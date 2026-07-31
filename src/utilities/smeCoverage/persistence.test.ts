import { describe, expect, it } from "vitest";
import type { SmeCoverageDecisionPack } from "./model";
import { parseSmeCoverageDecisionPack } from "./persistence";

const canonicalPartialSampleWarning = {
  utilityId: "sme-coverage-analyzer",
  code: "sme-coverage.partial-sample",
  message:
    "This decision pack is a partial sample because configured limits or source caps limited the analyzed evidence.",
} as const;

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

  it.each([
    ["sample sufficiency", (pack: Record<string, any>) => { pack.methodology.coveredActiveSampleSize = 3; }],
    ["covered sample count", (pack: Record<string, any>) => { pack.methodology.coveredActiveSampleSize = 5; }],
    ["active median", (pack: Record<string, any>) => { pack.methodology.activeTagMedianPageViews = 301; }],
    ["nearest-rank p75", (pack: Record<string, any>) => { pack.methodology.p75PageViewsPerSme = 151; }],
    ["covered row ratio", (pack: Record<string, any>) => {
      pack.evidence[1].pageViewsPerSme = 399;
    }],
    ["covered row percentile", (pack: Record<string, any>) => {
      pack.evidence[1].coveragePercentile = 99;
    }],
    ["sufficient-sample threshold null", (pack: Record<string, any>) => {
      pack.methodology.p90PageViewsPerSme = null;
    }],
  ])("rejects analyzer-incoherent %s", (_label, mutate) => {
    const persisted = structuredClone(createDecisionPack()) as Record<string, any>;
    mutate(persisted);

    expect(parseSmeCoverageDecisionPack(persisted)).toBeNull();
  });

  it("rejects small samples that claim sufficient percentiles, suppress thresholds, or classify covered rows", () => {
    const sufficient = structuredClone(createSmallSamplePack()) as Record<string, any>;
    sufficient.methodology.percentileSampleSufficient = true;
    expect(parseSmeCoverageDecisionPack(sufficient)).toBeNull();

    const missingThresholds = structuredClone(createSmallSamplePack()) as Record<string, any>;
    missingThresholds.methodology.p75PageViewsPerSme = null;
    missingThresholds.methodology.p90PageViewsPerSme = null;
    expect(parseSmeCoverageDecisionPack(missingThresholds)).toBeNull();

    const classified = structuredClone(createSmallSamplePack()) as Record<string, any>;
    classified.evidence[1].coverageTier = "Critical under-coverage";
    classified.findings.criticalUnderCoverage = [classified.evidence[1]];
    classified.summary.criticalUnderCoverage = 1;
    expect(parseSmeCoverageDecisionPack(classified)).toBeNull();
  });

  it("requires zero-sample thresholds to be null", () => {
    const persisted = structuredClone(createEmptyPack()) as Record<string, any>;
    persisted.methodology.p75PageViewsPerSme = 0;

    expect(parseSmeCoverageDecisionPack(persisted)).toBeNull();
  });

  it.each([
    ["Quick", { pageSize: 50, maxPagesPerDataset: 1, runPreset: "quick-sample" }],
    ["Standard", { pageSize: 100, maxPagesPerDataset: 5, runPreset: "standard" }],
    ["missing preset", { pageSize: 100, maxPagesPerDataset: 20 }],
    ["custom", { pageSize: 75, maxPagesPerDataset: 7 }],
    ["changed Deep", { pageSize: 50, maxPagesPerDataset: 20, runPreset: "deep-audit" }],
  ])("migrates a legacy %s configuration to one immutable canonical partial-sample warning", (_label, settings) => {
    const missingNarrative = structuredClone(createDecisionPack({ completeness: "Partial" })) as Record<string, any>;
    missingNarrative.snapshot = { ...missingNarrative.snapshot, ...settings };
    if (!("runPreset" in settings)) delete missingNarrative.snapshot.runPreset;
    expect(parseSmeCoverageDecisionPack(missingNarrative)).toBeNull();

    missingNarrative.overview += " This analysis is a partial sample.";
    missingNarrative.assessment += " This analysis is a partial sample.";
    const parsed = parseSmeCoverageDecisionPack(missingNarrative);
    expect(parsed).not.toBeNull();
    expect(parsed?.warnings.filter((warning) => warning.code === canonicalPartialSampleWarning.code)).toEqual([
      canonicalPartialSampleWarning,
    ]);
    expect(Object.isFrozen(parsed?.warnings)).toBe(true);
    expect(Object.isFrozen(parsed?.warnings.find((warning) => warning.code === canonicalPartialSampleWarning.code))).toBe(true);

    missingNarrative.snapshot.completeness = "Complete";
    expect(parseSmeCoverageDecisionPack(missingNarrative)).toBeNull();
  });

  it("normalizes and deduplicates a same-code legacy warning in source-to-sampling-to-analyzer order", () => {
    const persisted = structuredClone(createDecisionPack({ completeness: "Partial" })) as Record<string, any>;
    persisted.snapshot = {
      ...persisted.snapshot,
      pageSize: 100,
      maxPagesPerDataset: 5,
      runPreset: "standard",
    };
    persisted.overview += " This analysis is a partial sample.";
    persisted.assessment += " This analysis is a partial sample.";
    persisted.warnings = [
      persisted.warnings[0],
      {
        utilityId: "sme-coverage-analyzer",
        code: canonicalPartialSampleWarning.code,
        message: "Legacy sampling copy without the required phrase.",
      },
      {
        utilityId: "sme-coverage-analyzer",
        code: "sme-coverage.invalid-demand",
        message: "Analyzer warning.",
      },
      canonicalPartialSampleWarning,
    ];

    const parsed = parseSmeCoverageDecisionPack(persisted);

    expect(parsed?.warnings).toEqual([
      persisted.warnings[0],
      canonicalPartialSampleWarning,
      persisted.warnings[2],
    ]);
  });

  it("round-trips a current configured-partial pack without duplicating its canonical warning", () => {
    const persisted = structuredClone(createDecisionPack({ completeness: "Partial" })) as Record<string, any>;
    persisted.snapshot = {
      ...persisted.snapshot,
      pageSize: 100,
      maxPagesPerDataset: 5,
      runPreset: "standard",
    };
    persisted.overview += " This analysis is a partial sample.";
    persisted.assessment += " This analysis is a partial sample.";
    persisted.warnings = [persisted.warnings[0], canonicalPartialSampleWarning];

    const firstParse = parseSmeCoverageDecisionPack(persisted);
    const secondParse = parseSmeCoverageDecisionPack(firstParse);

    expect(firstParse?.warnings).toEqual([persisted.warnings[0], canonicalPartialSampleWarning]);
    expect(secondParse?.warnings).toEqual(firstParse?.warnings);
    expect(
      secondParse?.warnings.filter((warning) => warning.code === canonicalPartialSampleWarning.code),
    ).toHaveLength(1);
  });

  it("does not add sampling warnings to structured Deep Complete or Empty packs", () => {
    for (const pack of [createDecisionPack(), createEmptyPack()]) {
      const parsed = parseSmeCoverageDecisionPack(pack);
      expect(parsed).not.toBeNull();
      expect(parsed?.warnings.filter((warning) => warning.code === canonicalPartialSampleWarning.code)).toEqual([]);
    }
  });

  it("enforces empty-pack completeness and configured-partial narrative consistency", () => {
    const completeEmpty = structuredClone(createEmptyPack()) as Record<string, any>;
    completeEmpty.snapshot.completeness = "Complete";
    expect(parseSmeCoverageDecisionPack(completeEmpty)).toBeNull();

    const nonemptyMarkedEmpty = structuredClone(createDecisionPack()) as Record<string, any>;
    nonemptyMarkedEmpty.snapshot.completeness = "Empty";
    expect(parseSmeCoverageDecisionPack(nonemptyMarkedEmpty)).toBeNull();

    const partialEmpty = structuredClone(createEmptyPack()) as Record<string, any>;
    partialEmpty.snapshot = {
      ...partialEmpty.snapshot,
      completeness: "Partial",
      pageSize: 50,
      maxPagesPerDataset: 1,
      runPreset: "quick-sample",
    };
    expect(parseSmeCoverageDecisionPack(partialEmpty)).toBeNull();

    partialEmpty.overview += " This analysis is a partial sample.";
    partialEmpty.assessment += " This analysis is a partial sample.";
    expect(parseSmeCoverageDecisionPack(partialEmpty)).not.toBeNull();
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
    coveragePercentile: 100,
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
  const adequate = {
    tagName: "node.js",
    pageViews: 200,
    questionCount: 4,
    questionCountBasis: "Complete question enumeration" as const,
    smeCount: 2,
    pageViewsPerSme: 100,
    coveragePercentile: 50,
    coverageTier: "Adequate coverage" as const,
    reason: "Coverage is adequate relative to observed demand.",
    recommendedAction: "Maintain coverage.",
    demandQuality: "Complete" as const,
    smeQuality: "Complete" as const,
  };
  const adequateLow = {
    ...adequate,
    tagName: "css",
    pageViews: 100,
    questionCount: 2,
    pageViewsPerSme: 50,
    coveragePercentile: 25,
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
        code: "coverage.source-notice",
        message: "Source data was normalized.",
      },
    ],
    summary: {
      tagsAnalyzed: 5,
      tagsWithSmes: 4,
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
      coveredActiveSampleSize: 4,
      p75PageViewsPerSme: 150,
      p90PageViewsPerSme: 400,
      percentileSampleSufficient: true,
      ratioFormula: "pageViews / smeCount",
      roundingRule: "Nearest whole page view for display; unrounded for calculation",
    },
    evidence: [immediateGap, critical, light, adequate, adequateLow],
  };
}

function createSmallSamplePack(): SmeCoverageDecisionPack {
  const pack = createDecisionPack({ completeness: "Partial" });
  const immediateGap = pack.evidence[0]!;
  const firstCovered = {
    ...pack.evidence[1]!,
    coveragePercentile: null,
    coverageTier: "Not classified" as const,
    reason: "Relative risk is not classified for a small sample.",
  };
  const secondCovered = {
    ...pack.evidence[2]!,
    coveragePercentile: null,
    coverageTier: "Not classified" as const,
    reason: "Relative risk is not classified for a small sample.",
  };
  return {
    ...pack,
    summary: {
      tagsAnalyzed: 3,
      tagsWithSmes: 2,
      immediateGaps: 1,
      criticalUnderCoverage: 0,
      lightCoverage: 0,
      unknownRows: 0,
    },
    findings: { immediateGaps: [immediateGap], criticalUnderCoverage: [], lightCoverage: [] },
    methodology: {
      ...pack.methodology,
      activeTagMedianPageViews: 400,
      coveredActiveSampleSize: 2,
      p75PageViewsPerSme: 400,
      p90PageViewsPerSme: 400,
      percentileSampleSufficient: false,
    },
    evidence: [immediateGap, firstCovered, secondCovered],
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
