import { describe, expect, it, vi } from "vitest";

import { StackApiError, type ThrottleNotice } from "../api/httpClient";
import type { NormalizedInstance } from "../credentials/credentialRules";
import type { SessionCredentials } from "../domain/types";
import type { ContentReplacementClient } from "../writeTools/contentReplacement/contentApi";
import { createJobFingerprint } from "../writeTools/contentReplacement/proposals";
import type {
  ReplacementConfiguration,
  ReplacementItemRef,
} from "../writeTools/contentReplacement/types";
import {
  handleContentReplacementScanRequest,
  type ContentReplacementScanPayload,
} from "./contentReplacementScanApi";

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
  rules: [{ id: "rule-1", find: "MyPVM", replace: "MyPBM" }],
  options: { caseSensitive: true, wholeTerm: true, replaceInCode: false },
};

type CreateClient = (
  normalizedCredentials: SessionCredentials,
  instance: NormalizedInstance,
  onThrottle: (notice: unknown) => void,
) => ContentReplacementClient;

async function validScanPayload(
  overrides: Partial<ContentReplacementScanPayload> = {},
): Promise<ContentReplacementScanPayload> {
  return {
    action: "inventory",
    credentials,
    configuration,
    jobFingerprint: await createJobFingerprint({
      baseUrl: "https://demo.stackenterprise.co",
      configuration,
    }),
    cursor: { kind: "questions", page: 1 },
    ...overrides,
  } as ContentReplacementScanPayload;
}

