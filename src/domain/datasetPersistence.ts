import { reportRegistry } from "./reportRegistry";
import type {
  DatasetName,
  PeriodScope,
  ReportId,
  ReportOutput,
  ReportRunSnapshot,
  ReportWarning,
  RunPeriodRole,
  SessionDataset,
  SessionState,
} from "./types";

export const DATASET_SESSION_PERSISTENCE_VERSION = 1;

export interface PersistedDatasetSessionSnapshot {
  version: typeof DATASET_SESSION_PERSISTENCE_VERSION;
  selectedReportId: ReportId;
  selectedReportIds: ReportId[];
  datasets: Record<string, SessionDataset>;
  reportOutputs: Partial<Record<ReportId, ReportOutput>>;
  reportRunSnapshots: ReportRunSnapshot[];
  warnings: ReportWarning[];
}

const knownDatasetNames = new Set<DatasetName>([
  "users",
  "tags",
  "questions",
  "answers",
  "comments",
  "articles",
  "communities",
  "userGroups",
  "tagSmes",
  "reputationHistory",
  "interactions",
  "dataExport",
]);
const knownReportIds = new Set<ReportId>(reportRegistry.map((report) => report.id));
const runPeriodRoles = new Set<RunPeriodRole>(["current", "comparison"]);

export function createDatasetSessionSnapshot(state: SessionState): PersistedDatasetSessionSnapshot {
  const datasets = parseDatasetRecord(state.datasets) ?? {};

  return {
    version: DATASET_SESSION_PERSISTENCE_VERSION,
    selectedReportId: state.selectedReportId,
    selectedReportIds: normalizeSelectedReportIds(state.selectedReportId, state.selectedReportIds),
    datasets,
    reportOutputs: parseReportOutputs(state.reportOutputs),
    reportRunSnapshots: parseReportRunSnapshots(state.reportRunSnapshots, datasets),
    warnings: parseWarnings(state.warnings),
  };
}

export function hydrateDatasetSessionState(state: SessionState, value: unknown): SessionState {
  const snapshot = parseDatasetSessionSnapshot(value);

  if (!snapshot) {
    return state;
  }

  const selectedReportId = knownReportIds.has(snapshot.selectedReportId)
    ? snapshot.selectedReportId
    : state.selectedReportId;
  const selectedReportIds = normalizeSelectedReportIds(
    selectedReportId,
    snapshot.selectedReportIds.filter((reportId) => knownReportIds.has(reportId)),
  );

  return {
    ...state,
    selectedReportId,
    selectedReportIds,
    datasets: snapshot.datasets,
    reportOutputs: snapshot.reportOutputs,
    reportRunSnapshots: snapshot.reportRunSnapshots,
    warnings: snapshot.warnings,
  };
}

export function parseDatasetSessionSnapshot(value: unknown): PersistedDatasetSessionSnapshot | null {
  if (!isRecord(value) || value.version !== DATASET_SESSION_PERSISTENCE_VERSION) {
    return null;
  }

  const selectedReportId = isKnownReportId(value.selectedReportId) ? value.selectedReportId : "tag-report";
  const selectedReportIdCandidates = Array.isArray(value.selectedReportIds)
    ? value.selectedReportIds.filter(isKnownReportId)
    : [];
  const selectedReportIds = normalizeSelectedReportIds(selectedReportId, selectedReportIdCandidates);
  const datasets = parseDatasetRecord(value.datasets);

  if (!datasets) {
    return null;
  }
  if (!isRecord(value.reportOutputs) || !Array.isArray(value.reportRunSnapshots) || !Array.isArray(value.warnings)) {
    return null;
  }

  return {
    version: DATASET_SESSION_PERSISTENCE_VERSION,
    selectedReportId,
    selectedReportIds,
    datasets,
    reportOutputs: parseReportOutputs(value.reportOutputs),
    reportRunSnapshots: parseReportRunSnapshots(value.reportRunSnapshots, datasets),
    warnings: parseWarnings(value.warnings),
  };
}

