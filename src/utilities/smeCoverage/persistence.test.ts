import { describe, expect, it } from "vitest";
import type { SmeCoverageDecisionPack } from "./model";
import { parseSmeCoverageDecisionPack } from "./persistence";

describe("parseSmeCoverageDecisionPack", () => {
  it.each([
    ["complete", createDecisionPack()],
    ["partial", createDecisionPack({ completeness: "Partial" })],
    ["small sample", createSmallSamplePack()],
    ["empty", createEmptyPack()],
  ])("round-trips a %s decision pack without reordering canonical evidence", (_label, pack) => {
    const parsed = parseSmeCoverageDecisionPack(pack);

    expect(parsed).toEqual(pack);
    expect(parsed).not.toBe(pack);
    expect(parsed?.evidence.map((row) => row.tagName)).toEqual(pack.evidence.map((row) => row.tagName));
  });

  it.each([
    ["snapshot completeness enum", (pack: Record<string, any>) => { pack.snapshot.completeness = "Nearly"; }],
    ["negative snapshot metric", (pack: Record<string, any>) => { pack.snapshot.pageSize = -1; }],
    ["non-finite metric", (pack: Record<string, any>) => { pack.methodology.p90PageViewsPerSme = Infinity; }],
    ["percentile above 100", (pack: Record<string, any>) => { pack.evidence[0].coveragePercentile = 101; }],
    ["wrong summary type", (pack: Record<string, any>) => { pack.summary.tagsAnalyzed = "3"; }],
    ["non-integer summary", (pack: Record<string, any>) => { pack.summary.tagsAnalyzed = 2.5; }],
    ["non-array findings", (pack: Record<string, any>) => { pack.findings.immediateGaps = {}; }],
    ["non-array evidence", (pack: Record<string, any>) => { pack.evidence = {}; }],
    ["mismatched finding row", (pack: Record<string, any>) => {
      pack.findings.immediateGaps[0] = { ...pack.findings.immediateGaps[0], reason: "tampered" };
    }],
    ["missing canonical finding row", (pack: Record<string, any>) => { pack.findings.immediateGaps = []; }],
    ["finding in wrong tier", (pack: Record<string, any>) => { pack.findings.lightCoverage = [pack.evidence[0]]; }],
    ["missing snapshot label", (pack: Record<string, any>) => { delete pack.snapshot.scopeLabel; }],
    ["invalid required null", (pack: Record<string, any>) => { pack.overview = null; }],
    ["invalid nullable metric", (pack: Record<string, any>) => { pack.evidence[0].pageViews = "100"; }],
  ])("rejects malformed nested data: %s", (_label, mutate) => {
    const persisted = structuredClone(createDecisionPack()) as Record<string, any>;
    mutate(persisted);

    expect(parseSmeCoverageDecisionPack(persisted)).toBeNull();
  });

  it("reconstructs only allowlisted nested fields and strips secrets at every pack level", () => {
    const clean = createDecisionPack();
    const persisted = structuredClone(clean) as Record<string, any>;
    const secretExtras = {
      credentials: { pat: "secret" },
      accessToken: "secret",
      runQueue: [{ id: "secret-run" }],
    };
    Object.assign(persisted, secretExtras);
    Object.assign(persisted.snapshot, secretExtras);
    Object.assign(persisted.warnings[0], secretExtras);
    Object.assign(persisted.evidence[0], secretExtras);
    Object.assign(persisted.methodology, secretExtras);

    const parsed = parseSmeCoverageDecisionPack(persisted);

    expect(parsed).toEqual(clean);
    expect(JSON.stringify(parsed)).not.toMatch(/secret|credentials|accessToken|runQueue/);
  });

  it("reuses canonical evidence objects for validated finding rows", () => {
    const parsed = parseSmeCoverageDecisionPack(createDecisionPack());

    expect(parsed?.findings.immediateGaps[0]).toBe(parsed?.evidence[0]);
    expect(parsed?.findings.criticalUnderCoverage[0]).toBe(parsed?.evidence[1]);
    expect(parsed?.findings.lightCoverage[0]).toBe(parsed?.evidence[2]);
  });
});

