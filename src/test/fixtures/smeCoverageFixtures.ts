import type {
  CollectedSource,
  NormalizedTagDemandRow,
  NormalizedTagSmeRow,
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
