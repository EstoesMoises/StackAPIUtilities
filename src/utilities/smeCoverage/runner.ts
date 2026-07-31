import type { FetchLike, ThrottleNotice } from "../../api/httpClient";
import { createLiveCollectorClients } from "../../collectors/liveCollectorClients";
import { collectDataset, type CollectedDatasetResult } from "../../collectors/liveCollectors";
import { normalizeInstanceUrl, validateCredentialsForUtility } from "../../credentials/credentialRules";
import { getReportRunPresetForSettings } from "../../domain/reportRunPresets";
import { validateApiVolumeSettings } from "../../domain/reportScope";
import { readQuestionTags, readTagIdentity } from "../../domain/tagNormalization";
import type {
  ApiVolumeSettingsValue,
  ReportRunPresetId,
  ReportWarning,
  SessionCredentials,
} from "../../domain/types";
import { analyzeSmeCoverage } from "./analyzer";
import { buildSmeCoverageDecisionPack } from "./decisionPack";
import type { CollectedSource, SmeCoverageDecisionPack, SourcePagination } from "./model";
import { DEFAULT_SME_COVERAGE_SETTINGS } from "./settings";
import { normalizeTagDemand } from "./tagDemand";
import { normalizeTagSmeCounts } from "./tagSmeCounts";

export type SmeCoverageDatasetName = "tags" | "questions" | "tagSmeCounts";

export interface SmeCoverageRunDataset {
  datasetName: SmeCoverageDatasetName;
  records: Record<string, unknown>[];
  pagination: SourcePagination;
}

export interface SmeCoverageRunResult {
  utilityId: "sme-coverage-analyzer";
  utilityTitle: "SME Coverage Analyzer";
  pageSize: number;
  maxPagesPerDataset: number;
  runPreset?: ReportRunPresetId;
  datasets: SmeCoverageRunDataset[];
  messages: string[];
  warnings: ReportWarning[];
  decisionPack: SmeCoverageDecisionPack;
}

export interface SmeCoverageRunOptions {
  settings?: ApiVolumeSettingsValue;
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
  const settings = normalizeSettings(options.settings ?? DEFAULT_SME_COVERAGE_SETTINGS);
  const messages = [
    ...validateCredentialsForUtility("sme-coverage-analyzer", credentials, now).messages,
    ...validateApiVolumeSettings(settings).messages,
  ];
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
    const collection = await collectSource(datasetName, clients, settings);
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
  const sourceWarnings = [
    ...buildCapWarnings(datasets),
    ...demand.warnings,
    ...smeCounts.warnings,
  ];
  const analysis = analyzeSmeCoverage({ demand, smeCounts, sourceStatus, settings });
  const decisionPack = buildSmeCoverageDecisionPack({
    analysis,
    snapshot: {
      instanceHost: new URL(normalizedInstance.baseUrl).host,
      generatedAt: now.toISOString(),
      pageSize: settings.pageSize,
      maxPagesPerDataset: settings.maxPagesPerDataset,
      ...(settings.runPreset ? { runPreset: settings.runPreset } : {}),
    },
    sourceWarnings,
  });

  const result: SmeCoverageRunResult = {
    utilityId: "sme-coverage-analyzer",
    utilityTitle: "SME Coverage Analyzer",
    pageSize: settings.pageSize,
    maxPagesPerDataset: settings.maxPagesPerDataset,
    datasets,
    messages: datasets.map(formatDatasetMessage),
    warnings: [...decisionPack.warnings],
    decisionPack,
  };
  if (settings.runPreset) result.runPreset = settings.runPreset;
  return result;
}

function normalizeSettings(settings: ApiVolumeSettingsValue): ApiVolumeSettingsValue {
  const runPreset = settings.runPreset
    ? getReportRunPresetForSettings(settings.pageSize, settings.maxPagesPerDataset)?.id
    : undefined;
  return {
    pageSize: settings.pageSize,
    maxPagesPerDataset: settings.maxPagesPerDataset,
    ...(runPreset ? { runPreset } : {}),
  };
}

async function collectSource(
  datasetName: SmeCoverageDatasetName,
  clients: ReturnType<typeof createLiveCollectorClients>,
  settings: ApiVolumeSettingsValue,
): Promise<CollectedDatasetResult> {
  try {
    return await collectDataset(datasetName, clients, {
      pageSize: settings.pageSize,
      maxPagesPerDataset: settings.maxPagesPerDataset,
    });
  } catch (error) {
    throw new SmeCoverageRunError(
      "collection",
      `Failed to collect ${datasetName}: ${errorMessage(error)}`,
      datasetName,
      error,
    );
  }
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

function buildCapWarnings(datasets: readonly SmeCoverageRunDataset[]): ReportWarning[] {
  const warnings: ReportWarning[] = [];
  for (const dataset of datasets) {
    if (!dataset.pagination.reachedMaxPages || !dataset.pagination.hasMore) continue;
    if (dataset.datasetName === "tags") {
      warnings.push({
        utilityId: "sme-coverage-analyzer",
        code: "sme-coverage.tags-page-cap",
        message: "Tags reached the collection page cap; the decision pack covers only the collected tag sample.",
      });
    } else if (dataset.datasetName === "questions") {
      warnings.push({
        utilityId: "sme-coverage-analyzer",
        code: "sme-coverage.questions-page-cap",
        message: "Questions reached the collection page cap; page views and demand conclusions use a collected partial sample.",
      });
    } else {
      warnings.push({
        utilityId: "sme-coverage-analyzer",
        code: "sme-coverage.tag-sme-counts-page-cap",
        message: "Assigned-SME tag counts reached the collection page cap; unmatched assigned-SME coverage may be unknown.",
      });
    }
  }
  return warnings;
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

function toRecordList(records: unknown[]): Record<string, unknown>[] {
  return records.map((record) =>
    typeof record === "object" && record !== null && !Array.isArray(record)
      ? record as Record<string, unknown>
      : { value: record },
  );
}

function formatDatasetMessage(dataset: SmeCoverageRunDataset): string {
  const count = dataset.records.length;
  return `Collected ${dataset.datasetName} (${count} ${count === 1 ? "record" : "records"}) for SME Coverage Analyzer.`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
