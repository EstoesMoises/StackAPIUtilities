import { describe, expect, it } from "vitest";
import type { ReportId, SessionCredentials } from "../domain/types";
import { normalizeInstanceUrl, validateCredentialsForReport, validateEnterpriseV3OAuthCredentials } from "./credentialRules";

const NOW = new Date("2026-07-04T12:00:00.000Z");
const FUTURE_EXPIRY = "2026-07-05T00:00:00.000Z";
const CONNECTION_REQUIRED_MESSAGE = "Enterprise OAuth connection is required for Stack API v3 calls.";
const EXPIRY_MESSAGE = "Enterprise OAuth token has expired. Reconnect with Enterprise OAuth.";

describe("normalizeInstanceUrl", () => {
  it("normalizes Basic/Business team URLs into API roots and team slugs", () => {
    expect(normalizeInstanceUrl("https://stackoverflowteams.com/c/example-team")).toEqual({
      instanceType: "basic-business",
      baseUrl: "https://stackoverflowteams.com/c/example-team",
      teamSlug: "example-team",
      apiV2Url: "https://api.stackoverflowteams.com/2.3",
      apiV3Url: "https://api.stackoverflowteams.com/v3/teams/example-team",
    });
  });

  it("extracts the Basic/Business team slug from pasted in-app URLs", () => {
    expect(normalizeInstanceUrl("https://stackoverflowteams.com/c/example-team/questions")).toMatchObject({
      instanceType: "basic-business",
      baseUrl: "https://stackoverflowteams.com/c/example-team",
      teamSlug: "example-team",
      apiV3Url: "https://api.stackoverflowteams.com/v3/teams/example-team",
    });
  });

  it("rejects empty Basic/Business team slugs", () => {
    expect(() => normalizeInstanceUrl("https://stackoverflowteams.com/c/")).toThrow("Basic/Business team URL must include a team slug.");
  });

  it("normalizes Enterprise URLs into same-origin API roots", () => {
    expect(normalizeInstanceUrl("https://demo.stackenterprise.co/")).toEqual({
      instanceType: "enterprise",
      baseUrl: "https://demo.stackenterprise.co",
      teamSlug: null,
      apiV2Url: "https://demo.stackenterprise.co/api/2.3",
      apiV3Url: "https://demo.stackenterprise.co/api/v3",
    });
  });
});

describe("validateCredentialsForReport", () => {
  it("returns invalid for unknown reports", () => {
    const result = validateCredentialsForReport("not-a-report" as ReportId, {
      instanceType: "enterprise",
      baseUrl: "https://demo.stackenterprise.co",
    });

    expect(result.valid).toBe(false);
    expect(result.messages).toEqual(["Unknown report: not-a-report"]);
  });

  it("flags reports that are unavailable for the selected instance type", () => {
    const result = validateCredentialsForReport("webhook-report", {
      instanceType: "basic-business",
      baseUrl: "https://stackoverflowteams.com/c/example-team",
      pat: "pat",
    });

    expect(result.valid).toBe(false);
    expect(result.messages).toContain("WebHook Report is not available for the selected instance type.");
  });

  it("requires a PAT for Basic/Business live API reports", () => {
    const result = validateCredentialsForReport("tag-report", {
      instanceType: "basic-business",
      baseUrl: "https://stackoverflowteams.com/c/example-team",
    });

    expect(result.valid).toBe(false);
    expect(result.messages).toContain("Personal access token is required for Basic/Business API calls.");
  });

  it("rejects manually supplied access tokens for Basic/Business live API reports", () => {
    const result = validateCredentialsForReport("tag-report", {
      instanceType: "basic-business",
      baseUrl: "https://stackoverflowteams.com/c/example-team",
      accessToken: "manual-token",
    });

    expect(result.valid).toBe(false);
    expect(result.messages).toContain("Personal access token is required for Basic/Business API calls.");
  });

  it("accepts PAT credentials for Basic/Business live API reports without an access token", () => {
    const result = validateCredentialsForReport("tag-report", {
      instanceType: "basic-business",
      baseUrl: "https://stackoverflowteams.com/c/example-team",
      pat: "pat",
    });

    expect(result).toEqual({ valid: true, messages: [] });
  });

  it("requires an API key for Enterprise reports that use Stack API v2.3 even when OAuth exists", () => {
    const result = validateCredentialsForReport("api-user-report", {
      instanceType: "enterprise",
      baseUrl: "https://demo.stackenterprise.co",
      accessToken: "token",
      authSource: "oauth-pkce",
    });

    expect(result.valid).toBe(false);
    expect(result.messages).toContain("API key is required for Stack API v2.3 Enterprise calls.");
  });

  it("rejects whitespace-only API keys for Enterprise reports that use Stack API v2.3", () => {
    const result = validateCredentialsForReport("api-user-report", {
      instanceType: "enterprise",
      baseUrl: "https://demo.stackenterprise.co",
      apiKey: "   ",
      accessToken: "token",
      authSource: "oauth-pkce",
    }, NOW);

    expect(result.valid).toBe(false);
    expect(result.messages).toContain("API key is required for Stack API v2.3 Enterprise calls.");
  });

  it("requires Enterprise OAuth PKCE credentials for Enterprise reports that use Stack API v3", () => {
    const result = validateCredentialsForReport("api-user-report", {
      instanceType: "enterprise",
      baseUrl: "https://demo.stackenterprise.co",
      apiKey: "key",
    }, NOW);

    expect(result.valid).toBe(false);
    expect(result.messages).toContain(CONNECTION_REQUIRED_MESSAGE);
  });

  it("accepts Enterprise API key credentials for reports that only use Stack API v2.3 datasets", () => {
    const result = validateCredentialsForReport("inactive-users", {
      instanceType: "enterprise",
      baseUrl: "https://demo.stackenterprise.co",
      apiKey: "key",
    }, NOW);

    expect(result).toEqual({ valid: true, messages: [] });
  });

  it("accepts API key and active OAuth PKCE credentials for Enterprise reports that use v2 and v3", () => {
    const result = validateCredentialsForReport("api-user-report", {
      instanceType: "enterprise",
      baseUrl: "https://demo.stackenterprise.co",
      apiKey: "key",
      accessToken: "token",
      authSource: "oauth-pkce",
      accessTokenExpiresAt: FUTURE_EXPIRY,
    }, NOW);

    expect(result).toEqual({ valid: true, messages: [] });
  });
});

