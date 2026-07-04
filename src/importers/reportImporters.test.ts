import { describe, expect, it } from "vitest";
import {
  communityMembersCsv,
  dataExportUsersJson,
  inactiveUsersCsv,
  interactionMatrixCsv,
  tagMetricsCsv,
  userMetricsCsv,
} from "../test/fixtures/reportFixtures";
import { importReportFile } from "./reportImporters";

describe("importReportFile", () => {
  it("imports tag metrics CSV", async () => {
    const result = await importReportFile("tag_metrics.csv", tagMetricsCsv);
    expect(result.reportId).toBe("tag-report");
    expect(result.records[0]).toMatchObject({ tagName: "machine-learning", totalPageViews: 551412 });
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
