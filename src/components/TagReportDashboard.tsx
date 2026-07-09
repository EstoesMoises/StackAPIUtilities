import type { ReactNode } from "react";
import { formatPeriodLabel } from "../domain/reportScope";
import type { PeriodScope } from "../domain/types";
import type {
  TagActionQueueRow,
  TagHealthComparisonSummary,
  TagHealthStatus,
  TagHealthSummary,
  TagStatusDistributionRow,
} from "../reports/tagReport";
import { BarList } from "./charts/BarList";

interface TagReportDashboardProps {
  summary: TagHealthSummary;
  currentScope?: PeriodScope;
  comparisonScope?: PeriodScope;
}

export function TagReportDashboard({ summary, currentScope, comparisonScope }: TagReportDashboardProps) {
  const currentPeriod = formatPeriodLabel(currentScope ?? {});
  const comparisonPeriod = summary.comparison ? formatPeriodLabel(comparisonScope ?? {}) : undefined;

  return (
    <div className="tag-dashboard" aria-labelledby="tag-dashboard-title">
      <header className="tag-dashboard-header">
        <div className="tag-dashboard-title">
          <p className="tag-dashboard-subtitle">Tag Health operations</p>
          <h3 id="tag-dashboard-title">Tag Health Dashboard</h3>
          <p className="tag-dashboard-copy">
            Current period: <strong>{currentPeriod}</strong>
            {comparisonPeriod ? (
              <>
                {" "}
                <span aria-hidden="true">/</span> Compared with: <strong>{comparisonPeriod}</strong>
              </>
            ) : null}
          </p>
        </div>
        <span className="tag-dashboard-pill">CSV aligned</span>
      </header>

      <TagMetricStrip summary={summary} />

      <div className="tag-dashboard-grid tag-dashboard-grid__primary">
        <DashboardPanel title="Status distribution">
          <TagStatusDistribution rows={summary.statusDistribution} />
        </DashboardPanel>
        {summary.comparison ? (
          <TagComparisonPanel
            comparison={summary.comparison}
            currentScope={currentScope}
            comparisonScope={comparisonScope}
          />
        ) : (
          <TagOverviewNote summary={summary} currentScope={currentScope} />
        )}
      </div>

      <DashboardPanel title="Top tags by page views">
        <BarList
          rows={summary.topTagsByViews.map((row) => ({
            label: row.tag_name,
            value: finiteNumber(row.page_views),
          }))}
        />
      </DashboardPanel>

      <div className="tag-dashboard-grid">
        <TagQueuePanel
          title="SME coverage queue"
          rows={summary.smeCoverageQueue}
          emptyMessage="No tags need SME coverage."
        />
        <TagQueuePanel
          title="Response attention queue"
          rows={summary.responseAttentionQueue}
          emptyMessage="No tags need response attention."
        />
      </div>
    </div>
  );
}

function TagMetricStrip({ summary }: { summary: TagHealthSummary }) {
  return (
    <dl className="tag-kpi-grid" aria-label="Tag Health metrics">
      {summary.metricCards.map((card) => (
        <div className="tag-kpi" key={card.label}>
          <dt>{card.label}</dt>
          <dd>{formatMetricValue(card.value)}</dd>
          {card.delta === undefined ? null : (
            <span className={`tag-kpi-delta tag-delta tag-delta__${card.deltaTone ?? "neutral"}`}>
              {formatDelta(card.delta)}
            </span>
          )}
        </div>
      ))}
    </dl>
  );
}

function TagStatusDistribution({ rows }: { rows: TagStatusDistributionRow[] }) {
  const total = rows.reduce((sum, row) => sum + finiteNumber(row.count), 0);

  return (
    <div className="tag-status-distribution">
      <div
        aria-hidden="true"
        className="tag-status-donut"
        style={{ background: buildDistributionGradient(rows) }}
      />
      <ul className="tag-status-legend">
        {rows.map((row) => (
          <li className="tag-status-row" key={row.status}>
            <span className={`tag-status-dot ${getStatusClass(row.status)}`} />
            <span>{row.status}</span>
            <strong>{formatMetricValue(row.count)}</strong>
            {row.delta === undefined ? null : (
              <span className={`tag-inline-delta tag-delta tag-delta__${row.deltaTone ?? "neutral"}`}>
                {formatDelta(row.delta)}
              </span>
            )}
          </li>
        ))}
      </ul>
      <p className="tag-dashboard-copy">
        {formatMetricValue(total)} {total === 1 ? "tag" : "tags"} in the current period.
      </p>
    </div>
  );
}

function TagOverviewNote({ summary, currentScope }: { summary: TagHealthSummary; currentScope?: PeriodScope }) {
  const smeQueueCount = summary.smeCoverageQueue.length;
  const responseQueueCount = summary.responseAttentionQueue.length;
  const tagsCovered = summary.metricCards[0]?.value ?? 0;
  const tagsCoveredCount = typeof tagsCovered === "number" ? finiteNumber(tagsCovered) : undefined;

  return (
    <DashboardPanel title="Current-period context">
      <p className="tag-dashboard-copy">
        Showing {formatMetricValue(tagsCovered)} {tagsCoveredCount === 1 ? "tag" : "tags"} for{" "}
        <strong>{formatPeriodLabel(currentScope ?? {})}</strong>. The active queues contain{" "}
        <strong>{formatMetricValue(smeQueueCount)}</strong> SME coverage{" "}
        {smeQueueCount === 1 ? "gap" : "gaps"} and <strong>{formatMetricValue(responseQueueCount)}</strong>{" "}
        response {responseQueueCount === 1 ? "item" : "items"}.
      </p>
    </DashboardPanel>
  );
}

