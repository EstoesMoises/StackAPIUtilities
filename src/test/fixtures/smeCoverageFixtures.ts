import type { CollectedSource, SourcePagination } from "../../utilities/smeCoverage/model";

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
