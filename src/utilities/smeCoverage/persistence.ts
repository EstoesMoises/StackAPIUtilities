import { reportRegistry } from "../../domain/reportRegistry";
import type { ReportId, ReportRunPresetId, ReportWarning } from "../../domain/types";
import type {
  CoverageTier,
  DemandQuality,
  QuestionCountBasis,
  SmeCoverageCompleteness,
  SmeCoverageDecisionPack,
  SmeCoverageEvidenceRow,
  SmeCoverageMethodology,
  SmeCoverageSnapshot,
  SmeCoverageSummary,
  SmeQuality,
} from "./model";
import { SME_COVERAGE_PARTIAL_SAMPLE_WARNING } from "./decisionPack";
import { DEFAULT_SME_COVERAGE_SETTINGS } from "./settings";

const completenessValues = new Set<SmeCoverageCompleteness>(["Complete", "Partial", "Empty"]);
const questionCountBases = new Set<QuestionCountBasis>([
  "Complete question enumeration",
  "All-time tag total",
  "Partial question sample",
  "Unavailable",
]);
const demandQualities = new Set<DemandQuality>(["Complete", "Partial sample", "Invalid"]);
const smeQualities = new Set<SmeQuality>(["Complete", "Unknown"]);
const coverageTiers = new Set<CoverageTier>([
  "Immediate gap",
  "Critical under-coverage",
  "Light coverage",
  "Adequate coverage",
  "Not classified",
  "Low-demand uncovered",
  "Unknown",
]);
const reportRunPresetIds = new Set<ReportRunPresetId>(["quick-sample", "standard", "deep-audit"]);
const reportIds = new Set<ReportId>(reportRegistry.map((report) => report.id));

export function parseSmeCoverageDecisionPack(value: unknown): SmeCoverageDecisionPack | null {
  if (!isRecord(value) || typeof value.overview !== "string" || typeof value.assessment !== "string") {
    return null;
  }

  const snapshot = parseSnapshot(value.snapshot);
  const warnings = parseWarnings(value.warnings);
  const summary = parseSummary(value.summary);
  const methodology = parseMethodology(value.methodology);
  const evidence = parseEvidence(value.evidence);

  if (!snapshot || !warnings || !summary || !methodology || !evidence || !isRecord(value.findings)) {
    return null;
  }

  const evidenceByTag = new Map<string, SmeCoverageEvidenceRow>();
  for (const row of evidence) {
    if (evidenceByTag.has(row.tagName)) return null;
    evidenceByTag.set(row.tagName, row);
  }

  const immediateGaps = parseFindingList(value.findings.immediateGaps, "Immediate gap", evidenceByTag);
  const criticalUnderCoverage = parseFindingList(
    value.findings.criticalUnderCoverage,
    "Critical under-coverage",
    evidenceByTag,
  );
  const lightCoverage = parseFindingList(value.findings.lightCoverage, "Light coverage", evidenceByTag);

  if (
    !immediateGaps ||
    !criticalUnderCoverage ||
    !lightCoverage ||
    !findingListMatchesEvidenceTier(immediateGaps, evidence, "Immediate gap") ||
    !findingListMatchesEvidenceTier(criticalUnderCoverage, evidence, "Critical under-coverage") ||
    !findingListMatchesEvidenceTier(lightCoverage, evidence, "Light coverage") ||
    !summaryMatchesEvidence(summary, evidence) ||
    !isCoherentDecisionPack(snapshot, methodology, evidence, value.overview, value.assessment)
  ) {
    return null;
  }

  return Object.freeze({
    snapshot,
    warnings: migratePartialSampleWarnings(snapshot, warnings),
    summary,
    overview: value.overview,
    assessment: value.assessment,
    findings: Object.freeze({ immediateGaps, criticalUnderCoverage, lightCoverage }),
    methodology,
    evidence,
  });
}

const analyzerWarningCodes = new Set([
  "sme-coverage.invalid-demand",
  "sme-coverage.unknown-sme-coverage",
  "sme-coverage.insufficient-covered-sample",
]);

