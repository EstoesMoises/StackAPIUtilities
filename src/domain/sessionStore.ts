import { hydrateDatasetSessionState } from "./datasetPersistence";
import { isLegacyCollectionWarning } from "./collectionWarnings";
import type { DatasetPaginationMetadata } from "../collectors/liveCollectors";
import type {
  DatasetName,
  PeriodScope,
  ReportId,
  ReportOutput,
  ReportWarning,
  RunPeriodRole,
  SessionCredentials,
  SessionDataset,
  SessionState,
  UtilityId,
} from "./types";
import { buildTagHealthRowsFromLiveRecords } from "../reports/tagReport";
import type { SmeCoverageRunResult } from "../utilities/smeCoverage/runner";
import { parseTerminalSmeCoverageResult } from "../utilities/smeCoverage/runtimeValidation";

interface LiveDatasetPayload {
  datasetName: DatasetName;
  records: Record<string, unknown>[];
  pagination: DatasetPaginationMetadata;
}

type SessionAction =
  | { type: "credentials/set"; credentials: SessionCredentials }
  | { type: "report/select"; reportId: ReportId }
  | { type: "reports/selectMany"; reportIds: ReportId[] }
  | { type: "utility/select"; utilityId: UtilityId }
  | { type: "dataset/set"; datasetName: DatasetName; records: unknown[] }
  | { type: "utility/loaded"; result: SmeCoverageRunResult }
  | {
      type: "live/loaded";
      reportId: ReportId;
      periodRole: RunPeriodRole;
      scope: PeriodScope;
      warnings: ReportWarning[];
      datasets: LiveDatasetPayload[];
    }
  | {
      type: "import/loaded";
      datasetName: DatasetName;
      fileName: string;
      records: Record<string, unknown>[];
      reportId: ReportId;
    }
  | { type: "dataset/remove"; datasetId: string }
  | {
      type: "session/hydratePersistentDatasets";
      snapshot: unknown;
      preserveSelection?: Pick<SessionState, "selectedReportId" | "selectedReportIds" | "selectedUtilityId">;
    }
  | { type: "datasets/flush" }
  | { type: "session/reset" };

export function createInitialSessionState(): SessionState {
  return {
    credentials: null,
    selectedReportId: "tag-report",
    selectedReportIds: ["tag-report"],
    selectedUtilityId: "sme-coverage-analyzer",
    datasets: {},
    reportOutputs: {},
    reportRunSnapshots: [],
    utilityOutputs: {},
    utilityRunSnapshots: [],
    warnings: [],
    runQueue: [],
  };
}

