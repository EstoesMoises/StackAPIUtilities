import { describe, expect, it, vi } from "vitest";
import type { FetchLike } from "../../api/httpClient";
import * as liveCollectors from "../../collectors/liveCollectors";
import type { SessionCredentials } from "../../domain/types";
import * as decisionPack from "./decisionPack";
import { runSmeCoverageAnalysis, SmeCoverageRunError } from "./runner";
import type { SmeCoverageRunResult } from "./runner";

function assertDeepReadonlyResultType(result: SmeCoverageRunResult): void {
  // @ts-expect-error Runner decision-pack summaries are deeply readonly.
  result.decisionPack.summary.tagsAnalyzed = 0;
  // @ts-expect-error Runner decision-pack evidence rows are deeply readonly.
  result.decisionPack.evidence[0].tagName = "changed";
}

void assertDeepReadonlyResultType;

const basicCredentials: SessionCredentials = {
  instanceType: "basic-business",
  baseUrl: "https://stackoverflowteams.com/c/example-team",
  pat: "basic-pat-secret",
  authSource: "manual-pat",
};

const enterpriseCredentials: SessionCredentials = {
  instanceType: "enterprise",
  baseUrl: "https://demo.stackenterprise.co",
  apiKey: "enterprise-api-key-secret",
  accessToken: "enterprise-access-token-secret",
  authSource: "manual-enterprise-token",
};

function v2Page(items: Record<string, unknown>[], hasMore = false): Response {
  return new Response(JSON.stringify({ items, has_more: hasMore }), { status: 200 });
}

function v3Page(items: Record<string, unknown>[], totalPages = 1): Response {
  return new Response(JSON.stringify({ items, totalPages }), { status: 200 });
}

function standardFetch(requestUrls: string[] = []): FetchLike {
  return vi.fn().mockImplementation((input: RequestInfo | URL) => {
    const url = input.toString();
    requestUrls.push(url);
    if (url.includes("/2.3/tags")) return Promise.resolve(v2Page([{ name: "piper", count: 8 }]));
    if (url.includes("/2.3/questions")) {
      return Promise.resolve(v2Page([{ question_id: 1, tags: ["piper"], view_count: 800 }]));
    }
    if (url.includes("/v3/") && url.includes("/tags")) {
      return Promise.resolve(v3Page([{ name: "piper", subjectMatterExpertCount: 1 }]));
    }
    throw new Error(`Unexpected URL: ${url}`);
  }) as FetchLike;
}

function exhaustiveMultiPageFetch(requestUrls: string[] = []): FetchLike {
  return vi.fn().mockImplementation((input: RequestInfo | URL) => {
    const url = new URL(input.toString());
    const page = Number(url.searchParams.get("page"));
    requestUrls.push(url.toString());
    if (url.pathname.includes("/2.3/tags")) {
      return Promise.resolve(v2Page([{ name: page === 1 ? "piper" : "kafka", count: 8 }], page === 1));
    }
    if (url.pathname.includes("/2.3/questions")) {
      return Promise.resolve(v2Page([
        { question_id: page, tags: [page === 1 ? "piper" : "kafka"], view_count: page * 400 },
      ], page === 1));
    }
    if (url.pathname.includes("/v3/") && url.pathname.includes("/tags")) {
      return Promise.resolve(v3Page([
        { name: page === 1 ? "piper" : "kafka", subjectMatterExpertCount: 1 },
      ], 2));
    }
    throw new Error(`Unexpected URL: ${url.toString()}`);
  }) as FetchLike;
}

