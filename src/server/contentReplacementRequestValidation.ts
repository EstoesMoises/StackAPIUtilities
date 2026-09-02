import type { SessionCredentials } from "../domain/types";
import {
  MAX_FIND_LENGTH,
  MAX_REPLACEMENT_LENGTH,
  MAX_REPLACEMENT_RULES,
  validateReplacementRules,
} from "../writeTools/contentReplacement/rules";
import type {
  ArticlePermissionsRequest,
  ReplacementConfiguration,
  ReplacementItemRef,
  ReplacementRequestModel,
  ReplacementRule,
} from "../writeTools/contentReplacement/types";

const MAX_BASE_URL_LENGTH = 2_048;
const MAX_CREDENTIAL_STRING_LENGTH = 65_536;
const MAX_RULE_ID_LENGTH = 200;
const MAX_CONTENT_STRING_LENGTH = 1_048_576;
const MAX_STRING_LIST_ITEMS = 10_000;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;

export function validateSessionCredentials(value: unknown): SessionCredentials | null {
  try {
    if (
      !isRecord(value) ||
      !hasOnlyKeys(value, [
        "instanceType", "baseUrl", "apiKey", "accessToken", "pat", "authSource",
        "oauthClientId", "oauthScopes", "accessTokenExpiresAt",
      ]) ||
      (value.instanceType !== "enterprise" && value.instanceType !== "basic-business") ||
      !isBoundedString(value.baseUrl, 1, MAX_BASE_URL_LENGTH) ||
      !isOptionalBoundedString(value.apiKey) ||
      !isOptionalBoundedString(value.accessToken) ||
      !isOptionalBoundedString(value.pat) ||
      !isOptionalBoundedString(value.oauthClientId) ||
      !isOptionalBoundedString(value.accessTokenExpiresAt) ||
      !isOptionalAuthSource(value.authSource)
    ) {
      return null;
    }
    if (
      value.oauthScopes !== undefined &&
      (!Array.isArray(value.oauthScopes) ||
        value.oauthScopes.length > 100 ||
        !value.oauthScopes.every((scope) => isBoundedString(scope, 1, 200)))
    ) {
      return null;
    }
    return value as unknown as SessionCredentials;
  } catch {
    return null;
  }
}

export function validateConfiguration(value: unknown): ReplacementConfiguration | null {
  try {
    if (!isRecord(value) || !isExactObject(value, ["target", "contentTypes", "rules", "options"])) {
      return null;
    }
    if (!isRecord(value.target) || !isExactObject(value.target, ["kind"]) || value.target.kind !== "enterprise-main") {
      return null;
    }
    if (
      !isRecord(value.contentTypes) ||
      !isExactObject(value.contentTypes, ["questions", "answers", "articles"]) ||
      typeof value.contentTypes.questions !== "boolean" ||
      typeof value.contentTypes.answers !== "boolean" ||
      typeof value.contentTypes.articles !== "boolean" ||
      !(value.contentTypes.questions || value.contentTypes.answers || value.contentTypes.articles)
    ) {
      return null;
    }
    if (
      !isRecord(value.options) ||
      !isExactObject(value.options, ["caseSensitive", "wholeTerm", "replaceInCode"]) ||
      typeof value.options.caseSensitive !== "boolean" ||
      typeof value.options.wholeTerm !== "boolean" ||
      typeof value.options.replaceInCode !== "boolean"
    ) {
      return null;
    }
    if (
      !Array.isArray(value.rules) ||
      value.rules.length < 1 ||
      value.rules.length > MAX_REPLACEMENT_RULES ||
      !value.rules.every(isExactReplacementRule)
    ) {
      return null;
    }

    const options = {
      caseSensitive: value.options.caseSensitive,
      wholeTerm: value.options.wholeTerm,
      replaceInCode: value.options.replaceInCode,
    };
    const validated = validateReplacementRules(value.rules as ReplacementRule[], options);
    if (validated.errors.length > 0 || validated.rules.length < 1) return null;
    return {
      target: { kind: "enterprise-main" },
      contentTypes: {
        questions: value.contentTypes.questions,
        answers: value.contentTypes.answers,
        articles: value.contentTypes.articles,
      },
      rules: validated.rules,
      options,
    };
  } catch {
    return null;
  }
}

