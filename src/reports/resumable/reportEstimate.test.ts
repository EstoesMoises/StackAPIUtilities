import { describe, expect, it } from "vitest";
import {
  consumeEstimatedRead,
  estimateReportTime,
  estimateTagWork,
  formatReportTimeEstimate,
  type RemainingReportWork,
  type TagReportInventory,
} from "./reportEstimate";
import type { ReportJob, ReportReadRequest, ReportReadResponse } from "./types";

const inventory = (overrides: Partial<TagReportInventory> = {}): TagReportInventory => ({
  tags: [], users: [], questions: [], articles: [], answers: [], comments: [], tagSmeCounts: [], ...overrides,
});
const response = (body: unknown): ReportReadResponse => ({ status: 200, body, headers: {} });
const request = (path: string, page = 1, api: "v2" | "v3" = "v3"): ReportReadRequest => ({
  api, path, query: { page: String(page), [api === "v3" ? "pageSize" : "pagesize"]: "100" },
});
const measured: ReportJob["timings"] = {
  v2: { count: 10, milliseconds: 1_000 },
  v3: { count: 10, milliseconds: 20_000 },
};
const work = (v2: number, v3: number): RemainingReportWork => ({
  v2: { minimum: v2, maximum: v2 }, v3: { minimum: v3, maximum: v3 }, unknown: false,
});

describe("estimateTagWork", () => {
  it("skips explicit zero child counts and excludes all already inventoried roots", () => {
    const result = estimateTagWork(inventory({
      users: [{ user_id: 1 }],
      questions: [{ question_id: 1, answer_count: 0, comment_count: 0 }],
      articles: [{ article_id: 2, comment_count: 0 }],
    }), "basic-business");
    expect(result).toMatchObject(work(0, 0));
  });

  it("counts answer pages and missing comment counts as required discovery reads", () => {
    const result = estimateTagWork(inventory({
      questions: [{ question_id: 1, answer_count: 101, comment_count: 1 }],
      articles: [{ article_id: 2 }],
    }), "basic-business");
    expect(result).toMatchObject({ v3: { minimum: 4, maximum: 105 }, unknown: false });
  });

  it("withholds an ETA when question answer counts cannot reveal the workload", () => {
    const result = estimateTagWork(inventory({ questions: [{ id: 1, comment_count: 0 }] }), "basic-business");
    expect(result.unknown).toBe(true);
    expect(result.v3.minimum).toBe(1);
    expect(estimateReportTime(result, measured)).toBeNull();
  });

  it("skips invalid detail ids just as enrichment does", () => {
    const result = estimateTagWork(inventory({ questions: [{ id: 0 }, { answer_count: 40 }] }), "basic-business");
    expect(result).toMatchObject(work(0, 0));
  });

  it("limits SME memberships to tags on questions with answers and includes enterprise communities", () => {
    const result = estimateTagWork(inventory({
      tags: [{ name: "JavaScript" }, { name: "python" }, { name: "unused" }],
      questions: [{ id: 1, tags: ["javascript"], answer_count: 1, comment_count: 0 }],
      tagSmeCounts: [
        { id: 10, name: "JavaScript", subjectMatterExpertCount: 2 },
        { id: 11, name: "python", subjectMatterExpertCount: 0 },
        { id: 12, name: "unused", subjectMatterExpertCount: 3 },
      ],
    }), "enterprise");
    expect(result).toMatchObject({ v2: { minimum: 0, maximum: 0 }, v3: { minimum: 3, maximum: 6 } });
  });

  it("retains legacy answerer requests only where authoritative SME counts are absent", () => {
    const result = estimateTagWork(inventory({
      tags: [{ name: "javascript" }, { name: "python" }, { name: "python" }],
      tagSmeCounts: [{ id: 10, name: "JavaScript", subjectMatterExpertCount: "0" }],
      users: Array.from({ length: 250 }, (_, id) => ({ user_id: id + 1 })),
    }), "basic-business");
    expect(result.v2).toEqual({ minimum: 1, maximum: 3 });
  });

  it("batches absent parents and budgets a possible question lookup for comment answer parents", () => {
    const result = estimateTagWork(inventory({
      questions: [{ id: 1, answer_count: 0, comment_count: 0 }],
      articles: [{ id: 2, comment_count: 0 }],
      answers: [{ id: 3, question_id: 1 }, { id: 4, question_id: 99 }],
      comments: [
        { post_id: 3 }, { post_id: 2 }, { post_id: 999, tags: [] },
        ...Array.from({ length: 101 }, (_, index) => ({ post_id: index + 1000 })),
      ],
    }), "basic-business");
    expect(result.v2).toEqual({ minimum: 7, maximum: 9 });
  });

  it("scales detail estimates to a 50,000-question inventory", () => {
    const result = estimateTagWork(inventory({
      questions: Array.from({ length: 50_000 }, (_, index) => ({
        id: index + 1, answer_count: 2, comment_count: 0,
      })),
    }), "basic-business");
    expect(result.v3).toEqual({ minimum: 50_000, maximum: 150_000 });
    expect(estimateReportTime(result, measured)?.minimumSeconds).toBeGreaterThan(36_000);
  });
});

