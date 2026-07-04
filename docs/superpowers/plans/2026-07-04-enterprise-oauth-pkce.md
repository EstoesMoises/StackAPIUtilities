# Enterprise OAuth PKCE Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Stack Enterprise OAuth Authorization Code with PKCE for v3-only workflows, starting with User Group Sync, while preserving PAT for Basic/Business and API key support for Enterprise v2.3 workflows.

**Architecture:** Server-mediated PKCE uses a short-lived HTTP-only pending cookie, a Next callback route, and a callback page that posts the OAuth result back to the Credentials panel. OAuth-produced tokens stay in React session state and feed existing API v3 clients through `SessionCredentials.accessToken`.

**Tech Stack:** Next.js App Router route handlers, React 18, TypeScript, Vitest, Testing Library, Node `crypto`, Stack Enterprise OAuth endpoints.

---

## File Structure

- Create `src/auth/oauthPkce.ts`: PKCE verifier, challenge, state, Enterprise OAuth URL, token endpoint, scope normalization, Enterprise OAuth host validation.
- Create `src/auth/oauthPkce.test.ts`: unit tests for PKCE, URL construction, scope rules, and Enterprise host validation.
- Create `src/server/oauthPkceApi.ts`: pure start/callback handlers, pending-cookie encode/decode, token exchange, safe callback HTML, error redaction.
- Create `src/server/oauthPkceApi.test.ts`: handler tests for start, callback success, callback failure, cookie expiry, and redaction.
- Create `src/app/api/oauth/pkce/start/route.ts`: POST route that delegates start handling and sets the pending cookie.
- Create `src/app/api/oauth/pkce/callback/route.ts`: GET route that reads/clears the pending cookie and returns callback HTML.
- Modify `src/domain/types.ts`: add OAuth metadata to `SessionCredentials`.
- Modify `src/credentials/credentialRules.ts`: split Basic/Business PAT, Enterprise OAuth v3, and Enterprise v2.3 API key validation.
- Modify `src/credentials/credentialRules.test.ts`: update existing credential validation expectations and add OAuth expiry/scope cases.
- Modify `src/components/CredentialsPanel.tsx`: replace direct Enterprise access-token entry with OAuth PKCE controls, keep PAT for Basic/Business, keep API key for Enterprise.
- Create `src/components/CredentialsPanel.test.tsx`: focused UI tests for credential lanes and OAuth postMessage handling.
- Modify `src/components/AppShell.test.tsx`: replace Basic/Business access-token form usage with PAT usage and add one parent-level Enterprise OAuth smoke test.
- Modify `src/components/UserGroupSyncPanel.tsx`: show OAuth-specific missing/expired credential messages.
- Modify `src/components/UserGroupSyncPanel.test.tsx`: update credentials fixtures to OAuth PKCE and add missing/expired OAuth tests.
- Modify `src/server/userGroupSyncApi.ts`: require active Enterprise OAuth PKCE credentials with `write_access`.
- Modify `src/server/userGroupSyncApi.test.ts`: update happy-path credentials and add PAT/manual/expired rejection cases.
- Modify `src/styles/app.css`: add small OAuth status/control styles for the new Enterprise OAuth block.
- Modify `README.md`: document Basic/Business PAT, Enterprise OAuth PKCE, and Enterprise v2.3 API key lanes.

---

### Task 1: PKCE Utility Module

**Files:**
- Create: `src/auth/oauthPkce.ts`
- Create: `src/auth/oauthPkce.test.ts`

- [ ] **Step 1: Write failing PKCE utility tests**

Create `src/auth/oauthPkce.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  buildEnterpriseAuthorizationUrl,
  buildEnterpriseTokenEndpointUrl,
  createCodeChallenge,
  createCodeVerifier,
  createOAuthState,
  isSupportedEnterpriseOAuthTarget,
  normalizeOAuthScopes,
} from "./oauthPkce";

describe("oauthPkce", () => {
  it("generates URL-safe verifier and state values", () => {
    expect(createCodeVerifier()).toMatch(/^[A-Za-z0-9_-]{43,128}$/);
    expect(createOAuthState()).toMatch(/^[A-Za-z0-9_-]{32,128}$/);
  });

  it("derives an S256 code challenge using base64url encoding", () => {
    expect(createCodeChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe(
      "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
    );
  });

  it("builds the Enterprise authorization URL with PKCE parameters", () => {
    const url = buildEnterpriseAuthorizationUrl({
      baseUrl: "https://demo.stackenterprise.co/",
      clientId: "client-123",
      redirectUri: "http://127.0.0.1:3000/api/oauth/pkce/callback",
      scopes: ["write_access"],
      state: "state-123",
      codeChallenge: "challenge-123",
    });

    expect(url.origin).toBe("https://demo.stackenterprise.co");
    expect(url.pathname).toBe("/oauth");
    expect(url.searchParams.get("client_id")).toBe("client-123");
    expect(url.searchParams.get("redirect_uri")).toBe(
      "http://127.0.0.1:3000/api/oauth/pkce/callback",
    );
    expect(url.searchParams.get("scope")).toBe("write_access");
    expect(url.searchParams.get("state")).toBe("state-123");
    expect(url.searchParams.get("code_challenge")).toBe("challenge-123");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
  });

  it("builds the Enterprise token endpoint URL", () => {
    expect(buildEnterpriseTokenEndpointUrl("https://demo.stackenterprise.co/").toString()).toBe(
      "https://demo.stackenterprise.co/oauth/access_token/json",
    );
  });

  it("normalizes OAuth scopes and only includes no_expiry by explicit opt-in", () => {
    expect(normalizeOAuthScopes(["write_access"], false)).toEqual(["write_access"]);
    expect(normalizeOAuthScopes(["write_access"], true)).toEqual(["write_access", "no_expiry"]);
    expect(normalizeOAuthScopes([" write_access ", "write_access", ""], false)).toEqual(["write_access"]);
  });

  it("accepts only HTTPS stackenterprise.co OAuth targets", () => {
    expect(isSupportedEnterpriseOAuthTarget("https://demo.stackenterprise.co")).toBe(true);
    expect(isSupportedEnterpriseOAuthTarget("https://stackenterprise.co")).toBe(true);
    expect(isSupportedEnterpriseOAuthTarget("https://example.com")).toBe(false);
    expect(isSupportedEnterpriseOAuthTarget("http://demo.stackenterprise.co")).toBe(false);
    expect(isSupportedEnterpriseOAuthTarget("not a url")).toBe(false);
  });
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `pnpm test src/auth/oauthPkce.test.ts`

Expected: FAIL because `src/auth/oauthPkce.ts` does not exist.

- [ ] **Step 3: Implement the PKCE utility module**

Create `src/auth/oauthPkce.ts`:

```ts
import { createHash, randomBytes } from "node:crypto";

