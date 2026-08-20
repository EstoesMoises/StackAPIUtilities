import { afterEach, describe, expect, it, vi } from "vitest";
import { StackApiV3Client } from "./stackApiV3";

const API_V3_USER_AGENT =
  "StackAPIUtilities/0.1 (+https://github.com/EstoesMoises/StackAPIUtilities)";

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
