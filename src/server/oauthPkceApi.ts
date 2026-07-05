import { Buffer } from "node:buffer";
import {
  buildEnterpriseAuthorizationUrl,
  buildEnterpriseTokenEndpointUrl,
  createCodeChallenge,
  createCodeVerifier,
  createOAuthState,
  isSupportedEnterpriseOAuthTarget,
  normalizeOAuthBaseUrl,
  normalizeOAuthScopes,
  OAUTH_SCOPE_NO_EXPIRY,
  OAUTH_SCOPE_WRITE_ACCESS,
} from "../auth/oauthPkce";
import type { SessionCredentials } from "../domain/types";

export const OAUTH_PKCE_COOKIE_NAME = "stack_api_oauth_pkce";
export const OAUTH_PKCE_COOKIE_PATH = "/api/oauth/pkce";
export const OAUTH_PKCE_COOKIE_MAX_AGE_SECONDS = 600;

const OAUTH_PKCE_CALLBACK_PATH = "/api/oauth/pkce/callback";
const OAUTH_TOKEN_EXCHANGE_TIMEOUT_MS = 15_000;
const OAUTH_RESULT_MESSAGE_TYPE = "stack-api-oauth-pkce-result";
const START_REQUEST_ERROR =
  "Enterprise OAuth requires a Stack Enterprise HTTPS instance URL and OAuth client ID.";
const TOKEN_EXCHANGE_NETWORK_ERROR =
  "OAuth token exchange failed. Check the Enterprise instance and try again.";
const SUPPORTED_REQUESTED_SCOPES = new Set<string>([OAUTH_SCOPE_WRITE_ACCESS]);
const SENSITIVE_OAUTH_KEY_FRAGMENT_PATTERN =
  /token|code|verifier|client[_-]?secret|api[_-]?key|authorization|password|credential/i;
const SENSITIVE_OAUTH_TEXT_KEY_PATTERN =
  "(?:code|code_verifier|client[_-]?secret|api[_-]?key|authorization|password|credential|[A-Za-z0-9_-]*(?:token|verifier)[A-Za-z0-9_-]*)";
const OAUTH_JSON_SECURITY_HEADERS = {
  "Content-Type": "application/json",
  "Cache-Control": "no-store, private",
  Pragma: "no-cache",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
} as const;

export interface PendingOAuthTransaction {
  baseUrl: string;
  clientId: string;
  redirectUri: string;
  scopes: string[];
  state: string;
  codeVerifier: string;
  expiresAt: string;
}

export interface OAuthCookieInstruction {
  name: string;
  value: string;
  httpOnly: true;
  sameSite: "lax";
  secure: boolean;
  path: string;
  maxAge: number;
}

export type OAuthPkceStartResponseBody =
  | { ok: true; authorizationUrl: string }
  | { ok: false; error: string };

export interface OAuthPkceRouteResult {
  response: Response;
  cookie?: OAuthCookieInstruction;
  clearCookie?: boolean;
}

interface OAuthPkceStartPayload {
  baseUrl?: unknown;
  clientId?: unknown;
  scopes?: unknown;
  includeNoExpiry?: unknown;
}

interface OAuthPkceDependencies {
  origin?: string;
  publicOrigin?: string;
  redirectUri?: string;
  now?: () => Date;
  fetchFn?: typeof fetch;
  createAbortSignal?: (milliseconds: number) => AbortSignal;
}

interface OAuthTokenResponseBody {
  access_token?: unknown;
  expires?: unknown;
}

type OAuthCallbackMessage =
  | { type: typeof OAUTH_RESULT_MESSAGE_TYPE; ok: true; credential: SessionCredentials }
  | { type: typeof OAUTH_RESULT_MESSAGE_TYPE; ok: false; error: string };

interface OAuthRedirectTarget {
  redirectUri: string;
  callbackUrl: URL;
  cookieSecure: boolean;
  requireCallbackOriginMatch: boolean;
}