export const OAUTH_SCOPE_WRITE_ACCESS = "write_access";
export const OAUTH_SCOPE_NO_EXPIRY = "no_expiry";

const PKCE_VERIFIER_BYTES = 64;
const OAUTH_STATE_BYTES = 32;

export interface EnterpriseAuthorizationUrlInput {
  baseUrl: string;
  clientId: string;
  redirectUri: string;
  scopes: string[];
  state: string;
  codeChallenge: string;
}

export function createCodeVerifier(): string {
  return toBase64Url(randomBytes(PKCE_VERIFIER_BYTES));
}

export function createOAuthState(): string {
  return toBase64Url(randomBytes(OAUTH_STATE_BYTES));
}

export function createCodeChallenge(codeVerifier: string): string {
  return createHash("sha256").update(codeVerifier).digest("base64url");
}

export function normalizeOAuthScopes(scopes: readonly string[], includeNoExpiry: boolean): string[] {
  const normalized = scopes.map((scope) => scope.trim()).filter((scope) => scope.length > 0);
  const uniqueScopes = [...new Set(normalized)];

  if (includeNoExpiry && !uniqueScopes.includes(OAUTH_SCOPE_NO_EXPIRY)) {
    uniqueScopes.push(OAUTH_SCOPE_NO_EXPIRY);
  }

  if (!includeNoExpiry) {
    return uniqueScopes.filter((scope) => scope !== OAUTH_SCOPE_NO_EXPIRY);
  }

  return uniqueScopes;
}

export function buildEnterpriseAuthorizationUrl(input: EnterpriseAuthorizationUrlInput): URL {
  const url = new URL("/oauth", normalizeBaseUrl(input.baseUrl));
  url.searchParams.set("client_id", input.clientId);
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("scope", input.scopes.join(","));
  url.searchParams.set("state", input.state);
  url.searchParams.set("code_challenge", input.codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  return url;
}

export function buildEnterpriseTokenEndpointUrl(baseUrl: string): URL {
  return new URL("/oauth/access_token/json", normalizeBaseUrl(baseUrl));
}

export function isSupportedEnterpriseOAuthTarget(baseUrl: string): boolean {
  try {
    const url = new URL(baseUrl);
    const hostname = url.hostname.toLowerCase();

    return (
      url.protocol === "https:" &&
      (hostname === "stackenterprise.co" || hostname.endsWith(".stackenterprise.co"))
    );
  } catch {
    return false;
  }
}

function normalizeBaseUrl(baseUrl: string): string {
  const url = new URL(baseUrl);
  return `${url.protocol}//${url.host}`;
}

function toBase64Url(bytes: Buffer): string {
  return bytes.toString("base64url");
}
```

- [ ] **Step 4: Run the focused test and verify it passes**

Run: `pnpm test src/auth/oauthPkce.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/auth/oauthPkce.ts src/auth/oauthPkce.test.ts
git commit -m "feat: add enterprise oauth pkce helpers"
```

---

### Task 2: OAuth Start And Callback Server Handlers

**Files:**
- Create: `src/server/oauthPkceApi.ts`
- Create: `src/server/oauthPkceApi.test.ts`
- Create: `src/app/api/oauth/pkce/start/route.ts`
- Create: `src/app/api/oauth/pkce/callback/route.ts`
- Modify: `src/auth/oauthPkce.ts`

- [ ] **Step 1: Write failing server handler tests**

Create `src/server/oauthPkceApi.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import {
  OAUTH_PKCE_COOKIE_NAME,
  decodePendingOAuthCookie,
  encodePendingOAuthCookie,
  handleOAuthPkceCallbackRequest,
  handleOAuthPkceStartRequest,
} from "./oauthPkceApi";

const origin = "http://127.0.0.1:3000";
const now = new Date("2026-07-04T12:00:00.000Z");

describe("oauthPkceApi", () => {
  it("starts OAuth and creates a pending transaction cookie", async () => {
    const result = await handleOAuthPkceStartRequest(
      {
        baseUrl: "https://demo.stackenterprise.co",
        clientId: "client-123",
        scopes: ["write_access"],
        includeNoExpiry: false,
      },
      { origin, now: () => now },
    );
    const body = await result.response.json();

    expect(result.response.status).toBe(200);
    expect(body).toEqual({ ok: true, authorizationUrl: expect.stringContaining("https://demo.stackenterprise.co/oauth") });
    expect(result.cookie).toEqual(expect.objectContaining({
      name: OAUTH_PKCE_COOKIE_NAME,
      httpOnly: true,
      sameSite: "lax",
      path: "/api/oauth/pkce",
      maxAge: 600,
    }));
    const pending = decodePendingOAuthCookie(result.cookie?.value ?? "");
    expect(pending).toEqual(expect.objectContaining({
      baseUrl: "https://demo.stackenterprise.co",
      clientId: "client-123",
      redirectUri: `${origin}/api/oauth/pkce/callback`,
      scopes: ["write_access"],
    }));
  });

  it("rejects malformed start requests before creating a cookie", async () => {
    const result = await handleOAuthPkceStartRequest(
      { baseUrl: "https://example.com", clientId: "", scopes: ["write_access"] },
      { origin, now: () => now },
    );

    expect(result.response.status).toBe(400);
    await expect(result.response.json()).resolves.toEqual({
      ok: false,
      error: "Enterprise OAuth requires a Stack Enterprise HTTPS instance URL and OAuth client ID.",
    });
    expect(result.cookie).toBeUndefined();
  });

  it("exchanges callback codes and returns postMessage callback HTML", async () => {
    const pending = {
      baseUrl: "https://demo.stackenterprise.co",
      clientId: "client-123",
      redirectUri: `${origin}/api/oauth/pkce/callback`,
      scopes: ["write_access"],
      state: "state-123",
      codeVerifier: "verifier-123",
      expiresAt: "2026-07-04T12:10:00.000Z",
    };
    const fetchFn = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ access_token: "oauth-token", expires: 86400 }), { status: 200 }),
    );

    const result = await handleOAuthPkceCallbackRequest(
      new URL(`${origin}/api/oauth/pkce/callback?code=code-123&state=state-123`),
      encodePendingOAuthCookie(pending),
      { fetchFn, now: () => now },
    );
    const html = await result.response.text();

    expect(result.response.status).toBe(200);
    expect(result.clearCookie).toBe(true);
    expect(fetchFn).toHaveBeenCalledWith(
      "https://demo.stackenterprise.co/oauth/access_token/json",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: "client-123",
          code: "code-123",
          redirect_uri: `${origin}/api/oauth/pkce/callback`,
          code_verifier: "verifier-123",
        }),
      }),
    );
    expect(html).toContain("stack-api-oauth-pkce-result");
    expect(html).toContain("oauth-token");
    expect(html).toContain("2026-07-05T12:00:00.000Z");
  });

  it("rejects callback state mismatches without exchanging tokens", async () => {
    const fetchFn = vi.fn();
    const result = await handleOAuthPkceCallbackRequest(
      new URL(`${origin}/api/oauth/pkce/callback?code=code-123&state=wrong-state`),
      encodePendingOAuthCookie({
        baseUrl: "https://demo.stackenterprise.co",
        clientId: "client-123",
        redirectUri: `${origin}/api/oauth/pkce/callback`,
        scopes: ["write_access"],
        state: "state-123",
        codeVerifier: "verifier-123",
        expiresAt: "2026-07-04T12:10:00.000Z",
      }),
      { fetchFn, now: () => now },
    );
    const html = await result.response.text();

    expect(fetchFn).not.toHaveBeenCalled();
    expect(result.clearCookie).toBe(true);
    expect(html).toContain("OAuth state did not match the pending authorization request.");
  });

  it("redacts sensitive token exchange values from callback errors", async () => {
    const result = await handleOAuthPkceCallbackRequest(
      new URL(`${origin}/api/oauth/pkce/callback?code=code-secret&state=state-123`),
      encodePendingOAuthCookie({
        baseUrl: "https://demo.stackenterprise.co",
        clientId: "client-123",
        redirectUri: `${origin}/api/oauth/pkce/callback`,
        scopes: ["write_access"],
        state: "state-123",
        codeVerifier: "verifier-secret",
        expiresAt: "2026-07-04T12:10:00.000Z",
      }),
      {
        fetchFn: vi.fn().mockResolvedValue(
          new Response("failed with code-secret verifier-secret oauth-token", { status: 400 }),
        ),
        now: () => now,
      },
    );
    const html = await result.response.text();

    expect(html).toContain("[redacted]");
    expect(html).not.toContain("code-secret");
    expect(html).not.toContain("verifier-secret");
    expect(html).not.toContain("oauth-token");
  });
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `pnpm test src/server/oauthPkceApi.test.ts`

