import type { ReactNode } from "react";
import { formatPeriodLabel } from "../domain/reportScope";
import type { PeriodScope, ReportId } from "../domain/types";
import { summarizeCommunityMembers, type CommunityMemberRow } from "../reports/communityMembers";
import { summarizeDataExport } from "../reports/dataExport";
import { buildInteractionSummary, type InteractionEdge } from "../reports/interactions";
import { summarizeInactiveUsers, type InactiveUserRow } from "../reports/inactiveUsers";
import type { MetricCard } from "../reports/reportModels";
import { summarizeTags, type TagMetricRow } from "../reports/tagReport";
import { summarizeUsers, type UserMetricRow } from "../reports/userReport";
import { DashboardCards } from "./DashboardCards";
import { BarList } from "./charts/BarList";
import { InteractionMatrix } from "./charts/InteractionMatrix";

interface ReportDashboardProps {
  reportId: ReportId;
  records: Record<string, unknown>[];
  comparisonRecords?: Record<string, unknown>[];
  currentScope?: PeriodScope;
  comparisonScope?: PeriodScope;
  outputSource?: "live-api" | "upload";
}

export function ReportDashboard({
  reportId,
  records,
  comparisonRecords,
  currentScope,
  comparisonScope,
  outputSource,
}: ReportDashboardProps) {
  const comparisonSection =
    comparisonRecords === undefined
      ? undefined
      : renderComparisonDashboard({
          currentRecords: records,
          comparisonRecords,
          currentScope,
          comparisonScope,
        });

  if (records.length === 0 && comparisonRecords === undefined) {
    return (
      <div className="dashboard-summary">
        <DashboardCards cards={[]} />
      </div>
    );
  }

  if (outputSource === "live-api" && reportId === "interactions") {
    const liveInteractions = records.filter((record) => record.datasetName === "interactions");

    if (liveInteractions.length > 0) {
      return renderInteractionsDashboard(liveInteractions as unknown as InteractionEdge[], comparisonSection);
    }
  }

  if (outputSource === "live-api") {
    const datasetCounts = countBy(records, (record) => String(record.datasetName ?? "unknown"));

    return (
      <DashboardLayout
        cards={[
          { label: "Live Records", value: records.length },
          { label: "Live Datasets", value: Object.keys(datasetCounts).length },
        ]}
        comparisonSection={comparisonSection}
      >
        <DashboardSection title="Live datasets">
          <BarList rows={toBarRows(datasetCounts)} />
        </DashboardSection>
      </DashboardLayout>
    );
  }

  if (reportId === "tag-report") {
    const summary = summarizeTags(records as unknown as TagMetricRow[]);

    return (
      <DashboardLayout cards={summary.metricCards} comparisonSection={comparisonSection}>
        <DashboardSection title="Top tags by page views">
          <BarList
            rows={summary.topTagsByViews.map((row) => ({
              label: row.tagName,
              value: finiteNumber(row.totalPageViews),
            }))}
          />
        </DashboardSection>
      </DashboardLayout>
    );
  }

  if (reportId === "api-user-report") {
    const summary = summarizeUsers(records as unknown as UserMetricRow[]);

    return (
      <DashboardLayout
        cards={[
          { label: "Users", value: summary.totalUsers },
          { label: "Account Statuses", value: Object.keys(summary.accountStatusCounts).length },
          { label: "Departments", value: Object.keys(summary.departmentCounts).length },
        ]}
        comparisonSection={comparisonSection}
      >
        <DashboardSection title="Account status distribution">
          <BarList rows={toBarRows(summary.accountStatusCounts)} />
        </DashboardSection>
        <DashboardSection title="Top contributors by reputation">
          <BarList
            rows={summary.topContributors.map((row) => ({
              label: row.displayName,
              value: finiteNumber(row.netReputation),
            }))}
          />
        </DashboardSection>
      </DashboardLayout>
    );
  }

  if (reportId === "inactive-users") {
    const summary = summarizeInactiveUsers(records as unknown as InactiveUserRow[]);

    return (
      <DashboardLayout
        cards={[
          { label: "Inactive Users", value: summary.totalInactiveUsers },
          { label: "Deactivated", value: summary.deactivatedInactiveUsers },
          { label: "With Contributions", value: summary.contributingInactiveUsers },
          { label: "High Reputation", value: summary.highReputationInactiveUsers },
        ]}
        comparisonSection={comparisonSection}
      >
        <DashboardSection title="Inactive user risk">
          <BarList
            rows={[
              { label: "Deactivated", value: summary.deactivatedInactiveUsers },
              { label: "With contributions", value: summary.contributingInactiveUsers },
              { label: "High reputation", value: summary.highReputationInactiveUsers },
            ]}
          />
        </DashboardSection>
      </DashboardLayout>
    );
  }

  if (reportId === "interactions") {
    return renderInteractionsDashboard(records as unknown as InteractionEdge[], comparisonSection);
  }

  if (reportId === "community-members") {
    const summary = summarizeCommunityMembers(records as unknown as CommunityMemberRow[]);

    return (
      <DashboardLayout
        cards={[
          { label: "Members", value: summary.totalMembers },
          { label: "SMEs", value: summary.smeMembers },
          { label: "Departments", value: Object.keys(summary.departmentCounts).length },
        ]}
        comparisonSection={comparisonSection}
      >
        <DashboardSection title="Department distribution">
          <BarList rows={toBarRows(summary.departmentCounts)} />
        </DashboardSection>
      </DashboardLayout>
    );
  }

  if (reportId === "data-export") {
    const summary = summarizeDataExport({ "Imported records": records });

    return (
      <DashboardLayout
        cards={[{ label: "Imported Records", value: records.length }]}
        comparisonSection={comparisonSection}
      >
        <DashboardSection title="Dataset records">
          <BarList rows={toBarRows(summary.datasetCounts)} />
        </DashboardSection>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout
      cards={[{ label: "Records", value: records.length }]}
      comparisonSection={comparisonSection}
    />
  );
}

function renderInteractionsDashboard(records: InteractionEdge[], comparisonSection?: ReactNode) {
  const summary = buildInteractionSummary(records);

  return (
    <DashboardLayout
      cards={[
        { label: "Departments", value: summary.nodes.length },
        { label: "Interaction Weight", value: summary.totalInteractions },
        { label: "Edges", value: summary.edges.length },
      ]}
      comparisonSection={comparisonSection}
    >
      <DashboardSection title="Top interactions">
        <InteractionMatrix edges={summary.topEdges} />
      </DashboardSection>
    </DashboardLayout>
  );
}

function DashboardLayout({
  cards,
  comparisonSection,
  children,
}: {
  cards: MetricCard[];
  comparisonSection?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="dashboard-summary">
      <DashboardCards cards={cards} />
      {comparisonSection}
      {children}
    </div>
  );
}

function DashboardSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="dashboard-section" aria-labelledby={toSectionId(title)}>
      <h3 className="dashboard-section-title" id={toSectionId(title)}>
        {title}
      </h3>
      {children}
    </section>
  );
}

