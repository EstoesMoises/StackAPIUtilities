import { describe, expect, it } from "vitest";
import {
  completeSmeCoverageDecisionPack,
  emptySmeCoverageDecisionPack,
  partialSmeCoverageDecisionPack,
} from "../../test/fixtures/smeCoverageFixtures";
import type { SmeCoverageDecisionPack } from "./model";
import { buildSmeCoveragePdfModel } from "./pdfModel";

describe("buildSmeCoveragePdfModel", () => {
  it("builds an executive brief with prepared metrics and assessment structure", () => {
    const pack = completeSmeCoverageDecisionPack();
    const model = buildSmeCoveragePdfModel(pack);

    expect(model.title).toBe("SME Coverage Executive Brief");
    expect(model.snapshot).toBe(pack.snapshot);
    expect(model.metrics).toEqual([
      { label: "Tags analyzed", value: 5 },
      { label: "Tags with SMEs", value: 4 },
      { label: "Immediate gaps", value: 1 },
      { label: "Critical under-coverage", value: 1 },
      { label: "Light coverage", value: 1 },
      { label: "Unknown rows", value: 0 },
    ]);
    expect(model.overview).toBe(pack.overview);
    expect(model.assessmentBrief.bottomLine).toBe(pack.overview);
    expect(model.assessmentBrief.sections.map((section) => section.heading)).toEqual([
      "Immediate priorities",
      "Critical under-coverage",
      "Light coverage",
    ]);
  });

  it("keeps warnings and priority rows in canonical source order", () => {
    const source = completeSmeCoverageDecisionPack();
    const pack: SmeCoverageDecisionPack = {
      ...source,
      warnings: [
        { code: "first", message: "First evidence limitation." },
        { code: "second", message: "Second evidence limitation." },
      ],
    };

    const model = buildSmeCoveragePdfModel(pack);

    expect(model.warnings).toEqual([
      "First evidence limitation.",
      "Second evidence limitation.",
    ]);
    expect(model.priorityRows.map((row) => row.tagName)).toEqual([
      "zeta-runtime",
      "Alpha-platform",
      "beta-data",
    ]);
  });

  it("bounds the printed action register and reports omitted priorities", () => {
    const source = completeSmeCoverageDecisionPack();
    const seed = source.findings.immediateGaps[0];
    const pack: SmeCoverageDecisionPack = {
      ...source,
      findings: {
        ...source.findings,
        immediateGaps: Array.from({ length: 15 }, (_, index) => ({
          ...seed,
          tagName: `immediate-${index + 1}`,
        })),
      },
    };

    const model = buildSmeCoveragePdfModel(pack);

    expect(model.priorityRows).toHaveLength(12);
    expect(model.priorityRows.map((row) => row.tagName)).toEqual(
      Array.from({ length: 12 }, (_, index) => `immediate-${index + 1}`),
    );
    expect(model.omittedPriorityCount).toBe(5);
    expect(model).not.toHaveProperty("appendixRows");
  });

  it("summarizes methodology and directs complete reports to the CSV", () => {
    const model = buildSmeCoveragePdfModel(partialSmeCoverageDecisionPack());

    expect(model.methodologySummary).toContain(
      "Active tags have at least 1 question or more than 25 page views.",
    );
    expect(model.methodologySummary).toContain("P75 1,250");
    expect(model.methodologySummary).toContain("P90 3,000");
    expect(model.completeEvidenceNote).toBe(
      "Complete canonical evidence is provided in the accompanying CSV for filtering, audit, and AI-assisted analysis.",
    );
  });

  it("keeps an empty report useful without promising an unavailable CSV", () => {
    const model = buildSmeCoveragePdfModel(emptySmeCoverageDecisionPack());

    expect(model.priorityRows).toEqual([]);
    expect(model.omittedPriorityCount).toBe(0);
    expect(model.completeEvidenceNote).toBe(
      "No evidence CSV is available because this report contains no canonical evidence rows.",
    );
  });
});
