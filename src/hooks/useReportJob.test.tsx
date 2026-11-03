import { webcrypto } from "node:crypto";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FetchLike } from "../api/httpClient";
import type { SessionCredentials } from "../domain/types";
import { createReportJob } from "../reports/resumable/reportJobRunner";
import type { ReportJob, ReportJobStore, ReportReadResponse } from "../reports/resumable/types";
import { useReportJob } from "./useReportJob";

const credentials: SessionCredentials = {
  instanceType: "enterprise", baseUrl: "https://example.stackenterprise.co", apiKey: "private-test-key",
};
const periods: ReportJob["periods"] = [{ periodRole: "current", scope: {} }];
const runExclusive = async <T,>(operation: () => Promise<T>): Promise<T> => operation();
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

function memoryStore(initial: ReportJob | null = null) {
  let current = clone(initial);
  const responses = new Map<string, ReportReadResponse>();
  const checked = (job: ReportJob) => {
    if (!current || current.id !== job.id || current.revision !== job.revision) throw Error("Saved job revision conflict.");
  };
  const store: ReportJobStore = {
    load: vi.fn(async () => clone(current)),
    create: vi.fn<ReportJobStore["create"]>(async (job) => { current = clone(job); responses.clear(); return clone(current); }),
    save: vi.fn<ReportJobStore["save"]>(async (job) => { checked(job); current = clone({ ...job, revision: job.revision + 1 }); return clone(current); }),
    read: vi.fn(async (id, key) => clone(current?.id === id ? responses.get(key) ?? null : null)),
    checkpoint: vi.fn<ReportJobStore["checkpoint"]>(async (job, key, response, elapsedMs, api) => {
      checked(job);
      responses.set(key, clone(response));
      current = clone({ ...job, revision: job.revision + 1, completedRequests: job.completedRequests + 1,
        savedBytes: job.savedBytes + JSON.stringify(response).length, activeMs: job.activeMs + elapsedMs,
        timings: { ...job.timings, [api]: { count: job.timings[api].count + 1, milliseconds: job.timings[api].milliseconds + elapsedMs } },
      });
      return clone(current);
    }),
    delete: vi.fn(async (id) => { if (current?.id === id) { current = null; responses.clear(); } }),
  };
  return { store, current: () => clone(current) };
}

function page(items: unknown[] = [{ user_id: 1, display_name: "Ada" }], hasMore = false): Response {
  return Response.json({ ok: true, response: { status: 200, body: { items, has_more: hasMore }, headers: {} } });
}
function fetchPages() { return vi.fn<FetchLike>(async () => page()); }
function pendingPage() {
  let signal: AbortSignal | null = null;
  let resolve: (response: Response) => void = () => {};
  let reject: (error: unknown) => void = () => {};
  const fetchFn = vi.fn<FetchLike>((_, init) => new Promise((res, rej) => {
    signal = init?.signal ?? null;
    resolve = res; reject = rej;
    signal?.addEventListener("abort", () => rej(new DOMException("Paused", "AbortError")), { once: true });
  }));
  return { fetchFn, signal: () => signal, resolve: (response = page()) => resolve(response), reject: (error: unknown) => reject(error) };
}

