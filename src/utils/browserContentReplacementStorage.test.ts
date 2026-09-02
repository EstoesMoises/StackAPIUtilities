import { afterEach, describe, expect, it, vi } from "vitest";

import {
  deleteContentReplacementJob,
  listContentReplacementJobs,
  loadContentReplacementJob,
  saveContentReplacementJob,
} from "./browserContentReplacementStorage";
import type { PersistedContentReplacementJob } from "../writeTools/contentReplacement/types";

const originalIndexedDB = globalThis.indexedDB;
const JOB_FINGERPRINT = "758cb96c6de3e89a529a6ea11728371ffe3d242c7d4bc56cf9c8f4a6a8aa1d05";
const QUESTION_BEFORE_CHECKSUM = "de1e9b808d7270abdb70c9a62a8e2c9f43f447cd00c5032a6f5a9407707e25cc";
const QUESTION_AFTER_CHECKSUM = "73c354befeb39f52ac0b2e4876e033864abbd15a48f6433bff70042c4cbc27f3";
const ANSWER_BEFORE_CHECKSUM = "1bd8d4eaef3a9cfc162211319653d098d120491792435b32b0a15b1bc6549c6b";
const ANSWER_AFTER_CHECKSUM = "6197b3f53e1bab2d2ac7cb2050327f4e22631803f53d9a0d783fbe683a7f96da";
const ARTICLE_BEFORE_CHECKSUM = "37b369386ce3ea661dbda60e67fcc93025ef95095bd840c0057794eecadca09b";
const ARTICLE_AFTER_CHECKSUM = "477e64851681a28c9296464b78ec415d654720ca08790f0b65e892f481b3df2b";

afterEach(() => {
  vi.unstubAllGlobals();
  if (originalIndexedDB) vi.stubGlobal("indexedDB", originalIndexedDB);
});