export function sessionReducer(state: SessionState, action: SessionAction): SessionState {
  switch (action.type) {
    case "credentials/set":
      return { ...state, credentials: action.credentials };
    case "report/select":
      return {
        ...state,
        selectedReportId: action.reportId,
        selectedReportIds: [action.reportId],
      };
    case "reports/selectMany":
      return {
        ...state,
        selectedReportId: action.reportIds[0] ?? state.selectedReportId,
        selectedReportIds: action.reportIds,
      };
    case "utility/select":
      return { ...state, selectedUtilityId: action.utilityId };
    case "dataset/set":
      return storeUploadedDataset(state, action.datasetName, action.records);
    case "import/loaded": {
      const loadedAt = new Date().toISOString();
      const datasetId = createDatasetId("upload", action.datasetName, loadedAt);

      return {
        ...state,
        selectedReportId: action.reportId,
        selectedReportIds: [action.reportId],
        datasets: {
          ...state.datasets,
          [datasetId]: {
            id: datasetId,
            name: action.datasetName,
            records: action.records,
            loadedAt,
            source: "upload",
            fileName: action.fileName,
            reportId: action.reportId,
          },
        },
        reportOutputs: {
          ...state.reportOutputs,
          [action.reportId]: {
            reportId: action.reportId,
            datasetName: action.datasetName,
            fileName: action.fileName,
            records: action.records,
            loadedAt,
            source: "upload",
          },
        },
      };
    }
    case "live/loaded": {
      if (action.datasets.length === 0) {
        return state;
      }

      const loadedAt = new Date().toISOString();
      const snapshotId = createSnapshotId(state, action.reportId, action.periodRole, loadedAt);
      const liveDatasets: Record<string, SessionDataset> = {};
      const datasetIds: string[] = [];
      const reportRecords = action.datasets.flatMap(({ datasetName, records }) =>
        records.map((record) => ({ datasetName, ...record })),
      );
      const visibleReportRecords =
        action.reportId === "tag-report" ? buildTagHealthRowsFromLiveRecords(reportRecords) : reportRecords;

      action.datasets.forEach((dataset, index) => {
        const datasetId = createDatasetId(snapshotId, dataset.datasetName, String(index));
        datasetIds.push(datasetId);
        liveDatasets[datasetId] = {
          id: datasetId,
          snapshotId,
          reportId: action.reportId,
          name: dataset.datasetName,
          records: dataset.records,
          loadedAt,
          source: "live-api",
          periodRole: action.periodRole,
          scope: action.scope,
          warnings: action.warnings,
          pageCount: dataset.pagination.pageCount,
          reachedMaxPages: dataset.pagination.reachedMaxPages,
          hasMore: dataset.pagination.hasMore,
        };
      });

      const previousOutput = state.reportOutputs[action.reportId];
      const currentWarnings =
        action.periodRole === "current" ? action.warnings : getSnapshotWarnings(state, previousOutput?.currentSnapshotId);
      const comparisonWarnings =
        action.periodRole === "comparison"
          ? action.warnings
          : getSnapshotWarnings(state, previousOutput?.comparisonSnapshotId);
      const outputWarnings = dedupeWarnings([...currentWarnings, ...comparisonWarnings]);
      const baseOutput = {
        reportId: action.reportId,
        datasetName: action.datasets[0].datasetName,
        fileName: "Live API run",
        loadedAt,
        source: "live-api" as const,
        warnings: outputWarnings,
      };
      const nextOutput =
        action.periodRole === "comparison"
          ? {
              ...baseOutput,
              records: previousOutput?.records ?? [],
              comparisonRecords: visibleReportRecords,
              currentScope: previousOutput?.currentScope,
              comparisonScope: action.scope,
              currentSnapshotId: previousOutput?.currentSnapshotId,
              comparisonSnapshotId: snapshotId,
            }
          : {
              ...baseOutput,
              records: visibleReportRecords,
              comparisonRecords: previousOutput?.comparisonRecords,
              currentScope: action.scope,
              comparisonScope: previousOutput?.comparisonScope,
              currentSnapshotId: snapshotId,
              comparisonSnapshotId: previousOutput?.comparisonSnapshotId,
            };

      return {
        ...state,
        selectedReportId: action.reportId,
        selectedReportIds: [action.reportId],
        datasets: {
          ...state.datasets,
          ...liveDatasets,
        },
        reportRunSnapshots: [
          ...state.reportRunSnapshots,
          {
            id: snapshotId,
            reportId: action.reportId,
            periodRole: action.periodRole,
            scope: action.scope,
            loadedAt,
            datasetIds,
            warnings: action.warnings,
          },
        ],
        reportOutputs: {
          ...state.reportOutputs,
          [action.reportId]: nextOutput,
        },
        warnings: [...state.warnings, ...action.warnings],
      };
    }
    case "utility/loaded": {
      const result = parseTerminalSmeCoverageResult(action.result);
      if (!result) return state;
      const loadedAt = new Date().toISOString();
      const snapshotId = createUtilitySnapshotId(state, result.utilityId, loadedAt);
      const liveDatasets: Record<string, SessionDataset> = {};
      const datasetIds: string[] = [];
      const requiredDatasetNames = ["tags", "questions", "tagSmeCounts"] as const;

      requiredDatasetNames.forEach((datasetName, index) => {
        const source = result.datasets.find((dataset) => dataset.datasetName === datasetName);
        const datasetId = createDatasetId(snapshotId, datasetName, String(index));
        const pagination = source?.pagination ?? { pageCount: 0, reachedMaxPages: false, hasMore: false };
        datasetIds.push(datasetId);
        liveDatasets[datasetId] = {
          id: datasetId,
          snapshotId,
          utilityId: result.utilityId,
          name: datasetName,
          records: [...(source?.records ?? [])],
          loadedAt,
          source: "live-api",
          warnings: result.warnings.map((warning) => ({ ...warning })),
          pageCount: pagination.pageCount,
          reachedMaxPages: pagination.reachedMaxPages,
          hasMore: pagination.hasMore,
        };
      });

      const warnings = result.warnings.map((warning) => ({ ...warning }));
      return {
        ...state,
        selectedUtilityId: result.utilityId,
        datasets: { ...state.datasets, ...liveDatasets },
        utilityOutputs: {
          ...state.utilityOutputs,
          [result.utilityId]: {
            utilityId: result.utilityId,
            loadedAt,
            decisionPack: result.decisionPack,
          },
        },
        utilityRunSnapshots: [
          ...state.utilityRunSnapshots,
          {
            id: snapshotId,
            utilityId: result.utilityId,
            loadedAt,
            datasetIds,
            warnings,
          },
        ],
        warnings: [...state.warnings, ...warnings],
      };
    }
    case "dataset/remove": {
      const { [action.datasetId]: removedDataset, ...remainingDatasets } = state.datasets;

      if (!removedDataset) {
        return state;
      }

      const invalidatedReportSnapshotIds = new Set(
        state.reportRunSnapshots
          .filter(
            (snapshot) =>
              snapshot.datasetIds.includes(action.datasetId) &&
              !snapshot.warnings.some((warning) => isLegacyCollectionWarning(warning, snapshot.reportId)),
          )
          .map((snapshot) => snapshot.id),
      );
      const invalidatedUtilitySnapshotIds = new Set(
        state.utilityRunSnapshots
          .filter(
            (snapshot) =>
              snapshot.datasetIds.includes(action.datasetId) &&
              snapshot.datasetIds.every((datasetId) => hasTerminalDatasetPagination(state.datasets[datasetId])),
          )
          .map((snapshot) => snapshot.id),
      );
      const datasets = detachDatasetsFromInvalidatedSnapshots(
        remainingDatasets,
        new Set([...invalidatedReportSnapshotIds, ...invalidatedUtilitySnapshotIds]),
      );
      const reportRunSnapshots = state.reportRunSnapshots
        .filter((snapshot) => !invalidatedReportSnapshotIds.has(snapshot.id))
        .map((snapshot) => ({
          ...snapshot,
          datasetIds: snapshot.datasetIds.filter((datasetId) => datasetId !== action.datasetId),
        }))
        .filter((snapshot) => snapshot.datasetIds.length > 0);
      const utilityRunSnapshots = state.utilityRunSnapshots
        .filter((snapshot) => !invalidatedUtilitySnapshotIds.has(snapshot.id))
        .map((snapshot) => ({
          ...snapshot,
          datasetIds: snapshot.datasetIds.filter((datasetId) => datasetId !== action.datasetId),
        }))
        .filter((snapshot) => snapshot.datasetIds.length > 0);
      const utilityOutputs = { ...state.utilityOutputs };
      (Object.keys(utilityOutputs) as UtilityId[]).forEach((utilityId) => {
        const output = utilityOutputs[utilityId];
        if (!output) return;

        for (let index = state.utilityRunSnapshots.length - 1; index >= 0; index -= 1) {
          const snapshot = state.utilityRunSnapshots[index];
          if (snapshot?.utilityId === utilityId && snapshot.loadedAt === output.loadedAt) {
            if (invalidatedUtilitySnapshotIds.has(snapshot.id)) {
              delete utilityOutputs[utilityId];
            }
            break;
          }
        }
      });

      return {
        ...state,
        datasets,
        reportOutputs: removeReportOutputsForDataset(
          state.reportOutputs,
          removedDataset,
          state.reportRunSnapshots,
          reportRunSnapshots,
          datasets,
        ),
        reportRunSnapshots,
        utilityOutputs,
        utilityRunSnapshots,
        warnings: pruneWarningsForRemainingDatasetState(
          state.warnings,
          datasets,
          reportRunSnapshots,
          utilityRunSnapshots,
        ),
      };
    }
    case "session/hydratePersistentDatasets": {
      const hydrated = hydrateDatasetSessionState(state, action.snapshot);

      if (!action.preserveSelection || hydrated === state) {
        return hydrated;
      }

      return {
        ...hydrated,
        selectedReportId: action.preserveSelection.selectedReportId,
        selectedReportIds: action.preserveSelection.selectedReportIds,
        selectedUtilityId: action.preserveSelection.selectedUtilityId,
      };
    }
    case "datasets/flush":
      return {
        ...state,
        datasets: {},
        reportOutputs: {},
        reportRunSnapshots: [],
        utilityOutputs: {},
        utilityRunSnapshots: [],
        warnings: [],
      };
    case "session/reset":
      return createInitialSessionState();
    default:
      return state;
  }
}

