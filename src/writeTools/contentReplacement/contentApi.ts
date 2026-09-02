import type { StackApiV3Page } from "../../api/stackApiV3";
import {
  ApiTransportError,
  InvalidApiResponseError,
  StackApiError,
} from "../../api/httpClient";
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
  answerCount?: number | null;
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

export type SearchSummary =
  | { type: "question"; questionId: number }
  | { type: "answer"; answerId: number; parentQuestionId: number }
  | { type: "article"; articleId: number };

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
  getSearchPage(query: string, page: number): Promise<ContentInventoryPage<SearchSummary>>;
  getItem(ref: ReplacementItemRef): Promise<ReplacementRequestModel>;
  updateItem(model: ReplacementRequestModel): Promise<void>;
}

export type ContentReplacementApiErrorCategory = "http" | "transport" | "schema";

export class ContentReplacementApiError extends Error {
  declare readonly status?: number;
  readonly category: ContentReplacementApiErrorCategory;

  constructor(
    message: string,
    category: ContentReplacementApiErrorCategory,
    status?: number,
  ) {
    super(message);
    this.name = "ContentReplacementApiError";
    this.category = category;
    if (category === "http" && isHttpStatus(status)) this.status = status;
  }
}

export function createContentReplacementClient(transport: ContentApiTransport): ContentReplacementClient {
  return {
    async getQuestionsPage(page) {
      return readInventoryPage("question", () =>
        transport.getPage<QuestionSummary>("/questions", { pageSize: PAGE_SIZE }, page),
      );
    },
    async getAnswersPage(questionId, page) {
      if (!isContentId(questionId)) throw readError("answer", questionId);
      const result = await readInventoryPage("answer", () =>
        transport.getPage<Omit<AnswerSummary, "questionId">>(
          `/questions/${questionId}/answers`,
          { pageSize: PAGE_SIZE },
          page,
        ),
      );
      return {
        ...result,
        items: result.items.map((answer) => ({ ...asRecord(answer)!, questionId } as AnswerSummary)),
      };
    },
    async getArticlesPage(page) {
      return readInventoryPage("article", () =>
        transport.getPage<ArticleSummary>("/articles", { pageSize: PAGE_SIZE }, page),
      );
    },
    async getSearchPage(query, page) {
      const result = await readInventoryPage("search", () =>
        transport.getPage<unknown>("/search", { query, pageSize: PAGE_SIZE }, page),
      );
      try {
        return { ...result, items: result.items.map(toSearchSummary) };
      } catch {
        throw schemaError("Unable to read search inventory.");
      }
    },
    async getItem(ref) {
      assertValidRef(ref, "reconstruct");
      let response: unknown;
      try {
        response = await transport.getJson<unknown>(detailPath(ref));
      } catch (error) {
        throw transportBoundaryError(`Unable to read ${ref.kind} ${requestedId(ref)}.`, error);
      }
      return reconstructRequestModel(ref, response);
    },
    async updateItem(model) {
      const ref = validModelRef(model);
      const request = exactUpdateRequest(model, ref);
      try {
        await transport.putJson(detailPath(ref), request);
      } catch (error) {
        throw transportBoundaryError(`Unable to update ${ref.kind} ${requestedId(ref)}.`, error);
      }
    },
  };
}

async function readInventoryPage<T>(
  kind: "question" | "answer" | "article" | "search",
  read: () => Promise<ContentInventoryPage<T>>,
): Promise<ContentInventoryPage<T>> {
  let result: ContentInventoryPage<T>;
  try {
    result = await read();
  } catch (error) {
    throw transportBoundaryError(`Unable to read ${kind} inventory.`, error);
  }
  if (!Array.isArray(result.items) || result.items.some((item) => !isContentId(asRecord(item)?.id))) {
    throw schemaError(`Unable to read ${kind} inventory.`);
  }
  return result;
}

