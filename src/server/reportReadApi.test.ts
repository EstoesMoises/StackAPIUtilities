// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "../app/api/reports/read/route";
import type { SessionCredentials } from "../domain/types";
import type { ReportReadRequest } from "../reports/resumable/types";
import { handleReportReadRequest } from "./reportReadApi";

const credentials: SessionCredentials = {
  instanceType: "enterprise",
  baseUrl: "https://example.stackenterprise.co",
  apiKey: "private-api-key",
  accessToken: "private-access-token",
  authSource: "manual-enterprise-token",
};
const defaultRead: ReportReadRequest = { api: "v2", path: "/users", query: { page: "2", pagesize: "100" } };
const payload = (request: ReportReadRequest = defaultRead, connection: SessionCredentials = credentials) => ({
  reportId: "tag-report", credentials: connection, request,
});
const page = { items: [{ user_id: 7 }], has_more: true, backoff: 4, quota_remaining: 200 };
const okFetch = () => vi.fn<typeof fetch>().mockResolvedValue(Response.json(page));

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("bounded report reads", () => {
  it("forwards exactly one GET with reconstructed Enterprise v2 auth and no caching", async () => {
    const fetchFn = okFetch();
    const result = await handleReportReadRequest(payload(), { fetchFn });
    expect(result.status).toBe(200);
    expect(result.headers.get("cache-control")).toBe("no-store");
    await expect(result.json()).resolves.toEqual({ ok: true, response: { status: 200, body: page, headers: {} } });
    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [input, init] = fetchFn.mock.calls[0];
    expect(String(input)).toBe("https://example.stackenterprise.co/api/2.3/users?page=2&pagesize=100");
    expect(init).toMatchObject({ method: "GET", redirect: "error", cache: "no-store", credentials: "omit" });
    const headers = new Headers(init?.headers);
    expect(headers.get("X-API-Key")).toBe("private-api-key");
    expect(headers.has("Authorization")).toBe(false);
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it.each(["v2", "v3"] as const)("reconstructs Basic/Business %s endpoints and PAT headers", async (api) => {
    const fetchFn = okFetch();
    const result = await handleReportReadRequest(payload({ api, path: "/tags", query: {} }, {
      instanceType: "basic-business", baseUrl: "https://stackoverflowteams.com/c/demo/", pat: "private-pat",
    }), { fetchFn });
    expect(result.status).toBe(200);
    const [input, init] = fetchFn.mock.calls[0];
    expect(String(input)).toBe(api === "v2" ? "https://api.stackoverflowteams.com/2.3/tags?team=demo" : "https://api.stackoverflowteams.com/v3/teams/demo/tags");
    const headers = new Headers(init?.headers);
    expect(headers.get("authorization")).toBe("Bearer private-pat");
    expect(headers.get("x-api-access-token")).toBe(api === "v2" ? "private-pat" : null);
  });

  it("uses only the access token for Enterprise v3", async () => {
    const fetchFn = okFetch();
    await handleReportReadRequest(payload({ api: "v3", path: "/tags/9", query: {} }), { fetchFn });
    const headers = new Headers(fetchFn.mock.calls[0][1]?.headers);
    expect(headers.get("authorization")).toBe("Bearer private-access-token");
    expect(headers.has("x-api-key")).toBe(false);
    expect(headers.get("user-agent")).toMatch(/^StackAPIUtilities\//);
  });

  it.each([
    ["v2", "/users/1;2/reputation-history", { page: "1", pagesize: "100", fromdate: "0", todate: "1900000000" }],
    ["v2", "/tags/c%23/top-answerers/all_time", { page: "1", pagesize: "100" }],
    ["v2", "/tags/c%2B%2B/top-answerers/all_time", {}],
    ["v2", "/questions/1;23", { page: "1", pagesize: "100" }],
    ["v2", "/articles/1;23", {}],
    ["v2", "/answers/1;23", {}],
    ["v3", "/communities", { page: "1", pageSize: "100" }],
    ["v3", "/user-groups", { page: "1", pageSize: "100" }],
    ["v3", "/tags/1/subject-matter-experts", {}],
    ["v3", "/questions/3/answers", { page: "1", pageSize: "100", sort: "creation", order: "asc" }],
    ["v3", "/questions/3/answers/4/comments", {}],
    ["v3", "/questions/3/comments", {}],
    ["v3", "/articles/3/comments", {}],
  ])("accepts collector path %s %s", async (api, path, query) => {
    const fetchFn = okFetch();
    const result = await handleReportReadRequest(payload({ api, path, query } as ReportReadRequest), { fetchFn });
    expect(result.status).toBe(200);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it.each([
    { api: "v2", path: "https://attacker.test/users", query: {} },
    { api: "v2", path: "//attacker.test/users", query: {} },
    { api: "v2", path: "/users/../admin", query: {} },
    { api: "v2", path: "/users?access_token=secret", query: {} },
    { api: "v2", path: "/users#fragment", query: {} },
    { api: "v2", path: "/users\\admin", query: {} },
    { api: "v2", path: "/questions/1%3B2", query: {} },
    { api: "v2", path: "/questions/1;evil", query: {} },
    { api: "v2", path: "/tags/%2E%2E/top-answerers/all_time", query: {} },
    { api: "v2", path: "/tags/a%2Fb/top-answerers/all_time", query: {} },
    { api: "v2", path: "/tags/a%252Fb/top-answerers/all_time", query: {} },
    { api: "v2", path: "/users", query: { access_token: "secret" } },
    { api: "v2", path: "/users", query: { team: "other-team" } },
    { api: "v2", path: "/users", query: { filter: "unsafe" } },
    { api: "v2", path: "/users", query: { page: "0" } },
    { api: "v2", path: "/users", query: { page: "1&key=secret" } },
    { api: "v2", path: "/users", query: { pagesize: "101" } },
    { api: "v3", path: "/users", query: {} },
    { api: "v3", path: "/tags", query: { order: "asc" } },
    { api: "v3", path: "/questions/3/answers", query: { sort: "activity" } },
  ])("rejects unsupported or injected request %# without an upstream call", async (request) => {
    const fetchFn = okFetch();
    const result = await handleReportReadRequest(payload(request as ReportReadRequest), { fetchFn });
    expect(result.status).toBe(400);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it.each([
    "http://example.stackenterprise.co", "https://user:secret@example.stackenterprise.co",
    "https://example.stackenterprise.co?token=secret", "https://example.stackenterprise.co#secret",
    "https://example.stackenterprise.co\\@attacker.test", "not-a-url",
  ])("rejects an unsafe connection URL %s", async (baseUrl) => {
    const fetchFn = okFetch();
    const result = await handleReportReadRequest(payload(defaultRead, { ...credentials, baseUrl }), { fetchFn });
    expect(result.status).toBe(400);
    expect(fetchFn).not.toHaveBeenCalled();
    expect(await result.text()).not.toContain(baseUrl);
  });

  it.each([
    { reportId: "unknown" }, { reportId: "api-import" }, { method: "POST" },
    { credentials: { ...credentials, instanceType: "arbitrary" } },
    { credentials: { ...credentials, apiKey: undefined } },
    { credentials: { ...credentials, oauthScopes: {} } },
    { request: { ...defaultRead, headers: { authorization: "override" } } },
  ])("rejects malformed payload %# without reflecting it", async (override) => {
    const fetchFn = okFetch();
    const result = await handleReportReadRequest({ ...payload(), ...override }, { fetchFn });
    expect(result.status).toBe(400);
    expect(fetchFn).not.toHaveBeenCalled();
    expect(await result.text()).not.toContain("private-");
  });

  it("passes through 429 status and only throttle headers without retrying or exposing error bodies", async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ error_message: "private-access-token" }, {
      status: 429,
      headers: { "Retry-After": "12", "x-burst-throttle-calls-left": "0", "x-burst-throttle-seconds-until-full": "12",
        "x-token-bucket-calls-left": "5", "x-token-bucket-seconds-until-next-refill": "10",
        "set-cookie": "secret=value", "location": "https://secret.test", "x-api-key": "private-api-key" },
    }));
    const result = await handleReportReadRequest(payload(), { fetchFn });
    expect(result.status).toBe(200);
    await expect(result.json()).resolves.toEqual({ ok: true, response: { status: 429, body: {}, headers: {
      "retry-after": "12", "x-burst-throttle-calls-left": "0", "x-burst-throttle-seconds-until-full": "12",
      "x-token-bucket-calls-left": "5", "x-token-bucket-seconds-until-next-refill": "10",
    } } });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("omits malformed throttle values that could reflect secrets or redirect URLs", async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(Response.json(page, { headers: {
      "retry-after": "private-access-token", "x-burst-throttle-calls-left": "https://secret.test",
      "x-token-bucket-calls-left": "9007199254740992",
    } }));
    const result = await handleReportReadRequest(payload(), { fetchFn });
    await expect(result.json()).resolves.toEqual({ ok: true, response: { status: 200, body: page, headers: {} } });
  });

  it("preserves HTTP-date Retry-After values for browser throttle scheduling", async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(Response.json({}, {
      status: 429, headers: { "retry-after": "Tue, 03 Nov 2026 16:00:00 GMT" },
    }));
    const result = await handleReportReadRequest(payload(), { fetchFn });
    await expect(result.json()).resolves.toMatchObject({ response: { headers: { "retry-after": "Tue, 03 Nov 2026 16:00:00 GMT" } } });
  });

  it("rejects even empty query and fragment markers in connection URLs", async () => {
    for (const suffix of ["?", "#"]) {
      const fetchFn = okFetch();
      const result = await handleReportReadRequest(payload(defaultRead, { ...credentials, baseUrl: credentials.baseUrl + suffix }), { fetchFn });
      expect(result.status).toBe(400);
      expect(fetchFn).not.toHaveBeenCalled();
    }
  });

  it("does not fetch after a browser request was already cancelled", async () => {
    const abort = new AbortController();
    abort.abort();
    const fetchFn = okFetch();
    const result = await handleReportReadRequest(payload(), { fetchFn, signal: abort.signal });
    expect(result.status).toBe(499);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("refuses redirect responses without forwarding credentials to the redirect", async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 302, headers: { location: "https://attacker.test" } }));
    const result = await handleReportReadRequest(payload(), { fetchFn });
    expect(result.status).toBe(502);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(await result.text()).not.toContain("attacker.test");
  });

  it("sanitizes transport failures and malformed JSON", async () => {
    for (const fetchFn of [
      vi.fn<typeof fetch>().mockRejectedValue(new Error("https://private-access-token@secret.test")),
      vi.fn<typeof fetch>().mockResolvedValue(new Response("private-access-token")),
    ]) {
      const result = await handleReportReadRequest(payload(), { fetchFn });
      expect(result.status).toBe(502);
      expect(await result.text()).not.toContain("private-");
    }
  });

  it("aborts an unresolved upstream request after 20 seconds", async () => {
    vi.useFakeTimers();
    const fetchFn = vi.fn<typeof fetch>(() => new Promise(() => {}));
    const pending = handleReportReadRequest(payload(), { fetchFn });
    await vi.advanceTimersByTimeAsync(20_000);
    const result = await pending;
    expect(result.status).toBe(504);
    expect(fetchFn.mock.calls[0][1]?.signal?.aborted).toBe(true);
  });

  it("keeps the deadline active while streaming the upstream body and cancels its reader", async () => {
    vi.useFakeTimers();
    const cancel = vi.fn();
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(new Response(new ReadableStream({ cancel })));
    const pending = handleReportReadRequest(payload(), { fetchFn });
    await vi.advanceTimersByTimeAsync(20_000);
    const result = await pending;
    expect(result.status).toBe(504);
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it("cancels upstream body work when the browser pauses", async () => {
    const abort = new AbortController();
    const cancel = vi.fn();
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(new Response(new ReadableStream({ cancel })));
    const pending = handleReportReadRequest(payload(), { fetchFn, signal: abort.signal });
    await Promise.resolve();
    abort.abort(new Error("private-access-token"));
    const result = await pending;
    expect(result.status).toBe(499);
    expect(fetchFn.mock.calls[0][1]?.signal?.aborted).toBe(true);
    expect(cancel).toHaveBeenCalled();
    expect(await result.text()).not.toContain("private-");
  });

  it("rejects and cancels streamed upstream data exceeding 2 MiB without content-length", async () => {
    const cancel = vi.fn();
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(new Response(new ReadableStream({
      start(controller) { controller.enqueue(new Uint8Array(2 * 1024 * 1024)); controller.enqueue(new Uint8Array(1)); }, cancel,
    })));
    const result = await handleReportReadRequest(payload(), { fetchFn });
    expect(result.status).toBe(502);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(await result.text()).toMatch(/limit/i);
  });
});

describe("report read POST boundary", () => {
  it("returns no-store JSON for malformed request bodies", async () => {
    const result = await POST(new Request("http://localhost/api/reports/read", { method: "POST", body: "not-json" }));
    expect(result.status).toBe(400);
    expect(result.headers.get("cache-control")).toBe("no-store");
    await expect(result.json()).resolves.toMatchObject({ ok: false });
  });

  it("rejects a streamed request larger than 1 MiB before any upstream request", async () => {
    const fetchFn = okFetch();
    vi.stubGlobal("fetch", fetchFn);
    const request = new Request("http://localhost/api/reports/read", { method: "POST", body: " ".repeat(1024 * 1024 + 1) });
    const result = await POST(request);
    expect(result.status).toBe(413);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("rejects an oversized declared request before reading its pending stream", async () => {
    const cancel = vi.fn();
    const request = new Request("http://localhost/api/reports/read", {
      method: "POST", headers: { "content-length": String(1024 * 1024 + 1) },
      body: new ReadableStream({ cancel }), duplex: "half",
    } as RequestInit);
    expect((await POST(request)).status).toBe(413);
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it("forwards the request abort signal through the route", async () => {
    vi.useFakeTimers();
    const abort = new AbortController();
    const fetchFn = vi.fn<typeof fetch>(() => new Promise(() => {}));
    vi.stubGlobal("fetch", fetchFn);
    const pending = POST(new Request("http://localhost/api/reports/read", { method: "POST", body: JSON.stringify(payload()), signal: abort.signal }));
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    abort.abort();
    expect((await pending).status).toBe(499);
    expect(fetchFn.mock.calls[0][1]?.signal?.aborted).toBe(true);
  });
});
