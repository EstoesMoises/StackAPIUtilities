import {
  MAX_STACK_API_V3_BACKOFF_NOTICE_SECONDS,
  StackApiV3Client,
} from "../api/stackApiV3";
import type { ThrottleNotice } from "../api/httpClient";
import type { NormalizedInstance } from "../credentials/credentialRules";
import type { SessionCredentials } from "../domain/types";
import {
  createContentReplacementClient,
  type ContentReplacementClient,
} from "../writeTools/contentReplacement/contentApi";
import { createJobFingerprint } from "../writeTools/contentReplacement/proposals";
import {
  assertValidDetailRefs,
  scanDetailBatch,
  scanInventorySlice,
} from "../writeTools/contentReplacement/scanner";
import type {
  DetailBatchResult,
  InventoryCursor,
  InventorySliceResult,
  ReplacementConfiguration,
  ReplacementItemRef,
} from "../writeTools/contentReplacement/types";
import {
  isInventoryCursorRelevant as isSharedInventoryCursorRelevant,
  validateConfiguration as validateSharedConfiguration,
  validateInventoryCursor as validateSharedInventoryCursor,
  validateSessionCredentials as validateSharedSessionCredentials,
} from "./contentReplacementRequestValidation";
import {
  prepareEnterpriseWriteContext,
  redactedJsonResponse,
  type JsonRedactionPathSegment,
  type JsonRedactionPolicy,
} from "./enterpriseWriteRequest";

const INVALID_REQUEST_MESSAGE = "Content replacement scan request is invalid.";
const FINGERPRINT_MISMATCH_MESSAGE =
  "Replacement job configuration changed. Start a new scan.";
const MAX_INVENTORY_PAGE = 10_000;
const MAX_DETAIL_REFS = 10;
const DEFAULT_RETRY_DELAY_SECONDS = 2;
const MAX_SCAN_RETRY_WAIT_SECONDS = 5;
const MAX_SCAN_CUMULATIVE_RETRY_WAIT_SECONDS = 10;

export type ContentReplacementScanPayload = {
  credentials: SessionCredentials;
  configuration: ReplacementConfiguration;
  jobFingerprint: string;
} & (
  | { action: "inventory"; cursor: InventoryCursor }
  | { action: "details"; refs: ReplacementItemRef[] }
);

export type ContentReplacementScanResponseBody =
  | {
      ok: true;
      result: InventorySliceResult | DetailBatchResult;
      throttleNotices: ThrottleNotice[];
    }
  | { ok: false; error: string }
  | {
      ok: false;
      error: {
        code: "rate_limited";
        message: "Content scan is temporarily rate limited.";
        retryAfterSeconds: number;
      };
    };

interface ContentReplacementScanApiDependencies {
  createClient?: (
    credentials: SessionCredentials,
    instance: NormalizedInstance,
    onThrottle: (notice: unknown) => void,
  ) => ContentReplacementClient;
}

export async function handleContentReplacementScanRequest(
  payload: unknown,
  dependencies: ContentReplacementScanApiDependencies = {},
): Promise<Response> {
  const validated = validateScanPayload(payload);
  if (!validated) {
    return plainJsonResponse({ ok: false, error: INVALID_REQUEST_MESSAGE }, 400);
  }

  if (!isOriginOnlyInstanceUrl(validated.credentials.baseUrl)) {
    return plainJsonResponse(
      { ok: false, error: "Enterprise content scan requires an origin-only instance URL." },
      400,
    );
  }

  const writeContext = prepareEnterpriseWriteContext(validated.credentials);
  if (!writeContext.ok) {
    return plainJsonResponse({ ok: false, error: writeContext.message }, writeContext.status);
  }

  const browserJsonResponse = (body: ContentReplacementScanResponseBody, status: number) =>
    redactedJsonResponse(body, status, writeContext.redact, SCAN_RESPONSE_REDACTION_POLICY);

  const expectedFingerprint = await createJobFingerprint({
    baseUrl: writeContext.instance.baseUrl,
    configuration: validated.configuration,
  });
  if (validated.jobFingerprint !== expectedFingerprint) {
    return browserJsonResponse({ ok: false, error: FINGERPRINT_MISMATCH_MESSAGE }, 409);
  }

  const throttleNotices: ThrottleNotice[] = [];
  const collectThrottleNotice = (notice: unknown): void => {
    const sanitized = sanitizeThrottleNotice(notice);
    if (sanitized) throttleNotices.push(sanitized);
  };

  try {
    const createClient = dependencies.createClient ?? createDefaultClient;
    const client = createClient(
      writeContext.credentials,
      writeContext.instance,
      collectThrottleNotice,
    );
    if (validated.action === "inventory") {
      const result = await scanInventorySlice(client, {
        cursor: validated.cursor,
        configuration: validated.configuration,
      });
      if (validated.cursor.page === MAX_INVENTORY_PAGE && result.nextCursor !== null) {
        return browserJsonResponse(
          {
            ok: false,
            error: "Content inventory exceeds the supported 10,000-page safety limit.",
          },
          502,
        );
      }
      return browserJsonResponse({ ok: true, result, throttleNotices }, 200);
    }

    const result = await scanDetailBatch(client, {
      refs: validated.refs,
      configuration: validated.configuration,
    });
    return browserJsonResponse({ ok: true, result, throttleNotices }, 200);
  } catch (error) {
    const status = safeErrorStatus(error);
    if (status === 429) {
      return browserJsonResponse(
        {
          ok: false,
          error: {
            code: "rate_limited",
            message: "Content scan is temporarily rate limited.",
            retryAfterSeconds: latestBackoffDelay(throttleNotices),
          },
        },
        429,
      );
    }

    const mapped = mapScanFailure(status);
    return browserJsonResponse({ ok: false, error: mapped.message }, mapped.status);
  }
}

