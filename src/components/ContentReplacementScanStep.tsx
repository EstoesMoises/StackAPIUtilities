import { useState } from "react";
import { getEnterpriseWriteCredentialReadiness } from "../credentials/enterpriseV3Credentials";
import type { SessionCredentials } from "../domain/types";
import type { ContentReplacementJobController } from "../hooks/useContentReplacementJob";
import { canEnterReview } from "../writeTools/contentReplacement/jobState";
import type { PersistedContentReplacementJob } from "../writeTools/contentReplacement/types";
import { ContentReplacementCoverageEvidence } from "./ContentReplacementCoverageEvidence";

export interface ContentReplacementScanStepProps {
  controller: ContentReplacementJobController;
  credentials: SessionCredentials | null;
  onReconnect?: () => void;
}

export function ContentReplacementScanStep({
  controller,
  credentials,
  onReconnect,
}: ContentReplacementScanStepProps) {
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const job = controller.job;

  if (!job) {
    return <section className="content-replacement-scan"><p>No scan job is available.</p></section>;
  }

  const sharedReadiness = getEnterpriseWriteCredentialReadiness(credentials, { expectedOrigin: job.baseUrl });
  const credentialState = controller.credentialReadiness.refreshRequired
    ? controller.credentialReadiness
    : sharedReadiness;
  const scanCanFinish = !controller.storageError && canEnterReview(job);
  const status = getScanStatus(job, controller.storageError, credentialState);
  const active = job.stage === "scan" && job.status === "running";
  const paused = job.stage === "scan" && job.status === "paused";
  const failed = job.stage === "scan" && job.status === "failed";
  const needsReconnect = (paused || failed) && !credentialState.valid;
  const canRetryFailure = failed && !!job.failure?.retryable && credentialState.valid && !controller.storageError;

  async function confirmCancel() {
    if (cancelling) return;
    setCancelling(true);
    try {
      if (controller.job?.status === "running") controller.pause();
      await controller.cancel();
      setConfirmingCancel(false);
    } finally {
      setCancelling(false);
    }
  }

  return (
    <section className="content-replacement-scan" aria-labelledby="content-replacement-scan-heading">
      <header className="content-replacement-step-header">
        <h2 id="content-replacement-scan-heading">Scan content</h2>
        <p>The browser inventories the selected content and inspects canonical candidate details. Scanning performs reads only.</p>
      </header>

      <ContentReplacementCoverageEvidence configuration={job.configuration} />

      <div className={`s-notice ${status.noticeClass} content-replacement-scan-status`} role="status" aria-live="polite" aria-atomic="true">
        <strong>{status.heading}</strong>
        <p>{status.message}</p>
        {status.retryAt && <p>Next retry: <time dateTime={status.retryAt}>{formatAbsoluteTime(status.retryAt)}</time>.</p>}
      </div>

      <ScanConfiguration job={job} />

      <ScanCounts job={job} />

      {controller.operationError && !job.failure && (
        <div className="s-notice s-notice__warning"><strong>Operation notice:</strong> {controller.operationError}</div>
      )}

      {active && (
        <div className="write-tool-actions content-replacement-actions">
          <button className="s-btn s-btn__outlined" type="button" onClick={controller.pause} disabled={controller.busy && confirmingCancel}>Pause scan</button>
          <button className="s-btn s-btn__outlined" type="button" onClick={() => setConfirmingCancel(true)} disabled={cancelling}>Cancel scan</button>
        </div>
      )}

      {paused && credentialState.valid && !controller.storageError && !job.failure && (
        <div className="write-tool-actions content-replacement-actions">
          <button className="s-btn s-btn__primary" type="button" onClick={() => void controller.resume()} disabled={controller.busy}>Resume scan</button>
        </div>
      )}

      {canRetryFailure && (
        <div className="write-tool-actions content-replacement-actions">
          <button className="s-btn s-btn__primary" type="button" onClick={() => void controller.resume()} disabled={controller.busy}>
            {job.failure?.category === "authorization" ? "Resume scan" : "Retry scan"}
          </button>
        </div>
      )}

      {needsReconnect && (
        <div className="content-replacement-reconnect">
          {onReconnect && <button className="s-btn s-btn__outlined" type="button" onClick={onReconnect}>Reconnect credentials</button>}
        </div>
      )}

      {scanCanFinish && (
        <div className="write-tool-actions content-replacement-actions">
          <button className="s-btn s-btn__primary" type="button" onClick={() => void controller.startScan()} disabled={controller.busy}>Finish scan and review</button>
        </div>
      )}

      {confirmingCancel && (
        <div className="content-replacement-cancel-confirmation s-notice s-notice__warning" role="group" aria-label="Confirm scan cancellation">
          <p>Cancel this scan? Scanned progress stays local, but the incomplete inventory cannot enter Review.</p>
          <div className="write-tool-actions content-replacement-actions">
            <button className="s-btn s-btn__outlined" type="button" onClick={() => setConfirmingCancel(false)} disabled={cancelling}>Keep scanning</button>
            <button className="s-btn s-btn__outlined" type="button" onClick={() => void confirmCancel()} disabled={cancelling}>{cancelling ? "Cancelling…" : "Confirm cancel scan"}</button>
          </div>
        </div>
      )}
    </section>
  );
}

