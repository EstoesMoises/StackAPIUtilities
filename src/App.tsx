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
import { ContentReplacementWizard } from "./components/ContentReplacementWizard";
import { WriteToolsCatalog, type WriteToolId } from "./components/WriteToolsCatalog";
import { UtilityCatalog } from "./components/UtilityCatalog";
import { validateCredentialsForReport, validateCredentialsForUtility } from "./credentials/credentialRules";
import { createDatasetSessionSnapshot, type PersistedDatasetSessionSnapshot } from "./domain/datasetPersistence";
import { getExpectedReportDatasetNames } from "./domain/reportDatasetRequirements";
import { DEFAULT_REPORT_RUN_SCOPE } from "./domain/reportScope";
import { reportRegistry } from "./domain/reportRegistry";
import { createInitialSessionState, sessionReducer } from "./domain/sessionStore";
import type {
  DatasetName,
  PeriodScope,
  ReportId,
  ReportRunProgress,
  ReportRunScope,
  RunPeriodRole,
  RunQueueItem,
  SessionCredentials,
  UtilityId,
} from "./domain/types";
import type { PersistedContentReplacementJob } from "./writeTools/contentReplacement/types";
import type { LiveReportRunResult } from "./collectors/liveReportRunner";
import { parseTerminalSmeCoverageResult } from "./utilities/smeCoverage/runtimeValidation";
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
  const [selectedContentReplacementJob, setSelectedContentReplacementJob] = useState<PersistedContentReplacementJob | null>(null);
  const [runQueue, setRunQueue] = useState<RunQueueItem[]>([]);
  const [runProgress, setRunProgress] = useState<ReportRunProgress | undefined>();
  const [reportScope, setReportScope] = useState(DEFAULT_REPORT_RUN_SCOPE);
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

  function openContentReplacementJob(job: PersistedContentReplacementJob) {
    clearActiveRunProgress();
    setSelectedContentReplacementJob(job);
    setSelectedWriteToolId("content-replacement");
    setCredentialContext({ kind: "write-tool", writeToolId: "content-replacement" });
    setActivePanel("write-tools");
  }

  function reconnectContentReplacementCredentials() {
    clearActiveRunProgress();
    setCredentialContext({ kind: "write-tool", writeToolId: "content-replacement" });
    setActivePanel("credentials");
  }

  function forgetDeletedContentReplacementJob(jobId: string) {
    setSelectedContentReplacementJob((current) => current?.id === jobId ? null : current);
  }

  function prepareSelectedReportRun() {
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
      return undefined;
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
      return undefined;
    }

    return report;
  }

  async function queueSelectedReportRun(periodRole: RunPeriodRole = "current") {
    const report = prepareSelectedReportRun();
    if (!report) return;

    await executeSelectedReportRuns(report, [periodRole]);
  }

  async function executeSelectedReportRuns(
    report: (typeof reportRegistry)[number],
    periodRoles: readonly RunPeriodRole[],
  ) {
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
      const stagedResults: LiveReportRunResult[] = [];
      for (const periodRole of periodRoles) {
        const configuredScope = periodRole === "comparison" ? reportScope.comparison ?? {} : reportScope.current;
        const periodScope = normalizePeriodScope(configuredScope);
        const response = await fetch("/api/reports/run", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            reportId: report.id,
            credentials: state.credentials,
            periodRole,
            scope: periodScope,
          }),
        });
        const body: unknown = await response.json();

        if (!isRecord(body) || body.ok !== true) {
          throw new Error(isRecord(body) && typeof body.error === "string" ? body.error : "Live API run failed.");
        }
        if (!isActiveRun(runId)) return;
        const expectedDatasets = getExpectedReportDatasetNames(report.id, report.requiredDatasets);
        if (!isValidReportRunResult(body.result, report.id, periodRole, periodScope, expectedDatasets)) {
          throw new Error("Report result did not match the complete requested run.");
        }
        stagedResults.push(body.result);
      }

      if (!isActiveRun(runId)) return;
      markDatasetContentChanged();
      for (const result of stagedResults) {
        dispatch({
          type: "live/loaded",
          reportId: result.reportId,
          periodRole: result.periodRole,
          scope: result.scope,
          warnings: result.warnings,
          datasets: result.datasets,
        });
      }
      setRunProgress(createSucceededProgress(report.title));
      setRunQueue([
        ...stagedResults.flatMap((result) => result.messages).map((message, index) => ({
          id: `${report.id}-live-dataset-${index}`,
          reportId: report.id,
          status: "succeeded" as const,
          message,
        })),
        {
          id: `${report.id}-live-complete`,
          reportId: report.id,
          status: "succeeded",
          message: `Live API run completed for ${report.title}.`,
        },
      ]);
      setActivePanel("report");
    } catch (error) {
      if (!isActiveRun(runId)) return;

      setRunProgress(createFailedProgress(report.title));
      setRunQueue([
        {
          id: `${report.id}-live-failed`,
          reportId: report.id,
          status: "failed",
          message: getLiveRunErrorMessage(error, report.title),
        },
      ]);
    }
  }

  async function queueBothReportRuns() {
    const report = prepareSelectedReportRun();
    if (!report || !reportScope.comparison) return;

    await executeSelectedReportRuns(report, ["current", "comparison"]);
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
        body: JSON.stringify({ credentials: state.credentials }),
      });
      const body: unknown = await response.json();

      if (!isActiveRun(runId)) {
        return;
      }

      if (!isRecord(body) || body.ok !== true) {
        const errorKind = isRecord(body) && isSmeCoverageErrorKind(body.kind) ? body.kind : "unexpected";
        setSmeCoverageRunState({
          status: "failed",
          kind: errorKind,
          stage: isRecord(body) && typeof body.stage === "string" ? body.stage : undefined,
          error: isRecord(body) && typeof body.error === "string"
            ? body.error
            : "SME Coverage Analyzer returned an invalid response. No complete result was produced.",
        });
        return;
      }

      const result = parseTerminalSmeCoverageResult(body.result);
      if (!result) {
        setSmeCoverageRunState({
          status: "failed",
          kind: "unexpected",
          error: "SME Coverage Analyzer returned an incomplete result. No complete result was produced.",
        });
        return;
      }

      markDatasetContentChanged();
      dispatch({ type: "utility/loaded", result });
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
  const sidebar = activePanel === "credentials" ? null : activePanel === "write-tools" ? (
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
          onChangeWorkflow={() => changeActivePanel(
            credentialContext.kind === "report"
              ? "report"
              : credentialContext.kind === "utility"
                ? "utilities"
                : "write-tools",
          )}
          onSave={(credentials) => dispatch({ type: "credentials/set", credentials })}
        />
      )}
      {activePanel === "uploads" && <UploadsPanel onImported={importUploadedReport} />}
      {activePanel === "datasets" && (
        <DatasetsPanel
          datasets={datasets}
          onRemoveDataset={removeDataset}
          onFlushDatasets={flushStoredDatasets}
          onOpenContentReplacementJob={openContentReplacementJob}
          onContentReplacementJobDeleted={forgetDeletedContentReplacementJob}
        />
      )}
      {activePanel === "write-tools" && renderWriteToolPanel(
        selectedWriteToolId,
        state.credentials,
        selectedContentReplacementJob,
        reconnectContentReplacementCredentials,
      )}
      {activePanel === "utilities" && (
        <SmeCoverageWorkspace
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
          datasetName={selectedReportOutput?.datasetName}
          currentSnapshotId={selectedReportOutput?.currentSnapshotId}
          comparisonSnapshotId={selectedReportOutput?.comparisonSnapshotId}
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

function renderWriteToolPanel(
  toolId: WriteToolId,
  credentials: SessionCredentials | null,
  contentReplacementJob: PersistedContentReplacementJob | null,
  onReconnectContentReplacement: () => void,
) {
  switch (toolId) {
    case "user-group-sync":
      return <UserGroupSyncPanel credentials={credentials} />;
    case "content-replacement":
      return (
        <ContentReplacementWizard
          credentials={credentials}
          initialJob={contentReplacementJob}
          onReconnect={onReconnectContentReplacement}
        />
      );
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

function isValidReportRunResult(
  value: unknown,
  reportId: ReportId,
  periodRole: RunPeriodRole,
  scope: PeriodScope,
  requiredDatasets: readonly DatasetName[],
): value is LiveReportRunResult {
  if (!isRecord(value)) return false;
  if (value.reportId !== reportId || value.periodRole !== periodRole || !hasExactScope(value.scope, scope)) {
    return false;
  }
  if (typeof value.reportTitle !== "string" || !isStringArray(value.messages) || !isReportWarningArray(value.warnings, reportId)) {
    return false;
  }
  if (!Array.isArray(value.datasets) || value.datasets.length !== requiredDatasets.length) return false;

  const seen = new Set<string>();
  for (const dataset of value.datasets) {
    if (!isRecord(dataset) || typeof dataset.datasetName !== "string") return false;
    if (!requiredDatasets.includes(dataset.datasetName as DatasetName) || seen.has(dataset.datasetName)) return false;
    seen.add(dataset.datasetName);
    if (!Array.isArray(dataset.records) || !dataset.records.every(isRecord)) return false;
    if (!isRecord(dataset.pagination)) return false;
    const { pageCount, reachedMaxPages, hasMore } = dataset.pagination;
    if (!Number.isInteger(pageCount) || (pageCount as number) < 0 || reachedMaxPages !== false || hasMore !== false) {
      return false;
    }
  }

  return requiredDatasets.every((datasetName) => seen.has(datasetName));
}

function normalizePeriodScope(scope: PeriodScope): PeriodScope {
  return {
    ...(typeof scope.startDate === "string" ? { startDate: scope.startDate } : {}),
    ...(typeof scope.endDate === "string" ? { endDate: scope.endDate } : {}),
  };
}

function hasExactScope(value: unknown, expected: PeriodScope): value is PeriodScope {
  if (!isRecord(value)) return false;
  const keys = Object.keys(value).sort();
  const expectedKeys = Object.keys(expected).sort();
  return (
    keys.length === expectedKeys.length &&
    keys.every((key, index) => key === expectedKeys[index]) &&
    keys.every((key) => (key === "startDate" || key === "endDate") && typeof value[key] === "string" && value[key] === expected[key])
  );
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isReportWarningArray(value: unknown, reportId: ReportId): boolean {
  return Array.isArray(value) && value.every((warning) => (
    isRecord(warning) &&
    typeof warning.code === "string" &&
    typeof warning.message === "string" &&
    (warning.reportId === undefined || warning.reportId === reportId) &&
    warning.utilityId === undefined
  ));
}

function isSmeCoverageErrorKind(value: unknown): value is NonNullable<SmeCoverageRunUiState["kind"]> {
  return value === "validation" || value === "collection" || value === "unsupported" || value === "unexpected";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
