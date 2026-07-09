# Tag Report Dashboard Hybrid Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the approved Tag Report hybrid dashboard: an operations overview with comparison-aware KPI deltas, status movement, fastest changes, and action queues.

**Architecture:** Keep all Tag Health derivation in `src/reports/tagReport.ts` and keep React focused on rendering prepared summaries. Add a focused `src/components/TagReportDashboard.tsx` so the specialized dashboard does not make the generic `ReportDashboard.tsx` harder to maintain. Reuse existing CSS variables, product panel vocabulary, and `BarList` where it remains the right primitive.

**Tech Stack:** Next.js 14, React 18, TypeScript, Vitest, Testing Library, existing CSS in `src/styles/app.css`.

---

## File Structure

- Modify `src/reports/tagReport.ts`: extend Tag Health summary types, calculate dashboard KPIs, status distribution, queues, comparison status rows, and fastest-change rows.
- Modify `src/reports/reportTransforms.test.ts`: add TDD coverage for the richer Tag Health summary.
- Create `src/components/TagReportDashboard.tsx`: render the approved hybrid dashboard using prepared summary data.
- Modify `src/components/ReportDashboard.tsx`: delegate Tag Report rendering to `TagReportDashboard` and pass normalized comparison rows into `summarizeTagHealthRows`.
- Modify `src/components/ReportDashboard.test.tsx`: update Tag Report dashboard expectations for the hybrid dashboard.
- Modify `src/styles/app.css`: add responsive dashboard panel, KPI delta, status distribution, comparison, queue, and fastest-change styles.

## Task 1: Extend Tag Health Summary Transform

**Files:**
- Modify: `src/reports/tagReport.ts`
- Test: `src/reports/reportTransforms.test.ts`

- [ ] **Step 1: Write failing transform tests**

Add these imports in `src/reports/reportTransforms.test.ts`:

```ts
import type { TagHealthRow } from "./tagReport";
```

Add these tests near the existing Tag Health summary tests:

```ts
it("summarizes Tag Health rows with dashboard distribution and action queues", () => {
  const summary = summarizeTagHealthRows([
    tagHealthRow({
      tag_name: "python",
      health_status: "Needs response attention",
      page_views: 500,
      question_count: 8,
      answer_count: 11,
      sme_count: 2,
      watcher_count: 20,
      unanswered_questions: 3,
      median_first_answer_hours: 36,
      recommended_action: "Review unanswered questions and response time for this tag.",
    }),
    tagHealthRow({
      tag_name: "react",
      health_status: "Needs SME coverage",
      page_views: 450,
      question_count: 6,
      answer_count: 4,
      sme_count: 0,
      watcher_count: 12,
      unanswered_questions: 0,
      median_first_answer_hours: 8,
      recommended_action: "Assign or confirm SMEs for this tag.",
    }),
    tagHealthRow({
      tag_name: "r",
      health_status: "Healthy",
      page_views: 250,
      question_count: 5,
      answer_count: 8,
      sme_count: 1,
      watcher_count: 12,
      unanswered_questions: 0,
      median_first_answer_hours: 5,
      recommended_action: "Maintain current coverage and response habits.",
    }),
  ]);

  expect(summary.totalQuestions).toBe(19);
  expect(summary.metricCards).toEqual([
    { label: "Tags Covered", value: 3 },
    { label: "Healthy Tags", value: 1 },
    { label: "SME Gaps", value: 1 },
    { label: "Response Attention", value: 1 },
    { label: "Questions", value: 19 },
  ]);
  expect(summary.statusDistribution.map((row) => [row.status, row.count])).toEqual([
    ["Healthy", 1],
    ["Needs SME coverage", 1],
    ["Needs response attention", 1],
    ["Low activity", 0],
  ]);
  expect(summary.smeCoverageQueue).toEqual([
    {
      tagName: "react",
      primaryMetricLabel: "Questions",
      primaryMetricValue: 6,
      secondaryMetricLabel: "SMEs",
      secondaryMetricValue: 0,
      recommendedAction: "Assign or confirm SMEs for this tag.",
    },
  ]);
  expect(summary.responseAttentionQueue).toEqual([
    {
      tagName: "python",
      primaryMetricLabel: "Unanswered",
      primaryMetricValue: 3,
      secondaryMetricLabel: "Median first answer",
      secondaryMetricValue: 36,
      recommendedAction: "Review unanswered questions and response time for this tag.",
    },
  ]);
});

it("summarizes Tag Health comparison rows for KPI deltas, status movement, and fastest changes", () => {
  const summary = summarizeTagHealthRows(
    [
      tagHealthRow({
        tag_name: "python",
        health_status: "Needs response attention",
        page_views: 900,
        question_count: 10,
        answer_count: 8,
        sme_count: 1,
        watcher_count: 10,
        unanswered_questions: 6,
        median_first_answer_hours: 30,
        recommended_action: "Review unanswered questions and response time for this tag.",
      }),
      tagHealthRow({
        tag_name: "react",
        health_status: "Healthy",
        page_views: 500,
        question_count: 4,
        answer_count: 8,
        sme_count: 2,
        watcher_count: 8,
        unanswered_questions: 0,
        median_first_answer_hours: 4,
        recommended_action: "Maintain current coverage and response habits.",
      }),
    ],
    [
      tagHealthRow({
        tag_name: "python",
        health_status: "Healthy",
        page_views: 700,
        question_count: 8,
        answer_count: 8,
        sme_count: 1,
        watcher_count: 9,
        unanswered_questions: 1,
        median_first_answer_hours: 6,
        recommended_action: "Maintain current coverage and response habits.",
      }),
      tagHealthRow({
        tag_name: "react",
        health_status: "Needs SME coverage",
        page_views: 550,
        question_count: 5,
        answer_count: 5,
        sme_count: 0,
        watcher_count: 8,
        unanswered_questions: 0,
        median_first_answer_hours: 5,
        recommended_action: "Assign or confirm SMEs for this tag.",
      }),
    ],
  );

  expect(summary.metricCards).toContainEqual({
    label: "Response Attention",
    value: 1,
    delta: 1,
    deltaTone: "bad",
  });
  expect(summary.metricCards).toContainEqual({
    label: "SME Gaps",
    value: 0,
    delta: -1,
    deltaTone: "good",
  });
  expect(summary.comparison?.statusRows).toEqual([
    { status: "Healthy", current: 1, comparison: 1, delta: 0, deltaTone: "neutral" },
    { status: "Needs SME coverage", current: 0, comparison: 1, delta: -1, deltaTone: "good" },
    { status: "Needs response attention", current: 1, comparison: 0, delta: 1, deltaTone: "bad" },
    { status: "Low activity", current: 0, comparison: 0, delta: 0, deltaTone: "neutral" },
  ]);
  expect(summary.comparison?.fastestChanges[0]).toMatchObject({
    tagName: "python",
    metric: "Unanswered questions",
    current: 6,
    comparison: 1,
    delta: 5,
    deltaTone: "bad",
  });
});

function tagHealthRow(overrides: Partial<TagHealthRow>): TagHealthRow {
  return {
    tag_name: "tag",
    health_status: "Healthy",
    page_views: 0,
    question_count: 0,
    answer_count: 0,
    sme_count: 0,
    watcher_count: 0,
    unanswered_questions: 0,
    median_first_answer_hours: 0,
    recommended_action: "Maintain current coverage and response habits.",
    ...overrides,
  };
}
```

