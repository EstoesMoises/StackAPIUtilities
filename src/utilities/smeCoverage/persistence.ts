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
    !summaryMatchesEvidence(summary, evidence)
  ) {
    return null;
  }

  return Object.freeze({
    snapshot,
    warnings,
    summary,
    overview: value.overview,
    assessment: value.assessment,
    findings: Object.freeze({ immediateGaps, criticalUnderCoverage, lightCoverage }),
    methodology,
    evidence,
  });
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
