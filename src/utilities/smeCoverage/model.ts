import type { ReportWarning } from "../../domain/types";

export type QuestionCountBasis =
  | "Complete question enumeration"
  | "All-time tag total"
  | "Partial question sample"
  | "Unavailable";

export type DemandQuality = "Complete" | "Partial sample" | "Invalid";
export type SmeQuality = "Complete" | "Unknown";

export type CoverageTier =
  | "Immediate gap"
  | "Critical under-coverage"
  | "Light coverage"
  | "Adequate coverage"
  | "Not classified"
  | "Low-demand uncovered"
  | "Unknown";

export interface SourcePagination {
  pageCount: number;
  reachedMaxPages: boolean;
  hasMore: boolean;
}

export interface CollectedSource {
  records: readonly Record<string, unknown>[];
  pagination: SourcePagination;
}

export interface SmeCoverageSourceStatus {
  tags: SourcePagination;
  questions: SourcePagination;
  tagSmeCounts: SourcePagination;
}

export interface NormalizedTagDemandRow {
  key: string;
  tagNames: readonly string[];
  pageViews: number | null;
  questionCount: number | null;
  questionCountBasis: QuestionCountBasis;
  demandQuality: DemandQuality;
}

export interface NormalizedTagSmeRow {
  key: string;
  tagNames: readonly string[];
  smeCount: number | null;
  smeQuality: SmeQuality;
}

export interface NormalizedTagDemandResult {
  rows: readonly NormalizedTagDemandRow[];
  warnings: readonly ReportWarning[];
}

export interface NormalizedTagSmeResult {
  rows: readonly NormalizedTagSmeRow[];
  warnings: readonly ReportWarning[];
}

export interface SmeCoverageEvidenceRow {
  tagName: string;
  pageViews: number | null;
  questionCount: number | null;
  questionCountBasis: QuestionCountBasis;
  smeCount: number | null;
  pageViewsPerSme: number | null;
  coveragePercentile: number | null;
  coverageTier: CoverageTier;
  reason: string;
  recommendedAction: string;
  demandQuality: DemandQuality;
  smeQuality: SmeQuality;
}