Expected: FAIL because `src/server/oauthPkceApi.ts` does not exist.

- [ ] **Step 3: Implement pure OAuth server handlers**

Create `src/server/oauthPkceApi.ts` with these exported shapes and behavior:

```ts
import {
  buildEnterpriseAuthorizationUrl,
  buildEnterpriseTokenEndpointUrl,
  createCodeChallenge,
  createCodeVerifier,
  createOAuthState,
  isSupportedEnterpriseOAuthTarget,
  normalizeOAuthScopes,
} from "../auth/oauthPkce";
import type { SessionCredentials } from "../domain/types";

export const OAUTH_PKCE_COOKIE_NAME = "stack_api_oauth_pkce";
export const OAUTH_PKCE_COOKIE_PATH = "/api/oauth/pkce";
export const OAUTH_PKCE_COOKIE_MAX_AGE_SECONDS = 600;

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
```

Implement `handleOAuthPkceStartRequest` so it:

```ts
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
    return { response: jsonResponse({ ok: false, error: "Enterprise OAuth requires a Stack Enterprise HTTPS instance URL and OAuth client ID." }, 400) };
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
```

Implement `handleOAuthPkceCallbackRequest` so it:

- Reads `error`, `code`, and `state` from the callback URL.
- Decodes and expiry-checks the pending cookie.
- Rejects missing code, missing cookie, expired cookie, or mismatched state before token exchange.
- Posts `application/x-www-form-urlencoded` to `buildEnterpriseTokenEndpointUrl(pending.baseUrl)`.
- Converts numeric `expires` seconds into `accessTokenExpiresAt`.
- Returns HTML with a `postMessage` payload:

```ts
{
  type: "stack-api-oauth-pkce-result",
  ok: true,
  credential: {
    instanceType: "enterprise",
    baseUrl: pending.baseUrl,
    accessToken: tokenBody.access_token,
    authSource: "oauth-pkce",
    oauthClientId: pending.clientId,
    oauthScopes: pending.scopes,
    accessTokenExpiresAt,
  } satisfies SessionCredentials,
}
```

Use this safe HTML pattern:

```ts
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
```

Implement these helpers in the same file:

```ts
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
```

- [ ] **Step 4: Add Next route handlers**

Create `src/app/api/oauth/pkce/start/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { handleOAuthPkceStartRequest } from "../../../../../server/oauthPkceApi";

export const runtime = "nodejs";

export async function POST(request: NextRequest): Promise<NextResponse> {
  let payload: unknown;

  try {
    payload = await request.json();
  } catch {
    payload = null;
  }

  const result = await handleOAuthPkceStartRequest(payload, {
    origin: new URL(request.url).origin,
  });
  const responseBody = await result.response.json();
  const response = NextResponse.json(responseBody, { status: result.response.status });

  if (result.cookie) {
    response.cookies.set(result.cookie.name, result.cookie.value, result.cookie);
  }

  return response;
}
```

