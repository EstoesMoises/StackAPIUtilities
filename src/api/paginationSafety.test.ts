import { describe, expect, it } from "vitest";
import { assertSafePaginationPage, PaginationSafetyError } from "./paginationSafety";

describe("assertSafePaginationPage", () => {
  it("allows a page at the safety limit", () => {
    expect(() => assertSafePaginationPage("Stack API v3", "/tags", 3, 3)).not.toThrow();
  });

  it("throws when a page exceeds the safety limit", () => {
    expect(() => assertSafePaginationPage("Stack API v3", "/tags", 4, 3)).toThrow(
      PaginationSafetyError,
    );
    expect(() => assertSafePaginationPage("Stack API v3", "/tags", 4, 3)).toThrow(
      "Stack API v3 pagination for /tags exceeded the internal safety limit of 3 pages. No complete result was produced.",
    );
  });
});