export function createDecisionPack(
  options: { completeness?: "Complete" | "Partial" | "Empty" } = {},
): SmeCoverageDecisionPack {
  const immediateGap = {
    tagName: "python",
    pageViews: 500,
    questionCount: 8,
    questionCountBasis: "Complete question enumeration" as const,
    smeCount: 0,
    pageViewsPerSme: null,
    coveragePercentile: null,
    coverageTier: "Immediate gap" as const,
    reason: "Active demand has no SME coverage.",
    recommendedAction: "Recruit an SME.",
    demandQuality: "Complete" as const,
    smeQuality: "Complete" as const,
  };
  const critical = {
    tagName: "typescript",
    pageViews: 400,
    questionCount: 6,
    questionCountBasis: "All-time tag total" as const,
    smeCount: 1,
    pageViewsPerSme: 400,
    coveragePercentile: 90,
    coverageTier: "Critical under-coverage" as const,
    reason: "Demand per SME is at or above p90.",
    recommendedAction: "Add SME capacity.",
    demandQuality: "Complete" as const,
    smeQuality: "Complete" as const,
  };
  const light = {
    tagName: "react",
    pageViews: 300,
    questionCount: 5,
    questionCountBasis: "Complete question enumeration" as const,
    smeCount: 2,
    pageViewsPerSme: 150,
    coveragePercentile: 75,
    coverageTier: "Light coverage" as const,
    reason: "Demand per SME is at or above p75.",
    recommendedAction: "Monitor capacity.",
    demandQuality: "Complete" as const,
    smeQuality: "Complete" as const,
  };

  return {
    snapshot: {
      instanceHost: "example.stackenterprise.co",
      generatedAt: "2026-07-30T12:00:00.000Z",
      scopeLabel: "All-time demand · Current SME coverage",
      completeness: options.completeness ?? "Complete",
      pageSize: 100,
      maxPagesPerDataset: 20,
      runPreset: "deep-audit",
    },
    warnings: [
      {
        utilityId: "sme-coverage-analyzer",
        code: "coverage.partial-sample",
        message: "The approved sample may be partial.",
      },
    ],
    summary: {
      tagsAnalyzed: 3,
      tagsWithSmes: 2,
      immediateGaps: 1,
      criticalUnderCoverage: 1,
      lightCoverage: 1,
      unknownRows: 0,
    },
    overview: "Three tags were analyzed.",
    assessment: "Coverage needs attention.",
    findings: {
      immediateGaps: [immediateGap],
      criticalUnderCoverage: [critical],
      lightCoverage: [light],
    },
    methodology: {
      activityQuestionMinimum: 1,
      activityPageViewThresholdExclusive: 25,
      activeTagMedianPageViews: 300,
      coveredActiveSampleSize: 2,
      p75PageViewsPerSme: 150,
      p90PageViewsPerSme: 400,
      percentileSampleSufficient: true,
      ratioFormula: "pageViews / smeCount",
      roundingRule: "Nearest whole page view for display; unrounded for calculation",
    },
    evidence: [immediateGap, critical, light],
  };
}

function createSmallSamplePack(): SmeCoverageDecisionPack {
  const pack = createDecisionPack({ completeness: "Partial" });
  return {
    ...pack,
    methodology: {
      ...pack.methodology,
      coveredActiveSampleSize: 2,
      p75PageViewsPerSme: null,
      p90PageViewsPerSme: null,
      percentileSampleSufficient: false,
    },
  };
}

function createEmptyPack(): SmeCoverageDecisionPack {
  const pack = createDecisionPack({ completeness: "Empty" });
  return {
    ...pack,
    warnings: [],
    summary: {
      tagsAnalyzed: 0,
      tagsWithSmes: 0,
      immediateGaps: 0,
      criticalUnderCoverage: 0,
      lightCoverage: 0,
      unknownRows: 0,
    },
    overview: "No tags were available.",
    assessment: "No assessment can be made.",
    findings: { immediateGaps: [], criticalUnderCoverage: [], lightCoverage: [] },
    methodology: {
      ...pack.methodology,
      activeTagMedianPageViews: null,
      coveredActiveSampleSize: 0,
      p75PageViewsPerSme: null,
      p90PageViewsPerSme: null,
      percentileSampleSufficient: false,
    },
    evidence: [],
  };
}