function migratePartialSampleWarnings(
  snapshot: SmeCoverageSnapshot,
  warnings: readonly ReportWarning[],
): readonly ReportWarning[] {
  const hasPartialSampleWarning = warnings.some(
    (warning) => warning.code === SME_COVERAGE_PARTIAL_SAMPLE_WARNING.code,
  );
  if (!hasPartialSampleWarning && !isConfiguredPartialSample(snapshot)) return warnings;

  const migrated = warnings.filter(
    (warning) => warning.code !== SME_COVERAGE_PARTIAL_SAMPLE_WARNING.code,
  );
  const analyzerWarningIndex = migrated.findIndex((warning) => analyzerWarningCodes.has(warning.code));
  migrated.splice(
    analyzerWarningIndex === -1 ? migrated.length : analyzerWarningIndex,
    0,
    SME_COVERAGE_PARTIAL_SAMPLE_WARNING,
  );
  return Object.freeze(migrated);
}

function parseSnapshot(value: unknown): SmeCoverageSnapshot | null {
  if (
    !isRecord(value) ||
    typeof value.instanceHost !== "string" ||
    typeof value.generatedAt !== "string" ||
    value.scopeLabel !== "All-time demand · Current SME coverage" ||
    !isSetMember(value.completeness, completenessValues) ||
    !isNonnegativeFinite(value.pageSize) ||
    !isNonnegativeFinite(value.maxPagesPerDataset) ||
    (typeof value.runPreset !== "undefined" && !isSetMember(value.runPreset, reportRunPresetIds))
  ) {
    return null;
  }

  const snapshot = {
    instanceHost: value.instanceHost,
    generatedAt: value.generatedAt,
    scopeLabel: "All-time demand · Current SME coverage",
    completeness: value.completeness,
    pageSize: value.pageSize,
    maxPagesPerDataset: value.maxPagesPerDataset,
    ...(isSetMember(value.runPreset, reportRunPresetIds) ? { runPreset: value.runPreset } : {}),
  } satisfies SmeCoverageSnapshot;
  return Object.freeze(snapshot);
}

function parseSummary(value: unknown): SmeCoverageSummary | null {
  if (
    !isRecord(value) ||
    !isNonnegativeInteger(value.tagsAnalyzed) ||
    !isNonnegativeInteger(value.tagsWithSmes) ||
    !isNonnegativeInteger(value.immediateGaps) ||
    !isNonnegativeInteger(value.criticalUnderCoverage) ||
    !isNonnegativeInteger(value.lightCoverage) ||
    !isNonnegativeInteger(value.unknownRows)
  ) {
    return null;
  }

  return Object.freeze({
    tagsAnalyzed: value.tagsAnalyzed,
    tagsWithSmes: value.tagsWithSmes,
    immediateGaps: value.immediateGaps,
    criticalUnderCoverage: value.criticalUnderCoverage,
    lightCoverage: value.lightCoverage,
    unknownRows: value.unknownRows,
  });
}

function parseMethodology(value: unknown): SmeCoverageMethodology | null {
  if (
    !isRecord(value) ||
    value.activityQuestionMinimum !== 1 ||
    value.activityPageViewThresholdExclusive !== 25 ||
    !isNullableNonnegativeFinite(value.activeTagMedianPageViews) ||
    !isNonnegativeFinite(value.coveredActiveSampleSize) ||
    !isNullableNonnegativeFinite(value.p75PageViewsPerSme) ||
    !isNullableNonnegativeFinite(value.p90PageViewsPerSme) ||
    typeof value.percentileSampleSufficient !== "boolean" ||
    value.ratioFormula !== "pageViews / smeCount" ||
    value.roundingRule !== "Nearest whole page view for display; unrounded for calculation"
  ) {
    return null;
  }

  return Object.freeze({
    activityQuestionMinimum: 1,
    activityPageViewThresholdExclusive: 25,
    activeTagMedianPageViews: value.activeTagMedianPageViews,
    coveredActiveSampleSize: value.coveredActiveSampleSize,
    p75PageViewsPerSme: value.p75PageViewsPerSme,
    p90PageViewsPerSme: value.p90PageViewsPerSme,
    percentileSampleSufficient: value.percentileSampleSufficient,
    ratioFormula: "pageViews / smeCount",
    roundingRule: "Nearest whole page view for display; unrounded for calculation",
  });
}

