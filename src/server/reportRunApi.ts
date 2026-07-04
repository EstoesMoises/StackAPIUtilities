import { runLiveReport, type LiveReportRunResult } from "../collectors/liveReportRunner";
import type { ReportId, SessionCredentials } from "../domain/types";

interface ReportRunRequestPayload {
  reportId: ReportId;
  credentials: SessionCredentials;
}

interface ReportRunDependencies {
  runLiveReport?: (
    reportId: ReportId,
    credentials: SessionCredentials,
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

  try {
    const result = await (dependencies.runLiveReport ?? runLiveReport)(
      payload.reportId,
      payload.credentials,
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

  return typeof value.credentials.instanceType === "string" && typeof value.credentials.baseUrl === "string";
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
