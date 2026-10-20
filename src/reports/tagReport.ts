import type { MetricCard } from "./reportModels";
import { readNonNegativeNumber } from "../domain/tagNormalization";
import { formatApiDateTime } from "../utils/apiDates";
import { buildLiveTagMetricRows, readDate } from "./liveTagMetrics";
import { readTagDetailMetrics, TAG_DETAIL_HEADERS, type TagDetailMetrics } from "./tagMetricFields";

export interface TagMetricRow {
  tagName: string;
  tagId?: number | null;
  tagCreationDate?: string;
  lastUsed?: string;
  totalPageViews: number;
  tagWatchers: number;
  totalSmes: number;
  questionCount: number;
  questionsNoAnswers?: number;
  medianFirstAnswerHours?: number;
  answerCount: number;
}

export type TagHealthStatus =
  | "Healthy"
  | "Needs SME coverage"
  | "Needs response attention"
  | "Low activity";

export interface TagHealthRow extends Partial<TagDetailMetrics> {
  tag_name: string;
  tag_id: number | null;
  tag_creation_date: string;
  last_used: string;
  health_status: TagHealthStatus;
  page_views: number;
  question_count: number;
  article_count: number;
  unique_contributors: number;
  answer_count: number;
  sme_count: number;
  watcher_count: number;
  unanswered_questions: number;
  median_first_answer_hours: number;
  recommended_action: string;
}

export type TagDashboardDeltaTone = "good" | "bad" | "neutral";
export type TopTagMetric = "page_views" | "question_count" | "article_count" | "unique_contributors";
export type TagFastestChangeMetric = "Unanswered questions" | "SMEs" | "Questions" | "Page views";

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
  metric: TagFastestChangeMetric;
  current: number;
  comparison: number;
  delta: number;
  deltaTone: TagDashboardDeltaTone;
}

export interface TagHealthComparisonSummary {
  statusRows: TagHealthComparisonStatusRow[];
  fastestChanges: TagFastestChangeRow[];
}

export const TAG_HEALTH_CSV_HEADERS = [
  "tag_name",
  "tag_id",
  "tag_creation_date",
  "last_used",
  "health_status",
  "page_views",
  "question_count",
  "article_count",
  "unique_contributors",
  "answer_count",
  "sme_count",
  "watcher_count",
  "unanswered_questions",
  "median_first_answer_hours",
  "recommended_action",
  ...TAG_DETAIL_HEADERS,
] as const satisfies readonly (keyof TagHealthRow)[];

export interface TagHealthSummary {
  metricCards: TagDashboardMetricCard[];
  totalQuestions: number;
  healthStatusCounts: Record<TagHealthStatus, number>;
  statusDistribution: TagStatusDistributionRow[];
  topTagsByViews: TagHealthRow[];
  tagRows: TagHealthRow[];
  tagsNeedingResponse: TagHealthRow[];
  tagsNeedingSmeCoverage: TagHealthRow[];
  smeCoverageQueue: TagActionQueueRow[];
  responseAttentionQueue: TagActionQueueRow[];
  comparison?: TagHealthComparisonSummary;
}

const TAG_ID_ALIASES = ["tagId", "tag_id", "id"] as const;

const LOW_ACTIVITY_MAX_PAGE_VIEWS = 25;
const RESPONSE_ATTENTION_HOURS = 24;
const TAG_HEALTH_STATUSES: TagHealthStatus[] = [
  "Healthy",
  "Needs SME coverage",
  "Needs response attention",
  "Low activity",
];
type TagDashboardDeltaDirection = "increase-good" | "decrease-good" | "neutral";
const TAG_FASTEST_CHANGE_PRIORITIES: Record<TagFastestChangeMetric, number> = {
  "Unanswered questions": 1,
  SMEs: 2,
  Questions: 3,
  "Page views": 4,
};

export function summarizeTags(rows: TagMetricRow[]) {
  const totalViews = rows.reduce((sum, row) => sum + metricNumber(row.totalPageViews), 0);
  const totalQuestions = rows.reduce((sum, row) => sum + metricNumber(row.questionCount), 0);
  const metricCards: MetricCard[] = [
    { label: "Tags", value: rows.length },
    { label: "Page Views", value: totalViews },
    { label: "Questions", value: totalQuestions },
  ];
  return {
    metricCards,
    topTagsByViews: [...rows]
      .sort((a, b) => metricNumber(b.totalPageViews) - metricNumber(a.totalPageViews))
      .slice(0, 10),
  };
}

