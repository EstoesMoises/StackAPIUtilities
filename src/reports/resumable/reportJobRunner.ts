import type { FetchLike } from "../../api/httpClient";
import { validateStackApiV2Page } from "../../api/stackApiV2";
import { validateStackApiV3Page } from "../../api/stackApiV3";
import { createLiveCollectorClients } from "../../collectors/liveCollectorClients";
import { validateTagReportRead } from "../../collectors/tagReportEnrichment";
import { dateToUnixSeconds } from "../../domain/reportScope";
import { consumeEstimatedRead, estimateReportTime, estimateTagWork, type RemainingReportWork, type TagReportInventory } from "./reportEstimate";
import { runLiveReport, type LiveReportRunResult } from "../../collectors/liveReportRunner";
import { normalizeInstanceUrl, validateCredentialsForReport } from "../../credentials/credentialRules";
import { reportRegistry } from "../../domain/reportRegistry";
import { validateReportRunScope } from "../../domain/reportScope";
import type { ReportId, SessionCredentials } from "../../domain/types";
import type { ReportJob, ReportJobProgress, ReportJobStore, ReportReadRequest, ReportReadResponse } from "./types";

export async function createReportJob(reportId: ReportId, credentials: SessionCredentials, periods: ReportJob["periods"]): Promise<ReportJob> {
  assertCredentials(reportId, credentials);
  if (!periods.length || periods.length > 2 || new Set(periods.map((period) => period.periodRole)).size !== periods.length) throw Error("Choose one or two distinct report periods.");
  for (const period of periods) {
    const validation = validateReportRunScope({ current: period.scope });
    if (!validation.valid) throw Error(validation.messages.join(" "));
  }
  const now = new Date().toISOString();
  return {
    version: 1, id: crypto.randomUUID(), revision: 0, reportId,
    reportTitle: reportRegistry.find((report) => report.id === reportId)!.title,
    connectionKey: connectionKey(credentials), credentialFingerprint: await fingerprint(credentials),
    periods: periods.map((period) => ({ periodRole: period.periodRole, scope: { ...period.scope } })),
    status: "paused", createdAt: now, updatedAt: now, completedRequests: 0, savedBytes: 0, activeMs: 0,
    timings: { v2: { count: 0, milliseconds: 0 }, v3: { count: 0, milliseconds: 0 } },
    retryAt: null, stage: "Ready to collect", error: null,
  };
}

export interface ReportJobRunnerOptions {
  store: ReportJobStore;
  fetchFn?: FetchLike;
  signal: AbortSignal;
  onProgress?: (progress: ReportJobProgress) => void;
}