export async function handleOAuthPkceStartRequest(
  payload: unknown,
  dependencies: OAuthPkceDependencies,
): Promise<OAuthPkceRouteResult> {
  const startPayload = isStartPayload(payload) ? payload : null;
  const redirectTarget = resolveOAuthRedirectTarget(
    dependencies.redirectUri,
    dependencies.publicOrigin,
    dependencies.origin ?? "http://127.0.0.1:3000",
  );

  if (
    startPayload === null ||
    redirectTarget === null ||
    !isNonBlankString(startPayload.baseUrl) ||
    !isNonBlankString(startPayload.clientId) ||
    !isStringArray(startPayload.scopes) ||
    !isSupportedRequestedScopeList(startPayload.scopes.map((scope) => scope.trim())) ||
    !isSupportedEnterpriseOAuthTarget(startPayload.baseUrl)
  ) {
    return { response: jsonResponse({ ok: false, error: START_REQUEST_ERROR }, 400) };
  }

  const scopes = normalizeOAuthScopes(
    startPayload.scopes,
    startPayload.includeNoExpiry === true,
  );

  if (scopes.length === 0) {
    return { response: jsonResponse({ ok: false, error: START_REQUEST_ERROR }, 400) };
  }

  const now = dependencies.now?.() ?? new Date();
  const codeVerifier = createCodeVerifier();
  const state = createOAuthState();
  const pending: PendingOAuthTransaction = {
    baseUrl: normalizeOAuthBaseUrl(startPayload.baseUrl),
    clientId: startPayload.clientId.trim(),
    redirectUri: redirectTarget.redirectUri,
    scopes,
    state,
    codeVerifier,
    expiresAt: new Date(now.getTime() + OAUTH_PKCE_COOKIE_MAX_AGE_SECONDS * 1000).toISOString(),
  };
  const authorizationUrl = buildEnterpriseAuthorizationUrl({
    baseUrl: pending.baseUrl,
    clientId: pending.clientId,
    redirectUri: pending.redirectUri,
    scopes,
    state,
    codeChallenge: createCodeChallenge(codeVerifier),
  });

  return {
    response: jsonResponse({ ok: true, authorizationUrl: authorizationUrl.toString() }, 200),
    cookie: {
      name: OAUTH_PKCE_COOKIE_NAME,
      value: encodePendingOAuthCookie(pending),
      httpOnly: true,
      sameSite: "lax",
      secure: redirectTarget.cookieSecure,
      path: OAUTH_PKCE_COOKIE_PATH,
      maxAge: OAUTH_PKCE_COOKIE_MAX_AGE_SECONDS,
    },
  };
}

export async function handleOAuthPkceCallbackRequest(
  callbackUrl: URL,
  pendingCookieValue?: string,
  dependencies: OAuthPkceDependencies = {},
): Promise<OAuthPkceRouteResult> {
  const now = dependencies.now?.() ?? new Date();
  const error = callbackUrl.searchParams.get("error");
  const errorDescription = callbackUrl.searchParams.get("error_description");
  const code = callbackUrl.searchParams.get("code");
  const state = callbackUrl.searchParams.get("state");
  const pending = pendingCookieValue ? decodePendingOAuthCookie(pendingCookieValue) : null;

  if (error !== null) {
    if (pending === null || !isValidPendingOAuthExchangeTarget(pending, callbackUrl, dependencies)) {
      return callbackError("OAuth authorization response could not be verified.");
    }

    if (state !== pending.state) {
      return callbackError("OAuth authorization response could not be verified.");
    }

    if (isExpiredPendingOAuthTransaction(pending, now)) {
      return callbackError("OAuth authorization request expired. Start the connection again.");
    }

    return callbackError(
      redactOAuthCallbackError(
        errorDescription ?? `OAuth authorization failed: ${error}`,
        pending,
        code,
      ),
    );
  }

  if (!isNonBlankString(code)) {
    return callbackError("OAuth callback did not include an authorization code.");
  }

  if (pending === null) {
    return callbackError("OAuth authorization request expired or was not found.");
  }

  if (!isValidPendingOAuthExchangeTarget(pending, callbackUrl, dependencies)) {
    return callbackError("OAuth authorization request is invalid.");
  }

  if (isExpiredPendingOAuthTransaction(pending, now)) {
    return callbackError("OAuth authorization request expired. Start the connection again.");
  }

  if (state !== pending.state) {
    return callbackError("OAuth state did not match the pending authorization request.");
  }

  try {
    const tokenBody = await exchangeAuthorizationCodeForToken(code, pending, dependencies);

    if (!isNonBlankString(tokenBody.access_token)) {
      return callbackError("OAuth token response did not include an access token.");
    }

    const accessTokenExpiresAt = createAccessTokenExpiresAt(tokenBody.expires, pending, now);

    if (!pending.scopes.includes(OAUTH_SCOPE_NO_EXPIRY) && accessTokenExpiresAt === undefined) {
      return callbackError("OAuth token response did not include a valid expiration.");
    }

    const credential = {
      instanceType: "enterprise",
      baseUrl: pending.baseUrl,
      accessToken: tokenBody.access_token,
      authSource: "oauth-pkce",
      oauthClientId: pending.clientId,
      oauthScopes: pending.scopes,
      ...(accessTokenExpiresAt ? { accessTokenExpiresAt } : {}),
    } satisfies SessionCredentials;

    return {
      response: callbackHtml({
        type: OAUTH_RESULT_MESSAGE_TYPE,
        ok: true,
        credential,
      } satisfies OAuthCallbackMessage),
      clearCookie: true,
    };
  } catch (exchangeError) {
    return callbackError(redactOAuthExchangeError(toErrorMessage(exchangeError), pending, code));
  }
}

