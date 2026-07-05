import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";
import { GET as handleOAuthPkceCallbackRouteGet } from "../app/api/oauth/pkce/callback/route";
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
const redirectmetoOrigin = "http://127.0.0.1:3002";
const redirectmetoCallbackUri =
  "http://redirectmeto.com/http://127.0.0.1:3002/api/oauth/pkce/callback";
const now = new Date("2026-07-04T12:00:00.000Z");
const publicOriginEnvKey = "STACK_API_UTILITIES_PUBLIC_ORIGIN";
const nextPublicOriginEnvKey = "NEXT_PUBLIC_STACK_API_UTILITIES_PUBLIC_ORIGIN";
const redirectUriEnvKey = "STACK_API_UTILITIES_OAUTH_REDIRECT_URI";

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

async function withPublicOriginEnv<T>(
  publicOrigin: string | undefined,
  callback: () => Promise<T>,
): Promise<T> {
  const previousPublicOrigin = process.env[publicOriginEnvKey];
  const previousNextPublicOrigin = process.env[nextPublicOriginEnvKey];
  const previousRedirectUri = process.env[redirectUriEnvKey];

  if (publicOrigin === undefined) {
    delete process.env[publicOriginEnvKey];
  } else {
    process.env[publicOriginEnvKey] = publicOrigin;
  }
  delete process.env[nextPublicOriginEnvKey];
  delete process.env[redirectUriEnvKey];

  try {
    return await callback();
  } finally {
    if (previousPublicOrigin === undefined) {
      delete process.env[publicOriginEnvKey];
    } else {
      process.env[publicOriginEnvKey] = previousPublicOrigin;
    }

    if (previousNextPublicOrigin === undefined) {
      delete process.env[nextPublicOriginEnvKey];
    } else {
      process.env[nextPublicOriginEnvKey] = previousNextPublicOrigin;
    }

    if (previousRedirectUri === undefined) {
      delete process.env[redirectUriEnvKey];
    } else {
      process.env[redirectUriEnvKey] = previousRedirectUri;
    }
  }
}