describe("browserContentReplacementStorage", () => {
  it("persists a resumable job in a dedicated browser database", async () => {
    installFakeIndexedDB();
    const job = createJob();

    await saveContentReplacementJob(job);

    await expect(loadContentReplacementJob(job.id)).resolves.toEqual(job);
  });

  it("persists the recovery snapshot gate required before apply can resume", async () => {
    installFakeIndexedDB();
    const job = createJob() as PersistedContentReplacementJob & {
      recoverySnapshotStatus: "none";
    };
    job.recoverySnapshotStatus = "none";

    await saveContentReplacementJob(job);

    await expect(loadContentReplacementJob(job.id)).resolves.toEqual(job);
  });

  it("persists proposal, result, failure, and recovery records without inspecting content strings", async () => {
    installFakeIndexedDB();
    const body = 'Documentation: {"authorization":"Bearer abc"}, accessToken, and apiKey.';
    const job = createJob();
    job.proposals["question:42"] = {
      proposal: {
        before: {
          kind: "question",
          ref: { kind: "question", questionId: 42 },
          request: { title: "Old authorization", body, tags: ["api"] },
          metadata: {
            titleContext: "A title",
            webUrl: "https://example.stackenterprise.co/q/42",
            owner: { id: 1, name: "Owner" },
            lastEditor: { id: 2 },
            lastActivityDate: null,
          },
        },
        after: {
          kind: "question",
          ref: { kind: "question", questionId: 42 },
          request: { title: "New authorization", body, tags: ["api"] },
          metadata: {
            titleContext: "A title",
            webUrl: "https://example.stackenterprise.co/q/42",
            owner: { id: 1, name: "Owner" },
            lastEditor: { id: 2 },
            lastActivityDate: null,
          },
        },
        scannedRequestChecksum: QUESTION_BEFORE_CHECKSUM,
        proposedRequestChecksum: QUESTION_AFTER_CHECKSUM,
        proposalFingerprint: "d".repeat(64),
        fields: {
          title: { beforeMarkdown: "Old authorization", afterMarkdown: "New authorization" },
          body: { beforeMarkdown: body, afterMarkdown: body },
        },
        changedOccurrences: [{
          field: "title", ruleId: "rule-1", start: 0, end: 3, before: "Old", after: "New",
        }],
        protectedOccurrences: [{
          field: "body", ruleId: "rule-1", start: 20, end: 23, before: "Old", reason: "code",
        }],
        appliedRuleIds: ["rule-1"],
        metadata: {
          titleContext: "A title",
          webUrl: "https://example.stackenterprise.co/q/42",
          owner: { id: 1, name: "Owner" },
          lastEditor: { id: 2 },
          lastActivityDate: null,
        },
      },
      included: true,
      attemptCount: 2,
      status: "applied",
      result: {
        kind: "applied",
        observedRequestChecksum: "e".repeat(64),
        completedAt: "2026-09-01T12:02:00.000Z",
      },
      failure: {
        category: "network",
        message: "A sanitized prior failure",
        retryable: true,
        statusCode: 503,
        occurredAt: "2026-09-01T12:01:00.000Z",
      },
      recovery: {
        priorRequestModel: {
          kind: "question",
          ref: { kind: "question", questionId: 42 },
          request: { title: "Old authorization", body, tags: ["api"] },
        },
        scannedRequestChecksum: QUESTION_BEFORE_CHECKSUM,
        proposedRequestChecksum: QUESTION_AFTER_CHECKSUM,
        observedPostApplyChecksum: "e".repeat(64),
        status: "ready",
      },
    };
    job.progress.proposalsFound = 1;

    await saveContentReplacementJob(job);

    const loaded = await loadContentReplacementJob(job.id);
    expect(loaded).toEqual(job);
    expect(loaded?.proposals["question:42"].proposal.before.request.body).toBe(body);
  });

  it("uses its own versioned jobs store and supports deterministic list and idempotent delete", async () => {
    const fake = installFakeIndexedDB();
    const older = createJob();
    older.id = "job-z";
    const newerA = createJob();
    newerA.id = "job-a";
    newerA.updatedAt = "2026-09-01T13:00:00.000Z";
    const newerB = createJob();
    newerB.id = "job-b";
    newerB.updatedAt = newerA.updatedAt;

    await saveContentReplacementJob(older);
    await saveContentReplacementJob(newerB);
    await saveContentReplacementJob(newerA);

    await expect(listContentReplacementJobs()).resolves.toEqual([newerA, newerB, older]);
    await deleteContentReplacementJob("job-a");
    await deleteContentReplacementJob("job-a");
    await expect(loadContentReplacementJob("job-a")).resolves.toBeNull();
    expect(fake.openCalls.every((call) => call.name === "stack-api-content-replacement")).toBe(true);
    expect(fake.openCalls.every((call) => call.version === 1)).toBe(true);
    expect(fake.createdStores).toEqual([{ name: "jobs", keyPath: "id" }]);
  });

  it("uses a locale-independent lexical ID tie-break for equal update timestamps", async () => {
    installFakeIndexedDB();
    const upper = { ...createJob(), id: "job-A" };
    const lower = { ...createJob(), id: "job-a" };
    await saveContentReplacementJob(lower);
    await saveContentReplacementJob(upper);

    const jobs = await listContentReplacementJobs();

    expect(jobs.map((job) => job.id)).toEqual(["job-A", "job-a"]);
  });

  it("validates a job completely before opening a write transaction", async () => {
    const open = vi.fn();
    vi.stubGlobal("indexedDB", { open });
    const invalid = createJob() as PersistedContentReplacementJob & { apiKey?: string };
    invalid.apiKey = "secret";

    await expect(saveContentReplacementJob(invalid)).rejects.toThrow("Stored content replacement job is invalid.");
    expect(open).not.toHaveBeenCalled();
  });

  it.each([
    ["root", (job: any) => { job.accessToken = "secret"; }],
    ["target", (job: any) => { job.target.apiKey = "secret"; }],
    ["configuration", (job: any) => { job.configuration.authorizationHeader = "secret"; }],
    ["content types", (job: any) => { job.configuration.contentTypes.comments = true; }],
    ["options", (job: any) => { job.configuration.options.regex = true; }],
    ["rule", (job: any) => { job.configuration.rules[0].accessToken = "secret"; }],
    ["item", (job: any) => { job.proposals["question:42"].apiKey = "secret"; }],
    ["proposal", (job: any) => { job.proposals["question:42"].proposal.authorization = "secret"; }],
    ["ref", (job: any) => { job.proposals["question:42"].proposal.before.ref.apiKey = "secret"; }],
    ["request", (job: any) => { job.proposals["question:42"].proposal.before.request.accessToken = "secret"; }],
    ["metadata", (job: any) => { job.proposals["question:42"].proposal.metadata.apiKey = "secret"; }],
    ["metadata user", (job: any) => { job.proposals["question:42"].proposal.metadata.owner.apiKey = "secret"; }],
    ["fields", (job: any) => { job.proposals["question:42"].proposal.fields.apiKey = "secret"; }],
    ["field", (job: any) => { job.proposals["question:42"].proposal.fields.body.apiKey = "secret"; }],
    ["changed occurrence", (job: any) => { job.proposals["question:42"].proposal.changedOccurrences[0].apiKey = "secret"; }],
    ["protected occurrence", (job: any) => { job.proposals["question:42"].proposal.protectedOccurrences[0].apiKey = "secret"; }],
    ["result", (job: any) => { job.proposals["question:42"].result.apiKey = "secret"; }],
    ["failure", (job: any) => { job.proposals["question:42"].failure.apiKey = "secret"; }],
    ["recovery", (job: any) => { job.proposals["question:42"].recovery.apiKey = "secret"; }],
    ["recovery request", (job: any) => { job.proposals["question:42"].recovery.priorRequestModel.request.apiKey = "secret"; }],
    ["progress", (job: any) => { job.progress.apiKey = "secret"; }],
    ["cursor", (job: any) => { job.inventoryQueue[0].apiKey = "secret"; }],
  ])("rejects unknown keys at the %s object", async (_label, mutate) => {
    installFakeIndexedDB();
    const job = createPopulatedJob();
    mutate(job);

    await expect(saveContentReplacementJob(job)).rejects.toThrow("Stored content replacement job is invalid.");
  });

  it("rejects mismatched canonical proposal keys, refs, and checksums", async () => {
    installFakeIndexedDB();
    const badKey = createPopulatedJob();
    badKey.proposals["question:43"] = badKey.proposals["question:42"];
    delete badKey.proposals["question:42"];
    await expect(saveContentReplacementJob(badKey)).rejects.toThrow();

    const badRef = createPopulatedJob();
    badRef.proposals["question:42"].proposal.after.ref = { kind: "question", questionId: 43 };
    await expect(saveContentReplacementJob(badRef)).rejects.toThrow();

    const badChecksum = createPopulatedJob();
    badChecksum.proposals["question:42"].recovery!.scannedRequestChecksum = "f".repeat(64);
    await expect(saveContentReplacementJob(badChecksum)).rejects.toThrow();
  });

  it("rejects inventory cursors beyond the bounded server scan limit", async () => {
    installFakeIndexedDB();
    const job = createJob();
    job.inventoryQueue = [{ kind: "questions", page: 10_001 }];

    await expect(saveContentReplacementJob(job)).rejects.toThrow(
      "Stored content replacement job is invalid.",
    );
  });

  it("rejects proposal evidence that diverges from its configured rules or request models", async () => {
    installFakeIndexedDB();
    const badRule = createPopulatedJob();
    badRule.proposals["question:42"].proposal.changedOccurrences[0].ruleId = "not-configured";
    await expect(saveContentReplacementJob(badRule)).rejects.toThrow();

    const badReview = createPopulatedJob();
    badReview.proposals["question:42"].proposal.fields.body.afterMarkdown = "Different body";
    await expect(saveContentReplacementJob(badReview)).rejects.toThrow();
  });

  it("rejects well-formed fingerprints and request checksums that do not match canonical content", async () => {
    installFakeIndexedDB();
    const badFingerprint = createJob();
    badFingerprint.fingerprint = "f".repeat(64);
    await expect(saveContentReplacementJob(badFingerprint)).rejects.toThrow();

    const badRequestChecksum = createPopulatedJob();
    badRequestChecksum.proposals["question:42"].proposal.scannedRequestChecksum = "f".repeat(64);
    badRequestChecksum.proposals["question:42"].recovery!.scannedRequestChecksum = "f".repeat(64);
    await expect(saveContentReplacementJob(badRequestChecksum)).rejects.toThrow();
  });

  it("rejects corrupt records after load and rejects an entire corrupt list", async () => {
    const fake = installFakeIndexedDB();
    fake.records.set("replacement-job-1", { ...createJob(), status: "mystery" });
    await expect(loadContentReplacementJob("replacement-job-1")).rejects.toThrow(
      "Stored content replacement job is invalid.",
    );
    fake.records.set("valid-job", { ...createJob(), id: "valid-job" });
    await expect(listContentReplacementJobs()).rejects.toThrow("Stored content replacement job is invalid.");
  });

  it("fails predictably when IndexedDB is unavailable", async () => {
    vi.stubGlobal("indexedDB", undefined);
    await expect(loadContentReplacementJob("valid-id")).rejects.toThrow("Content replacement storage is unavailable.");
    await expect(listContentReplacementJobs()).rejects.toThrow("Content replacement storage is unavailable.");
    await expect(saveContentReplacementJob(createJob())).rejects.toThrow("Content replacement storage is unavailable.");
    await expect(deleteContentReplacementJob("valid-id")).rejects.toThrow("Content replacement storage is unavailable.");
  });

  it("rejects invalid IDs before opening storage", async () => {
    const open = vi.fn();
    vi.stubGlobal("indexedDB", { open });
    await expect(loadContentReplacementJob("__proto__")).rejects.toThrow("Content replacement job ID is invalid.");
    await expect(deleteContentReplacementJob("")).rejects.toThrow("Content replacement job ID is invalid.");
    expect(open).not.toHaveBeenCalled();
  });

  it("rejects open, blocked upgrade, request, and transaction failures with stable messages", async () => {
    const fake = installFakeIndexedDB();
    fake.nextOpenError = true;
    await expect(listContentReplacementJobs()).rejects.toThrow("Content replacement storage could not be opened.");
    fake.nextBlocked = true;
    await expect(listContentReplacementJobs()).rejects.toThrow("Content replacement storage upgrade was blocked.");
    fake.nextRequestError = true;
    await expect(loadContentReplacementJob("valid-id")).rejects.toThrow("Content replacement storage request failed.");
    fake.nextTransactionAbort = true;
    await expect(saveContentReplacementJob(createJob())).rejects.toThrow("Content replacement storage transaction aborted.");
    fake.nextTransactionError = true;
    await expect(deleteContentReplacementJob("valid-id")).rejects.toThrow("Content replacement storage transaction failed.");
  });

  it("rejects an object-store upgrade failure instead of leaving the open pending", async () => {
    const fake = installFakeIndexedDB();
    fake.nextUpgradeError = true;

    await expect(listContentReplacementJobs()).rejects.toThrow(
      "Content replacement storage could not be opened.",
    );
  });

  it("waits for readonly transaction completion and rejects a late abort", async () => {
    const fake = installFakeIndexedDB();
    fake.records.set("replacement-job-1", createJob());
    fake.nextTransactionAbort = true;

    await expect(loadContentReplacementJob("replacement-job-1")).rejects.toThrow(
      "Content replacement storage transaction aborted.",
    );
  });

  it("rejects cycles, accessors, sparse arrays, and prototype-pollution map keys without invoking getters", async () => {
    installFakeIndexedDB();
    const cyclic = createJob() as any;
    cyclic.loop = cyclic;
    await expect(saveContentReplacementJob(cyclic)).rejects.toThrow();

    const getter = vi.fn(() => "secret");
    const accessor = createJob() as any;
    Object.defineProperty(accessor, "accessToken", { enumerable: true, get: getter });
    await expect(saveContentReplacementJob(accessor)).rejects.toThrow();
    expect(getter).not.toHaveBeenCalled();

    const sparse = createJob();
    sparse.detailQueue = new Array(2);
    await expect(saveContentReplacementJob(sparse)).rejects.toThrow();

    const polluted = createJob();
    polluted.proposals = Object.create(null);
    Object.defineProperty(polluted.proposals, "constructor", {
      enumerable: true,
      value: createPopulatedJob().proposals["question:42"],
    });
    await expect(saveContentReplacementJob(polluted)).rejects.toThrow();
  });

  it("handles thousands of proposals with independent exact normalization", async () => {
    installFakeIndexedDB();
    const job = createPopulatedJob();
    const template = job.proposals["question:42"];
    job.proposals = {};
    for (let id = 1; id <= 2_000; id += 1) {
      const item = structuredClone(template);
      item.proposal.before.ref = { kind: "question", questionId: id };
      item.proposal.after.ref = { kind: "question", questionId: id };
      item.recovery!.priorRequestModel.ref = { kind: "question", questionId: id };
      job.proposals[`question:${id}`] = item;
    }
    job.progress.proposalsFound = 2_000;

    await saveContentReplacementJob(job);
    const loaded = await loadContentReplacementJob(job.id);

    expect(Object.keys(loaded!.proposals)).toHaveLength(2_000);
    expect(loaded!.proposals["question:2000"].proposal.before.ref).toEqual({
      kind: "question", questionId: 2_000,
    });
  });

  it("normalizes answer and article request-model unions including exact article permissions", async () => {
    installFakeIndexedDB();
    const job = createPopulatedJob();
    const answer = structuredClone(job.proposals["question:42"]);
    answer.proposal.before = {
      kind: "answer",
      ref: { kind: "answer", questionId: 10, answerId: 11 },
      request: { body: "Old body" },
    };
    answer.proposal.after = {
      kind: "answer",
      ref: { kind: "answer", questionId: 10, answerId: 11 },
      request: { body: "New body" },
    };
    answer.proposal.fields = {
      body: { beforeMarkdown: "Old body", afterMarkdown: "New body" },
    };
    answer.proposal.changedOccurrences[0].field = "body";
    answer.proposal.scannedRequestChecksum = ANSWER_BEFORE_CHECKSUM;
    answer.proposal.proposedRequestChecksum = ANSWER_AFTER_CHECKSUM;
    answer.recovery!.priorRequestModel = answer.proposal.before;
    answer.recovery!.scannedRequestChecksum = ANSWER_BEFORE_CHECKSUM;
    answer.recovery!.proposedRequestChecksum = ANSWER_AFTER_CHECKSUM;

    const article = structuredClone(job.proposals["question:42"]);
    const articleRequest = {
      title: "Old title",
      body: "Old body",
      tags: ["policy"],
      type: "policy" as const,
      expirationDate: null,
      permissions: {
        editableBy: "specificEditors" as const,
        editorUserIds: [1],
        editorUserGroupIds: [2],
      },
    };
    article.proposal.before = {
      kind: "article",
      ref: { kind: "article", articleId: 12 },
      request: articleRequest,
    };
    article.proposal.after = {
      kind: "article",
      ref: { kind: "article", articleId: 12 },
      request: { ...articleRequest, title: "New title" },
    };
    article.proposal.fields = {
      title: { beforeMarkdown: "Old title", afterMarkdown: "New title" },
      body: { beforeMarkdown: "Old body", afterMarkdown: "Old body" },
    };
    article.proposal.scannedRequestChecksum = ARTICLE_BEFORE_CHECKSUM;
    article.proposal.proposedRequestChecksum = ARTICLE_AFTER_CHECKSUM;
    article.recovery!.priorRequestModel = article.proposal.before;
    article.recovery!.scannedRequestChecksum = ARTICLE_BEFORE_CHECKSUM;
    article.recovery!.proposedRequestChecksum = ARTICLE_AFTER_CHECKSUM;
    job.proposals["answer:10:11"] = answer;
    job.proposals["article:12"] = article;
    job.progress.proposalsFound = 3;

    await saveContentReplacementJob(job);
    await expect(loadContentReplacementJob(job.id)).resolves.toEqual(job);

    (article.proposal.before.request as typeof articleRequest).permissions = {
      ...articleRequest.permissions,
      apiKey: "secret",
    } as typeof articleRequest.permissions;
    await expect(saveContentReplacementJob(job)).rejects.toThrow("Stored content replacement job is invalid.");
  });

  it.each([
    ["non-HTTPS root", (job: any) => { job.baseUrl = "http://example.stackenterprise.co"; }],
    ["non-Stack root", (job: any) => { job.baseUrl = "https://example.com"; }],
    ["non-normalized root", (job: any) => { job.baseUrl = "https://example.stackenterprise.co/path"; }],
    ["bad fingerprint", (job: any) => { job.fingerprint = "A".repeat(64); }],
    ["no rules", (job: any) => { job.configuration.rules = []; }],
    ["too many rules", (job: any) => { job.configuration.rules = Array.from({ length: 501 }, (_, index) => ({ id: `r${index}`, find: `f${index}`, replace: `x${index}` })); }],
    ["no selected types", (job: any) => { job.configuration.contentTypes = { questions: false, answers: false, articles: false }; }],
    ["unsafe counter", (job: any) => { job.progress.inventoryItems = Number.MAX_SAFE_INTEGER + 1; }],
    ["negative attempts", (job: any) => { job.proposals["question:42"].attemptCount = -1; }],
    ["bad detail ref", (job: any) => { job.detailQueue = [{ kind: "article", articleId: 0 }]; }],
    ["bad proposal digest", (job: any) => { job.proposals["question:42"].proposal.proposalFingerprint = "bad"; }],
    ["bad result digest", (job: any) => { job.proposals["question:42"].result.observedRequestChecksum = "bad"; }],
    ["bad timestamp", (job: any) => { job.updatedAt = "yesterday"; }],
    ["created after updated", (job: any) => { job.createdAt = "2026-09-02T12:00:00.000Z"; }],
    ["invalid result union", (job: any) => { job.proposals["question:42"].result.kind = "success"; }],
  ])("rejects invalid schema value: %s", async (_label, mutate) => {
    installFakeIndexedDB();
    const job = createPopulatedJob();
    mutate(job);
    await expect(saveContentReplacementJob(job)).rejects.toThrow("Stored content replacement job is invalid.");
  });
});

