import { describe, expect, it, vi } from "vitest";
import type { SessionCredentials } from "../domain/types";
import { runLiveReport } from "./liveReportRunner";

const basicCredentials: SessionCredentials = {
  instanceType: "basic-business",
  baseUrl: "https://stackoverflowteams.com/c/example-team",
  pat: "pat",
  authSource: "manual-pat",
};
const CONNECTION_REQUIRED_MESSAGE = "Enterprise access token is required for Stack API v3 calls.";

describe("runLiveReport", () => {
  it("rejects Enterprise mixed v2 and v3 reports without a v3 access token before collecting datasets", async () => {
    const fetchMock = vi.fn().mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify({ items: [], has_more: false, totalPages: 1 }), {
        status: 200,
      })),
    );

    await expect(
      runLiveReport(
        "api-user-report",
        {
          instanceType: "enterprise",
          baseUrl: "https://demo.stackenterprise.co",
          apiKey: "key",
        },
        { fetchFn: fetchMock },
      ),
    ).rejects.toThrow(CONNECTION_REQUIRED_MESSAGE);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("runs Enterprise v2-only reports with API key credentials", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ items: [{ user_id: 1, display_name: "Ada" }], has_more: false }), {
        status: 200,
      }),
    );

    const result = await runLiveReport(
      "inactive-users",
      {
        instanceType: "enterprise",
        baseUrl: "https://demo.stackenterprise.co",
        apiKey: "key",
      },
      { fetchFn: fetchMock },
    );

    expect(result.datasets).toEqual([
      {
        datasetName: "users",
        records: [{ user_id: 1, display_name: "Ada" }],
      },
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0].toString()).toContain(
      "https://demo.stackenterprise.co/api/2.3/users",
    );
  });

  it("collects mapped live datasets for a selected report", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ items: [{ user_id: 1, display_name: "Ada" }], has_more: false }), {
        status: 200,
      }),
    );

    const result = await runLiveReport("inactive-users", basicCredentials, {
      fetchFn: fetchMock,
    });

    expect(result.datasets).toEqual([
      {
        datasetName: "users",
        records: [{ user_id: 1, display_name: "Ada" }],
      },
    ]);
    expect(result.messages).toEqual(["Collected users (1 record) for Inactive Users."]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0].toString()).toContain(
      "https://api.stackoverflowteams.com/2.3/users",
    );
    expect(fetchMock.mock.calls[0][0].toString()).toContain("team=example-team");
  });

  it("passes scoped period and volume limits to live dataset requests", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ items: [{ user_id: 1, display_name: "Ada" }], has_more: true }), {
        status: 200,
      }),
    );

    const result = await runLiveReport("inactive-users", basicCredentials, {
      periodRole: "current",
      scope: { startDate: "2026-01-01", endDate: "2026-01-31" },
      pageSize: 50,
      maxPagesPerDataset: 1,
      fetchFn: fetchMock,
    });

    expect(result.periodRole).toBe("current");
    expect(result.scope).toEqual({ startDate: "2026-01-01", endDate: "2026-01-31" });
    expect(result.pageSize).toBe(50);
    expect(result.maxPagesPerDataset).toBe(1);
    expect(result.warnings).toEqual([
      {
        reportId: "inactive-users",
        code: "dataset-page-cap",
        message:
          "Configured API volume cap of 50 records reached for users. More users data is available; use Deep audit or Advanced API volume settings for a more complete run.",
      },
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0].toString()).toContain("pagesize=50");
    expect(fetchMock.mock.calls[0][0].toString()).toContain("fromdate=1767225600");
    expect(fetchMock.mock.calls[0][0].toString()).toContain("todate=1769817600");
  });

  it("warns when a preset cap leaves more dataset data available", async () => {
    const fetchMock = vi.fn().mockImplementation((input: RequestInfo | URL) => {
      const url = input.toString();
      const isTagsDataset = url.includes("/tags?") && !url.includes("/top-answerers/");

      return Promise.resolve(
        new Response(
          JSON.stringify({
            items: isTagsDataset ? [{ name: "python" }] : itemsForTagReportUrl(url),
            has_more: isTagsDataset,
          }),
          { status: 200 },
        ),
      );
    });

    const result = await runLiveReport("tag-report", basicCredentials, {
      fetchFn: fetchMock,
      pageSize: 50,
      maxPagesPerDataset: 1,
      runPreset: "quick-sample",
    });

    expect(result.runPreset).toBe("quick-sample");
    expect(result.warnings).toEqual([
      {
        reportId: "tag-report",
        code: "dataset-page-cap",
        message:
          "Quick sample cap of 50 records reached for tags. More tags data is available; use Deep audit or Advanced API volume settings for a more complete run.",
      },
    ]);
  });

  it("runs Tag Report by collecting tag SME records from tags", async () => {
    const fetchMock = vi.fn().mockImplementation((input: RequestInfo | URL) =>
      Promise.resolve(
        new Response(JSON.stringify({ items: itemsForTagReportUrl(input.toString()), has_more: false }), {
          status: 200,
        }),
      ),
    );

    const result = await runLiveReport("tag-report", basicCredentials, {
      fetchFn: fetchMock,
    });

    expect(result.datasets.map((dataset) => dataset.datasetName)).toEqual([
      "tags",
      "users",
      "questions",
      "articles",
      "tagSmes",
    ]);
    expect(result.datasets.find((dataset) => dataset.datasetName === "tagSmes")?.records).toEqual([
      { tagName: "python", user_id: 1, score: 12 },
    ]);
  });

  it("runs API User Report by collecting reputation history from users", async () => {
    const fetchMock = vi.fn().mockImplementation((input: RequestInfo | URL) =>
      Promise.resolve(
        new Response(JSON.stringify({ items: itemsForApiUserReportUrl(input.toString()), has_more: false, totalPages: 1 }), {
          status: 200,
        }),
      ),
    );

    const result = await runLiveReport("api-user-report", basicCredentials, {
      fetchFn: fetchMock,
    });

    expect(result.datasets.map((dataset) => dataset.datasetName)).toEqual([
      "users",
      "questions",
      "articles",
      "tags",
      "reputationHistory",
      "communities",
    ]);
    expect(fetchMock.mock.calls.map((call) => call[0].toString())).toContain(
      "https://api.stackoverflowteams.com/2.3/users/1/reputation-history?pagesize=100&page=1&team=example-team",
    );
  });

  it("runs Data Export by collecting concrete API datasets", async () => {
    const fetchMock = vi.fn().mockImplementation(() =>
      Promise.resolve(
        new Response(JSON.stringify({ items: [{ id: 1 }], has_more: false, totalPages: 1 }), {
          status: 200,
        }),
      ),
    );

    const result = await runLiveReport("data-export", basicCredentials, {
      fetchFn: fetchMock,
    });

    expect(result.datasets.map((dataset) => dataset.datasetName)).toEqual([
      "users",
      "userGroups",
      "tags",
      "articles",
      "questions",
      "answers",
      "comments",
    ]);
    expect(result.messages).toContain("Collected comments (1 record) for Data Export.");
  });

  it("builds Interactions from live content datasets", async () => {
    const fetchMock = vi.fn().mockImplementation((input: RequestInfo | URL) => {
      const url = input.toString();
      const items = itemsForInteractionsUrl(url);

      return Promise.resolve(
        new Response(JSON.stringify({ items, has_more: false }), {
          status: 200,
        }),
      );
    });

    const result = await runLiveReport("interactions", basicCredentials, {
      fetchFn: fetchMock,
    });

    expect(result.datasets.map((dataset) => dataset.datasetName)).toEqual([
      "users",
      "questions",
      "answers",
      "comments",
      "interactions",
    ]);
    expect(result.datasets.find((dataset) => dataset.datasetName === "interactions")?.records).toEqual([
      { source: "Engineering", target: "Product", weight: 1 },
      { source: "Support", target: "Engineering", weight: 1 },
    ]);
  });
});

function itemsForInteractionsUrl(url: string): Record<string, unknown>[] {
  if (url.includes("/users")) {
    return [
      { user_id: 1, department: "Engineering" },
      { user_id: 2, department: "Product" },
      { user_id: 3, department: "Support" },
    ];
  }

  if (url.includes("/questions")) {
    return [{ question_id: 10, owner: { user_id: 2 } }];
  }

  if (url.includes("/answers")) {
    return [{ answer_id: 100, question_id: 10, owner: { user_id: 1 } }];
  }

  if (url.includes("/comments")) {
    return [{ comment_id: 200, post_id: 100, owner: { user_id: 3 } }];
  }

  return [];
}

function itemsForTagReportUrl(url: string): Record<string, unknown>[] {
  if (url.includes("/tags?")) {
    return [{ name: "python" }];
  }

  if (url.includes("/top-answerers/")) {
    return [{ user_id: 1, score: 12 }];
  }

  return [{ id: 1 }];
}

function itemsForApiUserReportUrl(url: string): Record<string, unknown>[] {
  if (url.includes("/users?")) {
    return [{ user_id: 1 }];
  }

  if (url.includes("/reputation-history")) {
    return [{ user_id: 1, reputation_change: 5 }];
  }

  return [{ id: 1 }];
}
