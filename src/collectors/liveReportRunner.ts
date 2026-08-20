import type { FetchLike, ThrottleNotice } from "../api/httpClient";
import { validateCredentialsForReport } from "../credentials/credentialRules";
import { DEFAULT_REPORT_RUN_SCOPE } from "../domain/reportScope";
import { reportRegistry } from "../domain/reportRegistry";
import type {
  DatasetName,
  PeriodScope,
  ReportId,
  ReportWarning,
  RunPeriodRole,
  SessionCredentials,
} from "../domain/types";
import { buildInteractionEdgesFromLiveContent } from "../reports/interactions";
import { planDatasetsForReports } from "./datasetPlanner";
import { createLiveCollectorClients } from "./liveCollectorClients";
import {
  collectDataset,
  getUnsupportedLiveDatasets,
  type DatasetPaginationMetadata,
} from "./liveCollectors";

export interface LiveReportDataset {
  datasetName: DatasetName;
  records: Record<string, unknown>[];
  pagination: DatasetPaginationMetadata;
}

export interface LiveReportRunResult {
  reportId: ReportId;
  reportTitle: string;
  periodRole: RunPeriodRole;
  scope: PeriodScope;
  datasets: LiveReportDataset[];
  messages: string[];
  warnings: ReportWarning[];
}

export interface LiveReportRunOptions {
  fetchFn?: FetchLike;
  onThrottle?: (notice: ThrottleNotice) => void | Promise<void>;
  periodRole?: RunPeriodRole;
  scope?: PeriodScope;
}

export class LiveReportCollectionError extends Error {
  constructor(datasetName: DatasetName, cause: unknown) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    super(`Failed to collect ${datasetName}. No complete result was produced. ${detail}`);
    this.name = "LiveReportCollectionError";
    (this as Error & { cause?: unknown }).cause = cause;
  }
}

export class UnsupportedLiveReportRunError extends Error {
  constructor(
    public readonly reportId: ReportId,
    public readonly reportTitle: string,
    public readonly unsupportedDatasets: DatasetName[],
  ) {
    super(
      `${reportTitle} needs live datasets that are not mapped for live API collection yet: ${unsupportedDatasets.join(
        ", ",
      )}. Use Uploads for this report until those collectors are added.`,
    );
  }
}

export async function runLiveReport(
  reportId: ReportId,
  credentials: SessionCredentials,
  options: LiveReportRunOptions = {},
): Promise<LiveReportRunResult> {
  const report = reportRegistry.find((candidate) => candidate.id === reportId);

  if (!report) {
    throw new Error(`Unknown report: ${reportId}`);
  }

  const credentialValidation = validateCredentialsForReport(reportId, credentials);
  if (!credentialValidation.valid) {
    throw new Error(credentialValidation.messages.join(" "));
  }

  const plannedDatasets = planDatasetsForReports([reportId]);
  const unsupportedDatasets = getUnsupportedLiveDatasets(plannedDatasets);

  if (unsupportedDatasets.length > 0) {
    throw new UnsupportedLiveReportRunError(reportId, report.title, unsupportedDatasets);
  }

  const clients = createLiveCollectorClients(credentials, options);
  const datasets: LiveReportDataset[] = [];
  const collectedDatasets: Partial<Record<DatasetName, Record<string, unknown>[]>> = {};
  const periodRole = options.periodRole ?? "current";
  const scope = options.scope ?? DEFAULT_REPORT_RUN_SCOPE.current;
  const warnings: ReportWarning[] = [];

  for (const datasetName of plannedDatasets) {
    let collection;
    try {
      collection = await collectDataset(datasetName, clients, {
        collectedDatasets,
        periodRole,
        scope,
      });
    } catch (error) {
      throw new LiveReportCollectionError(datasetName, error);
    }
    const records = toRecordList(collection.records);

    collectedDatasets[datasetName] = records;
    datasets.push({ datasetName, records, pagination: collection.pagination });
  }

  datasets.push(...buildSyntheticDatasets(reportId, datasets));

  const result: LiveReportRunResult = {
    reportId,
    reportTitle: report.title,
    periodRole,
    scope,
    datasets,
    messages: datasets.map((dataset) => formatDatasetMessage(reportId, report.title, dataset)),
    warnings,
  };

  return result;
}

function buildSyntheticDatasets(
  reportId: ReportId,
  datasets: LiveReportDataset[],
): LiveReportDataset[] {
  if (reportId !== "interactions") {
    return [];
  }

  const recordsByDataset = new Map(datasets.map((dataset) => [dataset.datasetName, dataset.records]));

  return [
    {
      datasetName: "interactions",
      records: buildInteractionEdgesFromLiveContent({
        users: recordsByDataset.get("users") ?? [],
        questions: recordsByDataset.get("questions") ?? [],
        answers: recordsByDataset.get("answers") ?? [],
        comments: recordsByDataset.get("comments") ?? [],
      }).map((edge) => ({ ...edge })),
      pagination: { pageCount: 0, reachedMaxPages: false, hasMore: false },
    },
  ];
}

function formatDatasetMessage(
  reportId: ReportId,
  reportTitle: string,
  dataset: LiveReportDataset,
): string {
  const verb = reportId === "interactions" && dataset.datasetName === "interactions" ? "Built" : "Collected";

  return `${verb} ${dataset.datasetName} (${formatRecordCount(dataset.records.length)}) for ${reportTitle}.`;
}

function toRecordList(records: unknown[]): Record<string, unknown>[] {
  return records.map((record) => {
    if (isRecord(record)) {
      return record;
    }

    return { value: record };
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function formatRecordCount(count: number): string {
  return `${count} ${count === 1 ? "record" : "records"}`;
}