function parseEvidence(value: unknown): readonly SmeCoverageEvidenceRow[] | null {
  if (!Array.isArray(value)) return null;
  const evidence: SmeCoverageEvidenceRow[] = [];
  for (const candidate of value) {
    const row = parseEvidenceRow(candidate);
    if (!row) return null;
    evidence.push(row);
  }
  return Object.freeze(evidence);
}

function parseEvidenceRow(value: unknown): SmeCoverageEvidenceRow | null {
  if (
    !isRecord(value) ||
    typeof value.tagName !== "string" ||
    value.tagName.length === 0 ||
    !isNullableNonnegativeFinite(value.pageViews) ||
    !isNullableNonnegativeFinite(value.questionCount) ||
    !isSetMember(value.questionCountBasis, questionCountBases) ||
    !isNullableNonnegativeFinite(value.smeCount) ||
    !isNullableNonnegativeFinite(value.pageViewsPerSme) ||
    !isNullablePercentile(value.coveragePercentile) ||
    !isSetMember(value.coverageTier, coverageTiers) ||
    typeof value.reason !== "string" ||
    typeof value.recommendedAction !== "string" ||
    !isSetMember(value.demandQuality, demandQualities) ||
    !isSetMember(value.smeQuality, smeQualities)
  ) {
    return null;
  }

  return Object.freeze({
    tagName: value.tagName,
    pageViews: value.pageViews,
    questionCount: value.questionCount,
    questionCountBasis: value.questionCountBasis,
    smeCount: value.smeCount,
    pageViewsPerSme: value.pageViewsPerSme,
    coveragePercentile: value.coveragePercentile,
    coverageTier: value.coverageTier,
    reason: value.reason,
    recommendedAction: value.recommendedAction,
    demandQuality: value.demandQuality,
    smeQuality: value.smeQuality,
  });
}

function parseFindingList(
  value: unknown,
  expectedTier: CoverageTier,
  evidenceByTag: ReadonlyMap<string, SmeCoverageEvidenceRow>,
): readonly SmeCoverageEvidenceRow[] | null {
  if (!Array.isArray(value)) return null;
  const findings: SmeCoverageEvidenceRow[] = [];
  const seen = new Set<string>();
  for (const candidate of value) {
    const parsedCandidate = parseEvidenceRow(candidate);
    if (!parsedCandidate || parsedCandidate.coverageTier !== expectedTier || seen.has(parsedCandidate.tagName)) {
      return null;
    }
    const canonical = evidenceByTag.get(parsedCandidate.tagName);
    if (!canonical || !sameEvidenceRow(canonical, parsedCandidate)) return null;
    seen.add(parsedCandidate.tagName);
    findings.push(canonical);
  }
  return Object.freeze(findings);
}

function parseWarnings(value: unknown): readonly ReportWarning[] | null {
  if (!Array.isArray(value)) return null;
  const warnings: ReportWarning[] = [];
  for (const candidate of value) {
    const warning = parseWarning(candidate);
    if (!warning) return null;
    warnings.push(warning);
  }
  return Object.freeze(warnings);
}

function parseWarning(value: unknown): ReportWarning | null {
  if (
    !isRecord(value) ||
    typeof value.code !== "string" ||
    typeof value.message !== "string" ||
    (typeof value.reportId !== "undefined" && !isSetMember(value.reportId, reportIds)) ||
    (typeof value.utilityId !== "undefined" && value.utilityId !== "sme-coverage-analyzer") ||
    (typeof value.reportId !== "undefined" && typeof value.utilityId !== "undefined")
  ) {
    return null;
  }
  const warning: ReportWarning = { code: value.code, message: value.message };
  if (isSetMember(value.reportId, reportIds)) warning.reportId = value.reportId;
  if (value.utilityId === "sme-coverage-analyzer") warning.utilityId = value.utilityId;
  return Object.freeze(warning);
}

