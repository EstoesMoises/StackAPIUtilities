import { readNonNegativeNumber, readQuestionTags, readTagIdentity } from "../../domain/tagNormalization";
import type { InstanceType } from "../../domain/types";
import type { ReportJob, ReportReadRequest, ReportReadResponse, ReportTimeEstimate } from "./types";

export type TagReportInventory = Record<
  "tags" | "users" | "questions" | "articles" | "answers" | "comments" | "tagSmeCounts",
  Record<string, unknown>[]
>;

type RequestRange = { minimum: number; maximum: number };
interface AnswerPageEstimate {
  path: string;
  remainingPages: number;
  remainingAnswers: number;
  unknown: boolean;
  totalPages: number | null;
}
interface EstimateDetails {
  // These indexes are built once and only read during consumption. Copying the full
  // inventory per completed request would make large reports quadratic.
  answerCounts: Readonly<Record<string, number | null>>;
  legacyPages: Readonly<Record<string, number>>;
  unknownQuestions: number;
  activeAnswers?: AnswerPageEstimate;
  communityPages?: RequestRange;
}

export interface RemainingReportWork {
  v2: RequestRange;
  v3: RequestRange;
  unknown: boolean;
  /** Ephemeral bookkeeping; pass the returned work unchanged to the next read. */
  details?: EstimateDetails;
}

const PAGE_SIZE = 100;
const answerCountFields = ["answer_count", "answerCount"];
const commentCountFields = ["comment_count", "commentCount"];

/** Ranges describe likely enrichment work, not guaranteed upper bounds. Root lists are already cached. */
export function estimateTagWork(inventory: TagReportInventory, instanceType: InstanceType): RemainingReportWork {
  const work: RemainingReportWork = {
    v2: { minimum: 0, maximum: 0 }, v3: { minimum: 0, maximum: 0 }, unknown: false,
  };
  const answerCounts: Record<string, number | null> = Object.create(null);
  const legacyPages: Record<string, number> = Object.create(null);
  const details: EstimateDetails = { answerCounts, legacyPages, unknownQuestions: 0 };
  const tagsWithAnswers = new Set<string>();
  const seenPosts = new Set<string>();

  for (const [dataset, records] of [["questions", inventory.questions], ["articles", inventory.articles]] as const) {
    for (const record of records) {
      const count = readNonNegativeNumber(record, answerCountFields);
      if (dataset === "questions" && count !== 0) {
        for (const tag of readQuestionTags(record)) tagsWithAnswers.add(tag.key);
      }
      const id = detailId(record, dataset === "questions" ? ["question_id", "questionId", "id"] : ["article_id", "articleId", "id"]);
      if (id === null) continue;
      const path = `/${dataset}/${id}`;
      if (seenPosts.has(path)) continue;
      seenPosts.add(path);
      if (dataset === "questions" && count !== 0) {
        answerCounts[`${path}/answers`] = count;
        const pages = Math.max(1, Math.ceil((count ?? 0) / PAGE_SIZE));
        add(work.v3, pages, pages + (count ?? 0));
        if (count === null) details.unknownQuestions += 1;
      }
      if (readNonNegativeNumber(record, commentCountFields) !== 0) add(work.v3, 1, 1);
    }
  }

  const authoritativeTags = new Set<string>();
  const seenDetails = new Set<string>();
  for (const tag of inventory.tagSmeCounts) {
    const identity = readTagIdentity(tag);
    const count = readNonNegativeNumber(tag, ["subjectMatterExpertCount"]);
    if (identity !== null && count !== null) authoritativeTags.add(identity.key);
    const id = detailId(tag, ["tag_id", "tagId", "id"]);
    if (id === null || (count ?? 0) === 0 || (identity !== null && !tagsWithAnswers.has(identity.key))) continue;
    if (!seenDetails.has(id)) add(work.v3, 1, 2);
    seenDetails.add(id);
  }
  if (instanceType === "enterprise" && inventory.tagSmeCounts.length > 0) {
    details.communityPages = { minimum: 1, maximum: 2 };
    add(work.v3, 1, 2);
  }

  for (const tag of inventory.tags) {
    const identity = readTagIdentity(tag);
    if (identity === null || authoritativeTags.has(identity.key)) continue;
    const name = tag.name ?? tag.tagName ?? tag.tag_name;
    if (typeof name !== "string" || !name.trim()) continue;
    const path = `/tags/${encodeURIComponent(name)}/top-answerers/all_time`;
    if (legacyPages[path] !== undefined) continue;
    const pages = Math.max(1, Math.ceil(inventory.users.length / PAGE_SIZE));
    legacyPages[path] = pages;
    add(work.v2, 1, pages);
  }

  const knownPosts = new Set<string>();
  for (const [records, aliases] of [
    [inventory.questions, ["question_id", "questionId", "id"]],
    [inventory.articles, ["article_id", "articleId", "id"]],
  ] as const) {
    for (const record of records) {
      const id = parentId(record, aliases);
      if (id !== null) knownPosts.add(id);
    }
  }
  const missingAnswerParents = missingParents(inventory.answers, ["question_id", "questionId"], knownPosts);
  const answerParentPages = Math.ceil(missingAnswerParents.size / PAGE_SIZE);
  add(work.v2, answerParentPages, answerParentPages);
  // Comment enrichment knows every answer in the root answer inventory, even if
  // that answer's tags were obtained by the preceding parent lookup.
  for (const answer of inventory.answers) {
    const id = parentId(answer, ["answer_id", "answerId", "id"]);
    if (id !== null) knownPosts.add(id);
  }
  const missingCommentParents = missingParents(inventory.comments, ["post_id", "postId"], knownPosts);
  const commentParentPages = Math.ceil(missingCommentParents.size / PAGE_SIZE);
  // Each missing post is tried as question, article and answer. Returned answers
  // can require a further batched question lookup.
  add(work.v2, commentParentPages * 3, commentParentPages * 4);
  return { ...work, unknown: details.unknownQuestions > 0, details };
}