Update the existing `summarizes Tag Health rows for dashboard-ready metrics and slices` expectation so it matches the new KPI label:

```ts
expect(summary.metricCards).toContainEqual({ label: "SME Gaps", value: 1 });
```

- [ ] **Step 2: Run transform tests and verify failure**

Run:

```bash
pnpm test src/reports/reportTransforms.test.ts -t "Tag Health"
```

Expected: FAIL because `totalQuestions`, `statusDistribution`, `smeCoverageQueue`, `responseAttentionQueue`, `comparison`, and delta fields do not exist yet.

- [ ] **Step 3: Add summary types and helper constants**

In `src/reports/tagReport.ts`, extend the existing summary types:

```ts
export type TagDashboardDeltaTone = "good" | "bad" | "neutral";

export interface TagDashboardMetricCard extends MetricCard {
  delta?: number;
  deltaTone?: TagDashboardDeltaTone;
}

export interface TagStatusDistributionRow {
  status: TagHealthStatus;
  count: number;
  comparisonCount?: number;
  delta?: number;
  deltaTone?: TagDashboardDeltaTone;
}

export interface TagActionQueueRow {
  tagName: string;
  primaryMetricLabel: string;
  primaryMetricValue: number;
  secondaryMetricLabel: string;
  secondaryMetricValue: number;
  recommendedAction: string;
}

export interface TagHealthComparisonStatusRow {
  status: TagHealthStatus;
  current: number;
  comparison: number;
  delta: number;
  deltaTone: TagDashboardDeltaTone;
}

export interface TagFastestChangeRow {
  tagName: string;
  metric: string;
  current: number;
  comparison: number;
  delta: number;
  deltaTone: TagDashboardDeltaTone;
}

export interface TagHealthComparisonSummary {
  statusRows: TagHealthComparisonStatusRow[];
  fastestChanges: TagFastestChangeRow[];
}
```

Update `TagHealthSummary`:

```ts
export interface TagHealthSummary {
  metricCards: TagDashboardMetricCard[];
  totalQuestions: number;
  healthStatusCounts: Record<TagHealthStatus, number>;
  statusDistribution: TagStatusDistributionRow[];
  topTagsByViews: TagHealthRow[];
  tagsNeedingResponse: TagHealthRow[];
  tagsNeedingSmeCoverage: TagHealthRow[];
  smeCoverageQueue: TagActionQueueRow[];
  responseAttentionQueue: TagActionQueueRow[];
  comparison?: TagHealthComparisonSummary;
}
```

- [ ] **Step 4: Implement dashboard summary helpers**

In `src/reports/tagReport.ts`, update `summarizeTagHealthRows` to accept optional comparison rows:

```ts
export function summarizeTagHealthRows(
  rows: readonly TagHealthRow[],
  comparisonRows?: readonly TagHealthRow[],
): TagHealthSummary {
  const healthStatusCounts = countHealthStatuses(rows);
  const comparisonHealthStatusCounts = comparisonRows === undefined ? undefined : countHealthStatuses(comparisonRows);
  const totalQuestions = rows.reduce((sum, row) => sum + metricNumber(row.question_count), 0);
  const comparisonTotalQuestions =
    comparisonRows === undefined
      ? undefined
      : comparisonRows.reduce((sum, row) => sum + metricNumber(row.question_count), 0);

  const tagsNeedingResponse = [...rows]
    .filter((row) => row.health_status === "Needs response attention")
    .sort(
      (a, b) =>
        metricNumber(b.unanswered_questions) - metricNumber(a.unanswered_questions) ||
        metricNumber(b.median_first_answer_hours) - metricNumber(a.median_first_answer_hours) ||
        metricNumber(b.page_views) - metricNumber(a.page_views) ||
        a.tag_name.localeCompare(b.tag_name),
    )
    .slice(0, 10);
  const tagsNeedingSmeCoverage = [...rows]
    .filter((row) => row.health_status === "Needs SME coverage")
    .sort(
      (a, b) =>
        metricNumber(b.question_count) - metricNumber(a.question_count) ||
        metricNumber(b.page_views) - metricNumber(a.page_views) ||
        a.tag_name.localeCompare(b.tag_name),
    )
    .slice(0, 10);

  return {
    metricCards: buildTagDashboardMetricCards({
      rowCount: rows.length,
      healthyCount: healthStatusCounts.Healthy,
      smeGapCount: healthStatusCounts["Needs SME coverage"],
      responseAttentionCount: healthStatusCounts["Needs response attention"],
      totalQuestions,
      comparison:
        comparisonRows === undefined || comparisonHealthStatusCounts === undefined || comparisonTotalQuestions === undefined
          ? undefined
          : {
              rowCount: comparisonRows.length,
              healthyCount: comparisonHealthStatusCounts.Healthy,
              smeGapCount: comparisonHealthStatusCounts["Needs SME coverage"],
              responseAttentionCount: comparisonHealthStatusCounts["Needs response attention"],
              totalQuestions: comparisonTotalQuestions,
            },
    }),
    totalQuestions,
    healthStatusCounts,
    statusDistribution: buildStatusDistribution(healthStatusCounts, comparisonHealthStatusCounts),
    topTagsByViews: [...rows]
      .sort(
        (a, b) =>
          metricNumber(b.page_views) - metricNumber(a.page_views) ||
          metricNumber(b.question_count) - metricNumber(a.question_count) ||
          a.tag_name.localeCompare(b.tag_name),
      )
      .slice(0, 10),
    tagsNeedingResponse,
    tagsNeedingSmeCoverage,
    smeCoverageQueue: tagsNeedingSmeCoverage.map((row) => ({
      tagName: row.tag_name,
      primaryMetricLabel: "Questions",
      primaryMetricValue: metricNumber(row.question_count),
      secondaryMetricLabel: "SMEs",
      secondaryMetricValue: metricNumber(row.sme_count),
      recommendedAction: row.recommended_action,
    })),
    responseAttentionQueue: tagsNeedingResponse.map((row) => ({
      tagName: row.tag_name,
      primaryMetricLabel: "Unanswered",
      primaryMetricValue: metricNumber(row.unanswered_questions),
      secondaryMetricLabel: "Median first answer",
      secondaryMetricValue: metricNumber(row.median_first_answer_hours),
      recommendedAction: row.recommended_action,
    })),
    comparison:
      comparisonRows === undefined || comparisonHealthStatusCounts === undefined
        ? undefined
        : {
            statusRows: buildComparisonStatusRows(healthStatusCounts, comparisonHealthStatusCounts),
            fastestChanges: buildFastestChanges(rows, comparisonRows),
          },
  };
}
```