function createDefaultClient(
  credentials: SessionCredentials,
  instance: NormalizedInstance,
  onThrottle: (notice: unknown) => void,
): ContentReplacementClient {
  return createContentReplacementClient(
    new StackApiV3Client({
      apiV3Url: instance.apiV3Url,
      token: credentials.accessToken ?? "",
      onThrottle,
      maxRetryWaitSeconds: MAX_SCAN_RETRY_WAIT_SECONDS,
      maxCumulativeRetryWaitSeconds: MAX_SCAN_CUMULATIVE_RETRY_WAIT_SECONDS,
      maxBackoffNoticeSeconds: MAX_STACK_API_V3_BACKOFF_NOTICE_SECONDS,
    }),
  );
}

function isOriginOnlyInstanceUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.pathname === "/" &&
      url.search === "" &&
      url.hash === "" &&
      url.username === "" &&
      url.password === ""
    );
  } catch {
    return false;
  }
}

function validateScanPayload(value: unknown): ContentReplacementScanPayload | null {
  if (!isRecord(value) || !isExactObject(value, commonPayloadKeys(value.action))) return null;
  const credentials = validateSharedSessionCredentials(value.credentials);
  const configuration = validateSharedConfiguration(value.configuration);
  if (!configuration || typeof value.jobFingerprint !== "string" || value.jobFingerprint.length === 0) {
    return null;
  }

  const cursor = value.action === "inventory" ? validateSharedInventoryCursor(value.cursor) : null;
  if (value.action === "inventory" && credentials && cursor && isSharedInventoryCursorRelevant(cursor, configuration)) {
    return {
      action: "inventory",
      credentials,
      configuration,
      jobFingerprint: value.jobFingerprint,
      cursor,
    };
  }

  if (
    value.action === "details" &&
    credentials &&
    isDetailRefs(value.refs) &&
    value.refs.every((ref) => isDetailRefRelevant(ref, configuration))
  ) {
    assertValidDetailRefs(value.refs);
    return {
      action: "details",
      credentials,
      configuration,
      jobFingerprint: value.jobFingerprint,
      refs: value.refs,
    };
  }

  return null;
}

function commonPayloadKeys(action: unknown): readonly string[] {
  if (action === "inventory") {
    return ["action", "credentials", "configuration", "jobFingerprint", "cursor"];
  }
  if (action === "details") {
    return ["action", "credentials", "configuration", "jobFingerprint", "refs"];
  }
  return [];
}

function isDetailRefRelevant(
  ref: ReplacementItemRef,
  configuration: ReplacementConfiguration,
): boolean {
  if (ref.kind === "question") return configuration.contentTypes.questions;
  if (ref.kind === "answer") return configuration.contentTypes.answers;
  return configuration.contentTypes.articles;
}

function isDetailRefs(value: unknown): value is ReplacementItemRef[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_DETAIL_REFS) return false;

  const identities = new Set<string>();
  for (const ref of value) {
    const identity = canonicalRefIdentity(ref);
    if (identity === null || identities.has(identity)) return false;
    identities.add(identity);
  }
  return true;
}

