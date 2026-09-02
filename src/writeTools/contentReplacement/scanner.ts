import { defaultTreeAdapter, parseFragment, type DefaultTreeAdapterTypes } from "parse5";

import type {
  AnswerSummary,
  ArticleSummary,
  ContentReplacementClient,
  QuestionSummary,
} from "./contentApi";
import { buildReplacementProposal } from "./proposals";
import type {
  DetailBatchResult,
  InventoryCursor,
  InventorySliceResult,
  ReplacementConfiguration,
  ReplacementItemRef,
  ReplacementRule,
} from "./types";

const MAX_DETAIL_BATCH_SIZE = 10;
const MAX_CONCURRENT_DETAIL_REQUESTS = 4;

interface InventorySliceInput {
  cursor: InventoryCursor;
  configuration: ReplacementConfiguration;
}

interface DetailBatchInput {
  refs: readonly ReplacementItemRef[];
  configuration: ReplacementConfiguration;
}

export async function scanInventorySlice(
  client: ContentReplacementClient,
  input: InventorySliceInput,
): Promise<InventorySliceResult> {
  const { cursor, configuration } = input;

  if (cursor.kind === "questions") {
    const page = await client.getQuestionsPage(cursor.page);
    return {
      candidates: configuration.contentTypes.questions
        ? page.items.filter((summary) => isQuestionCandidate(summary, configuration)).map(questionRef)
        : [],
      answerCursors: configuration.contentTypes.answers
        ? page.items.map((summary) => ({ kind: "answers", questionId: summary.id, page: 1 }))
        : [],
      nextCursor: page.hasMore ? { kind: "questions", page: cursor.page + 1 } : null,
      inspectedCount: page.items.length,
      pageKind: "questions",
    };
  }

  if (cursor.kind === "answers") {
    const page = await client.getAnswersPage(cursor.questionId, cursor.page);
    return {
      candidates: configuration.contentTypes.answers
        ? page.items
            .filter((summary) => isAnswerCandidate(summary, configuration))
            .map((summary) => answerRef(cursor.questionId, summary))
        : [],
      answerCursors: [],
      nextCursor: page.hasMore
        ? { kind: "answers", questionId: cursor.questionId, page: cursor.page + 1 }
        : null,
      inspectedCount: page.items.length,
      pageKind: "answers",
    };
  }

  const page = await client.getArticlesPage(cursor.page);
  return {
    candidates: configuration.contentTypes.articles
      ? page.items.filter((summary) => isArticleCandidate(summary, configuration)).map(articleRef)
      : [],
    answerCursors: [],
    nextCursor: page.hasMore ? { kind: "articles", page: cursor.page + 1 } : null,
    inspectedCount: page.items.length,
    pageKind: "articles",
  };
}

export async function scanDetailBatch(
  client: ContentReplacementClient,
  input: DetailBatchInput,
): Promise<DetailBatchResult> {
  assertValidDetailRefs(input.refs);

  const proposals: DetailBatchResult["proposals"] = [];
  for (let offset = 0; offset < input.refs.length; offset += MAX_CONCURRENT_DETAIL_REQUESTS) {
    const batch = input.refs.slice(offset, offset + MAX_CONCURRENT_DETAIL_REQUESTS);
    const batchProposals = await Promise.all(
      batch.map(async (ref) => {
        const detail = await client.getItem(ref);
        return buildReplacementProposal(detail, input.configuration);
      }),
    );
    proposals.push(...batchProposals.filter((proposal) => proposal !== null));
  }

  return {
    proposals,
    inspectedCount: input.refs.length,
    protectedOccurrenceCount: proposals.reduce(
      (count, proposal) => count + proposal.protectedOccurrences.length,
      0,
    ),
  };
}

function isQuestionCandidate(
  summary: QuestionSummary,
  configuration: ReplacementConfiguration,
): boolean {
  return fieldsContainCandidate([summary.title, summary.body], configuration);
}

function isAnswerCandidate(
  summary: AnswerSummary,
  configuration: ReplacementConfiguration,
): boolean {
  return fieldsContainCandidate([summary.body], configuration);
}

