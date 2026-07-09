import type { MetricCard } from "./reportModels";

export interface TagMetricRow {
  tagName: string;
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

export interface TagHealthRow {
  tag_name: string;
  health_status: TagHealthStatus;
  page_views: number;
  question_count: number;
  answer_count: number;
  sme_count: number;
  watcher_count: number;
  unanswered_questions: number;
  median_first_answer_hours: number;
  recommended_action: string;
}

export type TagDashboardDeltaTone = "good" | "bad" | "neutral";
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
  "health_status",
  "page_views",
  "question_count",
  "answer_count",
  "sme_count",
  "watcher_count",
  "unanswered_questions",
  "median_first_answer_hours",
  "recommended_action",
] as const satisfies readonly (keyof TagHealthRow)[];

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

interface LiveTagAggregate {
  tagName: string;
  pageViews: number;
  questionCount: number;
  tagQuestionCount: number;
  sawQuestions: boolean;
  answerCount: number;
  watcherCount: number;
  unansweredQuestions: number;
  firstAnswerHours: number[];
  smeIds: Set<string>;
}

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
    const pageViews = getNumber(row, "totalPageViews", "page_views", "pageViews", "view_count", "viewCount");
    const questionCount = getNumber(row, "questionCount", "question_count");
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
      health_status: healthStatus,
      page_views: pageViews,
      question_count: questionCount,
      answer_count: answerCount,
      sme_count: smeCount,
      watcher_count: watcherCount,
      unanswered_questions: unansweredQuestions,
      median_first_answer_hours: medianFirstAnswerHours,
      recommended_action: getRecommendedAction(healthStatus),
    };
  });
}

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
  const aggregates = new Map<string, LiveTagAggregate>();

  for (const record of records.filter((candidate) => candidate.datasetName === "tags")) {
    const tagName = getText(record, "name", "tagName", "tag_name");
    if (!tagName) continue;

    const aggregate = ensureLiveAggregate(aggregates, tagName);
    aggregate.pageViews += getNumber(record, "totalPageViews", "page_views", "pageViews", "view_count", "viewCount");
    aggregate.watcherCount += getNumber(
      record,
      "tagWatchers",
      "watcher_count",
      "watcherCount",
      "followers",
      "follower_count",
    );
    aggregate.tagQuestionCount = Math.max(aggregate.tagQuestionCount, getNumber(record, "questionCount", "question_count", "count"));
  }

  for (const record of records.filter((candidate) => candidate.datasetName === "questions")) {
    const tags = getQuestionTags(record);

    for (const tagName of tags) {
      const aggregate = ensureLiveAggregate(aggregates, tagName);
      const answerCount = getNumber(record, "answer_count", "answerCount");

      aggregate.sawQuestions = true;
      aggregate.questionCount += 1;
      aggregate.answerCount += answerCount;
      aggregate.pageViews += getNumber(record, "view_count", "viewCount", "page_views", "pageViews", "totalPageViews");
      if (isQuestionUnanswered(record, answerCount)) aggregate.unansweredQuestions += 1;

      const firstAnswerHours = getFirstAnswerHours(record);
      if (firstAnswerHours !== null) aggregate.firstAnswerHours.push(firstAnswerHours);
    }
  }

  records
    .filter((candidate) => candidate.datasetName === "tagSmes")
    .forEach((record, index) => {
      const tagName = getText(record, "tagName", "tag_name", "name");
      if (!tagName) return;

      ensureLiveAggregate(aggregates, tagName).smeIds.add(getSmeIdentity(record) ?? `row-${index}`);
    });

  return buildTagHealthRows(
    [...aggregates.values()].map((aggregate) => ({
      tagName: aggregate.tagName,
      totalPageViews: aggregate.pageViews,
      tagWatchers: aggregate.watcherCount,
      totalSmes: aggregate.smeIds.size,
      questionCount: aggregate.sawQuestions ? aggregate.questionCount : aggregate.tagQuestionCount,
      answerCount: aggregate.answerCount,
      questionsNoAnswers: aggregate.unansweredQuestions,
      medianFirstAnswerHours: median(aggregate.firstAnswerHours),
    })),
  );
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

