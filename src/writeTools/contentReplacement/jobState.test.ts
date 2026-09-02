import { describe, expect, it } from "vitest";
import { parseContentReplacementJob } from "../../utils/browserContentReplacementStorage";
import { buildReplacementProposal, createJobFingerprint } from "./proposals";
import type {
  PersistedContentReplacementFailure,
  PersistedContentReplacementJob,
  ReplacementConfiguration,
  ReplacementItemRef,
  ReplacementProposal,
} from "./types";
import {
  MAX_CONTENT_REPLACEMENT_PROPOSALS,
  canEnterReview,
  createReplacementJob,
  createReplacementSelectionSnapshot,
  getNextApplyItem,
  getNextDetailBatch,
  getNextInventoryCursor,
  getNextRecoveryItem,
  getReplacementReviewPage,
  reduceReplacementJob,
  reduceReplacementSelectionBulk,
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
  discovery: { mode: "full" },
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
  return prepareJob(reviewJob(...proposals), AT);
}

function prepareJob(job: PersistedContentReplacementJob, at: string): PersistedContentReplacementJob {
  return reduceReplacementJob(job, {
    type: "apply/prepare",
    expectedSelection: createReplacementSelectionSnapshot(job.proposals),
    at,
  });
}

function failure(
  category: PersistedContentReplacementFailure["category"],
  retryable: boolean,
): Omit<PersistedContentReplacementFailure, "occurredAt"> {
  return { category, retryable, message: `Safe ${category} failure.` };
}

