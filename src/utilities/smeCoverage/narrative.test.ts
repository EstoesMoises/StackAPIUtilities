import { describe, expect, it } from "vitest";
import type { ApiVolumeSettingsValue } from "../../domain/types";
import {
  completeSmeCoverageSourceStatus,
  narrativeDemandRows,
  narrativeSmeRows,
  normalizedDemandRow,
  normalizedSmeRow,
} from "../../test/fixtures/smeCoverageFixtures";
import { analyzeSmeCoverage } from "./analyzer";
import type {
  SmeCoverageAnalysisResult,
  SmeCoverageEvidenceRow,
  SmeCoverageSourceStatus,
} from "./model";
import { buildSmeCoverageNarrative, formatDisplayedRatio } from "./narrative";

function analyze(
  demandRows = narrativeDemandRows,
  smeRows = narrativeSmeRows,
  sourceStatus: SmeCoverageSourceStatus = completeSmeCoverageSourceStatus,
  settings?: ApiVolumeSettingsValue,
): SmeCoverageAnalysisResult {
  return analyzeSmeCoverage({
    demand: { rows: demandRows, warnings: [] },
    smeCounts: { rows: smeRows, warnings: [] },
    sourceStatus,
    settings,
  });
}

interface RenderedRatioPair {
  tagName: string;
  displayedRatio: string;
}

