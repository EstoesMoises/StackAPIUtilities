import { useEffect, useMemo, useRef, useState } from "react";
import type { ContentReplacementJobController } from "../hooks/useContentReplacementJob";
import {
  downloadReplacementExceptions,
  downloadReplacementResults,
} from "../utils/contentReplacementDownloads";
import {
  replacementItemKey,
  summarizeReplacementJob,
} from "../writeTools/contentReplacement/jobState";
import type {
  PersistedContentReplacementItem,
  PersistedContentReplacementJob,
} from "../writeTools/contentReplacement/types";

const PAGE_SIZE = 50;
const RECOVERY_PAGE_SIZE = 25;

type ResultFilter =
  | "all"
  | "updated"
  | "already-applied"
  | "excluded"
  | "stale"
  | "permission"
  | "validation"
  | "network-api"
  | "recovered"
  | "recovery-conflict"
  | "recovery-failed";

export interface ContentReplacementApplyStepProps {
  controller: ContentReplacementJobController;
}

export function ContentReplacementApplyStep({ controller }: ContentReplacementApplyStepProps) {
  const job = controller.job;
  if (!job) return <section><p>No content replacement job is available.</p></section>;
  return <ContentReplacementApplyStepView controller={controller} job={job} />;
}

function ContentReplacementApplyStepView({
  controller,
  job,
}: {
  controller: ContentReplacementJobController;
  job: PersistedContentReplacementJob;
}) {
  const [applyAcknowledged, setApplyAcknowledged] = useState(false);
  const [applyConfirmation, setApplyConfirmation] = useState("");
  const [recoveryAcknowledged, setRecoveryAcknowledged] = useState(false);
  const [recoveryConfirmation, setRecoveryConfirmation] = useState("");
  const [recoverySelection, setRecoverySelection] = useState<Record<string, boolean>>({});
  const [resultFilter, setResultFilter] = useState<ResultFilter>("all");
  const [resultSearch, setResultSearch] = useState("");
  const [page, setPage] = useState(1);
  const [deleteConfirmation, setDeleteConfirmation] = useState<"snapshots" | "job" | null>(null);
  const [actionPending, setActionPending] = useState(false);
  const confirmationKey = applyScopeKey(job);
  const previousConfirmationKey = useRef(confirmationKey);
  const previewKey = recoveryPreviewKey(job);
  const previousPreviewKey = useRef(previewKey);

  useEffect(() => {
    if (previousConfirmationKey.current === confirmationKey) return;
    previousConfirmationKey.current = confirmationKey;
    setApplyAcknowledged(false);
    setApplyConfirmation("");
  }, [confirmationKey]);

  useEffect(() => {
    if (previousPreviewKey.current === previewKey) return;
    previousPreviewKey.current = previewKey;
    setRecoveryAcknowledged(false);
    setRecoveryConfirmation("");
  }, [previewKey]);

  const entries = useMemo(
    () => Object.entries(job.proposals).sort(compareEntries),
    [job.proposals],
  );
  const items = entries.map(([, item]) => item);
  const summary = summarizeReplacementJob(job);
  const selectedByKind = countSelectedByKind(entries);
  const applyStarted = entries.some(([, item]) => item.attemptCount > 0 || isApplyTerminal(item));
  const runningApply = job.stage === "apply" && job.status === "running";
  const pausedApply = job.stage === "apply" && job.status === "paused" && applyStarted;
  const showConfirmation = job.stage === "apply" && !runningApply && !applyStarted;
  const recoveryReady = job.recoverySnapshotStatus === "ready" &&
    entries.filter(([, item]) => item.included).every(([, item]) => completeRecoverySnapshot(item));
  const canApply = showConfirmation && recoveryReady && applyAcknowledged &&
    applyConfirmation === "APPLY" && summary.selectedItems > 0 && !controller.busy &&
    !controller.storageError && !controller.operationError;
  const applyRemaining = entries.filter(([, item]) =>
    item.included && (item.status === "ready-to-apply" || item.status === "applying")
  ).length;
  const liveStaleCount = entries.filter(([, item]) => item.status === "stale").length;
  const liveRateLimitedCount = entries.filter(([, item]) =>
    item.status === "failed" && item.failure?.category === "rate-limit"
  ).length;
  const liveFailedCount = entries.filter(([, item]) =>
    item.status === "failed" && item.failure?.category !== "rate-limit"
  ).length;
  const applyingEntry = entries.find(([, item]) => item.status === "applying");

  const successfulEntries = entries.filter(([, item]) => hasObservedApplySuccess(item));
  const selectedRecoveryEntries = successfulEntries.filter(([key]) => recoverySelection[key] !== false);
  const previewedEntries = selectedRecoveryEntries.filter(([, item]) => item.recovery?.preview);
  const recoverableEntries = previewedEntries.filter(([, item]) =>
    item.status === "ready-to-recover" && item.recovery?.preview?.status === "recoverable"
  );
  const previewComplete = selectedRecoveryEntries.length > 0 &&
    previewedEntries.length === selectedRecoveryEntries.length && !job.activeOperation;
  const canRecover = previewComplete && recoverableEntries.length > 0 && recoveryAcknowledged &&
    recoveryConfirmation === "RECOVER" && !controller.busy && !controller.storageError;

  const filteredEntries = entries.filter(([key, item]) =>
    matchesResultFilter(item, resultFilter) && matchesSearch(key, item, resultSearch)
  );
  const pageCount = Math.max(1, Math.ceil(filteredEntries.length / PAGE_SIZE));
  const boundedPage = Math.min(page, pageCount);
  const pageEntries = filteredEntries.slice((boundedPage - 1) * PAGE_SIZE, boundedPage * PAGE_SIZE);
  const eligibleFailureCount = entries.filter(([, item]) => item.status === "failed" && item.failure?.retryable).length;
  const staleKeys = entries.filter(([, item]) => item.status === "stale").map(([key]) => key);

  async function runAction(action: () => Promise<void>) {
    if (actionPending) return;
    setActionPending(true);
    try {
      await action();
    } finally {
      setActionPending(false);
    }
  }

  async function confirmDeletion(kind: "snapshots" | "job") {
    await runAction(kind === "snapshots" ? controller.deleteRecoverySnapshots : controller.deleteJob);
    setDeleteConfirmation(null);
  }

  return (
    <section className="content-replacement-apply" aria-labelledby="content-replacement-apply-heading">
      {showConfirmation && (
        <>
          <header className="content-replacement-step-header">
            <h2 id="content-replacement-apply-heading">Confirm reviewed changes</h2>
            <p>The reviewed configuration and proposals are now immutable. Applying performs live writes.</p>
          </header>
          <ApplyScopeSummary job={job} selectedByKind={selectedByKind} recoveryReady={recoveryReady} />
          {(controller.storageError || controller.operationError) && (
            <div className="s-notice s-notice__danger" role="alert">
              <strong>Apply is blocked.</strong> {controller.storageError ?? controller.operationError}
            </div>
          )}
          <fieldset className="content-replacement-confirmation">
            <legend>Live write confirmation</legend>
            <label>
              <input
                type="checkbox"
                checked={applyAcknowledged}
                onChange={(event) => setApplyAcknowledged(event.currentTarget.checked)}
              />{" "}
              I understand these edits use the live Enterprise API, are not one transaction, and may partially complete.
            </label>
            <label>
              <span>Type APPLY to confirm</span>
              <input
                className="s-input"
                value={applyConfirmation}
                autoComplete="off"
                spellCheck={false}
                onChange={(event) => setApplyConfirmation(event.currentTarget.value)}
              />
            </label>
            <button
              type="button"
              className="s-btn s-btn__primary"
              disabled={!canApply}
              onClick={() => void runAction(controller.startApply)}
            >
              Apply changes to {summary.selectedItems.toLocaleString()} {plural(summary.selectedItems, "post")}
            </button>
          </fieldset>
        </>
      )}

      {(runningApply || pausedApply) && (
        <section aria-labelledby="content-replacement-apply-heading">
          <header className="content-replacement-step-header">
            <h2 id="content-replacement-apply-heading">Applying reviewed changes</h2>
            <p>Configuration and selection remain locked while bounded live writes are in progress.</p>
          </header>
          <progress
            aria-label="Apply progress"
            aria-valuenow={job.progress.applyCompleted}
            max={Math.max(1, summary.selectedItems)}
            value={job.progress.applyCompleted}
          />
          <p role="status" aria-live="polite">
            {job.progress.applyCompleted.toLocaleString()} completed · {applyRemaining.toLocaleString()} remaining
          </p>
          <section role="region" aria-label="Live apply counts">
            <dl className="content-replacement-result-counts">
              <Count label="Completed" value={job.progress.applyCompleted} />
              <Count label="Remaining" value={applyRemaining} />
              <Count label="Stale" value={liveStaleCount} />
              <Count label="Failed" value={liveFailedCount} />
              <Count label="Rate-limited" value={liveRateLimitedCount} />
            </dl>
          </section>
          <p>{applyingEntry ? `Current item: ${itemLabel(applyingEntry[1])}` : "No request is currently active."}</p>
          {job.nextRetryAt && <p>Rate limited until <time dateTime={job.nextRetryAt}>{formatTime(job.nextRetryAt)}</time>.</p>}
          <p>Pausing preserves completed writes and does not roll back failed or stale posts. It stops before the next request.</p>
          {runningApply ? (
            <button type="button" className="s-btn s-btn__outlined" onClick={controller.pause}>
              Pause after the current request
            </button>
          ) : (
            <button
              type="button"
              className="s-btn s-btn__primary"
              disabled={controller.busy || !controller.credentialReadiness.valid}
              onClick={() => void runAction(controller.resume)}
            >
              Resume apply
            </button>
          )}
        </section>
      )}

      {(job.stage === "results" || job.stage === "recovery") && (
        <>
          <header className="content-replacement-step-header">
            <h2 id="content-replacement-apply-heading">Apply results</h2>
            <p>Each post retains its own observed result. Failed and stale posts were not described as rolled back.</p>
          </header>
          <ResultSummary job={job} />
          {(controller.storageError || controller.operationError) && (
            <div className="s-notice s-notice__warning" role="alert">
              <strong>Operation needs attention.</strong> {controller.storageError ?? controller.operationError}
            </div>
          )}
          <div className="write-tool-actions content-replacement-actions">
            <button type="button" className="s-btn s-btn__outlined" onClick={() => downloadReplacementResults(items)}>
              Download results CSV
            </button>
            <button type="button" className="s-btn s-btn__outlined" onClick={() => downloadReplacementExceptions(items)}>
              Download exceptions CSV
            </button>
            <button
              type="button"
              className="s-btn s-btn__outlined"
              disabled={
                eligibleFailureCount === 0 || job.stage !== "results" || job.status === "running" ||
                !!job.activeOperation || controller.busy || actionPending
              }
              onClick={() => void runAction(controller.retryEligibleFailures)}
            >
              Retry eligible failures ({eligibleFailureCount.toLocaleString()})
            </button>
            <button
              type="button"
              className="s-btn s-btn__outlined"
              disabled={
                staleKeys.length === 0 || job.stage !== "results" || job.status === "running" ||
                !!job.activeOperation || controller.busy || actionPending
              }
              onClick={() => void runAction(() => controller.rescanStaleItems(staleKeys))}
            >
              Rescan stale posts ({staleKeys.length.toLocaleString()})
            </button>
          </div>
          <p>Downloads are one-shot exports created on demand and are not retained by the app.</p>
          <ResultTable
            entries={pageEntries}
            filter={resultFilter}
            search={resultSearch}
            onFilter={(value) => { setResultFilter(value); setPage(1); }}
            onSearch={(value) => { setResultSearch(value); setPage(1); }}
          />
          <Pagination
            page={boundedPage}
            pageCount={pageCount}
            shown={pageEntries.length}
            total={filteredEntries.length}
            onPage={setPage}
          />

          <RecoverySection
            controller={controller}
            job={job}
            successfulEntries={successfulEntries}
            selection={recoverySelection}
            onSelection={(key, selected) => {
              setRecoverySelection((current) => ({ ...current, [key]: selected }));
              setRecoveryAcknowledged(false);
              setRecoveryConfirmation("");
            }}
            selectedEntries={selectedRecoveryEntries}
            previewedEntries={previewedEntries}
            recoverableEntries={recoverableEntries}
            previewComplete={previewComplete}
            acknowledged={recoveryAcknowledged}
            confirmation={recoveryConfirmation}
            canRecover={canRecover}
            actionPending={actionPending}
            onAcknowledged={setRecoveryAcknowledged}
            onConfirmation={setRecoveryConfirmation}
            onRunAction={runAction}
          />

          <LocalDataControls
            hasRecoverySnapshots={entries.some(([, item]) => !!item.recovery)}
            confirmation={deleteConfirmation}
            disabled={job.status === "running" || !!job.activeOperation || controller.busy || actionPending}
            onRequest={setDeleteConfirmation}
            onCancel={() => setDeleteConfirmation(null)}
            onConfirm={confirmDeletion}
          />
        </>
      )}
    </section>
  );
}

