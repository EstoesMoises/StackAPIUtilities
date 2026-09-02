import { describe, expect, it } from "vitest";

import type {
  AnswerSummary,
  ArticleSummary,
  ContentInventoryPage,
  ContentReplacementClient,
  QuestionSummary,
  SearchSummary,
} from "./contentApi";
import { scanDetailBatch, scanInventorySlice } from "./scanner";
import { createExactTargetSelection } from "./discovery";
import type {
  ReplacementConfiguration,
  ReplacementItemRef,
  ReplacementRequestModel,
} from "./types";
import { MAX_CONTENT_REPLACEMENT_REQUEST_MODEL_BYTES } from "./limits";

const configuration: ReplacementConfiguration = {
  target: { kind: "enterprise-main" },
  contentTypes: { questions: true, answers: true, articles: true },
  discovery: { mode: "full" },
  rules: [{ id: "r1", find: "TermA", replace: "TermB" }],
  options: { caseSensitive: true, wholeTerm: true, replaceInCode: false },
};

class FakeContentClient implements ContentReplacementClient {
  readonly itemCalls: ReplacementItemRef[] = [];
  readonly inventoryCalls: string[] = [];

  constructor(
    private readonly pages: {
      questions?: ContentInventoryPage<QuestionSummary>;
      answers?: ContentInventoryPage<AnswerSummary>;
      articles?: ContentInventoryPage<ArticleSummary>;
      search?: ContentInventoryPage<SearchSummary>;
    } = {},
    private readonly readItem: (ref: ReplacementItemRef) => Promise<ReplacementRequestModel> =
      async (ref) => modelFor(ref),
  ) {}

  async getQuestionsPage(page: number) {
    this.inventoryCalls.push(`questions:${page}`);
    return this.pages.questions ?? emptyPage<QuestionSummary>(page);
  }

  async getAnswersPage(questionId: number, page: number) {
    this.inventoryCalls.push(`answers:${questionId}:${page}`);
    return this.pages.answers ?? emptyPage<AnswerSummary>(page);
  }

  async getArticlesPage(page: number) {
    this.inventoryCalls.push(`articles:${page}`);
    return this.pages.articles ?? emptyPage<ArticleSummary>(page);
  }

  async getSearchPage(query: string, page: number) {
    this.inventoryCalls.push(`search:${query}:${page}`);
    return this.pages.search ?? emptyPage<SearchSummary>(page);
  }

  async getItem(ref: ReplacementItemRef) {
    this.itemCalls.push(ref);
    return this.readItem(ref);
  }

  async updateItem() {}
}

