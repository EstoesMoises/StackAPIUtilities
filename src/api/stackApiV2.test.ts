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
