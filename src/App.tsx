"use client";

import { useReducer, useState } from "react";
import { AppShell, type AppPanel } from "./components/AppShell";
import { CredentialsPanel } from "./components/CredentialsPanel";
import { DatasetsPanel } from "./components/DatasetsPanel";
import { ReportCatalog } from "./components/ReportCatalog";
import { ReportWorkspace } from "./components/ReportWorkspace";
import { RunStatus } from "./components/RunStatus";
import { SessionOverview } from "./components/SessionOverview";
import { UploadsPanel, type ImportedUploadResult } from "./components/UploadsPanel";
import { validateCredentialsForReport } from "./credentials/credentialRules";
import { DEFAULT_REPORT_RUN_SCOPE } from "./domain/reportScope";
import { reportRegistry } from "./domain/reportRegistry";
import { createInitialSessionState, sessionReducer } from "./domain/sessionStore";
import type { ReportId, RunPeriodRole, RunQueueItem } from "./domain/types";
import type { ReportRunResponseBody } from "./server/reportRunApi";

export function App() {
  const [state, dispatch] = useReducer(sessionReducer, undefined, createInitialSessionState);
  const [activePanel, setActivePanel] = useState<AppPanel>("report");
  const [runQueue, setRunQueue] = useState<RunQueueItem[]>([]);
  const [reportScope, setReportScope] = useState(DEFAULT_REPORT_RUN_SCOPE);

  function selectReport(reportId: ReportId) {
    dispatch({ type: "report/select", reportId });
    setActivePanel("report");
  }

  async function queueSelectedReportRun(periodRole: RunPeriodRole = "current") {
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
        id: `${state.selectedReportId}-live-running`,
        reportId: state.selectedReportId,
        status: "running",
        message: `Running ${report.title} ${periodRole} period live API collection...`,
      },
    ]);

    try {
      const periodScope = periodRole === "comparison" ? reportScope.comparison ?? {} : reportScope.current;
      const response = await fetch("/api/reports/run", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          reportId: state.selectedReportId,
          credentials: state.credentials,
          periodRole,
          scope: periodScope,
          pageSize: reportScope.pageSize,
          maxPagesPerDataset: reportScope.maxPagesPerDataset,
        }),
      });
      const body = (await response.json()) as ReportRunResponseBody;

      if (!body.ok) {
        throw new Error(body.error);
      }

      const result = body.result;
      dispatch({
        type: "live/loaded",
        reportId: result.reportId,
        periodRole: result.periodRole,
        scope: result.scope,
        pageSize: result.pageSize,
        maxPagesPerDataset: result.maxPagesPerDataset,
        warnings: result.warnings,
        datasets: result.datasets,
      });
      setRunQueue([
        ...result.messages.map((message, index) => ({
          id: `${state.selectedReportId}-live-dataset-${index}`,
          reportId: state.selectedReportId,
          status: "succeeded" as const,
          message,
        })),
        {
          id: `${state.selectedReportId}-live-complete`,
          reportId: state.selectedReportId,
          status: "succeeded",
          message: `Live API run completed for ${report.title}.`,
        },
      ]);
      setActivePanel("report");
    } catch (error) {
      setRunQueue([
        {
          id: `${state.selectedReportId}-live-failed`,
          reportId: state.selectedReportId,
          status: "failed",
          message: getLiveRunErrorMessage(error, report.title),
        },
      ]);
    }
  }

  async function queueBothReportRuns() {
    await queueSelectedReportRun("current");
    if (reportScope.comparison) {
      await queueSelectedReportRun("comparison");
    }
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

  const selectedReportOutput = state.reportOutputs[state.selectedReportId];
  const selectedReportRecords = selectedReportOutput?.records ?? [];
  const datasets = Object.values(state.datasets);
  const datasetCount = datasets.length;

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
      {activePanel === "datasets" && (
        <DatasetsPanel
          datasets={datasets}
          onRemoveDataset={(datasetId) => dispatch({ type: "dataset/remove", datasetId })}
        />
      )}
      {activePanel === "report" && (
        <ReportWorkspace
          reportId={state.selectedReportId}
          records={selectedReportRecords}
          comparisonRecords={selectedReportOutput?.comparisonRecords}
          currentScope={selectedReportOutput?.currentScope}
          comparisonScope={selectedReportOutput?.comparisonScope}
          outputSource={selectedReportOutput?.source}
          scope={reportScope}
          onScopeChange={setReportScope}
          onRun={queueSelectedReportRun}
          onRunBoth={queueBothReportRuns}
        />
      )}
    </AppShell>
  );
}

function getLiveRunErrorMessage(error: unknown, _reportTitle: string): string {
  if (error instanceof Error) {
    return error.message;
  }

  return "Live API run failed.";
}
