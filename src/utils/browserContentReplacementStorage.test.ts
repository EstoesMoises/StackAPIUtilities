import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import {
  deleteContentReplacementJob,
  listContentReplacementJobs,
  loadContentReplacementJob,
  saveContentReplacementJob,
} from "./browserContentReplacementStorage";
import {
  buildReplacementProposal,
  checksumRequestModel,
  createJobFingerprint,
  toReplacementWireRequestModel,
} from "../writeTools/contentReplacement/proposals";
import { scanDetailBatch } from "../writeTools/contentReplacement/scanner";
import { reduceReplacementJob } from "../writeTools/contentReplacement/jobState";
import type { ContentReplacementClient } from "../writeTools/contentReplacement/contentApi";
import type {
  PersistedContentReplacementJob,
  ReplacementProposal,
  ReplacementRequestModel,
} from "../writeTools/contentReplacement/types";

const originalIndexedDB = globalThis.indexedDB;
const JOB_FINGERPRINT = "758cb96c6de3e89a529a6ea11728371ffe3d242c7d4bc56cf9c8f4a6a8aa1d05";
type JobStage = PersistedContentReplacementJob["stage"];
type JobStatus = PersistedContentReplacementJob["status"];
const ROOT_STAGE_STATUS_MATRIX = {
  define: ["idle"],
  scan: ["running", "paused", "completed", "failed", "cancelled"],
  review: ["completed", "paused", "cancelled"],
  apply: ["running", "paused", "completed", "failed", "cancelled"],
  results: ["completed", "failed"],
  recovery: ["running", "paused", "completed", "failed", "cancelled"],
} as const;
const ALL_ROOT_STATUSES = ["idle", "running", "paused", "completed", "failed", "cancelled"] as const;
const ROOT_STAGE_STATUS_ENTRIES = Object.entries(ROOT_STAGE_STATUS_MATRIX) as Array<
  [JobStage, readonly JobStatus[]]
>;
const ALLOWED_ROOT_STAGE_STATUS_CASES = ROOT_STAGE_STATUS_ENTRIES.flatMap(
  ([stage, statuses]) => statuses.map((status) => [`${stage}/${status}`, stage, status] as const),
);
const REJECTED_ROOT_STAGE_STATUS_CASES = ROOT_STAGE_STATUS_ENTRIES.flatMap(
  ([stage, statuses]) => ALL_ROOT_STATUSES
    .filter((status) => !(statuses as readonly string[]).includes(status))
    .map((status) => [`${stage}/${status}`, stage, status] as const),
);
let canonicalQuestionProposal: ReplacementProposal;

