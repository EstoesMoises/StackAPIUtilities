import { dateToUnixSeconds } from "../domain/reportScope";
import { readQuestionTags, readTagIdentity } from "../domain/tagNormalization";
import type { DatasetName, PeriodScope, ReportId, RunPeriodRole } from "../domain/types";
import { buildTagLastUsedRows } from "../reports/tagLastUsed";

export interface LiveCollectorClients {
  v2: DatasetClient;
  v3: DatasetClient;
}

export interface DatasetClient {
  getPagedResult(
    path: string,
    query?: Record<string, string>,
    options?: { maxPages?: number },
  ): Promise<DatasetPagedResult<unknown>>;
  getPagedItems(
    path: string,
    query?: Record<string, string>,
    options?: { maxPages?: number },
  ): Promise<unknown[]>;
}

export interface DatasetPaginationMetadata {
  pageCount: number;
  reachedMaxPages: boolean;
  hasMore: boolean;
}

export interface DatasetPagedResult<T> extends DatasetPaginationMetadata {
  items: T[];
}

export interface CollectedDatasetResult {
  records: unknown[];
  pagination: DatasetPaginationMetadata;
}

export const INTERNAL_API_PAGE_SIZE = 100;

export interface LiveCollectorContext {
  collectedDatasets?: Partial<Record<DatasetName, Record<string, unknown>[]>>;
  periodRole?: RunPeriodRole;
  reportId?: ReportId;
  scope?: PeriodScope;
}

interface LiveDatasetEndpoint {
  client: keyof LiveCollectorClients;
  path: string;
}

const liveDatasetEndpoints: Partial<Record<DatasetName, LiveDatasetEndpoint>> = {
  users: { client: "v2", path: "/users" },
  tags: { client: "v2", path: "/tags" },
  questions: { client: "v2", path: "/questions" },
  answers: { client: "v2", path: "/answers" },
  comments: { client: "v2", path: "/comments" },
  articles: { client: "v2", path: "/articles" },
  communities: { client: "v3", path: "/communities" },
  userGroups: { client: "v3", path: "/user-groups" },
  tagSmeCounts: { client: "v3", path: "/tags" },
};

const dependentLiveDatasets = new Set<DatasetName>(["tagSmes", "tagLastUsed", "reputationHistory"]);

export class UnsupportedLiveDatasetError extends Error {
  constructor(public readonly dataset: DatasetName) {
    super(`Dataset ${dataset} is not mapped for live API collection yet.`);
  }
}

export function isLiveDatasetCollectable(dataset: DatasetName): boolean {
  return getLiveDatasetClient(dataset) !== null;
}

export function getUnsupportedLiveDatasets(datasets: readonly DatasetName[]): DatasetName[] {
  return datasets.filter((dataset) => !isLiveDatasetCollectable(dataset));
}

export function getLiveDatasetClient(dataset: DatasetName): keyof LiveCollectorClients | null {
  const endpoint = liveDatasetEndpoints[dataset];
  if (endpoint) {
    return endpoint.client;
  }

  if (dependentLiveDatasets.has(dataset)) {
    return "v2";
  }

  return null;
}

export async function collectDataset(
  dataset: DatasetName,
  clients: LiveCollectorClients,
  context: LiveCollectorContext = {},
): Promise<CollectedDatasetResult> {
  if (dataset === "tagSmes") {
    return collectTagSmes(clients, getCollectedDataset(context, "tags"), context);
  }

  if (dataset === "tagLastUsed") {
    return collectTagLastUsed(clients, getCollectedDataset(context, "tagSmeCounts"), context);
  }

  if (dataset === "reputationHistory") {
    return collectReputationHistory(clients, getCollectedDataset(context, "users"), context);
  }

  const endpoint = liveDatasetEndpoints[dataset];

  if (!endpoint) {
    throw new UnsupportedLiveDatasetError(dataset);
  }

  const collected = await collectPagedResult(
    clients[endpoint.client],
    endpoint.path,
    buildDatasetQuery(context, endpoint.client, endpoint.client === "v2"),
  );

  if (context.reportId === "tag-report" && dataset === "answers") {
    return enrichTagAnswerParents(clients.v2, collected, context);
  }
  if (context.reportId === "tag-report" && dataset === "comments") {
    return enrichTagCommentParents(clients.v2, collected, context);
  }
  return collected;
}

async function enrichTagAnswerParents(
  client: DatasetClient,
  collected: CollectedDatasetResult,
  context: LiveCollectorContext,
): Promise<CollectedDatasetResult> {
  const answers = toRecordList(collected.records);
  const postTags = buildKnownPostTags(context);
  const missingQuestionIds = uniqueValues(answers
    .filter((answer) => !hasExplicitTags(answer))
    .map((answer) => getRecordId(answer, "question_id", "questionId"))
    .filter((id) => id !== null && !postTags.has(id)));
  addParentTags(postTags, await fetchTaggedParents(client, "questions", missingQuestionIds));

  return {
    ...collected,
    records: answers.map((answer) => {
      const questionId = getRecordId(answer, "question_id", "questionId");
      const tags = questionId === null ? undefined : postTags.get(questionId);
      return tags === undefined || hasExplicitTags(answer) ? answer : { ...answer, tags };
    }),
  };
}

