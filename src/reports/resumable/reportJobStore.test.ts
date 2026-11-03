import { afterEach, describe, expect, it, vi } from "vitest";
import { reportJobStore } from "./reportJobStore";
import type { ReportJob, ReportReadResponse } from "./types";

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const key = JSON.stringify(["v2", "/questions", [["page", "1"]]]);
const response: ReportReadResponse = { status: 200, body: { items: [{ id: 7 }] }, headers: {} };

function job(overrides: Partial<ReportJob> = {}): ReportJob {
  return {
    version: 1, id: "report-1", revision: 0, reportId: "tag-report", reportTitle: "Tag report",
    connectionKey: "enterprise|https://example.stackenterprise.co", credentialFingerprint: "a".repeat(64),
    periods: [{ periodRole: "current", scope: { startDate: "2026-01-01", endDate: "2026-01-31" } }],
    status: "running", createdAt: "2026-11-03T12:00:00.000Z", updatedAt: "2026-11-03T12:00:00.000Z",
    completedRequests: 0, savedBytes: 0, activeMs: 0,
    timings: { v2: { count: 0, milliseconds: 0 }, v3: { count: 0, milliseconds: 0 } },
    retryAt: null, stage: "Reading questions", error: null, ...overrides,
  };
}

describe("reportJobStore", () => {
  it("fails visibly when durable browser storage is unavailable", async () => {
    vi.stubGlobal("indexedDB", undefined);
    await expect(reportJobStore.load()).rejects.toThrow(/storage.*unavailable/i);
    await expect(reportJobStore.create(job())).rejects.toThrow(/storage.*unavailable/i);
  });

  it.each(["throw", "error", "blocked"])("surfaces an IndexedDB open %s without silently losing persistence", async (failure) => {
    vi.stubGlobal("indexedDB", {
      open: () => {
        if (failure === "throw") throw new DOMException("storage blocked", "SecurityError");
        const request = { onerror: null as (() => void) | null, onblocked: null as (() => void) | null };
        queueMicrotask(() => failure === "error" ? request.onerror?.() : request.onblocked?.());
        return request;
      },
    });
    await expect(reportJobStore.load()).rejects.toThrow(/storage/i);
  });

  it("returns no job for an empty database and round-trips validated metadata", async () => {
    installDatabase();
    await expect(reportJobStore.load()).resolves.toBeNull();
    const created = await reportJobStore.create(job());
    expect(created).toEqual(job());
    await expect(reportJobStore.load()).resolves.toEqual(created);
  });

  it("persists a comparison-only run while preserving its period role", async () => {
    installDatabase();
    const comparison = job({ periods: [{ periodRole: "comparison", scope: { startDate: "2025-01-01", endDate: "2025-01-31" } }] });
    const created = await reportJobStore.create(comparison);
    await expect(reportJobStore.load()).resolves.toEqual(comparison);
    const saved = await reportJobStore.checkpoint(created, key, response, 100, "v2");
    expect(saved.periods).toEqual(comparison.periods);
  });

  it("reconstructs metadata from permitted own fields without storing credentials", async () => {
    const database = installDatabase();
    const input = { ...job(), credentials: { pat: "raw-secret" }, extra: "raw-secret" };
    Object.assign(input.periods[0].scope, { accessToken: "raw-secret" });
    Object.assign(input.timings.v2, { apiKey: "raw-secret" });
    await reportJobStore.create(input);
    expect(JSON.stringify([...database.stores.values()].map((store) => [...store.values()]))).not.toContain("raw-secret");
    await expect(reportJobStore.load()).resolves.toEqual(job());
  });

  it.each([
    { version: 2 }, { reportId: "unknown" }, { credentialFingerprint: "raw-token" },
    { revision: -1 }, { completedRequests: 1.5 }, { savedBytes: -1 }, { activeMs: Infinity },
    { status: "unknown" }, { stage: "x".repeat(10000) }, { createdAt: "not-a-date" },
    { retryAt: -1 }, { periods: [] }, { periods: [{ periodRole: "current", scope: { startDate: "2026-02-30" } }] },
    { periods: [{ periodRole: "current", scope: { startDate: "2026-02-02", endDate: "2026-01-01" } }] },
    { periods: [{ periodRole: "current", scope: {} }, { periodRole: "current", scope: {} }] },
  ])("rejects invalid metadata before replacing a saved job: %j", async (invalid) => {
    installDatabase();
    const original = await reportJobStore.create(job());
    await expect(reportJobStore.create({ ...job(), ...invalid } as ReportJob)).rejects.toThrow(/invalid/i);
    await expect(reportJobStore.load()).resolves.toEqual(original);
  });

  it("rejects corrupt persisted metadata rather than treating it as an empty job", async () => {
    const database = installDatabase();
    await reportJobStore.create(job());
    database.metadata().set(JSON.stringify("latest"), { ...job(), credentialFingerprint: "secret" });
    await expect(reportJobStore.load()).rejects.toThrow(/invalid/i);
  });

  it("rejects sparse period arrays and accessor metadata instead of trusting inherited or computed fields", async () => {
    installDatabase();
    const sparsePeriods = new Array(1) as ReportJob["periods"];
    await expect(reportJobStore.create(job({ periods: sparsePeriods }))).rejects.toThrow(/invalid/i);
    let getterCalled = false;
    const computedJob = Object.defineProperty(job(), "id", { get: () => { getterCalled = true; return "computed"; } });
    await expect(reportJobStore.create(computedJob)).rejects.toThrow(/invalid/i);
    expect(getterCalled).toBe(false);
  });

  it("persists a throttle deadline and stage with a new revision and no response", async () => {
    installDatabase();
    const created = await reportJobStore.create(job());
    const saved = await reportJobStore.save({ ...created, retryAt: Date.now() + 60000, stage: "Rate limit wait" });
    expect(saved.revision).toBe(1);
    expect(saved.completedRequests).toBe(0);
    expect(saved.retryAt).toBeGreaterThan(Date.now());
    await expect(reportJobStore.load()).resolves.toEqual(saved);
  });

  it("carries a final-response backoff into a replacement job on the same connection", async () => {
    installDatabase();
    const retryAt = Date.now() + 60000;
    const created = await reportJobStore.create(job());
    const checkpoint = await reportJobStore.checkpoint({ ...created, retryAt }, key,
      { ...response, body: { items: [], has_more: false, backoff: 60 } }, 100, "v2");
    const complete = await reportJobStore.save({ ...checkpoint, status: "complete", retryAt: null });
    expect(complete.retryAt).toBe(retryAt);
    const next = await reportJobStore.create(job({ id: "report-2", credentialFingerprint: "b".repeat(64) }));
    expect(next.retryAt).toBe(retryAt);
    expect(next.completedRequests).toBe(0);
    await expect(reportJobStore.load()).resolves.toEqual(next);
  });

  it("preserves connection backoff after discard and reopening the storage module", async () => {
    const database = installDatabase();
    const retryAt = Date.now() + 60000;
    const saved = await reportJobStore.save({ ...await reportJobStore.create(job()), retryAt });
    await reportJobStore.delete(saved.id);
    await expect(reportJobStore.load()).resolves.toBeNull();
    vi.resetModules();
    const reopened = (await import("./reportJobStore")).reportJobStore;
    expect((await reopened.create(job({ id: "report-2" }))).retryAt).toBe(retryAt);
    const throttle = database.stores.get("throttles")!.get(JSON.stringify(saved.connectionKey));
    expect(throttle).toEqual({ version: 1, connectionKey: saved.connectionKey, retryAt });
  });

  it("keeps throttle deadlines isolated between connections", async () => {
    installDatabase();
    const retryAt = Date.now() + 60000;
    await reportJobStore.save({ ...await reportJobStore.create(job()), retryAt });
    const other = await reportJobStore.create(job({ id: "report-2", connectionKey: "enterprise|https://other.stackenterprise.co" }));
    expect(other.retryAt).toBeNull();
    await reportJobStore.delete(other.id);
    expect((await reportJobStore.create(job({ id: "report-3" }))).retryAt).toBe(retryAt);
  });

  it("never shortens a future deadline and stops applying it after expiry", async () => {
    const database = installDatabase();
    const now = Date.now();
    const saved = await reportJobStore.save({ ...await reportJobStore.create(job()), retryAt: now + 60000 });
    const shorter = await reportJobStore.save({ ...saved, retryAt: now + 10000 });
    expect(shorter.retryAt).toBe(now + 60000);
    const extended = await reportJobStore.save({ ...shorter, retryAt: now + 120000 });
    vi.spyOn(Date, "now").mockReturnValue(now + 120001);
    expect((await reportJobStore.load())?.retryAt).toBeNull();
    const cleared = await reportJobStore.save({ ...extended, retryAt: null });
    expect(cleared.retryAt).toBeNull();
    expect(database.stores.get("throttles")!.size).toBe(0);
    expect((await reportJobStore.create(job({ id: "report-2" }))).retryAt).toBeNull();
  });

  it("extends backoff for a duplicate response without double counting the checkpoint", async () => {
    installDatabase();
    const saved = await reportJobStore.checkpoint(await reportJobStore.create(job()), key, response, 100, "v2");
    const retryAt = Date.now() + 60000;
    const updated = await reportJobStore.checkpoint({ ...saved, retryAt }, key, response, 100, "v2");
    expect(updated).toMatchObject({ retryAt, completedRequests: 1, savedBytes: saved.savedBytes, activeMs: 100 });
    expect(updated.revision).toBe(saved.revision + 1);
    await reportJobStore.delete(updated.id);
    expect((await reportJobStore.create(job({ id: "report-2" }))).retryAt).toBe(retryAt);
  });

  it("rolls back throttle metadata, response and counters together when storage fails", async () => {
    const database = installDatabase();
    const created = await reportJobStore.create(job());
    database.failPutStore = "jobs";
    await expect(reportJobStore.checkpoint({ ...created, retryAt: Date.now() + 60000 }, key, response, 100, "v2")).rejects.toThrow(/storage/i);
    await expect(reportJobStore.load()).resolves.toEqual(created);
    await expect(reportJobStore.read(created.id, key)).resolves.toBeNull();
    expect((await reportJobStore.create(job({ id: "report-2" }))).retryAt).toBeNull();
  });

  it.each(["replace", "discard"])("preserves a version-one job deadline during upgrade and %s", async (action) => {
    const database = installDatabase();
    const retryAt = Date.now() + 60000;
    database.version = 1;
    database.stores.set("jobs", new Map([[JSON.stringify("latest"), job({ retryAt })]]));
    database.stores.set("responses", new Map());
    expect((await reportJobStore.load())?.retryAt).toBe(retryAt);
    if (action === "discard") await reportJobStore.delete("report-1");
    expect((await reportJobStore.create(job({ id: "report-2" }))).retryAt).toBe(retryAt);
  });

  it("rejects corrupt or mismatched connection throttle records before recovery", async () => {
    const database = installDatabase();
    const created = await reportJobStore.create(job());
    const throttleKey = JSON.stringify(created.connectionKey);
    database.stores.set("throttles", new Map([[throttleKey, { version: 1, connectionKey: "another-connection", retryAt: Date.now() + 60000 }]]));
    await expect(reportJobStore.load()).rejects.toThrow(/invalid/i);
    database.stores.get("throttles")!.set(throttleKey, { version: 1, connectionKey: created.connectionKey, retryAt: NaN });
    await expect(reportJobStore.load()).rejects.toThrow(/invalid/i);
  });

  it("rejects stale revisions and changed job identity without overwriting progress", async () => {
    installDatabase();
    const created = await reportJobStore.create(job());
    const current = await reportJobStore.save({ ...created, stage: "Current stage" });
    await expect(reportJobStore.save({ ...created, stage: "Stale stage" })).rejects.toThrow(/changed|conflict|revision/i);
    await expect(reportJobStore.save({ ...current, credentialFingerprint: "b".repeat(64) })).rejects.toThrow(/identity|changed|conflict/i);
    await expect(reportJobStore.load()).resolves.toEqual(current);
  });

  it("allows measured wait time to advance without permitting response counter tampering", async () => {
    installDatabase();
    const created = await reportJobStore.create(job());
    const saved = await reportJobStore.save({ ...created, activeMs: 500 });
    expect(saved.activeMs).toBe(500);
    await expect(reportJobStore.save({ ...saved, activeMs: 400 })).rejects.toThrow(/invalid/i);
    await expect(reportJobStore.save({ ...saved, savedBytes: 500 })).rejects.toThrow(/invalid/i);
    await expect(reportJobStore.load()).resolves.toEqual(saved);
  });

  it("lets only one simultaneous save advance the same revision", async () => {
    installDatabase();
    const created = await reportJobStore.create(job());
    const saves = await Promise.allSettled([
      reportJobStore.save({ ...created, stage: "Tab one" }), reportJobStore.save({ ...created, stage: "Tab two" }),
    ]);
    expect(saves.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(saves.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect((await reportJobStore.load())?.revision).toBe(1);
  });

  it("commits a response and its byte, request, duration and API timing counters together", async () => {
    installDatabase();
    const created = await reportJobStore.create(job());
    const saved = await reportJobStore.checkpoint(created, key, response, 125.5, "v2");
    expect(saved).toMatchObject({
      revision: 1, completedRequests: 1, savedBytes: 55, activeMs: 125.5,
      timings: { v2: { count: 1, milliseconds: 125.5 }, v3: { count: 0, milliseconds: 0 } },
    });
    await expect(reportJobStore.read(created.id, key)).resolves.toEqual(response);
    await expect(reportJobStore.read("another-job", key)).resolves.toBeNull();
    await expect(reportJobStore.load()).resolves.toEqual(saved);
  });

  it("does not double count identical checkpoints or replace conflicting response bodies", async () => {
    installDatabase();
    const created = await reportJobStore.create(job());
    const saved = await reportJobStore.checkpoint(created, key, response, 100, "v2");
    await expect(reportJobStore.checkpoint(saved, key, response, 200, "v2")).resolves.toEqual(saved);
    await expect(reportJobStore.checkpoint(saved, key, { ...response, body: { items: [] } }, 200, "v2")).rejects.toThrow(/conflict|different/i);
    await expect(reportJobStore.checkpoint(created, key, response, 100, "v2")).rejects.toThrow(/changed|conflict|revision/i);
    await expect(reportJobStore.read(created.id, key)).resolves.toEqual(response);
    await expect(reportJobStore.load()).resolves.toEqual(saved);
  });

  it("rolls back a successful response write when the encompassing transaction aborts", async () => {
    const database = installDatabase();
    const created = await reportJobStore.create(job());
    database.abortNextWrite = new DOMException("quota exhausted", "QuotaExceededError");
    await expect(reportJobStore.checkpoint(created, key, response, 100, "v2")).rejects.toThrow(/quota|storage/i);
    await expect(reportJobStore.load()).resolves.toEqual(created);
    await expect(reportJobStore.read(created.id, key)).resolves.toBeNull();
    expect((await reportJobStore.checkpoint(created, key, response, 100, "v2")).completedRequests).toBe(1);
  });

  it("rolls back response and metadata writes when a store request fails", async () => {
    const database = installDatabase();
    const created = await reportJobStore.create(job());
    database.failPutStore = "jobs";
    await expect(reportJobStore.checkpoint(created, key, response, 100, "v2")).rejects.toThrow(/storage/i);
    await expect(reportJobStore.load()).resolves.toEqual(created);
    await expect(reportJobStore.read(created.id, key)).resolves.toBeNull();
  });

  it("replaces a previous job and its response journal only on create", async () => {
    installDatabase();
    await reportJobStore.checkpoint(await reportJobStore.create(job()), key, response, 100, "v2");
    const replacement = await reportJobStore.create(job({ id: "report-2" }));
    await expect(reportJobStore.read("report-1", key)).resolves.toBeNull();
    await expect(reportJobStore.load()).resolves.toEqual(replacement);
    await reportJobStore.delete("report-1");
    await expect(reportJobStore.load()).resolves.toEqual(replacement);
    await reportJobStore.delete("report-2");
    await expect(reportJobStore.load()).resolves.toBeNull();
  });

  it("rolls back replacement and deletion if their transaction fails", async () => {
    const database = installDatabase();
    const saved = await reportJobStore.checkpoint(await reportJobStore.create(job()), key, response, 100, "v2");
    database.abortNextWrite = new DOMException("aborted", "AbortError");
    await expect(reportJobStore.create(job({ id: "report-2" }))).rejects.toThrow(/storage/i);
    database.abortNextWrite = new DOMException("aborted", "AbortError");
    await expect(reportJobStore.delete(saved.id)).rejects.toThrow(/storage/i);
    await expect(reportJobStore.load()).resolves.toEqual(saved);
    await expect(reportJobStore.read(saved.id, key)).resolves.toEqual(response);
  });

  it("rejects unsuccessful, non-JSON, and oversized responses without advancing metadata", async () => {
    installDatabase();
    const created = await reportJobStore.create(job());
    for (const invalid of [
      { ...response, status: 429 }, { ...response, body: undefined }, { ...response, body: { count: NaN } },
      { ...response, body: { invalid: () => 1 } }, { ...response, body: "🙂".repeat(524288) },
    ]) {
      await expect(reportJobStore.checkpoint(created, key, invalid, 100, "v2")).rejects.toThrow(/invalid|limit|2 MiB/i);
    }
    await expect(reportJobStore.load()).resolves.toEqual(created);
    await expect(reportJobStore.read(created.id, key)).resolves.toBeNull();
  });

  it("preserves valid JSON report fields even when their names resemble metadata credentials", async () => {
    installDatabase();
    const created = await reportJobStore.create(job());
    const body = JSON.parse('{"__proto__":{"title":"ordinary report content"},"accessToken":"a documented field name","nested":[null,true,0]}');
    const savedResponse = { ...response, body };
    await reportJobStore.checkpoint(created, key, savedResponse, 100, "v2");
    await expect(reportJobStore.read(created.id, key)).resolves.toEqual(savedResponse);
    expect(Object.prototype).not.toHaveProperty("title");
  });

  it("rejects a response that would exceed the job capacity without truncation", async () => {
    const database = installDatabase();
    await reportJobStore.create(job());
    const full = job({ savedBytes: 128 * 1024 * 1024 - 10, completedRequests: 64,
      timings: { v2: { count: 64, milliseconds: 0 }, v3: { count: 0, milliseconds: 0 } } });
    database.metadata().set(JSON.stringify("latest"), full);
    await expect(reportJobStore.checkpoint(full, key, response, 100, "v2")).rejects.toThrow(/128 MiB|capacity|limit/i);
    await expect(reportJobStore.load()).resolves.toEqual(full);
    await expect(reportJobStore.read(full.id, key)).resolves.toBeNull();
  });

  it("validates stored journal scope and response shape before replay", async () => {
    const database = installDatabase();
    const created = await reportJobStore.create(job());
    await reportJobStore.checkpoint(created, key, response, 100, "v2");
    const journal = database.stores.get("responses")!;
    const recordKey = JSON.stringify([created.id, key]);
    const entry = journal.get(recordKey) as Record<string, unknown>;
    journal.set(recordKey, { ...entry, jobId: "another-job" });
    await expect(reportJobStore.read(created.id, key)).rejects.toThrow(/invalid|scope/i);
    journal.set(recordKey, { ...entry, response: { ...response, status: 500 } });
    await expect(reportJobStore.read(created.id, key)).rejects.toThrow(/invalid/i);
  });

  it("rejects malformed request keys, credential parameters, API mismatches and invalid durations", async () => {
    installDatabase();
    const created = await reportJobStore.create(job());
    for (const invalidKey of ["", "x".repeat(20000), JSON.stringify(["v2", "/questions", [["access_token", "secret"]]])]) {
      await expect(reportJobStore.checkpoint(created, invalidKey, response, 100, "v2")).rejects.toThrow(/invalid/i);
    }
    await expect(reportJobStore.checkpoint(created, key, response, -1, "v2")).rejects.toThrow(/invalid/i);
    await expect(reportJobStore.checkpoint(created, key, response, 100, "v3")).rejects.toThrow(/invalid|match/i);
  });
});

// IndexedDB is unavailable in jsdom. This fake follows the existing browser storage
// tests, staging all writes until commit and serializing overlapping transactions.
function installDatabase(): FakeIndexedDB {
  const database = new FakeIndexedDB();
  vi.stubGlobal("indexedDB", database);
  return database;
}

class FakeIndexedDB {
  readonly stores = new Map<string, Map<string, unknown>>();
  abortNextWrite: DOMException | null = null;
  failPutStore: string | null = null;
  version = 0;
  private readonly transactions: FakeTransaction[] = [];

  metadata(): Map<string, unknown> { return this.stores.get("jobs")!; }

  open(_name?: string, version = 1): IDBOpenDBRequest {
    const database = {
      objectStoreNames: { contains: (name: string) => this.stores.has(name) },
      createObjectStore: (name: string) => { this.stores.set(name, new Map()); },
      close: () => undefined,
      transaction: (_stores: string | string[], mode: IDBTransactionMode) => {
        const transaction = new FakeTransaction(this, mode);
        this.transactions.push(transaction);
        if (this.transactions.length === 1) queueMicrotask(() => transaction.start());
        return transaction;
      },
    };
    const request = new FakeRequest<unknown>() as FakeRequest<unknown> & { onupgradeneeded?: () => void };
    request.result = database;
    queueMicrotask(() => {
      if (version > this.version) {
        request.onupgradeneeded?.();
        this.version = version;
      }
      request.succeed(database);
    });
    return request as unknown as IDBOpenDBRequest;
  }

  finish(transaction: FakeTransaction): void {
    expect(this.transactions.shift()).toBe(transaction);
    const next = this.transactions[0];
    if (next) queueMicrotask(() => next.start());
  }
}

class FakeTransaction {
  error: DOMException | null = null;
  oncomplete: (() => void) | null = null;
  onabort: (() => void) | null = null;
  onerror: (() => void) | null = null;
  private active = false;
  private finished = false;
  private pending = 0;
  private readonly tasks: Array<() => void> = [];
  private readonly snapshot = new Map<string, Map<string, unknown>>();

  constructor(private readonly owner: FakeIndexedDB, private readonly mode: IDBTransactionMode) {}

  start(): void {
    this.active = true;
    for (const [name, records] of this.owner.stores) this.snapshot.set(name, new Map(records));
    for (const task of this.tasks.splice(0)) queueMicrotask(task);
    this.completeIfIdle();
  }

  objectStore(name: string): IDBObjectStore {
    const records = () => this.snapshot.get(name)!;
    return {
      get: (key: IDBValidKey) => this.request(() => records().get(JSON.stringify(key))),
      put: (value: unknown, key: IDBValidKey) => this.request(() => {
        if (this.owner.failPutStore === name) {
          this.owner.failPutStore = null;
          throw new DOMException("storage failure", "QuotaExceededError");
        }
        records().set(JSON.stringify(key), structuredClone(value));
        return key;
      }),
      delete: (key: IDBValidKey) => this.request(() => { records().delete(JSON.stringify(key)); }),
      clear: () => this.request(() => records().clear()),
    } as unknown as IDBObjectStore;
  }

  abort(): void {
    if (this.finished) return;
    this.finished = true;
    queueMicrotask(() => { this.onabort?.(); this.owner.finish(this); });
  }

  private request<T>(operation: () => T): IDBRequest<T> {
    const request = new FakeRequest<T>();
    this.pending += 1;
    const task = () => {
      if (this.finished) return;
      try { request.succeed(operation()); }
      catch (error) {
        this.error = error as DOMException;
        request.error = this.error;
        request.onerror?.();
        this.abort();
      }
      this.pending -= 1;
      this.completeIfIdle();
    };
    if (this.active) queueMicrotask(task); else this.tasks.push(task);
    return request as unknown as IDBRequest<T>;
  }

  private completeIfIdle(): void {
    setTimeout(() => {
      if (this.finished || this.pending !== 0) return;
      if (this.mode === "readwrite" && this.owner.abortNextWrite) {
        this.error = this.owner.abortNextWrite;
        this.owner.abortNextWrite = null;
        this.abort();
        return;
      }
      this.finished = true;
      if (this.mode === "readwrite") {
        for (const [name, records] of this.snapshot) this.owner.stores.set(name, records);
      }
      this.oncomplete?.();
      this.owner.finish(this);
    }, 0);
  }
}

class FakeRequest<T> {
  result!: T;
  error: DOMException | null = null;
  onsuccess: (() => void) | null = null;
  onerror: (() => void) | null = null;
  succeed(value: T): void { this.result = value; this.onsuccess?.(); }
}
