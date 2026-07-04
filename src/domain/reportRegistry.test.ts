import { describe, expect, it } from "vitest";
import { getExecutableReports, reportRegistry } from "./reportRegistry";

describe("reportRegistry", () => {
  it("contains the six browser-ready read-only MVP reports", () => {
    expect(reportRegistry.filter((report) => report.phase === "mvp").map((report) => report.id)).toEqual([
      "tag-report",
      "api-user-report",
      "inactive-users",
      "interactions",
      "community-members",
      "data-export",
    ]);
  });

  it("keeps later-phase write and scraping tools out of executable reports", () => {
    expect(getExecutableReports().map((report) => report.id)).not.toContain("api-import");
    expect(getExecutableReports().map((report) => report.id)).not.toContain("webhook-report");
    expect(getExecutableReports().map((report) => report.id)).not.toContain("scim-user-deletion");
  });
});
