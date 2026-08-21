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

export interface SmeCoverageSummary {
  tagsAnalyzed: number;
  tagsWithSmes: number;
  immediateGaps: number;
  criticalUnderCoverage: number;
  lightCoverage: number;
  unknownRows: number;
}

export interface SmeCoverageMethodology {
  activityQuestionMinimum: 1;
  activityPageViewThresholdExclusive: 25;
  activeTagMedianPageViews: number | null;
  coveredActiveSampleSize: number;
  p75PageViewsPerSme: number | null;
  p90PageViewsPerSme: number | null;
  percentileSampleSufficient: boolean;
  ratioFormula: "pageViews / smeCount";
  roundingRule: "Nearest whole page view for display; unrounded for calculation";
}

export interface SmeCoverageAnalysisResult {
  evidence: readonly SmeCoverageEvidenceRow[];
  summary: SmeCoverageSummary;
  methodology: SmeCoverageMethodology;
  findings: {
    immediateGaps: readonly SmeCoverageEvidenceRow[];
    criticalUnderCoverage: readonly SmeCoverageEvidenceRow[];
    lightCoverage: readonly SmeCoverageEvidenceRow[];
  };
  sourceStatus: SmeCoverageSourceStatus;
  warnings: readonly ReportWarning[];
}

export type SmeCoverageCompleteness = "Complete" | "Partial" | "Empty";

export interface SmeCoverageSnapshot {
  readonly instanceHost: string;
  readonly generatedAt: string;
  readonly scopeLabel: "All-time demand · Current SME coverage";
  readonly collectionLabel:
    | "All available data collected"
    | "Legacy run — completeness not verified under current collection rules";
  readonly completeness: SmeCoverageCompleteness;
}

export interface SmeCoverageDecisionPack {
  readonly snapshot: SmeCoverageSnapshot;
  readonly warnings: readonly ReportWarning[];
  readonly summary: SmeCoverageSummary;
  readonly overview: string;
  readonly assessment: string;
  readonly findings: SmeCoverageAnalysisResult["findings"];
  readonly methodology: SmeCoverageMethodology;
  readonly evidence: readonly SmeCoverageEvidenceRow[];
}

export interface SmeCoverageStoredOutput {
  utilityId: "sme-coverage-analyzer";
  loadedAt: string;
  decisionPack: SmeCoverageDecisionPack;
}
