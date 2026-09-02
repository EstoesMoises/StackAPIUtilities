import { describe, expect, it } from "vitest";
import {
  createDefaultReplacementConfiguration,
  parseReplacementCsv,
  validateReplacementRules,
} from "./rules";
import {
  MAX_CONTENT_REPLACEMENT_CSV_INPUT_BYTES,
} from "./limits";

describe("content replacement rules", () => {
  it("uses the safe matching defaults", () => {
    expect(createDefaultReplacementConfiguration()).toMatchObject({
      contentTypes: { questions: true, answers: true, articles: true },
      discovery: { mode: "targeted" },
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
        { id: "1", find: " TermA ", replace: " TermB " },
        { id: "2", find: "  ", replace: "TermB" },
      ],
      { caseSensitive: true, wholeTerm: true, replaceInCode: false },
    );

    expect(result.rules).toEqual([{ id: "1", find: " TermA ", replace: " TermB " }]);
    expect(result.errors.map((error) => error.code)).toEqual(["blank-source"]);
  });

  it("deduplicates identical rows and blocks ambiguous simultaneous rules", () => {
    const result = validateReplacementRules(
      [
        { id: "1", find: "TermA", replace: "TermB" },
        { id: "2", find: "TermA", replace: "TermB" },
        { id: "3", find: "TermB", replace: "myBenefits" },
        { id: "4", find: "mA", replace: "mB" },
      ],
      { caseSensitive: true, wholeTerm: true, replaceInCode: false },
    );

    expect(result.rules).toHaveLength(3);
    expect(result.notices).toContain('Removed duplicate rule "TermA" → "TermB".');
    expect(result.errors.map((error) => error.code)).toEqual([
      "replacement-is-source",
      "overlapping-sources",
    ]);
  });

  it("parses the canonical CSV and retains invalid rows for correction", () => {
    expect(parseReplacementCsv("find,replace\nTermA,TermB\nCPR,")).toEqual({
      rows: [
        { id: "csv-2", sourceRow: 2, find: "TermA", replace: "TermB" },
        { id: "csv-3", sourceRow: 3, find: "CPR", replace: "" },
      ],
      fileErrors: [],
    });
  });

  it("reports extra-column CSV records by source row instead of truncating them", () => {
    expect(parseReplacementCsv("find,replace\nTermA,TermB,unexpected")).toEqual({
      rows: [],
      fileErrors: ["CSV row 2 must contain exactly two columns."],
    });
  });

  it("normalizes only BOM and header padding, while omitting wholly blank CSV records", () => {
    expect(parseReplacementCsv("\uFEFF find , replace \n TermA , TermB \n,\n")).toEqual({
      rows: [{ id: "csv-2", sourceRow: 2, find: " TermA ", replace: " TermB " }],
      fileErrors: [],
    });
  });

  it("stops replacement-CSV row work at the mapping ceiling", () => {
    const csv = [
      "find,replace",
      ...Array.from({ length: 501 }, (_, index) => `source-${index},replacement-${index}`),
      "poison,row,that,must,not,be,visited",
    ].join("\n");

    const result = parseReplacementCsv(csv);

    expect(result.rows).toHaveLength(500);
    expect(result.fileErrors).toEqual(["CSV cannot contain more than 500 replacement mappings."]);
  });

  it("rejects an over-budget multibyte replacement CSV before row parsing", () => {
    const result = parseReplacementCsv(
      "é".repeat(Math.floor(MAX_CONTENT_REPLACEMENT_CSV_INPUT_BYTES / 2) + 1),
    );

    expect(result).toEqual({
      rows: [],
      fileErrors: ["Replacement CSV exceeds the 1 MiB UTF-8 limit."],
    });
  });
});
