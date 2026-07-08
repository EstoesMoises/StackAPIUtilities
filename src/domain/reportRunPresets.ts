import type { ReportRunPresetId, ReportRunScope } from "./types";

interface ReportRunPreset {
  id: ReportRunPresetId;
  label: string;
  shortDescription: string;
  completenessTradeoff: string;
  pageSize: number;
  maxPagesPerDataset: number;
}

export const REPORT_RUN_PRESETS: readonly ReportRunPreset[] = [
  {
    id: "quick-sample",
    label: "Quick sample",
    shortDescription: "Fast preview to confirm credentials, scope, and data shape.",
    completenessTradeoff: "Fastest option; use only to preview data shape.",
    pageSize: 50,
    maxPagesPerDataset: 1,
  },
  {
    id: "standard",
    label: "Standard report",
    shortDescription: "Balanced default for normal Tag Report use.",
    completenessTradeoff: "Balanced default for normal reports.",
    pageSize: 100,
    maxPagesPerDataset: 5,
  },
  {
    id: "deep-audit",
    label: "Deep audit",
    shortDescription: "More complete extraction when longer runtime is acceptable.",
    completenessTradeoff: "Slower, but reduces the chance of capped results.",
    pageSize: 100,
    maxPagesPerDataset: 20,
  },
];

export const DEFAULT_REPORT_RUN_PRESET_ID: ReportRunPresetId = "standard";

export function getReportRunPreset(id: ReportRunPresetId): ReportRunPreset {
  return REPORT_RUN_PRESETS.find((preset) => preset.id === id) ?? REPORT_RUN_PRESETS[1];
}

export function getReportRunPresetMaxRecords(id: ReportRunPresetId): number {
  const preset = getReportRunPreset(id);
  return preset.pageSize * preset.maxPagesPerDataset;
}

export function getReportRunPresetDisclosure(id: ReportRunPresetId): string {
  const preset = getReportRunPreset(id);
  return `Requests up to ${getReportRunPresetMaxRecords(id).toLocaleString(
    "en-US",
  )} records per dataset with pageSize ${preset.pageSize} and maxPagesPerDataset ${preset.maxPagesPerDataset}. ${preset.completenessTradeoff}`;
}

export function applyReportRunPreset(
  scope: ReportRunScope,
  presetId: ReportRunPresetId,
): ReportRunScope {
  const preset = getReportRunPreset(presetId);

  return {
    ...scope,
    pageSize: preset.pageSize,
    maxPagesPerDataset: preset.maxPagesPerDataset,
    runPreset: preset.id,
  };
}
