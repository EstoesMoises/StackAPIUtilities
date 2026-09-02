import { describe, expect, it, vi } from "vitest";
import type { SessionCredentials } from "../domain/types";
import {
  MAX_WRITE_ROUTE_BYTES,
  prepareEnterpriseWriteContext,
  readBoundedJsonRequest,
  redactedJsonResponse,
} from "./enterpriseWriteRequest";

const oauthCredentials: SessionCredentials = {
  instanceType: "enterprise",
  baseUrl: "https://demo.stackenterprise.co",
  accessToken: "oauth-token",
  authSource: "oauth-pkce",
  oauthScopes: ["write_access", "no_expiry"],
};

describe("prepareEnterpriseWriteContext", () => {
  it("returns a normalized write context without exposing credentials", () => {
    const result = prepareEnterpriseWriteContext({
      instanceType: "enterprise",
      baseUrl: "https://demo.stackenterprise.co/",
      accessToken: " token-value ",
      authSource: "manual-enterprise-token",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected a valid context");
    expect(result.instance.apiV3Url).toBe("https://demo.stackenterprise.co/api/v3");
    expect(result.credentials.accessToken).toBe("token-value");
    expect(result.redact("failed token-value request")).toBe("failed [redacted] request");
  });

  it("normalizes optional access-token and PAT whitespace", () => {
    const result = prepareEnterpriseWriteContext({
      ...oauthCredentials,
      accessToken: "  oauth-token  ",
      pat: "   ",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected a valid context");
    expect(result.credentials.accessToken).toBe("oauth-token");
    expect(result.credentials).not.toHaveProperty("pat");
  });

  it.each([
    "https://stackenterprise.co",
    "https://demo.stackenterprise.co",
    "https://DEMO.stackenterprise.co/",
  ])("accepts the exact HTTPS Stack Enterprise host allowlist: %s", (baseUrl) => {
    expect(prepareEnterpriseWriteContext({ ...oauthCredentials, baseUrl })).toMatchObject({
      ok: true,
    });
  });

  it.each([
    "http://demo.stackenterprise.co",
    "https://stackenterprise.co.evil.example",
    "https://demo.stackenterprise.co.evil.example",
    "https://example.com",
  ])("rejects hosts outside the exact HTTPS Stack Enterprise allowlist: %s", (baseUrl) => {
    expect(prepareEnterpriseWriteContext({ ...oauthCredentials, baseUrl })).toMatchObject({
      ok: false,
      code: "unsupported_enterprise_instance",
      status: 400,
    });
  });

  it("returns a stable safe failure for malformed instance URLs", () => {
    expect(prepareEnterpriseWriteContext({ ...oauthCredentials, baseUrl: "not a url" })).toEqual({
      ok: false,
      code: "invalid_instance_url",
      status: 400,
      message: "Enterprise write request requires a valid instance URL.",
    });
  });

  it("rejects unknown instance types", () => {
    expect(
      prepareEnterpriseWriteContext({
        ...oauthCredentials,
        instanceType: "unknown",
      } as unknown as SessionCredentials),
    ).toMatchObject({
      ok: false,
      code: "enterprise_credentials_required",
      status: 400,
    });
  });

  it("requires write_access for OAuth credentials", () => {
    expect(
      prepareEnterpriseWriteContext({ ...oauthCredentials, oauthScopes: ["no_expiry"] }),
    ).toEqual({
      ok: false,
      code: "invalid_enterprise_credentials",
      status: 400,
      message: "Enterprise OAuth token is missing required scope: write_access.",
    });
  });

  it("accepts manual Enterprise tokens whose scopes cannot be introspected", () => {
    expect(
      prepareEnterpriseWriteContext({
        instanceType: "enterprise",
        baseUrl: "https://demo.stackenterprise.co",
        accessToken: "manual-token",
        authSource: "manual-enterprise-token",
      }),
    ).toMatchObject({ ok: true });
  });

  it("rejects expired OAuth credentials", () => {
    expect(
      prepareEnterpriseWriteContext({
        ...oauthCredentials,
        accessTokenExpiresAt: "2000-01-01T00:00:00.000Z",
      }),
    ).toEqual({
      ok: false,
      code: "invalid_enterprise_credentials",
      status: 400,
      message: "Enterprise OAuth token has expired. Reconnect with Enterprise OAuth.",
    });
  });

  it("redacts raw and normalized credentials longest-first", () => {
    const result = prepareEnterpriseWriteContext({
      ...oauthCredentials,
      accessToken: " token-value ",
      pat: "token-value-extra",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected a valid context");
    expect(result.redact("raw= token-value ; normalized=token-value; pat=token-value-extra")).toBe(
      "raw= [redacted] ; normalized=[redacted]; pat=[redacted]",
    );
  });

  it("precomputes credential characters instead of repeatedly scanning a large token", () => {
    const largeToken = Array.from(
      { length: 512 },
      (_, index) => String.fromCodePoint(0xe000 + index),
    ).join("");
    const includes = vi.spyOn(String.prototype, "includes");

    const result = prepareEnterpriseWriteContext({
      instanceType: "enterprise",
      baseUrl: "https://demo.stackenterprise.co",
      accessToken: largeToken,
      authSource: "manual-enterprise-token",
    });
    if (!result.ok) throw new Error("expected a valid context");
    result.redact("safe value");
    const fullStringScanCount = includes.mock.calls.length;
    includes.mockRestore();

    expect(fullStringScanCount).toBeLessThan(20);
  });
});

describe("redactedJsonResponse", () => {
  it("redacts credentials from strings at every nesting depth", async () => {
    const result = prepareEnterpriseWriteContext({
      ...oauthCredentials,
      accessToken: " deeply-secret ",
      pat: "pat-secret",
    });
    if (!result.ok) throw new Error("expected a valid context");

    const response = redactedJsonResponse(
      {
        ok: false,
        error: "deeply-secret failed",
        details: [{ messages: ["token was  deeply-secret ", "PAT pat-secret"] }],
      },
      500,
      result.redact,
    );

    expect(response.status).toBe(500);
    expect(response.headers.get("Content-Type")).toBe("application/json");
    const serialized = await response.text();
    expect(serialized).not.toContain("deeply-secret");
    expect(serialized).not.toContain("pat-secret");
    expect(JSON.parse(serialized)).toEqual({
      ok: false,
      error: "[redacted] failed",
      details: [{ messages: ["token was  [redacted] ", "PAT [redacted]"] }],
    });
  });

  it("does not reintroduce adversarial credentials through marker collisions", async () => {
    const rawAccessToken = " [ ";
    const rawPat = " redacted ";
    const result = prepareEnterpriseWriteContext({
      instanceType: "enterprise",
      baseUrl: "https://demo.stackenterprise.co",
      accessToken: rawAccessToken,
      pat: rawPat,
      authSource: "manual-enterprise-token",
    });
    if (!result.ok) throw new Error("expected a valid context");

    const response = redactedJsonResponse(
      {
        ok: false,
        error: {
          access: "failed for [",
          pat: "failed for redacted",
          combined: "failed for [redacted]",
        },
      },
      500,
      result.redact,
    );

    const serialized = await response.text();
    for (const secret of [rawAccessToken, rawPat, rawAccessToken.trim(), rawPat.trim()]) {
      expect(serialized).not.toContain(secret);
    }
  });

  it("redacts credentials used as arbitrary nested object keys", async () => {
    const secret = "leaked-secret";
    const result = prepareEnterpriseWriteContext({
      instanceType: "enterprise",
      baseUrl: "https://demo.stackenterprise.co",
      accessToken: secret,
      authSource: "manual-enterprise-token",
    });
    if (!result.ok) throw new Error("expected a valid context");

    const response = redactedJsonResponse(
      {
        ok: false,
        error: {
          [secret]: "key must be sanitized",
          detail: `value also contains ${secret}`,
        },
      },
      500,
      result.redact,
    );

    const serialized = await response.text();
    expect(serialized).not.toContain(secret);
  });

  it.each([
    ["left", "a[", "aa["],
    ["right", "]a", "]aa"],
  ])("does not reconstruct a credential across a %s marker boundary", async (_side, secret, tainted) => {
    const result = prepareEnterpriseWriteContext({
      instanceType: "enterprise",
      baseUrl: "https://demo.stackenterprise.co",
      accessToken: secret,
      authSource: "manual-enterprise-token",
    });
    if (!result.ok) throw new Error("expected a valid context");

    const response = redactedJsonResponse(
      {
        ok: false,
        error: {
          [tainted]: tainted,
        },
      },
      500,
      result.redact,
    );

    const serialized = await response.text();
    expect(serialized).not.toContain(secret);
  });

  it.each([
    [
      "adjacent object fields",
      ']","next',
      { first: ']","next', next: "safe" },
    ],
    [
      "a sanitized key and its value",
      ']":"a',
      { [']":"a']: "a" },
    ],
    [
      "adjacent array values",
      ']","a',
      [']","a', "a"],
    ],
  ])("blocks credential reconstruction across serialized %s", async (_caseName, secret, body) => {
    const result = prepareEnterpriseWriteContext({
      instanceType: "enterprise",
      baseUrl: "https://demo.stackenterprise.co",
      accessToken: secret,
      authSource: "manual-enterprise-token",
    });
    if (!result.ok) throw new Error("expected a valid context");

    const response = redactedJsonResponse(body, 500, result.redact);
    const serialized = await response.text();

    expect(() => JSON.parse(serialized)).not.toThrow();
    expect(serialized).not.toContain(secret);
  });

  it("fails closed with valid bounded JSON when every object representation is unsafe", async () => {
    const secret = '"';
    const result = prepareEnterpriseWriteContext({
      instanceType: "enterprise",
      baseUrl: "https://demo.stackenterprise.co",
      accessToken: secret,
      authSource: "manual-enterprise-token",
    });
    if (!result.ok) throw new Error("expected a valid context");

    const response = redactedJsonResponse({ ok: false, error: secret }, 500, result.redact);
    const serialized = await response.text();

    expect(response.status).toBe(500);
    expect(serialized).toBe("0");
    expect(JSON.parse(serialized)).toBe(0);
    expect(serialized).not.toContain(secret);
  });

  it("redacts overlapping credentials in one non-cascading pass", async () => {
    const result = prepareEnterpriseWriteContext({
      instanceType: "enterprise",
      baseUrl: "https://demo.stackenterprise.co",
      accessToken: "token",
      pat: "token-longer",
      authSource: "manual-enterprise-token",
    });
    if (!result.ok) throw new Error("expected a valid context");

    const response = redactedJsonResponse(
      { ok: false, error: { first: "token-longer", second: "token" } },
      500,
      result.redact,
    );

    const serialized = await response.text();
    expect(serialized).not.toContain("token-longer");
    expect(serialized).not.toContain("token");
  });

  it("does not invoke nested toJSON hooks that could reveal a credential", async () => {
    const secret = "to-json-secret";
    const result = prepareEnterpriseWriteContext({
      instanceType: "enterprise",
      baseUrl: "https://demo.stackenterprise.co",
      accessToken: secret,
      authSource: "manual-enterprise-token",
    });
    if (!result.ok) throw new Error("expected a valid context");
    const toJSON = vi.fn(() => ({ leaked: secret }));
    const tainted = { safe: "retained", toJSON };

    const response = redactedJsonResponse(
      { ok: false, error: { nested: tainted } },
      500,
      result.redact,
    );

    const serialized = await response.text();
    expect(toJSON).not.toHaveBeenCalled();
    expect(serialized).not.toContain(secret);
    expect(JSON.parse(serialized)).toEqual({
      ok: false,
      error: { nested: { safe: "retained" } },
    });
  });

  it("serializes cyclic error data safely without credentials", async () => {
    const secret = "cycle-secret";
    const result = prepareEnterpriseWriteContext({
      instanceType: "enterprise",
      baseUrl: "https://demo.stackenterprise.co",
      accessToken: secret,
      authSource: "manual-enterprise-token",
    });
    if (!result.ok) throw new Error("expected a valid context");
    const error: Record<string, unknown> = { message: `failed for ${secret}` };
    error.cause = error;

    const response = redactedJsonResponse({ ok: false, error }, 500, result.redact);

    const serialized = await response.text();
    expect(serialized).not.toContain(secret);
    expect(JSON.parse(serialized)).toMatchObject({
      ok: false,
      error: { message: expect.any(String), cause: expect.any(String) },
    });
  });

  it("does not invoke getters and safely contains hostile proxies", async () => {
    const secret = "getter-secret";
    const result = prepareEnterpriseWriteContext({
      instanceType: "enterprise",
      baseUrl: "https://demo.stackenterprise.co",
      accessToken: secret,
      authSource: "manual-enterprise-token",
    });
    if (!result.ok) throw new Error("expected a valid context");
    const getter = vi.fn(() => secret);
    const accessorValue = Object.defineProperty({}, "leaked", {
      get: getter,
      enumerable: true,
    });
    const hostileProxy = new Proxy({}, {
      ownKeys() {
        throw new Error(`proxy failed for ${secret}`);
      },
    });

    const response = redactedJsonResponse(
      { ok: false, error: { accessorValue, hostileProxy } },
      500,
      result.redact,
    );

    const serialized = await response.text();
    expect(getter).not.toHaveBeenCalled();
    expect(serialized).not.toContain(secret);
    expect(JSON.parse(serialized)).toMatchObject({ ok: false, error: expect.any(Object) });
  });
});

describe("readBoundedJsonRequest", () => {
  it("parses a JSON body after reading it exactly once", async () => {
    const request = new Request("https://utilities.example/api/write", {
      method: "POST",
      body: JSON.stringify({ action: "scan" }),
    });
    const text = vi.spyOn(request, "text");

    await expect(readBoundedJsonRequest(request)).resolves.toEqual({
      ok: true,
      value: { action: "scan" },
    });
    expect(text).toHaveBeenCalledTimes(1);
  });

  it("accepts a valid JSON body at the 1 MiB byte boundary", async () => {
    const body = JSON.stringify("a".repeat(MAX_WRITE_ROUTE_BYTES - 2));
    const request = new Request("https://utilities.example/api/write", { method: "POST", body });

    const result = await readBoundedJsonRequest(request);

    expect(result.ok).toBe(true);
  });

  it("rejects a multibyte body over 1 MiB even when its UTF-16 length is smaller", async () => {
    const body = JSON.stringify("é".repeat(MAX_WRITE_ROUTE_BYTES / 2));
    expect(body.length).toBeLessThanOrEqual(MAX_WRITE_ROUTE_BYTES);
    const request = new Request("https://utilities.example/api/write", { method: "POST", body });

    const result = await readBoundedJsonRequest(request);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected an oversized-body failure");
    expect(result.response.status).toBe(413);
    await expect(result.response.json()).resolves.toEqual({
      ok: false,
      error: "Request body exceeds the 1 MiB limit.",
    });
  });

  it("rejects an oversized valid Content-Length before reading the body", async () => {
    const request = new Request("https://utilities.example/api/write", {
      method: "POST",
      body: "{}",
      headers: { "Content-Length": String(MAX_WRITE_ROUTE_BYTES + 1) },
    });
    const text = vi.spyOn(request, "text");

    const result = await readBoundedJsonRequest(request);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected an oversized-body failure");
    expect(result.response.status).toBe(413);
    expect(text).not.toHaveBeenCalled();
  });

  it("returns a generic error for invalid JSON without reflecting payload data", async () => {
    const request = new Request("https://utilities.example/api/write", {
      method: "POST",
      body: "{secret-payload",
    });

    const result = await readBoundedJsonRequest(request);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected an invalid-JSON failure");
    expect(result.response.status).toBe(400);
    const serialized = await result.response.text();
    expect(serialized).not.toContain("secret-payload");
    expect(JSON.parse(serialized)).toEqual({
      ok: false,
      error: "Request body must contain valid JSON.",
    });
  });
});
