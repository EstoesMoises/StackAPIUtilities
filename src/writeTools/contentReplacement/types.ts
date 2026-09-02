export type ReplacementContentKind = "question" | "answer" | "article";

export type ReplacementItemRef =
  | { kind: "question"; questionId: number }
  | { kind: "answer"; questionId: number; answerId: number }
  | { kind: "article"; articleId: number };

export interface ReplacementRule {
  id: string;
  find: string;
  replace: string;
  sourceRow?: number;
}

export interface ReplacementOptions {
  caseSensitive: boolean;
  wholeTerm: boolean;
  replaceInCode: boolean;
}

export interface ReplacementConfiguration {
  target: { kind: "enterprise-main" };
  contentTypes: { questions: boolean; answers: boolean; articles: boolean };
  rules: ReplacementRule[];
  options: ReplacementOptions;
}

export type ReplacementRuleErrorCode =
  | "blank-source"
  | "blank-replacement"
  | "no-op"
  | "duplicate-source"
  | "replacement-is-source"
  | "overlapping-sources";

export interface QuestionUpdateRequest {
  title: string;
  body: string;
  tags: string[];
}

export interface AnswerUpdateRequest {
  body: string;
}

export type ArticleType = "knowledgeArticle" | "announcement" | "policy" | "howToGuide";

export interface ArticlePermissionsRequest {
  editableBy?: "ownerOnly" | "specificEditors" | "everyone";
  editorUserIds: number[];
  editorUserGroupIds: number[];
}

export interface ArticleUpdateRequest {
  title: string;
  body: string;
  tags: string[];
  type: ArticleType;
  expirationDate?: string | null;
  permissions: ArticlePermissionsRequest;
}

export interface ReplacementMetadata {
  titleContext?: string;
  webUrl?: string;
  owner?: { id: number; name?: string };
  lastEditor?: { id: number; name?: string };
  lastActivityDate?: string | null;
}

type ReplacementRequestModelBase =
  | {
      kind: "question";
      ref: Extract<ReplacementItemRef, { kind: "question" }>;
      request: QuestionUpdateRequest;
    }
  | {
      kind: "answer";
      ref: Extract<ReplacementItemRef, { kind: "answer" }>;
      request: AnswerUpdateRequest;
    }
  | {
      kind: "article";
      ref: Extract<ReplacementItemRef, { kind: "article" }>;
      request: ArticleUpdateRequest;
    };

type WithoutReplacementMetadata<T> = T extends ReplacementRequestModelBase
  ? T & { metadata?: never }
  : never;

type WithReplacementMetadata<T> = T extends ReplacementRequestModelBase
  ? T & { metadata?: ReplacementMetadata }
  : never;

export type ReplacementWireRequestModel = WithoutReplacementMetadata<ReplacementRequestModelBase>;
export type ReplacementRequestModel = WithReplacementMetadata<ReplacementRequestModelBase>;

export type ReplacementProposalField = "title" | "body";

export interface ReplacementOccurrence {
  field: ReplacementProposalField;
  ruleId: string;
  start: number;
  end: number;
  before: string;
  after: string;
}

export type ReplacementProtectedOccurrenceReason =
  | "code"
  | "destination"
  | "raw-html-attribute"
  | "raw-html-syntax"
  | "raw-html-hidden";

export interface ReplacementProtectedOccurrence {
  field: ReplacementProposalField;
  ruleId: string;
  start: number;
  end: number;
  before: string;
  reason: ReplacementProtectedOccurrenceReason;
}

export interface ReplacementFieldMarkdown {
  beforeMarkdown: string;
  afterMarkdown: string;
}

export interface ReplacementProposal {
  before: ReplacementRequestModel;
  after: ReplacementRequestModel;
  scannedRequestChecksum: string;
  proposedRequestChecksum: string;
  proposalFingerprint: string;
  fields: {
    title?: ReplacementFieldMarkdown;
    body: ReplacementFieldMarkdown;
  };
  changedOccurrences: ReplacementOccurrence[];
  protectedOccurrences: ReplacementProtectedOccurrence[];
  appliedRuleIds: string[];
  metadata?: ReplacementMetadata;
}

export type InventoryCursor =
  | { kind: "questions"; page: number }
  | { kind: "answers"; questionId: number; page: number }
  | { kind: "articles"; page: number };

export interface InventorySliceResult {
  candidates: ReplacementItemRef[];
  answerCursors: Extract<InventoryCursor, { kind: "answers" }>[];
  nextCursor: InventoryCursor | null;
  inspectedCount: number;
  pageKind: InventoryCursor["kind"];
}