function parseDatasetRecord(value: unknown): Record<string, SessionDataset> | null {
  if (!isRecord(value)) {
    return null;
  }

  const datasets: Record<string, SessionDataset> = {};

  for (const [key, dataset] of Object.entries(value)) {
    const parsedDataset = parseSessionDataset(dataset);

    if (!parsedDataset || parsedDataset.id !== key) {
      return null;
    }

    datasets[key] = parsedDataset;
  }

  return datasets;
}

function parseReportOutputs(value: unknown): Partial<Record<ReportId, ReportOutput>> {
  if (!isRecord(value)) {
    return {};
  }

  const outputs: Partial<Record<ReportId, ReportOutput>> = {};

  for (const [key, output] of Object.entries(value)) {
    const parsedOutput = parseReportOutput(output);

    if (isKnownReportId(key) && parsedOutput?.reportId === key) {
      outputs[key] = parsedOutput;
    }
  }

  return outputs;
}

function parseReportRunSnapshots(
  value: unknown,
  datasets: Record<string, SessionDataset>,
): ReportRunSnapshot[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((snapshot) => {
    const parsedSnapshot = parseReportRunSnapshot(snapshot, datasets);
    return parsedSnapshot ? [parsedSnapshot] : [];
  });
}

function parseWarnings(value: unknown): ReportWarning[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((warning) => {
    const parsedWarning = parseWarning(warning);
    return parsedWarning ? [parsedWarning] : [];
  });
}

function parseSessionDataset(value: unknown): SessionDataset | null {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    !isDatasetName(value.name) ||
    !Array.isArray(value.records) ||
    typeof value.loadedAt !== "string" ||
    (value.source !== "live-api" && value.source !== "upload") ||
    (typeof value.snapshotId !== "undefined" && typeof value.snapshotId !== "string") ||
    (typeof value.reportId !== "undefined" && !isKnownReportId(value.reportId)) ||
    (typeof value.periodRole !== "undefined" && !isRunPeriodRole(value.periodRole)) ||
    (typeof value.fileName !== "undefined" && typeof value.fileName !== "string") ||
    (typeof value.warnings !== "undefined" && !Array.isArray(value.warnings))
  ) {
    return null;
  }

  const scope = parseOptionalPeriodScope(value.scope);

  if (scope === null) {
    return null;
  }

  const dataset: SessionDataset = {
    id: value.id,
    name: value.name,
    records: value.records,
    loadedAt: value.loadedAt,
    source: value.source,
  };

  if (typeof value.snapshotId === "string") {
    dataset.snapshotId = value.snapshotId;
  }
  if (isKnownReportId(value.reportId)) {
    dataset.reportId = value.reportId;
  }
  if (isRunPeriodRole(value.periodRole)) {
    dataset.periodRole = value.periodRole;
  }
  if (scope) {
    dataset.scope = scope;
  }
  if (typeof value.fileName === "string") {
    dataset.fileName = value.fileName;
  }
  if (Array.isArray(value.warnings)) {
    dataset.warnings = parseWarnings(value.warnings);
  }

  return dataset;
}

function parseReportOutput(value: unknown): ReportOutput | null {
  if (
    !isRecord(value) ||
    !isKnownReportId(value.reportId) ||
    !isDatasetName(value.datasetName) ||
    typeof value.fileName !== "string" ||
    !Array.isArray(value.records) ||
    typeof value.loadedAt !== "string" ||
    (value.source !== "live-api" && value.source !== "upload") ||
    (typeof value.comparisonRecords !== "undefined" && !Array.isArray(value.comparisonRecords)) ||
    (typeof value.currentSnapshotId !== "undefined" && typeof value.currentSnapshotId !== "string") ||
    (typeof value.comparisonSnapshotId !== "undefined" && typeof value.comparisonSnapshotId !== "string") ||
    (typeof value.warnings !== "undefined" && !Array.isArray(value.warnings))
  ) {
    return null;
  }

  const currentScope = parseOptionalPeriodScope(value.currentScope);
  const comparisonScope = parseOptionalPeriodScope(value.comparisonScope);

  if (currentScope === null || comparisonScope === null) {
    return null;
  }

  const output: ReportOutput = {
    reportId: value.reportId,
    datasetName: value.datasetName,
    fileName: value.fileName,
    records: value.records as Record<string, unknown>[],
    loadedAt: value.loadedAt,
    source: value.source,
  };

  if (Array.isArray(value.comparisonRecords)) {
    output.comparisonRecords = value.comparisonRecords as Record<string, unknown>[];
  }
  if (currentScope) {
    output.currentScope = currentScope;
  }
  if (comparisonScope) {
    output.comparisonScope = comparisonScope;
  }
  if (typeof value.currentSnapshotId === "string") {
    output.currentSnapshotId = value.currentSnapshotId;
  }
  if (typeof value.comparisonSnapshotId === "string") {
    output.comparisonSnapshotId = value.comparisonSnapshotId;
  }
  if (Array.isArray(value.warnings)) {
    output.warnings = parseWarnings(value.warnings);
  }

  return output;
}

