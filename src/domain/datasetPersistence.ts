import { reportRegistry } from "./reportRegistry";
import { parseSmeCoverageDecisionPack } from "../utilities/smeCoverage/persistence";
import type { SmeCoverageStoredOutput } from "../utilities/smeCoverage/model";
import type {
  DatasetName,
  PeriodScope,
  ReportId,
  ReportOutput,
  ReportRunPresetId,
  ReportRunSnapshot,
  ReportWarning,
  RunPeriodRole,
  SessionDataset,
  SessionState,
  UtilityId,
  UtilityRunSnapshot,
} from "./types";

export const DATASET_SESSION_PERSISTENCE_VERSION = 2;

export interface PersistedDatasetSessionSnapshot {
  version: typeof DATASET_SESSION_PERSISTENCE_VERSION;
  selectedReportId: ReportId;
  selectedReportIds: ReportId[];
  selectedUtilityId: UtilityId;
  datasets: Record<string, SessionDataset>;
  reportOutputs: Partial<Record<ReportId, ReportOutput>>;
  reportRunSnapshots: ReportRunSnapshot[];
  utilityOutputs: Partial<Record<UtilityId, SmeCoverageStoredOutput>>;
  utilityRunSnapshots: UtilityRunSnapshot[];
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
  "tagSmeCounts",
  "tagLastUsed",
  "reputationHistory",
  "interactions",
  "dataExport",
]);
const knownReportIds = new Set<ReportId>(reportRegistry.map((report) => report.id));
const runPeriodRoles = new Set<RunPeriodRole>(["current", "comparison"]);
const reportRunPresetIds = new Set<ReportRunPresetId>(["quick-sample", "standard", "deep-audit"]);
const knownUtilityIds = new Set<UtilityId>(["sme-coverage-analyzer"]);
const prohibitedPersistedKeys = new Set([
  "credentials",
  "apiKey",
  "accessToken",
  "token",
  "refreshToken",
  "idToken",
  "oauthToken",
  "pat",
  "authSource",
  "oauthClientId",
  "clientSecret",
  "oauthScopes",
  "accessTokenExpiresAt",
  "runQueue",
  "requestPayload",
  "requestBody",
  "requestBodies",
  "runProgress",
]);
const omittedJsonValue = Symbol("omitted-json-value");

export function createDatasetSessionSnapshot(state: SessionState): PersistedDatasetSessionSnapshot {
  const datasets = parseDatasetRecord(state.datasets, true) ?? {};
  const reportRunSnapshots = parseReportRunSnapshots(state.reportRunSnapshots, datasets);
  const utilityRunSnapshots = parseUtilityRunSnapshots(state.utilityRunSnapshots, datasets);

  return {
    version: DATASET_SESSION_PERSISTENCE_VERSION,
    selectedReportId: state.selectedReportId,
    selectedReportIds: normalizeSelectedReportIds(state.selectedReportId, state.selectedReportIds),
    selectedUtilityId: isKnownUtilityId(state.selectedUtilityId) ? state.selectedUtilityId : "sme-coverage-analyzer",
    datasets,
    reportOutputs: parseReportOutputs(state.reportOutputs, datasets, reportRunSnapshots),
    reportRunSnapshots,
    utilityOutputs: parseUtilityOutputs(state.utilityOutputs),
    utilityRunSnapshots,
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
    selectedUtilityId: snapshot.selectedUtilityId,
    datasets: snapshot.datasets,
    reportOutputs: snapshot.reportOutputs,
    reportRunSnapshots: snapshot.reportRunSnapshots,
    utilityOutputs: snapshot.utilityOutputs,
    utilityRunSnapshots: snapshot.utilityRunSnapshots,
    warnings: snapshot.warnings,
  };
}