export function encodePendingOAuthCookie(pending: PendingOAuthTransaction): string {
  return Buffer.from(JSON.stringify(pending), "utf8").toString("base64url");
}

export function decodePendingOAuthCookie(value: string): PendingOAuthTransaction | null {
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    return isPendingOAuthTransaction(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

async function exchangeAuthorizationCodeForToken(
  code: string,
  pending: PendingOAuthTransaction,
  dependencies: OAuthPkceDependencies,
): Promise<OAuthTokenResponseBody> {
  const fetchFn = dependencies.fetchFn ?? fetch;
  let response: Response;
  const tokenEndpointUrl = buildEnterpriseTokenEndpointUrl(pending.baseUrl);
  tokenEndpointUrl.searchParams.set("client_id", pending.clientId);
  tokenEndpointUrl.searchParams.set("code", code);
  tokenEndpointUrl.searchParams.set("redirect_uri", pending.redirectUri);
  tokenEndpointUrl.searchParams.set("code_verifier", pending.codeVerifier);

  try {
    response = await fetchFn(tokenEndpointUrl.toString(), {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      signal: createTokenExchangeAbortSignal(dependencies),
    });
  } catch {
    throw new Error(TOKEN_EXCHANGE_NETWORK_ERROR);
  }

  if (!response.ok) {
    throw new Error(
      `OAuth token exchange failed (${response.status}): ${await readTokenExchangeErrorBody(response)}`,
    );
  }

  try {
    const tokenBody: unknown = await response.json();
    return isRecord(tokenBody) ? tokenBody : {};
  } catch (error) {
    if (!isJsonSyntaxError(error)) {
      throw new Error(TOKEN_EXCHANGE_NETWORK_ERROR);
    }

    throw new Error("OAuth token response was not valid JSON.");
  }
}

async function readTokenExchangeErrorBody(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    throw new Error(TOKEN_EXCHANGE_NETWORK_ERROR);
  }
}

function callbackError(error: string): OAuthPkceRouteResult {
  return {
    response: callbackHtml({
      type: OAUTH_RESULT_MESSAGE_TYPE,
      ok: false,
      error,
    } satisfies OAuthCallbackMessage),
    clearCookie: true,
  };
}

function callbackHtml(message: unknown): Response {
  const serializedMessage = JSON.stringify(message).replace(/</g, "\\u003c");

  return new Response(
    `<!doctype html><html><head><title>OAuth complete</title></head><body><script>
(() => {
  const message = ${serializedMessage};
  if (window.opener && !window.opener.closed) {
    window.opener.postMessage(message, window.location.origin);
    window.close();
  } else {
    document.body.textContent = message.ok ? "OAuth connection complete. You can close this window." : message.error;
  }
})();
</script></body></html>`,
    {
      status: 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store, private",
        "Content-Security-Policy":
          "default-src 'none'; script-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'",
        Pragma: "no-cache",
        "Referrer-Policy": "no-referrer",
        "X-Content-Type-Options": "nosniff",
      },
    },
  );
}

function jsonResponse(body: OAuthPkceStartResponseBody, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: OAUTH_JSON_SECURITY_HEADERS,
  });
}

function redactOAuthExchangeError(
  message: string,
  pending: PendingOAuthTransaction,
  code: string,
): string {
  return redactOAuthSensitiveText(redactStructuredOAuthErrorBody(message), [
    code,
    pending.codeVerifier,
  ]);
}

