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

  if (!isSmeCoverageRunRequestPayload(payload)) {
    return jsonResponse(
      { ok: false, kind: "validation", error: "SME Coverage Analyzer run request requires credentials." },
      400,
    );
  }

  const settings = normalizeSettings(payload);
  const volumeValidation = validateApiVolumeSettings(settings);
  if (!volumeValidation.valid) {
    return jsonResponse(
      { ok: false, kind: "validation", error: volumeValidation.messages.join(" ") },
      400,
    );
  }

  const credentialValidation = validateCredentialsForUtility("sme-coverage-analyzer", payload.credentials);
  if (!credentialValidation.valid) {
    return jsonResponse(
      { ok: false, kind: "validation", error: credentialValidation.messages.join(" ") },
      400,
    );
  }

  try {
    const run = dependencies.runSmeCoverageAnalysis ?? runWithRunnerOptions;
    const result = await run(payload.credentials, settings);
    return jsonResponse({ ok: true, result }, 200);
  } catch (error) {
    return errorResponse(error);
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

function errorResponse(error: unknown): Response {
  if (error instanceof SmeCoverageRunError) {
    const status = {
      validation: 400,
      unsupported: 422,
      collection: 502,
      unexpected: 500,
    }[error.kind];
    const stage = typeof error.stage === "string" && error.stage.trim().length > 0
      ? { stage: error.stage }
      : {};

    return jsonResponse({ ok: false, kind: error.kind, ...stage, error: error.message }, status);
  }

  return jsonResponse(
    {
      ok: false,
      kind: "unexpected",
      error: error instanceof Error ? error.message : String(error),
    },
    500,
  );
}

function hasDateScopeProperty(value: unknown): boolean {
  return isRecord(value) && ["scope", "startDate", "endDate"].some((key) =>
    Object.prototype.hasOwnProperty.call(value, key),
  );
}

function isSmeCoverageRunRequestPayload(value: unknown): value is SmeCoverageRunRequestPayload {
  if (!isRecord(value) || !isAllowedPayloadShape(value) || !isSessionCredentials(value.credentials)) {
    return false;
  }

  return (
    (value.pageSize === undefined || typeof value.pageSize === "number") &&
    (value.maxPagesPerDataset === undefined || typeof value.maxPagesPerDataset === "number") &&
    (value.runPreset === undefined || isReportRunPresetId(value.runPreset))
  );
}

function isAllowedPayloadShape(value: Record<string, unknown>): boolean {
  return Object.keys(value).every((key) =>
    key === "credentials" || key === "pageSize" || key === "maxPagesPerDataset" || key === "runPreset",
  );
}

function isSessionCredentials(value: unknown): value is SessionCredentials {
  if (!isRecord(value)) return false;

  return (
    (value.instanceType === "basic-business" || value.instanceType === "enterprise") &&
    typeof value.baseUrl === "string" &&
    isOptionalString(value.apiKey) &&
    isOptionalString(value.accessToken) &&
    isOptionalString(value.pat) &&
    isOptionalAuthSource(value.authSource) &&
    isOptionalString(value.oauthClientId) &&
    (value.oauthScopes === undefined || isStringArray(value.oauthScopes)) &&
    isOptionalString(value.accessTokenExpiresAt)
  );
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function jsonResponse(body: SmeCoverageRunResponseBody, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
