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
import {
  buildReplacementProposal,
  checksumRequestModel,
  createJobFingerprint,
} from "../writeTools/contentReplacement/proposals";
import type {
  ReplacementConfiguration,
  ReplacementItemRef,
} from "../writeTools/contentReplacement/types";
import {
  isExactObject,
  isOriginOnlyInstanceUrl,
  isSelectedKind,
  isSha256Digest,
  normalizeCurrentRequestModel,
  validateConfiguration,
  validateItemRef,
  validateSessionCredentials,
} from "./contentReplacementRequestValidation";
import {
  prepareEnterpriseWriteContext,
  redactedJsonResponse,
  type JsonRedactionPathSegment,
  type JsonRedactionPolicy,
} from "./enterpriseWriteRequest";

const INVALID_REQUEST_MESSAGE = "Content replacement apply request is invalid.";
const FINGERPRINT_MISMATCH_MESSAGE = "Replacement job configuration changed. Start a new scan.";
const MAX_RETRY_WAIT_SECONDS = 5;
const MAX_CUMULATIVE_RETRY_WAIT_SECONDS = 10;

export interface ContentReplacementApplyPayload {
  credentials: SessionCredentials;
  configuration: ReplacementConfiguration;
  jobFingerprint: string;
  itemRef: ReplacementItemRef;
  expectedScannedRequestChecksum: string;
  expectedProposedRequestChecksum: string;
  expectedProposalFingerprint: string;
}

type ApplyItemResult =
  | { status: "updated" | "already-applied" | "stale"; observedRequestChecksum: string }
  | { status: "permission" | "validation" | "network" | "failed"; error: string };

export type ContentReplacementApplyResponseBody =
  | { ok: true; result: ApplyItemResult; throttleNotices: ThrottleNotice[] }
  | { ok: false; error: string };

interface ContentReplacementApplyDependencies {
  createClient?: (
    credentials: SessionCredentials,
    instance: NormalizedInstance,
    onThrottle: (notice: unknown) => void,
  ) => ContentReplacementClient;
}

export async function handleContentReplacementApplyRequest(
  payload: unknown,
  dependencies: ContentReplacementApplyDependencies = {},
): Promise<Response> {
  const validated = validateApplyPayload(payload);
  if (!validated) return plainJsonResponse({ ok: false, error: INVALID_REQUEST_MESSAGE }, 400);

  const writeContext = prepareEnterpriseWriteContext(validated.credentials);
  if (!writeContext.ok) {
    return plainJsonResponse({ ok: false, error: writeContext.message }, writeContext.status);
  }
  const browserJsonResponse = (body: ContentReplacementApplyResponseBody, status: number) =>
    redactedJsonResponse(body, status, writeContext.redact, APPLY_RESPONSE_REDACTION_POLICY);

  if (!isOriginOnlyInstanceUrl(validated.credentials.baseUrl)) {
    return browserJsonResponse(
      { ok: false, error: "Enterprise content apply requires an origin-only instance URL." },
      400,
    );
  }
  const expectedFingerprint = await createJobFingerprint({
    baseUrl: writeContext.instance.baseUrl,
    configuration: validated.configuration,
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

  let current;
  try {
    current = normalizeCurrentRequestModel(
      await client.getItem(validated.itemRef),
      validated.itemRef,
    );
    if (!current) throw new Error("Invalid canonical request model.");
  } catch (error) {
    return itemFailureResponse(error, "Unable to read the current content item.", throttleNotices, browserJsonResponse);
  }
  const currentChecksum = await checksumRequestModel(current);
  if (currentChecksum === validated.expectedProposedRequestChecksum) {
    return browserJsonResponse({
      ok: true,
      result: { status: "already-applied", observedRequestChecksum: currentChecksum },
      throttleNotices,
    }, 200);
  }
  if (currentChecksum !== validated.expectedScannedRequestChecksum) {
    return browserJsonResponse({
      ok: true,
      result: { status: "stale", observedRequestChecksum: currentChecksum },
      throttleNotices,
    }, 200);
  }

  const proposal = await buildReplacementProposal(current, validated.configuration);
  if (
    !proposal ||
    proposal.proposedRequestChecksum !== validated.expectedProposedRequestChecksum ||
    proposal.proposalFingerprint !== validated.expectedProposalFingerprint
  ) {
    return browserJsonResponse({
      ok: true,
      result: { status: "stale", observedRequestChecksum: currentChecksum },
      throttleNotices,
    }, 200);
  }

  const exactAfter = normalizeCurrentRequestModel(proposal.after, validated.itemRef);
  if (!exactAfter) {
    return browserJsonResponse({
      ok: true,
      result: { status: "failed", error: "Unable to construct the reviewed content update." },
      throttleNotices,
    }, 200);
  }
  try {
    await client.updateItem(exactAfter);
  } catch (error) {
    return itemFailureResponse(error, "Unable to update the content item.", throttleNotices, browserJsonResponse);
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
        status: "updated",
        observedRequestChecksum: await checksumRequestModel(observed),
      },
      throttleNotices,
    }, 200);
  } catch (error) {
    return itemFailureResponse(error, "Unable to verify the updated content item.", throttleNotices, browserJsonResponse);
  }
}

