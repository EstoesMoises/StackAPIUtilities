export const SME_COVERAGE_RUN_STAGES = [
  "Validate credentials and instance support",
  "Collect all-time tag demand",
  "Collect current assigned-SME counts",
  "Normalize and join tag evidence",
  "Calculate thresholds and coverage tiers",
  "Build deterministic assessment",
  "Store browser-local result",
  "Render decision pack",
] as const;

export type SmeCoverageRunStage = (typeof SME_COVERAGE_RUN_STAGES)[number];

type SmeCoverageRunStatus = "idle" | "running" | "succeeded" | "failed";

interface SmeCoverageRunProgressProps {
  status: SmeCoverageRunStatus;
  failedStage?: SmeCoverageRunStage;
  error?: string;
}

export function SmeCoverageRunProgress({
  status,
  failedStage,
  error,
}: SmeCoverageRunProgressProps) {
  const succeeded = status === "succeeded";
  const progressText = getProgressText(status);
  const resolvedFailedStage =
    status === "failed" && isSmeCoverageRunStage(failedStage) ? failedStage : undefined;
  const fallbackFailedStage =
    status === "failed" && !resolvedFailedStage
      ? getFallbackFailedStage(failedStage)
      : undefined;

  return (
    <section
      className={`sme-run-progress sme-run-progress__${status}`}
      role="region"
      aria-label="SME Coverage Analyzer run progress"
      aria-live="polite"
    >
      <div className="sme-run-progress-header">
        <div>
          <p className="run-status-section-label">Utility run</p>
          <h3 className="sme-run-progress-title">{getProgressTitle(status)}</h3>
        </div>
        <span className={`run-status-badge run-status-badge__${status}`}>
          {getStatusLabel(status)}
        </span>
      </div>
      <p className="sme-run-progress-copy">{getProgressCopy(status, resolvedFailedStage)}</p>
      <div
        className="sme-run-progressbar"
        role="progressbar"
        aria-label="SME Coverage Analyzer progress"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={succeeded ? 100 : status === "idle" ? 0 : undefined}
        aria-valuetext={progressText}
      >
        <span className="sme-run-progress-fill" aria-hidden="true" />
      </div>
      <ol className="sme-run-stage-list">
        {SME_COVERAGE_RUN_STAGES.map((stage) => {
          const stageStatus = getStageStatus(status, stage, resolvedFailedStage);
          return (
            <li className={`sme-run-stage sme-run-stage__${stageStatus.kind}`} key={stage}>
              <span>{stage}</span>
              <strong>{stageStatus.label}</strong>
            </li>
          );
        })}
        {fallbackFailedStage && (
          <li className="sme-run-stage sme-run-stage__failed">
            <span>{fallbackFailedStage}</span>
            <strong>Failed</strong>
          </li>
        )}
      </ol>
      {status === "failed" && (
        <div className="s-notice s-notice__danger sme-run-progress-error" role="alert">
          {getFailureError(error)}
        </div>
      )}
    </section>
  );
}

function getProgressTitle(status: SmeCoverageRunStatus): string {
  switch (status) {
    case "idle":
      return "SME Coverage Analyzer ready";
    case "running":
      return "Running SME Coverage Analyzer";
    case "succeeded":
      return "SME Coverage Analyzer complete";
    case "failed":
      return "SME Coverage Analyzer failed";
  }
}

function getStatusLabel(status: SmeCoverageRunStatus): string {
  switch (status) {
    case "idle":
      return "Ready";
    case "running":
      return "Running";
    case "succeeded":
      return "Succeeded";
    case "failed":
      return "Failed";
  }
}

function getProgressText(status: SmeCoverageRunStatus): string {
  switch (status) {
    case "idle":
      return "Ready to run; 0 of 8 stages complete";
    case "running":
      return "Running all stages in order; stage completion is available after the server responds.";
    case "succeeded":
      return "8 of 8 stages complete";
    case "failed":
      return "Run failed; no aggregate completion percentage is available";
  }
}

function getProgressCopy(status: SmeCoverageRunStatus, failedStage?: SmeCoverageRunStage): string {
  switch (status) {
    case "idle":
      return "The stages below run on the server after you start the utility.";
    case "running":
      return "The server is running the following stages in order. Individual stage completion is available only after the request finishes.";
    case "succeeded":
      return "The server completed every stage and returned the decision pack.";
    case "failed":
      return failedStage
        ? `The server reported a failure during: ${failedStage}.`
        : "The server reported a failure before returning the decision pack.";
  }
}

function getStageStatus(
  status: SmeCoverageRunStatus,
  stage: SmeCoverageRunStage,
  failedStage?: SmeCoverageRunStage,
): { kind: "awaiting" | "complete" | "failed" | "not-run"; label: string } {
  if (status === "succeeded") {
    return { kind: "complete", label: "Complete" };
  }
  if (status === "failed" && stage === failedStage) {
    return { kind: "failed", label: "Failed" };
  }
  if (status === "failed") {
    return { kind: "not-run", label: "Not confirmed" };
  }
  if (status === "running") {
    return { kind: "awaiting", label: "Awaiting server result" };
  }
  return { kind: "not-run", label: "Not started" };
}

function isSmeCoverageRunStage(value: unknown): value is SmeCoverageRunStage {
  return (
    typeof value === "string" &&
    (SME_COVERAGE_RUN_STAGES as readonly string[]).includes(value)
  );
}

function getFallbackFailedStage(value: unknown): string {
  if (typeof value === "string" && value.trim() !== "") {
    return `Server-reported stage: ${value}`;
  }
  return "Failed stage was not reported by the server";
}

function getFailureError(error: unknown): string {
  if (typeof error === "string" && error.trim() !== "") {
    return error;
  }
  return "The utility could not complete. Review the failed stage, confirm credentials and instance access, then retry.";
}
