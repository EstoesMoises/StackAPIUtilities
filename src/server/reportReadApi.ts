import type { FetchLike } from "../api/httpClient";
import { normalizeInstanceUrl, validateCredentialsForReport, validateEnterpriseV3OAuthCredentials } from "../credentials/credentialRules";
import { reportRegistry } from "../domain/reportRegistry";
import type { ReportId, SessionCredentials } from "../domain/types";
import type { ReportReadRequest, ReportReadResponse } from "../reports/resumable/types";

const MAX_REQUEST_BYTES = 1024 * 1024;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const READ_TIMEOUT_MS = 20_000;
const THROTTLE_HEADERS = [
  "retry-after",
  "x-burst-throttle-calls-left",
  "x-burst-throttle-seconds-until-full",
  "x-token-bucket-calls-left",
  "x-token-bucket-seconds-until-next-refill",
] as const;
const CREDENTIAL_KEYS = [
  "instanceType", "baseUrl", "apiKey", "accessToken", "pat", "authSource", "oauthClientId", "oauthScopes", "accessTokenExpiresAt",
];

interface ReportReadPayload {
  reportId: ReportId;
  credentials: SessionCredentials;
  request: ReportReadRequest;
}
interface ReportReadDependencies {
  fetchFn?: FetchLike;
  signal?: AbortSignal;
}
export type ReportReadResponseBody = { ok: true; response: ReportReadResponse } | { ok: false; error: string };

class ReadFailure extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

/** The HTTP boundary reads at most 1 MiB, including requests without Content-Length. */
export async function handleReportReadHttpRequest(request: Request): Promise<Response> {
  try {
    const text = await readBoundedText(request, MAX_REQUEST_BYTES,
      new ReadFailure(413, "Report read request exceeds the size limit."), request.signal);
    let payload: unknown;
    try { payload = JSON.parse(text); } catch { throw new ReadFailure(400, "Report read request must contain valid JSON."); }
    return handleReportReadRequest(payload, { signal: request.signal });
  } catch (error) {
    return failureResponse(error, request.signal.aborted ? 499 : 400);
  }
}

/** One upstream GET only. Pagination, retries, and throttle waits belong to the browser. */
export async function handleReportReadRequest(
  payload: unknown,
  dependencies: ReportReadDependencies = {},
): Promise<Response> {
  let url: URL;
  let headers: Headers;
  try {
    if (!isPayload(payload)) throw new ReadFailure(400, "Invalid report read request.");
    const report = reportRegistry.find((candidate) => candidate.id === payload.reportId && candidate.capabilities.includes("live-api"));
    if (!report || !validateCredentialsForReport(payload.reportId, payload.credentials).valid) {
      throw new ReadFailure(400, "Valid report credentials are required.");
    }
    const target = buildTarget(payload.credentials, payload.request);
    url = target.url;
    headers = target.headers;
  } catch {
    // Validation errors never reflect supplied paths, connection URLs, or credentials.
    return jsonResponse({ ok: false, error: "Invalid report read request or credentials." }, 400);
  }

  if (dependencies.signal?.aborted) return jsonResponse({ ok: false, error: "Report read was cancelled." }, 499);
  const controller = new AbortController();
  let rejectAbort: (reason: ReadFailure) => void = () => {};
  const aborted = new Promise<never>((_, reject) => { rejectAbort = reject; });
  const cancel = () => {
    rejectAbort(new ReadFailure(499, "Report read was cancelled."));
    controller.abort();
  };
  const timer = setTimeout(() => {
    rejectAbort(new ReadFailure(504, "Report read exceeded the 20-second deadline."));
    controller.abort();
  }, READ_TIMEOUT_MS);
  dependencies.signal?.addEventListener("abort", cancel, { once: true });

  try {
    const response = await Promise.race([
      readUpstream(url, headers, dependencies.fetchFn ?? globalThis.fetch, controller.signal),
      aborted,
    ]);
    return jsonResponse({ ok: true, response }, 200);
  } catch (error) {
    return failureResponse(error, 502);
  } finally {
    clearTimeout(timer);
    dependencies.signal?.removeEventListener("abort", cancel);
  }
}