function fakeContentClient(
  overrides: Partial<ContentReplacementClient> = {},
): ContentReplacementClient {
  return {
    getQuestionsPage: vi.fn().mockResolvedValue({
      items: [{ id: 10, title: "Rename MyPVM", body: "<p>Body</p>" }],
      page: 1,
      totalPages: 2,
      hasMore: true,
    }),
    getAnswersPage: vi.fn().mockResolvedValue({
      items: [],
      page: 1,
      totalPages: 1,
      hasMore: false,
    }),
    getArticlesPage: vi.fn().mockResolvedValue({
      items: [],
      page: 1,
      totalPages: 1,
      hasMore: false,
    }),
    getItem: vi.fn().mockResolvedValue({
      kind: "question",
      ref: { kind: "question", questionId: 10 },
      request: { title: "Rename MyPVM", body: "MyPVM body", tags: ["product"] },
    }),
    updateItem: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

async function expectInvalidWithoutClient(payload: unknown): Promise<void> {
  const createClient = vi.fn<CreateClient>();
  const response = await handleContentReplacementScanRequest(payload, { createClient });

  expect(response.status).toBe(400);
  await expect(response.json()).resolves.toEqual({
    ok: false,
    error: "Content replacement scan request is invalid.",
  });
  expect(createClient).not.toHaveBeenCalled();
}

describe("handleContentReplacementScanRequest", () => {
  it("returns one bounded inventory slice with sanitized throttle notices", async () => {
    const client = fakeContentClient();
    const createClient = vi.fn<CreateClient>((normalizedCredentials, instance, onThrottle) => {
      expect(normalizedCredentials.accessToken).toBe("secret-token");
      expect(instance.baseUrl).toBe("https://demo.stackenterprise.co");
      onThrottle({ kind: "burst", seconds: 7, remaining: 2 } satisfies ThrottleNotice);
      onThrottle({ kind: "burst", seconds: 7, remaining: 2, upstream: "secret-token" });
      onThrottle({ kind: "backoff", seconds: -1 });
      return client;
    });

    const response = await handleContentReplacementScanRequest(await validScanPayload(), {
      createClient,
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      result: {
        candidates: [{ kind: "question", questionId: 10 }],
        answerCursors: [{ kind: "answers", questionId: 10, page: 1 }],
        nextCursor: { kind: "questions", page: 2 },
        inspectedCount: 1,
        pageKind: "questions",
      },
      throttleNotices: [{ kind: "burst", seconds: 7, remaining: 2 }],
    });
    expect(client.getQuestionsPage).toHaveBeenCalledTimes(1);
    expect(client.getQuestionsPage).toHaveBeenCalledWith(1);
    expect(client.getItem).not.toHaveBeenCalled();
  });

  it("returns a detail batch of at most ten canonical proposals", async () => {
    const client = fakeContentClient();
    const payload = await validScanPayload({
      action: "details",
      refs: [{ kind: "question", questionId: 10 }],
    } as Partial<ContentReplacementScanPayload>);
    delete (payload as { cursor?: unknown }).cursor;

    const response = await handleContentReplacementScanRequest(payload, {
      createClient: () => client,
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({
      ok: true,
      result: {
        inspectedCount: 1,
        protectedOccurrenceCount: 0,
        proposals: [
          {
            before: {
              kind: "question",
              ref: { kind: "question", questionId: 10 },
              request: { title: "Rename MyPVM", body: "MyPVM body", tags: ["product"] },
            },
            after: {
              request: { title: "Rename MyPBM", body: "MyPBM body", tags: ["product"] },
            },
            changedOccurrences: [
              { field: "title", ruleId: "rule-1", before: "MyPVM", after: "MyPBM" },
              { field: "body", ruleId: "rule-1", before: "MyPVM", after: "MyPBM" },
            ],
            appliedRuleIds: ["rule-1"],
          },
        ],
      },
      throttleNotices: [],
    });
    expect(client.getItem).toHaveBeenCalledTimes(1);
    expect(client.getQuestionsPage).not.toHaveBeenCalled();
  });

  it("rejects a client fingerprint that does not match the normalized configuration", async () => {
    const createClient = vi.fn<CreateClient>();
    const response = await handleContentReplacementScanRequest(
      await validScanPayload({ jobFingerprint: "tampered" }),
      { createClient },
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: "Replacement job configuration changed. Start a new scan.",
    });
    expect(createClient).not.toHaveBeenCalled();
  });

  it("uses the normalized Enterprise origin when verifying the fingerprint", async () => {
    const response = await handleContentReplacementScanRequest(await validScanPayload(), {
      createClient: () => fakeContentClient(),
    });

    expect(response.status).toBe(200);
  });

  it.each([
    ["unknown root key", async () => ({ ...(await validScanPayload()), unexpected: true })],
    ["inventory-only refs", async () => ({ ...(await validScanPayload()), refs: [] })],
    ["details-only cursor", async () => {
      const payload = await validScanPayload({ action: "details", refs: [{ kind: "article", articleId: 1 }] } as Partial<ContentReplacementScanPayload>);
      return { ...payload, cursor: { kind: "articles", page: 1 } };
    }],
    ["unknown credential key", async () => ({ ...(await validScanPayload()), credentials: { ...credentials, tokenCopy: "secret-token" } })],
    ["unknown configuration key", async () => ({ ...(await validScanPayload()), configuration: { ...configuration, mode: "unsafe" } })],
    ["unknown target key", async () => ({ ...(await validScanPayload()), configuration: { ...configuration, target: { kind: "enterprise-main", teamId: 1 } } })],
    ["unknown content-type key", async () => ({ ...(await validScanPayload()), configuration: { ...configuration, contentTypes: { ...configuration.contentTypes, comments: true } } })],
    ["unknown option key", async () => ({ ...(await validScanPayload()), configuration: { ...configuration, options: { ...configuration.options, regex: true } } })],
    ["unknown rule key", async () => ({ ...(await validScanPayload()), configuration: { ...configuration, rules: [{ ...configuration.rules[0], flags: "g" }] } })],
    ["unknown cursor key", async () => ({ ...(await validScanPayload()), cursor: { kind: "questions", page: 1, pageSize: 500 } })],
    ["unknown ref key", async () => {
      const payload = await validScanPayload({ action: "details", refs: [{ kind: "question", questionId: 1, answerId: 2 } as unknown as ReplacementItemRef] } as Partial<ContentReplacementScanPayload>);
      delete (payload as { cursor?: unknown }).cursor;
      return payload;
    }],
  ])("rejects exact-shape violation: %s", async (_label, makePayload) => {
    await expectInvalidWithoutClient(await makePayload());
  });

  it.each([
    ["team target", { ...configuration, target: { kind: "enterprise-team", teamId: 4 } }],
    ["no content type", { ...configuration, contentTypes: { questions: false, answers: false, articles: false } }],
    ["no rules", { ...configuration, rules: [] }],
    ["too many rules", { ...configuration, rules: Array.from({ length: 501 }, (_, index) => ({ id: String(index), find: `old-${index}`, replace: `new-${index}` })) }],
    ["oversized source", { ...configuration, rules: [{ id: "1", find: "a".repeat(201), replace: "b" }] }],
    ["oversized replacement", { ...configuration, rules: [{ id: "1", find: "a", replace: "b".repeat(501) }] }],
    ["blank source", { ...configuration, rules: [{ id: "1", find: " ", replace: "b" }] }],
    ["conflicting canonical rules", { ...configuration, rules: [{ id: "1", find: "alpha", replace: "beta" }, { id: "2", find: "beta", replace: "gamma" }] }],
  ])("revalidates invalid server-side configuration: %s", async (_label, invalidConfiguration) => {
    await expectInvalidWithoutClient(await validScanPayload({
      configuration: invalidConfiguration as ReplacementConfiguration,
    }));
  });

  it.each([
    { kind: "questions", page: 0 },
    { kind: "questions", page: 10_001 },
    { kind: "articles", page: 1.5 },
    { kind: "answers", questionId: 0, page: 1 },
    { kind: "answers", questionId: Number.MAX_SAFE_INTEGER + 1, page: 1 },
  ])("rejects an invalid bounded inventory cursor: %o", async (cursor) => {
    await expectInvalidWithoutClient(await validScanPayload({ cursor } as Partial<ContentReplacementScanPayload>));
  });

  it.each([
    [[]],
    [Array.from({ length: 11 }, (_, index) => ({ kind: "article", articleId: index + 1 }))],
    [[{ kind: "question", questionId: 1 }, { kind: "question", questionId: 1 }]],
    [[{ kind: "question", questionId: 0 }]],
    [[{ kind: "answer", questionId: 1, answerId: Number.MAX_SAFE_INTEGER + 1 }]],
    [[{ kind: "other", articleId: 1 }]],
  ] as [unknown[]][]) ("rejects an invalid bounded detail ref batch: %o", async (refs) => {
    const payload = await validScanPayload({ action: "details", refs } as Partial<ContentReplacementScanPayload>);
    delete (payload as { cursor?: unknown }).cursor;
    await expectInvalidWithoutClient(payload);
  });

  it.each([
    ["host suffix attack", { ...credentials, baseUrl: "https://demo.stackenterprise.co.evil.example" }],
    ["missing write scope", { ...credentials, oauthScopes: ["no_expiry"] }],
    ["expired token", { ...credentials, accessTokenExpiresAt: "2000-01-01T00:00:00.000Z", oauthScopes: ["write_access"] }],
    ["invalid manual token source", { ...credentials, authSource: "manual-pat" }],
  ])("applies the shared Enterprise write context: %s", async (_label, invalidCredentials) => {
    const createClient = vi.fn<CreateClient>();
    const response = await handleContentReplacementScanRequest(
      await validScanPayload({ credentials: invalidCredentials as SessionCredentials }),
      { createClient },
    );

    expect(response.status).toBe(400);
    expect(JSON.stringify(await response.json())).not.toContain("secret-token");
    expect(createClient).not.toHaveBeenCalled();
  });

  it.each([
    [400, 400, "Content scan request was rejected by Stack Enterprise."],
    [401, 401, "Stack Enterprise credentials were rejected."],
    [403, 403, "Stack Enterprise access was denied."],
    [409, 409, "Stack Enterprise content changed during scanning."],
    [500, 502, "Unable to complete the content scan."],
    [503, 502, "Stack Enterprise is temporarily unavailable."],
  ])("maps hostile upstream status %i to a stable safe response", async (upstreamStatus, expectedStatus, expectedError) => {
    const hostile = new StackApiError(
      `failed with secret-token`,
      upstreamStatus,
      "https://demo.stackenterprise.co/api/v3/questions?authorization=secret-token",
      JSON.stringify({ secret: "secret-token", nested: { "secret-token": "secret-token" } }),
    );
    (hostile as Error & { cause?: unknown }).cause = { token: "secret-token", error: hostile };
    const client = fakeContentClient({ getQuestionsPage: vi.fn().mockRejectedValue(hostile) });

    const response = await handleContentReplacementScanRequest(await validScanPayload(), {
      createClient: () => client,
    });
    const serialized = await response.text();

    expect(response.status).toBe(expectedStatus);
    expect(JSON.parse(serialized)).toEqual({ ok: false, error: expectedError });
    expect(serialized).not.toContain("secret-token");
    expect(serialized).not.toContain("authorization");
    expect(serialized).not.toContain("questions?");
  });

  it("contains a hostile client-construction failure without exposing credentials", async () => {
    const response = await handleContentReplacementScanRequest(await validScanPayload(), {
      createClient: () => {
        throw new Error("client setup exposed secret-token");
      },
    });

    expect(response.status).toBe(502);
    const serialized = await response.text();
    expect(JSON.parse(serialized)).toEqual({
      ok: false,
      error: "Unable to complete the content scan.",
    });
    expect(serialized).not.toContain("secret-token");
  });

  it("returns exhausted rate limiting as a typed bounded backoff response", async () => {
    const client = fakeContentClient({
      getQuestionsPage: vi.fn().mockRejectedValue(
        new StackApiError("secret-token upstream limit", 429, "https://secret-token.example", "secret-token"),
      ),
    });

    const response = await handleContentReplacementScanRequest(await validScanPayload(), {
      createClient: (_credentials, _instance, onThrottle) => {
        onThrottle({ kind: "backoff", seconds: 17 });
        onThrottle({ kind: "backoff", seconds: Number.MAX_SAFE_INTEGER });
        return client;
      },
    });

    expect(response.status).toBe(429);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: {
        code: "rate_limited",
        message: "Content scan is temporarily rate limited.",
        retryAfterSeconds: 17,
      },
    });
  });

  it("redacts credentials from nested hostile details while preserving protocol keys and enums", async () => {
    const client = fakeContentClient({
      getItem: vi.fn().mockResolvedValue({
        kind: "question",
        ref: { kind: "question", questionId: 10 },
        request: {
          title: "Rename MyPVM secret-token",
          body: "MyPVM secret-token",
          tags: ["secret-token"],
        },
        metadata: {
          owner: { id: 4, name: "secret-token" },
          webUrl: "https://example.test/secret-token",
        },
      }),
    });
    const payload = await validScanPayload({
      action: "details",
      refs: [{ kind: "question", questionId: 10 }],
    } as Partial<ContentReplacementScanPayload>);
    delete (payload as { cursor?: unknown }).cursor;

    const response = await handleContentReplacementScanRequest(payload, {
      createClient: () => client,
    });
    const serialized = await response.text();
    const body = JSON.parse(serialized);

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.result.proposals[0].before.kind).toBe("question");
    expect(body.result.proposals[0].before.request).toHaveProperty("body");
    expect(body.result.proposals[0].changedOccurrences[0]).toHaveProperty("field");
    expect(serialized).not.toContain("secret-token");
  });

  it("preserves scan protocol discriminators when a short credential matches them", async () => {
    const shortCredentials: SessionCredentials = {
      instanceType: "enterprise",
      baseUrl: "https://demo.stackenterprise.co",
      accessToken: "question",
      authSource: "manual-enterprise-token",
    };
    const shortPayload = await validScanPayload({ credentials: shortCredentials });
    shortPayload.jobFingerprint = await createJobFingerprint({
      baseUrl: shortCredentials.baseUrl,
      configuration,
    });

    const response = await handleContentReplacementScanRequest(shortPayload, {
      createClient: () => fakeContentClient(),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      result: {
        candidates: [{ kind: "question", questionId: 10 }],
        pageKind: "questions",
      },
    });
  });

  it("preserves a protocol key only at its declared path", async () => {
    const shortCredentials: SessionCredentials = {
      instanceType: "enterprise",
      baseUrl: "https://demo.stackenterprise.co",
      accessToken: "body",
      authSource: "manual-enterprise-token",
    };
    const payload = await validScanPayload({
      action: "details",
      credentials: shortCredentials,
      refs: [{ kind: "question", questionId: 10 }],
    } as Partial<ContentReplacementScanPayload>);
    delete (payload as { cursor?: unknown }).cursor;
    payload.jobFingerprint = await createJobFingerprint({
      baseUrl: shortCredentials.baseUrl,
      configuration,
    });
    const client = fakeContentClient({
      getItem: vi.fn().mockResolvedValue({
        kind: "question",
        ref: { kind: "question", questionId: 10 },
        request: { title: "Rename MyPVM", body: "MyPVM text", tags: [] },
        metadata: { body: "untrusted metadata" },
      }),
    });

    const response = await handleContentReplacementScanRequest(payload, {
      createClient: () => client,
    });
    const proposal = (await response.json()).result.proposals[0];

    expect(proposal.before.request).toHaveProperty("body");
    expect(proposal.before.metadata).not.toHaveProperty("body");
  });
});

describe("content replacement scan route", () => {
  it("uses the bounded JSON reader and delegates one valid request exactly once", async () => {
    const scanApi = await import("./contentReplacementScanApi");
    const handler = vi.spyOn(scanApi, "handleContentReplacementScanRequest").mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    const { POST, runtime } = await import("../app/api/write-tools/content-replacement/scan/route");
    const payload = await validScanPayload();

    const response = await POST(new Request("https://local.test/api/write-tools/content-replacement/scan", {
      method: "POST",
      body: JSON.stringify(payload),
    }));

    expect(runtime).toBe("nodejs");
    expect(response.status).toBe(200);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(payload);
    handler.mockRestore();
  });

  it("returns the bounded reader's early response without delegating", async () => {
    const scanApi = await import("./contentReplacementScanApi");
    const handler = vi.spyOn(scanApi, "handleContentReplacementScanRequest");
    const { POST } = await import("../app/api/write-tools/content-replacement/scan/route");

    const response = await POST(new Request("https://local.test/api/write-tools/content-replacement/scan", {
      method: "POST",
      body: "not-json",
    }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: "Request body must contain valid JSON.",
    });
    expect(handler).not.toHaveBeenCalled();
    handler.mockRestore();
  });
});
