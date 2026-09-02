import { formatPeriodLabel } from "../domain/reportScope";
import { reportRegistry } from "../domain/reportRegistry";
import { utilityRegistry } from "../domain/utilityRegistry";
import type { ReportId, RunPeriodRole, SessionDataset, UtilityId } from "../domain/types";
import { downloadSessionDataset } from "../utils/datasetDownloads";
import type { PersistedContentReplacementJob } from "../writeTools/contentReplacement/types";
import {
  ContentReplacementJobManager,
  type ContentReplacementJobManagerStorage,
} from "./ContentReplacementJobManager";

interface DatasetsPanelProps {
  datasets: SessionDataset[];
  onRemoveDataset: (datasetId: string) => void;
  onFlushDatasets?: () => void;
  onOpenContentReplacementJob?: (job: PersistedContentReplacementJob) => void;
  onContentReplacementJobDeleted?: (jobId: string) => void;
  contentReplacementStorage?: ContentReplacementJobManagerStorage;
}

export function DatasetsPanel({
  datasets,
  onRemoveDataset,
  onFlushDatasets,
  onOpenContentReplacementJob,
  onContentReplacementJobDeleted,
  contentReplacementStorage,
}: DatasetsPanelProps) {
  const sortedDatasets = [...datasets].sort((a, b) => b.loadedAt.localeCompare(a.loadedAt));

  return (
    <section className="workspace-panel datasets-panel" aria-labelledby="datasets-heading">
      <div className="workspace-header">
        <div>
          <h2 className="workspace-heading" id="datasets-heading">
            Datasets
          </h2>
        </div>
        {sortedDatasets.length > 0 && onFlushDatasets && (
          <button className="s-btn s-btn__outlined" type="button" onClick={onFlushDatasets}>
            Flush stored datasets
          </button>
        )}
      </div>
      {sortedDatasets.length === 0 ? (
        <p className="workspace-copy">No datasets loaded or stored in this browser.</p>
      ) : (
        <div className="datasets-table-wrap">
          <table className="datasets-table">
            <thead>
              <tr>
                <th scope="col">Dataset</th>
                <th scope="col">Workflow</th>
                <th scope="col">Period</th>
                <th scope="col">Scope</th>
                <th scope="col">Records</th>
                <th scope="col">Source</th>
                <th scope="col">Loaded</th>
                <th scope="col">Actions</th>
              </tr>
            </thead>
            <tbody>
              {sortedDatasets.map((dataset) => {
                const sourceLabel = formatDatasetSourceLabel(dataset);
                return <tr key={dataset.id}>
                  <td>{dataset.name}</td>
                  <td>{formatWorkflowName(dataset)}</td>
                  <td>{dataset.utilityId ? "Snapshot" : formatPeriodRole(dataset.periodRole)}</td>
                  <td>{formatDatasetScope(dataset)}</td>
                  <td>{formatRecordCount(dataset.records.length)}</td>
                  <td>{formatSource(dataset.source)}</td>
                  <td>{formatLoadedAt(dataset.loadedAt)}</td>
                  <td>
                    <div className="dataset-actions">
                      <button
                        className="s-btn s-btn__outlined s-btn__xs"
                        type="button"
                        aria-label={`Download ${sourceLabel} dataset as CSV`}
                        onClick={() => downloadSessionDataset(dataset, "csv")}
                      >
                        CSV
                      </button>
                      <button
                        className="s-btn s-btn__outlined s-btn__xs"
                        type="button"
                        aria-label={`Download ${sourceLabel} dataset as JSON`}
                        onClick={() => downloadSessionDataset(dataset, "json")}
                      >
                        JSON
                      </button>
                      <button
                        className="s-btn s-btn__outlined s-btn__xs"
                        type="button"
                        aria-label={`Remove ${sourceLabel} dataset`}
                        onClick={() => onRemoveDataset(dataset.id)}
                      >
                        Remove
                      </button>
                    </div>
                  </td>
                </tr>;
              })}
            </tbody>
          </table>
        </div>
      )}
      {onOpenContentReplacementJob && (
        <ContentReplacementJobManager
          onOpenJob={onOpenContentReplacementJob}
          onDeleteJob={onContentReplacementJobDeleted}
          storage={contentReplacementStorage}
        />
      )}
    </section>
  );
}

function formatWorkflowName(dataset: SessionDataset): string {
  if (dataset.utilityId) {
    return formatUtilityName(dataset.utilityId);
  }

  return formatReportName(dataset.reportId);
}

function formatReportName(reportId: ReportId | undefined): string {
  if (!reportId) {
    return "Uploaded dataset";
  }

  return reportRegistry.find((report) => report.id === reportId)?.title ?? reportId;
}

function formatUtilityName(utilityId: UtilityId): string {
  return utilityRegistry.find((utility) => utility.id === utilityId)?.title ?? utilityId;
}

function formatDatasetScope(dataset: SessionDataset): string {
  if (dataset.utilityId) {
    return utilityRegistry.find((utility) => utility.id === dataset.utilityId)?.scopeLabel ?? "Snapshot";
  }

  return dataset.scope ? formatPeriodLabel(dataset.scope) : "Uploaded file";
}

function formatDatasetSourceLabel(dataset: SessionDataset): string {
  if (dataset.utilityId) {
    return `${formatUtilityName(dataset.utilityId)} ${dataset.name} snapshot`;
  }

  return `${dataset.name} ${dataset.periodRole ?? "upload"}`;
}

function formatPeriodRole(periodRole: RunPeriodRole | undefined): string {
  if (!periodRole) {
    return "Upload";
  }

  return periodRole === "current" ? "Current" : "Comparison";
}

function formatSource(source: SessionDataset["source"]): string {
  return source === "live-api" ? "Live API" : "Upload";
}

function formatRecordCount(count: number): string {
  return `${count.toLocaleString()} ${count === 1 ? "record" : "records"}`;
}

function formatLoadedAt(loadedAt: string): string {
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(loadedAt));
}