Create `src/app/api/oauth/pkce/callback/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import {
  OAUTH_PKCE_COOKIE_NAME,
  OAUTH_PKCE_COOKIE_PATH,
  handleOAuthPkceCallbackRequest,
} from "../../../../../server/oauthPkceApi";

export const runtime = "nodejs";

export async function GET(request: NextRequest): Promise<NextResponse> {
  const result = await handleOAuthPkceCallbackRequest(
    new URL(request.url),
    request.cookies.get(OAUTH_PKCE_COOKIE_NAME)?.value,
  );
  const html = await result.response.text();
  const response = new NextResponse(html, {
    status: result.response.status,
    headers: result.response.headers,
  });

  if (result.clearCookie) {
    response.cookies.set(OAUTH_PKCE_COOKIE_NAME, "", {
      httpOnly: true,
      sameSite: "lax",
      path: OAUTH_PKCE_COOKIE_PATH,
      maxAge: 0,
    });
  }

  return response;
}
```

- [ ] **Step 5: Run focused tests and typecheck the routes**

Run: `pnpm test src/auth/oauthPkce.test.ts src/server/oauthPkceApi.test.ts`

Expected: PASS.

Run: `pnpm lint`

Expected: PASS, or FAIL only on files introduced in this task. Fix introduced type errors before continuing.

- [ ] **Step 6: Commit**

```bash
git add src/server/oauthPkceApi.ts src/server/oauthPkceApi.test.ts src/app/api/oauth/pkce/start/route.ts src/app/api/oauth/pkce/callback/route.ts src/auth/oauthPkce.ts src/auth/oauthPkce.test.ts
git commit -m "feat: add enterprise oauth pkce routes"
```

---

### Task 3: Credential Model And Validation Rules

**Files:**
- Modify: `src/domain/types.ts`
- Modify: `src/credentials/credentialRules.ts`
- Modify: `src/credentials/credentialRules.test.ts`

- [ ] **Step 1: Write failing credential validation tests**

Modify `src/credentials/credentialRules.test.ts`:

```ts
import {
  normalizeInstanceUrl,
  validateCredentialsForReport,
  validateEnterpriseV3OAuthCredentials,
} from "./credentialRules";
```

Replace the Basic/Business access-token test with:

```ts
it("requires a PAT for Basic/Business live API reports", () => {
  const result = validateCredentialsForReport("tag-report", {
    instanceType: "basic-business",
    baseUrl: "https://stackoverflowteams.com/c/example-team",
  });

  expect(result.valid).toBe(false);
  expect(result.messages).toContain("Personal access token is required for Basic/Business API calls.");
});
```

Add these Enterprise OAuth tests:

```ts
it("requires OAuth PKCE for Enterprise API v3 credentials", () => {
  const result = validateCredentialsForReport("api-user-report", {
    instanceType: "enterprise",
    baseUrl: "https://demo.stackenterprise.co",
    apiKey: "key",
  });

  expect(result.valid).toBe(false);
  expect(result.messages).toContain("Enterprise OAuth connection is required for Stack API v3 calls.");
});

it("accepts a non-expired Enterprise OAuth PKCE token for API v3 credentials", () => {
  const result = validateCredentialsForReport(
    "api-user-report",
    {
      instanceType: "enterprise",
      baseUrl: "https://demo.stackenterprise.co",
      apiKey: "key",
      accessToken: "oauth-token",
      authSource: "oauth-pkce",
      oauthScopes: ["write_access"],
      accessTokenExpiresAt: "2026-07-05T00:00:00.000Z",
    },
    new Date("2026-07-04T12:00:00.000Z"),
  );

  expect(result.valid).toBe(true);
  expect(result.messages).toEqual([]);
});

it("rejects expired Enterprise OAuth PKCE tokens", () => {
  const result = validateEnterpriseV3OAuthCredentials(
    {
      instanceType: "enterprise",
      baseUrl: "https://demo.stackenterprise.co",
      accessToken: "oauth-token",
      authSource: "oauth-pkce",
      oauthScopes: ["write_access"],
      accessTokenExpiresAt: "2026-07-04T11:59:59.000Z",
    },
    { requiredScopes: ["write_access"], now: new Date("2026-07-04T12:00:00.000Z") },
  );

  expect(result.valid).toBe(false);
  expect(result.messages).toEqual(["Enterprise OAuth token has expired. Reconnect with Enterprise OAuth."]);
});

it("requires requested OAuth scopes for Enterprise v3 write workflows", () => {
  const result = validateEnterpriseV3OAuthCredentials(
    {
      instanceType: "enterprise",
      baseUrl: "https://demo.stackenterprise.co",
      accessToken: "oauth-token",
      authSource: "oauth-pkce",
      oauthScopes: [],
    },
    { requiredScopes: ["write_access"], now: new Date("2026-07-04T12:00:00.000Z") },
  );

  expect(result.valid).toBe(false);
  expect(result.messages).toEqual(["Enterprise OAuth token is missing required scope: write_access."]);
});
```

- [ ] **Step 2: Run focused credential tests and verify they fail**

Run: `pnpm test src/credentials/credentialRules.test.ts`

Expected: FAIL because the credential type and validators do not include OAuth metadata or PAT-only Basic/Business validation yet.

- [ ] **Step 3: Extend `SessionCredentials`**

Modify `src/domain/types.ts`:

```ts
export interface SessionCredentials {
  instanceType: InstanceType;
  baseUrl: string;
  apiKey?: string;
  accessToken?: string;
  pat?: string;
  authSource?: "manual-pat" | "oauth-pkce";
  oauthClientId?: string;
  oauthScopes?: string[];
  accessTokenExpiresAt?: string;
}
```

- [ ] **Step 4: Implement OAuth-aware validation**

Modify `src/credentials/credentialRules.ts`:

```ts
interface EnterpriseOAuthValidationOptions {
  requiredScopes?: string[];
  now?: Date;
}

export function validateCredentialsForReport(
  reportId: ReportId,
  credentials: SessionCredentials,
  now: Date = new Date(),
): ValidationResult {
  const report = reportRegistry.find((candidate) => candidate.id === reportId);
  const messages: string[] = [];

  if (!report) {
    return { valid: false, messages: [`Unknown report: ${reportId}`] };
  }

  if (!report.supportedInstances.includes(credentials.instanceType)) {
    messages.push(`${report.title} is not available for the selected instance type.`);
  }

  if (credentials.instanceType === "basic-business" && !credentials.pat) {
    messages.push("Personal access token is required for Basic/Business API calls.");
  }

  if (credentials.instanceType === "enterprise") {
    if (report.credentialRequirements.includes("api-key") && !credentials.apiKey) {
      messages.push("API key is required for Stack API v2.3 Enterprise calls.");
    }

    if (report.credentialRequirements.includes("access-token")) {
      messages.push(...validateEnterpriseV3OAuthCredentials(credentials, { now }).messages);
    }
  }

  return { valid: messages.length === 0, messages };
}

export function validateEnterpriseV3OAuthCredentials(
  credentials: SessionCredentials | null,
  options: EnterpriseOAuthValidationOptions = {},
): ValidationResult {
  const messages: string[] = [];
  const now = options.now ?? new Date();

  if (!credentials || credentials.instanceType !== "enterprise") {
    return {
      valid: false,
      messages: ["Enterprise OAuth connection is required for Stack API v3 calls."],
    };
  }

  if (credentials.authSource !== "oauth-pkce" || !credentials.accessToken) {
    messages.push("Enterprise OAuth connection is required for Stack API v3 calls.");
  }

  if (credentials.accessTokenExpiresAt) {
    const expiresAt = new Date(credentials.accessTokenExpiresAt);
    if (Number.isNaN(expiresAt.getTime()) || expiresAt.getTime() <= now.getTime()) {
      messages.push("Enterprise OAuth token has expired. Reconnect with Enterprise OAuth.");
    }
  }

  for (const requiredScope of options.requiredScopes ?? []) {
    if (!(credentials.oauthScopes ?? []).includes(requiredScope)) {
      messages.push(`Enterprise OAuth token is missing required scope: ${requiredScope}.`);
    }
  }

  return { valid: messages.length === 0, messages };
}
```

- [ ] **Step 5: Run credential tests and update old access-token expectations**

Run: `pnpm test src/credentials/credentialRules.test.ts`

Expected: PASS after replacing remaining Basic/Business manual access-token assertions with PAT assertions.

- [ ] **Step 6: Commit**

```bash
git add src/domain/types.ts src/credentials/credentialRules.ts src/credentials/credentialRules.test.ts
git commit -m "feat: validate oauth and pat credential lanes"
```

---

### Task 4: Credentials Panel OAuth UI

**Files:**
- Modify: `src/components/CredentialsPanel.tsx`
- Create: `src/components/CredentialsPanel.test.tsx`
- Modify: `src/components/AppShell.test.tsx`
- Modify: `src/styles/app.css`

- [ ] **Step 1: Write focused Credentials panel tests**

Create `src/components/CredentialsPanel.test.tsx`:

```tsx
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SessionCredentials } from "../domain/types";
import { CredentialsPanel } from "./CredentialsPanel";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("CredentialsPanel", () => {
  it("shows PAT credentials for Basic/Business and hides Enterprise OAuth controls", () => {
    render(
      <CredentialsPanel selectedReportId="tag-report" credentials={null} onSave={vi.fn()} />,
    );

    expect(screen.getByLabelText("Instance type")).toHaveValue("basic-business");
    expect(screen.getByLabelText("Personal access token")).toBeInTheDocument();
    expect(screen.queryByLabelText("OAuth Client ID")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Connect with Enterprise OAuth" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Access token")).not.toBeInTheDocument();
  });

  it("shows OAuth controls and API key support for Enterprise", async () => {
    const user = userEvent.setup();

    render(
      <CredentialsPanel selectedReportId="tag-report" credentials={null} onSave={vi.fn()} />,
    );

    await user.selectOptions(screen.getByLabelText("Instance type"), "enterprise");

    expect(screen.getByLabelText("API key")).toBeInTheDocument();
    expect(screen.getByLabelText("OAuth Client ID")).toBeInTheDocument();
    expect(screen.getByLabelText("Request non-expiring token")).not.toBeChecked();
    expect(screen.getByRole("button", { name: "Connect with Enterprise OAuth" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Personal access token")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Access token")).not.toBeInTheDocument();
  });

  it("starts Enterprise OAuth with write_access and no no_expiry by default", async () => {
    const user = userEvent.setup();
    const popup = { location: { href: "" }, close: vi.fn() };
    vi.spyOn(window, "open").mockReturnValue(popup as unknown as Window);
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ ok: true, authorizationUrl: "https://demo.stackenterprise.co/oauth?state=abc" }), {
        status: 200,
      }),
    );

    render(
      <CredentialsPanel selectedReportId="tag-report" credentials={null} onSave={vi.fn()} />,
    );

    await user.selectOptions(screen.getByLabelText("Instance type"), "enterprise");
    await user.type(screen.getByLabelText("Instance URL"), "https://demo.stackenterprise.co");
    await user.type(screen.getByLabelText("OAuth Client ID"), "client-123");
    await user.click(screen.getByRole("button", { name: "Connect with Enterprise OAuth" }));

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/oauth/pkce/start",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          baseUrl: "https://demo.stackenterprise.co",
          clientId: "client-123",
          scopes: ["write_access"],
          includeNoExpiry: false,
        }),
      }),
    );
    expect(popup.location.href).toBe("https://demo.stackenterprise.co/oauth?state=abc");
  });

  it("saves OAuth callback credentials merged with Enterprise API key", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    vi.spyOn(window, "open").mockReturnValue({ location: { href: "" }, close: vi.fn() } as unknown as Window);
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ ok: true, authorizationUrl: "https://demo.stackenterprise.co/oauth?state=abc" }), {
        status: 200,
      }),
    );

    render(
      <CredentialsPanel selectedReportId="tag-report" credentials={null} onSave={onSave} />,
    );

    await user.selectOptions(screen.getByLabelText("Instance type"), "enterprise");
    await user.type(screen.getByLabelText("Instance URL"), "https://demo.stackenterprise.co");
    await user.type(screen.getByLabelText("API key"), "api-key-123");
    await user.type(screen.getByLabelText("OAuth Client ID"), "client-123");
    await user.click(screen.getByRole("button", { name: "Connect with Enterprise OAuth" }));

    window.dispatchEvent(
      new MessageEvent("message", {
        origin: window.location.origin,
        data: {
          type: "stack-api-oauth-pkce-result",
          ok: true,
          credential: {
            instanceType: "enterprise",
            baseUrl: "https://demo.stackenterprise.co",
            accessToken: "oauth-token",
            authSource: "oauth-pkce",
            oauthClientId: "client-123",
            oauthScopes: ["write_access"],
            accessTokenExpiresAt: "2026-07-05T12:00:00.000Z",
          } satisfies SessionCredentials,
        },
      }),
    );

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith({
        instanceType: "enterprise",
        baseUrl: "https://demo.stackenterprise.co",
        apiKey: "api-key-123",
        accessToken: "oauth-token",
        authSource: "oauth-pkce",
        oauthClientId: "client-123",
        oauthScopes: ["write_access"],
        accessTokenExpiresAt: "2026-07-05T12:00:00.000Z",
      });
    });
  });
});
```

