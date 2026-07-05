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
      scopes: ["write_access", "no_expiry"],
      state: "state-123",
      codeChallenge: "challenge-123",
    });

    expect(url.origin).toBe("https://demo.stackenterprise.co");
    expect(url.pathname).toBe("/oauth");
    expect(url.searchParams.get("client_id")).toBe("client-123");
    expect(url.searchParams.get("redirect_uri")).toBe(
      "http://127.0.0.1:3000/api/oauth/pkce/callback",
    );
    expect(url.searchParams.get("scope")).toBe("write_access,no_expiry");
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
    expect(normalizeOAuthScopes(["write_access", "no_expiry"], false)).toEqual(["write_access"]);
    expect(normalizeOAuthScopes([" write_access ", "write_access", ""], false)).toEqual([
      "write_access",
    ]);
  });

  it("accepts only HTTPS stackenterprise.co OAuth targets", () => {
    expect(isSupportedEnterpriseOAuthTarget("https://demo.stackenterprise.co")).toBe(true);
    expect(isSupportedEnterpriseOAuthTarget("https://stackenterprise.co")).toBe(true);
    expect(isSupportedEnterpriseOAuthTarget("https://example.com")).toBe(false);
    expect(isSupportedEnterpriseOAuthTarget("http://demo.stackenterprise.co")).toBe(false);
    expect(isSupportedEnterpriseOAuthTarget("not a url")).toBe(false);
  });
});
