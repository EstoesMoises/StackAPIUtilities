import { useState } from "react";
import { reportRegistry } from "../domain/reportRegistry";
import type { DatasetName, ReportId } from "../domain/types";
import { importReportFile } from "../importers/reportImporters";

export type ImportedUploadResult = Awaited<ReturnType<typeof importReportFile>> & {
  datasetName: DatasetName;
  fileName: string;
};

interface UploadsPanelProps {
  onImported?: (result: ImportedUploadResult) => void;
}

export function UploadsPanel({ onImported }: UploadsPanelProps) {
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleFiles(files: FileList | null) {
    if (!files) return;

    for (const file of Array.from(files)) {
      try {
        const text = await readFileText(file);
        const result = await importReportFile(file.name, text);
        const report = reportRegistry.find((candidate) => candidate.id === result.reportId);
        const imported = {
          ...result,
          datasetName: datasetNameForImportedReport(result.reportId),
          fileName: file.name,
        };

        setError(null);
        setMessage(`Imported ${file.name} for ${report?.title ?? result.reportId}.`);
        onImported?.(imported);
      } catch (caughtError) {
        setMessage(null);
        setError(caughtError instanceof Error ? caughtError.message : `Unable to import ${file.name}.`);
      }
    }
  }

  return (
    <section className="workspace-panel" aria-labelledby="uploads-heading">
      <div className="workspace-header">
        <div>
          <p className="workspace-kicker">Local files</p>
          <h2 className="workspace-heading" id="uploads-heading">
            Uploads
          </h2>
        </div>
      </div>
      <p className="fs-body2 workspace-copy">
        Upload existing CSV or JSON outputs from current SO4T scripts. Files are parsed locally in
        this browser. Loaded datasets stay stored locally until removed from the Datasets panel.
      </p>
      <label className="upload-dropzone">
        <span className="upload-dropzone-title">Upload report outputs</span>
        <span className="upload-dropzone-copy">CSV or JSON files from existing SO4T scripts</span>
        <input
          className="s-input"
          type="file"
          multiple
          accept=".csv,.json"
          aria-label="Upload report outputs"
          onChange={(event) => void handleFiles(event.currentTarget.files)}
        />
      </label>
      {message && (
        <div className="s-notice s-notice__success mt16" role="status">
          {message}
        </div>
      )}
      {error && (
        <div className="s-notice s-notice__danger mt16" role="alert">
          {error}
        </div>
      )}
    </section>
  );
}

function datasetNameForImportedReport(reportId: ReportId): DatasetName {
  switch (reportId) {
    case "tag-report":
      return "tags";
    case "api-user-report":
    case "inactive-users":
      return "users";
    case "interactions":
      return "interactions";
    case "community-members":
      return "communities";
    case "data-export":
      return "dataExport";
    default:
      return "dataExport";
  }
}

async function readFileText(file: File) {
  if (typeof file.text === "function") {
    return file.text();
  }

  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(String(reader.result ?? "")));
    reader.addEventListener("error", () => reject(reader.error ?? new Error(`Unable to read ${file.name}.`)));
    reader.readAsText(file);
  });
}
