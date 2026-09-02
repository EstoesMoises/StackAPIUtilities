import {
  MAX_STACK_API_V3_BACKOFF_NOTICE_SECONDS,
  StackApiV3Client,
} from "../api/stackApiV3";
import type { ThrottleNotice } from "../api/httpClient";
import type { NormalizedInstance } from "../credentials/credentialRules";
import type { SessionCredentials } from "../domain/types";
import {
  ContentReplacementApiError,
  createContentReplacementClient,
  type ContentReplacementClient,
} from "../writeTools/contentReplacement/contentApi";
import { checksumRequestModel, createJobFingerprint } from "../writeTools/contentReplacement/proposals";
import type {
  ContentReplacementScanCompatibility,
  ReplacementConfiguration,
  ReplacementItemRef,
  ReplacementWireRequestModel,
} from "../writeTools/contentReplacement/types";
import {
  isExactObject,
  isOriginOnlyInstanceUrl,
  isSelectedKind,
  isSha256Digest,
  normalizeCurrentRequestModel,
  validateConfiguration,
  validateExactPriorRequestModel,
  validateItemRef,
  validateSessionCredentials,
} from "./contentReplacementRequestValidation";
import {
  prepareEnterpriseWriteContext,
  redactedJsonResponse,
  type JsonRedactionPathSegment,
  type JsonRedactionPolicy,
} from "./enterpriseWriteRequest";

const INVALID_REQUEST_MESSAGE = "Content replacement recovery request is invalid.";
const FINGERPRINT_MISMATCH_MESSAGE = "Replacement job configuration changed. Start a new scan.";
const MAX_RETRY_WAIT_SECONDS = 5;
const MAX_CUMULATIVE_RETRY_WAIT_SECONDS = 10;

export interface ContentReplacementRecoveryPayload {
  action: "preview" | "apply";
  credentials: SessionCredentials;
  configuration: ReplacementConfiguration;
  scanCompatibility: ContentReplacementScanCompatibility;
  jobFingerprint: string;
  itemRef: ReplacementItemRef;
  priorRequestModel: ReplacementWireRequestModel;
  expectedPriorRequestChecksum: string;
  expectedPostApplyChecksum: string;
}

type RecoveryPreviewResult = {
  status: "recoverable" | "already-recovered" | "conflict";
  currentRequestModel: ReplacementWireRequestModel;
  priorRequestModel: ReplacementWireRequestModel;
  observedRequestChecksum: string;
};

type RecoveryApplyResult =
  | { status: "recovered" | "already-recovered" | "conflict"; observedRequestChecksum: string }
  | { status: "permission" | "validation" | "network" | "failed"; error: string };

export type ContentReplacementRecoveryResponseBody =
  | { ok: true; result: RecoveryPreviewResult | RecoveryApplyResult; throttleNotices: ThrottleNotice[] }
  | { ok: false; error: string };

interface ContentReplacementRecoveryDependencies {
  createClient?: (
    credentials: SessionCredentials,
    instance: NormalizedInstance,
    onThrottle: (notice: unknown) => void,
  ) => ContentReplacementClient;
}

