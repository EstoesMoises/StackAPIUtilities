import { describe, expect, it } from "vitest";
import type {
  PersistedContentReplacementFailure,
  PersistedContentReplacementJob,
  ReplacementConfiguration,
  ReplacementItemRef,
  ReplacementProposal,
} from "./types";
import {
  canEnterReview,
  createReplacementJob,
  getNextApplyItem,
  getNextDetailBatch,
  getNextInventoryCursor,
  getNextRecoveryItem,
  reduceReplacementJob,
  replacementItemKey,
  summarizeReplacementJob,
} from "./jobState";

const AT = "2026-09-01T12:00:00.000Z";
const LATER = "2026-09-01T12:01:00.000Z";
const DIGEST_A = "a".repeat(64);
const DIGEST_B = "b".repeat(64);
const DIGEST_C = "c".repeat(64);
const DIGEST_D = "d".repeat(64);

const configuration: ReplacementConfiguration = {
  target: { kind: "enterprise-main" },
  contentTypes: { questions: true, answers: true, articles: true },
  rules: [{ id: "rule-1", find: "Old", replace: "New" }],
  options: { caseSensitive: true, wholeTerm: true, replaceInCode: false },
};

function createJob(
  contentTypes: ReplacementConfiguration["contentTypes"] = configuration.contentTypes,
): PersistedContentReplacementJob {
  return createReplacementJob({
    id: "job-1",
    fingerprint: DIGEST_D,
    baseUrl: "https://example.stackenterprise.co",
    configuration: { ...configuration, contentTypes },
    createdAt: AT,
  });
}

function proposal(ref: ReplacementItemRef): ReplacementProposal {
  const before = (ref.kind === "answer"
    ? { kind: "answer" as const, ref, request: { body: "Old body" } }
    : ref.kind === "question"
      ? { kind: "question" as const, ref, request: { title: "Old title", body: "body", tags: ["tag"] } }
      : {
          kind: "article" as const,
          ref,
          request: {
            title: "Old title",
            body: "body",
            tags: ["tag"],
            type: "knowledgeArticle" as const,
            permissions: { editorUserIds: [], editorUserGroupIds: [] },
          },
        }) as ReplacementProposal["before"];
  const after = (ref.kind === "answer"
    ? { ...before, request: { body: "New body" } }
    : { ...before, request: { ...before.request, title: "New title" } }) as ReplacementProposal["after"];
  return {
    before,
    after,
    scannedRequestChecksum: DIGEST_A,
    proposedRequestChecksum: DIGEST_B,
    proposalFingerprint: DIGEST_C,
    fields: ref.kind === "answer"
      ? { body: { beforeMarkdown: "Old body", afterMarkdown: "New body" } }
      : {
          title: { beforeMarkdown: "Old title", afterMarkdown: "New title" },
          body: { beforeMarkdown: "body", afterMarkdown: "body" },
        },
    changedOccurrences: [{
      field: ref.kind === "answer" ? "body" : "title",
      ruleId: "rule-1",
      start: 0,
      end: 3,
      before: "Old",
      after: "New",
    }],
    protectedOccurrences: [],
    appliedRuleIds: ["rule-1"],
  };
}

function reviewJob(...proposals: ReplacementProposal[]): PersistedContentReplacementJob {
  let job = createJob();
  const refs = proposals.map((candidate) => candidate.before.ref);
  job = { ...job, inventoryQueue: [], detailQueue: refs };
  job = reduceReplacementJob(job, {
    type: "scan/details-succeeded",
    refs,
    result: { proposals, inspectedCount: proposals.length, protectedOccurrenceCount: 0 },
    at: AT,
  });
  return reduceReplacementJob(job, { type: "scan/queues-drained", at: AT });
}

function preparedJob(...proposals: ReplacementProposal[]): PersistedContentReplacementJob {
  return reduceReplacementJob(reviewJob(...proposals), { type: "apply/prepare", at: AT });
}

function failure(
  category: PersistedContentReplacementFailure["category"],
  retryable: boolean,
): Omit<PersistedContentReplacementFailure, "occurredAt"> {
  return { category, retryable, message: `Safe ${category} failure.` };
}

