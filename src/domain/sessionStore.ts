import type { DatasetName, ReportId, SessionCredentials, SessionDataset, SessionState } from "./types";

interface LiveDatasetPayload {
  datasetName: DatasetName;
  records: Record<string, unknown>[];
}

type SessionAction =
  | { type: "credentials/set"; credentials: SessionCredentials }
  | { type: "report/select"; reportId: ReportId }
  | { type: "reports/selectMany"; reportIds: ReportId[] }
  | { type: "dataset/set"; datasetName: DatasetName; records: unknown[] }
  | { type: "live/loaded"; reportId: ReportId; datasets: LiveDatasetPayload[] }
  | {
      type: "import/loaded";
      datasetName: DatasetName;
      fileName: string;
      records: Record<string, unknown>[];
      reportId: ReportId;
    }
  | { type: "session/reset" };

export function createInitialSessionState(): SessionState {
  return {
    credentials: null,
    selectedReportId: "tag-report",
    selectedReportIds: ["tag-report"],
    datasets: {},
    reportOutputs: {},
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
      return {
        ...state,
        datasets: {
          ...state.datasets,
          [action.datasetName]: {
            name: action.datasetName,
            records: action.records,
            loadedAt: new Date().toISOString(),
            source: "upload",
          },
        },
      };
    case "import/loaded": {
      const loadedAt = new Date().toISOString();

      return {
        ...state,
        selectedReportId: action.reportId,
        selectedReportIds: [action.reportId],
        datasets: {
          ...state.datasets,
          [action.datasetName]: {
            name: action.datasetName,
            records: action.records,
            loadedAt,
            source: "upload",
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
      const liveDatasets: Partial<Record<DatasetName, SessionDataset>> = {};
      const reportRecords = action.datasets.flatMap(({ datasetName, records }) =>
        records.map((record) => ({ datasetName, ...record })),
      );

      for (const dataset of action.datasets) {
        liveDatasets[dataset.datasetName] = {
          name: dataset.datasetName,
          records: dataset.records,
          loadedAt,
          source: "live-api",
        };
      }

      return {
        ...state,
        selectedReportId: action.reportId,
        selectedReportIds: [action.reportId],
        datasets: {
          ...state.datasets,
          ...liveDatasets,
        },
        reportOutputs: {
          ...state.reportOutputs,
          [action.reportId]: {
            reportId: action.reportId,
            datasetName: action.datasets[0].datasetName,
            fileName: "Live API run",
            records: reportRecords,
            loadedAt,
            source: "live-api",
          },
        },
      };
    }
    case "session/reset":
      return createInitialSessionState();
    default:
      return state;
  }
}
