import { describe, expect, it } from "vitest";
import { completeRawSources, collected } from "../../test/fixtures/smeCoverageFixtures";
import type { NormalizedTagSmeRow } from "./model";
import { normalizeTagSmeCounts } from "./tagSmeCounts";

function byTag(rows: readonly NormalizedTagSmeRow[], tagName: string): NormalizedTagSmeRow {
  const row = rows.find((candidate) => candidate.key === tagName);
  if (!row) throw new Error(`Missing ${tagName}`);
  return row;
}

describe("normalizeTagSmeCounts", () => {
  it("retains authoritative numeric zero SME coverage", () => {
    const result = normalizeTagSmeCounts(completeRawSources.tagSmeCounts);

    expect(byTag(result.rows, "timeout")).toMatchObject({ smeCount: 0, smeQuality: "Complete" });
  });

  it("retains a v3-only tag for the later evidence join", () => {
    const result = normalizeTagSmeCounts(collected([{ name: "v3-only", subjectMatterExpertCount: 3 }]));

    expect(byTag(result.rows, "v3-only")).toMatchObject({ smeCount: 3, smeQuality: "Complete" });
  });

  it.each([
    ["numeric string", "3"],
    ["missing", undefined],
    ["null", null],
    ["negative", -1],
    ["NaN", Number.NaN],
    ["infinite", Infinity],
  ])("treats a %s SME count as unknown", (_label, subjectMatterExpertCount) => {
    const result = normalizeTagSmeCounts(collected([{ name: "piper", subjectMatterExpertCount }]));

    expect(byTag(result.rows, "piper")).toMatchObject({ smeCount: null, smeQuality: "Unknown" });
  });

  it("does not read snake-case or unrelated user fields", () => {
    const result = normalizeTagSmeCounts(
      collected([{ name: "piper", subject_matter_expert_count: 3, topAnswererCount: 2, user_id: 1 }]),
    );

    expect(byTag(result.rows, "piper")).toMatchObject({ smeCount: null, smeQuality: "Unknown" });
  });

  it("collapses identical numeric duplicate counts", () => {
    const result = normalizeTagSmeCounts(
      collected([
        { name: "piper", subjectMatterExpertCount: 3 },
        { name: "PIPER", subjectMatterExpertCount: 3 },
      ]),
    );

    expect(byTag(result.rows, "piper")).toMatchObject({ smeCount: 3, smeQuality: "Complete" });
  });

  it("makes conflicting numeric or mixed unavailable duplicate counts unknown", () => {
    const conflicting = normalizeTagSmeCounts(
      collected([
        { name: "piper", subjectMatterExpertCount: 3 },
        { name: "PIPER", subjectMatterExpertCount: 4 },
      ]),
    );
    const mixed = normalizeTagSmeCounts(
      collected([
        { name: "piper", subjectMatterExpertCount: 3 },
        { name: "PIPER", subjectMatterExpertCount: null },
      ]),
    );

    expect(byTag(conflicting.rows, "piper")).toMatchObject({ smeCount: null, smeQuality: "Unknown" });
    expect(byTag(mixed.rows, "piper")).toMatchObject({ smeCount: null, smeQuality: "Unknown" });
  });
});
