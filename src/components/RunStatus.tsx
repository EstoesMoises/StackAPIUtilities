import type { ReportRunProgress, RunQueueItem } from "../domain/types";

interface RunStatusProps {
  queue: RunQueueItem[];
  progress?: ReportRunProgress;
}

export function RunStatus({ queue, progress }: RunStatusProps) {
  if (queue.length === 0 && !progress) {
    return null;
  }

  return (
    <section className="s-notice s-notice__info mt16 run-status" aria-label="Run status">
      {progress && <RunProgress progress={progress} />}
      {queue.length > 0 && (
        <div className="run-status-queue">
          {progress && <p className="run-status-section-label">Queue messages</p>}
          <ul className="m0">
            {queue.map((item) => (
              <li key={item.id}>{item.message}</li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function RunProgress({ progress }: { progress: ReportRunProgress }) {
  const progressPercent = getProgressPercent(progress);

  return (
    <div className="run-status-progress">
      <div className="run-status-progress-header">
        <div>
          <p className="run-status-section-label">Live run progress</p>
          <h3 className="run-status-title">{getProgressTitle(progress)}</h3>
        </div>
        <span className={`run-status-badge run-status-badge__${progress.status}`}>
          {getStatusLabel(progress.status)}
        </span>
      </div>
      <p className="run-status-stage">
        <span>Current stage</span>
        <strong>{progress.currentStage}</strong>
      </p>
      <div
        className="run-status-progressbar"
        role="progressbar"
        aria-label={`${progress.reportTitle} progress`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={progressPercent}
        aria-valuetext={`${progress.completedStages.length} of ${progress.totalStages} stages complete`}
      >
        <span className="run-status-progress-fill" style={{ transform: `scaleX(${progressPercent / 100})` }} />
      </div>
      {progress.completedStages.length > 0 && (
        <div className="run-status-completed">
          <p className="run-status-section-label">Completed stages</p>
          <ul className="run-status-stage-list">
            {progress.completedStages.map((stage) => (
              <li key={stage}>{stage}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function getProgressPercent(progress: ReportRunProgress) {
  if (progress.totalStages <= 0) {
    return 0;
  }

  return Math.min(
    100,
    Math.max(0, Math.round((progress.completedStages.length / progress.totalStages) * 100)),
  );
}

function getProgressTitle(progress: ReportRunProgress) {
  switch (progress.status) {
    case "running":
      return `Running ${progress.reportTitle}`;
    case "succeeded":
      return `${progress.reportTitle} run complete`;
    case "failed":
      return `${progress.reportTitle} run failed`;
    case "idle":
      return `${progress.reportTitle} ready`;
  }
}

function getStatusLabel(status: ReportRunProgress["status"]) {
  switch (status) {
    case "running":
      return "Running";
    case "succeeded":
      return "Succeeded";
    case "failed":
      return "Failed";
    case "idle":
      return "Idle";
  }
}
