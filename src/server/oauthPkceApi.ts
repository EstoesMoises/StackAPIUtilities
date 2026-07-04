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
} from "../auth/oauthPkce";
import type { SessionCredentials } from "../domain/types";

export const OAUTH_PKCE_COOKIE_NAME = "stack_api_oauth_pkce";
export const OAUTH_PKCE_COOKIE_PATH = "/api/oauth/pkce";
export const OAUTH_PKCE_COOKIE_MAX_AGE_SECONDS = 600;

const OAUTH_RESULT_MESSAGE_TYPE = "stack-api-oauth-pkce-result";
const START_REQUEST_ERROR =
  "Enterprise OAuth requires a Stack Enterprise HTTPS instance URL and OAuth client ID.";

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
  now?: () => Date;
  fetchFn?: typeof fetch;
}

interface OAuthTokenResponseBody {
  access_token?: unknown;
  expires?: unknown;
}

type OAuthCallbackMessage =
  | { type: typeof OAUTH_RESULT_MESSAGE_TYPE; ok: true; credential: SessionCredentials }
  | { type: typeof OAUTH_RESULT_MESSAGE_TYPE; ok: false; error: string };

export async function handleOAuthPkceStartRequest(
  payload: unknown,
  dependencies: OAuthPkceDependencies,
): Promise<OAuthPkceRouteResult> {
  const startPayload = isStartPayload(payload) ? payload : null;
  const origin = dependencies.origin ?? "http://127.0.0.1:3000";

  if (
    startPayload === null ||
    !isNonBlankString(startPayload.baseUrl) ||
    !isNonBlankString(startPayload.clientId) ||
    !Array.isArray(startPayload.scopes) ||
    !isSupportedEnterpriseOAuthTarget(startPayload.baseUrl)
  ) {
    return { response: jsonResponse({ ok: false, error: START_REQUEST_ERROR }, 400) };
  }

  const now = dependencies.now?.() ?? new Date();
  const scopes = normalizeOAuthScopes(
    startPayload.scopes.filter((scope): scope is string => typeof scope === "string"),
    startPayload.includeNoExpiry === true,
  );
  const codeVerifier = createCodeVerifier();
  const state = createOAuthState();
  const redirectUri = `${origin}/api/oauth/pkce/callback`;
  const pending: PendingOAuthTransaction = {
    baseUrl: normalizeOAuthBaseUrl(startPayload.baseUrl),
    clientId: startPayload.clientId.trim(),
    redirectUri,
    scopes,
    state,
    codeVerifier,
    expiresAt: new Date(now.getTime() + OAUTH_PKCE_COOKIE_MAX_AGE_SECONDS * 1000).toISOString(),
  };
  const authorizationUrl = buildEnterpriseAuthorizationUrl({
    baseUrl: pending.baseUrl,
    clientId: pending.clientId,
    redirectUri,
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
      secure: origin.startsWith("https://"),
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
    return callbackError(errorDescription ?? `OAuth authorization failed: ${error}`);
  }

  if (!isNonBlankString(code)) {
    return callbackError("OAuth callback did not include an authorization code.");
  }

  if (pending === null) {
    return callbackError("OAuth authorization request expired or was not found.");
  }

  if (new Date(pending.expiresAt).getTime() <= now.getTime()) {
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

    const accessTokenExpiresAt =
      typeof tokenBody.expires === "number" && Number.isFinite(tokenBody.expires)
        ? new Date(now.getTime() + tokenBody.expires * 1000).toISOString()
        : undefined;
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
  const response = await fetchFn(buildEnterpriseTokenEndpointUrl(pending.baseUrl).toString(), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: pending.clientId,
      code,
      redirect_uri: pending.redirectUri,
      code_verifier: pending.codeVerifier,
    }),
  });

  if (!response.ok) {
    throw new Error(`OAuth token exchange failed (${response.status}): ${await response.text()}`);
  }

  try {
    const tokenBody: unknown = await response.json();
    return isRecord(tokenBody) ? tokenBody : {};
  } catch {
    throw new Error("OAuth token response was not valid JSON.");
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
    { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } },
  );
}

function jsonResponse(body: OAuthPkceStartResponseBody, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
    },
  });
}

function redactOAuthExchangeError(
  message: string,
  pending: PendingOAuthTransaction,
  code: string,
): string {
  const sensitiveValues = [code, pending.codeVerifier].filter(isNonBlankString);
  let redacted = message;

  for (const sensitiveValue of sensitiveValues) {
    redacted = redacted.replace(new RegExp(escapeRegExp(sensitiveValue), "g"), "[redacted]");
  }

  return redacted.replace(/\b(?!token\b)[A-Za-z0-9_-]*token[A-Za-z0-9_-]*\b/gi, "[redacted]");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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
