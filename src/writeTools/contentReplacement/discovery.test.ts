import { describe, expect, it } from "vitest";
import {
  createExactTargetCsvTemplate,
  createExactTargetSelection,
  getDiscoveryPresentation,
  normalizeExactTargets,
  parseExactTargetCsv,
  parseExactTargetLines,
} from "./discovery";

const ORIGIN = "https://demo.example.test";

describe("exact replacement targets", () => {
  it("parses same-origin canonical URLs and deduplicates normalized references", () => {
    const result = parseExactTargetLines([
      "https://demo.example.test/questions/42",
      "https://demo.example.test/questions/42/87#87",
      "https://demo.example.test/articles/9",
      "https://demo.example.test/questions/42",
    ].join("\n"), ORIGIN);

    expect(result.errors).toEqual([]);
    expect(result.targets).toEqual([
      { kind: "question", questionId: 42 },
      { kind: "answer", questionId: 42, answerId: 87 },
      { kind: "article", articleId: 9 },
    ]);
    expect(result.duplicateCount).toBe(1);
  });

  it("accepts supported question and article URL path variants", () => {
    const result = parseExactTargetLines([
      "https://demo.example.test/questions/42/a-question-title",
      "https://demo.example.test/questions/42/a-question-title/87#87",
      "https://demo.example.test/questions/42/answers/88",
      "https://demo.example.test/articles/9/an-article-title",
    ].join("\n"), ORIGIN);

    expect(result).toMatchObject({
      errors: [],
      targets: [
        { kind: "question", questionId: 42 },
        { kind: "answer", questionId: 42, answerId: 87 },
        { kind: "answer", questionId: 42, answerId: 88 },
        { kind: "article", articleId: 9 },
      ],
    });
  });

  it("rejects origins, credentials, queries, and malformed fragments", () => {
    expect(parseExactTargetLines("https://other.test/questions/42", ORIGIN).errors[0]?.code)
      .toBe("wrong-origin");
    expect(parseExactTargetLines("https://user:password@demo.example.test/questions/42", ORIGIN).errors[0]?.code)
      .toBe("credentials-not-allowed");
    expect(parseExactTargetLines("https://demo.example.test/questions/42?view=all", ORIGIN).errors[0]?.code)
      .toBe("query-not-allowed");
    expect(parseExactTargetLines("https://demo.example.test/questions/42/87#86", ORIGIN).errors[0]?.code)
      .toBe("malformed-fragment");
    expect(parseExactTargetLines("https://demo.example.test/questions/42/87#", ORIGIN).errors[0]?.code)
      .toBe("malformed-fragment");
  });

  it("parses typed CSV target rows with positive safe integer identifiers", () => {
    const result = parseExactTargetCsv([
      "type,id,parent_question_id",
      "question,42,",
      "answer,87,42",
      "article,9,",
    ].join("\n"), ORIGIN);

    expect(result).toEqual({
      targets: [
        { kind: "question", questionId: 42 },
        { kind: "answer", questionId: 42, answerId: 87 },
        { kind: "article", articleId: 9 },
      ],
      errors: [],
      duplicateCount: 0,
    });
  });

  it("rejects answers without a parent question and invalid numeric CSV identifiers", () => {
    expect(parseExactTargetCsv("type,id,parent_question_id\nanswer,87,", ORIGIN).errors[0]?.code)
      .toBe("missing-parent-question");
    expect(parseExactTargetCsv("type,id,parent_question_id\nquestion,0,", ORIGIN).errors[0]?.code)
      .toBe("invalid-id");
    expect(parseExactTargetCsv("type,id,parent_question_id\narticle,1.5,", ORIGIN).errors[0]?.code)
      .toBe("invalid-id");
    expect(parseExactTargetCsv("type,id,parent_question_id\narticle,9007199254740992,", ORIGIN).errors[0]?.code)
      .toBe("invalid-id");
  });

  it("requires exact CSV headers and rejects extra columns", () => {
    expect(createExactTargetCsvTemplate()).toBe("type,id,parent_question_id\n");
    expect(parseExactTargetCsv("type,id\nquestion,42", ORIGIN).errors[0]?.code)
      .toBe("invalid-headers");
    expect(parseExactTargetCsv("type,id,parent_question_id\nquestion,42,,unexpected", ORIGIN).errors[0]?.code)
      .toBe("extra-columns");
  });

  it("normalizes to stable first-seen target order and rejects more than 100,000 targets", () => {
    expect(normalizeExactTargets([
      { kind: "article", articleId: 9 },
      { kind: "question", questionId: 42 },
      { kind: "article", articleId: 9 },
      { kind: "answer", questionId: 42, answerId: 87 },
    ])).toEqual([
      { kind: "article", articleId: 9 },
      { kind: "question", questionId: 42 },
      { kind: "answer", questionId: 42, answerId: 87 },
    ]);

    expect(() => normalizeExactTargets(
      Array.from({ length: 100_001 }, (_, index) => ({ kind: "question" as const, questionId: index + 1 })),
    )).toThrow("100,000");
  });

  it("creates a compact exact descriptor from stable normalized targets", async () => {
    const first = await createExactTargetSelection([
      { kind: "question", questionId: 42 },
      { kind: "question", questionId: 42 },
      { kind: "article", articleId: 9 },
    ]);
    const second = await createExactTargetSelection([
      { kind: "question", questionId: 42 },
      { kind: "article", articleId: 9 },
    ]);

    expect(first.targets).toEqual([
      { kind: "question", questionId: 42 },
      { kind: "article", articleId: 9 },
    ]);
    expect(first.discovery).toEqual({
      mode: "exact",
      targetCount: 2,
      targetDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(first.discovery.targetDigest).toBe(second.discovery.targetDigest);
  });

  it("rejects an empty exact selection before producing an invalid descriptor", async () => {
    await expect(createExactTargetSelection([])).rejects.toThrow("at least one");
  });

  it("excludes non-reference row metadata from normalized targets and their digest", async () => {
    const annotated = { kind: "question" as const, questionId: 42, sourceRow: 7 };
    const normalized = normalizeExactTargets([annotated]);
    const annotatedSelection = await createExactTargetSelection([annotated]);
    const canonicalSelection = await createExactTargetSelection([{ kind: "question", questionId: 42 }]);

    expect(normalized).toEqual([{ kind: "question", questionId: 42 }]);
    expect(annotatedSelection.discovery.targetDigest).toBe(canonicalSelection.discovery.targetDigest);
  });

  it("returns immutable coverage copy for every discovery mode", () => {
    expect(getDiscoveryPresentation({ mode: "targeted" })).toEqual({
      label: "Search-assisted · may miss matches",
      exhaustive: false,
    });
    expect(getDiscoveryPresentation({ mode: "exact", targetCount: 3, targetDigest: "a".repeat(64) })).toEqual({
      label: "Exact target list · complete for 3 supplied posts",
      exhaustive: true,
    });
    expect(getDiscoveryPresentation({ mode: "full" })).toEqual({
      label: "Exhaustive · all accessible selected content",
      exhaustive: true,
    });
    expect(Object.isFrozen(getDiscoveryPresentation({ mode: "full" }))).toBe(true);
  });
});
