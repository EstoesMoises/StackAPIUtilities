import {
  normalizeInstanceUrl,
  validateEnterpriseV3OAuthCredentials,
  type NormalizedInstance,
} from "../credentials/credentialRules";
import type { SessionCredentials } from "../domain/types";

export const MAX_WRITE_ROUTE_BYTES = 1_048_576;

const DEFAULT_REDACTION_MARKER = "[redacted]";
const INVALID_JSON_MESSAGE = "Request body must contain valid JSON.";
const OVERSIZED_BODY_MESSAGE = "Request body exceeds the 1 MiB limit.";

export type EnterpriseWriteContextFailureCode =
  | "invalid_instance_url"
  | "enterprise_credentials_required"
  | "unsupported_enterprise_instance"
  | "invalid_enterprise_credentials";

export type EnterpriseWriteContextResult =
  | {
      ok: true;
      credentials: SessionCredentials;
      instance: NormalizedInstance;
      redact: (value: string) => string;
    }
  | {
      ok: false;
      code: EnterpriseWriteContextFailureCode;
      status: 400;
      message: string;
    };

export type BoundedJsonRequestResult =
  | { ok: true; value: unknown }
  | { ok: false; response: Response };

export type JsonRedactionPathSegment = string | number;

export interface JsonRedactionPolicy {
  preserveKey?: (path: readonly JsonRedactionPathSegment[], key: string) => boolean;
  preserveStringValue?: (
    path: readonly JsonRedactionPathSegment[],
    value: string,
  ) => boolean;
}

export function prepareEnterpriseWriteContext(
  credentials: SessionCredentials,
): EnterpriseWriteContextResult {
  const normalizedCredentials = normalizeWriteCredentials(credentials);
  const redact = createCredentialRedactor(credentials, normalizedCredentials);
  let instance: NormalizedInstance;

  try {
    instance = normalizeInstanceUrl(normalizedCredentials.baseUrl);
  } catch {
    return {
      ok: false,
      code: "invalid_instance_url",
      status: 400,
      message: "Enterprise write request requires a valid instance URL.",
    };
  }

  if (
    normalizedCredentials.instanceType !== "enterprise" ||
    instance.instanceType !== "enterprise"
  ) {
    return {
      ok: false,
      code: "enterprise_credentials_required",
      status: 400,
      message: "Enterprise write request requires Enterprise session credentials.",
    };
  }

  if (!isSupportedEnterpriseWriteTarget(instance)) {
    return {
      ok: false,
      code: "unsupported_enterprise_instance",
      status: 400,
      message: "Enterprise write request requires a Stack Enterprise instance URL.",
    };
  }

  const oauthValidation = validateEnterpriseV3OAuthCredentials(normalizedCredentials, {
    requiredScopes: ["write_access"],
  });
  if (!oauthValidation.valid) {
    return {
      ok: false,
      code: "invalid_enterprise_credentials",
      status: 400,
      message: oauthValidation.messages.join(" "),
    };
  }

  return {
    ok: true,
    credentials: normalizedCredentials,
    instance,
    redact,
  };
}

export function redactedJsonResponse<T>(
  body: T,
  status: number,
  redact: (value: string) => string,
  policy: JsonRedactionPolicy = {},
): Response {
  return jsonResponse(
    sanitizeForJson(body, redact, policy, [], new WeakSet<object>()),
    status,
  );
}

export async function readBoundedJsonRequest(
  request: Request,
): Promise<BoundedJsonRequestResult> {
  const contentLength = request.headers.get("content-length");
  if (contentLength !== null && isOversizedContentLength(contentLength)) {
    return { ok: false, response: jsonErrorResponse(OVERSIZED_BODY_MESSAGE, 413) };
  }

  let body: string;
  try {
    body = await request.text();
  } catch {
    return { ok: false, response: jsonErrorResponse(INVALID_JSON_MESSAGE, 400) };
  }

  if (new TextEncoder().encode(body).byteLength > MAX_WRITE_ROUTE_BYTES) {
    return { ok: false, response: jsonErrorResponse(OVERSIZED_BODY_MESSAGE, 413) };
  }

  try {
    return { ok: true, value: JSON.parse(body) as unknown };
  } catch {
    return { ok: false, response: jsonErrorResponse(INVALID_JSON_MESSAGE, 400) };
  }
}

