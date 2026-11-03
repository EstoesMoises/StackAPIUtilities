import { useEffect, useState } from "react";
import { formatReportTimeEstimate } from "../reports/resumable/reportEstimate";
import type { ReportJobProgress } from "../reports/resumable/types";

interface ReportJobStatusProps {
  progress: ReportJobProgress | null;
  ready: boolean;
  busy: boolean;
  hasCredentials: boolean;
  error: string | null;
  onPause(): void;
  onResume(): void;
  onDiscard(): void;
  onReconnect(): void;
}

export function ReportJobStatus({ progress, busy, ready, hasCredentials, error, onPause, onResume, onDiscard, onReconnect }: ReportJobStatusProps) {
  const [now, setNow] = useState(Date.now);
  const retryAt = progress?.job.retryAt;
  useEffect(() => {
    if (!busy || !retryAt) return;
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [busy, retryAt]);
  if (!progress && !error) return null;
  const job = progress?.job;
  const waitingSeconds = busy && retryAt ? Math.max(0, Math.ceil((retryAt - now) / 1_000)) : 0;
  const complete = job?.status === "complete";
  const status = busy ? waitingSeconds ? "Waiting for API" : "Collecting" : complete ? "Complete" : job?.status === "failed" ? "Needs attention" : "Paused";

  return (
    <section className="s-notice s-notice__info mt16 report-job-status" aria-label="Report collection">
      {job && <>
        <div className="run-status-progress-header">
          <h3 className="run-status-title">{job.reportTitle} collection</h3>
          <span className="run-status-badge">{status}</span>
        </div>
        <div role="status" aria-live="polite" aria-atomic="true">
          <p className="report-job-stage">{busy ? job.stage : complete ? "All required data collected." : "Progress saved in this browser."}</p>
          {busy && <p className="report-job-estimate">
            {waitingSeconds > 0 ? `API rate limit: retrying in ${waitingSeconds.toLocaleString()} seconds.`
              : progress.restoring ? "Restoring saved progress…"
              : progress.estimate ? `${formatReportTimeEstimate(progress.estimate)} remaining while collection is running`
              : job.stage.startsWith("Discovering") ? "Discovering report size…" : "Estimating time remaining…"}
          </p>}
        </div>
        <p className="report-job-details">{job.completedRequests.toLocaleString()} requests saved · {(job.savedBytes / 1024 / 1024).toFixed(1)} MB · {Math.floor(job.activeMs / 60_000).toLocaleString()} minutes collecting</p>
        {!complete && <p className="report-job-help">Keep this tab open to collect. You can pause or close it and resume here with the same connection credentials. Time estimates update as more work is discovered.</p>}
        <div className="run-controls">
          {busy ? <button type="button" className="s-btn s-btn__outlined" onClick={onPause}>Pause collection</button>
            : hasCredentials ? <button type="button" className="s-btn s-btn__filled" disabled={!ready} onClick={onResume}>{complete ? "Load saved report" : "Resume collection"}</button>
              : <button type="button" className="s-btn s-btn__filled" onClick={onReconnect}>Reconnect to resume</button>}
          <button type="button" className="s-btn s-btn__muted" disabled={busy || !ready} onClick={onDiscard}>{complete ? "Clear saved collection" : "Discard collection"}</button>
        </div>
      </>}
      {error && <p className="report-job-error" role="alert">{error}</p>}
    </section>
  );
}
