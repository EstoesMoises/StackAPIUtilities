import { StackApiV2Client } from "../api/stackApiV2";
import { StackApiV3Client } from "../api/stackApiV3";
import type { FetchLike, ThrottleNotice } from "../api/httpClient";
import { normalizeInstanceUrl } from "../credentials/credentialRules";
import { reportRegistry } from "../domain/reportRegistry";
import type { DatasetName, ReportId, SessionCredentials } from "../domain/types";
import { planDatasetsForReports } from "./datasetPlanner";
import { collectDataset, getUnsupportedLiveDatasets, type LiveCollectorClients } from "./liveCollectors";

export interface LiveReportDataset {
  datasetName: DatasetName;
  records: Record<string, unknown>[];
}

export interface LiveReportRunResult {
  reportId: ReportId;
  reportTitle: string;
  datasets: LiveReportDataset[];
  messages: string[];
}

export interface LiveReportRunOptions {
  fetchFn?: FetchLike;
  onThrottle?: (notice: ThrottleNotice) => void | Promise<void>;
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

  const plannedDatasets = planDatasetsForReports([reportId]);
  const unsupportedDatasets = getUnsupportedLiveDatasets(plannedDatasets);

  if (unsupportedDatasets.length > 0) {
    throw new UnsupportedLiveReportRunError(reportId, report.title, unsupportedDatasets);
  }

  const clients = createLiveCollectorClients(credentials, options);
  const datasets: LiveReportDataset[] = [];

  for (const datasetName of plannedDatasets) {
    const records = await collectDataset(datasetName, clients);
    datasets.push({ datasetName, records: toRecordList(records) });
  }

  return {
    reportId,
    reportTitle: report.title,
    datasets,
    messages: datasets.map(
      (dataset) =>
        `Collected ${dataset.datasetName} (${formatRecordCount(dataset.records.length)}) for ${report.title}.`,
    ),
  };
}

function createLiveCollectorClients(
  credentials: SessionCredentials,
  options: LiveReportRunOptions,
): LiveCollectorClients {
  const instance = normalizeInstanceUrl(credentials.baseUrl);
  const token = credentials.accessToken ?? credentials.pat ?? "";

  return {
    v2: new StackApiV2Client({
      apiV2Url: instance.apiV2Url,
      teamSlug: instance.teamSlug,
      headers: createV2Headers(credentials),
      fetchFn: options.fetchFn,
      onThrottle: options.onThrottle,
    }),
    v3: new StackApiV3Client({
      apiV3Url: instance.apiV3Url,
      token,
      fetchFn: options.fetchFn,
      onThrottle: options.onThrottle,
    }),
  };
}

function createV2Headers(credentials: SessionCredentials): HeadersInit {
  const headers: Record<string, string> = {};
  const token = credentials.accessToken ?? credentials.pat;

  if (credentials.apiKey) {
    headers["X-API-Key"] = credentials.apiKey;
  }

  if (token) {
    headers["X-API-Access-Token"] = token;
  }

  if (credentials.pat && !credentials.accessToken) {
    headers.Authorization = `Bearer ${credentials.pat}`;
  }

  return headers;
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
