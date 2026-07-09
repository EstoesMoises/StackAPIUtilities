"use client";

import { useEffect, useReducer, useRef, useState } from "react";
import { AppShell, type AppPanel } from "./components/AppShell";
import { CredentialsPanel } from "./components/CredentialsPanel";
import { DatasetsPanel } from "./components/DatasetsPanel";
import { ReportCatalog } from "./components/ReportCatalog";
import { ReportWorkspace } from "./components/ReportWorkspace";
import { RunStatus } from "./components/RunStatus";
import { SessionOverview } from "./components/SessionOverview";
import { UploadsPanel, type ImportedUploadResult } from "./components/UploadsPanel";
import { UserGroupSyncPanel } from "./components/UserGroupSyncPanel";
import { WriteToolsCatalog, type WriteToolId } from "./components/WriteToolsCatalog";
import { validateCredentialsForReport } from "./credentials/credentialRules";
import { createDatasetSessionSnapshot } from "./domain/datasetPersistence";
import { DEFAULT_REPORT_RUN_SCOPE } from "./domain/reportScope";
import { reportRegistry } from "./domain/reportRegistry";
import { createInitialSessionState, sessionReducer } from "./domain/sessionStore";
import type { ReportId, ReportRunProgress, RunPeriodRole, RunQueueItem, SessionCredentials } from "./domain/types";
import type { ReportRunResponseBody } from "./server/reportRunApi";
import {
  clearPersistedDatasetSession,
  loadPersistedDatasetSession,
  savePersistedDatasetSession,
} from "./utils/browserDatasetStorage";

const REPORT_RUN_STAGES = [
  "Validate credentials",
  "Plan required datasets",
  "Collecting live API datasets",
  "Build report output",
] as const;

