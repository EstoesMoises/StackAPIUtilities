import type { PeriodScope, ReportId } from "../../domain/types";
import type { ReportJob, ReportJobStore, ReportReadResponse } from "./types";

const DATABASE_NAME = "stack-api-utilities-report-jobs";
const JOB_STORE = "jobs";
const RESPONSE_STORE = "responses";
const THROTTLE_STORE = "throttles";
const LATEST = "latest";
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_JOB_BYTES = 128 * 1024 * 1024;
const MAX_KEY_BYTES = 16 * 1024;
const REPORT_IDS = new Set<ReportId>([
  "tag-report", "api-user-report", "inactive-users", "interactions", "community-members",
  "data-export", "webhook-report", "search-log-report", "api-import", "user-groups",
  "scim-user-activation", "scim-user-deactivation", "scim-user-deletion",
]);
const QUERY_FIELDS = new Set([
  "page", "pagesize", "pageSize", "filter", "sort", "order", "fromdate", "todate",
  "fromDate", "toDate", "min", "max", "inname", "tagged", "userIds", "include",
]);

interface JournalEntry {
  version: 1;
  jobId: string;
  key: string;
  bytes: number;
  response: ReportReadResponse;
}

export const reportJobStore: ReportJobStore = {
  async load() {
    return transact("readonly", async (jobs, _responses, throttles) => {
      const value = await readRequest(jobs.get(LATEST));
      return value === undefined ? null : withConnectionThrottle(parseReportJob(value), throttles, false);
    });
  },

  async create(input) {
    const job = parseReportJob(input);
    if (job.revision !== 0 || job.completedRequests !== 0 || job.savedBytes !== 0 ||
      job.timings.v2.count !== 0 || job.timings.v3.count !== 0 || job.activeMs !== 0) {
      throw invalid("new job counters");
    }
    return transact("readwrite", async (jobs, responses, throttles) => {
      const previous = await readRequest(jobs.get(LATEST));
      // Older databases kept the deadline only on the latest job. Preserve that
      // deadline before replacing the job, including when its connection changes.
      if (previous !== undefined) await withConnectionThrottle(parseReportJob(previous), throttles, true);
      const created = await withConnectionThrottle(job, throttles, true);
      await readRequest(responses.clear());
      await readRequest(jobs.put(created, LATEST));
      return created;
    });
  },

  async save(input) {
    const job = parseReportJob(input);
    return transact("readwrite", async (jobs, _responses, throttles) => {
      const current = await currentJob(jobs, job);
      const saved = await withConnectionThrottle(nextRevision(job, current), throttles, true, current.retryAt);
      await readRequest(jobs.put(saved, LATEST));
      return saved;
    });
  },

  async read(jobId, key) {
    validateId(jobId);
    validateKey(key);
    return transact("readonly", async (jobs, responses) => {
      const value = await readRequest(jobs.get(LATEST));
      if (value === undefined || parseReportJob(value).id !== jobId) return null;
      const entry = await readRequest(responses.get([jobId, key]));
      return entry === undefined ? null : parseEntry(entry, jobId, key).response;
    });
  },

  async checkpoint(input, key, inputResponse, elapsedMs, api) {
    const job = parseReportJob(input);
    if (validateKey(key) !== api || !nonnegative(elapsedMs)) throw invalid("checkpoint timing or API");
    const response = parseResponse(inputResponse);
    const bytes = byteLength(response);
    return transact("readwrite", async (jobs, responses, throttles) => {
      const current = await currentJob(jobs, job);
      const previous = await readRequest(responses.get([job.id, key]));
      if (previous !== undefined) {
        const entry = parseEntry(previous, job.id, key);
        if (canonicalJson(entry.response) !== canonicalJson(response)) {
          throw new Error("Report checkpoint conflicts with a different saved response.");
        }
        const recovered = await withConnectionThrottle(current, throttles, true, job.retryAt);
        if (recovered.retryAt === current.retryAt) return current;
        const saved = nextRevision(recovered, current);
        await readRequest(jobs.put(saved, LATEST));
        return saved;
      }
      if (current.savedBytes + bytes > MAX_JOB_BYTES) {
        throw new Error("Report checkpoint storage has reached its 128 MiB capacity limit.");
      }
      const saved = await withConnectionThrottle(parseReportJob({
        ...nextRevision(job, current),
        completedRequests: current.completedRequests + 1,
        savedBytes: current.savedBytes + bytes,
        activeMs: job.activeMs + elapsedMs,
        timings: {
          ...current.timings,
          [api]: { count: current.timings[api].count + 1, milliseconds: current.timings[api].milliseconds + elapsedMs },
        },
      }), throttles, true, current.retryAt);
      const entry: JournalEntry = { version: 1, jobId: job.id, key, bytes, response };
      await readRequest(responses.put(entry, [job.id, key]));
      await readRequest(jobs.put(saved, LATEST));
      return saved;
    });
  },

  async delete(jobId) {
    validateId(jobId);
    return transact("readwrite", async (jobs, responses, throttles) => {
      const value = await readRequest(jobs.get(LATEST));
      if (value === undefined) return;
      const current = parseReportJob(value);
      if (current.id !== jobId) return;
      await withConnectionThrottle(current, throttles, true);
      await readRequest(responses.clear());
      await readRequest(jobs.delete(LATEST));
    });
  },
};