function summaryMatchesEvidence(
  summary: SmeCoverageSummary,
  evidence: readonly SmeCoverageEvidenceRow[],
): boolean {
  return (
    summary.tagsAnalyzed === evidence.length &&
    summary.tagsWithSmes === evidence.filter((row) => row.smeQuality === "Complete" && row.smeCount !== null && row.smeCount >= 1).length &&
    summary.immediateGaps === evidence.filter((row) => row.coverageTier === "Immediate gap").length &&
    summary.criticalUnderCoverage === evidence.filter((row) => row.coverageTier === "Critical under-coverage").length &&
    summary.lightCoverage === evidence.filter((row) => row.coverageTier === "Light coverage").length &&
    summary.unknownRows === evidence.filter((row) => row.coverageTier === "Unknown").length
  );
}

function findingListMatchesEvidenceTier(
  findings: readonly SmeCoverageEvidenceRow[],
  evidence: readonly SmeCoverageEvidenceRow[],
  tier: CoverageTier,
): boolean {
  const expected = evidence.filter((row) => row.coverageTier === tier);
  return findings.length === expected.length && findings.every((row, index) => row === expected[index]);
}

function sameEvidenceRow(left: SmeCoverageEvidenceRow, right: SmeCoverageEvidenceRow): boolean {
  return (
    left.tagName === right.tagName &&
    left.pageViews === right.pageViews &&
    left.questionCount === right.questionCount &&
    left.questionCountBasis === right.questionCountBasis &&
    left.smeCount === right.smeCount &&
    left.pageViewsPerSme === right.pageViewsPerSme &&
    left.coveragePercentile === right.coveragePercentile &&
    left.coverageTier === right.coverageTier &&
    left.reason === right.reason &&
    left.recommendedAction === right.recommendedAction &&
    left.demandQuality === right.demandQuality &&
    left.smeQuality === right.smeQuality
  );
}

function isCoherentDecisionPack(
  snapshot: SmeCoverageSnapshot,
  methodology: SmeCoverageMethodology,
  evidence: readonly SmeCoverageEvidenceRow[],
  overview: string,
  assessment: string,
): boolean {
  const activePageViews = evidence
    .filter(isActiveEvidenceRow)
    .map((row) => row.pageViews as number);
  const eligibleCoveredRows = evidence.filter(isEligibleCoveredActiveRow);
  const sampleRatios = eligibleCoveredRows.map((row) => row.pageViewsPerSme as number);
  const percentileSampleSufficient = sampleRatios.length >= 4;
  const p75PageViewsPerSme = nearestRank(sampleRatios, 0.75);
  const p90PageViewsPerSme = nearestRank(sampleRatios, 0.9);

  if (
    methodology.coveredActiveSampleSize !== sampleRatios.length ||
    methodology.percentileSampleSufficient !== percentileSampleSufficient ||
    methodology.activeTagMedianPageViews !== conventionalMedian(activePageViews) ||
    methodology.p75PageViewsPerSme !== p75PageViewsPerSme ||
    methodology.p90PageViewsPerSme !== p90PageViewsPerSme
  ) {
    return false;
  }

  for (const row of evidence) {
    const expectedRatio =
      row.smeCount !== null && row.smeCount >= 1 && row.pageViews !== null
        ? row.pageViews / row.smeCount
        : null;
    if (row.pageViewsPerSme !== expectedRatio) return false;

    const expectedPercentile =
      percentileSampleSufficient && isEligibleCoveredActiveRow(row) && row.pageViewsPerSme !== null
        ? (sampleRatios.filter((ratio) => ratio <= row.pageViewsPerSme!).length / sampleRatios.length) * 100
        : null;
    if (row.coveragePercentile !== expectedPercentile) return false;

    const expectedTier = classifyCoverageTier(
      row,
      percentileSampleSufficient,
      methodology.activeTagMedianPageViews,
      p75PageViewsPerSme,
      p90PageViewsPerSme,
    );
    if (row.coverageTier !== expectedTier) return false;
  }

  const configuredAsPartialSample = isConfiguredPartialSample(snapshot);
  if (configuredAsPartialSample) {
    return (
      snapshot.completeness === "Partial" &&
      overview.includes("partial sample") &&
      assessment.includes("partial sample")
    );
  }

  if (evidence.length === 0) return snapshot.completeness !== "Complete";
  if (snapshot.completeness === "Empty") return false;
  if (snapshot.completeness === "Complete") {
    return (
      percentileSampleSufficient &&
      evidence.every((row) => row.demandQuality === "Complete" && row.smeQuality === "Complete")
    );
  }
  return true;
}

