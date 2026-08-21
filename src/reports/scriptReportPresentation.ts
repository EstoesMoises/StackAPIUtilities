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

export function createScriptReportPresentation(
  input: ScriptPresentationInput,
): ReportPresentationModel<Record<string, unknown>, never> {
  const report = reportRegistry.find((candidate) => candidate.id === input.reportId)!;
  const legacy = input.warnings.some((warning) =>
    isLegacyCollectionWarning(warning, input.reportId),
  );
  const qualityLabel =
    input.outputSource === "upload"
      ? "Uploaded result"
      : legacy
        ? "Legacy result — completeness unverified"
        : "All available data collected";
  const evidence = input.records.length > 0 ? input.records : (input.comparisonRecords ?? []);

  return {
    reportKey: `${input.reportId}:${input.loadedAt}:${input.currentScope?.startDate ?? ""}:${input.comparisonScope?.startDate ?? ""}`,
    kindLabel: "Script report",
    title: report.title,
    sourceLabel: report.sourceRepo,
    generatedAt: input.loadedAt,
    scopeLabel: input.currentScope
      ? formatPeriodLabel(input.currentScope)
      : input.comparisonScope
        ? `Comparison: ${formatPeriodLabel(input.comparisonScope)}`
        : "All available history",
    collectionLabel: qualityLabel,
    qualityLabel,
    qualityTone: legacy ? "warning" : input.outputSource === "live-api" ? "success" : "neutral",
    rowCount: evidence.length,
    warnings: input.warnings,
    metrics: [],
    overview: report.description,
    findings: [],
    evidence,
    availableSections: ["overview", ...(evidence.length > 0 ? (["evidence"] as const) : [])],
    exports: { pdf: false, csv: evidence.length > 0, markdown: false },
  };
}
