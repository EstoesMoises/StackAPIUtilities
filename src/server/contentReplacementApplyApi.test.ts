import { afterEach, describe, expect, it, vi } from "vitest";

import type { NormalizedInstance } from "../credentials/credentialRules";
import type { SessionCredentials } from "../domain/types";
import {
  ContentReplacementApiError,
  type ContentReplacementClient,
} from "../writeTools/contentReplacement/contentApi";
import {
  buildReplacementProposal,
  checksumRequestModel,
  createJobFingerprint,
} from "../writeTools/contentReplacement/proposals";
import { createExactTargetSelection } from "../writeTools/contentReplacement/discovery";
import type {
  ReplacementConfiguration,
  ReplacementItemRef,
  ReplacementRequestModel,
} from "../writeTools/contentReplacement/types";
import { MAX_CONTENT_REPLACEMENT_REQUEST_MODEL_BYTES } from "../writeTools/contentReplacement/limits";
import {
  handleContentReplacementApplyRequest,
  type ContentReplacementApplyPayload,
} from "./contentReplacementApplyApi";

const credentials: SessionCredentials = {
  instanceType: "enterprise",
  baseUrl: "https://DEMO.stackenterprise.co/",
  accessToken: "secret-token",
  authSource: "oauth-pkce",
  oauthScopes: ["write_access", "no_expiry"],
};

const configuration: ReplacementConfiguration = {
  target: { kind: "enterprise-main" },
  contentTypes: { questions: true, answers: true, articles: true },
  discovery: { mode: "full" },
  rules: [{ id: "rule-1", find: "TermA", replace: "TermB" }],
  options: { caseSensitive: true, wholeTerm: true, replaceInCode: false },
};