- [ ] **Step 2: Run focused component tests and verify they fail**

Run: `pnpm test src/components/CredentialsPanel.test.tsx`

Expected: FAIL because the component still renders direct access-token entry and has no OAuth controls.

- [ ] **Step 3: Implement conditional credential lanes**

Modify `src/components/CredentialsPanel.tsx`:

- Import `useEffect` from React.
- Extend `CredentialsDraft`:

```ts
interface CredentialsDraft {
  instanceType: InstanceType;
  baseUrl: string;
  apiKey: string;
  pat: string;
  oauthClientId: string;
  includeNoExpiry: boolean;
}
```

- Initialize from credentials:

```ts
const [draft, setDraft] = useState<CredentialsDraft>({
  instanceType: credentials?.instanceType ?? "basic-business",
  baseUrl: credentials?.baseUrl ?? "",
  apiKey: credentials?.apiKey ?? "",
  pat: credentials?.pat ?? "",
  oauthClientId: credentials?.oauthClientId ?? "",
  includeNoExpiry: credentials?.oauthScopes?.includes("no_expiry") ?? false,
});
```

- Save manual credentials by lane:

```ts
function handleSubmit(event: FormEvent<HTMLFormElement>) {
  event.preventDefault();

  if (draft.instanceType === "basic-business") {
    onSave({
      instanceType: "basic-business",
      baseUrl: draft.baseUrl.trim(),
      pat: draft.pat.trim() || undefined,
      authSource: draft.pat.trim() ? "manual-pat" : undefined,
    });
    setSaved(true);
    return;
  }

  onSave({
    instanceType: "enterprise",
    baseUrl: draft.baseUrl.trim(),
    apiKey: draft.apiKey.trim() || undefined,
    oauthClientId: draft.oauthClientId.trim() || undefined,
    accessToken: credentials?.authSource === "oauth-pkce" ? credentials.accessToken : undefined,
    authSource: credentials?.authSource === "oauth-pkce" ? "oauth-pkce" : undefined,
    oauthScopes: credentials?.authSource === "oauth-pkce" ? credentials.oauthScopes : undefined,
    accessTokenExpiresAt: credentials?.authSource === "oauth-pkce" ? credentials.accessTokenExpiresAt : undefined,
  });
  setSaved(true);
}
```

- Add OAuth start and message handling:

```ts
type OAuthMessage =
  | { type: "stack-api-oauth-pkce-result"; ok: true; credential: SessionCredentials }
  | { type: "stack-api-oauth-pkce-result"; ok: false; error: string };

const OAUTH_SCOPES = ["write_access"];

useEffect(() => {
  function handleMessage(event: MessageEvent<OAuthMessage>) {
    if (event.origin !== window.location.origin || event.data?.type !== "stack-api-oauth-pkce-result") {
      return;
    }

    if (!event.data.ok) {
      setSaved(false);
      setOAuthError(event.data.error);
      return;
    }

    onSave({
      ...event.data.credential,
      baseUrl: draft.baseUrl.trim(),
      apiKey: draft.apiKey.trim() || undefined,
      oauthClientId: draft.oauthClientId.trim() || event.data.credential.oauthClientId,
    });
    setOAuthError(null);
    setSaved(true);
  }

  window.addEventListener("message", handleMessage);
  return () => window.removeEventListener("message", handleMessage);
}, [draft.apiKey, draft.baseUrl, draft.oauthClientId, onSave]);

async function beginOAuthConnect() {
  setSaved(false);
  setOAuthError(null);

  const popup = window.open("", "stack-api-enterprise-oauth", "popup,width=720,height=800");
  const response = await fetch("/api/oauth/pkce/start", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      baseUrl: draft.baseUrl.trim(),
      clientId: draft.oauthClientId.trim(),
      scopes: OAUTH_SCOPES,
      includeNoExpiry: draft.includeNoExpiry,
    }),
  });
  const body = (await response.json()) as { ok: true; authorizationUrl: string } | { ok: false; error: string };

  if (!body.ok) {
    popup?.close();
    setOAuthError(body.error);
    return;
  }

  if (!popup) {
    setOAuthError("Enable pop-ups to connect with Enterprise OAuth.");
    return;
  }

  popup.location.href = body.authorizationUrl;
}
```

- Render fields conditionally:
  - Always render instance type and instance URL.
  - Render API key only for Enterprise.
  - Render PAT only for Basic/Business.
  - Render OAuth Client ID, no-expiry checkbox, status, and connect button only for Enterprise.
  - Remove the direct `Access token` input.

- [ ] **Step 4: Update AppShell tests that use direct access-token input**

Modify `src/components/AppShell.test.tsx`:

- In `opens the shared credentials panel`, replace:

```ts
expect(screen.getByLabelText("Access token")).toBeInTheDocument();
expect(screen.getByLabelText("Personal access token")).toBeInTheDocument();
```

with:

```ts
expect(screen.queryByLabelText("Access token")).not.toBeInTheDocument();
expect(screen.getByLabelText("Personal access token")).toBeInTheDocument();
```

- In Basic/Business live report tests, replace:

```ts
await user.type(screen.getByLabelText("Access token"), "token");
```

with:

```ts
await user.type(screen.getByLabelText("Personal access token"), "pat-token");
```

- Update expected request credentials from `accessToken: "token"` to:

```ts
pat: "pat-token",
authSource: "manual-pat",
```

- [ ] **Step 5: Add OAuth form spacing**

Modify `src/styles/app.css` with existing variables:

```css
.oauth-connect-panel {
  display: grid;
  gap: 12px;
  padding: 14px;
  border: 1px solid var(--so-border);
  border-radius: 8px;
  background: var(--so-surface-raised);
}

.oauth-status {
  margin: 0;
  color: var(--so-text-muted);
  font-size: 13px;
}
```

- [ ] **Step 6: Run component tests**

Run: `pnpm test src/components/CredentialsPanel.test.tsx src/components/AppShell.test.tsx`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/components/CredentialsPanel.tsx src/components/CredentialsPanel.test.tsx src/components/AppShell.test.tsx src/styles/app.css
git commit -m "feat: add enterprise oauth credentials UI"
```

---

### Task 5: User Group Sync OAuth Enforcement

**Files:**
- Modify: `src/server/userGroupSyncApi.ts`
- Modify: `src/server/userGroupSyncApi.test.ts`
- Modify: `src/components/UserGroupSyncPanel.tsx`
- Modify: `src/components/UserGroupSyncPanel.test.tsx`

- [ ] **Step 1: Update server tests to require OAuth PKCE**

Modify the `credentials` fixture in `src/server/userGroupSyncApi.test.ts`:

```ts
const credentials: SessionCredentials = {
  instanceType: "enterprise",
  baseUrl: "https://demo.stackenterprise.co",
  accessToken: "oauth-token",
  authSource: "oauth-pkce",
  oauthScopes: ["write_access"],
  accessTokenExpiresAt: "2026-07-05T12:00:00.000Z",
};
```

Add tests:

```ts
it("rejects Enterprise PAT credentials for OAuth-only user group sync", async () => {
  const createClient = vi.fn();

  const response = await handleUserGroupSyncRequest(
    {
      action: "preview",
      credentials: {
        instanceType: "enterprise",
        baseUrl: "https://demo.stackenterprise.co",
        pat: "pat-token",
        authSource: "manual-pat",
      },
      csvText,
      groupNameTemplate: "{Senior Manager} VRM",
      syncMode: "add-only",
    },
    { createClient },
  );

  expect(response.status).toBe(400);
  await expect(response.json()).resolves.toEqual({
    ok: false,
    error: "Enterprise OAuth connection is required for Stack API v3 calls.",
  });
  expect(createClient).not.toHaveBeenCalled();
});

it("rejects OAuth tokens that do not include write_access", async () => {
  const response = await handleUserGroupSyncRequest({
    action: "preview",
    credentials: { ...credentials, oauthScopes: [] },
    csvText,
    groupNameTemplate: "{Senior Manager} VRM",
    syncMode: "add-only",
  });

  expect(response.status).toBe(400);
  await expect(response.json()).resolves.toEqual({
    ok: false,
    error: "Enterprise OAuth token is missing required scope: write_access.",
  });
});