function ApplyScopeSummary({
  job,
  selectedByKind,
  recoveryReady,
}: {
  job: PersistedContentReplacementJob;
  selectedByKind: { questions: number; answers: number; articles: number };
  recoveryReady: boolean;
}) {
  const summary = summarizeReplacementJob(job);
  return (
    <section className="content-replacement-apply-summary" aria-label="Confirmed apply scope">
      <h3>Reviewed live-write scope</h3>
      <dl>
        <div><dt>Instance</dt><dd>{new URL(job.baseUrl).host}</dd></div>
        <div><dt>Content space</dt><dd>Enterprise main site</dd></div>
        <div><dt>Content types</dt><dd>{contentTypeList(job)}</dd></div>
        <div><dt>Selected by type</dt><dd>{selectedByKind.questions} questions, {selectedByKind.answers} answers, {selectedByKind.articles} articles</dd></div>
        <div><dt>Matching</dt><dd>{matchingSummary(job)}</dd></div>
      </dl>
      <ol aria-label="Reviewed replacement rules">
        {job.configuration.rules.map((rule) => <li key={rule.id}>{rule.find} → {rule.replace}</li>)}
      </ol>
      <p>{summary.selectedItems.toLocaleString()} {plural(summary.selectedItems, "post")} selected · {summary.selectedChangedOccurrences.toLocaleString()} changed {plural(summary.selectedChangedOccurrences, "occurrence")} · {summary.selectedProtectedOccurrences.toLocaleString()} protected {plural(summary.selectedProtectedOccurrences, "occurrence")}</p>
      <p className={`s-notice ${recoveryReady ? "s-notice__success" : "s-notice__danger"}`} role="status">
        {recoveryReady
          ? `Complete recovery snapshots are saved for all ${summary.selectedItems.toLocaleString()} selected ${plural(summary.selectedItems, "post")}.`
          : "Recovery snapshots are not ready for every selected post. No live writes can begin."}
      </p>
      <p className="s-notice s-notice__warning">
        Stack Enterprise provides no all-post transaction or advertised conditional update. Every post is checked immediately before writing, but a small race remains between the final checksum read and PUT.
      </p>
    </section>
  );
}