export async function runReportJob(initial: ReportJob, credentials: SessionCredentials, options: ReportJobRunnerOptions): Promise<{ job: ReportJob; results: LiveReportRunResult[] }> {
  assertCredentials(initial.reportId, credentials);
  if (initial.connectionKey !== connectionKey(credentials) || initial.credentialFingerprint !== await fingerprint(credentials)) {
    throw Error("Reconnect with the same credentials and instance used for this report, or discard it and start a new run.");
  }
  const { signal, store } = options;
  const fetchFn = options.fetchFn ?? globalThis.fetch.bind(globalThis);
  const instance = normalizeInstanceUrl(credentials.baseUrl);
  let job = initial;
  let restoring = initial.completedRequests > 0;
  let tail: Promise<unknown> = Promise.resolve();
  let stopped: unknown;
  let pendingWaitMs = 0;
  const workloads: RemainingReportWork[] = [];
  let collectingPeriod = -1;
  const consumed = new Set<string>();
  const totalPagesByCollection = new Map<string, number | null>();
  const validateRead = (request: ReportReadRequest, response: ReportReadResponse) => {
    const page = Number(request.query.page);
    if (request.api === "v2") {
      validateStackApiV2Page(response.body, request.path, page);
    } else {
      if (request.query.page !== undefined) {
        const collectionKey = JSON.stringify([request.path, Object.entries(request.query).filter(([key]) => key !== "page").sort(([a], [b]) => a.localeCompare(b))]);
        const known = page === 1 ? null : totalPagesByCollection.get(collectionKey) ?? null;
        const validated = validateStackApiV3Page(response.body, request.path, page, known);
        totalPagesByCollection.set(collectionKey, validated.totalPages);
      }
      if (job.reportId === "tag-report") validateTagReportRead(request.path, response.body);
    }
  };
  const overallEstimate = () => {
    if (restoring || workloads.length !== job.periods.length) return null;
    const remaining = workloads.slice(Math.max(0, collectingPeriod)).filter((work) => work.unknown || work.v2.maximum + work.v3.maximum > 0);
    if (!remaining.length) return null;
    const estimates = remaining.map((work) => estimateReportTime(work, job.timings));
    if (estimates.some((estimate) => estimate === null)) return null;
    return { minimumSeconds: estimates.reduce((sum, estimate) => sum + estimate!.minimumSeconds, 0),
      maximumSeconds: estimates.reduce((sum, estimate) => sum + estimate!.maximumSeconds, 0) };
  };
  const emit = () => options.onProgress?.({ job, estimate: overallEstimate(), restoring });
  const consume = (key: string, request: ReportReadRequest, response: ReportReadResponse) => {
    const scopedKey = `${collectingPeriod}:${key}`;
    if (collectingPeriod < 0 || !workloads[collectingPeriod] || consumed.has(scopedKey)) return;
    if ((response.status < 200 || response.status >= 300) && !(request.path === "/communities" && [403, 404].includes(response.status))) return;
    consumed.add(scopedKey);
    workloads[collectingPeriod] = consumeEstimatedRead(workloads[collectingPeriod], request, response);
  };
  const assertActive = () => {
    signal.throwIfAborted();
    if (stopped) throw stopped;
  };
  const save = async () => { job = await store.save({ ...job, updatedAt: new Date().toISOString() }); emit(); };

  const waitForDeadline = async () => {
    while (job.retryAt !== null && job.retryAt > Date.now()) {
      assertActive();
      emit();
      const duration = Math.min(30_000, job.retryAt - Date.now());
      const started = Date.now();
      try { await abortableDelay(duration, signal); }
      finally { pendingWaitMs += Math.max(0, Math.min(duration, Date.now() - started)); }
    }
    if (job.retryAt !== null) { job = { ...job, retryAt: null }; await save(); }
  };

  async function read(input: RequestInfo | URL): Promise<Response> {
    assertActive();
    const url = new URL(input.toString());
    const api = url.href.startsWith(`${instance.apiV2Url}/`) ? "v2" : "v3";
    const prefix = api === "v2" ? instance.apiV2Url : instance.apiV3Url;
    if (!url.href.startsWith(`${prefix}/`)) throw Error("Unexpected report API destination.");
    const query = Object.fromEntries(url.searchParams);
    delete query.team;
    const request: ReportReadRequest = { api, path: url.pathname.slice(new URL(prefix).pathname.length), query };
    const key = JSON.stringify([api, request.path, Object.entries(query).sort(([a], [b]) => a.localeCompare(b))]);
    const cached = await store.read(job.id, key);
    assertActive();
    if (cached) { validateRead(request, cached); consume(key, request, cached); return toResponse(cached, true); }
    restoring = false;
    await waitForDeadline();
    assertActive();
    const started = Date.now();
    const response = await fetchFn("/api/reports/read", {
      method: "POST", headers: { "Content-Type": "application/json" }, signal,
      body: JSON.stringify({ reportId: job.reportId, credentials, request }),
    });
    assertActive();
    let body: unknown;
    try { body = await response.json(); } catch { throw Error("The report service returned an invalid response. Your saved progress is available to retry."); }
    if (!response.ok || !isRecord(body) || body.ok !== true || !isReadResponse(body.response)) {
      throw Error(isRecord(body) && typeof body.error === "string" ? body.error : "The report request failed. Your saved progress is available to retry.");
    }
    const result = body.response;
    const delay = responseBackoff(result);
    if (delay > 0) job = { ...job, retryAt: Math.max(job.retryAt ?? 0, Date.now() + delay * 1_000) };
    if (result.status >= 200 && result.status < 300) {
      validateRead(request, result);
      job = await store.checkpoint(job, key, result, Math.max(0, Date.now() - started) + pendingWaitMs, api);
      pendingWaitMs = 0;
      consume(key, request, result);
      emit();
    } else {
      consume(key, request, result);
      if (delay > 0) await save();
    }
    assertActive();
    return toResponse(result, false);
  }

  const transport: FetchLike = (input) => {
    const pending = tail.then(() => read(input));
    tail = pending.catch((error: unknown) => { stopped = error; });
    return pending;
  };
  const waitFn = async (seconds: number) => {
    assertActive();
    if (job.retryAt === null) { job = { ...job, retryAt: Date.now() + seconds * 1_000 }; await save(); }
    await waitForDeadline();
  };

  try {
    assertActive();
    job = { ...job, status: "running", error: null };
    await save();
    const results: LiveReportRunResult[] = [];
    if (job.reportId === "tag-report") {
      const clients = createLiveCollectorClients(credentials, { fetchFn: transport, waitFn });
      for (const period of job.periods) {
        const inventory = {} as TagReportInventory;
        const query: Record<string, string> = { pagesize: "100" };
        if (period.scope.startDate) query.fromdate = String(dateToUnixSeconds(period.scope.startDate));
        if (period.scope.endDate) query.todate = String(dateToUnixSeconds(period.scope.endDate));
        for (const name of ["tags", "users", "questions", "articles", "answers", "comments"] as const) {
          job = { ...job, stage: `Discovering ${name} · ${period.periodRole} period` }; emit();
          const result = await clients.v2.getPagedResult(`/${name}`, query);
          inventory[name] = result.items.filter(isRecord);
        }
        job = { ...job, stage: `Discovering tag coverage · ${period.periodRole} period` }; emit();
        inventory.tagSmeCounts = (await clients.v3.getPagedResult("/tags", { pageSize: "100" })).items.filter(isRecord);
        if (inventory.tagSmeCounts.length > 0) {
          job = { ...job, stage: "Discovering historical tag usage" }; emit();
          await clients.v2.getPagedResult("/questions", { pagesize: "100" });
          await clients.v2.getPagedResult("/articles", { pagesize: "100" });
        }
        workloads.push(estimateTagWork(inventory, credentials.instanceType));
      }
    }
    for (const [index, period] of job.periods.entries()) {
      collectingPeriod = index;
      results.push(await runLiveReport(job.reportId, credentials, {
        ...period, fetchFn: transport, waitFn,
        onDataset: (dataset) => { assertActive(); job = { ...job, stage: `Collecting ${dataset} · ${period.periodRole} period` }; emit(); },
      }));
      assertActive();
    }
    job = { ...job, status: "complete", stage: "Report collection complete" };
    await save();
    assertActive();
    return { job, results };
  } catch (error) {
    stopped = error;
    await tail;
    job = { ...job, status: signal.aborted ? "paused" : "failed", error: signal.aborted ? null : (error instanceof Error ? error.message : "Report collection failed.") };
    try { await save(); } catch { emit(); }
    throw error;
  }
}

