import { validateCredentialsForUtility } from "../credentials/credentialRules";
import { getReportRunPresetForSettings } from "../domain/reportRunPresets";
import { validateApiVolumeSettings } from "../domain/reportScope";
import type { ApiVolumeSettingsValue, ReportRunPresetId, SessionCredentials } from "../domain/types";
import {
  runSmeCoverageAnalysis,
  SmeCoverageRunError,
  type SmeCoverageRunResult,
} from "../utilities/smeCoverage/runner";
import { DEFAULT_SME_COVERAGE_SETTINGS } from "../utilities/smeCoverage/settings";

interface SmeCoverageRunRequestPayload {
  credentials: SessionCredentials;
  pageSize?: number;
  maxPagesPerDataset?: number;
  runPreset?: ReportRunPresetId;
}

interface SmeCoverageRunDependencies {
  runSmeCoverageAnalysis?: (
    credentials: SessionCredentials,
    settings: ApiVolumeSettingsValue,
  ) => Promise<SmeCoverageRunResult>;
}

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
  if (hasDateScopeProperty(payload)) {
    return jsonResponse(
      { ok: false, kind: "validation", error: "SME Coverage Analyzer does not accept a date scope." },
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

  const settings = normalizeSettings(request);
  const volumeValidation = validateApiVolumeSettings(settings);
  if (!volumeValidation.valid) {
    return jsonResponse(
      { ok: false, kind: "validation", error: volumeValidation.messages.join(" ") },
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

  try {
    const run = dependencies.runSmeCoverageAnalysis ?? runWithRunnerOptions;
    const result = await run(request.credentials, settings);
    return jsonResponse({ ok: true, result }, 200);
  } catch (error) {
    return errorResponse(error, request.credentials);
  }
}

async function runWithRunnerOptions(
  credentials: SessionCredentials,
  settings: ApiVolumeSettingsValue,
): Promise<SmeCoverageRunResult> {
  return runSmeCoverageAnalysis(credentials, { settings });
}

function normalizeSettings(payload: SmeCoverageRunRequestPayload): ApiVolumeSettingsValue {
  const pageSize = payload.pageSize ?? DEFAULT_SME_COVERAGE_SETTINGS.pageSize;
  const maxPagesPerDataset = payload.maxPagesPerDataset ?? DEFAULT_SME_COVERAGE_SETTINGS.maxPagesPerDataset;
  const runPreset = getReportRunPresetForSettings(pageSize, maxPagesPerDataset)?.id;

  return {
    pageSize,
    maxPagesPerDataset,
    ...(runPreset ? { runPreset } : {}),
  };
}

function errorResponse(error: unknown, credentials: SessionCredentials): Response {
  if (error instanceof SmeCoverageRunError) {
    const status = {
      validation: 400,
      unsupported: 422,
      collection: 502,
      unexpected: 500,
    }[error.kind];
    const stage = typeof error.stage === "string" && error.stage.trim().length > 0
      ? { stage: redactCredentialValues(error.stage, credentials) }
      : {};

    return jsonResponse(
      { ok: false, kind: error.kind, ...stage, error: redactCredentialValues(error.message, credentials) },
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

function hasDateScopeProperty(value: unknown): boolean {
  return isRecord(value) && Reflect.ownKeys(value).some((key) =>
    key === "scope" || key === "startDate" || key === "endDate",
  );
}

function parseSmeCoverageRunRequestPayload(value: unknown): SmeCoverageRunRequestPayload | null {
  if (!isRecord(value) || !isAllowedPayloadShape(value) || !hasOwnProperty(value, "credentials")) {
    return null;
  }

  const credentials = parseSessionCredentials(ownValue(value, "credentials"));
  const pageSize = ownValue(value, "pageSize");
  const maxPagesPerDataset = ownValue(value, "maxPagesPerDataset");
  const runPreset = ownValue(value, "runPreset");
  if (
    !credentials ||
    (pageSize !== undefined && typeof pageSize !== "number") ||
    (maxPagesPerDataset !== undefined && typeof maxPagesPerDataset !== "number") ||
    (runPreset !== undefined && !isReportRunPresetId(runPreset))
  ) {
    return null;
  }

  return {
    credentials,
    ...(pageSize !== undefined ? { pageSize } : {}),
    ...(maxPagesPerDataset !== undefined ? { maxPagesPerDataset } : {}),
    ...(runPreset !== undefined ? { runPreset } : {}),
  };
}

function isAllowedPayloadShape(value: Record<string, unknown>): boolean {
  return Reflect.ownKeys(value).every((key) =>
    key === "credentials" || key === "pageSize" || key === "maxPagesPerDataset" || key === "runPreset",
  );
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

function isReportRunPresetId(value: unknown): value is ReportRunPresetId {
  return value === "quick-sample" || value === "standard" || value === "deep-audit";
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

function redactCredentialValues(message: string, credentials: SessionCredentials): string {
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
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .sort((left, right) => right.length - left.length);

  return [...new Set(values)].reduce(
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