async function withConnectionThrottle(
  job: ReportJob,
  throttles: IDBObjectStore,
  persist: boolean,
  previousDeadline: number | null = null,
): Promise<ReportJob> {
  const value = await readRequest(throttles.get(job.connectionKey));
  let storedDeadline: number | null = null;
  if (value !== undefined) {
    const record = object(value, "connection throttle");
    const retryAt = own(record, "retryAt");
    if (own(record, "version") !== 1 || own(record, "connectionKey") !== job.connectionKey ||
      !nonnegative(retryAt)) throw invalid("connection throttle");
    storedDeadline = retryAt;
  }
  const latestDeadline = Math.max(job.retryAt ?? 0, previousDeadline ?? 0, storedDeadline ?? 0);
  const retryAt = latestDeadline > Date.now() ? latestDeadline : null;
  if (persist) {
    if (retryAt !== null && retryAt !== storedDeadline) {
      // Connection identity contains no token or credential fingerprint. Keeping
      // this independent of the job prevents discard/restart from bypassing waits.
      await readRequest(throttles.put({ version: 1, connectionKey: job.connectionKey, retryAt }, job.connectionKey));
    } else if (retryAt === null && value !== undefined) {
      await readRequest(throttles.delete(job.connectionKey));
    }
  }
  return { ...job, retryAt };
}