function parseReportRunSnapshot(
  value: unknown,
  datasets: Record<string, SessionDataset>,
): ReportRunSnapshot | null {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    !isKnownReportId(value.reportId) ||
    !isRunPeriodRole(value.periodRole) ||
    !Number.isInteger(value.pageSize) ||
    !Number.isInteger(value.maxPagesPerDataset) ||
    typeof value.loadedAt !== "string" ||
    !Array.isArray(value.datasetIds) ||
    !value.datasetIds.every((datasetId) => typeof datasetId === "string" && datasets[datasetId]) ||
    !Array.isArray(value.warnings)
  ) {
    return null;
  }

  const scope = parsePeriodScope(value.scope);

  if (!scope) {
    return null;
  }

  return {
    id: value.id,
    reportId: value.reportId,
    periodRole: value.periodRole,
    scope,
    pageSize: value.pageSize,
    maxPagesPerDataset: value.maxPagesPerDataset,
    loadedAt: value.loadedAt,
    datasetIds: [...value.datasetIds],
    warnings: parseWarnings(value.warnings),
  };
}

function parseWarning(value: unknown): ReportWarning | null {
  if (
    !isRecord(value) ||
    typeof value.code !== "string" ||
    typeof value.message !== "string" ||
    (typeof value.reportId !== "undefined" && !isKnownReportId(value.reportId))
  ) {
    return null;
  }

  const warning: ReportWarning = {
    code: value.code,
    message: value.message,
  };

  if (isKnownReportId(value.reportId)) {
    warning.reportId = value.reportId;
  }

  return warning;
}

function isKnownReportId(value: unknown): value is ReportId {
  return typeof value === "string" && knownReportIds.has(value as ReportId);
}

function isDatasetName(value: unknown): value is DatasetName {
  return typeof value === "string" && knownDatasetNames.has(value as DatasetName);
}

function isRunPeriodRole(value: unknown): value is RunPeriodRole {
  return typeof value === "string" && runPeriodRoles.has(value as RunPeriodRole);
}

function parseOptionalPeriodScope(value: unknown): PeriodScope | undefined | null {
  if (typeof value === "undefined") {
    return undefined;
  }

  return parsePeriodScope(value);
}

function parsePeriodScope(value: unknown): PeriodScope | null {
  if (
    !isRecord(value) ||
    (typeof value.startDate !== "undefined" && typeof value.startDate !== "string") ||
    (typeof value.endDate !== "undefined" && typeof value.endDate !== "string")
  ) {
    return null;
  }

  const scope: PeriodScope = {};

  if (typeof value.startDate === "string") {
    scope.startDate = value.startDate;
  }
  if (typeof value.endDate === "string") {
    scope.endDate = value.endDate;
  }

  return scope;
}

function normalizeSelectedReportIds(selectedReportId: ReportId, reportIds: readonly ReportId[]): ReportId[] {
  const normalized: ReportId[] = [selectedReportId];

  reportIds.forEach((reportId) => {
    if (reportId !== selectedReportId && !normalized.includes(reportId)) {
      normalized.push(reportId);
    }
  });

  return normalized;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
