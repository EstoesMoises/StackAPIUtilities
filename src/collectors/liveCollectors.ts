import { dateToUnixSeconds } from "../domain/reportScope";
import type { DatasetName, PeriodScope, RunPeriodRole } from "../domain/types";

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

export interface LiveCollectorContext {
  collectedDatasets?: Partial<Record<DatasetName, Record<string, unknown>[]>>;
  periodRole?: RunPeriodRole;
  scope?: PeriodScope;
  pageSize?: number;
  maxPagesPerDataset?: number;
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
};

const dependentLiveDatasets = new Set<DatasetName>(["tagSmes", "reputationHistory"]);

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

  if (dataset === "reputationHistory") {
    return collectReputationHistory(clients, getCollectedDataset(context, "users"), context);
  }

  const endpoint = liveDatasetEndpoints[dataset];

  if (!endpoint) {
    throw new UnsupportedLiveDatasetError(dataset);
  }

  return collectPagedResult(
    clients[endpoint.client],
    endpoint.path,
    buildDatasetQuery(context, endpoint.client === "v2"),
    context,
  );
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
      buildDatasetQuery(context, false),
      context,
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
      buildDatasetQuery(context, true),
      context,
    );

    records.push(...toRecordList(reputationEvents.records));
    pagination = mergePaginationMetadata(pagination, reputationEvents.pagination);
  }

  return { records, pagination };
}

async function collectPagedResult(
  client: DatasetClient,
  path: string,
  query: Record<string, string>,
  context: LiveCollectorContext,
): Promise<CollectedDatasetResult> {
  const result = typeof context.maxPagesPerDataset === "number"
    ? await client.getPagedResult(path, query, { maxPages: context.maxPagesPerDataset })
    : await client.getPagedResult(path, query);

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
  includeDateScope: boolean,
): Record<string, string> {
  const query: Record<string, string> = {
    pagesize: String(context.pageSize ?? 100),
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
