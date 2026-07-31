import { useState } from "react";
import type { SmeCoverageDecisionPack as DecisionPack } from "../utilities/smeCoverage/model";
import {
  downloadSmeCoverageEvidenceCsv,
  downloadSmeCoverageMarkdown,
} from "../utils/smeCoverageDownloads";
import { SmeCoverageAssessment } from "./SmeCoverageAssessment";
import { SmeCoverageEvidenceTable } from "./SmeCoverageEvidenceTable";
import { SmeCoverageFindings } from "./SmeCoverageFindings";
import { SmeCoverageMethodology } from "./SmeCoverageMethodology";

interface SmeCoverageDecisionPackProps {
  pack: DecisionPack;
  onRunAgain: () => void;
  runPending?: boolean;
}

type DownloadFeedback =
  | { state: "idle" }
  | { state: "success"; message: string }
  | { state: "failed"; message: string };

const summaryMetrics = [
  ["Tags analyzed", "tagsAnalyzed"],
  ["Tags with SMEs", "tagsWithSmes"],
  ["Immediate gaps", "immediateGaps"],
  ["Critical under-coverage", "criticalUnderCoverage"],
  ["Light-coverage tags", "lightCoverage"],
] as const;

export function SmeCoverageDecisionPack({
  pack,
  onRunAgain,
  runPending = false,
}: SmeCoverageDecisionPackProps) {
  const [downloadFeedback, setDownloadFeedback] = useState<DownloadFeedback>({ state: "idle" });
  const needsPartialQualification =
    pack.snapshot.completeness === "Partial" && pack.warnings.length === 0;

  function startDownload(format: "Markdown" | "CSV") {
    try {
      if (format === "Markdown") downloadSmeCoverageMarkdown(pack);
      else downloadSmeCoverageEvidenceCsv(pack);
      setDownloadFeedback({ state: "success", message: `${format} download started.` });
    } catch {
      setDownloadFeedback({
        state: "failed",
        message: `The ${format} download could not start. Check browser download permissions and try again.`,
      });
    }
  }

  return (
    <section className="sme-decision-pack" aria-labelledby="sme-decision-pack-heading">
      <div className="sme-result-header">
        <div>
          <p className="workspace-kicker">Decision pack</p>
          <h2 id="sme-decision-pack-heading">SME coverage result</h2>
        </div>
        <span className={`sme-completeness-badge sme-completeness-badge__${pack.snapshot.completeness.toLowerCase()}`}>
          {pack.snapshot.completeness}
        </span>
      </div>

      {(pack.warnings.length > 0 || needsPartialQualification) && (
        <section className="sme-warning-stack" role="region" aria-labelledby="sme-warnings-heading">
          <h3 id="sme-warnings-heading">Completeness warnings</h3>
          {pack.warnings.map((warning) => (
            <p className="s-notice s-notice__warning" role="alert" key={`${warning.code}-${warning.message}`}>
              {warning.message}
            </p>
          ))}
          {needsPartialQualification && (
            <p className="s-notice s-notice__warning" role="alert">
              This decision pack is a partial sample. Qualify its conclusions with that
              limitation before acting.
            </p>
          )}
        </section>
      )}

      <dl className="sme-snapshot" aria-label="Analysis snapshot">
        <SnapshotItem label="Instance" value={pack.snapshot.instanceHost} />
        <SnapshotItem label="Generated" value={pack.snapshot.generatedAt} />
        <SnapshotItem label="Scope" value={pack.snapshot.scopeLabel} />
        <SnapshotItem label="Page size" value={pack.snapshot.pageSize.toLocaleString("en-US")} />
        <SnapshotItem label="Max pages per dataset" value={pack.snapshot.maxPagesPerDataset.toLocaleString("en-US")} />
      </dl>

      <section className="sme-summary" aria-labelledby="sme-summary-heading">
        <h3 id="sme-summary-heading">Executive summary</h3>
        <dl className="sme-kpi-strip">
          {summaryMetrics.map(([label, key]) => (
            <div className="sme-kpi" key={key}>
              <dt>{label}</dt>
              <dd>{pack.summary[key].toLocaleString("en-US")}</dd>
            </div>
          ))}
        </dl>
        <p className="sme-overview">{pack.overview}</p>
      </section>

      <SmeCoverageFindings findings={pack.findings} />
      <SmeCoverageAssessment assessment={pack.assessment} />
      <SmeCoverageMethodology
        methodology={pack.methodology}
        completeness={pack.snapshot.completeness}
      />

      <section className="sme-evidence-section" aria-labelledby="sme-evidence-heading">
        <h3 id="sme-evidence-heading">Evidence</h3>
        <p>Search and sort this view without changing the decision pack or its download order.</p>
        <SmeCoverageEvidenceTable evidence={pack.evidence} />
      </section>

      <div className="sme-result-actions" aria-label="Decision pack actions">
        <button className="s-btn s-btn__outlined" type="button" onClick={() => startDownload("Markdown")}>
          Download Markdown
        </button>
        <button className="s-btn s-btn__outlined" type="button" onClick={() => startDownload("CSV")}>
          Download CSV
        </button>
        <button
          className="s-btn s-btn__filled"
          type="button"
          disabled={runPending}
          onClick={onRunAgain}
        >
          Run again
        </button>
      </div>
      {downloadFeedback.state === "success" && (
        <p className="sme-action-feedback sme-action-feedback__success" role="status">
          {downloadFeedback.message}
        </p>
      )}
      {downloadFeedback.state === "failed" && (
        <p className="sme-action-feedback sme-action-feedback__error" role="alert">
          {downloadFeedback.message}
        </p>
      )}
    </section>
  );
}

function SnapshotItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
