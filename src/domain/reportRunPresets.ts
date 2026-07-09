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

export function getReportRunPresetForSettings(
  pageSize: number,
  maxPagesPerDataset: number,
): ReportRunPreset | undefined {
  return REPORT_RUN_PRESETS.find(
    (preset) => preset.pageSize === pageSize && preset.maxPagesPerDataset === maxPagesPerDataset,
  );
}

export function getReportRunPresetMaxRecords(id: ReportRunPresetId): number {
  const preset = getReportRunPreset(id);
  return getMaxRecordsForSettings(preset.pageSize, preset.maxPagesPerDataset);
}

export function getReportRunPresetRecordSummary(id: ReportRunPresetId): string {
  return getPrimaryGroupRecordSummary(getReportRunPresetMaxRecords(id));
}

export function getReportRunPresetDisclosure(id: ReportRunPresetId): string {
  const preset = getReportRunPreset(id);
  const maxRecords = getReportRunPresetMaxRecords(id);
  return `SME detail is separate: up to ${formatNumber(
    maxRecords,
  )} top-answerer records for each collected tag. Technical settings: pageSize ${preset.pageSize}, maxPagesPerDataset ${preset.maxPagesPerDataset}. ${preset.completenessTradeoff}`;
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

export function getMaxRecordsForSettings(pageSize: number, maxPagesPerDataset: number): number {
  return pageSize * maxPagesPerDataset;
}

export function getPrimaryGroupRecordSummary(maxRecords: number): string {
  const formatted = formatNumber(maxRecords);
  return `Up to ${formatted} users, ${formatted} tags, ${formatted} questions, and ${formatted} articles`;
}

function formatNumber(value: number): string {
  return value.toLocaleString("en-US");
}
