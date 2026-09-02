import { afterEach, describe, expect, it, vi } from "vitest";

import type { NormalizedInstance } from "../credentials/credentialRules";
import type { SessionCredentials } from "../domain/types";
import {
  ContentReplacementApiError,
  type ContentReplacementClient,
} from "../writeTools/contentReplacement/contentApi";
import {
  checksumRequestModel,
  toReplacementWireRequestModel,
} from "../writeTools/contentReplacement/proposals";
import type { ReplacementRequestModel } from "../writeTools/contentReplacement/types";
import {
  handleContentReplacementRecoveryRequest,
  type ContentReplacementRecoveryPayload,
} from "./contentReplacementRecoveryApi";

const credentials: SessionCredentials = {
  instanceType: "enterprise",
  baseUrl: "https://DEMO.stackenterprise.co/",
  accessToken: "secret-token",
  authSource: "oauth-pkce",
  oauthScopes: ["write_access", "no_expiry"],
};

const priorQuestion: ReplacementRequestModel = {
  kind: "question",
  ref: { kind: "question", questionId: 10 },
  request: { title: "Rename MyPVM", body: "Use MyPVM.", tags: ["product"] },
};

const postApplyQuestion: ReplacementRequestModel = {
  kind: "question",
  ref: { kind: "question", questionId: 10 },
  request: { title: "Rename MyPBM", body: "Use MyPBM.", tags: ["product"] },
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

type CreateClient = (
  normalizedCredentials: SessionCredentials,
  instance: NormalizedInstance,
  onThrottle: (notice: unknown) => void,
) => ContentReplacementClient;

async function validRecoveryPayload(
  overrides: Partial<ContentReplacementRecoveryPayload> = {},
): Promise<ContentReplacementRecoveryPayload> {
  return {
    action: "preview",
    credentials,
    jobFingerprint: "1".repeat(64),
    itemRef: priorQuestion.ref,
    priorRequestModel: toReplacementWireRequestModel(priorQuestion),
    expectedPriorRequestChecksum: await checksumRequestModel(priorQuestion),
    expectedPostApplyChecksum: await checksumRequestModel(postApplyQuestion),
    ...overrides,
  } as ContentReplacementRecoveryPayload;
}

function fakeContentClient(
  getItems: readonly ReplacementRequestModel[] = [postApplyQuestion],
  updateImplementation?: (model: ReplacementRequestModel) => Promise<void>,
): ContentReplacementClient {
  let readIndex = 0;
  return {
    getQuestionsPage: vi.fn(),
    getAnswersPage: vi.fn(),
    getArticlesPage: vi.fn(),
    getItem: vi.fn(async () => getItems[Math.min(readIndex++, getItems.length - 1)]),
    updateItem: vi.fn(updateImplementation ?? (async () => undefined)),
  };
}

async function expectInvalidWithoutClient(payload: unknown): Promise<void> {
  const createClient = vi.fn<CreateClient>();
  const response = await handleContentReplacementRecoveryRequest(payload, { createClient });

  expect(response.status).toBe(400);
  await expect(response.json()).resolves.toEqual({
    ok: false,
    error: "Content replacement recovery request is invalid.",
  });
  expect(createClient).not.toHaveBeenCalled();
}

describe("handleContentReplacementRecoveryRequest", () => {
  it("previews a recoverable item read-only with normalized current and prior models", async () => {
    const client = fakeContentClient([{
      ...postApplyQuestion,
      metadata: { webUrl: "https://private.example/secret-token" },
    }]);

    const response = await handleContentReplacementRecoveryRequest(await validRecoveryPayload(), {
      createClient: (_credentials, _instance, onThrottle) => {
        onThrottle({ kind: "burst", seconds: 7, remaining: 2 });
        onThrottle({ kind: "burst", seconds: 7, remaining: 2, upstream: "secret-token" });
        return client;
      },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      result: {
        status: "recoverable",
        currentRequestModel: postApplyQuestion,
        priorRequestModel: priorQuestion,
        observedRequestChecksum: await checksumRequestModel(postApplyQuestion),
      },
      throttleNotices: [{ kind: "burst", seconds: 7, remaining: 2 }],
    });
    expect(client.getItem).toHaveBeenCalledTimes(1);
    expect(client.updateItem).not.toHaveBeenCalled();
  });

  it("previews an already-recovered item without a PUT", async () => {
    const client = fakeContentClient([priorQuestion]);

    const response = await handleContentReplacementRecoveryRequest(await validRecoveryPayload(), {
      createClient: () => client,
    });

    await expect(response.json()).resolves.toMatchObject({
      result: { status: "already-recovered" },
    });
    expect(client.updateItem).not.toHaveBeenCalled();
  });

  it("previews a third checksum state as a conflict without a PUT", async () => {
    const conflict: ReplacementRequestModel = {
      ...postApplyQuestion,
      request: { ...postApplyQuestion.request, tags: ["changed-later"] },
    };
    const client = fakeContentClient([conflict]);

    const response = await handleContentReplacementRecoveryRequest(await validRecoveryPayload(), {
      createClient: () => client,
    });

    await expect(response.json()).resolves.toMatchObject({
      result: {
        status: "conflict",
        currentRequestModel: conflict,
        priorRequestModel: priorQuestion,
      },
    });
    expect(client.updateItem).not.toHaveBeenCalled();
  });

  it("uses only the current request model—not metadata—to validate the post-apply checksum", async () => {
    const client = fakeContentClient([{
      ...postApplyQuestion,
      metadata: { titleContext: "changed response-only metadata" },
    }]);

    const response = await handleContentReplacementRecoveryRequest(await validRecoveryPayload(), {
      createClient: () => client,
    });

    await expect(response.json()).resolves.toMatchObject({ result: { status: "recoverable" } });
  });

  it("contains a current-model identity mismatch without writing", async () => {
    const client = fakeContentClient([{
      ...postApplyQuestion,
      ref: { kind: "question", questionId: 11 },
    }]);

    const response = await handleContentReplacementRecoveryRequest(await validRecoveryPayload(), {
      createClient: () => client,
    });

    await expect(response.json()).resolves.toMatchObject({ result: { status: "failed" } });
    expect(client.updateItem).not.toHaveBeenCalled();
  });

  it("applies recovery only from the expected post-apply state and returns the observed checksum", async () => {
    const observed: ReplacementRequestModel = {
      ...priorQuestion,
      request: { ...priorQuestion.request, tags: ["product", "observed-after-put"] },
      metadata: { owner: { id: 2, name: "response-only" } },
    };
    const client = fakeContentClient([postApplyQuestion, observed]);

    const response = await handleContentReplacementRecoveryRequest(
      await validRecoveryPayload({ action: "apply" }),
      { createClient: () => client },
    );

    await expect(response.json()).resolves.toEqual({
      ok: true,
      result: {
        status: "recovered",
        observedRequestChecksum: await checksumRequestModel(observed),
      },
      throttleNotices: [],
    });
    expect(client.getItem).toHaveBeenCalledTimes(2);
    expect(client.updateItem).toHaveBeenCalledTimes(1);
    expect(client.updateItem).toHaveBeenCalledWith(priorQuestion);
  });

  it("does not PUT recovery when apply finds the prior checksum", async () => {
    const client = fakeContentClient([priorQuestion]);

    const response = await handleContentReplacementRecoveryRequest(
      await validRecoveryPayload({ action: "apply" }),
      { createClient: () => client },
    );

    await expect(response.json()).resolves.toMatchObject({
      result: { status: "already-recovered" },
    });
    expect(client.updateItem).not.toHaveBeenCalled();
  });

  it("does not PUT recovery when apply finds a third checksum state", async () => {
    const conflict: ReplacementRequestModel = {
      ...postApplyQuestion,
      request: { ...postApplyQuestion.request, body: "Changed after apply" },
    };
    const client = fakeContentClient([conflict]);

    const response = await handleContentReplacementRecoveryRequest(
      await validRecoveryPayload({ action: "apply" }),
      { createClient: () => client },
    );

    await expect(response.json()).resolves.toMatchObject({ result: { status: "conflict" } });
    expect(client.updateItem).not.toHaveBeenCalled();
  });

  it("returns network after a lost recovery PUT response and retries as already recovered", async () => {
    let current: ReplacementRequestModel = postApplyQuestion;
    const updateItem = vi.fn(async (model: ReplacementRequestModel) => {
      current = model;
      throw new ContentReplacementApiError("Unable to update question 10.", "transport");
    });
    const client = fakeContentClient();
    client.getItem = vi.fn(async () => current);
    client.updateItem = updateItem;
    const payload = await validRecoveryPayload({ action: "apply" });

    const first = await handleContentReplacementRecoveryRequest(payload, { createClient: () => client });
    const second = await handleContentReplacementRecoveryRequest(payload, { createClient: () => client });

    await expect(first.json()).resolves.toMatchObject({ result: { status: "network" } });
    await expect(second.json()).resolves.toMatchObject({ result: { status: "already-recovered" } });
    expect(updateItem).toHaveBeenCalledTimes(1);
  });

  it("returns network when the post-recovery observation fails after exactly one PUT", async () => {
    const client = fakeContentClient();
    client.getItem = vi.fn()
      .mockResolvedValueOnce(postApplyQuestion)
      .mockRejectedValueOnce(new ContentReplacementApiError("Unable to read question 10.", "transport"));

    const response = await handleContentReplacementRecoveryRequest(
      await validRecoveryPayload({ action: "apply" }),
      { createClient: () => client },
    );

    await expect(response.json()).resolves.toMatchObject({ result: { status: "network" } });
    expect(client.updateItem).toHaveBeenCalledTimes(1);
  });

  it.each([
    [401, "permission"], [403, "permission"], [400, "validation"], [422, "validation"],
    [429, "network"], [502, "network"], [503, "network"], [504, "network"], [404, "failed"],
  ] as const)("maps upstream status %i to an HTTP-200 %s item result", async (status, expected) => {
    const client = fakeContentClient();
    client.getItem = vi.fn().mockRejectedValue(
      new ContentReplacementApiError("secret-token hostile body", "http", status),
    );

    const response = await handleContentReplacementRecoveryRequest(await validRecoveryPayload(), {
      createClient: () => client,
    });
    const serialized = await response.text();

    expect(response.status).toBe(200);
    expect(JSON.parse(serialized)).toMatchObject({ result: { status: expected } });
    expect(serialized).not.toContain("secret-token");
    expect(serialized).not.toContain("hostile");
  });

  it("does not trust a fake-client TypeError as transport provenance", async () => {
    const client = fakeContentClient();
    client.getItem = vi.fn().mockRejectedValue(new TypeError("secret-token network URL"));

    const response = await handleContentReplacementRecoveryRequest(await validRecoveryPayload(), {
      createClient: () => client,
    });
    const serialized = await response.text();

    expect(JSON.parse(serialized)).toMatchObject({ result: { status: "failed" } });
    expect(serialized).not.toContain("secret-token");
    expect(serialized).not.toContain("URL");
  });

  it("maps a sanitized adapter schema failure to failed", async () => {
    const client = fakeContentClient();
    client.getItem = vi.fn().mockRejectedValue(
      new ContentReplacementApiError("malformed secret-token detail", "schema"),
    );

    const response = await handleContentReplacementRecoveryRequest(await validRecoveryPayload(), {
      createClient: () => client,
    });
    const serialized = await response.text();

    expect(JSON.parse(serialized)).toMatchObject({ result: { status: "failed" } });
    expect(serialized).not.toContain("secret-token");
    expect(serialized).not.toContain("malformed");
  });

  it("does not trust an unexpected error that impersonates a retryable HTTP failure", async () => {
    const client = fakeContentClient();
    client.getItem = vi.fn().mockRejectedValue(
      Object.assign(new Error("secret-token"), { status: 503, category: "transport" }),
    );

    const response = await handleContentReplacementRecoveryRequest(await validRecoveryPayload(), {
      createClient: () => client,
    });

    await expect(response.json()).resolves.toMatchObject({ result: { status: "failed" } });
  });

  it("accepts each exact canonical prior-model kind and PUTs no response-only fields", async () => {
    const cases: Array<{ prior: ReplacementRequestModel; post: ReplacementRequestModel }> = [
      {
        prior: { kind: "answer", ref: { kind: "answer", questionId: 10, answerId: 11 }, request: { body: "MyPVM" } },
        post: { kind: "answer", ref: { kind: "answer", questionId: 10, answerId: 11 }, request: { body: "MyPBM" } },
      },
      {
        prior: {
          kind: "article", ref: { kind: "article", articleId: 12 },
          request: {
            title: "MyPVM policy", body: "MyPVM", tags: ["safe"], type: "policy", expirationDate: null,
            permissions: { editableBy: "specificEditors", editorUserIds: [2], editorUserGroupIds: [3] },
          },
        },
        post: {
          kind: "article", ref: { kind: "article", articleId: 12 },
          request: {
            title: "MyPBM policy", body: "MyPBM", tags: ["safe"], type: "policy", expirationDate: null,
            permissions: { editableBy: "specificEditors", editorUserIds: [2], editorUserGroupIds: [3] },
          },
        },
      },
    ];

    for (const { prior, post } of cases) {
      const client = fakeContentClient([post, prior]);
      const payload = await validRecoveryPayload({
        action: "apply",
        itemRef: prior.ref,
        priorRequestModel: toReplacementWireRequestModel(prior),
        expectedPriorRequestChecksum: await checksumRequestModel(prior),
        expectedPostApplyChecksum: await checksumRequestModel(post),
      });

      const response = await handleContentReplacementRecoveryRequest(payload, {
        createClient: () => client,
      });

      await expect(response.json()).resolves.toMatchObject({ result: { status: "recovered" } });
      expect(client.updateItem).toHaveBeenCalledWith(prior);
    }
  });

  it.each([
    ["unknown root key", async () => ({ ...(await validRecoveryPayload()), configuration: {} })],
    ["unknown credential key", async () => ({ ...(await validRecoveryPayload()), credentials: { ...credentials, tokenCopy: "secret-token" } })],
    ["invalid action", async () => ({ ...(await validRecoveryPayload()), action: "force" })],
    ["invalid job fingerprint format", async () => ({ ...(await validRecoveryPayload()), jobFingerprint: "review-job" })],
    ["invalid prior checksum format", async () => ({ ...(await validRecoveryPayload()), expectedPriorRequestChecksum: "A".repeat(64) })],
    ["invalid post checksum format", async () => ({ ...(await validRecoveryPayload()), expectedPostApplyChecksum: "a".repeat(63) })],
    ["unknown item-ref key", async () => ({ ...(await validRecoveryPayload()), itemRef: { kind: "question", questionId: 10, answerId: 11 } })],
    ["unknown model key", async () => ({ ...(await validRecoveryPayload()), priorRequestModel: { ...priorQuestion, metadata: {} } })],
    ["model kind mismatch", async () => ({ ...(await validRecoveryPayload()), priorRequestModel: { ...priorQuestion, kind: "article" } })],
    ["model ref mismatch", async () => ({ ...(await validRecoveryPayload()), priorRequestModel: { ...priorQuestion, ref: { kind: "question", questionId: 11 } } })],
    ["unknown request key", async () => ({ ...(await validRecoveryPayload()), priorRequestModel: { ...priorQuestion, request: { ...priorQuestion.request, owner: 3 } } })],
    ["wrong request type", async () => ({ ...(await validRecoveryPayload()), priorRequestModel: { ...priorQuestion, request: { ...priorQuestion.request, tags: [2] } } })],
    ["prior checksum mismatch", async () => ({ ...(await validRecoveryPayload()), expectedPriorRequestChecksum: "f".repeat(64) })],
  ])("rejects exact recovery evidence violation before client construction: %s", async (_label, makePayload) => {
    await expectInvalidWithoutClient(await makePayload());
  });

  it("rejects article permission and response-only extras before client construction", async () => {
    const article: ReplacementRequestModel = {
      kind: "article",
      ref: { kind: "article", articleId: 12 },
      request: {
        title: "Prior", body: "Prior", tags: [], type: "policy",
        permissions: { editableBy: "ownerOnly", editorUserIds: [], editorUserGroupIds: [] },
      },
    };
    await expectInvalidWithoutClient(await validRecoveryPayload({
      itemRef: article.ref,
      priorRequestModel: {
        ...article,
        request: {
          ...article.request,
          permissions: { ...article.request.permissions, editorUsers: [{ id: 2 }] },
        },
      } as never,
      expectedPriorRequestChecksum: await checksumRequestModel(article),
    }));
  });

  it.each([
    "https://demo.stackenterprise.co/proxy",
    "https://demo.stackenterprise.co/?proxy=1",
    "https://demo.stackenterprise.co/#fragment",
    "https://user:secret-token@demo.stackenterprise.co/",
  ])("rejects non-root Enterprise context before client construction: %s", async (baseUrl) => {
    const createClient = vi.fn<CreateClient>();
    const response = await handleContentReplacementRecoveryRequest(
      await validRecoveryPayload({ credentials: { ...credentials, baseUrl } }),
      { createClient },
    );
    expect(response.status).toBe(400);
    expect(createClient).not.toHaveBeenCalled();
  });

  it("treats a canonical digest as opaque recovery evidence instead of pretending to recompute it", async () => {
    const createClient = vi.fn<CreateClient>(() => fakeContentClient());
    const payload = await validRecoveryPayload({ jobFingerprint: "a".repeat(64) });

    const response = await handleContentReplacementRecoveryRequest(payload, { createClient });

    expect(response.status).toBe(200);
    expect(createClient).toHaveBeenCalledTimes(1);
  });

  it("uses the five-second production read cap without a long server wait", async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      new Response("secret-token upstream body", {
        status: 429,
        headers: { "Retry-After": "6" },
      }),
    );
    const scheduledWait = vi.fn();
    vi.stubGlobal("fetch", fetchFn);
    vi.stubGlobal("setTimeout", scheduledWait);

    const response = await handleContentReplacementRecoveryRequest(await validRecoveryPayload());
    const serialized = await response.text();

    expect(JSON.parse(serialized)).toEqual({
      ok: true,
      result: { status: "network", error: "Unable to read the current content item." },
      throttleNotices: [{ kind: "backoff", seconds: 6 }],
    });
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(scheduledWait).not.toHaveBeenCalled();
    expect(serialized).not.toContain("secret-token");
  });

  it("returns one sanitized backoff notice for a no-retry production 503 recovery PUT", async () => {
    const fetchFn = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "PUT") {
        return new Response(JSON.stringify({ error_message: "secret-token upstream failure" }), {
          status: 503,
          headers: { "Retry-After": "30", "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({
        id: 10,
        title: "Rename MyPBM",
        bodyMarkdown: "Use MyPBM.",
        tags: [{ name: "product" }],
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    });
    const scheduledWait = vi.fn();
    vi.stubGlobal("fetch", fetchFn);
    vi.stubGlobal("setTimeout", scheduledWait);

    const response = await handleContentReplacementRecoveryRequest(
      await validRecoveryPayload({ action: "apply" }),
    );
    const serialized = await response.text();

    expect(JSON.parse(serialized)).toEqual({
      ok: true,
      result: { status: "network", error: "Unable to recover the content item." },
      throttleNotices: [{ kind: "backoff", seconds: 30 }],
    });
    expect(fetchFn.mock.calls.filter(([, init]) => init?.method === "PUT")).toHaveLength(1);
    expect(scheduledWait).not.toHaveBeenCalled();
    expect(serialized).not.toContain("secret-token");
    expect(serialized).not.toContain("upstream");
  });
});

describe("content replacement recovery route", () => {
  it("uses the bounded JSON reader and delegates one valid request exactly once", async () => {
    const api = await import("./contentReplacementRecoveryApi");
    const handler = vi.spyOn(api, "handleContentReplacementRecoveryRequest").mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );
    const { POST, runtime } = await import("../app/api/write-tools/content-replacement/recover/route");
    const payload = await validRecoveryPayload();

    const response = await POST(new Request("https://local.test/recover", {
      method: "POST", body: JSON.stringify(payload),
    }));

    expect(runtime).toBe("nodejs");
    expect(response.status).toBe(200);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(payload);
  });

  it("returns a bounded-reader error without delegating", async () => {
    const api = await import("./contentReplacementRecoveryApi");
    const handler = vi.spyOn(api, "handleContentReplacementRecoveryRequest");
    const { POST } = await import("../app/api/write-tools/content-replacement/recover/route");

    const response = await POST(new Request("https://local.test/recover", {
      method: "POST", body: "not-json",
    }));

    expect(response.status).toBe(400);
    expect(handler).not.toHaveBeenCalled();
  });
});
