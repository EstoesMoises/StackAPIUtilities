import { describe, expect, it } from "vitest";
import type { ApiVolumeSettingsValue, ReportWarning } from "../../domain/types";
import {
  completeSmeCoverageSourceStatus,
  narrativeDemandRows,
  narrativeSmeRows,
  normalizedDemandRow,
  normalizedSmeRow,
} from "../../test/fixtures/smeCoverageFixtures";
import { analyzeSmeCoverage } from "./analyzer";
import { buildSmeCoverageDecisionPack } from "./decisionPack";
import type { SmeCoverageAnalysisResult, SmeCoverageSourceStatus } from "./model";

const snapshot = {
  instanceHost: "example.stackenterprise.co",
  generatedAt: "2026-07-30T12:00:00.000Z",
  pageSize: 100,
  maxPagesPerDataset: 20,
  runPreset: "deep-audit" as const,
};

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

function capped(source: keyof SmeCoverageSourceStatus): SmeCoverageSourceStatus {
  return {
    ...completeSmeCoverageSourceStatus,
    [source]: { pageCount: 20, reachedMaxPages: true, hasMore: true },
  };
}

function warning(code: string, message: string): ReportWarning {
  return { utilityId: "sme-coverage-analyzer", code, message };
}

describe("buildSmeCoverageDecisionPack", () => {
  it("composes complete immutable snapshot metadata and canonical analysis sections", () => {
    const analysis = analyze();

    const pack = buildSmeCoverageDecisionPack({ analysis, snapshot, sourceWarnings: [] });

    expect(pack.snapshot).toEqual({
      instanceHost: "example.stackenterprise.co",
      generatedAt: "2026-07-30T12:00:00.000Z",
      scopeLabel: "All-time demand · Current SME coverage",
      completeness: "Complete",
      pageSize: 100,
      maxPagesPerDataset: 20,
      runPreset: "deep-audit",
    });
    expect(pack.summary).toEqual(analysis.summary);
    expect(pack.methodology).toEqual(analysis.methodology);
    expect(pack.evidence).toEqual(analysis.evidence);
    expect(pack.findings).toEqual(analysis.findings);
    expect(pack.evidence).not.toBe(analysis.evidence);
    expect(pack.findings.criticalUnderCoverage).not.toBe(analysis.findings.criticalUnderCoverage);
    expect(Object.isFrozen(pack)).toBe(true);
    expect(Object.isFrozen(pack.snapshot)).toBe(true);
    expect(Object.isFrozen(pack.warnings)).toBe(true);
    expect(Object.isFrozen(pack.evidence)).toBe(true);
    expect(Object.isFrozen(pack.findings.criticalUnderCoverage)).toBe(true);
  });

  it.each(["tags", "questions", "tagSmeCounts"] as const)(
    "marks a %s source cap Partial from source status rather than warning copy",
    (source) => {
      const analysis = analyze(narrativeDemandRows, narrativeSmeRows, capped(source));

      const pack = buildSmeCoverageDecisionPack({
        analysis,
        snapshot,
        sourceWarnings: [warning("misleading.copy", "Everything was complete.")],
      });

      expect(pack.snapshot.completeness).toBe("Partial");
    },
  );

  it.each([
    ["Quick sample", { pageSize: 50, maxPagesPerDataset: 1, runPreset: "quick-sample" }],
    ["Standard", { pageSize: 100, maxPagesPerDataset: 5, runPreset: "standard" }],
    ["custom", { pageSize: 75, maxPagesPerDataset: 7 }],
  ] as const)("marks a non-capped %s run Partial from analysis sampling metadata", (_label, settings) => {
    const analysis = analyze(
      narrativeDemandRows,
      narrativeSmeRows,
      completeSmeCoverageSourceStatus,
      settings,
    );

    const pack = buildSmeCoverageDecisionPack({ analysis, snapshot, sourceWarnings: [] });

    expect(pack.snapshot.completeness).toBe("Partial");
  });

  it.each([
    {
      label: "invalid demand",
      analysis: () => analyze([normalizedDemandRow("invalid", null)], [normalizedSmeRow("invalid", 1)]),
    },
    {
      label: "unknown SME coverage",
      analysis: () => analyze([normalizedDemandRow("unknown", 50)], [normalizedSmeRow("unknown", null)]),
    },
    {
      label: "insufficient percentile sample",
      analysis: () => analyze([normalizedDemandRow("small", 50)], [normalizedSmeRow("small", 1)]),
    },
  ])("marks $label Partial", ({ analysis }) => {
    expect(
      buildSmeCoverageDecisionPack({ analysis: analysis(), snapshot, sourceWarnings: [] }).snapshot.completeness,
    ).toBe("Partial");
  });

  it("marks zero evidence with successfully empty sources Empty", () => {
    const pack = buildSmeCoverageDecisionPack({ analysis: analyze([], []), snapshot, sourceWarnings: [] });

    expect(pack.snapshot.completeness).toBe("Empty");
    expect(pack.summary).toEqual({
      tagsAnalyzed: 0,
      tagsWithSmes: 0,
      immediateGaps: 0,
      criticalUnderCoverage: 0,
      lightCoverage: 0,
      unknownRows: 0,
    });
  });

  it("marks capped zero evidence Partial instead of Empty", () => {
    const pack = buildSmeCoverageDecisionPack({
      analysis: analyze([], [], capped("tags")),
      snapshot,
      sourceWarnings: [],
    });

    expect(pack.snapshot.completeness).toBe("Partial");
  });

  it("marks zero evidence from a configured partial run Partial instead of Empty", () => {
    const pack = buildSmeCoverageDecisionPack({
      analysis: analyze(
        [],
        [],
        completeSmeCoverageSourceStatus,
        { pageSize: 100, maxPagesPerDataset: 5, runPreset: "standard" },
      ),
      snapshot,
      sourceWarnings: [],
    });

    expect(pack.snapshot.completeness).toBe("Partial");
    expect(pack.overview).toContain("partial sample");
    expect(pack.assessment).toContain("partial sample");
  });

  it("deduplicates source warnings before analysis warnings in stable source order", () => {
    const duplicate = warning("duplicate", "Same warning.");
    const first = warning("source.first", "First source warning.");
    const second = warning("source.second", "Second source warning.");
    const analysis = {
      ...analyze(),
      warnings: [duplicate, warning("analysis.only", "Analysis warning."), first],
    };

    const pack = buildSmeCoverageDecisionPack({
      analysis,
      snapshot,
      sourceWarnings: [first, duplicate, second, duplicate],
    });

    expect(pack.warnings).toEqual([first, duplicate, second, warning("analysis.only", "Analysis warning.")]);
  });

  it("copies canonical rows once and keeps finding references inside the copied evidence", () => {
    const analysis = analyze();

    const pack = buildSmeCoverageDecisionPack({ analysis, snapshot, sourceWarnings: [] });

    for (const finding of [
      ...pack.findings.immediateGaps,
      ...pack.findings.criticalUnderCoverage,
      ...pack.findings.lightCoverage,
    ]) {
      expect(pack.evidence).toContain(finding);
    }
  });
});
