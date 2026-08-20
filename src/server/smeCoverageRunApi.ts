import { validateCredentialsForUtility } from "../credentials/credentialRules";
import type { SessionCredentials } from "../domain/types";
import {
  runSmeCoverageAnalysis,
  SmeCoverageRunError,
  type SmeCoverageRunResult,
} from "../utilities/smeCoverage/runner";

interface SmeCoverageRunRequestPayload {
  credentials: SessionCredentials;
}

interface SmeCoverageRunDependencies {
  runSmeCoverageAnalysis?: (credentials: SessionCredentials) => Promise<SmeCoverageRunResult>;
}

const EXHAUSTIVE_SCOPE_ERROR =
  "SME Coverage Analyzer accepts credentials only; its scope is all available history.";

export type SmeCoverageRunResponseBody =
  | { ok: true; result: SmeCoverageRunResult }
  | {
      ok: false;
      kind: "validation" | "collection" | "unsupported" | "unexpected";
      stage?: string;
      error: string;
    };

export async function handleSmeCoverageRunRequest(
  payload: unknown,
  dependencies: SmeCoverageRunDependencies = {},
): Promise<Response> {
  if (hasUnapprovedPayloadProperty(payload)) {
    return jsonResponse(
      { ok: false, kind: "validation", error: EXHAUSTIVE_SCOPE_ERROR },
      400,
    );
  }

  const request = parseSmeCoverageRunRequestPayload(payload);
  if (!request) {
    return jsonResponse(
      { ok: false, kind: "validation", error: "SME Coverage Analyzer run request requires credentials." },
      400,
    );
  }

  const credentialValidation = validateCredentialsForUtility("sme-coverage-analyzer", request.credentials);
  if (!credentialValidation.valid) {
    return jsonResponse(
      { ok: false, kind: "validation", error: credentialValidation.messages.join(" ") },
      400,
    );
  }

  const credentialStrings = snapshotCredentialStrings(request.credentials);
  try {
    const run = dependencies.runSmeCoverageAnalysis ?? runSmeCoverageAnalysis;
    const runnerCredentials = cloneAndFreezeCredentials(request.credentials);
    const result = await run(runnerCredentials);
    return jsonResponse({ ok: true, result }, 200);
  } catch (error) {
    return errorResponse(error, credentialStrings);
  }
}

function errorResponse(error: unknown, credentialStrings: readonly string[]): Response {
  if (error instanceof SmeCoverageRunError) {
    const status = {
      validation: 400,
      unsupported: 422,
      collection: 502,
      unexpected: 500,
    }[error.kind];
    const stage = typeof error.stage === "string" && error.stage.trim().length > 0
      ? { stage: redactCredentialValues(error.stage, credentialStrings) }
      : {};

    return jsonResponse(
      { ok: false, kind: error.kind, ...stage, error: redactCredentialValues(error.message, credentialStrings) },
      status,
    );
  }

  return jsonResponse(
    {
      ok: false,
      kind: "unexpected",
      error: "SME Coverage Analyzer failed unexpectedly.",
    },
    500,
  );
}

function hasUnapprovedPayloadProperty(value: unknown): boolean {
  return isRecord(value) && Reflect.ownKeys(value).some((key) => key !== "credentials");
}

function parseSmeCoverageRunRequestPayload(value: unknown): SmeCoverageRunRequestPayload | null {
  if (!isRecord(value) || !hasOwnProperty(value, "credentials")) {
    return null;
  }

  const credentials = parseSessionCredentials(ownValue(value, "credentials"));
  if (!credentials) return null;

  return { credentials };
}

function parseSessionCredentials(value: unknown): SessionCredentials | null {
  if (!isRecord(value) || !hasOwnProperty(value, "instanceType") || !hasOwnProperty(value, "baseUrl")) {
    return null;
  }

  const instanceType = ownValue(value, "instanceType");
  const baseUrl = ownValue(value, "baseUrl");
  const apiKey = ownValue(value, "apiKey");
  const accessToken = ownValue(value, "accessToken");
  const pat = ownValue(value, "pat");
  const authSource = ownValue(value, "authSource");
  const oauthClientId = ownValue(value, "oauthClientId");
  const oauthScopes = ownValue(value, "oauthScopes");
  const accessTokenExpiresAt = ownValue(value, "accessTokenExpiresAt");

  if (
    (instanceType !== "basic-business" && instanceType !== "enterprise") ||
    typeof baseUrl !== "string" ||
    !isOptionalString(apiKey) ||
    !isOptionalString(accessToken) ||
    !isOptionalString(pat) ||
    !isOptionalAuthSource(authSource) ||
    !isOptionalString(oauthClientId) ||
    (oauthScopes !== undefined && !isStringArray(oauthScopes)) ||
    !isOptionalString(accessTokenExpiresAt)
  ) {
    return null;
  }

  return {
    instanceType,
    baseUrl,
    ...(apiKey !== undefined ? { apiKey } : {}),
    ...(accessToken !== undefined ? { accessToken } : {}),
    ...(pat !== undefined ? { pat } : {}),
    ...(authSource !== undefined ? { authSource } : {}),
    ...(oauthClientId !== undefined ? { oauthClientId } : {}),
    ...(oauthScopes !== undefined ? { oauthScopes } : {}),
    ...(accessTokenExpiresAt !== undefined ? { accessTokenExpiresAt } : {}),
  };
}

function isOptionalAuthSource(value: unknown): value is SessionCredentials["authSource"] | undefined {
  return (
    value === undefined ||
    value === "manual-pat" ||
    value === "manual-enterprise-token" ||
    value === "oauth-pkce"
  );
}

function isOptionalString(value: unknown): value is string | undefined {
  return value === undefined || typeof value === "string";
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function hasOwnProperty(value: object, key: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function ownValue(value: Record<string, unknown>, key: string): unknown {
  return hasOwnProperty(value, key) ? value[key] : undefined;
}

function snapshotCredentialStrings(credentials: SessionCredentials): readonly string[] {
  const values = [
    credentials.instanceType,
    credentials.baseUrl,
    credentials.apiKey,
    credentials.accessToken,
    credentials.pat,
    credentials.authSource,
    credentials.oauthClientId,
    ...(credentials.oauthScopes ?? []),
    credentials.accessTokenExpiresAt,
  ]
    .filter((value): value is string => typeof value === "string" && value.length > 0);

  return Object.freeze([...new Set(values)]);
}

function cloneAndFreezeCredentials(credentials: SessionCredentials): SessionCredentials {
  const clonedScopes = credentials.oauthScopes ? Object.freeze([...credentials.oauthScopes]) : undefined;
  return Object.freeze({
    ...credentials,
    ...(clonedScopes ? { oauthScopes: clonedScopes } : {}),
  }) as SessionCredentials;
}

function redactCredentialValues(message: string, credentialStrings: readonly string[]): string {
  return [...credentialStrings]
    .sort((left, right) => right.length - left.length)
    .reduce(
    (redacted, value) => redacted.split(value).join("[REDACTED]"),
    message,
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function jsonResponse(body: SmeCoverageRunResponseBody, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
