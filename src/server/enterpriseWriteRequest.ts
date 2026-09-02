import {
  normalizeInstanceUrl,
  validateEnterpriseV3OAuthCredentials,
  type NormalizedInstance,
} from "../credentials/credentialRules";
import type { SessionCredentials } from "../domain/types";

export const MAX_WRITE_ROUTE_BYTES = 1_048_576;

const REDACTED_CREDENTIAL = "[redacted]";
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
): Response {
  return jsonResponse(redactStrings(body, redact), status);
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

  return (value) =>
    uniqueSecretCandidates.reduce(
      (redactedValue, candidate) =>
        redactedValue.split(candidate.secret).join(candidate.replacement),
      value,
    );
}

interface SecretCandidate {
  secret: string;
  replacement: string;
}

function createRawSecretCandidate(value: string | undefined): SecretCandidate | null {
  if (!isNonBlankString(value)) {
    return null;
  }

  const normalizedValue = value.trim();
  const normalizedStart = value.indexOf(normalizedValue);
  return {
    secret: value,
    replacement: `${value.slice(0, normalizedStart)}${REDACTED_CREDENTIAL}${value.slice(normalizedStart + normalizedValue.length)}`,
  };
}

function createNormalizedSecretCandidate(value: string | undefined): SecretCandidate | null {
  return isNonBlankString(value)
    ? { secret: value, replacement: REDACTED_CREDENTIAL }
    : null;
}

function isSecretCandidate(value: SecretCandidate | null): value is SecretCandidate {
  return value !== null;
}

function redactStrings(value: unknown, redact: (value: string) => string): unknown {
  if (typeof value === "string") {
    return redact(value);
  }

  if (Array.isArray(value)) {
    return value.map((item) => redactStrings(item, redact));
  }

  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [redact(key), redactStrings(item, redact)]),
    );
  }

  return value;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