describe("replacement job state", () => {
  it("seeds exact mode directly into the bounded detail queue", () => {
    const targets: ReplacementItemRef[] = [
      { kind: "question", questionId: 42 },
      { kind: "answer", questionId: 42, answerId: 87 },
      { kind: "article", articleId: 9 },
    ];

    const job = createReplacementJob({
      id: "exact-job",
      fingerprint: DIGEST_D,
      baseUrl: "https://example.stackenterprise.co",
      configuration: {
        ...configuration,
        discovery: { mode: "exact", targetCount: 3, targetDigest: DIGEST_A },
      },
      exactTargets: targets,
      createdAt: AT,
    } as Parameters<typeof createReplacementJob>[0] & { exactTargets: ReplacementItemRef[] });

    expect(job.inventoryQueue).toEqual([]);
    expect(job.detailQueue).toEqual(targets);
  });

  it("rejects exact targets that conflict with selected content types", () => {
    expect(() => createReplacementJob({
      id: "exact-job",
      fingerprint: DIGEST_D,
      baseUrl: "https://example.stackenterprise.co",
      configuration: {
        ...configuration,
        contentTypes: { questions: false, answers: true, articles: false },
        discovery: { mode: "exact", targetCount: 1, targetDigest: DIGEST_A },
      },
      exactTargets: [{ kind: "question", questionId: 42 }],
      createdAt: AT,
    } as Parameters<typeof createReplacementJob>[0] & { exactTargets: ReplacementItemRef[] })).toThrow();
  });

  it("seeds one targeted cursor per distinct configured source term", () => {
    const job = createReplacementJob({
      id: "targeted-job",
      fingerprint: DIGEST_D,
      baseUrl: "https://example.stackenterprise.co",
      configuration: {
        ...configuration,
        discovery: { mode: "targeted" },
        rules: [
          { id: "rule-1", find: "Old", replace: "New" },
          { id: "rule-2", find: "Legacy", replace: "Current" },
        ],
      },
      createdAt: AT,
    });

    expect(job.inventoryQueue).toEqual([
      { kind: "search", ruleId: "rule-1", page: 1 },
      { kind: "search", ruleId: "rule-2", page: 1 },
    ]);
  });

  it("counts only accepted search references once while advancing a paginated rule", () => {
    const configurationWithSearch: ReplacementConfiguration = {
      ...configuration,
      discovery: { mode: "targeted" },
      rules: [
        { id: "rule-1", find: "Old", replace: "New" },
        { id: "rule-2", find: "Legacy", replace: "Current" },
      ],
    };
    let job = createReplacementJob({
      id: "targeted-job",
      fingerprint: DIGEST_D,
      baseUrl: "https://example.stackenterprise.co",
      configuration: configurationWithSearch,
      createdAt: AT,
    });

    job = reduceReplacementJob(job, {
      type: "scan/inventory-succeeded",
      cursor: { kind: "search", ruleId: "rule-1", page: 1 },
      result: {
        candidates: [
          { kind: "question", questionId: 1 },
          { kind: "article", articleId: 2 },
          { kind: "question", questionId: 1 },
        ],
        answerCursors: [],
        nextCursor: { kind: "search", ruleId: "rule-1", page: 2 },
        inspectedCount: 3,
        pageKind: "search",
        progress: {
          apiRequestsCompleted: 1,
          searchPages: 1,
          searchTermsCompleted: 0,
          answerBearingQuestionsQueued: 0,
          zeroAnswerQuestionsSkipped: 0,
        },
      },
      at: LATER,
    });

    expect(job.inventoryQueue).toEqual([
      { kind: "search", ruleId: "rule-1", page: 2 },
      { kind: "search", ruleId: "rule-2", page: 1 },
    ]);
    expect(job.detailQueue).toEqual([
      { kind: "question", questionId: 1 },
      { kind: "article", articleId: 2 },
    ]);
    expect(job.progress).toMatchObject({
      apiRequestsCompleted: 1,
      searchPages: 1,
      searchTermsCompleted: 0,
      indexedReferences: 2,
    });

    job = reduceReplacementJob(job, {
      type: "scan/inventory-succeeded",
      cursor: { kind: "search", ruleId: "rule-1", page: 2 },
      result: {
        candidates: [
          { kind: "question", questionId: 1 },
          { kind: "answer", questionId: 1, answerId: 3 },
        ],
        answerCursors: [],
        nextCursor: null,
        inspectedCount: 2,
        pageKind: "search",
        progress: {
          apiRequestsCompleted: 1,
          searchPages: 1,
          searchTermsCompleted: 1,
          answerBearingQuestionsQueued: 0,
          zeroAnswerQuestionsSkipped: 0,
        },
      },
      at: LATER,
    });

    job = reduceReplacementJob(job, {
      type: "scan/inventory-succeeded",
      cursor: { kind: "search", ruleId: "rule-2", page: 1 },
      result: {
        candidates: [
          { kind: "question", questionId: 1 },
          { kind: "article", articleId: 2 },
        ],
        answerCursors: [],
        nextCursor: null,
        inspectedCount: 2,
        pageKind: "search",
        progress: {
          apiRequestsCompleted: 1,
          searchPages: 1,
          searchTermsCompleted: 1,
          answerBearingQuestionsQueued: 0,
          zeroAnswerQuestionsSkipped: 0,
        },
      },
      at: LATER,
    });

    expect(job.detailQueue).toEqual([
      { kind: "question", questionId: 1 },
      { kind: "article", articleId: 2 },
      { kind: "answer", questionId: 1, answerId: 3 },
    ]);
    expect(job.progress).toMatchObject({
      apiRequestsCompleted: 3,
      searchPages: 3,
      searchTermsCompleted: 2,
      indexedReferences: 3,
    });
  });

  it("increments request metrics only for the matching current inventory response", () => {
    const job = createJob({ questions: true, answers: false, articles: false });
    const stale = reduceReplacementJob(job, {
      type: "scan/inventory-succeeded",
      cursor: { kind: "articles", page: 1 },
      result: {
        candidates: [],
        answerCursors: [],
        nextCursor: null,
        inspectedCount: 0,
        pageKind: "articles",
        progress: {
          apiRequestsCompleted: 1,
          searchPages: 0,
          searchTermsCompleted: 0,
          answerBearingQuestionsQueued: 0,
          zeroAnswerQuestionsSkipped: 0,
        },
      },
      at: LATER,
    });
    const accepted = reduceReplacementJob(stale, {
      type: "scan/inventory-succeeded",
      cursor: { kind: "questions", page: 1 },
      result: {
        candidates: [],
        answerCursors: [],
        nextCursor: null,
        inspectedCount: 0,
        pageKind: "questions",
        progress: {
          apiRequestsCompleted: 1,
          searchPages: 0,
          searchTermsCompleted: 0,
          answerBearingQuestionsQueued: 0,
          zeroAnswerQuestionsSkipped: 0,
        },
      },
      at: LATER,
    });

    expect(stale).toBe(job);
    expect(accepted.progress).toMatchObject({ apiRequestsCompleted: 1 });
  });

  it("enters Review only after all targeted search and detail work drains", () => {
    const job = createReplacementJob({
      id: "targeted-job",
      fingerprint: DIGEST_D,
      baseUrl: "https://example.stackenterprise.co",
      configuration: { ...configuration, discovery: { mode: "targeted" } },
      createdAt: AT,
    });
    const remainingDetail = {
      ...job,
      inventoryQueue: [],
      detailQueue: [{ kind: "question" as const, questionId: 42 }],
    };
    const drained = { ...job, inventoryQueue: [], detailQueue: [] };

    expect(canEnterReview(job)).toBe(false);
    expect(canEnterReview(remainingDetail)).toBe(false);
    expect(reduceReplacementJob(job, { type: "scan/queues-drained", at: LATER })).toBe(job);
    expect(reduceReplacementJob(remainingDetail, { type: "scan/queues-drained", at: LATER })).toBe(remainingDetail);
    expect(canEnterReview(drained)).toBe(true);
    expect(reduceReplacementJob(drained, { type: "scan/queues-drained", at: LATER })).toMatchObject({
      stage: "review",
      status: "completed",
    });
  });

  it("caps the next detail request by the five remaining proposal slots", () => {
    const refs = Array.from({ length: 10 }, (_, index) => ({
      kind: "question" as const,
      questionId: 200_001 + index,
    }));
    const job = capacityScanJob(99_995, refs);

    expect(MAX_CONTENT_REPLACEMENT_PROPOSALS).toBe(100_000);
    expect(getNextDetailBatch(job)).toEqual(refs.slice(0, 5));
  });

  it("blocks review when the proposal ceiling is full but detail refs remain", () => {
    const refs = [{ kind: "question" as const, questionId: 200_001 }];
    const job = capacityScanJob(100_000, refs);

    expect(getNextDetailBatch(job)).toEqual([]);
    expect(canEnterReview(job)).toBe(false);
    expect(job.status).toBe("running");
    const blocked = reduceReplacementJob(job, { type: "scan/queues-drained", at: LATER });
    expect(blocked).toMatchObject({
      stage: "scan",
      status: "failed",
      detailQueue: refs,
      failure: {
        category: "validation",
        retryable: false,
        message: "Content replacement reached the 100,000-proposal safety limit before candidate inspection finished. Start a narrower job.",
      },
    });
    expect(reduceReplacementJob(blocked, { type: "scan/queues-drained", at: LATER }) === blocked).toBe(true);
  });

  it("does not overwrite an existing failed scan when a duplicate queues-drained event arrives at capacity", () => {
    const refs: ReplacementItemRef[] = [{ kind: "question", questionId: 200_001 }];
    const job = {
      ...capacityScanJob(100_000, refs),
      status: "failed" as const,
      failure: {
        category: "network" as const,
        retryable: true,
        message: "The prior scan request lost its connection.",
        occurredAt: AT,
      },
    };

    const duplicate = reduceReplacementJob(job, { type: "scan/queues-drained", at: LATER });

    expect(duplicate === job).toBe(true);
    expect(duplicate.revision).toBe(job.revision);
    expect(duplicate.failure === job.failure).toBe(true);
  });

  it.each(["cancelled", "completed"] as const)(
    "keeps an already %s scan unchanged when queues-drained is replayed at capacity",
    (status) => {
      const refs: ReplacementItemRef[] = [{ kind: "question", questionId: 200_001 }];
      const job = { ...capacityScanJob(100_000, refs), status };

      const duplicate = reduceReplacementJob(job, { type: "scan/queues-drained", at: LATER });

      expect(duplicate === job).toBe(true);
      expect(duplicate.revision).toBe(job.revision);
    },
  );

  it("rejects a malicious detail completion that would publish proposal 100,001", () => {
    const refs = Array.from({ length: 10 }, (_, index) => ({
      kind: "question" as const,
      questionId: 200_001 + index,
    }));
    const job = capacityScanJob(99_995, refs);
    const candidates = refs.map(proposal);

    expect(reduceReplacementJob(job, {
      type: "scan/details-succeeded",
      refs,
      result: { proposals: candidates, inspectedCount: 10, protectedOccurrenceCount: 0 },
      at: LATER,
    })).toBe(job);
    expect(job.detailQueue).toEqual(refs);
    expect(Object.keys(job.proposals)).toHaveLength(99_995);
  });

  it("validates 10,000 canonical proposals with deterministic batches, selections, review pages, and serialization", async () => {
    const questionInventoryCount = 10_000;
    const refs = Array.from({ length: 10_000 }, (_, index) => ({
      kind: "answer" as const,
      questionId: index + 1,
      answerId: index + 10_001,
    }));
    const configured = createJob({ questions: false, answers: true, articles: false });
    configured.fingerprint = await createJobFingerprint({
      baseUrl: configured.baseUrl,
      configuration: configured.configuration,
    });
    const canonical = await Promise.all(refs.map((ref) => buildReplacementProposal({
      kind: "answer",
      ref,
      request: { body: "Old body" },
    }, configured.configuration)));
    expect(canonical.every((candidate) => candidate !== null)).toBe(true);
    const proposals = Object.fromEntries(refs.map((ref, index) => {
      const candidate = canonical[index];
      if (!candidate) throw new Error("Expected a canonical 10,000-proposal fixture.");
      return [replacementItemKey(ref), {
        proposal: candidate,
        included: true,
        attemptCount: 0,
        status: "pending" as const,
      }];
    }));
    const startedAt = performance.now();
    const serializedReview = JSON.stringify({
      ...configured,
      stage: "review" as const,
      status: "completed" as const,
      inventoryQueue: [],
      detailQueue: [],
      proposals,
      progress: {
        ...configured.progress,
        questionPages: questionInventoryCount / 100,
        answerPages: refs.length,
        inventoryItems: questionInventoryCount + refs.length,
        detailsInspected: refs.length,
        proposalsFound: refs.length,
      },
    });
    const serializedScan = JSON.stringify({
      ...configured,
      inventoryQueue: [],
      detailQueue: refs,
      progress: {
        ...configured.progress,
        questionPages: questionInventoryCount / 100,
        answerPages: refs.length,
        inventoryItems: questionInventoryCount + refs.length,
      },
    });

    const scanning = await parseContentReplacementJob(JSON.parse(serializedScan));
    const review = await parseContentReplacementJob(JSON.parse(serializedReview));

    expect(scanning.progress).toMatchObject({
      questionPages: 100,
      answerPages: 10_000,
      inventoryItems: 20_000,
      detailsInspected: 0,
      proposalsFound: 0,
    });
    expect(review.progress).toMatchObject({
      questionPages: 100,
      answerPages: 10_000,
      inventoryItems: 20_000,
      detailsInspected: 10_000,
      proposalsFound: 10_000,
    });

    expect(getNextDetailBatch(scanning)).toEqual(refs.slice(0, 10));
    expect(getNextDetailBatch(scanning)).toEqual(getNextDetailBatch(scanning));

    const excludedKeys = refs.slice(4_500, 5_500).map(replacementItemKey);
    const selected = reduceReplacementSelectionBulk(review, excludedKeys, false, "bulk", LATER);
    expect(summarizeReplacementJob(selected)).toMatchObject({
      selectedItems: 9_000,
      selectedChangedOccurrences: 9_000,
      results: { excluded: 1_000 },
    });

    const entries = Object.entries(selected.proposals);
    expect(getReplacementReviewPage(entries, 1)).toMatchObject({ page: 1, pageCount: 200, start: 1, end: 50 });
    expect(getReplacementReviewPage(entries, 200)).toMatchObject({ page: 200, pageCount: 200, start: 9_951, end: 10_000 });
    expect(getReplacementReviewPage(entries, 200).items).toHaveLength(50);

    expect(Object.keys(review.proposals)).toHaveLength(10_000);
    expect(createReplacementSelectionSnapshot(review.proposals)).toEqual(
      {
        itemKeys: refs.map(replacementItemKey).sort(),
        selectedItems: 10_000,
        selectedChangedOccurrences: 10_000,
      },
    );
    expect(createReplacementSelectionSnapshot(selected.proposals)).toEqual(
      {
        itemKeys: refs.filter((_ref, index) => index < 4_500 || index >= 5_500).map(replacementItemKey).sort(),
        selectedItems: 9_000,
        selectedChangedOccurrences: 9_000,
      },
    );
    expect(createReplacementSelectionSnapshot(review.proposals)).not.toEqual(
      createReplacementSelectionSnapshot(selected.proposals),
    );
    const elapsed = performance.now() - startedAt;
    expect(elapsed).toBeLessThan(10_000);
  }, 30_000);

  it("starts at revision zero and advances once for each accepted reducer transition", () => {
    const created = createJob();
    expect(created.revision).toBe(0);

    const resumed = reduceReplacementJob(created, { type: "run/resume", at: LATER });
    expect(resumed.revision).toBe(1);

    const delayed = reduceReplacementJob(resumed, {
      type: "run/set-retry-at",
      nextRetryAt: "2026-09-01T12:02:00.000Z",
      at: LATER,
    });
    expect(delayed.revision).toBe(2);
    expect(reduceReplacementJob(delayed, { type: "run/resume", at: LATER })).toBe(delayed);
  });

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
        progress: {
          apiRequestsCompleted: 0,
          searchPages: 0,
          searchTermsCompleted: 0,
          answerBearingQuestionsQueued: 0,
          zeroAnswerQuestionsSkipped: 0,
        },
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
          progress: {
            apiRequestsCompleted: 0,
            searchPages: 0,
            searchTermsCompleted: 0,
            answerBearingQuestionsQueued: 0,
            zeroAnswerQuestionsSkipped: 0,
          },
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
        progress: {
          apiRequestsCompleted: 0,
          searchPages: 0,
          searchTermsCompleted: 0,
          answerBearingQuestionsQueued: 0,
          zeroAnswerQuestionsSkipped: 0,
        },
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
        progress: {
          apiRequestsCompleted: 0,
          searchPages: 0,
          searchTermsCompleted: 0,
          answerBearingQuestionsQueued: 0,
          zeroAnswerQuestionsSkipped: 0,
        },
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
    job = prepareJob(job, AT);
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

  it("bulk-updates one captured unique key set deterministically and invalidates recovery once", () => {
    const first = proposal({ kind: "question", questionId: 1 });
    const second = proposal({ kind: "answer", questionId: 1, answerId: 2 });
    const third = proposal({ kind: "article", articleId: 3 });
    const initial = reviewJob(first, second, third);

    const next = reduceReplacementJob(initial, {
      type: "review/set-included-bulk",
      itemKeys: ["article:3", "question:1"],
      included: false,
      reason: "bulk",
      at: LATER,
    });

    expect(next).not.toBe(initial);
    expect(next.updatedAt).toBe(LATER);
    expect(next.recoverySnapshotStatus).toBe("none");
    expect(next.proposals["question:1"]).toMatchObject({ included: false, exclusionReason: "bulk" });
    expect(next.proposals["article:3"]).toMatchObject({ included: false, exclusionReason: "bulk" });
    expect(next.proposals["answer:1:2"].included).toBe(true);
    expect(Object.keys(next.proposals)).toEqual(Object.keys(initial.proposals));

    expect(reduceReplacementJob(initial, {
      type: "review/set-included-bulk",
      itemKeys: ["question:1", "question:1"],
      included: false,
      reason: "bulk",
      at: LATER,
    })).toBe(initial);
    expect(reduceReplacementJob(initial, {
      type: "review/set-included-bulk",
      itemKeys: ["question:404"],
      included: false,
      reason: "bulk",
      at: LATER,
    })).toBe(initial);
  });

  it("prepares apply only when the exact reviewed selection snapshot still matches", () => {
    const initial = reviewJob(
      proposal({ kind: "question", questionId: 1 }),
      proposal({ kind: "article", articleId: 2 }),
    );
    const reviewed = createReplacementSelectionSnapshot(initial.proposals);
    const changed = reduceReplacementJob(initial, {
      type: "review/set-included",
      itemKey: "question:1",
      included: false,
      reason: "user",
      at: LATER,
    });

    expect(reduceReplacementJob(changed, {
      type: "apply/prepare",
      expectedSelection: reviewed,
      at: LATER,
    })).toBe(changed);

    const current = createReplacementSelectionSnapshot(changed.proposals);
    const prepared = reduceReplacementJob(changed, {
      type: "apply/prepare",
      expectedSelection: current,
      at: LATER,
    });
    expect(prepared.stage).toBe("apply");
    expect(current).toEqual({
      itemKeys: ["article:2"],
      selectedItems: 1,
      selectedChangedOccurrences: 1,
    });
  });

  it("prepares every selected recovery atomically before apply becomes eligible", () => {
    const first = proposal({ kind: "question", questionId: 1 });
    const second = proposal({ kind: "article", articleId: 2 });
    const next = prepareJob(reviewJob(first, second), LATER);
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
    expect(prepareJob(excluded, LATER)).toEqual(excluded);
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

  it("advances exact recovery completed prefixes only with typed item evidence", () => {
    const first = proposal({ kind: "question", questionId: 1 });
    const second = proposal({ kind: "question", questionId: 2 });
    let job = preparedJob(first, second);
    job = reduceReplacementJob(job, { type: "apply/start", at: AT });
    for (const key of ["question:1", "question:2"]) {
      job = reduceReplacementJob(job, { type: "apply/item-started", itemKey: key, at: AT });
      job = reduceReplacementJob(job, {
        type: "apply/item-finished", itemKey: key,
        result: { status: "updated", observedRequestChecksum: DIGEST_B }, at: AT,
      });
    }
    job = reduceReplacementJob(job, {
      type: "recovery/preview-run-started", itemKeys: ["question:1", "question:2"], at: LATER,
    });
    job = reduceReplacementJob(job, { type: "recovery/preview-started", itemKey: "question:1", at: LATER });
    job = reduceReplacementJob(job, {
      type: "recovery/preview-finished", itemKey: "question:1",
      result: {
        status: "recoverable",
        currentRequestModel: { kind: "question", ref: { kind: "question", questionId: 1 }, request: { title: "New title", body: "body", tags: ["tag"] } },
        observedRequestChecksum: DIGEST_B,
      }, at: LATER,
    });

    expect(job.activeOperation).toMatchObject({
      kind: "recovery-preview",
      requestedItemKeys: ["question:1", "question:2"],
      completedItemKeys: ["question:1"],
      remainingItemKeys: ["question:2"],
    });
    expect(job.proposals["question:1"].status).toBe("ready-to-recover");
    expect(job.proposals["question:2"].status).toBe("applied");
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

function capacityScanJob(
  proposalCount: number,
  detailQueue: ReplacementItemRef[],
): PersistedContentReplacementJob {
  const shared = {
    proposal: proposal({ kind: "answer", questionId: 1, answerId: 1 }),
    included: true,
    attemptCount: 0,
    status: "pending" as const,
  };
  const proposals = Object.fromEntries(Array.from({ length: proposalCount }, (_unused, index) => [
    `answer:${index + 1}:${index + 1}`,
    shared,
  ]));
  return {
    ...createJob(),
    status: "running",
    inventoryQueue: [],
    detailQueue,
    proposals,
    progress: {
      ...createJob().progress,
      inventoryItems: proposalCount + detailQueue.length,
      detailsInspected: proposalCount,
      proposalsFound: proposalCount,
    },
  };
}