Add these helper functions below `summarizeTagHealthRows`:

```ts
function countHealthStatuses(rows: readonly TagHealthRow[]): Record<TagHealthStatus, number> {
  return TAG_HEALTH_STATUSES.reduce<Record<TagHealthStatus, number>>((counts, status) => {
    counts[status] = rows.filter((row) => row.health_status === status).length;
    return counts;
  }, {} as Record<TagHealthStatus, number>);
}

function buildTagDashboardMetricCards({
  rowCount,
  healthyCount,
  smeGapCount,
  responseAttentionCount,
  totalQuestions,
  comparison,
}: {
  rowCount: number;
  healthyCount: number;
  smeGapCount: number;
  responseAttentionCount: number;
  totalQuestions: number;
  comparison?: {
    rowCount: number;
    healthyCount: number;
    smeGapCount: number;
    responseAttentionCount: number;
    totalQuestions: number;
  };
}): TagDashboardMetricCard[] {
  return [
    buildMetricCard("Tags Covered", rowCount, comparison?.rowCount, "neutral"),
    buildMetricCard("Healthy Tags", healthyCount, comparison?.healthyCount, "increase-good"),
    buildMetricCard("SME Gaps", smeGapCount, comparison?.smeGapCount, "decrease-good"),
    buildMetricCard("Response Attention", responseAttentionCount, comparison?.responseAttentionCount, "decrease-good"),
    buildMetricCard("Questions", totalQuestions, comparison?.totalQuestions, "neutral"),
  ];
}

function buildMetricCard(
  label: string,
  value: number,
  comparisonValue: number | undefined,
  direction: "increase-good" | "decrease-good" | "neutral",
): TagDashboardMetricCard {
  if (comparisonValue === undefined) return { label, value };

  const delta = value - comparisonValue;
  return {
    label,
    value,
    delta,
    deltaTone: getDeltaTone(delta, direction),
  };
}

function buildStatusDistribution(
  currentCounts: Record<TagHealthStatus, number>,
  comparisonCounts?: Record<TagHealthStatus, number>,
): TagStatusDistributionRow[] {
  return TAG_HEALTH_STATUSES.map((status) => {
    const count = currentCounts[status] ?? 0;
    const comparisonCount = comparisonCounts?.[status];
    const delta = comparisonCount === undefined ? undefined : count - comparisonCount;

    return {
      status,
      count,
      comparisonCount,
      delta,
      deltaTone: delta === undefined ? undefined : getStatusDeltaTone(status, delta),
    };
  });
}

function buildComparisonStatusRows(
  currentCounts: Record<TagHealthStatus, number>,
  comparisonCounts: Record<TagHealthStatus, number>,
): TagHealthComparisonStatusRow[] {
  return TAG_HEALTH_STATUSES.map((status) => {
    const current = currentCounts[status] ?? 0;
    const comparison = comparisonCounts[status] ?? 0;
    const delta = current - comparison;

    return {
      status,
      current,
      comparison,
      delta,
      deltaTone: getStatusDeltaTone(status, delta),
    };
  });
}

function buildFastestChanges(
  rows: readonly TagHealthRow[],
  comparisonRows: readonly TagHealthRow[],
): TagFastestChangeRow[] {
  const comparisonByTag = new Map(comparisonRows.map((row) => [row.tag_name, row]));
  const changes: TagFastestChangeRow[] = [];

  for (const row of rows) {
    const comparison = comparisonByTag.get(row.tag_name);
    if (!comparison) continue;

    pushChange(changes, row.tag_name, "Unanswered questions", row.unanswered_questions, comparison.unanswered_questions, "decrease-good");
    pushChange(changes, row.tag_name, "SMEs", row.sme_count, comparison.sme_count, "increase-good");
    pushChange(changes, row.tag_name, "Page views", row.page_views, comparison.page_views, "neutral");
    pushChange(changes, row.tag_name, "Questions", row.question_count, comparison.question_count, "neutral");
  }

  return changes
    .sort(
      (a, b) =>
        getChangePriority(a.metric) - getChangePriority(b.metric) ||
        Math.abs(b.delta) - Math.abs(a.delta) ||
        b.current - a.current ||
        a.tagName.localeCompare(b.tagName) ||
        a.metric.localeCompare(b.metric),
    )
    .slice(0, 6);
}

function pushChange(
  changes: TagFastestChangeRow[],
  tagName: string,
  metric: string,
  currentValue: number,
  comparisonValue: number,
  direction: "increase-good" | "decrease-good" | "neutral",
) {
  const current = metricNumber(currentValue);
  const comparison = metricNumber(comparisonValue);
  const delta = current - comparison;
  if (delta === 0) return;

  changes.push({
    tagName,
    metric,
    current,
    comparison,
    delta,
    deltaTone: getDeltaTone(delta, direction),
  });
}

function getStatusDeltaTone(status: TagHealthStatus, delta: number): TagDashboardDeltaTone {
  if (delta === 0) return "neutral";
  if (status === "Healthy") return delta > 0 ? "good" : "bad";
  if (status === "Needs SME coverage" || status === "Needs response attention") {
    return delta < 0 ? "good" : "bad";
  }
  return "neutral";
}

function getDeltaTone(
  delta: number,
  direction: "increase-good" | "decrease-good" | "neutral",
): TagDashboardDeltaTone {
  if (delta === 0 || direction === "neutral") return "neutral";
  if (direction === "increase-good") return delta > 0 ? "good" : "bad";
  return delta < 0 ? "good" : "bad";
}

function getChangePriority(metric: string): number {
  switch (metric) {
    case "Unanswered questions":
      return 1;
    case "SMEs":
      return 2;
    case "Questions":
      return 3;
    case "Page views":
      return 4;
    default:
      return 5;
  }
}
```