async function enrichTagCommentParents(
  client: DatasetClient,
  collected: CollectedDatasetResult,
  context: LiveCollectorContext,
): Promise<CollectedDatasetResult> {
  const comments = toRecordList(collected.records);
  const postTags = buildKnownPostTags(context);
  const missingPostIds = uniqueValues(comments
    .filter((comment) => !hasExplicitTags(comment))
    .map((comment) => getRecordId(comment, "post_id", "postId"))
    .filter((id) => id !== null && !postTags.has(id)));

  if (missingPostIds.length > 0) {
    const [questions, articles, answers] = await Promise.all([
      fetchTaggedParents(client, "questions", missingPostIds),
      fetchTaggedParents(client, "articles", missingPostIds),
      fetchParents(client, "answers", missingPostIds),
    ]);
    addParentTags(postTags, questions);
    addParentTags(postTags, articles);

    const missingQuestionIds = uniqueValues(answers
      .map((answer) => getRecordId(answer, "question_id", "questionId"))
      .filter((id) => id !== null && !postTags.has(id)));
    addParentTags(postTags, await fetchTaggedParents(client, "questions", missingQuestionIds));
    for (const answer of answers) {
      const answerId = getRecordId(answer, "answer_id", "answerId", "id");
      const questionId = getRecordId(answer, "question_id", "questionId");
      const tags = questionId === null ? undefined : postTags.get(questionId);
      if (answerId !== null && tags !== undefined) postTags.set(answerId, tags);
    }
  }

  return {
    ...collected,
    records: comments.map((comment) => {
      const postId = getRecordId(comment, "post_id", "postId");
      const tags = postId === null ? undefined : postTags.get(postId);
      return tags === undefined || hasExplicitTags(comment) ? comment : { ...comment, tags };
    }),
  };
}

function buildKnownPostTags(context: LiveCollectorContext): Map<string, string[]> {
  const postTags = new Map<string, string[]>();
  for (const [dataset, aliases] of [
    ["questions", ["question_id", "questionId", "id"]],
    ["articles", ["article_id", "articleId", "id"]],
    ["answers", ["answer_id", "answerId", "id"]],
  ] as const) {
    for (const record of getCollectedDataset(context, dataset)) {
      const id = getRecordId(record, ...aliases);
      if (id !== null) postTags.set(id, getTagNames(record));
    }
  }
  return postTags;
}

async function fetchTaggedParents(
  client: DatasetClient,
  dataset: "questions" | "articles",
  ids: string[],
): Promise<Map<string, string[]>> {
  const records = await fetchParents(client, dataset, ids);
  const tags = new Map<string, string[]>();
  const aliases = dataset === "questions" ? ["question_id", "questionId", "id"] : ["article_id", "articleId", "id"];
  for (const record of records) {
    const id = getRecordId(record, ...aliases);
    if (id !== null) tags.set(id, getTagNames(record));
  }
  return tags;
}

async function fetchParents(
  client: DatasetClient,
  dataset: "questions" | "articles" | "answers",
  ids: string[],
): Promise<Record<string, unknown>[]> {
  const records: Record<string, unknown>[] = [];
  for (const batch of chunk(ids, INTERNAL_API_PAGE_SIZE)) {
    const result = await client.getPagedResult(`/${dataset}/${batch.join(";")}`, {
      pagesize: String(INTERNAL_API_PAGE_SIZE),
    });
    if (result.hasMore || result.reachedMaxPages) {
      throw new Error(`Incomplete ${dataset} parent lookup for Tag Report contributors.`);
    }
    records.push(...toRecordList(result.items));
  }
  return records;
}

function addParentTags(target: Map<string, string[]>, source: Map<string, string[]>): void {
  for (const [id, tags] of source) target.set(id, tags);
}

function hasExplicitTags(record: Record<string, unknown>): boolean {
  return record.tags !== undefined || record.tagNames !== undefined || record.tag_names !== undefined;
}

function getTagNames(record: Record<string, unknown>): string[] {
  return readQuestionTags(record).map((tag) => tag.displayName);
}

function getRecordId(record: Record<string, unknown>, ...aliases: string[]): string | null {
  for (const alias of aliases) {
    const value = record[alias];
    if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return String(value);
    if (typeof value === "string" && value.trim() !== "") return value.trim();
  }
  return null;
}