function canonicalRefIdentity(value: unknown): string | null {
  if (!isRecord(value)) return null;
  if (
    value.kind === "question" &&
    isExactObject(value, ["kind", "questionId"]) &&
    isPositiveSafeInteger(value.questionId)
  ) {
    return `question:${value.questionId}`;
  }
  if (
    value.kind === "answer" &&
    isExactObject(value, ["kind", "questionId", "answerId"]) &&
    isPositiveSafeInteger(value.questionId) &&
    isPositiveSafeInteger(value.answerId)
  ) {
    return `answer:${value.questionId}:${value.answerId}`;
  }
  if (
    value.kind === "article" &&
    isExactObject(value, ["kind", "articleId"]) &&
    isPositiveSafeInteger(value.articleId)
  ) {
    return `article:${value.articleId}`;
  }
  return null;
}

function sanitizeThrottleNotice(value: unknown): ThrottleNotice | null {
  try {
    if (
      !isRecord(value) ||
      !hasOnlyKeys(value, ["kind", "seconds", "remaining"]) ||
      (value.kind !== "backoff" && value.kind !== "burst" && value.kind !== "token-bucket") ||
      !isBoundedNonNegativeInteger(value.seconds, MAX_STACK_API_V3_BACKOFF_NOTICE_SECONDS) ||
      (value.remaining !== undefined && !isBoundedNonNegativeInteger(value.remaining, Number.MAX_SAFE_INTEGER))
    ) {
      return null;
    }

    return value.remaining === undefined
      ? { kind: value.kind, seconds: value.seconds }
      : { kind: value.kind, seconds: value.seconds, remaining: value.remaining };
  } catch {
    return null;
  }
}

function latestBackoffDelay(notices: readonly ThrottleNotice[]): number {
  for (let index = notices.length - 1; index >= 0; index -= 1) {
    if (notices[index].kind === "backoff") return notices[index].seconds;
  }
  return DEFAULT_RETRY_DELAY_SECONDS;
}

function safeErrorStatus(error: unknown): number | undefined {
  try {
    if (!error || (typeof error !== "object" && typeof error !== "function")) return undefined;
    const descriptor = Object.getOwnPropertyDescriptor(error, "status");
    return descriptor && "value" in descriptor && isBoundedNonNegativeInteger(descriptor.value, 599)
      ? descriptor.value
      : undefined;
  } catch {
    return undefined;
  }
}

function mapScanFailure(status: number | undefined): { status: number; message: string } {
  if (status === 400 || status === 404 || status === 422) {
    return { status: 400, message: "Content scan request was rejected by Stack Enterprise." };
  }
  if (status === 401) {
    return { status: 401, message: "Stack Enterprise credentials were rejected." };
  }
  if (status === 403) {
    return { status: 403, message: "Stack Enterprise access was denied." };
  }
  if (status === 409) {
    return { status: 409, message: "Stack Enterprise content changed during scanning." };
  }
  if (status === 502 || status === 503 || status === 504) {
    return { status: 502, message: "Stack Enterprise is temporarily unavailable." };
  }
  return { status: 502, message: "Unable to complete the content scan." };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isExactObject(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && hasOnlyKeys(value, keys);
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const allowed = new Set(keys);
  return Object.keys(value).every((key) => allowed.has(key));
}

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function isBoundedNonNegativeInteger(value: unknown, maximum: number): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= maximum;
}