describe("replacement job state", () => {
  it.each([
    [{ questions: true, answers: false, articles: false }, [{ kind: "questions", page: 1 }]],
    [{ questions: false, answers: true, articles: false }, [{ kind: "questions", page: 1 }]],
    [{ questions: false, answers: false, articles: true }, [{ kind: "articles", page: 1 }]],
    [
      { questions: true, answers: true, articles: true },
      [{ kind: "questions", page: 1 }, { kind: "articles", page: 1 }],
    ],
  ] as const)("creates only the required initial inventory for %j", (contentTypes, expected) => {
    const job = createJob({ ...contentTypes });

    expect(job.stage).toBe("scan");
    expect(job.status).toBe("paused");
    expect(job.inventoryQueue).toEqual(expected);
    expect(getNextInventoryCursor(job)).toEqual(expected[0] ?? null);
  });

  it("expands answer inventory only from question inventory and preserves FIFO order", () => {
    const job = createJob();
    const next = reduceReplacementJob(job, {
      type: "scan/inventory-succeeded",
      cursor: { kind: "questions", page: 1 },
      result: {
        candidates: [{ kind: "question", questionId: 2 }],
        answerCursors: [
          { kind: "answers", questionId: 2, page: 1 },
          { kind: "answers", questionId: 2, page: 1 },
        ],
        nextCursor: { kind: "questions", page: 2 },
        inspectedCount: 1,
        pageKind: "questions",
      },
      at: LATER,
    });

    expect(next.inventoryQueue).toEqual([
      { kind: "articles", page: 1 },
      { kind: "questions", page: 2 },
      { kind: "answers", questionId: 2, page: 1 },
    ]);
    expect(next.detailQueue).toEqual([{ kind: "question", questionId: 2 }]);

    const articleResponseWithInjectedAnswerCursor = reduceReplacementJob(
      { ...next, inventoryQueue: [{ kind: "articles", page: 1 }] },
      {
        type: "scan/inventory-succeeded",
        cursor: { kind: "articles", page: 1 },
        result: {
          candidates: [],
          answerCursors: [{ kind: "answers", questionId: 99, page: 1 }],
          nextCursor: null,
          inspectedCount: 0,
          pageKind: "articles",
        },
        at: LATER,
      },
    );
    expect(articleResponseWithInjectedAnswerCursor.inventoryQueue).toEqual([]);
  });

  it("does not enqueue answer inventory when answers are not selected", () => {
    const job = createJob({ questions: true, answers: false, articles: false });
    const next = reduceReplacementJob(job, {
      type: "scan/inventory-succeeded",
      cursor: { kind: "questions", page: 1 },
      result: {
        candidates: [{ kind: "question", questionId: 2 }],
        answerCursors: [{ kind: "answers", questionId: 2, page: 1 }],
        nextCursor: null,
        inspectedCount: 1,
        pageKind: "questions",
      },
      at: LATER,
    });

    expect(next.inventoryQueue).toEqual([]);
  });

  it("deduplicates inventory/detail/proposals by canonical key and batches ten FIFO refs", () => {
    const refs = Array.from({ length: 12 }, (_, index) => ({
      kind: "question" as const,
      questionId: index + 1,
    }));
    let job = createJob({ questions: true, answers: false, articles: false });
    job = reduceReplacementJob(job, {
      type: "scan/inventory-succeeded",
      cursor: { kind: "questions", page: 1 },
      result: {
        candidates: [...refs, refs[0], refs[1]],
        answerCursors: [],
        nextCursor: null,
        inspectedCount: 14,
        pageKind: "questions",
      },
      at: AT,
    });

    expect(getNextDetailBatch(job)).toEqual(refs.slice(0, 10));
    const first = proposal(refs[0]);
    job = reduceReplacementJob(job, {
      type: "scan/details-succeeded",
      refs: refs.slice(0, 10),
      result: { proposals: [first, first], inspectedCount: 10, protectedOccurrenceCount: 2 },
      at: LATER,
    });

    expect(getNextDetailBatch(job)).toEqual(refs.slice(10));
    expect(Object.keys(job.proposals)).toEqual(["question:1"]);
    expect(job.progress.proposalsFound).toBe(1);
  });

  it("rejects an out-of-order or oversized detail completion", () => {
    const refs = Array.from({ length: 11 }, (_, index) => ({
      kind: "question" as const,
      questionId: index + 1,
    }));
    const job = { ...createJob(), detailQueue: refs };

    expect(reduceReplacementJob(job, {
      type: "scan/details-succeeded",
      refs: [refs[1]],
      result: { proposals: [], inspectedCount: 1, protectedOccurrenceCount: 0 },
      at: LATER,
    })).toEqual(job);
    expect(reduceReplacementJob(job, {
      type: "scan/details-succeeded",
      refs,
      result: { proposals: [], inspectedCount: 11, protectedOccurrenceCount: 0 },
      at: LATER,
    })).toEqual(job);
  });

  it("uses stable canonical keys for every supported ref", () => {
    expect(replacementItemKey({ kind: "question", questionId: 4 })).toBe("question:4");
    expect(replacementItemKey({ kind: "answer", questionId: 4, answerId: 8 })).toBe("answer:4:8");
    expect(replacementItemKey({ kind: "article", articleId: 9 })).toBe("article:9");
  });

  it("does not enter review until both scan queues drain", () => {
    const job = createJob();
    expect(canEnterReview(job)).toBe(false);
    expect(reduceReplacementJob(job, { type: "scan/queues-drained", at: LATER })).toEqual(job);

    const drained = { ...job, inventoryQueue: [], detailQueue: [] };
    expect(canEnterReview(drained)).toBe(true);
    const complete = reduceReplacementJob(drained, { type: "scan/queues-drained", at: LATER });
    expect(complete.stage).toBe("review");
    expect(complete.status).toBe("completed");
  });

  it("counts protected-only detail responses without creating proposals", () => {
    const job = { ...createJob(), inventoryQueue: [], detailQueue: [{ kind: "article" as const, articleId: 8 }] };
    const next = reduceReplacementJob(job, {
      type: "scan/details-succeeded",
      refs: [{ kind: "article", articleId: 8 }],
      result: { proposals: [], inspectedCount: 1, protectedOccurrenceCount: 7 },
      at: LATER,
    });
    expect(next.proposals).toEqual({});
    expect(next.progress).toMatchObject({ detailsInspected: 1, proposalsFound: 0, protectedOccurrences: 7 });
    expect(summarizeReplacementJob(next).results.protectedOnly).toBe(7);
  });

  it("stops scanning on a sanitized blocking inventory failure", () => {
    const job = reduceReplacementJob(createJob(), {
      type: "scan/failed",
      failure: failure("authorization", false),
      at: LATER,
    });
    expect(job).toMatchObject({
      stage: "scan",
      status: "failed",
      failure: { category: "authorization", retryable: false, occurredAt: LATER },
    });
    const failedWithoutQueuedWork = { ...job, inventoryQueue: [], detailQueue: [] };
    expect(reduceReplacementJob(failedWithoutQueuedWork, {
      type: "scan/queues-drained",
      at: LATER,
    })).toEqual(failedWithoutQueuedWork);
  });

  it("pauses and resumes without changing queued work", () => {
    const running = reduceReplacementJob(createJob(), { type: "run/resume", at: AT });
    const paused = reduceReplacementJob(running, { type: "run/pause", at: LATER });
    expect(paused.status).toBe("paused");
    expect(paused.inventoryQueue).toEqual(running.inventoryQueue);
    expect(reduceReplacementJob(paused, { type: "run/resume", at: LATER }).status).toBe("running");
  });

  it("turns interrupted apply work back into lost-response-safe retry work", () => {
    let job = preparedJob(proposal({ kind: "question", questionId: 1 }));
    job = reduceReplacementJob(job, { type: "apply/start", at: AT });
    job = reduceReplacementJob(job, { type: "apply/item-started", itemKey: "question:1", at: AT });

    const paused = reduceReplacementJob(job, { type: "run/pause", at: LATER });

    expect(paused.status).toBe("paused");
    expect(paused.proposals["question:1"]).toMatchObject({
      status: "ready-to-apply",
      attemptCount: 1,
    });
  });

  it("retains durable retry deadlines and records a resumable credential interruption", () => {
    let job: PersistedContentReplacementJob = { ...createJob(), status: "running", nextRetryAt: LATER };
    job = reduceReplacementJob(job, {
      type: "run/credential-interrupted",
      failure: failure("authorization", true),
      at: AT,
    });

    expect(job).toMatchObject({
      status: "paused",
      nextRetryAt: LATER,
      operationError: { category: "authorization", occurredAt: AT },
    });
  });

  it("persists a multi-batch stale rescan until every requested ref drains", () => {
    const originals = Array.from({ length: 11 }, (_, index) => proposal({ kind: "question", questionId: index + 1 }));
    const refs = originals.map((candidate) => candidate.before.ref);
    let job = createJob();
    job = { ...job, inventoryQueue: [], detailQueue: refs };
    for (let offset = 0; offset < refs.length; offset += 10) {
      job = reduceReplacementJob(job, {
        type: "scan/details-succeeded", refs: refs.slice(offset, offset + 10),
        result: {
          proposals: originals.slice(offset, offset + 10),
          inspectedCount: refs.slice(offset, offset + 10).length,
          protectedOccurrenceCount: 0,
        }, at: AT,
      });
    }
    job = reduceReplacementJob(job, { type: "scan/queues-drained", at: AT });
    job = reduceReplacementJob(job, { type: "apply/prepare", at: AT });
    job = reduceReplacementJob(job, { type: "apply/start", at: AT });
    for (let index = 0; index < originals.length; index += 1) {
      const key = `question:${index + 1}`;
      job = reduceReplacementJob(job, { type: "apply/item-started", itemKey: key, at: AT });
      job = reduceReplacementJob(job, {
        type: "apply/item-finished", itemKey: key,
        result: { status: "stale", observedRequestChecksum: DIGEST_C }, at: AT,
      });
    }
    const keys = originals.map((_, index) => `question:${index + 1}`);
    job = reduceReplacementJob(job, { type: "scan/stale-rescan-started", requestedItemKeys: keys, at: LATER });
    job = reduceReplacementJob(job, {
      type: "scan/stale-details-succeeded", requestedItemKeys: keys.slice(0, 10),
      result: { proposals: originals.slice(0, 10), inspectedCount: 10, protectedOccurrenceCount: 0 }, at: LATER,
    });

    expect(job).toMatchObject({
      stage: "results",
      status: "running",
      activeOperation: { kind: "stale-rescan", remainingItemKeys: ["question:11"] },
    });
    expect(job.proposals["question:1"].status).toBe("stale");
  });

  it("excludes items and derives exact selection summaries", () => {
    const first = proposal({ kind: "question", questionId: 1 });
    const second = proposal({ kind: "answer", questionId: 1, answerId: 2 });
    const job = reduceReplacementJob(reviewJob(first, second), {
      type: "review/set-included",
      itemKey: "question:1",
      included: false,
      reason: "user",
      at: LATER,
    });
    expect(job.proposals["question:1"]).toMatchObject({ included: false, status: "excluded" });
    expect(summarizeReplacementJob(job)).toMatchObject({
      selectedItems: 1,
      selectedChangedOccurrences: 1,
      results: { excluded: 1 },
    });
  });

  it("prepares every selected recovery atomically before apply becomes eligible", () => {
    const first = proposal({ kind: "question", questionId: 1 });
    const second = proposal({ kind: "article", articleId: 2 });
    const next = reduceReplacementJob(reviewJob(first, second), { type: "apply/prepare", at: LATER });
    const selected = Object.values(next.proposals).filter((item) => item.included);

    expect(next.recoverySnapshotStatus).toBe("ready");
    expect(selected.map((item) => item.recovery?.priorRequestModel)).toEqual([first.before, second.before]);
    expect(selected.every((item) => item.status === "ready-to-apply")).toBe(true);
    expect(getNextApplyItem(next)?.proposal.before.ref).toEqual(first.before.ref);
  });

  it("starts apply items strictly in proposal FIFO order", () => {
    const first = proposal({ kind: "question", questionId: 1 });
    const second = proposal({ kind: "question", questionId: 2 });
    const running = reduceReplacementJob(preparedJob(first, second), { type: "apply/start", at: AT });

    expect(reduceReplacementJob(running, {
      type: "apply/item-started",
      itemKey: "question:2",
      at: LATER,
    })).toEqual(running);
  });

  it("refuses preparation and apply when nothing is selected", () => {
    const first = proposal({ kind: "question", questionId: 1 });
    const excluded = reduceReplacementJob(reviewJob(first), {
      type: "review/set-included", itemKey: "question:1", included: false, reason: "user", at: AT,
    });
    expect(reduceReplacementJob(excluded, { type: "apply/prepare", at: LATER })).toEqual(excluded);
    expect(getNextApplyItem(excluded)).toBeNull();
  });

  it.each([
    ["updated", "applied", "updated"],
    ["already-applied", "applied", "alreadyApplied"],
    ["stale", "stale", "stale"],
    ["permission", "failed", "permission"],
    ["validation", "failed", "validation"],
    ["network", "failed", "network"],
    ["failed", "failed", "failed"],
  ] as const)("categorizes an apply %s result", (resultStatus, itemStatus, summaryKey) => {
    const key = "question:1";
    let job = preparedJob(proposal({ kind: "question", questionId: 1 }));
    job = reduceReplacementJob(job, { type: "apply/start", at: AT });
    job = reduceReplacementJob(job, { type: "apply/item-started", itemKey: key, at: AT });
    job = reduceReplacementJob(job, {
      type: "apply/item-finished",
      itemKey: key,
      result: resultStatus === "updated" || resultStatus === "already-applied" || resultStatus === "stale"
        ? { status: resultStatus, observedRequestChecksum: resultStatus === "stale" ? DIGEST_C : DIGEST_B }
        : { status: resultStatus, error: "Safe item failure." },
      at: LATER,
    });

    expect(job.proposals[key].status).toBe(itemStatus);
    expect(summarizeReplacementJob(job).results[summaryKey]).toBe(1);
    if (resultStatus === "already-applied") {
      expect(job.proposals[key].result).toEqual({
        kind: "unchanged", observedRequestChecksum: DIGEST_B, completedAt: LATER,
      });
    }
  });

  it("retries only eligible apply failures and preserves attempt counts", () => {
    const refs: ReplacementItemRef[] = [
      { kind: "question", questionId: 1 },
      { kind: "question", questionId: 2 },
      { kind: "question", questionId: 3 },
    ];
    let job = preparedJob(...refs.map(proposal));
    job = reduceReplacementJob(job, { type: "apply/start", at: AT });
    for (const [index, status] of ["network", "permission", "failed"] .entries()) {
      const key = replacementItemKey(refs[index]);
      job = reduceReplacementJob(job, { type: "apply/item-started", itemKey: key, at: AT });
      job = reduceReplacementJob(job, {
        type: "apply/item-finished",
        itemKey: key,
        result: { status: status as "network" | "permission" | "failed", error: "Safe failure." },
        at: LATER,
      });
    }
    const retried = reduceReplacementJob(job, { type: "apply/retry-eligible", at: LATER });
    expect(retried.proposals["question:1"].status).toBe("ready-to-apply");
    expect(retried.proposals["question:2"].status).toBe("failed");
    expect(retried.proposals["question:3"].status).toBe("ready-to-apply");
    expect(retried.proposals["question:1"].attemptCount).toBe(1);
  });

  it("replaces only requested stale proposals during a focused rescan", () => {
    const staleRef = { kind: "question" as const, questionId: 1 };
    const otherRef = { kind: "question" as const, questionId: 2 };
    let job = preparedJob(proposal(staleRef), proposal(otherRef));
    job = reduceReplacementJob(job, { type: "apply/start", at: AT });
    job = reduceReplacementJob(job, { type: "apply/item-started", itemKey: "question:1", at: AT });
    job = reduceReplacementJob(job, {
      type: "apply/item-finished",
      itemKey: "question:1",
      result: { status: "stale", observedRequestChecksum: DIGEST_C },
      at: LATER,
    });
    job = reduceReplacementJob(job, { type: "apply/item-started", itemKey: "question:2", at: AT });
    job = reduceReplacementJob(job, {
      type: "apply/item-finished", itemKey: "question:2",
      result: { status: "updated", observedRequestChecksum: DIGEST_B }, at: LATER,
    });
    const refreshed = { ...proposal(staleRef), proposalFingerprint: DIGEST_D };
    job = reduceReplacementJob(job, {
      type: "scan/stale-rescan-started", requestedItemKeys: ["question:1"], at: LATER,
    });
    const next = reduceReplacementJob(job, {
      type: "scan/stale-details-succeeded",
      requestedItemKeys: ["question:1"],
      result: { proposals: [refreshed], inspectedCount: 1, protectedOccurrenceCount: 0 },
      at: LATER,
    });
    expect(next.proposals["question:1"].proposal).toBe(refreshed);
    expect(next.proposals["question:2"].proposal).toBe(job.proposals["question:2"].proposal);
  });

  it("removes a stale proposal when focused rescan finds protected-only content", () => {
    let job = preparedJob(proposal({ kind: "question", questionId: 1 }));
    job = reduceReplacementJob(job, { type: "apply/start", at: AT });
    job = reduceReplacementJob(job, { type: "apply/item-started", itemKey: "question:1", at: AT });
    job = reduceReplacementJob(job, {
      type: "apply/item-finished", itemKey: "question:1",
      result: { status: "stale", observedRequestChecksum: DIGEST_C }, at: LATER,
    });
    job = reduceReplacementJob(job, {
      type: "scan/stale-rescan-started", requestedItemKeys: ["question:1"], at: LATER,
    });

    const next = reduceReplacementJob(job, {
      type: "scan/stale-details-succeeded",
      requestedItemKeys: ["question:1"],
      result: { proposals: [], inspectedCount: 1, protectedOccurrenceCount: 4 },
      at: LATER,
    });

    expect(next.proposals).toEqual({});
    expect(next.progress).toMatchObject({ proposalsFound: 0, protectedOccurrences: 4 });
    expect(next.stage).toBe("review");
  });

  it("persists a sanitized blocking failure when a focused stale rescan fails", () => {
    let job = preparedJob(proposal({ kind: "question", questionId: 1 }));
    job = reduceReplacementJob(job, { type: "apply/start", at: AT });
    job = reduceReplacementJob(job, { type: "apply/item-started", itemKey: "question:1", at: AT });
    job = reduceReplacementJob(job, {
      type: "apply/item-finished", itemKey: "question:1",
      result: { status: "stale", observedRequestChecksum: DIGEST_C }, at: LATER,
    });
    job = reduceReplacementJob(job, {
      type: "scan/stale-rescan-started", requestedItemKeys: ["question:1"], at: LATER,
    });

    const next = reduceReplacementJob(job, {
      type: "scan/stale-details-failed",
      requestedItemKeys: ["question:1"],
      failure: failure("network", true),
      at: LATER,
    });

    expect(next).toMatchObject({
      stage: "results",
      status: "failed",
      failure: { category: "network", retryable: true, occurredAt: LATER },
    });
    expect(next.proposals["question:1"].status).toBe("stale");
  });

  it("binds recovery previews and conflict outcomes to the successful apply generation", () => {
    const key = "question:1";
    let job = preparedJob(proposal({ kind: "question", questionId: 1 }));
    job = reduceReplacementJob(job, { type: "apply/start", at: AT });
    job = reduceReplacementJob(job, { type: "apply/item-started", itemKey: key, at: AT });
    job = reduceReplacementJob(job, {
      type: "apply/item-finished", itemKey: key,
      result: { status: "updated", observedRequestChecksum: DIGEST_B }, at: AT,
    });
    job = reduceReplacementJob(job, {
      type: "recovery/preview-finished",
      itemKey: key,
      result: {
        status: "recoverable",
        currentRequestModel: { kind: "question", ref: { kind: "question", questionId: 1 }, request: { title: "New title", body: "body", tags: ["tag"] } },
        observedRequestChecksum: DIGEST_B,
      },
      at: LATER,
    });
    expect(getNextRecoveryItem(job)?.proposal.before.ref).toEqual({ kind: "question", questionId: 1 });
    job = reduceReplacementJob(job, { type: "recovery/start", itemKeys: [key], at: LATER });
    job = reduceReplacementJob(job, { type: "recovery/item-started", itemKey: key, at: LATER });
    job = reduceReplacementJob(job, {
      type: "recovery/item-finished", itemKey: key,
      result: { status: "conflict", observedRequestChecksum: DIGEST_C }, at: LATER,
    });
    expect(job.proposals[key]).toMatchObject({
      status: "recovery-conflict",
      result: { kind: "applied", completedAt: AT },
      recovery: {
        status: "conflict",
        result: {
          kind: "conflict",
          sourceAttemptCount: 1,
          sourceApplyCompletedAt: AT,
          completedAt: LATER,
        },
      },
    });
    expect(summarizeReplacementJob(job).results).toMatchObject({
      updated: 1,
      recoveryConflict: 1,
    });
  });

  it("persists divergent post-write checksums as verification evidence, never success", () => {
    const key = "question:1";
    let job = preparedJob(proposal({ kind: "question", questionId: 1 }));
    job = reduceReplacementJob(job, { type: "apply/start", at: AT });
    job = reduceReplacementJob(job, { type: "apply/item-started", itemKey: key, at: AT });
    job = reduceReplacementJob(job, {
      type: "apply/item-finished", itemKey: key,
      result: { status: "updated", observedRequestChecksum: DIGEST_C }, at: LATER,
    });

    expect(job.proposals[key]).toMatchObject({
      status: "failed",
      result: {
        kind: "verification-failed",
        expectedRequestChecksum: DIGEST_B,
        observedRequestChecksum: DIGEST_C,
      },
      failure: { category: "validation", retryable: false },
    });
    expect(job.proposals[key].recovery?.observedPostApplyChecksum).toBeUndefined();
  });

  it("retains successful apply evidence when recovery readback verification diverges", () => {
    const key = "question:1";
    let job = preparedJob(proposal({ kind: "question", questionId: 1 }));
    job = reduceReplacementJob(job, { type: "apply/start", at: AT });
    job = reduceReplacementJob(job, { type: "apply/item-started", itemKey: key, at: AT });
    job = reduceReplacementJob(job, {
      type: "apply/item-finished", itemKey: key,
      result: { status: "updated", observedRequestChecksum: DIGEST_B }, at: AT,
    });
    job = reduceReplacementJob(job, {
      type: "recovery/preview-finished", itemKey: key,
      result: {
        status: "recoverable",
        currentRequestModel: { kind: "question", ref: { kind: "question", questionId: 1 }, request: { title: "New title", body: "body", tags: ["tag"] } },
        observedRequestChecksum: DIGEST_B,
      }, at: LATER,
    });
    job = reduceReplacementJob(job, { type: "recovery/start", itemKeys: [key], at: LATER });
    job = reduceReplacementJob(job, { type: "recovery/item-started", itemKey: key, at: LATER });
    job = reduceReplacementJob(job, {
      type: "recovery/item-finished", itemKey: key,
      result: { status: "recovered", observedRequestChecksum: DIGEST_D }, at: LATER,
    });

    expect(job.proposals[key]).toMatchObject({
      status: "recovery-conflict",
      result: { kind: "applied", observedRequestChecksum: DIGEST_B },
      recovery: {
        status: "conflict",
        observedPostApplyChecksum: DIGEST_B,
        result: {
          kind: "verification-failed",
          expectedRequestChecksum: DIGEST_A,
          observedRequestChecksum: DIGEST_D,
        },
      },
    });
  });

  it("deletes recovery snapshots without deleting successful apply evidence", () => {
    const key = "question:1";
    let job = preparedJob(proposal({ kind: "question", questionId: 1 }));
    job = reduceReplacementJob(job, { type: "apply/start", at: AT });
    job = reduceReplacementJob(job, { type: "apply/item-started", itemKey: key, at: AT });
    job = reduceReplacementJob(job, {
      type: "apply/item-finished", itemKey: key,
      result: { status: "updated", observedRequestChecksum: DIGEST_B }, at: LATER,
    });

    const next = reduceReplacementJob(job, { type: "recovery/delete-snapshots", at: LATER });

    expect(next.recoverySnapshotStatus).toBe("none");
    expect(next.proposals[key].recovery).toBeUndefined();
    expect(next.proposals[key].result).toEqual(job.proposals[key].result);
  });

  it("clears a stale-rescan root failure when deleting the remaining recovery snapshots", () => {
    let job = preparedJob(proposal({ kind: "question", questionId: 1 }));
    job = reduceReplacementJob(job, { type: "apply/start", at: AT });
    job = reduceReplacementJob(job, { type: "apply/item-started", itemKey: "question:1", at: AT });
    job = reduceReplacementJob(job, {
      type: "apply/item-finished", itemKey: "question:1",
      result: { status: "stale", observedRequestChecksum: DIGEST_C }, at: LATER,
    });
    job = reduceReplacementJob(job, {
      type: "scan/stale-details-failed", requestedItemKeys: ["question:1"],
      failure: failure("network", true), at: LATER,
    });

    const next = reduceReplacementJob(job, { type: "recovery/delete-snapshots", at: LATER });

    expect(next.status).toBe("completed");
    expect(next.failure).toBeUndefined();
    expect(next.proposals["question:1"].result?.kind).toBe("stale");
  });
});
