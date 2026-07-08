import { runLiveReport, type LiveReportRunResult } from "../collectors/liveReportRunner";
import { validateCredentialsForReport } from "../credentials/credentialRules";
import { DEFAULT_REPORT_RUN_SCOPE, validateReportRunScope } from "../domain/reportScope";
import type {
  PeriodScope,
  ReportId,
  ReportRunPresetId,
  RunPeriodRole,
  SessionCredentials,
} from "../domain/types";

interface ReportRunRequestPayload {
  reportId: ReportId;
  credentials: SessionCredentials;
  periodRole?: RunPeriodRole;
  scope?: PeriodScope;
  pageSize?: number;
  maxPagesPerDataset?: number;
  runPreset?: ReportRunPresetId;
}

interface ReportRunDependencies {
  runLiveReport?: (
    reportId: ReportId,
    credentials: SessionCredentials,
    options: {
      periodRole: RunPeriodRole;
      scope: PeriodScope;
      pageSize: number;
      maxPagesPerDataset: number;
    },
  ) => Promise<LiveReportRunResult>;
}

export type ReportRunResponseBody =
  | { ok: true; result: LiveReportRunResult }
  | { ok: false; error: string };

export async function handleReportRunRequest(
  payload: unknown,
  dependencies: ReportRunDependencies = {},
): Promise<Response> {
  if (!isReportRunRequestPayload(payload)) {
    return jsonResponse(
      { ok: false, error: "Report run request requires a reportId and credentials." },
      400,
    );
  }

  const periodRole = payload.periodRole ?? "current";
  const scope = payload.scope ?? {};
  const pageSize = payload.pageSize ?? DEFAULT_REPORT_RUN_SCOPE.pageSize;
  const maxPagesPerDataset = payload.maxPagesPerDataset ?? DEFAULT_REPORT_RUN_SCOPE.maxPagesPerDataset;
  const validation = validateReportRunScope({
    current: scope,
    pageSize,
    maxPagesPerDataset,
  });

  if (!validation.valid) {
    return jsonResponse({ ok: false, error: validation.messages.join(" ") }, 400);
  }

  const credentialValidation = validateCredentialsForReport(payload.reportId, payload.credentials);
  if (!credentialValidation.valid) {
    return jsonResponse({ ok: false, error: credentialValidation.messages.join(" ") }, 400);
  }

  try {
    const result = await (dependencies.runLiveReport ?? runLiveReport)(
      payload.reportId,
      payload.credentials,
      {
        periodRole,
        scope,
        pageSize,
        maxPagesPerDataset,
      },
    );

    return jsonResponse({ ok: true, result }, 200);
  } catch (error) {
    return jsonResponse(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      500,
    );
  }
}

function isReportRunRequestPayload(value: unknown): value is ReportRunRequestPayload {
  if (!isRecord(value) || typeof value.reportId !== "string" || !isRecord(value.credentials)) {
    return false;
  }

  if (value.periodRole !== undefined && value.periodRole !== "current" && value.periodRole !== "comparison") {
    return false;
  }

  if (value.scope !== undefined && !isRecord(value.scope)) {
    return false;
  }

  if (
    value.runPreset !== undefined &&
    value.runPreset !== "quick-sample" &&
    value.runPreset !== "standard" &&
    value.runPreset !== "deep-audit"
  ) {
    return false;
  }

  return (
    typeof value.credentials.instanceType === "string" &&
    typeof value.credentials.baseUrl === "string" &&
    isOptionalString(value.credentials.apiKey) &&
    isOptionalString(value.credentials.accessToken) &&
    isOptionalString(value.credentials.pat) &&
    isOptionalAuthSource(value.credentials.authSource) &&
    isOptionalString(value.credentials.oauthClientId) &&
    (value.credentials.oauthScopes === undefined || isStringArray(value.credentials.oauthScopes)) &&
    isOptionalString(value.credentials.accessTokenExpiresAt)
  );
}

function jsonResponse(body: ReportRunResponseBody, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
    },
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
