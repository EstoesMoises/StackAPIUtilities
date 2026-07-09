import { hydrateDatasetSessionState } from "./datasetPersistence";
import type {
  DatasetName,
  PeriodScope,
  ReportId,
  ReportWarning,
  RunPeriodRole,
  SessionCredentials,
  SessionDataset,
  SessionState,
} from "./types";

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
  | { type: "session/hydratePersistentDatasets"; snapshot: unknown }
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
      const baseOutput = {
        reportId: action.reportId,
        datasetName: action.datasets[0].datasetName,
        fileName: "Live API run",
        loadedAt,
        source: "live-api" as const,
        warnings: action.warnings,
      };
      const nextOutput =
        action.periodRole === "comparison"
          ? {
              ...baseOutput,
              records: previousOutput?.records ?? [],
              comparisonRecords: reportRecords,
              currentScope: previousOutput?.currentScope,
              comparisonScope: action.scope,
              currentSnapshotId: previousOutput?.currentSnapshotId,
              comparisonSnapshotId: snapshotId,
            }
          : {
              ...baseOutput,
              records: reportRecords,
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

      return {
        ...state,
        datasets: remainingDatasets,
        reportRunSnapshots: state.reportRunSnapshots
          .map((snapshot) => ({
            ...snapshot,
            datasetIds: snapshot.datasetIds.filter((datasetId) => datasetId !== action.datasetId),
          }))
          .filter((snapshot) => snapshot.datasetIds.length > 0),
      };
    }
    case "session/hydratePersistentDatasets":
      return hydrateDatasetSessionState(state, action.snapshot);
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