/** Reconstruct only own, permitted metadata fields; never copy credentials or extras. */
export function parseReportJob(value: unknown): ReportJob {
  const record = object(value, "job metadata");
  const version = own(record, "version");
  const id = own(record, "id");
  const revision = own(record, "revision");
  const reportId = own(record, "reportId");
  const reportTitle = own(record, "reportTitle");
  const connectionKey = own(record, "connectionKey");
  const credentialFingerprint = own(record, "credentialFingerprint");
  const rawPeriods = own(record, "periods");
  const status = own(record, "status");
  const createdAt = own(record, "createdAt");
  const updatedAt = own(record, "updatedAt");
  const completedRequests = own(record, "completedRequests");
  const savedBytes = own(record, "savedBytes");
  const activeMs = own(record, "activeMs");
  const rawTimings = object(own(record, "timings"), "job timings");
  const retryAt = own(record, "retryAt");
  const stage = own(record, "stage");
  const error = own(record, "error");

  if (version !== 1 || !integer(revision) || !integer(completedRequests) || !integer(savedBytes) ||
    savedBytes > MAX_JOB_BYTES || !nonnegative(activeMs) ||
    typeof reportId !== "string" || !REPORT_IDS.has(reportId as ReportId) ||
    !boundedString(reportTitle, 256) || !boundedString(connectionKey, 4096) ||
    typeof credentialFingerprint !== "string" || !/^[a-f0-9]{64}$/i.test(credentialFingerprint) ||
    !Array.isArray(rawPeriods) || rawPeriods.length < 1 || rawPeriods.length > 2 ||
    !["paused", "running", "failed", "complete"].includes(status as string) ||
    !timestamp(createdAt) || !timestamp(updatedAt) ||
    (retryAt !== null && !nonnegative(retryAt)) || !boundedString(stage, 256, true) ||
    (error !== null && !boundedString(error, 2048, true))) throw invalid("job metadata");
  validateId(id);
  validateConnection(connectionKey);
  const periods = Array.from({ length: rawPeriods.length }, (_, index): ReportJob["periods"][number] => {
    const entry = object(own(rawPeriods as unknown as Record<string, unknown>, String(index)), "job period");
    const periodRole = own(entry, "periodRole");
    if ((periodRole !== "current" && periodRole !== "comparison") ||
      (rawPeriods.length === 2 && periodRole !== (index === 0 ? "current" : "comparison"))) throw invalid("job period role");
    const scopeRecord = object(own(entry, "scope"), "job period scope");
    const startDate = own(scopeRecord, "startDate");
    const endDate = own(scopeRecord, "endDate");
    if ((startDate !== undefined && !date(startDate)) || (endDate !== undefined && !date(endDate)) ||
      (typeof startDate === "string" && typeof endDate === "string" && startDate > endDate)) throw invalid("job period scope");
    const scope: PeriodScope = {};
    if (typeof startDate === "string") scope.startDate = startDate;
    if (typeof endDate === "string") scope.endDate = endDate;
    return { periodRole, scope };
  });
  const timings = { v2: parseTiming(own(rawTimings, "v2")), v3: parseTiming(own(rawTimings, "v3")) };
  if (timings.v2.count + timings.v3.count !== completedRequests ||
    timings.v2.milliseconds + timings.v3.milliseconds > activeMs + 0.001) throw invalid("job counters");
  return {
    version, id, revision, reportId: reportId as ReportId, reportTitle, connectionKey, credentialFingerprint,
    periods, status: status as ReportJob["status"], createdAt, updatedAt, completedRequests, savedBytes, activeMs,
    timings, retryAt: retryAt as number | null, stage, error: error as string | null,
  };
}

function parseTiming(value: unknown): { count: number; milliseconds: number } {
  const record = object(value, "job timing");
  const count = own(record, "count");
  const milliseconds = own(record, "milliseconds");
  if (!integer(count) || !nonnegative(milliseconds)) throw invalid("job timing");
  return { count, milliseconds };
}

async function currentJob(jobs: IDBObjectStore, requested: ReportJob): Promise<ReportJob> {
  const value = await readRequest(jobs.get(LATEST));
  if (value === undefined) throw new Error("The saved report job has changed or was deleted.");
  const current = parseReportJob(value);
  if (current.id !== requested.id || current.revision !== requested.revision) {
    throw new Error("The saved report job changed in another tab (revision conflict). Reload it before continuing.");
  }
  if (current.reportId !== requested.reportId || current.connectionKey !== requested.connectionKey ||
    current.credentialFingerprint !== requested.credentialFingerprint || current.createdAt !== requested.createdAt ||
    JSON.stringify(current.periods) !== JSON.stringify(requested.periods)) {
    throw new Error("Report job identity cannot be changed. Start a new report job.");
  }
  if (current.completedRequests !== requested.completedRequests || current.savedBytes !== requested.savedBytes ||
    JSON.stringify(current.timings) !== JSON.stringify(requested.timings) || requested.activeMs < current.activeMs) {
    throw invalid("job counters changed outside a checkpoint");
  }
  return current;
}

