import { StackApiV2Client } from "../api/stackApiV2";
import { StackApiV3Client } from "../api/stackApiV3";
import type { FetchLike, ThrottleNotice } from "../api/httpClient";
import { normalizeInstanceUrl, validateCredentialsForReport } from "../credentials/credentialRules";
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
import { collectDataset, getUnsupportedLiveDatasets, type LiveCollectorClients } from "./liveCollectors";

export interface LiveReportDataset {
  datasetName: DatasetName;
  records: Record<string, unknown>[];
}

export interface LiveReportRunResult {
  reportId: ReportId;
  reportTitle: string;
  periodRole: RunPeriodRole;
  scope: PeriodScope;
  pageSize: number;
  maxPagesPerDataset: number;
  datasets: LiveReportDataset[];
  messages: string[];
  warnings: ReportWarning[];
}

export interface LiveReportRunOptions {
  fetchFn?: FetchLike;
  onThrottle?: (notice: ThrottleNotice) => void | Promise<void>;
  periodRole?: RunPeriodRole;
  scope?: PeriodScope;
  pageSize?: number;
  maxPagesPerDataset?: number;
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
  const pageSize = options.pageSize ?? DEFAULT_REPORT_RUN_SCOPE.pageSize;
  const maxPagesPerDataset = options.maxPagesPerDataset ?? DEFAULT_REPORT_RUN_SCOPE.maxPagesPerDataset;

  for (const datasetName of plannedDatasets) {
    const records = toRecordList(
      await collectDataset(datasetName, clients, {
        collectedDatasets,
        periodRole,
        scope,
        pageSize,
        maxPagesPerDataset,
      }),
    );
    collectedDatasets[datasetName] = records;
    datasets.push({ datasetName, records });
  }

  datasets.push(...buildSyntheticDatasets(reportId, datasets));

  return {
    reportId,
    reportTitle: report.title,
    periodRole,
    scope,
    pageSize,
    maxPagesPerDataset,
    datasets,
    messages: datasets.map((dataset) => formatDatasetMessage(reportId, report.title, dataset)),
    warnings: [],
  };
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

function createLiveCollectorClients(
  credentials: SessionCredentials,
  options: LiveReportRunOptions,
): LiveCollectorClients {
  const instance = normalizeInstanceUrl(credentials.baseUrl);
  const token = credentials.instanceType === "basic-business" ? credentials.pat ?? "" : credentials.accessToken ?? "";

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
