import { describe, expect, it } from "vitest";
import { StackApiError } from "../../api/httpClient";
import { StackApiV3Client } from "../../api/stackApiV3";
import {
  ContentReplacementApiError,
  type ContentReplacementClient,
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
    private readonly failures: { getPage?: unknown; getJson?: unknown; putJson?: unknown } = {},
  ) {}

  async getPage<T>(
    path: string,
    query: Record<string, string>,
    page: number,
  ): Promise<ContentInventoryPage<T>> {
    this.pageCalls.push({ path, query, page });
    if (this.failures.getPage !== undefined) throw this.failures.getPage;
    return this.page as ContentInventoryPage<T>;
  }

  async getJson<T>(path: string) {
    this.jsonCalls.push(path);
    if (this.failures.getJson !== undefined) throw this.failures.getJson;
    return this.detail as T;
  }

  async putJson<T>(path: string, body: unknown) {
    this.putCalls.push({ path, body });
    if (this.failures.putJson !== undefined) throw this.failures.putJson;
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

  it.each([
    ["question", (client: ReturnType<typeof createContentReplacementClient>) => client.getQuestionsPage(1)],
    ["answer", (client: ReturnType<typeof createContentReplacementClient>) => client.getAnswersPage(42, 1)],
    ["article", (client: ReturnType<typeof createContentReplacementClient>) => client.getArticlesPage(1)],
  ])("blocks a %s inventory slice with a malformed item ID", async (kind, getPage) => {
    const transport = new FakeTransport(undefined, {
      items: [{ id: 0, title: "<p>MyPVM</p>" }], page: 1, totalPages: 1, hasMore: false,
    });

    await expect(getPage(createContentReplacementClient(transport))).rejects.toThrow(
      `Unable to read ${kind} inventory.`,
    );
  });

  it("rejects invalid requested IDs before requesting nested answer inventory", async () => {
    const transport = new FakeTransport();
    const client = createContentReplacementClient(transport);

    await expect(client.getAnswersPage(0, 1)).rejects.toThrow("Unable to read answer 0.");
    await expect(
      client.getItem({ kind: "answer", questionId: 42, answerId: 0 } as never),
    ).rejects.toThrow("Unable to reconstruct answer 0.");
    expect(transport.pageCalls).toEqual([]);
    expect(transport.jsonCalls).toEqual([]);
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

  it.each([
    ["question", { kind: "question", questionId: 42 }, {
      id: 42, title: "MyPVM", bodyMarkdown: "safe", tags: [{ name: 3 }],
    }],
    ["answer", { kind: "answer", questionId: 42, answerId: 8 }, {
      id: 8, bodyMarkdown: { hostile: "secret" },
    }],
    ["article", { kind: "article", articleId: 7 }, {
      id: 7, title: "MyPVM", bodyMarkdown: "safe", tags: [], type: "policy",
      permissions: { editorUsers: [{ id: 0 }] },
    }],
  ] as const)("rejects malformed %s tag or editor IDs without exposing detail text", async (kind, ref, detail) => {
    const transport = new FakeTransport(detail);

    await expect(createContentReplacementClient(transport).getItem(ref)).rejects.toEqual(
      expect.objectContaining({
        message: `Unable to reconstruct ${kind} ${kind === "answer" ? ref.answerId : kind === "question" ? ref.questionId : ref.articleId}.`,
        category: "schema",
      }),
    );
    await expect(createContentReplacementClient(transport).getItem(ref)).rejects.not.toThrow(/MyPVM/);
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

  it("preserves the everyone article permission scope", async () => {
    const transport = new FakeTransport({
      id: 7,
      title: "MyPVM policy",
      bodyMarkdown: "Use MyPVM.",
      tags: [],
      type: "policy",
      permissions: { editableBy: "everyone" },
    });

    await expect(createContentReplacementClient(transport).getItem({ kind: "article", articleId: 7 }))
      .resolves.toMatchObject({
        request: { permissions: { editableBy: "everyone", editorUserIds: [], editorUserGroupIds: [] } },
      });
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

  it("does not promote an arbitrary numeric status to trusted HTTP provenance", async () => {
    const failure = Object.assign(new Error("access token=secret https://private.example"), { status: 403 });
    const transport = new FakeTransport({}, undefined, { getJson: failure, putJson: "write key=secret" });
    const client = createContentReplacementClient(transport);

    await expect(client.getItem({ kind: "question", questionId: 42 })).rejects.toEqual(
      expect.objectContaining({
        name: "ContentReplacementApiError",
        message: "Unable to read question 42.",
        category: "schema",
      }),
    );
    await expect(client.getItem({ kind: "question", questionId: 42 })).rejects.not.toHaveProperty("status");
    await expect(client.getItem({ kind: "question", questionId: 42 })).rejects.not.toThrow(/secret|private/);
    await expect(client.getItem({ kind: "question", questionId: 42 })).rejects.not.toHaveProperty("cause");
    await expect(client.getItem({ kind: "question", questionId: 42 })).rejects.not.toHaveProperty("url");
    await expect(client.getItem({ kind: "question", questionId: 42 })).rejects.not.toHaveProperty("responseText");
    await expect(client.updateItem({
      kind: "answer",
      ref: { kind: "answer", questionId: 42, answerId: 8 },
      request: { body: "safe" },
    })).rejects.toMatchObject({ name: "ContentReplacementApiError" });
    await expect(client.updateItem({
      kind: "answer",
      ref: { kind: "answer", questionId: 42, answerId: 8 },
      request: { body: "safe" },
    })).rejects.toThrow("Unable to update answer 8.");
  });

  it("copies only the status from a trusted Stack API HTTP error", async () => {
    const failure = new StackApiError(
      "secret HTTP message",
      403,
      "https://private.example/secret",
      "secret response body",
    );
    const client = createContentReplacementClient(
      new FakeTransport({}, undefined, { getJson: failure }),
    );

    await expect(client.getItem({ kind: "question", questionId: 42 })).rejects.toEqual(
      expect.objectContaining({
        message: "Unable to read question 42.",
        category: "http",
        status: 403,
      }),
    );
    await expect(client.getItem({ kind: "question", questionId: 42 })).rejects.not.toHaveProperty("cause");
    await expect(client.getItem({ kind: "question", questionId: 42 })).rejects.not.toHaveProperty("url");
    await expect(client.getItem({ kind: "question", questionId: 42 })).rejects.not.toHaveProperty("responseText");
  });

  it("does not trust an adapter error rethrown by an arbitrary transport", async () => {
    const transport = new FakeTransport(
      undefined,
      undefined,
      { getPage: new ContentReplacementApiError("authorization=secret", "http", 429) },
    );

    await expect(createContentReplacementClient(transport).getArticlesPage(1)).rejects.toEqual(
      expect.objectContaining({
        name: "ContentReplacementApiError",
        message: "Unable to read article inventory.",
        category: "schema",
      }),
    );
    await expect(createContentReplacementClient(transport).getArticlesPage(1)).rejects.not.toHaveProperty("status");
  });

  it.each([
    [Object.assign(new Error("secret"), { status: Number.POSITIVE_INFINITY })],
    [new Proxy({}, { get: () => { throw new Error("secret getter"); } })],
    [new ContentReplacementApiError("secret adapter error", "schema")],
  ])("fails closed on unknown detail errors without retaining a status", async (failure) => {
    const transport = new FakeTransport({}, undefined, { getJson: failure });

    await expect(createContentReplacementClient(transport).getItem({ kind: "question", questionId: 42 }))
      .rejects.toEqual(expect.objectContaining({
        name: "ContentReplacementApiError",
        message: "Unable to read question 42.",
        category: "schema",
      }));
    await expect(createContentReplacementClient(transport).getItem({ kind: "question", questionId: 42 }))
      .rejects.not.toHaveProperty("status");
  });

  it("does not trust an arbitrary TypeError as transport provenance", async () => {
    const failure = Object.assign(new TypeError("secret transport URL"), {
      cause: { authorization: "secret" },
    });
    const client = createContentReplacementClient(
      new FakeTransport({}, undefined, { getJson: failure }),
    );

    await expect(client.getItem({ kind: "question", questionId: 42 })).rejects.toEqual(
      expect.objectContaining({
        name: "ContentReplacementApiError",
        message: "Unable to read question 42.",
        category: "schema",
      }),
    );
    await expect(client.getItem({ kind: "question", questionId: 42 })).rejects.not.toHaveProperty("cause");
  });

  it.each([
    ["question", { kind: "question", questionId: 42 }],
    ["answer", { kind: "answer", questionId: 42, answerId: 8 }],
    ["article", { kind: "article", articleId: 7 }],
  ] as const)("maps invalid JSON for a %s detail to schema without retaining parser data", async (_kind, ref) => {
    const transport = new StackApiV3Client({
      apiV3Url: "https://demo.stackenterprise.co/api/v3",
      token: "secret-token",
      fetchFn: async () => new Response("secret invalid JSON", { status: 200 }),
    });

    const result = createContentReplacementClient(transport).getItem(ref);

    await expect(result).rejects.toEqual(expect.objectContaining({ category: "schema" }));
    await expect(result).rejects.not.toHaveProperty("status");
    await expect(result).rejects.not.toHaveProperty("cause");
    await expect(result).rejects.not.toThrow(/secret|invalid JSON|URL/);
  });

  it("maps trusted exhausted API retries to transport without retaining the fetch error", async () => {
    let attempts = 0;
    const transport = new StackApiV3Client({
      apiV3Url: "https://demo.stackenterprise.co/api/v3",
      token: "secret-token",
      fetchFn: async () => {
        attempts += 1;
        throw new TypeError("secret fetch URL");
      },
      waitFn: async () => undefined,
    });

    const result = createContentReplacementClient(transport).getItem({
      kind: "question",
      questionId: 42,
    });

    await expect(result).rejects.toEqual(expect.objectContaining({
      category: "transport",
      message: "Unable to read question 42.",
    }));
    await expect(result).rejects.not.toHaveProperty("cause");
    await expect(result).rejects.not.toThrow(/secret|fetch URL/);
    expect(attempts).toBe(4);
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
        responseOnly: "do not send",
      },
      metadata: { owner: { id: 3, name: "Ada" } },
    } as unknown as Parameters<typeof client.updateItem>[0]);

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

  it("allowlists runtime question and answer PUT requests and uses their exact paths", async () => {
    const transport = new FakeTransport();
    const client = createContentReplacementClient(transport);

    await client.updateItem({
      kind: "question",
      ref: { kind: "question", questionId: 42 },
      request: { title: "MyPBM", body: "safe", tags: ["product"], responseOnly: "do not send" },
      metadata: { webUrl: "https://private.example/question/42" },
    } as unknown as Parameters<typeof client.updateItem>[0]);
    await client.updateItem({
      kind: "answer",
      ref: { kind: "answer", questionId: 42, answerId: 8 },
      request: { body: "safe", responseOnly: "do not send" },
    } as unknown as Parameters<typeof client.updateItem>[0]);

    expect(transport.putCalls).toEqual([
      { path: "/questions/42", body: { title: "MyPBM", body: "safe", tags: ["product"] } },
      { path: "/questions/42/answers/8", body: { body: "safe" } },
    ]);
  });

  it("rejects a runtime PUT request with malformed required fields before the write", async () => {
    const transport = new FakeTransport();

    await expect(createContentReplacementClient(transport).updateItem({
      kind: "article",
      ref: { kind: "article", articleId: 7 },
      request: { title: "safe", body: 3, tags: [], type: "policy", permissions: {} },
    } as unknown as Parameters<ContentReplacementClient["updateItem"]>[0])).rejects.toEqual(
      expect.objectContaining({
        message: "Unable to update article 7.",
        category: "schema",
      }),
    );
    expect(transport.putCalls).toEqual([]);
  });
});