function nextRevision(job: ReportJob, current: ReportJob): ReportJob {
  return parseReportJob({ ...job, revision: current.revision + 1, updatedAt: new Date().toISOString() });
}

function parseEntry(value: unknown, jobId: string, key: string): JournalEntry {
  const entry = object(value, "saved response");
  const response = parseResponse(own(entry, "response"));
  const bytes = byteLength(response);
  if (own(entry, "version") !== 1 || own(entry, "jobId") !== jobId || own(entry, "key") !== key ||
    own(entry, "bytes") !== bytes) throw invalid("saved response scope or size");
  return { version: 1, jobId, key, bytes, response };
}

function parseResponse(value: unknown): ReportReadResponse {
  const record = object(value, "response");
  const status = own(record, "status");
  if (typeof status !== "number" || !Number.isInteger(status) || status < 200 || status >= 300) throw invalid("response status");
  const rawHeaders = object(own(record, "headers"), "response headers");
  if (Object.keys(rawHeaders).length > 64) throw invalid("response headers");
  const headers: Record<string, string> = {};
  for (const key of Object.keys(rawHeaders)) {
    const value = own(rawHeaders, key);
    if (!/^[a-zA-Z0-9-]{1,128}$/.test(key) || !boundedString(value, 8192, true)) throw invalid("response headers");
    Object.defineProperty(headers, key, { value, enumerable: true, writable: true, configurable: true });
  }
  const body = cloneJson(own(record, "body"));
  const response: ReportReadResponse = { status, body, headers };
  if (byteLength(response) > MAX_RESPONSE_BYTES) throw new Error("Report response exceeds the 2 MiB storage limit.");
  return response;
}

function validateKey(key: unknown): "v2" | "v3" {
  if (!boundedString(key, MAX_KEY_BYTES) || new TextEncoder().encode(key).byteLength > MAX_KEY_BYTES) throw invalid("request key");
  let parts: unknown;
  try { parts = JSON.parse(key); } catch { throw invalid("request key"); }
  if (!Array.isArray(parts) || parts.length !== 3) throw invalid("request key");
  const [api, path, query] = parts;
  if ((api !== "v2" && api !== "v3") || typeof path !== "string" || path.length > 4096 ||
    !/^\/[A-Za-z0-9_/%;.,~!$&'()*+@=-]+$/.test(path) || path.includes("//") || path.includes("..") ||
    !Array.isArray(query) || query.length > 32) throw invalid("request key");
  let previous = "";
  for (const pair of query) {
    if (!Array.isArray(pair) || pair.length !== 2 || typeof pair[0] !== "string" ||
      !QUERY_FIELDS.has(pair[0]) || pair[0] <= previous || !boundedString(pair[1], 4096, true)) throw invalid("request key query");
    previous = pair[0];
  }
  if (JSON.stringify(parts) !== key) throw invalid("canonical request key");
  return api;
}

function validateConnection(key: string): void {
  const delimiter = key.indexOf("|");
  if (!["enterprise", "basic-business"].includes(key.slice(0, delimiter))) throw invalid("connection key");
  let url: URL;
  try { url = new URL(key.slice(delimiter + 1)); } catch { throw invalid("connection key"); }
  if (!/https?:/.test(url.protocol) || url.username || url.password || url.search || url.hash) throw invalid("connection key");
}

function validateId(value: unknown): asserts value is string {
  if (!boundedString(value, 128)) throw invalid("job id");
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw invalid(label);
  return value as Record<string, unknown>;
}

function own(record: Record<string, unknown>, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(record, key);
  if (descriptor && !("value" in descriptor)) throw invalid("accessor field");
  return descriptor?.value;
}

function boundedString(value: unknown, maximum: number, empty = false): value is string {
  return typeof value === "string" && (empty || value.trim().length > 0) && value.length <= maximum && !/[\u0000-\u001f\u007f]/.test(value);
}

function nonnegative(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER;
}

function integer(value: unknown): value is number { return nonnegative(value) && Number.isSafeInteger(value); }

function timestamp(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) &&
    Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
}

