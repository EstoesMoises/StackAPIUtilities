import type {
  CollectedSource,
  NormalizedTagDemandRow,
  NormalizedTagSmeRow,
  SmeCoverageDecisionPack,
  SmeCoverageEvidenceRow,
  SmeCoverageSourceStatus,
  SourcePagination,
} from "../../utilities/smeCoverage/model";

export function collected(
  records: readonly Record<string, unknown>[],
  pagination: SourcePagination = { pageCount: 1, reachedMaxPages: false, hasMore: false },
): CollectedSource {
  return { records, pagination };
}

export const completeRawSources = {
  tags: collected([
    { name: "piper", count: 8 },
    { name: "kafka", count: 6 },
    { name: "timeout", count: 2 },
  ]),
  questions: collected([
    { question_id: 1, tags: ["piper", "piper"], view_count: 500 },
    { question_id: 2, tags: ["piper", "kafka"], view_count: 300 },
    { question_id: 3, tags: ["timeout"], view_count: 80 },
  ]),
  tagSmeCounts: collected([
    { name: "piper", subjectMatterExpertCount: 1 },
    { name: "kafka", subjectMatterExpertCount: 2 },
    { name: "timeout", subjectMatterExpertCount: 0 },
  ]),
};

export const completeSmeCoverageSourceStatus: SmeCoverageSourceStatus = {
  tags: { pageCount: 1, reachedMaxPages: false, hasMore: false },
  questions: { pageCount: 1, reachedMaxPages: false, hasMore: false },
  tagSmeCounts: { pageCount: 1, reachedMaxPages: false, hasMore: false },
};

export const narrativeDemandRows: readonly NormalizedTagDemandRow[] = [
  normalizedDemandRow("alpha", 100),
  normalizedDemandRow("bravo", 200),
  normalizedDemandRow("charlie", 300),
  normalizedDemandRow("timeout", 600),
  normalizedDemandRow("delta", 800),
  normalizedDemandRow("echo", 1000),
];

export const narrativeSmeRows: readonly NormalizedTagSmeRow[] = [
  normalizedSmeRow("alpha", 4),
  normalizedSmeRow("bravo", 4),
  normalizedSmeRow("charlie", 3),
  normalizedSmeRow("timeout", 0),
  normalizedSmeRow("delta", 2),
  normalizedSmeRow("echo", 1),
];

export function normalizedDemandRow(
  tagName: string,
  pageViews: number | null,
  questionCount = pageViews === null ? null : 1,
  overrides: Partial<NormalizedTagDemandRow> = {},
): NormalizedTagDemandRow {
  return {
    key: tagName.toLowerCase(),
    tagNames: [tagName],
    pageViews,
    questionCount,
    questionCountBasis: questionCount === null ? "Unavailable" : "Complete question enumeration",
    demandQuality: pageViews === null || questionCount === null ? "Invalid" : "Complete",
    ...overrides,
  };
}

export function normalizedSmeRow(
  tagName: string,
  smeCount: number | null,
  overrides: Partial<NormalizedTagSmeRow> = {},
): NormalizedTagSmeRow {
  return {
    key: tagName.toLowerCase(),
    tagNames: [tagName],
    smeCount,
    smeQuality: smeCount === null ? "Unknown" : "Complete",
    ...overrides,
  };
}

const immediateGap: SmeCoverageEvidenceRow = {
  tagName: "zeta-runtime",
  pageViews: 12_345.6,
  questionCount: 12,
  questionCountBasis: "Complete question enumeration",
  smeCount: 0,
  pageViewsPerSme: null,
  coveragePercentile: null,
  coverageTier: "Immediate gap",
  reason: "Active demand has no SME coverage.",
  recommendedAction: "Assign and confirm at least one SME.",
  demandQuality: "Complete",
  smeQuality: "Complete",
};

const criticalGap: SmeCoverageEvidenceRow = {
  tagName: "Alpha-platform",
  pageViews: 3_000,
  questionCount: 8,
  questionCountBasis: "All-time tag total",
  smeCount: 1,
  pageViewsPerSme: 3_000.49,
  coveragePercentile: 100,
  coverageTier: "Critical under-coverage",
  reason: "Ratio is at or above the prepared P90 threshold.",
  recommendedAction: "Expand and validate SME ownership.",
  demandQuality: "Complete",
  smeQuality: "Complete",
};

const lightGap: SmeCoverageEvidenceRow = {
  tagName: "beta-data",
  pageViews: 2_500,
  questionCount: 7,
  questionCountBasis: "Complete question enumeration",
  smeCount: 2,
  pageViewsPerSme: 1_250.4,
  coveragePercentile: 80,
  coverageTier: "Light coverage",
  reason: "Ratio is at or above the prepared P75 threshold.",
  recommendedAction: "Review resilience and add an SME if needed.",
  demandQuality: "Complete",
  smeQuality: "Complete",
};

