export type InstanceType = "basic-business" | "enterprise";

export type ReportPhase = "mvp" | "later";

export type ReportCapability = "live-api" | "upload";

export type CredentialRequirement = "api-key" | "access-token" | "pat" | "enterprise-admin" | "community-access";

export type RunPeriodRole = "current" | "comparison";

export interface PeriodScope {
  startDate?: string;
  endDate?: string;
}

export interface ReportRunScope {
  current: PeriodScope;
  comparison?: PeriodScope;
  pageSize: number;
  maxPagesPerDataset: number;
}

export type DatasetName =
  | "users"
  | "tags"
  | "questions"
  | "answers"
  | "comments"
  | "articles"
  | "communities"
  | "userGroups"
  | "tagSmes"
  | "reputationHistory"
  | "interactions"
  | "dataExport";

export type ReportId =
  | "tag-report"
  | "api-user-report"
  | "inactive-users"
  | "interactions"
  | "community-members"
  | "data-export"
  | "webhook-report"
  | "search-log-report"
  | "api-import"
  | "user-groups"
  | "scim-user-activation"
  | "scim-user-deactivation"
  | "scim-user-deletion";

export interface SessionCredentials {
  instanceType: InstanceType;
  baseUrl: string;
  apiKey?: string;
  accessToken?: string;
  pat?: string;
  authSource?: "manual-pat" | "manual-enterprise-token" | "oauth-pkce";
  oauthClientId?: string;
  oauthScopes?: string[];
  accessTokenExpiresAt?: string;
}

export interface ReportMetadata {
  readonly id: ReportId;
  readonly phase: ReportPhase;
  readonly title: string;
  readonly sourceRepo: string;
  readonly description: string;
  readonly supportedInstances: readonly InstanceType[];
  readonly capabilities: readonly ReportCapability[];
  readonly credentialRequirements: readonly CredentialRequirement[];
  readonly requiredDatasets: readonly DatasetName[];
  readonly excludedReason?: string;
}

export interface ReportWarning {
  reportId?: ReportId;
  code: string;
  message: string;
}

export interface SessionDataset {
  id: string;
  snapshotId?: string;
  reportId?: ReportId;
  name: DatasetName;
  records: unknown[];
  loadedAt: string;
  source: "live-api" | "upload";
  periodRole?: RunPeriodRole;
  scope?: PeriodScope;
  warnings?: ReportWarning[];
  fileName?: string;
}

export interface ReportRunSnapshot {
  id: string;
  reportId: ReportId;
  periodRole: RunPeriodRole;
  scope: PeriodScope;
  pageSize: number;
  maxPagesPerDataset: number;
  loadedAt: string;
  datasetIds: string[];
  warnings: ReportWarning[];
}

export interface ReportOutput {
  reportId: ReportId;
  datasetName: DatasetName;
  fileName: string;
  records: Record<string, unknown>[];
  comparisonRecords?: Record<string, unknown>[];
  loadedAt: string;
  source: "live-api" | "upload";
  currentScope?: PeriodScope;
  comparisonScope?: PeriodScope;
  currentSnapshotId?: string;
  comparisonSnapshotId?: string;
  warnings?: ReportWarning[];
}

export interface RunQueueItem {
  id: string;
  reportId: ReportId;
  status: "queued" | "running" | "succeeded" | "failed";
  message: string;
}

export interface SessionState {
  credentials: SessionCredentials | null;
  selectedReportId: ReportId;
  selectedReportIds: readonly ReportId[];
  datasets: Record<string, SessionDataset>;
  reportOutputs: Partial<Record<ReportId, ReportOutput>>;
  reportRunSnapshots: ReportRunSnapshot[];
  warnings: ReportWarning[];
  runQueue: RunQueueItem[];
}
