import { describe, expect, it } from "vitest";
import type { ReportId } from "../domain/types";
import { normalizeInstanceUrl, validateCredentialsForReport } from "./credentialRules";

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
      accessToken: "token",
    });

    expect(result.valid).toBe(false);
    expect(result.messages).toContain("WebHook Report is not available for the selected instance type.");
  });

  it("requires an access token for Basic/Business live API reports", () => {
    const result = validateCredentialsForReport("tag-report", {
      instanceType: "basic-business",
      baseUrl: "https://stackoverflowteams.com/c/example-team",
    });

    expect(result.valid).toBe(false);
    expect(result.messages).toContain("Access token or PAT is required for Basic/Business API calls.");
  });

  it("requires an API key for Enterprise reports that use Stack API v2.3", () => {
    const result = validateCredentialsForReport("api-user-report", {
      instanceType: "enterprise",
      baseUrl: "https://demo.stackenterprise.co",
      accessToken: "token",
    });

    expect(result.valid).toBe(false);
    expect(result.messages).toContain("API key is required for Stack API v2.3 Enterprise calls.");
  });

  it("requires an API key and access token for Enterprise reports that use both v2 and v3", () => {
    const result = validateCredentialsForReport("api-user-report", {
      instanceType: "enterprise",
      baseUrl: "https://demo.stackenterprise.co",
      apiKey: "key",
    });

    expect(result.valid).toBe(false);
    expect(result.messages).toContain("Access token is required for Stack API v3 calls.");
  });
});