describe("consumeEstimatedRead", () => {
  it("does not spend detail work when cached root inventories are replayed", () => {
    const result = estimateTagWork(inventory({ questions: [{ id: 1, answer_count: 1, comment_count: 0 }] }), "basic-business");
    for (const [api, path] of [["v2", "/questions"], ["v2", "/articles"], ["v3", "/tags"]] as const) {
      expect(consumeEstimatedRead(result, request(path, 1, api), response({ items: [] }))).toEqual(result);
    }
  });

  it("discovers missing answer comment counts without mutating the prior estimate", () => {
    const before = estimateTagWork(inventory({ questions: [{ id: 1, answer_count: 3, comment_count: 0 }] }), "basic-business");
    const after = consumeEstimatedRead(before, request("/questions/1/answers"), response({
      items: [{ id: 10 }, { id: 11, commentCount: 0 }, { id: 12, isDeleted: true }], totalPages: 1,
    }));
    expect(before.v3).toEqual({ minimum: 1, maximum: 4 });
    expect(after.v3).toEqual({ minimum: 1, maximum: 1 });
    expect(consumeEstimatedRead(after, request("/questions/1/answers/10/comments"), response([])).v3)
      .toEqual({ minimum: 0, maximum: 0 });
  });

  it("accounts for additional answer pages revealed by totalPages", () => {
    let result = estimateTagWork(inventory({ questions: [{ id: 1, answer_count: 1, comment_count: 0 }] }), "basic-business");
    result = consumeEstimatedRead(result, request("/questions/1/answers"), response({
      items: [{ id: 10, commentCount: 0 }], totalPages: 3,
    }));
    expect(result.v3.minimum).toBe(2);
    expect(result.v3.maximum).toBeGreaterThanOrEqual(2);
    result = consumeEstimatedRead(result, request("/questions/1/answers", 2), response({
      items: [{ id: 11, commentCount: 0 }], totalPages: 3,
    }));
    result = consumeEstimatedRead(result, request("/questions/1/answers", 3), response({
      items: [{ id: 12, commentCount: 0 }], totalPages: 3,
    }));
    expect(result.v3).toEqual({ minimum: 0, maximum: 0 });
  });

  it("resolves an unknown answer workload when the response supplies pagination", () => {
    const initial = estimateTagWork(inventory({ questions: [{ id: 1, comment_count: 0 }] }), "basic-business");
    const result = consumeEstimatedRead(initial, request("/questions/1/answers"), response({
      items: [{ id: 10 }, { id: 11, commentCount: 0 }], totalPages: 1,
    }));
    expect(result.unknown).toBe(false);
    expect(result.v3).toEqual({ minimum: 1, maximum: 1 });
    expect(estimateReportTime(result, measured)).not.toBeNull();
  });

  it("keeps an unknown workload unknown until unbounded answer pagination ends", () => {
    let result = estimateTagWork(inventory({ questions: [{ id: 1, comment_count: 0 }] }), "basic-business");
    result = consumeEstimatedRead(result, request("/questions/1/answers"), response({ items: [{ id: 10, commentCount: 0 }] }));
    expect(result.unknown).toBe(true);
    expect(result.v3.minimum).toBe(1);
    result = consumeEstimatedRead(result, request("/questions/1/answers", 2), response({ items: [] }));
    expect(result.unknown).toBe(false);
    expect(result.v3).toEqual({ minimum: 0, maximum: 0 });
  });

  it("removes the optional membership request when tag detail embeds its membership", () => {
    const initial = estimateTagWork(inventory({
      questions: [{ id: 1, tags: ["javascript"], answer_count: 1, comment_count: 0 }],
      tagSmeCounts: [{ id: 10, name: "javascript", subjectMatterExpertCount: 1 }],
    }), "basic-business");
    const result = consumeEstimatedRead(initial, request("/tags/10"), response({
      subjectMatterExperts: { users: [], userGroups: [] },
    }));
    expect(result.v3).toEqual({ minimum: 1, maximum: 2 });
  });

  it("makes the fallback membership request definite when detail omits membership", () => {
    const initial = estimateTagWork(inventory({
      questions: [{ id: 1, tags: ["javascript"], answer_count: 1, comment_count: 0 }],
      tagSmeCounts: [{ id: 10, name: "javascript", subjectMatterExpertCount: 1 }],
    }), "basic-business");
    const result = consumeEstimatedRead(initial, request("/tags/10"), response({ id: 10 }));
    expect(result.v3).toEqual({ minimum: 2, maximum: 3 });
  });

  it("removes speculative answer comments when a final page contains fewer answers than listed", () => {
    const initial = estimateTagWork(inventory({ questions: [{ id: 1, answer_count: 250, comment_count: 0 }] }), "basic-business");
    const result = consumeEstimatedRead(initial, request("/questions/1/answers"), response({
      items: [{ id: 10, commentCount: 0 }], totalPages: 1,
    }));
    expect(result.v3).toEqual({ minimum: 0, maximum: 0 });
  });

  it("does not clear another question's unresolved workload", () => {
    const initial = estimateTagWork(inventory({ questions: [
      { id: 1, comment_count: 0 }, { id: 2, comment_count: 0 },
    ] }), "basic-business");
    const first = consumeEstimatedRead(initial, request("/questions/1/answers"), response({ items: [], totalPages: 0 }));
    expect(first.unknown).toBe(true);
    const second = consumeEstimatedRead(first, request("/questions/2/answers"), response({ items: [], totalPages: 0 }));
    expect(second.unknown).toBe(false);
    expect(second.v3).toEqual({ minimum: 0, maximum: 0 });
  });

  it.each([403, 404])("finishes optional Enterprise community work on an unsupported response %i", (status) => {
    const initial = estimateTagWork(inventory({ tagSmeCounts: [{ name: "javascript", subjectMatterExpertCount: 0 }] }), "enterprise");
    const result = consumeEstimatedRead(initial, request("/communities"), { status, body: {}, headers: {} });
    expect(result.v3).toEqual({ minimum: 0, maximum: 0 });
  });

  it("tracks additional Enterprise community pages", () => {
    let result = estimateTagWork(inventory({ tagSmeCounts: [{ name: "javascript", subjectMatterExpertCount: 0 }] }), "enterprise");
    result = consumeEstimatedRead(result, request("/communities"), response({ items: [{ id: 1 }], totalPages: 3 }));
    expect(result.v3).toEqual({ minimum: 2, maximum: 2 });
    result = consumeEstimatedRead(result, request("/communities", 2), response({ items: [{ id: 2 }], totalPages: 3 }));
    result = consumeEstimatedRead(result, request("/communities", 3), response({ items: [{ id: 3 }], totalPages: 3 }));
    expect(result.v3).toEqual({ minimum: 0, maximum: 0 });
  });

  it("removes unused legacy top-answerer page budgets at the terminal response", () => {
    let result = estimateTagWork(inventory({
      tags: [{ name: "javascript" }], users: Array.from({ length: 250 }, (_, id) => ({ id: id + 1 })),
    }), "basic-business");
    result = consumeEstimatedRead(result, request("/tags/javascript/top-answerers/all_time", 1, "v2"), response({ items: [{ id: 1 }], has_more: true }));
    expect(result.v2).toEqual({ minimum: 1, maximum: 2 });
    result = consumeEstimatedRead(result, request("/tags/javascript/top-answerers/all_time", 2, "v2"), response({ items: [], has_more: false }));
    expect(result.v2).toEqual({ minimum: 0, maximum: 0 });
  });

  it("does not consume a retryable failed read", () => {
    const initial = work(2, 3);
    expect(consumeEstimatedRead(initial, request("/questions/1/comments"), {
      status: 429, headers: {}, body: {},
    })).toEqual(initial);
  });
});

