import type { DatasetName, ReportId } from "./types";

export function getExpectedReportDatasetNames(
  reportId: ReportId,
  requiredDatasets: readonly DatasetName[],
): readonly DatasetName[] {
  return reportId === "interactions" ? [...requiredDatasets, "interactions"] : requiredDatasets;
}
