import { describe, expect, it } from "vitest";
import type { ReportWarning } from "../../domain/types";
import {
  completeSmeCoverageSourceStatus,
  normalizedDemandRow,
  normalizedSmeRow,
} from "../../test/fixtures/smeCoverageFixtures";
import { analyzeSmeCoverage } from "./analyzer";
import type {
  NormalizedTagDemandRow,
  NormalizedTagSmeRow,
  SmeCoverageAnalysisResult,
  SmeCoverageEvidenceRow,
} from "./model";

function analyze(
  demandRows: readonly NormalizedTagDemandRow[],
  smeRows: readonly NormalizedTagSmeRow[],
  sourceWarnings: {
    demand?: readonly ReportWarning[];
    smeCounts?: readonly ReportWarning[];
  } = {},
): SmeCoverageAnalysisResult {
  return analyzeSmeCoverage({
    demand: { rows: demandRows, warnings: sourceWarnings.demand ?? [] },
    smeCounts: { rows: smeRows, warnings: sourceWarnings.smeCounts ?? [] },
    sourceStatus: completeSmeCoverageSourceStatus,
  });
}

function evidence(result: SmeCoverageAnalysisResult, tagName: string): SmeCoverageEvidenceRow {
  const row = result.evidence.find((candidate) => candidate.tagName === tagName);
  if (!row) throw new Error(`Missing evidence for ${tagName}`);
  return row;
}

function coveredRows(values: readonly number[]): {
  demand: NormalizedTagDemandRow[];
  smes: NormalizedTagSmeRow[];
} {
  return {
    demand: values.map((value, index) => normalizedDemandRow(`tag-${index + 1}`, value)),
    smes: values.map((_value, index) => normalizedSmeRow(`tag-${index + 1}`, 1)),
  };
}