export function parseDatasetSessionSnapshot(value: unknown): PersistedDatasetSessionSnapshot | null {
  if (!isRecord(value) || (value.version !== 1 && value.version !== DATASET_SESSION_PERSISTENCE_VERSION)) {
    return null;
  }

  const isVersion2 = value.version === DATASET_SESSION_PERSISTENCE_VERSION;

  const selectedReportId = isKnownReportId(value.selectedReportId) ? value.selectedReportId : "tag-report";
  const selectedReportIdCandidates = Array.isArray(value.selectedReportIds)
    ? value.selectedReportIds.filter(isKnownReportId)
    : [];
  const selectedReportIds = normalizeSelectedReportIds(selectedReportId, selectedReportIdCandidates);
  const datasets = parseDatasetRecord(value.datasets, isVersion2);

  if (!datasets) {
    return null;
  }
  if (!isRecord(value.reportOutputs) || !Array.isArray(value.reportRunSnapshots) || !Array.isArray(value.warnings)) {
    return null;
  }

  const reportRunSnapshots = parseReportRunSnapshots(value.reportRunSnapshots, datasets);
  const utilityRunSnapshots = isVersion2 ? parseUtilityRunSnapshots(value.utilityRunSnapshots, datasets) : [];

  return {
    version: DATASET_SESSION_PERSISTENCE_VERSION,
    selectedReportId,
    selectedReportIds,
    selectedUtilityId: isVersion2 && isKnownUtilityId(value.selectedUtilityId)
      ? value.selectedUtilityId
      : "sme-coverage-analyzer",
    datasets,
    reportOutputs: parseReportOutputs(value.reportOutputs, datasets, reportRunSnapshots),
    reportRunSnapshots,
    utilityOutputs: isVersion2 ? parseUtilityOutputs(value.utilityOutputs) : {},
    utilityRunSnapshots,
    warnings: parseWarnings(value.warnings),
  };
}

function parseDatasetRecord(value: unknown, allowUtility: boolean): Record<string, SessionDataset> | null {
  if (!isRecord(value)) {
    return null;
  }

  const datasets: Record<string, SessionDataset> = {};

  for (const [key, dataset] of Object.entries(value)) {
    const parsedDataset = parseSessionDataset(dataset, allowUtility);

    if (!isSafeObjectKey(key) || !parsedDataset || parsedDataset.id !== key) {
      return null;
    }

    datasets[key] = parsedDataset;
  }

  return datasets;
}

