import { describe, expect, it } from "vitest";
import {
  applySmeCoveragePreset,
  DEFAULT_SME_COVERAGE_SETTINGS,
  getSmeCoveragePresetDisclosure,
} from "./settings";

describe("SME Coverage settings", () => {
  it("defaults to the Deep audit preset", () => {
    expect(DEFAULT_SME_COVERAGE_SETTINGS).toEqual({
      pageSize: 100,
      maxPagesPerDataset: 20,
      runPreset: "deep-audit",
    });
  });

  it("applies existing API volume presets", () => {
    expect(applySmeCoveragePreset(DEFAULT_SME_COVERAGE_SETTINGS, "quick-sample")).toEqual({
      pageSize: 50,
      maxPagesPerDataset: 1,
      runPreset: "quick-sample",
    });
  });

  it("discloses its source datasets and capped-sample consequence", () => {
    expect(getSmeCoveragePresetDisclosure("quick-sample")).toContain("tags, questions, and assigned-SME counts");
    expect(getSmeCoveragePresetDisclosure("quick-sample")).toContain("partial sample");
  });
});
