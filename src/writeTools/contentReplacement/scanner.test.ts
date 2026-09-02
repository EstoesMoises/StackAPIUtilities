import { describe, expect, it } from "vitest";

import type {
  AnswerSummary,
  ArticleSummary,
  ContentInventoryPage,
  ContentReplacementClient,
  QuestionSummary,
} from "./contentApi";
import { scanDetailBatch, scanInventorySlice } from "./scanner";
import type {
  ReplacementConfiguration,
  ReplacementItemRef,
  ReplacementRequestModel,
} from "./types";

const configuration: ReplacementConfiguration = {
  target: { kind: "enterprise-main" },
  contentTypes: { questions: true, answers: true, articles: true },
  rules: [{ id: "r1", find: "MyPVM", replace: "MyPBM" }],
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

  async getItem(ref: ReplacementItemRef) {
    this.itemCalls.push(ref);
    return this.readItem(ref);
  }

  async updateItem() {}
}

describe("bounded content replacement scanning", () => {
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
    });
    expect(client.inventoryCalls).toEqual(["questions:1"]);
  });

  it("inventories questions for answer cursors without emitting unselected question candidates", async () => {
    const client = new FakeContentClient({
      questions: page([{ id: 10, title: "MyPVM", body: "<p>MyPVM</p>" }], 1, false),
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
        { id: 10, title: "Safe", body: "<p>Use My&#80;VM here.</p>" },
        { id: 11, title: "mypvm", body: "<p>Safe</p>" },
        { id: 12, title: "MyPVM2", body: "<p>Safe</p>" },
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
      answers: page([{ id: 8, questionId: 10, body: "<b>My</b>PVM" }]),
    });

    const result = await scanInventorySlice(client, {
      cursor: { kind: "answers", questionId: 10, page: 1 },
      configuration,
    });

    expect(result.candidates).toEqual([{ kind: "answer", questionId: 10, answerId: 8 }]);
  });

  it("does not inspect URL attributes, comments, scripts, or styles as visible text", async () => {
    const client = new FakeContentClient({
      articles: page([
        {
          id: 7,
          title: "Safe",
          body: '<a href="https://MyPVM.example">docs</a><!-- MyPVM --><script>MyPVM</script><style>.MyPVM{}</style>',
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
        answers: page([{ id: 8, questionId: 10, body: "MyPVM" }], 2, true),
      }),
      { cursor: { kind: "answers", questionId: 10, page: 2 }, configuration: disabled },
    );
    const articleResult = await scanInventorySlice(
      new FakeContentClient({ articles: page([{ id: 7, title: "MyPVM", body: "safe" }]) }),
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
        body: "Canonical MyPVM Markdown",
        tags: [],
      },
    }));

    const result = await scanDetailBatch(client, {
      refs: [{ kind: "question", questionId: 10 }],
      configuration,
    });

    expect(result.proposals[0].before.request.body).toBe("Canonical MyPVM Markdown");
    expect(result.proposals[0].after.request.body).toBe("Canonical MyPBM Markdown");
    expect(result.inspectedCount).toBe(1);
  });

  it("omits canonical details that yield no proposal and counts protected occurrences", async () => {
    const client = new FakeContentClient({}, async (ref) => ({
      kind: "answer",
      ref: ref as Extract<ReplacementItemRef, { kind: "answer" }>,
      request: { body: "`MyPVM` and MyPVM" },
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
            request: { body: "`MyPVM` and MyPVM" },
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
    return { kind: "answer", ref, request: { body: `MyPVM answer ${ref.answerId}` } };
  }
  if (ref.kind === "article") {
    return {
      kind: "article",
      ref,
      request: {
        title: `MyPVM article ${ref.articleId}`,
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
    request: { title: `MyPVM question ${ref.questionId}`, body: "Safe", tags: [] },
  };
}
