import { describe, expect, it } from "vitest";
import {
  completeSmeCoverageDecisionPack,
  emptySmeCoverageDecisionPack,
  partialSmeCoverageDecisionPack,
} from "../../../test/fixtures/smeCoverageFixtures";
import type { SmeCoverageDecisionPack } from "../model";
import { createSmeCoveragePresentation } from "../presentation";

describe("createSmeCoveragePresentation", () => {
  it("preserves stable report identity and semantic summary metrics", () => {
    const pack = completeSmeCoverageDecisionPack();

    const result = createSmeCoveragePresentation(pack);

    expect(result.reportKey).toBe(
      `sme-coverage-analyzer:${pack.snapshot.instanceHost}:${pack.snapshot.generatedAt}`,
    );
    expect(result).toMatchObject({
      kindLabel: "Decision pack",
      title: "SME coverage report",
      sourceLabel: pack.snapshot.instanceHost,
      generatedAt: pack.snapshot.generatedAt,
      scopeLabel: pack.snapshot.scopeLabel,
      collectionLabel: pack.snapshot.collectionLabel,
      rowCount: pack.evidence.length,
    });
    expect(result.metrics).toEqual([
      { label: "Tags analyzed", value: pack.summary.tagsAnalyzed },
      { label: "Tags with SMEs", value: pack.summary.tagsWithSmes },
      { label: "Immediate gaps", value: pack.summary.immediateGaps },
      { label: "Critical under-coverage", value: pack.summary.criticalUnderCoverage },
      { label: "Light-coverage tags", value: pack.summary.lightCoverage },
    ]);
  });

  it("preserves warnings, evidence, and finding evidence references in canonical bucket order", () => {
    const source = completeSmeCoverageDecisionPack();
    const warnings = [
      {
        utilityId: "sme-coverage-analyzer" as const,
        code: "sme-coverage.fixture-note",
        message: "Fixture evidence note.",
      },
    ];
    const pack: SmeCoverageDecisionPack = { ...source, warnings };

    const result = createSmeCoveragePresentation(pack);
    const expectedEvidence = [
      ...pack.findings.immediateGaps,
      ...pack.findings.criticalUnderCoverage,
      ...pack.findings.lightCoverage,
    ];

    expect(result.warnings).toBe(pack.warnings);
    expect(result.evidence).toBe(pack.evidence);
    expect(result.findings.map((finding) => finding.evidence)).toEqual(expectedEvidence);
    result.findings.forEach((finding, index) => {
      expect(finding.evidence).toBe(expectedEvidence[index]);
      expect(finding.tier).toBe(expectedEvidence[index].coverageTier);
    });
  });

  it("declares content-aware sections and export availability", () => {
    const result = createSmeCoveragePresentation(completeSmeCoverageDecisionPack());

    expect(result.availableSections).toEqual([
      "overview",
      "findings",
      "evidence",
      "methodology",
    ]);
    expect(result.exports).toEqual({ pdf: true, csv: true, markdown: true });
  });

  it("exposes only overview and methodology and disables CSV for an empty pack", () => {
    const result = createSmeCoveragePresentation(emptySmeCoverageDecisionPack());

    expect(result.availableSections).toEqual(["overview", "methodology"]);
    expect(result.exports).toEqual({ pdf: true, csv: false, markdown: true });
  });

  it.each([
    [completeSmeCoverageDecisionPack, "Complete", "success"],
    [partialSmeCoverageDecisionPack, "Partial", "warning"],
    [emptySmeCoverageDecisionPack, "Empty", "neutral"],
  ] as const)(
    "maps %s source quality to a clear label and tone",
    (createPack, completeness, qualityTone) => {
      const result = createSmeCoveragePresentation(createPack());

      expect(result.qualityLabel).toBe(`Analysis quality: ${completeness}`);
      expect(result.qualityTone).toBe(qualityTone);
    },
  );
});
