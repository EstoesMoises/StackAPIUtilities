import { describe, expect, it, vi } from "vitest";
import type { LiveReportRunResult } from "../collectors/liveReportRunner";
import type { SessionCredentials } from "../domain/types";
import { handleReportRunRequest } from "./reportRunApi";

const credentials: SessionCredentials = {
  instanceType: "enterprise",
  baseUrl: "https://soedemo.stackenterprise.co",
  apiKey: "key",
  accessToken: "token",
};

describe("handleReportRunRequest", () => {
  it("runs reports server-side and returns live datasets", async () => {
    const result: LiveReportRunResult = {
      reportId: "inactive-users",
      reportTitle: "Inactive Users",
      datasets: [
        {
          datasetName: "users",
          records: [{ user_id: 1, display_name: "Ada" }],
        },
      ],
      messages: ["Collected users (1 record) for Inactive Users."],
    };
    const runLiveReport = vi.fn().mockResolvedValue(result);

    const response = await handleReportRunRequest(
      { reportId: "inactive-users", credentials },
      { runLiveReport },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, result });
    expect(runLiveReport).toHaveBeenCalledWith("inactive-users", credentials);
  });

  it("returns a 400 response for invalid request payloads", async () => {
    const runLiveReport = vi.fn();

    const response = await handleReportRunRequest({ reportId: "inactive-users" }, { runLiveReport });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: "Report run request requires a reportId and credentials.",
    });
    expect(runLiveReport).not.toHaveBeenCalled();
  });
});
