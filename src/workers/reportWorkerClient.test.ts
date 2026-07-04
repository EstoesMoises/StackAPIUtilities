import { describe, expect, it } from "vitest";
import { createInlineReportWorkerClient } from "./reportWorkerClient";

describe("createInlineReportWorkerClient", () => {
  it("imports uploaded report text through the same client interface", async () => {
    const client = createInlineReportWorkerClient();
    const result = await client.importFile(
      "inactive_users.csv",
      "user_id,display_name,inactive_days,is_deactivated,reputation,answer_count,question_count,article_count\n1,A,90,FALSE,0,0,0,0",
    );
    expect(result.reportId).toBe("inactive-users");
  });
});