export function buildTagHealthRows(rows: readonly Record<string, unknown>[]): TagHealthRow[] {
  return rows.map((row) => {
    const tagName = getText(row, "tagName", "tag_name", "name") || "Unknown tag";
    const tagId = readTagId(row);
    const tagCreationDate = readDate(row, "tagCreationDate", "tag_creation_date", "creationDate", "creation_date");
    const lastUsed = readDate(row, "lastUsed", "last_used");
    const pageViews = getNumber(row, "totalPageViews", "page_views", "pageViews", "view_count", "viewCount");
    const questionCount = getNumber(row, "questionCount", "question_count");
    const articleCount = getNumber(row, "articleCount", "article_count");
    const uniqueContributors = getNumber(row, "totalUniqueContributors", "unique_contributors", "uniqueContributors");
    const answerCount = getNumber(row, "answerCount", "answer_count");
    const smeCount = getNumber(row, "totalSmes", "sme_count", "smeCount");
    const watcherCount = getNumber(row, "tagWatchers", "watcher_count", "watcherCount", "followers", "follower_count");
    const unansweredQuestions = getNumber(
      row,
      "questionsNoAnswers",
      "unanswered_questions",
      "questions_no_answers",
      "questionsWithNoAnswers",
    );
    const medianFirstAnswerHours = getNumber(
      row,
      "medianFirstAnswerHours",
      "medianTimeToFirstAnswerHours",
      "median_first_answer_hours",
      "median_time_to_first_answer_hours",
    );
    const healthStatus = getTagHealthStatus({
      pageViews,
      questionCount,
      smeCount,
      unansweredQuestions,
      medianFirstAnswerHours,
    });

    return {
      tag_name: tagName,
      tag_id: tagId,
      tag_creation_date: tagCreationDate,
      last_used: lastUsed,
      health_status: healthStatus,
      page_views: pageViews,
      question_count: questionCount,
      article_count: articleCount,
      unique_contributors: uniqueContributors,
      answer_count: answerCount,
      sme_count: smeCount,
      watcher_count: watcherCount,
      unanswered_questions: unansweredQuestions,
      median_first_answer_hours: medianFirstAnswerHours,
      recommended_action: getRecommendedAction(healthStatus),
      ...readTagDetailMetrics(row),
    };
  });
}

export function summarizeTagHealthRows(
  rows: readonly TagHealthRow[],
  comparisonRows?: readonly TagHealthRow[],
): TagHealthSummary {
  const normalizedRows = aggregateTagHealthRows(rows.map(normalizeTagHealthRow));
  const normalizedComparisonRows =
    comparisonRows === undefined ? undefined : aggregateTagHealthRows(comparisonRows.map(normalizeTagHealthRow));
  const healthStatusCounts = countHealthStatuses(normalizedRows);
  const comparisonHealthStatusCounts =
    normalizedComparisonRows === undefined ? undefined : countHealthStatuses(normalizedComparisonRows);
  const totalQuestions = normalizedRows.reduce((sum, row) => sum + metricNumber(row.question_count), 0);
  const comparisonTotalQuestions =
    normalizedComparisonRows === undefined
      ? undefined
      : normalizedComparisonRows.reduce((sum, row) => sum + metricNumber(row.question_count), 0);
  const tagsNeedingResponse = [...normalizedRows]
    .filter((row) => row.health_status === "Needs response attention")
    .sort(
      (a, b) =>
        metricNumber(b.unanswered_questions) - metricNumber(a.unanswered_questions) ||
        metricNumber(b.median_first_answer_hours) - metricNumber(a.median_first_answer_hours) ||
        metricNumber(b.page_views) - metricNumber(a.page_views) ||
        a.tag_name.localeCompare(b.tag_name),
    )
    .slice(0, 10);
  const tagsNeedingSmeCoverage = [...normalizedRows]
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
      rowCount: normalizedRows.length,
      healthyCount: healthStatusCounts.Healthy,
      smeGapCount: healthStatusCounts["Needs SME coverage"],
      responseAttentionCount: healthStatusCounts["Needs response attention"],
      totalQuestions,
      comparison:
        normalizedComparisonRows === undefined ||
        comparisonHealthStatusCounts === undefined ||
        comparisonTotalQuestions === undefined
          ? undefined
          : {
              rowCount: normalizedComparisonRows.length,
              healthyCount: comparisonHealthStatusCounts.Healthy,
              smeGapCount: comparisonHealthStatusCounts["Needs SME coverage"],
              responseAttentionCount: comparisonHealthStatusCounts["Needs response attention"],
              totalQuestions: comparisonTotalQuestions,
            },
    }),
    totalQuestions,
    healthStatusCounts,
    statusDistribution: buildStatusDistribution(healthStatusCounts, comparisonHealthStatusCounts),
    topTagsByViews: getTopTagsByMetric(normalizedRows, "page_views"),
    tagRows: normalizedRows,
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
      normalizedComparisonRows === undefined || comparisonHealthStatusCounts === undefined
        ? undefined
        : {
            statusRows: buildComparisonStatusRows(healthStatusCounts, comparisonHealthStatusCounts),
            fastestChanges: buildFastestChanges(normalizedRows, normalizedComparisonRows),
          },
  };
}