function hasTerminalDatasetPagination(dataset: SessionDataset | undefined): boolean {
  return (
    !!dataset &&
    Number.isInteger(dataset.pageCount) &&
    (dataset.pageCount ?? -1) >= 0 &&
    dataset.reachedMaxPages === false &&
    dataset.hasMore === false
  );
}

function detachDatasetsFromInvalidatedSnapshots(
  datasets: SessionState["datasets"],
  invalidatedSnapshotIds: ReadonlySet<string>,
): SessionState["datasets"] {
  return Object.fromEntries(
    Object.entries(datasets).map(([datasetId, dataset]) => {
      if (!dataset.snapshotId || !invalidatedSnapshotIds.has(dataset.snapshotId)) {
        return [datasetId, dataset];
      }

      const { snapshotId: _snapshotId, ...detachedDataset } = dataset;
      return [datasetId, detachedDataset];
    }),
  );
}

function removeReportOutputsForDataset(
  reportOutputs: SessionState["reportOutputs"],
  removedDataset: SessionDataset,
  previousReportRunSnapshots: SessionState["reportRunSnapshots"],
  retainedReportRunSnapshots: SessionState["reportRunSnapshots"],
  remainingDatasets: SessionState["datasets"],
): SessionState["reportOutputs"] {
  const nextReportOutputs = { ...reportOutputs };
  const retainedSnapshotIds = new Set(retainedReportRunSnapshots.map((snapshot) => snapshot.id));

  for (const reportId of Object.keys(nextReportOutputs) as ReportId[]) {
    const output = nextReportOutputs[reportId];

    if (!output) {
      continue;
    }

    const nextOutput = removeDatasetFromReportOutput(
      output,
      removedDataset,
      retainedSnapshotIds,
      previousReportRunSnapshots,
      retainedReportRunSnapshots,
      remainingDatasets,
    );

    if (nextOutput) {
      nextReportOutputs[reportId] = nextOutput;
    } else {
      delete nextReportOutputs[reportId];
    }
  }

  return nextReportOutputs;
}

