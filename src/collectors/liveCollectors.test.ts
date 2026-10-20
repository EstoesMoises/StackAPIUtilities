import { describe, expect, it, vi } from "vitest";
import type { SessionCredentials } from "../domain/types";
import { createLiveCollectorClients } from "./liveCollectorClients";
import { collectDataset, getLiveDatasetClient, INTERNAL_API_PAGE_SIZE, type LiveCollectorClients } from "./liveCollectors";
import { buildTagHealthRowsFromLiveRecords } from "../reports/tagReport";

const basicCredentials: SessionCredentials = {
  instanceType: "basic-business",
  baseUrl: "https://stackoverflowteams.com/c/example-team",
  pat: "pat",
};

describe("live collectors", () => {
  it("includes answers after the selected period when measuring first answer time", async () => {
    const fetchFn = async (input: RequestInfo | URL) => {
      const url = new URL(input.toString());
      const isAnswers = url.pathname.endsWith("/questions/10/answers");
      if (isAnswers && (url.searchParams.has("fromdate") || url.searchParams.has("todate"))) {
        throw new Error("Answer lookup must include all dates");
      }
      if (isAnswers) {
        expect(url.pathname).toBe("/v3/teams/example-team/questions/10/answers");
        return jsonResponse({ items: [{ id: 20, creationDate: "2025-02-01T02:00:00Z", owner: { id: 2 }, commentCount: 0 }], totalPages: 1 });
      }
      return jsonResponse({
        items: [{ question_id: 10, answer_count: 1, comment_count: 0, creation_date: 1_738_281_600, tags: ["python"], owner: { user_id: 1 } }],
        has_more: false,
      });
    };
    const collected = await collectDataset("questions", createLiveCollectorClients(basicCredentials, { fetchFn }), {
      reportId: "tag-report", scope: { startDate: "2025-01-01", endDate: "2025-01-31" },
    });
    const rows = buildTagHealthRowsFromLiveRecords(collected.records.map((record) => ({
      ...record as Record<string, unknown>, datasetName: "questions",
    })));
    expect(rows[0].median_first_answer_hours).toBe(26);
  });

  it("attaches all v3 answer pages and raw-array comments while omitting content bodies", async () => {
    const urls: URL[] = [];
    const clients = clientsWithResponses((url) => {
      urls.push(url);
      if (url.pathname === "/2.3/questions") {
        return { items: [{ question_id: 10, answer_count: 3, tags: ["python"] }], has_more: false };
      }
      if (url.pathname.endsWith("/questions/10/answers")) {
        return {
          items: url.searchParams.get("page") === "1"
            ? [{ id: 20, owner: { id: 2, name: "Ada" }, score: 5, isAccepted: true, commentCount: 1, body: "large answer", creationDate: "2025-02-01T02:00:00Z" }]
            : [{ id: 21, owner: { id: 3 }, commentCount: 0 }, { id: 22, isDeleted: true, commentCount: 1 }],
          totalPages: 2,
        };
      }
      if (url.pathname.endsWith("/questions/10/answers/20/comments")) {
        return [{ id: 30, ownerUserId: 4, creationDate: "2025-02-02T00:00:00Z", body: "large comment" }];
      }
      if (url.pathname.endsWith("/questions/10/comments")) {
        return [{ id: 31, ownerUserId: 5, creationDate: "2025-02-01T01:00:00Z", body: "large comment" }];
      }
      throw new Error(`Unexpected request: ${url}`);
    });

    const result = await collectDataset("questions", clients, {
      reportId: "tag-report", scope: { startDate: "2025-01-01", endDate: "2025-01-31" },
    });

    expect(result).toEqual({
      records: [{ question_id: 10, answer_count: 3, tags: ["python"],
        answers: [
          { id: 20, owner: { id: 2 }, score: 5, isAccepted: true, commentCount: 1, creationDate: "2025-02-01T02:00:00Z", comments: [{ id: 30, ownerUserId: 4, creationDate: "2025-02-02T00:00:00Z" }] },
          { id: 21, owner: { id: 3 }, commentCount: 0, comments: [] },
          { id: 22, isDeleted: true, commentCount: 1, comments: [] },
        ],
        comments: [{ id: 31, ownerUserId: 5, creationDate: "2025-02-01T01:00:00Z" }],
      }],
      pagination: { pageCount: 5, reachedMaxPages: false, hasMore: false },
    });
    const nestedUrls = urls.filter((url) => url.pathname.includes("/v3/"));
    expect(nestedUrls).toHaveLength(4);
    expect(nestedUrls.every((url) => !url.searchParams.has("fromdate") && !url.searchParams.has("todate"))).toBe(true);
    expect(nestedUrls.filter((url) => url.pathname.endsWith("/answers")).map((url) => Object.fromEntries(url.searchParams))).toEqual([
      { pageSize: "100", sort: "creation", order: "asc", page: "1" },
      { pageSize: "100", sort: "creation", order: "asc", page: "2" },
    ]);
    expect(nestedUrls.filter((url) => url.pathname.endsWith("/comments")).every((url) => url.search === "")).toBe(true);
  });

  it("fetches article comments when v2 omits the count and skips explicit zero counts", async () => {
    const clients = clientsWithResponses((url) => {
      if (url.pathname === "/2.3/articles") {
        return { items: [{ article_id: 50 }, { id: 51, commentCount: 0 }, { title: "Missing ID" }], has_more: false };
      }
      if (url.pathname.endsWith("/articles/50/comments")) return [{ id: 60, ownerUserId: 6, body: "text" }];
      throw new Error(`Unexpected request: ${url}`);
    });

    await expect(collectDataset("articles", clients, { reportId: "tag-report" })).resolves.toEqual({
      records: [{ article_id: 50, comments: [{ id: 60, ownerUserId: 6 }] }, { id: 51, commentCount: 0, comments: [] }, { title: "Missing ID" }],
      pagination: { pageCount: 2, reachedMaxPages: false, hasMore: false },
    });
  });

  it("retains records without IDs and avoids calls for explicit empty child collections", async () => {
    const clients = clientsWithResponses((url) => {
      if (url.pathname === "/2.3/questions") {
        return { items: [{ id: 10, answerCount: 0, comment_count: 0 }, { answer_count: 1 }], has_more: false };
      }
      throw new Error(`Unexpected request: ${url}`);
    });

    await expect(collectDataset("questions", clients, { reportId: "tag-report" })).resolves.toMatchObject({
      records: [{ id: 10, answerCount: 0, comment_count: 0, answers: [], comments: [] }, { answer_count: 1 }],
      pagination: { pageCount: 1 },
    });
  });

  it("collects answers when the question answer count is unavailable", async () => {
    const clients = clientsWithResponses((url) => {
      if (url.pathname === "/2.3/questions") return { items: [{ id: 10, comment_count: 0 }], has_more: false };
      if (url.pathname.endsWith("/questions/10/answers")) return { items: [{ id: 20, commentCount: 0 }], totalPages: 1 };
      throw new Error(`Unexpected request: ${url}`);
    });

    await expect(collectDataset("questions", clients, { reportId: "tag-report" })).resolves.toMatchObject({
      records: [{ id: 10, answers: [{ id: 20, commentCount: 0, comments: [] }], comments: [] }],
      pagination: { pageCount: 2 },
    });
  });

  it("collects comments when an answer comment count is unavailable", async () => {
    const clients = clientsWithResponses((url) => {
      if (url.pathname === "/2.3/questions") return { items: [{ id: 10, answer_count: 1, comment_count: 0 }], has_more: false };
      if (url.pathname.endsWith("/questions/10/answers")) return { items: [{ id: 20 }], totalPages: 1 };
      if (url.pathname.endsWith("/questions/10/answers/20/comments")) return [{ id: 30, ownerUserId: 4 }];
      throw new Error(`Unexpected request: ${url}`);
    });

    await expect(collectDataset("questions", clients, { reportId: "tag-report" })).resolves.toMatchObject({
      records: [{ id: 10, answers: [{ id: 20, comments: [{ id: 30, ownerUserId: 4 }] }] }],
      pagination: { pageCount: 3 },
    });
  });

  it("preserves owner account IDs in compact answers and comments", async () => {
    const clients = clientsWithResponses((url) => {
      if (url.pathname === "/2.3/questions") return { items: [{ id: 10, answer_count: 1, comment_count: 0 }], has_more: false };
      if (url.pathname.endsWith("/questions/10/answers")) return { items: [{ id: 20, owner: { accountId: 200, name: "Ada" }, commentCount: 1 }], totalPages: 1 };
      if (url.pathname.endsWith("/questions/10/answers/20/comments")) return [{ id: 30, owner: { account_id: 300, display_name: "Alan" } }];
      throw new Error(`Unexpected request: ${url}`);
    });

    const result = await collectDataset("questions", clients, { reportId: "tag-report" });
    expect(result.records).toEqual([{
      id: 10, answer_count: 1, comment_count: 0, comments: [],
      answers: [{ id: 20, owner: { accountId: 200 }, commentCount: 1, comments: [{ id: 30, owner: { account_id: 300 } }] }],
    }]);
  });

  it("keeps answer comments unavailable when the answer has no lookup ID", async () => {
    const clients = clientsWithResponses((url) => {
      if (url.pathname === "/2.3/questions") return { items: [{ id: 10, answer_count: 1, comment_count: 0 }], has_more: false };
      if (url.pathname.endsWith("/questions/10/answers")) return { items: [{ owner: { id: 2 }, commentCount: 3 }], totalPages: 1 };
      throw new Error(`Unexpected request: ${url}`);
    });

    const result = await collectDataset("questions", clients, { reportId: "tag-report" });
    expect(result.records).toEqual([{
      id: 10, answer_count: 1, comment_count: 0, comments: [],
      answers: [{ owner: { id: 2 }, commentCount: 3 }],
    }]);
  });

  it("merges SME membership detail without discarding tag list metadata", async () => {
    const clients = clientsWithResponses((url) => {
      if (url.pathname.endsWith("/tags")) {
        return { items: [{ id: 42, name: "python", subjectMatterExpertCount: 2, creationDate: "2020-01-01" }, { id: 43, name: "empty", subjectMatterExpertCount: 0 }], totalPages: 1 };
      }
      if (url.pathname.endsWith("/tags/42")) {
        return { id: 42, description: "Python", subjectMatterExperts: { users: [{ id: 2 }], userGroups: [{ id: 7, users: [{ id: 3 }] }] } };
      }
      throw new Error(`Unexpected request: ${url}`);
    });

    await expect(collectDataset("tagSmeCounts", clients, { reportId: "tag-report" })).resolves.toEqual({
      records: [
        { id: 42, name: "python", subjectMatterExpertCount: 2, creationDate: "2020-01-01", description: "Python", subjectMatterExperts: { users: [{ id: 2 }], userGroups: [{ id: 7, users: [{ id: 3 }] }] } },
        { id: 43, name: "empty", subjectMatterExpertCount: 0 },
      ],
      pagination: { pageCount: 2, reachedMaxPages: false, hasMore: false },
    });
  });

  it("uses the script SME endpoint when tag detail does not include memberships", async () => {
    const clients = clientsWithResponses((url) => {
      if (url.pathname.endsWith("/tags")) return { items: [{ id: 42, name: "python", subjectMatterExpertCount: 1 }], totalPages: 1 };
      if (url.pathname.endsWith("/tags/42")) return { id: 42, description: "Python" };
      if (url.pathname.endsWith("/tags/42/subject-matter-experts")) return { users: [{ id: 2 }], userGroups: [] };
      throw new Error(`Unexpected request: ${url}`);
    });

    await expect(collectDataset("tagSmeCounts", clients, { reportId: "tag-report" })).resolves.toEqual({
      records: [{ id: 42, name: "python", subjectMatterExpertCount: 1, description: "Python", subjectMatterExperts: { users: [{ id: 2 }], userGroups: [] } }],
      pagination: { pageCount: 3, reachedMaxPages: false, hasMore: false },
    });
  });

  it("counts Enterprise communities across all pages using normalized tag names", async () => {
    const clients = clientsWithResponses((url) => {
      if (url.pathname.endsWith("/tags")) return { items: [{ id: 42, name: "Python" }, { id: 43, name: "unused" }], totalPages: 1 };
      if (url.pathname.endsWith("/communities")) {
        expect(Object.fromEntries(url.searchParams)).toEqual({ pageSize: "100", page: url.searchParams.get("page") });
        return { items: [{ id: url.searchParams.get("page"), tags: [{ id: 42, name: " python " }, { id: 42, name: "PYTHON" }] }], totalPages: 2 };
      }
      throw new Error(`Unexpected request: ${url}`);
    });

    await expect(collectDataset("tagSmeCounts", clients, {
      reportId: "tag-report", instanceType: "enterprise", scope: { startDate: "2025-01-01", endDate: "2025-01-31" },
    })).resolves.toEqual({
      records: [{ id: 42, name: "Python", communities: 2 }, { id: 43, name: "unused", communities: 0 }],
      pagination: { pageCount: 3, reachedMaxPages: false, hasMore: false },
    });
  });

  it.each([403, 404])("leaves Enterprise community counts unavailable on HTTP %i", async (status) => {
    const clients = clientsWithResponses((url) => url.pathname.endsWith("/tags")
      ? { items: [{ id: 42, name: "python" }], totalPages: 1 }
      : new Response("unavailable", { status }));
    await expect(collectDataset("tagSmeCounts", clients, { reportId: "tag-report", instanceType: "enterprise" })).resolves.toMatchObject({
      records: [{ id: 42, name: "python" }],
    });
  });

  it("fails on an unexpected community API error", async () => {
    const clients = clientsWithResponses((url) => url.pathname.endsWith("/tags")
      ? { items: [{ id: 42, name: "python" }], totalPages: 1 }
      : new Response("server error", { status: 500 }));
    await expect(collectDataset("tagSmeCounts", clients, { reportId: "tag-report", instanceType: "enterprise" })).rejects.toThrow("Stack API v3 request failed with 500");
  });

  it.each([
    { id: 7 },
    { id: 7, tags: null },
    { id: 7, tags: [{ id: 42 }] },
  ])("rejects unavailable community tag data instead of publishing zero counts: %j", async (community) => {
    const clients = clientsWithResponses((url) => url.pathname.endsWith("/tags")
      ? { items: [{ id: 42, name: "python" }], totalPages: 1 }
      : { items: [community], totalPages: 1 });
    await expect(collectDataset("tagSmeCounts", clients, { reportId: "tag-report", instanceType: "enterprise" })).rejects.toThrow(/invalid.*communities tags/);
  });

  it("does not request unavailable community endpoints for Basic/Business", async () => {
    const clients = clientsWithResponses((url) => {
      if (url.pathname.endsWith("/tags")) return { items: [{ id: 42, name: "python" }], totalPages: 1 };
      throw new Error(`Unexpected request: ${url}`);
    });
    await expect(collectDataset("tagSmeCounts", clients, { reportId: "tag-report", instanceType: "basic-business" })).resolves.toEqual({
      records: [{ id: 42, name: "python" }], pagination: { pageCount: 1, reachedMaxPages: false, hasMore: false },
    });
  });

  it.each([
    { users: [], userGroups: [{ id: 7 }] },
    { users: "invalid", userGroups: [] },
  ])("rejects malformed SME membership rather than returning partial counts: %j", async (membership) => {
    const clients = clientsWithResponses((url) => url.pathname.endsWith("/tags")
      ? { items: [{ id: 42, name: "python", subjectMatterExpertCount: 1 }], totalPages: 1 }
      : { id: 42, subjectMatterExperts: membership });
    await expect(collectDataset("tagSmeCounts", clients, { reportId: "tag-report" })).rejects.toThrow(/invalid.*subject matter expert/);
  });

  it.each(["questions", "articles", "tagSmeCounts"] as const)("does not enrich %s for other reports", async (dataset) => {
    const clients = clientsWithResponses((url) => {
      if (url.pathname === "/2.3/questions" || url.pathname === "/2.3/articles") {
        return { items: [{ id: 10, answer_count: 1 }], has_more: false };
      }
      if (url.pathname.endsWith("/tags")) return { items: [{ id: 42, subjectMatterExpertCount: 1 }], totalPages: 1 };
      throw new Error(`Unexpected request: ${url}`);
    });
    const result = await collectDataset(dataset, clients, { reportId: "data-export" });
    expect(result.records).toEqual(dataset === "tagSmeCounts" ? [{ id: 42, subjectMatterExpertCount: 1 }] : [{ id: 10, answer_count: 1 }]);
    expect(result.pagination.pageCount).toBe(1);
  });

  it("fails atomically if a later answer page fails", async () => {
    const clients = clientsWithResponses((url) => {
      if (url.pathname === "/2.3/questions") return { items: [{ id: 10, answer_count: 2, comment_count: 0 }], has_more: false };
      if (url.searchParams.get("page") === "2") return new Response("server error", { status: 500 });
      return { items: [{ id: 20, commentCount: 0 }], totalPages: 2 };
    });
    await expect(collectDataset("questions", clients, { reportId: "tag-report" })).rejects.toThrow("Stack API v3 request failed with 500");
  });

  it.each([{ value: { items: [] } }, { value: [null] }, { value: ["comment"] }])("rejects malformed raw comment results: %j", async ({ value: comments }) => {
    const clients = clientsWithResponses((url) => url.pathname === "/2.3/questions"
      ? { items: [{ id: 10, answer_count: 0 }], has_more: false }
      : comments);
    await expect(collectDataset("questions", clients, { reportId: "tag-report" })).rejects.toThrow(/invalid.*comments/i);
  });

  it("rejects malformed nested answers", async () => {
    const clients = clientsWithResponses((url) => url.pathname === "/2.3/questions"
      ? { items: [{ id: 10, answer_count: 1, comment_count: 0 }], has_more: false }
      : { items: [null], totalPages: 1 });
    await expect(collectDataset("questions", clients, { reportId: "tag-report" })).rejects.toThrow(/invalid.*answers/i);
  });

  it("rejects missing v3 JSON support when comments are required", async () => {
    const client = {
      getPagedResult: async () => ({ items: [{ id: 10, answer_count: 0 }], pageCount: 1, reachedMaxPages: false, hasMore: false }),
      getPagedItems: async () => [],
    };
    await expect(collectDataset("questions", { v2: client, v3: client }, { reportId: "tag-report" })).rejects.toThrow(/Tag Report.*getJson/);
  });

  it("rejects incomplete child pagination without mutating selected records", async () => {
    const question = { id: 10, answer_count: 1, comment_count: 0 };
    const clients: LiveCollectorClients = {
      v2: { getPagedItems: async () => [], getPagedResult: async () => ({ items: [question], pageCount: 1, reachedMaxPages: false, hasMore: false }) },
      v3: { getPagedItems: async () => [], getPagedResult: async () => ({ items: [{ id: 20 }], pageCount: 1, reachedMaxPages: true, hasMore: true }) },
    };
    await expect(collectDataset("questions", clients, { reportId: "tag-report" })).rejects.toThrow(/Incomplete.*answers/);
    expect(question).toEqual({ id: 10, answer_count: 1, comment_count: 0 });
  });
  it("collects assigned-SME counts from the Basic/Business v3 tags endpoint with the internal page size", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({
        items: [{ name: "piper", subjectMatterExpertCount: 1 }],
        totalPages: 1,
      }), { status: 200 }),
    );
    const clients = createLiveCollectorClients(basicCredentials, { fetchFn: fetchMock });

    await expect(collectDataset("tagSmeCounts", clients)).resolves.toEqual({
      records: [{ name: "piper", subjectMatterExpertCount: 1 }],
      pagination: { pageCount: 1, reachedMaxPages: false, hasMore: false },
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(INTERNAL_API_PAGE_SIZE).toBe(100);
    expect(fetchMock.mock.calls[0][0].toString()).toBe(
      "https://api.stackoverflowteams.com/v3/teams/example-team/tags?pageSize=100&page=1",
    );
  });

  it("maps tags to v2 and assigned-SME counts to v3", async () => {
    expect(getLiveDatasetClient("tags")).toBe("v2");
    expect(getLiveDatasetClient("tagSmeCounts")).toBe("v3");
    expect(getLiveDatasetClient("tagLastUsed")).toBe("v2");
  });
});

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), { status: 200 });
}

function clientsWithResponses(response: (url: URL) => unknown): LiveCollectorClients {
  return createLiveCollectorClients(basicCredentials, {
    fetchFn: async (input) => {
      const value = response(new URL(input.toString()));
      return value instanceof Response ? value : jsonResponse(value);
    },
  });
}
