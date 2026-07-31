import { describe, expect, it, vi } from "vitest";
import type { SessionCredentials } from "../domain/types";
import { SmeCoverageRunError, type SmeCoverageRunResult } from "../utilities/smeCoverage/runner";
import { handleSmeCoverageRunRequest } from "./smeCoverageRunApi";

const credentials: SessionCredentials = {
  instanceType: "enterprise",
  baseUrl: "https://soedemo.stackenterprise.co",
  apiKey: "enterprise-api-key-secret",
  accessToken: "enterprise-access-token-secret",
  authSource: "manual-enterprise-token",
};

const result: SmeCoverageRunResult = {
  utilityId: "sme-coverage-analyzer",
  utilityTitle: "SME Coverage Analyzer",
  pageSize: 100,
  maxPagesPerDataset: 20,
  runPreset: "deep-audit",
  datasets: [],
  messages: [],
  warnings: [],
  decisionPack: {
    summary: {
      tagsAnalyzed: 0,
      tagsWithSmes: 0,
      immediateGaps: 0,
      criticalUnderCoverage: 0,
      lightCoverage: 0,
      unknownRows: 0,
    },
    evidence: [],
    overview: "No SME coverage data was returned.",
    assessment: "No assessment is available.",
    findings: {
      immediateGaps: [],
      criticalUnderCoverage: [],
      lightCoverage: [],
    },
    methodology: {
      activityQuestionMinimum: 1,
      activityPageViewThresholdExclusive: 25,
      activeTagMedianPageViews: null,
      coveredActiveSampleSize: 0,
      p75PageViewsPerSme: null,
      p90PageViewsPerSme: null,
      percentileSampleSufficient: false,
      ratioFormula: "pageViews / smeCount",
      roundingRule: "Nearest whole page view for display; unrounded for calculation",
    },
    warnings: [],
    snapshot: {
      instanceHost: "soedemo.stackenterprise.co",
      generatedAt: "2026-07-31T00:00:00.000Z",
      scopeLabel: "All-time demand · Current SME coverage",
      completeness: "Complete",
      pageSize: 100,
      maxPagesPerDataset: 20,
      runPreset: "deep-audit",
    },
  },
};

async function responseBody(response: Response) {
  return response.json();
}

