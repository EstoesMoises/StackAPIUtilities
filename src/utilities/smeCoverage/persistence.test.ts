import { describe, expect, it } from "vitest";
import type { SmeCoverageDecisionPack } from "./model";
import { parseSmeCoverageDecisionPack } from "./persistence";

const legacyCollectionLabel = "Legacy run — completeness not verified under current collection rules" as const;
const canonicalLegacyCollectionWarning = {
  utilityId: "sme-coverage-analyzer",
  code: "collection.legacy-unverified",
  message: `${legacyCollectionLabel}.`,
} as const;

describe("parseSmeCoverageDecisionPack", () => {
  it("migrates a legacy decision pack without losing its historical warnings", () => {
    const legacy = structuredClone(createDecisionPack()) as Record<string, any>;
    delete legacy.snapshot.collectionLabel;
    Object.assign(legacy.snapshot, {
      pageSize: 50,
      maxPagesPerDataset: 1,
      runPreset: "quick-sample",
    });
    const historicalCapWarning = {
      utilityId: "sme-coverage-analyzer",
      code: "sme-coverage.questions-page-cap",
      message: "Questions reached the historical collection page cap.",
    };
    legacy.warnings.push(historicalCapWarning, canonicalLegacyCollectionWarning, canonicalLegacyCollectionWarning);

    const parsed = parseSmeCoverageDecisionPack(legacy);

    expect(parsed?.snapshot.collectionLabel).toBe(legacyCollectionLabel);
    expect(parsed?.warnings).toEqual([
      legacy.warnings[0],
      historicalCapWarning,
      canonicalLegacyCollectionWarning,
    ]);
    expect(parsed?.snapshot).not.toHaveProperty("pageSize");
    expect(parsed?.snapshot).not.toHaveProperty("maxPagesPerDataset");
    expect(parsed?.snapshot).not.toHaveProperty("runPreset");
    expect(parseSmeCoverageDecisionPack(parsed)).toEqual(parsed);
  });

  it("round-trips a current exhaustive decision pack without a legacy warning", () => {
    const pack = createDecisionPack();

    const parsed = parseSmeCoverageDecisionPack(pack);

    expect(parsed).toEqual(pack);
    expect(parsed?.snapshot.collectionLabel).toBe("All available data collected");
    expect(parsed?.warnings).not.toContainEqual(canonicalLegacyCollectionWarning);
  });

  it.each(["pageSize", "maxPagesPerDataset"])(
    "rejects a legacy decision pack missing historical %s evidence",
    (field) => {
      const legacy = structuredClone(createDecisionPack()) as Record<string, any>;
      delete legacy.snapshot.collectionLabel;
      Object.assign(legacy.snapshot, {
        pageSize: 100,
        maxPagesPerDataset: 5,
        runPreset: "standard",
      });
      delete legacy.snapshot[field];

      expect(parseSmeCoverageDecisionPack(legacy)).toBeNull();
    },
  );

  it("migrates a legacy custom-volume decision pack without a preset id", () => {
    const legacy = structuredClone(createDecisionPack()) as Record<string, any>;
    delete legacy.snapshot.collectionLabel;
    Object.assign(legacy.snapshot, { pageSize: 75, maxPagesPerDataset: 7 });

    const parsed = parseSmeCoverageDecisionPack(legacy);

    expect(parsed?.snapshot.collectionLabel).toBe(legacyCollectionLabel);
    expect(parsed?.warnings).toContainEqual(canonicalLegacyCollectionWarning);
  });

  it("rejects a current exhaustive pack carrying the canonical legacy warning", () => {
    const current = structuredClone(createDecisionPack()) as Record<string, any>;
    current.warnings.push(canonicalLegacyCollectionWarning);

    expect(parseSmeCoverageDecisionPack(current)).toBeNull();
  });

  it.each([
    ["zero page size", "pageSize", 0],
    ["fractional page limit", "maxPagesPerDataset", 1.5],
    ["unknown preset", "runPreset", "unbounded"],
  ])("rejects invalid legacy collection evidence: %s", (_label, field, invalidValue) => {
    const legacy = structuredClone(createDecisionPack()) as Record<string, any>;
    delete legacy.snapshot.collectionLabel;
    Object.assign(legacy.snapshot, {
      pageSize: 100,
      maxPagesPerDataset: 5,
      runPreset: "standard",
      [field]: invalidValue,
    });

    expect(parseSmeCoverageDecisionPack(legacy)).toBeNull();
  });

  it.each([
    ["complete", createDecisionPack()],
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
    ["unknown collection label", (pack: Record<string, any>) => { pack.snapshot.collectionLabel = "Mostly collected"; }],
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

  it("does not add legacy warnings to current Complete or Empty packs", () => {
    for (const pack of [createDecisionPack(), createEmptyPack()]) {
      const parsed = parseSmeCoverageDecisionPack(pack);
      expect(parsed).not.toBeNull();
      expect(parsed?.warnings.filter((warning) => warning.code === canonicalLegacyCollectionWarning.code)).toEqual([]);
    }
  });

  it("enforces empty-pack completeness consistency", () => {
    const completeEmpty = structuredClone(createEmptyPack()) as Record<string, any>;
    completeEmpty.snapshot.completeness = "Complete";
    expect(parseSmeCoverageDecisionPack(completeEmpty)).toBeNull();

    const nonemptyMarkedEmpty = structuredClone(createDecisionPack()) as Record<string, any>;
    nonemptyMarkedEmpty.snapshot.completeness = "Empty";
    expect(parseSmeCoverageDecisionPack(nonemptyMarkedEmpty)).toBeNull();

    const completeMarkedPartial = structuredClone(createDecisionPack()) as Record<string, any>;
    completeMarkedPartial.snapshot.completeness = "Partial";
    expect(parseSmeCoverageDecisionPack(completeMarkedPartial)).toBeNull();

    const emptyMarkedPartial = structuredClone(createEmptyPack()) as Record<string, any>;
    emptyMarkedPartial.snapshot.completeness = "Partial";
    expect(parseSmeCoverageDecisionPack(emptyMarkedPartial)).toBeNull();

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
      collectionLabel: "All available data collected",
      completeness: options.completeness ?? "Complete",
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
