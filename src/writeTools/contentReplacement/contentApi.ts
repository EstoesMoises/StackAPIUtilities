import type { StackApiV3Page } from "../../api/stackApiV3";
import type {
  ArticlePermissionsRequest,
  ArticleType,
  ReplacementItemRef,
  ReplacementMetadata,
  ReplacementRequestModel,
} from "./types";

const PAGE_SIZE = "100";

export interface ContentInventoryPage<T> extends StackApiV3Page<T> {}

export interface QuestionSummary {
  id: number;
  title?: string | null;
  body?: string | null;
}

export interface AnswerSummary {
  id: number;
  questionId: number;
  body?: string | null;
}

export interface ArticleSummary {
  id: number;
  title?: string | null;
  body?: string | null;
}

export interface ContentApiTransport {
  getPage<T = unknown>(
    path: string,
    query: Record<string, string>,
    page: number,
  ): Promise<StackApiV3Page<T>>;
  getJson<T = unknown>(path: string): Promise<T>;
  putJson<T = unknown>(path: string, body: unknown): Promise<T>;
}

export interface ContentReplacementClient {
  getQuestionsPage(page: number): Promise<ContentInventoryPage<QuestionSummary>>;
  getAnswersPage(questionId: number, page: number): Promise<ContentInventoryPage<AnswerSummary>>;
  getArticlesPage(page: number): Promise<ContentInventoryPage<ArticleSummary>>;
  getItem(ref: ReplacementItemRef): Promise<ReplacementRequestModel>;
  updateItem(model: ReplacementRequestModel): Promise<void>;
}

export function createContentReplacementClient(transport: ContentApiTransport): ContentReplacementClient {
  return {
    async getQuestionsPage(page) {
      return transport.getPage<QuestionSummary>("/questions", { pageSize: PAGE_SIZE }, page);
    },
    async getAnswersPage(questionId, page) {
      const result = await transport.getPage<Omit<AnswerSummary, "questionId">>(
        `/questions/${questionId}/answers`,
        { pageSize: PAGE_SIZE },
        page,
      );
      return { ...result, items: result.items.map((answer) => ({ ...answer, questionId })) };
    },
    async getArticlesPage(page) {
      return transport.getPage<ArticleSummary>("/articles", { pageSize: PAGE_SIZE }, page);
    },
    async getItem(ref) {
      assertValidRef(ref);
      const response = await transport.getJson<unknown>(detailPath(ref));
      return reconstructRequestModel(ref, response);
    },
    async updateItem(model) {
      assertValidRef(model.ref);
      await transport.putJson(detailPath(model.ref), model.request);
    },
  };
}

function reconstructRequestModel(ref: ReplacementItemRef, response: unknown): ReplacementRequestModel {
  const detail = asRecord(response);
  if (!detail || detail.id !== requestedId(ref)) throw reconstructionError(ref);

  const metadata = extractMetadata(detail);
  try {
    if (ref.kind === "answer") {
      return withOptionalMetadata({
        kind: "answer",
        ref,
        request: { body: requiredString(detail.bodyMarkdown) },
      }, metadata);
    }

    const common = {
      title: requiredString(detail.title),
      body: requiredString(detail.bodyMarkdown),
      tags: tagNames(detail.tags),
    };
    if (ref.kind === "question") {
      return withOptionalMetadata({ kind: "question", ref, request: common }, metadata);
    }

    const request = {
      ...common,
      type: articleType(detail.type),
      permissions: articlePermissions(detail.permissions),
      ...expirationDate(detail),
    };
    return withOptionalMetadata({ kind: "article", ref, request }, metadata);
  } catch {
    throw reconstructionError(ref);
  }
}

function withOptionalMetadata<T extends ReplacementRequestModel>(
  model: T,
  metadata: ReplacementMetadata | undefined,
): T {
  return metadata ? { ...model, metadata } : model;
}

function detailPath(ref: ReplacementItemRef): string {
  if (ref.kind === "question") return `/questions/${ref.questionId}`;
  if (ref.kind === "answer") return `/questions/${ref.questionId}/answers/${ref.answerId}`;
  return `/articles/${ref.articleId}`;
}

function requestedId(ref: ReplacementItemRef): number {
  return ref.kind === "question" ? ref.questionId : ref.kind === "answer" ? ref.answerId : ref.articleId;
}

function assertValidRef(ref: ReplacementItemRef): void {
  const ids = ref.kind === "answer" ? [ref.questionId, ref.answerId] : [requestedId(ref)];
  if (!ids.every(isContentId)) throw reconstructionError(ref);
}

function reconstructionError(ref: ReplacementItemRef): Error {
  return new Error(`Unable to reconstruct ${ref.kind} ${requestedId(ref)}.`);
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function isContentId(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function requiredString(value: unknown): string {
  if (typeof value !== "string") throw new Error("Invalid required content field.");
  return value;
}

function tagNames(value: unknown): string[] {
  if (!Array.isArray(value)) throw new Error("Invalid content tags.");
  return value.map((tag) => {
    const name = asRecord(tag)?.name;
    if (typeof name !== "string" || !name) throw new Error("Invalid content tag.");
    return name;
  });
}

function articleType(value: unknown): ArticleType {
  if (
    value !== "knowledgeArticle" &&
    value !== "announcement" &&
    value !== "policy" &&
    value !== "howToGuide"
  ) {
    throw new Error("Invalid article type.");
  }
  return value;
}

function expirationDate(detail: Record<string, unknown>): { expirationDate?: string | null } {
  if (!("expirationDate" in detail)) return {};
  if (detail.expirationDate !== null && typeof detail.expirationDate !== "string") {
    throw new Error("Invalid article expiration date.");
  }
  return { expirationDate: detail.expirationDate };
}

function articlePermissions(value: unknown): ArticlePermissionsRequest {
  const permissions = asRecord(value);
  if (!permissions) throw new Error("Invalid article permissions.");
  const editableBy = permissions.editableBy;
  if (
    editableBy !== undefined &&
    editableBy !== "ownerOnly" &&
    editableBy !== "specificEditors" &&
    editableBy !== "everyone"
  ) {
    throw new Error("Invalid article editor scope.");
  }
  return {
    ...(editableBy === undefined ? {} : { editableBy }),
    editorUserIds: editorIds(permissions.editorUsers),
    editorUserGroupIds: editorIds(permissions.editorUserGroups),
  };
}

function editorIds(value: unknown): number[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error("Invalid article editor list.");
  return value.map((editor) => {
    const id = asRecord(editor)?.id;
    if (!isContentId(id)) throw new Error("Invalid article editor.");
    return id;
  });
}

function extractMetadata(detail: Record<string, unknown>): ReplacementMetadata | undefined {
  const metadata: ReplacementMetadata = {};
  const owner = metadataUser(detail.owner);
  if (owner) metadata.owner = owner;
  const lastEditor = metadataUser(detail.lastEditor);
  if (lastEditor) metadata.lastEditor = lastEditor;
  if (typeof detail.webUrl === "string") metadata.webUrl = detail.webUrl;
  if (detail.lastActivityDate === null || typeof detail.lastActivityDate === "string") {
    metadata.lastActivityDate = detail.lastActivityDate;
  }
  return Object.keys(metadata).length ? metadata : undefined;
}

function metadataUser(value: unknown): { id: number; name?: string } | undefined {
  const user = asRecord(value);
  if (!user || !isContentId(user.id)) return undefined;
  return typeof user.name === "string" ? { id: user.id, name: user.name } : { id: user.id };
}
