import { describe, expect, it } from "vitest";
import type { SmeCoverageDecisionPack } from "./model";
import { buildSmeCoverageEvidenceCsv, buildSmeCoverageMarkdown } from "./exports";

const csvHeader =
  "tag_name,page_views,question_count,question_count_basis,sme_count,page_views_per_sme,coverage_percentile,coverage_tier,reason,recommended_action,demand_quality,sme_quality,collection_status,analysis_quality,evidence_notes";

describe("SME coverage exports", () => {
  it("serializes canonical evidence rows in fixed CSV columns without rounding ratios", () => {
    const csv = buildSmeCoverageEvidenceCsv(partialPack());

    expect(csv).toBe(
      [
        csvHeader,
        'first-tag,1234.567,9,Partial question sample,1,1234.567,80,Critical under-coverage,"Demand, sample-based","Assign ""one"" SME",Partial sample,Complete,All available data collected,Partial,questions.partial: This analysis is a partial sample.',
        "second-tag,,,Unavailable,,,,Unknown,Unavailable,Validate source data,Invalid,Unknown,All available data collected,Partial,questions.partial: This analysis is a partial sample.",
      ].join("\n"),
    );
  });

  it("keeps the fixed CSV header when the decision pack has no evidence", () => {
    expect(buildSmeCoverageEvidenceCsv(emptyPack())).toBe(csvHeader);
  });

  it("renders the fixed Markdown sections from decision-pack content with display rounding", () => {
    const markdown = buildSmeCoverageMarkdown(partialPack());
    const sections = [
      "# SME Coverage Decision Pack",
      "## Snapshot",
      "## Evidence notes",
      "## Executive summary",
      "## Copy-ready assessment",
      "## Immediate no-SME risks",
      "## Highest-demand critical gaps",
      "## Light SME coverage",
      "## Methodology",
    ];

    expect(sections.map((section) => markdown.indexOf(section))).toEqual([...sections.keys()].map((index) => expect.any(Number)));
    for (let index = 1; index < sections.length; index += 1) {
      expect(markdown.indexOf(sections[index]!)).toBeGreaterThan(markdown.indexOf(sections[index - 1]!));
    }
    expect(markdown).toContain("This analysis is a partial sample.");
    expect(markdown).toContain("- Collection: All available data collected");
    expect(markdown).toContain("- Analysis quality: Partial");
    expect(markdown).not.toContain("Page size");
    expect(markdown).not.toContain("Maximum pages");
    expect(markdown).not.toContain("Run preset");
    expect(markdown).toContain("- Tags analyzed: 2");
    expect(markdown).toContain("Question-count basis: Partial question sample");
    expect(markdown).toContain("Page views per SME: 1,235");
    expect(markdown).toContain("Coverage percentile: 80%");
    expect(markdown).not.toContain("Coverage percentile: 8,000%");
    expect(markdown).not.toContain("Page views per SME: 1234.567");
    expect(markdown).toContain("No immediate no-SME risks are listed in this decision pack.");
    expect(markdown).toContain("No light SME coverage risks are listed in this decision pack.");
  });

  it("renders tier-specific empty states without inventing a coverage conclusion", () => {
    const markdown = buildSmeCoverageMarkdown(emptyPack());

    expect(markdown).toContain("No immediate no-SME risks are listed in this decision pack.");
    expect(markdown).toContain("No highest-demand critical gaps are listed in this decision pack.");
    expect(markdown).toContain("No light SME coverage risks are listed in this decision pack.");
  });
});

function partialPack(): SmeCoverageDecisionPack {
  return {
    snapshot: {
      instanceHost: "example.stackenterprise.co",
      generatedAt: "2026-07-30T12:00:00.000Z",
      scopeLabel: "All-time demand · Current SME coverage",
      collectionLabel: "All available data collected",
      completeness: "Partial",
    },
    warnings: [
      {
        utilityId: "sme-coverage-analyzer",
        code: "questions.partial",
        message: "This analysis is a partial sample.",
      },
    ],
    summary: {
      tagsAnalyzed: 2,
      tagsWithSmes: 1,
      immediateGaps: 0,
      criticalUnderCoverage: 1,
      lightCoverage: 0,
      unknownRows: 1,
    },
    overview: "This analysis is a partial sample. One critical gap was identified.",
    assessment: "Prioritize `first-tag` with collected-sample evidence.",
    findings: {
      immediateGaps: [],
      criticalUnderCoverage: [
        {
          tagName: "first-tag",
          pageViews: 1234.567,
          questionCount: 9,
          questionCountBasis: "Partial question sample",
          smeCount: 1,
          pageViewsPerSme: 1234.567,
          coveragePercentile: 80,
          coverageTier: "Critical under-coverage",
          reason: "Demand, sample-based",
          recommendedAction: 'Assign "one" SME',
          demandQuality: "Partial sample",
          smeQuality: "Complete",
        },
      ],
      lightCoverage: [],
    },
    methodology: {
      activityQuestionMinimum: 1,
      activityPageViewThresholdExclusive: 25,
      activeTagMedianPageViews: 100,
      coveredActiveSampleSize: 1,
      p75PageViewsPerSme: 1234.567,
      p90PageViewsPerSme: 1234.567,
      percentileSampleSufficient: false,
      ratioFormula: "pageViews / smeCount",
      roundingRule: "Nearest whole page view for display; unrounded for calculation",
    },
    evidence: [
      {
        tagName: "first-tag",
        pageViews: 1234.567,
        questionCount: 9,
        questionCountBasis: "Partial question sample",
        smeCount: 1,
        pageViewsPerSme: 1234.567,
        coveragePercentile: 80,
        coverageTier: "Critical under-coverage",
        reason: "Demand, sample-based",
        recommendedAction: 'Assign "one" SME',
        demandQuality: "Partial sample",
        smeQuality: "Complete",
      },
      {
        tagName: "second-tag",
        pageViews: null,
        questionCount: null,
        questionCountBasis: "Unavailable",
        smeCount: null,
        pageViewsPerSme: null,
        coveragePercentile: null,
        coverageTier: "Unknown",
        reason: "Unavailable",
        recommendedAction: "Validate source data",
        demandQuality: "Invalid",
        smeQuality: "Unknown",
      },
    ],
  };
}

function emptyPack(): SmeCoverageDecisionPack {
  const pack = partialPack();
  return {
    ...pack,
    snapshot: { ...pack.snapshot, completeness: "Empty" },
    warnings: [],
    summary: {
      tagsAnalyzed: 0,
      tagsWithSmes: 0,
      immediateGaps: 0,
      criticalUnderCoverage: 0,
      lightCoverage: 0,
      unknownRows: 0,
    },
    overview: "No tags were available for SME coverage analysis.",
    assessment: "No evidence rows were available, so no coverage conclusion was produced.",
    findings: { immediateGaps: [], criticalUnderCoverage: [], lightCoverage: [] },
    evidence: [],
  };
}