function validateApplyPayload(value: unknown): ContentReplacementApplyPayload | null {
  try {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const record = value as Record<string, unknown>;
    if (!isExactObject(record, [
      "credentials", "configuration", "jobFingerprint", "itemRef",
      "expectedScannedRequestChecksum", "expectedProposedRequestChecksum",
      "expectedProposalFingerprint",
    ])) return null;
    const credentials = validateSessionCredentials(record.credentials);
    const configuration = validateConfiguration(record.configuration);
    const itemRef = validateItemRef(record.itemRef);
    if (
      !credentials || !configuration || !itemRef || !isSelectedKind(itemRef, configuration) ||
      !isSha256Digest(record.jobFingerprint) ||
      !isSha256Digest(record.expectedScannedRequestChecksum) ||
      !isSha256Digest(record.expectedProposedRequestChecksum) ||
      !isSha256Digest(record.expectedProposalFingerprint)
    ) return null;
    return {
      credentials,
      configuration,
      jobFingerprint: record.jobFingerprint,
      itemRef,
      expectedScannedRequestChecksum: record.expectedScannedRequestChecksum,
      expectedProposedRequestChecksum: record.expectedProposedRequestChecksum,
      expectedProposalFingerprint: record.expectedProposalFingerprint,
    };
  } catch {
    return null;
  }
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
  respond: (body: ContentReplacementApplyResponseBody, status: number) => Response,
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
  return error instanceof TypeError ? "network" : "failed";
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

function plainJsonResponse(body: ContentReplacementApplyResponseBody, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const ROOT_KEYS = new Set(["ok", "result", "throttleNotices", "error"]);
const RESULT_KEYS = new Set(["status", "observedRequestChecksum", "error"]);
const THROTTLE_KEYS = new Set(["kind", "seconds", "remaining"]);
const RESULT_STATUSES = new Set([
  "updated", "already-applied", "stale", "permission", "validation", "network", "failed",
]);
const THROTTLE_KINDS = new Set(["backoff", "burst", "token-bucket"]);

const APPLY_RESPONSE_REDACTION_POLICY: JsonRedactionPolicy = {
  preserveKey(path, key) {
    if (path.length === 0) return ROOT_KEYS.has(key);
    if (matchesPath(path, "result")) return RESULT_KEYS.has(key);
    if (path.length === 2 && path[0] === "throttleNotices" && typeof path[1] === "number") {
      return THROTTLE_KEYS.has(key);
    }
    return false;
  },
  preserveStringValue(path: readonly JsonRedactionPathSegment[], value: string) {
    return (matchesPath(path, "result", "status") && RESULT_STATUSES.has(value)) ||
      (path.length === 3 && path[0] === "throttleNotices" && typeof path[1] === "number" &&
        path[2] === "kind" && THROTTLE_KINDS.has(value));
  },
};

function matchesPath(path: readonly JsonRedactionPathSegment[], ...segments: string[]): boolean {
  return path.length === segments.length && segments.every((segment, index) => path[index] === segment);
}