beforeEach(() => { vi.stubGlobal("crypto", webcrypto); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("useReportJob", () => {
  it("restores a running checkpoint as paused without automatic requests", async () => {
    const initial = { ...await createReportJob("inactive-users", credentials, periods), status: "running" as const };
    const { store, current } = memoryStore(initial);
    const fetchFn = fetchPages();
    const onComplete = vi.fn();
    const { result } = renderHook(() => useReportJob(credentials, onComplete, { store, fetchFn, runExclusive }));
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.progress?.job.status).toBe("paused");
    expect(current()?.status).toBe("paused");
    expect(fetchFn).not.toHaveBeenCalled();
    expect(onComplete).not.toHaveBeenCalled();
  });

  it("runs the real collector and publishes the complete result once", async () => {
    const { store, current } = memoryStore();
    const fetchFn = fetchPages();
    const onComplete = vi.fn();
    const { result } = renderHook(() => useReportJob(credentials, onComplete, { store, fetchFn, runExclusive }));
    await waitFor(() => expect(result.current.ready).toBe(true));
    await act(() => result.current.start("inactive-users", periods));
    expect(result.current.busy).toBe(false);
    expect(current()?.status).toBe("complete");
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onComplete.mock.calls[0][0][0]).toMatchObject({ reportId: "inactive-users", datasets: [{ datasetName: "users", records: [{ user_id: 1, display_name: "Ada" }] }] });
    expect(JSON.stringify(current())).not.toContain("private-test-key");
  });

  it("uses a synchronous busy guard to reject double-click starts", async () => {
    const { store } = memoryStore();
    const pending = pendingPage();
    const { result } = renderHook(() => useReportJob(credentials, vi.fn(), { store, fetchFn: pending.fetchFn, runExclusive }));
    await waitFor(() => expect(result.current.ready).toBe(true));
    let first!: Promise<void>;
    act(() => { first = result.current.start("inactive-users", periods); void result.current.start("inactive-users", periods); });
    await waitFor(() => expect(pending.fetchFn).toHaveBeenCalledTimes(1));
    expect(store.create).toHaveBeenCalledTimes(1);
    await act(async () => { pending.resolve(); await first; });
  });

  it("refuses to replace unfinished saved work but replaces completed work", async () => {
    const initial = await createReportJob("inactive-users", credentials, periods);
    const { store, current } = memoryStore(initial);
    const fetchFn = fetchPages();
    const { result } = renderHook(() => useReportJob(credentials, vi.fn(), { store, fetchFn, runExclusive }));
    await waitFor(() => expect(result.current.ready).toBe(true));
    await act(() => result.current.start("inactive-users", periods));
    expect(result.current.error).toMatch(/discard|unfinished/i);
    expect(current()?.id).toBe(initial.id);
    expect(fetchFn).not.toHaveBeenCalled();
    await act(() => result.current.resume());
    await act(() => result.current.start("inactive-users", periods));
    expect(current()?.id).not.toBe(initial.id);
    expect(result.current.error).toBeNull();
  });

  it("pauses an interrupted page, restores it on remount, and reuses completed checkpoints", async () => {
    const { store } = memoryStore();
    const blocked = pendingPage();
    const fetchFn = vi.fn<FetchLike>((input, init) => {
      const body = JSON.parse(String(init?.body)) as { request: { query: { page: string } } };
      return body.request.query.page === "1" ? Promise.resolve(page([{ user_id: 1 }], true)) : blocked.fetchFn(input, init);
    });
    const onComplete = vi.fn();
    const first = renderHook(() => useReportJob(credentials, onComplete, { store, fetchFn, runExclusive }));
    await waitFor(() => expect(first.result.current.ready).toBe(true));
    let running!: Promise<void>;
    act(() => { running = first.result.current.start("inactive-users", periods); });
    await waitFor(() => expect(blocked.fetchFn).toHaveBeenCalledTimes(1));
    await act(async () => { first.result.current.pause(); await running; });
    expect(first.result.current.progress?.job.status).toBe("paused");
    expect(first.result.current.progress?.job.completedRequests).toBe(1);
    expect(onComplete).not.toHaveBeenCalled();
    first.unmount();
    const resumedFetch = fetchPages();
    const second = renderHook(() => useReportJob(credentials, onComplete, { store, fetchFn: resumedFetch, runExclusive }));
    await waitFor(() => expect(second.result.current.ready).toBe(true));
    expect(resumedFetch).not.toHaveBeenCalled();
    await act(() => second.result.current.resume());
    expect(resumedFetch).toHaveBeenCalledTimes(1);
    const request = JSON.parse(String(resumedFetch.mock.calls[0][1]?.body)) as { request: { query: { page: string } } };
    expect(request.request.query.page).toBe("2");
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it.each(["pagehide", "offline", "unmount"])("aborts active work on %s without late publication", async (event) => {
    const { store, current } = memoryStore();
    const pending = pendingPage();
    const onComplete = vi.fn();
    const hook = renderHook(() => useReportJob(credentials, onComplete, { store, fetchFn: pending.fetchFn, runExclusive }));
    await waitFor(() => expect(hook.result.current.ready).toBe(true));
    let running!: Promise<void>;
    act(() => { running = hook.result.current.start("inactive-users", periods); });
    await waitFor(() => expect(pending.fetchFn).toHaveBeenCalledTimes(1));
    await act(async () => {
      if (event === "unmount") hook.unmount(); else window.dispatchEvent(new Event(event));
      await running;
    });
    expect(pending.signal()?.aborted).toBe(true);
    expect(current()?.status).toBe("paused");
    expect(onComplete).not.toHaveBeenCalled();
  });

  it("keeps comparison results private until both periods finish", async () => {
    const { store } = memoryStore();
    let calls = 0;
    const fetchFn = vi.fn<FetchLike>(async () => ++calls === 1 ? page() : Response.json({ ok: false, error: "Comparison collection failed." }, { status: 502 }));
    const onComplete = vi.fn();
    const { result } = renderHook(() => useReportJob(credentials, onComplete, { store, fetchFn, runExclusive }));
    await waitFor(() => expect(result.current.ready).toBe(true));
    await act(() => result.current.start("inactive-users", [
      { periodRole: "current", scope: { startDate: "2026-01-01", endDate: "2026-01-31" } },
      { periodRole: "comparison", scope: { startDate: "2025-01-01", endDate: "2025-01-31" } },
    ]));
    expect(result.current.error).toMatch(/Comparison collection failed/);
    expect(onComplete).not.toHaveBeenCalled();
  });

  it("shows credential mismatch before issuing another request", async () => {
    const { store } = memoryStore(await createReportJob("inactive-users", credentials, periods));
    const fetchFn = fetchPages();
    const { result } = renderHook(() => useReportJob({ ...credentials, apiKey: "different-key" }, vi.fn(), { store, fetchFn, runExclusive }));
    await waitFor(() => expect(result.current.ready).toBe(true));
    await act(() => result.current.resume());
    expect(result.current.error).toMatch(/same credentials/);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("uses the latest completion callback and surfaces output validation errors", async () => {
    const { store } = memoryStore();
    const pending = pendingPage();
    const firstCallback = vi.fn();
    const latestCallback = vi.fn(() => { throw Error("Report output validation failed."); });
    const hook = renderHook(({ callback }) => useReportJob(credentials, callback, { store, fetchFn: pending.fetchFn, runExclusive }), { initialProps: { callback: firstCallback } });
    await waitFor(() => expect(hook.result.current.ready).toBe(true));
    let running!: Promise<void>;
    act(() => { running = hook.result.current.start("inactive-users", periods); });
    await waitFor(() => expect(pending.fetchFn).toHaveBeenCalledTimes(1));
    hook.rerender({ callback: latestCallback });
    await act(async () => { pending.resolve(); await running; });
    expect(firstCallback).not.toHaveBeenCalled();
    expect(latestCallback).toHaveBeenCalledTimes(1);
    expect(hook.result.current.error).toMatch(/output validation/);
  });

  it("waits for active work to settle before deleting its saved job", async () => {
    const { store, current } = memoryStore();
    const pending = pendingPage();
    const onComplete = vi.fn();
    const { result } = renderHook(() => useReportJob(credentials, onComplete, { store, fetchFn: pending.fetchFn, runExclusive }));
    await waitFor(() => expect(result.current.ready).toBe(true));
    let running!: Promise<void>;
    act(() => { running = result.current.start("inactive-users", periods); });
    await waitFor(() => expect(pending.fetchFn).toHaveBeenCalledTimes(1));
    await act(async () => { await result.current.discard(); await running; });
    expect(current()).toBeNull();
    expect(result.current.progress).toBeNull();
    expect(result.current.busy).toBe(false);
    expect(onComplete).not.toHaveBeenCalled();
  });

  it("does not delete a different job created in another tab", async () => {
    const initial = await createReportJob("inactive-users", credentials, periods);
    const { store, current } = memoryStore(initial);
    const { result } = renderHook(() => useReportJob(credentials, vi.fn(), { store, fetchFn: fetchPages(), runExclusive }));
    await waitFor(() => expect(result.current.ready).toBe(true));
    const replacement = await createReportJob("inactive-users", credentials, periods);
    await store.create(replacement);
    await act(() => result.current.discard());
    expect(current()?.id).toBe(replacement.id);
    expect(result.current.error).toMatch(/changed|another tab/i);
  });

  it("shows storage load and checkpoint failures without publishing", async () => {
    const first = memoryStore();
    vi.mocked(first.store.load).mockRejectedValue(Error("Storage is unavailable."));
    const failed = renderHook(() => useReportJob(credentials, vi.fn(), { store: first.store, runExclusive }));
    await waitFor(() => expect(failed.result.current.ready).toBe(true));
    expect(failed.result.current.error).toMatch(/Storage is unavailable/);
    failed.unmount();
    const second = memoryStore();
    vi.mocked(second.store.checkpoint).mockRejectedValue(Error("Storage quota exceeded."));
    const onComplete = vi.fn();
    const hook = renderHook(() => useReportJob(credentials, onComplete, { store: second.store, fetchFn: fetchPages(), runExclusive }));
    await waitFor(() => expect(hook.result.current.ready).toBe(true));
    await act(() => hook.result.current.start("inactive-users", periods));
    expect(hook.result.current.error).toMatch(/Storage quota exceeded/);
    expect(onComplete).not.toHaveBeenCalled();
  });

  it("waits for hydration before starting so its stale snapshot cannot replace new work", async () => {
    const { store, current } = memoryStore();
    let loaded: (value: ReportJob | null) => void = () => {};
    vi.mocked(store.load).mockImplementationOnce(() => new Promise((resolve) => { loaded = resolve; }));
    const { result } = renderHook(() => useReportJob(credentials, vi.fn(), { store, fetchFn: fetchPages(), runExclusive }));
    let running!: Promise<void>;
    act(() => { running = result.current.start("inactive-users", periods); });
    expect(store.create).not.toHaveBeenCalled();
    await act(async () => { loaded(null); await running; });
    expect(result.current.progress?.job.id).toBe(current()?.id);
    expect(result.current.progress?.job.status).toBe("complete");
  });

  it("keeps a late hydration result from replacing a newer store snapshot", async () => {
    const old = await createReportJob("inactive-users", credentials, periods);
    const first = memoryStore(old);
    let loaded: (job: ReportJob) => void = () => {};
    vi.mocked(first.store.load).mockImplementationOnce(() => new Promise((resolve) => { loaded = resolve; }));
    const newer = { ...await createReportJob("inactive-users", credentials, periods), status: "complete" as const };
    const second = memoryStore(newer);
    const hook = renderHook(({ store }) => useReportJob(credentials, vi.fn(), { store, runExclusive }), { initialProps: { store: first.store } });
    hook.rerender({ store: second.store });
    await waitFor(() => expect(hook.result.current.ready).toBe(true));
    await act(async () => { loaded(old); });
    expect(hook.result.current.progress?.job.id).toBe(newer.id);
  });

  it("clears busy state when changing stores aborts an older run", async () => {
    const first = memoryStore();
    const second = memoryStore();
    const pending = pendingPage();
    const hook = renderHook(({ store }) => useReportJob(credentials, vi.fn(), { store, fetchFn: pending.fetchFn, runExclusive }), { initialProps: { store: first.store } });
    await waitFor(() => expect(hook.result.current.ready).toBe(true));
    let running!: Promise<void>;
    act(() => { running = hook.result.current.start("inactive-users", periods); });
    await waitFor(() => expect(pending.fetchFn).toHaveBeenCalledTimes(1));
    hook.rerender({ store: second.store });
    await act(async () => { await running; });
    expect(hook.result.current.busy).toBe(false);
    expect(hook.result.current.progress).toBeNull();
  });

  it("does not publish when paused after the final checkpoint commit", async () => {
    const { store } = memoryStore();
    const save = store.save;
    const onComplete = vi.fn();
    const hook = renderHook(() => useReportJob(credentials, onComplete, { store, fetchFn: fetchPages(), runExclusive }));
    await waitFor(() => expect(hook.result.current.ready).toBe(true));
    store.save = async (job) => {
      const saved = await save(job);
      if (job.status === "complete") hook.result.current.pause();
      return saved;
    };
    await act(() => hook.result.current.start("inactive-users", periods));
    expect(onComplete).not.toHaveBeenCalled();
  });

  it("does not overwrite a running checkpoint owned by another tab during hydration", async () => {
    const initial = { ...await createReportJob("inactive-users", credentials, periods), status: "running" as const };
    const { store, current } = memoryStore(initial);
    Object.defineProperty(navigator, "locks", { configurable: true, value: {
      request: async (_name: string, _options: unknown, callback: (lock: null) => Promise<unknown>) => callback(null),
    } });
    const { result } = renderHook(() => useReportJob(credentials, vi.fn(), { store, fetchFn: fetchPages() }));
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(current()?.status).toBe("running");
    expect(store.save).not.toHaveBeenCalled();
    expect(result.current.error).toMatch(/another tab/);
  });

  it("uses a nonwaiting Web Lock for the entire operation", async () => {
    const { store } = memoryStore();
    const pending = pendingPage();
    let held = false;
    const request = vi.fn(async (_name, _options, callback) => {
      held = true;
      try { return await callback({ name: "stack-report-job", mode: "exclusive" }); } finally { held = false; }
    });
    Object.defineProperty(navigator, "locks", { configurable: true, value: { request } });
    const onComplete = vi.fn(() => { expect(held).toBe(true); });
    const { result } = renderHook(() => useReportJob(credentials, onComplete, { store, fetchFn: pending.fetchFn }));
    await waitFor(() => expect(result.current.ready).toBe(true));
    let running!: Promise<void>;
    act(() => { running = result.current.start("inactive-users", periods); });
    await waitFor(() => expect(pending.fetchFn).toHaveBeenCalledTimes(1));
    expect(held).toBe(true);
    expect(request.mock.calls[0].slice(0, 2)).toEqual(["stack-report-job", { ifAvailable: true }]);
    await act(async () => { pending.resolve(); await running; });
    expect(held).toBe(false);
  });

  it.each(["unavailable", "unsupported"])("reports %s Web Locks before mutation", async (condition) => {
    const { store } = memoryStore();
    const fetchFn = fetchPages();
    Object.defineProperty(navigator, "locks", { configurable: true, value: condition === "unsupported" ? undefined : {
      request: async (_name: string, _options: unknown, callback: (lock: null) => Promise<unknown>) => callback(null),
    } });
    const { result } = renderHook(() => useReportJob(credentials, vi.fn(), { store, fetchFn }));
    await waitFor(() => expect(result.current.ready).toBe(true));
    await act(() => result.current.start("inactive-users", periods));
    expect(result.current.error).toMatch(condition === "unavailable" ? /another tab/i : /browser.*support|Web Locks/i);
    expect(store.create).not.toHaveBeenCalled();
    expect(fetchFn).not.toHaveBeenCalled();
  });
});