function normalizeWriteCredentials(credentials: SessionCredentials): SessionCredentials {
  const normalizedCredentials: SessionCredentials = { ...credentials };
  const accessToken = normalizeOptionalToken(credentials.accessToken);
  const pat = normalizeOptionalToken(credentials.pat);

  if (accessToken) {
    normalizedCredentials.accessToken = accessToken;
  } else {
    delete normalizedCredentials.accessToken;
  }

  if (pat) {
    normalizedCredentials.pat = pat;
  } else {
    delete normalizedCredentials.pat;
  }

  return normalizedCredentials;
}

function normalizeOptionalToken(token: string | undefined): string | undefined {
  const trimmedToken = token?.trim();
  return trimmedToken ? trimmedToken : undefined;
}

function isSupportedEnterpriseWriteTarget(instance: NormalizedInstance): boolean {
  const url = new URL(instance.baseUrl);
  const hostname = url.hostname.toLowerCase();

  return (
    url.protocol === "https:" &&
    (hostname === "stackenterprise.co" || hostname.endsWith(".stackenterprise.co"))
  );
}

function createCredentialRedactor(
  rawCredentials: SessionCredentials,
  normalizedCredentials: SessionCredentials,
): (value: string) => string {
  const secretCandidates = [
    createRawSecretCandidate(rawCredentials.accessToken),
    createRawSecretCandidate(rawCredentials.pat),
    createNormalizedSecretCandidate(normalizedCredentials.accessToken),
    createNormalizedSecretCandidate(normalizedCredentials.pat),
  ].filter(isSecretCandidate);
  const uniqueSecretCandidates = [...new Map(
    secretCandidates.map((candidate) => [candidate.secret, candidate]),
  ).values()].sort((left, right) => right.secret.length - left.secret.length);
  const marker = chooseRedactionMarker(uniqueSecretCandidates);

  return (value) => redactInSinglePass(value, uniqueSecretCandidates, marker);
}

interface SecretCandidate {
  secret: string;
  prefix: string;
  suffix: string;
}

function createRawSecretCandidate(value: string | undefined): SecretCandidate | null {
  if (!isNonBlankString(value)) {
    return null;
  }

  const normalizedValue = value.trim();
  const normalizedStart = value.indexOf(normalizedValue);
  return {
    secret: value,
    prefix: value.slice(0, normalizedStart),
    suffix: value.slice(normalizedStart + normalizedValue.length),
  };
}

function createNormalizedSecretCandidate(value: string | undefined): SecretCandidate | null {
  return isNonBlankString(value)
    ? { secret: value, prefix: "", suffix: "" }
    : null;
}

function isSecretCandidate(value: SecretCandidate | null): value is SecretCandidate {
  return value !== null;
}

function chooseRedactionMarker(candidates: SecretCandidate[]): string {
  if (isSafeMarker(DEFAULT_REDACTION_MARKER, candidates)) {
    return DEFAULT_REDACTION_MARKER;
  }

  for (let codePoint = 0xe000; codePoint <= 0x10ffff; codePoint += 1) {
    const marker = String.fromCodePoint(codePoint);
    if (isSafeMarker(marker, candidates)) {
      return marker;
    }
  }

  return "";
}

function isSafeMarker(marker: string, candidates: SecretCandidate[]): boolean {
  return candidates.every((candidate) => !marker.includes(candidate.secret));
}

function redactInSinglePass(
  value: string,
  candidates: SecretCandidate[],
  marker: string,
): string {
  let redacted = "";
  let index = 0;

  while (index < value.length) {
    const candidate = candidates.find((item) => value.startsWith(item.secret, index));
    if (candidate) {
      redacted += `${candidate.prefix}${marker}${candidate.suffix}`;
      index += candidate.secret.length;
    } else {
      redacted += value[index];
      index += 1;
    }
  }

  return redacted;
}