function TagComparisonPanel({
  comparison,
  currentScope,
  comparisonScope,
}: {
  comparison: TagHealthComparisonSummary;
  currentScope?: PeriodScope;
  comparisonScope?: PeriodScope;
}) {
  return (
    <DashboardPanel title="Period comparison">
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
      <div className="tag-comparison-table-wrap">
        <table className="tag-comparison-table">
          <thead>
            <tr>
              <th scope="col">Health status</th>
              <th scope="col">Current</th>
              <th scope="col">Comparison</th>
              <th scope="col">Change</th>
            </tr>
          </thead>
          <tbody>
            {comparison.statusRows.map((row) => (
              <tr key={row.status}>
                <td>{row.status}</td>
                <td>{formatMetricValue(row.current)}</td>
                <td>{formatMetricValue(row.comparison)}</td>
                <td>
                  <span className={`tag-inline-delta tag-delta tag-delta__${row.deltaTone}`}>
                    {formatDelta(row.delta)}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {comparison.fastestChanges.length === 0 ? null : (
        <div className="tag-comparison-table-wrap">
          <table className="tag-comparison-table">
            <thead>
              <tr>
                <th scope="col">Tag</th>
                <th scope="col">Metric</th>
                <th scope="col">Current</th>
                <th scope="col">Comparison</th>
                <th scope="col">Change</th>
              </tr>
            </thead>
            <tbody>
              {comparison.fastestChanges.map((row) => (
                <tr key={`${row.tagName}-${row.metric}`}>
                  <td>{row.tagName}</td>
                  <td>{row.metric}</td>
                  <td>{formatMetricValue(row.current)}</td>
                  <td>{formatMetricValue(row.comparison)}</td>
                  <td>
                    <span className={`tag-inline-delta tag-delta tag-delta__${row.deltaTone}`}>
                      {formatDelta(row.delta)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </DashboardPanel>
  );
}

function TagQueuePanel({
  title,
  rows,
  emptyMessage,
}: {
  title: string;
  rows: TagActionQueueRow[];
  emptyMessage: string;
}) {
  const primaryMetricLabel = rows[0]?.primaryMetricLabel ?? "Primary";
  const secondaryMetricLabel = rows[0]?.secondaryMetricLabel ?? "Secondary";

  return (
    <DashboardPanel title={title}>
      {rows.length === 0 ? (
        <div className="dashboard-empty">{emptyMessage}</div>
      ) : (
        <div className="tag-queue-table-wrap">
          <table className="tag-queue-table">
            <thead>
              <tr>
                <th scope="col">Tag</th>
                <th aria-label={primaryMetricLabel} scope="col">
                  {primaryMetricLabel}
                </th>
                <th aria-label={secondaryMetricLabel} scope="col">
                  {secondaryMetricLabel}
                </th>
                <th scope="col">Recommended action</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const primaryValue = formatQueueValue(row.primaryMetricLabel, row.primaryMetricValue);
                const secondaryValue = formatQueueValue(row.secondaryMetricLabel, row.secondaryMetricValue);

                return (
                  <tr aria-label={`${row.tagName} ${primaryValue} ${secondaryValue}`} key={row.tagName}>
                    <td>{row.tagName}</td>
                    <td>{primaryValue}</td>
                    <td>{secondaryValue}</td>
                    <td>{row.recommendedAction}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </DashboardPanel>
  );
}

function DashboardPanel({ title, children }: { title: string; children: ReactNode }) {
  const panelId = toPanelId(title);

  return (
    <section className="tag-dashboard-panel" aria-labelledby={panelId}>
      <h4 id={panelId}>{title}</h4>
      {children}
    </section>
  );
}

function buildDistributionGradient(rows: TagStatusDistributionRow[]): string {
  const total = rows.reduce((sum, row) => sum + finiteNumber(row.count), 0);
  if (total === 0) return "var(--so-canvas-2)";

  let cursor = 0;
  const segments = rows
    .filter((row) => finiteNumber(row.count) > 0)
    .map((row) => {
      const start = (cursor / total) * 100;
      cursor += finiteNumber(row.count);
      const end = (cursor / total) * 100;
      return `${getStatusColor(row.status)} ${start.toFixed(2)}% ${end.toFixed(2)}%`;
    });

  return `conic-gradient(${segments.join(", ")})`;
}

function getStatusColor(status: TagHealthStatus): string {
  switch (status) {
    case "Healthy":
      return "var(--so-green)";
    case "Needs SME coverage":
      return "var(--so-yellow)";
    case "Needs response attention":
      return "var(--so-red)";
    case "Low activity":
      return "var(--so-blue)";
  }
}

function getStatusClass(status: TagHealthStatus): string {
  return `tag-status-dot__${status.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;
}

function formatMetricValue(value: number | string): string {
  if (typeof value === "string") return value;
  return finiteNumber(value).toLocaleString("en-US", { maximumFractionDigits: 2 });
}

function formatDelta(delta: number): string {
  if (delta > 0) return `+${formatMetricValue(delta)}`;
  return formatMetricValue(delta);
}

function formatQueueValue(label: string, value: number): string {
  const formattedValue = formatMetricValue(finiteNumber(value));
  return label === "Median first answer" ? `${formattedValue}h` : formattedValue;
}

function finiteNumber(value: number | undefined): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function toPanelId(title: string): string {
  return `tag-panel-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;
}
