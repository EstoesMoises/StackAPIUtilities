export type InstanceType = "basic-business" | "enterprise";

export type ReportPhase = "mvp" | "later";

export type ReportCapability = "live-api" | "upload";

export type CredentialRequirement = "api-key" | "access-token" | "pat" | "enterprise-admin" | "community-access";

export type DatasetName =
  | "users"
  | "tags"
  | "questions"
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
  name: DatasetName;
  records: unknown[];
  loadedAt: string;
  source: "live-api" | "upload";
}

export interface ImportedReportOutput {
  reportId: ReportId;
  datasetName: DatasetName;
  fileName: string;
  records: Record<string, unknown>[];
  loadedAt: string;
  source: "upload";
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
  datasets: Partial<Record<DatasetName, SessionDataset>>;
  reportOutputs: Partial<Record<ReportId, ImportedReportOutput>>;
  warnings: ReportWarning[];
  runQueue: RunQueueItem[];
}
