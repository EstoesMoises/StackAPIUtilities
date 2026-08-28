import {
  buildSmeCoverageAssessmentBrief,
  type SmeCoverageAssessmentBrief,
} from "./assessmentBrief";
import type {
  SmeCoverageDecisionPack,
  SmeCoverageEvidenceRow,
} from "./model";
import { formatDisplayedRatio } from "./narrative";

const PDF_PRIORITY_ROW_LIMIT = 12;

export interface SmeCoveragePdfMetric {
  readonly label: string;
  readonly value: number;
}

export interface SmeCoveragePdfModel {
  readonly title: "SME Coverage Executive Brief";
  readonly snapshot: SmeCoverageDecisionPack["snapshot"];
  readonly warnings: readonly string[];
  readonly metrics: readonly SmeCoveragePdfMetric[];
  readonly overview: string;
  readonly assessmentBrief: SmeCoverageAssessmentBrief;
  readonly priorityRows: readonly SmeCoverageEvidenceRow[];
  readonly omittedPriorityCount: number;
  readonly methodologySummary: string;
  readonly completeEvidenceNote: string;
}

export function buildSmeCoveragePdfModel(
  pack: SmeCoverageDecisionPack,
): SmeCoveragePdfModel {
  const allPriorityRows = [
    ...pack.findings.immediateGaps,
    ...pack.findings.criticalUnderCoverage,
    ...pack.findings.lightCoverage,
  ];
  const priorityRows = allPriorityRows.slice(0, PDF_PRIORITY_ROW_LIMIT);

  return {
    title: "SME Coverage Executive Brief",
    snapshot: pack.snapshot,
    warnings: pack.warnings.map((warning) => warning.message),
    metrics: [
      { label: "Tags analyzed", value: pack.summary.tagsAnalyzed },
      { label: "Tags with SMEs", value: pack.summary.tagsWithSmes },
      { label: "Immediate gaps", value: pack.summary.immediateGaps },
      { label: "Critical under-coverage", value: pack.summary.criticalUnderCoverage },
      { label: "Light coverage", value: pack.summary.lightCoverage },
      { label: "Unknown rows", value: pack.summary.unknownRows },
    ],
    overview: pack.overview,
    assessmentBrief: buildSmeCoverageAssessmentBrief(pack),
    priorityRows,
    omittedPriorityCount: Math.max(0, allPriorityRows.length - priorityRows.length),
    methodologySummary: buildMethodologySummary(pack),
    completeEvidenceNote:
      pack.evidence.length > 0
        ? "Complete canonical evidence is provided in the accompanying CSV for filtering, audit, and AI-assisted analysis."
        : "No evidence CSV is available because this report contains no canonical evidence rows.",
  };
}

function buildMethodologySummary(pack: SmeCoverageDecisionPack): string {
  const methodology = pack.methodology;
  const thresholdSummary = methodology.percentileSampleSufficient
    ? `P75 ${formatRatio(methodology.p75PageViewsPerSme)}; P90 ${formatRatio(methodology.p90PageViewsPerSme)}.`
    : `Relative percentile thresholds were not calculated because only ${methodology.coveredActiveSampleSize.toLocaleString("en-US")} eligible covered active ${methodology.coveredActiveSampleSize === 1 ? "tag was" : "tags were"} available.`;

  return [
    `Active tags have at least ${methodology.activityQuestionMinimum} question or more than ${methodology.activityPageViewThresholdExclusive} page views.`,
    `Coverage ratio: ${methodology.ratioFormula}.`,
    thresholdSummary,
    `Display values use nearest-whole page views; calculations use unrounded values. Analysis quality: ${pack.snapshot.completeness}.`,
  ].join(" ");
}

function formatRatio(value: number | null): string {
  return value === null ? "not calculated" : formatDisplayedRatio(value);
}
