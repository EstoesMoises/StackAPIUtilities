import { describe, expect, it } from "vitest";
import { summarizeCommunityMembers } from "./communityMembers";
import { summarizeDataExport } from "./dataExport";
import { summarizeInactiveUsers } from "./inactiveUsers";
import { buildInteractionSummary } from "./interactions";
import { summarizeTags } from "./tagReport";
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

  it("does not mutate tag metric inputs while sorting", () => {
    const rows = [
      { tagName: "r", totalPageViews: 50, tagWatchers: 5, totalSmes: 1, questionCount: 2, answerCount: 3 },
      { tagName: "python", totalPageViews: 100, tagWatchers: 10, totalSmes: 2, questionCount: 4, answerCount: 8 },
    ];

    summarizeTags(rows);

    expect(rows.map((row) => row.tagName)).toEqual(["r", "python"]);
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