function toSearchSummary(value: unknown): SearchSummary {
  const result = asRecord(value);
  if (!result || !isContentId(result.id)) throw new Error("Invalid search result.");
  if (result.type === "question") return { type: "question", questionId: result.id };
  if (result.type === "article") return { type: "article", articleId: result.id };
  if (result.type === "answer" && isContentId(result.parentQuestionId)) {
    return { type: "answer", answerId: result.id, parentQuestionId: result.parentQuestionId };
  }
  throw new Error("Invalid search result.");
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

function exactUpdateRequest(model: ReplacementRequestModel, ref: ReplacementItemRef) {
  if (model.kind !== ref.kind) throw updateError(ref.kind, requestedId(ref));
  const request = asRecord(model.request);
  if (!request) throw updateError(ref.kind, requestedId(ref));
  try {
    if (ref.kind === "answer") return { body: requiredString(request.body) };

    const common = {
      title: requiredString(request.title),
      body: requiredString(request.body),
      tags: requestTagNames(request.tags),
    };
    if (ref.kind === "question") return common;
    return {
      ...common,
      type: articleType(request.type),
      permissions: articlePermissionsRequest(request.permissions),
      ...expirationDate(request),
    };
  } catch {
    throw updateError(ref.kind, requestedId(ref));
  }
}

function validModelRef(model: ReplacementRequestModel): ReplacementItemRef {
  const record = asRecord(model);
  const ref = asRecord(record?.ref);
  if (!record || !isContentKind(record.kind) || !ref || ref.kind !== record.kind) {
    throw schemaError("Unable to update content item.");
  }
  const typedRef = ref as ReplacementItemRef;
  assertValidRef(typedRef, "update");
  return typedRef;
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

function isContentKind(value: unknown): value is ReplacementItemRef["kind"] {
  return value === "question" || value === "answer" || value === "article";
}

function assertValidRef(ref: ReplacementItemRef, operation: "reconstruct" | "update"): void {
  const ids = ref.kind === "answer" ? [ref.questionId, ref.answerId] : [requestedId(ref)];
  if (!ids.every(isContentId)) {
    throw operation === "reconstruct"
      ? reconstructionError(ref)
      : updateError(ref.kind, requestedId(ref));
  }
}

function reconstructionError(ref: ReplacementItemRef): ContentReplacementApiError {
  return schemaError(`Unable to reconstruct ${ref.kind} ${requestedId(ref)}.`);
}

function readError(kind: ReplacementItemRef["kind"], id: unknown): ContentReplacementApiError {
  return schemaError(`Unable to read ${kind} ${id}.`);
}

function updateError(kind: ReplacementItemRef["kind"], id: unknown): ContentReplacementApiError {
  return schemaError(`Unable to update ${kind} ${id}.`);
}

function schemaError(message: string): ContentReplacementApiError {
  return new ContentReplacementApiError(message, "schema");
}

function transportBoundaryError(message: string, error: unknown): ContentReplacementApiError {
  if (error instanceof StackApiError) {
    return new ContentReplacementApiError(message, "http", error.status);
  }
  if (error instanceof ApiTransportError) {
    return new ContentReplacementApiError(message, "transport");
  }
  if (error instanceof InvalidApiResponseError) {
    return new ContentReplacementApiError(message, "schema");
  }
  return new ContentReplacementApiError(message, "schema");
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function isHttpStatus(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 100 && value <= 599;
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

function requestTagNames(value: unknown): string[] {
  if (!Array.isArray(value) || value.some((tag) => typeof tag !== "string" || !tag)) {
    throw new Error("Invalid content tag.");
  }
  return [...value];
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

function articlePermissionsRequest(value: unknown): ArticlePermissionsRequest {
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
    editorUserIds: editorIdsRequest(permissions.editorUserIds),
    editorUserGroupIds: editorIdsRequest(permissions.editorUserGroupIds),
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

function editorIdsRequest(value: unknown): number[] {
  if (!Array.isArray(value) || !value.every(isContentId)) {
    throw new Error("Invalid article editor ID list.");
  }
  return [...value];
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
