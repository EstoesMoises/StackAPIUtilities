import { useState } from "react";
import { validateEnterpriseV3OAuthCredentials } from "../credentials/enterpriseV3Credentials";
import type { SessionCredentials } from "../domain/types";
import type { ContentReplacementJobController } from "../hooks/useContentReplacementJob";
import { canEnterReview } from "../writeTools/contentReplacement/jobState";
import type { PersistedContentReplacementJob } from "../writeTools/contentReplacement/types";

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

  const credentialState = getCredentialState(credentials, job);
  const scanCanFinish = !controller.storageError && canEnterReview(job);
  const status = getScanStatus(job, controller.storageError, credentialState);
  const active = job.stage === "scan" && job.status === "running";
  const paused = job.stage === "scan" && job.status === "paused";

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

      <div className={`s-notice ${status.noticeClass} content-replacement-scan-status`} role="status" aria-live="polite" aria-atomic="true">
        <strong>{status.heading}</strong>
        <p>{status.message}</p>
        {status.retryAt && <p>Next retry: <time dateTime={status.retryAt}>{formatAbsoluteTime(status.retryAt)}</time>.</p>}
      </div>

      <dl className="content-replacement-scan-counts" aria-label="Scan counts">
        <Count label="Question pages" value={job.progress.questionPages} />
        <Count label="Answer collections" value={job.progress.answerPages} />
        <Count label="Article pages" value={job.progress.articlePages} />
        <Count label="Candidate details inspected" value={job.progress.detailsInspected} />
        <Count label="Proposed posts" value={job.progress.proposalsFound} />
        <Count label="Protected occurrences" value={job.progress.protectedOccurrences} />
      </dl>

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

      {paused && !credentialState.valid && (
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

function getCredentialState(
  credentials: SessionCredentials | null,
  job: Pick<PersistedContentReplacementJob, "baseUrl">,
): { valid: boolean; message: string } {
  const validation = validateEnterpriseV3OAuthCredentials(credentials, {
    requiredScopes: ["write_access"],
  });
  if (!validation.valid || !credentials) {
    return { valid: false, message: validation.messages.join(" ") || "Reconnect valid Stack Enterprise credentials." };
  }
  try {
    if (new URL(credentials.baseUrl).origin !== job.baseUrl) {
      return { valid: false, message: "The connected Stack Enterprise origin does not match this scan." };
    }
  } catch {
    return { valid: false, message: "Reconnect valid Stack Enterprise credentials." };
  }
  return { valid: true, message: "" };
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
    return {
      heading: "Scan complete",
      message: "Exhaustive inventory and candidate inspection finished. Review can use the complete scan.",
      noticeClass: "s-notice__success",
    };
  }
  if (job.status === "failed") {
    return {
      heading: "Inventory scan failed",
      message: `${job.failure?.message ?? "The scan could not continue."} Review is blocked because the inventory is incomplete.`,
      noticeClass: "s-notice__danger",
    };
  }
  if (job.failure?.category === "authorization" || (job.status === "paused" && !credentials.valid)) {
    return {
      heading: "Credential reconnection required",
      message: job.failure?.message ?? credentials.message,
      noticeClass: "s-notice__warning",
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

function formatAbsoluteTime(timestamp: string) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "long" }).format(new Date(timestamp));
}
