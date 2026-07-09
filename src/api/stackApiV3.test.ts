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
        headers: expect.objectContaining({ Authorization: "Bearer token", "Content-Type": "application/json" }),
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
        headers: expect.objectContaining({ Authorization: "Bearer token", "Content-Type": "application/json" }),
      }),
    );
    expect(fetchMock.mock.calls[1][1]).toEqual(
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer token", "Content-Type": "application/json" }),
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
        headers: expect.objectContaining({ Authorization: "Bearer token", "Content-Type": "application/json" }),
        body: JSON.stringify({ name: "Ada Lovelace VRM", userIds: [1, 2] }),
      }),
    );
    expect(fetchMock.mock.calls[1][0].toString()).toBe(
      "https://demo.stackenterprise.co/api/v3/user-groups/7/members",
    );
    expect(fetchMock.mock.calls[1][1]).toEqual(
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Authorization: "Bearer token", "Content-Type": "application/json" }),
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
        headers: expect.objectContaining({ Authorization: "Bearer token", "Content-Type": "application/json" }),
      }),
    );
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