export async function handleContentReplacementRecoveryRequest(
  payload: unknown,
  dependencies: ContentReplacementRecoveryDependencies = {},
): Promise<Response> {
  const validated = validateRecoveryPayload(payload);
  if (!validated) return plainJsonResponse({ ok: false, error: INVALID_REQUEST_MESSAGE }, 400);

  if (await checksumRequestModel(validated.priorRequestModel) !== validated.expectedPriorRequestChecksum) {
    return plainJsonResponse({ ok: false, error: INVALID_REQUEST_MESSAGE }, 400);
  }

  const writeContext = prepareEnterpriseWriteContext(validated.credentials);
  if (!writeContext.ok) {
    return plainJsonResponse({ ok: false, error: writeContext.message }, writeContext.status);
  }
  const browserJsonResponse = (body: ContentReplacementRecoveryResponseBody, status: number) =>
    redactedJsonResponse(body, status, writeContext.redact, RECOVERY_RESPONSE_REDACTION_POLICY);
  if (!isOriginOnlyInstanceUrl(validated.credentials.baseUrl)) {
    return browserJsonResponse(
      { ok: false, error: "Enterprise content recovery requires an origin-only instance URL." },
      400,
    );
  }
  const expectedFingerprint = await createJobFingerprint({
    baseUrl: writeContext.instance.baseUrl,
    configuration: validated.configuration,
    scanCompatibility: validated.scanCompatibility,
  });
  if (validated.jobFingerprint !== expectedFingerprint) {
    return browserJsonResponse({ ok: false, error: FINGERPRINT_MISMATCH_MESSAGE }, 409);
  }

  const throttleNotices: ThrottleNotice[] = [];
  const collectThrottleNotice = (notice: unknown) => {
    const sanitized = sanitizeThrottleNotice(notice);
    if (sanitized) throttleNotices.push(sanitized);
  };
  let client: ContentReplacementClient;
  try {
    client = (dependencies.createClient ?? createDefaultClient)(
      writeContext.credentials,
      writeContext.instance,
      collectThrottleNotice,
    );
  } catch (error) {
    return itemFailureResponse(error, "Unable to create the content client.", throttleNotices, browserJsonResponse);
  }

  let current: ReplacementWireRequestModel;
  try {
    const normalized = normalizeCurrentRequestModel(
      await client.getItem(validated.itemRef),
      validated.itemRef,
    );
    if (!normalized) throw new Error("Invalid canonical request model.");
    current = normalized;
  } catch (error) {
    return itemFailureResponse(error, "Unable to read the current content item.", throttleNotices, browserJsonResponse);
  }

  const currentChecksum = await checksumRequestModel(current);
  const state = currentChecksum === validated.expectedPriorRequestChecksum
    ? "already-recovered"
    : currentChecksum === validated.expectedPostApplyChecksum
      ? "recoverable"
      : "conflict";

  if (validated.action === "preview") {
    return browserJsonResponse({
      ok: true,
      result: {
        status: state,
        currentRequestModel: current,
        priorRequestModel: validated.priorRequestModel,
        observedRequestChecksum: currentChecksum,
      },
      throttleNotices,
    }, 200);
  }

  if (state !== "recoverable") {
    return browserJsonResponse({
      ok: true,
      result: { status: state, observedRequestChecksum: currentChecksum },
      throttleNotices,
    }, 200);
  }

  try {
    await client.updateItem(validated.priorRequestModel);
  } catch (error) {
    return itemFailureResponse(error, "Unable to recover the content item.", throttleNotices, browserJsonResponse);
  }

  try {
    const observed = normalizeCurrentRequestModel(
      await client.getItem(validated.itemRef),
      validated.itemRef,
    );
    if (!observed) throw new Error("Invalid canonical request model.");
    return browserJsonResponse({
      ok: true,
      result: {
        status: "recovered",
        observedRequestChecksum: await checksumRequestModel(observed),
      },
      throttleNotices,
    }, 200);
  } catch (error) {
    return itemFailureResponse(error, "Unable to verify the recovered content item.", throttleNotices, browserJsonResponse);
  }
}

function validateRecoveryPayload(value: unknown): ContentReplacementRecoveryPayload | null {
  try {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const record = value as Record<string, unknown>;
    if (!isExactObject(record, [
      "action", "credentials", "configuration", "scanCompatibility", "jobFingerprint", "itemRef", "priorRequestModel",
      "expectedPriorRequestChecksum", "expectedPostApplyChecksum",
    ])) return null;
    if (record.action !== "preview" && record.action !== "apply") return null;
    const credentials = validateSessionCredentials(record.credentials);
    const configuration = validateConfiguration(record.configuration);
    const itemRef = validateItemRef(record.itemRef);
    if (
      !credentials || !configuration || !isScanCompatibility(record.scanCompatibility) ||
      !itemRef || !isSelectedKind(itemRef, configuration) ||
      !isSha256Digest(record.jobFingerprint) ||
      !isSha256Digest(record.expectedPriorRequestChecksum) ||
      !isSha256Digest(record.expectedPostApplyChecksum)
    ) return null;
    const priorRequestModel = validateExactPriorRequestModel(record.priorRequestModel, itemRef);
    if (!priorRequestModel) return null;
    return {
      action: record.action,
      credentials,
      configuration,
      scanCompatibility: record.scanCompatibility,
      jobFingerprint: record.jobFingerprint,
      itemRef,
      priorRequestModel,
      expectedPriorRequestChecksum: record.expectedPriorRequestChecksum,
      expectedPostApplyChecksum: record.expectedPostApplyChecksum,
    };
  } catch {
    return null;
  }
}

