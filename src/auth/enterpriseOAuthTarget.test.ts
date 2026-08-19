import { describe, expect, it } from "vitest";
import {
  isSupportedEnterpriseOAuthTarget,
  normalizeOAuthBaseUrl,
} from "./enterpriseOAuthTarget";

describe("enterpriseOAuthTarget", () => {
  it("accepts HTTPS Stack Enterprise OAuth targets", () => {
    expect(isSupportedEnterpriseOAuthTarget("https://demo.stackenterprise.co/path?x=1")).toBe(
      true,
    );
    expect(isSupportedEnterpriseOAuthTarget("https://stackenterprise.co")).toBe(true);
  });

  it("rejects unsupported Enterprise OAuth targets", () => {
    expect(isSupportedEnterpriseOAuthTarget("http://demo.stackenterprise.co")).toBe(false);
    expect(isSupportedEnterpriseOAuthTarget("https://example.com")).toBe(false);
    expect(isSupportedEnterpriseOAuthTarget("not a url")).toBe(false);
  });

  it("normalizes an OAuth base URL to its origin", () => {
    expect(normalizeOAuthBaseUrl("https://demo.stackenterprise.co/path?x=1")).toBe(
      "https://demo.stackenterprise.co",
    );
  });
});
