import { reportRegistry } from "./reportRegistry";
import type {
  DatasetName,
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
  return {
    version: DATASET_SESSION_PERSISTENCE_VERSION,
    selectedReportId: state.selectedReportId,
    selectedReportIds: [...state.selectedReportIds],
    datasets: state.datasets,
    reportOutputs: state.reportOutputs,
    reportRunSnapshots: state.reportRunSnapshots,
    warnings: state.warnings,
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
  const selectedReportIds = snapshot.selectedReportIds.filter((reportId) => knownReportIds.has(reportId));

  return {
    ...state,
    selectedReportId,
    selectedReportIds: selectedReportIds.length > 0 ? selectedReportIds : [selectedReportId],
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
  const selectedReportIds = Array.isArray(value.selectedReportIds)
    ? value.selectedReportIds.filter(isKnownReportId)
    : [selectedReportId];
  const datasets = parseDatasetRecord(value.datasets);

  if (!datasets) {
    return null;
  }

  return {
    version: DATASET_SESSION_PERSISTENCE_VERSION,
    selectedReportId,
    selectedReportIds: selectedReportIds.length > 0 ? selectedReportIds : [selectedReportId],
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
    if (!isSessionDataset(dataset) || dataset.id !== key) {
      return null;
    }

    datasets[key] = dataset;
  }

  return datasets;
}

function parseReportOutputs(value: unknown): Partial<Record<ReportId, ReportOutput>> {
  if (!isRecord(value)) {
    return {};
  }

  const outputs: Partial<Record<ReportId, ReportOutput>> = {};

  for (const [key, output] of Object.entries(value)) {
    if (isKnownReportId(key) && isReportOutput(output)) {
      outputs[key] = output;
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

  return value.filter((snapshot): snapshot is ReportRunSnapshot => {
    return (
      isRecord(snapshot) &&
      typeof snapshot.id === "string" &&
      isKnownReportId(snapshot.reportId) &&
      isRunPeriodRole(snapshot.periodRole) &&
      isPeriodScope(snapshot.scope) &&
      Number.isInteger(snapshot.pageSize) &&
      Number.isInteger(snapshot.maxPagesPerDataset) &&
      typeof snapshot.loadedAt === "string" &&
      Array.isArray(snapshot.datasetIds) &&
      snapshot.datasetIds.every((datasetId) => typeof datasetId === "string" && datasets[datasetId]) &&
      Array.isArray(snapshot.warnings)
    );
  });
}

function parseWarnings(value: unknown): ReportWarning[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((warning): warning is ReportWarning => {
    return (
      isRecord(warning) &&
      typeof warning.code === "string" &&
      typeof warning.message === "string" &&
      (typeof warning.reportId === "undefined" || isKnownReportId(warning.reportId))
    );
  });
}

function isSessionDataset(value: unknown): value is SessionDataset {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    isDatasetName(value.name) &&
    Array.isArray(value.records) &&
    typeof value.loadedAt === "string" &&
    (value.source === "live-api" || value.source === "upload") &&
    (typeof value.snapshotId === "undefined" || typeof value.snapshotId === "string") &&
    (typeof value.reportId === "undefined" || isKnownReportId(value.reportId)) &&
    (typeof value.periodRole === "undefined" || isRunPeriodRole(value.periodRole)) &&
    (typeof value.scope === "undefined" || isPeriodScope(value.scope)) &&
    (typeof value.fileName === "undefined" || typeof value.fileName === "string") &&
    (typeof value.warnings === "undefined" || Array.isArray(value.warnings))
  );
}

function isReportOutput(value: unknown): value is ReportOutput {
  return (
    isRecord(value) &&
    isKnownReportId(value.reportId) &&
    isDatasetName(value.datasetName) &&
    typeof value.fileName === "string" &&
    Array.isArray(value.records) &&
    typeof value.loadedAt === "string" &&
    (value.source === "live-api" || value.source === "upload") &&
    (typeof value.comparisonRecords === "undefined" || Array.isArray(value.comparisonRecords)) &&
    (typeof value.currentScope === "undefined" || isPeriodScope(value.currentScope)) &&
    (typeof value.comparisonScope === "undefined" || isPeriodScope(value.comparisonScope)) &&
    (typeof value.currentSnapshotId === "undefined" || typeof value.currentSnapshotId === "string") &&
    (typeof value.comparisonSnapshotId === "undefined" || typeof value.comparisonSnapshotId === "string") &&
    (typeof value.warnings === "undefined" || Array.isArray(value.warnings))
  );
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

function isPeriodScope(value: unknown): value is { startDate?: string; endDate?: string } {
  return (
    isRecord(value) &&
    (typeof value.startDate === "undefined" || typeof value.startDate === "string") &&
    (typeof value.endDate === "undefined" || typeof value.endDate === "string")
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