function ResultSummary({ job }: { job: PersistedContentReplacementJob }) {
  const results = summarizeReplacementJob(job).results;
  return (
    <section role="region" aria-label="Apply result summary">
      <dl className="content-replacement-result-counts">
        <Count label="Updated" value={results.updated} />
        <Count label="Already applied" value={results.alreadyApplied} />
        <Count label="Excluded" value={results.excluded} />
        <Count label="Stale" value={results.stale} />
        <Count label="Permission failures" value={results.permission} />
        <Count label="Validation failures" value={results.validation} />
        <Count label="Network/API failures" value={results.network + results.failed} />
        <Count label="Protected occurrences" value={results.protectedOnly} />
        <Count label="Recovered" value={results.recovered} />
        <Count label="Recovery conflicts" value={results.recoveryConflict} />
        <Count label="Recovery failures" value={results.recoveryFailed} />
      </dl>
    </section>
  );
}

function ResultTable({
  entries,
  filter,
  search,
  onFilter,
  onSearch,
}: {
  entries: Array<[string, PersistedContentReplacementItem]>;
  filter: ResultFilter;
  search: string;
  onFilter(value: ResultFilter): void;
  onSearch(value: string): void;
}) {
  return (
    <section className="content-replacement-results" aria-labelledby="content-replacement-results-heading">
      <h3 id="content-replacement-results-heading">Item results</h3>
      <div className="content-replacement-review-filters" aria-label="Result filters">
        <label>
          <span>Result status</span>
          <select className="s-select" value={filter} onChange={(event) => onFilter(event.currentTarget.value as ResultFilter)}>
            <option value="all">All results</option>
            <option value="updated">Updated</option>
            <option value="already-applied">Already applied</option>
            <option value="excluded">Excluded</option>
            <option value="stale">Stale</option>
            <option value="permission">Permission failures</option>
            <option value="validation">Validation failures</option>
            <option value="network-api">Network/API failures</option>
            <option value="recovered">Recovered</option>
            <option value="recovery-conflict">Recovery conflicts</option>
            <option value="recovery-failed">Recovery failures</option>
          </select>
        </label>
        <label>
          <span>Search result title or ID</span>
          <input className="s-input" type="search" value={search} onChange={(event) => onSearch(event.currentTarget.value)} />
        </label>
      </div>
      <div role="region" aria-label="Content replacement result rows" tabIndex={0}>
        <table className="s-table" aria-label="Content replacement results">
          <thead><tr><th scope="col">Content</th><th scope="col">Result</th><th scope="col">Changed</th><th scope="col">Protected</th><th scope="col">Details</th></tr></thead>
          <tbody>
            {entries.map(([key, item]) => (
              <tr key={key}>
                <th scope="row">{itemLabel(item)}</th>
                <td>{resultLabel(item)}</td>
                <td>{item.proposal.changedOccurrences.length}</td>
                <td>{item.proposal.protectedOccurrences.length}</td>
                <td>{item.failure?.message ?? resultDetail(item)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {entries.length === 0 && <p role="status">No item results match the current filters.</p>}
      </div>
    </section>
  );
}

function Pagination({
  page,
  pageCount,
  shown,
  total,
  onPage,
}: {
  page: number;
  pageCount: number;
  shown: number;
  total: number;
  onPage(page: number): void;
}) {
  if (pageCount === 1) return <p>{shown.toLocaleString()} of {total.toLocaleString()} matching results shown.</p>;
  return (
    <nav aria-label="Result pagination">
      <button type="button" className="s-btn s-btn__outlined" disabled={page === 1} onClick={() => onPage(page - 1)}>Previous page</button>
      <span>Page {page} of {pageCount}</span>
      <button type="button" className="s-btn s-btn__outlined" disabled={page === pageCount} onClick={() => onPage(page + 1)}>Next page</button>
    </nav>
  );
}

function RecoverySection({
  controller,
  job,
  successfulEntries,
  selection,
  onSelection,
  selectedEntries,
  previewedEntries,
  recoverableEntries,
  previewComplete,
  acknowledged,
  confirmation,
  canRecover,
  actionPending,
  onAcknowledged,
  onConfirmation,
  onRunAction,
}: {
  controller: ContentReplacementJobController;
  job: PersistedContentReplacementJob;
  successfulEntries: Array<[string, PersistedContentReplacementItem]>;
  selection: Record<string, boolean>;
  onSelection(key: string, selected: boolean): void;
  selectedEntries: Array<[string, PersistedContentReplacementItem]>;
  previewedEntries: Array<[string, PersistedContentReplacementItem]>;
  recoverableEntries: Array<[string, PersistedContentReplacementItem]>;
  previewComplete: boolean;
  acknowledged: boolean;
  confirmation: string;
  canRecover: boolean;
  actionPending: boolean;
  onAcknowledged(value: boolean): void;
  onConfirmation(value: string): void;
  onRunAction(action: () => Promise<void>): Promise<void>;
}) {
  const [selectionPage, setSelectionPage] = useState(1);
  const [previewPage, setPreviewPage] = useState(1);
  const previewRunning = job.activeOperation?.kind === "recovery-preview";
  const recoveryRunning = job.activeOperation?.kind === "recovery-apply";
  const selectionPageCount = Math.max(1, Math.ceil(successfulEntries.length / RECOVERY_PAGE_SIZE));
  const boundedSelectionPage = Math.min(selectionPage, selectionPageCount);
  const visibleSuccessfulEntries = successfulEntries.slice(
    (boundedSelectionPage - 1) * RECOVERY_PAGE_SIZE,
    boundedSelectionPage * RECOVERY_PAGE_SIZE,
  );
  const previewPageCount = Math.max(1, Math.ceil(previewedEntries.length / RECOVERY_PAGE_SIZE));
  const boundedPreviewPage = Math.min(previewPage, previewPageCount);
  const visiblePreviewEntries = previewedEntries.slice(
    (boundedPreviewPage - 1) * RECOVERY_PAGE_SIZE,
    boundedPreviewPage * RECOVERY_PAGE_SIZE,
  );
  return (
    <section className="content-replacement-recovery" aria-labelledby="content-replacement-recovery-heading">
      <h3 id="content-replacement-recovery-heading">Guarded recovery</h3>
      <p>Only posts with an observed successful post-apply checksum are eligible. Recovery rechecks current content and never overwrites a conflict.</p>
      {successfulEntries.length === 0 ? (
        <p>No successfully verified applied posts are available for recovery.</p>
      ) : (
        <fieldset disabled={previewRunning || recoveryRunning || controller.busy || actionPending}>
          <legend>Select successfully verified posts</legend>
          {visibleSuccessfulEntries.map(([key, item]) => (
            <label key={key}>
              <input
                type="checkbox"
                checked={selection[key] !== false}
                aria-label={`Select ${itemLabel(item)} for recovery`}
                onChange={(event) => onSelection(key, event.currentTarget.checked)}
              />{" "}{itemLabel(item)}
            </label>
          ))}
          <button
            type="button"
            className="s-btn s-btn__outlined"
            disabled={selectedEntries.length === 0 || previewRunning || recoveryRunning || controller.busy || actionPending}
            onClick={() => void onRunAction(() => controller.prepareRecovery(selectedEntries.map(([key]) => key)))}
          >
            Preview recovery for {selectedEntries.length.toLocaleString()} {plural(selectedEntries.length, "post")}
          </button>
          {selectionPageCount > 1 && (
            <div aria-label="Recovery selection pagination">
              <button
                type="button"
                className="s-btn s-btn__outlined"
                aria-label="Previous recovery selection page"
                disabled={boundedSelectionPage === 1}
                onClick={() => setSelectionPage(boundedSelectionPage - 1)}
              >Previous page</button>
              <span>Page {boundedSelectionPage} of {selectionPageCount}</span>
              <button
                type="button"
                className="s-btn s-btn__outlined"
                aria-label="Next recovery selection page"
                disabled={boundedSelectionPage === selectionPageCount}
                onClick={() => setSelectionPage(boundedSelectionPage + 1)}
              >Next page</button>
            </div>
          )}
        </fieldset>
      )}

      {previewRunning && (
        <p role="status" aria-live="polite">
          Recovery preview: {job.activeOperation!.completedItemKeys.length} of {job.activeOperation!.requestedItemKeys.length} checked. No recovery writes have started.
        </p>
      )}
      {recoveryRunning && (
        <p role="status" aria-live="polite">
          Recovery progress: {job.progress.recoveryCompleted} completed; {job.activeOperation!.remainingItemKeys.length} remaining.
        </p>
      )}

      {previewedEntries.length > 0 && (
        <section role="region" aria-label="Recovery preview">
          <h4>Complete selected recovery preview</h4>
          {visiblePreviewEntries.map(([key, item]) => {
            const preview = item.recovery!.preview!;
            return (
              <details key={key} open={previewedEntries.length <= 3}>
                <summary>{itemLabel(item)} recovery preview · {recoveryPreviewLabel(preview.status)}</summary>
                <section aria-labelledby={`recovery-preview-${safeId(key)}`}>
                  <h5 id={`recovery-preview-${safeId(key)}`}>{itemLabel(item)} recovery preview</h5>
                  {preview.status === "conflict" && <p className="s-notice s-notice__warning">{itemLabel(item)} changed after apply and will not be overwritten.</p>}
                  {preview.status === "already-recovered" && <p>This post already matches the prior request model and does not need another write.</p>}
                  <h6>Current replacement state</h6>
                  <pre>{JSON.stringify(preview.currentRequestModel, null, 2)}</pre>
                  <h6>Prior full request model to restore</h6>
                  <pre>{JSON.stringify(item.recovery!.priorRequestModel, null, 2)}</pre>
                  <dl>
                    <div><dt>Observed current checksum</dt><dd><code>{preview.observedCurrentChecksum}</code></dd></div>
                    <div><dt>Expected successful apply checksum</dt><dd><code>{preview.expectedPostApplyChecksum}</code></dd></div>
                  </dl>
                </section>
              </details>
            );
          })}
          {previewPageCount > 1 && (
            <div aria-label="Recovery preview pagination">
              <button
                type="button"
                className="s-btn s-btn__outlined"
                aria-label="Previous recovery preview page"
                disabled={boundedPreviewPage === 1}
                onClick={() => setPreviewPage(boundedPreviewPage - 1)}
              >Previous page</button>
              <span>Page {boundedPreviewPage} of {previewPageCount}</span>
              <button
                type="button"
                className="s-btn s-btn__outlined"
                aria-label="Next recovery preview page"
                disabled={boundedPreviewPage === previewPageCount}
                onClick={() => setPreviewPage(boundedPreviewPage + 1)}
              >Next page</button>
            </div>
          )}
        </section>
      )}

      {previewComplete && recoverableEntries.length > 0 && (
        <fieldset className="content-replacement-confirmation">
          <legend>Recovery write confirmation</legend>
          <label>
            <input type="checkbox" checked={acknowledged} onChange={(event) => onAcknowledged(event.currentTarget.checked)} />{" "}
            I understand recovery writes the prior full request model only when the current checksum still matches the successful apply.
          </label>
          <label>
            <span>Type RECOVER to confirm</span>
            <input className="s-input" autoComplete="off" spellCheck={false} value={confirmation} onChange={(event) => onConfirmation(event.currentTarget.value)} />
          </label>
          <button
            type="button"
            className="s-btn s-btn__primary"
            disabled={!canRecover}
            onClick={() => void onRunAction(() => controller.startRecovery(recoverableEntries.map(([key]) => key)))}
          >
            Recover {recoverableEntries.length.toLocaleString()} {plural(recoverableEntries.length, "post")}
          </button>
        </fieldset>
      )}
    </section>
  );
}

function LocalDataControls({
  hasRecoverySnapshots,
  confirmation,
  disabled,
  onRequest,
  onCancel,
  onConfirm,
}: {
  hasRecoverySnapshots: boolean;
  confirmation: "snapshots" | "job" | null;
  disabled: boolean;
  onRequest(kind: "snapshots" | "job"): void;
  onCancel(): void;
  onConfirm(kind: "snapshots" | "job"): Promise<void>;
}) {
  return (
    <section className="content-replacement-local-data" aria-labelledby="content-replacement-local-data-heading">
      <h3 id="content-replacement-local-data-heading">Sensitive browser-local content</h3>
      <p>This job contains post bodies and request models in this browser. Deleting data does not navigate away from Content Replacement.</p>
      <div className="write-tool-actions">
        <button type="button" className="s-btn s-btn__outlined" disabled={disabled || !hasRecoverySnapshots} onClick={() => onRequest("snapshots")}>Delete recovery snapshots</button>
        <button type="button" className="s-btn s-btn__outlined" disabled={disabled} onClick={() => onRequest("job")}>Delete entire local job</button>
      </div>
      {confirmation === "snapshots" && (
        <div role="group" aria-label="Confirm recovery snapshot deletion" className="s-notice s-notice__warning">
          <p>Delete only the prior request models used for recovery? Apply results remain local, but recovery becomes unavailable.</p>
          <button type="button" className="s-btn s-btn__outlined" onClick={onCancel}>Keep recovery snapshots</button>
          <button type="button" className="s-btn s-btn__outlined" onClick={() => void onConfirm("snapshots")}>Confirm delete recovery snapshots</button>
        </div>
      )}
      {confirmation === "job" && (
        <div role="group" aria-label="Confirm local job deletion" className="s-notice s-notice__warning">
          <p>Delete this entire browser-local job, including proposals, results, and recovery snapshots?</p>
          <button type="button" className="s-btn s-btn__outlined" onClick={onCancel}>Keep local job</button>
          <button type="button" className="s-btn s-btn__outlined" onClick={() => void onConfirm("job")}>Confirm delete entire local job</button>
        </div>
      )}
    </section>
  );
}

function Count({ label, value }: { label: string; value: number }) {
  return <div><dt>{label}</dt><dd>{value.toLocaleString()}</dd></div>;
}

function countSelectedByKind(entries: Array<[string, PersistedContentReplacementItem]>) {
  const counts = { questions: 0, answers: 0, articles: 0 };
  for (const [, item] of entries) {
    if (!item.included) continue;
    counts[`${item.proposal.before.kind}s` as keyof typeof counts] += 1;
  }
  return counts;
}

function completeRecoverySnapshot(item: PersistedContentReplacementItem): boolean {
  return !item.included || !!item.recovery &&
    item.recovery.scannedRequestChecksum === item.proposal.scannedRequestChecksum &&
    item.recovery.proposedRequestChecksum === item.proposal.proposedRequestChecksum;
}

function hasObservedApplySuccess(item: PersistedContentReplacementItem): boolean {
  return (item.result?.kind === "applied" || item.result?.kind === "unchanged") &&
    !!item.recovery?.observedPostApplyChecksum &&
    item.recovery.observedPostApplyChecksum === item.result.observedRequestChecksum;
}

function isApplyTerminal(item: PersistedContentReplacementItem): boolean {
  return item.status === "applied" || item.status === "stale" || item.status === "failed";
}

function applyScopeKey(job: PersistedContentReplacementJob): string {
  const selected = Object.entries(job.proposals)
    .filter(([, item]) => item.included)
    .map(([key, item]) => `${key}:${item.proposal.proposalFingerprint}`)
    .sort();
  return `${job.fingerprint}|${selected.join("|")}`;
}

function recoveryPreviewKey(job: PersistedContentReplacementJob): string {
  return Object.entries(job.proposals)
    .map(([key, item]) => `${key}:${item.recovery?.preview?.observedCurrentChecksum ?? ""}:${item.recovery?.preview?.status ?? ""}`)
    .sort()
    .join("|");
}

function contentTypeList(job: PersistedContentReplacementJob): string {
  return [
    job.configuration.contentTypes.questions && "Questions",
    job.configuration.contentTypes.answers && "Answers",
    job.configuration.contentTypes.articles && "Articles",
  ].filter(Boolean).join(", ");
}

function matchingSummary(job: PersistedContentReplacementJob): string {
  const options = job.configuration.options;
  return [
    options.caseSensitive ? "Case-sensitive" : "Case-insensitive",
    options.wholeTerm ? "whole-term" : "partial",
    options.replaceInCode ? "code included" : "code protected",
    "destinations and raw HTML attributes protected",
  ].join("; ");
}

function compareEntries(
  [leftKey]: [string, PersistedContentReplacementItem],
  [rightKey]: [string, PersistedContentReplacementItem],
): number {
  return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
}

function itemLabel(item: PersistedContentReplacementItem): string {
  const ref = item.proposal.before.ref;
  const kind = `${ref.kind[0].toUpperCase()}${ref.kind.slice(1)}`;
  const id = ref.kind === "question" ? ref.questionId : ref.kind === "answer" ? ref.answerId : ref.articleId;
  return `${kind} ${id}`;
}

function resultLabel(item: PersistedContentReplacementItem): string {
  if (item.status === "recovered") return "Recovered";
  if (item.status === "recovery-conflict") return "Recovery conflict";
  if (item.status === "recovery-failed") return "Recovery failed";
  if (!item.included || item.status === "excluded") return "Excluded";
  if (item.result?.kind === "applied") return "Updated";
  if (item.result?.kind === "unchanged") return "Already applied";
  if (item.status === "stale") return "Stale — skipped before writing";
  if (item.status === "failed") {
    if (item.failure?.category === "authorization") return "Permission failure";
    if (item.failure?.category === "validation") return "Validation failure";
    if (item.failure?.category === "network" || item.failure?.category === "rate-limit") return "Network/API failure";
    return "API failure";
  }
  return item.status;
}

function resultDetail(item: PersistedContentReplacementItem): string {
  if (item.status === "stale") return "Content changed after review; no write was attempted.";
  if (item.status === "recovery-conflict") return "Content changed after apply; the prior model was not restored.";
  if (item.status === "excluded") return "Excluded during review.";
  return "—";
}

function matchesResultFilter(item: PersistedContentReplacementItem, filter: ResultFilter): boolean {
  if (filter === "all") return true;
  if (filter === "updated") return item.result?.kind === "applied";
  if (filter === "already-applied") return item.result?.kind === "unchanged";
  if (filter === "excluded") return !item.included || item.status === "excluded";
  if (filter === "stale") return item.status === "stale";
  if (filter === "permission") return item.status === "failed" && item.failure?.category === "authorization";
  if (filter === "validation") return item.status === "failed" && item.failure?.category === "validation";
  if (filter === "network-api") return item.status === "failed" &&
    (item.failure?.category === "network" || item.failure?.category === "rate-limit" ||
      item.failure?.category === "server" || item.failure?.category === "unknown");
  return item.status === filter;
}

function matchesSearch(key: string, item: PersistedContentReplacementItem, value: string): boolean {
  const query = value.trim().toLocaleLowerCase("en-US");
  if (!query) return true;
  const metadata = item.proposal.metadata ?? item.proposal.before.metadata;
  return `${key} ${itemLabel(item)} ${metadata?.titleContext ?? ""}`.toLocaleLowerCase("en-US").includes(query);
}

function recoveryPreviewLabel(status: "recoverable" | "already-recovered" | "conflict"): string {
  if (status === "recoverable") return "Ready to recover";
  if (status === "already-recovered") return "Already restored";
  return "Conflict — will not overwrite";
}

function safeId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "-");
}

function formatTime(timestamp: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "long" }).format(new Date(timestamp));
}

function plural(count: number, singular: string): string {
  return count === 1 ? singular : `${singular}s`;
}