describe("estimateReportTime", () => {
  it("requires several useful measured requests before showing a duration", () => {
    expect(estimateReportTime(work(50, 50), {
      v2: { count: 1, milliseconds: 100 }, v3: { count: 1, milliseconds: 500 },
    })).toBeNull();
    expect(estimateReportTime(work(50, 50), {
      v2: { count: 4, milliseconds: 0 }, v3: { count: 0, milliseconds: 0 },
    })).toBeNull();
  });

  it("uses the relevant API rate instead of blending a slow API into a fast one", () => {
    const fast = estimateReportTime(work(100, 0), measured)!;
    const slow = estimateReportTime(work(0, 100), measured)!;
    expect(slow.minimumSeconds).toBeGreaterThan(fast.maximumSeconds * 5);
    expect(slow.minimumSeconds).toBeLessThanOrEqual(200);
    expect(slow.maximumSeconds).toBeGreaterThanOrEqual(200);
  });

  it("widens the range when only the other API has timing samples", () => {
    const same = estimateReportTime(work(100, 0), measured)!;
    const fallback = estimateReportTime(work(0, 100), {
      v2: measured.v2, v3: { count: 0, milliseconds: 0 },
    })!;
    expect(fallback.minimumSeconds).toBeLessThanOrEqual(same.minimumSeconds);
    expect(fallback.maximumSeconds).toBeGreaterThan(same.maximumSeconds);
  });

  it("never presents zero remaining time before report completion", () => {
    expect(estimateReportTime(work(0, 0), measured)).toBeNull();
    expect(estimateReportTime({ ...work(10, 10), unknown: true }, measured)).toBeNull();
  });
});

describe("formatReportTimeEstimate", () => {
  it.each([
    [{ minimumSeconds: 0, maximumSeconds: 40 }, "Less than a minute"],
    [{ minimumSeconds: 120, maximumSeconds: 300 }, "2–5 minutes"],
    [{ minimumSeconds: 3_600, maximumSeconds: 7_200 }, "1–2 hours"],
    [{ minimumSeconds: 7_200, maximumSeconds: 7_200 }, "2 hours"],
    [{ minimumSeconds: 1_200, maximumSeconds: 4_800 }, "Up to 1.5 hours"],
  ])("uses a readable duration for %j", (estimate, expected) => {
    expect(formatReportTimeEstimate(estimate)).toBe(expected);
  });
});
