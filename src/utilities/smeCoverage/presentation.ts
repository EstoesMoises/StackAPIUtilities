import type { ReportPresentationModel } from "../../reports/reportPresentation";
import type {
  SmeCoverageDecisionPack,
  SmeCoverageEvidenceRow,
  SmeCoverageMethodology,
} from "./model";

const summaryMetrics = [
  ["Tags analyzed", "tagsAnalyzed"],
  ["Tags with SMEs", "tagsWithSmes"],
  ["Immediate gaps", "immediateGaps"],
  ["Critical under-coverage", "criticalUnderCoverage"],
  ["Light-coverage tags", "lightCoverage"],
] as const;

export type SmeCoveragePresentation = ReportPresentationModel<
  SmeCoverageEvidenceRow,
  SmeCoverageMethodology
>;

export function createSmeCoveragePresentation(
  pack: SmeCoverageDecisionPack,
): SmeCoveragePresentation {
  const findings = [
    ...pack.findings.immediateGaps,
    ...pack.findings.criticalUnderCoverage,
    ...pack.findings.lightCoverage,
  ].map((evidence) => ({ tier: evidence.coverageTier, evidence }));
  const availableSections: SmeCoveragePresentation["availableSections"] = [
    "overview",
    ...(findings.length > 0 ? (["findings"] as const) : []),
    ...(pack.evidence.length > 0 ? (["evidence"] as const) : []),
    "methodology",
  ];

  return {
    reportKey: `sme-coverage-analyzer:${pack.snapshot.instanceHost}:${pack.snapshot.generatedAt}`,
    kindLabel: "Decision pack",
    title: "SME coverage report",
    sourceLabel: pack.snapshot.instanceHost,
    generatedAt: pack.snapshot.generatedAt,
    scopeLabel: pack.snapshot.scopeLabel,
    collectionLabel: pack.snapshot.collectionLabel,
    qualityLabel: `Analysis quality: ${pack.snapshot.completeness}`,
    qualityTone:
      pack.snapshot.completeness === "Complete"
        ? "success"
        : pack.snapshot.completeness === "Partial"
          ? "warning"
          : "neutral",
    rowCount: pack.evidence.length,
    warnings: pack.warnings,
    metrics: summaryMetrics.map(([label, key]) => ({ label, value: pack.summary[key] })),
    overview: pack.overview,
    assessment: pack.assessment,
    findings,
    evidence: pack.evidence,
    methodology: pack.methodology,
    availableSections,
    exports: {
      pdf: true,
      csv: pack.evidence.length > 0,
      markdown: true,
    },
  };
}