function toBarRows(counts: Record<string, number>) {
  return Object.entries(counts)
    .map(([label, value]) => ({ label, value: finiteNumber(value) }))
    .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label));
}

function countBy<T>(rows: T[], getKey: (row: T) => string): Record<string, number> {
  return rows.reduce<Record<string, number>>((counts, row) => {
    const key = getKey(row);
    counts[key] = (counts[key] ?? 0) + 1;
    return counts;
  }, {});
}

interface ComparisonDashboardInput {
  currentRecords: Record<string, unknown>[];
  comparisonRecords: Record<string, unknown>[];
  currentScope?: PeriodScope;
  comparisonScope?: PeriodScope;
}

function renderComparisonDashboard({
  currentRecords,
  comparisonRecords,
  currentScope,
  comparisonScope,
}: ComparisonDashboardInput) {
  const rows = buildComparisonRows(currentRecords, comparisonRecords);

  return (
    <DashboardSection title="Period comparison">
      <DashboardCards
        cards={[
          { label: "Current Records", value: currentRecords.length },
          { label: "Comparison Records", value: comparisonRecords.length },
          { label: "Change", value: formatDelta(currentRecords.length - comparisonRecords.length) },
        ]}
      />
      <div className="comparison-scope-grid">
        <div className="comparison-scope-item">
          <span>Current period</span>
          <strong>{formatPeriodLabel(currentScope ?? {})}</strong>
        </div>
        <div className="comparison-scope-item">
          <span>Comparison period</span>
          <strong>{formatPeriodLabel(comparisonScope ?? {})}</strong>
        </div>
      </div>
      <div className="comparison-table-wrap">
        <table className="comparison-table">
          <thead>
            <tr>
              <th scope="col">Dataset</th>
              <th scope="col">Current</th>
              <th scope="col">Comparison</th>
              <th scope="col">Change</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.label}>
                <td>{row.label}</td>
                <td>{row.current}</td>
                <td>{row.comparison}</td>
                <td>{formatDelta(row.delta)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </DashboardSection>
  );
}

function buildComparisonRows(
  currentRecords: Record<string, unknown>[],
  comparisonRecords: Record<string, unknown>[],
) {
  const currentCounts = countBy(currentRecords, getComparisonGroup);
  const comparisonCounts = countBy(comparisonRecords, getComparisonGroup);
  const labels = new Set([...Object.keys(currentCounts), ...Object.keys(comparisonCounts)]);

  return [...labels]
    .map((label) => {
      const current = currentCounts[label] ?? 0;
      const comparison = comparisonCounts[label] ?? 0;

      return {
        label,
        current,
        comparison,
        delta: current - comparison,
      };
    })
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta) || b.current - a.current || a.label.localeCompare(b.label));
}

function getComparisonGroup(record: Record<string, unknown>): string {
  return String(record.datasetName ?? "Records");
}

function formatDelta(delta: number): string {
  if (delta > 0) return `+${delta.toLocaleString("en-US")}`;
  return delta.toLocaleString("en-US");
}

function toSectionId(title: string) {
  return `dashboard-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;
}

function finiteNumber(value: number | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}
