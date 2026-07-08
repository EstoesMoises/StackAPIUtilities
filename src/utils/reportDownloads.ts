import type { DatasetName, PeriodScope, ReportId, RunPeriodRole } from "../domain/types";
import { buildTagHealthRows, buildTagHealthRowsFromLiveRecords } from "../reports/tagReport";
import { downloadTextFile, recordsToCsv } from "./downloads";

interface ReportCsvDownload {
  fileName: string;
  contents: string;
  mimeType: string;
}

export interface ReportCsvDownloadOutput {
  reportId: ReportId;
  datasetName: DatasetName;
  records: Record<string, unknown>[];
  loadedAt: string;
  source: "live-api" | "upload";
  periodRole?: RunPeriodRole;
  currentScope?: PeriodScope;
  comparisonScope?: PeriodScope;
}

export function buildReportCsvDownload(output: ReportCsvDownloadOutput): ReportCsvDownload {
  const periodRole = output.periodRole ?? "current";
  const rows =
    output.reportId === "tag-report" && output.datasetName === "tags"
      ? buildTagHealthRowsForOutput(output)
      : output.records;

  return {
    fileName: `${buildReportFileStem(output.reportId, output.datasetName, periodRole, output.loadedAt)}.csv`,
    contents: recordsToCsv(rows.map((row) => ({ ...row }))),
    mimeType: "text/csv;charset=utf-8",
  };
}

export function downloadReportCsv(output: ReportCsvDownloadOutput) {
  const download = buildReportCsvDownload(output);

  downloadTextFile(download.fileName, download.contents, download.mimeType);
}

function buildTagHealthRowsForOutput(output: ReportCsvDownloadOutput) {
  return output.source === "live-api" && output.records.some((record) => typeof record.datasetName === "string")
    ? buildTagHealthRowsFromLiveRecords(output.records)
    : buildTagHealthRows(output.records);
}

function buildReportFileStem(
  reportId: ReportId,
  datasetName: DatasetName,
  periodRole: RunPeriodRole,
  loadedAt: string,
): string {
  const datasetPart = reportId === "tag-report" && datasetName === "tags" ? "tag-health" : datasetName;

  return [reportId, datasetPart, periodRole, loadedAt.slice(0, 10)].map(sanitizeFileNamePart).join("-");
}

function sanitizeFileNamePart(value: string): string {
  return value.trim().replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-|-$/g, "") || "report";
}
