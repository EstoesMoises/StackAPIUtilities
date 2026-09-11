import { describe, expect, it } from "vitest";
import {
  isSupportedEnterpriseOAuthTarget,
  normalizeOAuthBaseUrl,
} from "./enterpriseOAuthTarget";

describe("enterpriseOAuthTarget", () => {
  it("accepts HTTPS Stack Enterprise and custom-domain OAuth targets", () => {
    expect(isSupportedEnterpriseOAuthTarget("https://demo.stackenterprise.co/path?x=1")).toBe(
      true,
    );
    expect(isSupportedEnterpriseOAuthTarget("https://stackenterprise.co")).toBe(true);
    expect(isSupportedEnterpriseOAuthTarget("https://stackoverflow.microsoft.com")).toBe(true);
  });

  it("rejects unsupported Enterprise OAuth targets", () => {
    expect(isSupportedEnterpriseOAuthTarget("http://demo.stackenterprise.co")).toBe(false);
    expect(isSupportedEnterpriseOAuthTarget("https://stackoverflowteams.com/c/example-team")).toBe(false);
    expect(isSupportedEnterpriseOAuthTarget("https://user@stackoverflow.microsoft.com")).toBe(false);
    expect(isSupportedEnterpriseOAuthTarget("https://@stackoverflow.microsoft.com")).toBe(false);
    expect(isSupportedEnterpriseOAuthTarget("https://stackoverflow.microsoft.com:8443")).toBe(false);
    expect(isSupportedEnterpriseOAuthTarget("https://stackoverflow.microsoft.com:443")).toBe(false);
    expect(isSupportedEnterpriseOAuthTarget("https://localhost")).toBe(false);
    expect(isSupportedEnterpriseOAuthTarget("https://tenant.localhost")).toBe(false);
    expect(isSupportedEnterpriseOAuthTarget("https://127.0.0.1")).toBe(false);
    expect(isSupportedEnterpriseOAuthTarget("https://[::1]")).toBe(false);
    expect(isSupportedEnterpriseOAuthTarget("https:///stackoverflow.microsoft.com")).toBe(false);
    expect(isSupportedEnterpriseOAuthTarget("not a url")).toBe(false);
  });

  it("normalizes an OAuth base URL to its origin", () => {
    expect(normalizeOAuthBaseUrl("https://demo.stackenterprise.co/path?x=1")).toBe(
      "https://demo.stackenterprise.co",
    );
  });
});