/** Called once per distinct replayed or newly completed read, in collector order. */
export function consumeEstimatedRead(
  work: RemainingReportWork,
  request: ReportReadRequest,
  response: ReportReadResponse,
): RemainingReportWork {
  if (isInventoryRead(request)) return work;
  const unsupportedCommunities = request.api === "v3" && request.path === "/communities"
    && (response.status === 403 || response.status === 404);
  if (!unsupportedCommunities && (response.status < 200 || response.status >= 300)) return work;
  const next: RemainingReportWork = {
    ...work, v2: { ...work.v2 }, v3: { ...work.v3 },
    ...(work.details ? { details: { ...work.details } } : {}),
  };
  const body = isRecord(response.body) ? response.body : {};
  const page = Math.max(1, Number(request.query.page) || 1);

  if (request.api === "v3" && /^\/questions\/[^/]+\/answers$/.test(request.path)
    && next.details && Object.prototype.hasOwnProperty.call(next.details.answerCounts, request.path)) {
    consumeAnswerPage(next, request, body, page);
  } else if (request.api === "v3" && request.path === "/communities" && next.details?.communityPages) {
    const previous = next.details.communityPages;
    const totalPages = readNonNegativeNumber(body, ["totalPages"]);
    const hasItems = Array.isArray(body.items) && body.items.length > 0;
    const remaining = unsupportedCommunities || (!hasItems && totalPages === null) ? 0
      : totalPages !== null ? Math.max(0, totalPages - page) : 1;
    const maximum = totalPages !== null || remaining === 0 ? remaining : Math.max(remaining, previous.maximum - 1);
    add(next.v3, remaining - previous.minimum, maximum - previous.maximum);
    next.details.communityPages = { minimum: remaining, maximum };
  } else {
    add(next[request.api], -1, -1);
    if (request.api === "v3" && /^\/tags\/[^/]+$/.test(request.path)) {
      // Every eligible detail initially reserves one optional fallback membership read.
      if (body.subjectMatterExperts !== undefined && body.subjectMatterExperts !== null) add(next.v3, 0, -1);
      else add(next.v3, 1, 0);
    }
    if (request.api === "v2" && typeof body.has_more === "boolean") {
      const expectedPages = next.details?.legacyPages[request.path] ?? 1;
      if (body.has_more) add(next.v2, 1, page >= expectedPages ? 1 : 0);
      else add(next.v2, 0, -Math.max(0, expectedPages - page));
    }
  }
  for (const api of ["v2", "v3"] as const) {
    next[api].minimum = Math.max(0, next[api].minimum);
    next[api].maximum = Math.max(next[api].minimum, next[api].maximum);
  }
  return next;
}