function plainJsonResponse(body: ContentReplacementScanResponseBody, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const SCAN_RESPONSE_REDACTION_POLICY: JsonRedactionPolicy = {
  preserveKey: isTrustedScanResponseKey,
  preserveStringValue: isTrustedScanResponseString,
};

const ROOT_KEYS = new Set(["ok", "result", "throttleNotices", "error"]);
const ERROR_KEYS = new Set(["code", "message", "retryAfterSeconds"]);
const RESULT_KEYS = new Set([
  "candidates", "answerCursors", "nextCursor", "inspectedCount", "pageKind",
  "progress", "proposals", "protectedOccurrenceCount",
]);
const THROTTLE_KEYS = new Set(["kind", "seconds", "remaining"]);
const REF_KEYS = new Set(["kind", "questionId", "answerId", "articleId"]);
const CURSOR_KEYS = new Set(["kind", "questionId", "ruleId", "page"]);
const PROGRESS_KEYS = new Set([
  "apiRequestsCompleted", "searchPages", "searchTermsCompleted",
  "answerBearingQuestionsQueued", "zeroAnswerQuestionsSkipped",
]);
const PROPOSAL_KEYS = new Set([
  "before", "after", "scannedRequestChecksum", "proposedRequestChecksum", "proposalFingerprint",
  "fields", "changedOccurrences", "protectedOccurrences", "appliedRuleIds", "metadata",
]);
const MODEL_KEYS = new Set(["kind", "ref", "request", "metadata"]);
const REQUEST_KEYS = new Set([
  "title", "body", "tags", "type", "expirationDate", "permissions",
]);
const PERMISSIONS_KEYS = new Set(["editableBy", "editorUserIds", "editorUserGroupIds"]);
const METADATA_KEYS = new Set([
  "titleContext", "webUrl", "owner", "lastEditor", "lastActivityDate",
]);
const METADATA_USER_KEYS = new Set(["id", "name"]);
const FIELDS_KEYS = new Set(["title", "body"]);
const FIELD_MARKDOWN_KEYS = new Set(["beforeMarkdown", "afterMarkdown"]);
const OCCURRENCE_KEYS = new Set(["field", "ruleId", "start", "end", "before", "after", "reason"]);
const ITEM_KINDS = new Set(["question", "answer", "article"]);
const CURSOR_KINDS = new Set(["questions", "answers", "articles", "search"]);
const THROTTLE_KINDS = new Set(["backoff", "burst", "token-bucket"]);
const ARTICLE_TYPES = new Set(["knowledgeArticle", "announcement", "policy", "howToGuide"]);
const EDITOR_SCOPES = new Set(["ownerOnly", "specificEditors", "everyone"]);
const OCCURRENCE_FIELDS = new Set(["title", "body"]);
const PROTECTED_REASONS = new Set([
  "code", "destination", "raw-html-attribute", "raw-html-syntax", "raw-html-hidden",
]);

function isTrustedScanResponseKey(
  path: readonly JsonRedactionPathSegment[],
  key: string,
): boolean {
  if (path.length === 0) return ROOT_KEYS.has(key);
  if (matchesPath(path, "error")) return ERROR_KEYS.has(key);
  if (matchesPath(path, "result")) return RESULT_KEYS.has(key);
  if (matchesPath(path, "result", "progress")) return PROGRESS_KEYS.has(key);
  if (isCollectionItemPath(path, "throttleNotices")) return THROTTLE_KEYS.has(key);
  if (isCollectionItemPath(path, "result", "candidates")) return REF_KEYS.has(key);
  if (isCollectionItemPath(path, "result", "answerCursors")) return CURSOR_KEYS.has(key);
  if (matchesPath(path, "result", "nextCursor")) return CURSOR_KEYS.has(key);
  if (isProposalPath(path)) return PROPOSAL_KEYS.has(key);
  if (isProposalChildPath(path, "before") || isProposalChildPath(path, "after")) {
    return MODEL_KEYS.has(key);
  }
  if (isProposalGrandchildPath(path, "before", "ref") || isProposalGrandchildPath(path, "after", "ref")) {
    return REF_KEYS.has(key);
  }
  if (isProposalGrandchildPath(path, "before", "request") || isProposalGrandchildPath(path, "after", "request")) {
    return REQUEST_KEYS.has(key);
  }
  if (isProposalGreatGrandchildPath(path, "before", "request", "permissions") || isProposalGreatGrandchildPath(path, "after", "request", "permissions")) {
    return PERMISSIONS_KEYS.has(key);
  }
  if (isProposalGrandchildPath(path, "before", "metadata") || isProposalGrandchildPath(path, "after", "metadata") || isProposalChildPath(path, "metadata")) {
    return METADATA_KEYS.has(key);
  }
  if (isProposalMetadataUserPath(path)) return METADATA_USER_KEYS.has(key);
  if (isProposalChildPath(path, "fields")) return FIELDS_KEYS.has(key);
  if (isProposalGrandchildPath(path, "fields", "title") || isProposalGrandchildPath(path, "fields", "body")) {
    return FIELD_MARKDOWN_KEYS.has(key);
  }
  if (
    isProposalCollectionItemPath(path, "changedOccurrences") ||
    isProposalCollectionItemPath(path, "protectedOccurrences")
  ) {
    return OCCURRENCE_KEYS.has(key);
  }
  return false;
}

function isTrustedScanResponseString(
  path: readonly JsonRedactionPathSegment[],
  value: string,
): boolean {
  const last = path[path.length - 1];
  const parent = path.slice(0, -1);
  if (last === "code" && matchesPath(parent, "error")) return value === "rate_limited";
  if (last === "pageKind" && matchesPath(parent, "result")) return CURSOR_KINDS.has(value);
  if (last === "kind" && isCollectionItemPath(parent, "throttleNotices")) return THROTTLE_KINDS.has(value);
  if (
    last === "kind" &&
    (isCollectionItemPath(parent, "result", "candidates") ||
      isProposalGrandchildPath(parent, "before", "ref") ||
      isProposalGrandchildPath(parent, "after", "ref") ||
      isProposalChildPath(parent, "before") ||
      isProposalChildPath(parent, "after"))
  ) {
    return ITEM_KINDS.has(value);
  }
  if (
    last === "kind" &&
    (isCollectionItemPath(parent, "result", "answerCursors") || matchesPath(parent, "result", "nextCursor"))
  ) {
    return CURSOR_KINDS.has(value);
  }
  if (
    last === "type" &&
    (isProposalGrandchildPath(parent, "before", "request") || isProposalGrandchildPath(parent, "after", "request"))
  ) {
    return ARTICLE_TYPES.has(value);
  }
  if (
    last === "editableBy" &&
    (isProposalGreatGrandchildPath(parent, "before", "request", "permissions") ||
      isProposalGreatGrandchildPath(parent, "after", "request", "permissions"))
  ) {
    return EDITOR_SCOPES.has(value);
  }
  if (last === "field" && isProposalOccurrencePath(parent)) return OCCURRENCE_FIELDS.has(value);
  if (last === "reason" && isProposalCollectionItemPath(parent, "protectedOccurrences")) {
    return PROTECTED_REASONS.has(value);
  }
  return false;
}

function matchesPath(
  path: readonly JsonRedactionPathSegment[],
  ...expected: readonly JsonRedactionPathSegment[]
): boolean {
  return path.length === expected.length && path.every((segment, index) => segment === expected[index]);
}

function isCollectionItemPath(
  path: readonly JsonRedactionPathSegment[],
  ...collectionPath: readonly string[]
): boolean {
  return (
    path.length === collectionPath.length + 1 &&
    collectionPath.every((segment, index) => path[index] === segment) &&
    typeof path[path.length - 1] === "number"
  );
}

function isProposalPath(path: readonly JsonRedactionPathSegment[]): boolean {
  return isCollectionItemPath(path, "result", "proposals");
}

function isProposalChildPath(
  path: readonly JsonRedactionPathSegment[],
  child: string,
): boolean {
  return path.length === 4 && isProposalPath(path.slice(0, 3)) && path[3] === child;
}

function isProposalGrandchildPath(
  path: readonly JsonRedactionPathSegment[],
  child: string,
  grandchild: string,
): boolean {
  return path.length === 5 && isProposalPath(path.slice(0, 3)) && path[3] === child && path[4] === grandchild;
}

function isProposalGreatGrandchildPath(
  path: readonly JsonRedactionPathSegment[],
  child: string,
  grandchild: string,
  greatGrandchild: string,
): boolean {
  return (
    path.length === 6 &&
    isProposalPath(path.slice(0, 3)) &&
    path[3] === child &&
    path[4] === grandchild &&
    path[5] === greatGrandchild
  );
}

function isProposalCollectionItemPath(
  path: readonly JsonRedactionPathSegment[],
  collection: string,
): boolean {
  return (
    path.length === 5 &&
    isProposalPath(path.slice(0, 3)) &&
    path[3] === collection &&
    typeof path[4] === "number"
  );
}

function isProposalOccurrencePath(path: readonly JsonRedactionPathSegment[]): boolean {
  return (
    isProposalCollectionItemPath(path, "changedOccurrences") ||
    isProposalCollectionItemPath(path, "protectedOccurrences")
  );
}

function isProposalMetadataUserPath(path: readonly JsonRedactionPathSegment[]): boolean {
  if (path[path.length - 1] !== "owner" && path[path.length - 1] !== "lastEditor") return false;
  const parent = path.slice(0, -1);
  return (
    isProposalGrandchildPath(parent, "before", "metadata") ||
    isProposalGrandchildPath(parent, "after", "metadata") ||
    isProposalChildPath(parent, "metadata")
  );
}
