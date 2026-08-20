import { describe, expect, it } from "vitest";
import {
  DEFAULT_REPORT_RUN_SCOPE,
  dateToUnixSeconds,
  formatPeriodLabel,
  validateApiVolumeSettings,
  validateReportRunScope,
} from "./reportScope";

describe("report scope", () => {
  it("defaults to all available history with no collection-depth configuration", () => {
    expect(DEFAULT_REPORT_RUN_SCOPE).toEqual({ current: {} });
  });

  it("validates only current and comparison date periods", () => {
    expect(
      validateReportRunScope({
        current: { startDate: "2026-04-30", endDate: "2026-04-01" },
        comparison: { startDate: "not-a-date", endDate: "2026-03-01" },
      }),
    ).toEqual({
      valid: false,
      messages: [
        "Current period end date must be on or after its start date.",
        "Comparison period start date must use YYYY-MM-DD.",
      ],
    });
  });

  it("validates reusable API volume settings", () => {
    expect(validateApiVolumeSettings({ pageSize: 0, maxPagesPerDataset: 0 })).toEqual({
      valid: false,
      messages: [
        "Page size must be between 1 and 100.",
        "Max pages per dataset must be at least 1.",
      ],
    });
  });

  it("converts YYYY-MM-DD dates to Stack API epoch seconds", () => {
    expect(dateToUnixSeconds("1970-01-02")).toBe(86400);
  });

  it("formats explicit and all-history period labels", () => {
    expect(formatPeriodLabel({ startDate: "2026-01-01", endDate: "2026-03-31" })).toBe(
      "2026-01-01 to 2026-03-31",
    );
    expect(formatPeriodLabel({})).toBe("All available history");
  });
});
