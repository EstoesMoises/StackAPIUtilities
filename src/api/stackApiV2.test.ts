import { afterEach, describe, expect, it, vi } from "vitest";
import { StackApiV2Client } from "./stackApiV2";

afterEach(() => {
  vi.unstubAllGlobals();
});

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