export function App() {
  const [state, dispatch] = useReducer(sessionReducer, undefined, createInitialSessionState);
  const [activePanel, setActivePanel] = useState<AppPanel>("report");
  const [selectedWriteToolId, setSelectedWriteToolId] = useState<WriteToolId>("user-group-sync");
  const [runQueue, setRunQueue] = useState<RunQueueItem[]>([]);
  const [runProgress, setRunProgress] = useState<ReportRunProgress | undefined>();
  const [reportScope, setReportScope] = useState(DEFAULT_REPORT_RUN_SCOPE);
  const [datasetStorageReady, setDatasetStorageReady] = useState(false);
  const [datasetStorageWarning, setDatasetStorageWarning] = useState<string | null>(null);
  const datasetContentRevisionRef = useRef(0);
  const reportSelectionRevisionRef = useRef(0);
  const mountedRef = useRef(false);
  const persistenceQueueRef = useRef(Promise.resolve());
  const persistenceSequenceRef = useRef(0);
  const selectedReportsRef = useRef({
    selectedReportId: state.selectedReportId,
    selectedReportIds: state.selectedReportIds,
  });
  const suppressNextEmptyClearRef = useRef(false);
  const explicitEmptyRevisionRef = useRef(0);
  const activeRunIdRef = useRef(0);

  function markDatasetContentChanged() {
    datasetContentRevisionRef.current += 1;
  }

  function markReportSelectionChanged(reportId: ReportId) {
    reportSelectionRevisionRef.current += 1;
    selectedReportsRef.current = {
      selectedReportId: reportId,
      selectedReportIds: [reportId],
    };
  }

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    selectedReportsRef.current = {
      selectedReportId: state.selectedReportId,
      selectedReportIds: state.selectedReportIds,
    };
  }, [state.selectedReportId, state.selectedReportIds]);

  useEffect(() => {
    let active = true;
    const hydrationContentRevision = datasetContentRevisionRef.current;
    const hydrationSelectionRevision = reportSelectionRevisionRef.current;
    const hydrationEmptyRevision = explicitEmptyRevisionRef.current;

    loadPersistedDatasetSession()
      .then((snapshot) => {
        if (!active) {
          return;
        }

        if (!snapshot) {
          return;
        }

        if (datasetContentRevisionRef.current !== hydrationContentRevision) {
          if (explicitEmptyRevisionRef.current === hydrationEmptyRevision) {
            suppressNextEmptyClearRef.current = true;
          }
          return;
        }

        dispatch({
          type: "session/hydratePersistentDatasets",
          snapshot,
          preserveSelection:
            reportSelectionRevisionRef.current !== hydrationSelectionRevision
              ? selectedReportsRef.current
              : undefined,
        });
      })
      .catch(() => {
        if (active && mountedRef.current) {
          setDatasetStorageWarning(
            "Datasets could not be restored from browser storage. Current session data will still work.",
          );
        }
      })
      .finally(() => {
        if (active) {
          setDatasetStorageReady(true);
        }
      });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!datasetStorageReady) {
      return;
    }

    const hasDatasets = Object.keys(state.datasets).length > 0;

    if (!hasDatasets && suppressNextEmptyClearRef.current) {
      suppressNextEmptyClearRef.current = false;
      return;
    }
    if (hasDatasets) {
      suppressNextEmptyClearRef.current = false;
    }

    const sequence = persistenceSequenceRef.current + 1;
    persistenceSequenceRef.current = sequence;
    const persist = () => hasDatasets
      ? savePersistedDatasetSession(createDatasetSessionSnapshot(state))
      : clearPersistedDatasetSession();

    persistenceQueueRef.current = persistenceQueueRef.current
      .catch(() => undefined)
      .then(() => persist())
      .catch(() => {
        if (mountedRef.current && sequence === persistenceSequenceRef.current) {
          setDatasetStorageWarning(
            "Dataset changes could not be stored in this browser. Current session data will still work.",
          );
        }
      });
  }, [
    datasetStorageReady,
    state.datasets,
    state.reportOutputs,
    state.reportRunSnapshots,
    state.selectedReportId,
    state.selectedReportIds,
    state.warnings,
  ]);

  function selectReport(reportId: ReportId) {
    markReportSelectionChanged(reportId);
    clearActiveRunProgress();
    dispatch({ type: "report/select", reportId });
    setActivePanel("report");
  }

  function selectWriteTool(toolId: WriteToolId) {
    setSelectedWriteToolId(toolId);
    setActivePanel("write-tools");
  }

  async function queueSelectedReportRun(periodRole: RunPeriodRole = "current") {
    const report = reportRegistry.find((candidate) => candidate.id === state.selectedReportId)!;
    if (!state.credentials) {
      clearActiveRunProgress();
      setRunQueue([
        {
          id: `${state.selectedReportId}-missing-credentials`,
          reportId: state.selectedReportId,
          status: "queued",
          message: `Add session credentials before running ${report.title}.`,
        },
      ]);
      setActivePanel("credentials");
      return false;
    }

    const validation = validateCredentialsForReport(state.selectedReportId, state.credentials);
    if (!validation.valid) {
      clearActiveRunProgress();
      setRunQueue(
        validation.messages.map((message, index) => ({
          id: `${state.selectedReportId}-credential-error-${index}`,
          reportId: state.selectedReportId,
          status: "failed",
          message,
        })),
      );
      setActivePanel("credentials");
      return false;
    }

    setRunQueue([
      {
        id: `${state.selectedReportId}-live-running`,
        reportId: state.selectedReportId,
        status: "running",
        message: `Running ${report.title} ${periodRole} period live API collection...`,
      },
    ]);
    const runId = startActiveRun();
    setRunProgress(createRunningProgress(report.title));

    try {
      const periodScope = periodRole === "comparison" ? reportScope.comparison ?? {} : reportScope.current;
      const runPreset = state.selectedReportId === "tag-report" ? reportScope.runPreset : undefined;
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
          runPreset,
        }),
      });
      const body = (await response.json()) as ReportRunResponseBody;

      if (!body.ok) {
        throw new Error(body.error);
      }

      if (!isActiveRun(runId)) {
        return false;
      }

      const result = body.result;
      markDatasetContentChanged();
      dispatch({
        type: "live/loaded",
        reportId: result.reportId,
        periodRole: result.periodRole,
        scope: result.scope,
        pageSize: result.pageSize,
        maxPagesPerDataset: result.maxPagesPerDataset,
        runPreset: result.runPreset,
        warnings: result.warnings,
        datasets: result.datasets,
      });
      setRunProgress(createSucceededProgress(report.title));
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
      return true;
    } catch (error) {
      if (!isActiveRun(runId)) {
        return false;
      }

      setRunProgress(createFailedProgress(report.title));
      setRunQueue([
        {
          id: `${state.selectedReportId}-live-failed`,
          reportId: state.selectedReportId,
          status: "failed",
          message: getLiveRunErrorMessage(error, report.title),
        },
      ]);
      return true;
    }
  }

  async function queueBothReportRuns() {
    const currentRunHandled = await queueSelectedReportRun("current");
    if (currentRunHandled && reportScope.comparison) {
      await queueSelectedReportRun("comparison");
    }
  }

  function importUploadedReport(result: ImportedUploadResult) {
    const report = reportRegistry.find((candidate) => candidate.id === result.reportId)!;

    markDatasetContentChanged();
    clearActiveRunProgress();
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

  function removeDataset(datasetId: string) {
    markDatasetContentChanged();
    if (state.datasets[datasetId] && Object.keys(state.datasets).length === 1) {
      explicitEmptyRevisionRef.current += 1;
    }
    dispatch({ type: "dataset/remove", datasetId });
  }

  function flushStoredDatasets() {
    markDatasetContentChanged();
    explicitEmptyRevisionRef.current += 1;
    dispatch({ type: "datasets/flush" });
    clearActiveRunProgress();
  }

  function startActiveRun() {
    activeRunIdRef.current += 1;
    return activeRunIdRef.current;
  }

  function clearActiveRunProgress() {
    activeRunIdRef.current += 1;
    setRunProgress(undefined);
    setRunQueue([]);
  }

  function isActiveRun(runId: number) {
    return activeRunIdRef.current === runId;
  }

  const selectedReportOutput = state.reportOutputs[state.selectedReportId];
  const selectedReportRecords = selectedReportOutput?.records ?? [];
  const datasets = Object.values(state.datasets);
  const datasetCount = datasets.length;
  const sidebar =
    activePanel === "write-tools" ? (
      <WriteToolsCatalog selectedToolId={selectedWriteToolId} onSelect={selectWriteTool} />
    ) : (
      <ReportCatalog selectedReportId={state.selectedReportId} onSelect={selectReport} />
    );

  return (
    <AppShell
      activePanel={activePanel}
      onPanelChange={setActivePanel}
      summary={{ credentialsSaved: state.credentials !== null, datasetCount }}
      sidebar={sidebar}
    >
      <SessionOverview state={state} />
      <RunStatus queue={runQueue} progress={runProgress} />
      {datasetStorageWarning && (
        <div className="s-notice s-notice__warning mt16" role="status">
          {datasetStorageWarning}
        </div>
      )}
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
          onRemoveDataset={removeDataset}
          onFlushDatasets={flushStoredDatasets}
        />
      )}
      {activePanel === "write-tools" && renderWriteToolPanel(selectedWriteToolId, state.credentials)}
      {activePanel === "report" && (
        <ReportWorkspace
          reportId={state.selectedReportId}
          records={selectedReportRecords}
          comparisonRecords={selectedReportOutput?.comparisonRecords}
          loadedAt={selectedReportOutput?.loadedAt}
          currentScope={selectedReportOutput?.currentScope}
          comparisonScope={selectedReportOutput?.comparisonScope}
          outputSource={selectedReportOutput?.source}
          warnings={selectedReportOutput?.warnings}
          scope={reportScope}
          onScopeChange={setReportScope}
          onRun={queueSelectedReportRun}
          onRunBoth={queueBothReportRuns}
        />
      )}
    </AppShell>
  );
}