- [ ] **Step 5: Run transform tests and verify pass**

Run:

```bash
pnpm test src/reports/reportTransforms.test.ts -t "Tag Health"
```

Expected: PASS for the Tag Health transform tests.

## Task 2: Render Operations Overview Without Comparison

**Files:**
- Create: `src/components/TagReportDashboard.tsx`
- Modify: `src/components/ReportDashboard.tsx`
- Modify: `src/components/ReportDashboard.test.tsx`
- Modify: `src/styles/app.css`

- [ ] **Step 1: Write failing render test for the operations overview**

Replace the current `renders warnings and Tag Health dashboard sections` expectations in `src/components/ReportDashboard.test.tsx` with this behavior:

```ts
it("renders warnings and the Tag Health operations overview", () => {
  render(
    <ReportDashboard
      reportId="tag-report"
      outputSource="live-api"
      records={[
        {
          tag_name: "python",
          health_status: "Healthy",
          page_views: 900,
          question_count: 2,
          answer_count: 3,
          sme_count: 1,
          watcher_count: 8,
          unanswered_questions: 0,
          median_first_answer_hours: 2,
          recommended_action: "Maintain current coverage and response habits.",
        },
        {
          tag_name: "react",
          health_status: "Needs SME coverage",
          page_views: 700,
          question_count: 4,
          answer_count: 1,
          sme_count: 0,
          watcher_count: 12,
          unanswered_questions: 0,
          median_first_answer_hours: 4,
          recommended_action: "Assign or confirm SMEs for this tag.",
        },
        {
          tag_name: "java",
          health_status: "Needs response attention",
          page_views: 600,
          question_count: 5,
          answer_count: 2,
          sme_count: 2,
          watcher_count: 10,
          unanswered_questions: 3,
          median_first_answer_hours: 30,
          recommended_action: "Review unanswered questions and response time for this tag.",
        },
      ]}
      warnings={[
        {
          reportId: "tag-report",
          code: "dataset-page-cap",
          message: "Questions hit the configured page cap; results may be partial.",
        },
      ]}
    />,
  );

  const warningArea = screen.getByRole("alert", { name: "Report warnings" });
  expect(within(warningArea).getByText("dataset-page-cap")).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Tag Health Dashboard" })).toBeInTheDocument();
  expect(screen.getByText("Tags Covered")).toBeInTheDocument();
  expect(screen.getByText("Healthy Tags")).toBeInTheDocument();
  expect(screen.getByText("SME Gaps")).toBeInTheDocument();
  expect(screen.getByText("Response Attention")).toBeInTheDocument();
  expect(screen.getByText("Questions")).toBeInTheDocument();
  expect(screen.getByText("Status distribution")).toBeInTheDocument();
  expect(screen.getByText("Top tags by page views")).toBeInTheDocument();
  expect(screen.getByText("SME coverage queue")).toBeInTheDocument();
  expect(screen.getByText("Response attention queue")).toBeInTheDocument();
  expect(screen.getByLabelText("python: 900")).toBeInTheDocument();
  expect(screen.getByRole("columnheader", { name: "Questions" })).toBeInTheDocument();
  expect(screen.getByRole("columnheader", { name: "SMEs" })).toBeInTheDocument();
  expect(screen.getByRole("columnheader", { name: "Unanswered" })).toBeInTheDocument();
  expect(screen.getByRole("columnheader", { name: "Median first answer" })).toBeInTheDocument();
  expect(screen.getByRole("row", { name: "react 4 0" })).toBeInTheDocument();
  expect(screen.getByRole("row", { name: "java 3 30h" })).toBeInTheDocument();
  expect(screen.queryByText("Period comparison")).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run dashboard test and verify failure**

Run:

```bash
pnpm test src/components/ReportDashboard.test.tsx -t "operations overview"
```

Expected: FAIL because `Tag Health Dashboard`, `Status distribution`, queue tables, and `SME Gaps` are not rendered yet.

- [ ] **Step 3: Create `TagReportDashboard` operations overview component**

Create `src/components/TagReportDashboard.tsx`:

```tsx
import { formatPeriodLabel } from "../domain/reportScope";
import type { ReactNode } from "react";
import type { PeriodScope } from "../domain/types";
import type {
  TagActionQueueRow,
  TagDashboardMetricCard,
  TagHealthComparisonSummary,
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
  return (
    <div className="tag-dashboard">
      <header className="tag-dashboard-header">
        <div>
          <h3 className="tag-dashboard-title">Tag Health Dashboard</h3>
          <p className="tag-dashboard-subtitle">
            Current period: {formatPeriodLabel(currentScope ?? {})}
            {summary.comparison ? ` · Comparison: ${formatPeriodLabel(comparisonScope ?? {})}` : ""}
          </p>
        </div>
        <span className="tag-dashboard-pill">CSV aligned</span>
      </header>
      <TagMetricStrip metrics={summary.metricCards} />
      <div className="tag-dashboard-grid tag-dashboard-grid__primary">
        <TagStatusDistribution rows={summary.statusDistribution} />
        {summary.comparison ? (
          <TagPeriodComparison comparison={summary.comparison} />
        ) : (
          <TagOverviewNote totalQuestions={summary.totalQuestions} />
        )}
      </div>
      <div className="tag-dashboard-grid">
        <DashboardPanel title="Top tags by page views">
          <BarList
            rows={summary.topTagsByViews.map((row) => ({
              label: row.tag_name,
              value: finiteNumber(row.page_views),
            }))}
          />
        </DashboardPanel>
        {summary.comparison && <TagFastestChanges comparison={summary.comparison} />}
      </div>
      <div className="tag-dashboard-grid">
        <TagQueuePanel title="SME coverage queue" rows={summary.smeCoverageQueue} emptyMessage="No tags need SME coverage." />
        <TagQueuePanel title="Response attention queue" rows={summary.responseAttentionQueue} emptyMessage="No tags need response attention." />
      </div>
    </div>
  );
}

