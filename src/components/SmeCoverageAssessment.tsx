import { useState } from "react";
import {
  formatSmeCoverageAssessmentMarkdown,
  type SmeCoverageAssessmentBrief,
  type SmeCoverageAssessmentItem,
} from "../utilities/smeCoverage/assessmentBrief";

interface SmeCoverageAssessmentProps {
  brief: SmeCoverageAssessmentBrief;
}

type CopyState = "idle" | "copied" | "failed";

export function SmeCoverageAssessment({ brief }: SmeCoverageAssessmentProps) {
  const [copyState, setCopyState] = useState<CopyState>("idle");

  async function copyAssessment() {
    try {
      if (!navigator.clipboard) throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(formatSmeCoverageAssessmentMarkdown(brief));
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
  }

  return (
    <section className="sme-assessment" aria-labelledby="sme-assessment-heading">
      <div className="sme-section-header">
        <h3 id="sme-assessment-heading">Copy-ready assessment</h3>
        <button className="s-btn s-btn__outlined" type="button" onClick={copyAssessment}>
          Copy assessment
        </button>
      </div>
      <div className="sme-assessment-content" data-testid="assessment-content">
        <section className="sme-assessment-block">
          <h4>Bottom line</h4>
          <p>{brief.bottomLine}</p>
        </section>
        {brief.sections.map((section) => (
          <section className="sme-assessment-block" key={section.heading}>
            <h4>{section.heading}</h4>
            <ul className="sme-assessment-list">
              {section.items.map((item) => (
                <li key={`${section.heading}:${item.tagName}`}>
                  <div className="sme-assessment-item-heading">
                    <strong>{item.tagName}</strong>
                    <span>{formatAssessmentMetrics(item)}</span>
                  </div>
                  <p>{item.recommendedAction}</p>
                </li>
              ))}
            </ul>
            {section.omittedCount > 0 && (
              <p className="sme-assessment-omitted">
                {section.omittedCount.toLocaleString("en-US")} additional {section.omittedCount === 1 ? "priority is" : "priorities are"} available in the evidence CSV.
              </p>
            )}
          </section>
        ))}
        <section className="sme-assessment-block">
          <h4>Recommended next step</h4>
          <p>{brief.recommendedNextStep}</p>
        </section>
        <div className="sme-assessment-meta">
          <span>Evidence quality: <strong>{brief.evidenceQuality}</strong></span>
          <span>Full evidence: {brief.fullEvidenceNote}</span>
        </div>
      </div>
      {copyState === "copied" && (
        <p className="sme-action-feedback sme-action-feedback__success" role="status">
          Assessment copied to the clipboard.
        </p>
      )}
      {copyState === "failed" && (
        <p className="sme-action-feedback sme-action-feedback__error" role="alert">
          The assessment could not be copied. Select the assessment and copy it manually.
        </p>
      )}
    </section>
  );
}

function formatAssessmentMetrics(item: SmeCoverageAssessmentItem): string {
  return `${formatMetric(item.pageViews, "page view")} · ${formatMetric(item.smeCount, "SME")}`;
}

function formatMetric(value: number | null, label: string): string {
  if (value === null) return `${label} count unavailable`;
  return `${value.toLocaleString("en-US", { maximumFractionDigits: 0 })} ${label}${value === 1 ? "" : "s"}`;
}