function removeDatasetFromReportOutput(
  output: ReportOutput,
  dataset: SessionDataset,
  retainedSnapshotIds: ReadonlySet<string>,
  previousReportRunSnapshots: SessionState["reportRunSnapshots"],
  retainedReportRunSnapshots: SessionState["reportRunSnapshots"],
  remainingDatasets: SessionState["datasets"],
): ReportOutput | null {
  if (isUploadedReportOutputTiedToDataset(output, dataset)) {
    return null;
  }

  if (!dataset.snapshotId) {
    return output;
  }
  const removedSnapshotWarnings = retainedSnapshotIds.has(dataset.snapshotId)
    ? []
    : previousReportRunSnapshots.find(
        (snapshot) => snapshot.id === dataset.snapshotId && snapshot.reportId === output.reportId,
      )?.warnings ?? dataset.warnings ?? [];

  if (output.currentSnapshotId === dataset.snapshotId) {
    const isSnapshotRetained = retainedSnapshotIds.has(dataset.snapshotId);
    const records = pruneDatasetRecords(
      output.records,
      dataset,
      isSnapshotRetained,
      output.reportId,
      dataset.snapshotId,
      remainingDatasets,
    );
    const nextOutput: ReportOutput = {
      ...output,
      records,
    };

    if (!isSnapshotRetained) {
      delete nextOutput.currentScope;
      delete nextOutput.currentSnapshotId;
    }

    const refreshedOutput = refreshReportOutputWarnings(
      nextOutput,
      retainedReportRunSnapshots,
      removedSnapshotWarnings,
    );
    return hasRetainedReportOutputSnapshot(refreshedOutput, retainedSnapshotIds)
      ? refreshedOutput
      : null;
  }

  if (output.comparisonSnapshotId === dataset.snapshotId) {
    const nextOutput: ReportOutput = { ...output };
    const isSnapshotRetained = retainedSnapshotIds.has(dataset.snapshotId);
    const comparisonRecords = pruneDatasetRecords(
      output.comparisonRecords ?? [],
      dataset,
      isSnapshotRetained,
      output.reportId,
      dataset.snapshotId,
      remainingDatasets,
    );

    if (isSnapshotRetained) {
      nextOutput.comparisonRecords = comparisonRecords;
    } else {
      delete nextOutput.comparisonRecords;
      delete nextOutput.comparisonScope;
      delete nextOutput.comparisonSnapshotId;
    }

    const refreshedOutput = refreshReportOutputWarnings(
      nextOutput,
      retainedReportRunSnapshots,
      removedSnapshotWarnings,
    );
    return hasRetainedReportOutputSnapshot(refreshedOutput, retainedSnapshotIds)
      ? refreshedOutput
      : null;
  }

  return output;
}