function TagMetricStrip({ metrics }: { metrics: TagDashboardMetricCard[] }) {
  return (
    <div className="tag-kpi-grid" aria-label="Tag health metrics">
      {metrics.map((metric) => (
        <dl className="tag-kpi" key={metric.label}>
          <dt>{metric.label}</dt>
          <dd>{formatMetricValue(metric.value)}</dd>
          {metric.delta !== undefined && (
            <span className={`tag-kpi-delta tag-kpi-delta__${metric.deltaTone ?? "neutral"}`}>
              {formatDelta(metric.delta)} vs prior
            </span>
          )}
        </dl>
      ))}
    </div>
  );
}

function TagStatusDistribution({ rows }: { rows: TagStatusDistributionRow[] }) {
  const total = rows.reduce((sum, row) => sum + row.count, 0);
  const background = buildDistributionGradient(rows, total);

  return (
    <DashboardPanel title="Status distribution">
      <div className="tag-status-distribution">
        <div className="tag-status-donut" style={{ background }} aria-hidden="true" />
        <div className="tag-status-legend">
          {rows.map((row) => (
            <div className="tag-status-row" key={row.status}>
              <span>
                <span className={`tag-status-dot ${getStatusClass(row.status)}`} aria-hidden="true" />
                {row.status}
              </span>
              <strong>
                {row.count.toLocaleString("en-US")}
                {row.delta !== undefined && (
                  <span className={`tag-inline-delta tag-inline-delta__${row.deltaTone ?? "neutral"}`}>
                    {formatDelta(row.delta)}
                  </span>
                )}
              </strong>
            </div>
          ))}
        </div>
      </div>
    </DashboardPanel>
  );
}

function TagOverviewNote({ totalQuestions }: { totalQuestions: number }) {
  return (
    <DashboardPanel title="Current-period context">
      <p className="tag-dashboard-copy">
        This run covers {totalQuestions.toLocaleString("en-US")} questions. Enable comparison in the report scope to add period deltas and fastest-change analysis.
      </p>
    </DashboardPanel>
  );
}

function TagPeriodComparison({ comparison }: { comparison: TagHealthComparisonSummary }) {
  return (
    <DashboardPanel title="Period comparison">
      <div className="tag-comparison-table-wrap">
        <table className="tag-comparison-table">
          <thead>
            <tr>
              <th scope="col">Health status</th>
              <th scope="col">Current</th>
              <th scope="col">Comparison</th>
              <th scope="col">Delta</th>
            </tr>
          </thead>
          <tbody>
            {comparison.statusRows.map((row) => (
              <tr key={row.status}>
                <td>{row.status}</td>
                <td>{row.current.toLocaleString("en-US")}</td>
                <td>{row.comparison.toLocaleString("en-US")}</td>
                <td className={`tag-delta tag-delta__${row.deltaTone}`}>{formatDelta(row.delta)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </DashboardPanel>
  );
}

function TagFastestChanges({ comparison }: { comparison: TagHealthComparisonSummary }) {
  return (
    <DashboardPanel title="Fastest changes">
      {comparison.fastestChanges.length === 0 ? (
        <div className="dashboard-empty">No comparison changes detected.</div>
      ) : (
        <div className="tag-change-list" role="list">
          {comparison.fastestChanges.map((row) => (
            <div className="tag-change-row" key={`${row.tagName}-${row.metric}`} role="listitem">
              <strong>{row.tagName}</strong>
              <span>{row.metric}</span>
              <span className={`tag-delta tag-delta__${row.deltaTone}`}>{formatDelta(row.delta)}</span>
            </div>
          ))}
        </div>
      )}
    </DashboardPanel>
  );
}

function TagQueuePanel({ title, rows, emptyMessage }: { title: string; rows: TagActionQueueRow[]; emptyMessage: string }) {
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
                <th scope="col">{rows[0]?.primaryMetricLabel ?? "Primary"}</th>
                <th scope="col">{rows[0]?.secondaryMetricLabel ?? "Secondary"}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.tagName} title={row.recommendedAction}>
                  <td>{row.tagName}</td>
                  <td>{formatQueueValue(row.primaryMetricValue, row.primaryMetricLabel)}</td>
                  <td>{formatQueueValue(row.secondaryMetricValue, row.secondaryMetricLabel)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </DashboardPanel>
  );
}

function DashboardPanel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="tag-dashboard-panel" aria-labelledby={toPanelId(title)}>
      <h4 id={toPanelId(title)}>{title}</h4>
      {children}
    </section>
  );
}

function buildDistributionGradient(rows: TagStatusDistributionRow[], total: number) {
  if (total <= 0) return "conic-gradient(var(--so-canvas-2) 0 100%)";

  let cursor = 0;
  const segments = rows.map((row) => {
    const start = cursor;
    cursor += (row.count / total) * 100;
    return `${getStatusColor(row.status)} ${start}% ${cursor}%`;
  });

  return `conic-gradient(${segments.join(", ")})`;
}

function getStatusColor(status: TagStatusDistributionRow["status"]) {
  switch (status) {
    case "Healthy":
      return "var(--so-green)";
    case "Needs SME coverage":
      return "var(--so-orange-strong)";
    case "Needs response attention":
      return "var(--so-red)";
    case "Low activity":
      return "var(--so-purple)";
  }
}

function getStatusClass(status: TagStatusDistributionRow["status"]) {
  return `tag-status-dot__${status.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
}

function formatMetricValue(value: number | string) {
  return typeof value === "number" ? value.toLocaleString("en-US") : value;
}

function formatDelta(delta: number) {
  if (delta > 0) return `+${delta.toLocaleString("en-US")}`;
  return delta.toLocaleString("en-US");
}

function formatQueueValue(value: number, label: string) {
  const formatted = value.toLocaleString("en-US");
  return label === "Median first answer" ? `${formatted}h` : formatted;
}

function finiteNumber(value: number | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function toPanelId(title: string) {
  return `tag-dashboard-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;
}
```

- [ ] **Step 4: Delegate Tag Report rendering from `ReportDashboard`**

In `src/components/ReportDashboard.tsx`, add:

```ts
import { TagReportDashboard } from "./TagReportDashboard";
```

Replace the current Tag Report branch with:

```tsx
  if (reportId === "tag-report") {
    const tagHealthRows = normalizeTagHealthRows(records, outputSource);
    const tagHealthComparisonRows =
      comparisonRecords === undefined ? undefined : normalizeTagHealthRows(comparisonRecords, outputSource);
    const summary = summarizeTagHealthRows(tagHealthRows, tagHealthComparisonRows);

    return (
      <DashboardLayout cards={[]} warnings={warnings} showCards={false}>
        <TagReportDashboard summary={summary} currentScope={currentScope} comparisonScope={comparisonScope} />
      </DashboardLayout>
    );
  }
```

Update `DashboardLayout` props:

```tsx
function DashboardLayout({
  cards,
  comparisonSection,
  warnings,
  showCards = true,
  children,
}: {
  cards: MetricCard[];
  comparisonSection?: ReactNode;
  warnings?: ReportWarning[];
  showCards?: boolean;
  children?: ReactNode;
}) {
  return (
    <div className="dashboard-summary">
      <DashboardWarnings warnings={warnings ?? []} />
      {showCards && <DashboardCards cards={cards} />}
      {comparisonSection}
      {children}
    </div>
  );
}
```

- [ ] **Step 5: Add initial CSS for the operations overview**

Append this block near the existing dashboard styles in `src/styles/app.css`:

```css
.tag-dashboard {
  display: grid;
  gap: 16px;
  min-width: 0;
}

.tag-dashboard-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  padding-bottom: 2px;
}

