import { describe, expect, it } from "vitest";
import {
  emptySmeCoverageDecisionPack,
  partialSmeCoverageDecisionPack,
} from "../../test/fixtures/smeCoverageFixtures";
import { buildSmeCoverageEvidenceCsv, buildSmeCoverageMarkdown } from "./exports";

const csvHeader =
  "tag_name,page_views,question_count,question_count_basis,sme_count,page_views_per_sme,coverage_percentile,coverage_tier,reason,recommended_action,demand_quality,sme_quality,collection_status,analysis_quality,evidence_notes";

describe("SME coverage exports", () => {
  it("serializes canonical evidence rows in fixed CSV columns without rounding ratios", () => {
    const pack = partialSmeCoverageDecisionPack();
    const csv = buildSmeCoverageEvidenceCsv(pack);

    expect(csv.split("\n")).toHaveLength(pack.evidence.length + 1);
    expect(csv.split("\n")[0]).toBe(csvHeader);
    expect(csv).toContain(
      "Alpha-platform,3000.49,8,Complete question enumeration,1,3000.49,100,Critical under-coverage",
    );
    expect(csv).toContain("unknown-source,,,Unavailable,,,,Unknown");
    expect(csv).not.toContain("Partial question sample");
    expect(csv).not.toContain("Partial sample");
  });

  it("keeps the fixed CSV header when the decision pack has no evidence", () => {
    expect(buildSmeCoverageEvidenceCsv(emptySmeCoverageDecisionPack())).toBe(csvHeader);
  });

  it("renders the fixed Markdown sections from decision-pack content with display rounding", () => {
    const pack = partialSmeCoverageDecisionPack();
    const markdown = buildSmeCoverageMarkdown(pack);
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
    expect(markdown).toContain(
      pack.warnings[0]!.message,
    );
    expect(markdown).toContain("- Collection: All available data collected");
    expect(markdown).toContain("- Analysis quality: Partial");
    expect(markdown).not.toContain("Page size");
    expect(markdown).not.toContain("Maximum pages");
    expect(markdown).not.toContain("Run preset");
    expect(markdown).toContain("- Tags analyzed: 6");
    expect(markdown).toContain("Question-count basis: Complete question enumeration");
    expect(markdown).toContain("Page views per SME: 3,000");
    expect(markdown).toContain("Coverage percentile: 100%");
    expect(markdown).not.toContain("Page views per SME: 3000.49");
    expect(markdown).not.toContain("Partial question sample");
    expect(markdown).not.toContain("Partial sample");
  });

  it("renders tier-specific empty states without inventing a coverage conclusion", () => {
    const markdown = buildSmeCoverageMarkdown(emptySmeCoverageDecisionPack());

    expect(markdown).toContain("No immediate no-SME risks are listed in this decision pack.");
    expect(markdown).toContain("No highest-demand critical gaps are listed in this decision pack.");
    expect(markdown).toContain("No light SME coverage risks are listed in this decision pack.");
  });
});
