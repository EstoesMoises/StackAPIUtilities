import { chooseDisplayTagName, compareCodeUnits } from "../../domain/tagNormalization";
import type { ReportWarning } from "../../domain/types";
import type {
  CoverageTier,
  DemandQuality,
  NormalizedTagDemandResult,
  NormalizedTagDemandRow,
  NormalizedTagSmeResult,
  NormalizedTagSmeRow,
  QuestionCountBasis,
  SmeCoverageAnalysisResult,
  SmeCoverageEvidenceRow,
  SmeCoverageSourceStatus,
  SmeQuality,
} from "./model";

export interface AnalyzeSmeCoverageInput {
  demand: NormalizedTagDemandResult;
  smeCounts: NormalizedTagSmeResult;
  sourceStatus: SmeCoverageSourceStatus;
}

interface JoinedEvidenceRow extends SmeCoverageEvidenceRow {
  readonly active: boolean;
  readonly eligibleCoveredActive: boolean;
}

const COPY = {
  unknownBoth: {
    reason: "Demand metrics and assigned-SME coverage are unavailable or invalid.",
    action: "Inspect both source lanes before drawing a coverage conclusion.",
  },
  unknownDemand: {
    reason: "Demand metrics are unavailable or invalid.",
    action: "Rerun or inspect the v2 tag/question source.",
  },
  unknownSme: {
    reason: "Assigned-SME coverage is unavailable.",
    action: "Rerun or inspect the v3 tag source.",
  },
  immediate: {
    reason: "Active tag has no assigned SMEs.",
    action: "Assign or confirm at least one SME.",
  },
  lowDemand: {
    reason: "Uncovered tag has no questions and at most 25 page views.",
    action: "Review whether the tag needs ownership or consolidation.",
  },
  notClassified: {
    reason: "Covered-tag sample is too small for relative classification.",
    action: "Review the raw ratio without making a percentile-based coverage conclusion.",
  },
  critical: {
    reason: "Demand meets the active-tag median and the ratio meets or exceeds P90.",
    action: "Expand and validate SME ownership.",
  },
  light: {
    reason: "Demand meets the active-tag median and the ratio is between P75 and P90.",
    action: "Review whether additional SMEs would improve resilience.",
  },
  adequate: {
    reason: "The tag does not meet an under-coverage rule.",
    action: "Maintain current coverage.",
  },
} as const;

const TIER_PRIORITY: Record<CoverageTier, number> = {
  "Immediate gap": 0,
  "Critical under-coverage": 1,
  "Light coverage": 2,
  Unknown: 3,
  "Not classified": 4,
  "Low-demand uncovered": 5,
  "Adequate coverage": 6,
};

export function analyzeSmeCoverage({
  demand,
  smeCounts,
  sourceStatus,
}: AnalyzeSmeCoverageInput): SmeCoverageAnalysisResult {
  const demandByKey = new Map(demand.rows.map((row) => [row.key, row]));
  const smeByKey = new Map(smeCounts.rows.map((row) => [row.key, row]));
  const keys = new Set([...demandByKey.keys(), ...smeByKey.keys()]);

  const joinedRows = [...keys].map((key) => joinRow(key, demandByKey.get(key), smeByKey.get(key)));
  const activePageViews = joinedRows
    .filter((row) => row.active && row.pageViews !== null)
    .map((row) => row.pageViews as number);
  const sampleRatios = joinedRows
    .filter((row) => row.eligibleCoveredActive && row.pageViewsPerSme !== null)
    .map((row) => row.pageViewsPerSme as number);
  const activeTagMedianPageViews = conventionalMedian(activePageViews);
  const p75PageViewsPerSme = nearestRank(sampleRatios, 0.75);
  const p90PageViewsPerSme = nearestRank(sampleRatios, 0.9);
  const percentileSampleSufficient = sampleRatios.length >= 4;

  const classifiedRows = joinedRows.map((row) => {
    const coveragePercentile =
      percentileSampleSufficient && row.eligibleCoveredActive && row.pageViewsPerSme !== null
        ? (sampleRatios.filter((candidate) => candidate <= row.pageViewsPerSme!).length / sampleRatios.length) * 100
        : null;
    return classifyRow(
      { ...row, coveragePercentile },
      percentileSampleSufficient,
      activeTagMedianPageViews,
      p75PageViewsPerSme,
      p90PageViewsPerSme,
    );
  });
  const evidence = classifiedRows.map(toEvidenceRow).sort(compareEvidenceRows);
  const immediateGaps = evidence.filter((row) => row.coverageTier === "Immediate gap");
  const criticalUnderCoverage = evidence.filter((row) => row.coverageTier === "Critical under-coverage");
  const lightCoverage = evidence.filter((row) => row.coverageTier === "Light coverage");

  return {
    evidence,
    summary: {
      tagsAnalyzed: evidence.length,
      tagsWithSmes: evidence.filter((row) => row.smeQuality === "Complete" && row.smeCount !== null && row.smeCount >= 1)
        .length,
      immediateGaps: immediateGaps.length,
      criticalUnderCoverage: criticalUnderCoverage.length,
      lightCoverage: lightCoverage.length,
      unknownRows: evidence.filter((row) => row.coverageTier === "Unknown").length,
    },
    methodology: {
      activityQuestionMinimum: 1,
      activityPageViewThresholdExclusive: 25,
      activeTagMedianPageViews,
      coveredActiveSampleSize: sampleRatios.length,
      p75PageViewsPerSme,
      p90PageViewsPerSme,
      percentileSampleSufficient,
      ratioFormula: "pageViews / smeCount",
      roundingRule: "Nearest whole page view for display; unrounded for calculation",
    },
    findings: { immediateGaps, criticalUnderCoverage, lightCoverage },
    sourceStatus,
    warnings: buildWarnings(evidence, sampleRatios.length),
  };
}

