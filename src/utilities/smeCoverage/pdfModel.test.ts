import { describe, expect, it } from "vitest";
import {
  completeSmeCoverageDecisionPack,
  emptySmeCoverageDecisionPack,
  partialSmeCoverageDecisionPack,
} from "../../test/fixtures/smeCoverageFixtures";
import type { SmeCoverageDecisionPack } from "./model";
import { buildSmeCoveragePdfModel } from "./pdfModel";

describe("buildSmeCoveragePdfModel", () => {
  it("preserves the snapshot, source summary values, overview, and methodology", () => {
    const source = completeSmeCoverageDecisionPack();
    const pack: SmeCoverageDecisionPack = {
      ...source,
      summary: {
        tagsAnalyzed: 101,
        tagsWithSmes: 72,
        immediateGaps: 13,
        criticalUnderCoverage: 8,
        lightCoverage: 5,
        unknownRows: 3,
      },
    };

    const model = buildSmeCoveragePdfModel(pack);

    expect(model.title).toBe("SME Coverage Decision Pack");
    expect(model.snapshot).toBe(pack.snapshot);
    expect(model.metrics).toEqual([
      { label: "Tags analyzed", value: 101 },
      { label: "Tags with SMEs", value: 72 },
      { label: "Immediate gaps", value: 13 },
      { label: "Critical under-coverage", value: 8 },
      { label: "Light coverage", value: 5 },
      { label: "Unknown rows", value: 3 },
    ]);
    expect(model.overview).toBe(pack.overview);
    expect(model.methodology).toBe(pack.methodology);
  });

  it("keeps warning messages and findings in canonical source order", () => {
    const source = completeSmeCoverageDecisionPack();
    const [immediate] = source.findings.immediateGaps;
    const critical = source.evidence[1];
    const light = source.evidence[2];
    const pack: SmeCoverageDecisionPack = {
      ...source,
      warnings: [
        { code: "first", message: "First evidence limitation." },
        { code: "second", message: "Second evidence limitation." },
      ],
      findings: {
        immediateGaps: [immediate],
        criticalUnderCoverage: [critical],
        lightCoverage: [light],
      },
    };

    const model = buildSmeCoveragePdfModel(pack);

    expect(model.warnings).toEqual([
      "First evidence limitation.",
      "Second evidence limitation.",
    ]);
    expect(model.findingGroups.map((group) => group.tier)).toEqual([
      "Immediate gap",
      "Critical under-coverage",
      "Light coverage",
    ]);
    expect(model.findingGroups.flatMap((group) => group.rows)).toEqual([
      immediate,
      critical,
      light,
    ]);
  });

  it("omits empty finding groups and bounds the appendix to finding rows", () => {
    const source = partialSmeCoverageDecisionPack();
    const immediate = source.evidence[0];
    const light = source.evidence[2];
    const pack: SmeCoverageDecisionPack = {
      ...source,
      findings: {
        immediateGaps: [immediate],
        criticalUnderCoverage: [],
        lightCoverage: [light],
      },
    };

    const model = buildSmeCoveragePdfModel(pack);

    expect(model.findingGroups.map((group) => group.tier)).toEqual([
      "Immediate gap",
      "Light coverage",
    ]);
    expect(model.appendixRows).toEqual([immediate, light]);
    expect(model.appendixRows).not.toContain(source.evidence[source.evidence.length - 1]);
    expect(model.appendixRows.length).toBeLessThan(pack.evidence.length);
  });

  it("keeps source row references and does not mutate the decision pack", () => {
    const pack = completeSmeCoverageDecisionPack();
    const sourceJson = JSON.stringify(pack);

    const model = buildSmeCoveragePdfModel(pack);

    expect(model.findingGroups[0]?.rows[0]).toBe(pack.findings.immediateGaps[0]);
    expect(model.appendixRows[0]).toBe(pack.findings.immediateGaps[0]);
    expect(JSON.stringify(pack)).toBe(sourceJson);
  });

  it("cleans assessment paragraphs while preserving their source order", () => {
    const source = completeSmeCoverageDecisionPack();
    const pack: SmeCoverageDecisionPack = {
      ...source,
      assessment: "  First assessment paragraph.  \n\n \n Second assessment paragraph. \r\n\r\n  ",
    };

    expect(buildSmeCoveragePdfModel(pack).assessmentParagraphs).toEqual([
      "First assessment paragraph.",
      "Second assessment paragraph.",
    ]);
  });

  it.each([
    ["complete", completeSmeCoverageDecisionPack()],
    ["partial", partialSmeCoverageDecisionPack()],
  ])("builds a useful %s model with the complete CSV note", (_state, pack) => {
    const model = buildSmeCoveragePdfModel(pack);

    expect(model.snapshot.completeness).toBe(pack.snapshot.completeness);
    expect(model.assessmentParagraphs.every((paragraph) => paragraph.length > 0)).toBe(true);
    expect(model.appendixRows).toEqual(model.findingGroups.flatMap((group) => group.rows));
    expect(model.completeEvidenceNote).toBe(
      "The accompanying evidence CSV contains the complete canonical dataset in decision-pack order.",
    );
  });

  it("states that no evidence CSV accompanies an empty report", () => {
    const pack = emptySmeCoverageDecisionPack();
    const model = buildSmeCoveragePdfModel(pack);

    expect(model.snapshot.completeness).toBe("Empty");
    expect(model.completeEvidenceNote).toBe(
      "No accompanying evidence CSV is available because this report contains no canonical evidence rows.",
    );
    expect(model.completeEvidenceNote).not.toContain("complete canonical dataset");
  });
});
