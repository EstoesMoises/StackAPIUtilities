import { describe, expect, it } from "vitest";
import {
  DEFAULT_REPORT_RUN_PRESET_ID,
  REPORT_RUN_PRESETS,
  applyReportRunPreset,
  getReportRunPreset,
  getReportRunPresetDisclosure,
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

  it("describes primary Tag Report record limits without blending them into one total", () => {
    expect(getReportRunPresetRecordSummary("quick-sample")).toBe(
      "Up to 50 users, 50 tags, 50 questions, and 50 articles",
    );
    expect(getReportRunPresetRecordSummary("standard")).toBe(
      "Up to 500 users, 500 tags, 500 questions, and 500 articles",
    );
    expect(getReportRunPresetRecordSummary("deep-audit")).toBe(
      "Up to 2,000 users, 2,000 tags, 2,000 questions, and 2,000 articles",
    );
  });

  it("discloses technical settings in user-facing copy", () => {
    expect(getReportRunPresetDisclosure("deep-audit")).toBe(
      "SME detail is separate: up to 2,000 top-answerer records for each collected tag. Technical settings: pageSize 100, maxPagesPerDataset 20. Slower, but reduces the chance of capped results.",
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
