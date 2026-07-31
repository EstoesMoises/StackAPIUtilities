import type { SmeCoverageCompleteness, SmeCoverageMethodology as Methodology } from "../utilities/smeCoverage/model";

interface SmeCoverageMethodologyProps {
  methodology: Methodology;
  completeness: SmeCoverageCompleteness;
}

export function SmeCoverageMethodology({ methodology, completeness }: SmeCoverageMethodologyProps) {
  return (
    <details className="sme-methodology">
      <summary>Methodology and completeness notes</summary>
      <div className="sme-methodology-content">
        <dl>
          <MethodRow
            label="Active-tag rule"
            value={`At least ${methodology.activityQuestionMinimum} question or more than ${methodology.activityPageViewThresholdExclusive} page views`}
          />
          <MethodRow label="Coverage ratio" value={methodology.ratioFormula} />
          <MethodRow label="Active-tag median page views" value={formatMethodValue(methodology.activeTagMedianPageViews)} />
          <MethodRow label="Eligible covered active-tag sample size" value={methodology.coveredActiveSampleSize.toLocaleString("en-US")} />
          <MethodRow label="P75 page views per SME" value={formatMethodValue(methodology.p75PageViewsPerSme)} />
          <MethodRow label="P90 page views per SME" value={formatMethodValue(methodology.p90PageViewsPerSme)} />
          <MethodRow label="Display rounding" value={methodology.roundingRule} />
          <MethodRow label="Result completeness" value={completeness} />
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
          Complete, Partial, and Empty are distinct result states. Partial results require the
          warnings above to qualify conclusions; Empty results contain no evidence conclusion.
        </p>
      </div>
    </details>
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