describe("validateEnterpriseV3OAuthCredentials", () => {
  const activeOAuthCredentials: SessionCredentials = {
    instanceType: "enterprise",
    baseUrl: "https://demo.stackenterprise.co",
    accessToken: "token",
    authSource: "oauth-pkce",
    accessTokenExpiresAt: FUTURE_EXPIRY,
    oauthScopes: ["read_access"],
  };

  it("rejects expired OAuth tokens", () => {
    const result = validateEnterpriseV3OAuthCredentials({
      ...activeOAuthCredentials,
      accessTokenExpiresAt: "2026-07-04T11:59:59.000Z",
    }, { now: NOW });

    expect(result.valid).toBe(false);
    expect(result.messages).toContain(EXPIRY_MESSAGE);
  });

  it("rejects blank OAuth token expiry values", () => {
    const result = validateEnterpriseV3OAuthCredentials({
      ...activeOAuthCredentials,
      accessTokenExpiresAt: "",
    }, { now: NOW });

    expect(result.valid).toBe(false);
    expect(result.messages).toContain(EXPIRY_MESSAGE);
  });

  it("rejects unparseable OAuth token expiry values", () => {
    const result = validateEnterpriseV3OAuthCredentials({
      ...activeOAuthCredentials,
      accessTokenExpiresAt: "not-a-date",
    }, { now: NOW });

    expect(result.valid).toBe(false);
    expect(result.messages).toContain(EXPIRY_MESSAGE);
  });

  it("rejects OAuth tokens without an expiry unless no_expiry was requested", () => {
    const result = validateEnterpriseV3OAuthCredentials({
      instanceType: "enterprise",
      baseUrl: "https://demo.stackenterprise.co",
      accessToken: "token",
      authSource: "oauth-pkce",
      oauthScopes: ["read_access"],
    }, { now: NOW });

    expect(result.valid).toBe(false);
    expect(result.messages).toContain(EXPIRY_MESSAGE);
  });

  it("accepts OAuth tokens without an expiry when the no_expiry scope was requested", () => {
    const result = validateEnterpriseV3OAuthCredentials({
      instanceType: "enterprise",
      baseUrl: "https://demo.stackenterprise.co",
      accessToken: "token",
      authSource: "oauth-pkce",
      oauthScopes: ["read_access", "no_expiry"],
    }, { now: NOW });

    expect(result).toEqual({ valid: true, messages: [] });
  });

  it("rejects OAuth tokens missing required scopes", () => {
    const result = validateEnterpriseV3OAuthCredentials(activeOAuthCredentials, {
      now: NOW,
      requiredScopes: ["write_access"],
    });

    expect(result.valid).toBe(false);
    expect(result.messages).toContain("Enterprise OAuth token is missing required scope: write_access.");
  });

  it.each([
    ["null credentials", null],
    [
      "Basic/Business PAT credentials",
      {
        instanceType: "basic-business",
        baseUrl: "https://stackoverflowteams.com/c/example-team",
        pat: "pat",
      },
    ],
    [
      "Enterprise OAuth credentials missing an access token",
      {
        instanceType: "enterprise",
        baseUrl: "https://demo.stackenterprise.co",
        authSource: "oauth-pkce",
      },
    ],
    [
      "Enterprise OAuth credentials with a blank access token",
      {
        instanceType: "enterprise",
        baseUrl: "https://demo.stackenterprise.co",
        accessToken: "   ",
        authSource: "oauth-pkce",
      },
    ],
    [
      "Enterprise credentials with a manual access token",
      {
        instanceType: "enterprise",
        baseUrl: "https://demo.stackenterprise.co",
        accessToken: "manual-token",
      },
    ],
  ] satisfies [string, SessionCredentials | null][])("rejects %s", (_label, credentials) => {
    const result = validateEnterpriseV3OAuthCredentials(credentials, { now: NOW });

    expect(result.valid).toBe(false);
    expect(result.messages).toContain(CONNECTION_REQUIRED_MESSAGE);
  });
});
