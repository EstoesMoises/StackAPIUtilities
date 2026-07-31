import { describe, expect, it, vi } from "vitest";
import type { FetchLike } from "../../api/httpClient";
import type { ApiVolumeSettingsValue, SessionCredentials } from "../../domain/types";
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

const deepSettings: ApiVolumeSettingsValue = {
  pageSize: 100,
  maxPagesPerDataset: 20,
  runPreset: "deep-audit",
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

describe("runSmeCoverageAnalysis", () => {
  it("collects exactly v2 tags, v2 questions, and v3 tags before composing one decision pack", async () => {
    const requestUrls: string[] = [];

    const result = await runSmeCoverageAnalysis(basicCredentials, {
      fetchFn: standardFetch(requestUrls),
      settings: deepSettings,
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
      { fetchFn: fetchMock, settings: deepSettings },
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

    await runSmeCoverageAnalysis(enterpriseCredentials, { fetchFn: fetchMock, settings: deepSettings });

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

  it.each([
    ["tags", "sme-coverage.tags-page-cap", "collected tag sample"],
    ["questions", "sme-coverage.questions-page-cap", "collected partial sample"],
    ["tagSmeCounts", "sme-coverage.tag-sme-counts-page-cap", "may be unknown"],
  ] as const)("preserves a %s page cap and emits its stable warning", async (cappedSource, code, message) => {
    const fetchMock: FetchLike = vi.fn().mockImplementation((input: RequestInfo | URL) => {
      const url = input.toString();
      if (url.includes("/2.3/tags")) {
        return Promise.resolve(v2Page([{ name: "piper", count: 8 }], cappedSource === "tags"));
      }
      if (url.includes("/2.3/questions")) {
        return Promise.resolve(
          v2Page([{ question_id: 1, tags: ["piper"], view_count: 800 }], cappedSource === "questions"),
        );
      }
      return Promise.resolve(
        v3Page([{ name: "piper", subjectMatterExpertCount: 1 }], cappedSource === "tagSmeCounts" ? 2 : 1),
      );
    }) as FetchLike;

    const result = await runSmeCoverageAnalysis(basicCredentials, {
      fetchFn: fetchMock,
      settings: { pageSize: 50, maxPagesPerDataset: 1, runPreset: "quick-sample" },
    });

    expect(result.datasets.find((dataset) => dataset.datasetName === cappedSource)?.pagination).toEqual({
      pageCount: 1,
      reachedMaxPages: true,
      hasMore: true,
    });
    expect(result.warnings).toContainEqual(expect.objectContaining({ code, message: expect.stringContaining(message) }));
    expect(result.decisionPack.warnings).toContainEqual(
      expect.objectContaining({ code, message: expect.stringContaining(message) }),
    );
  });

  it("labels capped question demand and narrative conclusions as a partial sample", async () => {
    const fetchMock: FetchLike = vi.fn().mockImplementation((input: RequestInfo | URL) => {
      const url = input.toString();
      if (url.includes("/2.3/tags")) return Promise.resolve(v2Page([{ name: "piper", count: 8 }]));
      if (url.includes("/2.3/questions")) {
        return Promise.resolve(v2Page([{ question_id: 1, tags: ["piper"], view_count: 800 }], true));
      }
      return Promise.resolve(v3Page([{ name: "piper", subjectMatterExpertCount: 1 }]));
    }) as FetchLike;

    const result = await runSmeCoverageAnalysis(basicCredentials, {
      fetchFn: fetchMock,
      settings: { pageSize: 100, maxPagesPerDataset: 1 },
    });

    expect(result.decisionPack.evidence[0]).toMatchObject({
      demandQuality: "Partial sample",
      questionCount: 8,
      questionCountBasis: "All-time tag total",
    });
    expect(result.decisionPack.snapshot.completeness).toBe("Partial");
    expect(result.decisionPack.overview).toContain("partial sample");
    expect(result.decisionPack.assessment).toContain("partial sample");
  });

  it("keeps retrieved numeric v3 tag counts complete while capped unmatched tags remain unknown", async () => {
    const fetchMock: FetchLike = vi.fn().mockImplementation((input: RequestInfo | URL) => {
      const url = input.toString();
      if (url.includes("/2.3/tags")) {
        return Promise.resolve(v2Page([{ name: "piper" }, { name: "kafka" }]));
      }
      if (url.includes("/2.3/questions")) {
        return Promise.resolve(v2Page([
          { question_id: 1, tags: ["piper"], view_count: 800 },
          { question_id: 2, tags: ["kafka"], view_count: 400 },
        ]));
      }
      return Promise.resolve(v3Page([{ name: "piper", subjectMatterExpertCount: 1 }], 2));
    }) as FetchLike;

    const result = await runSmeCoverageAnalysis(basicCredentials, {
      fetchFn: fetchMock,
      settings: { pageSize: 50, maxPagesPerDataset: 1, runPreset: "quick-sample" },
    });

    expect(result.decisionPack.evidence.find((row) => row.tagName === "piper")).toMatchObject({
      smeCount: 1,
      smeQuality: "Complete",
    });
    expect(result.decisionPack.evidence.find((row) => row.tagName === "kafka")).toMatchObject({
      smeCount: null,
      smeQuality: "Unknown",
    });
  });

  it("keeps capped v3-unmatched v2 tags unknown when the retrieved numeric counts are unrelated", async () => {
    const fetchMock: FetchLike = vi.fn().mockImplementation((input: RequestInfo | URL) => {
      const url = input.toString();
      if (url.includes("/2.3/tags")) return Promise.resolve(v2Page([{ name: "piper" }]));
      if (url.includes("/2.3/questions")) {
        return Promise.resolve(v2Page([{ question_id: 1, tags: ["piper"], view_count: 800 }]));
      }
      return Promise.resolve(v3Page([{ name: "kafka", subjectMatterExpertCount: 2 }], 2));
    }) as FetchLike;

    const result = await runSmeCoverageAnalysis(basicCredentials, {
      fetchFn: fetchMock,
      settings: { pageSize: 50, maxPagesPerDataset: 1, runPreset: "quick-sample" },
    });

    expect(result.decisionPack.snapshot.completeness).toBe("Partial");
    expect(result.decisionPack.evidence.find((row) => row.tagName === "piper")).toMatchObject({
      smeCount: null,
      smeQuality: "Unknown",
      coverageTier: "Unknown",
    });
    expect(result.warnings).toContainEqual(
      expect.objectContaining({ code: "sme-coverage.tag-sme-counts-page-cap" }),
    );
  });

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
      settings: deepSettings,
    });

    expect(result.decisionPack.snapshot.completeness).toBe("Empty");
    expect(result.decisionPack.evidence).toEqual([]);
    expect(result.decisionPack.summary.tagsAnalyzed).toBe(0);
  });

  it("uses the injected clock and normalized instance host in the snapshot", async () => {
    const result = await runSmeCoverageAnalysis(enterpriseCredentials, {
      fetchFn: standardFetch(),
      settings: deepSettings,
      clock: () => new Date("2026-07-31T15:00:00.000Z"),
    });

    expect(result.decisionPack.snapshot).toMatchObject({
      generatedAt: "2026-07-31T15:00:00.000Z",
      instanceHost: "demo.stackenterprise.co",
    });
  });

  it("normalizes stale preset labels and passes actual settings into analysis sampling", async () => {
    const result = await runSmeCoverageAnalysis(basicCredentials, {
      fetchFn: standardFetch(),
      settings: { pageSize: 75, maxPagesPerDataset: 7, runPreset: "quick-sample" },
    });

    expect(result.runPreset).toBeUndefined();
    expect(result.decisionPack.snapshot).toMatchObject({ pageSize: 75, maxPagesPerDataset: 7 });
    expect(result.decisionPack.snapshot.runPreset).toBeUndefined();
    expect(result.decisionPack.snapshot.completeness).toBe("Partial");
    expect(result.decisionPack.overview).toContain("configured API volume settings");
  });

  it("returns a deeply immutable result and supporting datasets", async () => {
    const result = await runSmeCoverageAnalysis(basicCredentials, {
      fetchFn: standardFetch(),
      settings: deepSettings,
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

  it("rejects invalid volume settings before fetch", async () => {
    const fetchMock = vi.fn();

    await expect(
      runSmeCoverageAnalysis(basicCredentials, {
        fetchFn: fetchMock,
        settings: { pageSize: 0, maxPagesPerDataset: 0 },
      }),
    ).rejects.toMatchObject({ kind: "validation" });
    expect(fetchMock).not.toHaveBeenCalled();
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
      settings: deepSettings,
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
