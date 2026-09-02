import { describe, expect, it } from "vitest";
import {
  createContentReplacementClient,
  type ContentInventoryPage,
  type ContentApiTransport,
} from "./contentApi";

class FakeTransport implements ContentApiTransport {
  readonly pageCalls: Array<{ path: string; query: Record<string, string>; page: number }> = [];
  readonly jsonCalls: string[] = [];
  readonly putCalls: Array<{ path: string; body: unknown }> = [];

  constructor(
    private readonly detail: unknown = {},
    private readonly page: ContentInventoryPage<unknown> = {
      items: [], page: 1, totalPages: 1, hasMore: false,
    },
  ) {}

  async getPage<T>(
    path: string,
    query: Record<string, string>,
    page: number,
  ): Promise<ContentInventoryPage<T>> {
    this.pageCalls.push({ path, query, page });
    return this.page as ContentInventoryPage<T>;
  }

  async getJson<T>(path: string) {
    this.jsonCalls.push(path);
    return this.detail as T;
  }

  async putJson<T>(path: string, body: unknown) {
    this.putCalls.push({ path, body });
    return {} as T;
  }
}

describe("content replacement API adapter", () => {
  it("fetches inventory pages from the main-site paths and preserves summary HTML", async () => {
    const transport = new FakeTransport(undefined, {
      items: [{ id: 42, title: "<b>MyPVM</b>", body: "<p>Use MyPVM.</p>" }],
      page: 3,
      totalPages: 4,
      hasMore: true,
    });
    const client = createContentReplacementClient(transport);

    await expect(client.getQuestionsPage(3)).resolves.toEqual({
      items: [{ id: 42, title: "<b>MyPVM</b>", body: "<p>Use MyPVM.</p>" }],
      page: 3,
      totalPages: 4,
      hasMore: true,
    });
    await client.getAnswersPage(42, 2);
    await client.getArticlesPage(1);

    expect(transport.pageCalls).toEqual([
      { path: "/questions", query: { pageSize: "100" }, page: 3 },
      { path: "/questions/42/answers", query: { pageSize: "100" }, page: 2 },
      { path: "/articles", query: { pageSize: "100" }, page: 1 },
    ]);
  });

  it("adds the parent question identity to answer inventory", async () => {
    const transport = new FakeTransport(undefined, {
      items: [{ id: 8, body: "<p>MyPVM</p>" }],
      page: 1,
      totalPages: 1,
      hasMore: false,
    });

    await expect(createContentReplacementClient(transport).getAnswersPage(42, 1)).resolves.toEqual({
      items: [{ id: 8, questionId: 42, body: "<p>MyPVM</p>" }],
      page: 1,
      totalPages: 1,
      hasMore: false,
    });
  });

  it("reconstructs a question request from canonical Markdown and tag names in order", async () => {
    const transport = new FakeTransport({
      id: 42,
      title: "MyPVM setup",
      bodyMarkdown: "Use MyPVM.",
      tags: [{ name: "support" }, { name: "product" }],
      owner: { id: 3, name: "Ada" },
      lastEditor: { id: 4, name: "Grace" },
      webUrl: "https://demo.stackenterprise.co/questions/42",
      lastActivityDate: "2026-09-01T12:00:00Z",
    });

    await expect(createContentReplacementClient(transport).getItem({ kind: "question", questionId: 42 }))
      .resolves.toEqual({
        kind: "question",
        ref: { kind: "question", questionId: 42 },
        request: { title: "MyPVM setup", body: "Use MyPVM.", tags: ["support", "product"] },
        metadata: {
          owner: { id: 3, name: "Ada" },
          lastEditor: { id: 4, name: "Grace" },
          webUrl: "https://demo.stackenterprise.co/questions/42",
          lastActivityDate: "2026-09-01T12:00:00Z",
        },
      });
    expect(transport.jsonCalls).toEqual(["/questions/42"]);
  });

  it("reconstructs an answer request only from its canonical Markdown", async () => {
    const transport = new FakeTransport({ id: 8, bodyMarkdown: "Use MyPVM." });

    await expect(
      createContentReplacementClient(transport).getItem({ kind: "answer", questionId: 42, answerId: 8 }),
    ).resolves.toEqual({
      kind: "answer",
      ref: { kind: "answer", questionId: 42, answerId: 8 },
      request: { body: "Use MyPVM." },
    });
    expect(transport.jsonCalls).toEqual(["/questions/42/answers/8"]);
  });

  it("converts an article detail response into the exact allowed PUT model", async () => {
    const transport = new FakeTransport({
      id: 7,
      title: "MyPVM policy",
      bodyMarkdown: "Use MyPVM.",
      tags: [{ name: "product" }],
      type: "policy",
      expirationDate: null,
      permissions: {
        editableBy: "specificEditors",
        editorUsers: [{ id: 2 }],
        editorUserGroups: [{ id: 8 }],
      },
      owner: { id: 3, name: "Ada" },
      lastActivityDate: "2026-09-01T12:00:00Z",
    });

    await expect(createContentReplacementClient(transport).getItem({ kind: "article", articleId: 7 }))
      .resolves.toEqual({
        kind: "article",
        ref: { kind: "article", articleId: 7 },
        request: {
          title: "MyPVM policy",
          body: "Use MyPVM.",
          tags: ["product"],
          type: "policy",
          expirationDate: null,
          permissions: {
            editableBy: "specificEditors",
            editorUserIds: [2],
            editorUserGroupIds: [8],
          },
        },
        metadata: {
          owner: { id: 3, name: "Ada" },
          lastActivityDate: "2026-09-01T12:00:00Z",
        },
      });
  });

  it("keeps optional article editor arrays empty and preserves an omitted expiration date", async () => {
    const transport = new FakeTransport({
      id: 7,
      title: "MyPVM policy",
      bodyMarkdown: "Use MyPVM.",
      tags: [],
      type: "knowledgeArticle",
      permissions: { editableBy: "ownerOnly" },
    });

    await expect(createContentReplacementClient(transport).getItem({ kind: "article", articleId: 7 }))
      .resolves.toMatchObject({
        request: {
          permissions: { editableBy: "ownerOnly", editorUserIds: [], editorUserGroupIds: [] },
        },
      });
    await expect(createContentReplacementClient(transport).getItem({ kind: "article", articleId: 7 }))
      .resolves.not.toHaveProperty("request.expirationDate");
  });

  it("omits malformed optional metadata while retaining a safe request", async () => {
    const transport = new FakeTransport({
      id: 42,
      title: "MyPVM setup",
      bodyMarkdown: "Use MyPVM.",
      tags: [],
      owner: { id: "3", name: 2 },
      lastEditor: { id: 4, name: 2 },
      webUrl: 42,
      lastActivityDate: {},
    });

    await expect(createContentReplacementClient(transport).getItem({ kind: "question", questionId: 42 }))
      .resolves.toEqual({
        kind: "question",
        ref: { kind: "question", questionId: 42 },
        request: { title: "MyPVM setup", body: "Use MyPVM.", tags: [] },
        metadata: { lastEditor: { id: 4 } },
      });
  });

  it.each([
    ["question", { kind: "question", questionId: 42 }, { id: 42, title: "title", body: "unsafe HTML", tags: [] }],
    ["answer", { kind: "answer", questionId: 42, answerId: 8 }, { bodyMarkdown: "safe" }],
    ["article", { kind: "article", articleId: 7 }, { id: 7, title: "title", bodyMarkdown: "safe", tags: [{ name: "product" }], type: "policy", permissions: { editableBy: "nobody" } }],
  ] as const)("rejects incomplete %s details without exposing upstream content", async (kind, ref, detail) => {
    const transport = new FakeTransport(detail);

    await expect(createContentReplacementClient(transport).getItem(ref)).rejects.toThrow(
      `Unable to reconstruct ${kind} ${kind === "answer" ? ref.answerId : kind === "article" ? ref.articleId : ref.questionId}.`,
    );
    await expect(createContentReplacementClient(transport).getItem(ref)).rejects.not.toThrow(/unsafe HTML|nobody/);
  });

  it("rejects a detail response whose ID does not match the requested item", async () => {
    const transport = new FakeTransport({ id: 9, bodyMarkdown: "safe" });

    await expect(
      createContentReplacementClient(transport).getItem({ kind: "answer", questionId: 42, answerId: 8 }),
    ).rejects.toThrow("Unable to reconstruct answer 8.");
  });

  it("writes only the reconstructed request to the matching PUT path", async () => {
    const transport = new FakeTransport();
    const client = createContentReplacementClient(transport);

    await client.updateItem({
      kind: "article",
      ref: { kind: "article", articleId: 7 },
      request: {
        title: "MyPBM policy",
        body: "Use MyPBM.",
        tags: ["product"],
        type: "policy",
        expirationDate: null,
        permissions: { editableBy: "specificEditors", editorUserIds: [2], editorUserGroupIds: [8] },
      },
      metadata: { owner: { id: 3, name: "Ada" } },
    });

    expect(transport.putCalls).toEqual([{
      path: "/articles/7",
      body: {
        title: "MyPBM policy",
        body: "Use MyPBM.",
        tags: ["product"],
        type: "policy",
        expirationDate: null,
        permissions: { editableBy: "specificEditors", editorUserIds: [2], editorUserGroupIds: [8] },
      },
    }]);
  });
});