describe("analyzeSmeCoverage", () => {
  it("needs no sampling settings and omits sampling metadata", () => {
    const result = analyze(
      [normalizedDemandRow("alpha", 100)],
      [normalizedSmeRow("alpha", 1)],
    );

    expect(result).not.toHaveProperty("sampling");
  });

  it("does not expose internal calculation flags on canonical evidence", () => {
    const result = analyze([normalizedDemandRow("alpha", 10)], [normalizedSmeRow("alpha", 1)]);

    expect(Object.keys(evidence(result, "alpha")).sort()).toEqual([
      "coveragePercentile",
      "coverageTier",
      "demandQuality",
      "pageViews",
      "pageViewsPerSme",
      "questionCount",
      "questionCountBasis",
      "reason",
      "recommendedAction",
      "smeCount",
      "smeQuality",
      "tagName",
    ]);
  });

  it("calculates the approved median, nearest-rank thresholds, empirical percentile, and tiers", () => {
    const demand = [
      normalizedDemandRow("alpha", 100),
      normalizedDemandRow("bravo", 200),
      normalizedDemandRow("charlie", 300),
      normalizedDemandRow("delta", 800),
      normalizedDemandRow("echo", 1000),
    ];
    const smes = [
      normalizedSmeRow("alpha", 4),
      normalizedSmeRow("bravo", 4),
      normalizedSmeRow("charlie", 3),
      normalizedSmeRow("delta", 2),
      normalizedSmeRow("echo", 1),
    ];

    const result = analyze(demand, smes);

    expect(result.methodology).toEqual({
      activityQuestionMinimum: 1,
      activityPageViewThresholdExclusive: 25,
      activeTagMedianPageViews: 300,
      coveredActiveSampleSize: 5,
      p75PageViewsPerSme: 400,
      p90PageViewsPerSme: 1000,
      percentileSampleSufficient: true,
      ratioFormula: "pageViews / smeCount",
      roundingRule: "Nearest whole page view for display; unrounded for calculation",
    });
    expect(evidence(result, "echo")).toMatchObject({
      pageViewsPerSme: 1000,
      coveragePercentile: 100,
      coverageTier: "Critical under-coverage",
    });
    expect(evidence(result, "delta").coverageTier).toBe("Light coverage");
  });

  it.each([
    [[10, 20, 90], 20],
    [[10, 20, 90, 100], 55],
  ])("uses the conventional median for active demand values %j", (values, expectedMedian) => {
    const rows = coveredRows(values);

    expect(analyze(rows.demand, rows.smes).methodology.activeTagMedianPageViews).toBe(expectedMedian);
  });

  it.each([
    [[1, 2, 3, 4], 3, 4],
    [[1, 2, 3, 4, 5], 4, 5],
    [[1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 8, 9],
  ])("uses nearest-rank P75 and P90 for sample %j", (values, expectedP75, expectedP90) => {
    const rows = coveredRows(values);

    const methodology = analyze(rows.demand, rows.smes).methodology;

    expect(methodology.p75PageViewsPerSme).toBe(expectedP75);
    expect(methodology.p90PageViewsPerSme).toBe(expectedP90);
  });

  it("assigns tied ratios their shared empirical upper-bound percentile", () => {
    const rows = coveredRows([10, 20, 20, 40]);

    const result = analyze(rows.demand, rows.smes);

    expect(evidence(result, "tag-2").coveragePercentile).toBe(75);
    expect(evidence(result, "tag-3").coveragePercentile).toBe(75);
  });

  it("stores and evaluates ratios at full precision", () => {
    const demand = [
      normalizedDemandRow("third", 100),
      normalizedDemandRow("one", 10),
      normalizedDemandRow("two", 20),
      normalizedDemandRow("four", 40),
    ];
    const smes = [
      normalizedSmeRow("third", 3),
      normalizedSmeRow("one", 1),
      normalizedSmeRow("two", 1),
      normalizedSmeRow("four", 1),
    ];

    const result = analyze(demand, smes);

    expect(evidence(result, "third").pageViewsPerSme).toBe(100 / 3);
    expect(result.methodology.p75PageViewsPerSme).toBe(100 / 3);
  });

  it("keeps numeric zero SME counts distinct from infinity and classifies by activity", () => {
    const result = analyze(
      [normalizedDemandRow("active-zero", 26, 0), normalizedDemandRow("quiet-zero", 25, 0)],
      [normalizedSmeRow("active-zero", 0), normalizedSmeRow("quiet-zero", 0)],
    );

    expect(evidence(result, "active-zero")).toMatchObject({
      pageViewsPerSme: null,
      coveragePercentile: null,
      coverageTier: "Immediate gap",
      reason: "Active tag has no assigned SMEs.",
      recommendedAction: "Assign or confirm at least one SME.",
    });
    expect(evidence(result, "quiet-zero")).toMatchObject({
      pageViewsPerSme: null,
      coverageTier: "Low-demand uncovered",
      reason: "Uncovered tag has no questions and at most 25 page views.",
      recommendedAction: "Review whether the tag needs ownership or consolidation.",
    });
  });

  it("distinguishes unavailable demand, unavailable SME coverage, and both unavailable", () => {
    const result = analyze(
      [
        normalizedDemandRow("bad-demand", null),
        normalizedDemandRow("bad-sme", 50),
        normalizedDemandRow("bad-both", null),
      ],
      [normalizedSmeRow("bad-demand", 2), normalizedSmeRow("bad-both", null)],
    );

    expect(evidence(result, "bad-demand")).toMatchObject({
      coverageTier: "Unknown",
      reason: "Demand metrics are unavailable or invalid.",
      recommendedAction: "Rerun or inspect the v2 tag/question source.",
    });
    expect(evidence(result, "bad-sme")).toMatchObject({
      coverageTier: "Unknown",
      reason: "Assigned-SME coverage is unavailable.",
      recommendedAction: "Rerun or inspect the v3 tag source.",
    });
    expect(evidence(result, "bad-both")).toMatchObject({
      coverageTier: "Unknown",
      reason: "Demand metrics and assigned-SME coverage are unavailable or invalid.",
      recommendedAction: "Inspect both source lanes before drawing a coverage conclusion.",
    });
  });

  it("keeps a covered row at or above P90 adequate when its demand is below the active median", () => {
    const result = analyze(
      [
        normalizedDemandRow("low-demand-high-ratio", 40),
        normalizedDemandRow("high-a", 1000),
        normalizedDemandRow("high-b", 1000),
        normalizedDemandRow("high-c", 1000),
      ],
      [
        normalizedSmeRow("low-demand-high-ratio", 1),
        normalizedSmeRow("high-a", 100),
        normalizedSmeRow("high-b", 50),
        normalizedSmeRow("high-c", 34),
      ],
    );

    const resultRow = evidence(result, "low-demand-high-ratio");
    expect(result.methodology).toMatchObject({ activeTagMedianPageViews: 1000, p90PageViewsPerSme: 40 });
    expect(resultRow).toMatchObject({
      coveragePercentile: 100,
      coverageTier: "Adequate coverage",
      reason: "The tag does not meet an under-coverage rule.",
      recommendedAction: "Maintain current coverage.",
    });
  });

  it("makes an equal P75/P90 boundary critical and leaves light coverage empty", () => {
    const rows = coveredRows([1, 10, 10, 10]);

    const result = analyze(rows.demand, rows.smes);

    expect(result.methodology).toMatchObject({ p75PageViewsPerSme: 10, p90PageViewsPerSme: 10 });
    expect(evidence(result, "tag-2").coverageTier).toBe("Critical under-coverage");
    expect(result.findings.lightCoverage).toEqual([]);
  });

  it("suppresses every covered conclusion when only three eligible covered active tags exist", () => {
    const rows = coveredRows([10, 20, 30]);

    const result = analyze(rows.demand, rows.smes);

    expect(result.methodology).toMatchObject({ coveredActiveSampleSize: 3, percentileSampleSufficient: false });
    expect(result.evidence.map((row) => row.coverageTier)).toEqual([
      "Not classified",
      "Not classified",
      "Not classified",
    ]);
    expect(result.evidence.every((row) => row.coveragePercentile === null)).toBe(true);
    expect(result.evidence.some((row) => row.coverageTier === "Adequate coverage")).toBe(false);
  });

  it("enables percentile classification at four eligible covered active tags", () => {
    const rows = coveredRows([10, 20, 30, 40]);

    const result = analyze(rows.demand, rows.smes);

    expect(result.methodology).toMatchObject({ coveredActiveSampleSize: 4, percentileSampleSufficient: true });
    expect(evidence(result, "tag-4").coverageTier).toBe("Critical under-coverage");
    expect(evidence(result, "tag-3").coverageTier).toBe("Light coverage");
    expect(evidence(result, "tag-2").coverageTier).toBe("Adequate coverage");
  });

  it("sorts the sufficient-sample canonical evidence by tier priority", () => {
    const rows = coveredRows([10, 20, 30, 40]);
    const result = analyze(
      [
        ...rows.demand,
        normalizedDemandRow("immediate", 500),
        normalizedDemandRow("unknown", null),
        normalizedDemandRow("low-demand", 25, 0),
      ],
      [
        ...rows.smes,
        normalizedSmeRow("immediate", 0),
        normalizedSmeRow("unknown", 1),
        normalizedSmeRow("low-demand", 0),
      ],
    );

    expect(result.evidence.map((row) => row.coverageTier)).toEqual([
      "Immediate gap",
      "Critical under-coverage",
      "Light coverage",
      "Unknown",
      "Low-demand uncovered",
      "Adequate coverage",
      "Adequate coverage",
    ]);
  });

  it("places not-classified rows between unknown and low-demand rows", () => {
    const result = analyze(
      [
        normalizedDemandRow("immediate", 50),
        normalizedDemandRow("unknown", null),
        normalizedDemandRow("covered", 30),
        normalizedDemandRow("low-demand", 25, 0),
      ],
      [
        normalizedSmeRow("immediate", 0),
        normalizedSmeRow("unknown", 1),
        normalizedSmeRow("covered", 1),
        normalizedSmeRow("low-demand", 0),
      ],
    );

    expect(result.evidence.map((row) => row.coverageTier)).toEqual([
      "Immediate gap",
      "Unknown",
      "Not classified",
      "Low-demand uncovered",
    ]);
  });

  it.each([
    {
      name: "critical",
      tier: "Critical under-coverage" as const,
      demand: [
        ...coveredRows([10, 20, 30, 40, 50, 60, 70, 80]).demand,
        normalizedDemandRow("critical-ratio-100", 900),
        normalizedDemandRow("critical-ratio-90", 990),
      ],
      smes: [
        ...coveredRows([10, 20, 30, 40, 50, 60, 70, 80]).smes,
        normalizedSmeRow("critical-ratio-100", 9),
        normalizedSmeRow("critical-ratio-90", 11),
      ],
      expected: ["critical-ratio-100", "critical-ratio-90"],
    },
    {
      name: "light",
      tier: "Light coverage" as const,
      demand: [
        ...coveredRows([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 18, 19, 20]).demand,
        normalizedDemandRow("light-ratio-17", 850),
        normalizedDemandRow("light-ratio-16", 960),
        normalizedDemandRow("light-ratio-15", 900),
      ],
      smes: [
        ...coveredRows([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 18, 19, 20]).smes,
        normalizedSmeRow("light-ratio-17", 50),
        normalizedSmeRow("light-ratio-16", 60),
        normalizedSmeRow("light-ratio-15", 60),
      ],
      expected: ["light-ratio-17", "light-ratio-16", "light-ratio-15"],
    },
    {
      name: "not-classified",
      tier: "Not classified" as const,
      demand: [
        normalizedDemandRow("not-classified-ratio-100", 100),
        normalizedDemandRow("not-classified-ratio-50", 200),
        normalizedDemandRow("not-classified-ratio-25", 300),
      ],
      smes: [
        normalizedSmeRow("not-classified-ratio-100", 1),
        normalizedSmeRow("not-classified-ratio-50", 4),
        normalizedSmeRow("not-classified-ratio-25", 12),
      ],
      expected: [
        "not-classified-ratio-100",
        "not-classified-ratio-50",
        "not-classified-ratio-25",
      ],
    },
    {
      name: "immediate",
      tier: "Immediate gap" as const,
      demand: [normalizedDemandRow("immediate-page-50", 50), normalizedDemandRow("immediate-page-40", 40, 99)],
      smes: [normalizedSmeRow("immediate-page-50", 0), normalizedSmeRow("immediate-page-40", 0)],
      expected: ["immediate-page-50", "immediate-page-40"],
    },
    {
      name: "low-demand",
      tier: "Low-demand uncovered" as const,
      demand: [normalizedDemandRow("low-demand-page-20", 20, 0), normalizedDemandRow("low-demand-page-25", 25, 0)],
      smes: [normalizedSmeRow("low-demand-page-20", 0), normalizedSmeRow("low-demand-page-25", 0)],
      expected: ["low-demand-page-25", "low-demand-page-20"],
    },
    {
      name: "adequate",
      tier: "Adequate coverage" as const,
      demand: [
        normalizedDemandRow("adequate-ratio-high", 10),
        normalizedDemandRow("adequate-page-high", 20),
        normalizedDemandRow("light", 30),
        normalizedDemandRow("critical", 40),
      ],
      smes: [
        normalizedSmeRow("adequate-ratio-high", 1),
        normalizedSmeRow("adequate-page-high", 4),
        normalizedSmeRow("light", 1),
        normalizedSmeRow("critical", 1),
      ],
      expected: ["adequate-page-high", "adequate-ratio-high"],
    },
  ])("uses the $name tier's canonical ordering", ({ tier, demand, smes, expected }) => {
    const result = analyze(demand, smes);

    expect(result.evidence.filter((row) => row.coverageTier === tier).map((row) => row.tagName)).toEqual(expected);
  });

  it("uses page views, question count, and code-unit tag name to break equal covered ratios", () => {
    const result = analyze(
      [
        normalizedDemandRow("low-1", 100),
        normalizedDemandRow("low-2", 200),
        normalizedDemandRow("low-3", 300),
        normalizedDemandRow("ratio-100-high", 1000),
        normalizedDemandRow("A-ratio-100-mid-q1", 800, 1),
        normalizedDemandRow("B-ratio-100-mid-q2", 800, 2),
        normalizedDemandRow("C-ratio-100-mid-q2", 800, 2),
      ],
      [
        normalizedSmeRow("low-1", 1),
        normalizedSmeRow("low-2", 2),
        normalizedSmeRow("low-3", 3),
        normalizedSmeRow("ratio-100-high", 10),
        normalizedSmeRow("A-ratio-100-mid-q1", 8),
        normalizedSmeRow("B-ratio-100-mid-q2", 8),
        normalizedSmeRow("C-ratio-100-mid-q2", 8),
      ],
    );

    expect(result.findings.criticalUnderCoverage.map((row) => row.tagName)).toEqual([
      "ratio-100-high",
      "B-ratio-100-mid-q2",
      "C-ratio-100-mid-q2",
      "A-ratio-100-mid-q1",
    ]);
  });

  it("sorts null numeric values after valid values and finishes ties by code-unit tag name", () => {
    const result = analyze(
      [
        normalizedDemandRow("null-page", null),
        normalizedDemandRow("A-null-question", null, null, { pageViews: 10 }),
        normalizedDemandRow("B-null-question", null, null, { pageViews: 10 }),
        normalizedDemandRow("valid-question", null, 2, { pageViews: 10 }),
      ],
      [
        normalizedSmeRow("null-page", 1),
        normalizedSmeRow("A-null-question", 1),
        normalizedSmeRow("B-null-question", 1),
        normalizedSmeRow("valid-question", 1),
      ],
    );

    expect(result.evidence.map((row) => row.tagName)).toEqual([
      "valid-question",
      "A-null-question",
      "B-null-question",
      "null-page",
    ]);
  });

  it("joins the key union, chooses the deterministic display name, summarizes canonical rows, and preserves finding references", () => {
    const demandRows = [
      normalizedDemandRow("zeta", 40, 1, { key: "shared", tagNames: ["zeta", "Zeta"] }),
      normalizedDemandRow("demand-only", 60),
      normalizedDemandRow("partial", 20, 1, {
        demandQuality: "Partial sample",
        questionCountBasis: "Partial question sample",
      }),
    ];
    const smeRows = [
      normalizedSmeRow("ZETA", 0, { key: "shared", tagNames: ["ZETA", "zeta"] }),
      normalizedSmeRow("sme-only", 2),
      normalizedSmeRow("partial", 2),
    ];

    const result = analyze(demandRows, smeRows);
    const zeta = evidence(result, "ZETA");

    expect(result.sourceStatus).toBe(completeSmeCoverageSourceStatus);
    expect(result.summary).toEqual({
      tagsAnalyzed: 4,
      tagsWithSmes: 2,
      immediateGaps: 1,
      criticalUnderCoverage: 0,
      lightCoverage: 0,
      unknownRows: 2,
    });
    expect(result.findings.immediateGaps[0]).toBe(zeta);
    expect(result.findings.criticalUnderCoverage).toEqual([]);
    expect(result.findings.lightCoverage).toEqual([]);
    expect(evidence(result, "sme-only")).toMatchObject({
      demandQuality: "Invalid",
      questionCountBasis: "Unavailable",
      smeCount: 2,
    });
  });

  it("emits analyzer warnings in stable order, names up to five sorted tags, and excludes source warnings", () => {
    const sourceWarning: ReportWarning = {
      utilityId: "sme-coverage-analyzer",
      code: "source.warning",
      message: "Source warning",
    };
    const result = analyze(
      [normalizedDemandRow("z-invalid", null), normalizedDemandRow("a-invalid", null), normalizedDemandRow("unknown", 40)],
      [normalizedSmeRow("z-invalid", 1), normalizedSmeRow("a-invalid", 1)],
      { demand: [sourceWarning], smeCounts: [sourceWarning] },
    );

    expect(result.warnings).toEqual([
      {
        utilityId: "sme-coverage-analyzer",
        code: "sme-coverage.invalid-demand",
        message: "Demand metrics are unavailable or invalid for 2 tags: `a-invalid`, `z-invalid`.",
      },
      {
        utilityId: "sme-coverage-analyzer",
        code: "sme-coverage.unknown-sme-coverage",
        message: "Assigned-SME coverage is unavailable for 1 tag: `unknown`.",
      },
      {
        utilityId: "sme-coverage-analyzer",
        code: "sme-coverage.insufficient-covered-sample",
        message:
          "Relative covered-tag classification is unavailable because only 0 eligible covered active tags were available; at least 4 are required.",
      },
    ]);
  });

  it("uses count-only analysis warnings for six or more affected rows", () => {
    const invalidDemand = ["one", "two", "three", "four", "five", "six"].map((tag) =>
      normalizedDemandRow(`invalid-${tag}`, null),
    );
    const invalidDemandSmes = invalidDemand.map((row) => normalizedSmeRow(row.tagNames[0], 1));
    const unknownSme = ["one", "two", "three", "four", "five", "six"].map((tag) =>
      normalizedDemandRow(`unknown-${tag}`, 30),
    );

    const result = analyze([...invalidDemand, ...unknownSme], invalidDemandSmes);

    expect(result.warnings.slice(0, 2)).toEqual([
      {
        utilityId: "sme-coverage-analyzer",
        code: "sme-coverage.invalid-demand",
        message: "Demand metrics are unavailable or invalid for 6 tags.",
      },
      {
        utilityId: "sme-coverage-analyzer",
        code: "sme-coverage.unknown-sme-coverage",
        message: "Assigned-SME coverage is unavailable for 6 tags.",
      },
    ]);
  });

  it("lists all five affected tag names in sorted code-unit order", () => {
    const invalidDemand = ["echo", "delta", "charlie", "bravo", "alpha"].map((tag) =>
      normalizedDemandRow(tag, null),
    );

    const result = analyze(
      invalidDemand,
      invalidDemand.map((row) => normalizedSmeRow(row.tagNames[0], 1)),
    );

    expect(result.warnings[0]).toEqual({
      utilityId: "sme-coverage-analyzer",
      code: "sme-coverage.invalid-demand",
      message:
        "Demand metrics are unavailable or invalid for 5 tags: `alpha`, `bravo`, `charlie`, `delta`, `echo`.",
    });
  });

  it("does not mutate normalized source arrays while sorting canonical evidence", () => {
    const demandRows = [normalizedDemandRow("alpha", 10), normalizedDemandRow("bravo", 100)];
    const smeRows = [normalizedSmeRow("alpha", 1), normalizedSmeRow("bravo", 0)];

    analyze(demandRows, smeRows);

    expect(demandRows.map((row) => row.tagNames[0])).toEqual(["alpha", "bravo"]);
    expect(smeRows.map((row) => row.tagNames[0])).toEqual(["alpha", "bravo"]);
  });
});