export interface DetailBatchResult {
  proposals: ReplacementProposal[];
  inspectedCount: number;
  protectedOccurrenceCount: number;
}

export type ContentReplacementJobStage =
  | "define"
  | "scan"
  | "review"
  | "apply"
  | "results"
  | "recovery";

export type ContentReplacementJobStatus =
  | "idle"
  | "running"
  | "paused"
  | "completed"
  | "failed"
  | "cancelled";

export interface PersistedContentReplacementProgress {
  questionPages: number;
  answerPages: number;
  articlePages: number;
  inventoryItems: number;
  detailsInspected: number;
  proposalsFound: number;
  protectedOccurrences: number;
  applyCompleted: number;
  recoveryCompleted: number;
}

export type PersistedContentReplacementItemStatus =
  | "pending"
  | "excluded"
  | "ready-to-apply"
  | "applying"
  | "applied"
  | "stale"
  | "failed"
  | "ready-to-recover"
  | "recovering"
  | "recovered"
  | "recovery-conflict"
  | "recovery-failed";

export interface PersistedContentReplacementFailure {
  category:
    | "network"
    | "authorization"
    | "validation"
    | "rate-limit"
    | "storage"
    | "server"
    | "unknown";
  message: string;
  retryable: boolean;
  statusCode?: number;
  occurredAt: string;
}

export type PersistedContentReplacementResult =
  | {
      kind: "applied";
      observedRequestChecksum: string;
      completedAt: string;
    }
  | {
      kind: "unchanged";
      observedRequestChecksum: string;
      completedAt: string;
    }
  | {
      kind: "stale" | "excluded";
      completedAt: string;
    }
  | {
      kind: "verification-failed";
      expectedRequestChecksum: string;
      observedRequestChecksum: string;
      completedAt: string;
    };

export type PersistedContentReplacementRecoveryResult =
  | {
      kind: "recovered" | "conflict" | "verification-failed";
      observedRequestChecksum: string;
      expectedRequestChecksum?: string;
      sourceAttemptCount: number;
      sourceApplyCompletedAt: string;
      completedAt: string;
    };

export interface PersistedContentReplacementRecovery {
  priorRequestModel: ReplacementRequestModel;
  scannedRequestChecksum: string;
  proposedRequestChecksum: string;
  observedPostApplyChecksum?: string;
  status: "pending" | "ready" | "applied" | "conflict" | "failed";
  preview?: PersistedContentReplacementRecoveryPreview;
  result?: PersistedContentReplacementRecoveryResult;
}

export interface PersistedContentReplacementRecoveryPreview {
  status: "recoverable" | "already-recovered" | "conflict";
  currentRequestModel: ReplacementWireRequestModel;
  observedCurrentChecksum: string;
  expectedPostApplyChecksum: string;
  sourceAttemptCount: number;
  sourceApplyCompletedAt: string;
  previewedAt: string;
}

export interface PersistedContentReplacementItem {
  proposal: ReplacementProposal;
  included: boolean;
  exclusionReason?: "user" | "bulk";
  attemptCount: number;
  status: PersistedContentReplacementItemStatus;
  result?: PersistedContentReplacementResult;
  failure?: PersistedContentReplacementFailure;
  recovery?: PersistedContentReplacementRecovery;
}

export type PersistedContentReplacementActiveOperation =
  | {
      kind: "stale-rescan";
      requestedItemKeys: string[];
      remainingItemKeys: string[];
      completedItemKeys: string[];
      generation: string;
      proposals: Record<string, ReplacementProposal>;
      inspectedCount: number;
      protectedOccurrenceCount: number;
    }
  | {
      kind: "recovery-preview" | "recovery-apply";
      requestedItemKeys: string[];
      remainingItemKeys: string[];
      completedItemKeys: string[];
      generation: string;
    };

export interface PersistedContentReplacementJob {
  schemaVersion: 1;
  id: string;
  fingerprint: string;
  baseUrl: string;
  target: { kind: "enterprise-main" };
  configuration: ReplacementConfiguration;
  stage: ContentReplacementJobStage;
  status: ContentReplacementJobStatus;
  inventoryQueue: InventoryCursor[];
  detailQueue: ReplacementItemRef[];
  progress: PersistedContentReplacementProgress;
  proposals: Record<string, PersistedContentReplacementItem>;
  recoverySnapshotStatus: "none" | "preparing" | "ready" | "failed";
  activeOperation?: PersistedContentReplacementActiveOperation;
  operationError?: PersistedContentReplacementFailure;
  nextRetryAt?: string;
  failure?: PersistedContentReplacementFailure;
  createdAt: string;
  updatedAt: string;
}
