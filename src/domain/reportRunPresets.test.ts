import { describe, expect, it } from "vitest";
import {
  DEFAULT_REPORT_RUN_PRESET_ID,
  REPORT_RUN_PRESETS,
  applyReportRunPreset,
  getReportRunPreset,
  getReportRunPresetDisclosure,
  getReportRunPresetEstimatedTotalRecords,
  getReportRunPresetMaxRecords,
  getReportRunPresetRecordSummary,
} from "./reportRunPresets";

describe("report run presets", () => {
  it("uses Standard report as the default preset", () => {
    expect(DEFAULT_REPORT_RUN_PRESET_ID).toBe("standard");
    expect(getReportRunPreset(DEFAULT_REPORT_RUN_PRESET_ID)).toEqual(
      expect.objectContaining({
        id: "standard",
        label: "Standard report",
        pageSize: 100,
        maxPagesPerDataset: 5,
      }),
    );
  });

  it("calculates the maximum requested records per dataset", () => {
    expect(getReportRunPresetMaxRecords("quick-sample")).toBe(50);
    expect(getReportRunPresetMaxRecords("standard")).toBe(500);
    expect(getReportRunPresetMaxRecords("deep-audit")).toBe(2000);
  });

  it("calculates the estimated total records for Tag Report presets", () => {
    expect(getReportRunPresetEstimatedTotalRecords("quick-sample")).toBe(250);
    expect(getReportRunPresetEstimatedTotalRecords("standard")).toBe(2500);
    expect(getReportRunPresetEstimatedTotalRecords("deep-audit")).toBe(10000);
    expect(getReportRunPresetRecordSummary("standard")).toBe(
      "Up to 2,500 estimated records across 5 Tag Report data groups",
    );
  });

  it("discloses technical settings in user-facing copy", () => {
    expect(getReportRunPresetDisclosure("deep-audit")).toBe(
      "2,000 records per data group across 5 Tag Report data groups. Technical settings: pageSize 100, maxPagesPerDataset 20. SME detail can add up to 2,000 top-answerer records for each collected tag. Slower, but reduces the chance of capped results.",
    );
  });

  it("applies preset volume settings to an existing report scope", () => {
    expect(
      applyReportRunPreset(
        {
          current: { startDate: "2026-01-01" },
          pageSize: 50,
          maxPagesPerDataset: 1,
          runPreset: "quick-sample",
        },
        "deep-audit",
      ),
    ).toEqual({
      current: { startDate: "2026-01-01" },
      pageSize: 100,
      maxPagesPerDataset: 20,
      runPreset: "deep-audit",
    });
  });

  it("keeps the expected preset ordering", () => {
    expect(REPORT_RUN_PRESETS.map((preset) => preset.id)).toEqual([
      "quick-sample",
      "standard",
      "deep-audit",
    ]);
  });
});