function createJob(): PersistedContentReplacementJob {
  return {
    schemaVersion: 1 as const,
    id: "replacement-job-1",
    fingerprint: JOB_FINGERPRINT,
    baseUrl: "https://example.stackenterprise.co",
    target: { kind: "enterprise-main" as const },
    configuration: {
      target: { kind: "enterprise-main" as const },
      contentTypes: { questions: true, answers: true, articles: true },
      rules: [{ id: "rule-1", find: "Old", replace: "New" }],
      options: { caseSensitive: true, wholeTerm: true, replaceInCode: false },
    },
    stage: "scan" as const,
    status: "paused" as const,
    inventoryQueue: [{ kind: "questions" as const, page: 1 }],
    detailQueue: [{ kind: "question" as const, questionId: 42 }],
    progress: {
      questionPages: 0,
      answerPages: 0,
      articlePages: 0,
      inventoryItems: 0,
      detailsInspected: 0,
      proposalsFound: 0,
      protectedOccurrences: 0,
      applyCompleted: 0,
      recoveryCompleted: 0,
    },
    proposals: {},
    recoverySnapshotStatus: "none",
    createdAt: "2026-09-01T12:00:00.000Z",
    updatedAt: "2026-09-01T12:00:00.000Z",
  };
}

function createPopulatedJob(): PersistedContentReplacementJob {
  const body = 'Documentation: {"authorization":"Bearer abc"}, accessToken, and apiKey.';
  const job = createJob();
  job.proposals["question:42"] = {
    proposal: {
      before: {
        kind: "question",
        ref: { kind: "question", questionId: 42 },
        request: { title: "Old authorization", body, tags: ["api"] },
        metadata: {
          titleContext: "A title",
          webUrl: "https://example.stackenterprise.co/q/42",
          owner: { id: 1, name: "Owner" },
          lastEditor: { id: 2 },
          lastActivityDate: null,
        },
      },
      after: {
        kind: "question",
        ref: { kind: "question", questionId: 42 },
        request: { title: "New authorization", body, tags: ["api"] },
        metadata: {
          titleContext: "A title",
          webUrl: "https://example.stackenterprise.co/q/42",
          owner: { id: 1, name: "Owner" },
          lastEditor: { id: 2 },
          lastActivityDate: null,
        },
      },
      scannedRequestChecksum: QUESTION_BEFORE_CHECKSUM,
      proposedRequestChecksum: QUESTION_AFTER_CHECKSUM,
      proposalFingerprint: "d".repeat(64),
      fields: {
        title: { beforeMarkdown: "Old authorization", afterMarkdown: "New authorization" },
        body: { beforeMarkdown: body, afterMarkdown: body },
      },
      changedOccurrences: [{
        field: "title", ruleId: "rule-1", start: 0, end: 3, before: "Old", after: "New",
      }],
      protectedOccurrences: [{
        field: "body", ruleId: "rule-1", start: 20, end: 23, before: "Old", reason: "code",
      }],
      appliedRuleIds: ["rule-1"],
      metadata: {
        titleContext: "A title",
        webUrl: "https://example.stackenterprise.co/q/42",
        owner: { id: 1, name: "Owner" },
        lastEditor: { id: 2 },
        lastActivityDate: null,
      },
    },
    included: true,
    attemptCount: 2,
    status: "applied",
    result: {
      kind: "applied",
      observedRequestChecksum: "e".repeat(64),
      completedAt: "2026-09-01T12:02:00.000Z",
    },
    failure: {
      category: "network",
      message: "A sanitized prior failure",
      retryable: true,
      statusCode: 503,
      occurredAt: "2026-09-01T12:01:00.000Z",
    },
    recovery: {
      priorRequestModel: {
        kind: "question",
        ref: { kind: "question", questionId: 42 },
        request: { title: "Old authorization", body, tags: ["api"] },
      },
      scannedRequestChecksum: QUESTION_BEFORE_CHECKSUM,
      proposedRequestChecksum: QUESTION_AFTER_CHECKSUM,
      observedPostApplyChecksum: "e".repeat(64),
      status: "ready",
    },
  };
  job.progress.proposalsFound = 1;
  return job;
}