const beforeQuestion: ReplacementRequestModel = {
  kind: "question",
  ref: { kind: "question", questionId: 10 },
  request: { title: "Rename TermA", body: "Use TermA.", tags: ["product"] },
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

async function validApplyPayload(
  overrides: Partial<ContentReplacementApplyPayload> = {},
): Promise<ContentReplacementApplyPayload> {
  const effectiveConfiguration = overrides.configuration ?? configuration;
  const proposal = await buildReplacementProposal(beforeQuestion, effectiveConfiguration, overrides.exactProof);
  if (!proposal) throw new Error("fixture must produce a proposal");
  return {
    credentials,
    configuration: effectiveConfiguration,
    scanCompatibility: "current",
    jobFingerprint: await createJobFingerprint({
      baseUrl: "https://demo.stackenterprise.co",
      configuration: effectiveConfiguration,
      scanCompatibility: "current",
    }),
    itemRef: beforeQuestion.ref,
    expectedScannedRequestChecksum: proposal.scannedRequestChecksum,
    expectedProposedRequestChecksum: proposal.proposedRequestChecksum,
    expectedProposalFingerprint: proposal.proposalFingerprint,
    ...(overrides.exactProof === undefined ? {} : { exactProof: overrides.exactProof }),
    ...overrides,
  };
}

function fakeContentClient(
  getItems: readonly ReplacementRequestModel[] = [beforeQuestion],
  updateImplementation?: (model: ReplacementRequestModel) => Promise<void>,
): ContentReplacementClient {
  let readIndex = 0;
  return {
    getQuestionsPage: vi.fn(),
    getAnswersPage: vi.fn(),
    getArticlesPage: vi.fn(),
    getSearchPage: vi.fn(async () => {
      throw new Error("Search inventory is unavailable in this fixture.");
    }),
    getItem: vi.fn(async () => getItems[Math.min(readIndex++, getItems.length - 1)]),
    updateItem: vi.fn(updateImplementation ?? (async () => undefined)),
  };
}

async function proposedQuestion(): Promise<ReplacementRequestModel> {
  const proposal = await buildReplacementProposal(beforeQuestion, configuration);
  if (!proposal) throw new Error("fixture must produce a proposal");
  return proposal.after;
}

async function expectInvalidWithoutClient(payload: unknown): Promise<void> {
  const createClient = vi.fn<CreateClient>();
  const response = await handleContentReplacementApplyRequest(payload, { createClient });

  expect(response.status).toBe(400);
  await expect(response.json()).resolves.toEqual({
    ok: false,
    error: "Content replacement apply request is invalid.",
  });
  expect(createClient).not.toHaveBeenCalled();
}

describe("handleContentReplacementApplyRequest", () => {
  it("never applies an aggregate-over-budget current model that could not be recovered", async () => {
    const oversized: ReplacementRequestModel = {
      ...beforeQuestion,
      request: { ...beforeQuestion.request, body: "é".repeat(1_048_576) },
    };
    expect(new TextEncoder().encode(JSON.stringify(oversized)).byteLength)
      .toBeGreaterThan(MAX_CONTENT_REPLACEMENT_REQUEST_MODEL_BYTES);
    const client = fakeContentClient([oversized]);

    const response = await handleContentReplacementApplyRequest(await validApplyPayload(), {
      createClient: () => client,
    });

    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      result: { status: "failed", error: "Unable to read the current content item." },
    });
    expect(client.updateItem).not.toHaveBeenCalled();
  });

  it("requires current compatibility on a current-bound apply request", async () => {
    const response = await handleContentReplacementApplyRequest({
      ...(await validApplyPayload()),
      scanCompatibility: "current",
    }, { createClient: () => fakeContentClient() });

    expect(response.status).toBe(200);
  });

  it("rejects legacy compatibility before creating an apply client", async () => {
    const createClient = vi.fn<CreateClient>();
    const response = await handleContentReplacementApplyRequest({
      ...(await validApplyPayload()),
      scanCompatibility: "legacy-restart-required",
      jobFingerprint: await createJobFingerprint({
        baseUrl: "https://demo.stackenterprise.co",
        configuration,
        scanCompatibility: "legacy-restart-required",
      }),
    }, { createClient });

    expect(response.status).toBe(400);
    expect(createClient).not.toHaveBeenCalled();
  });

  it("requires the reviewed Exact proof before client construction and applies with valid evidence", async () => {
    const selection = await createExactTargetSelection([beforeQuestion.ref]);
    const exact: ReplacementConfiguration = {
      ...configuration,
      discovery: selection.discovery,
    };
    const payload = await validApplyPayload({ configuration: exact, exactProof: selection.proofs[0] });
    const response = await handleContentReplacementApplyRequest(payload, {
      createClient: () => fakeContentClient(),
    });

    expect(response.status).toBe(200);
    const { exactProof: _proof, ...withoutProof } = payload;
    await expectInvalidWithoutClient(withoutProof);
    await expectInvalidWithoutClient({
      ...payload,
      exactProof: { ...selection.proofs[0], targetIndex: 1 },
    });
  });

  it("writes one server-recomputed exact request and returns the observed post-write checksum", async () => {
    const after = await proposedQuestion();
    const observed = {
      ...after,
      request: { ...after.request, tags: ["product", "server-added"] },
      metadata: { webUrl: "https://private.example/secret-token" },
    } as ReplacementRequestModel;
    const client = fakeContentClient([
      { ...beforeQuestion, metadata: { titleContext: "secret-token" } },
      observed,
    ]);

    const response = await handleContentReplacementApplyRequest(await validApplyPayload(), {
      createClient: () => client,
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      result: {
        status: "updated",
        observedRequestChecksum: await checksumRequestModel(observed),
      },
      throttleNotices: [],
    });
    expect(client.getItem).toHaveBeenCalledTimes(2);
    expect(client.updateItem).toHaveBeenCalledTimes(1);
    expect(client.updateItem).toHaveBeenCalledWith({
      kind: "question",
      ref: { kind: "question", questionId: 10 },
      request: { title: "Rename TermB", body: "Use TermB.", tags: ["product"] },
    });
  });

  it("applies exact allowlisted answer and article proposals", async () => {
    const models: ReplacementRequestModel[] = [
      {
        kind: "answer",
        ref: { kind: "answer", questionId: 10, answerId: 11 },
        request: { body: "Use TermA." },
      },
      {
        kind: "article",
        ref: { kind: "article", articleId: 12 },
        request: {
          title: "TermA policy",
          body: "Use TermA.",
          tags: ["product"],
          type: "policy",
          expirationDate: null,
          permissions: {
            editableBy: "specificEditors",
            editorUserIds: [2],
            editorUserGroupIds: [3],
          },
        },
      },
    ];

    for (const before of models) {
      const proposal = await buildReplacementProposal(before, configuration);
      if (!proposal) throw new Error("fixture must produce a proposal");
      const client = fakeContentClient([before, proposal.after]);
      const payload = await validApplyPayload({
        itemRef: before.ref,
        expectedScannedRequestChecksum: proposal.scannedRequestChecksum,
        expectedProposedRequestChecksum: proposal.proposedRequestChecksum,
        expectedProposalFingerprint: proposal.proposalFingerprint,
      });

      const response = await handleContentReplacementApplyRequest(payload, {
        createClient: () => client,
      });

      await expect(response.json()).resolves.toMatchObject({ result: { status: "updated" } });
      expect(client.updateItem).toHaveBeenCalledWith(proposal.after);
    }
  });

  it("treats an already-proposed current checksum as idempotent success without a PUT", async () => {
    const client = fakeContentClient([await proposedQuestion()]);

    const response = await handleContentReplacementApplyRequest(await validApplyPayload(), {
      createClient: () => client,
    });

    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      result: { status: "already-applied" },
    });
    expect(client.getItem).toHaveBeenCalledTimes(1);
    expect(client.updateItem).not.toHaveBeenCalled();
  });

  it("does not write when any required request field changed after review", async () => {
    const changedTagsQuestion: ReplacementRequestModel = {
      ...beforeQuestion,
      request: { ...beforeQuestion.request, tags: ["changed-after-review"] },
    };
    const client = fakeContentClient([changedTagsQuestion]);

    const response = await handleContentReplacementApplyRequest(await validApplyPayload(), {
      createClient: () => client,
    });

    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      result: { status: "stale" },
    });
    expect(client.updateItem).not.toHaveBeenCalled();
  });

  it.each([
    ["reviewed proposed checksum", { expectedProposedRequestChecksum: "a".repeat(64) }],
    ["reviewed proposal fingerprint", { expectedProposalFingerprint: "b".repeat(64) }],
  ])("does not write when the recomputed proposal differs from the %s", async (_label, override) => {
    const client = fakeContentClient();
    const response = await handleContentReplacementApplyRequest(
      await validApplyPayload(override),
      { createClient: () => client },
    );

    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      result: { status: "stale" },
    });
    expect(client.updateItem).not.toHaveBeenCalled();
  });

  it("does not write when the reviewed content no longer produces a proposal", async () => {
    const unchanged: ReplacementRequestModel = {
      ...beforeQuestion,
      request: { ...beforeQuestion.request, title: "Unrelated", body: "Unrelated" },
    };
    const payload = await validApplyPayload({
      expectedScannedRequestChecksum: await checksumRequestModel(unchanged),
    });
    const client = fakeContentClient([unchanged]);

    const response = await handleContentReplacementApplyRequest(payload, {
      createClient: () => client,
    });

    await expect(response.json()).resolves.toMatchObject({ result: { status: "stale" } });
    expect(client.updateItem).not.toHaveBeenCalled();
  });

  it("contains a current-model identity mismatch without writing", async () => {
    const hostileCurrent: ReplacementRequestModel = {
      ...beforeQuestion,
      ref: { kind: "question", questionId: 11 },
    };
    const client = fakeContentClient([hostileCurrent]);

    const response = await handleContentReplacementApplyRequest(await validApplyPayload(), {
      createClient: () => client,
    });

    await expect(response.json()).resolves.toMatchObject({ result: { status: "failed" } });
    expect(client.updateItem).not.toHaveBeenCalled();
  });

  it("returns a typed network failure after a lost PUT response and retries as already applied", async () => {
    let current: ReplacementRequestModel = beforeQuestion;
    const updateItem = vi.fn(async (model: ReplacementRequestModel) => {
      current = model;
      throw new ContentReplacementApiError("Unable to update question 10.", "transport");
    });
    const client = fakeContentClient();
    client.getItem = vi.fn(async () => current);
    client.updateItem = updateItem;
    const payload = await validApplyPayload();

    const first = await handleContentReplacementApplyRequest(payload, { createClient: () => client });
    const second = await handleContentReplacementApplyRequest(payload, { createClient: () => client });

    await expect(first.json()).resolves.toMatchObject({ result: { status: "network" } });
    await expect(second.json()).resolves.toMatchObject({ result: { status: "already-applied" } });
    expect(updateItem).toHaveBeenCalledTimes(1);
  });

  it("returns network when the post-write observation fails and never issues a second PUT", async () => {
    const client = fakeContentClient();
    client.getItem = vi.fn()
      .mockResolvedValueOnce(beforeQuestion)
      .mockRejectedValueOnce(new ContentReplacementApiError("Unable to read question 10.", "transport"));

    const response = await handleContentReplacementApplyRequest(await validApplyPayload(), {
      createClient: () => client,
    });

    await expect(response.json()).resolves.toMatchObject({ result: { status: "network" } });
    expect(client.updateItem).toHaveBeenCalledTimes(1);
  });

  it("returns HTTP 401 for an invalid upstream credential instead of an item permission result", async () => {
    const client = fakeContentClient();
    client.getItem = vi.fn().mockRejectedValue(
      new ContentReplacementApiError("hostile credential detail", "http", 401),
    );

    const response = await handleContentReplacementApplyRequest(await validApplyPayload(), {
      createClient: () => client,
    });

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: "Stack Enterprise credentials were rejected.",
    });
    expect(client.updateItem).not.toHaveBeenCalled();
  });

  it.each([
    [403, "permission"],
    [400, "validation"],
    [422, "validation"],
    [429, "network"],
    [502, "network"],
    [503, "network"],
    [504, "network"],
    [404, "failed"],
  ] as const)("maps upstream non-credential status %i to an HTTP-200 %s item result", async (status, expected) => {
    const hostile = new ContentReplacementApiError("secret-token hostile body", "http", status);
    const client = fakeContentClient();
    client.getItem = vi.fn().mockRejectedValue(hostile);

    const response = await handleContentReplacementApplyRequest(await validApplyPayload(), {
      createClient: () => client,
    });
    const serialized = await response.text();

    expect(response.status).toBe(200);
    expect(JSON.parse(serialized)).toMatchObject({ ok: true, result: { status: expected } });
    expect(serialized).not.toContain("secret-token");
    expect(serialized).not.toContain("hostile");
  });

  it("maps only sanitized adapter transport provenance to network", async () => {
    const schemaClient = fakeContentClient();
    schemaClient.getItem = vi.fn().mockRejectedValue(
      new ContentReplacementApiError("safe", "schema"),
    );
    const transportClient = fakeContentClient();
    transportClient.getItem = vi.fn().mockRejectedValue(
      new ContentReplacementApiError("safe", "transport"),
    );
    const fetchTransportClient = fakeContentClient();
    fetchTransportClient.getItem = vi.fn().mockRejectedValue(new TypeError("secret-token network"));
    const unexpectedClient = fakeContentClient();
    unexpectedClient.getItem = vi.fn().mockRejectedValue(new Error("secret-token"));

    const schema = await handleContentReplacementApplyRequest(await validApplyPayload(), {
      createClient: () => schemaClient,
    });
    const transport = await handleContentReplacementApplyRequest(await validApplyPayload(), {
      createClient: () => transportClient,
    });
    const unexpected = await handleContentReplacementApplyRequest(await validApplyPayload(), {
      createClient: () => unexpectedClient,
    });
    const fetchTransport = await handleContentReplacementApplyRequest(await validApplyPayload(), {
      createClient: () => fetchTransportClient,
    });

    await expect(schema.json()).resolves.toMatchObject({ result: { status: "failed" } });
    await expect(transport.json()).resolves.toMatchObject({ result: { status: "network" } });
    await expect(fetchTransport.json()).resolves.toMatchObject({ result: { status: "failed" } });
    const serialized = await unexpected.text();
    expect(JSON.parse(serialized)).toMatchObject({ result: { status: "failed" } });
    expect(serialized).not.toContain("secret-token");
  });

  it("does not trust an unexpected error that impersonates an HTTP failure", async () => {
    const client = fakeContentClient();
    client.getItem = vi.fn().mockRejectedValue(
      Object.assign(new Error("secret-token"), { status: 401, category: "http" }),
    );

    const response = await handleContentReplacementApplyRequest(await validApplyPayload(), {
      createClient: () => client,
    });

    await expect(response.json()).resolves.toMatchObject({ result: { status: "failed" } });
  });

  it("rejects a job fingerprint mismatch before client construction", async () => {
    const createClient = vi.fn<CreateClient>();
    const response = await handleContentReplacementApplyRequest(
      await validApplyPayload({ jobFingerprint: "f".repeat(64) }),
      { createClient },
    );

    expect(response.status).toBe(409);
    expect(createClient).not.toHaveBeenCalled();
  });

  it.each([
    ["unknown root key", async () => ({ ...(await validApplyPayload()), replacementBody: { body: "pwned" } })],
    ["unknown credential key", async () => ({ ...(await validApplyPayload()), credentials: { ...credentials, secretCopy: "secret-token" } })],
    ["unknown configuration key", async () => ({ ...(await validApplyPayload()), configuration: { ...configuration, unsafe: true } })],
    ["unknown target key", async () => ({ ...(await validApplyPayload()), configuration: { ...configuration, target: { kind: "enterprise-main", teamId: 4 } } })],
    ["unknown content-type key", async () => ({ ...(await validApplyPayload()), configuration: { ...configuration, contentTypes: { ...configuration.contentTypes, comments: true } } })],
    ["unknown option key", async () => ({ ...(await validApplyPayload()), configuration: { ...configuration, options: { ...configuration.options, regex: true } } })],
    ["unknown rule key", async () => ({ ...(await validApplyPayload()), configuration: { ...configuration, rules: [{ ...configuration.rules[0], flags: "g" }] } })],
    ["unknown item-ref key", async () => ({ ...(await validApplyPayload()), itemRef: { kind: "question", questionId: 10, answerId: 2 } })],
    ["invalid digest format", async () => ({ ...(await validApplyPayload()), expectedScannedRequestChecksum: "A".repeat(64) })],
    ["wrong digest length", async () => ({ ...(await validApplyPayload()), expectedProposalFingerprint: "a".repeat(63) })],
    ["disabled selected kind", async () => ({ ...(await validApplyPayload()), configuration: { ...configuration, contentTypes: { questions: false, answers: true, articles: true } } })],
    ["disabled answer kind", async () => ({ ...(await validApplyPayload()), itemRef: { kind: "answer", questionId: 10, answerId: 11 }, configuration: { ...configuration, contentTypes: { questions: true, answers: false, articles: true } } })],
    ["disabled article kind", async () => ({ ...(await validApplyPayload()), itemRef: { kind: "article", articleId: 12 }, configuration: { ...configuration, contentTypes: { questions: true, answers: true, articles: false } } })],
    ["invalid rules", async () => ({ ...(await validApplyPayload()), configuration: { ...configuration, rules: [{ id: "x", find: " ", replace: "safe" }] } })],
  ])("rejects exact recursive payload violation before client construction: %s", async (_label, makePayload) => {
    await expectInvalidWithoutClient(await makePayload());
  });

  it.each([
    "https://demo.stackenterprise.co/proxy",
    "https://demo.stackenterprise.co/?proxy=1",
    "https://demo.stackenterprise.co/#fragment",
    "https://user:secret-token@demo.stackenterprise.co/",
  ])("rejects non-root Enterprise context before client construction: %s", async (baseUrl) => {
    const payload = await validApplyPayload({ credentials: { ...credentials, baseUrl } });
    const createClient = vi.fn<CreateClient>();

    const response = await handleContentReplacementApplyRequest(payload, { createClient });

    expect(response.status).toBe(400);
    expect(createClient).not.toHaveBeenCalled();
  });

  it.each([
    ["missing write scope", { ...credentials, oauthScopes: ["no_expiry"] }],
    ["expired token", { ...credentials, accessTokenExpiresAt: "2000-01-01T00:00:00.000Z", oauthScopes: ["write_access"] }],
    ["unsupported instance", { ...credentials, baseUrl: "https://evil.example" }],
  ])("rejects invalid Enterprise write credentials before client construction: %s", async (_label, invalidCredentials) => {
    const createClient = vi.fn<CreateClient>();
    const response = await handleContentReplacementApplyRequest(
      await validApplyPayload({ credentials: invalidCredentials as SessionCredentials }),
      { createClient },
    );

    expect(response.status).toBe(400);
    expect(createClient).not.toHaveBeenCalled();
  });

  it("uses the five-second per-wait production cap and returns a sanitized throttle notice", async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      new Response("secret-token upstream body", {
        status: 429,
        headers: { "Retry-After": "6" },
      }),
    );
    const scheduledWait = vi.fn();
    vi.stubGlobal("fetch", fetchFn);
    vi.stubGlobal("setTimeout", scheduledWait);

    const response = await handleContentReplacementApplyRequest(await validApplyPayload());
    const serialized = await response.text();

    expect(response.status).toBe(200);
    expect(JSON.parse(serialized)).toEqual({
      ok: true,
      result: { status: "network", error: "Unable to read the current content item." },
      throttleNotices: [{ kind: "backoff", seconds: 6 }],
    });
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(scheduledWait).not.toHaveBeenCalled();
    expect(serialized).not.toContain("secret-token");
    expect(serialized).not.toContain("upstream");
  });

  it("stops production GET retries before cumulative waits exceed ten seconds", async () => {
    const fetchFn = vi.fn()
      .mockResolvedValueOnce(new Response("limited", { status: 429, headers: { "Retry-After": "5" } }))
      .mockResolvedValueOnce(new Response("limited", { status: 429, headers: { "Retry-After": "5" } }))
      .mockResolvedValueOnce(new Response("limited", { status: 429, headers: { "Retry-After": "1" } }));
    const scheduledWait = vi.fn((callback: () => void, _delay?: number) => {
      callback();
      return 1;
    });
    vi.stubGlobal("fetch", fetchFn);
    vi.stubGlobal("setTimeout", scheduledWait);

    const response = await handleContentReplacementApplyRequest(await validApplyPayload());

    await expect(response.json()).resolves.toMatchObject({ result: { status: "network" } });
    expect(fetchFn).toHaveBeenCalledTimes(3);
    expect(scheduledWait.mock.calls.map(([, delay]) => delay)).toEqual([5_000, 5_000]);
  });

  it("never retries a production PUT whose response may have been lost", async () => {
    const fetchFn = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "PUT") throw new TypeError("secret-token lost response");
      return new Response(JSON.stringify({
        id: 10,
        title: "Rename TermA",
        bodyMarkdown: "Use TermA.",
        tags: [{ name: "product" }],
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    });
    const scheduledWait = vi.fn((callback: () => void) => {
      callback();
      return 1;
    });
    vi.stubGlobal("fetch", fetchFn);
    vi.stubGlobal("setTimeout", scheduledWait);

    const response = await handleContentReplacementApplyRequest(await validApplyPayload());

    await expect(response.json()).resolves.toMatchObject({ result: { status: "network" } });
    expect(fetchFn.mock.calls.filter(([, init]) => init?.method === "PUT")).toHaveLength(1);
    expect(scheduledWait).not.toHaveBeenCalled();
  });

  it("returns one sanitized backoff notice for a no-retry production 503 PUT", async () => {
    const fetchFn = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "PUT") {
        return new Response(JSON.stringify({ error_message: "secret-token upstream failure" }), {
          status: 503,
          headers: { "Retry-After": "30", "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({
        id: 10,
        title: "Rename TermA",
        bodyMarkdown: "Use TermA.",
        tags: [{ name: "product" }],
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    });
    const scheduledWait = vi.fn();
    vi.stubGlobal("fetch", fetchFn);
    vi.stubGlobal("setTimeout", scheduledWait);

    const response = await handleContentReplacementApplyRequest(await validApplyPayload());
    const serialized = await response.text();

    expect(JSON.parse(serialized)).toEqual({
      ok: true,
      result: { status: "network", error: "Unable to update the content item." },
      throttleNotices: [{ kind: "backoff", seconds: 30 }],
    });
    expect(fetchFn.mock.calls.filter(([, init]) => init?.method === "PUT")).toHaveLength(1);
    expect(scheduledWait).not.toHaveBeenCalled();
    expect(serialized).not.toContain("secret-token");
    expect(serialized).not.toContain("upstream");
  });
});

describe("content replacement apply route", () => {
  it("uses the bounded JSON reader and delegates one valid request exactly once", async () => {
    const api = await import("./contentReplacementApplyApi");
    const handler = vi.spyOn(api, "handleContentReplacementApplyRequest").mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );
    const { POST, runtime } = await import("../app/api/write-tools/content-replacement/apply/route");
    const payload = await validApplyPayload();

    const response = await POST(new Request("https://local.test/apply", {
      method: "POST",
      body: JSON.stringify(payload),
    }));

    expect(runtime).toBe("nodejs");
    expect(response.status).toBe(200);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(payload);
  });

  it("returns a bounded-reader error without delegating", async () => {
    const api = await import("./contentReplacementApplyApi");
    const handler = vi.spyOn(api, "handleContentReplacementApplyRequest");
    const { POST } = await import("../app/api/write-tools/content-replacement/apply/route");

    const response = await POST(new Request("https://local.test/apply", {
      method: "POST",
      body: "not-json",
    }));

    expect(response.status).toBe(400);
    expect(handler).not.toHaveBeenCalled();
  });
});
