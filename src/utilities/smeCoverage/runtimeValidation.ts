import type { ReportWarning } from "../../domain/types";
import { parseCurrentSmeCoverageDecisionPack } from "./persistence";
import type {
  SmeCoverageRunDataset,
  SmeCoverageRunResult,
} from "./runner";

const REQUIRED_DATASETS = ["tags", "questions", "tagSmeCounts"] as const;

export function parseTerminalSmeCoverageResult(value: unknown): SmeCoverageRunResult | null {
  if (!isRecord(value)) return null;
  if (value.utilityId !== "sme-coverage-analyzer" || value.utilityTitle !== "SME Coverage Analyzer") {
    return null;
  }
  if (!isStringArray(value.messages) || !isWarningArray(value.warnings)) return null;
  if (!Array.isArray(value.datasets) || value.datasets.length !== REQUIRED_DATASETS.length) return null;

  const datasets: SmeCoverageRunDataset[] = [];
  const seen = new Set<string>();
  for (const dataset of value.datasets) {
    if (!isRecord(dataset) || !isRequiredDatasetName(dataset.datasetName)) return null;
    if (seen.has(dataset.datasetName)) return null;
    seen.add(dataset.datasetName);
    if (!Array.isArray(dataset.records) || !dataset.records.every(isRecord)) return null;
    const pagination = parseTerminalPagination(dataset.pagination);
    if (!pagination) return null;
    datasets.push({
      datasetName: dataset.datasetName,
      records: dataset.records as SmeCoverageRunDataset["records"],
      pagination,
    });
  }

  const decisionPack = parseCurrentSmeCoverageDecisionPack(value.decisionPack);
  if (
    !REQUIRED_DATASETS.every((datasetName) => seen.has(datasetName)) ||
    !decisionPack ||
    !warningsMatch(value.warnings, decisionPack.warnings)
  ) {
    return null;
  }

  return {
    utilityId: "sme-coverage-analyzer",
    utilityTitle: "SME Coverage Analyzer",
    datasets,
    messages: [...value.messages],
    warnings: decisionPack.warnings,
    decisionPack,
  };
}

function warningsMatch(left: readonly ReportWarning[], right: readonly ReportWarning[]): boolean {
  return left.length === right.length && left.every((warning, index) => {
    const expected = right[index];
    return (
      expected !== undefined &&
      warning.code === expected.code &&
      warning.message === expected.message &&
      warning.reportId === expected.reportId &&
      warning.utilityId === expected.utilityId
    );
  });
}

export function isTerminalSmeCoverageResult(value: unknown): value is SmeCoverageRunResult {
  return parseTerminalSmeCoverageResult(value) !== null;
}

function isWarningArray(value: unknown): value is ReportWarning[] {
  return Array.isArray(value) && value.every((warning) => (
    isRecord(warning) &&
    typeof warning.code === "string" &&
    typeof warning.message === "string" &&
    (warning.reportId === undefined || typeof warning.reportId === "string") &&
    (warning.utilityId === undefined || warning.utilityId === "sme-coverage-analyzer")
  ));
}

function parseTerminalPagination(value: unknown): SmeCoverageRunDataset["pagination"] | null {
  if (
    !isRecord(value) ||
    !isNonNegativeInteger(value.pageCount) ||
    value.reachedMaxPages !== false ||
    value.hasMore !== false
  ) {
    return null;
  }
  return { pageCount: value.pageCount, reachedMaxPages: false, hasMore: false };
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function isRequiredDatasetName(value: unknown): value is (typeof REQUIRED_DATASETS)[number] {
  return typeof value === "string" && REQUIRED_DATASETS.includes(value as (typeof REQUIRED_DATASETS)[number]);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
