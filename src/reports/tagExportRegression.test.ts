import { describe, expect, it } from "vitest";
import { buildTagHealthRows, buildTagHealthRowsFromLiveRecords } from "./tagReport";
import { buildTagLastUsedRows } from "./tagLastUsed";
import { importReportFile } from "../importers/reportImporters";
import { buildReportCsvDownload } from "../utils/reportDownloads";
import Papa from "papaparse";

describe("tag export regressions", () => {
  it("preserves every script metric through import and CSV export", async () => {
    const imported = await importReportFile("tag_metrics.csv", [
      "Tag Name,Tag Id,Tag Creation Date,Last Used,Total Page Views,Webhooks,Tag Watchers,Communities,Total Smes,Median Time To First Answer Hours,Median Time To First Response Hours,Total Unique Contributors,Unique Askers,Unique Answerers,Unique Commenters,Unique Article Contributors,Question Count,Question Score,Question Comments,Questions No Answers,Questions Accepted Answer,Questions Self Answered,Answer Count,Sme Answers,Answer Score,Answer Comments,Article Count,Article Score,Article Comments",
      "python,2,2014-05-13,2026-08-18,338584,44,188,5,25,6.43,4.07,894,411,434,500,3,600,-12,700,20,400,40,800,9,900,1000,4,11,12",
    ].join("\n"));
    const csv = buildReportCsvDownload({ reportId: "tag-report", datasetName: "tags", source: "upload", records: imported.records, loadedAt: "2026-10-20T12:00:00Z" });
    const row = Papa.parse<Record<string, string>>(csv.contents, { header: true }).data[0];
    expect(row).toMatchObject({
      webhooks: "44", communities: "5", median_first_response_hours: "4.07",
      unique_askers: "411", unique_answerers: "434", unique_commenters: "500", unique_article_contributors: "3",
      question_score: "-12", question_comments: "700", questions_accepted_answer: "400", questions_self_answered: "40",
      sme_answers: "9", answer_score: "900", answer_comments: "1000", article_score: "11", article_comments: "12",
    });
    expect(Object.keys(row)).toHaveLength(31); // 29 script metrics plus health and action
  });

  it("computes the additional metrics from child records once, preserving negative scores and excluding deleted content", () => {
    const rows = buildTagHealthRowsFromLiveRecords([
      { datasetName: "tagSmeCounts", name: "python", subjectMatterExpertCount: 1, subjectMatterExperts: { users: [{ id: 2 }], userGroups: [] } },
      { datasetName: "questions", question_id: 10, tags: ["python"], score: -2, creation_date: 1_735_689_600, owner: { user_id: 1 }, answers: [
        { id: 20, creationDate: "2025-01-01T01:00:00Z", score: 2, owner: { id: 1 }, isAccepted: false, comments: [] },
        { id: 21, creationDate: "2025-01-01T04:00:00Z", score: 5, owner: { id: 2 }, isAccepted: true, comments: [{ id: 31, ownerUserId: 3, creationDate: "2025-01-01T05:00:00Z" }] },
        { id: 22, creationDate: "2025-01-01T02:00:00Z", score: 99, owner: { id: 4 }, isDeleted: true },
      ], comments: [
        { id: 30, ownerUserId: 1, creationDate: "2025-01-01T00:30:00Z" },
        { id: 32, ownerUserId: 3, creationDate: "2025-01-01T02:00:00Z" },
      ] },
      { datasetName: "answers", answer_id: 21, question_id: 10, score: 5, owner: { user_id: 2 } },
      { datasetName: "comments", comment_id: 32, post_id: 10, owner: { user_id: 3 } },
      { datasetName: "articles", article_id: 40, tags: ["python"], score: -1, owner: { user_id: 4 }, comments: [{ id: 41, ownerUserId: 3 }] },
      { datasetName: "questions", question_id: 11, tags: ["python"], score: 999, isDeleted: true },
    ]);
    expect(rows[0]).toMatchObject({
      sme_count: 1, unique_contributors: 4, question_count: 1, answer_count: 2, article_count: 1,
      unique_askers: 1, unique_answerers: 2, unique_commenters: 2, unique_article_contributors: 1,
      question_score: -2, question_comments: 2, questions_accepted_answer: 1, questions_self_answered: 1,
      answer_score: 7, answer_comments: 1, sme_answers: 1, article_score: -1, article_comments: 1,
      median_first_answer_hours: 4, median_first_response_hours: 2,
      webhooks: null, communities: null,
    });
  });
  it("retains v3 creation timestamps with API precision and reads v3 watchers without double counting v2", () => {
    const rows = buildTagHealthRowsFromLiveRecords([
      { datasetName: "tagSmeCounts", id: 42, name: "PYTHON", creationDate: "2014-05-13T12:34:56.1234567", watcherCount: 188 },
      { datasetName: "tags", name: "python", watcher_count: 9 },
    ]);
    expect(rows[0]).toMatchObject({ tag_creation_date: "2014-05-13 12:34:56.123", watcher_count: 188 });
  });

  it("lets complete nested records override deleted standalone duplicates and stale accepted-answer metadata", () => {
    const [row] = buildTagHealthRowsFromLiveRecords([
      { datasetName: "questions", question_id: 1, tags: ["python"], accepted_answer_id: 2,
        answers: [{ id: 2, isDeleted: true, owner: { id: 2 } }],
        comments: [{ id: 3, isDeleted: true, ownerUserId: 3 }] },
      { datasetName: "answers", answer_id: 2, question_id: 1, owner: { user_id: 2 } },
      { datasetName: "comments", comment_id: 3, post_id: 1, owner: { user_id: 3 } },
      { datasetName: "comments", comment_id: 4, post_id: 2, owner: { user_id: 4 }, tags: ["python"] },
    ]);
    expect(row).toMatchObject({ answer_count: 0, question_comments: 0, questions_accepted_answer: 0,
      unique_answerers: 0, unique_commenters: 0 });
  });

  it("maps account identities in nested children before deduplicating contributors", () => {
    const [row] = buildTagHealthRowsFromLiveRecords([
      { datasetName: "questions", question_id: 1, tags: ["python"], answers: [
        { id: 2, owner: { user_id: 2, account_id: 102 } },
      ], comments: [] },
      { datasetName: "answers", answer_id: 2, question_id: 1, owner: { account_id: 102 } },
    ]);
    expect(row).toMatchObject({ unique_answerers: 1, unique_contributors: 1 });
  });

  it("leaves metrics unavailable when older snapshots do not contain complete child details", () => {
    const [row] = buildTagHealthRowsFromLiveRecords([
      { datasetName: "questions", question_id: 1, tags: ["python"], answer_count: 3, comment_count: 4,
        creation_date: 1_735_689_600, owner: { user_id: 1 } },
      { datasetName: "answers", answer_id: 2, question_id: 1, score: 5, owner: { user_id: 2 } },
    ]);
    expect(row).toMatchObject({ answer_count: 3, question_comments: 4, question_score: null,
      answer_score: null, answer_comments: null, questions_self_answered: null,
      unique_answerers: null, unique_commenters: null, median_first_response_hours: null });
  });

  it("does not count unknown group membership as proof that an answerer is not an SME", () => {
    const [row] = buildTagHealthRowsFromLiveRecords([
      { datasetName: "tagSmeCounts", name: "python", subjectMatterExpertCount: 1,
        subjectMatterExperts: { users: [], userGroups: [{ id: 1 }] } },
      { datasetName: "questions", tags: ["python"], answers: [{ id: 2, owner: { id: 2 } }], comments: [] },
    ]);
    expect(row.sme_answers).toBeNull();
  });

  it("does not substitute the lifetime question total for an empty reporting period", () => {
    const [row] = buildTagHealthRowsFromLiveRecords([{ datasetName: "tags", name: "python", count: 100 }]);
    expect(row.question_count).toBe(0);
  });

  it("does not treat the parent of a deleted standalone answer as deleted", () => {
    const [row] = buildTagHealthRowsFromLiveRecords([
      { datasetName: "answers", answer_id: 2, question_id: 1, tags: ["python"], is_deleted: true },
      { datasetName: "answers", answer_id: 3, question_id: 1, tags: ["python"], owner: { user_id: 3 } },
    ]);
    expect(row.unique_answerers).toBe(1);
  });

  it("honors a v3 watcher count of zero and falls back to v2 when it is absent", () => {
    const rows = buildTagHealthRowsFromLiveRecords([
      { datasetName: "tagSmeCounts", name: "zero", watcherCount: 0 },
      { datasetName: "tags", name: "zero", watcher_count: 9 },
      { datasetName: "tagSmeCounts", name: "legacy" },
      { datasetName: "tags", name: "legacy", watcher_count: 12 },
    ]);
    expect(rows.map((row) => row.watcher_count)).toEqual([0, 12]);
  });

  it("accepts numeric metadata and spreadsheet datetime strings and skips invalid aliases", () => {
    expect(buildTagHealthRows([
      { tagName: "python", tagCreationDate: "invalid", creation_date: 1_735_689_600, lastUsed: "2025-01-02 13:45:12" },
    ])[0]).toMatchObject({ tag_creation_date: "2025-01-01 00:00:00", last_used: "2025-01-02 13:45:12" });
  });

  it("preserves the time of the latest tag use", () => {
    expect(buildTagLastUsedRows([{ name: "python" }], [
      { tags: ["python"], creationDate: "2025-03-04T23:59:59-05:00" },
    ])).toEqual([{ tagName: "python", lastUsed: "2025-03-05 04:59:59" }]);
  });

  it("calculates the median from each question's earliest external non-deleted answer", () => {
    const rows = buildTagHealthRowsFromLiveRecords([
      { datasetName: "users", user_id: 1, account_id: 101 },
      { datasetName: "questions", question_id: 10, tags: ["python"], creation_date: 1_735_689_600, owner: { user_id: 1 }, answers: [
        { creation_date: 1_735_725_600, owner: { user_id: 2 } }, // 10h, unsorted
        { creation_date: 1_735_693_200, owner: { account_id: 101 } }, // self
        { creation_date: 1_735_696_800, owner: { user_id: 3 }, is_deleted: true },
        { creation_date: 1_735_711_200, owner: { user_id: 4 } }, // 6h
      ] },
      { datasetName: "questions", question_id: 20, tags: ["python"], creationDate: "2025-01-01T00:00:00Z", owner: { user_id: 1 } },
      { datasetName: "answers", question_id: 20, creationDate: "2025-01-01T02:00:00Z", owner: { user_id: 2 } },
      { datasetName: "questions", question_id: 30, tags: ["python"], creation_date: 1_735_689_600 }, // no answer
    ]);
    expect(rows[0].median_first_answer_hours).toBe(4);
  });
});