function redactOAuthCallbackError(
  message: string,
  pending: PendingOAuthTransaction | null,
  code: string | null,
): string {
  return redactOAuthSensitiveText(message, [code, pending?.codeVerifier]);
}

function redactStructuredOAuthErrorBody(message: string): string {
  const tokenExchangeErrorMatch = /^(OAuth token exchange failed \(\d+\): )([\s\S]*)$/.exec(message);

  if (!tokenExchangeErrorMatch) {
    return message;
  }

  const [, prefix, responseBody] = tokenExchangeErrorMatch;
  return `${prefix}${redactOAuthErrorBody(responseBody)}`;
}

function redactOAuthErrorBody(responseBody: string): string {
  try {
    const parsed: unknown = JSON.parse(responseBody);
    return JSON.stringify(redactSensitiveJsonFields(parsed));
  } catch {
    return redactTokenTextPatterns(responseBody);
  }
}

function redactSensitiveJsonFields(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => redactSensitiveJsonFields(item));
  }

  if (!isRecord(value)) {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, nestedValue]) => [
      key,
      isSensitiveOAuthKey(key) ? "[redacted]" : redactSensitiveJsonFields(nestedValue),
    ]),
  );
}

function isSensitiveOAuthKey(key: string): boolean {
  return SENSITIVE_OAUTH_KEY_FRAGMENT_PATTERN.test(key);
}

function redactOAuthSensitiveText(
  message: string,
  sensitiveValues: Array<string | null | undefined>,
): string {
  let redacted = message;

  for (const sensitiveValue of sensitiveValues.filter(isNonBlankString)) {
    redacted = redacted.replace(new RegExp(escapeRegExp(sensitiveValue), "g"), "[redacted]");
  }

  return redactTokenTextPatterns(redacted)
    .replace(
      /\b(?:token|code|verifier|client[_-]?secret|api[_-]?key|authorization|password|credential)[_-][A-Za-z0-9_-]+\b/gi,
      "[redacted]",
    )
    .replace(/\b(?!token\b)[A-Za-z0-9_-]*token[A-Za-z0-9_-]*\b/gi, "[redacted]");
}

