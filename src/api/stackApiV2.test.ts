import { afterEach, describe, expect, it, vi } from "vitest";
import { StackApiV2Client } from "./stackApiV2";

afterEach(() => {
  vi.unstubAllGlobals();
});

function responseWithJson(body: unknown): Response {
  const response = new Response("", { status: 200 });
  vi.spyOn(response, "json").mockResolvedValue(body);
  return response;
}

describe("StackApiV2Client", () => {
  it("fetches all pages and appends the team slug for Basic/Business", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ items: [{ id: 1 }], has_more: true }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ items: [{ id: 2 }], has_more: false }), { status: 200 }));

    const client = new StackApiV2Client({
      apiV2Url: "https://api.stackoverflowteams.com/2.3",
      teamSlug: "example-team",
      headers: { "X-API-Access-Token": "token" },
      fetchFn: fetchMock,
    });

    await expect(client.getPagedItems("/users", { pagesize: "100" })).resolves.toEqual([{ id: 1 }, { id: 2 }]);
    expect(fetchMock.mock.calls[0][0].toString()).toContain("team=example-team");
    expect(fetchMock.mock.calls[1][0].toString()).toContain("page=2");
  });

  it("waits for a backoff before requesting the next page without a throttle callback", async () => {
    let releaseWait: (() => void) | undefined;
    const waitFn = vi.fn(() => new Promise<void>((resolve) => {
      releaseWait = resolve;
    }));
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(responseWithJson({
        items: [{ id: 1 }],
        has_more: true,
        backoff: 3,
        quota_remaining: 99,
      }))
      .mockResolvedValueOnce(responseWithJson({ items: [{ id: 2 }], has_more: false }));
    const client = new StackApiV2Client({
      apiV2Url: "https://api.stackoverflowteams.com/2.3",
      teamSlug: "example-team",
      fetchFn: fetchMock,
      waitFn,
    });

    const result = client.getPagedItems("/users");
    await vi.waitFor(() => expect(waitFn).toHaveBeenCalledWith(3));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    releaseWait?.();
    await expect(result).resolves.toEqual([{ id: 1 }, { id: 2 }]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("notifies, waits once, and then requests the next page", async () => {
    const events: string[] = [];
    const fetchMock = vi.fn(async () => {
      const page = fetchMock.mock.calls.length;
      events.push(`fetch-${page}`);
      return page === 1
        ? responseWithJson({ items: [{ id: 1 }], has_more: true, backoff: 4, quota_remaining: 12 })
        : responseWithJson({ items: [{ id: 2 }], has_more: false });
    });
    const onThrottle = vi.fn(async () => {
      events.push("notify");
    });
    const waitFn = vi.fn(async () => {
      events.push("wait");
    });
    const client = new StackApiV2Client({
      apiV2Url: "https://api.stackoverflowteams.com/2.3",
      teamSlug: "example-team",
      fetchFn: fetchMock,
      onThrottle,
      waitFn,
    });

    await expect(client.getPagedItems("/users")).resolves.toEqual([{ id: 1 }, { id: 2 }]);

    expect(onThrottle).toHaveBeenCalledTimes(1);
    expect(onThrottle).toHaveBeenCalledWith({ kind: "backoff", seconds: 4, remaining: 12 });
    expect(waitFn).toHaveBeenCalledTimes(1);
    expect(waitFn).toHaveBeenCalledWith(4);
    expect(events).toEqual(["fetch-1", "notify", "wait", "fetch-2"]);
  });

  it("carries a terminal-page backoff to the next call and consumes it once", async () => {
    let releaseWait: (() => void) | undefined;
    const waitFn = vi.fn(() => new Promise<void>((resolve) => {
      releaseWait = resolve;
    }));
    const onThrottle = vi.fn(async () => undefined);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(responseWithJson({
        items: [{ id: 1 }],
        has_more: false,
        backoff: 5,
        quota_remaining: 8,
      }))
      .mockResolvedValueOnce(responseWithJson({ items: [{ id: 2 }], has_more: false }))
      .mockResolvedValueOnce(responseWithJson({ items: [{ id: 3 }], has_more: false }));
    const client = new StackApiV2Client({
      apiV2Url: "https://api.stackoverflowteams.com/2.3",
      teamSlug: "example-team",
      fetchFn: fetchMock,
      onThrottle,
      waitFn,
    });

    await expect(client.getPagedItems("/users")).resolves.toEqual([{ id: 1 }]);
    expect(onThrottle).toHaveBeenCalledTimes(1);
    expect(onThrottle).toHaveBeenCalledWith({ kind: "backoff", seconds: 5, remaining: 8 });
    expect(waitFn).not.toHaveBeenCalled();

    const secondResult = client.getPagedItems("/tags");
    await vi.waitFor(() => expect(waitFn).toHaveBeenCalledWith(5));
    expect(fetchMock).toHaveBeenCalledTimes(1);

    releaseWait?.();
    await expect(secondResult).resolves.toEqual([{ id: 2 }]);
    await expect(client.getPagedItems("/badges")).resolves.toEqual([{ id: 3 }]);

    expect(waitFn).toHaveBeenCalledTimes(1);
    expect(onThrottle).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("does not wait when a non-terminal page has no backoff", async () => {
    const waitFn = vi.fn(async () => undefined);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(responseWithJson({ items: [{ id: 1 }], has_more: true }))
      .mockResolvedValueOnce(responseWithJson({ items: [{ id: 2 }], has_more: false }));
    const client = new StackApiV2Client({
      apiV2Url: "https://api.stackoverflowteams.com/2.3",
      teamSlug: "example-team",
      fetchFn: fetchMock,
      waitFn,
    });

    await client.getPagedItems("/users");

    expect(waitFn).not.toHaveBeenCalled();
  });

  it("stops pagination at the requested max pages", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ items: [{ id: 1 }], has_more: true }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ items: [{ id: 2 }], has_more: true }), { status: 200 }));

    const client = new StackApiV2Client({
      apiV2Url: "https://api.stackoverflowteams.com/2.3",
      teamSlug: "example-team",
      fetchFn: fetchMock,
    });

    await expect(client.getPagedItems("/users", { pagesize: "50" }, { maxPages: 1 })).resolves.toEqual([{ id: 1 }]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("fails closed when pagination exceeds the internal safety limit", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ items: [{ id: 1 }], has_more: true }), { status: 200 }));
    const client = new StackApiV2Client({
      apiV2Url: "https://api.stackoverflowteams.com/2.3",
      teamSlug: "example-team",
      fetchFn: fetchMock,
      paginationSafetyLimit: 2,
    });

    await expect(client.getPagedItems("/tags")).rejects.toThrow(
      "exceeded the internal safety limit of 2 pages. No complete result was produced.",
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("returns pagination metadata when max pages leaves more v2 data available", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      new Response(JSON.stringify({ items: [{ id: 1 }], has_more: true }), { status: 200 }),
    );

    const client = new StackApiV2Client({
      apiV2Url: "https://api.stackoverflowteams.com/2.3",
      teamSlug: "example-team",
      fetchFn: fetchMock,
    });

    await expect(client.getPagedResult("/users", { pagesize: "50" }, { maxPages: 1 })).resolves.toEqual({
      items: [{ id: 1 }],
      pageCount: 1,
      reachedMaxPages: true,
      hasMore: true,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["a null body", null],
    ["an array body", []],
    ["missing items", { has_more: false }],
    ["non-array items", { items: {}, has_more: false }],
    ["missing has_more", { items: [] }],
    ["non-boolean has_more", { items: [], has_more: "false" }],
    ["inherited pagination fields", Object.create({ items: [], has_more: false })],
  ])("fails closed when page 1 has %s", async (_label, body) => {
    const client = new StackApiV2Client({
      apiV2Url: "https://api.stackoverflowteams.com/2.3",
      teamSlug: "example-team",
      fetchFn: vi.fn().mockResolvedValue(responseWithJson(body)),
    });

    await expect(client.getPagedItems("/users")).rejects.toThrow(
      "Stack API v2.3 returned an invalid pagination envelope for /users page 1. No complete result was produced.",
    );
  });

  it.each([
    ["a string backoff", { backoff: "2" }],
    ["a negative backoff", { backoff: -1 }],
    ["a fractional backoff", { backoff: 1.5 }],
    ["a non-finite backoff", { backoff: Number.NaN }],
    ["a negative quota", { quota_remaining: -1 }],
    ["a fractional quota", { quota_remaining: 1.5 }],
    ["a non-finite quota", { quota_remaining: Number.POSITIVE_INFINITY }],
  ])("fails closed when page 1 has %s", async (_label, optionalFields) => {
    const client = new StackApiV2Client({
      apiV2Url: "https://api.stackoverflowteams.com/2.3",
      teamSlug: "example-team",
      fetchFn: vi.fn().mockResolvedValue(responseWithJson({
        items: [],
        has_more: false,
        ...optionalFields,
      })),
    });

    await expect(client.getPagedItems("/users")).rejects.toThrow(
      "Stack API v2.3 returned an invalid pagination envelope for /users page 1. No complete result was produced.",
    );
  });

  it("validates every v2 page before returning any accumulated result", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(responseWithJson({ items: [{ id: 1 }], has_more: true }))
      .mockResolvedValueOnce(responseWithJson({ items: [{ id: 2 }] }));
    const client = new StackApiV2Client({
      apiV2Url: "https://api.stackoverflowteams.com/2.3",
      teamSlug: "example-team",
      fetchFn: fetchMock,
    });

    await expect(client.getPagedItems("/users")).rejects.toThrow(
      "Stack API v2.3 returned an invalid pagination envelope for /users page 2. No complete result was produced.",
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("throws a mapped error on non-200 responses", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("bad key", { status: 400 }));
    const client = new StackApiV2Client({
      apiV2Url: "https://demo.stackenterprise.co/api/2.3",
      teamSlug: null,
      headers: { "X-API-Key": "bad" },
      fetchFn: fetchMock,
    });

    await expect(client.getPagedItems("/tags")).rejects.toThrow("Stack API v2.3 request failed with 400");
  });

  it("includes structured Stack API error details on non-200 responses", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          error_id: 403,
          error_message: "`key` is not valid for passed `access_token`, application did not create token.",
          error_name: "access_denied",
        }),
        { status: 400 },
      ),
    );
    const client = new StackApiV2Client({
      apiV2Url: "https://demo.stackenterprise.co/api/2.3",
      teamSlug: null,
      headers: { "X-API-Key": "bad" },
      fetchFn: fetchMock,
    });

    await expect(client.getPagedItems("/tags")).rejects.toThrow(
      "Stack API v2.3 request failed with 400: access_denied - `key` is not valid for passed `access_token`, application did not create token.",
    );
  });

  it("throws a contextual error on invalid JSON responses", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("not json", { status: 200 }));
    const client = new StackApiV2Client({
      apiV2Url: "https://demo.stackenterprise.co/api/2.3",
      teamSlug: null,
      fetchFn: fetchMock,
    });

    await expect(client.getPagedItems("/tags")).rejects.toThrow("Stack API v2.3 returned invalid JSON");
  });

  it("calls the default browser fetch with the global receiver", async () => {
    const fetchMock = vi.fn(function (this: unknown) {
      if (this !== globalThis) {
        throw new TypeError("Illegal invocation");
      }

      return Promise.resolve(
        new Response(JSON.stringify({ items: [{ id: 1 }], has_more: false }), { status: 200 }),
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = new StackApiV2Client({
      apiV2Url: "https://api.stackoverflowteams.com/2.3",
      teamSlug: "example-team",
    });

    await expect(client.getPagedItems("/users")).resolves.toEqual([{ id: 1 }]);
  });
});
