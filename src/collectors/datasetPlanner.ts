import { reportRegistry } from "../domain/reportRegistry";
import type { DatasetName, ReportId } from "../domain/types";

export function planDatasetsForReports(reportIds: readonly ReportId[]): DatasetName[] {
  const planned: DatasetName[] = [];
  for (const reportId of reportIds) {
    const report = reportRegistry.find((candidate) => candidate.id === reportId && candidate.phase === "mvp");
    if (!report) continue;
    for (const dataset of report.requiredDatasets) {
      if (!planned.includes(dataset)) planned.push(dataset);
    }
  }
  return planned;
}