function installFakeIndexedDB(): FakeIndexedDB {
  const fake = new FakeIndexedDB();
  vi.stubGlobal("indexedDB", { open: (name: string, version?: number) => fake.open(name, version) });
  return fake;
}

class FakeIndexedDB {
  readonly records = new Map<string, unknown>();
  readonly openCalls: Array<{ name: string; version?: number }> = [];
  readonly createdStores: Array<{ name: string; keyPath: string | string[] | null }> = [];
  hasStore = false;
  nextOpenError = false;
  nextBlocked = false;
  nextUpgradeError = false;
  nextRequestError = false;
  nextTransactionAbort = false;
  nextTransactionError = false;

  open(name: string, version?: number): IDBOpenDBRequest {
    this.openCalls.push({ name, version });
    const database = new FakeDatabase(this);
    const request = new FakeOpenRequest(database);
    request.transaction = {
      abort: () => request.fail(),
    } as IDBTransaction;
    queueMicrotask(() => {
      if (this.nextOpenError) {
        this.nextOpenError = false;
        request.fail();
        return;
      }
      if (this.nextBlocked) {
        this.nextBlocked = false;
        request.block();
        return;
      }
      if (!this.hasStore) request.upgrade();
      if (request.failed) return;
      request.succeed(database);
    });
    return request as unknown as IDBOpenDBRequest;
  }
}