describe("runSmeCoverageAnalysis", () => {
  it("collects exactly v2 tags, v2 questions, and v3 tags before composing one decision pack", async () => {
    const requestUrls: string[] = [];

    const result = await runSmeCoverageAnalysis(basicCredentials, {
      fetchFn: standardFetch(requestUrls),
    });

    expect(requestUrls).toHaveLength(3);
    expect(requestUrls.filter((url) => url.includes("/2.3/tags"))).toHaveLength(1);
    expect(requestUrls.filter((url) => url.includes("/2.3/questions"))).toHaveLength(1);
    expect(requestUrls.filter((url) => url.includes("/v3/teams/example-team/tags"))).toHaveLength(1);
    expect(requestUrls.some((url) => url.includes("top-answerers"))).toBe(false);
    expect(requestUrls.some((url) => url.includes("/users") || url.includes("/articles"))).toBe(false);
    expect(requestUrls.every((url) => !url.includes("fromdate") && !url.includes("todate"))).toBe(true);
    expect(result.datasets.map((dataset) => dataset.datasetName)).toEqual([
      "tags",
      "questions",
      "tagSmeCounts",
    ]);
    expect(result.decisionPack.evidence[0]).toMatchObject({
      tagName: "piper",
      pageViews: 800,
      smeCount: 1,
      pageViewsPerSme: 800,
    });
  });

  it("sends only the Basic/Business PAT when credentials retain a stale Enterprise API key", async () => {
    const fetchMock = standardFetch() as ReturnType<typeof vi.fn>;

    await runSmeCoverageAnalysis(
      { ...basicCredentials, apiKey: "stale-enterprise-api-key" },
      { fetchFn: fetchMock },
    );

    const v2Calls = fetchMock.mock.calls.filter(([input]) => input.toString().includes("/2.3/"));
    const v3Call = fetchMock.mock.calls.find(([input]) => input.toString().includes("/v3/"));
    expect(v2Calls).toHaveLength(2);
    for (const [, init] of v2Calls) {
      expect(init?.headers).toEqual({
        "X-API-Access-Token": "basic-pat-secret",
        Authorization: "Bearer basic-pat-secret",
      });
    }
    expect(v3Call?.[1]?.headers).toMatchObject({ Authorization: "Bearer basic-pat-secret" });
  });

  it("keeps Enterprise v2 API-key and v3 bearer authentication in separate lanes", async () => {
    const fetchMock = standardFetch() as ReturnType<typeof vi.fn>;

    await runSmeCoverageAnalysis(enterpriseCredentials, { fetchFn: fetchMock });

    const v2Calls = fetchMock.mock.calls.filter(([input]) => input.toString().includes("/api/2.3/"));
    const v3Call = fetchMock.mock.calls.find(([input]) => input.toString().includes("/api/v3/"));
    expect(v2Calls).toHaveLength(2);
    for (const [, init] of v2Calls) {
      expect(init?.headers).toEqual({ "X-API-Key": "enterprise-api-key-secret" });
    }
    expect(v3Call?.[1]?.headers).toMatchObject({ Authorization: "Bearer enterprise-access-token-secret" });
  });

  it.each([
    ["Basic/Business PAT", { ...basicCredentials, pat: "" }],
    ["Enterprise API key", { ...enterpriseCredentials, apiKey: "" }],
    ["Enterprise access token", { ...enterpriseCredentials, accessToken: "" }],
  ])("rejects missing %s credentials before fetch", async (_label, credentials) => {
    const fetchMock = vi.fn();

    await expect(runSmeCoverageAnalysis(credentials, { fetchFn: fetchMock })).rejects.toMatchObject({
      kind: "validation",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each(["tags", "questions", "tagSmeCounts"] as const)(
    "reports the %s stage when that source fetch fails",
    async (failedStage) => {
      const fetchMock: FetchLike = vi.fn().mockImplementation((input: RequestInfo | URL) => {
        const url = input.toString();
        const matches =
          (failedStage === "tags" && url.includes("/2.3/tags")) ||
          (failedStage === "questions" && url.includes("/2.3/questions")) ||
          (failedStage === "tagSmeCounts" && url.includes("/v3/") && url.includes("/tags"));
        if (matches) return Promise.resolve(new Response("source failed", { status: 500 }));
        if (url.includes("/2.3/tags")) return Promise.resolve(v2Page([{ name: "piper" }]));
        if (url.includes("/2.3/questions")) return Promise.resolve(v2Page([]));
        return Promise.resolve(v3Page([{ name: "piper", subjectMatterExpertCount: 1 }]));
      }) as FetchLike;

      const error = await runSmeCoverageAnalysis(basicCredentials, { fetchFn: fetchMock }).catch(
        (caught: unknown) => caught,
      );
      expect(error).toBeInstanceOf(SmeCoverageRunError);
      expect(error).toMatchObject({ kind: "collection", stage: failedStage });
    },
  );

  it("collects every source across all pages and records terminal pagination", async () => {
    const requestUrls: string[] = [];

    const result = await runSmeCoverageAnalysis(basicCredentials, {
      fetchFn: exhaustiveMultiPageFetch(requestUrls),
    });

    expect(requestUrls).toHaveLength(6);
    expect(result.datasets).toHaveLength(3);
    for (const dataset of result.datasets) {
      expect(dataset.records).toHaveLength(2);
      expect(dataset.pagination).toEqual({
        pageCount: 2,
        reachedMaxPages: false,
        hasMore: false,
      });
    }
    expect(result).not.toHaveProperty("pageSize");
    expect(result).not.toHaveProperty("maxPagesPerDataset");
    expect(result).not.toHaveProperty("runPreset");
  });

  describe.each(["tags", "questions", "tagSmeCounts"] as const)("nonterminal %s collection", (source) => {
    it.each([
      ["reachedMaxPages", { pageCount: 1, reachedMaxPages: true, hasMore: false }],
      ["hasMore", { pageCount: 1, reachedMaxPages: false, hasMore: true }],
    ] as const)("fails closed when metadata reports %s", async (_label, nonterminalPagination) => {
      const collectSpy = vi.spyOn(liveCollectors, "collectDataset").mockImplementation(async (datasetName) => {
        const records = datasetName === "questions"
          ? [{ question_id: 1, tags: ["piper"], view_count: 800 }]
          : [{ name: "piper", subjectMatterExpertCount: 1 }];
        return {
          records,
          pagination: datasetName === source
            ? nonterminalPagination
            : { pageCount: 1, reachedMaxPages: false, hasMore: false },
        };
      });

      const error = await runSmeCoverageAnalysis(basicCredentials, { fetchFn: vi.fn() }).catch(
        (caught: unknown) => caught,
      );
      const collectedSources = collectSpy.mock.calls.map(([datasetName]) => datasetName);
      collectSpy.mockRestore();

      expect(error).toBeInstanceOf(SmeCoverageRunError);
      expect(error).toMatchObject({
        kind: "collection",
        stage: source,
        message: `${source} collection did not reach terminal pagination. No complete result was produced.`,
      });
      expect(collectedSources).toEqual(
        ["tags", "questions", "tagSmeCounts"].slice(0, ["tags", "questions", "tagSmeCounts"].indexOf(source) + 1),
      );
    });
  });

  it.each(["tags", "questions", "tagSmeCounts"] as const)(
    "surfaces a malformed %s pagination envelope as a collection error",
    async (failedStage) => {
      const decisionPackSpy = vi.spyOn(decisionPack, "buildSmeCoverageDecisionPack");
      const fetchMock: FetchLike = vi.fn().mockImplementation((input: RequestInfo | URL) => {
        const url = input.toString();
        if (url.includes("/2.3/tags")) {
          return Promise.resolve(failedStage === "tags"
            ? new Response(JSON.stringify({ has_more: false }), { status: 200 })
            : v2Page([{ name: "piper", count: 8 }]));
        }
        if (url.includes("/2.3/questions")) {
          return Promise.resolve(failedStage === "questions"
            ? new Response(JSON.stringify({ items: [] }), { status: 200 })
            : v2Page([{ question_id: 1, tags: ["piper"], view_count: 800 }]));
        }
        return Promise.resolve(failedStage === "tagSmeCounts"
          ? new Response(JSON.stringify({ totalPages: 1 }), { status: 200 })
          : v3Page([{ name: "piper", subjectMatterExpertCount: 1 }]));
      }) as FetchLike;

      const error = await runSmeCoverageAnalysis(basicCredentials, { fetchFn: fetchMock }).catch(
        (caught: unknown) => caught,
      );
      const decisionPackCallCount = decisionPackSpy.mock.calls.length;
      decisionPackSpy.mockRestore();

      expect(error).toBeInstanceOf(SmeCoverageRunError);
      expect(error).toMatchObject({
        kind: "collection",
        stage: failedStage,
        message: expect.stringContaining("invalid pagination envelope"),
      });
      expect(decisionPackCallCount).toBe(0);
    },
  );

  it("rejects v2 tag data when v3 provides no matching authoritative numeric SME count", async () => {
    const fetchMock: FetchLike = vi.fn().mockImplementation((input: RequestInfo | URL) => {
      const url = input.toString();
      if (url.includes("/2.3/tags")) return Promise.resolve(v2Page([{ name: "piper" }]));
      if (url.includes("/2.3/questions")) return Promise.resolve(v2Page([]));
      return Promise.resolve(v3Page([{ name: "kafka", subjectMatterExpertCount: 2 }]));
    }) as FetchLike;

    await expect(runSmeCoverageAnalysis(basicCredentials, { fetchFn: fetchMock })).rejects.toMatchObject({
      kind: "unsupported",
      stage: "tagSmeCounts",
      message: expect.stringContaining("numeric assigned-SME count"),
    });
  });

  it.each([
    ["tags", [{ count: 8 }], [], []],
    ["questions", [], [{ question_id: 1, view_count: 12 }], []],
    ["tagSmeCounts", [], [], [{ subjectMatterExpertCount: 1 }]],
  ] as const)("rejects non-empty %s records with no usable tag identity", async (stage, tags, questions, smeCounts) => {
    const fetchMock: FetchLike = vi.fn().mockImplementation((input: RequestInfo | URL) => {
      const url = input.toString();
      if (url.includes("/2.3/tags")) return Promise.resolve(v2Page([...tags]));
      if (url.includes("/2.3/questions")) return Promise.resolve(v2Page([...questions]));
      return Promise.resolve(v3Page([...smeCounts]));
    }) as FetchLike;

    await expect(runSmeCoverageAnalysis(basicCredentials, { fetchFn: fetchMock })).rejects.toMatchObject({
      kind: "collection",
      stage,
      message: expect.stringContaining("no usable tag identity"),
    });
  });

  it("returns an empty decision pack when all three sources are successfully empty", async () => {
    const fetchMock: FetchLike = vi.fn().mockImplementation((input: RequestInfo | URL) =>
      Promise.resolve(input.toString().includes("/v3/") ? v3Page([]) : v2Page([])),
    ) as FetchLike;

    const result = await runSmeCoverageAnalysis(basicCredentials, {
      fetchFn: fetchMock,
    });

    expect(result.decisionPack.snapshot.completeness).toBe("Empty");
    expect(result.decisionPack.evidence).toEqual([]);
    expect(result.decisionPack.summary.tagsAnalyzed).toBe(0);
  });

  it("uses the injected clock and normalized instance host in the snapshot", async () => {
    const result = await runSmeCoverageAnalysis(enterpriseCredentials, {
      fetchFn: standardFetch(),
      clock: () => new Date("2026-07-31T15:00:00.000Z"),
    });

    expect(result.decisionPack.snapshot).toMatchObject({
      generatedAt: "2026-07-31T15:00:00.000Z",
      instanceHost: "demo.stackenterprise.co",
    });
  });

  it("returns a deeply immutable result and supporting datasets", async () => {
    const result = await runSmeCoverageAnalysis(basicCredentials, {
      fetchFn: standardFetch(),
    });
    const originalJson = JSON.stringify(result);
    const mutable = result as unknown as {
      utilityTitle: string;
      datasets: Array<{
        records: Array<Record<string, unknown>>;
        pagination: { pageCount: number };
      }>;
      messages: string[];
      warnings: Array<Record<string, unknown>>;
    };

    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.datasets)).toBe(true);
    expect(Object.isFrozen(result.messages)).toBe(true);
    expect(Object.isFrozen(result.warnings)).toBe(true);
    for (const dataset of result.datasets) {
      expect(Object.isFrozen(dataset)).toBe(true);
      expect(Object.isFrozen(dataset.records)).toBe(true);
      expect(Object.isFrozen(dataset.pagination)).toBe(true);
      for (const record of dataset.records) expect(Object.isFrozen(record)).toBe(true);
    }
    expect(Object.isFrozen(result.datasets[1].records[0].tags)).toBe(true);
    expect(Object.isFrozen(result.warnings[0])).toBe(true);

    expect(() => { mutable.utilityTitle = "Changed"; }).toThrow(TypeError);
    expect(() => { mutable.datasets.reverse(); }).toThrow(TypeError);
    expect(() => { mutable.datasets[0].records.push({}); }).toThrow(TypeError);
    expect(() => { mutable.datasets[0].records[0].name = "changed"; }).toThrow(TypeError);
    expect(() => { (mutable.datasets[1].records[0].tags as string[]).push("changed"); }).toThrow(TypeError);
    expect(() => { mutable.datasets[0].pagination.pageCount = 99; }).toThrow(TypeError);
    expect(() => { mutable.messages.push("changed"); }).toThrow(TypeError);
    expect(() => { mutable.warnings.push({ code: "changed" }); }).toThrow(TypeError);
    expect(JSON.stringify(result)).toBe(originalJson);
  });

  it.each([
    [
      "Basic/Business PAT",
      basicCredentials,
      ["basic-pat-secret", "manual-pat"],
    ],
    [
      "Enterprise OAuth metadata",
      {
        ...enterpriseCredentials,
        authSource: "oauth-pkce" as const,
        oauthClientId: "oauth-client-secret-metadata",
        oauthScopes: ["no_expiry", "admin"],
        accessTokenExpiresAt: "2099-01-01T00:00:00.000Z",
      },
      [
        "enterprise-api-key-secret",
        "enterprise-access-token-secret",
        "oauth-client-secret-metadata",
        "oauth-pkce",
        "no_expiry",
      ],
    ],
  ])("never returns %s credentials or authentication metadata", async (_label, credentials, secretValues) => {
    const result = await runSmeCoverageAnalysis(credentials, {
      fetchFn: standardFetch(),
    });
    const serialized = JSON.stringify(result);

    for (const secretValue of secretValues) expect(serialized).not.toContain(secretValue);
    for (const fieldName of [
      "pat",
      "apiKey",
      "accessToken",
      "authSource",
      "oauthClientId",
      "oauthScopes",
      "accessTokenExpiresAt",
    ]) {
      expect(serialized).not.toContain(fieldName);
    }
  });
});
