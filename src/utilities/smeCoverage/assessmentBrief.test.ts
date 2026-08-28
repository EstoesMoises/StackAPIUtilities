import { describe, expect, it } from "vitest";
import {
  completeSmeCoverageDecisionPack,
  emptySmeCoverageDecisionPack,
} from "../../test/fixtures/smeCoverageFixtures";
import {
  buildSmeCoverageAssessmentBrief,
  formatSmeCoverageAssessmentMarkdown,
} from "./assessmentBrief";
import type { SmeCoverageDecisionPack } from "./model";

describe("buildSmeCoverageAssessmentBrief", () => {
  it("structures prepared priorities in canonical tier and source order", () => {
    const brief = buildSmeCoverageAssessmentBrief(completeSmeCoverageDecisionPack());

    expect(brief.title).toBe("SME COVERAGE ASSESSMENT");
    expect(brief.sections.map((section) => section.heading)).toEqual([
      "Immediate priorities",
      "Critical under-coverage",
      "Light coverage",
    ]);
    expect(
      brief.sections.flatMap((section) => section.items.map((item) => item.tagName)),
    ).toEqual(["zeta-runtime", "Alpha-platform", "beta-data"]);
    expect(brief.sections[0]?.items[0]).toMatchObject({
      tagName: "zeta-runtime",
      pageViews: 12_345.6,
      smeCount: 0,
      recommendedAction: "Assign or confirm at least one SME.",
    });
    expect(brief.evidenceQuality).toBe("Complete");
    expect(brief.fullEvidenceNote).toBe("See the accompanying CSV.");
  });

  it("bounds each priority group for share-ready copy and reports omitted items", () => {
    const source = completeSmeCoverageDecisionPack();
    const immediate = source.findings.immediateGaps[0];
    const pack: SmeCoverageDecisionPack = {
      ...source,
      findings: {
        ...source.findings,
        immediateGaps: Array.from({ length: 5 }, (_, index) => ({
          ...immediate,
          tagName: `gap-${index + 1}`,
        })),
      },
    };

    const immediateSection = buildSmeCoverageAssessmentBrief(pack).sections[0];

    expect(immediateSection?.items.map((item) => item.tagName)).toEqual([
      "gap-1",
      "gap-2",
      "gap-3",
    ]);
    expect(immediateSection?.omittedCount).toBe(2);
  });

  it("keeps an empty report explicit without referring to an unavailable CSV", () => {
    const brief = buildSmeCoverageAssessmentBrief(emptySmeCoverageDecisionPack());

    expect(brief.sections).toEqual([]);
    expect(brief.recommendedNextStep).toBe(
      "Collect evidence before assigning or changing SME coverage.",
    );
    expect(brief.fullEvidenceNote).toBe(
      "No evidence CSV is available for this empty report.",
    );
  });
});

describe("formatSmeCoverageAssessmentMarkdown", () => {
  it("formats a concise hierarchy for email, Slack, and AI tools", () => {
    const markdown = formatSmeCoverageAssessmentMarkdown(
      buildSmeCoverageAssessmentBrief(completeSmeCoverageDecisionPack()),
    );

    expect(markdown).toContain(
      "SME COVERAGE ASSESSMENT\n\nBottom line\n1 active tag has immediate no-SME gaps.",
    );
    expect(markdown).toContain(
      "\n\nImmediate priorities\n- zeta-runtime: 12,346 page views, 0 SMEs; Assign or confirm at least one SME.",
    );
    expect(markdown).toContain("\n\nRecommended next step\n");
    expect(markdown).toContain("\n\nEvidence quality: Complete");
    expect(markdown).toContain("Full evidence: See the accompanying CSV.");
  });
});
