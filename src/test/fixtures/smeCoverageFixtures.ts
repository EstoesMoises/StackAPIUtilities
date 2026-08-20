import type {
  CollectedSource,
  NormalizedTagDemandRow,
  NormalizedTagSmeRow,
  SmeCoverageDecisionPack,
  SmeCoverageSourceStatus,
  SourcePagination,
} from "../../utilities/smeCoverage/model";
import { analyzeSmeCoverage } from "../../utilities/smeCoverage/analyzer";
import { buildSmeCoverageDecisionPack } from "../../utilities/smeCoverage/decisionPack";

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

const fixtureSnapshot = {
  instanceHost: "example.stackenterprise.co",
  generatedAt: "2026-07-30T12:00:00.000Z",
};

const completeFixtureDemandRows: readonly NormalizedTagDemandRow[] = [
  normalizedDemandRow("zeta-runtime", 12_345.6, 12),
  normalizedDemandRow("Alpha-platform", 3_000.49, 8),
  normalizedDemandRow("beta-data", 2_500.8, 7),
  normalizedDemandRow("delta-service", 2_000, 4),
  normalizedDemandRow("gamma-tools", 1_000, 2),
];

const completeFixtureSmeRows: readonly NormalizedTagSmeRow[] = [
  normalizedSmeRow("zeta-runtime", 0),
  normalizedSmeRow("Alpha-platform", 1),
  normalizedSmeRow("beta-data", 2),
  normalizedSmeRow("delta-service", 4),
  normalizedSmeRow("gamma-tools", 4),
];

const unknownDemandRow = normalizedDemandRow("unknown-source", null);
const unknownSmeRow = normalizedSmeRow("unknown-source", null);

export function completeSmeCoverageDecisionPack(): SmeCoverageDecisionPack {
  return buildCurrentDecisionPack(completeFixtureDemandRows, completeFixtureSmeRows);
}

export function partialSmeCoverageDecisionPack(): SmeCoverageDecisionPack {
  return buildCurrentDecisionPack(
    [...completeFixtureDemandRows, unknownDemandRow],
    [...completeFixtureSmeRows, unknownSmeRow],
  );
}

export function emptySmeCoverageDecisionPack(): SmeCoverageDecisionPack {
  return buildCurrentDecisionPack([], []);
}

export function insufficientSampleSmeCoverageDecisionPack(): SmeCoverageDecisionPack {
  return buildCurrentDecisionPack(
    [normalizedDemandRow("solo-service", 600, 3)],
    [normalizedSmeRow("solo-service", 1)],
  );
}

function buildCurrentDecisionPack(
  demandRows: readonly NormalizedTagDemandRow[],
  smeRows: readonly NormalizedTagSmeRow[],
): SmeCoverageDecisionPack {
  const analysis = analyzeSmeCoverage({
    demand: { rows: demandRows, warnings: [] },
    smeCounts: { rows: smeRows, warnings: [] },
    sourceStatus: completeSmeCoverageSourceStatus,
  });
  return buildSmeCoverageDecisionPack({
    analysis,
    snapshot: fixtureSnapshot,
    sourceWarnings: [],
  });
}