function isConfiguredPartialSample(snapshot: SmeCoverageSnapshot): boolean {
  return (
    snapshot.runPreset !== DEFAULT_SME_COVERAGE_SETTINGS.runPreset ||
    snapshot.pageSize !== DEFAULT_SME_COVERAGE_SETTINGS.pageSize ||
    snapshot.maxPagesPerDataset !== DEFAULT_SME_COVERAGE_SETTINGS.maxPagesPerDataset
  );
}

function isActiveEvidenceRow(row: SmeCoverageEvidenceRow): boolean {
  return (
    row.questionCount !== null &&
    row.pageViews !== null &&
    (row.questionCount >= 1 || row.pageViews > 25)
  );
}

function isEligibleCoveredActiveRow(row: SmeCoverageEvidenceRow): boolean {
  return (
    isActiveEvidenceRow(row) &&
    row.demandQuality !== "Invalid" &&
    row.smeQuality === "Complete" &&
    row.smeCount !== null &&
    row.smeCount >= 1 &&
    row.pageViewsPerSme !== null
  );
}

function classifyCoverageTier(
  row: SmeCoverageEvidenceRow,
  percentileSampleSufficient: boolean,
  activeTagMedianPageViews: number | null,
  p75PageViewsPerSme: number | null,
  p90PageViewsPerSme: number | null,
): CoverageTier {
  if (row.demandQuality === "Invalid" || row.smeQuality === "Unknown") return "Unknown";
  if (row.smeCount === 0 && isActiveEvidenceRow(row)) return "Immediate gap";
  if (row.smeCount === 0 && row.questionCount === 0 && row.pageViews !== null && row.pageViews <= 25) {
    return "Low-demand uncovered";
  }
  if (row.smeCount !== null && row.smeCount >= 1 && !percentileSampleSufficient) {
    return "Not classified";
  }
  if (
    row.smeCount !== null &&
    row.smeCount >= 1 &&
    row.pageViews !== null &&
    activeTagMedianPageViews !== null &&
    row.pageViews >= activeTagMedianPageViews &&
    row.pageViewsPerSme !== null &&
    p90PageViewsPerSme !== null &&
    row.pageViewsPerSme >= p90PageViewsPerSme
  ) {
    return "Critical under-coverage";
  }
  if (
    row.smeCount !== null &&
    row.smeCount >= 1 &&
    row.pageViews !== null &&
    activeTagMedianPageViews !== null &&
    row.pageViews >= activeTagMedianPageViews &&
    row.pageViewsPerSme !== null &&
    p75PageViewsPerSme !== null &&
    p90PageViewsPerSme !== null &&
    row.pageViewsPerSme >= p75PageViewsPerSme &&
    row.pageViewsPerSme < p90PageViewsPerSme
  ) {
    return "Light coverage";
  }
  return "Adequate coverage";
}

function nearestRank(values: readonly number[], percentile: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const rank = Math.min(sorted.length, Math.max(1, Math.ceil(percentile * sorted.length)));
  return sorted[rank - 1] ?? null;
}

function conventionalMedian(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle] ?? null
    : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSetMember<T extends string>(value: unknown, values: ReadonlySet<T>): value is T {
  return typeof value === "string" && values.has(value as T);
}

function isNonnegativeFinite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isNonnegativeInteger(value: unknown): value is number {
  return isNonnegativeFinite(value) && Number.isInteger(value);
}

function isNullableNonnegativeFinite(value: unknown): value is number | null {
  return value === null || isNonnegativeFinite(value);
}

function isNullablePercentile(value: unknown): value is number | null {
  return value === null || (isNonnegativeFinite(value) && value <= 100);
}
