import type { FetchLike, ThrottleNotice } from "../../api/httpClient";
import { createLiveCollectorClients } from "../../collectors/liveCollectorClients";
import { collectDataset, type CollectedDatasetResult } from "../../collectors/liveCollectors";
import { normalizeInstanceUrl, validateCredentialsForUtility } from "../../credentials/credentialRules";
import { readQuestionTags, readTagIdentity } from "../../domain/tagNormalization";
import type { ReportWarning, SessionCredentials } from "../../domain/types";
import { analyzeSmeCoverage } from "./analyzer";
import { buildSmeCoverageDecisionPack } from "./decisionPack";
import type { CollectedSource, SmeCoverageDecisionPack, SourcePagination } from "./model";
import { normalizeTagDemand } from "./tagDemand";
import { normalizeTagSmeCounts } from "./tagSmeCounts";

export type SmeCoverageDatasetName = "tags" | "questions" | "tagSmeCounts";

export type DeepReadonly<T> =
  T extends string | number | boolean | bigint | symbol | null | undefined
    ? T
    : T extends (...args: never[]) => unknown
      ? T
      : T extends readonly (infer Item)[]
        ? readonly DeepReadonly<Item>[]
        : T extends object
          ? { readonly [Key in keyof T]: DeepReadonly<T[Key]> }
          : T;

export type SmeCoverageRunRecordValue =
  | string
  | number
  | boolean
  | null
  | SmeCoverageRunRecord
  | readonly SmeCoverageRunRecordValue[];

export interface SmeCoverageRunRecord {
  readonly [key: string]: SmeCoverageRunRecordValue;
}

export interface SmeCoverageRunDataset {
  readonly datasetName: SmeCoverageDatasetName;
  readonly records: readonly SmeCoverageRunRecord[];
  readonly pagination: Readonly<SourcePagination>;
}

export interface SmeCoverageRunResult {
  readonly utilityId: "sme-coverage-analyzer";
  readonly utilityTitle: "SME Coverage Analyzer";
  readonly datasets: readonly SmeCoverageRunDataset[];
  readonly messages: readonly string[];
  readonly warnings: readonly DeepReadonly<ReportWarning>[];
  readonly decisionPack: DeepReadonly<SmeCoverageDecisionPack>;
}

export interface SmeCoverageRunOptions {
  fetchFn?: FetchLike;
  onThrottle?: (notice: ThrottleNotice) => void | Promise<void>;
  clock?: () => Date;
}

export type SmeCoverageRunErrorKind = "validation" | "collection" | "unsupported" | "unexpected";

export class SmeCoverageRunError extends Error {
  constructor(
    public readonly kind: SmeCoverageRunErrorKind,
    message: string,
    public readonly stage?: string,
    cause?: unknown,
  ) {
    super(message);
    this.name = "SmeCoverageRunError";
    if (cause !== undefined) (this as Error & { cause?: unknown }).cause = cause;
  }
}

const DATASET_NAMES: readonly SmeCoverageDatasetName[] = ["tags", "questions", "tagSmeCounts"];

export async function runSmeCoverageAnalysis(
  credentials: SessionCredentials,
  options: SmeCoverageRunOptions = {},
): Promise<SmeCoverageRunResult> {
  try {
    return await runValidatedSmeCoverageAnalysis(credentials, options);
  } catch (error) {
    if (error instanceof SmeCoverageRunError) throw error;
    throw new SmeCoverageRunError("unexpected", `SME Coverage Analyzer failed unexpectedly: ${errorMessage(error)}`, undefined, error);
  }
}

async function runValidatedSmeCoverageAnalysis(
  credentials: SessionCredentials,
  options: SmeCoverageRunOptions,
): Promise<SmeCoverageRunResult> {
  const now = (options.clock ?? (() => new Date()))();
  const messages = validateCredentialsForUtility("sme-coverage-analyzer", credentials, now).messages;
  if (messages.length > 0) {
    throw new SmeCoverageRunError("validation", messages.join(" "));
  }

  let normalizedInstance: ReturnType<typeof normalizeInstanceUrl>;
  try {
    normalizedInstance = normalizeInstanceUrl(credentials.baseUrl);
  } catch (error) {
    throw new SmeCoverageRunError("validation", `Instance URL is invalid: ${errorMessage(error)}`, undefined, error);
  }

  const clients = createLiveCollectorClients(credentials, options);
  const datasets: SmeCoverageRunDataset[] = [];

  for (const datasetName of DATASET_NAMES) {
    const collection = await collectSource(datasetName, clients);
    datasets.push({
      datasetName,
      records: toRecordList(collection.records),
      pagination: { ...collection.pagination },
    });
  }

  validateSourceIdentities(datasets);

  const tags = asCollectedSource(getDataset(datasets, "tags"));
  const questions = asCollectedSource(getDataset(datasets, "questions"));
  const tagSmeCounts = asCollectedSource(getDataset(datasets, "tagSmeCounts"));
  const demand = normalizeTagDemand({ tags, questions });
  const smeCounts = normalizeTagSmeCounts(tagSmeCounts);
  validateSupportedSmeCounts(tags, smeCounts.rows);

  const sourceStatus = {
    tags: tags.pagination,
    questions: questions.pagination,
    tagSmeCounts: tagSmeCounts.pagination,
  };
  const sourceWarnings = [...demand.warnings, ...smeCounts.warnings];
  const analysis = analyzeSmeCoverage({ demand, smeCounts, sourceStatus });
  const decisionPack = buildSmeCoverageDecisionPack({
    analysis,
    snapshot: {
      instanceHost: new URL(normalizedInstance.baseUrl).host,
      generatedAt: now.toISOString(),
    },
    sourceWarnings,
  });

  const result: SmeCoverageRunResult = {
    utilityId: "sme-coverage-analyzer",
    utilityTitle: "SME Coverage Analyzer",
    datasets,
    messages: datasets.map(formatDatasetMessage),
    warnings: decisionPack.warnings,
    decisionPack,
  };
  return deepFreezeCopy(result);
}