describe("handleSmeCoverageRunRequest", () => {
  it("uses Deep settings for a credentials-only request", async () => {
    const runSmeCoverageAnalysis = vi.fn().mockResolvedValue(result);

    const response = await handleSmeCoverageRunRequest({ credentials }, { runSmeCoverageAnalysis });

    expect(response.status).toBe(200);
    await expect(responseBody(response)).resolves.toEqual({ ok: true, result });
    expect(runSmeCoverageAnalysis).toHaveBeenCalledWith(credentials, {
      pageSize: 100,
      maxPagesPerDataset: 20,
      runPreset: "deep-audit",
    });
  });

  it.each([
    ["Quick", "quick-sample", 50, 1],
    ["Standard", "standard", 100, 5],
    ["Deep", "deep-audit", 100, 20],
    ["custom", undefined, 75, 2],
  ] as const)("preserves %s volume settings", async (_label, runPreset, pageSize, maxPagesPerDataset) => {
    const runSmeCoverageAnalysis = vi.fn().mockResolvedValue(result);

    const response = await handleSmeCoverageRunRequest(
      { credentials, pageSize, maxPagesPerDataset, ...(runPreset ? { runPreset } : {}) },
      { runSmeCoverageAnalysis },
    );

    expect(response.status).toBe(200);
    expect(runSmeCoverageAnalysis).toHaveBeenCalledWith(credentials, {
      pageSize,
      maxPagesPerDataset,
      ...(runPreset ? { runPreset } : {}),
    });
  });

  it("clears a requested preset that does not match its numeric settings", async () => {
    const runSmeCoverageAnalysis = vi.fn().mockResolvedValue(result);

    const response = await handleSmeCoverageRunRequest(
      { credentials, pageSize: 75, maxPagesPerDataset: 2, runPreset: "quick-sample" },
      { runSmeCoverageAnalysis },
    );

    expect(response.status).toBe(200);
    expect(runSmeCoverageAnalysis).toHaveBeenCalledWith(credentials, {
      pageSize: 75,
      maxPagesPerDataset: 2,
    });
  });

  it.each([
    ["a zero page size", { pageSize: 0 }],
    ["a page size above 100", { pageSize: 101 }],
    ["zero maximum pages", { maxPagesPerDataset: 0 }],
  ])("rejects %s before running", async (_label, settings) => {
    const runSmeCoverageAnalysis = vi.fn();

    const response = await handleSmeCoverageRunRequest(
      { credentials, ...settings },
      { runSmeCoverageAnalysis },
    );

    expect(response.status).toBe(400);
    await expect(responseBody(response)).resolves.toMatchObject({ ok: false, kind: "validation" });
    expect(runSmeCoverageAnalysis).not.toHaveBeenCalled();
  });

  it.each([
    ["missing credentials", {}],
    ["malformed OAuth scopes", { credentials: { ...credentials, oauthScopes: {} } }],
  ])("returns a validation response for %s", async (_label, payload) => {
    const runSmeCoverageAnalysis = vi.fn();

    const response = await handleSmeCoverageRunRequest(payload, { runSmeCoverageAnalysis });

    expect(response.status).toBe(400);
    await expect(responseBody(response)).resolves.toMatchObject({ ok: false, kind: "validation" });
    expect(runSmeCoverageAnalysis).not.toHaveBeenCalled();
  });

  it.each([
    ["scope", { scope: {} }],
    ["startDate", { startDate: "2026-07-01" }],
    ["endDate", { endDate: "2026-07-31" }],
  ])("rejects a %s property instead of accepting a date scope", async (_property, dateField) => {
    const runSmeCoverageAnalysis = vi.fn();

    const response = await handleSmeCoverageRunRequest(
      { credentials, ...dateField },
      { runSmeCoverageAnalysis },
    );

    expect(response.status).toBe(400);
    await expect(responseBody(response)).resolves.toEqual({
      ok: false,
      kind: "validation",
      error: "SME Coverage Analyzer does not accept a date scope.",
    });
    expect(runSmeCoverageAnalysis).not.toHaveBeenCalled();
  });

  it.each([
    ["validation", 400],
    ["unsupported", 422],
    ["collection", 502],
    ["unexpected", 500],
  ] as const)("maps a %s runner error to HTTP %i", async (kind, status) => {
    const runSmeCoverageAnalysis = vi.fn().mockRejectedValue(new SmeCoverageRunError(kind, `${kind} failed`));

    const response = await handleSmeCoverageRunRequest({ credentials }, { runSmeCoverageAnalysis });

    expect(response.status).toBe(status);
    await expect(responseBody(response)).resolves.toEqual({ ok: false, kind, error: `${kind} failed` });
  });

  it("includes a non-empty collection stage", async () => {
    const runSmeCoverageAnalysis = vi.fn().mockRejectedValue(
      new SmeCoverageRunError("collection", "Questions failed", "questions"),
    );

    const response = await handleSmeCoverageRunRequest({ credentials }, { runSmeCoverageAnalysis });

    expect(response.status).toBe(502);
    await expect(responseBody(response)).resolves.toEqual({
      ok: false,
      kind: "collection",
      stage: "questions",
      error: "Questions failed",
    });
  });

  it.each([
    ["complete", result],
    [
      "partial",
      {
        ...result,
        warnings: [{ code: "capped", message: "Partial sample" }],
        decisionPack: {
          ...result.decisionPack,
          snapshot: { ...result.decisionPack.snapshot, completeness: "Partial" as const },
        },
      },
    ],
    [
      "empty",
      {
        ...result,
        datasets: [],
        messages: [],
        warnings: [],
        decisionPack: {
          ...result.decisionPack,
          snapshot: { ...result.decisionPack.snapshot, completeness: "Empty" as const },
        },
      },
    ],
  ])("returns a %s result pack unchanged", async (_label, successfulResult) => {
    const runSmeCoverageAnalysis = vi.fn().mockResolvedValue(successfulResult);

    const response = await handleSmeCoverageRunRequest({ credentials }, { runSmeCoverageAnalysis });

    expect(response.status).toBe(200);
    await expect(responseBody(response)).resolves.toEqual({ ok: true, result: successfulResult });
  });

  it("never returns submitted credential values", async () => {
    const runSmeCoverageAnalysis = vi.fn().mockRejectedValue(
      new SmeCoverageRunError("collection", "Questions failed", "questions"),
    );

    const response = await handleSmeCoverageRunRequest({ credentials }, { runSmeCoverageAnalysis });
    const body = JSON.stringify(await responseBody(response));

    expect(body).not.toContain("enterprise-api-key-secret");
    expect(body).not.toContain("enterprise-access-token-secret");
    expect(body).not.toContain("credentials");
  });
});
