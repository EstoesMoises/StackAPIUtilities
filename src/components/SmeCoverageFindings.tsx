import type { SmeCoverageDecisionPack, SmeCoverageEvidenceRow } from "../utilities/smeCoverage/model";
import { formatDisplayedRatio } from "../utilities/smeCoverage/narrative";

interface SmeCoverageFindingsProps {
  findings: SmeCoverageDecisionPack["findings"];
}

const findingSections = [
  {
    key: "immediateGaps",
    heading: "Immediate no-SME risks",
    emptyMessage: "No immediate no-SME risks are listed in this decision pack.",
  },
  {
    key: "criticalUnderCoverage",
    heading: "Highest-demand critical gaps",
    emptyMessage: "No highest-demand critical gaps are listed in this decision pack.",
  },
  {
    key: "lightCoverage",
    heading: "Light SME coverage",
    emptyMessage: "No light SME coverage risks are listed in this decision pack.",
  },
] as const;

export function SmeCoverageFindings({ findings }: SmeCoverageFindingsProps) {
  return (
    <div className="sme-findings">
      {findingSections.map((section) => (
        <FindingTable
          key={section.key}
          heading={section.heading}
          emptyMessage={section.emptyMessage}
          rows={findings[section.key]}
        />
      ))}
    </div>
  );
}

interface FindingTableProps {
  heading: string;
  emptyMessage: string;
  rows: readonly SmeCoverageEvidenceRow[];
}

function FindingTable({ heading, emptyMessage, rows }: FindingTableProps) {
  const headingId = `sme-finding-${heading.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  return (
    <section className="sme-finding-section" role="region" aria-labelledby={headingId}>
      <h3 id={headingId}>{heading}</h3>
      {rows.length === 0 ? (
        <p className="sme-empty-state">{emptyMessage}</p>
      ) : (
        <div className="sme-finding-table-wrap" role="region" aria-label={`${heading} table`} tabIndex={0}>
          <table className="s-table sme-finding-table">
            <thead>
              <tr>
                {[
                  "Tag",
                  "Page views",
                  "SMEs",
                  "Questions",
                  "Question-count basis",
                  "Page views per SME",
                  "Tier reason",
                  "Recommended next action",
                ].map((label) => (
                  <th key={label} scope="col">{label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.tagName}>
                  <td><strong>{row.tagName}</strong></td>
                  <td>{formatNumber(row.pageViews)}</td>
                  <td>{formatSmeCount(row.smeCount)}</td>
                  <td>{formatNumber(row.questionCount)}</td>
                  <td>{row.questionCountBasis}</td>
                  <td>{row.pageViewsPerSme === null ? "Unavailable" : formatDisplayedRatio(row.pageViewsPerSme)}</td>
                  <td>{row.reason}</td>
                  <td>{row.recommendedAction}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
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