it("rejects expired OAuth tokens before creating an API client", async () => {
  const createClient = vi.fn();

  const response = await handleUserGroupSyncRequest(
    {
      action: "preview",
      credentials: { ...credentials, accessTokenExpiresAt: "2000-01-01T00:00:00.000Z" },
      csvText,
      groupNameTemplate: "{Senior Manager} VRM",
      syncMode: "add-only",
    },
    { createClient },
  );

  expect(response.status).toBe(400);
  await expect(response.json()).resolves.toEqual({
    ok: false,
    error: "Enterprise OAuth token has expired. Reconnect with Enterprise OAuth.",
  });
  expect(createClient).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run focused server tests and verify they fail**

Run: `pnpm test src/server/userGroupSyncApi.test.ts`

Expected: FAIL because PAT/manual tokens are still accepted for User Group Sync.

- [ ] **Step 3: Enforce OAuth in the User Group Sync API**

Modify `src/server/userGroupSyncApi.ts`:

```ts
import { validateEnterpriseV3OAuthCredentials } from "../credentials/credentialRules";
```

Replace the token presence check:

```ts
if (!normalizedCredentials.accessToken && !normalizedCredentials.pat) {
  return browserJsonResponse(
    { ok: false, error: "Enterprise user group sync requires an access token with write_access." },
    400,
  );
}
```

with:

```ts
const oauthValidation = validateEnterpriseV3OAuthCredentials(normalizedCredentials, {
  requiredScopes: ["write_access"],
});

if (!oauthValidation.valid) {
  return browserJsonResponse({ ok: false, error: oauthValidation.messages.join(" ") }, 400);
}
```

Update `createStackApiV3Client`:

```ts
function createStackApiV3Client(
  credentials: SessionCredentials,
  normalizedInstance: NormalizedInstance,
): StackApiV3Client {
  return new StackApiV3Client({
    apiV3Url: normalizedInstance.apiV3Url,
    token: credentials.accessToken ?? "",
  });
}
```

- [ ] **Step 4: Update UserGroupSyncPanel tests and UI message**

Modify the credentials fixture in `src/components/UserGroupSyncPanel.test.tsx`:

```ts
const credentials = {
  instanceType: "enterprise" as const,
  baseUrl: "https://demo.stackenterprise.co",
  accessToken: "oauth-token",
  authSource: "oauth-pkce" as const,
  oauthScopes: ["write_access"],
  accessTokenExpiresAt: "2026-07-05T12:00:00.000Z",
};
```

Add a missing OAuth test:

```tsx
it("prompts for Enterprise OAuth credentials when missing", () => {
  render(<UserGroupSyncPanel credentials={null} />);

  expect(
    screen.getByText("Connect with Enterprise OAuth before using User Group Sync."),
  ).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Preview changes" })).toBeDisabled();
});
```

Modify `src/components/UserGroupSyncPanel.tsx`:

```ts
const MISSING_CREDENTIALS_MESSAGE = "Connect with Enterprise OAuth before using User Group Sync.";
```

Keep server-side validation as the authority; the UI message is only a friendlier prompt.

- [ ] **Step 5: Run focused User Group Sync tests**

Run: `pnpm test src/server/userGroupSyncApi.test.ts src/components/UserGroupSyncPanel.test.tsx`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/server/userGroupSyncApi.ts src/server/userGroupSyncApi.test.ts src/components/UserGroupSyncPanel.tsx src/components/UserGroupSyncPanel.test.tsx
git commit -m "feat: require oauth for enterprise user group sync"
```

---

### Task 6: App Integration And Documentation

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/components/AppShell.test.tsx`
- Modify: `README.md`

- [ ] **Step 1: Write or update app integration expectations**

In `src/components/AppShell.test.tsx`, ensure the live Basic/Business report tests now save PAT credentials and assert this request body:

```ts
expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({
  reportId: "inactive-users",
  credentials: {
    instanceType: "basic-business",
    baseUrl: "https://stackoverflowteams.com/c/example-team",
    pat: "pat-token",
    authSource: "manual-pat",
  },
  periodRole: "current",
  scope: {},
  pageSize: 100,
  maxPagesPerDataset: 5,
});
```

Add this Enterprise OAuth save smoke test for the parent reducer:

```tsx
it("stores Enterprise OAuth credentials returned from the credentials panel", async () => {
  const user = userEvent.setup();
  vi.spyOn(window, "open").mockReturnValue({ location: { href: "" }, close: vi.fn() } as unknown as Window);
  vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(JSON.stringify({ ok: true, authorizationUrl: "https://demo.stackenterprise.co/oauth?state=abc" }), {
      status: 200,
    }),
  );

  render(<App />);

  await user.click(screen.getByRole("button", { name: "Credentials" }));
  await user.selectOptions(screen.getByLabelText("Instance type"), "enterprise");
  await user.type(screen.getByLabelText("Instance URL"), "https://demo.stackenterprise.co");
  await user.type(screen.getByLabelText("OAuth Client ID"), "client-123");
  await user.click(screen.getByRole("button", { name: "Connect with Enterprise OAuth" }));

  window.dispatchEvent(
    new MessageEvent("message", {
      origin: window.location.origin,
      data: {
        type: "stack-api-oauth-pkce-result",
        ok: true,
        credential: {
          instanceType: "enterprise",
          baseUrl: "https://demo.stackenterprise.co",
          accessToken: "oauth-token",
          authSource: "oauth-pkce",
          oauthClientId: "client-123",
          oauthScopes: ["write_access"],
          accessTokenExpiresAt: "2026-07-05T12:00:00.000Z",
        },
      },
    }),
  );

  expect(await screen.findByText("Credentials saved for this browser session.")).toBeInTheDocument();
  expect(screen.getByText("Credentials saved")).toBeInTheDocument();
});
```

- [ ] **Step 2: Run AppShell tests**

Run: `pnpm test src/components/AppShell.test.tsx`

Expected: PASS.

- [ ] **Step 3: Update README credential guidance**

Modify the `## Credentials` section in `README.md`:

```md
## Credentials

Credentials and generated report data are session-only; the app does not persist them in browser storage.

The shared credentials screen supports three authentication lanes:

- Stack Overflow Basic/Business: instance URL plus personal access token.
- Stack Overflow Enterprise API v3: OAuth Authorization Code with PKCE, using the Enterprise instance URL and OAuth Client ID.
- Stack Overflow Enterprise API v2.3: API key remains available for workflows that still call v2.3 endpoints.

Enterprise OAuth requests the minimum workflow scope by default. User Group Sync requests `write_access`. `no_expiry` is off by default and is included only when explicitly selected.
```

- [ ] **Step 4: Run focused tests and lint**

Run: `pnpm test src/components/AppShell.test.tsx src/components/CredentialsPanel.test.tsx`

Expected: PASS.

Run: `pnpm lint`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/App.tsx src/components/AppShell.test.tsx README.md
git commit -m "docs: describe oauth credential lanes"
```

---

### Task 7: Full Verification

**Files:**
- No planned edits.

- [ ] **Step 1: Run the complete unit test suite**

Run: `pnpm test`

Expected: PASS.

- [ ] **Step 2: Run TypeScript lint**

Run: `pnpm lint`

Expected: PASS.

- [ ] **Step 3: Run production build**

Run: `pnpm build`

Expected: PASS.

- [ ] **Step 4: Run Playwright e2e**

Run: `pnpm e2e`

Expected: PASS.

- [ ] **Step 5: Inspect final diff**

Run: `git status --short`

Expected: only intended OAuth PKCE implementation files are modified or untracked.

Run: `git diff --stat HEAD`

Expected: changes are limited to auth helpers, OAuth routes, credential validation/UI, User Group Sync auth enforcement, tests, styles, and README.

- [ ] **Step 6: Commit verification fixes after any failed command**

If a verification command fails, use `superpowers:systematic-debugging`, make the smallest fix, rerun the failed command until it passes, then commit the fix:

```bash
git add README.md src
git commit -m "fix: complete oauth pkce verification"
```

When all verification commands pass without additional edits, skip this commit step.

---

## Self-Review Checklist

- Spec coverage: This plan covers PKCE S256, server-mediated callback, short-lived HTTP-only pending cookie, minimum scopes, explicit `no_expiry`, Basic/Business PAT, Enterprise v2.3 API key, User Group Sync OAuth enforcement, error handling, and tests.
- Placeholder scan: No task relies on an unspecified implementation step; every code-changing step includes concrete code or exact behavioral replacements.
- Type consistency: The plan uses `authSource: "manual-pat" | "oauth-pkce"`, `oauthScopes`, and `accessTokenExpiresAt` consistently across types, validation, UI, server handlers, and tests.
