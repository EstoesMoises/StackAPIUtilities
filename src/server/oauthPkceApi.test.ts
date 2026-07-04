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
    expect(body).toEqual({
      ok: true,
      authorizationUrl: expect.stringContaining("https://demo.stackenterprise.co/oauth"),
    });
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
});
