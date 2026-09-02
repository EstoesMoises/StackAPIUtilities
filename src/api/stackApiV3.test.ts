import { afterEach, describe, expect, it, vi } from "vitest";
import { StackApiV3Client } from "./stackApiV3";

const API_V3_USER_AGENT =
  "StackAPIUtilities/0.1 (+https://github.com/EstoesMoises/StackAPIUtilities)";

afterEach(() => {
  vi.unstubAllGlobals();
});

function responseWithJson(body: unknown): Response {
  const response = new Response("", { status: 200 });
  vi.spyOn(response, "json").mockResolvedValue(body);
  return response;
}

function createClient(options: Partial<ConstructorParameters<typeof StackApiV3Client>[0]> = {}) {
  return new StackApiV3Client({
    apiV3Url: "https://demo.stackenterprise.co/api/v3",
    token: "token",
    ...options,
  });
}

describe("StackApiV3Client", () => {
  it("fetches one requested page without walking earlier pages", async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ items: [{ id: 9 }], totalPages: 5 })),
    );
    const client = createClient({ fetchFn });

    await expect(client.getPage<{ id: number }>("/questions", { pageSize: "100" }, 3)).resolves.toEqual({
      items: [{ id: 9 }],
      page: 3,
      totalPages: 5,
      hasMore: true,
    });
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(String(fetchFn.mock.calls[0][0])).toContain("page=3");
  });

  it("rejects an explicitly requested page beyond the pagination safety limit", async () => {
    const client = createClient({
      fetchFn: vi.fn(),
      paginationSafetyLimit: 2,
    });

    await expect(client.getPage("/questions", {}, 3)).rejects.toThrow(
      "exceeded the internal safety limit of 2 pages. No complete result was produced.",
    );
  });

  it.each([
    ["zero", 0],
    ["a negative number", -1],
    ["a fraction", 1.5],
    ["an unsafe integer", Number.MAX_SAFE_INTEGER + 1],
  ])("rejects %s as an explicit page number", async (_label, page) => {
    const fetchFn = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ items: [], totalPages: 1 })),
    );
    const client = createClient({ fetchFn });

    await expect(client.getPage("/questions", {}, page)).rejects.toThrow(
      "Stack API v3 page must be a positive safe integer.",
    );
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("retrieves one JSON detail object", async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: 42, title: "MyPBM" })),
    );
    const client = createClient({ fetchFn });

    await expect(client.getJson<{ id: number; title: string }>("/questions/42")).resolves.toEqual({
      id: 42,
      title: "MyPBM",
    });
    expect(String(fetchFn.mock.calls[0][0])).toBe("https://demo.stackenterprise.co/api/v3/questions/42");
  });

  it("sends one JSON PUT request body", async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: 42 })));
    const client = createClient({ fetchFn });

    await expect(client.putJson<{ id: number }>("/questions/42", {
      title: "MyPBM",
      body: "Body",
      tags: [],
    })).resolves.toEqual({ id: 42 });
    expect(fetchFn.mock.calls[0][1]).toEqual(expect.objectContaining({
      method: "PUT",
      headers: expect.objectContaining({
        Authorization: "Bearer token",
        "Content-Type": "application/json",
        "User-Agent": API_V3_USER_AGENT,
      }),
      body: JSON.stringify({ title: "MyPBM", body: "Body", tags: [] }),
    }));
  });

  it("notifies backoff before waiting to retry a throttled PUT", async () => {
    const events: string[] = [];
    const onThrottle = vi.fn(async (notice) => {
      events.push(`${notice.kind}:${notice.seconds}`);
    });
    const waitFn = vi.fn(async (seconds) => {
      events.push(`wait:${seconds}`);
    });
    const fetchFn = vi.fn()
      .mockResolvedValueOnce(new Response("{}", { status: 429, headers: { "Retry-After": "2" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 42 }), { status: 200 }));
    const client = createClient({ fetchFn, waitFn, onThrottle });

    await client.putJson("/questions/42", { title: "MyPBM", body: "Body", tags: [] });

    expect(events).toEqual(["backoff:2", "wait:2"]);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it.each([429, 502, 503, 504])(
    "emits one backoff notice without replaying a no-retry PUT after status %i",
    async (status) => {
      const onThrottle = vi.fn(async () => undefined);
      const waitFn = vi.fn(async () => undefined);
      const fetchFn = vi.fn().mockResolvedValue(
        new Response("upstream secret body", {
          status,
          headers: { "Retry-After": "30" },
        }),
      );
      const client = createClient({
        fetchFn,
        waitFn,
        onThrottle,
        retryPutRequests: false,
        maxBackoffNoticeSeconds: 86_400,
      });

      await expect(client.putJson("/questions/42", { title: "safe" })).rejects.toThrow(
        `Stack API v3 request failed with ${status}`,
      );
      expect(fetchFn).toHaveBeenCalledTimes(1);
      expect(waitFn).not.toHaveBeenCalled();
      expect(onThrottle).toHaveBeenCalledTimes(1);
      expect(onThrottle).toHaveBeenCalledWith({ kind: "backoff", seconds: 30 });
    },
  );

  it.each([400, 401, 403, 404, 409, 500])(
    "does not emit a backoff notice for no-retry PUT status %i",
    async (status) => {
      const onThrottle = vi.fn(async () => undefined);
      const fetchFn = vi.fn().mockResolvedValue(new Response("failed", { status }));
      const client = createClient({ fetchFn, onThrottle, retryPutRequests: false });

      await expect(client.putJson("/questions/42", { title: "safe" })).rejects.toThrow(
        `Stack API v3 request failed with ${status}`,
      );
      expect(fetchFn).toHaveBeenCalledTimes(1);
      expect(onThrottle).not.toHaveBeenCalled();
    },
  );

  it("surfaces an exact browser-cap delay without sleeping or retrying when it exceeds the server wait budget", async () => {
    const onThrottle = vi.fn(async () => undefined);
    const waitFn = vi.fn(async () => undefined);
    const fetchFn = vi.fn().mockResolvedValue(
      new Response("upstream secret body", {
        status: 429,
        headers: { "Retry-After": "86400" },
      }),
    );
    const client = createClient({
      fetchFn,
      waitFn,
      onThrottle,
      maxRetryWaitSeconds: 5,
      maxCumulativeRetryWaitSeconds: 10,
      maxBackoffNoticeSeconds: 86_400,
    });

    await expect(client.getJson("/questions/42")).rejects.toThrow(
      "Stack API v3 request failed with 429",
    );
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(waitFn).not.toHaveBeenCalled();
    expect(onThrottle).toHaveBeenCalledTimes(1);
    expect(onThrottle).toHaveBeenCalledWith({ kind: "backoff", seconds: 86_400 });
  });

  it("stops repeated short waits before crossing the cumulative server budget", async () => {
    const onThrottle = vi.fn(async () => undefined);
    const waitFn = vi.fn(async () => undefined);
    const fetchFn = vi.fn().mockResolvedValue(
      new Response("limited", { status: 429, headers: { "Retry-After": "2" } }),
    );
    const client = createClient({
      fetchFn,
      waitFn,
      onThrottle,
      maxRetryWaitSeconds: 3,
      maxCumulativeRetryWaitSeconds: 5,
      maxBackoffNoticeSeconds: 86_400,
    });

    await expect(client.getJson("/questions/42")).rejects.toThrow(
      "Stack API v3 request failed with 429",
    );
    expect(fetchFn).toHaveBeenCalledTimes(3);
    expect(waitFn.mock.calls).toEqual([[2], [2]]);
    expect(onThrottle).toHaveBeenCalledTimes(3);
  });

  it("allows waits exactly on the per-wait and cumulative budget boundaries", async () => {
    const waitFn = vi.fn(async () => undefined);
    const fetchFn = vi.fn()
      .mockResolvedValueOnce(new Response("limited", { status: 429, headers: { "Retry-After": "2" } }))
      .mockResolvedValueOnce(new Response("limited", { status: 429, headers: { "Retry-After": "3" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 42 }), { status: 200 }));
    const client = createClient({
      fetchFn,
      waitFn,
      maxRetryWaitSeconds: 3,
      maxCumulativeRetryWaitSeconds: 5,
      maxBackoffNoticeSeconds: 86_400,
    });

    await expect(client.getJson("/questions/42")).resolves.toEqual({ id: 42 });
    expect(fetchFn).toHaveBeenCalledTimes(3);
    expect(waitFn.mock.calls).toEqual([[2], [3]]);
  });

  it("preserves an ordinary short retry under configured server budgets", async () => {
    const waitFn = vi.fn(async () => undefined);
    const fetchFn = vi.fn()
      .mockResolvedValueOnce(new Response("limited", { status: 429, headers: { "Retry-After": "2" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 42 }), { status: 200 }));
    const client = createClient({
      fetchFn,
      waitFn,
      maxRetryWaitSeconds: 5,
      maxCumulativeRetryWaitSeconds: 10,
      maxBackoffNoticeSeconds: 86_400,
    });

    await expect(client.getJson("/questions/42")).resolves.toEqual({ id: 42 });
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(waitFn).toHaveBeenCalledWith(2);
  });

  it("rejects invalid configured retry budget numbers", () => {
    for (const option of [
      "maxRetryWaitSeconds",
      "maxCumulativeRetryWaitSeconds",
      "maxBackoffNoticeSeconds",
    ] as const) {
      for (const value of [-1, 1.5, Number.POSITIVE_INFINITY, Number.NaN, Number.MAX_SAFE_INTEGER + 1]) {
        expect(() => createClient({ [option]: value })).toThrow(
          "Stack API v3 retry budgets must be non-negative safe integers.",
        );
      }
    }
  });

  it("preserves the existing retry-attempt behavior when server budgets are not configured", async () => {
    const waitFn = vi.fn(async () => undefined);
    const fetchFn = vi.fn().mockResolvedValue(
      new Response("unavailable", {
        status: 503,
        headers: { "Retry-After": String(Number.MAX_SAFE_INTEGER) },
      }),
    );
    const client = createClient({ fetchFn, waitFn });

    await expect(client.getJson("/questions/42")).rejects.toThrow(
      "Stack API v3 request failed with 503",
    );
    expect(fetchFn).toHaveBeenCalledTimes(4);
    expect(waitFn).toHaveBeenCalledTimes(3);
  });

  it("retries a GET after a retryable 503 response", async () => {
    const waitFn = vi.fn(async () => undefined);
    const fetchFn = vi.fn()
      .mockResolvedValueOnce(new Response("unavailable", { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 42 })));
    const client = createClient({ fetchFn, waitFn });

    await expect(client.getJson<{ id: number }>("/questions/42")).resolves.toEqual({ id: 42 });
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(waitFn).toHaveBeenCalledWith(2);
  });

  it.each([502, 504])("retries a GET after a retryable %s response", async (status) => {
    const waitFn = vi.fn(async () => undefined);
    const fetchFn = vi.fn()
      .mockResolvedValueOnce(new Response("unavailable", { status }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 42 })));
    const client = createClient({ fetchFn, waitFn });

    await expect(client.getJson<{ id: number }>("/questions/42")).resolves.toEqual({ id: 42 });
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(waitFn).toHaveBeenCalledWith(2);
  });

  it("retries idempotent network errors at most three times", async () => {
    const waitFn = vi.fn(async () => undefined);
    const fetchFn = vi.fn(async () => { throw new TypeError("network unavailable"); });
    const client = createClient({ fetchFn, waitFn });

    await expect(client.getJson("/questions/42")).rejects.toThrow("network unavailable");
    expect(fetchFn).toHaveBeenCalledTimes(4);
    expect(waitFn).toHaveBeenCalledTimes(3);
  });

  it("stops retrying a PUT after three retryable responses", async () => {
    const waitFn = vi.fn(async () => undefined);
    const fetchFn = vi.fn(async () => new Response("unavailable", { status: 503 }));
    const client = createClient({ fetchFn, waitFn });

    await expect(client.putJson("/questions/42", { title: "MyPBM" })).rejects.toThrow(
      "Stack API v3 request failed with 503",
    );
    expect(fetchFn).toHaveBeenCalledTimes(4);
    expect(waitFn).toHaveBeenCalledTimes(3);
  });

  it.each([400, 401, 403, 404, 409])("does not retry non-retryable GET status %s", async (status) => {
    const waitFn = vi.fn(async () => undefined);
    const fetchFn = vi.fn().mockResolvedValue(new Response("request failed", { status }));
    const client = createClient({ fetchFn, waitFn });

    await expect(client.getJson("/questions/42")).rejects.toThrow(`Stack API v3 request failed with ${status}`);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(waitFn).not.toHaveBeenCalled();
  });

  it.each([
    ["POST", "a network error", async (client: StackApiV3Client) => client.createUserGroup({ name: "Ada", userIds: [1] }), () => {
      throw new TypeError("network unavailable");
    }],
    ["DELETE", "a network error", async (client: StackApiV3Client) => client.removeUserGroupMember(7, 3), () => {
      throw new TypeError("network unavailable");
    }],
    ["POST", "a 503 response", async (client: StackApiV3Client) => client.createUserGroup({ name: "Ada", userIds: [1] }), () => new Response("unavailable", { status: 503 })],
    ["DELETE", "a 503 response", async (client: StackApiV3Client) => client.removeUserGroupMember(7, 3), () => new Response("unavailable", { status: 503 })],
  ])("does not retry %s after %s", async (_method, _failure, request, responseOrError) => {
    const waitFn = vi.fn(async () => undefined);
    const fetchFn = vi.fn(async () => responseOrError());
    const client = createClient({ fetchFn, waitFn });

    await expect(request(client)).rejects.toThrow();
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(waitFn).not.toHaveBeenCalled();
  });

  it("fetches totalPages pagination", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ items: [{ id: "a" }], totalPages: 2 }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ items: [{ id: "b" }], totalPages: 2 }), { status: 200 }));

    const client = new StackApiV3Client({
      apiV3Url: "https://api.stackoverflowteams.com/v3/teams/example-team",
      token: "token",
      fetchFn: fetchMock,
    });

    await expect(client.getPagedItems("/tags")).resolves.toEqual([{ id: "a" }, { id: "b" }]);
    expect(fetchMock.mock.calls[1][0].toString()).toContain("page=2");
  });

  it("stops pagination at the requested max pages", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ items: [{ id: "a" }], totalPages: 2 }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ items: [{ id: "b" }], totalPages: 2 }), { status: 200 }));

    const client = new StackApiV3Client({
      apiV3Url: "https://api.stackoverflowteams.com/v3/teams/example-team",
      token: "token",
      fetchFn: fetchMock,
    });

    await expect(client.getPagedItems("/tags", {}, { maxPages: 1 })).resolves.toEqual([{ id: "a" }]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("fails closed when pagination exceeds the internal safety limit", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ items: [{ id: "tag" }], totalPages: 99 }), { status: 200 }));
    const client = new StackApiV3Client({
      apiV3Url: "https://api.stackoverflowteams.com/v3/teams/example-team",
      token: "token",
      fetchFn: fetchMock,
      paginationSafetyLimit: 2,
    });

    await expect(client.getPagedItems("/tags")).rejects.toThrow(
      "exceeded the internal safety limit of 2 pages. No complete result was produced.",
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("returns pagination metadata when max pages leaves more v3 data available", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      new Response(JSON.stringify({ items: [{ id: "a" }], totalPages: 3 }), { status: 200 }),
    );

    const client = new StackApiV3Client({
      apiV3Url: "https://api.stackoverflowteams.com/v3/teams/example-team",
      token: "token",
      fetchFn: fetchMock,
    });

    await expect(client.getPagedResult("/tags", {}, { maxPages: 1 })).resolves.toEqual({
      items: [{ id: "a" }],
      pageCount: 1,
      reachedMaxPages: true,
      hasMore: true,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("treats missing totalPages as capped when max pages stops a non-empty v3 result", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      new Response(JSON.stringify({ items: [{ id: "a" }] }), { status: 200 }),
    );

    const client = new StackApiV3Client({
      apiV3Url: "https://api.stackoverflowteams.com/v3/teams/example-team",
      token: "token",
      fetchFn: fetchMock,
    });

    await expect(client.getPagedResult("/tags", {}, { maxPages: 1 })).resolves.toEqual({
      items: [{ id: "a" }],
      pageCount: 1,
      reachedMaxPages: true,
      hasMore: true,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["a null body", null],
    ["an array body", []],
    ["missing items", { totalPages: 0 }],
    ["non-array items", { items: {}, totalPages: 0 }],
    ["inherited items", Object.create({ items: [] })],
  ])("fails closed when page 1 has %s", async (_label, body) => {
    const client = new StackApiV3Client({
      apiV3Url: "https://api.stackoverflowteams.com/v3/teams/example-team",
      token: "token",
      fetchFn: vi.fn().mockResolvedValue(responseWithJson(body)),
    });

    await expect(client.getPagedItems("/tags")).rejects.toThrow(
      "Stack API v3 returned an invalid pagination envelope for /tags page 1. No complete result was produced.",
    );
  });

  it.each([
    ["a string", "2"],
    ["null", null],
    ["a negative number", -1],
    ["a fraction", 1.5],
    ["positive infinity", Number.POSITIVE_INFINITY],
  ])("rejects totalPages when it is %s", async (_label, totalPages) => {
    const client = new StackApiV3Client({
      apiV3Url: "https://api.stackoverflowteams.com/v3/teams/example-team",
      token: "token",
      fetchFn: vi.fn().mockResolvedValue(responseWithJson({ items: [], totalPages })),
    });

    await expect(client.getPagedItems("/tags")).rejects.toThrow(
      "Stack API v3 returned an invalid pagination envelope for /tags page 1. No complete result was produced.",
    );
  });

  it("rejects a totalPages value that changes between pages", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(responseWithJson({ items: [{ id: "a" }], totalPages: 2 }))
      .mockResolvedValueOnce(responseWithJson({ items: [{ id: "b" }], totalPages: 3 }));
    const client = new StackApiV3Client({
      apiV3Url: "https://api.stackoverflowteams.com/v3/teams/example-team",
      token: "token",
      fetchFn: fetchMock,
    });

    await expect(client.getPagedItems("/tags")).rejects.toThrow(
      "Stack API v3 returned an invalid pagination envelope for /tags page 2. No complete result was produced.",
    );
  });

  it.each([
    ["page 1 with totalPages 0", [
      { items: [{ id: "a" }], totalPages: 0 },
    ]],
    ["page 2 greater than a newly supplied totalPages", [
      { items: [{ id: "a" }] },
      { items: [{ id: "b" }], totalPages: 1 },
    ]],
  ] as const)("rejects non-empty items claimed beyond totalPages: %s", async (_label, pages) => {
    const fetchMock = vi.fn();
    for (const page of pages) fetchMock.mockResolvedValueOnce(responseWithJson(page));
    const client = new StackApiV3Client({
      apiV3Url: "https://api.stackoverflowteams.com/v3/teams/example-team",
      token: "token",
      fetchFn: fetchMock,
    });

    await expect(client.getPagedItems("/tags")).rejects.toThrow(
      `Stack API v3 returned an invalid pagination envelope for /tags page ${pages.length}. No complete result was produced.`,
    );
  });

  it("uses an explicit empty items array as the terminal fallback when totalPages is absent", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(responseWithJson({ items: [{ id: "a" }] }))
      .mockResolvedValueOnce(responseWithJson({ items: [] }));
    const client = new StackApiV3Client({
      apiV3Url: "https://api.stackoverflowteams.com/v3/teams/example-team",
      token: "token",
      fetchFn: fetchMock,
    });

    await expect(client.getPagedResult("/tags")).resolves.toEqual({
      items: [{ id: "a" }],
      pageCount: 2,
      reachedMaxPages: false,
      hasMore: false,
    });
  });

  it("calls the throttle callback when token bucket is low", async () => {
    const wait = vi.fn();
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ items: [], totalPages: 1 }), {
        status: 200,
        headers: {
          "x-token-bucket-calls-left": "25",
          "x-token-bucket-seconds-until-next-refill": "60",
        },
      }),
    );

    const client = new StackApiV3Client({
      apiV3Url: "https://demo.stackenterprise.co/api/v3",
      token: "token",
      fetchFn: fetchMock,
      onThrottle: wait,
    });

    await client.getPagedItems("/users");
    expect(wait).toHaveBeenCalledWith({ kind: "token-bucket", seconds: 60, remaining: 25 });
  });

  it("calls the throttle callback when burst capacity is low", async () => {
    const onThrottle = vi.fn();
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ items: [], totalPages: 1 }), {
        status: 200,
        headers: {
          "x-burst-throttle-calls-left": "4",
          "x-burst-throttle-seconds-until-full": "2",
        },
      }),
    );

    const client = new StackApiV3Client({
      apiV3Url: "https://demo.stackenterprise.co/api/v3",
      token: "token",
      fetchFn: fetchMock,
      onThrottle,
    });

    await client.getPagedItems("/users");

    expect(onThrottle).toHaveBeenCalledWith({ kind: "burst", seconds: 2, remaining: 4 });
  });

  it("retries a throttled GET after the longest server-directed delay", async () => {
    const waitFn = vi.fn(async () => undefined);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(
        new Response("rate limited", {
          status: 429,
          headers: {
            "Retry-After": "1",
            "x-burst-throttle-seconds-until-full": "4",
            "x-token-bucket-seconds-until-next-refill": "2",
          },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: 42, email: "ada@example.com" }), {
          status: 200,
        }),
      );
    const client = new StackApiV3Client({
      apiV3Url: "https://demo.stackenterprise.co/api/v3",
      token: "token",
      fetchFn: fetchMock,
      waitFn,
    });

    await expect(client.getUserByEmail("ada@example.com")).resolves.toEqual({
      id: 42,
      email: "ada@example.com",
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(waitFn).toHaveBeenCalledTimes(1);
    expect(waitFn).toHaveBeenCalledWith(4);
    expect(fetchMock.mock.calls[0][1]).toEqual(
      expect.objectContaining({
        headers: expect.objectContaining({
          "User-Agent": API_V3_USER_AGENT,
        }),
      }),
    );
  });

  it("supports HTTP-date Retry-After values", async () => {
    const now = Date.parse("2026-07-30T17:00:00.000Z");
    const waitFn = vi.fn(async () => undefined);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(
        new Response("rate limited", {
          status: 429,
          headers: {
            "Retry-After": new Date(now + 3_000).toUTCString(),
          },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: 42, email: "ada@example.com" }), {
          status: 200,
        }),
      );
    const client = new StackApiV3Client({
      apiV3Url: "https://demo.stackenterprise.co/api/v3",
      token: "token",
      fetchFn: fetchMock,
      waitFn,
      nowFn: () => now,
    });

    await client.getUserByEmail("ada@example.com");

    expect(waitFn).toHaveBeenCalledWith(3);
  });

  it("uses a two-second retry fallback when throttle headers are invalid", async () => {
    const waitFn = vi.fn(async () => undefined);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(
        new Response("rate limited", {
          status: 429,
          headers: {
            "Retry-After": "invalid",
            "x-burst-throttle-seconds-until-full": "-1",
            "x-token-bucket-seconds-until-next-refill": "invalid",
          },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: 42, email: "ada@example.com" }), {
          status: 200,
        }),
      );
    const client = new StackApiV3Client({
      apiV3Url: "https://demo.stackenterprise.co/api/v3",
      token: "token",
      fetchFn: fetchMock,
      waitFn,
    });

    await client.getUserByEmail("ada@example.com");

    expect(waitFn).toHaveBeenCalledWith(2);
  });

  it("stops retrying a GET after three retries", async () => {
    const waitFn = vi.fn(async () => undefined);
    const fetchMock = vi.fn(async () => new Response("rate limited", { status: 429 }));
    const client = new StackApiV3Client({
      apiV3Url: "https://demo.stackenterprise.co/api/v3",
      token: "token",
      fetchFn: fetchMock,
      waitFn,
    });

    await expect(client.getUserByEmail("ada@example.com")).rejects.toThrow(
      "Stack API v3 request failed with 429",
    );
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(waitFn).toHaveBeenCalledTimes(3);
    expect(waitFn).toHaveBeenNthCalledWith(1, 2);
    expect(waitFn).toHaveBeenNthCalledWith(2, 2);
    expect(waitFn).toHaveBeenNthCalledWith(3, 2);
  });

  it("calls the default browser fetch with the global receiver", async () => {
    const fetchMock = vi.fn(function (this: unknown) {
      if (this !== globalThis) {
        throw new TypeError("Illegal invocation");
      }

      return Promise.resolve(
        new Response(JSON.stringify({ items: [{ id: "community" }], totalPages: 1 }), {
          status: 200,
        }),
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = new StackApiV3Client({
      apiV3Url: "https://api.stackoverflowteams.com/v3/teams/example-team",
      token: "token",
    });

    await expect(client.getPagedItems("/communities")).resolves.toEqual([{ id: "community" }]);
  });

  it("retrieves a user by email", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: 42, email: "ada@example.com", name: "Ada Lovelace" }), { status: 200 }),
    );
    const client = new StackApiV3Client({
      apiV3Url: "https://demo.stackenterprise.co/api/v3",
      token: "token",
      fetchFn: fetchMock,
    });

    await expect(client.getUserByEmail("ada+vrm@example.com")).resolves.toEqual({
      id: 42,
      email: "ada@example.com",
      name: "Ada Lovelace",
    });
    expect(fetchMock.mock.calls[0][0].toString()).toBe(
      "https://demo.stackenterprise.co/api/v3/users/by-email/ada%2Bvrm%40example.com",
    );
    expect(fetchMock.mock.calls[0][1]).toEqual(
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer token",
          "Content-Type": "application/json",
          "User-Agent": API_V3_USER_AGENT,
        }),
      }),
    );
  });

  it("returns null when user lookup by email is not found", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("not found", { status: 404 }));
    const client = new StackApiV3Client({
      apiV3Url: "https://demo.stackenterprise.co/api/v3",
      token: "token",
      fetchFn: fetchMock,
    });

    await expect(client.getUserByEmail("missing@example.com")).resolves.toBeNull();
  });

  it("retrieves user groups with page size, pagination, and bearer auth", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ items: [{ id: 7, name: "Ada Lovelace VRM", users: [] }], totalPages: 2 }), {
          status: 200,
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ items: [{ id: 8, name: "Alan Turing VRM", users: [] }], totalPages: 2 }), {
          status: 200,
        }),
      );
    const client = new StackApiV3Client({
      apiV3Url: "https://demo.stackenterprise.co/api/v3",
      token: "token",
      fetchFn: fetchMock,
    });

    await expect(client.getUserGroups()).resolves.toEqual([
      { id: 7, name: "Ada Lovelace VRM", users: [] },
      { id: 8, name: "Alan Turing VRM", users: [] },
    ]);
    expect(fetchMock.mock.calls[0][0].toString()).toBe(
      "https://demo.stackenterprise.co/api/v3/user-groups?pageSize=100&page=1",
    );
    expect(fetchMock.mock.calls[1][0].toString()).toBe(
      "https://demo.stackenterprise.co/api/v3/user-groups?pageSize=100&page=2",
    );
    expect(fetchMock.mock.calls[0][1]).toEqual(
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer token",
          "Content-Type": "application/json",
          "User-Agent": API_V3_USER_AGENT,
        }),
      }),
    );
    expect(fetchMock.mock.calls[1][1]).toEqual(
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer token",
          "Content-Type": "application/json",
          "User-Agent": API_V3_USER_AGENT,
        }),
      }),
    );
  });

  it("creates user groups and adds members with write access bearer auth", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: 7, name: "Ada Lovelace VRM", users: [] }), { status: 201 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: 7, name: "Ada Lovelace VRM", users: [{ id: 1 }] }), { status: 200 }),
      );
    const client = new StackApiV3Client({
      apiV3Url: "https://demo.stackenterprise.co/api/v3",
      token: "token",
      fetchFn: fetchMock,
    });

    await expect(client.createUserGroup({ name: "Ada Lovelace VRM", userIds: [1, 2] })).resolves.toEqual(
      expect.objectContaining({ id: 7, name: "Ada Lovelace VRM" }),
    );
    await expect(client.addUserGroupMembers(7, [3])).resolves.toEqual(
      expect.objectContaining({ id: 7, name: "Ada Lovelace VRM" }),
    );
    expect(fetchMock.mock.calls[0][0].toString()).toBe("https://demo.stackenterprise.co/api/v3/user-groups");
    expect(fetchMock.mock.calls[0][1]).toEqual(
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer token",
          "Content-Type": "application/json",
          "User-Agent": API_V3_USER_AGENT,
        }),
        body: JSON.stringify({ name: "Ada Lovelace VRM", userIds: [1, 2] }),
      }),
    );
    expect(fetchMock.mock.calls[1][0].toString()).toBe(
      "https://demo.stackenterprise.co/api/v3/user-groups/7/members",
    );
    expect(fetchMock.mock.calls[1][1]).toEqual(
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer token",
          "Content-Type": "application/json",
          "User-Agent": API_V3_USER_AGENT,
        }),
        body: JSON.stringify([3]),
      }),
    );
  });

  it("removes a group member with DELETE", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    const client = new StackApiV3Client({
      apiV3Url: "https://demo.stackenterprise.co/api/v3",
      token: "token",
      fetchFn: fetchMock,
    });

    await expect(client.removeUserGroupMember(7, 3)).resolves.toBeUndefined();
    expect(fetchMock.mock.calls[0][0].toString()).toBe(
      "https://demo.stackenterprise.co/api/v3/user-groups/7/members/3",
    );
    expect(fetchMock.mock.calls[0][1]).toEqual(
      expect.objectContaining({
        method: "DELETE",
        headers: expect.objectContaining({
          Authorization: "Bearer token",
          "Content-Type": "application/json",
          "User-Agent": API_V3_USER_AGENT,
        }),
      }),
    );
  });

  it("does not retry throttled write requests", async () => {
    const waitFn = vi.fn(async () => undefined);
    const fetchMock = vi.fn(async () => new Response("rate limited", { status: 429 }));
    const client = new StackApiV3Client({
      apiV3Url: "https://demo.stackenterprise.co/api/v3",
      token: "token",
      fetchFn: fetchMock,
      waitFn,
    });

    await expect(client.createUserGroup({ name: "Ada Lovelace VRM", userIds: [1] })).rejects.toThrow(
      "Stack API v3 request failed with 429",
    );
    await expect(client.addUserGroupMembers(7, [2])).rejects.toThrow(
      "Stack API v3 request failed with 429",
    );
    await expect(client.removeUserGroupMember(7, 3)).rejects.toThrow(
      "Stack API v3 request failed with 429",
    );

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(waitFn).not.toHaveBeenCalled();
  });

  it("throws Stack API v3 errors when removing a group member fails", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ title: "Forbidden" }), {
        status: 403,
      }),
    );
    const client = new StackApiV3Client({
      apiV3Url: "https://demo.stackenterprise.co/api/v3",
      token: "token",
      fetchFn: fetchMock,
    });

    await expect(client.removeUserGroupMember(7, 3)).rejects.toThrow(/Stack API v3 request failed with 403/);
  });
});