class FakeDatabase {
  readonly objectStoreNames = { contains: (name: string) => name === "jobs" && this.owner.hasStore };

  constructor(private readonly owner: FakeIndexedDB) {}

  createObjectStore(name: string, options?: IDBObjectStoreParameters): IDBObjectStore {
    if (this.owner.nextUpgradeError) {
      this.owner.nextUpgradeError = false;
      throw new Error("upgrade failed");
    }
    this.owner.hasStore = true;
    this.owner.createdStores.push({ name, keyPath: options?.keyPath ?? null });
    return {} as IDBObjectStore;
  }

  transaction(): IDBTransaction {
    return new FakeTransaction(this.owner) as unknown as IDBTransaction;
  }

  close(): void {}
}

class FakeTransaction {
  error: DOMException | null = null;
  oncomplete: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;

  constructor(private readonly owner: FakeIndexedDB) {}

  objectStore(): IDBObjectStore {
    return new FakeObjectStore(this.owner, this) as unknown as IDBObjectStore;
  }

  finish(): void {
    queueMicrotask(() => {
      if (this.owner.nextTransactionAbort) {
        this.owner.nextTransactionAbort = false;
        this.onabort?.();
      } else if (this.owner.nextTransactionError) {
        this.owner.nextTransactionError = false;
        this.onerror?.();
      } else {
        this.oncomplete?.();
      }
    });
  }
}

