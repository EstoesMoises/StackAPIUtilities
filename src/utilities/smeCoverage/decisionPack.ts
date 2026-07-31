import type { ReportRunPresetId, ReportWarning } from "../../domain/types";
import type {
  SmeCoverageAnalysisResult,
  SmeCoverageCompleteness,
  SmeCoverageDecisionPack,
  SmeCoverageEvidenceRow,
  SmeCoverageSnapshot,
  SmeCoverageSourceStatus,
} from "./model";
import { buildSmeCoverageNarrative } from "./narrative";

export interface SmeCoverageSnapshotInput {
  instanceHost: string;
  generatedAt: string;
  pageSize: number;
  maxPagesPerDataset: number;
  runPreset?: ReportRunPresetId;
}

export interface BuildSmeCoverageDecisionPackInput {
  analysis: SmeCoverageAnalysisResult;
  snapshot: SmeCoverageSnapshotInput;
  sourceWarnings: readonly ReportWarning[];
}

export function buildSmeCoverageDecisionPack({
  analysis,
  snapshot,
  sourceWarnings,
}: BuildSmeCoverageDecisionPackInput): SmeCoverageDecisionPack {
  const narrative = buildSmeCoverageNarrative(analysis);
  const evidenceBySource = new Map<SmeCoverageEvidenceRow, SmeCoverageEvidenceRow>();
  const evidence = Object.freeze(
    analysis.evidence.map((row) => {
      const copy = Object.freeze({ ...row });
      evidenceBySource.set(row, copy);
      return copy;
    }),
  );
  const findings = Object.freeze({
    immediateGaps: copyFindingRows(analysis.findings.immediateGaps, evidenceBySource),
    criticalUnderCoverage: copyFindingRows(analysis.findings.criticalUnderCoverage, evidenceBySource),
    lightCoverage: copyFindingRows(analysis.findings.lightCoverage, evidenceBySource),
  });
  const completeness = determineCompleteness(analysis);
  const packSnapshot: SmeCoverageSnapshot = Object.freeze({
    ...snapshot,
    scopeLabel: "All-time demand · Current SME coverage",
    completeness,
  });

  return Object.freeze({
    snapshot: packSnapshot,
    warnings: copyWarnings(sourceWarnings, analysis.warnings),
    summary: Object.freeze({ ...analysis.summary }),
    overview: narrative.overview,
    assessment: narrative.assessment,
    findings,
    methodology: Object.freeze({ ...analysis.methodology }),
    evidence,
  });
}

function determineCompleteness(analysis: SmeCoverageAnalysisResult): SmeCoverageCompleteness {
  const capped = Object.values(analysis.sourceStatus).some(isCapped);
  const configuredAsPartialSample = analysis.sampling.configuredAsPartialSample;
  if (analysis.evidence.length === 0) return capped || configuredAsPartialSample ? "Partial" : "Empty";

  const incompleteRow = analysis.evidence.some(
    (row) => row.demandQuality !== "Complete" || row.smeQuality !== "Complete",
  );
  if (
    capped ||
    configuredAsPartialSample ||
    incompleteRow ||
    !analysis.methodology.percentileSampleSufficient
  ) {
    return "Partial";
  }
  return "Complete";
}

function copyFindingRows(
  rows: readonly SmeCoverageEvidenceRow[],
  evidenceBySource: ReadonlyMap<SmeCoverageEvidenceRow, SmeCoverageEvidenceRow>,
): readonly SmeCoverageEvidenceRow[] {
  return Object.freeze(rows.map((row) => evidenceBySource.get(row) ?? Object.freeze({ ...row })));
}

function copyWarnings(
  sourceWarnings: readonly ReportWarning[],
  analysisWarnings: readonly ReportWarning[],
): readonly ReportWarning[] {
  const seen = new Set<string>();
  const warnings: ReportWarning[] = [];
  for (const warning of [...sourceWarnings, ...analysisWarnings]) {
    const key = `${warning.code}\u0000${warning.message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    warnings.push(Object.freeze({ ...warning }));
  }
  return Object.freeze(warnings);
}

function isCapped(source: SmeCoverageSourceStatus[keyof SmeCoverageSourceStatus]): boolean {
  return source.reachedMaxPages || source.hasMore;
}
