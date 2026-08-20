import { describe, expect, it } from "vitest";
import type {
  SmeCoverageDecisionPack,
  SmeCoverageEvidenceRow,
} from "../../utilities/smeCoverage/model";
import {
  completeSmeCoverageDecisionPack,
  emptySmeCoverageDecisionPack,
  insufficientSampleSmeCoverageDecisionPack,
  partialSmeCoverageDecisionPack,
} from "./smeCoverageFixtures";

describe("SME coverage decision-pack fixtures", () => {
  it("derives complete summary, findings, thresholds, and quality from canonical evidence", () => {
    const pack = completeSmeCoverageDecisionPack();

    expectPackInvariants(pack);
    expect(pack.snapshot.completeness).toBe("Complete");
    expect(pack.methodology.coveredActiveSampleSize).toBeGreaterThanOrEqual(4);
    expect(pack.evidence.every((row) => row.demandQuality === "Complete")).toBe(true);
    expect(pack.evidence.every((row) => row.smeQuality === "Complete")).toBe(true);
  });

  it("derives partial quality from invalid or unknown evidence after exhaustive collection", () => {
    const pack = partialSmeCoverageDecisionPack();

    expectPackInvariants(pack);
    expect(pack.snapshot.collectionLabel).toBe("All available data collected");
    expect(pack.snapshot.completeness).toBe("Partial");
    expect(
      pack.evidence.some(
        (row) => row.demandQuality === "Invalid" || row.smeQuality === "Unknown",
      ),
    ).toBe(true);
    expect(pack.warnings.map((warning) => warning.message).join(" ")).not.toMatch(
      /configured|cap|sampling/i,
    );
  });

  it("derives insufficient-sample classifications and nearest-rank thresholds from evidence", () => {
    const pack = insufficientSampleSmeCoverageDecisionPack();
    const coveredRows = eligibleCoveredActiveRows(pack.evidence);

    expectPackInvariants(pack);
    expect(pack.snapshot.completeness).toBe("Partial");
    expect(coveredRows).toHaveLength(1);
    expect(coveredRows.every((row) => row.coverageTier === "Not classified")).toBe(true);
    expect(pack.findings.criticalUnderCoverage).toEqual([]);
    expect(pack.findings.lightCoverage).toEqual([]);
  });

  it("derives an empty pack from zero evidence", () => {
    expectPackInvariants(emptySmeCoverageDecisionPack());
  });
});

function expectPackInvariants(pack: SmeCoverageDecisionPack): void {
  const eligibleRows = eligibleCoveredActiveRows(pack.evidence);
  const activePageViews = pack.evidence
    .filter(isActive)
    .map((row) => row.pageViews)
    .filter((value): value is number => value !== null);
  const ratios = eligibleRows
    .map((row) => row.pageViewsPerSme)
    .filter((value): value is number => value !== null);

  expect(pack.summary).toEqual({
    tagsAnalyzed: pack.evidence.length,
    tagsWithSmes: pack.evidence.filter(
      (row) => row.smeQuality === "Complete" && row.smeCount !== null && row.smeCount >= 1,
    ).length,
    immediateGaps: pack.evidence.filter((row) => row.coverageTier === "Immediate gap").length,
    criticalUnderCoverage: pack.evidence.filter(
      (row) => row.coverageTier === "Critical under-coverage",
    ).length,
    lightCoverage: pack.evidence.filter((row) => row.coverageTier === "Light coverage").length,
    unknownRows: pack.evidence.filter((row) => row.coverageTier === "Unknown").length,
  });
  expect(pack.findings.immediateGaps).toEqual(
    pack.evidence.filter((row) => row.coverageTier === "Immediate gap"),
  );
  expect(pack.findings.criticalUnderCoverage).toEqual(
    pack.evidence.filter((row) => row.coverageTier === "Critical under-coverage"),
  );
  expect(pack.findings.lightCoverage).toEqual(
    pack.evidence.filter((row) => row.coverageTier === "Light coverage"),
  );
  expect(pack.methodology.coveredActiveSampleSize).toBe(eligibleRows.length);
  expect(pack.methodology.activeTagMedianPageViews).toBe(median(activePageViews));
  expect(pack.methodology.p75PageViewsPerSme).toBe(nearestRank(ratios, 0.75));
  expect(pack.methodology.p90PageViewsPerSme).toBe(nearestRank(ratios, 0.9));
  expect(pack.methodology.percentileSampleSufficient).toBe(ratios.length >= 4);

  const expectedCompleteness = pack.evidence.length === 0
    ? "Empty"
    : pack.evidence.some(
          (row) => row.demandQuality !== "Complete" || row.smeQuality !== "Complete",
        ) || ratios.length < 4
      ? "Partial"
      : "Complete";
  expect(pack.snapshot.completeness).toBe(expectedCompleteness);
}

function eligibleCoveredActiveRows(
  rows: readonly SmeCoverageEvidenceRow[],
): readonly SmeCoverageEvidenceRow[] {
  return rows.filter(
    (row) =>
      isActive(row) &&
      row.demandQuality !== "Invalid" &&
      row.smeQuality === "Complete" &&
      row.smeCount !== null &&
      row.smeCount >= 1 &&
      row.pageViewsPerSme !== null,
  );
}

function isActive(row: SmeCoverageEvidenceRow): boolean {
  return (
    row.questionCount !== null &&
    row.pageViews !== null &&
    (row.questionCount >= 1 || row.pageViews > 25)
  );
}

function nearestRank(values: readonly number[], percentile: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const rank = Math.min(sorted.length, Math.max(1, Math.ceil(percentile * sorted.length)));
  return sorted[rank - 1]!;
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]!
    : (sorted[middle - 1]! + sorted[middle]!) / 2;
}
