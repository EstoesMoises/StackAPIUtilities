"use client";

import { useEffect, useReducer, useRef, useState } from "react";
import { AppShell, type AppPanel } from "./components/AppShell";
import { CredentialsPanel, type CredentialWorkflow } from "./components/CredentialsPanel";
import { DatasetsPanel } from "./components/DatasetsPanel";
import { ReportCatalog } from "./components/ReportCatalog";
import { ReportWorkspace } from "./components/ReportWorkspace";
import { RunStatus } from "./components/RunStatus";
import { SessionOverview } from "./components/SessionOverview";
import { SmeCoverageWorkspace, type SmeCoverageRunUiState } from "./components/SmeCoverageWorkspace";
import { UploadsPanel, type ImportedUploadResult } from "./components/UploadsPanel";
import { UserGroupSyncPanel } from "./components/UserGroupSyncPanel";
import { WriteToolsCatalog, type WriteToolId } from "./components/WriteToolsCatalog";
import { UtilityCatalog } from "./components/UtilityCatalog";
import { validateCredentialsForReport, validateCredentialsForUtility } from "./credentials/credentialRules";
import { createDatasetSessionSnapshot, type PersistedDatasetSessionSnapshot } from "./domain/datasetPersistence";
import { DEFAULT_REPORT_RUN_SCOPE } from "./domain/reportScope";
import { reportRegistry } from "./domain/reportRegistry";
import { createInitialSessionState, sessionReducer } from "./domain/sessionStore";
import type {
  ReportId,
  ReportRunProgress,
  ReportRunScope,
  RunPeriodRole,
  RunQueueItem,
  SessionCredentials,
  UtilityId,
} from "./domain/types";
import type { ReportRunResponseBody } from "./server/reportRunApi";
import type { SmeCoverageRunResponseBody } from "./server/smeCoverageRunApi";
import { DEFAULT_SME_COVERAGE_SETTINGS } from "./utilities/smeCoverage/settings";
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
  const [smeCoverageSettings, setSmeCoverageSettings] = useState(DEFAULT_SME_COVERAGE_SETTINGS);
  const [smeCoverageRunState, setSmeCoverageRunState] = useState<SmeCoverageRunUiState>({ status: "idle" });
  const [credentialContext, setCredentialContext] = useState<CredentialWorkflow>({
    kind: "report",
    reportId: "tag-report",
  });
  const [datasetStorageReady, setDatasetStorageReady] = useState(false);
  const [datasetStorageWarning, setDatasetStorageWarning] = useState<string | null>(null);
  const datasetContentRevisionRef = useRef(0);
  const reportSelectionRevisionRef = useRef(0);
  const utilitySelectionRevisionRef = useRef(0);
  const reportScopeRevisionRef = useRef(0);
  const mountedRef = useRef(false);
  const persistenceQueueRef = useRef(Promise.resolve());
  const persistenceSequenceRef = useRef(0);
  const selectedReportsRef = useRef({
    selectedReportId: state.selectedReportId,
    selectedReportIds: state.selectedReportIds,
  });
  const selectedUtilityRef = useRef(state.selectedUtilityId);
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

  function markUtilitySelectionChanged(utilityId: UtilityId) {
    utilitySelectionRevisionRef.current += 1;
    selectedUtilityRef.current = utilityId;
  }

  function updateReportScope(nextScope: ReportRunScope) {
    reportScopeRevisionRef.current += 1;
    setReportScope(nextScope);
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
    selectedUtilityRef.current = state.selectedUtilityId;
  }, [state.selectedUtilityId]);

  useEffect(() => {
    let active = true;
    const hydrationContentRevision = datasetContentRevisionRef.current;
    const hydrationSelectionRevision = reportSelectionRevisionRef.current;
    const hydrationUtilitySelectionRevision = utilitySelectionRevisionRef.current;
    const hydrationReportScopeRevision = reportScopeRevisionRef.current;
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
            reportSelectionRevisionRef.current !== hydrationSelectionRevision ||
            utilitySelectionRevisionRef.current !== hydrationUtilitySelectionRevision
              ? {
                  ...selectedReportsRef.current,
                  selectedUtilityId: selectedUtilityRef.current,
                }
              : undefined,
        });
        if (
          reportSelectionRevisionRef.current === hydrationSelectionRevision &&
          reportScopeRevisionRef.current === hydrationReportScopeRevision
        ) {
          setReportScope((currentScope) => restoreReportScopeFromSnapshot(currentScope, snapshot));
        }
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

    const hasPersistentContent =
      Object.keys(state.datasets).length > 0 || Object.keys(state.utilityOutputs).length > 0;

    if (!hasPersistentContent && suppressNextEmptyClearRef.current) {
      suppressNextEmptyClearRef.current = false;
      return;
    }
    if (hasPersistentContent) {
      suppressNextEmptyClearRef.current = false;
    }

    const sequence = persistenceSequenceRef.current + 1;
    persistenceSequenceRef.current = sequence;
    const persist = () => hasPersistentContent
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
    state.selectedUtilityId,
    state.utilityOutputs,
    state.utilityRunSnapshots,
    state.warnings,
  ]);

  function selectReport(reportId: ReportId) {
    markReportSelectionChanged(reportId);
    clearActiveRunProgress();
    setCredentialContext({ kind: "report", reportId });
    dispatch({ type: "report/select", reportId });
    setActivePanel("report");
  }

  function selectUtility(utilityId: UtilityId) {
    markUtilitySelectionChanged(utilityId);
    clearActiveRunProgress();
    setCredentialContext({ kind: "utility", utilityId });
    dispatch({ type: "utility/select", utilityId });
    setActivePanel("utilities");
  }

  function changeActivePanel(panel: AppPanel) {
    if (panel === "report") {
      if (credentialContext.kind !== "report") {
        clearActiveRunProgress();
      }
      setCredentialContext({ kind: "report", reportId: state.selectedReportId });
    } else if (panel === "utilities") {
      if (credentialContext.kind !== "utility") {
        clearActiveRunProgress();
      }
      setCredentialContext({ kind: "utility", utilityId: state.selectedUtilityId });
    } else if (panel === "write-tools") {
      if (
        credentialContext.kind !== "write-tool" ||
        credentialContext.writeToolId !== selectedWriteToolId
      ) {
        clearActiveRunProgress();
      }
      setCredentialContext({ kind: "write-tool", writeToolId: selectedWriteToolId });
    }

    setActivePanel(panel);
  }

  function selectWriteTool(toolId: WriteToolId) {
    if (credentialContext.kind !== "write-tool" || credentialContext.writeToolId !== toolId) {
      clearActiveRunProgress();
    }
    setCredentialContext({ kind: "write-tool", writeToolId: toolId });
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
        message: `Collecting all available data for ${report.title}…`,
      },
    ]);
    const runId = startActiveRun();
    setRunProgress(createRunningProgress(report.title));

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

  async function queueSmeCoverageRun() {
    const utilityId = state.selectedUtilityId;
    const workflow = { kind: "utility", utilityId } as const;
    setCredentialContext(workflow);

    if (!state.credentials) {
      clearActiveRunProgress();
      setSmeCoverageRunState({
        status: "failed",
        kind: "validation",
        error: "Add session credentials before running SME Coverage Analyzer.",
      });
      setRunQueue([
        {
          id: `${utilityId}-missing-credentials`,
          reportId: state.selectedReportId,
          status: "queued",
          message: "Add session credentials before running SME Coverage Analyzer.",
        },
      ]);
      setActivePanel("credentials");
      return;
    }

    const validation = validateCredentialsForUtility(utilityId, state.credentials);
    if (!validation.valid) {
      clearActiveRunProgress();
      const error = validation.messages.join(" ");
      setSmeCoverageRunState({ status: "failed", kind: "validation", error });
      setRunQueue(
        validation.messages.map((message, index) => ({
          id: `${utilityId}-credential-error-${index}`,
          reportId: state.selectedReportId,
          status: "failed" as const,
          message,
        })),
      );
      setActivePanel("credentials");
      return;
    }

    const runId = startActiveRun();
    setRunQueue([]);
    setRunProgress(undefined);
    setSmeCoverageRunState({ status: "running" });

    try {
      const response = await fetch("/api/utilities/sme-coverage/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          credentials: state.credentials,
          pageSize: smeCoverageSettings.pageSize,
          maxPagesPerDataset: smeCoverageSettings.maxPagesPerDataset,
          ...(smeCoverageSettings.runPreset ? { runPreset: smeCoverageSettings.runPreset } : {}),
        }),
      });
      const body = (await response.json()) as SmeCoverageRunResponseBody;

      if (!isActiveRun(runId)) {
        return;
      }

      if (!body.ok) {
        setSmeCoverageRunState({
          status: "failed",
          kind: body.kind,
          stage: body.stage,
          error: body.error,
        });
        return;
      }

      markDatasetContentChanged();
      dispatch({ type: "utility/loaded", result: body.result });
      setSmeCoverageRunState({ status: "succeeded" });
      setActivePanel("utilities");
    } catch {
      if (isActiveRun(runId)) {
        setSmeCoverageRunState({
          status: "failed",
          kind: "unexpected",
          error: "SME Coverage Analyzer could not complete the live API run. Try again.",
        });
      }
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
    setSmeCoverageRunState({ status: "idle" });
  }

  function isActiveRun(runId: number) {
    return activeRunIdRef.current === runId;
  }

  const selectedReportOutput = state.reportOutputs[state.selectedReportId];
  const selectedUtilityOutput = state.utilityOutputs[state.selectedUtilityId];
  const selectedReportRecords = selectedReportOutput?.records ?? [];
  const datasets = Object.values(state.datasets);
  const datasetCount = datasets.length;
  const sidebar = activePanel === "write-tools" ? (
      <WriteToolsCatalog selectedToolId={selectedWriteToolId} onSelect={selectWriteTool} />
    ) : activePanel === "utilities" ? (
      <UtilityCatalog selectedUtilityId={state.selectedUtilityId} onSelect={selectUtility} />
    ) : activePanel === "report" ? (
      <ReportCatalog selectedReportId={state.selectedReportId} onSelect={selectReport} />
    ) : credentialContext.kind === "utility" ? (
      <UtilityCatalog selectedUtilityId={state.selectedUtilityId} onSelect={selectUtility} />
    ) : credentialContext.kind === "write-tool" ? (
      <WriteToolsCatalog selectedToolId={selectedWriteToolId} onSelect={selectWriteTool} />
    ) : (
      <ReportCatalog selectedReportId={state.selectedReportId} onSelect={selectReport} />
    );

  return (
    <AppShell
      activePanel={activePanel}
      onPanelChange={changeActivePanel}
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
          workflow={credentialContext}
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
      {activePanel === "utilities" && (
        <SmeCoverageWorkspace
          settings={smeCoverageSettings}
          onSettingsChange={setSmeCoverageSettings}
          onRun={queueSmeCoverageRun}
          runState={smeCoverageRunState}
          decisionPack={selectedUtilityOutput?.decisionPack}
        />
      )}
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
          onScopeChange={updateReportScope}
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

function restoreReportScopeFromSnapshot(
  currentScope: ReportRunScope,
  snapshot: PersistedDatasetSessionSnapshot,
): ReportRunScope {
  const selectedRunSnapshots = findSelectedReportRunSnapshots(snapshot);
  const runSnapshot =
    selectedRunSnapshots.current ??
    selectedRunSnapshots.comparison ??
    findLatestSelectedReportRunSnapshot(snapshot);

  if (!runSnapshot) {
    return currentScope;
  }

  return {
    ...currentScope,
    current:
      selectedRunSnapshots.current?.scope ??
      (runSnapshot.periodRole === "current" ? runSnapshot.scope : currentScope.current),
    comparison:
      selectedRunSnapshots.comparison?.scope ??
      (runSnapshot.periodRole === "comparison" ? runSnapshot.scope : currentScope.comparison),
  };
}

function findSelectedReportRunSnapshots(snapshot: PersistedDatasetSessionSnapshot) {
  const selectedOutput = snapshot.reportOutputs[snapshot.selectedReportId];

  return {
    current: findReportRunSnapshotById(snapshot, selectedOutput?.currentSnapshotId),
    comparison: findReportRunSnapshotById(snapshot, selectedOutput?.comparisonSnapshotId),
  };
}

function findReportRunSnapshotById(snapshot: PersistedDatasetSessionSnapshot, snapshotId: string | undefined) {
  if (!snapshotId) {
    return undefined;
  }

  return snapshot.reportRunSnapshots.find((runSnapshot) => runSnapshot.id === snapshotId);
}

function findLatestSelectedReportRunSnapshot(snapshot: PersistedDatasetSessionSnapshot) {
  return [...snapshot.reportRunSnapshots]
    .reverse()
    .find((runSnapshot) => runSnapshot.reportId === snapshot.selectedReportId);
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
  const message = error instanceof Error ? error.message : "Live API run failed.";
  const completionDisclaimer = "No complete result was produced.";
  const messageWithoutDisclaimer = message.split(completionDisclaimer).join("").trim();

  return messageWithoutDisclaimer === ""
    ? completionDisclaimer
    : `${messageWithoutDisclaimer} ${completionDisclaimer}`;
}
