import { webcrypto } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createReportJob, runReportJob } from "./reportJobRunner";
import type { ReportJob, ReportJobStore, ReportReadResponse } from "./types";
import type { SessionCredentials } from "../../domain/types";

const credentials: SessionCredentials = { instanceType: "enterprise", baseUrl: "https://example.stackenterprise.co", apiKey: "secret-key" };
export function memoryStore(): ReportJobStore {
  let job: ReportJob | null = null;
  const pages = new Map<string, ReportReadResponse>();
  const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
  return {
    load: async () => job && clone(job),
    create: async (value) => { pages.clear(); job = clone(value); return clone(job); },
    save: async (value) => { if (job && value.revision !== job.revision) throw Error("Changed in another tab"); job = clone({ ...value, revision: value.revision + 1 }); return clone(job); },
    read: async (_id, key) => pages.has(key) ? clone(pages.get(key)!) : null,
    checkpoint: async (value, key, response, elapsedMs, api) => {
      pages.set(key, clone(response));
      job = clone({ ...value, revision: value.revision + 1, completedRequests: value.completedRequests + 1,
        savedBytes: value.savedBytes + JSON.stringify(response).length, activeMs: value.activeMs + elapsedMs,
        timings: { ...value.timings, [api]: { count: value.timings[api].count + 1, milliseconds: value.timings[api].milliseconds + elapsedMs } } });
      return clone(job);
    },
    delete: async () => { job = null; pages.clear(); },
  };
}
function wire(body: unknown, status = 200, headers = {}) {
  return new Response(JSON.stringify({ ok: true, response: { status, body, headers } }), { status: 200 });
}
async function initial(store: ReportJobStore) {
  return store.create(await createReportJob("inactive-users", credentials, [{ periodRole: "current", scope: {} }]));
}
beforeEach(() => vi.stubGlobal("crypto", webcrypto));
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("resumable reports", () => {
  it("resumes from a durable page after interruption without fetching it again", async () => {
    const store = memoryStore();
    const abort = new AbortController();
    const requests: string[] = [];
    const fetchFn = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const payload = JSON.parse(String(init?.body));
      requests.push(payload.request.query.page);
      return wire({ items: [{ user_id: Number(payload.request.query.page) }], has_more: payload.request.query.page === "1" });
    });
    await expect(runReportJob(await initial(store), credentials, { store, fetchFn, signal: abort.signal,
      onProgress: ({ job }) => { if (job.completedRequests === 1) abort.abort(); },
    })).rejects.toThrow();
    const saved = (await store.load())!;
    expect(saved.status).toBe("paused");
    const result = await runReportJob(saved, credentials, { store, fetchFn, signal: new AbortController().signal });
    expect(requests).toEqual(["1", "2"]);
    expect(result.results[0].datasets[0].records).toEqual([{ user_id: 1 }, { user_id: 2 }]);
    expect(result.job.status).toBe("complete");
    expect(JSON.stringify(await store.load())).not.toContain("secret-key");
  });

  it("rejects a different credential or instance before reading saved data", async () => {
    const store = memoryStore();
    const job = await initial(store);
    const fetchFn = vi.fn();
    await expect(runReportJob(job, { ...credentials, apiKey: "other-account" }, { store, fetchFn, signal: new AbortController().signal })).rejects.toThrow(/same credentials/i);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("does not publish either comparison result when the second period fails", async () => {
    const store = memoryStore();
    const job = await store.create(await createReportJob("inactive-users", credentials, [
      { periodRole: "current", scope: { startDate: "2026-01-01" } },
      { periodRole: "comparison", scope: { startDate: "2025-01-01" } },
    ]));
    const fetchFn = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const { request } = JSON.parse(String(init?.body));
      return request.query.fromdate === "1735689600" ? wire({}, 403) : wire({ items: [{ user_id: 1 }], has_more: false });
    });
    await expect(runReportJob(job, credentials, { store, fetchFn, signal: new AbortController().signal })).rejects.toThrow(/403/);
    expect((await store.load())?.status).toBe("failed");
  });

  it("stops collection if a completed response cannot be saved", async () => {
    const store = memoryStore();
    store.checkpoint = async () => { throw Error("Browser storage is full"); };
    const fetchFn = vi.fn(async () => wire({ items: [{ user_id: 1 }], has_more: true }));
    await expect(runReportJob(await initial(store), credentials, { store, fetchFn, signal: new AbortController().signal })).rejects.toThrow(/storage is full/);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("honors a saved backoff deadline without waiting again for cached backoff metadata", async () => {
    vi.useFakeTimers();
    const store = memoryStore();
    const abort = new AbortController();
    const fetchFn = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const { request } = JSON.parse(String(init?.body));
      return wire({ items: [{ user_id: Number(request.query.page) }], has_more: request.query.page === "1", ...(request.query.page === "1" ? { backoff: 10 } : {}) });
    });
    await expect(runReportJob(await initial(store), credentials, { store, fetchFn, signal: abort.signal,
      onProgress: ({ job }) => { if (job.completedRequests === 1) abort.abort(); },
    })).rejects.toThrow();
    const saved = (await store.load())!;
    expect(saved.retryAt).toBeGreaterThan(Date.now());
    const promise = runReportJob(saved, credentials, { store, fetchFn, signal: new AbortController().signal });
    await vi.advanceTimersByTimeAsync(9_000);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1_000);
    await promise;
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("keeps a final-page backoff available to the next report", async () => {
    const store = memoryStore();
    const before = Date.now();
    const result = await runReportJob(await initial(store), credentials, {
      store, signal: new AbortController().signal,
      fetchFn: async () => wire({ items: [], has_more: false, backoff: 60 }),
    });
    expect(result.job.status).toBe("complete");
    expect(result.job.retryAt).toBeGreaterThanOrEqual(before + 60_000);
    expect((await store.load())?.retryAt).toBe(result.job.retryAt);
  });

  it("retries a malformed v2 page while keeping earlier valid pages", async () => {
    const store = memoryStore();
    const requests: string[] = [];
    let malformed = true;
    const fetchFn = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const { request } = JSON.parse(String(init?.body));
      const page = request.query.page;
      requests.push(page);
      return wire({ items: [{ user_id: Number(page) }], has_more: page === "1" ? true : malformed ? "false" : false });
    });
    await expect(runReportJob(await initial(store), credentials, { store, fetchFn, signal: new AbortController().signal })).rejects.toThrow(/invalid pagination/);
    expect((await store.load())?.completedRequests).toBe(1);
    malformed = false;
    const result = await runReportJob((await store.load())!, credentials, { store, fetchFn, signal: new AbortController().signal });
    expect(requests).toEqual(["1", "2", "2"]);
    expect(result.results[0].datasets[0].records).toHaveLength(2);
  });

  it.each(["pagination", "comments", "communities"] as const)("retries malformed v3 %s without poisoning the journal", async (failure) => {
    const store = memoryStore();
    const connection = { ...credentials, accessToken: "secret-token", authSource: "manual-enterprise-token" as const };
    let malformed = true;
    const reads: string[] = [];
    const badKey = failure === "pagination" ? "v3/questions/10/answers:2" : failure === "comments" ? "v3/questions/10/comments:" : "v3/communities:1";
    const fetchFn = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const { request } = JSON.parse(String(init?.body));
      reads.push(`${request.api}${request.path}:${request.query.page ?? ""}`);
      if (request.path === "/tags") return wire({ items: [{ id: 1, name: "python", subjectMatterExpertCount: 0 }], has_more: false, totalPages: 1 });
      if (request.path === "/questions") return wire({ items: [{ question_id: 10, answer_count: 2, comment_count: 1, tags: ["python"] }], has_more: false });
      if (request.path === "/questions/10/answers") return wire({ items: [{ id: Number(request.query.page) + 20, commentCount: 0 }],
        totalPages: malformed && failure === "pagination" && request.query.page === "2" ? 3 : 2 });
      if (request.path === "/questions/10/comments") return wire(malformed && failure === "comments" ? {} : [{ id: 30 }]);
      if (request.path === "/communities") return wire({ items: [{ tags: malformed && failure === "communities" ? [null] : [{ name: "python" }] }], totalPages: 1 });
      return wire({ items: [], has_more: false, totalPages: 1 });
    });
    const job = await store.create(await createReportJob("tag-report", connection, [{ periodRole: "current", scope: {} }]));
    await expect(runReportJob(job, connection, { store, fetchFn, signal: new AbortController().signal })).rejects.toThrow(/invalid/);
    malformed = false;
    const result = await runReportJob((await store.load())!, connection, { store, fetchFn, signal: new AbortController().signal });
    expect(result.job.status).toBe("complete");
    expect(reads.filter((key) => key === badKey)).toHaveLength(2);
    expect(reads.filter((key) => key === "v3/questions/10/answers:1")).toHaveLength(1);
  });
});