function joinRow(
  key: string,
  demandRow: NormalizedTagDemandRow | undefined,
  smeRow: NormalizedTagSmeRow | undefined,
): JoinedEvidenceRow {
  const tagName = chooseDisplayTagName([...(demandRow?.tagNames ?? []), ...(smeRow?.tagNames ?? [])]) ?? key;
  const pageViews = demandRow?.pageViews ?? null;
  const questionCount = demandRow?.questionCount ?? null;
  const questionCountBasis: QuestionCountBasis = demandRow?.questionCountBasis ?? "Unavailable";
  const demandQuality: DemandQuality = demandRow?.demandQuality ?? "Invalid";
  const smeCount = smeRow?.smeCount ?? null;
  const smeQuality: SmeQuality = smeRow?.smeQuality ?? "Unknown";
  const active =
    questionCount !== null && pageViews !== null && (questionCount >= 1 || pageViews > 25);
  const pageViewsPerSme = smeCount !== null && smeCount >= 1 && pageViews !== null ? pageViews / smeCount : null;
  const eligibleCoveredActive =
    active &&
    demandQuality !== "Invalid" &&
    smeQuality === "Complete" &&
    smeCount !== null &&
    smeCount >= 1 &&
    pageViewsPerSme !== null;

  return {
    tagName,
    pageViews,
    questionCount,
    questionCountBasis,
    smeCount,
    pageViewsPerSme,
    coveragePercentile: null,
    coverageTier: "Unknown",
    reason: "",
    recommendedAction: "",
    demandQuality,
    smeQuality,
    active,
    eligibleCoveredActive,
  };
}

function classifyRow(
  row: JoinedEvidenceRow,
  percentileSampleSufficient: boolean,
  activeTagMedianPageViews: number | null,
  p75PageViewsPerSme: number | null,
  p90PageViewsPerSme: number | null,
): JoinedEvidenceRow {
  if (row.demandQuality === "Invalid" || row.smeQuality === "Unknown") {
    if (row.demandQuality === "Invalid" && row.smeQuality === "Unknown") {
      return withTier(row, "Unknown", COPY.unknownBoth);
    }
    return row.demandQuality === "Invalid"
      ? withTier(row, "Unknown", COPY.unknownDemand)
      : withTier(row, "Unknown", COPY.unknownSme);
  }
  if (row.smeCount === 0 && row.active) return withTier(row, "Immediate gap", COPY.immediate);
  if (row.smeCount === 0 && row.questionCount === 0 && row.pageViews !== null && row.pageViews <= 25) {
    return withTier(row, "Low-demand uncovered", COPY.lowDemand);
  }
  if (row.smeCount !== null && row.smeCount >= 1 && !percentileSampleSufficient) {
    return withTier(row, "Not classified", COPY.notClassified);
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
    return withTier(row, "Critical under-coverage", COPY.critical);
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
    return withTier(row, "Light coverage", COPY.light);
  }
  return withTier(row, "Adequate coverage", COPY.adequate);
}