async function collectTagSmes(
  clients: LiveCollectorClients,
  tags: Record<string, unknown>[],
  context: LiveCollectorContext,
): Promise<CollectedDatasetResult> {
  const records: Record<string, unknown>[] = [];
  let pagination = createEmptyPaginationMetadata();

  for (const tagName of uniqueValues(tags.map(getTagName))) {
    const tagScores = await collectPagedResult(
      clients.v2,
      `/tags/${encodeURIComponent(tagName)}/top-answerers/all_time`,
      buildDatasetQuery(context, "v2", false),
    );

    records.push(...toRecordList(tagScores.records).map((record) => ({ tagName, ...record })));
    pagination = mergePaginationMetadata(pagination, tagScores.pagination);
  }

  return { records, pagination };
}

async function collectReputationHistory(
  clients: LiveCollectorClients,
  users: Record<string, unknown>[],
  context: LiveCollectorContext,
): Promise<CollectedDatasetResult> {
  const records: Record<string, unknown>[] = [];
  let pagination = createEmptyPaginationMetadata();
  const userIds = uniqueValues(users.map((user) => getNumberField(user, "user_id", "userId", "id")));

  for (const userIdBatch of chunk(userIds, 100)) {
    const reputationEvents = await collectPagedResult(
      clients.v2,
      `/users/${userIdBatch.join(";")}/reputation-history`,
      buildDatasetQuery(context, "v2", true),
    );

    records.push(...toRecordList(reputationEvents.records));
    pagination = mergePaginationMetadata(pagination, reputationEvents.pagination);
  }

  return { records, pagination };
}

async function collectTagLastUsed(
  clients: LiveCollectorClients,
  knownTags: Record<string, unknown>[],
  context: LiveCollectorContext,
): Promise<CollectedDatasetResult> {
  const knownTagRecords = knownTags.filter((tag) => readTagIdentity(tag) !== null);
  if (knownTagRecords.length === 0) {
    return { records: [], pagination: createEmptyPaginationMetadata() };
  }

  const query = buildDatasetQuery(context, "v2", false);
  const [questions, articles] = await Promise.all([
    collectPagedResult(clients.v2, "/questions", query),
    collectPagedResult(clients.v2, "/articles", query),
  ]);

  return {
    records: buildTagLastUsedRows(knownTagRecords, [
      ...toRecordList(questions.records),
      ...toRecordList(articles.records),
    ]),
    pagination: mergePaginationMetadata(questions.pagination, articles.pagination),
  };
}

async function collectPagedResult(
  client: DatasetClient,
  path: string,
  query: Record<string, string>,
): Promise<CollectedDatasetResult> {
  const result = await client.getPagedResult(path, query);

  return {
    records: result.items,
    pagination: {
      pageCount: result.pageCount,
      reachedMaxPages: result.reachedMaxPages,
      hasMore: result.hasMore,
    },
  };
}

function buildDatasetQuery(
  context: LiveCollectorContext,
  client: keyof LiveCollectorClients,
  includeDateScope: boolean,
): Record<string, string> {
  const pageSizeKey = client === "v2" ? "pagesize" : "pageSize";
  const query: Record<string, string> = {
    [pageSizeKey]: String(INTERNAL_API_PAGE_SIZE),
  };

  if (!includeDateScope) {
    return query;
  }

  if (context.scope?.startDate) {
    query.fromdate = String(dateToUnixSeconds(context.scope.startDate));
  }

  if (context.scope?.endDate) {
    query.todate = String(dateToUnixSeconds(context.scope.endDate));
  }

  return query;
}

function getCollectedDataset(
  context: LiveCollectorContext,
  dataset: DatasetName,
): Record<string, unknown>[] {
  return context.collectedDatasets?.[dataset] ?? [];
}

function getTagName(tag: Record<string, unknown>): string | null {
  const value = tag.name ?? tag.tagName ?? tag.tag_name;
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

function getNumberField(record: Record<string, unknown>, ...fieldNames: string[]): number | null {
  for (const fieldName of fieldNames) {
    const value = record[fieldName];
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === "string") {
      const parsed = Number.parseInt(value, 10);
      if (!Number.isNaN(parsed)) {
        return parsed;
      }
    }
  }

  return null;
}

function uniqueValues<T extends string | number>(values: (T | null)[]): T[] {
  return [...new Set(values.filter((value): value is T => value !== null))];
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];

  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }

  return chunks;
}

function toRecordList(records: unknown[]): Record<string, unknown>[] {
  return records.map((record) => {
    if (typeof record === "object" && record !== null && !Array.isArray(record)) {
      return record as Record<string, unknown>;
    }

    return { value: record };
  });
}

function createEmptyPaginationMetadata(): DatasetPaginationMetadata {
  return {
    pageCount: 0,
    reachedMaxPages: false,
    hasMore: false,
  };
}

function mergePaginationMetadata(
  first: DatasetPaginationMetadata,
  second: DatasetPaginationMetadata,
): DatasetPaginationMetadata {
  return {
    pageCount: first.pageCount + second.pageCount,
    reachedMaxPages: first.reachedMaxPages || second.reachedMaxPages,
    hasMore: first.hasMore || second.hasMore,
  };
}
