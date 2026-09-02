import { describe, expect, it } from "vitest";
import {
  createExactTargetCsvTemplate,
  createExactTargetSelection,
  getDiscoveryPresentation,
  normalizeExactTargets,
  parseExactTargetCsv,
  parseExactTargetLines,
  verifyExactTargetProof,
} from "./discovery";
import {
  MAX_CONTENT_REPLACEMENT_EXACT_TARGETS,
  MAX_CONTENT_REPLACEMENT_PASTE_BYTES,
} from "./limits";

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
      { kind: "answer", questionId: 42, answerId: 87 },
      { kind: "article", articleId: 9 },
      { kind: "question", questionId: 42 },
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
        { kind: "answer", questionId: 42, answerId: 87 },
        { kind: "answer", questionId: 42, answerId: 88 },
        { kind: "article", articleId: 9 },
        { kind: "question", questionId: 42 },
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
        { kind: "answer", questionId: 42, answerId: 87 },
        { kind: "article", articleId: 9 },
        { kind: "question", questionId: 42 },
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

  it("normalizes to a stable canonical order and rejects more than 5,000 targets", () => {
    expect(normalizeExactTargets([
      { kind: "article", articleId: 9 },
      { kind: "question", questionId: 42 },
      { kind: "article", articleId: 9 },
      { kind: "answer", questionId: 42, answerId: 87 },
    ])).toEqual([
      { kind: "answer", questionId: 42, answerId: 87 },
      { kind: "article", articleId: 9 },
      { kind: "question", questionId: 42 },
    ]);

    expect(() => normalizeExactTargets(
      Array.from({ length: 5_001 }, (_, index) => ({ kind: "question" as const, questionId: index + 1 })),
    )).toThrow("5,000");
  });

  it("stops pasted-target row work at the unique-target ceiling", () => {
    const value = [
      ...Array.from(
        { length: MAX_CONTENT_REPLACEMENT_EXACT_TARGETS + 1 },
        (_, index) => `${ORIGIN}/questions/${index + 1}`,
      ),
      "https://different.example.test/questions/1",
    ].join("\n");

    const result = parseExactTargetLines(value, ORIGIN);

    expect(result.targets).toHaveLength(MAX_CONTENT_REPLACEMENT_EXACT_TARGETS);
    expect(result.errors).toEqual([{
      code: "too-many-targets",
      sourceLine: MAX_CONTENT_REPLACEMENT_EXACT_TARGETS + 1,
    }]);
  });

  it("stops target-CSV row work at the unique-target ceiling", () => {
    const value = [
      "type,id,parent_question_id",
      ...Array.from(
        { length: MAX_CONTENT_REPLACEMENT_EXACT_TARGETS + 1 },
        (_, index) => `question,${index + 1},`,
      ),
      "question,1,,unexpected",
    ].join("\n");

    const result = parseExactTargetCsv(value, ORIGIN);

    expect(result.targets).toHaveLength(MAX_CONTENT_REPLACEMENT_EXACT_TARGETS);
    expect(result.errors).toEqual([{
      code: "too-many-targets",
      sourceLine: MAX_CONTENT_REPLACEMENT_EXACT_TARGETS + 2,
    }]);
  });

  it("rejects an over-budget multibyte paste before URL row parsing", () => {
    const result = parseExactTargetLines(
      "é".repeat(Math.floor(MAX_CONTENT_REPLACEMENT_PASTE_BYTES / 2) + 1),
      ORIGIN,
    );

    expect(result).toEqual({
      targets: [],
      errors: [{ code: "input-too-large", sourceLine: 1 }],
      duplicateCount: 0,
    });
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
      { kind: "article", articleId: 9 },
      { kind: "question", questionId: 42 },
    ]);
    expect(first.discovery).toEqual({
      mode: "exact",
      targetCount: 2,
      targetDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(first.discovery.targetDigest).toBe(second.discovery.targetDigest);
  });

  it("creates versioned Merkle membership proofs that bind every canonical ref to the manifest", async () => {
    const first = await createExactTargetSelection([
      { kind: "question", questionId: 42 },
      { kind: "article", articleId: 9 },
      { kind: "answer", questionId: 42, answerId: 87 },
    ]);
    const reordered = await createExactTargetSelection([...first.targets].reverse());

    expect(first.discovery.targetDigest).toBe(reordered.discovery.targetDigest);
    expect(first.proofs).toHaveLength(first.targets.length);
    await Promise.all(first.targets.map(async (target, index) => {
      expect(first.proofs[index]).toMatchObject({
        algorithm: "sha256-merkle",
        version: 1,
        targetCount: first.targets.length,
        targetIndex: index,
        manifestRoot: first.discovery.targetDigest,
      });
      await expect(verifyExactTargetProof(target, first.proofs[index], first.discovery)).resolves.toBe(true);
    }));
  });

  it("rejects Merkle proofs with a forged ref, index, count, root, sibling, algorithm, or version", async () => {
    const selection = await createExactTargetSelection([
      { kind: "question", questionId: 42 },
      { kind: "article", articleId: 9 },
      { kind: "answer", questionId: 42, answerId: 87 },
    ]);
    const proof = selection.proofs[0];
    const forged = [
      [{ kind: "question", questionId: 999 }, proof, selection.discovery],
      [selection.targets[0], { ...proof, targetIndex: 1 }, selection.discovery],
      [selection.targets[0], { ...proof, targetCount: 4 }, selection.discovery],
      [selection.targets[0], { ...proof, manifestRoot: "0".repeat(64) }, selection.discovery],
      [selection.targets[0], { ...proof, siblingHashes: ["0".repeat(64), ...proof.siblingHashes.slice(1)] }, selection.discovery],
      [selection.targets[0], { ...proof, algorithm: "sha256" }, selection.discovery],
      [selection.targets[0], { ...proof, version: 2 }, selection.discovery],
    ] as const;

    for (const [target, candidate, discovery] of forged) {
      await expect(verifyExactTargetProof(target, candidate, discovery)).resolves.toBe(false);
    }
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