const unknownCoverage: SmeCoverageEvidenceRow = {
  tagName: "unknown-source",
  pageViews: null,
  questionCount: null,
  questionCountBasis: "Unavailable",
  smeCount: null,
  pageViewsPerSme: null,
  coveragePercentile: null,
  coverageTier: "Unknown",
  reason: "Demand and assigned-SME coverage are unavailable.",
  recommendedAction: "Validate both API sources, then rerun.",
  demandQuality: "Invalid",
  smeQuality: "Unknown",
};

export function completeSmeCoverageDecisionPack(): SmeCoverageDecisionPack {
  return {
    snapshot: {
      instanceHost: "example.stackenterprise.co",
      generatedAt: "2026-07-30T12:00:00.000Z",
      scopeLabel: "All-time demand · Current SME coverage",
      collectionLabel: "All available data collected",
      completeness: "Complete",
    },
    warnings: [],
    summary: {
      tagsAnalyzed: 3,
      tagsWithSmes: 2,
      immediateGaps: 1,
      criticalUnderCoverage: 1,
      lightCoverage: 1,
      unknownRows: 0,
    },
    overview: "Three prepared evidence rows include three priority coverage findings.",
    assessment: "Prioritize `zeta-runtime` and `Alpha-platform`.",
    findings: {
      immediateGaps: [immediateGap],
      criticalUnderCoverage: [criticalGap],
      lightCoverage: [lightGap],
    },
    methodology: {
      activityQuestionMinimum: 1,
      activityPageViewThresholdExclusive: 25,
      activeTagMedianPageViews: 2_750,
      coveredActiveSampleSize: 12,
      p75PageViewsPerSme: 1_250.4,
      p90PageViewsPerSme: 3_000.49,
      percentileSampleSufficient: true,
      ratioFormula: "pageViews / smeCount",
      roundingRule: "Nearest whole page view for display; unrounded for calculation",
    },
    evidence: [immediateGap, criticalGap, lightGap],
  };
}

export function partialSmeCoverageDecisionPack(): SmeCoverageDecisionPack {
  const pack = completeSmeCoverageDecisionPack();
  return {
    ...pack,
    snapshot: {
      ...pack.snapshot,
      completeness: "Partial",
    },
    summary: {
      ...pack.summary,
      tagsAnalyzed: 4,
      unknownRows: 1,
    },
    warnings: [
      {
        utilityId: "sme-coverage-analyzer",
        code: "demand.invalid",
        message: "Demand evidence is unavailable or invalid for unknown-source; review that row before qualifying conclusions.",
      },
      {
        utilityId: "sme-coverage-analyzer",
        code: "smes.unknown",
        message: "Assigned-SME evidence is unavailable for unknown-source; review that row before qualifying conclusions.",
      },
    ],
    overview: "Analysis quality is Partial because one evidence row has unavailable demand and SME data. Review the evidence notes before qualifying conclusions.",
    assessment:
      "Prioritize `zeta-runtime` and `Alpha-platform`.\n\nValidate `unknown-source` before drawing a coverage conclusion.",
    evidence: [...pack.evidence, unknownCoverage],
  };
}

export function warninglessPartialSmeCoverageDecisionPack(): SmeCoverageDecisionPack {
  const pack = completeSmeCoverageDecisionPack();
  return {
    ...pack,
    snapshot: {
      ...pack.snapshot,
      completeness: "Partial",
    },
    summary: {
      ...pack.summary,
      tagsAnalyzed: 4,
      unknownRows: 1,
    },
    warnings: [],
    overview: "Analysis quality is Partial because one evidence row has unavailable demand and SME data.",
    assessment: "Review the unavailable unknown-source evidence before assigning owners.",
    evidence: [...pack.evidence, unknownCoverage],
  };
}

export function emptySmeCoverageDecisionPack(): SmeCoverageDecisionPack {
  const pack = completeSmeCoverageDecisionPack();
  return {
    ...pack,
    snapshot: { ...pack.snapshot, completeness: "Empty" },
    summary: {
      tagsAnalyzed: 0,
      tagsWithSmes: 0,
      immediateGaps: 0,
      criticalUnderCoverage: 0,
      lightCoverage: 0,
      unknownRows: 0,
    },
    overview: "No tags were available for SME coverage analysis.",
    assessment: "No evidence rows were available, so no coverage conclusion was produced.",
    findings: { immediateGaps: [], criticalUnderCoverage: [], lightCoverage: [] },
    evidence: [],
  };
}

export function insufficientSampleSmeCoverageDecisionPack(): SmeCoverageDecisionPack {
  const pack = completeSmeCoverageDecisionPack();
  return {
    ...pack,
    snapshot: { ...pack.snapshot, completeness: "Partial" },
    warnings: [
      {
        utilityId: "sme-coverage-analyzer",
        code: "percentiles.insufficient-sample",
        message: "Only one eligible covered active tag was available; relative tiers were not classified.",
      },
    ],
    methodology: {
      ...pack.methodology,
      coveredActiveSampleSize: 1,
      p75PageViewsPerSme: null,
      p90PageViewsPerSme: null,
      percentileSampleSufficient: false,
    },
  };
}
