import { describe, expect, it } from "vitest";
import {
  communityMembersCsv,
  dataExportUsersJson,
  inactiveUsersCsv,
  interactionMatrixCsv,
  tagMetricsCsv,
  tagMetricsWithMetadataCsv,
  userMetricsCsv,
} from "../test/fixtures/reportFixtures";
import { importReportFile } from "./reportImporters";

describe("importReportFile", () => {
  it("imports tag metrics CSV", async () => {
    const result = await importReportFile("tag_metrics.csv", tagMetricsCsv);
    expect(result.reportId).toBe("tag-report");
    expect(result.records[0]).toMatchObject({
      tagName: "machine-learning",
      tagId: null,
      tagCreationDate: "",
      lastUsed: "",
      totalPageViews: 551412,
      questionsNoAnswers: 222,
      medianFirstAnswerHours: 7.41,
    });
  });

  it("imports Tag Report metadata from the updated CSV format", async () => {
    const result = await importReportFile("tag_metrics.csv", tagMetricsWithMetadataCsv);

    expect(result.records[0]).toMatchObject({
      tagName: "machine-learning",
      tagId: 42,
      tagCreationDate: "2014-05-13",
      lastUsed: "2026-08-18",
      totalPageViews: 551412,
      questionsNoAnswers: 222,
      medianFirstAnswerHours: 7.41,
    });
  });

  it("imports blank and invalid Tag Report IDs as null", async () => {
    for (const tagId of ["", "not-an-id", "-1", "1.5", "9007199254740992"]) {
      const csv = tagMetricsWithMetadataCsv.replace("machine-learning,42,", `machine-learning,${tagId},`);
      const result = await importReportFile("tag_metrics.csv", csv);

      expect(result.records[0]).toMatchObject({ tagId: null });
    }
  });

  it("imports user metrics CSV", async () => {
    const result = await importReportFile("user_metrics.csv", userMetricsCsv);
    expect(result.reportId).toBe("api-user-report");
    expect(result.records[0]).toMatchObject({ userId: 96, displayName: "Harley Q." });
  });

  it("imports inactive users CSV", async () => {
    const result = await importReportFile("inactive_users.csv", inactiveUsersCsv);
    expect(result.reportId).toBe("inactive-users");
    expect(result.records[0]).toMatchObject({ userId: 11, inactiveDays: 297 });
  });

  it("imports community members CSV", async () => {
    const result = await importReportFile("2026-04-13_community_members_Engineering.csv", communityMembersCsv);
    expect(result.reportId).toBe("community-members");
    expect(result.records[0]).toMatchObject({ name: "Jane Doe", isSme: true });
  });

  it("imports interaction matrix CSV", async () => {
    const result = await importReportFile("interaction_matrix.csv", interactionMatrixCsv);
    expect(result.reportId).toBe("interactions");
    expect(result.records).toEqual([
      { source: "Engineering", target: "Product", weight: 4 },
      { source: "Product", target: "Engineering", weight: 2 },
    ]);
  });

  it("imports data export JSON", async () => {
    const result = await importReportFile("users.json", dataExportUsersJson);
    expect(result.reportId).toBe("data-export");
    expect(result.records).toHaveLength(2);
  });

  it("does not misroute ambiguous filenames", async () => {
    await expect(importReportFile("community_members_inactive.csv", communityMembersCsv)).rejects.toThrow(
      "Unsupported report output file",
    );
  });
});