export function getTopTagsByMetric(rows: readonly TagHealthRow[], metric: TopTagMetric): TagHealthRow[] {
  const tieBreaker: TopTagMetric = metric === "page_views" ? "question_count" : "page_views";
  return [...rows]
    .sort((a, b) =>
      metricNumber(b[metric]) - metricNumber(a[metric]) ||
      metricNumber(b[tieBreaker]) - metricNumber(a[tieBreaker]) ||
      a.tag_name.localeCompare(b.tag_name),
    )
    .slice(0, 10);
}

function normalizeTagHealthRow(row: TagHealthRow): TagHealthRow {
  const healthStatus =
    normalizeTagHealthStatus(row.health_status) ??
    getTagHealthStatus({
      pageViews: metricNumber(row.page_views),
      questionCount: metricNumber(row.question_count),
      smeCount: metricNumber(row.sme_count),
      unansweredQuestions: metricNumber(row.unanswered_questions),
      medianFirstAnswerHours: metricNumber(row.median_first_answer_hours),
    });
  const recommendedAction = String(row.recommended_action ?? "").trim() || getRecommendedAction(healthStatus);

  return {
    ...row,
    tag_id: readTagId({ tag_id: row.tag_id }),
    article_count: metricNumber(row.article_count),
    unique_contributors: metricNumber(row.unique_contributors),
    tag_creation_date: formatApiDateTime(row.tag_creation_date),
    last_used: formatApiDateTime(row.last_used),
    health_status: healthStatus,
    recommended_action: recommendedAction,
  };
}

function normalizeTagHealthStatus(status: unknown): TagHealthStatus | undefined {
  const normalizedStatus = normalizeStatusText(status);
  return TAG_HEALTH_STATUSES.find((candidate) => normalizeStatusText(candidate) === normalizedStatus);
}

function normalizeStatusText(status: unknown): string {
  return String(status ?? "")
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ");
}

function aggregateTagHealthRows(rows: readonly TagHealthRow[]): TagHealthRow[] {
  const aggregates = new Map<string, { row: TagHealthRow; rowCount: number }>();

  for (const row of rows) {
    const tagName = row.tag_name.trim() || "Unknown tag";
    const aggregate = aggregates.get(tagName);

    if (aggregate) {
      aggregate.row.page_views += metricNumber(row.page_views);
      aggregate.row.question_count += metricNumber(row.question_count);
      aggregate.row.article_count += metricNumber(row.article_count);
      aggregate.row.unique_contributors = Math.max(
        aggregate.row.unique_contributors,
        metricNumber(row.unique_contributors),
      );
      aggregate.row.answer_count += metricNumber(row.answer_count);
      aggregate.row.sme_count += metricNumber(row.sme_count);
      aggregate.row.watcher_count += metricNumber(row.watcher_count);
      aggregate.row.unanswered_questions += metricNumber(row.unanswered_questions);
      aggregate.row.median_first_answer_hours = Math.max(
        metricNumber(aggregate.row.median_first_answer_hours),
        metricNumber(row.median_first_answer_hours),
      );
      aggregate.rowCount += 1;
      continue;
    }

    aggregates.set(tagName, {
      row: {
        ...row,
        tag_name: tagName,
        page_views: metricNumber(row.page_views),
        question_count: metricNumber(row.question_count),
        article_count: metricNumber(row.article_count),
        unique_contributors: metricNumber(row.unique_contributors),
        answer_count: metricNumber(row.answer_count),
        sme_count: metricNumber(row.sme_count),
        watcher_count: metricNumber(row.watcher_count),
        unanswered_questions: metricNumber(row.unanswered_questions),
        median_first_answer_hours: metricNumber(row.median_first_answer_hours),
      },
      rowCount: 1,
    });
  }

  return [...aggregates.values()].map(({ row, rowCount }) =>
    rowCount === 1 ? row : normalizeAggregatedTagHealthRow(row),
  );
}

function normalizeAggregatedTagHealthRow(row: TagHealthRow): TagHealthRow {
  const healthStatus = getTagHealthStatus({
    pageViews: row.page_views,
    questionCount: row.question_count,
    smeCount: row.sme_count,
    unansweredQuestions: row.unanswered_questions,
    medianFirstAnswerHours: row.median_first_answer_hours,
  });

  return {
    ...row,
    health_status: healthStatus,
    recommended_action: getRecommendedAction(healthStatus),
  };
}