function isScanCompatibility(value: unknown): value is ContentReplacementScanCompatibility {
  return value === "current" || value === "legacy-restart-required";
}

function createDefaultClient(
  credentials: SessionCredentials,
  instance: NormalizedInstance,
  onThrottle: (notice: unknown) => void,
): ContentReplacementClient {
  return createContentReplacementClient(new StackApiV3Client({
    apiV3Url: instance.apiV3Url,
    token: credentials.accessToken ?? "",
    onThrottle,
    maxRetryWaitSeconds: MAX_RETRY_WAIT_SECONDS,
    maxCumulativeRetryWaitSeconds: MAX_CUMULATIVE_RETRY_WAIT_SECONDS,
    maxBackoffNoticeSeconds: MAX_STACK_API_V3_BACKOFF_NOTICE_SECONDS,
    retryPutRequests: false,
  }));
}

function itemFailureResponse(
  error: unknown,
  message: string,
  throttleNotices: ThrottleNotice[],
  respond: (body: ContentReplacementRecoveryResponseBody, status: number) => Response,
): Response {
  return respond({
    ok: true,
    result: { status: categorizeItemFailure(error), error: message },
    throttleNotices,
  }, 200);
}

function categorizeItemFailure(error: unknown): "permission" | "validation" | "network" | "failed" {
  if (error instanceof ContentReplacementApiError) {
    if (error.category === "transport") return "network";
    if (error.category === "schema") return "failed";
    const status = safeErrorStatus(error);
    if (status === 401 || status === 403) return "permission";
    if (status === 400 || status === 422) return "validation";
    if (status === 429 || status === 502 || status === 503 || status === 504) return "network";
    return "failed";
  }
  return "failed";
}

function safeErrorStatus(error: unknown): number | undefined {
  try {
    if (!error || (typeof error !== "object" && typeof error !== "function")) return undefined;
    const descriptor = Object.getOwnPropertyDescriptor(error, "status");
    return descriptor && "value" in descriptor && typeof descriptor.value === "number" &&
      Number.isSafeInteger(descriptor.value) && descriptor.value >= 0 && descriptor.value <= 599
      ? descriptor.value : undefined;
  } catch {
    return undefined;
  }
}

function sanitizeThrottleNotice(value: unknown): ThrottleNotice | null {
  try {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const notice = value as Record<string, unknown>;
    if (!isExactObject(notice, notice.remaining === undefined
      ? ["kind", "seconds"] : ["kind", "seconds", "remaining"])) return null;
    if (
      (notice.kind !== "backoff" && notice.kind !== "burst" && notice.kind !== "token-bucket") ||
      !isBoundedNonNegativeInteger(notice.seconds, MAX_STACK_API_V3_BACKOFF_NOTICE_SECONDS) ||
      !(notice.remaining === undefined || isBoundedNonNegativeInteger(notice.remaining, Number.MAX_SAFE_INTEGER))
    ) return null;
    return notice.remaining === undefined
      ? { kind: notice.kind, seconds: notice.seconds }
      : { kind: notice.kind, seconds: notice.seconds, remaining: notice.remaining };
  } catch {
    return null;
  }
}

function isBoundedNonNegativeInteger(value: unknown, maximum: number): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= maximum;
}

