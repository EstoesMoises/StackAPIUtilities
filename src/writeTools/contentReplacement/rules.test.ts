import { describe, expect, it } from "vitest";
import {
  createDefaultReplacementConfiguration,
  parseReplacementCsv,
  validateReplacementRules,
} from "./rules";

describe("content replacement rules", () => {
  it("uses the safe matching defaults", () => {
    expect(createDefaultReplacementConfiguration()).toMatchObject({
      contentTypes: { questions: true, answers: true, articles: true },
      options: {
        caseSensitive: true,
        wholeTerm: true,
        replaceInCode: false,
      },
      target: { kind: "enterprise-main" },
    });
  });

  it("preserves meaningful term whitespace while recognizing blank values", () => {
    const result = validateReplacementRules(
      [
        { id: "1", find: " MyPVM ", replace: " MyPBM " },
        { id: "2", find: "  ", replace: "MyPBM" },
      ],
      { caseSensitive: true, wholeTerm: true, replaceInCode: false },
    );

    expect(result.rules).toEqual([{ id: "1", find: " MyPVM ", replace: " MyPBM " }]);
    expect(result.errors.map((error) => error.code)).toEqual(["blank-source"]);
  });

  it("deduplicates identical rows and blocks ambiguous simultaneous rules", () => {
    const result = validateReplacementRules(
      [
        { id: "1", find: "MyPVM", replace: "MyPBM" },
        { id: "2", find: "MyPVM", replace: "MyPBM" },
        { id: "3", find: "MyPBM", replace: "myBenefits" },
        { id: "4", find: "PVM", replace: "PBM" },
      ],
      { caseSensitive: true, wholeTerm: true, replaceInCode: false },
    );

    expect(result.rules).toHaveLength(3);
    expect(result.notices).toContain('Removed duplicate rule "MyPVM" → "MyPBM".');
    expect(result.errors.map((error) => error.code)).toEqual([
      "replacement-is-source",
      "overlapping-sources",
    ]);
  });

  it("parses the canonical CSV and retains invalid rows for correction", () => {
    expect(parseReplacementCsv("find,replace\nMyPVM,MyPBM\nCPR,")).toEqual({
      rows: [
        { id: "csv-2", sourceRow: 2, find: "MyPVM", replace: "MyPBM" },
        { id: "csv-3", sourceRow: 3, find: "CPR", replace: "" },
      ],
      fileErrors: [],
    });
  });

  it("reports extra-column CSV records by source row instead of truncating them", () => {
    expect(parseReplacementCsv("find,replace\nMyPVM,MyPBM,unexpected")).toEqual({
      rows: [],
      fileErrors: ["CSV row 2 must contain exactly two columns."],
    });
  });

  it("normalizes only BOM and header padding, while omitting wholly blank CSV records", () => {
    expect(parseReplacementCsv("\uFEFF find , replace \n MyPVM , MyPBM \n,\n")).toEqual({
      rows: [{ id: "csv-2", sourceRow: 2, find: " MyPVM ", replace: " MyPBM " }],
      fileErrors: [],
    });
  });
});