function isArticleCandidate(
  summary: ArticleSummary,
  configuration: ReplacementConfiguration,
): boolean {
  return fieldsContainCandidate([summary.title, summary.body], configuration);
}

function fieldsContainCandidate(
  fields: readonly unknown[],
  configuration: ReplacementConfiguration,
): boolean {
  const visibleFields = fields.map(visibleText);
  if (visibleFields.some((field) => field === null)) return true;

  try {
    return visibleFields.some((field) =>
      configuration.rules.some((rule) => termMatches(field!, rule, configuration)),
    );
  } catch {
    return true;
  }
}

function visibleText(value: unknown): string | null {
  if (typeof value !== "string") return null;

  try {
    const fragment = parseFragment(value);
    return collectVisibleText(fragment);
  } catch {
    return null;
  }
}

function collectVisibleText(node: DefaultTreeAdapterTypes.Node): string {
  if (defaultTreeAdapter.isTextNode(node)) return node.value;
  if (
    "tagName" in node &&
    (node.tagName === "script" || node.tagName === "style" || node.tagName === "template")
  ) {
    return "";
  }
  if (!("childNodes" in node)) return "";
  return node.childNodes.map(collectVisibleText).join("");
}

function termMatches(
  source: string,
  rule: ReplacementRule,
  configuration: ReplacementConfiguration,
): boolean {
  if (rule.find.length === 0) return false;
  const matcher = new RegExp(
    escapeRegExp(rule.find),
    configuration.options.caseSensitive ? "gu" : "giu",
  );
  for (const match of source.matchAll(matcher)) {
    const start = match.index;
    const end = start + match[0].length;
    if (!configuration.options.wholeTerm || hasWholeTermBoundaries(source, start, end)) return true;
  }
  return false;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function hasWholeTermBoundaries(source: string, start: number, end: number): boolean {
  const previous = characterBefore(source, start);
  const following = end < source.length ? String.fromCodePoint(source.codePointAt(end)!) : undefined;
  return !/[\p{L}\p{N}_]/u.test(previous ?? "") && !/[\p{L}\p{N}_]/u.test(following ?? "");
}

function characterBefore(value: string, index: number): string | undefined {
  if (index <= 0) return undefined;
  const lastCodeUnit = value.charCodeAt(index - 1);
  const start = lastCodeUnit >= 0xdc00 && lastCodeUnit <= 0xdfff ? index - 2 : index - 1;
  return String.fromCodePoint(value.codePointAt(start)!);
}

function questionRef(summary: QuestionSummary): ReplacementItemRef {
  return { kind: "question", questionId: summary.id };
}

function answerRef(questionId: number, summary: AnswerSummary): ReplacementItemRef {
  return { kind: "answer", questionId, answerId: summary.id };
}

function articleRef(summary: ArticleSummary): ReplacementItemRef {
  return { kind: "article", articleId: summary.id };
}

function assertValidDetailRefs(refs: readonly ReplacementItemRef[]): void {
  if (refs.length < 1 || refs.length > MAX_DETAIL_BATCH_SIZE) throw invalidDetailBatch();

  const keys = new Set<string>();
  for (const ref of refs) {
    const key = validRefKey(ref);
    if (key === null || keys.has(key)) throw invalidDetailBatch();
    keys.add(key);
  }
}

function validRefKey(ref: ReplacementItemRef): string | null {
  if (!ref || typeof ref !== "object") return null;
  if (ref.kind === "question" && isContentId(ref.questionId)) return `question:${ref.questionId}`;
  if (ref.kind === "article" && isContentId(ref.articleId)) return `article:${ref.articleId}`;
  if (ref.kind === "answer" && isContentId(ref.questionId) && isContentId(ref.answerId)) {
    return `answer:${ref.questionId}:${ref.answerId}`;
  }
  return null;
}

function isContentId(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function invalidDetailBatch(): TypeError {
  return new TypeError("Detail batch must contain 1 to 10 unique valid content references.");
}