function refreshReportOutputWarnings(
  output: ReportOutput,
  reportRunSnapshots: SessionState["reportRunSnapshots"],
  removedSnapshotWarnings: ReportWarning[],
): ReportOutput {
  const retainedSnapshotWarnings = [output.currentSnapshotId, output.comparisonSnapshotId].flatMap((snapshotId) => {
    if (!snapshotId) return [];
    return reportRunSnapshots.find(
      (snapshot) => snapshot.id === snapshotId && snapshot.reportId === output.reportId,
    )?.warnings ?? [];
  });
  const snapshotWarnings = [...retainedSnapshotWarnings, ...removedSnapshotWarnings];
  const outputSpecificWarnings = (output.warnings ?? []).filter(
    (warning) => !snapshotWarnings.some((snapshotWarning) => isSameWarning(warning, snapshotWarning)),
  );

  return {
    ...output,
    warnings: dedupeWarnings([...outputSpecificWarnings, ...retainedSnapshotWarnings]),
  };
}

function isUploadedReportOutputTiedToDataset(output: ReportOutput, dataset: SessionDataset): boolean {
  return (
    dataset.source === "upload" &&
    output.source === "upload" &&
    output.reportId === dataset.reportId &&
    output.datasetName === dataset.name &&
    output.loadedAt === dataset.loadedAt
  );
}

function hasRetainedReportOutputSnapshot(
  output: ReportOutput,
  retainedSnapshotIds: ReadonlySet<string>,
): boolean {
  return (
    (typeof output.currentSnapshotId === "string" &&
      retainedSnapshotIds.has(output.currentSnapshotId)) ||
    (typeof output.comparisonSnapshotId === "string" &&
      retainedSnapshotIds.has(output.comparisonSnapshotId))
  );
}

function pruneDatasetRecords(
  records: Record<string, unknown>[],
  dataset: SessionDataset,
  isSnapshotRetained: boolean,
  reportId: ReportId,
  snapshotId: string,
  remainingDatasets: SessionState["datasets"],
): Record<string, unknown>[] {
  if (!isSnapshotRetained) {
    return [];
  }

  if (records.some((record) => Object.prototype.hasOwnProperty.call(record, "datasetName"))) {
    return records.filter((record) => record.datasetName !== dataset.name);
  }

  return buildVisibleReportRecordsForSnapshot(reportId, snapshotId, remainingDatasets);
}

function buildVisibleReportRecordsForSnapshot(
  reportId: ReportId,
  snapshotId: string,
  datasets: SessionState["datasets"],
): Record<string, unknown>[] {
  const reportRecords = Object.values(datasets)
    .filter(
      (dataset) =>
        dataset.source === "live-api" && dataset.snapshotId === snapshotId && dataset.reportId === reportId,
    )
    .flatMap((dataset) =>
      dataset.records.map((record) => createReportRecord(dataset.name, record)),
    );

  return reportId === "tag-report"
    ? buildTagHealthRowsFromLiveRecords(reportRecords).map((record) => ({ ...record }))
    : reportRecords;
}

