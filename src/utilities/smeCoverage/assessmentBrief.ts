import type {
  SmeCoverageDecisionPack,
  SmeCoverageEvidenceRow,
} from "./model";

const ASSESSMENT_ITEM_LIMIT = 3;

export interface SmeCoverageAssessmentItem {
  readonly tagName: string;
  readonly pageViews: number | null;
  readonly smeCount: number | null;
  readonly recommendedAction: string;
}

export interface SmeCoverageAssessmentSection {
  readonly heading:
    | "Immediate priorities"
    | "Critical under-coverage"
    | "Light coverage";
  readonly items: readonly SmeCoverageAssessmentItem[];
  readonly omittedCount: number;
}

export interface SmeCoverageAssessmentBrief {
  readonly title: "SME COVERAGE ASSESSMENT";
  readonly bottomLine: string;
  readonly sections: readonly SmeCoverageAssessmentSection[];
  readonly recommendedNextStep: string;
  readonly evidenceQuality: SmeCoverageDecisionPack["snapshot"]["completeness"];
  readonly fullEvidenceNote: string;
}

export function buildSmeCoverageAssessmentBrief(
  pack: SmeCoverageDecisionPack,
): SmeCoverageAssessmentBrief {
  return {
    title: "SME COVERAGE ASSESSMENT",
    bottomLine: pack.overview,
    sections: [
      buildSection("Immediate priorities", pack.findings.immediateGaps),
      buildSection("Critical under-coverage", pack.findings.criticalUnderCoverage),
      buildSection("Light coverage", pack.findings.lightCoverage),
    ].filter((section) => section.items.length > 0),
    recommendedNextStep: buildRecommendedNextStep(pack),
    evidenceQuality: pack.snapshot.completeness,
    fullEvidenceNote:
      pack.evidence.length > 0
        ? "See the accompanying CSV."
        : "No evidence CSV is available for this empty report.",
  };
}

export function formatSmeCoverageAssessmentMarkdown(
  brief: SmeCoverageAssessmentBrief,
): string {
  const sections = brief.sections.flatMap((section) => [
    "",
    section.heading,
    ...section.items.map(formatAssessmentItem),
    ...(section.omittedCount > 0
      ? [`- ${formatNumber(section.omittedCount)} additional ${itemLabel(section.omittedCount)} in the accompanying CSV.`]
      : []),
  ]);

  return [
    brief.title,
    "",
    "Bottom line",
    brief.bottomLine,
    ...sections,
    "",
    "Recommended next step",
    brief.recommendedNextStep,
    "",
    `Evidence quality: ${brief.evidenceQuality}`,
    `Full evidence: ${brief.fullEvidenceNote}`,
  ].join("\n");
}

function buildSection(
  heading: SmeCoverageAssessmentSection["heading"],
  rows: readonly SmeCoverageEvidenceRow[],
): SmeCoverageAssessmentSection {
  return {
    heading,
    items: rows.slice(0, ASSESSMENT_ITEM_LIMIT).map(toAssessmentItem),
    omittedCount: Math.max(0, rows.length - ASSESSMENT_ITEM_LIMIT),
  };
}

function toAssessmentItem(row: SmeCoverageEvidenceRow): SmeCoverageAssessmentItem {
  return {
    tagName: row.tagName,
    pageViews: row.pageViews,
    smeCount: row.smeCount,
    recommendedAction: row.recommendedAction,
  };
}

function buildRecommendedNextStep(pack: SmeCoverageDecisionPack): string {
  if (pack.evidence.length === 0) {
    return "Collect evidence before assigning or changing SME coverage.";
  }
  if (pack.findings.immediateGaps.length > 0) {
    return pack.findings.criticalUnderCoverage.length > 0
      ? "Assign or confirm SMEs for the highest-demand no-SME tags first, then expand coverage for critical tags."
      : "Assign or confirm SMEs for the highest-demand no-SME tags first.";
  }
  if (pack.findings.criticalUnderCoverage.length > 0) {
    return "Expand and validate SME ownership for the highest-demand critical tags.";
  }
  if (pack.findings.lightCoverage.length > 0) {
    return "Validate backup ownership for the highest-demand light-coverage tags.";
  }
  return "Maintain current coverage and review again as demand changes.";
}

function formatAssessmentItem(item: SmeCoverageAssessmentItem): string {
  return `- ${item.tagName}: ${formatMetric(item.pageViews, "page view")}, ${formatMetric(item.smeCount, "SME")}; ${item.recommendedAction}`;
}

function formatMetric(value: number | null, label: string): string {
  if (value === null) return `${label} count unavailable`;
  return `${formatNumber(value)} ${label}${value === 1 ? "" : "s"}`;
}

function formatNumber(value: number): string {
  return value.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

function itemLabel(count: number): string {
  return count === 1 ? "priority" : "priorities";
}
