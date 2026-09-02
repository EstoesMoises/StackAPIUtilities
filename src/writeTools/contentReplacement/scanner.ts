import { defaultTreeAdapter, parseFragment, type DefaultTreeAdapterTypes } from "parse5";

import type {
  AnswerSummary,
  ArticleSummary,
  ContentReplacementClient,
  QuestionSummary,
  SearchSummary,
} from "./contentApi";
import { replaceMarkdown } from "./markdown";
import { buildReplacementProposal, toReplacementWireRequestModel } from "./proposals";
import { normalizeExactTargetProof, verifyExactTargetProof } from "./exactManifest";
import {
  MAX_CONTENT_REPLACEMENT_REQUEST_MODEL_BYTES,
  isJsonWithinUtf8ByteLimit,
} from "./limits";
import type {
  DetailBatchResult,
  ExactTargetProof,
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
  exactProofs?: readonly ExactTargetProof[];
  configuration: ReplacementConfiguration;
}

export class ContentReplacementRequestModelLimitError extends RangeError {
  constructor() {
    super("Content replacement request model exceeds the 2 MiB recovery-safe limit.");
    this.name = "ContentReplacementRequestModelLimitError";
  }
}

export async function scanInventorySlice(
  client: ContentReplacementClient,
  input: InventorySliceInput,
): Promise<InventorySliceResult> {
  const { cursor, configuration } = input;
  assertCursorMatchesDiscovery(cursor, configuration);

  if (cursor.kind === "search") {
    const rule = configuration.rules.find((candidate) => candidate.id === cursor.ruleId);
    if (!rule) throw new TypeError("Targeted search cursor must reference a configured rule.");
    const page = await client.getSearchPage(rule.find, cursor.page);
    return {
      candidates: page.items
        .filter((summary) => isSearchResultSelected(summary, configuration))
        .map(searchRef),
      answerCursors: [],
      nextCursor: page.hasMore ? { kind: "search", ruleId: rule.id, page: cursor.page + 1 } : null,
      inspectedCount: page.items.length,
      pageKind: "search",
      progress: inventoryProgress({
        searchPages: 1,
        searchTermsCompleted: page.hasMore ? 0 : 1,
      }),
    };
  }

  if (cursor.kind === "questions") {
    const page = await client.getQuestionsPage(cursor.page);
    const answerCursors = configuration.contentTypes.answers
      ? page.items
          .filter((summary) => !hasKnownZeroAnswers(summary.answerCount))
          .map((summary) => ({ kind: "answers" as const, questionId: summary.id, page: 1 }))
      : [];
    return {
      candidates: configuration.contentTypes.questions
        ? page.items.filter((summary) => isQuestionCandidate(summary, configuration)).map(questionRef)
        : [],
      answerCursors,
      nextCursor: page.hasMore ? { kind: "questions", page: cursor.page + 1 } : null,
      inspectedCount: page.items.length,
      pageKind: "questions",
      progress: inventoryProgress({
        answerBearingQuestionsQueued: answerCursors.length,
        zeroAnswerQuestionsSkipped: configuration.contentTypes.answers
          ? page.items.filter((summary) => hasKnownZeroAnswers(summary.answerCount)).length
          : 0,
      }),
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
      progress: inventoryProgress(),
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
    progress: inventoryProgress(),
  };
}

function assertCursorMatchesDiscovery(
  cursor: InventoryCursor,
  configuration: ReplacementConfiguration,
): void {
  if (
    (configuration.discovery.mode === "targeted" && cursor.kind === "search") ||
    (configuration.discovery.mode === "full" && cursor.kind !== "search")
  ) {
    return;
  }
  throw new TypeError("Inventory cursor does not match replacement discovery mode.");
}

function inventoryProgress(
  values: Partial<InventorySliceResult["progress"]> = {},
): InventorySliceResult["progress"] {
  return {
    apiRequestsCompleted: 1,
    searchPages: 0,
    searchTermsCompleted: 0,
    answerBearingQuestionsQueued: 0,
    zeroAnswerQuestionsSkipped: 0,
    ...values,
  };
}

function hasKnownZeroAnswers(answerCount: unknown): boolean {
  return typeof answerCount === "number" && Number.isSafeInteger(answerCount) && answerCount === 0;
}

function isSearchResultSelected(
  summary: SearchSummary,
  configuration: ReplacementConfiguration,
): boolean {
  return (summary.type === "question" && configuration.contentTypes.questions) ||
    (summary.type === "answer" && configuration.contentTypes.answers) ||
    (summary.type === "article" && configuration.contentTypes.articles);
}

function searchRef(summary: SearchSummary): ReplacementItemRef {
  if (summary.type === "question") return { kind: "question", questionId: summary.questionId };
  if (summary.type === "answer") {
    return { kind: "answer", questionId: summary.parentQuestionId, answerId: summary.answerId };
  }
  return { kind: "article", articleId: summary.articleId };
}

export async function scanDetailBatch(
  client: ContentReplacementClient,
  input: DetailBatchInput,
): Promise<DetailBatchResult> {
  assertValidDetailRefs(input.refs);
  const exactProofs = await validateDetailProofs(input);

  const proposals: DetailBatchResult["proposals"] = [];
  let protectedOccurrenceCount = 0;
  for (let offset = 0; offset < input.refs.length; offset += MAX_CONCURRENT_DETAIL_REQUESTS) {
    const batch = input.refs.slice(offset, offset + MAX_CONCURRENT_DETAIL_REQUESTS);
    const batchResults = await Promise.all(
      batch.map(async (ref, index) => {
        const detail = await client.getItem(ref);
        if (!isJsonWithinUtf8ByteLimit(
          toReplacementWireRequestModel(detail),
          MAX_CONTENT_REPLACEMENT_REQUEST_MODEL_BYTES,
        )) {
          throw new ContentReplacementRequestModelLimitError();
        }
        const proposal = await buildReplacementProposal(
          detail,
          input.configuration,
          exactProofs?.[offset + index],
        );
        return {
          proposal,
          protectedOccurrenceCount: proposal
            ? proposal.protectedOccurrences.length
            : replaceMarkdown(
                detail.request.body,
                input.configuration.rules,
                input.configuration.options,
              ).protectedOccurrences.length,
        };
      }),
    );
    proposals.push(
      ...batchResults.flatMap(({ proposal }) => proposal === null ? [] : [proposal]),
    );
    protectedOccurrenceCount += batchResults.reduce(
      (count, result) => count + result.protectedOccurrenceCount,
      0,
    );
  }

  return {
    proposals,
    inspectedCount: input.refs.length,
    protectedOccurrenceCount,
  };
}

async function validateDetailProofs(
  input: DetailBatchInput,
): Promise<ExactTargetProof[] | undefined> {
  if (input.configuration.discovery.mode !== "exact") {
    if (input.exactProofs !== undefined) {
      throw new TypeError("Exact manifest proofs are only valid for Exact discovery.");
    }
    return undefined;
  }
  if (!Array.isArray(input.exactProofs) || input.exactProofs.length !== input.refs.length) {
    throw new TypeError("Exact manifest proof count must match the detail references.");
  }
  const proofs: ExactTargetProof[] = [];
  for (let index = 0; index < input.refs.length; index += 1) {
    const proof = normalizeExactTargetProof(input.exactProofs[index]);
    if (!proof || !await verifyExactTargetProof(
      input.refs[index],
      proof,
      input.configuration.discovery,
    )) {
      throw new TypeError("Exact manifest proof does not match its detail reference.");
    }
    proofs.push(proof);
  }
  return proofs;
}

function isQuestionCandidate(
  summary: QuestionSummary,
  configuration: ReplacementConfiguration,
): boolean {
  return titleContainsCandidate(summary.title, configuration) ||
    fieldsContainCandidate([summary.body], configuration);
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
  return titleContainsCandidate(summary.title, configuration) ||
    fieldsContainCandidate([summary.body], configuration);
}

function titleContainsCandidate(
  title: unknown,
  configuration: ReplacementConfiguration,
): boolean {
  if (typeof title !== "string") return true;
  try {
    if (configuration.rules.some((rule) => termMatches(title, rule, configuration))) return true;
  } catch {
    return true;
  }
  return fieldsContainCandidate([title], configuration);
}

function fieldsContainCandidate(
  fields: readonly unknown[],
  configuration: ReplacementConfiguration,
): boolean {
  const visibleFields = fields.map(visibleText);
  if (visibleFields.some((field) => field === null)) return true;

  try {
    return visibleFields.some((field) =>
      field!.some((source) =>
        configuration.rules.some((rule) => termMatches(source, rule, configuration)),
      ),
    );
  } catch {
    return true;
  }
}

function visibleText(value: unknown): string[] | null {
  if (typeof value !== "string") return null;

  try {
    const fragment = parseFragment(value);
    const textNodes: string[] = [];
    collectVisibleText(fragment, textNodes);
    return [...textNodes, textNodes.join("")];
  } catch {
    return null;
  }
}

function collectVisibleText(node: DefaultTreeAdapterTypes.Node, textNodes: string[]): void {
  if (defaultTreeAdapter.isTextNode(node)) {
    textNodes.push(node.value);
    return;
  }
  if (
    "tagName" in node &&
    (node.tagName === "script" || node.tagName === "style" || node.tagName === "template")
  ) {
    return;
  }
  if (!("childNodes" in node)) return;
  node.childNodes.forEach((child) => collectVisibleText(child, textNodes));
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

export function assertValidDetailRefs(refs: readonly ReplacementItemRef[]): void {
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
