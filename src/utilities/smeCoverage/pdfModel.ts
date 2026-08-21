import type {
  CoverageTier,
  SmeCoverageDecisionPack,
  SmeCoverageEvidenceRow,
} from "./model";

export interface SmeCoveragePdfMetric {
  readonly label: string;
  readonly value: number;
}

export interface SmeCoveragePdfFindingGroup {
  readonly tier: CoverageTier;
  readonly rows: readonly SmeCoverageEvidenceRow[];
}

export interface SmeCoveragePdfModel {
  readonly title: "SME Coverage Decision Pack";
  readonly snapshot: SmeCoverageDecisionPack["snapshot"];
  readonly warnings: readonly string[];
  readonly metrics: readonly SmeCoveragePdfMetric[];
  readonly overview: string;
  readonly assessmentParagraphs: readonly string[];
  readonly findingGroups: readonly SmeCoveragePdfFindingGroup[];
  readonly methodology: SmeCoverageDecisionPack["methodology"];
  readonly appendixRows: readonly SmeCoverageEvidenceRow[];
  readonly completeEvidenceNote: string;
}

export function buildSmeCoveragePdfModel(
  pack: SmeCoverageDecisionPack,
): SmeCoveragePdfModel {
  const findingGroups = ([
    { tier: "Immediate gap", rows: pack.findings.immediateGaps },
    { tier: "Critical under-coverage", rows: pack.findings.criticalUnderCoverage },
    { tier: "Light coverage", rows: pack.findings.lightCoverage },
  ] satisfies readonly SmeCoveragePdfFindingGroup[]).filter((group) => group.rows.length > 0);

  return {
    title: "SME Coverage Decision Pack",
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
    assessmentParagraphs: pack.assessment
      .split(/(?:\r?\n\s*){2,}/)
      .map((paragraph) => paragraph.trim())
      .filter(Boolean),
    findingGroups,
    methodology: pack.methodology,
    appendixRows: findingGroups.flatMap((group) => group.rows),
    completeEvidenceNote:
      "The accompanying evidence CSV contains the complete canonical dataset in decision-pack order.",
  };
}