function redactTokenTextPatterns(message: string): string {
  return message.replace(
    new RegExp(
      `(["']?)\\b(${SENSITIVE_OAUTH_TEXT_KEY_PATTERN})\\b\\1(\\s*[:=]\\s*)(?:"[^"]*"|'[^']*'|[^,;&}\\r\\n]+)`,
      "gi",
    ),
    "$1$2$1$3[redacted]",
  );
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isJsonSyntaxError(error: unknown): boolean {
  return error instanceof SyntaxError;
}

function createAccessTokenExpiresAt(
  expires: unknown,
  pending: PendingOAuthTransaction,
  now: Date,
): string | undefined {
  if (pending.scopes.includes(OAUTH_SCOPE_NO_EXPIRY)) {
    return undefined;
  }

  if (typeof expires !== "number" || !Number.isFinite(expires) || expires <= 0) {
    return undefined;
  }

  const expiresAt = new Date(now.getTime() + expires * 1000);

  if (!Number.isFinite(expiresAt.getTime())) {
    return undefined;
  }

  return expiresAt.toISOString();
}

function resolveOAuthRedirectOrigin(
  publicOrigin: string | undefined,
  requestOrigin: string,
): string | null {
  if (publicOrigin !== undefined) {
    const parsedPublicOrigin = parsePublicOAuthOrigin(publicOrigin);

    if (parsedPublicOrigin === null || !isAllowedConfiguredPublicOrigin(parsedPublicOrigin)) {
      return null;
    }

    return parsedPublicOrigin.origin;
  }

  const parsedRequestOrigin = parsePublicOAuthOrigin(requestOrigin);

  if (parsedRequestOrigin === null || !isLocalDevelopmentOrigin(parsedRequestOrigin)) {
    return null;
  }

  return parsedRequestOrigin.origin;
}

function parsePublicOAuthOrigin(origin: string): URL | null {
  try {
    const parsedOrigin = new URL(origin);

    if (
      (parsedOrigin.protocol !== "http:" && parsedOrigin.protocol !== "https:") ||
      parsedOrigin.username !== "" ||
      parsedOrigin.password !== "" ||
      parsedOrigin.pathname !== "/" ||
      parsedOrigin.search !== "" ||
      parsedOrigin.hash !== ""
    ) {
      return null;
    }

    return parsedOrigin;
  } catch {
    return null;
  }
}

function isLocalDevelopmentOrigin(origin: URL): boolean {
  return (
    origin.hostname === "localhost" ||
    origin.hostname === "127.0.0.1" ||
    origin.hostname === "[::1]" ||
    origin.hostname === "::1"
  );
}

function isAllowedConfiguredPublicOrigin(origin: URL): boolean {
  return origin.protocol === "https:" || isLocalDevelopmentOrigin(origin);
}

function resolveOAuthRedirectTarget(
  redirectUri: string | undefined,
  publicOrigin: string | undefined,
  requestOrigin: string,
): OAuthRedirectTarget | null {
  if (redirectUri !== undefined) {
    return parseConfiguredOAuthRedirectUri(redirectUri);
  }

  const redirectOrigin = resolveOAuthRedirectOrigin(publicOrigin, requestOrigin);

  if (redirectOrigin === null) {
    return null;
  }

  const callbackUrl = new URL(`${redirectOrigin}${OAUTH_PKCE_CALLBACK_PATH}`);
  return {
    redirectUri: callbackUrl.href,
    callbackUrl,
    cookieSecure: callbackUrl.protocol === "https:",
    requireCallbackOriginMatch: false,
  };
}

function parseConfiguredOAuthRedirectUri(redirectUri: string): OAuthRedirectTarget | null {
  const trimmedRedirectUri = redirectUri.trim();

  try {
    const parsedRedirectUri = new URL(trimmedRedirectUri);

    if (
      (parsedRedirectUri.protocol !== "http:" && parsedRedirectUri.protocol !== "https:") ||
      parsedRedirectUri.username !== "" ||
      parsedRedirectUri.password !== "" ||
      parsedRedirectUri.search !== "" ||
      parsedRedirectUri.hash !== ""
    ) {
      return null;
    }

    const redirectmetoTarget = parseRedirectmetoCallbackTarget(parsedRedirectUri);
    if (redirectmetoTarget !== null) {
      return {
        redirectUri: trimmedRedirectUri,
        callbackUrl: redirectmetoTarget,
        cookieSecure: redirectmetoTarget.protocol === "https:",
        requireCallbackOriginMatch: true,
      };
    }

    if (!isAllowedCallbackUrl(parsedRedirectUri, isAllowedConfiguredPublicOrigin)) {
      return null;
    }

    return {
      redirectUri: trimmedRedirectUri,
      callbackUrl: parsedRedirectUri,
      cookieSecure: parsedRedirectUri.protocol === "https:",
      requireCallbackOriginMatch: false,
    };
  } catch {
    return null;
  }
}

function parseRedirectmetoCallbackTarget(redirectUri: URL): URL | null {
  if (redirectUri.hostname.toLowerCase() !== "redirectmeto.com") {
    return null;
  }

  const rawTarget = redirectUri.pathname.replace(/^\/+/, "");

  if (!rawTarget) {
    return null;
  }

  try {
    const targetUrl = new URL(decodeURIComponent(rawTarget));

    if (!isAllowedCallbackUrl(targetUrl, isLocalDevelopmentOrigin)) {
      return null;
    }

    return targetUrl;
  } catch {
    return null;
  }
}

function isAllowedCallbackUrl(
  callbackUrl: URL,
  isAllowedOrigin: (origin: URL) => boolean,
): boolean {
  return (
    (callbackUrl.protocol === "http:" || callbackUrl.protocol === "https:") &&
    callbackUrl.username === "" &&
    callbackUrl.password === "" &&
    callbackUrl.pathname === OAUTH_PKCE_CALLBACK_PATH &&
    callbackUrl.search === "" &&
    callbackUrl.hash === "" &&
    isAllowedOrigin(callbackUrl)
  );
}

function createTokenExchangeAbortSignal(dependencies: OAuthPkceDependencies): AbortSignal {
  if (dependencies.createAbortSignal) {
    return dependencies.createAbortSignal(OAUTH_TOKEN_EXCHANGE_TIMEOUT_MS);
  }

  const abortSignal = AbortSignal as typeof AbortSignal & {
    timeout?: (milliseconds: number) => AbortSignal;
  };

  if (typeof abortSignal.timeout === "function") {
    return abortSignal.timeout(OAUTH_TOKEN_EXCHANGE_TIMEOUT_MS);
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), OAUTH_TOKEN_EXCHANGE_TIMEOUT_MS);
  const maybeNodeTimeout = timeoutId as unknown as { unref?: () => void };
  maybeNodeTimeout.unref?.();
  return controller.signal;
}

