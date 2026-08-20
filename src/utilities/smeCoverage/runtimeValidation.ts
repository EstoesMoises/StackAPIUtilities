import type { ReportWarning } from "../../domain/types";
import type {
  SmeCoverageDecisionPack,
  SmeCoverageEvidenceRow,
  SmeCoverageMethodology,
  SmeCoverageSummary,
} from "./model";
import type { SmeCoverageRunResult } from "./runner";

const REQUIRED_DATASETS = ["tags", "questions", "tagSmeCounts"] as const;
const QUESTION_COUNT_BASES = [
  "Complete question enumeration",
  "All-time tag total",
  "Partial question sample",
  "Unavailable",
] as const;
const COVERAGE_TIERS = [
  "Immediate gap",
  "Critical under-coverage",
  "Light coverage",
  "Adequate coverage",
  "Not classified",
  "Low-demand uncovered",
  "Unknown",
] as const;
const DEMAND_QUALITIES = ["Complete", "Partial sample", "Invalid"] as const;
const SME_QUALITIES = ["Complete", "Unknown"] as const;

export function isTerminalSmeCoverageResult(value: unknown): value is SmeCoverageRunResult {
  if (!isRecord(value)) return false;
  if (value.utilityId !== "sme-coverage-analyzer" || value.utilityTitle !== "SME Coverage Analyzer") {
    return false;
  }
  if (!isStringArray(value.messages) || !isWarningArray(value.warnings)) return false;
  if (!Array.isArray(value.datasets) || value.datasets.length !== REQUIRED_DATASETS.length) return false;

  const seen = new Set<string>();
  for (const dataset of value.datasets) {
    if (!isRecord(dataset) || !isRequiredDatasetName(dataset.datasetName)) return false;
    if (seen.has(dataset.datasetName)) return false;
    seen.add(dataset.datasetName);
    if (!Array.isArray(dataset.records) || !dataset.records.every(isRecord)) return false;
    if (!isTerminalPagination(dataset.pagination)) return false;
  }

  return REQUIRED_DATASETS.every((datasetName) => seen.has(datasetName)) && isDecisionPack(value.decisionPack);
}

function isDecisionPack(value: unknown): value is SmeCoverageDecisionPack {
  if (!isRecord(value) || !isRecord(value.snapshot)) return false;
  const snapshot = value.snapshot;
  if (
    typeof snapshot.instanceHost !== "string" ||
    typeof snapshot.generatedAt !== "string" ||
    snapshot.scopeLabel !== "All-time demand · Current SME coverage" ||
    snapshot.collectionLabel !== "All available data collected" ||
    !["Complete", "Partial", "Empty"].includes(String(snapshot.completeness))
  ) {
    return false;
  }

  return (
    isWarningArray(value.warnings) &&
    isSummary(value.summary) &&
    typeof value.overview === "string" &&
    typeof value.assessment === "string" &&
    isRecord(value.findings) &&
    isEvidenceRowArray(value.findings.immediateGaps) &&
    isEvidenceRowArray(value.findings.criticalUnderCoverage) &&
    isEvidenceRowArray(value.findings.lightCoverage) &&
    isMethodology(value.methodology) &&
    isEvidenceRowArray(value.evidence)
  );
}

function isSummary(value: unknown): value is SmeCoverageSummary {
  if (!isRecord(value)) return false;
  return [
    value.tagsAnalyzed,
    value.tagsWithSmes,
    value.immediateGaps,
    value.criticalUnderCoverage,
    value.lightCoverage,
    value.unknownRows,
  ].every(isNonNegativeInteger);
}

function isEvidenceRowArray(value: unknown): value is SmeCoverageEvidenceRow[] {
  return Array.isArray(value) && value.every(isEvidenceRow);
}

function isEvidenceRow(value: unknown): value is SmeCoverageEvidenceRow {
  return (
    isRecord(value) &&
    typeof value.tagName === "string" &&
    isNullableFiniteNumber(value.pageViews) &&
    isNullableFiniteNumber(value.questionCount) &&
    includesValue(QUESTION_COUNT_BASES, value.questionCountBasis) &&
    isNullableFiniteNumber(value.smeCount) &&
    isNullableFiniteNumber(value.pageViewsPerSme) &&
    isNullableFiniteNumber(value.coveragePercentile) &&
    includesValue(COVERAGE_TIERS, value.coverageTier) &&
    typeof value.reason === "string" &&
    typeof value.recommendedAction === "string" &&
    includesValue(DEMAND_QUALITIES, value.demandQuality) &&
    includesValue(SME_QUALITIES, value.smeQuality)
  );
}

function isMethodology(value: unknown): value is SmeCoverageMethodology {
  return (
    isRecord(value) &&
    value.activityQuestionMinimum === 1 &&
    value.activityPageViewThresholdExclusive === 25 &&
    isNullableFiniteNumber(value.activeTagMedianPageViews) &&
    isNonNegativeInteger(value.coveredActiveSampleSize) &&
    isNullableFiniteNumber(value.p75PageViewsPerSme) &&
    isNullableFiniteNumber(value.p90PageViewsPerSme) &&
    typeof value.percentileSampleSufficient === "boolean" &&
    value.ratioFormula === "pageViews / smeCount" &&
    value.roundingRule === "Nearest whole page view for display; unrounded for calculation"
  );
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

function isTerminalPagination(value: unknown): boolean {
  return (
    isRecord(value) &&
    isNonNegativeInteger(value.pageCount) &&
    value.reachedMaxPages === false &&
    value.hasMore === false
  );
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function isNullableFiniteNumber(value: unknown): value is number | null {
  return value === null || (typeof value === "number" && Number.isFinite(value));
}

function isRequiredDatasetName(value: unknown): value is (typeof REQUIRED_DATASETS)[number] {
  return includesValue(REQUIRED_DATASETS, value);
}

function includesValue<const T extends readonly unknown[]>(values: T, value: unknown): value is T[number] {
  return values.includes(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
