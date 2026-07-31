import { recordsToCsvWithHeaders } from "../../utils/downloads";
import type { SmeCoverageDecisionPack, SmeCoverageEvidenceRow } from "./model";

export const SME_COVERAGE_EVIDENCE_CSV_HEADERS = [
  "tag_name",
  "page_views",
  "question_count",
  "question_count_basis",
  "sme_count",
  "page_views_per_sme",
  "coverage_percentile",
  "coverage_tier",
  "reason",
  "recommended_action",
  "demand_quality",
  "sme_quality",
  "result_completeness",
  "completeness_warnings",
] as const;

export function buildSmeCoverageEvidenceCsv(pack: SmeCoverageDecisionPack): string {
  return recordsToCsvWithHeaders(
    SME_COVERAGE_EVIDENCE_CSV_HEADERS,
    pack.evidence.map((row) => toCsvRecord(row, pack)),
  );
}

export function buildSmeCoverageMarkdown(pack: SmeCoverageDecisionPack): string {
  return [
    "# SME Coverage Decision Pack",
    "",
    "## Snapshot",
    `- Instance host: ${pack.snapshot.instanceHost}`,
    `- Generated at: ${pack.snapshot.generatedAt}`,
    `- Scope: ${pack.snapshot.scopeLabel}`,
    `- Completeness: ${pack.snapshot.completeness}`,
    `- Page size: ${pack.snapshot.pageSize}`,
    `- Maximum pages per dataset: ${pack.snapshot.maxPagesPerDataset}`,
    `- Run preset: ${pack.snapshot.runPreset ?? "Unavailable"}`,
    "",
    "## Completeness warnings",
    ...renderWarnings(pack),
    "",
    "## Executive summary",
    `- Tags analyzed: ${pack.summary.tagsAnalyzed}`,
    `- Tags with SMEs: ${pack.summary.tagsWithSmes}`,
    `- Immediate no-SME gaps: ${pack.summary.immediateGaps}`,
    `- Critical under-coverage gaps: ${pack.summary.criticalUnderCoverage}`,
    `- Light SME coverage gaps: ${pack.summary.lightCoverage}`,
    `- Unknown rows: ${pack.summary.unknownRows}`,
    "",
    pack.overview,
    "",
    "## Copy-ready assessment",
    pack.assessment,
    "",
    "## Immediate no-SME risks",
    ...renderFindingSection(
      pack.findings.immediateGaps,
      "No immediate no-SME risks are listed in this decision pack.",
    ),
    "",
    "## Highest-demand critical gaps",
    ...renderFindingSection(
      pack.findings.criticalUnderCoverage,
      "No highest-demand critical gaps are listed in this decision pack.",
    ),
    "",
    "## Light SME coverage",
    ...renderFindingSection(
      pack.findings.lightCoverage,
      "No light SME coverage risks are listed in this decision pack.",
    ),
    "",
    "## Methodology",
    `- Active-tag minimum questions: ${pack.methodology.activityQuestionMinimum}`,
    `- Active-tag page-view threshold: more than ${pack.methodology.activityPageViewThresholdExclusive}`,
    `- Active-tag median page views: ${displayNumber(pack.methodology.activeTagMedianPageViews)}`,
    `- Eligible covered active-tag sample size: ${pack.methodology.coveredActiveSampleSize}`,
    `- 75th-percentile page views per SME: ${displayNumber(pack.methodology.p75PageViewsPerSme)}`,
    `- 90th-percentile page views per SME: ${displayNumber(pack.methodology.p90PageViewsPerSme)}`,
    `- Percentile sample sufficient: ${pack.methodology.percentileSampleSufficient ? "Yes" : "No"}`,
    `- Ratio formula: ${pack.methodology.ratioFormula}`,
    `- Rounding rule: ${pack.methodology.roundingRule}`,
  ].join("\n");
}

function toCsvRecord(
  row: SmeCoverageEvidenceRow,
  pack: SmeCoverageDecisionPack,
): Record<(typeof SME_COVERAGE_EVIDENCE_CSV_HEADERS)[number], unknown> {
  return {
    tag_name: row.tagName,
    page_views: row.pageViews,
    question_count: row.questionCount,
    question_count_basis: row.questionCountBasis,
    sme_count: row.smeCount,
    page_views_per_sme: row.pageViewsPerSme,
    coverage_percentile: row.coveragePercentile,
    coverage_tier: row.coverageTier,
    reason: row.reason,
    recommended_action: row.recommendedAction,
    demand_quality: row.demandQuality,
    sme_quality: row.smeQuality,
    result_completeness: pack.snapshot.completeness,
    completeness_warnings: pack.warnings
      .map((warning) => `${warning.code}: ${warning.message}`)
      .join(" | "),
  };
}

function renderWarnings(pack: SmeCoverageDecisionPack): readonly string[] {
  if (pack.warnings.length === 0) return ["No completeness warnings are listed in this decision pack."];
  return pack.warnings.map((warning) => `- ${warning.code}: ${warning.message}`);
}

function renderFindingSection(
  rows: readonly SmeCoverageEvidenceRow[],
  emptyState: string,
): readonly string[] {
  if (rows.length === 0) return [emptyState];
  return rows.map(renderFinding);
}

function renderFinding(row: SmeCoverageEvidenceRow): string {
  return [
    `- ${row.tagName}`,
    `Page views: ${displayNumber(row.pageViews)}`,
    `Questions: ${displayNumber(row.questionCount)}`,
    `Question-count basis: ${row.questionCountBasis}`,
    `SMEs: ${displayNumber(row.smeCount)}`,
    `Page views per SME: ${displayNumber(row.pageViewsPerSme)}`,
    `Coverage percentile: ${displayPercentile(row.coveragePercentile)}`,
    `Coverage tier: ${row.coverageTier}`,
    `Reason: ${row.reason}`,
    `Recommended action: ${row.recommendedAction}`,
    `Demand quality: ${row.demandQuality}`,
    `SME quality: ${row.smeQuality}`,
  ].join("; ");
}

function displayNumber(value: number | null): string {
  return value === null ? "Unavailable" : Math.round(value).toLocaleString("en-US");
}

function displayPercentile(value: number | null): string {
  return value === null ? "Unavailable" : `${Math.round(value)}%`;
}
