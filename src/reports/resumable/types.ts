import type { PeriodScope, ReportId, RunPeriodRole } from "../../domain/types";

export interface ReportReadRequest {
  api: "v2" | "v3";
  path: string;
  query: Record<string, string>;
}

export interface ReportReadResponse {
  status: number;
  body: unknown;
  headers: Record<string, string>;
}

export interface ReportJob {
  version: 1;
  id: string;
  revision: number;
  reportId: ReportId;
  reportTitle: string;
  connectionKey: string;
  credentialFingerprint: string;
  periods: { periodRole: RunPeriodRole; scope: PeriodScope }[];
  status: "paused" | "running" | "failed" | "complete";
  createdAt: string;
  updatedAt: string;
  completedRequests: number;
  savedBytes: number;
  activeMs: number;
  timings: Record<"v2" | "v3", { count: number; milliseconds: number }>;
  retryAt: number | null;
  stage: string;
  error: string | null;
}

export interface ReportJobStore {
  load(): Promise<ReportJob | null>;
  create(job: ReportJob): Promise<ReportJob>;
  save(job: ReportJob): Promise<ReportJob>;
  read(jobId: string, key: string): Promise<ReportReadResponse | null>;
  checkpoint(job: ReportJob, key: string, response: ReportReadResponse, elapsedMs: number, api: "v2" | "v3"): Promise<ReportJob>;
  delete(jobId: string): Promise<void>;
}

export interface ReportTimeEstimate {
  minimumSeconds: number;
  maximumSeconds: number;
}

export interface ReportJobProgress {
  job: ReportJob;
  estimate: ReportTimeEstimate | null;
  restoring: boolean;
}