function plainJsonResponse(body: ContentReplacementRecoveryResponseBody, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const ROOT_KEYS = new Set(["ok", "result", "throttleNotices", "error"]);
const RESULT_KEYS = new Set([
  "status", "currentRequestModel", "priorRequestModel", "observedRequestChecksum", "error",
]);
const MODEL_KEYS = new Set(["kind", "ref", "request"]);
const REF_KEYS = new Set(["kind", "questionId", "answerId", "articleId"]);
const REQUEST_KEYS = new Set(["title", "body", "tags", "type", "expirationDate", "permissions"]);
const PERMISSION_KEYS = new Set(["editableBy", "editorUserIds", "editorUserGroupIds"]);
const THROTTLE_KEYS = new Set(["kind", "seconds", "remaining"]);
const RESULT_STATUSES = new Set([
  "recoverable", "recovered", "already-recovered", "conflict",
  "permission", "validation", "network", "failed",
]);
const MODEL_KINDS = new Set(["question", "answer", "article"]);
const ARTICLE_TYPES = new Set(["knowledgeArticle", "announcement", "policy", "howToGuide"]);
const EDITOR_SCOPES = new Set(["ownerOnly", "specificEditors", "everyone"]);
const THROTTLE_KINDS = new Set(["backoff", "burst", "token-bucket"]);

const RECOVERY_RESPONSE_REDACTION_POLICY: JsonRedactionPolicy = {
  preserveKey(path, key) {
    if (path.length === 0) return ROOT_KEYS.has(key);
    if (matchesPath(path, "result")) return RESULT_KEYS.has(key);
    if (isResultModelPath(path)) return MODEL_KEYS.has(key);
    if (isResultModelChildPath(path, "ref")) return REF_KEYS.has(key);
    if (isResultModelChildPath(path, "request")) return REQUEST_KEYS.has(key);
    if (isResultModelGrandchildPath(path, "request", "permissions")) return PERMISSION_KEYS.has(key);
    if (path.length === 2 && path[0] === "throttleNotices" && typeof path[1] === "number") {
      return THROTTLE_KEYS.has(key);
    }
    return false;
  },
  preserveStringValue(path: readonly JsonRedactionPathSegment[], value: string) {
    if (matchesPath(path, "result", "status")) return RESULT_STATUSES.has(value);
    if (isResultModelChildValuePath(path, "kind")) return MODEL_KINDS.has(value);
    if (isResultModelGrandchildValuePath(path, "request", "type")) return ARTICLE_TYPES.has(value);
    if (isResultModelGreatGrandchildValuePath(path, "request", "permissions", "editableBy")) {
      return EDITOR_SCOPES.has(value);
    }
    return path.length === 3 && path[0] === "throttleNotices" && typeof path[1] === "number" &&
      path[2] === "kind" && THROTTLE_KINDS.has(value);
  },
};

function matchesPath(path: readonly JsonRedactionPathSegment[], ...segments: string[]): boolean {
  return path.length === segments.length && segments.every((segment, index) => path[index] === segment);
}

function isResultModelPath(path: readonly JsonRedactionPathSegment[]): boolean {
  return path.length === 2 && path[0] === "result" &&
    (path[1] === "currentRequestModel" || path[1] === "priorRequestModel");
}

function isResultModelChildPath(path: readonly JsonRedactionPathSegment[], child: string): boolean {
  return path.length === 3 && isResultModelPath(path.slice(0, 2)) && path[2] === child;
}

function isResultModelGrandchildPath(
  path: readonly JsonRedactionPathSegment[],
  child: string,
  grandchild: string,
): boolean {
  return path.length === 4 && isResultModelPath(path.slice(0, 2)) &&
    path[2] === child && path[3] === grandchild;
}

function isResultModelChildValuePath(path: readonly JsonRedactionPathSegment[], child: string): boolean {
  return isResultModelChildPath(path, child);
}

function isResultModelGrandchildValuePath(
  path: readonly JsonRedactionPathSegment[],
  child: string,
  grandchild: string,
): boolean {
  return isResultModelGrandchildPath(path, child, grandchild);
}

function isResultModelGreatGrandchildValuePath(
  path: readonly JsonRedactionPathSegment[],
  child: string,
  grandchild: string,
  greatGrandchild: string,
): boolean {
  return path.length === 5 && isResultModelPath(path.slice(0, 2)) &&
    path[2] === child && path[3] === grandchild && path[4] === greatGrandchild;
}