export function validateItemRef(value: unknown): ReplacementItemRef | null {
  try {
    if (!isRecord(value)) return null;
    if (
      value.kind === "question" &&
      isExactObject(value, ["kind", "questionId"]) &&
      isPositiveSafeInteger(value.questionId)
    ) {
      return { kind: "question", questionId: value.questionId };
    }
    if (
      value.kind === "answer" &&
      isExactObject(value, ["kind", "questionId", "answerId"]) &&
      isPositiveSafeInteger(value.questionId) &&
      isPositiveSafeInteger(value.answerId)
    ) {
      return { kind: "answer", questionId: value.questionId, answerId: value.answerId };
    }
    if (
      value.kind === "article" &&
      isExactObject(value, ["kind", "articleId"]) &&
      isPositiveSafeInteger(value.articleId)
    ) {
      return { kind: "article", articleId: value.articleId };
    }
    return null;
  } catch {
    return null;
  }
}

export function isSelectedKind(
  ref: ReplacementItemRef,
  configuration: ReplacementConfiguration,
): boolean {
  if (ref.kind === "question") return configuration.contentTypes.questions;
  if (ref.kind === "answer") return configuration.contentTypes.answers;
  return configuration.contentTypes.articles;
}

export function isSha256Digest(value: unknown): value is string {
  return typeof value === "string" && SHA256_PATTERN.test(value);
}

export function isOriginOnlyInstanceUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.pathname === "/" && url.search === "" && url.hash === "" &&
      url.username === "" && url.password === ""
    );
  } catch {
    return false;
  }
}

export function sameRef(left: ReplacementItemRef, right: ReplacementItemRef): boolean {
  if (left.kind !== right.kind) return false;
  if (left.kind === "question" && right.kind === "question") return left.questionId === right.questionId;
  if (left.kind === "article" && right.kind === "article") return left.articleId === right.articleId;
  return left.kind === "answer" && right.kind === "answer" &&
    left.questionId === right.questionId && left.answerId === right.answerId;
}

export function normalizeCurrentRequestModel(
  value: unknown,
  expectedRef: ReplacementItemRef,
): ReplacementRequestModel | null {
  return normalizeRequestModel(value, expectedRef, false);
}

export function validateExactPriorRequestModel(
  value: unknown,
  expectedRef: ReplacementItemRef,
): ReplacementRequestModel | null {
  return normalizeRequestModel(value, expectedRef, true);
}

function normalizeRequestModel(
  value: unknown,
  expectedRef: ReplacementItemRef,
  requireExactModel: boolean,
): ReplacementRequestModel | null {
  try {
    if (!isRecord(value)) return null;
    if (requireExactModel && !isExactObject(value, ["kind", "ref", "request"])) return null;
    const ref = validateItemRef(value.ref);
    if (!ref || value.kind !== ref.kind || !sameRef(ref, expectedRef) || !isRecord(value.request)) return null;

    if (ref.kind === "answer") {
      if (!isExactObject(value.request, ["body"]) || !isContentString(value.request.body)) return null;
      return { kind: "answer", ref, request: { body: value.request.body } };
    }

    if (
      ref.kind === "question" &&
      isExactObject(value.request, ["title", "body", "tags"]) &&
      isContentString(value.request.title) &&
      isContentString(value.request.body) &&
      isStringList(value.request.tags)
    ) {
      return {
        kind: "question",
        ref,
        request: { title: value.request.title, body: value.request.body, tags: [...value.request.tags] },
      };
    }
    if (ref.kind !== "article") return null;
    const requestKeys = Object.keys(value.request);
    const expectedKeys = "expirationDate" in value.request
      ? ["title", "body", "tags", "type", "expirationDate", "permissions"]
      : ["title", "body", "tags", "type", "permissions"];
    if (
      requestKeys.length !== expectedKeys.length ||
      !hasOnlyKeys(value.request, expectedKeys) ||
      !isContentString(value.request.title) ||
      !isContentString(value.request.body) ||
      !isStringList(value.request.tags) ||
      !isArticleType(value.request.type) ||
      !(value.request.expirationDate === undefined || value.request.expirationDate === null || isContentString(value.request.expirationDate))
    ) {
      return null;
    }
    const permissions = validateArticlePermissions(value.request.permissions);
    if (!permissions) return null;
    return {
      kind: "article",
      ref,
      request: {
        title: value.request.title,
        body: value.request.body,
        tags: [...value.request.tags],
        type: value.request.type,
        ...(value.request.expirationDate === undefined ? {} : { expirationDate: value.request.expirationDate }),
        permissions,
      },
    };
  } catch {
    return null;
  }
}

