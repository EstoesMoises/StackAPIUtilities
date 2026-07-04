import { importReportFile } from "../importers/reportImporters";

export interface ReportWorkerClient {
  importFile(
    fileName: string,
    text: string,
  ): Promise<Awaited<ReturnType<typeof importReportFile>>>;
}

export function createInlineReportWorkerClient(): ReportWorkerClient {
  return {
    importFile: importReportFile,
  };
}