.tag-dashboard-title {
  margin: 0;
  color: var(--so-ink);
  font-size: 18px;
  font-weight: 850;
  line-height: 1.3;
}

.tag-dashboard-subtitle,
.tag-dashboard-copy {
  margin: 4px 0 0;
  color: var(--so-text-muted);
  font-size: 13px;
  line-height: 1.45;
}

.tag-dashboard-pill {
  display: inline-flex;
  align-items: center;
  min-height: 28px;
  padding: 4px 9px;
  border: 1px solid var(--so-border);
  border-radius: 999px;
  color: var(--so-text);
  background: var(--so-surface-raised);
  font-size: 12px;
  font-weight: 800;
  white-space: nowrap;
}

.tag-kpi-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 10px;
}

.tag-kpi {
  display: grid;
  min-width: 0;
  min-height: 92px;
  align-content: space-between;
  margin: 0;
  padding: 13px;
  border: 1px solid var(--so-border);
  border-radius: 8px;
  background: var(--so-surface-raised);
}

.tag-kpi dt {
  color: var(--so-text-muted);
  font-size: 12px;
  font-weight: 800;
  line-height: 1.25;
}

.tag-kpi dd {
  margin: 8px 0 0;
  color: var(--so-ink);
  font-size: 28px;
  font-weight: 850;
  font-variant-numeric: tabular-nums;
  line-height: 1.1;
}

.tag-kpi-delta,
.tag-inline-delta,
.tag-delta {
  font-weight: 850;
  font-variant-numeric: tabular-nums;
}

.tag-kpi-delta {
  margin-top: 6px;
  font-size: 12px;
}

.tag-kpi-delta__good,
.tag-inline-delta__good,
.tag-delta__good {
  color: var(--so-green);
}

.tag-kpi-delta__bad,
.tag-inline-delta__bad,
.tag-delta__bad {
  color: var(--so-red);
}

.tag-kpi-delta__neutral,
.tag-inline-delta__neutral,
.tag-delta__neutral {
  color: var(--so-text-muted);
}

.tag-dashboard-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.tag-dashboard-grid__primary {
  grid-template-columns: minmax(0, 1.1fr) minmax(280px, 0.9fr);
}

.tag-dashboard-panel {
  display: grid;
  gap: 12px;
  min-width: 0;
  padding: 14px;
  border: 1px solid var(--so-border);
  border-radius: 8px;
  background: var(--so-surface);
}

.tag-dashboard-panel h4 {
  margin: 0;
  color: var(--so-ink);
  font-size: 15px;
  font-weight: 850;
  line-height: 1.3;
}

.tag-status-distribution {
  display: grid;
  grid-template-columns: 118px minmax(0, 1fr);
  gap: 14px;
  align-items: center;
}

.tag-status-donut {
  width: 118px;
  height: 118px;
  border-radius: 50%;
  box-shadow: inset 0 0 0 30px var(--so-surface);
}

.tag-status-legend {
  display: grid;
  gap: 8px;
}

.tag-status-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--so-border);
  color: var(--so-text);
  font-size: 13px;
}

.tag-status-row:last-child {
  padding-bottom: 0;
  border-bottom: 0;
}

.tag-status-dot {
  display: inline-block;
  width: 9px;
  height: 9px;
  margin-right: 7px;
  border-radius: 50%;
  background: var(--so-text-muted);
}

.tag-status-dot__healthy {
  background: var(--so-green);
}

.tag-status-dot__needs-sme-coverage {
  background: var(--so-orange-strong);
}

