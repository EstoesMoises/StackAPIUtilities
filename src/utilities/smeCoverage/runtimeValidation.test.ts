import { describe, expect, it } from "vitest";
import { completeSmeCoverageDecisionPack } from "../../test/fixtures/smeCoverageFixtures";
import {
  isTerminalSmeCoverageResult,
  parseTerminalSmeCoverageResult,
} from "./runtimeValidation";

describe("isTerminalSmeCoverageResult", () => {
  it("accepts a complete production-built result", () => {
    expect(isTerminalSmeCoverageResult(makeResult())).toBe(true);
  });

  it.each([
    ["negative evidence", (pack: Record<string, any>) => { pack.evidence[0].pageViews = -1; }],
    ["percentile above 100", (pack: Record<string, any>) => { pack.evidence[1].coveragePercentile = 101; }],
    ["summary mismatch", (pack: Record<string, any>) => { pack.summary.tagsAnalyzed += 1; }],
    ["finding mismatch", (pack: Record<string, any>) => {
      pack.findings.immediateGaps[0] = { ...pack.findings.immediateGaps[0], reason: "tampered" };
    }],
    ["invalid tier", (pack: Record<string, any>) => { pack.evidence[0].coverageTier = "Impossible"; }],
    ["methodology mismatch", (pack: Record<string, any>) => { pack.methodology.coveredActiveSampleSize += 1; }],
    ["ratio mismatch", (pack: Record<string, any>) => { pack.evidence[1].pageViewsPerSme += 1; }],
    ["completeness mismatch", (pack: Record<string, any>) => { pack.snapshot.completeness = "Partial"; }],
  ])("rejects a current exhaustive pack with %s", (_label, mutate) => {
    const result = makeResult();
    const pack = structuredClone(result.decisionPack) as unknown as Record<string, any>;
    mutate(pack);
    result.decisionPack = pack;

    expect(isTerminalSmeCoverageResult(result)).toBe(false);
  });

  it("rejects a canonical legacy pack for a new live result", () => {
    const result = makeResult();
    const pack = structuredClone(result.decisionPack) as unknown as Record<string, any>;
    pack.snapshot.collectionLabel = "Legacy run — completeness not verified under current collection rules";
    result.decisionPack = pack;

    expect(isTerminalSmeCoverageResult(result)).toBe(false);
  });

  it("returns the canonical parsed pack instead of raw extra fields", () => {
    const result = makeResult();
    const pack = structuredClone(result.decisionPack) as unknown as Record<string, any>;
    pack.credentials = { pat: "secret" };
    pack.evidence[0].accessToken = "secret";
    result.decisionPack = pack;

    const parsed = parseTerminalSmeCoverageResult(result);

    expect(parsed?.decisionPack).not.toHaveProperty("credentials");
    expect(parsed?.decisionPack.evidence[0]).not.toHaveProperty("accessToken");
  });
});

function makeResult(): Record<string, any> {
  return {
    utilityId: "sme-coverage-analyzer",
    utilityTitle: "SME Coverage Analyzer",
    datasets: ["tags", "questions", "tagSmeCounts"].map((datasetName) => ({
      datasetName,
      records: [],
      pagination: { pageCount: 0, reachedMaxPages: false, hasMore: false },
    })),
    messages: [],
    warnings: [],
    decisionPack: completeSmeCoverageDecisionPack(),
  };
}