function date(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d\d-\d\d$/.test(value) &&
    Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}

function cloneJson(value: unknown, ancestors = new Set<object>(), depth = 0): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "object" || !value || depth > 1000 || ancestors.has(value)) throw invalid("JSON response body");
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      return Array.from({ length: value.length }, (_, index) => cloneJson(own(value as unknown as Record<string, unknown>, String(index)), ancestors, depth + 1));
    }
    const record = object(value, "JSON response body");
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(record)) {
      Object.defineProperty(result, key, {
        value: cloneJson(own(record, key), ancestors, depth + 1), enumerable: true, writable: true, configurable: true,
      });
    }
    return result;
  } finally { ancestors.delete(value); }
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function byteLength(value: unknown): number { return new TextEncoder().encode(JSON.stringify(value)).byteLength; }

function invalid(label: string): Error { return new Error(`Report checkpoint ${label} is invalid.`); }

function storageFailure(error?: DOMException | null): Error {
  return new Error(error?.name === "QuotaExceededError"
    ? "Report checkpoint storage quota is exhausted. Free browser storage before continuing."
    : "Report checkpoint storage failed; the checkpoint was not committed.");
}

async function transact<T>(mode: IDBTransactionMode, action: (jobs: IDBObjectStore, responses: IDBObjectStore, throttles: IDBObjectStore) => Promise<T>): Promise<T> {
  const database = await openDatabase();
  let transaction: IDBTransaction;
  try { transaction = database.transaction([JOB_STORE, RESPONSE_STORE, THROTTLE_STORE], mode); }
  catch { database.close(); throw storageFailure(); }
  // Resolve errors as values immediately so aborts cannot become unhandled rejections
  // while an individual request is still settling.
  const completion = new Promise<Error | null>((resolve) => {
    transaction.oncomplete = () => resolve(null);
    transaction.onabort = () => resolve(storageFailure(transaction.error));
    transaction.onerror = () => resolve(storageFailure(transaction.error));
  });
  try {
    const result = await action(transaction.objectStore(JOB_STORE), transaction.objectStore(RESPONSE_STORE), transaction.objectStore(THROTTLE_STORE));
    const error = await completion;
    if (error) throw error;
    return result;
  } catch (error) {
    try { transaction.abort(); } catch { /* Already completed or aborted. */ }
    await completion;
    throw error;
  } finally { database.close(); }
}

function readRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(storageFailure(request.error));
  });
}

async function openDatabase(): Promise<IDBDatabase> {
  if (typeof globalThis.indexedDB === "undefined") throw new Error("Report checkpoint storage is unavailable in this browser.");
  let request: IDBOpenDBRequest;
  try { request = indexedDB.open(DATABASE_NAME, 2); }
  catch { throw new Error("Report checkpoint storage could not be opened."); }
  return new Promise((resolve, reject) => {
    let settled = false;
    request.onupgradeneeded = () => {
      try {
        for (const name of [JOB_STORE, RESPONSE_STORE, THROTTLE_STORE]) {
          if (!request.result.objectStoreNames.contains(name)) request.result.createObjectStore(name);
        }
      } catch {
        try { request.transaction?.abort(); } catch { /* Preserve the original open failure. */ }
        settled = true;
        reject(new Error("Report checkpoint storage could not be initialized."));
      }
    };
    request.onsuccess = () => {
      if (settled) { request.result.close(); return; }
      settled = true;
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
    request.onerror = () => {
      settled = true;
      reject(storageFailure(request.error));
    };
    request.onblocked = () => {
      settled = true;
      reject(new Error("Report checkpoint storage upgrade is blocked by another tab."));
    };
  });
}