describe("large and nested report recovery", () => {
  it("continues through 10,000 pages across a pause without duplicate upstream reads", async () => {
    const store = memoryStore();
    const abort = new AbortController();
    let calls = 0;
    const fetchFn = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const { request } = JSON.parse(String(init?.body));
      calls++;
      const page = Number(request.query.page);
      return wire({ items: [{ user_id: page }], has_more: page < 10_000 });
    });
    await expect(runReportJob(await initial(store), credentials, { store, fetchFn, signal: abort.signal,
      onProgress: ({ job }) => { if (job.completedRequests === 5_000) abort.abort(); },
    })).rejects.toThrow();
    const result = await runReportJob((await store.load())!, credentials, { store, fetchFn, signal: new AbortController().signal });
    expect(calls).toBe(10_000);
    expect(result.results[0].datasets[0].records).toHaveLength(10_000);
    expect(result.results[0].datasets[0].pagination).toEqual({ pageCount: 10_000, reachedMaxPages: false, hasMore: false });
  }, 20_000);

  it("resumes inside answer pagination and preserves complete tag metrics", async () => {
    const store = memoryStore();
    const abort = new AbortController();
    const requests: string[] = [];
    const connection = { ...credentials, accessToken: "secret-token", authSource: "manual-enterprise-token" as const };
    let lastPath = "";
    const fetchFn = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const { request } = JSON.parse(String(init?.body));
      lastPath = `${request.api}${request.path}?${request.query.page ?? ""}`;
      requests.push(lastPath);
      if (request.api === "v3" && request.path === "/communities") return wire({}, 403);
      if (request.path === "/tags") return wire({ items: [{ id: 1, name: "python", subjectMatterExpertCount: 0 }], has_more: false, totalPages: 1 });
      if (request.path === "/questions") return wire({ items: [{ question_id: 10, answer_count: 2, comment_count: 0, tags: ["python"] }], has_more: false });
      if (request.path === "/questions/10/answers") return wire({ items: [{ id: Number(request.query.page) + 20, commentCount: 0 }], totalPages: 2 });
      return wire({ items: [], has_more: false, totalPages: 1 });
    });
    const job = await store.create(await createReportJob("tag-report", connection, [{ periodRole: "current", scope: {} }]));
    await expect(runReportJob(job, connection, { store, fetchFn, signal: abort.signal,
      onProgress: () => { if (lastPath === "v3/questions/10/answers?1") abort.abort(); },
    })).rejects.toThrow();
    const result = await runReportJob((await store.load())!, connection, { store, fetchFn, signal: new AbortController().signal });
    expect(requests.filter((path) => path === "v3/questions/10/answers?1")).toHaveLength(1);
    expect(requests.filter((path) => path === "v2/questions?1")).toHaveLength(1);
    expect(requests.some((path) => path.includes("top-answerers"))).toBe(false);
    expect(result.results[0].datasets.find((data) => data.datasetName === "questions")?.records[0].answers).toEqual([
      { id: 21, commentCount: 0, comments: [] }, { id: 22, commentCount: 0, comments: [] },
    ]);
    expect(result.job.status).toBe("complete");
  });

  it("does not return a complete result when paused during the final checkpoint", async () => {
    const store = memoryStore();
    const abort = new AbortController();
    const save = store.save;
    store.save = async (job) => { const saved = await save(job); if (job.status === "complete") abort.abort(); return saved; };
    await expect(runReportJob(await initial(store), credentials, {
      store, signal: abort.signal, fetchFn: async () => wire({ items: [], has_more: false }),
    })).rejects.toThrow();
    expect((await store.load())?.status).toBe("paused");
  });
});