function renderedRatioPairs(assessment: string): RenderedRatioPair[] {
  return [...assessment.matchAll(/`([^`]+)` \(([\d,]+) (?:collected-sample )?page views per SME\)/g)].map(
    (match) => ({ tagName: match[1], displayedRatio: match[2] }),
  );
}

function matchRenderedPairsToCanonicalRows(
  pairs: readonly RenderedRatioPair[],
  rows: readonly SmeCoverageEvidenceRow[],
): readonly SmeCoverageEvidenceRow[] | null {
  const matched: SmeCoverageEvidenceRow[] = [];
  for (const pair of pairs) {
    const row = rows.find(
      (candidate) =>
        candidate.tagName === pair.tagName &&
        candidate.pageViewsPerSme !== null &&
        formatDisplayedRatio(candidate.pageViewsPerSme) === pair.displayedRatio,
    );
    if (!row) return null;
    matched.push(row);
  }
  return matched;
}

function capped(source: keyof SmeCoverageSourceStatus): SmeCoverageSourceStatus {
  return {
    ...completeSmeCoverageSourceStatus,
    [source]: { pageCount: 20, reachedMaxPages: true, hasMore: true },
  };
}

describe("buildSmeCoverageNarrative", () => {
  it("traces every named tag and displayed ratio to the selected canonical findings", () => {
    const analysis = analyze();

    const narrative = buildSmeCoverageNarrative(analysis);

    expect(narrative.assessment).toContain("`echo`");
    expect(narrative.assessment).toContain("1,000 page views per SME");
    expect(narrative.assessment).not.toMatch(/burnout|answer quality|slow response|caused/i);

    const selected = [
      ...analysis.findings.criticalUnderCoverage.slice(0, 10),
      ...analysis.findings.immediateGaps.slice(0, 10),
      ...analysis.findings.lightCoverage.slice(0, 10),
    ];
    const namedTags = [...narrative.assessment.matchAll(/`([^`]+)`/g)].map((match) => match[1]);
    const pairs = renderedRatioPairs(narrative.assessment);
    const matchedRows = matchRenderedPairsToCanonicalRows(pairs, selected);

    expect(namedTags.every((tagName) => selected.some((row) => row.tagName === tagName))).toBe(true);
    expect(matchedRows).not.toBeNull();
    expect(matchedRows).toHaveLength(pairs.length);
    for (const row of matchedRows ?? []) expect(analysis.evidence).toContain(row);

    const swappedPairs = pairs.map((pair, index) => ({
      ...pair,
      displayedRatio: pairs[(index + 1) % pairs.length].displayedRatio,
    }));
    expect(matchRenderedPairsToCanonicalRows(swappedPairs, selected)).toBeNull();
  });

  it.each([
    ["Quick sample", { pageSize: 50, maxPagesPerDataset: 1, runPreset: "quick-sample" }],
    ["Standard", { pageSize: 100, maxPagesPerDataset: 5, runPreset: "standard" }],
    ["custom", { pageSize: 75, maxPagesPerDataset: 7 }],
  ] as const)("labels a non-capped %s run as a partial sample", (_label, settings) => {
    const narrative = buildSmeCoverageNarrative(
      analyze(narrativeDemandRows, narrativeSmeRows, completeSmeCoverageSourceStatus, settings),
    );

    expect(narrative.overview).toContain("partial sample");
    expect(narrative.assessment).toContain("partial sample");
  });

  it("limits each finding paragraph to the first ten canonical rows", () => {
    const analysis = analyze();
    const critical = analysis.findings.criticalUnderCoverage[0];
    if (!critical) throw new Error("Fixture must contain a critical finding");
    const criticalRows = Array.from({ length: 11 }, (_value, index) => ({
      ...critical,
      tagName: `critical-${index + 1}`,
    }));
    const expanded: SmeCoverageAnalysisResult = {
      ...analysis,
      evidence: criticalRows,
      findings: { immediateGaps: [], criticalUnderCoverage: criticalRows, lightCoverage: [] },
    };

    const narrative = buildSmeCoverageNarrative(expanded);
    const paragraphs = narrative.assessment.split("\n\n");

    expect(paragraphs).toHaveLength(1);
    expect([...paragraphs[0].matchAll(/`([^`]+)`/g)]).toHaveLength(10);
    expect(paragraphs[0]).not.toContain("`critical-11`");
  });

  it("labels a capped question run as a partial sample with collected-sample ratios", () => {
    const analysis = analyze(
      narrativeDemandRows.map((row) => ({ ...row, demandQuality: "Partial sample" as const })),
      narrativeSmeRows,
      capped("questions"),
    );

    const narrative = buildSmeCoverageNarrative(analysis);

    expect(narrative.overview).toMatch(/partial sample/i);
    expect(narrative.assessment).toMatch(/collected-sample page views/i);
    expect(narrative.assessment).not.toMatch(/complete all-time total/i);
  });

  it.each(["tags", "tagSmeCounts"] as const)(
    "labels a capped %s source as a collected source sample without relabeling page views",
    (source) => {
      const narrative = buildSmeCoverageNarrative(analyze(narrativeDemandRows, narrativeSmeRows, capped(source)));

      expect(narrative.overview).toContain("partial sample");
      expect(narrative.assessment).toContain("partial sample");
      expect(narrative.overview).toMatch(/partial collected-source sample/i);
      expect(narrative.assessment).toMatch(/partial collected-source sample/i);
      expect(narrative.overview).toMatch(/complete all-time question enumeration and page views/i);
      expect(narrative.assessment).toMatch(/complete all-time question enumeration and page views/i);
      expect(narrative.assessment).not.toMatch(/collected-sample page views/i);
    },
  );

  it("retains both demand and source-sample caveats when multiple sources are capped", () => {
    const sourceStatus = {
      ...capped("questions"),
      tags: { pageCount: 20, reachedMaxPages: true, hasMore: true },
    };
    const analysis = analyze(
      narrativeDemandRows.map((row) => ({ ...row, demandQuality: "Partial sample" as const })),
      narrativeSmeRows,
      sourceStatus,
    );

    const narrative = buildSmeCoverageNarrative(analysis);

    expect(narrative.overview).toMatch(/partial sample/i);
    expect(narrative.overview).toMatch(/partial collected-source sample/i);
    expect(narrative.assessment).toMatch(/collected-sample page views/i);
    expect(narrative.assessment).toMatch(/partial collected-source sample/i);
  });

  it("keeps an immediate gap and always states the three-row classification limitation", () => {
    const analysis = analyze(
      [
        normalizedDemandRow("covered-1", 10),
        normalizedDemandRow("covered-2", 20),
        normalizedDemandRow("covered-3", 30),
        normalizedDemandRow("immediate", 100),
      ],
      [
        normalizedSmeRow("covered-1", 1),
        normalizedSmeRow("covered-2", 1),
        normalizedSmeRow("covered-3", 1),
        normalizedSmeRow("immediate", 0),
      ],
    );

    const narrative = buildSmeCoverageNarrative(analysis);

    expect(narrative.assessment).toContain(
      "Relative covered-tag risk could not be classified because only 3 eligible covered active tags were available; review the raw ratios.",
    );
    expect(narrative.overview).not.toMatch(/no priority coverage gaps/i);
    expect(narrative.overview).toContain("1 active tag has immediate no-SME gaps.");
    expect(narrative.assessment.split("\n\n")).toHaveLength(1);
  });

  it("omits empty finding tiers instead of substituting lower-priority evidence", () => {
    const analysis = analyze();
    const noImmediate: SmeCoverageAnalysisResult = {
      ...analysis,
      findings: { ...analysis.findings, immediateGaps: [] },
    };

    const narrative = buildSmeCoverageNarrative(noImmediate);

    expect(narrative.assessment).not.toContain("`timeout`");
    expect(narrative.assessment.split("\n\n")).toHaveLength(2);
  });

  it("states that no priority gaps exist only for a sufficient no-risk sample", () => {
    const analysis = analyze(
      [
        normalizedDemandRow("low-ratio-high-demand-1", 1000),
        normalizedDemandRow("low-ratio-high-demand-2", 2000),
        normalizedDemandRow("high-ratio-low-demand-1", 10),
        normalizedDemandRow("high-ratio-low-demand-2", 20),
      ],
      [
        normalizedSmeRow("low-ratio-high-demand-1", 1000),
        normalizedSmeRow("low-ratio-high-demand-2", 1000),
        normalizedSmeRow("high-ratio-low-demand-1", 1),
        normalizedSmeRow("high-ratio-low-demand-2", 1),
      ],
    );

    const narrative = buildSmeCoverageNarrative(analysis);

    expect(analysis.methodology.percentileSampleSufficient).toBe(true);
    expect(narrative.overview).toMatch(/no priority coverage gaps/i);
    expect(narrative.assessment).toMatch(/no priority coverage gaps/i);
  });

  it("retains the no-priority-gap conclusion when a sufficient run is source-capped", () => {
    const analysis = analyze(
      [
        normalizedDemandRow("low-ratio-high-demand-1", 1000),
        normalizedDemandRow("low-ratio-high-demand-2", 2000),
        normalizedDemandRow("high-ratio-low-demand-1", 10),
        normalizedDemandRow("high-ratio-low-demand-2", 20),
      ],
      [
        normalizedSmeRow("low-ratio-high-demand-1", 1000),
        normalizedSmeRow("low-ratio-high-demand-2", 1000),
        normalizedSmeRow("high-ratio-low-demand-1", 1),
        normalizedSmeRow("high-ratio-low-demand-2", 1),
      ],
      capped("tags"),
    );

    const narrative = buildSmeCoverageNarrative(analysis);

    expect(narrative.assessment).toMatch(/no priority coverage gaps/i);
    expect(narrative.assessment).toMatch(/partial collected-source sample/i);
  });

  it("keeps unknown-only rows out of claims and reports only the sample limitation", () => {
    const analysis = analyze(
      [normalizedDemandRow("unknown-tag", null)],
      [normalizedSmeRow("unknown-tag", null)],
    );

    const narrative = buildSmeCoverageNarrative(analysis);

    expect(narrative.overview).not.toContain("unknown-tag");
    expect(narrative.assessment).not.toContain("unknown-tag");
    expect(narrative.assessment).not.toMatch(/no priority coverage gaps/i);
    expect(narrative.assessment).toContain("only 0 eligible covered active tags were available");
  });

  it("returns a clear empty state without inventing a coverage conclusion", () => {
    const narrative = buildSmeCoverageNarrative(analyze([], []));

    expect(narrative.overview).toMatch(/no tags were available/i);
    expect(narrative.assessment).toMatch(/no evidence rows/i);
    expect(narrative.assessment).not.toMatch(/no priority coverage gaps/i);
  });
});