describe("bounded content replacement scanning", () => {
  it("does not propose an aggregate-over-budget model that cannot be recovered", async () => {
    const ref: ReplacementItemRef = { kind: "question", questionId: 1 };
    const oversized: ReplacementRequestModel = {
      kind: "question",
      ref,
      request: { title: "TermA product", body: "é".repeat(1_048_576), tags: [] },
    };
    expect(new TextEncoder().encode(JSON.stringify(oversized)).byteLength)
      .toBeGreaterThan(MAX_CONTENT_REPLACEMENT_REQUEST_MODEL_BYTES);
    const client = new FakeContentClient({}, async () => oversized);

    await expect(scanDetailBatch(client, { refs: [ref], configuration })).rejects.toThrow(
      "Content replacement request model exceeds the 2 MiB recovery-safe limit.",
    );
  });

  it("enqueues answer inventory for every question and returns the next question page", async () => {
    const client = new FakeContentClient({
      questions: page(
        [
          { id: 10, title: "Safe", body: "<p>Safe</p>" },
          { id: 11, title: "Safe", body: "<p>Safe</p>" },
        ],
        1,
        true,
      ),
    });

    const result = await scanInventorySlice(client, {
      cursor: { kind: "questions", page: 1 },
      configuration,
    });

    expect(result).toEqual({
      candidates: [],
      answerCursors: [
        { kind: "answers", questionId: 10, page: 1 },
        { kind: "answers", questionId: 11, page: 1 },
      ],
      nextCursor: { kind: "questions", page: 2 },
      inspectedCount: 2,
      pageKind: "questions",
      progress: {
        apiRequestsCompleted: 1,
        searchPages: 0,
        searchTermsCompleted: 0,
        answerBearingQuestionsQueued: 2,
        zeroAnswerQuestionsSkipped: 0,
      },
    });
    expect(client.inventoryCalls).toEqual(["questions:1"]);
  });

  it.each([
    { answerCount: 0, expected: 0, skipped: 1 },
    { answerCount: 2, expected: 1, skipped: 0 },
    { answerCount: undefined, expected: 1, skipped: 0 },
    { answerCount: -1, expected: 1, skipped: 0 },
    { answerCount: 1.5, expected: 1, skipped: 0 },
    { answerCount: Number.MAX_SAFE_INTEGER + 1, expected: 1, skipped: 0 },
  ])("queues answers conservatively for $answerCount", async ({ answerCount, expected, skipped }) => {
    const client = new FakeContentClient({
      questions: page([{ id: 42, answerCount }]),
    });

    const result = await scanInventorySlice(client, {
      cursor: { kind: "questions", page: 1 },
      configuration,
    });

    expect(result.answerCursors).toHaveLength(expected);
    expect(result.progress.zeroAnswerQuestionsSkipped).toBe(skipped);
  });

  it("uses the configured rule for a targeted search cursor and keeps duplicate result refs", async () => {
    const client = new FakeContentClient({
      search: page([
        { type: "question", questionId: 42 },
        { type: "answer", answerId: 8, parentQuestionId: 42 },
        { type: "article", articleId: 7 },
        { type: "question", questionId: 42 },
      ], 3, true),
    });
    const targeted = { ...configuration, discovery: { mode: "targeted" as const } };

    const result = await scanInventorySlice(client, {
      cursor: { kind: "search", ruleId: "r1", page: 3 },
      configuration: targeted,
    });

    expect(client.inventoryCalls).toEqual(["search:TermA:3"]);
    expect(result).toMatchObject({
      candidates: [
        { kind: "question", questionId: 42 },
        { kind: "answer", questionId: 42, answerId: 8 },
        { kind: "article", articleId: 7 },
        { kind: "question", questionId: 42 },
      ],
      answerCursors: [],
      nextCursor: { kind: "search", ruleId: "r1", page: 4 },
      inspectedCount: 4,
      pageKind: "search",
      progress: {
        apiRequestsCompleted: 1,
        searchPages: 1,
        searchTermsCompleted: 0,
        answerBearingQuestionsQueued: 0,
        zeroAnswerQuestionsSkipped: 0,
      },
    });
  });

  it("filters unselected targeted search result types and completes the rule on its final page", async () => {
    const client = new FakeContentClient({
      search: page([
        { type: "question", questionId: 42 },
        { type: "answer", answerId: 8, parentQuestionId: 42 },
        { type: "article", articleId: 7 },
      ]),
    });
    const targeted = {
      ...configuration,
      discovery: { mode: "targeted" as const },
      contentTypes: { questions: false, answers: true, articles: false },
    };

    const result = await scanInventorySlice(client, {
      cursor: { kind: "search", ruleId: "r1", page: 1 },
      configuration: targeted,
    });

    expect(result.candidates).toEqual([{ kind: "answer", questionId: 42, answerId: 8 }]);
    expect(result.nextCursor).toBeNull();
    expect(result.progress.searchTermsCompleted).toBe(1);
  });

  it.each([
    [{ mode: "full" as const }, { kind: "search", ruleId: "r1", page: 1 }],
    [{ mode: "targeted" as const }, { kind: "questions", page: 1 }],
    [{ mode: "exact" as const, targetCount: 1, targetDigest: "digest" }, { kind: "articles", page: 1 }],
  ])("rejects an inventory cursor that does not match its discovery mode", async (discovery, cursor) => {
    const client = new FakeContentClient();

    await expect(scanInventorySlice(client, {
      cursor: cursor as Parameters<typeof scanInventorySlice>[1]["cursor"],
      configuration: { ...configuration, discovery },
    })).rejects.toThrow("Inventory cursor does not match replacement discovery mode.");
    expect(client.inventoryCalls).toEqual([]);
  });

  it("inventories questions for answer cursors without emitting unselected question candidates", async () => {
    const client = new FakeContentClient({
      questions: page([{ id: 10, title: "TermA", body: "<p>TermA</p>" }], 1, false),
    });

    const result = await scanInventorySlice(client, {
      cursor: { kind: "questions", page: 1 },
      configuration: {
        ...configuration,
        contentTypes: { questions: false, answers: true, articles: false },
      },
    });

    expect(result.candidates).toEqual([]);
    expect(result.answerCursors).toEqual([{ kind: "answers", questionId: 10, page: 1 }]);
    expect(result.inspectedCount).toBe(1);
    expect(client.inventoryCalls).toEqual(["questions:1"]);
  });

  it("decodes HTML text and matches case and whole-term semantics conservatively", async () => {
    const client = new FakeContentClient({
      questions: page([
        { id: 10, title: "Safe", body: "<p>Use Te&#114;mA here.</p>" },
        { id: 11, title: "terma", body: "<p>Safe</p>" },
        { id: 12, title: "TermA2", body: "<p>Safe</p>" },
      ]),
    });

    const result = await scanInventorySlice(client, {
      cursor: { kind: "questions", page: 1 },
      configuration: {
        ...configuration,
        options: { ...configuration.options, caseSensitive: false },
      },
    });

    expect(result.candidates).toEqual([
      { kind: "question", questionId: 10 },
      { kind: "question", questionId: 11 },
    ]);
  });

  it("matches terms split across visible HTML text nodes", async () => {
    const client = new FakeContentClient({
      answers: page([{ id: 8, questionId: 10, body: "<b>Term</b>A" }]),
    });

    const result = await scanInventorySlice(client, {
      cursor: { kind: "answers", questionId: 10, page: 1 },
      configuration,
    });

    expect(result.candidates).toEqual([{ kind: "answer", questionId: 10, answerId: 8 }]);
  });

  it("keeps whole-term matches when a following block starts with a word character", async () => {
    const client = new FakeContentClient({
      questions: page([{ id: 10, title: "Safe", body: "<p>TermA</p><p>x</p>" }]),
    });

    const result = await scanInventorySlice(client, {
      cursor: { kind: "questions", page: 1 },
      configuration,
    });

    expect(result.candidates).toEqual([{ kind: "question", questionId: 10 }]);
  });

  it("checks literal markup-like question titles in addition to decoded HTML text", async () => {
    const client = new FakeContentClient({
      questions: page([{ id: 10, title: "Compare <TermA> APIs", body: "<p>Safe</p>" }]),
    });

    const result = await scanInventorySlice(client, {
      cursor: { kind: "questions", page: 1 },
      configuration,
    });

    expect(result.candidates).toEqual([{ kind: "question", questionId: 10 }]);
  });

  it("does not inspect URL attributes, comments, scripts, or styles as visible text", async () => {
    const client = new FakeContentClient({
      articles: page([
        {
          id: 7,
          title: "Safe",
          body: '<a href="https://TermA.example">docs</a><!-- TermA --><script>TermA</script><style>.TermA{}</style>',
        },
      ]),
    });

    const result = await scanInventorySlice(client, {
      cursor: { kind: "articles", page: 1 },
      configuration,
    });

    expect(result.candidates).toEqual([]);
  });

  it("keeps an uninspectable summary as a candidate instead of risking a false negative", async () => {
    const client = new FakeContentClient({
      questions: page([{ id: 10, title: "Safe", body: null }]),
    });

    const result = await scanInventorySlice(client, {
      cursor: { kind: "questions", page: 1 },
      configuration,
    });

    expect(result.candidates).toEqual([{ kind: "question", questionId: 10 }]);
  });

  it("only emits answer and article candidates when their content types are selected", async () => {
    const disabled = {
      ...configuration,
      contentTypes: { questions: true, answers: false, articles: false },
    };
    const answerResult = await scanInventorySlice(
      new FakeContentClient({
        answers: page([{ id: 8, questionId: 10, body: "TermA" }], 2, true),
      }),
      { cursor: { kind: "answers", questionId: 10, page: 2 }, configuration: disabled },
    );
    const articleResult = await scanInventorySlice(
      new FakeContentClient({ articles: page([{ id: 7, title: "TermA", body: "safe" }]) }),
      { cursor: { kind: "articles", page: 1 }, configuration: disabled },
    );

    expect(answerResult.candidates).toEqual([]);
    expect(answerResult.nextCursor).toEqual({ kind: "answers", questionId: 10, page: 3 });
    expect(articleResult.candidates).toEqual([]);
    expect(articleResult.nextCursor).toBeNull();
  });

  it("propagates an inventory failure without returning a completion-shaped result", async () => {
    const failure = new Error("Unable to read question inventory.");
    const client = new FakeContentClient();
    client.getQuestionsPage = async () => {
      throw failure;
    };

    await expect(
      scanInventorySlice(client, {
        cursor: { kind: "questions", page: 1 },
        configuration,
      }),
    ).rejects.toBe(failure);
  });

  it("builds proposals only from canonical detail Markdown", async () => {
    const client = new FakeContentClient({}, async () => ({
      kind: "question",
      ref: { kind: "question", questionId: 10 },
      request: {
        title: "Safe canonical title",
        body: "Canonical TermA Markdown",
        tags: [],
      },
    }));

    const result = await scanDetailBatch(client, {
      refs: [{ kind: "question", questionId: 10 }],
      configuration,
    });

    expect(result.proposals[0].before.request.body).toBe("Canonical TermA Markdown");
    expect(result.proposals[0].after.request.body).toBe("Canonical TermB Markdown");
    expect(result.inspectedCount).toBe(1);
  });

  it("validates Exact membership proofs before I/O and retains them on every proposal", async () => {
    const selection = await createExactTargetSelection([
      { kind: "question", questionId: 10 },
      { kind: "question", questionId: 11 },
    ]);
    const exactConfiguration: ReplacementConfiguration = {
      ...configuration,
      discovery: selection.discovery,
      rules: [{ id: "r1", find: "LegacyProduct", replace: "NewProduct" }],
    };
    const client = new FakeContentClient({}, async (ref) => ({
      kind: "question",
      ref: ref as Extract<ReplacementItemRef, { kind: "question" }>,
      request: { title: "LegacyProduct", body: "Safe", tags: [] },
    }));

    const result = await scanDetailBatch(client, {
      refs: selection.targets,
      exactProofs: selection.proofs,
      configuration: exactConfiguration,
    });

    expect(result.proposals.map((proposal) => proposal.exactProof)).toEqual(selection.proofs);

    const forgedProofs = [{ ...selection.proofs[0], targetIndex: 1 }, selection.proofs[1]];
    const rejectedClient = new FakeContentClient();
    await expect(scanDetailBatch(rejectedClient, {
      refs: selection.targets,
      exactProofs: forgedProofs,
      configuration: exactConfiguration,
    })).rejects.toThrow("Exact manifest proof");
    expect(rejectedClient.itemCalls).toEqual([]);
  });

  it("rejects proof material on non-Exact detail scans before I/O", async () => {
    const selection = await createExactTargetSelection([{ kind: "question", questionId: 10 }]);
    const client = new FakeContentClient();

    await expect(scanDetailBatch(client, {
      refs: selection.targets,
      exactProofs: selection.proofs,
      configuration,
    })).rejects.toThrow("only valid for Exact");
    expect(client.itemCalls).toEqual([]);
  });

  it("omits canonical details that yield no proposal and counts protected occurrences", async () => {
    const client = new FakeContentClient({}, async (ref) => ({
      kind: "answer",
      ref: ref as Extract<ReplacementItemRef, { kind: "answer" }>,
      request: { body: "`TermA` and TermA" },
    }));
    const matchingRef = { kind: "answer" as const, questionId: 10, answerId: 8 };
    const safeRef = { kind: "answer" as const, questionId: 10, answerId: 9 };
    client.getItem = async (ref) => {
      client.itemCalls.push(ref);
      return ref.kind === "answer" && ref.answerId === 9
        ? { kind: "answer", ref, request: { body: "Safe canonical Markdown" } }
        : {
            kind: "answer",
            ref: ref as Extract<ReplacementItemRef, { kind: "answer" }>,
            request: { body: "`TermA` and TermA" },
          };
    };

    const result = await scanDetailBatch(client, {
      refs: [matchingRef, safeRef],
      configuration,
    });

    expect(result.proposals).toHaveLength(1);
    expect(result.inspectedCount).toBe(2);
    expect(result.protectedOccurrenceCount).toBe(1);
  });

  it("counts protected-only canonical body occurrences without creating a proposal", async () => {
    const client = new FakeContentClient({}, async (ref) => ({
      kind: "answer",
      ref: ref as Extract<ReplacementItemRef, { kind: "answer" }>,
      request: { body: "`TermA`" },
    }));

    const result = await scanDetailBatch(client, {
      refs: [{ kind: "answer", questionId: 10, answerId: 8 }],
      configuration,
    });

    expect(result.proposals).toEqual([]);
    expect(result.protectedOccurrenceCount).toBe(1);
  });

  it("rejects empty, duplicate, invalid, and oversized detail batches before I/O", async () => {
    const client = new FakeContentClient();
    const elevenRefs = Array.from({ length: 11 }, (_, index) => ({
      kind: "question" as const,
      questionId: index + 1,
    }));

    await expect(scanDetailBatch(client, { refs: [], configuration })).rejects.toThrow();
    await expect(
      scanDetailBatch(client, {
        refs: [
          { kind: "question", questionId: 1 },
          { kind: "question", questionId: 1 },
        ],
        configuration,
      }),
    ).rejects.toThrow();
    await expect(
      scanDetailBatch(client, {
        refs: [{ kind: "answer", questionId: 1, answerId: 0 }],
        configuration,
      }),
    ).rejects.toThrow();
    await expect(scanDetailBatch(client, { refs: elevenRefs, configuration })).rejects.toThrow();
    expect(client.itemCalls).toEqual([]);
  });

  it("fetches at most four details concurrently while preserving proposal input order", async () => {
    let active = 0;
    let maximumActive = 0;
    const client = new FakeContentClient({}, async (ref) => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await new Promise((resolve) => setTimeout(resolve, ref.kind === "question" ? 7 - ref.questionId : 0));
      active -= 1;
      return modelFor(ref);
    });
    const refs = Array.from({ length: 6 }, (_, index) => ({
      kind: "question" as const,
      questionId: index + 1,
    }));

    const result = await scanDetailBatch(client, { refs, configuration });

    expect(maximumActive).toBe(4);
    expect(result.proposals.map((proposal) => proposal.before.ref)).toEqual(refs);
  });

  it("propagates a detail failure instead of synthesizing a partial result", async () => {
    const failure = new Error("Unable to reconstruct question 2.");
    const client = new FakeContentClient({}, async (ref) => {
      if (ref.kind === "question" && ref.questionId === 2) throw failure;
      return modelFor(ref);
    });

    await expect(
      scanDetailBatch(client, {
        refs: [
          { kind: "question", questionId: 1 },
          { kind: "question", questionId: 2 },
        ],
        configuration,
      }),
    ).rejects.toBe(failure);
  });
});

function page<T>(items: T[], pageNumber = 1, hasMore = false): ContentInventoryPage<T> {
  return { items, page: pageNumber, totalPages: hasMore ? pageNumber + 1 : pageNumber, hasMore };
}

function emptyPage<T>(pageNumber: number): ContentInventoryPage<T> {
  return page<T>([], pageNumber);
}

function modelFor(ref: ReplacementItemRef): ReplacementRequestModel {
  if (ref.kind === "answer") {
    return { kind: "answer", ref, request: { body: `TermA answer ${ref.answerId}` } };
  }
  if (ref.kind === "article") {
    return {
      kind: "article",
      ref,
      request: {
        title: `TermA article ${ref.articleId}`,
        body: "Safe",
        tags: [],
        type: "knowledgeArticle",
        permissions: { editorUserIds: [], editorUserGroupIds: [] },
      },
    };
  }
  return {
    kind: "question",
    ref,
    request: { title: `TermA question ${ref.questionId}`, body: "Safe", tags: [] },
  };
}
