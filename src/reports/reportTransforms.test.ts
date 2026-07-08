import { describe, expect, it } from "vitest";
import { summarizeCommunityMembers } from "./communityMembers";
import { summarizeDataExport } from "./dataExport";
import { summarizeInactiveUsers } from "./inactiveUsers";
import { buildInteractionSummary } from "./interactions";
import {
  buildTagHealthRows,
  buildTagHealthRowsFromLiveRecords,
  summarizeTagHealthRows,
  summarizeTags,
  type TagMetricRow,
} from "./tagReport";
import { summarizeUsers } from "./userReport";

describe("report transforms", () => {
  it("summarizes tag metrics", () => {
    const summary = summarizeTags([
      { tagName: "python", totalPageViews: 100, tagWatchers: 10, totalSmes: 2, questionCount: 4, answerCount: 8 },
      { tagName: "r", totalPageViews: 50, tagWatchers: 5, totalSmes: 1, questionCount: 2, answerCount: 3 },
    ]);
    expect(summary.metricCards).toContainEqual({ label: "Tags", value: 2 });
    expect(summary.topTagsByViews[0].tagName).toBe("python");
  });

  it("summarizes empty tag metrics", () => {
    const summary = summarizeTags([]);
    expect(summary.metricCards).toContainEqual({ label: "Tags", value: 0 });
    expect(summary.topTagsByViews).toEqual([]);
  });

  it("treats missing tag metric numbers as zero", () => {
    const summary = summarizeTags([{ tagName: "python", totalPageViews: 100 } as TagMetricRow]);

    expect(summary.metricCards).toContainEqual({ label: "Questions", value: 0 });
  });

  it("does not mutate tag metric inputs while sorting", () => {
    const rows = [
      { tagName: "r", totalPageViews: 50, tagWatchers: 5, totalSmes: 1, questionCount: 2, answerCount: 3 },
      { tagName: "python", totalPageViews: 100, tagWatchers: 10, totalSmes: 2, questionCount: 4, answerCount: 8 },
    ];

    summarizeTags(rows);

    expect(rows.map((row) => row.tagName)).toEqual(["r", "python"]);
  });

  it("builds Tag Health rows with conservative health statuses and actions", () => {
    const healthRows = buildTagHealthRows([
      {
        tagName: "python",
        totalPageViews: 500,
        tagWatchers: 20,
        totalSmes: 0,
        questionCount: 8,
        answerCount: 11,
        questionsNoAnswers: 1,
        medianFirstAnswerHours: 12,
      },
      {
        tagName: "old-product",
        totalPageViews: 4,
        tagWatchers: 0,
        totalSmes: 0,
        questionCount: 0,
        answerCount: 0,
        questionsNoAnswers: 0,
      },
    ]);

    expect(healthRows[0]).toMatchObject({
      tag_name: "python",
      health_status: "Needs SME coverage",
      page_views: 500,
      question_count: 8,
      answer_count: 11,
      sme_count: 0,
      watcher_count: 20,
      unanswered_questions: 1,
      median_first_answer_hours: 12,
      recommended_action: "Assign or confirm SMEs for this tag.",
    });
    expect(healthRows[1]).toMatchObject({
      tag_name: "old-product",
      health_status: "Low activity",
      recommended_action: "Review whether this tag is still useful or should be consolidated.",
    });
  });

  it("calls out meaningful tag activity without SMEs even when there are no questions", () => {
    const [healthRow] = buildTagHealthRows([
      {
        tagName: "platform-api",
        totalPageViews: 250,
        tagWatchers: 12,
        totalSmes: 0,
        questionCount: 0,
        answerCount: 0,
      },
    ]);

    expect(healthRow).toMatchObject({
      tag_name: "platform-api",
      health_status: "Needs SME coverage",
      recommended_action: "Assign or confirm SMEs for this tag.",
    });
  });

  it("uses medianTimeToFirstAnswerHours as a slow-response signal", () => {
    const [healthRow] = buildTagHealthRows([
      {
        tagName: "python",
        totalPageViews: 100,
        tagWatchers: 8,
        totalSmes: 1,
        questionCount: 4,
        answerCount: 5,
        medianTimeToFirstAnswerHours: 36,
      },
    ]);

    expect(healthRow).toMatchObject({
      health_status: "Needs response attention",
      median_first_answer_hours: 36,
      recommended_action: "Review unanswered questions and response time for this tag.",
    });
  });

  it("summarizes Tag Health rows for dashboard-ready metrics and slices", () => {
    const summary = summarizeTagHealthRows([
      {
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
      },
      {
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
      },
      {
        tag_name: "excel",
        health_status: "Needs SME coverage",
        page_views: 150,
        question_count: 3,
        answer_count: 4,
        sme_count: 0,
        watcher_count: 6,
        unanswered_questions: 0,
        median_first_answer_hours: 9,
        recommended_action: "Assign or confirm SMEs for this tag.",
      },
    ]);

    expect(summary.metricCards).toContainEqual({ label: "Tags Covered", value: 3 });
    expect(summary.metricCards).toContainEqual({ label: "Response Attention", value: 1 });
    expect(summary.tagsNeedingResponse.map((row) => row.tag_name)).toEqual(["python"]);
    expect(summary.tagsNeedingSmeCoverage.map((row) => row.tag_name)).toEqual(["excel"]);
    expect(summary.topTagsByViews.map((row) => row.tag_name)).toEqual(["python", "r", "excel"]);
  });

  it("builds Tag Health rows from live tag, question, and tag SME records", () => {
    const healthRows = buildTagHealthRowsFromLiveRecords([
      { datasetName: "tags", name: "python", count: 4 },
      { datasetName: "questions", question_id: 1, tags: ["python"], answer_count: 0, view_count: 30 },
      { datasetName: "questions", question_id: 2, tags: ["python"], answer_count: 2, view_count: 50 },
      { datasetName: "tagSmes", tagName: "python", user_id: 96, score: 12 },
    ]);

    expect(healthRows).toEqual([
      {
        tag_name: "python",
        health_status: "Needs response attention",
        page_views: 80,
        question_count: 2,
        answer_count: 2,
        sme_count: 1,
        watcher_count: 0,
        unanswered_questions: 1,
        median_first_answer_hours: 0,
        recommended_action: "Review unanswered questions and response time for this tag.",
      },
    ]);
  });

  it("counts live questions with answers but is_answered false as needing response attention", () => {
    const healthRows = buildTagHealthRowsFromLiveRecords([
      { datasetName: "tags", name: "python" },
      { datasetName: "questions", question_id: 1, tags: ["python"], answer_count: 2, is_answered: false, view_count: 45 },
      { datasetName: "tagSmes", tagName: "python", user_id: 96, score: 12 },
    ]);

    expect(healthRows[0]).toMatchObject({
      tag_name: "python",
      health_status: "Needs response attention",
      answer_count: 2,
      unanswered_questions: 1,
      recommended_action: "Review unanswered questions and response time for this tag.",
    });
  });

  it("summarizes user metrics", () => {
    const summary = summarizeUsers([
      { userId: 1, displayName: "A", netReputation: 20, accountInactivityDays: 0, answers: 5, questions: 1, accountStatus: "Registered", department: "Engineering" },
      { userId: 2, displayName: "B", netReputation: 10, accountInactivityDays: 90, answers: 0, questions: 2, accountStatus: "Deactivated", department: "Product" },
    ]);
    expect(summary.accountStatusCounts).toEqual({ Registered: 1, Deactivated: 1 });
    expect(summary.topContributors[0].displayName).toBe("A");
  });

  it("summarizes inactive users", () => {
    const summary = summarizeInactiveUsers([
      { userId: 1, inactiveDays: 120, isDeactivated: false, reputation: 10, answerCount: 1, questionCount: 0, articleCount: 0 },
      { userId: 2, inactiveDays: 240, isDeactivated: true, reputation: 0, answerCount: 0, questionCount: 0, articleCount: 0 },
    ]);
    expect(summary.contributingInactiveUsers).toBe(1);
    expect(summary.deactivatedInactiveUsers).toBe(1);
  });

  it("builds interaction summary", () => {
    const summary = buildInteractionSummary([
      { source: "Engineering", target: "Product", weight: 4 },
      { source: "Product", target: "Engineering", weight: 2 },
    ]);
    expect(summary.totalInteractions).toBe(6);
    expect(summary.nodes).toEqual(["Engineering", "Product"]);
  });

  it("builds empty interaction summaries", () => {
    expect(buildInteractionSummary([])).toEqual({
      totalInteractions: 0,
      nodes: [],
      edges: [],
      topEdges: [],
    });
  });

  it("returns interaction summary edges independent from caller input", () => {
    const edges = [{ source: "Engineering", target: "Product", weight: 4 }];
    const summary = buildInteractionSummary(edges);

    summary.edges[0].weight = 99;

    expect(edges[0].weight).toBe(4);
  });


  it("summarizes community members", () => {
    const summary = summarizeCommunityMembers([
      { name: "Jane Doe", isSme: true, department: "Engineering" },
      { name: "John Smith", isSme: false, department: "Product" },
    ]);
    expect(summary.totalMembers).toBe(2);
    expect(summary.smeMembers).toBe(1);
  });

  it("summarizes data export datasets", () => {
    const summary = summarizeDataExport({
      users: [{ id: 1 }],
      tags: [{ name: "python" }, { name: "r" }],
    });
    expect(summary.datasetCounts).toEqual({ users: 1, tags: 2 });
  });
});