export function abortableDelay(milliseconds: number, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const abort = () => { clearTimeout(timer); reject(signal.reason ?? new DOMException("Paused", "AbortError")); };
    const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, milliseconds);
    signal.addEventListener("abort", abort, { once: true });
  });
}
function assertCredentials(reportId: ReportId, credentials: SessionCredentials): void {
  const validation = validateCredentialsForReport(reportId, credentials);
  if (!validation.valid) throw Error(validation.messages.join(" "));
}
function connectionKey(credentials: SessionCredentials): string {
  return `${credentials.instanceType}|${normalizeInstanceUrl(credentials.baseUrl).baseUrl}`;
}
async function fingerprint(credentials: SessionCredentials): Promise<string> {
  const data = JSON.stringify([connectionKey(credentials), credentials.apiKey ?? "", credentials.accessToken ?? "", credentials.pat ?? ""]);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(data));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
function toResponse(response: ReportReadResponse, cached: boolean): Response {
  const body = cached && isRecord(response.body) ? { ...response.body, backoff: undefined } : response.body;
  return new Response(JSON.stringify(body), { status: response.status, headers: cached ? {} : response.headers });
}
function isRecord(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === "object" && !Array.isArray(value); }
function isReadResponse(value: unknown): value is ReportReadResponse {
  return isRecord(value) && Number.isInteger(value.status) && Number(value.status) >= 200 && Number(value.status) <= 599 && "body" in value
    && isRecord(value.headers) && Object.values(value.headers).every((header) => typeof header === "string");
}
function responseBackoff(response: ReportReadResponse): number {
  const bodyBackoff = isRecord(response.body) && typeof response.body.backoff === "number" ? response.body.backoff : 0;
  const headers = new Headers(response.headers);
  const retry = headers.get("retry-after");
  const retrySeconds = retry === null ? 0 : /^\d+$/.test(retry) ? Number(retry) : Math.max(0, (Date.parse(retry) - Date.now()) / 1_000);
  const headerWait = response.status === 429 || response.status >= 500 ? Math.max(retrySeconds || 0,
    Number(headers.get("x-burst-throttle-seconds-until-full")) || 0,
    Number(headers.get("x-token-bucket-seconds-until-next-refill")) || 0) : 0;
  return Math.max(0, Number.isFinite(bodyBackoff) ? bodyBackoff : 0, headerWait);
}