function createRunningProgress(reportTitle: string): ReportRunProgress {
  return {
    reportTitle,
    status: "running",
    currentStage: "Collecting live API datasets",
    completedStages: [REPORT_RUN_STAGES[0], REPORT_RUN_STAGES[1]],
    totalStages: REPORT_RUN_STAGES.length,
  };
}

function createSucceededProgress(reportTitle: string): ReportRunProgress {
  return {
    reportTitle,
    status: "succeeded",
    currentStage: "Build report output",
    completedStages: [...REPORT_RUN_STAGES],
    totalStages: REPORT_RUN_STAGES.length,
  };
}

function createFailedProgress(reportTitle: string): ReportRunProgress {
  return {
    reportTitle,
    status: "failed",
    currentStage: "Live API run failed",
    completedStages: [REPORT_RUN_STAGES[0], REPORT_RUN_STAGES[1]],
    totalStages: REPORT_RUN_STAGES.length,
  };
}

function renderWriteToolPanel(toolId: WriteToolId, credentials: SessionCredentials | null) {
  switch (toolId) {
    case "user-group-sync":
      return <UserGroupSyncPanel credentials={credentials} />;
  }

  const unhandledToolId: never = toolId;
  return unhandledToolId;
}

function getLiveRunErrorMessage(error: unknown, _reportTitle: string): string {
  if (error instanceof Error) {
    return error.message;
  }

  return "Live API run failed.";
}