function Count({ label, value }: { label: string; value: number }) {
  return <div><dt>{label}</dt><dd>{value.toLocaleString()}</dd></div>;
}

function ScanCounts({ job }: { job: PersistedContentReplacementJob }) {
  const { discovery } = job.configuration;
  const { progress } = job;
  const counts: ReadonlyArray<readonly [string, number]> = discovery.mode === "targeted"
    ? [
        ["Source terms completed", progress.searchTermsCompleted],
        ["Search pages", progress.searchPages],
        ["Indexed references", progress.indexedReferences],
        ["Canonical details", progress.detailsInspected],
        ["Proposals", progress.proposalsFound],
        ["API reads completed", progress.apiRequestsCompleted],
      ]
    : discovery.mode === "exact"
      ? [
          ["Supplied targets", discovery.targetCount],
          ["Canonical details fetched", progress.detailsInspected],
          ["Proposals", progress.proposalsFound],
          ["Protected occurrences", progress.protectedOccurrences],
          ["API reads completed", progress.apiRequestsCompleted],
        ]
      : [
          ["Question pages", progress.questionPages],
          ["Answer collections", progress.answerPages],
          ["Article pages", progress.articlePages],
          ["Answer-bearing questions queued", progress.answerBearingQuestionsQueued],
          ["Zero-answer questions skipped", progress.zeroAnswerQuestionsSkipped],
          ["Canonical details", progress.detailsInspected],
          ["Proposals", progress.proposalsFound],
          ["API reads completed", progress.apiRequestsCompleted],
        ];
  return (
    <dl className="content-replacement-scan-counts" aria-label="Scan counts">
      {counts.map(([label, value]) => <Count key={label} label={label} value={value} />)}
    </dl>
  );
}

function ScanConfiguration({ job }: { job: PersistedContentReplacementJob }) {
  const configuration = job.configuration;
  const contentTypes = [
    configuration.contentTypes.questions && "Questions",
    configuration.contentTypes.answers && "Answers",
    configuration.contentTypes.articles && "Articles",
  ].filter(Boolean).join(", ");
  const unsafe = !configuration.options.caseSensitive || !configuration.options.wholeTerm || configuration.options.replaceInCode;
  return (
    <details className="content-replacement-scan-configuration" open role="group" aria-label="Scan configuration">
      <summary>Scan configuration · {configuration.rules.length} {configuration.rules.length === 1 ? "mapping" : "mappings"}</summary>
      <dl>
        <div><dt>Content types</dt><dd>{contentTypes}</dd></div>
        <div><dt>Case</dt><dd>{configuration.options.caseSensitive ? "Case-sensitive matching" : "Case-insensitive matching"}</dd></div>
        <div><dt>Boundaries</dt><dd>{configuration.options.wholeTerm ? "Whole-term matching" : "Partial matching"}</dd></div>
        <div><dt>Code</dt><dd>{configuration.options.replaceInCode ? "Code included" : "Code protected"}</dd></div>
      </dl>
      <ol aria-label="Replacement mappings">
        {configuration.rules.map((rule) => <li key={rule.id}>{rule.find} → {rule.replace}</li>)}
      </ol>
      <p>Link, image, and autolink destinations and raw HTML attributes remain protected always.</p>
      {unsafe && <p className="s-notice s-notice__warning"><strong>Unsafe matching options are active.</strong> Review the case, boundary, and code policy above.</p>}
    </details>
  );
}

