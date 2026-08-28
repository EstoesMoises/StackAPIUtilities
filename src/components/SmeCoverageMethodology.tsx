import { useId } from "react";
import type { SmeCoverageCompleteness, SmeCoverageMethodology as Methodology } from "../utilities/smeCoverage/model";
import { formatDisplayedRatio } from "../utilities/smeCoverage/narrative";

interface SmeCoverageMethodologyProps {
  methodology: Methodology;
  completeness: SmeCoverageCompleteness;
  standalone?: boolean;
}

export function SmeCoverageMethodology({
  methodology,
  completeness,
  standalone = false,
}: SmeCoverageMethodologyProps) {
  const headingId = useId();
  const body = <MethodologyBody methodology={methodology} completeness={completeness} />;

  if (standalone) {
    return (
      <section
        className="sme-methodology sme-methodology__standalone"
        aria-labelledby={headingId}
      >
        <h3 id={headingId}>Methodology and evidence quality</h3>
        {body}
      </section>
    );
  }

  return (
    <details className="sme-methodology">
      <summary>Methodology and evidence quality</summary>
      {body}
    </details>
  );
}

function MethodologyBody({
  methodology,
  completeness,
}: Pick<SmeCoverageMethodologyProps, "methodology" | "completeness">) {
  return (
    <div className="sme-methodology-content">
      <dl>
        <MethodRow
          label="Active-tag rule"
          value={`At least ${methodology.activityQuestionMinimum} question or more than ${methodology.activityPageViewThresholdExclusive} page views`}
        />
        <MethodRow label="Coverage ratio" value={methodology.ratioFormula} />
        <MethodRow label="Active-tag median page views" value={formatMethodValue(methodology.activeTagMedianPageViews)} />
        <MethodRow label="Eligible covered active-tag sample size" value={methodology.coveredActiveSampleSize.toLocaleString("en-US")} />
        <MethodRow label="P75 page views per SME" value={formatThreshold(methodology.p75PageViewsPerSme)} />
        <MethodRow label="P90 page views per SME" value={formatThreshold(methodology.p90PageViewsPerSme)} />
        <MethodRow label="Display rounding" value={methodology.roundingRule} />
        <MethodRow label="Analysis quality" value={completeness} />
      </dl>
      <p>
        Prepared P75 and P90 thresholds use the nearest-rank method; evidence rows report an
        empirical-percentile position within the eligible covered active-tag sample.
      </p>
      <p>
        <strong>Question-count precedence:</strong> Complete question enumeration, then All-time
        tag total, then Partial question sample; otherwise Unavailable.
      </p>
      <p>
        Complete, Partial, and Empty are analysis-quality states independent of collection
        status. Complete means every evidence row has complete demand and SME evidence and the
        percentile sample is sufficient. Partial means at least one evidence row or percentile
        calculation is incomplete; review the evidence notes before qualifying conclusions.
        Empty means no evidence rows were available, so no evidence conclusion was produced.
      </p>
    </div>
  );
}

function MethodRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function formatMethodValue(value: number | null): string {
  return value === null
    ? "Not calculated"
    : value.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

function formatThreshold(value: number | null): string {
  return value === null ? "Not calculated" : formatDisplayedRatio(value);
}