function sanitizeForJson(
  value: unknown,
  redact: (value: string) => string,
  policy: JsonRedactionPolicy,
  path: readonly JsonRedactionPathSegment[],
  ancestors: WeakSet<object>,
): unknown {
  try {
    return sanitizeForJsonUnsafe(value, redact, policy, path, ancestors);
  } catch {
    return "";
  }
}

function sanitizeForJsonUnsafe(
  value: unknown,
  redact: (value: string) => string,
  policy: JsonRedactionPolicy,
  path: readonly JsonRedactionPathSegment[],
  ancestors: WeakSet<object>,
): unknown {
  if (typeof value === "string") {
    return policy.preserveStringValue?.(path, value) ? value : redact(value);
  }

  if (typeof value === "bigint") {
    return redact(String(value));
  }

  if ((typeof value !== "object" && typeof value !== "function") || value === null) {
    return value;
  }

  if (ancestors.has(value)) {
    return "";
  }

  ancestors.add(value);
  try {
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (Array.isArray(value)) {
      return sanitizeArray(descriptors, redact, policy, path, ancestors);
    }

    return sanitizeObject(descriptors, redact, policy, path, ancestors);
  } finally {
    ancestors.delete(value);
  }
}

function sanitizeArray(
  descriptors: PropertyDescriptorMap,
  redact: (value: string) => string,
  policy: JsonRedactionPolicy,
  path: readonly JsonRedactionPathSegment[],
  ancestors: WeakSet<object>,
): unknown[] {
  const lengthValue = descriptors.length?.value;
  const length = Number.isSafeInteger(lengthValue) && lengthValue >= 0 ? lengthValue : 0;
  const sanitized = new Array<unknown>(length);

  for (const [key, descriptor] of Object.entries(descriptors)) {
    if (!isArrayIndex(key, length) || !("value" in descriptor)) {
      continue;
    }

    const index = Number(key);
    sanitized[index] = sanitizeForJson(
      descriptor.value,
      redact,
      policy,
      [...path, index],
      ancestors,
    );
  }

  return sanitized;
}

function sanitizeObject(
  descriptors: PropertyDescriptorMap,
  redact: (value: string) => string,
  policy: JsonRedactionPolicy,
  path: readonly JsonRedactionPathSegment[],
  ancestors: WeakSet<object>,
): Record<string, unknown> {
  const sanitized = Object.create(null) as Record<string, unknown>;
  const trustedByOutputKey = new Map<string, boolean>();

  for (const [key, descriptor] of Object.entries(descriptors)) {
    if (key === "toJSON" || !descriptor.enumerable || !("value" in descriptor)) {
      continue;
    }

    const isTrustedKey = policy.preserveKey?.(path, key) === true;
    const outputKey = isTrustedKey ? key : redact(key);
    const existingKeyIsTrusted = trustedByOutputKey.get(outputKey);
    if (existingKeyIsTrusted !== undefined && (existingKeyIsTrusted || !isTrustedKey)) {
      continue;
    }

    Object.defineProperty(sanitized, outputKey, {
      value: sanitizeForJson(
        descriptor.value,
        redact,
        policy,
        [...path, key],
        ancestors,
      ),
      enumerable: true,
      configurable: true,
      writable: true,
    });
    trustedByOutputKey.set(outputKey, isTrustedKey);
  }

  return sanitized;
}

function isArrayIndex(key: string, length: number): boolean {
  if (!/^(0|[1-9]\d*)$/.test(key)) {
    return false;
  }

  const index = Number(key);
  return Number.isSafeInteger(index) && index >= 0 && index < length;
}

function isOversizedContentLength(value: string): boolean {
  if (!/^\d+$/.test(value)) {
    return false;
  }

  const contentLength = Number(value);
  return Number.isFinite(contentLength) && contentLength > MAX_WRITE_ROUTE_BYTES;
}

function jsonErrorResponse(error: string, status: number): Response {
  return jsonResponse({ ok: false, error }, status);
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
    },
  });
}

function isNonBlankString(value: string | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