function getScanStatus(
  job: PersistedContentReplacementJob,
  storageError: string | null,
  credentials: { valid: boolean; message: string },
): { heading: string; message: string; noticeClass: string; retryAt?: string } {
  if (storageError) {
    return {
      heading: "Storage failure",
      message: `${storageError} Review is blocked until progress can be saved.`,
      noticeClass: "s-notice__danger",
    };
  }
  if (job.stage !== "scan") {
    const completed = completedScanStatus(job);
    return {
      ...completed,
      noticeClass: "s-notice__success",
    };
  }
  if ((job.status === "paused" || job.status === "failed") && !credentials.valid) {
    return {
      heading: "Credential reconnection required",
      message: job.failure?.category === "authorization" ? job.failure.message : credentials.message,
      noticeClass: "s-notice__warning",
    };
  }
  if (job.failure?.category === "authorization") {
    return {
      heading: "Credentials reconnected",
      message: "Valid matching write credentials are available. Resume the incomplete scan; Review remains blocked until it finishes.",
      noticeClass: "s-notice__info",
    };
  }
  if (job.nextRetryAt) {
    return {
      heading: "Rate-limit backoff",
      message: "The Stack Enterprise API asked the scan to wait before the next bounded read.",
      noticeClass: "s-notice__warning",
      retryAt: job.nextRetryAt,
    };
  }
  if (job.status === "failed" && job.failure?.retryable) {
    return {
      heading: job.failure.category === "rate-limit" ? "Rate-limit scan interrupted" : "Scan interrupted",
      message: `${job.failure.message} Progress is saved locally and can be retried. Review remains blocked until the scan finishes.`,
      noticeClass: "s-notice__warning",
    };
  }
  if (job.status === "failed") {
    return {
      heading: "Inventory scan failed",
      message: `${job.failure?.message ?? "The scan could not continue."} Review is blocked because the inventory is incomplete.`,
      noticeClass: "s-notice__danger",
    };
  }
  if (job.status === "paused") {
    return {
      heading: "Scan paused",
      message: "Progress is saved locally. Resume with valid credentials to continue the incomplete scan.",
      noticeClass: "s-notice__info",
    };
  }
  if (job.status === "cancelled") {
    return {
      heading: "Scan cancelled",
      message: "The inventory is incomplete, so Review remains unavailable.",
      noticeClass: "s-notice__warning",
    };
  }
  return {
    heading: "Scan running",
    message: "Inventory and candidate-detail reads are in progress. Counts update after each saved batch.",
    noticeClass: "s-notice__info",
  };
}

function completedScanStatus(job: PersistedContentReplacementJob): Pick<ReturnType<typeof getScanStatus>, "heading" | "message"> {
  if (job.progress.proposalsFound > 0) {
    if (job.configuration.discovery.mode === "targeted") {
      return {
        heading: "Scan complete",
        message: "Search-assisted candidate inspection finished. Review can use the completed scan, which may miss matches.",
      };
    }
    if (job.configuration.discovery.mode === "exact") {
      return {
        heading: "Scan complete",
        message: "Canonical details for the supplied targets finished. Review can use the complete supplied-target scan.",
      };
    }
    return {
      heading: "Scan complete",
      message: "Exhaustive inventory and candidate inspection finished. Review can use the complete scan.",
    };
  }
  if (job.configuration.discovery.mode === "targeted") {
    return job.progress.indexedReferences === 0
      ? {
          heading: "No indexed candidates found",
          message: "Search-assisted discovery found no indexed candidates. It may miss matches outside those results.",
        }
      : {
          heading: "No eligible matches in indexed candidates",
          message: "The indexed candidates were inspected, but none produced a proposal. Search-assisted discovery may miss matches.",
        };
  }
  if (job.configuration.discovery.mode === "exact") {
    return {
      heading: "No matches found in the supplied targets.",
      message: "Every supplied target was inspected; none produced a proposal.",
    };
  }
  return {
    heading: "No matches found in accessible selected content.",
    message: "The exhaustive scan completed across accessible selected content without a proposal.",
  };
}

function formatAbsoluteTime(timestamp: string) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "long" }).format(new Date(timestamp));
}