function withTier(
  row: JoinedEvidenceRow,
  coverageTier: CoverageTier,
  copy: { readonly reason: string; readonly action: string },
): JoinedEvidenceRow {
  return { ...row, coverageTier, reason: copy.reason, recommendedAction: copy.action };
}

function toEvidenceRow(row: JoinedEvidenceRow): SmeCoverageEvidenceRow {
  return {
    tagName: row.tagName,
    pageViews: row.pageViews,
    questionCount: row.questionCount,
    questionCountBasis: row.questionCountBasis,
    smeCount: row.smeCount,
    pageViewsPerSme: row.pageViewsPerSme,
    coveragePercentile: row.coveragePercentile,
    coverageTier: row.coverageTier,
    reason: row.reason,
    recommendedAction: row.recommendedAction,
    demandQuality: row.demandQuality,
    smeQuality: row.smeQuality,
  };
}

function nearestRank(values: readonly number[], percentile: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const rank = Math.min(sorted.length, Math.max(1, Math.ceil(percentile * sorted.length)));
  return sorted[rank - 1];
}

function conventionalMedian(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function compareEvidenceRows(left: SmeCoverageEvidenceRow, right: SmeCoverageEvidenceRow): number {
  const tierDifference = TIER_PRIORITY[left.coverageTier] - TIER_PRIORITY[right.coverageTier];
  if (tierDifference !== 0) return tierDifference;

  if (
    left.coverageTier === "Critical under-coverage" ||
    left.coverageTier === "Light coverage" ||
    left.coverageTier === "Not classified"
  ) {
    const ratioDifference = compareNullableDescending(left.pageViewsPerSme, right.pageViewsPerSme);
    if (ratioDifference !== 0) return ratioDifference;
  }

  const pageViewDifference = compareNullableDescending(left.pageViews, right.pageViews);
  if (pageViewDifference !== 0) return pageViewDifference;
  const questionDifference = compareNullableDescending(left.questionCount, right.questionCount);
  if (questionDifference !== 0) return questionDifference;
  return compareCodeUnits(left.tagName, right.tagName);
}

function compareNullableDescending(left: number | null, right: number | null): number {
  if (left === null) return right === null ? 0 : 1;
  if (right === null) return -1;
  return right - left;
}

function buildWarnings(evidence: readonly SmeCoverageEvidenceRow[], coveredActiveSampleSize: number): ReportWarning[] {
  const warnings: ReportWarning[] = [];
  const invalidDemandTags = evidence
    .filter((row) => row.demandQuality === "Invalid")
    .map((row) => row.tagName)
    .sort(compareCodeUnits);
  const unknownSmeTags = evidence
    .filter((row) => row.smeQuality === "Unknown")
    .map((row) => row.tagName)
    .sort(compareCodeUnits);

  if (invalidDemandTags.length > 0) {
    warnings.push({
      utilityId: "sme-coverage-analyzer",
      code: "sme-coverage.invalid-demand",
      message: affectedTagMessage("Demand metrics are unavailable or invalid", invalidDemandTags),
    });
  }
  if (unknownSmeTags.length > 0) {
    warnings.push({
      utilityId: "sme-coverage-analyzer",
      code: "sme-coverage.unknown-sme-coverage",
      message: affectedTagMessage("Assigned-SME coverage is unavailable", unknownSmeTags),
    });
  }
  if (coveredActiveSampleSize < 4) {
    warnings.push({
      utilityId: "sme-coverage-analyzer",
      code: "sme-coverage.insufficient-covered-sample",
      message: `Relative covered-tag classification is unavailable because only ${coveredActiveSampleSize} eligible covered active ${tagLabel(coveredActiveSampleSize)} were available; at least 4 are required.`,
    });
  }
  return warnings;
}

function affectedTagMessage(prefix: string, tagNames: readonly string[]): string {
  const count = tagNames.length;
  if (count <= 5) return `${prefix} for ${count} ${tagLabel(count)}: ${tagNames.map((name) => `\`${name}\``).join(", ")}.`;
  return `${prefix} for ${count} tags.`;
}

function tagLabel(count: number): "tag" | "tags" {
  return count === 1 ? "tag" : "tags";
}
