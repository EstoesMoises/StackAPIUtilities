import { useState } from "react";

interface SmeCoverageAssessmentProps {
  assessment: string;
}

type CopyState = "idle" | "copied" | "failed";

export function SmeCoverageAssessment({ assessment }: SmeCoverageAssessmentProps) {
  const [copyState, setCopyState] = useState<CopyState>("idle");

  async function copyAssessment() {
    try {
      if (!navigator.clipboard) throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(assessment);
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
        {assessment.split(/\n\s*\n/).map((paragraph, index) => (
          <p key={`${index}-${paragraph.slice(0, 24)}`}>{paragraph}</p>
        ))}
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