beforeAll(async () => {
  const proposal = await buildReplacementProposal(
    createQuestionBeforeModel(),
    createJob().configuration,
  );
  if (!proposal) throw new Error("Expected a canonical question proposal fixture.");
  canonicalQuestionProposal = proposal;
});

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

  it("persists successful apply evidence after explicitly deleting recovery snapshots", async () => {
    installFakeIndexedDB();
    const job = createAppliedJob();
    delete job.proposals["question:42"].recovery;
    job.recoverySnapshotStatus = "none";

    await saveContentReplacementJob(job);

    const loaded = await loadContentReplacementJob(job.id);
    expect(loaded?.proposals["question:42"].result).toEqual(
      job.proposals["question:42"].result,
    );
    expect(loaded?.proposals["question:42"].recovery).toBeUndefined();
  });

  it("persists a sanitized root failure for a focused stale-item rescan", async () => {
    installFakeIndexedDB();
    const job = createAppliedJob();
    const item = job.proposals["question:42"];
    item.status = "stale";
    item.result = { kind: "stale", completedAt: "2026-09-01T12:02:00.000Z" };
    delete item.recovery!.observedPostApplyChecksum;
    job.status = "failed";
    job.failure = createFailure();

    await saveContentReplacementJob(job);

    await expect(loadContentReplacementJob(job.id)).resolves.toEqual(job);
  });

  it("persists an exact recovery preview bound to the observed post-apply generation", async () => {
    installFakeIndexedDB();
    const job = createPopulatedJob() as any;
    const item = job.proposals["question:42"];
    item.failure = undefined;
    delete item.failure;
    item.result.observedRequestChecksum = item.proposal.proposedRequestChecksum;
    item.recovery.observedPostApplyChecksum = item.proposal.proposedRequestChecksum;
    item.recovery.preview = {
      status: "recoverable",
      currentRequestModel: toReplacementWireRequestModel(item.proposal.after),
      observedCurrentChecksum: item.proposal.proposedRequestChecksum,
      expectedPostApplyChecksum: item.proposal.proposedRequestChecksum,
      sourceAttemptCount: item.attemptCount,
      sourceApplyCompletedAt: item.result.completedAt,
      previewedAt: "2026-09-01T12:03:00.000Z",
    };
    item.status = "ready-to-recover";
    job.stage = "recovery";
    job.status = "paused";

    await saveContentReplacementJob(job);

    await expect(loadContentReplacementJob(job.id)).resolves.toEqual(job);
  });

  it("rejects recovery previews with fabricated checksums, status, generation, or unknown keys", async () => {
    installFakeIndexedDB();
    const createPreviewJob = () => {
      const job = createPopulatedJob() as any;
      const item = job.proposals["question:42"];
      delete item.failure;
      item.result.observedRequestChecksum = item.proposal.proposedRequestChecksum;
      item.recovery.observedPostApplyChecksum = item.proposal.proposedRequestChecksum;
      item.recovery.preview = {
        status: "recoverable",
        currentRequestModel: toReplacementWireRequestModel(item.proposal.after),
        observedCurrentChecksum: item.proposal.proposedRequestChecksum,
        expectedPostApplyChecksum: item.proposal.proposedRequestChecksum,
        sourceAttemptCount: item.attemptCount,
        sourceApplyCompletedAt: item.result.completedAt,
        previewedAt: "2026-09-01T12:03:00.000Z",
      };
      item.status = "ready-to-recover";
      job.stage = "recovery";
      return job;
    };
    for (const mutate of [
      (job: any) => { job.proposals["question:42"].recovery.preview.observedCurrentChecksum = "f".repeat(64); },
      (job: any) => { job.proposals["question:42"].recovery.preview.status = "already-recovered"; },
      (job: any) => { job.proposals["question:42"].recovery.preview.expectedPostApplyChecksum = "f".repeat(64); },
      (job: any) => { job.proposals["question:42"].recovery.preview.sourceAttemptCount -= 1; },
      (job: any) => { job.proposals["question:42"].recovery.preview.sourceApplyCompletedAt = "2026-09-01T12:01:00.000Z"; },
      (job: any) => { job.proposals["question:42"].recovery.preview.previewedAt = "2026-09-01T12:01:00.000Z"; },
      (job: any) => { job.proposals["question:42"].recovery.preview.previewedAt = "2026-09-01T12:05:00.000Z"; },
      (job: any) => { job.proposals["question:42"].recovery.preview.currentRequestModel.metadata = { titleContext: "fabricated" }; },
      (job: any) => { job.proposals["question:42"].recovery.preview.apiKey = "secret"; },
    ]) {
      const job = createPreviewJob();
      mutate(job);
      await expect(saveContentReplacementJob(job)).rejects.toThrow(
        "Stored content replacement job is invalid.",
      );
    }
  });

  it("persists already-recovered and conflict preview discriminants derived from canonical checksums", async () => {
    installFakeIndexedDB();
    const alreadyRecovered = createAppliedJob() as any;
    const recoveredItem = alreadyRecovered.proposals["question:42"];
    recoveredItem.status = "ready-to-recover";
    recoveredItem.recovery.preview = {
      status: "already-recovered",
      currentRequestModel: toReplacementWireRequestModel(recoveredItem.proposal.before),
      observedCurrentChecksum: recoveredItem.proposal.scannedRequestChecksum,
      expectedPostApplyChecksum: recoveredItem.proposal.proposedRequestChecksum,
      sourceAttemptCount: recoveredItem.attemptCount,
      sourceApplyCompletedAt: recoveredItem.result.completedAt,
      previewedAt: "2026-09-01T12:03:00.000Z",
    };
    alreadyRecovered.stage = "recovery";
    alreadyRecovered.status = "paused";
    await expect(saveContentReplacementJob(alreadyRecovered)).resolves.toBeUndefined();

    const conflict = createAppliedJob() as any;
    const conflictItem = conflict.proposals["question:42"];
    const current = toReplacementWireRequestModel(conflictItem.proposal.before);
    if (current.kind !== "question") throw new Error("Expected question fixture.");
    current.request.title = "Changed after apply";
    const observedCurrentChecksum = await checksumRequestModel(current);
    conflictItem.status = "ready-to-recover";
    conflictItem.recovery.preview = {
      status: "conflict",
      currentRequestModel: current,
      observedCurrentChecksum,
      expectedPostApplyChecksum: conflictItem.proposal.proposedRequestChecksum,
      sourceAttemptCount: conflictItem.attemptCount,
      sourceApplyCompletedAt: conflictItem.result.completedAt,
      previewedAt: "2026-09-01T12:03:00.000Z",
    };
    conflict.stage = "recovery";
    conflict.status = "paused";
    await expect(saveContentReplacementJob(conflict)).resolves.toBeUndefined();
  });

  it("preserves exact canonical metadata in recovery review evidence", async () => {
    installFakeIndexedDB();
    const job = createPopulatedJob();
    job.proposals["question:42"].recovery!.priorRequestModel = structuredClone(
      job.proposals["question:42"].proposal.before,
    );

    await saveContentReplacementJob(job);

    expect((await loadContentReplacementJob(job.id))!.proposals["question:42"].recovery)
      .toEqual(job.proposals["question:42"].recovery);
  });

  it("persists aggregate protected occurrences from a protected-only scanned detail", async () => {
    installFakeIndexedDB();
    const job = createJob();
    const detail = await scanDetailBatch({
      getItem: async () => ({
        kind: "question" as const,
        ref: { kind: "question" as const, questionId: 42 },
        request: { title: "Safe", body: "`Old`", tags: ["api"] },
      }),
    } as unknown as ContentReplacementClient, {
      refs: [{ kind: "question", questionId: 42 }],
      configuration: job.configuration,
    });
    expect(detail).toMatchObject({
      proposals: [],
      inspectedCount: 1,
      protectedOccurrenceCount: 1,
    });
    job.stage = "review";
    job.status = "completed";
    job.inventoryQueue = [];
    job.detailQueue = [];
    job.progress.questionPages = 1;
    job.progress.inventoryItems = 1;
    job.progress.detailsInspected = detail.inspectedCount;
    job.progress.proposalsFound = detail.proposals.length;
    job.progress.protectedOccurrences = detail.protectedOccurrenceCount;

    await saveContentReplacementJob(job);

    await expect(loadContentReplacementJob(job.id)).resolves.toEqual(job);
  });

  it("persists a 100,001 protected-only aggregate without proposal occurrence objects", async () => {
    installFakeIndexedDB();
    const job = createJob();
    job.stage = "review";
    job.status = "completed";
    job.inventoryQueue = [];
    job.detailQueue = [];
    job.progress.questionPages = 1;
    job.progress.inventoryItems = 1;
    job.progress.detailsInspected = 1;
    job.progress.protectedOccurrences = 100_001;

    await saveContentReplacementJob(job);

    await expect(loadContentReplacementJob(job.id)).resolves.toEqual(job);
    expect(job.proposals).toEqual({});
  });

  it.each([
    ["authorization", false, 403],
    ["validation", false, 422],
    ["network", true, 503],
  ] as const)("persists a retryable or terminal %s recovery-operation failure", async (
    category,
    retryable,
    statusCode,
  ) => {
    installFakeIndexedDB();
    const job = createRecoveryFailedJob({ category, retryable, statusCode });

    await saveContentReplacementJob(job);

    await expect(loadContentReplacementJob(job.id)).resolves.toEqual(job);
  });

  it("persists recovered and recovery-conflict outcomes without overwriting apply evidence", async () => {
    installFakeIndexedDB();
    for (const outcome of ["recovered", "conflict"] as const) {
      const job = createRecoveryTerminalJob(outcome);

      await saveContentReplacementJob(job);
      const loaded = await loadContentReplacementJob(job.id);

      expect(loaded).toEqual(job);
      expect(loaded!.proposals["question:42"].result?.kind).toBe("applied");
      expect(loaded!.proposals["question:42"].recovery?.result?.kind).toBe(outcome);
    }
  });

  it("rejects a successful recovery claim with divergent post-PUT readback evidence", async () => {
    installFakeIndexedDB();
    const job = createRecoveryTerminalJob("recovered");
    const item = job.proposals["question:42"];
    const observed = structuredClone(item.proposal.before);
    if (observed.kind !== "question") throw new Error("Expected question fixture.");
    observed.request.tags = ["api", "observed-after-put"];
    const observedReadbackChecksum = await checksumRequestModel(observed);
    if (
      observedReadbackChecksum === item.recovery!.scannedRequestChecksum ||
      observedReadbackChecksum === item.recovery!.observedPostApplyChecksum
    ) throw new Error("Expected a divergent observed readback checksum fixture.");
    item.recovery!.result!.observedRequestChecksum = observedReadbackChecksum;

    await expect(saveContentReplacementJob(job)).rejects.toThrow(
      "Stored content replacement job is invalid.",
    );
  });

  it("persists divergent recovery readback as explicit verification evidence", async () => {
    installFakeIndexedDB();
    const job = createRecoveryTerminalJob("conflict");
    const recovery = job.proposals["question:42"].recovery!;
    recovery.result = {
      ...recovery.result!,
      kind: "verification-failed",
      expectedRequestChecksum: recovery.scannedRequestChecksum,
    };

    await saveContentReplacementJob(job);

    await expect(loadContentReplacementJob(job.id)).resolves.toEqual(job);
  });

  it("persists recovery verification failure when the PUT readback still equals the post-apply checksum", async () => {
    installFakeIndexedDB();
    const job = createRecoveryTerminalJob("conflict");
    const recovery = job.proposals["question:42"].recovery!;
    recovery.result = {
      ...recovery.result!,
      kind: "verification-failed",
      expectedRequestChecksum: recovery.scannedRequestChecksum,
      observedRequestChecksum: recovery.observedPostApplyChecksum!,
    };

    await saveContentReplacementJob(job);

    await expect(loadContentReplacementJob(job.id)).resolves.toEqual(job);
  });

  it("round-trips Task 9 divergent recovery evidence through reducer and storage", async () => {
    installFakeIndexedDB();
    const at = "2026-09-01T12:04:00.000Z";
    let job = createApplyReadyJob();
    const itemKey = "question:42";
    const proposal = job.proposals[itemKey].proposal;
    job = reduceReplacementJob(job, { type: "apply/start", at });
    job = reduceReplacementJob(job, { type: "apply/item-started", itemKey, at });
    job = reduceReplacementJob(job, {
      type: "apply/item-finished", itemKey,
      result: { status: "updated", observedRequestChecksum: proposal.proposedRequestChecksum }, at,
    });
    job = reduceReplacementJob(job, {
      type: "recovery/preview-finished", itemKey,
      result: {
        status: "recoverable",
        currentRequestModel: toReplacementWireRequestModel(proposal.after),
        observedRequestChecksum: proposal.proposedRequestChecksum,
      }, at,
    });
    job = reduceReplacementJob(job, { type: "recovery/start", itemKeys: [itemKey], at });
    job = reduceReplacementJob(job, { type: "recovery/item-started", itemKey, at });
    job = reduceReplacementJob(job, {
      type: "recovery/item-finished", itemKey,
      result: { status: "recovered", observedRequestChecksum: proposal.proposedRequestChecksum }, at,
    });

    await saveContentReplacementJob(job);
    const loaded = await loadContentReplacementJob(job.id);

    expect(loaded).toEqual(job);
    expect(loaded!.proposals[itemKey]).toMatchObject({
      status: "recovery-conflict",
      result: { kind: "applied", observedRequestChecksum: proposal.proposedRequestChecksum },
      recovery: {
        result: {
          kind: "verification-failed",
          expectedRequestChecksum: proposal.scannedRequestChecksum,
          observedRequestChecksum: proposal.proposedRequestChecksum,
        },
      },
    });
  });

  it.each([
    ["empty remaining suffix", []],
    ["reordered remaining suffix", ["question:44", "question:43", "question:42"]],
    ["skipped remaining suffix", ["question:42", "question:44"]],
    ["duplicated remaining suffix", ["question:42", "question:42", "question:43", "question:44"]],
  ] as const)("rejects active operation with %s", async (_label, remainingItemKeys) => {
    installFakeIndexedDB();
    const job = await createActiveRecoveryOperationJob();
    job.activeOperation!.remainingItemKeys = [...remainingItemKeys];

    await expect(saveContentReplacementJob(job)).rejects.toThrow(
      "Stored content replacement job is invalid.",
    );
  });

  it("rejects stale-rescan evidence for a key that is still unfinished", async () => {
    installFakeIndexedDB();
    const job = await createActiveRecoveryOperationJob();
    for (const item of Object.values(job.proposals)) {
      item.status = "stale";
      item.result = { kind: "stale", completedAt: job.updatedAt };
      delete item.failure;
      item.recovery = {
        priorRequestModel: structuredClone(item.proposal.before),
        scannedRequestChecksum: item.proposal.scannedRequestChecksum,
        proposedRequestChecksum: item.proposal.proposedRequestChecksum,
        status: "ready",
      };
    }
    job.stage = "results";
    job.status = "running";
    job.activeOperation = {
      kind: "stale-rescan",
      requestedItemKeys: ["question:42", "question:43", "question:44"],
      remainingItemKeys: ["question:44"],
      completedItemKeys: ["question:42", "question:43"],
      generation: job.updatedAt,
      proposals: { "question:44": job.proposals["question:44"].proposal },
      inspectedCount: 2,
      protectedOccurrenceCount: 0,
    };

    await expect(saveContentReplacementJob(job)).rejects.toThrow(
      "Stored content replacement job is invalid.",
    );
  });

  it("persists an exact active-operation suffix and consumed stale-rescan prefix", async () => {
    installFakeIndexedDB();
    const job = await createActiveRecoveryOperationJob();
    for (const item of Object.values(job.proposals)) {
      item.status = "stale";
      item.result = { kind: "stale", completedAt: job.updatedAt };
      item.recovery = {
        priorRequestModel: structuredClone(item.proposal.before),
        scannedRequestChecksum: item.proposal.scannedRequestChecksum,
        proposedRequestChecksum: item.proposal.proposedRequestChecksum,
        status: "ready",
      };
    }
    job.stage = "results";
    job.status = "running";
    job.activeOperation = {
      kind: "stale-rescan",
      requestedItemKeys: ["question:42", "question:43", "question:44"],
      remainingItemKeys: ["question:44"],
      completedItemKeys: ["question:42", "question:43"],
      generation: job.updatedAt,
      proposals: { "question:42": job.proposals["question:42"].proposal },
      inspectedCount: 2,
      protectedOccurrenceCount: 0,
    };

    await saveContentReplacementJob(job);

    await expect(loadContentReplacementJob(job.id)).resolves.toEqual(job);
  });

  it("persists divergent apply readback as explicit nonretryable verification evidence", async () => {
    installFakeIndexedDB();
    const job = createApplyReadyJob();
    const item = job.proposals["question:42"];
    const observed = "f".repeat(64);
    job.stage = "results";
    job.status = "completed";
    job.progress.applyCompleted = 1;
    item.status = "failed";
    item.attemptCount = 1;
    item.failure = {
      category: "validation", message: "Apply evidence did not match the reviewed proposal.",
      retryable: false, occurredAt: job.updatedAt,
    };
    item.result = {
      kind: "verification-failed", expectedRequestChecksum: item.proposal.proposedRequestChecksum,
      observedRequestChecksum: observed, completedAt: job.updatedAt,
    };

    await saveContentReplacementJob(job);

    await expect(loadContentReplacementJob(job.id)).resolves.toEqual(job);
  });

  it.each([
    ["missing successful apply result", (job: any) => { delete job.proposals["question:42"].result; }],
    ["mismatched apply checksum", (job: any) => { job.proposals["question:42"].result.observedRequestChecksum = "f".repeat(64); }],
    ["nonfailed recovery record", (job: any) => { job.proposals["question:42"].recovery.status = "ready"; }],
    ["missing recovery failure", (job: any) => { delete job.proposals["question:42"].failure; }],
    ["recovery failure predates apply", (job: any) => {
      job.proposals["question:42"].failure.occurredAt = "2026-09-01T12:01:00.000Z";
    }],
    ["apply-stage recovery failure", (job: any) => { job.stage = "apply"; }],
    ["terminal recovery result on retryable failure", (job: any) => {
      job.proposals["question:42"].recovery.result = {
        kind: "recovered",
        observedRequestChecksum: job.proposals["question:42"].recovery.scannedRequestChecksum,
        completedAt: job.updatedAt,
      };
    }],
  ])("rejects cross-operation recovery failure contradiction: %s", async (_label, mutate) => {
    installFakeIndexedDB();
    const job = createRecoveryFailedJob({ category: "network", retryable: true, statusCode: 503 });
    mutate(job);

    await expect(saveContentReplacementJob(job)).rejects.toThrow(
      "Stored content replacement job is invalid.",
    );
  });

  it.each(["recovered", "conflict"] as const)(
    "rejects a %s recovery outcome that predates the retained apply result",
    async (outcome) => {
      installFakeIndexedDB();
      const job = createRecoveryTerminalJob(outcome);
      job.proposals["question:42"].recovery!.result!.completedAt =
        "2026-09-01T12:01:00.000Z";

      await expect(saveContentReplacementJob(job)).rejects.toThrow(
        "Stored content replacement job is invalid.",
      );
    },
  );

  it.each([
    ["source attempt", (job: any) => { job.proposals["question:42"].recovery.result.sourceAttemptCount -= 1; }],
    ["source apply timestamp", (job: any) => { job.proposals["question:42"].recovery.result.sourceApplyCompletedAt = "2026-09-01T12:01:00.000Z"; }],
    ["prior checksum input", (job: any) => { job.proposals["question:42"].recovery.scannedRequestChecksum = "e".repeat(64); }],
    ["prior request input", (job: any) => { job.proposals["question:42"].recovery.priorRequestModel.request.title = "Spoofed prior"; }],
    ["observed post-apply input", (job: any) => { job.proposals["question:42"].recovery.observedPostApplyChecksum = "e".repeat(64); }],
  ])("rejects a recovered outcome with spoofed %s evidence", async (_label, mutate) => {
    installFakeIndexedDB();
    const job = createRecoveryTerminalJob("recovered");
    mutate(job);

    await expect(saveContentReplacementJob(job)).rejects.toThrow(
      "Stored content replacement job is invalid.",
    );
  });

  it("rejects recovery review metadata that diverges from the canonical proposal", async () => {
    installFakeIndexedDB();
    const job = createPopulatedJob();
    const prior = job.proposals["question:42"].recovery!.priorRequestModel;
    if (!prior.metadata?.owner) throw new Error("Expected owner metadata fixture.");
    prior.metadata.owner.name = "Different owner";

    await expect(saveContentReplacementJob(job)).rejects.toThrow(
      "Stored content replacement job is invalid.",
    );
  });

  it("persists proposal, result, and recovery records without inspecting content strings", async () => {
    installFakeIndexedDB();
    const body = 'Documentation: {"authorization":"Bearer abc"}, accessToken, and apiKey.';
    const job = createPopulatedJob();

    await saveContentReplacementJob(job);

    const loaded = await loadContentReplacementJob(job.id);
    expect(loaded).toEqual(job);
    expect(loaded?.proposals["question:42"].proposal.before.request.body).toBe(body);
  });

  it("persists a sanitized item failure without response extras", async () => {
    installFakeIndexedDB();
    const job = createPopulatedJob();
    const item = job.proposals["question:42"];
    item.status = "failed";
    item.result = undefined;
    delete item.result;
    item.failure = createFailure();
    delete item.recovery!.observedPostApplyChecksum;

    await saveContentReplacementJob(job);

    expect((await loadContentReplacementJob(job.id))!.proposals["question:42"].failure)
      .toEqual(createFailure());
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
    ["protected occurrence", (job: any) => { job.proposals["question:42"].proposal.protectedOccurrences.push({ field: "body", ruleId: "rule-1", start: 0, end: 3, before: "Old", reason: "code", apiKey: "secret" }); }],
    ["result", (job: any) => { job.proposals["question:42"].result.apiKey = "secret"; }],
    ["failure", (job: any) => { job.proposals["question:42"].failure = { ...createFailure(), apiKey: "secret" }; }],
    ["recovery", (job: any) => { job.proposals["question:42"].recovery.apiKey = "secret"; }],
    ["recovery result", (job: any) => { job.proposals["question:42"].recovery.result = { kind: "recovered", observedRequestChecksum: job.proposals["question:42"].proposal.scannedRequestChecksum, completedAt: job.updatedAt, apiKey: "secret" }; }],
    ["recovery request", (job: any) => { job.proposals["question:42"].recovery.priorRequestModel.request.apiKey = "secret"; }],
    ["progress", (job: any) => { job.progress.apiKey = "secret"; }],
    ["cursor", (job: any) => { job.inventoryQueue = [{ kind: "questions", page: 1, apiKey: "secret" }]; }],
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

  it("rejects fabricated but internally shaped proposal evidence", async () => {
    installFakeIndexedDB();
    const badFingerprint = createPopulatedJob();
    badFingerprint.proposals["question:42"].proposal.proposalFingerprint = "f".repeat(64);
    await expect(saveContentReplacementJob(badFingerprint)).rejects.toThrow(
      "Stored content replacement job is invalid.",
    );

    const badOffset = createPopulatedJob();
    badOffset.proposals["question:42"].proposal.changedOccurrences[0].start = 1;
    await expect(saveContentReplacementJob(badOffset)).rejects.toThrow(
      "Stored content replacement job is invalid.",
    );
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

  it("rejects huge arrays and deeply nested graphs with stable errors and no proportional array allocation", async () => {
    installFakeIndexedDB();
    const huge = createJob();
    huge.detailQueue = new Array(0xffffffff);
    const originalArrayFrom = Array.from;
    const arrayFrom = vi.spyOn(Array, "from").mockImplementation(((value: ArrayLike<unknown>) => {
      if (value.length === 0xffffffff) throw new Error("proportional allocation attempted");
      return originalArrayFrom(value);
    }) as typeof Array.from);
    let hugeError: unknown;
    try {
      await saveContentReplacementJob(huge);
    } catch (error) {
      hugeError = error;
    } finally {
      arrayFrom.mockRestore();
    }
    expect(hugeError).toEqual(new TypeError("Stored content replacement job is invalid."));

    const deep = createJob() as any;
    let cursor = deep;
    for (let depth = 0; depth < 20_000; depth += 1) {
      cursor.extra = {};
      cursor = cursor.extra;
    }
    await expect(saveContentReplacementJob(deep)).rejects.toThrow(
      "Stored content replacement job is invalid.",
    );
  });

  it("enforces a graph node budget and rejects sparse, symbol, and accessor shapes with stable errors", async () => {
    installFakeIndexedDB();
    const overBudget = createJob() as any;
    overBudget.extra = Array.from({ length: 100_000 }, () => ({ nested: {} }));
    const beyondBudgetPrototypeRead = vi.fn(() => Object.prototype);
    overBudget.extra[99_999].nested = new Proxy({}, {
      getPrototypeOf: beyondBudgetPrototypeRead,
    });
    await expect(saveContentReplacementJob(overBudget)).rejects.toThrow(
      "Stored content replacement job is invalid.",
    );
    expect(beyondBudgetPrototypeRead).not.toHaveBeenCalled();

    const symbol = createJob() as any;
    symbol[Symbol("secret")] = "value";
    await expect(saveContentReplacementJob(symbol)).rejects.toThrow(
      "Stored content replacement job is invalid.",
    );

    const sparse = createJob();
    sparse.inventoryQueue = new Array(3);
    sparse.inventoryQueue[2] = { kind: "questions", page: 1 };
    await expect(saveContentReplacementJob(sparse)).rejects.toThrow(
      "Stored content replacement job is invalid.",
    );

    const getter = vi.fn();
    const accessor = createJob() as any;
    Object.defineProperty(accessor.configuration, "authorization", {
      enumerable: true,
      get: getter,
    });
    await expect(saveContentReplacementJob(accessor)).rejects.toThrow(
      "Stored content replacement job is invalid.",
    );
    expect(getter).not.toHaveBeenCalled();
  });

  it("bounds total descriptor inspection across many maximum-key proxy objects", async () => {
    installFakeIndexedDB();
    const job = createJob() as any;
    const keys = Array.from({ length: 100_000 }, (_, index) => `key${index}`);
    let descriptorCalls = 0;
    const maximumKeyProxy = () => new Proxy({}, {
      ownKeys: () => keys,
      getOwnPropertyDescriptor: () => {
        descriptorCalls += 1;
        return { value: null, enumerable: true, configurable: true, writable: true };
      },
    });
    job.extra = [maximumKeyProxy(), maximumKeyProxy(), maximumKeyProxy(), maximumKeyProxy()];

    await expect(saveContentReplacementJob(job)).rejects.toEqual(
      new TypeError("Stored content replacement job is invalid."),
    );
    expect(descriptorCalls).toBeLessThan(250_000);
  });

  it("rejects an oversized per-object key set before any per-key descriptor calls", async () => {
    installFakeIndexedDB();
    const job = createJob() as any;
    const keys = Array.from({ length: 100_001 }, (_, index) => `key${index}`);
    let descriptorCalls = 0;
    job.extra = new Proxy({}, {
      ownKeys: () => keys,
      getOwnPropertyDescriptor: () => {
        descriptorCalls += 1;
        return { value: null, enumerable: true, configurable: true, writable: true };
      },
    });

    await expect(saveContentReplacementJob(job)).rejects.toEqual(
      new TypeError("Stored content replacement job is invalid."),
    );
    expect(descriptorCalls).toBe(0);
  });

  it("normalizes only descriptor-cloned data without invoking root or nested proxy get traps", async () => {
    const fake = installFakeIndexedDB();
    const rootGet = vi.fn(() => { throw new Error("root get trap must not run"); });
    const rootProxy = new Proxy(createJob(), { get: rootGet });

    await saveContentReplacementJob(rootProxy);
    expect(rootGet).not.toHaveBeenCalled();

    const nestedJob = createJob();
    const nestedGet = vi.fn(() => { throw new Error("nested get trap must not run"); });
    nestedJob.configuration = new Proxy(nestedJob.configuration, { get: nestedGet });
    fake.records.set(nestedJob.id, nestedJob);

    await expect(loadContentReplacementJob(nestedJob.id)).resolves.toEqual(createJob());
    expect(nestedGet).not.toHaveBeenCalled();
  });

  it("contains descriptor trap failures behind the stable content-free corruption error", async () => {
    installFakeIndexedDB();
    const hostile = new Proxy(createJob(), {
      ownKeys: () => { throw new Error("sensitive descriptor failure"); },
    });

    await expect(saveContentReplacementJob(hostile)).rejects.toEqual(
      new TypeError("Stored content replacement job is invalid."),
    );
  });

  it("handles thousands of genuinely canonical proposals with bounded validation", async () => {
    installFakeIndexedDB();
    const job = createJob();
    job.stage = "review";
    job.status = "completed";
    job.inventoryQueue = [];
    job.detailQueue = [];
    for (let id = 1; id <= 2_000; id += 1) {
      const before = createQuestionBeforeModel();
      before.ref = { kind: "question", questionId: id };
      if (before.metadata) before.metadata.webUrl = `https://example.stackenterprise.co/q/${id}`;
      const proposal = await buildReplacementProposal(before, job.configuration);
      if (!proposal) throw new Error("Expected canonical proposal fixture.");
      job.proposals[`question:${id}`] = {
        proposal,
        included: true,
        attemptCount: 0,
        status: "pending",
      };
    }
    job.progress.questionPages = 20;
    job.progress.inventoryItems = 2_000;
    job.progress.detailsInspected = 2_000;
    job.progress.proposalsFound = 2_000;
    job.progress.protectedOccurrences = 0;

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
    const answerBefore: ReplacementRequestModel = {
      kind: "answer",
      ref: { kind: "answer", questionId: 10, answerId: 11 },
      request: { body: "Old body" },
    };
    const answerProposal = await buildReplacementProposal(answerBefore, job.configuration);
    if (!answerProposal) throw new Error("Expected answer proposal.");
    answer.proposal = answerProposal;
    answer.recovery!.priorRequestModel = answer.proposal.before;
    answer.recovery!.scannedRequestChecksum = answer.proposal.scannedRequestChecksum;
    answer.recovery!.proposedRequestChecksum = answer.proposal.proposedRequestChecksum;
    answer.recovery!.observedPostApplyChecksum = answer.proposal.proposedRequestChecksum;
    if (answer.result?.kind === "applied") {
      answer.result.observedRequestChecksum = answer.proposal.proposedRequestChecksum;
    }

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
    const articleBefore: ReplacementRequestModel = {
      kind: "article",
      ref: { kind: "article", articleId: 12 },
      request: articleRequest,
    };
    const articleProposal = await buildReplacementProposal(articleBefore, job.configuration);
    if (!articleProposal) throw new Error("Expected article proposal.");
    article.proposal = articleProposal;
    article.recovery!.priorRequestModel = article.proposal.before;
    article.recovery!.scannedRequestChecksum = article.proposal.scannedRequestChecksum;
    article.recovery!.proposedRequestChecksum = article.proposal.proposedRequestChecksum;
    article.recovery!.observedPostApplyChecksum = article.proposal.proposedRequestChecksum;
    if (article.result?.kind === "applied") {
      article.result.observedRequestChecksum = article.proposal.proposedRequestChecksum;
    }
    job.proposals["answer:10:11"] = answer;
    job.proposals["article:12"] = article;
    job.progress.inventoryItems = 3;
    job.progress.detailsInspected = 3;
    job.progress.proposalsFound = 3;
    job.progress.protectedOccurrences = Object.values(job.proposals).reduce(
      (countValue, item) => countValue + item.proposal.protectedOccurrences.length,
      0,
    );
    job.progress.applyCompleted = 3;

    await saveContentReplacementJob(job);
    await expect(loadContentReplacementJob(job.id)).resolves.toEqual(job);

    (article.proposal.before.request as typeof articleRequest).permissions = {
      ...articleRequest.permissions,
      apiKey: "secret",
    } as typeof articleRequest.permissions;
    await expect(saveContentReplacementJob(job)).rejects.toThrow("Stored content replacement job is invalid.");
  });

  it("canonicalizes and accepts the allowlisted apex and subdomain origins", async () => {
    installFakeIndexedDB();
    for (const input of ["https://STACKENTERPRISE.CO/", "https://DEMO.stackenterprise.co/"]) {
      const job = createJob();
      job.baseUrl = input;
      const normalizedBaseUrl = new URL(input).origin;
      job.fingerprint = await createJobFingerprint({
        baseUrl: normalizedBaseUrl,
        configuration: job.configuration,
      });

      await saveContentReplacementJob(job);
      const loaded = await loadContentReplacementJob(job.id);

      expect(loaded!.baseUrl).toBe(normalizedBaseUrl);
    }
  });

  it.each([
    "http://stackenterprise.co",
    "https://stackenterprise.co.evil.example",
    "https://stackenterprise.co/path",
    "https://user:password@stackenterprise.co",
    "https://stackenterprise.co?proxy=1",
    "https://stackenterprise.co#fragment",
  ])("rejects a base URL outside the shared write-target allowlist: %s", async (baseUrl) => {
    installFakeIndexedDB();
    const job = createJob();
    job.baseUrl = baseUrl;
    job.fingerprint = await createJobFingerprint({ baseUrl, configuration: job.configuration });
    await expect(saveContentReplacementJob(job)).rejects.toThrow(
      "Stored content replacement job is invalid.",
    );
  });

  it("accepts legitimate persisted states across scan, review, apply, results, and recovery", async () => {
    installFakeIndexedDB();
    const fixtures = createValidStateFixtures();
    for (const job of fixtures) {
      try {
        await saveContentReplacementJob(job);
      } catch {
        throw new Error(`Valid ${job.stage} fixture was rejected.`);
      }
    }
  });

  it("accepts reducer-compatible intermediate running, paused, retry, and failed states", async () => {
    installFakeIndexedDB();
    const applyPreparing = createReviewJob();
    applyPreparing.stage = "apply";
    applyPreparing.status = "running";
    applyPreparing.recoverySnapshotStatus = "preparing";

    const applying = createApplyReadyJob();
    applying.status = "running";
    applying.proposals["question:42"].status = "applying";
    applying.proposals["question:42"].attemptCount = 1;

    const retryReady = createApplyReadyJob();
    retryReady.proposals["question:42"].attemptCount = 1;

    const applyPreparedBeforeGateFlip = createApplyReadyJob();
    applyPreparedBeforeGateFlip.status = "running";
    applyPreparedBeforeGateFlip.recoverySnapshotStatus = "preparing";

    const snapshotFailed = createReviewJob();
    snapshotFailed.stage = "apply";
    snapshotFailed.status = "failed";
    snapshotFailed.failure = createFailure();
    snapshotFailed.recoverySnapshotStatus = "failed";

    const recovering = createAppliedJob();
    recovering.stage = "recovery";
    recovering.status = "running";
    recovering.proposals["question:42"].status = "recovering";

    const failedScan = createJob();
    failedScan.status = "failed";
    failedScan.failure = createFailure();
    failedScan.updatedAt = "2026-09-01T12:04:00.000Z";

    for (const job of [
      applyPreparing, applying, retryReady, applyPreparedBeforeGateFlip,
      snapshotFailed, recovering, failedScan,
    ]) {
      await expect(saveContentReplacementJob(job)).resolves.toBeUndefined();
    }
  });

  it.each(ALLOWED_ROOT_STAGE_STATUS_CASES)(
    "accepts documented root stage/status pair: %s",
    async (_label, stage, status) => {
      installFakeIndexedDB();
      await expect(saveContentReplacementJob(createRootStateJob(stage, status)))
        .resolves.toBeUndefined();
    },
  );

  it.each(REJECTED_ROOT_STAGE_STATUS_CASES)(
    "rejects unsupported root stage/status pair: %s",
    async (_label, stage, status) => {
      installFakeIndexedDB();
      const allowedStatus = ROOT_STAGE_STATUS_MATRIX[stage][0];
      const job = createRootStateJob(stage, allowedStatus);
      job.status = status;
      if (status === "failed") {
        job.failure = createFailure();
        job.updatedAt = "2026-09-01T12:04:00.000Z";
      } else {
        delete job.failure;
      }
      await expect(saveContentReplacementJob(job)).rejects.toThrow(
        "Stored content replacement job is invalid.",
      );
    },
  );

  it("rejects active recovery work moved to a non-recovery stage", async () => {
    installFakeIndexedDB();
    const job = createAppliedJob();
    job.stage = "recovery";
    job.status = "running";
    job.proposals["question:42"].status = "recovering";
    job.stage = "apply";

    await expect(saveContentReplacementJob(job)).rejects.toThrow(
      "Stored content replacement job is invalid.",
    );
  });

  it.each(["inventory", "detail"] as const)(
    "rejects a completed scan with a nonempty %s queue",
    async (queue) => {
      installFakeIndexedDB();
      const job = createJob();
      job.status = "completed";
      if (queue === "inventory") job.detailQueue = [];
      else job.inventoryQueue = [];

      await expect(saveContentReplacementJob(job)).rejects.toThrow(
        "Stored content replacement job is invalid.",
      );
    },
  );

  it.each([
    ["completed apply with ready work", () => {
      const job = createApplyReadyJob();
      job.status = "completed";
      return job;
    }],
    ["completed apply with applying work", () => {
      const job = createApplyReadyJob();
      job.status = "completed";
      job.proposals["question:42"].status = "applying";
      job.proposals["question:42"].attemptCount = 1;
      return job;
    }],
    ["failed root without failure", () => {
      const job = createJob();
      job.status = "failed";
      return job;
    }],
    ["nonfailed root with failure", () => {
      const job = createJob();
      job.failure = createFailure();
      return job;
    }],
    ["applying item while root paused", () => {
      const job = createApplyReadyJob();
      job.proposals["question:42"].status = "applying";
      job.proposals["question:42"].attemptCount = 1;
      return job;
    }],
    ["recovering item while root paused", () => {
      const job = createAppliedJob();
      job.stage = "recovery";
      job.status = "paused";
      job.proposals["question:42"].status = "recovering";
      return job;
    }],
    ["stale apply result with observed post-apply generation", () => {
      const job = createAppliedJob();
      job.proposals["question:42"].status = "stale";
      job.proposals["question:42"].result = { kind: "stale", completedAt: job.updatedAt };
      return job;
    }],
    ["failed apply result with applied recovery generation", () => {
      const job = createAppliedJob();
      const item = job.proposals["question:42"];
      item.status = "failed";
      delete item.result;
      item.failure = createFailure();
      item.recovery!.status = "applied";
      return job;
    }],
    ["none snapshot gate with ready recovery data", () => {
      const job = createApplyReadyJob();
      job.recoverySnapshotStatus = "none";
      return job;
    }],
    ["ready snapshot gate with failed recovery data", () => {
      const job = createApplyReadyJob();
      const item = job.proposals["question:42"];
      item.status = "failed";
      item.attemptCount = 1;
      item.failure = createFailure();
      item.recovery!.status = "failed";
      return job;
    }],
  ])("rejects reducer-incompatible state: %s", async (_label, createInvalidJob) => {
    installFakeIndexedDB();
    await expect(saveContentReplacementJob(createInvalidJob())).rejects.toThrow(
      "Stored content replacement job is invalid.",
    );
  });

  it.each([
    ["proposal count", (job: any) => { job.progress.proposalsFound = 0; }],
    ["detail count", (job: any) => { job.progress.detailsInspected = 0; }],
    ["inventory count", (job: any) => { job.progress.inventoryItems = 0; }],
    ["apply completion count", (job: any) => { job.progress.applyCompleted = 0; }],
    ["recovery completion count", (job: any) => { job.progress.recoveryCompleted = 1; }],
    ["applied without result", (job: any) => { delete job.proposals["question:42"].result; }],
    ["applied with failure", (job: any) => { job.proposals["question:42"].failure = createFailure(); }],
    ["applied checksum mismatch", (job: any) => { job.proposals["question:42"].result.observedRequestChecksum = "f".repeat(64); }],
    ["excluded but included", (job: any) => { job.proposals["question:42"].included = true; job.proposals["question:42"].status = "excluded"; job.proposals["question:42"].result = { kind: "excluded", completedAt: job.updatedAt }; job.proposals["question:42"].exclusionReason = "user"; }],
    ["ready snapshot missing recovery", (job: any) => { job.recoverySnapshotStatus = "ready"; delete job.proposals["question:42"].recovery; }],
    ["stale preview after later apply", (job: any) => { job.proposals["question:42"].recovery.preview = createRecoveryPreview(job); }],
    ["stale preview after recovery begins", (job: any) => { job.proposals["question:42"].status = "recovering"; job.proposals["question:42"].recovery.preview = createRecoveryPreview(job); }],
  ])("rejects corrupt cross-field state: %s", async (_label, mutate) => {
    installFakeIndexedDB();
    const job = createAppliedJob() as any;
    mutate(job);
    await expect(saveContentReplacementJob(job)).rejects.toThrow(
      "Stored content replacement job is invalid.",
    );
  });

  it("rejects item states that cannot occur in the persisted wizard stage", async () => {
    installFakeIndexedDB();
    const job = createAppliedJob();
    job.stage = "review";

    await expect(saveContentReplacementJob(job)).rejects.toThrow(
      "Stored content replacement job is invalid.",
    );
  });

  it("closes a database that succeeds after the open request was already rejected", async () => {
    for (const [mode, message] of [
      ["blocked", "Content replacement storage upgrade was blocked."],
      ["error", "Content replacement storage could not be opened."],
    ] as const) {
      const fake = installFakeIndexedDB();
      if (mode === "blocked") fake.nextBlockedThenSuccess = true;
      else fake.nextErrorThenSuccess = true;

      await expect(listContentReplacementJobs()).rejects.toThrow(message);
      await new Promise<void>((resolve) => queueMicrotask(() => resolve()));

      expect(fake.closedDatabases).toBe(1);
    }
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
  const job = createJob();
  job.proposals["question:42"] = {
    proposal: structuredClone(canonicalQuestionProposal),
    included: true,
    attemptCount: 1,
    status: "applied",
    result: {
      kind: "applied",
      observedRequestChecksum: canonicalQuestionProposal.proposedRequestChecksum,
      completedAt: "2026-09-01T12:02:00.000Z",
    },
    recovery: {
      priorRequestModel: structuredClone(canonicalQuestionProposal.before),
      scannedRequestChecksum: canonicalQuestionProposal.scannedRequestChecksum,
      proposedRequestChecksum: canonicalQuestionProposal.proposedRequestChecksum,
      observedPostApplyChecksum: canonicalQuestionProposal.proposedRequestChecksum,
      status: "ready",
    },
  };
  job.stage = "results";
  job.status = "completed";
  job.inventoryQueue = [];
  job.detailQueue = [];
  job.recoverySnapshotStatus = "ready";
  job.progress.questionPages = 1;
  job.progress.inventoryItems = 1;
  job.progress.detailsInspected = 1;
  job.progress.proposalsFound = 1;
  job.progress.protectedOccurrences = canonicalQuestionProposal.protectedOccurrences.length;
  job.progress.applyCompleted = 1;
  job.updatedAt = "2026-09-01T12:04:00.000Z";
  return job;
}

function createQuestionBeforeModel(): ReplacementRequestModel {
  const body = 'Documentation: {"authorization":"Bearer abc"}, accessToken, and apiKey.';
  return {
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
  };
}

function createAppliedJob(): PersistedContentReplacementJob {
  const job = createPopulatedJob();
  const item = job.proposals["question:42"];
  delete item.failure;
  item.attemptCount = 1;
  item.status = "applied";
  item.result = {
    kind: "applied",
    observedRequestChecksum: item.proposal.proposedRequestChecksum,
    completedAt: "2026-09-01T12:02:00.000Z",
  };
  item.recovery = {
    priorRequestModel: structuredClone(item.proposal.before),
    scannedRequestChecksum: item.proposal.scannedRequestChecksum,
    proposedRequestChecksum: item.proposal.proposedRequestChecksum,
    observedPostApplyChecksum: item.proposal.proposedRequestChecksum,
    status: "ready",
  };
  job.stage = "results";
  job.status = "completed";
  job.inventoryQueue = [];
  job.detailQueue = [];
  job.recoverySnapshotStatus = "ready";
  job.progress.questionPages = 1;
  job.progress.inventoryItems = 1;
  job.progress.detailsInspected = 1;
  job.progress.proposalsFound = 1;
  job.progress.protectedOccurrences = item.proposal.protectedOccurrences.length;
  job.progress.applyCompleted = 1;
  job.progress.recoveryCompleted = 0;
  job.updatedAt = "2026-09-01T12:04:00.000Z";
  return job;
}

async function createActiveRecoveryOperationJob(): Promise<PersistedContentReplacementJob> {
  const job = createAppliedJob();
  for (const id of [43, 44]) {
    const before = structuredClone(createQuestionBeforeModel());
    before.ref = { kind: "question", questionId: id };
    if (before.kind !== "question") throw new Error("Expected question fixture.");
    before.metadata = { ...before.metadata, webUrl: `https://example.stackenterprise.co/q/${id}` };
    const proposal = await buildReplacementProposal(before, job.configuration);
    if (!proposal) throw new Error("Expected canonical proposal fixture.");
    job.proposals[`question:${id}`] = {
      proposal,
      included: true,
      attemptCount: 1,
      status: "applied",
      result: {
        kind: "applied", observedRequestChecksum: proposal.proposedRequestChecksum,
        completedAt: "2026-09-01T12:02:00.000Z",
      },
      recovery: {
        priorRequestModel: structuredClone(proposal.before),
        scannedRequestChecksum: proposal.scannedRequestChecksum,
        proposedRequestChecksum: proposal.proposedRequestChecksum,
        observedPostApplyChecksum: proposal.proposedRequestChecksum,
        status: "ready",
      },
    };
  }
  job.stage = "recovery";
  job.status = "paused";
  job.progress.inventoryItems = 3;
  job.progress.detailsInspected = 3;
  job.progress.proposalsFound = 3;
  job.progress.protectedOccurrences = Object.values(job.proposals)
    .reduce((count, item) => count + item.proposal.protectedOccurrences.length, 0);
  job.progress.applyCompleted = 3;
  job.activeOperation = {
    kind: "recovery-preview",
    requestedItemKeys: ["question:42", "question:43", "question:44"],
    remainingItemKeys: ["question:42", "question:43", "question:44"],
    generation: job.updatedAt,
  };
  return job;
}

function createReviewJob(): PersistedContentReplacementJob {
  const job = createPopulatedJob();
  const item = job.proposals["question:42"];
  job.stage = "review";
  job.status = "completed";
  job.recoverySnapshotStatus = "none";
  item.attemptCount = 0;
  item.status = "pending";
  delete item.result;
  delete item.failure;
  delete item.recovery;
  job.progress.applyCompleted = 0;
  return job;
}

function createApplyReadyJob(): PersistedContentReplacementJob {
  const job = createReviewJob();
  const item = job.proposals["question:42"];
  job.stage = "apply";
  job.status = "paused";
  job.recoverySnapshotStatus = "ready";
  item.status = "ready-to-apply";
  item.recovery = {
    priorRequestModel: structuredClone(item.proposal.before),
    scannedRequestChecksum: item.proposal.scannedRequestChecksum,
    proposedRequestChecksum: item.proposal.proposedRequestChecksum,
    status: "ready",
  };
  return job;
}

function createRecoveryFailedJob(input: {
  category: "authorization" | "validation" | "network";
  retryable: boolean;
  statusCode: number;
}): PersistedContentReplacementJob {
  const job = createAppliedJob();
  const item = job.proposals["question:42"] as any;
  job.stage = "recovery";
  job.status = "paused";
  item.status = "recovery-failed";
  item.attemptCount = 2;
  item.failure = {
    category: input.category,
    message: "A sanitized recovery failure",
    retryable: input.retryable,
    statusCode: input.statusCode,
    occurredAt: "2026-09-01T12:03:00.000Z",
  };
  item.recovery.status = "failed";
  delete item.recovery.preview;
  job.progress.recoveryCompleted = 1;
  return job;
}

function createRecoveryTerminalJob(
  outcome: "recovered" | "conflict",
): PersistedContentReplacementJob {
  const job = createAppliedJob();
  const item = job.proposals["question:42"] as any;
  job.id = `replacement-job-${outcome}`;
  job.stage = "recovery";
  job.status = "completed";
  item.status = outcome === "recovered" ? "recovered" : "recovery-conflict";
  item.attemptCount = 2;
  item.recovery.status = outcome === "recovered" ? "applied" : "conflict";
  item.recovery.result = {
    kind: outcome,
    observedRequestChecksum: outcome === "recovered"
      ? item.recovery.scannedRequestChecksum
      : "f".repeat(64),
    sourceAttemptCount: item.attemptCount,
    sourceApplyCompletedAt: item.result.completedAt,
    completedAt: "2026-09-01T12:03:00.000Z",
  };
  delete item.recovery.preview;
  job.progress.recoveryCompleted = 1;
  return job;
}

function createRootStateJob(stage: JobStage, status: JobStatus): PersistedContentReplacementJob {
  if (stage === "define") {
    const job = createJob();
    job.stage = stage;
    job.status = status;
    job.inventoryQueue = [];
    job.detailQueue = [];
    return job;
  }
  if (stage === "scan") {
    const job = createJob();
    job.status = status;
    if (status === "completed") {
      job.inventoryQueue = [];
      job.detailQueue = [];
    }
    if (status === "failed") {
      job.failure = createFailure();
      job.updatedAt = "2026-09-01T12:04:00.000Z";
    }
    return job;
  }
  if (stage === "review") {
    const job = createReviewJob();
    job.status = status;
    return job;
  }
  if (stage === "apply") {
    if (status === "completed") {
      const job = createAppliedJob();
      job.stage = "apply";
      return job;
    }
    if (status === "failed") {
      const job = createReviewJob();
      job.stage = "apply";
      job.status = "failed";
      job.failure = createFailure();
      job.recoverySnapshotStatus = "failed";
      return job;
    }
    const job = createApplyReadyJob();
    job.status = status;
    if (status === "running") {
      job.proposals["question:42"].status = "applying";
      job.proposals["question:42"].attemptCount = 1;
    }
    return job;
  }
  if (stage === "results") return createAppliedJob();
  if (status === "completed") return createRecoveryTerminalJob("recovered");
  if (status === "failed") {
    const job = createRecoveryFailedJob({ category: "network", retryable: true, statusCode: 503 });
    job.status = "failed";
    job.failure = createFailure();
    return job;
  }
  const job = createAppliedJob();
  job.stage = "recovery";
  job.status = status;
  if (status === "running") job.proposals["question:42"].status = "recovering";
  return job;
}

function createRecoveryPreview(job: PersistedContentReplacementJob): Record<string, unknown> {
  const item = job.proposals["question:42"];
  if (item.result?.kind !== "applied" && item.result?.kind !== "unchanged") {
    throw new Error("Expected successful apply result fixture.");
  }
  return {
    status: "recoverable",
    currentRequestModel: toReplacementWireRequestModel(item.proposal.after),
    observedCurrentChecksum: item.proposal.proposedRequestChecksum,
    expectedPostApplyChecksum: item.proposal.proposedRequestChecksum,
    sourceAttemptCount: item.attemptCount,
    sourceApplyCompletedAt: item.result.completedAt,
    previewedAt: "2026-09-01T12:03:00.000Z",
  };
}

function createFailure() {
  return {
    category: "network" as const,
    message: "A sanitized failure",
    retryable: true,
    statusCode: 503,
    occurredAt: "2026-09-01T12:03:00.000Z",
  };
}

function createValidStateFixtures(): PersistedContentReplacementJob[] {
  const define = createJob();
  define.stage = "define";
  define.status = "idle";
  define.inventoryQueue = [];
  define.detailQueue = [];

  const scan = createJob();

  const review = createReviewJob();

  const excluded = structuredClone(review);
  const excludedItem = excluded.proposals["question:42"];
  excludedItem.included = false;
  excludedItem.exclusionReason = "user";
  excludedItem.status = "excluded";
  excludedItem.result = { kind: "excluded", completedAt: excluded.updatedAt };

  const apply = createApplyReadyJob();

  const retry = structuredClone(apply);
  retry.proposals["question:42"].attemptCount = 1;

  const results = createAppliedJob();

  const recovery = structuredClone(results) as any;
  recovery.stage = "recovery";
  recovery.status = "paused";
  recovery.proposals["question:42"].status = "ready-to-recover";
  recovery.proposals["question:42"].recovery.preview = createRecoveryPreview(recovery);

  return [define, scan, review, excluded, apply, retry, results, recovery];
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
  closedDatabases = 0;
  hasStore = false;
  nextOpenError = false;
  nextBlocked = false;
  nextBlockedThenSuccess = false;
  nextErrorThenSuccess = false;
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
      if (this.nextErrorThenSuccess) {
        this.nextErrorThenSuccess = false;
        request.fail();
        queueMicrotask(() => request.succeed(database));
        return;
      }
      if (this.nextBlocked) {
        this.nextBlocked = false;
        request.block();
        return;
      }
      if (this.nextBlockedThenSuccess) {
        this.nextBlockedThenSuccess = false;
        request.block();
        queueMicrotask(() => request.succeed(database));
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

  close(): void { this.owner.closedDatabases += 1; }
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