.tag-status-dot__needs-response-attention {
  background: var(--so-red);
}

.tag-status-dot__low-activity {
  background: var(--so-purple);
}

.tag-inline-delta {
  margin-left: 8px;
}

.tag-queue-table-wrap,
.tag-comparison-table-wrap {
  overflow: auto;
  border: 1px solid var(--so-border);
  border-radius: 8px;
}

.tag-queue-table,
.tag-comparison-table {
  width: 100%;
  min-width: 420px;
  border-collapse: collapse;
  background: var(--so-surface);
  font-size: 13px;
}

.tag-queue-table th,
.tag-queue-table td,
.tag-comparison-table th,
.tag-comparison-table td {
  padding: 9px 10px;
  border-bottom: 1px solid var(--so-border);
  color: var(--so-text);
  text-align: left;
}

.tag-queue-table th,
.tag-comparison-table th {
  color: var(--so-text-muted);
  background: var(--so-canvas);
  font-size: 12px;
  font-weight: 800;
}

.tag-queue-table tr:last-child td,
.tag-comparison-table tr:last-child td {
  border-bottom: 0;
}
```

- [ ] **Step 6: Run dashboard test and verify pass**

Run:

```bash
pnpm test src/components/ReportDashboard.test.tsx -t "operations overview"
```

Expected: PASS.

## Task 3: Render Comparison Console Inside Tag Dashboard

**Files:**
- Modify: `src/components/ReportDashboard.test.tsx`
- Modify: `src/components/TagReportDashboard.tsx`
- Modify: `src/styles/app.css`

- [ ] **Step 1: Write failing comparison render test**

Replace the existing `compares curated Tag Health rows by health status` test in `src/components/ReportDashboard.test.tsx` with:

```ts
it("renders Tag Health comparison deltas and fastest changes inside the hybrid dashboard", () => {
  render(
    <ReportDashboard
      reportId="tag-report"
      records={[
        tagHealthRecord("python", "Needs response attention", { unanswered_questions: 6, page_views: 900, question_count: 10 }),
        tagHealthRecord("react", "Healthy", { sme_count: 2, page_views: 500, question_count: 4 }),
      ]}
      comparisonRecords={[
        tagHealthRecord("python", "Healthy", { unanswered_questions: 1, page_views: 700, question_count: 8 }),
        tagHealthRecord("react", "Needs SME coverage", { sme_count: 0, page_views: 550, question_count: 5 }),
      ]}
      currentScope={{ startDate: "2026-06-01", endDate: "2026-06-30" }}
      comparisonScope={{ startDate: "2026-05-01", endDate: "2026-05-31" }}
    />,
  );

  expect(screen.getByText("Current period: 2026-06-01 to 2026-06-30 · Comparison: 2026-05-01 to 2026-05-31")).toBeInTheDocument();
  expect(screen.getByText("Period comparison")).toBeInTheDocument();
  expect(screen.getByRole("columnheader", { name: "Health status" })).toBeInTheDocument();
  expect(screen.getByRole("row", { name: "Needs response attention 1 0 +1" })).toBeInTheDocument();
  expect(screen.getByRole("row", { name: "Needs SME coverage 0 1 -1" })).toBeInTheDocument();
  expect(screen.getByText("Fastest changes")).toBeInTheDocument();
  expect(screen.getByText("Unanswered questions")).toBeInTheDocument();
  expect(screen.getByText("+5")).toBeInTheDocument();
  expect(screen.queryByText("Current Records")).not.toBeInTheDocument();
  expect(screen.queryByRole("columnheader", { name: "Dataset" })).not.toBeInTheDocument();
});
```

Update the helper at the bottom of the file:

```ts
function tagHealthRecord(
  tagName: string,
  healthStatus: string,
  overrides: Partial<Record<string, number | string>> = {},
) {
  return {
    tag_name: tagName,
    health_status: healthStatus,
    page_views: 100,
    question_count: 1,
    answer_count: 1,
    sme_count: healthStatus === "Needs SME coverage" ? 0 : 1,
    watcher_count: 1,
    unanswered_questions: healthStatus === "Needs response attention" ? 1 : 0,
    median_first_answer_hours: 2,
    recommended_action: "Maintain current coverage and response habits.",
    ...overrides,
  };
}
```

- [ ] **Step 2: Run comparison render test and verify failure**

Run:

```bash
pnpm test src/components/ReportDashboard.test.tsx -t "comparison deltas"
```

Expected: FAIL if Task 2 did not yet render comparison-specific panels or if the helper still has the old signature.

- [ ] **Step 3: Complete comparison UI rendering**

If Task 2 already created the comparison component skeleton, confirm these details in `src/components/TagReportDashboard.tsx`:

```tsx
{summary.comparison ? (
  <TagPeriodComparison comparison={summary.comparison} />
) : (
  <TagOverviewNote totalQuestions={summary.totalQuestions} />
)}
```

Confirm `TagFastestChanges` is rendered only when `summary.comparison` exists:

```tsx
{summary.comparison && <TagFastestChanges comparison={summary.comparison} />}
```

Confirm the generic Tag Report comparison branch has been removed from `ReportDashboard.tsx`; Tag Report should not render the generic `Current Records` cards or `Dataset` comparison table.

- [ ] **Step 4: Add fastest-change CSS**

Append near the Tag dashboard CSS in `src/styles/app.css`:

```css
.tag-change-list {
  display: grid;
  gap: 7px;
}

.tag-change-row {
  display: grid;
  grid-template-columns: minmax(92px, 1fr) minmax(120px, 1.3fr) minmax(44px, auto);
  gap: 10px;
  align-items: center;
  min-height: 34px;
  padding: 8px 9px;
  border: 1px solid var(--so-border);
  border-radius: 6px;
  color: var(--so-text);
  font-size: 13px;
}

