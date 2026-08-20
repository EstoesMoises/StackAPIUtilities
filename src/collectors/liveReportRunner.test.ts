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
        pagination: { pageCount: 1, reachedMaxPages: false, hasMore: false },
      },
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0].toString()).toContain(
      "https://demo.stackenterprise.co/api/2.3/users",
    );
  });

  it("does not attach Enterprise access tokens to v2-only dataset requests", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ items: [{ user_id: 1, display_name: "Ada" }], has_more: false }), {
        status: 200,
      }),
    );

    await runLiveReport(
      "inactive-users",
      {
        instanceType: "enterprise",
        baseUrl: "https://demo.stackenterprise.co",
        apiKey: "key",
        accessToken: "mismatched-token",
        authSource: "manual-enterprise-token",
      },
      { fetchFn: fetchMock },
    );

    expect(fetchMock.mock.calls[0][1]?.headers).toEqual({ "X-API-Key": "key" });
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
        pagination: { pageCount: 1, reachedMaxPages: false, hasMore: false },
      },
    ]);
    expect(result.messages).toEqual(["Collected users (1 record) for Inactive Users."]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0].toString()).toContain(
      "https://api.stackoverflowteams.com/2.3/users",
    );
    expect(fetchMock.mock.calls[0][0].toString()).toContain("team=example-team");
  });

  it("collects every available page with the server-owned page size", async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const page = new URL(input.toString()).searchParams.get("page");
      return Promise.resolve(new Response(JSON.stringify({
        items: [{ user_id: page === "1" ? 1 : 2 }],
        has_more: page === "1",
      }), { status: 200 }));
    });

    const result = await runLiveReport("inactive-users", basicCredentials, {
      periodRole: "current",
      scope: { startDate: "2026-01-01", endDate: "2026-01-31" },
      fetchFn: fetchMock,
    });

    expect(result.periodRole).toBe("current");
    expect(result.scope).toEqual({ startDate: "2026-01-01", endDate: "2026-01-31" });
    expect(result.datasets[0]).toEqual({
      datasetName: "users",
      records: [{ user_id: 1 }, { user_id: 2 }],
      pagination: { pageCount: 2, reachedMaxPages: false, hasMore: false },
    });
    expect(result.warnings).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][0].toString()).toContain("pagesize=100");
    expect(fetchMock.mock.calls[0][0].toString()).toContain("fromdate=1767225600");
    expect(fetchMock.mock.calls[0][0].toString()).toContain("todate=1769817600");
  });

  it("rejects atomically when a later page fails", async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const page = new URL(input.toString()).searchParams.get("page");
      if (page === "2") {
        return Promise.resolve(new Response("server error", { status: 500 }));
      }
      return Promise.resolve(new Response(JSON.stringify({
        items: [{ user_id: 1 }],
        has_more: true,
      }), { status: 200 }));
    });

    await expect(runLiveReport("inactive-users", basicCredentials, {
      fetchFn: fetchMock,
    })).rejects.toThrow(
      "Failed to collect users. No complete result was produced. Stack API v2.3 request failed with 500",
    );
  });

  it("runs Tag Report by collecting tag SME records from tags", async () => {
    const fetchMock = vi.fn().mockImplementation((input: RequestInfo | URL) =>
      Promise.resolve(
        new Response(JSON.stringify({
          items: itemsForTagReportUrl(input.toString()),
          has_more: false,
          totalPages: input.toString().includes("/v3/") ? 1 : undefined,
        }), {
          status: 200,
        }),
      ),
    );

    const result = await runLiveReport("tag-report", basicCredentials, {
      fetchFn: fetchMock,
      scope: { startDate: "2025-01-01", endDate: "2025-01-31" },
    });

    expect(result.datasets.map((dataset) => dataset.datasetName)).toEqual([
      "tags",
      "users",
      "questions",
      "articles",
      "tagSmes",
      "tagSmeCounts",
      "tagLastUsed",
    ]);
    expect(result.datasets.find((dataset) => dataset.datasetName === "tagSmes")?.records).toEqual([
      { tagName: "python", user_id: 1, score: 12 },
    ]);
    expect(result.datasets.find((dataset) => dataset.datasetName === "tagSmeCounts")?.records).toEqual([
      { id: 42, name: "python", creationDate: "2014-05-13T00:00:00Z" },
    ]);
    expect(result.datasets.find((dataset) => dataset.datasetName === "tagLastUsed")?.records).toEqual([
      { tagName: "python", lastUsed: "2025-01-01" },
    ]);

    const questionUrls = fetchMock.mock.calls
      .map((call) => call[0].toString())
      .filter((url) => url.includes("/questions?"));
    const articleUrls = fetchMock.mock.calls
      .map((call) => call[0].toString())
      .filter((url) => url.includes("/articles?"));
    expect(questionUrls).toHaveLength(2);
    expect(articleUrls).toHaveLength(2);
    expect(questionUrls.some((url) => url.includes("fromdate=1735689600"))).toBe(true);
    expect(articleUrls.some((url) => url.includes("todate=1738281600"))).toBe(true);
    expect(questionUrls.filter((url) => !url.includes("fromdate=") && !url.includes("todate="))).toHaveLength(1);
    expect(articleUrls.filter((url) => !url.includes("fromdate=") && !url.includes("todate="))).toHaveLength(1);
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
    expect(result.datasets.find((dataset) => dataset.datasetName === "interactions")?.pagination).toEqual({
      pageCount: 0,
      reachedMaxPages: false,
      hasMore: false,
    });
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
  if (url.includes("/v3/") && url.includes("/tags?")) {
    return [{ id: 42, name: "python", creationDate: "2014-05-13T00:00:00Z" }];
  }

  if (url.includes("/2.3/tags?")) {
    return [{ name: "python" }];
  }

  if (url.includes("/top-answerers/")) {
    return [{ user_id: 1, score: 12 }];
  }

  if (url.includes("/questions?")) {
    return [{ id: 1, tags: ["python"], creation_date: 1_735_689_600 }];
  }

  if (url.includes("/articles?")) {
    return [{ id: 2, tags: ["python"], creationDate: "2025-01-01T00:00:00Z" }];
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
