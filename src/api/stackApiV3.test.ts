import { afterEach, describe, expect, it, vi } from "vitest";
import { StackApiV3Client } from "./stackApiV3";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("StackApiV3Client", () => {
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
});