function ensureLiveAggregate(aggregates: Map<string, LiveTagAggregate>, tagName: string): LiveTagAggregate {
  const existing = aggregates.get(tagName);
  if (existing) return existing;

  const aggregate: LiveTagAggregate = {
    tagName,
    pageViews: 0,
    questionCount: 0,
    tagQuestionCount: 0,
    sawQuestions: false,
    answerCount: 0,
    watcherCount: 0,
    unansweredQuestions: 0,
    firstAnswerHours: [],
    smeIds: new Set(),
  };

  aggregates.set(tagName, aggregate);
  return aggregate;
}

function getQuestionTags(record: Record<string, unknown>): string[] {
  const tags = record.tags ?? record.tagNames ?? record.tag_names;

  if (Array.isArray(tags)) {
    return tags.filter((tag): tag is string => typeof tag === "string" && tag.trim() !== "").map((tag) => tag.trim());
  }

  if (typeof tags === "string") {
    return tags
      .split(/[;,]/)
      .map((tag) => tag.trim())
      .filter(Boolean);
  }

  const singleTag = getText(record, "tagName", "tag_name", "name");
  return singleTag ? [singleTag] : [];
}

function isQuestionUnanswered(record: Record<string, unknown>, answerCount: number): boolean {
  const isAnswered = getBoolean(record, "is_answered", "isAnswered");

  if (isAnswered !== null) return !isAnswered;

  return answerCount === 0;
}

function getFirstAnswerHours(record: Record<string, unknown>): number | null {
  const creationSeconds = getEpochSeconds(record, "creation_date", "creationDate", "created_at", "createdAt");
  const firstAnswerSeconds = getEpochSeconds(
    record,
    "first_answer_creation_date",
    "firstAnswerCreationDate",
    "first_answer_date",
    "firstAnswerDate",
    "first_answered_at",
    "firstAnsweredAt",
  );

  if (creationSeconds === null || firstAnswerSeconds === null || firstAnswerSeconds < creationSeconds) {
    return null;
  }

  return Number(((firstAnswerSeconds - creationSeconds) / 3600).toFixed(2));
}

function getEpochSeconds(record: Record<string, unknown>, ...fieldNames: string[]): number | null {
  for (const fieldName of fieldNames) {
    const value = record[fieldName];

    if (typeof value === "number" && Number.isFinite(value)) {
      return value > 1_000_000_000_000 ? Math.floor(value / 1000) : value;
    }

    if (typeof value === "string" && value.trim() !== "") {
      const numericValue = Number(value);
      if (Number.isFinite(numericValue)) {
        return numericValue > 1_000_000_000_000 ? Math.floor(numericValue / 1000) : numericValue;
      }

      const parsedDate = Date.parse(value);
      if (Number.isFinite(parsedDate)) return Math.floor(parsedDate / 1000);
    }
  }

  return null;
}

function getSmeIdentity(record: Record<string, unknown>): string | null {
  for (const fieldName of ["user_id", "userId", "account_id", "accountId", "display_name", "displayName"]) {
    const value = record[fieldName];
    if (typeof value === "string" && value.trim() !== "") return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }

  return null;
}

function getText(record: Record<string, unknown>, ...fieldNames: string[]): string {
  for (const fieldName of fieldNames) {
    const value = record[fieldName];
    if (typeof value === "string" && value.trim() !== "") return value.trim();
  }

  return "";
}

function getBoolean(record: Record<string, unknown>, ...fieldNames: string[]): boolean | null {
  for (const fieldName of fieldNames) {
    const value = record[fieldName];
    if (typeof value === "boolean") return value;
    if (typeof value === "string") {
      const normalized = value.trim().toLowerCase();
      if (normalized === "true") return true;
      if (normalized === "false") return false;
    }
  }

  return null;
}

function getNumber(record: Record<string, unknown>, ...fieldNames: string[]): number {
  for (const fieldName of fieldNames) {
    const value = record[fieldName];
    const parsed = metricNumber(value);
    if (parsed !== 0 || value === 0 || value === "0") return parsed;
  }

  return 0;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;

  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);

  if (sorted.length % 2 === 1) return sorted[middle];

  return Number(((sorted[middle - 1] + sorted[middle]) / 2).toFixed(2));
}

function metricNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  return 0;
}
