import { hydrateDatasetSessionState } from "./datasetPersistence";
import type {
  DatasetName,
  PeriodScope,
  ReportId,
  ReportOutput,
  ReportRunPresetId,
  ReportWarning,
  RunPeriodRole,
  SessionCredentials,
  SessionDataset,
  SessionState,
} from "./types";
import { buildTagHealthRowsFromLiveRecords } from "../reports/tagReport";

interface LiveDatasetPayload {
  datasetName: DatasetName;
  records: Record<string, unknown>[];
}

type SessionAction =
  | { type: "credentials/set"; credentials: SessionCredentials }
  | { type: "report/select"; reportId: ReportId }
  | { type: "reports/selectMany"; reportIds: ReportId[] }
  | { type: "dataset/set"; datasetName: DatasetName; records: unknown[] }
  | {
      type: "live/loaded";
      reportId: ReportId;
      periodRole: RunPeriodRole;
      scope: PeriodScope;
      pageSize: number;
      maxPagesPerDataset: number;
      runPreset?: ReportRunPresetId;
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
      preserveSelection?: Pick<SessionState, "selectedReportId" | "selectedReportIds">;
    }
  | { type: "datasets/flush" }
  | { type: "session/reset" };

export function createInitialSessionState(): SessionState {
  return {
    credentials: null,
    selectedReportId: "tag-report",
    selectedReportIds: ["tag-report"],
    datasets: {},
    reportOutputs: {},
    reportRunSnapshots: [],
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
      const snapshotId = createSnapshotId(action.reportId, action.periodRole, loadedAt);
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
            pageSize: action.pageSize,
            maxPagesPerDataset: action.maxPagesPerDataset,
            runPreset: action.runPreset,
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
    case "dataset/remove": {
      const { [action.datasetId]: removedDataset, ...remainingDatasets } = state.datasets;

      if (!removedDataset) {
        return state;
      }

      const reportRunSnapshots = state.reportRunSnapshots
        .map((snapshot) => ({
          ...snapshot,
          datasetIds: snapshot.datasetIds.filter((datasetId) => datasetId !== action.datasetId),
        }))
        .filter((snapshot) => snapshot.datasetIds.length > 0);

      return {
        ...state,
        datasets: remainingDatasets,
        reportOutputs: removeReportOutputsForDataset(state.reportOutputs, removedDataset),
        reportRunSnapshots,
        warnings: pruneWarningsForRemainingDatasetState(state.warnings, remainingDatasets, reportRunSnapshots),
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
      };
    }
    case "datasets/flush":
      return {
        ...state,
        datasets: {},
        reportOutputs: {},
        reportRunSnapshots: [],
        warnings: [],
      };
    case "session/reset":
      return createInitialSessionState();
    default:
      return state;
  }
}

function removeReportOutputsForDataset(
  reportOutputs: SessionState["reportOutputs"],
  removedDataset: SessionDataset,
): SessionState["reportOutputs"] {
  const nextReportOutputs = { ...reportOutputs };

  for (const reportId of Object.keys(nextReportOutputs) as ReportId[]) {
    const output = nextReportOutputs[reportId];

    if (!output) {
      continue;
    }

    const nextOutput = removeDatasetFromReportOutput(output, removedDataset);

    if (nextOutput) {
      nextReportOutputs[reportId] = nextOutput;
    } else {
      delete nextReportOutputs[reportId];
    }
  }

  return nextReportOutputs;
}

function removeDatasetFromReportOutput(output: ReportOutput, dataset: SessionDataset): ReportOutput | null {
  if (isUploadedReportOutputTiedToDataset(output, dataset)) {
    return null;
  }

  if (!dataset.snapshotId) {
    return output;
  }

  if (output.currentSnapshotId === dataset.snapshotId) {
    const records = pruneDatasetRecords(output.records, dataset);
    const nextOutput: ReportOutput = {
      ...output,
      records,
    };

    if (records.length === 0) {
      delete nextOutput.currentScope;
      delete nextOutput.currentSnapshotId;
    }

    return hasReportOutputRecords(nextOutput) ? nextOutput : null;
  }

  if (output.comparisonSnapshotId === dataset.snapshotId) {
    const nextOutput: ReportOutput = { ...output };
    const comparisonRecords = pruneDatasetRecords(output.comparisonRecords ?? [], dataset);

    if (comparisonRecords.length > 0) {
      nextOutput.comparisonRecords = comparisonRecords;
    } else {
      delete nextOutput.comparisonRecords;
      delete nextOutput.comparisonScope;
      delete nextOutput.comparisonSnapshotId;
    }

    return hasReportOutputRecords(nextOutput) ? nextOutput : null;
  }

  return output;
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

function hasReportOutputRecords(output: ReportOutput): boolean {
  return output.records.length > 0 || Boolean(output.comparisonRecords?.length);
}

function pruneDatasetRecords(
  records: Record<string, unknown>[],
  dataset: SessionDataset,
): Record<string, unknown>[] {
  return records.filter((record) => record.datasetName !== dataset.name);
}

function pruneWarningsForRemainingDatasetState(
  warnings: ReportWarning[],
  datasets: Record<string, SessionDataset>,
  reportRunSnapshots: SessionState["reportRunSnapshots"],
): ReportWarning[] {
  if (warnings.length === 0) {
    return warnings;
  }

  const remainingWarnings = [
    ...Object.values(datasets).flatMap((dataset) => dataset.warnings ?? []),
    ...reportRunSnapshots.flatMap((snapshot) => snapshot.warnings),
  ];

  if (remainingWarnings.length === 0) {
    return [];
  }

  return warnings.filter((warning) =>
    remainingWarnings.some((remainingWarning) => isSameWarning(remainingWarning, warning)),
  );
}

function isSameWarning(left: ReportWarning, right: ReportWarning): boolean {
  return left.reportId === right.reportId && left.code === right.code && left.message === right.message;
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

function createSnapshotId(reportId: ReportId, periodRole: RunPeriodRole, loadedAt: string): string {
  return createDatasetId("snapshot", reportId, periodRole, loadedAt);
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
    const key = [warning.reportId ?? "", warning.code, warning.message].join("\u0000");

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    uniqueWarnings.push(warning);
  }

  return uniqueWarnings;
}