async function readUpstream(url: URL, headers: Headers, fetchFn: FetchLike, signal: AbortSignal): Promise<ReportReadResponse> {
  const response = await fetchFn(url, { method: "GET", headers, redirect: "error", cache: "no-store", credentials: "omit", signal });
  if (signal.aborted || response.redirected || (response.status >= 300 && response.status < 400)) {
    void response.body?.cancel().catch(() => {});
    throw new ReadFailure(502, "Report read could not complete the upstream request.");
  }
  const text = await readBoundedText(response, MAX_RESPONSE_BYTES,
    new ReadFailure(502, "Upstream report response exceeds the size limit."), signal);
  let body: unknown = {};
  if (response.ok) {
    try { body = JSON.parse(text); } catch { throw new ReadFailure(502, "Upstream report response was not valid JSON."); }
  }
  // Error text can reflect authentication inputs; the client needs status and throttle headers only.
  return {
    status: response.status,
    body,
    headers: Object.fromEntries(THROTTLE_HEADERS.flatMap((name) => {
      const value = response.headers.get(name);
      return value === null || !isThrottleValue(name, value) ? [] : [[name, value]];
    })),
  };
}

async function readBoundedText(
  source: Pick<Response, "headers" | "body">,
  limit: number,
  overflow: ReadFailure,
  signal: AbortSignal,
): Promise<string> {
  const contentLength = source.headers.get("content-length");
  if (contentLength !== null && /^\d+$/.test(contentLength) && Number(contentLength) > limit) {
    void source.body?.cancel().catch(() => {});
    throw overflow;
  }
  if (!source.body) return "";
  const reader = source.body.getReader();
  const cancel = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener("abort", cancel, { once: true });
  let bytes = 0;
  const decoder = new TextDecoder();
  const parts: string[] = [];
  try {
    while (true) {
      if (signal.aborted) throw new ReadFailure(499, "Report read was cancelled.");
      const { done, value } = await reader.read();
      if (signal.aborted) throw new ReadFailure(499, "Report read was cancelled.");
      if (done) break;
      bytes += value.byteLength;
      if (bytes > limit) throw overflow;
      parts.push(decoder.decode(value, { stream: true }));
    }
    parts.push(decoder.decode());
    return parts.join("");
  } catch (error) {
    cancel();
    throw error;
  } finally {
    signal.removeEventListener("abort", cancel);
    reader.releaseLock();
  }
}

function isThrottleValue(name: string, value: string): boolean {
  if (/^\d+$/.test(value) && Number.isSafeInteger(Number(value))) return true;
  return name === "retry-after"
    && /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4} \d{2}:\d{2}:\d{2} GMT$/.test(value)
    && Number.isFinite(Date.parse(value));
}

