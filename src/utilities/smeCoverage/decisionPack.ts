import type { ReportWarning } from "../../domain/types";
import type {
  SmeCoverageAnalysisResult,
  SmeCoverageCompleteness,
  SmeCoverageDecisionPack,
  SmeCoverageEvidenceRow,
  SmeCoverageSnapshot,
} from "./model";
import { buildSmeCoverageNarrative } from "./narrative";

export interface SmeCoverageSnapshotInput {
  instanceHost: string;
  generatedAt: string;
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
  assertTerminalSourceStatus(analysis);
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
    instanceHost: snapshot.instanceHost,
    generatedAt: snapshot.generatedAt,
    scopeLabel: "All-time demand · Current SME coverage",
    collectionLabel: "All available data collected",
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

function assertTerminalSourceStatus(analysis: SmeCoverageAnalysisResult): void {
  for (const source of ["tags", "questions", "tagSmeCounts"] as const) {
    const pagination = analysis.sourceStatus[source];
    if (!pagination.reachedMaxPages && !pagination.hasMore) continue;
    throw new Error(
      `Cannot build SME coverage decision pack: ${source} collection did not reach terminal pagination. No complete result was produced.`,
    );
  }
}

function determineCompleteness(analysis: SmeCoverageAnalysisResult): SmeCoverageCompleteness {
  if (analysis.evidence.length === 0) return "Empty";

  const incompleteRow = analysis.evidence.some(
    (row) => row.demandQuality !== "Complete" || row.smeQuality !== "Complete",
  );
  if (incompleteRow || !analysis.methodology.percentileSampleSufficient) {
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
  ...warningGroups: readonly (readonly ReportWarning[])[]
): readonly ReportWarning[] {
  const seen = new Set<string>();
  const warnings: ReportWarning[] = [];
  for (const warning of warningGroups.flat()) {
    const key = `${warning.code}\u0000${warning.message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    warnings.push(Object.freeze({ ...warning }));
  }
  return Object.freeze(warnings);
}
