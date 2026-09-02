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

export type ReplacementRequestModel =
  | {
      kind: "question";
      ref: Extract<ReplacementItemRef, { kind: "question" }>;
      request: QuestionUpdateRequest;
      metadata?: ReplacementMetadata;
    }
  | {
      kind: "answer";
      ref: Extract<ReplacementItemRef, { kind: "answer" }>;
      request: AnswerUpdateRequest;
      metadata?: ReplacementMetadata;
    }
  | {
      kind: "article";
      ref: Extract<ReplacementItemRef, { kind: "article" }>;
      request: ArticleUpdateRequest;
      metadata?: ReplacementMetadata;
    };

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
