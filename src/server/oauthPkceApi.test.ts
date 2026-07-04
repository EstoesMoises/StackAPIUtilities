import type { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";
import { POST as handleOAuthPkceStartRoutePost } from "../app/api/oauth/pkce/start/route";
import {
  OAUTH_PKCE_COOKIE_NAME,
  type PendingOAuthTransaction,
  decodePendingOAuthCookie,
  encodePendingOAuthCookie,
  handleOAuthPkceCallbackRequest,
  handleOAuthPkceStartRequest,
} from "./oauthPkceApi";

const origin = "http://127.0.0.1:3000";
const now = new Date("2026-07-04T12:00:00.000Z");

function validPending(overrides: Partial<PendingOAuthTransaction> = {}): PendingOAuthTransaction {
  return {
    baseUrl: "https://demo.stackenterprise.co",
    clientId: "client-123",
    redirectUri: `${origin}/api/oauth/pkce/callback`,
    scopes: ["write_access"],
    state: "state-123",
    codeVerifier: "verifier-123",
    expiresAt: "2026-07-04T12:10:00.000Z",
    ...overrides,
  };
}

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
    expect(body).toEqual({
      ok: true,
      authorizationUrl: expect.stringContaining("https://demo.stackenterprise.co/oauth"),
    });
    expect(result.response.headers.get("Cache-Control")).toBe("no-store, private");
    expect(result.response.headers.get("Pragma")).toBe("no-cache");
    expect(result.response.headers.get("Referrer-Policy")).toBe("no-referrer");
    expect(result.response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(result.cookie).toEqual(
      expect.objectContaining({
        name: OAUTH_PKCE_COOKIE_NAME,
        httpOnly: true,
        sameSite: "lax",
        path: "/api/oauth/pkce",
        maxAge: 600,
      }),
    );
    const pending = decodePendingOAuthCookie(result.cookie?.value ?? "");
    expect(pending).toEqual(
      expect.objectContaining({
        baseUrl: "https://demo.stackenterprise.co",
        clientId: "client-123",
        redirectUri: `${origin}/api/oauth/pkce/callback`,
        scopes: ["write_access"],
      }),
    );
  });

  it("preserves start response security headers in the Next route", async () => {
    const response = await handleOAuthPkceStartRoutePost(
      new Request(`${origin}/api/oauth/pkce/start`, {
        method: "POST",
        body: JSON.stringify({
          baseUrl: "https://demo.stackenterprise.co",
          clientId: "client-123",
          scopes: ["write_access"],
          includeNoExpiry: false,
        }),
      }) as NextRequest,
    );

    expect(response.headers.get("Cache-Control")).toBe("no-store, private");
    expect(response.headers.get("Pragma")).toBe("no-cache");
    expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
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

  it("rejects empty or non-string OAuth scopes before creating a cookie", async () => {
    const invalidPayloads = [
      { baseUrl: "https://demo.stackenterprise.co", clientId: "client-123", scopes: [] },
      {
        baseUrl: "https://demo.stackenterprise.co",
        clientId: "client-123",
        scopes: ["write_access,no_expiry"],
      },
      {
        baseUrl: "https://demo.stackenterprise.co",
        clientId: "client-123",
        scopes: ["write_access", 123],
      },
      {
        baseUrl: "https://demo.stackenterprise.co",
        clientId: "client-123",
        scopes: ["write_access", " "],
      },
      {
        baseUrl: "https://demo.stackenterprise.co",
        clientId: "client-123",
        scopes: ["write_access", "no_expiry"],
        includeNoExpiry: false,
      },
    ];

    for (const payload of invalidPayloads) {
      const result = await handleOAuthPkceStartRequest(payload, { origin, now: () => now });

      expect(result.response.status).toBe(400);
      await expect(result.response.json()).resolves.toEqual({
        ok: false,
        error: "Enterprise OAuth requires a Stack Enterprise HTTPS instance URL and OAuth client ID.",
      });
      expect(result.cookie).toBeUndefined();
    }
  });

  it("exchanges callback codes and returns postMessage callback HTML", async () => {
    const pending = validPending();
    const fetchFn = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ access_token: "oauth-token", expires: 86400 }), {
        status: 200,
      }),
    );

    const result = await handleOAuthPkceCallbackRequest(
      new URL(`${origin}/api/oauth/pkce/callback?code=code-123&state=state-123`),
      encodePendingOAuthCookie(pending),
      { fetchFn, now: () => now },
    );
    const html = await result.response.text();

    expect(result.response.status).toBe(200);
    expect(result.response.headers.get("Cache-Control")).toBe("no-store, private");
    expect(result.response.headers.get("Content-Security-Policy")).toBe(
      "default-src 'none'; script-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'",
    );
    expect(result.response.headers.get("Pragma")).toBe("no-cache");
    expect(result.response.headers.get("Referrer-Policy")).toBe("no-referrer");
    expect(result.response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(result.clearCookie).toBe(true);
    expect(fetchFn).toHaveBeenCalledWith(
      "https://demo.stackenterprise.co/oauth/access_token/json",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: expect.any(URLSearchParams),
      }),
    );
    const [, init] = fetchFn.mock.calls[0];
    expect(Object.fromEntries((init.body as URLSearchParams).entries())).toEqual({
      client_id: "client-123",
      code: "code-123",
      redirect_uri: `${origin}/api/oauth/pkce/callback`,
      code_verifier: "verifier-123",
    });
    expect(html).toContain("stack-api-oauth-pkce-result");
    expect(html).toContain("oauth-token");
    expect(html).toContain("2026-07-05T12:00:00.000Z");
  });

  it("rejects callback state mismatches without exchanging tokens", async () => {
    const fetchFn = vi.fn();
    const result = await handleOAuthPkceCallbackRequest(
      new URL(`${origin}/api/oauth/pkce/callback?code=code-123&state=wrong-state`),
      encodePendingOAuthCookie(validPending()),
      { fetchFn, now: () => now },
    );
    const html = await result.response.text();

    expect(fetchFn).not.toHaveBeenCalled();
    expect(result.clearCookie).toBe(true);
    expect(html).toContain("OAuth state did not match the pending authorization request.");
  });

  it("rejects forged callback cookies before exchanging tokens", async () => {
    const forgedPendings = [
      validPending({ baseUrl: "http://127.0.0.1:1234" }),
      validPending({ baseUrl: "https://example.com" }),
      validPending({ baseUrl: "https://demo.stackenterprise.co/some/path?x=1" }),
      validPending({ redirectUri: "https://demo.stackenterprise.co/not-callback" }),
      validPending({ redirectUri: "https://evil.example/api/oauth/pkce/callback" }),
      validPending({ redirectUri: "ftp://evil.example/api/oauth/pkce/callback" }),
      validPending({ redirectUri: `${origin}/api/oauth/pkce/callback?x=1` }),
      validPending({ redirectUri: `${origin}/api/oauth/pkce/callback#fragment` }),
      validPending({ scopes: ["write_access", "admin_scope"] }),
      validPending({ scopes: ["write_access,no_expiry"] }),
      validPending({ redirectUri: "not a url" }),
    ];

    for (const pending of forgedPendings) {
      const fetchFn = vi.fn();
      const result = await handleOAuthPkceCallbackRequest(
        new URL(`${origin}/api/oauth/pkce/callback?code=code-123&state=state-123`),
        encodePendingOAuthCookie(pending),
        { fetchFn, now: () => now },
      );
      const html = await result.response.text();

      expect(fetchFn).not.toHaveBeenCalled();
      expect(result.clearCookie).toBe(true);
      expect(html).toContain("OAuth authorization request is invalid.");
      expect(html).not.toContain("127.0.0.1");
      expect(html).not.toContain("example.com");
      expect(html).not.toContain("some/path");
      expect(html).not.toContain("evil.example");
      expect(html).not.toContain("not-callback");
      expect(html).not.toContain("fragment");
    }
  });

  it("rejects expired, missing, and malformed pending cookies without exchanging tokens", async () => {
    const cases = [
      {
        cookie: encodePendingOAuthCookie(validPending({ expiresAt: "2026-07-04T11:59:59.000Z" })),
        expectedError: "OAuth authorization request expired. Start the connection again.",
      },
      {
        cookie: undefined,
        expectedError: "OAuth authorization request expired or was not found.",
      },
      {
        cookie: "not-valid-base64-json",
        expectedError: "OAuth authorization request expired or was not found.",
      },
    ];

    for (const testCase of cases) {
      const fetchFn = vi.fn();
      const result = await handleOAuthPkceCallbackRequest(
        new URL(`${origin}/api/oauth/pkce/callback?code=code-123&state=state-123`),
        testCase.cookie,
        { fetchFn, now: () => now },
      );
      const html = await result.response.text();

      expect(fetchFn).not.toHaveBeenCalled();
      expect(result.clearCookie).toBe(true);
      expect(html).toContain(testCase.expectedError);
    }
  });

  it("redacts sensitive OAuth denial descriptions", async () => {
    const result = await handleOAuthPkceCallbackRequest(
      new URL(
        `${origin}/api/oauth/pkce/callback?error=access_denied&state=state-123&error_description=denied%20token-secret%20code-secret`,
      ),
      encodePendingOAuthCookie(validPending({ codeVerifier: "verifier-secret" })),
      { fetchFn: vi.fn(), now: () => now },
    );
    const html = await result.response.text();

    expect(html).toContain("[redacted]");
    expect(html).not.toContain("token-secret");
    expect(html).not.toContain("code-secret");
    expect(html).not.toContain("verifier-secret");
  });

  it("rejects unverifiable OAuth denial callbacks without reflecting descriptions", async () => {
    const callbackUrls = [
      new URL(
        `${origin}/api/oauth/pkce/callback?error=access_denied&state=wrong-state&error_description=attacker-controlled-secret`,
      ),
      new URL(
        `${origin}/api/oauth/pkce/callback?error=access_denied&error_description=attacker-controlled-secret`,
      ),
    ];

    for (const callbackUrl of callbackUrls) {
      const fetchFn = vi.fn();
      const result = await handleOAuthPkceCallbackRequest(
        callbackUrl,
        encodePendingOAuthCookie(validPending()),
        { fetchFn, now: () => now },
      );
      const html = await result.response.text();

      expect(fetchFn).not.toHaveBeenCalled();
      expect(result.clearCookie).toBe(true);
      expect(html).toContain("OAuth authorization response could not be verified.");
      expect(html).not.toContain("attacker-controlled-secret");
    }
  });

  it("rejects expired OAuth denial callbacks without reflecting descriptions", async () => {
    const fetchFn = vi.fn();
    const result = await handleOAuthPkceCallbackRequest(
      new URL(
        `${origin}/api/oauth/pkce/callback?error=access_denied&state=state-123&error_description=sensitive-provider-detail`,
      ),
      encodePendingOAuthCookie(validPending({ expiresAt: "2026-07-04T11:59:59.000Z" })),
      { fetchFn, now: () => now },
    );
    const html = await result.response.text();

    expect(fetchFn).not.toHaveBeenCalled();
    expect(result.clearCookie).toBe(true);
    expect(html).toContain("OAuth authorization request expired. Start the connection again.");
    expect(html).not.toContain("sensitive-provider-detail");
  });

  it("redacts sensitive OAuth denial key-value descriptions", async () => {
    const result = await handleOAuthPkceCallbackRequest(
      new URL(
        `${origin}/api/oauth/pkce/callback?error=access_denied&state=state-123&error_description=denied%20code%3Draw-code%20code_verifier%3Draw-verifier%20access_token%3Draw-token`,
      ),
      encodePendingOAuthCookie(validPending()),
      { fetchFn: vi.fn(), now: () => now },
    );
    const html = await result.response.text();

    expect(html).toContain("[redacted]");
    expect(html).not.toContain("raw-code");
    expect(html).not.toContain("raw-verifier");
    expect(html).not.toContain("raw-token");
  });

  it("redacts sensitive token exchange values from callback errors", async () => {
    const result = await handleOAuthPkceCallbackRequest(
      new URL(`${origin}/api/oauth/pkce/callback?code=code-secret&state=state-123`),
      encodePendingOAuthCookie(validPending({ codeVerifier: "verifier-secret" })),
      {
        fetchFn: vi
          .fn()
          .mockResolvedValue(
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

  it("redacts token values from JSON callback errors", async () => {
    const result = await handleOAuthPkceCallbackRequest(
      new URL(`${origin}/api/oauth/pkce/callback?code=code-secret&state=state-123`),
      encodePendingOAuthCookie(validPending({ codeVerifier: "verifier-secret" })),
      {
        fetchFn: vi.fn().mockResolvedValue(
          new Response(
            JSON.stringify({
              error: "invalid_grant",
              access_token: "access-secret-123",
              nested: {
                refresh_token: "refresh-secret-456",
                verifier_hint: "verifier-secret",
              },
            }),
            { status: 400 },
          ),
        ),
        now: () => now,
      },
    );
    const html = await result.response.text();

    expect(html).toContain("[redacted]");
    expect(html).not.toContain("code-secret");
    expect(html).not.toContain("verifier-secret");
    expect(html).not.toContain("access-secret-123");
    expect(html).not.toContain("refresh-secret-456");
  });

  it("redacts token values from malformed JSON callback errors", async () => {
    const result = await handleOAuthPkceCallbackRequest(
      new URL(`${origin}/api/oauth/pkce/callback?code=code-secret&state=state-123`),
      encodePendingOAuthCookie(validPending()),
      {
        fetchFn: vi
          .fn()
          .mockResolvedValue(new Response('{"access_token":"leaky-secret"', { status: 400 })),
        now: () => now,
      },
    );
    const html = await result.response.text();

    expect(html).toContain("[redacted]");
    expect(html).not.toContain("leaky-secret");
  });
});
