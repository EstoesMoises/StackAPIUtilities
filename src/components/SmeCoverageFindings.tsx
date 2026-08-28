import { useState } from "react";
import type { ReportFinding } from "../reports/reportPresentation";
import type {
  CoverageTier,
  SmeCoverageEvidenceRow,
} from "../utilities/smeCoverage/model";

interface SmeCoverageFindingsProps {
  findings: readonly ReportFinding<SmeCoverageEvidenceRow>[];
}

type FindingTier = Extract<
  CoverageTier,
  "Immediate gap" | "Critical under-coverage" | "Light coverage"
>;
type PriorityFilter = "All priorities" | FindingTier;

const priorityTiers: readonly FindingTier[] = [
  "Immediate gap",
  "Critical under-coverage",
  "Light coverage",
];

export function SmeCoverageFindings({ findings }: SmeCoverageFindingsProps) {
  const [filter, setFilter] = useState<PriorityFilter>("All priorities");
  const visibleFindings = findings
    .map((finding, sourceIndex) => ({ finding, sourceIndex }))
    .filter(({ finding }) => filter === "All priorities" || finding.tier === filter);

  return (
    <section className="sme-findings" aria-labelledby="sme-priority-findings-heading">
      <div className="sme-finding-header">
        <div>
          <h3 id="sme-priority-findings-heading">Priority findings</h3>
          <p>{formatPreparedPriorityCount(findings.length)}</p>
        </div>
        <label className="sme-finding-filter">
          <span>Priority tier</span>
          <select
            className="s-select"
            value={filter}
            onChange={(event) => setFilter(event.currentTarget.value as PriorityFilter)}
          >
            <option>All priorities</option>
            {priorityTiers.map((tier) => (
              <option key={tier}>{tier}</option>
            ))}
          </select>
        </label>
      </div>

      {findings.length === 0 ? (
        <p className="sme-empty-state">No priority findings are in this decision pack.</p>
      ) : (
        <div
          className="sme-finding-table-wrap"
          role="region"
          aria-label="Priority findings table"
          tabIndex={0}
        >
          {visibleFindings.length === 0 ? (
            <p className="sme-finding-filter-empty">
              No prepared priorities match {filter}.
            </p>
          ) : (
            <table className="s-table sme-finding-table">
              <thead>
                <tr>
                  {[
                    "Priority",
                    "Tag",
                    "Why it matters",
                    "SMEs",
                    "Demand",
                    "Recommended action",
                  ].map((label) => (
                    <th key={label} scope="col">{label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visibleFindings.map(({ finding, sourceIndex }) => {
                  const { tier, evidence } = finding;
                  return (
                    <tr key={`${tier}:${evidence.tagName}:${sourceIndex}`}>
                      <td>
                        <span className={`sme-tier-badge sme-tier-badge__${tierClass(tier)}`}>
                          {tier}
                        </span>
                      </td>
                      <td><strong>{evidence.tagName}</strong></td>
                      <td>{evidence.reason}</td>
                      <td>{formatSmeCount(evidence.smeCount)}</td>
                      <td>{formatNumber(evidence.pageViews)}</td>
                      <td>{evidence.recommendedAction}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}
    </section>
  );
}

function formatPreparedPriorityCount(count: number): string {
  return `${count.toLocaleString("en-US")} prepared ${count === 1 ? "priority" : "priorities"}`;
}

function formatNumber(value: number | null): string {
  return value === null
    ? "Unavailable"
    : value.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

function formatSmeCount(value: number | null): string {
  if (value === null) return "Unavailable";
  if (value === 0) return "No SME";
  return value.toLocaleString("en-US");
}

function tierClass(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-");
}
