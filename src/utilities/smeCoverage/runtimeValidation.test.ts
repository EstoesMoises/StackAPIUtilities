import { describe, expect, it } from "vitest";
import { analyzeSmeCoverage } from "./analyzer";
import { buildSmeCoverageDecisionPack } from "./decisionPack";
import type { CollectedSource } from "./model";
import { normalizeTagDemand } from "./tagDemand";
import { normalizeTagSmeCounts } from "./tagSmeCounts";
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

  it("rejects a stale pack after a returned source record changes", () => {
    const result = makeResult();
    result.datasets[1].records[0].view_count = 999;

    expect(isTerminalSmeCoverageResult(result)).toBe(false);
  });

  it("rejects a different well-formed pack whose evidence and methodology came from other sources", () => {
    const result = makeResult();
    const other = makeResult({ firstQuestionViews: 900 });
    result.decisionPack = other.decisionPack;
    result.warnings = other.warnings;

    expect(isTerminalSmeCoverageResult(result)).toBe(false);
  });

  it("rejects a different well-formed pack whose summary came from other sources", () => {
    const result = makeResult();
    const other = makeResult({ includeExtraTag: true });
    result.decisionPack = other.decisionPack;
    result.warnings = other.warnings;

    expect(isTerminalSmeCoverageResult(result)).toBe(false);
  });
});

function makeResult(
  options: { firstQuestionViews?: number; includeExtraTag?: boolean } = {},
): Record<string, any> {
  const pagination = { pageCount: 1, reachedMaxPages: false, hasMore: false };
  const tags: CollectedSource = {
    records: [
      { name: "python", count: 1 },
      { name: "typescript", count: 1 },
      { name: "go", count: 1 },
      { name: "rust", count: 1 },
      { name: "java", count: 1 },
      { name: "csharp", count: 1 },
      ...(options.includeExtraTag ? [{ name: "kotlin", count: 1 }] : []),
    ],
    pagination,
  };
  const questions: CollectedSource = {
    records: [
      { question_id: 1, tags: ["python"], view_count: options.firstQuestionViews ?? 500 },
      { question_id: 2, tags: ["typescript"], view_count: 400 },
      { question_id: 3, tags: ["go"], view_count: 300 },
      { question_id: 4, tags: ["rust"], view_count: 200 },
      { question_id: 5, tags: ["java"], view_count: 100 },
      { question_id: 6, tags: ["csharp"], view_count: 50 },
      ...(options.includeExtraTag ? [{ question_id: 7, tags: ["kotlin"], view_count: 25 }] : []),
    ],
    pagination,
  };
  const tagSmeCounts: CollectedSource = {
    records: [
      { name: "python", subjectMatterExpertCount: 0 },
      { name: "typescript", subjectMatterExpertCount: 1 },
      { name: "go", subjectMatterExpertCount: 2 },
      { name: "rust", subjectMatterExpertCount: 2 },
      { name: "java", subjectMatterExpertCount: 4 },
      { name: "csharp", subjectMatterExpertCount: 5 },
      ...(options.includeExtraTag ? [{ name: "kotlin", subjectMatterExpertCount: 5 }] : []),
    ],
    pagination,
  };
  const demand = normalizeTagDemand({ tags, questions });
  const smeCounts = normalizeTagSmeCounts(tagSmeCounts);
  const analysis = analyzeSmeCoverage({
    demand,
    smeCounts,
    sourceStatus: { tags: pagination, questions: pagination, tagSmeCounts: pagination },
  });
  const decisionPack = buildSmeCoverageDecisionPack({
    analysis,
    snapshot: {
      instanceHost: "example.stackenterprise.co",
      generatedAt: "2026-07-30T12:00:00.000Z",
    },
    sourceWarnings: [...demand.warnings, ...smeCounts.warnings],
  });
  return {
    utilityId: "sme-coverage-analyzer",
    utilityTitle: "SME Coverage Analyzer",
    datasets: [
      { datasetName: "tags", ...tags },
      { datasetName: "questions", ...questions },
      { datasetName: "tagSmeCounts", ...tagSmeCounts },
    ],
    messages: [],
    warnings: decisionPack.warnings,
    decisionPack,
  };
}
