import { describe, expect, it } from "vitest";
import { collected, completeRawSources } from "../../test/fixtures/smeCoverageFixtures";
import type { NormalizedTagDemandRow } from "./model";
import { normalizeTagDemand } from "./tagDemand";

function byTag(rows: readonly NormalizedTagDemandRow[], tagName: string): NormalizedTagDemandRow {
  const row = rows.find((candidate) => candidate.key === tagName);
  if (!row) throw new Error(`Missing ${tagName}`);
  return row;
}

describe("normalizeTagDemand", () => {
  it("uses deduplicated complete question enumeration for demand", () => {
    const result = normalizeTagDemand(completeRawSources);

    expect(byTag(result.rows, "piper")).toMatchObject({
      pageViews: 800,
      questionCount: 2,
      questionCountBasis: "Complete question enumeration",
      demandQuality: "Complete",
    });
    expect(byTag(result.rows, "kafka")).toMatchObject({ pageViews: 300, questionCount: 1 });
    expect(byTag(result.rows, "timeout")).toMatchObject({ pageViews: 80, questionCount: 1 });
  });

  it("counts identical normalized duplicate questions once", () => {
    const result = normalizeTagDemand({
      tags: collected([{ name: "piper", count: 99 }]),
      questions: collected([
        { question_id: 1, tags: ["Piper", "piper"], view_count: 50 },
        { question_id: "1", tags: ["piper"], view_count: 50 },
      ]),
    });

    expect(byTag(result.rows, "piper")).toMatchObject({ pageViews: 50, questionCount: 1 });
  });

  it("invalidates every tag named by conflicting duplicate questions and excludes the question", () => {
    const result = normalizeTagDemand({
      tags: collected([{ name: "piper" }, { name: "kafka" }, { name: "timeout" }]),
      questions: collected([
        { question_id: 1, tags: ["piper"], view_count: 20 },
        { question_id: 1, tags: ["kafka"], view_count: 20 },
        { question_id: 2, tags: ["timeout"], view_count: 10 },
        { question_id: 2, tags: ["timeout"], view_count: 11 },
      ]),
    });

    expect(byTag(result.rows, "piper")).toMatchObject({ pageViews: null, questionCount: null, demandQuality: "Invalid" });
    expect(byTag(result.rows, "kafka")).toMatchObject({ pageViews: null, questionCount: null, demandQuality: "Invalid" });
    expect(byTag(result.rows, "timeout")).toMatchObject({ pageViews: null, questionCount: null, demandQuality: "Invalid" });
    expect(result.warnings).toContainEqual(expect.objectContaining({ code: "sme-coverage.invalid-question-demand" }));
  });

  it("invalidates usable tags on ID-less or invalid-view questions", () => {
    const result = normalizeTagDemand({
      tags: collected([{ name: "piper" }, { name: "kafka" }]),
      questions: collected([
        { tags: ["piper"], view_count: 10 },
        { question_id: 2, tags: ["kafka"], view_count: -1 },
      ]),
    });

    expect(byTag(result.rows, "piper")).toMatchObject({
      pageViews: null,
      questionCount: null,
      demandQuality: "Invalid",
    });
    expect(byTag(result.rows, "kafka")).toMatchObject({
      pageViews: null,
      questionCount: null,
      demandQuality: "Invalid",
    });
  });

  it("invalidates aggregate page views that overflow a finite number", () => {
    const result = normalizeTagDemand({
      tags: collected([{ name: "piper" }]),
      questions: collected([
        { question_id: 1, tags: ["piper"], view_count: Number.MAX_VALUE },
        { question_id: 2, tags: ["piper"], view_count: Number.MAX_VALUE },
      ]),
    });

    expect(byTag(result.rows, "piper")).toMatchObject({
      pageViews: null,
      questionCount: null,
      demandQuality: "Invalid",
    });
    expect(result.warnings).toContainEqual(expect.objectContaining({ code: "sme-coverage.non-finite-page-views" }));
  });

  it("contributes a valid question once to each distinct canonical tag and ignores tag page views", () => {
    const result = normalizeTagDemand({
      tags: collected([{ name: "piper", page_views: 9000 }, { name: "kafka", page_views: 6000 }]),
      questions: collected([{ question_id: 1, tags: ["piper", "PIPER", "kafka"], view_count: 42 }]),
    });

    expect(byTag(result.rows, "piper")).toMatchObject({ pageViews: 42, questionCount: 1 });
    expect(byTag(result.rows, "kafka")).toMatchObject({ pageViews: 42, questionCount: 1 });
  });

  it("uses complete questions over conflicting v2 fallback counts", () => {
    const result = normalizeTagDemand({
      tags: collected([{ name: "piper", count: 3 }, { name: "PIPER", count: 9 }]),
      questions: collected([{ question_id: 1, tags: ["piper"], view_count: 42 }]),
    });

    expect(byTag(result.rows, "piper")).toMatchObject({
      pageViews: 42,
      questionCount: 1,
      questionCountBasis: "Complete question enumeration",
      demandQuality: "Complete",
    });
  });

  it("uses a trustworthy v2 tag count when question enumeration is capped", () => {
    const result = normalizeTagDemand({
      tags: collected([{ name: "piper", count: 8 }]),
      questions: collected([{ question_id: 1, tags: ["piper"], view_count: 42 }], {
        pageCount: 1,
        reachedMaxPages: true,
        hasMore: true,
      }),
    });

    expect(byTag(result.rows, "piper")).toMatchObject({
      pageViews: 42,
      questionCount: 8,
      questionCountBasis: "All-time tag total",
      demandQuality: "Partial sample",
    });
  });

  it("uses the collected count as a labeled partial sample without a tag fallback", () => {
    const result = normalizeTagDemand({
      tags: collected([{ name: "piper" }]),
      questions: collected([{ question_id: 1, tags: ["piper"], view_count: 42 }], {
        pageCount: 1,
        reachedMaxPages: true,
        hasMore: true,
      }),
    });

    expect(byTag(result.rows, "piper")).toMatchObject({
      questionCount: 1,
      questionCountBasis: "Partial question sample",
      demandQuality: "Partial sample",
    });
  });

  it("does not select a conflicting fallback count for capped questions", () => {
    const result = normalizeTagDemand({
      tags: collected([{ name: "piper", count: 8 }, { name: "PIPER", count: 9 }]),
      questions: collected([{ question_id: 1, tags: ["piper"], view_count: 42 }], {
        pageCount: 1,
        reachedMaxPages: true,
        hasMore: true,
      }),
    });

    expect(byTag(result.rows, "piper")).toMatchObject({
      questionCount: 1,
      questionCountBasis: "Partial question sample",
    });
    expect(result.warnings).toContainEqual(expect.objectContaining({ code: "sme-coverage.conflicting-tag-counts" }));
  });

  it("keeps a valid no-question tag at zero when questions are complete", () => {
    const result = normalizeTagDemand({ tags: collected([{ name: "piper" }]), questions: collected([]) });

    expect(byTag(result.rows, "piper")).toMatchObject({
      pageViews: 0,
      questionCount: 0,
      questionCountBasis: "Complete question enumeration",
      demandQuality: "Complete",
    });
  });

  it("skips non-empty tag records without an identity and reports their count", () => {
    const result = normalizeTagDemand({
      tags: collected([{ count: 4 }, { name: "  ", count: 3 }]),
      questions: collected([]),
    });

    expect(result.rows).toEqual([]);
    expect(result.warnings).toContainEqual(
      expect.objectContaining({ code: "sme-coverage.skipped-tag-identities", message: expect.stringContaining("2") }),
    );
  });
});
