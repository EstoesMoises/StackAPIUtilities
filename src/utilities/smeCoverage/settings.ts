import { getReportRunPreset } from "../../domain/reportRunPresets";
import type { ApiVolumeSettingsValue, ReportRunPresetId } from "../../domain/types";

const defaultPreset = getReportRunPreset("deep-audit");

export const DEFAULT_SME_COVERAGE_SETTINGS: ApiVolumeSettingsValue = {
  pageSize: defaultPreset.pageSize,
  maxPagesPerDataset: defaultPreset.maxPagesPerDataset,
  runPreset: defaultPreset.id,
};

export function applySmeCoveragePreset(
  settings: ApiVolumeSettingsValue,
  presetId: ReportRunPresetId,
): ApiVolumeSettingsValue {
  const preset = getReportRunPreset(presetId);

  return {
    ...settings,
    pageSize: preset.pageSize,
    maxPagesPerDataset: preset.maxPagesPerDataset,
    runPreset: preset.id,
  };
}

export function getSmeCoveragePresetDisclosure(presetId: ReportRunPresetId): string {
  const preset = getReportRunPreset(presetId);
  return `Collects tags, questions, and assigned-SME counts with pageSize ${preset.pageSize} and maxPagesPerDataset ${preset.maxPagesPerDataset}. A cap produces a partial sample.`;
}