function buildTarget(credentials: SessionCredentials, request: ReportReadRequest): { url: URL; headers: Headers } {
  const raw = credentials.baseUrl;
  if (/[?#\\\u0000-\u0020\u007f]/.test(raw)) throw new Error("Invalid connection");
  const base = new URL(raw);
  if (base.protocol !== "https:" || base.username || base.password || base.search || base.hash) throw new Error("Invalid connection");
  // URL normalization must not silently erase traversal or encoded separators in a supplied base path.
  const rawPath = raw.replace(/^https:\/\/[^/]+/i, "");
  if (rawPath.split("/").some((part) => part === "." || part === "..") || /%/.test(base.pathname)) throw new Error("Invalid connection");
  const instance = normalizeInstanceUrl(raw);
  if (instance.instanceType !== credentials.instanceType) throw new Error("Invalid instance type");
  if (credentials.instanceType === "basic-business" && !/^\/c\/[A-Za-z0-9_-]+\/?$/.test(base.pathname)) throw new Error("Invalid team");
  if (!isAllowedRequest(request)) throw new Error("Unsupported report read");

  const url = new URL(`${request.api === "v2" ? instance.apiV2Url : instance.apiV3Url}${request.path}`);
  for (const [key, value] of Object.entries(request.query)) url.searchParams.set(key, value);
  const headers = new Headers({ Accept: "application/json" });
  if (request.api === "v2") {
    if (instance.teamSlug) url.searchParams.set("team", instance.teamSlug);
    if (credentials.instanceType === "enterprise") {
      if (!credentials.apiKey?.trim()) throw new Error("Missing key");
      headers.set("X-API-Key", credentials.apiKey);
    } else {
      if (!credentials.pat?.trim()) throw new Error("Missing token");
      headers.set("X-API-Access-Token", credentials.pat);
      headers.set("Authorization", `Bearer ${credentials.pat}`);
    }
  } else {
    if (credentials.instanceType === "enterprise" && !validateEnterpriseV3OAuthCredentials(credentials).valid) throw new Error("Invalid token");
    const token = credentials.instanceType === "basic-business" ? credentials.pat : credentials.accessToken;
    if (!token?.trim()) throw new Error("Missing token");
    headers.set("Authorization", `Bearer ${token}`);
    headers.set("Content-Type", "application/json");
    headers.set("User-Agent", "StackAPIUtilities/0.1 (+https://github.com/EstoesMoises/StackAPIUtilities)");
  }
  return { url, headers };
}

function isAllowedRequest(request: ReportReadRequest): boolean {
  if (request.path.length > 4096) return false;
  let queryKeys: string[] | null = null;
  if (request.api === "v2") {
    if (/^\/(users|tags|questions|answers|comments|articles)$/.test(request.path)) {
      queryKeys = ["page", "pagesize", "fromdate", "todate"];
    } else {
      const parent = /^\/(questions|articles|answers)\/([^/]+)$/.exec(request.path);
      const reputation = /^\/users\/([^/]+)\/reputation-history$/.exec(request.path);
      const tag = /^\/tags\/([^/]+)\/top-answerers\/all_time$/.exec(request.path);
      if (parent && isIdBatch(parent[2])) queryKeys = ["page", "pagesize"];
      if (reputation && isIdBatch(reputation[1])) queryKeys = ["page", "pagesize", "fromdate", "todate"];
      if (tag && isEncodedTag(tag[1])) queryKeys = ["page", "pagesize"];
    }
  } else {
    if (/^\/(tags|communities|user-groups)$/.test(request.path)) queryKeys = ["page", "pageSize"];
    if (/^\/questions\/[1-9]\d*\/answers$/.test(request.path)) queryKeys = ["page", "pageSize", "sort", "order"];
    if (/^\/tags\/[1-9]\d*(\/subject-matter-experts)?$/.test(request.path)
      || /^\/(questions|articles)\/[1-9]\d*\/comments$/.test(request.path)
      || /^\/questions\/[1-9]\d*\/answers\/[1-9]\d*\/comments$/.test(request.path)) queryKeys = [];
  }
  return queryKeys !== null && Object.entries(request.query).every(([key, value]) => {
    if (!queryKeys.includes(key)) return false;
    if (key === "sort") return value === "creation";
    if (key === "order") return value === "asc";
    if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value))) return false;
    const number = Number(value);
    if (key === "page") return number >= 1;
    if (key === "pagesize" || key === "pageSize") return number >= 1 && number <= 100;
    return number >= 0;
  });
}

function isIdBatch(value: string): boolean {
  const ids = value.split(";");
  return ids.length <= 100 && ids.every((id) => /^-?\d+$/.test(id) && Number.isSafeInteger(Number(id)));
}

function isEncodedTag(value: string): boolean {
  try {
    const decoded = decodeURIComponent(value);
    return decoded.length > 0 && decoded.length <= 200 && decoded !== "." && decoded !== ".."
      && !/[\\/%;\u0000-\u001f\u007f]/.test(decoded) && encodeURIComponent(decoded) === value;
  } catch { return false; }
}

function isPayload(value: unknown): value is ReportReadPayload {
  if (!isRecord(value) || !onlyKeys(value, ["reportId", "credentials", "request"]) || typeof value.reportId !== "string") return false;
  const credentials = value.credentials;
  const request = value.request;
  return isRecord(credentials) && onlyKeys(credentials, CREDENTIAL_KEYS)
    && (credentials.instanceType === "enterprise" || credentials.instanceType === "basic-business")
    && typeof credentials.baseUrl === "string"
    && ["apiKey", "accessToken", "pat", "oauthClientId", "accessTokenExpiresAt"].every((key) => credentials[key] === undefined || typeof credentials[key] === "string")
    && (credentials.authSource === undefined || ["manual-pat", "manual-enterprise-token", "oauth-pkce"].includes(String(credentials.authSource)))
    && (credentials.oauthScopes === undefined || (Array.isArray(credentials.oauthScopes) && credentials.oauthScopes.every((scope) => typeof scope === "string")))
    && isRecord(request) && onlyKeys(request, ["api", "path", "query"])
    && (request.api === "v2" || request.api === "v3") && typeof request.path === "string"
    && isRecord(request.query) && Object.values(request.query).every((entry) => typeof entry === "string");
}

function onlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key));
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function failureResponse(error: unknown, fallbackStatus: number): Response {
  return jsonResponse({ ok: false, error: error instanceof ReadFailure ? error.message
    : fallbackStatus === 499 ? "Report read was cancelled." : "Report read could not complete." },
  error instanceof ReadFailure ? error.status : fallbackStatus);
}
function jsonResponse(body: ReportReadResponseBody, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
}
