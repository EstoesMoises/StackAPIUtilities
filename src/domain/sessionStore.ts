import type { DatasetName, ReportId, SessionCredentials, SessionState } from "./types";

type SessionAction =
  | { type: "credentials/set"; credentials: SessionCredentials }
  | { type: "report/select"; reportId: ReportId }
  | { type: "reports/selectMany"; reportIds: ReportId[] }
  | { type: "dataset/set"; datasetName: DatasetName; records: unknown[] }
  | { type: "session/reset" };

export function createInitialSessionState(): SessionState {
  return {
    credentials: null,
    selectedReportId: "tag-report",
    selectedReportIds: ["tag-report"],
    datasets: {},
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
    case "session/reset":
      return createInitialSessionState();
    default:
      return state;
  }
}
