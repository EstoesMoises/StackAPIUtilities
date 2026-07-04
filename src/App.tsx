import { useReducer, useState } from "react";
import { AppShell, type AppPanel } from "./components/AppShell";
import { CredentialsPanel } from "./components/CredentialsPanel";
import { ReportCatalog } from "./components/ReportCatalog";
import { ReportWorkspace } from "./components/ReportWorkspace";
import { RunStatus } from "./components/RunStatus";
import { SessionOverview } from "./components/SessionOverview";
import { UploadsPanel, type ImportedUploadResult } from "./components/UploadsPanel";
import { validateCredentialsForReport } from "./credentials/credentialRules";
import { reportRegistry } from "./domain/reportRegistry";
import { createInitialSessionState, sessionReducer } from "./domain/sessionStore";
import type { ReportId, RunQueueItem } from "./domain/types";

export function App() {
  const [state, dispatch] = useReducer(sessionReducer, undefined, createInitialSessionState);
  const [activePanel, setActivePanel] = useState<AppPanel>("report");
  const [runQueue, setRunQueue] = useState<RunQueueItem[]>([]);

  function selectReport(reportId: ReportId) {
    dispatch({ type: "report/select", reportId });
    setActivePanel("report");
  }

  function queueSelectedReportRun() {
    const report = reportRegistry.find((candidate) => candidate.id === state.selectedReportId)!;
    if (!state.credentials) {
      setRunQueue([
        {
          id: `${state.selectedReportId}-missing-credentials`,
          reportId: state.selectedReportId,
          status: "queued",
          message: `Add session credentials before running ${report.title}.`,
        },
      ]);
      setActivePanel("credentials");
      return;
    }

    const validation = validateCredentialsForReport(state.selectedReportId, state.credentials);
    if (!validation.valid) {
      setRunQueue(
        validation.messages.map((message, index) => ({
          id: `${state.selectedReportId}-credential-error-${index}`,
          reportId: state.selectedReportId,
          status: "failed",
          message,
        })),
      );
      setActivePanel("credentials");
      return;
    }

    setRunQueue([
      {
        id: `${state.selectedReportId}-preview-run`,
        reportId: state.selectedReportId,
        status: "queued",
        message: `${report.title} has valid session credentials. Live API execution is not connected yet; use Uploads for existing CSV or JSON outputs.`,
      },
    ]);
  }

  function importUploadedReport(result: ImportedUploadResult) {
    const report = reportRegistry.find((candidate) => candidate.id === result.reportId)!;

    dispatch({
      type: "import/loaded",
      datasetName: result.datasetName,
      fileName: result.fileName,
      records: result.records,
      reportId: result.reportId,
    });
    setRunQueue([
      {
        id: `${result.reportId}-${result.fileName}-imported`,
        reportId: result.reportId,
        status: "succeeded",
        message: `Imported ${result.fileName} for ${report.title}.`,
      },
    ]);
    setActivePanel("report");
  }

  const selectedReportRecords = state.reportOutputs[state.selectedReportId]?.records ?? [];
  const datasetCount = Object.values(state.datasets).filter((dataset) => dataset !== undefined).length;

  return (
    <AppShell
      activePanel={activePanel}
      onPanelChange={setActivePanel}
      summary={{ credentialsSaved: state.credentials !== null, datasetCount }}
      sidebar={
        <ReportCatalog selectedReportId={state.selectedReportId} onSelect={selectReport} />
      }
    >
      <SessionOverview state={state} />
      <RunStatus queue={runQueue} />
      {activePanel === "credentials" && (
        <CredentialsPanel
          selectedReportId={state.selectedReportId}
          credentials={state.credentials}
          onSave={(credentials) => dispatch({ type: "credentials/set", credentials })}
        />
      )}
      {activePanel === "uploads" && <UploadsPanel onImported={importUploadedReport} />}
      {activePanel === "report" && (
        <ReportWorkspace
          reportId={state.selectedReportId}
          records={selectedReportRecords}
          onRun={queueSelectedReportRun}
        />
      )}
    </AppShell>
  );
}