function isExpiredPendingOAuthTransaction(pending: PendingOAuthTransaction, now: Date): boolean {
  return new Date(pending.expiresAt).getTime() <= now.getTime();
}

function isSupportedRequestedScopeList(scopes: string[]): boolean {
  return scopes.length > 0 && scopes.every((scope) => SUPPORTED_REQUESTED_SCOPES.has(scope));
}

function isValidPendingOAuthScopes(scopes: string[]): boolean {
  return (
    (scopes.length === 1 && scopes[0] === OAUTH_SCOPE_WRITE_ACCESS) ||
    (scopes.length === 2 &&
      scopes[0] === OAUTH_SCOPE_WRITE_ACCESS &&
      scopes[1] === OAUTH_SCOPE_NO_EXPIRY)
  );
}

function isValidPendingOAuthExchangeTarget(
  pending: PendingOAuthTransaction,
  callbackUrl: URL,
  dependencies: OAuthPkceDependencies,
): boolean {
  if (!isSupportedEnterpriseOAuthTarget(pending.baseUrl)) {
    return false;
  }

  if (!isValidPendingOAuthScopes(pending.scopes)) {
    return false;
  }

  if (callbackUrl.pathname !== OAUTH_PKCE_CALLBACK_PATH) {
    return false;
  }

  const redirectOrigin = resolveOAuthRedirectOrigin(dependencies.publicOrigin, callbackUrl.origin);

  if (redirectOrigin === null) {
    return false;
  }

  try {
    if (pending.baseUrl !== normalizeOAuthBaseUrl(pending.baseUrl)) {
      return false;
    }

    const expectedRedirectTarget = resolveOAuthRedirectTarget(
      dependencies.redirectUri,
      dependencies.publicOrigin,
      callbackUrl.origin,
    );
    const pendingRedirectmetoTarget = resolvePendingRedirectmetoTarget(pending.redirectUri);

    return [expectedRedirectTarget, pendingRedirectmetoTarget].some((target) =>
      isMatchingOAuthRedirectTarget(pending, callbackUrl, target),
    );
  } catch {
    return false;
  }
}

function isMatchingOAuthRedirectTarget(
  pending: PendingOAuthTransaction,
  callbackUrl: URL,
  target: OAuthRedirectTarget | null,
): boolean {
  return (
    target !== null &&
    pending.redirectUri === target.redirectUri &&
    (!target.requireCallbackOriginMatch || callbackUrl.origin === target.callbackUrl.origin ||
      areEquivalentLocalCallbackOrigins(callbackUrl, target.callbackUrl))
  );
}

function areEquivalentLocalCallbackOrigins(left: URL, right: URL): boolean {
  return (
    isLocalDevelopmentOrigin(left) &&
    isLocalDevelopmentOrigin(right) &&
    left.protocol === right.protocol &&
    left.port === right.port
  );
}

function resolvePendingRedirectmetoTarget(redirectUri: string): OAuthRedirectTarget | null {
  try {
    const parsedRedirectUri = new URL(redirectUri);
    const redirectmetoTarget = parseRedirectmetoCallbackTarget(parsedRedirectUri);

    if (redirectmetoTarget === null) {
      return null;
    }

    return {
      redirectUri,
      callbackUrl: redirectmetoTarget,
      cookieSecure: redirectmetoTarget.protocol === "https:",
      requireCallbackOriginMatch: true,
    };
  } catch {
    return null;
  }
}

function isStartPayload(value: unknown): value is OAuthPkceStartPayload {
  return isRecord(value);
}

function isPendingOAuthTransaction(value: unknown): value is PendingOAuthTransaction {
  return (
    isRecord(value) &&
    isNonBlankString(value.baseUrl) &&
    isNonBlankString(value.clientId) &&
    isNonBlankString(value.redirectUri) &&
    isStringArray(value.scopes) &&
    isNonBlankString(value.state) &&
    isNonBlankString(value.codeVerifier) &&
    isNonBlankString(value.expiresAt) &&
    Number.isFinite(Date.parse(value.expiresAt))
  );
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isNonBlankString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