class FakeObjectStore {
  constructor(private readonly owner: FakeIndexedDB, private readonly transaction: FakeTransaction) {}

  get(key: IDBValidKey): IDBRequest<unknown> {
    return this.request(() => this.owner.records.get(String(key)));
  }

  getAll(): IDBRequest<unknown[]> {
    return this.request(() => [...this.owner.records.values()]);
  }

  put(value: PersistedContentReplacementJob): IDBRequest<IDBValidKey> {
    return this.request<IDBValidKey>(() => {
      this.owner.records.set(value.id, value);
      return value.id;
    }, true);
  }

  delete(key: IDBValidKey): IDBRequest<undefined> {
    return this.request(() => {
      this.owner.records.delete(String(key));
      return undefined;
    }, true);
  }

  private request<T>(operation: () => T, _write = false): IDBRequest<T> {
    const request = new FakeRequest<T>();
    queueMicrotask(() => {
      if (this.owner.nextRequestError) {
        this.owner.nextRequestError = false;
        request.fail();
        return;
      }
      request.succeed(operation());
      this.transaction.finish();
    });
    return request as unknown as IDBRequest<T>;
  }
}

class FakeRequest<T> {
  result!: T;
  error: DOMException | null = null;
  onsuccess: (() => void) | null = null;
  onerror: (() => void) | null = null;

  succeed(result: T): void {
    this.result = result;
    this.onsuccess?.();
  }

  fail(): void {
    this.onerror?.();
  }
}

class FakeOpenRequest<T> extends FakeRequest<T> {
  onblocked: (() => void) | null = null;
  onupgradeneeded: (() => void) | null = null;
  transaction: IDBTransaction | null = null;
  failed = false;

  constructor(result: T) {
    super();
    this.result = result;
  }

  upgrade(): void { this.onupgradeneeded?.(); }
  block(): void { this.onblocked?.(); }
  override fail(): void {
    this.failed = true;
    super.fail();
  }
}