function validateArticlePermissions(value: unknown): ArticlePermissionsRequest | null {
  if (!isRecord(value)) return null;
  const expectedKeys = "editableBy" in value
    ? ["editableBy", "editorUserIds", "editorUserGroupIds"]
    : ["editorUserIds", "editorUserGroupIds"];
  if (
    !isExactObject(value, expectedKeys) ||
    !(value.editableBy === undefined || value.editableBy === "ownerOnly" || value.editableBy === "specificEditors" || value.editableBy === "everyone") ||
    !isIdList(value.editorUserIds) ||
    !isIdList(value.editorUserGroupIds)
  ) {
    return null;
  }
  return {
    ...(value.editableBy === undefined ? {} : { editableBy: value.editableBy }),
    editorUserIds: [...value.editorUserIds],
    editorUserGroupIds: [...value.editorUserGroupIds],
  };
}

function isExactReplacementRule(value: unknown): value is ReplacementRule {
  return isRecord(value) &&
    hasOnlyKeys(value, ["id", "find", "replace", "sourceRow"]) &&
    isBoundedString(value.id, 1, MAX_RULE_ID_LENGTH) &&
    isBoundedString(value.find, 0, MAX_FIND_LENGTH) &&
    isBoundedString(value.replace, 0, MAX_REPLACEMENT_LENGTH) &&
    (value.sourceRow === undefined || isPositiveSafeInteger(value.sourceRow));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isExactObject(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && hasOnlyKeys(value, keys);
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const allowed = new Set(keys);
  return Object.keys(value).every((key) => allowed.has(key));
}

function isBoundedString(value: unknown, minimum: number, maximum: number): value is string {
  return typeof value === "string" && value.length >= minimum && value.length <= maximum;
}

function isContentString(value: unknown): value is string {
  return isBoundedString(value, 0, MAX_CONTENT_STRING_LENGTH);
}

function isOptionalBoundedString(value: unknown): value is string | undefined {
  return value === undefined || isBoundedString(value, 0, MAX_CREDENTIAL_STRING_LENGTH);
}

function isOptionalAuthSource(value: unknown): value is SessionCredentials["authSource"] | undefined {
  return value === undefined || value === "manual-pat" ||
    value === "manual-enterprise-token" || value === "oauth-pkce";
}

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function isStringList(value: unknown): value is string[] {
  return Array.isArray(value) && value.length <= MAX_STRING_LIST_ITEMS &&
    value.every((item) => isContentString(item) && item.length > 0);
}

function isIdList(value: unknown): value is number[] {
  return Array.isArray(value) && value.length <= MAX_STRING_LIST_ITEMS && value.every(isPositiveSafeInteger);
}

function isArticleType(value: unknown): value is "knowledgeArticle" | "announcement" | "policy" | "howToGuide" {
  return value === "knowledgeArticle" || value === "announcement" || value === "policy" || value === "howToGuide";
}