function countHealthStatuses(rows: readonly TagHealthRow[]): Record<TagHealthStatus, number> {
  const counts = TAG_HEALTH_STATUSES.reduce<Record<TagHealthStatus, number>>((statusCounts, status) => {
    statusCounts[status] = 0;
    return statusCounts;
  }, {} as Record<TagHealthStatus, number>);

  for (const row of rows) {
    counts[row.health_status] = (counts[row.health_status] ?? 0) + 1;
  }

  return counts;
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
    buildMetricCard(
      "Response Attention",
      responseAttentionCount,
      comparison?.responseAttentionCount,
      "decrease-good",
    ),
    buildMetricCard("Questions", totalQuestions, comparison?.totalQuestions, "neutral"),
  ];
}

function buildMetricCard(
  label: string,
  value: number,
  comparisonValue: number | undefined,
  direction: TagDashboardDeltaDirection,
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

    pushChange(
      changes,
      row.tag_name,
      "Unanswered questions",
      row.unanswered_questions,
      comparison.unanswered_questions,
      "decrease-good",
    );
    pushChange(changes, row.tag_name, "SMEs", row.sme_count, comparison.sme_count, "increase-good");
    pushChange(changes, row.tag_name, "Questions", row.question_count, comparison.question_count, "neutral");
    pushChange(changes, row.tag_name, "Page views", row.page_views, comparison.page_views, "neutral");
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
  metric: TagFastestChangeMetric,
  currentValue: number,
  comparisonValue: number,
  direction: TagDashboardDeltaDirection,
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

function getChangePriority(metric: TagFastestChangeMetric): number {
  return TAG_FASTEST_CHANGE_PRIORITIES[metric];
}

function getStatusDeltaTone(status: TagHealthStatus, delta: number): TagDashboardDeltaTone {
  if (delta === 0) return "neutral";
  if (status === "Healthy") return delta > 0 ? "good" : "bad";
  if (status === "Needs SME coverage" || status === "Needs response attention") {
    return delta < 0 ? "good" : "bad";
  }
  return "neutral";
}

function getDeltaTone(delta: number, direction: TagDashboardDeltaDirection): TagDashboardDeltaTone {
  if (delta === 0 || direction === "neutral") return "neutral";
  if (direction === "increase-good") return delta > 0 ? "good" : "bad";
  return delta < 0 ? "good" : "bad";
}

export function buildTagHealthRowsFromLiveRecords(records: readonly Record<string, unknown>[]): TagHealthRow[] {
  return buildTagHealthRows(buildLiveTagMetricRows(records));
}

function getTagHealthStatus({
  pageViews,
  questionCount,
  smeCount,
  unansweredQuestions,
  medianFirstAnswerHours,
}: {
  pageViews: number;
  questionCount: number;
  smeCount: number;
  unansweredQuestions: number;
  medianFirstAnswerHours: number;
}): TagHealthStatus {
  if (questionCount === 0 && pageViews <= LOW_ACTIVITY_MAX_PAGE_VIEWS) {
    return "Low activity";
  }

  if (smeCount === 0 && (questionCount > 0 || pageViews > LOW_ACTIVITY_MAX_PAGE_VIEWS)) {
    return "Needs SME coverage";
  }

  if (unansweredQuestions > 0 || medianFirstAnswerHours >= RESPONSE_ATTENTION_HOURS) {
    return "Needs response attention";
  }

  return "Healthy";
}

function getRecommendedAction(status: TagHealthStatus): string {
  switch (status) {
    case "Needs SME coverage":
      return "Assign or confirm SMEs for this tag.";
    case "Needs response attention":
      return "Review unanswered questions and response time for this tag.";
    case "Low activity":
      return "Review whether this tag is still useful or should be consolidated.";
    case "Healthy":
      return "Maintain current coverage and response habits.";
  }
}

function getText(record: Record<string, unknown>, ...fieldNames: string[]): string {
  for (const fieldName of fieldNames) {
    const value = record[fieldName];
    if (typeof value === "string" && value.trim() !== "") return value.trim();
  }

  return "";
}

function readTagId(record: Record<string, unknown>): number | null {
  const tagId = readNonNegativeNumber(record, TAG_ID_ALIASES);
  return tagId !== null && Number.isSafeInteger(tagId) ? tagId : null;
}

function getNumber(record: Record<string, unknown>, ...fieldNames: string[]): number {
  for (const fieldName of fieldNames) {
    const value = record[fieldName];
    const parsed = metricNumber(value);
    if (parsed !== 0 || value === 0 || value === "0") return parsed;
  }

  return 0;
}

function metricNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  return 0;
}