function consumeAnswerPage(work: RemainingReportWork, request: ReportReadRequest, body: Record<string, unknown>, page: number): void {
  const details = work.details!;
  const count = details.answerCounts[request.path];
  // Question enrichment reads all pages of one answer collection before moving
  // to another question; only that active collection needs mutable-size state.
  const previous = details.activeAnswers?.path === request.path ? details.activeAnswers : {
    path: request.path,
    remainingPages: Math.max(1, Math.ceil((count ?? 0) / PAGE_SIZE)),
    remainingAnswers: count ?? 0,
    unknown: count === null,
    totalPages: null,
  };
  const items = Array.isArray(body.items) ? body.items.filter(isRecord) : [];
  const totalPages = readNonNegativeNumber(body, ["totalPages"]) ?? previous.totalPages;
  const remainingPages = totalPages !== null ? Math.max(0, totalPages - page)
    : items.length === 0 ? 0 : Math.max(1, previous.remainingPages - 1);
  let remainingAnswers = Math.max(0, previous.remainingAnswers - items.length);
  if (remainingPages === 0) remainingAnswers = 0;
  else if (previous.unknown || remainingPages > previous.remainingPages - 1) {
    remainingAnswers = Math.max(remainingAnswers, remainingPages * PAGE_SIZE);
  }
  const commentReads = items.filter((answer) => !answer.isDeleted && !answer.is_deleted
    && readNonNegativeNumber(answer, commentCountFields) !== 0
    && detailId(answer, ["id", "answerId", "answer_id"]) !== null).length;
  add(work.v3,
    remainingPages - previous.remainingPages + commentReads,
    remainingPages - previous.remainingPages + remainingAnswers - previous.remainingAnswers + commentReads);
  const unknown = previous.unknown && totalPages === null && remainingPages > 0;
  if (previous.unknown && !unknown) details.unknownQuestions = Math.max(0, details.unknownQuestions - 1);
  details.activeAnswers = { path: request.path, remainingPages, remainingAnswers, totalPages, unknown };
  work.unknown = details.unknownQuestions > 0;
}

/** Uses active request measurements only; pauses and scheduled retry waits are separate UI states. */
export function estimateReportTime(work: RemainingReportWork, timings: ReportJob["timings"]): ReportTimeEstimate | null {
  if (work.unknown || work.v2.maximum + work.v3.maximum <= 0) return null;
  const useful = (["v2", "v3"] as const).map((api) => timings[api]).filter((timing) =>
    Number.isFinite(timing.count) && timing.count > 0 && Number.isFinite(timing.milliseconds) && timing.milliseconds > 0);
  const samples = useful.reduce((total, timing) => total + timing.count, 0);
  if (samples < 3) return null;
  const fallback = useful.reduce((total, timing) => total + timing.milliseconds, 0) / samples;
  let minimumMs = 0;
  let maximumMs = 0;
  for (const api of ["v2", "v3"] as const) {
    const timing = timings[api];
    const ownRate = useful.includes(timing) ? timing.milliseconds / timing.count : null;
    const rate = ownRate ?? fallback;
    const wellSampled = ownRate !== null && timing.count >= 3;
    minimumMs += work[api].minimum * rate * (wellSampled ? 0.8 : 0.5);
    maximumMs += work[api].maximum * rate * (wellSampled ? 1.5 : ownRate === null ? 3 : 2);
  }
  if (!Number.isFinite(maximumMs) || maximumMs <= 0) return null;
  return { minimumSeconds: Math.max(0, Math.floor(minimumMs / 1_000)), maximumSeconds: Math.max(1, Math.ceil(maximumMs / 1_000)) };
}

export function formatReportTimeEstimate(estimate: ReportTimeEstimate): string {
  if (estimate.maximumSeconds < 60) return "Less than a minute";
  const hours = estimate.maximumSeconds >= 3_600;
  const divisor = hours ? 3_600 : 60;
  // Round outward; a small lower bound must not round up to half an hour.
  const scale = hours ? 2 : 1;
  const minimum = Math.max(0, Math.floor(estimate.minimumSeconds / divisor * scale) / scale);
  const maximum = Math.max(minimum, Math.ceil(estimate.maximumSeconds / divisor * scale) / scale);
  const unit = hours ? "hour" : "minute";
  if (minimum === 0) return `Up to ${maximum} ${unit}${maximum === 1 ? "" : "s"}`;
  return minimum === maximum ? `${minimum} ${unit}${minimum === 1 ? "" : "s"}` : `${minimum}–${maximum} ${unit}s`;
}

function add(range: RequestRange, minimum: number, maximum: number): void {
  range.minimum += minimum;
  range.maximum += maximum;
}
function isInventoryRead(request: ReportReadRequest): boolean {
  return request.api === "v2" ? /^\/(tags|users|questions|articles|answers|comments)$/.test(request.path)
    : request.path === "/tags";
}
function missingParents(records: Record<string, unknown>[], aliases: readonly string[], knownPosts: ReadonlySet<string>): Set<string> {
  const missing = new Set<string>();
  for (const record of records) {
    if (record.tags !== undefined || record.tagNames !== undefined || record.tag_names !== undefined) continue;
    const id = parentId(record, aliases);
    if (id !== null && !knownPosts.has(id)) missing.add(id);
  }
  return missing;
}
function parentId(record: Record<string, unknown>, aliases: readonly string[]): string | null {
  for (const alias of aliases) {
    const value = record[alias];
    if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return String(value);
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}
function detailId(record: Record<string, unknown>, aliases: readonly string[]): string | null {
  for (const alias of aliases) {
    const value = record[alias];
    if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) return String(value);
    if (typeof value === "string" && value.trim()) return encodeURIComponent(value.trim());
  }
  return null;
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
