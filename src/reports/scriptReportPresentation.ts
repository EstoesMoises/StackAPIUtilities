import { isLegacyCollectionWarning } from "../domain/collectionWarnings";
import { reportRegistry } from "../domain/reportRegistry";
import { formatPeriodLabel } from "../domain/reportScope";
import type { PeriodScope, ReportId, ReportWarning } from "../domain/types";
import type { ReportPresentationModel } from "./reportPresentation";

interface ScriptPresentationInput {
  reportId: ReportId;
  records: readonly Record<string, unknown>[];
  comparisonRecords?: readonly Record<string, unknown>[];
  loadedAt: string;
  outputSource: "live-api" | "upload";
  currentScope?: PeriodScope;
  comparisonScope?: PeriodScope;
  warnings: readonly ReportWarning[];
}

function serializeScope(scope: PeriodScope | undefined): string {
  return scope ? `${scope.startDate ?? ""}..${scope.endDate ?? ""}` : "none";
}

function requireReportMetadata(reportId: ReportId) {
  const report = reportRegistry.find((candidate) => candidate.id === reportId);
  if (!report) {
    throw new Error(`Missing report metadata for Script report "${reportId}".`);
  }
  return report;
}

function formatScopeLabel(
  input: ScriptPresentationInput,
  evidenceRole: "current" | "comparison",
): string {
  if (evidenceRole === "comparison") {
    return `Comparison: ${formatPeriodLabel(input.comparisonScope ?? {})}`;
  }
  if (input.currentScope) return formatPeriodLabel(input.currentScope);
  if (input.comparisonScope) return `Comparison: ${formatPeriodLabel(input.comparisonScope)}`;
  return "All available history";
}

export function createScriptReportPresentation(
  input: ScriptPresentationInput,
): ReportPresentationModel<Record<string, unknown>, never> {
  const report = requireReportMetadata(input.reportId);
  const legacy =
    input.outputSource === "live-api" &&
    input.warnings.some((warning) => isLegacyCollectionWarning(warning, input.reportId));
  const quality =
    input.outputSource === "upload"
      ? ({ label: "Uploaded result", tone: "neutral" } as const)
      : legacy
        ? ({ label: "Legacy result — completeness unverified", tone: "warning" } as const)
        : ({ label: "All available data collected", tone: "success" } as const);
  const evidenceRole =
    input.records.length === 0 && (input.comparisonRecords?.length ?? 0) > 0
      ? "comparison"
      : "current";
  const evidenceSource =
    evidenceRole === "comparison" ? (input.comparisonRecords ?? []) : input.records;
  const evidence = [...evidenceSource];

  return {
    reportKey: `${input.reportId}:${input.loadedAt}:${input.outputSource}:current=${serializeScope(input.currentScope)}:comparison=${serializeScope(input.comparisonScope)}`,
    kindLabel: "Script report",
    title: report.title,
    sourceLabel: report.sourceRepo,
    generatedAt: input.loadedAt,
    scopeLabel: formatScopeLabel(input, evidenceRole),
    collectionLabel: quality.label,
    qualityLabel: quality.label,
    qualityTone: quality.tone,
    rowCount: evidence.length,
    warnings: [...input.warnings],
    metrics: [],
    overview: report.description,
    findings: [],
    evidence,
    availableSections: ["overview", ...(evidence.length > 0 ? (["evidence"] as const) : [])],
    exports: { pdf: false, csv: evidence.length > 0, markdown: false },
  };
}