async function withRedirectUriEnv<T>(
  redirectUri: string | undefined,
  callback: () => Promise<T>,
): Promise<T> {
  const previousRedirectUri = process.env[redirectUriEnvKey];

  if (redirectUri === undefined) {
    delete process.env[redirectUriEnvKey];
  } else {
    process.env[redirectUriEnvKey] = redirectUri;
  }

  try {
    return await callback();
  } finally {
    if (previousRedirectUri === undefined) {
      delete process.env[redirectUriEnvKey];
    } else {
      process.env[redirectUriEnvKey] = previousRedirectUri;
    }
  }
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

  it("starts OAuth with no_expiry only when explicitly requested", async () => {
    const result = await handleOAuthPkceStartRequest(
      {
        baseUrl: "https://demo.stackenterprise.co",
        clientId: "client-123",
        scopes: ["write_access"],
        includeNoExpiry: true,
      },
      { origin, now: () => now },
    );
    const body = await result.response.json();
    const authorizationUrl = new URL(body.authorizationUrl);
    const pending = decodePendingOAuthCookie(result.cookie?.value ?? "");

    expect(result.response.status).toBe(200);
    expect(authorizationUrl.searchParams.get("scope")).toBe("write_access,no_expiry");
    expect(pending?.scopes).toEqual(["write_access", "no_expiry"]);
  });

  it("normalizes whitespace around supported OAuth scopes before starting", async () => {
    const result = await handleOAuthPkceStartRequest(
      {
        baseUrl: "https://demo.stackenterprise.co",
        clientId: "client-123",
        scopes: [" write_access "],
        includeNoExpiry: false,
      },
      { origin, now: () => now },
    );
    const pending = decodePendingOAuthCookie(result.cookie?.value ?? "");

    expect(result.response.status).toBe(200);
    expect(pending?.scopes).toEqual(["write_access"]);
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

  it("uses configured public origin for OAuth redirect binding in the Next route", async () => {
    await withPublicOriginEnv("https://utilities.example.com", async () => {
      const response = await handleOAuthPkceStartRoutePost(
        new Request("https://internal.example.net/api/oauth/pkce/start", {
          method: "POST",
          body: JSON.stringify({
            baseUrl: "https://demo.stackenterprise.co",
            clientId: "client-123",
            scopes: ["write_access"],
            includeNoExpiry: false,
          }),
        }) as NextRequest,
      );
      const body = await response.json();
      const authorizationUrl = new URL(body.authorizationUrl);

      expect(response.status).toBe(200);
      expect(authorizationUrl.searchParams.get("redirect_uri")).toBe(
        "https://utilities.example.com/api/oauth/pkce/callback",
      );
    });
  });

  it("starts OAuth with a redirectmeto-wrapped callback redirect URI", async () => {
    const result = await handleOAuthPkceStartRequest(
      {
        baseUrl: "https://demo.stackenterprise.co",
        clientId: "client-123",
        scopes: ["write_access"],
        includeNoExpiry: false,
      },
      {
        origin: redirectmetoOrigin,
        redirectUri: redirectmetoCallbackUri,
        now: () => now,
      },
    );
    const body = await result.response.json();
    const authorizationUrl = new URL(body.authorizationUrl);
    const pending = decodePendingOAuthCookie(result.cookie?.value ?? "");

    expect(result.response.status).toBe(200);
    expect(authorizationUrl.searchParams.get("redirect_uri")).toBe(redirectmetoCallbackUri);
    expect(pending?.redirectUri).toBe(redirectmetoCallbackUri);
  });

  it("uses configured redirect URI env for OAuth redirect binding in the Next route", async () => {
    await withRedirectUriEnv(redirectmetoCallbackUri, async () => {
      const response = await handleOAuthPkceStartRoutePost(
        new Request(`${redirectmetoOrigin}/api/oauth/pkce/start`, {
          method: "POST",
          body: JSON.stringify({
            baseUrl: "https://demo.stackenterprise.co",
            clientId: "client-123",
            scopes: ["write_access"],
            includeNoExpiry: false,
          }),
        }) as NextRequest,
      );
      const body = await response.json();
      const authorizationUrl = new URL(body.authorizationUrl);

      expect(response.status).toBe(200);
      expect(authorizationUrl.searchParams.get("redirect_uri")).toBe(redirectmetoCallbackUri);
    });
  });

  it("rejects redirect URI overrides that do not unwrap to a local callback", async () => {
    const result = await handleOAuthPkceStartRequest(
      {
        baseUrl: "https://demo.stackenterprise.co",
        clientId: "client-123",
        scopes: ["write_access"],
      },
      {
        origin: redirectmetoOrigin,
        redirectUri: "http://redirectmeto.com/https://evil.example/api/oauth/pkce/callback",
        now: () => now,
      },
    );

    expect(result.response.status).toBe(400);
    await expect(result.response.json()).resolves.toEqual({
      ok: false,
      error: "Enterprise OAuth requires a Stack Enterprise HTTPS instance URL and OAuth client ID.",
    });
    expect(result.cookie).toBeUndefined();
  });

  it("rejects non-local HTTP configured public origins in the Next route", async () => {
    await withPublicOriginEnv("http://utilities.example.com", async () => {
      const response = await handleOAuthPkceStartRoutePost(
        new Request(`${origin}/api/oauth/pkce/start`, {
          method: "POST",
          body: JSON.stringify({
            baseUrl: "https://demo.stackenterprise.co",
            clientId: "client-123",
            scopes: ["write_access"],
          }),
        }) as NextRequest,
      );

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toEqual({
        ok: false,
        error: "Enterprise OAuth requires a Stack Enterprise HTTPS instance URL and OAuth client ID.",
      });
      expect(response.headers.get("set-cookie")).toBeNull();
    });
  });

  it("allows local HTTP configured public origins in the Next route", async () => {
    await withPublicOriginEnv("http://localhost:3000", async () => {
      const response = await handleOAuthPkceStartRoutePost(
        new Request("https://internal.example.net/api/oauth/pkce/start", {
          method: "POST",
          body: JSON.stringify({
            baseUrl: "https://demo.stackenterprise.co",
            clientId: "client-123",
            scopes: ["write_access"],
          }),
        }) as NextRequest,
      );
      const body = await response.json();
      const authorizationUrl = new URL(body.authorizationUrl);

      expect(response.status).toBe(200);
      expect(authorizationUrl.searchParams.get("redirect_uri")).toBe(
        "http://localhost:3000/api/oauth/pkce/callback",
      );
    });
  });

  it("rejects malformed configured public origins in the Next route", async () => {
    await withPublicOriginEnv("https://utilities.example.com/path", async () => {
      const response = await handleOAuthPkceStartRoutePost(
        new Request(`${origin}/api/oauth/pkce/start`, {
          method: "POST",
          body: JSON.stringify({
            baseUrl: "https://demo.stackenterprise.co",
            clientId: "client-123",
            scopes: ["write_access"],
          }),
        }) as NextRequest,
      );

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toEqual({
        ok: false,
        error: "Enterprise OAuth requires a Stack Enterprise HTTPS instance URL and OAuth client ID.",
      });
      expect(response.headers.get("set-cookie")).toBeNull();
    });
  });

  it("allows local development request origins without a configured public origin", async () => {
    await withPublicOriginEnv(undefined, async () => {
      const response = await handleOAuthPkceStartRoutePost(
        new Request("http://localhost:3000/api/oauth/pkce/start", {
          method: "POST",
          body: JSON.stringify({
            baseUrl: "https://demo.stackenterprise.co",
            clientId: "client-123",
            scopes: ["write_access"],
          }),
        }) as NextRequest,
      );
      const body = await response.json();
      const authorizationUrl = new URL(body.authorizationUrl);

      expect(response.status).toBe(200);
      expect(authorizationUrl.searchParams.get("redirect_uri")).toBe(
        "http://localhost:3000/api/oauth/pkce/callback",
      );
    });
  });

  it("rejects production request origins without a configured public origin", async () => {
    await withPublicOriginEnv(undefined, async () => {
      const response = await handleOAuthPkceStartRoutePost(
        new Request("https://utilities.example.com/api/oauth/pkce/start", {
          method: "POST",
          body: JSON.stringify({
            baseUrl: "https://demo.stackenterprise.co",
            clientId: "client-123",
            scopes: ["write_access"],
          }),
        }) as NextRequest,
      );

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toEqual({
        ok: false,
        error: "Enterprise OAuth requires a Stack Enterprise HTTPS instance URL and OAuth client ID.",
      });
      expect(response.headers.get("set-cookie")).toBeNull();
    });
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
    const signal = new AbortController().signal;
    const createAbortSignal = vi.fn(() => signal);
    const fetchFn = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ access_token: "oauth-token", expires: 86400 }), {
        status: 200,
      }),
    );

    const result = await handleOAuthPkceCallbackRequest(
      new URL(`${origin}/api/oauth/pkce/callback?code=code-123&state=state-123`),
      encodePendingOAuthCookie(pending),
      { createAbortSignal, fetchFn, now: () => now },
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
      expect.stringContaining("https://demo.stackenterprise.co/oauth/access_token/json?"),
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        signal,
      }),
    );
    expect(createAbortSignal).toHaveBeenCalledWith(15000);
    const [tokenExchangeUrl, init] = fetchFn.mock.calls[0];
    const tokenUrl = new URL(tokenExchangeUrl as string);
    expect(tokenUrl.searchParams.get("client_id")).toBe("client-123");
    expect(tokenUrl.searchParams.get("code")).toBe("code-123");
    expect(tokenUrl.searchParams.get("redirect_uri")).toBe(`${origin}/api/oauth/pkce/callback`);
    expect(tokenUrl.searchParams.get("code_verifier")).toBe("verifier-123");
    expect(init.body).toBeUndefined();
    expect(html).toContain("stack-api-oauth-pkce-result");
    expect(html).toContain("oauth-token");
    expect(html).toContain("2026-07-05T12:00:00.000Z");
  });

  it("accepts public-origin pending redirects for internal callback requests", async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ access_token: "oauth-token", expires: 86400 }), {
        status: 200,
      }),
    );

    const result = await handleOAuthPkceCallbackRequest(
      new URL("http://internal.local/api/oauth/pkce/callback?code=code-123&state=state-123"),
      encodePendingOAuthCookie(
        validPending({
          redirectUri: "https://public.example.com/api/oauth/pkce/callback",
        }),
      ),
      {
        fetchFn,
        now: () => now,
        publicOrigin: "https://public.example.com",
      },
    );
    const html = await result.response.text();

    expect(fetchFn).toHaveBeenCalled();
    const [tokenExchangeUrl] = fetchFn.mock.calls[0];
    const tokenUrl = new URL(tokenExchangeUrl as string);
    expect(tokenUrl.searchParams.get("redirect_uri")).toBe(
      "https://public.example.com/api/oauth/pkce/callback",
    );
    expect(html).toContain("stack-api-oauth-pkce-result");
    expect(html).toContain("oauth-token");
  });

  it("accepts redirectmeto pending redirects for local callback requests", async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ access_token: "oauth-token", expires: 86400 }), {
        status: 200,
      }),
    );

    const result = await handleOAuthPkceCallbackRequest(
      new URL(`${redirectmetoOrigin}/api/oauth/pkce/callback?code=code-123&state=state-123`),
      encodePendingOAuthCookie(
        validPending({
          redirectUri: redirectmetoCallbackUri,
        }),
      ),
      {
        fetchFn,
        now: () => now,
        redirectUri: redirectmetoCallbackUri,
      },
    );
    const html = await result.response.text();

    expect(fetchFn).toHaveBeenCalled();
    const [tokenExchangeUrl] = fetchFn.mock.calls[0];
    const tokenUrl = new URL(tokenExchangeUrl as string);
    expect(tokenUrl.searchParams.get("redirect_uri")).toBe(redirectmetoCallbackUri);
    expect(html).toContain("stack-api-oauth-pkce-result");
    expect(html).toContain("oauth-token");
  });

  it("accepts redirectmeto pending redirects when the callback route only has the pending cookie", async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ access_token: "oauth-token", expires: 86400 }), {
        status: 200,
      }),
    );

    const result = await handleOAuthPkceCallbackRequest(
      new URL(`${redirectmetoOrigin}/api/oauth/pkce/callback?code=code-123&state=state-123`),
      encodePendingOAuthCookie(
        validPending({
          redirectUri: redirectmetoCallbackUri,
        }),
      ),
      {
        fetchFn,
        now: () => now,
      },
    );
    const html = await result.response.text();

    expect(fetchFn).toHaveBeenCalled();
    expect(html).toContain("stack-api-oauth-pkce-result");
    expect(html).toContain("oauth-token");
  });

  it("rejects public-origin callbacks that do not hit the callback path", async () => {
    const fetchFn = vi.fn();
    const result = await handleOAuthPkceCallbackRequest(
      new URL("http://internal.local/not-callback?code=code-123&state=state-123"),
      encodePendingOAuthCookie(
        validPending({
          redirectUri: "https://public.example.com/api/oauth/pkce/callback",
        }),
      ),
      {
        fetchFn,
        now: () => now,
        publicOrigin: "https://public.example.com",
      },
    );
    const html = await result.response.text();

    expect(fetchFn).not.toHaveBeenCalled();
    expect(result.clearCookie).toBe(true);
    expect(html).toContain("OAuth authorization request is invalid.");
  });

  it("rejects non-local HTTP public-origin callback redirects", async () => {
    const fetchFn = vi.fn();
    const result = await handleOAuthPkceCallbackRequest(
      new URL("http://internal.local/api/oauth/pkce/callback?code=code-123&state=state-123"),
      encodePendingOAuthCookie(
        validPending({
          redirectUri: "http://utilities.example.com/api/oauth/pkce/callback",
        }),
      ),
      {
        fetchFn,
        now: () => now,
        publicOrigin: "http://utilities.example.com",
      },
    );
    const html = await result.response.text();

    expect(fetchFn).not.toHaveBeenCalled();
    expect(result.clearCookie).toBe(true);
    expect(html).toContain("OAuth authorization request is invalid.");
  });

  it("callback Next route reads and clears the pending OAuth cookie with security headers", async () => {
    await withPublicOriginEnv("https://public.example.com", async () => {
      const fetchFn = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ access_token: "oauth-token", expires: 86400 }), {
          status: 200,
        }),
      );
      vi.stubGlobal("fetch", fetchFn);

      try {
        const response = await handleOAuthPkceCallbackRouteGet(
          new NextRequest(
            "http://internal.local/api/oauth/pkce/callback?code=code-123&state=state-123",
            {
              headers: {
                cookie: `${OAUTH_PKCE_COOKIE_NAME}=${encodePendingOAuthCookie(
                  validPending({
                    redirectUri: "https://public.example.com/api/oauth/pkce/callback",
                    expiresAt: "2999-01-01T00:00:00.000Z",
                  }),
                )}`,
              },
            },
          ),
        );
        const html = await response.text();
        const setCookie = response.headers.get("set-cookie") ?? "";

        expect(html).toContain("oauth-token");
        expect(fetchFn).toHaveBeenCalled();
        expect(setCookie).toContain(`${OAUTH_PKCE_COOKIE_NAME}=;`);
        expect(setCookie).toContain("Path=/api/oauth/pkce");
        expect(setCookie).toContain("Max-Age=0");
        expect(setCookie).toContain("HttpOnly");
        expect(setCookie).toMatch(/SameSite=Lax/i);
        expect(response.headers.get("Cache-Control")).toBe("no-store, private");
        expect(response.headers.get("Content-Security-Policy")).toBe(
          "default-src 'none'; script-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'",
        );
        expect(response.headers.get("Pragma")).toBe("no-cache");
        expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
        expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
      } finally {
        vi.unstubAllGlobals();
      }
    });
  });

  it("callback Next route accepts redirectmeto pending redirects", async () => {
    await withRedirectUriEnv(redirectmetoCallbackUri, async () => {
      const fetchFn = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ access_token: "oauth-token", expires: 86400 }), {
          status: 200,
        }),
      );
      vi.stubGlobal("fetch", fetchFn);

      try {
        const response = await handleOAuthPkceCallbackRouteGet(
          new NextRequest(
            `${redirectmetoOrigin}/api/oauth/pkce/callback?code=code-123&state=state-123`,
            {
              headers: {
                cookie: `${OAUTH_PKCE_COOKIE_NAME}=${encodePendingOAuthCookie(
                  validPending({
                    redirectUri: redirectmetoCallbackUri,
                    expiresAt: "2999-01-01T00:00:00.000Z",
                  }),
                )}`,
              },
            },
          ),
        );
        const html = await response.text();

        expect(html).toContain("oauth-token");
        expect(fetchFn).toHaveBeenCalled();
      } finally {
        vi.unstubAllGlobals();
      }
    });
  });

  it("rejects expiring token responses without a positive numeric expires value", async () => {
    const invalidTokenBodies = [
      { access_token: "oauth-token" },
      { access_token: "oauth-token", expires: "86400" },
      { access_token: "oauth-token", expires: 0 },
      { access_token: "oauth-token", expires: -1 },
      { access_token: "oauth-token", expires: Number.MAX_VALUE },
    ];

    for (const tokenBody of invalidTokenBodies) {
      const result = await handleOAuthPkceCallbackRequest(
        new URL(`${origin}/api/oauth/pkce/callback?code=code-123&state=state-123`),
        encodePendingOAuthCookie(validPending()),
        {
          fetchFn: vi.fn().mockResolvedValue(
            new Response(JSON.stringify(tokenBody), {
              status: 200,
            }),
          ),
          now: () => now,
        },
      );
      const html = await result.response.text();

      expect(html).toContain("OAuth token response did not include a valid expiration.");
      expect(html).not.toContain("Invalid time value");
      expect(html).not.toContain("oauth-token");
    }
  });

  it("allows no_expiry token responses without an expires value", async () => {
    const result = await handleOAuthPkceCallbackRequest(
      new URL(`${origin}/api/oauth/pkce/callback?code=code-123&state=state-123`),
      encodePendingOAuthCookie(validPending({ scopes: ["write_access", "no_expiry"] })),
      {
        fetchFn: vi.fn().mockResolvedValue(
          new Response(JSON.stringify({ access_token: "oauth-token" }), {
            status: 200,
          }),
        ),
        now: () => now,
      },
    );
    const html = await result.response.text();

    expect(html).toContain("stack-api-oauth-pkce-result");
    expect(html).toContain("oauth-token");
    expect(html).not.toContain("accessTokenExpiresAt");
  });

  it("returns a safe retryable callback error when token exchange fails before a response", async () => {
    const result = await handleOAuthPkceCallbackRequest(
      new URL(`${origin}/api/oauth/pkce/callback?code=code-secret&state=state-123`),
      encodePendingOAuthCookie(validPending({ codeVerifier: "verifier-secret" })),
      {
        fetchFn: vi
          .fn()
          .mockRejectedValue(
            new Error("network failed code-secret verifier-secret client_secret=network-secret"),
          ),
        now: () => now,
      },
    );
    const html = await result.response.text();

    expect(html).toContain("OAuth token exchange failed. Check the Enterprise instance and try again.");
    expect(html).not.toContain("code-secret");
    expect(html).not.toContain("verifier-secret");
    expect(html).not.toContain("network-secret");
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
              api_key: "api-key-secret",
              client_secret: "client-secret-value",
              nested: {
                authorization: "Bearer authorization-secret",
                credential: "credential-secret",
                password: "password-secret",
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
    expect(html).not.toContain("api-key-secret");
    expect(html).not.toContain("authorization-secret");
    expect(html).not.toContain("client-secret-value");
    expect(html).not.toContain("credential-secret");
    expect(html).not.toContain("password-secret");
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

  it("redacts broader sensitive values from malformed callback errors", async () => {
    const result = await handleOAuthPkceCallbackRequest(
      new URL(`${origin}/api/oauth/pkce/callback?code=code-secret&state=state-123`),
      encodePendingOAuthCookie(validPending()),
      {
        fetchFn: vi.fn().mockResolvedValue(
          new Response(
            'client_secret=plain-secret Authorization: Bearer authorization-secret {"api_key":"api-secret"',
            { status: 400 },
          ),
        ),
        now: () => now,
      },
    );
    const html = await result.response.text();

    expect(html).toContain("[redacted]");
    expect(html).not.toContain("plain-secret");
    expect(html).not.toContain("authorization-secret");
    expect(html).not.toContain("api-secret");
  });

  it("returns a safe retryable callback error when a non-OK token response body read fails", async () => {
    const response = new Response(null, { status: 400 });
    vi.spyOn(response, "text").mockRejectedValue(
      new DOMException("body read failed text-read-secret", "AbortError"),
    );

    const result = await handleOAuthPkceCallbackRequest(
      new URL(`${origin}/api/oauth/pkce/callback?code=code-secret&state=state-123`),
      encodePendingOAuthCookie(validPending()),
      {
        fetchFn: vi.fn().mockResolvedValue(response),
        now: () => now,
      },
    );
    const html = await result.response.text();

    expect(html).toContain("OAuth token exchange failed. Check the Enterprise instance and try again.");
    expect(html).not.toContain("text-read-secret");
  });

  it("returns a safe retryable callback error when a successful token response JSON read fails", async () => {
    const response = new Response(null, { status: 200 });
    vi.spyOn(response, "json").mockRejectedValue(new TypeError("network json-read-secret"));

    const result = await handleOAuthPkceCallbackRequest(
      new URL(`${origin}/api/oauth/pkce/callback?code=code-secret&state=state-123`),
      encodePendingOAuthCookie(validPending()),
      {
        fetchFn: vi.fn().mockResolvedValue(response),
        now: () => now,
      },
    );
    const html = await result.response.text();

    expect(html).toContain("OAuth token exchange failed. Check the Enterprise instance and try again.");
    expect(html).not.toContain("json-read-secret");
  });

  it("reports invalid JSON token responses without treating syntax errors as network failures", async () => {
    const result = await handleOAuthPkceCallbackRequest(
      new URL(`${origin}/api/oauth/pkce/callback?code=code-secret&state=state-123`),
      encodePendingOAuthCookie(validPending()),
      {
        fetchFn: vi.fn().mockResolvedValue(new Response("not json", { status: 200 })),
        now: () => now,
      },
    );
    const html = await result.response.text();

    expect(html).toContain("OAuth token response was not valid JSON.");
    expect(html).not.toContain("OAuth token exchange failed. Check the Enterprise instance and try again.");
  });
});
