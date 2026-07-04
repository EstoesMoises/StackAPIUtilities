export function summarizeDataExport(datasets: Record<string, unknown[]>) {
  return {
    datasetCounts: Object.fromEntries(
      Object.entries(datasets).map(([name, records]) => [name, records.length]),
    ),
  };
}