function createReportRecord(datasetName: DatasetName, record: unknown): Record<string, unknown> {
  if (isRecordObject(record)) {
    return { datasetName, ...record };
  }

  return { datasetName, value: record };
}

function isRecordObject(record: unknown): record is Record<string, unknown> {
  return typeof record === "object" && record !== null && !Array.isArray(record);
}

function pruneWarningsForRemainingDatasetState(
  warnings: ReportWarning[],
  datasets: Record<string, SessionDataset>,
  reportRunSnapshots: SessionState["reportRunSnapshots"],
  utilityRunSnapshots: SessionState["utilityRunSnapshots"],
): ReportWarning[] {
  if (warnings.length === 0) {
    return warnings;
  }

  const remainingWarnings = [
    ...Object.values(datasets).flatMap((dataset) => dataset.warnings ?? []),
    ...reportRunSnapshots.flatMap((snapshot) => snapshot.warnings),
    ...utilityRunSnapshots.flatMap((snapshot) => snapshot.warnings),
  ];

  if (remainingWarnings.length === 0) {
    return [];
  }

  return warnings.filter((warning) =>
    remainingWarnings.some((remainingWarning) => isSameWarning(remainingWarning, warning)),
  );
}

function isSameWarning(left: ReportWarning, right: ReportWarning): boolean {
  return (
    left.reportId === right.reportId &&
    left.utilityId === right.utilityId &&
    left.code === right.code &&
    left.message === right.message
  );
}

function storeUploadedDataset(
  state: SessionState,
  datasetName: DatasetName,
  records: unknown[],
): SessionState {
  const loadedAt = new Date().toISOString();
  const datasetId = createDatasetId("upload", datasetName, loadedAt);

  return {
    ...state,
    datasets: {
      ...state.datasets,
      [datasetId]: {
        id: datasetId,
        name: datasetName,
        records,
        loadedAt,
        source: "upload",
      },
    },
  };
}

function createSnapshotId(
  state: SessionState,
  reportId: ReportId,
  periodRole: RunPeriodRole,
  loadedAt: string,
): string {
  const baseId = createDatasetId("snapshot", reportId, periodRole, loadedAt);
  let suffix = 0;
  let candidate = baseId;

  while (hasSnapshotIdConflict(state, candidate)) {
    suffix += 1;
    candidate = createDatasetId(baseId, String(suffix));
  }
  return candidate;
}

function createUtilitySnapshotId(state: SessionState, utilityId: UtilityId, loadedAt: string): string {
  let suffix = state.utilityRunSnapshots.length;
  let candidate = createDatasetId("utility-snapshot", utilityId, loadedAt, String(suffix));
  while (hasSnapshotIdConflict(state, candidate)) {
    suffix += 1;
    candidate = createDatasetId("utility-snapshot", utilityId, loadedAt, String(suffix));
  }
  return candidate;
}

function hasSnapshotIdConflict(state: SessionState, candidate: string): boolean {
  return (
    state.reportRunSnapshots.some((snapshot) => snapshot.id === candidate) ||
    state.utilityRunSnapshots.some((snapshot) => snapshot.id === candidate) ||
    Object.values(state.datasets).some(
      (dataset) =>
        dataset.snapshotId === candidate ||
        dataset.id === candidate ||
        dataset.id.startsWith(`${candidate}__`),
    )
  );
}

function createDatasetId(...parts: string[]): string {
  return parts.join("__");
}

function getSnapshotWarnings(state: SessionState, snapshotId: string | undefined): ReportWarning[] {
  if (!snapshotId) {
    return [];
  }

  for (let index = state.reportRunSnapshots.length - 1; index >= 0; index -= 1) {
    const snapshot = state.reportRunSnapshots[index];

    if (snapshot?.id === snapshotId) {
      return snapshot.warnings;
    }
  }

  return [];
}

function dedupeWarnings(warnings: ReportWarning[]): ReportWarning[] {
  const seen = new Set<string>();
  const uniqueWarnings: ReportWarning[] = [];

  for (const warning of warnings) {
    const key = [warning.reportId ?? "", warning.utilityId ?? "", warning.code, warning.message].join("\u0000");

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    uniqueWarnings.push(warning);
  }

  return uniqueWarnings;
}