.tag-change-row strong {
  color: var(--so-ink);
  overflow-wrap: anywhere;
}
```

- [ ] **Step 5: Run comparison render test and verify pass**

Run:

```bash
pnpm test src/components/ReportDashboard.test.tsx -t "comparison deltas"
```

Expected: PASS.

## Task 4: Preserve Import And Live API Normalization

**Files:**
- Modify: `src/components/ReportDashboard.test.tsx`
- Modify: `src/components/ReportDashboard.tsx`

- [ ] **Step 1: Update imported Tag Metric row test**

Update `normalizes imported Tag Metric rows into Tag Health dashboard rows` in `src/components/ReportDashboard.test.tsx`:

```ts
it("normalizes imported Tag Metric rows into the hybrid Tag Health dashboard", () => {
  render(
    <ReportDashboard
      reportId="tag-report"
      records={[
        {
          tagName: "typescript",
          totalPageViews: 450,
          questionCount: 8,
          answerCount: 4,
          totalSmes: 0,
          questionsNoAnswers: 0,
          medianFirstAnswerHours: 6,
        },
      ]}
    />,
  );

  expect(screen.getByRole("heading", { name: "Tag Health Dashboard" })).toBeInTheDocument();
  expect(screen.getByText("SME coverage queue")).toBeInTheDocument();
  expect(screen.getByLabelText("typescript: 450")).toBeInTheDocument();
  expect(screen.getByRole("row", { name: "typescript 8 0" })).toBeInTheDocument();
});
```

- [ ] **Step 2: Add live API normalization render test**

Add this test to `src/components/ReportDashboard.test.tsx`:

```ts
it("normalizes live Tag Report records into the hybrid dashboard", () => {
  render(
    <ReportDashboard
      reportId="tag-report"
      outputSource="live-api"
      records={[
        { datasetName: "tags", name: "python", count: 2 },
        { datasetName: "questions", question_id: 1, tags: ["python"], answer_count: 0, view_count: 30 },
        { datasetName: "tagSmes", tagName: "python", user_id: 96, score: 12 },
      ]}
    />,
  );

  expect(screen.getByRole("heading", { name: "Tag Health Dashboard" })).toBeInTheDocument();
  expect(screen.getByText("Response attention queue")).toBeInTheDocument();
  expect(screen.getByRole("row", { name: "python 1 0h" })).toBeInTheDocument();
});
```

- [ ] **Step 3: Run normalization render tests and verify failure if needed**

Run:

```bash
pnpm test src/components/ReportDashboard.test.tsx -t "hybrid dashboard"
```

Expected: PASS if Tasks 1-3 kept normalization intact. If it fails, the failure should point to `normalizeTagHealthRows` behavior or queue rendering.

- [ ] **Step 4: Fix only the failing normalization path**

If the live API test fails because `ReportDashboard.tsx` is not passing `outputSource` into `normalizeTagHealthRows`, keep this existing logic:

```ts
if (outputSource === "live-api" && records.some((record) => typeof record.datasetName === "string")) {
  return buildTagHealthRowsFromLiveRecords(records);
}
```

If the imported rows test fails, confirm the fallback remains:

```ts
return buildTagHealthRows(records);
```

- [ ] **Step 5: Run all ReportDashboard tests**

Run:

```bash
pnpm test src/components/ReportDashboard.test.tsx
```

Expected: PASS.

## Task 5: Responsive Polish And Visual Verification

**Files:**
- Modify: `src/styles/app.css`

- [ ] **Step 1: Add responsive CSS**

Append near the existing responsive styles in `src/styles/app.css`:

```css
@media (max-width: 900px) {
  .tag-dashboard-header {
    display: grid;
  }

  .tag-dashboard-grid,
  .tag-dashboard-grid__primary,
  .tag-status-distribution {
    grid-template-columns: 1fr;
  }

  .tag-status-donut {
    width: 96px;
    height: 96px;
    box-shadow: inset 0 0 0 24px var(--so-surface);
  }
}

@media (max-width: 640px) {
  .tag-kpi-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .tag-change-row {
    grid-template-columns: 1fr;
  }
}
```

- [ ] **Step 2: Run CSS/design hook check**

Run:

```bash
node .agents/skills/impeccable/scripts/detect.mjs --json src/components/TagReportDashboard.tsx src/styles/app.css
```

Expected: no deterministic design-quality issues. If it reports an issue, fix the CSS or component unless it is a contextually intentional false positive.

- [ ] **Step 3: Run unit tests**

Run:

```bash
pnpm test src/reports/reportTransforms.test.ts src/components/ReportDashboard.test.tsx
```

Expected: PASS.

- [ ] **Step 4: Run typecheck**

Run:

```bash
pnpm lint
```

Expected: PASS.

- [ ] **Step 5: Start the local app**

Run:

```bash
pnpm dev
```

Expected: Next.js starts on `http://127.0.0.1:3000` or prints a different available port.

- [ ] **Step 6: Verify in the browser**

Open the running app in the in-app browser. Navigate to the Tag Report dashboard with existing fixture, upload, or live-session data available in the app state. Verify:

- Warnings render above dashboard content.
- KPI strip has five cards and comparison deltas only when comparison data exists.
- Status distribution panel has visible labels and counts.
- Period comparison table appears with comparison data and disappears without it.
- Fastest changes appears only with comparison data.
- SME coverage queue and response attention queue render row tables or empty states.
- No text overflows at desktop and mobile viewport widths.

- [ ] **Step 7: Stop the dev server**

Stop the `pnpm dev` session after visual verification unless the user asks to keep it running.

## Task 6: Final Verification And Commit

**Files:**
- Review all modified files.

- [ ] **Step 1: Run full verification**

Run:

```bash
pnpm test
pnpm lint
```

Expected: both commands exit 0.

- [ ] **Step 2: Review diff**

Run:

```bash
git diff -- src/reports/tagReport.ts src/reports/reportTransforms.test.ts src/components/TagReportDashboard.tsx src/components/ReportDashboard.tsx src/components/ReportDashboard.test.tsx src/styles/app.css
```

Expected: diff only contains the hybrid dashboard transform, rendering, tests, and CSS changes.

- [ ] **Step 3: Commit implementation**

Run:

```bash
git add src/reports/tagReport.ts src/reports/reportTransforms.test.ts src/components/TagReportDashboard.tsx src/components/ReportDashboard.tsx src/components/ReportDashboard.test.tsx src/styles/app.css
git commit -m "Improve Tag Report dashboard insights"
```

Expected: commit succeeds with only the implementation files staged.
