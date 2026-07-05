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
const CONNECTION_REQUIRED_MESSAGE = "Enterprise OAuth connection is required for Stack API v3 calls.";

describe("handleReportRunRequest", () => {
  it("runs reports server-side and returns live datasets", async () => {
    const result: LiveReportRunResult = {
      reportId: "inactive-users",
      reportTitle: "Inactive Users",
      periodRole: "current",
      scope: {},
      pageSize: 100,
      maxPagesPerDataset: 5,
      datasets: [
        {
          datasetName: "users",
          records: [{ user_id: 1, display_name: "Ada" }],
        },
      ],
      messages: ["Collected users (1 record) for Inactive Users."],
      warnings: [],
    };
    const runLiveReport = vi.fn().mockResolvedValue(result);

    const response = await handleReportRunRequest(
      {
        reportId: "inactive-users",
        credentials,
        periodRole: "current",
        scope: {},
        pageSize: 100,
        maxPagesPerDataset: 5,
      },
      { runLiveReport },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, result });
    expect(runLiveReport).toHaveBeenCalledWith("inactive-users", credentials, {
      periodRole: "current",
      scope: {},
      pageSize: 100,
      maxPagesPerDataset: 5,
    });
  });

  it("rejects Enterprise v3 report credentials before calling the runner", async () => {
    const runLiveReport = vi.fn();

    const response = await handleReportRunRequest(
      {
        reportId: "api-user-report",
        credentials: {
          instanceType: "enterprise",
          baseUrl: "https://soedemo.stackenterprise.co",
          apiKey: "key",
        },
      },
      { runLiveReport },
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: CONNECTION_REQUIRED_MESSAGE,
    });
    expect(runLiveReport).not.toHaveBeenCalled();
  });

  it("accepts Enterprise API key credentials for v2-only reports before calling the runner", async () => {
    const result: LiveReportRunResult = {
      reportId: "inactive-users",
      reportTitle: "Inactive Users",
      periodRole: "current",
      scope: {},
      pageSize: 100,
      maxPagesPerDataset: 5,
      datasets: [
        {
          datasetName: "users",
          records: [{ user_id: 1, display_name: "Ada" }],
        },
      ],
      messages: ["Collected users (1 record) for Inactive Users."],
      warnings: [],
    };
    const runLiveReport = vi.fn().mockResolvedValue(result);
    const apiKeyOnlyCredentials: SessionCredentials = {
      instanceType: "enterprise",
      baseUrl: "https://soedemo.stackenterprise.co",
      apiKey: "key",
    };

    const response = await handleReportRunRequest(
      {
        reportId: "inactive-users",
        credentials: apiKeyOnlyCredentials,
      },
      { runLiveReport },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, result });
    expect(runLiveReport).toHaveBeenCalledWith("inactive-users", apiKeyOnlyCredentials, {
      periodRole: "current",
      scope: {},
      pageSize: 100,
      maxPagesPerDataset: 5,
    });
  });

  it("returns a 400 response for malformed OAuth metadata before calling the runner", async () => {
    const runLiveReport = vi.fn();

    const response = await handleReportRunRequest(
      {
        reportId: "api-user-report",
        credentials: {
          instanceType: "enterprise",
          baseUrl: "https://soedemo.stackenterprise.co",
          apiKey: "key",
          accessToken: "token",
          authSource: "oauth-pkce",
          oauthScopes: {},
        },
      },
      { runLiveReport },
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: "Report run request requires a reportId and credentials.",
    });
    expect(runLiveReport).not.toHaveBeenCalled();
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

  it("returns a 400 response for invalid scope payloads", async () => {
    const runLiveReport = vi.fn();

    const response = await handleReportRunRequest(
      {
        reportId: "inactive-users",
        credentials,
        periodRole: "current",
        scope: { startDate: "2026-04-30", endDate: "2026-04-01" },
        pageSize: 0,
        maxPagesPerDataset: 0,
      },
      { runLiveReport },
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error:
        "Page size must be between 1 and 100. Max pages per dataset must be at least 1. Current period end date must be on or after its start date.",
    });
    expect(runLiveReport).not.toHaveBeenCalled();
  });
});