function parseReportOutputs(
  value: unknown,
  datasets: Record<string, SessionDataset>,
  reportRunSnapshots: ReportRunSnapshot[],
): Partial<Record<ReportId, ReportOutput>> {
  if (!isRecord(value)) {
    return {};
  }

  const outputs: Partial<Record<ReportId, ReportOutput>> = {};

  for (const [key, output] of Object.entries(value)) {
    const parsedOutput = parseReportOutput(output);

    if (
      isKnownReportId(key) &&
      parsedOutput?.reportId === key &&
      isReportOutputBackedByDatasetState(parsedOutput, datasets, reportRunSnapshots)
    ) {
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

function parseUtilityOutputs(value: unknown): Partial<Record<UtilityId, SmeCoverageStoredOutput>> {
  if (!isRecord(value)) return {};
  const outputs: Partial<Record<UtilityId, SmeCoverageStoredOutput>> = {};

  for (const [key, candidate] of Object.entries(value)) {
    if (!isKnownUtilityId(key) || !isRecord(candidate) || candidate.utilityId !== key || typeof candidate.loadedAt !== "string") {
      continue;
    }
    const decisionPack = parseSmeCoverageDecisionPack(candidate.decisionPack);
    if (!decisionPack) continue;
    outputs[key] = {
      utilityId: key,
      loadedAt: candidate.loadedAt,
      decisionPack,
    };
  }

  return outputs;
}

function parseUtilityRunSnapshots(
  value: unknown,
  datasets: Record<string, SessionDataset>,
): UtilityRunSnapshot[] {
  if (!Array.isArray(value)) return [];
  const idCounts = new Map<string, number>();
  for (const candidate of value) {
    if (isRecord(candidate) && typeof candidate.id === "string" && candidate.id.length > 0) {
      idCounts.set(candidate.id, (idCounts.get(candidate.id) ?? 0) + 1);
    }
  }
  return value.flatMap((candidate) => {
    if (isRecord(candidate) && typeof candidate.id === "string" && (idCounts.get(candidate.id) ?? 0) > 1) {
      return [];
    }
    const snapshot = parseUtilityRunSnapshot(candidate, datasets);
    return snapshot ? [snapshot] : [];
  });
}

function parseUtilityRunSnapshot(
  value: unknown,
  datasets: Record<string, SessionDataset>,
): UtilityRunSnapshot | null {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    value.id.length === 0 ||
    !isKnownUtilityId(value.utilityId) ||
    !isNonnegativeInteger(value.pageSize) ||
    !isNonnegativeInteger(value.maxPagesPerDataset) ||
    (typeof value.runPreset !== "undefined" && !isReportRunPresetId(value.runPreset)) ||
    typeof value.loadedAt !== "string" ||
    !Array.isArray(value.datasetIds) ||
    value.datasetIds.length === 0 ||
    new Set(value.datasetIds).size !== value.datasetIds.length ||
    !value.datasetIds.every(
      (datasetId) =>
        typeof datasetId === "string" &&
        datasetId.length > 0 &&
        hasOwn(datasets, datasetId) &&
        datasets[datasetId]?.utilityId === value.utilityId &&
        datasets[datasetId]?.snapshotId === value.id,
    ) ||
    !Array.isArray(value.warnings)
  ) {
    return null;
  }

  const snapshot: UtilityRunSnapshot = {
    id: value.id,
    utilityId: value.utilityId,
    pageSize: value.pageSize,
    maxPagesPerDataset: value.maxPagesPerDataset,
    loadedAt: value.loadedAt,
    datasetIds: [...value.datasetIds],
    warnings: parseWarnings(value.warnings),
  };
  if (isReportRunPresetId(value.runPreset)) snapshot.runPreset = value.runPreset;
  return snapshot;
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

function parseSessionDataset(value: unknown, allowUtility: boolean): SessionDataset | null {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    !isDatasetName(value.name) ||
    !Array.isArray(value.records) ||
    typeof value.loadedAt !== "string" ||
    (value.source !== "live-api" && value.source !== "upload") ||
    (typeof value.snapshotId !== "undefined" && typeof value.snapshotId !== "string") ||
    (typeof value.reportId !== "undefined" && !isKnownReportId(value.reportId)) ||
    (allowUtility && typeof value.utilityId !== "undefined" && !isKnownUtilityId(value.utilityId)) ||
    (allowUtility && typeof value.reportId !== "undefined" && typeof value.utilityId !== "undefined") ||
    (typeof value.periodRole !== "undefined" && !isRunPeriodRole(value.periodRole)) ||
    (typeof value.fileName !== "undefined" && typeof value.fileName !== "string") ||
    (typeof value.warnings !== "undefined" && !Array.isArray(value.warnings)) ||
    (allowUtility && typeof value.pageCount !== "undefined" && !isNonnegativeInteger(value.pageCount)) ||
    (allowUtility && typeof value.reachedMaxPages !== "undefined" && typeof value.reachedMaxPages !== "boolean") ||
    (allowUtility && typeof value.hasMore !== "undefined" && typeof value.hasMore !== "boolean")
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
    records: sanitizeDatasetRecords(value.records),
    loadedAt: value.loadedAt,
    source: value.source,
  };

  if (typeof value.snapshotId === "string") {
    dataset.snapshotId = value.snapshotId;
  }
  if (isKnownReportId(value.reportId)) {
    dataset.reportId = value.reportId;
  }
  if (allowUtility && isKnownUtilityId(value.utilityId)) {
    dataset.utilityId = value.utilityId;
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
  if (allowUtility && isNonnegativeInteger(value.pageCount)) {
    dataset.pageCount = value.pageCount;
  }
  if (allowUtility && typeof value.reachedMaxPages === "boolean") {
    dataset.reachedMaxPages = value.reachedMaxPages;
  }
  if (allowUtility && typeof value.hasMore === "boolean") {
    dataset.hasMore = value.hasMore;
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
  const records = sanitizeRecordArray(value.records);
  const comparisonRecords =
    typeof value.comparisonRecords === "undefined"
      ? undefined
      : sanitizeRecordArray(value.comparisonRecords);

  if (currentScope === null || comparisonScope === null || !records || comparisonRecords === null) {
    return null;
  }

  const output: ReportOutput = {
    reportId: value.reportId,
    datasetName: value.datasetName,
    fileName: value.fileName,
    records,
    loadedAt: value.loadedAt,
    source: value.source,
  };

  if (comparisonRecords) {
    output.comparisonRecords = comparisonRecords;
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

function isReportOutputBackedByDatasetState(
  output: ReportOutput,
  datasets: Record<string, SessionDataset>,
  reportRunSnapshots: ReportRunSnapshot[],
): boolean {
  if (output.source === "upload") {
    return Object.values(datasets).some(
      (dataset) =>
        dataset.source === "upload" &&
        dataset.reportId === output.reportId &&
        dataset.name === output.datasetName &&
        dataset.fileName === output.fileName &&
        dataset.loadedAt === output.loadedAt,
    );
  }

  const outputSnapshotIds = [output.currentSnapshotId, output.comparisonSnapshotId].filter(
    (snapshotId): snapshotId is string => typeof snapshotId === "string",
  );

  if (outputSnapshotIds.length === 0) {
    return false;
  }

  return outputSnapshotIds.every((snapshotId) =>
    reportRunSnapshots.some((snapshot) => snapshot.id === snapshotId && snapshot.reportId === output.reportId),
  );
}

function parseReportRunSnapshot(
  value: unknown,
  datasets: Record<string, SessionDataset>,
): ReportRunSnapshot | null {
  if (!isRecord(value)) {
    return null;
  }

  const pageSize = value.pageSize;
  const maxPagesPerDataset = value.maxPagesPerDataset;

  if (
    typeof value.id !== "string" ||
    !isKnownReportId(value.reportId) ||
    !isRunPeriodRole(value.periodRole) ||
    typeof pageSize !== "number" ||
    !Number.isInteger(pageSize) ||
    typeof maxPagesPerDataset !== "number" ||
    !Number.isInteger(maxPagesPerDataset) ||
    typeof value.loadedAt !== "string" ||
    !Array.isArray(value.datasetIds) ||
    !value.datasetIds.every((datasetId) => typeof datasetId === "string" && hasOwn(datasets, datasetId)) ||
    !Array.isArray(value.warnings) ||
    (typeof value.runPreset !== "undefined" && !isReportRunPresetId(value.runPreset))
  ) {
    return null;
  }

  const scope = parsePeriodScope(value.scope);

  if (!scope) {
    return null;
  }

  const snapshot: ReportRunSnapshot = {
    id: value.id,
    reportId: value.reportId,
    periodRole: value.periodRole,
    scope,
    pageSize,
    maxPagesPerDataset,
    loadedAt: value.loadedAt,
    datasetIds: [...value.datasetIds],
    warnings: parseWarnings(value.warnings),
  };

  if (isReportRunPresetId(value.runPreset)) {
    snapshot.runPreset = value.runPreset;
  }

  return snapshot;
}

function parseWarning(value: unknown): ReportWarning | null {
  if (
    !isRecord(value) ||
    typeof value.code !== "string" ||
    typeof value.message !== "string" ||
    (typeof value.reportId !== "undefined" && !isKnownReportId(value.reportId)) ||
    (typeof value.utilityId !== "undefined" && !isKnownUtilityId(value.utilityId)) ||
    (typeof value.reportId !== "undefined" && typeof value.utilityId !== "undefined")
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
  if (isKnownUtilityId(value.utilityId)) {
    warning.utilityId = value.utilityId;
  }

  return warning;
}

function isKnownReportId(value: unknown): value is ReportId {
  return typeof value === "string" && knownReportIds.has(value as ReportId);
}

function isKnownUtilityId(value: unknown): value is UtilityId {
  return typeof value === "string" && knownUtilityIds.has(value as UtilityId);
}

function isDatasetName(value: unknown): value is DatasetName {
  return typeof value === "string" && knownDatasetNames.has(value as DatasetName);
}

function isRunPeriodRole(value: unknown): value is RunPeriodRole {
  return typeof value === "string" && runPeriodRoles.has(value as RunPeriodRole);
}

function isReportRunPresetId(value: unknown): value is ReportRunPresetId {
  return typeof value === "string" && reportRunPresetIds.has(value as ReportRunPresetId);
}

function isNonnegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && Number.isInteger(value) && value >= 0;
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

function sanitizeDatasetRecords(records: readonly unknown[]): unknown[] {
  const sanitized: unknown[] = [];
  for (const record of records) {
    const value = sanitizeJsonValue(record, new Set<object>());
    if (value !== omittedJsonValue) sanitized.push(value);
  }
  return sanitized;
}

function sanitizeRecordArray(records: readonly unknown[]): Record<string, unknown>[] | null {
  const sanitized: Record<string, unknown>[] = [];
  for (const record of records) {
    if (!isPlainRecord(record)) return null;
    const value = sanitizeJsonValue(record, new Set<object>());
    if (value === omittedJsonValue || !isRecord(value)) return null;
    sanitized.push(value);
  }
  return sanitized;
}

function sanitizeJsonValue(
  value: unknown,
  ancestors: Set<object>,
): unknown | typeof omittedJsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : omittedJsonValue;

  if (Array.isArray(value)) {
    if (ancestors.has(value)) return omittedJsonValue;
    ancestors.add(value);
    const sanitized: unknown[] = [];
    for (const item of value) {
      const parsedItem = sanitizeJsonValue(item, ancestors);
      if (parsedItem !== omittedJsonValue) sanitized.push(parsedItem);
    }
    ancestors.delete(value);
    return sanitized;
  }

  if (!isPlainRecord(value) || ancestors.has(value)) return omittedJsonValue;
  ancestors.add(value);
  const sanitized: Record<string, unknown> = {};
  for (const key of Object.keys(value)) {
    if (!isSafeObjectKey(key) || prohibitedPersistedKeys.has(key)) continue;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !("value" in descriptor)) continue;
    const parsedValue = sanitizeJsonValue(descriptor.value, ancestors);
    if (parsedValue !== omittedJsonValue) sanitized[key] = parsedValue;
  }
  ancestors.delete(value);
  return sanitized;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSafeObjectKey(value: string): boolean {
  return value !== "__proto__" && value !== "constructor" && value !== "prototype";
}

function hasOwn(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}