async function collectSource(
  datasetName: SmeCoverageDatasetName,
  clients: ReturnType<typeof createLiveCollectorClients>,
): Promise<CollectedDatasetResult> {
  let collection: CollectedDatasetResult;
  try {
    collection = await collectDataset(datasetName, clients);
  } catch (error) {
    throw new SmeCoverageRunError(
      "collection",
      `Failed to collect ${datasetName}: ${errorMessage(error)}`,
      datasetName,
      error,
    );
  }
  if (collection.pagination.reachedMaxPages || collection.pagination.hasMore) {
    throw new SmeCoverageRunError(
      "collection",
      `${datasetName} collection did not reach terminal pagination. No complete result was produced.`,
      datasetName,
    );
  }
  return collection;
}

function validateSourceIdentities(datasets: readonly SmeCoverageRunDataset[]): void {
  for (const dataset of datasets) {
    if (dataset.records.length === 0) continue;
    const hasIdentity = dataset.datasetName === "questions"
      ? dataset.records.some((record) => readQuestionTags(record).length > 0)
      : dataset.records.some((record) => readTagIdentity(record) !== null);
    if (!hasIdentity) {
      throw new SmeCoverageRunError(
        "collection",
        `Collected ${dataset.datasetName} records contained no usable tag identity.`,
        dataset.datasetName,
      );
    }
  }
}

function validateSupportedSmeCounts(
  tags: CollectedSource,
  smeRows: readonly { key: string; smeCount: number | null }[],
): void {
  const v2TagKeys = new Set(
    tags.records
      .map(readTagIdentity)
      .filter((identity): identity is NonNullable<typeof identity> => identity !== null)
      .map((identity) => identity.key),
  );
  if (v2TagKeys.size === 0) return;

  const numericSmeKeys = new Set(
    smeRows.filter((row) => row.smeCount !== null).map((row) => row.key),
  );
  if ([...v2TagKeys].some((key) => numericSmeKeys.has(key))) return;

  throw new SmeCoverageRunError(
    "unsupported",
    "Stack API v3 tags did not provide a matching numeric assigned-SME count for the collected v2 tags. SME coverage cannot be inferred from v2 top answerers.",
    "tagSmeCounts",
  );
}

function getDataset(
  datasets: readonly SmeCoverageRunDataset[],
  datasetName: SmeCoverageDatasetName,
): SmeCoverageRunDataset {
  const dataset = datasets.find((candidate) => candidate.datasetName === datasetName);
  if (!dataset) throw new SmeCoverageRunError("unexpected", `Missing collected dataset: ${datasetName}.`, datasetName);
  return dataset;
}

function asCollectedSource(dataset: SmeCoverageRunDataset): CollectedSource {
  return { records: dataset.records, pagination: dataset.pagination };
}

function toRecordList(records: unknown[]): SmeCoverageRunRecord[] {
  return records.map((record) =>
    typeof record === "object" && record !== null && !Array.isArray(record)
      ? record as SmeCoverageRunRecord
      : { value: record } as SmeCoverageRunRecord,
  );
}

function formatDatasetMessage(dataset: SmeCoverageRunDataset): string {
  const count = dataset.records.length;
  return `Collected ${dataset.datasetName} (${count} ${count === 1 ? "record" : "records"}) for SME Coverage Analyzer.`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function deepFreezeCopy<T>(value: T): T {
  if (Array.isArray(value)) {
    return Object.freeze(value.map((item) => deepFreezeCopy(item))) as T;
  }
  if (typeof value === "object" && value !== null) {
    const copy = Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, deepFreezeCopy(item)]),
    );
    return Object.freeze(copy) as T;
  }
  return value;
}
