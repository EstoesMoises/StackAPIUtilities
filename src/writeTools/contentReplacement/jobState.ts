import type {
  DetailBatchResult,
  InventoryCursor,
  InventorySliceResult,
  PersistedContentReplacementFailure,
  PersistedContentReplacementItem,
  PersistedContentReplacementJob,
  PersistedContentReplacementRecoveryPreview,
  ReplacementConfiguration,
  ReplacementItemRef,
  ReplacementWireRequestModel,
} from "./types";

export interface CreateReplacementJobInput {
  id: string;
  fingerprint: string;
  baseUrl: string;
  configuration: ReplacementConfiguration;
  createdAt: string;
}

type FailureInput = Omit<PersistedContentReplacementFailure, "occurredAt">;

type ApplyResponseResult =
  | { status: "updated" | "already-applied" | "stale"; observedRequestChecksum: string }
  | { status: "permission" | "validation" | "network" | "failed"; error: string };

type RecoveryPreviewResponseResult = {
  status: "recoverable" | "already-recovered" | "conflict";
  currentRequestModel: ReplacementWireRequestModel;
  observedRequestChecksum: string;
};

type RecoveryApplyResponseResult =
  | { status: "recovered" | "already-recovered" | "conflict"; observedRequestChecksum: string }
  | { status: "permission" | "validation" | "network" | "failed"; error: string };

export type ReplacementJobEvent =
  | { type: "run/resume" | "run/pause" | "run/cancel"; at: string }
  | { type: "run/interrupted"; at: string }
  | { type: "run/credential-interrupted"; failure: FailureInput; at: string }
  | { type: "scan/inventory-succeeded"; cursor: InventoryCursor; result: InventorySliceResult; at: string }
  | { type: "scan/details-succeeded"; refs: ReplacementItemRef[]; result: DetailBatchResult; at: string }
  | { type: "scan/queues-drained"; at: string }
  | { type: "scan/failed"; failure: FailureInput; at: string }
  | {
      type: "recovery/preview-run-started";
      itemKeys: string[];
      at: string;
    }
  | {
      type: "scan/stale-rescan-started";
      requestedItemKeys: string[];
      at: string;
    }
  | {
      type: "scan/stale-details-succeeded";
      requestedItemKeys: string[];
      result: DetailBatchResult;
      at: string;
    }
  | {
      type: "scan/stale-details-failed";
      requestedItemKeys: string[];
      failure: FailureInput;
      at: string;
    }
  | {
      type: "review/set-included";
      itemKey: string;
      included: boolean;
      reason?: "user" | "bulk";
      at: string;
    }
  | { type: "apply/prepare"; at: string }
  | { type: "apply/start"; at: string }
  | { type: "apply/item-started"; itemKey: string; at: string }
  | { type: "apply/item-finished"; itemKey: string; result: ApplyResponseResult; at: string }
  | { type: "apply/retry-eligible"; at: string }
  | {
      type: "recovery/preview-started";
      itemKey: string;
      at: string;
    }
  | {
      type: "recovery/preview-finished";
      itemKey: string;
      result: RecoveryPreviewResponseResult;
      at: string;
    }
  | {
      type: "recovery/preview-failed";
      itemKey: string;
      failure: FailureInput;
      at: string;
    }
  | { type: "recovery/start"; itemKeys: string[]; at: string }
  | { type: "recovery/item-started"; itemKey: string; at: string }
  | { type: "recovery/item-finished"; itemKey: string; result: RecoveryApplyResponseResult; at: string }
  | { type: "recovery/delete-snapshots"; at: string }
  | { type: "run/set-retry-at"; nextRetryAt: string; at: string }
  | { type: "run/clear-retry-at"; at: string };

export interface ReplacementJobSummary {
  selectedItems: number;
  selectedChangedOccurrences: number;
  selectedProtectedOccurrences: number;
  results: {
    updated: number;
    alreadyApplied: number;
    excluded: number;
    stale: number;
    permission: number;
    validation: number;
    network: number;
    failed: number;
    protectedOnly: number;
    recovered: number;
    recoveryConflict: number;
    recoveryFailed: number;
  };
}

export function replacementItemKey(ref: ReplacementItemRef): string {
  if (ref.kind === "question") return `question:${ref.questionId}`;
  if (ref.kind === "answer") return `answer:${ref.questionId}:${ref.answerId}`;
  return `article:${ref.articleId}`;
}

export function createReplacementJob(input: CreateReplacementJobInput): PersistedContentReplacementJob {
  const inventoryQueue: InventoryCursor[] = [];
  if (input.configuration.contentTypes.questions || input.configuration.contentTypes.answers) {
    inventoryQueue.push({ kind: "questions", page: 1 });
  }
  if (input.configuration.contentTypes.articles) {
    inventoryQueue.push({ kind: "articles", page: 1 });
  }
  return {
    schemaVersion: 1,
    id: input.id,
    fingerprint: input.fingerprint,
    baseUrl: normalizeOrigin(input.baseUrl),
    target: { kind: "enterprise-main" },
    configuration: input.configuration,
    stage: "scan",
    status: "paused",
    inventoryQueue,
    detailQueue: [],
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
    createdAt: input.createdAt,
    updatedAt: input.createdAt,
  };
}

export function reduceReplacementJob(
  job: PersistedContentReplacementJob,
  event: ReplacementJobEvent,
): PersistedContentReplacementJob {
  switch (event.type) {
    case "run/resume":
      if (job.status !== "paused" && job.status !== "failed") return job;
      return touch({ ...job, status: "running", failure: undefined, operationError: undefined }, event.at);
    case "run/interrupted":
      if (job.status !== "running" &&
        !Object.values(job.proposals).some((item) => item.status === "applying" || item.status === "recovering")) {
        return job;
      }
      return pauseActiveWork(job, event.at);
    case "run/credential-interrupted":
      if (job.status === "completed" || job.status === "cancelled") return job;
      return touch({
        ...pauseActiveWork(job, event.at),
        failure: undefined,
        operationError: { ...event.failure, occurredAt: event.at },
      }, event.at);
    case "run/pause":
      if (job.status !== "running") return job;
      return pauseActiveWork(job, event.at);
    case "run/cancel":
      if (job.status === "completed" || job.status === "cancelled" || job.activeOperation) return job;
      return touch({ ...job, status: "cancelled", nextRetryAt: undefined }, event.at);
    case "run/set-retry-at":
      if (job.status === "failed" || job.status === "cancelled") return job;
      return touch({ ...job, nextRetryAt: event.nextRetryAt }, event.at);
    case "run/clear-retry-at":
      if (job.nextRetryAt === undefined) return job;
      return touch({ ...job, nextRetryAt: undefined }, event.at);
    case "scan/inventory-succeeded":
      return reduceInventory(job, event.cursor, event.result, event.at);
    case "scan/details-succeeded":
      return reduceDetails(job, event.refs, event.result, event.at);
    case "scan/queues-drained":
      if (!canEnterReview(job)) return job;
      return touch({ ...job, stage: "review", status: "completed", nextRetryAt: undefined }, event.at);
    case "scan/failed":
      if (job.stage !== "scan") return job;
      return touch({
        ...job,
        status: "failed",
        nextRetryAt: undefined,
        failure: { ...event.failure, occurredAt: event.at },
      }, event.at);
    case "scan/stale-rescan-started":
      return startStaleRescan(job, event.requestedItemKeys, event.at);
    case "scan/stale-details-succeeded":
      return reduceStaleRescan(job, event.requestedItemKeys, event.result, event.at);
    case "scan/stale-details-failed":
      if (
        job.stage !== "results" ||
        job.activeOperation?.kind !== "stale-rescan"
      ) return job;
      return touch({
        ...job,
        status: "failed",
        failure: { ...event.failure, occurredAt: event.at },
        nextRetryAt: undefined,
      }, event.at);
    case "review/set-included":
      return reduceSelection(job, event, event.at);
    case "apply/prepare":
      return prepareApply(job, event.at);
    case "apply/start":
      if (
        job.recoverySnapshotStatus !== "ready" ||
        !Object.values(job.proposals).some((item) => item.status === "ready-to-apply")
      ) return job;
      return touch({ ...job, stage: "apply", status: "running", failure: undefined }, event.at);
    case "apply/item-started":
      return startApplyItem(job, event.itemKey, event.at);
    case "apply/item-finished":
      return finishApplyItem(job, event.itemKey, event.result, event.at);
    case "apply/retry-eligible":
      return retryApplyFailures(job, event.at);
    case "recovery/preview-started":
      return startRecoveryPreview(job, event.itemKey, event.at);
    case "recovery/preview-run-started":
      return startRecoveryPreviewRun(job, event.itemKeys, event.at);
    case "recovery/preview-finished":
      return finishRecoveryPreview(job, event.itemKey, event.result, event.at);
    case "recovery/preview-failed":
      return failRecoveryPreview(job, event.itemKey, event.failure, event.at);
    case "recovery/start":
      return startRecovery(job, event.itemKeys, event.at);
    case "recovery/item-started":
      return startRecoveryItem(job, event.itemKey, event.at);
    case "recovery/item-finished":
      return finishRecoveryItem(job, event.itemKey, event.result, event.at);
    case "recovery/delete-snapshots":
      return deleteRecoverySnapshots(job, event.at);
  }
}

export function getNextInventoryCursor(job: PersistedContentReplacementJob): InventoryCursor | null {
  return job.stage === "scan" ? job.inventoryQueue[0] ?? null : null;
}

export function getNextDetailBatch(job: PersistedContentReplacementJob): ReplacementItemRef[] {
  return job.stage === "scan" ? job.detailQueue.slice(0, 10) : [];
}

export function getNextStaleRescanBatch(job: PersistedContentReplacementJob): ReplacementItemRef[] {
  if (job.activeOperation?.kind !== "stale-rescan") return [];
  return job.activeOperation.remainingItemKeys.slice(0, 10)
    .map((key) => job.proposals[key]?.proposal.before.ref)
    .filter((ref): ref is ReplacementItemRef => ref !== undefined);
}

export function getNextApplyItem(job: PersistedContentReplacementJob): PersistedContentReplacementItem | null {
  for (const item of Object.values(job.proposals)) {
    if (item.included && item.status === "ready-to-apply" && item.recovery) return item;
  }
  return null;
}

export function getNextRecoveryItem(job: PersistedContentReplacementJob): PersistedContentReplacementItem | null {
  for (const item of Object.values(job.proposals)) {
    if (
      item.included && item.status === "ready-to-recover" &&
      item.recovery?.preview?.status === "recoverable"
    ) return item;
  }
  return null;
}

export function canEnterReview(job: PersistedContentReplacementJob): boolean {
  return job.stage === "scan" && (job.status === "running" || job.status === "paused") &&
    job.inventoryQueue.length === 0 && job.detailQueue.length === 0;
}

export function summarizeReplacementJob(job: PersistedContentReplacementJob): ReplacementJobSummary {
  const summary: ReplacementJobSummary = {
    selectedItems: 0,
    selectedChangedOccurrences: 0,
    selectedProtectedOccurrences: 0,
    results: {
      updated: 0,
      alreadyApplied: 0,
      excluded: 0,
      stale: 0,
      permission: 0,
      validation: 0,
      network: 0,
      failed: 0,
      protectedOnly: job.progress.protectedOccurrences,
      recovered: 0,
      recoveryConflict: 0,
      recoveryFailed: 0,
    },
  };
  for (const item of Object.values(job.proposals)) {
    if (item.included) {
      summary.selectedItems += 1;
      summary.selectedChangedOccurrences += item.proposal.changedOccurrences.length;
      summary.selectedProtectedOccurrences += item.proposal.protectedOccurrences.length;
    }
    if (!item.included || item.status === "excluded") summary.results.excluded += 1;
    else if (item.result?.kind === "unchanged") summary.results.alreadyApplied += 1;
    else if (item.result?.kind === "applied") summary.results.updated += 1;
    else if (item.status === "stale") summary.results.stale += 1;
    else if (item.status === "failed") {
      const category = item.failure?.category;
      if (category === "authorization") summary.results.permission += 1;
      else if (category === "validation") summary.results.validation += 1;
      else if (category === "network" || category === "rate-limit") summary.results.network += 1;
      else summary.results.failed += 1;
    }
    if (item.status === "recovered") summary.results.recovered += 1;
    else if (item.status === "recovery-conflict") summary.results.recoveryConflict += 1;
    else if (item.status === "recovery-failed") summary.results.recoveryFailed += 1;
  }
  return summary;
}

function pauseActiveWork(
  job: PersistedContentReplacementJob,
  at: string,
): PersistedContentReplacementJob {
  const proposals = Object.fromEntries(Object.entries(job.proposals).map(([key, item]) => {
    if (item.status === "applying") {
      return [key, { ...item, status: "ready-to-apply" as const }];
    }
    if (item.status === "recovering" && hasSuccessfulApply(item) && item.recovery) {
      return [key, {
        ...item,
        status: "applied" as const,
        failure: undefined,
        recovery: {
          ...item.recovery,
          status: "ready" as const,
          preview: undefined,
          result: undefined,
        },
      }];
    }
    return [key, item];
  }));
  const interruptedRecovery = Object.values(job.proposals).some((item) => item.status === "recovering");
  const activeOperation = interruptedRecovery && job.activeOperation?.kind === "recovery-apply"
    ? {
        kind: "recovery-preview" as const,
        requestedItemKeys: job.activeOperation.remainingItemKeys,
        remainingItemKeys: job.activeOperation.remainingItemKeys,
        completedItemKeys: [],
        generation: at,
      }
    : job.activeOperation;
  return touch({
    ...job,
    status: "paused",
    proposals,
    activeOperation,
    progress: deriveTerminalProgress(job, proposals),
  }, at);
}

function reduceInventory(
  job: PersistedContentReplacementJob,
  cursor: InventoryCursor,
  result: InventorySliceResult,
  at: string,
): PersistedContentReplacementJob {
  if (job.stage !== "scan" || !sameCursor(job.inventoryQueue[0], cursor)) return job;
  const remaining = job.inventoryQueue.slice(1);
  const inventoryQueue = dedupeByKey([
    ...remaining,
    ...(result.nextCursor && isCursorRelevant(result.nextCursor, job.configuration)
      ? [result.nextCursor]
      : []),
    ...(cursor.kind === "questions" && job.configuration.contentTypes.answers
      ? result.answerCursors
      : []),
  ], inventoryCursorKey);
  const knownDetailKeys = new Set([
    ...job.detailQueue.map(replacementItemKey),
    ...Object.keys(job.proposals),
  ]);
  const detailQueue = [...job.detailQueue];
  for (const ref of result.candidates) {
    if (!isRefRelevant(ref, job.configuration)) continue;
    const key = replacementItemKey(ref);
    if (!knownDetailKeys.has(key)) {
      knownDetailKeys.add(key);
      detailQueue.push(ref);
    }
  }
  const progress = {
    ...job.progress,
    questionPages: job.progress.questionPages + (cursor.kind === "questions" ? 1 : 0),
    answerPages: job.progress.answerPages + (cursor.kind === "answers" ? 1 : 0),
    articlePages: job.progress.articlePages + (cursor.kind === "articles" ? 1 : 0),
    inventoryItems: job.progress.inventoryItems + result.inspectedCount,
  };
  return touch({ ...job, inventoryQueue, detailQueue, progress, nextRetryAt: undefined }, at);
}

function reduceDetails(
  job: PersistedContentReplacementJob,
  refs: readonly ReplacementItemRef[],
  result: DetailBatchResult,
  at: string,
): PersistedContentReplacementJob {
  if (job.stage !== "scan") return job;
  if (refs.length > 10 || refs.some((ref, index) =>
    replacementItemKey(ref) !== replacementItemKey(job.detailQueue[index]))) return job;
  const consumed = new Set(refs.map(replacementItemKey));
  if (result.proposals.some((candidate) => !consumed.has(replacementItemKey(candidate.before.ref)))) {
    return job;
  }
  const detailQueue = job.detailQueue.slice(refs.length);
  const proposals = { ...job.proposals };
  for (const candidate of result.proposals) {
    const key = replacementItemKey(candidate.before.ref);
    if (proposals[key]) continue;
    proposals[key] = {
      proposal: candidate,
      included: true,
      attemptCount: 0,
      status: "pending",
    };
  }
  const progress = {
    ...job.progress,
    detailsInspected: job.progress.detailsInspected + result.inspectedCount,
    proposalsFound: Object.keys(proposals).length,
    protectedOccurrences: job.progress.protectedOccurrences + result.protectedOccurrenceCount,
  };
  return touch({ ...job, detailQueue, proposals, progress, nextRetryAt: undefined }, at);
}

function reduceSelection(
  job: PersistedContentReplacementJob,
  event: Extract<ReplacementJobEvent, { type: "review/set-included" }>,
  at: string,
): PersistedContentReplacementJob {
  if (job.stage !== "review") return job;
  const current = job.proposals[event.itemKey];
  if (!current || current.included === event.included) return job;
  const proposals = resetReviewItems(job.proposals);
  proposals[event.itemKey] = event.included
    ? { proposal: current.proposal, included: true, attemptCount: 0, status: "pending" }
    : {
        proposal: current.proposal,
        included: false,
        exclusionReason: event.reason ?? "user",
        attemptCount: 0,
        status: "excluded",
        result: { kind: "excluded", completedAt: at },
      };
  return touch({
    ...job,
    proposals,
    recoverySnapshotStatus: "none",
    progress: deriveTerminalProgress(job, proposals),
  }, at);
}

function prepareApply(job: PersistedContentReplacementJob, at: string): PersistedContentReplacementJob {
  if (job.stage !== "review") return job;
  const entries = Object.entries(job.proposals);
  if (!entries.some(([, item]) => item.included)) return job;
  const proposals: PersistedContentReplacementJob["proposals"] = {};
  for (const [key, item] of entries) {
    if (!item.included) {
      proposals[key] = item;
      continue;
    }
    proposals[key] = {
      proposal: item.proposal,
      included: true,
      attemptCount: 0,
      status: "ready-to-apply",
      recovery: {
        priorRequestModel: item.proposal.before,
        scannedRequestChecksum: item.proposal.scannedRequestChecksum,
        proposedRequestChecksum: item.proposal.proposedRequestChecksum,
        status: "ready",
      },
    };
  }
  return touch({
    ...job,
    stage: "apply",
    status: "paused",
    proposals,
    recoverySnapshotStatus: "ready",
    failure: undefined,
    progress: deriveTerminalProgress(job, proposals),
  }, at);
}

function startApplyItem(
  job: PersistedContentReplacementJob,
  itemKey: string,
  at: string,
): PersistedContentReplacementJob {
  const item = job.proposals[itemKey];
  const nextItem = getNextApplyItem(job);
  if (
    job.stage !== "apply" || job.status !== "running" || item?.status !== "ready-to-apply" ||
    !nextItem || replacementItemKey(nextItem.proposal.before.ref) !== itemKey ||
    Object.values(job.proposals).some((candidate) => candidate.status === "applying")
  ) return job;
  const proposals = {
    ...job.proposals,
    [itemKey]: {
      ...item,
      attemptCount: item.attemptCount + 1,
      status: "applying" as const,
      result: undefined,
      failure: undefined,
      recovery: item.recovery && { ...item.recovery, preview: undefined, result: undefined },
    },
  };
  return touch({ ...job, proposals }, at);
}

function finishApplyItem(
  job: PersistedContentReplacementJob,
  itemKey: string,
  result: ApplyResponseResult,
  at: string,
): PersistedContentReplacementJob {
  const item = job.proposals[itemKey];
  if (job.stage !== "apply" || item?.status !== "applying" || !item.recovery) return job;
  let nextItem: PersistedContentReplacementItem;
  if (result.status === "updated" || result.status === "already-applied") {
    if (result.observedRequestChecksum !== item.proposal.proposedRequestChecksum) {
      nextItem = {
        ...applyFailureItem(item, "validation", "Apply evidence did not match the reviewed proposal.", false, at),
        result: {
          kind: "verification-failed",
          expectedRequestChecksum: item.proposal.proposedRequestChecksum,
          observedRequestChecksum: result.observedRequestChecksum,
          completedAt: at,
        },
      };
    } else {
      nextItem = {
        ...item,
        status: "applied",
        result: {
          kind: result.status === "updated" ? "applied" : "unchanged",
          observedRequestChecksum: result.observedRequestChecksum,
          completedAt: at,
        },
        failure: undefined,
        recovery: {
          ...item.recovery,
          observedPostApplyChecksum: result.observedRequestChecksum,
          status: "ready",
          preview: undefined,
          result: undefined,
        },
      };
    }
  } else if (result.status === "stale") {
    nextItem = {
      ...item,
      status: "stale",
      result: { kind: "stale", completedAt: at },
      failure: undefined,
      recovery: { ...item.recovery, status: "ready", preview: undefined, result: undefined },
    };
  } else {
    const category = result.status === "permission" ? "authorization" :
      result.status === "failed" ? "server" : result.status;
    nextItem = applyFailureItem(
      item,
      category,
      "error" in result ? result.error : "Unable to apply the content item.",
      result.status === "network" || result.status === "failed",
      at,
    );
  }
  const proposals = { ...job.proposals, [itemKey]: nextItem };
  const hasRemaining = Object.values(proposals).some(
    (candidate) => candidate.status === "ready-to-apply" || candidate.status === "applying",
  );
  const next = {
    ...job,
    proposals,
    progress: deriveTerminalProgress(job, proposals),
    ...(hasRemaining
      ? {}
      : { stage: "results" as const, status: "completed" as const, nextRetryAt: undefined }),
  };
  return touch(next, at);
}

function applyFailureItem(
  item: PersistedContentReplacementItem,
  category: PersistedContentReplacementFailure["category"],
  message: string,
  retryable: boolean,
  at: string,
): PersistedContentReplacementItem {
  return {
    ...item,
    status: "failed",
    result: undefined,
    failure: { category, message, retryable, occurredAt: at },
    recovery: item.recovery && {
      ...item.recovery,
      status: "ready",
      observedPostApplyChecksum: undefined,
      preview: undefined,
      result: undefined,
    },
  };
}

function retryApplyFailures(job: PersistedContentReplacementJob, at: string): PersistedContentReplacementJob {
  if (job.stage !== "results" && job.stage !== "apply") return job;
  let changed = false;
  const proposals = Object.fromEntries(Object.entries(job.proposals).map(([key, item]) => {
    if (item.status !== "failed" || !item.failure?.retryable || !item.recovery) return [key, item];
    changed = true;
    return [key, {
      ...item,
      status: "ready-to-apply" as const,
      result: undefined,
      failure: undefined,
      recovery: { ...item.recovery, status: "ready" as const, preview: undefined, result: undefined },
    }];
  }));
  if (!changed) return job;
  return touch({
    ...job,
    stage: "apply",
    status: "paused",
    proposals,
    progress: deriveTerminalProgress(job, proposals),
  }, at);
}

function reduceStaleRescan(
  job: PersistedContentReplacementJob,
  requestedItemKeys: readonly string[],
  result: DetailBatchResult,
  at: string,
): PersistedContentReplacementJob {
  const operation = job.activeOperation;
  if (job.stage !== "results" || operation?.kind !== "stale-rescan") return job;
  const expected = operation.remainingItemKeys.slice(0, requestedItemKeys.length);
  if (requestedItemKeys.length === 0 || requestedItemKeys.length > 10 ||
    requestedItemKeys.some((key, index) => key !== expected[index])) return job;
  const requested = new Set(requestedItemKeys);
  if (result.proposals.some((candidate) => !requested.has(replacementItemKey(candidate.before.ref)))) return job;
  const accumulated = { ...operation.proposals };
  for (const proposal of result.proposals) accumulated[replacementItemKey(proposal.before.ref)] = proposal;
  const remainingItemKeys = operation.remainingItemKeys.slice(requestedItemKeys.length);
  const activeOperation = {
    ...operation,
    remainingItemKeys,
    completedItemKeys: [...operation.completedItemKeys, ...requestedItemKeys],
    proposals: accumulated,
    inspectedCount: operation.inspectedCount + result.inspectedCount,
    protectedOccurrenceCount: operation.protectedOccurrenceCount + result.protectedOccurrenceCount,
  };
  if (remainingItemKeys.length > 0) {
    return touch({ ...job, activeOperation, nextRetryAt: undefined }, at);
  }
  const allRequested = new Set(operation.requestedItemKeys);
  const replacedProtectedOccurrences = operation.requestedItemKeys.reduce(
    (count, key) => count + (job.proposals[key]?.proposal.protectedOccurrences.length ?? 0), 0,
  );
  const rescanned = Object.fromEntries(Object.entries(job.proposals)
    .filter(([key]) => !allRequested.has(key) || accumulated[key])
    .map(([key, item]) => [key, accumulated[key] ? { ...item, proposal: accumulated[key] } : item]));
  const proposals = resetReviewItems(rescanned);
  return touch({
    ...job, stage: "review", status: "completed", proposals,
    activeOperation: undefined, recoverySnapshotStatus: "none", failure: undefined,
    operationError: undefined, nextRetryAt: undefined,
    progress: {
      ...deriveTerminalProgress(job, proposals),
      protectedOccurrences: Math.max(0,
        job.progress.protectedOccurrences - replacedProtectedOccurrences + activeOperation.protectedOccurrenceCount),
    },
  }, at);
}

function startStaleRescan(
  job: PersistedContentReplacementJob,
  requestedItemKeys: readonly string[],
  at: string,
): PersistedContentReplacementJob {
  if (job.stage !== "results" || job.status === "running" || job.activeOperation) return job;
  const requested = new Set(requestedItemKeys);
  const keys = Object.keys(job.proposals).filter((key) =>
    requested.has(key) && job.proposals[key].status === "stale");
  if (keys.length === 0) return job;
  return touch({
    ...job,
    status: "running",
    failure: undefined,
    operationError: undefined,
    activeOperation: {
      kind: "stale-rescan",
      requestedItemKeys: keys,
      remainingItemKeys: keys,
      completedItemKeys: [],
      generation: at,
      proposals: {},
      inspectedCount: 0,
      protectedOccurrenceCount: 0,
    },
  }, at);
}

function finishRecoveryPreview(
  job: PersistedContentReplacementJob,
  itemKey: string,
  result: RecoveryPreviewResponseResult,
  at: string,
): PersistedContentReplacementJob {
  const item = job.proposals[itemKey];
  if (!item || !hasSuccessfulApply(item) || !item.recovery) return job;
  const preview: PersistedContentReplacementRecoveryPreview = {
    status: result.status,
    currentRequestModel: result.currentRequestModel,
    observedCurrentChecksum: result.observedRequestChecksum,
    expectedPostApplyChecksum: item.recovery.observedPostApplyChecksum,
    sourceAttemptCount: item.attemptCount,
    sourceApplyCompletedAt: item.result.completedAt,
    previewedAt: at,
  };
  const proposals = {
    ...job.proposals,
    [itemKey]: {
      ...item,
      status: "ready-to-recover" as const,
      failure: undefined,
      recovery: { ...item.recovery, status: "ready" as const, preview, result: undefined },
    },
  };
  return touch(consumeActiveOperation({
    ...job,
    stage: "recovery",
    status: "running",
    proposals,
    progress: deriveTerminalProgress(job, proposals),
  }, itemKey, "recovery-preview"), at);
}

function startRecoveryPreviewRun(
  job: PersistedContentReplacementJob,
  itemKeys: readonly string[],
  at: string,
): PersistedContentReplacementJob {
  if (job.activeOperation || job.status === "running") return job;
  const requested = new Set(itemKeys);
  const keys = Object.keys(job.proposals).filter((key) => requested.has(key) && hasSuccessfulApply(job.proposals[key]));
  if (keys.length === 0) return job;
  return touch({
    ...job, stage: "recovery", status: "running", operationError: undefined,
    activeOperation: {
      kind: "recovery-preview", requestedItemKeys: keys, remainingItemKeys: keys,
      completedItemKeys: [], generation: at,
    },
  }, at);
}

function startRecoveryPreview(
  job: PersistedContentReplacementJob,
  itemKey: string,
  at: string,
): PersistedContentReplacementJob {
  const item = job.proposals[itemKey];
  if (!item || !hasSuccessfulApply(item) || !item.recovery) return job;
  const proposals = {
    ...job.proposals,
    [itemKey]: {
      ...item,
      status: "applied" as const,
      failure: undefined,
      recovery: { ...item.recovery, status: "ready" as const, preview: undefined, result: undefined },
    },
  };
  return touch({ ...job, stage: "recovery", status: "paused", proposals }, at);
}

function failRecoveryPreview(
  job: PersistedContentReplacementJob,
  itemKey: string,
  failure: FailureInput,
  at: string,
): PersistedContentReplacementJob {
  const item = job.proposals[itemKey];
  if (!item || !hasSuccessfulApply(item) || !item.recovery) return job;
  const proposals = {
    ...job.proposals,
    [itemKey]: {
      ...item,
      status: "recovery-failed" as const,
      failure: { ...failure, occurredAt: at },
      recovery: { ...item.recovery, status: "failed" as const, preview: undefined, result: undefined },
    },
  };
  const failedJob: PersistedContentReplacementJob = {
    ...job,
    stage: "recovery",
    status: "running",
    proposals,
    progress: deriveTerminalProgress(job, proposals),
  };
  return touch(failure.retryable
    ? consumeActiveOperation(failedJob, itemKey, "recovery-preview")
    : { ...failedJob, status: "completed", activeOperation: undefined }, at);
}

function startRecovery(
  job: PersistedContentReplacementJob,
  itemKeys: readonly string[],
  at: string,
): PersistedContentReplacementJob {
  const requested = new Set(itemKeys);
  const hasRecoverable = Object.entries(job.proposals).some(([key, item]) =>
    requested.has(key) && item.status === "ready-to-recover" &&
    item.recovery?.preview?.status === "recoverable"
  );
  if (job.recoverySnapshotStatus !== "ready" || !hasRecoverable) return job;
  const keys = Object.keys(job.proposals).filter((key) => requested.has(key)).filter((key) => {
    const item = job.proposals[key];
    return item.status === "ready-to-recover" && item.recovery?.preview?.status === "recoverable";
  });
  return touch({
    ...job, stage: "recovery", status: "running", failure: undefined, operationError: undefined,
    activeOperation: {
      kind: "recovery-apply", requestedItemKeys: keys, remainingItemKeys: keys,
      completedItemKeys: [], generation: at,
    },
  }, at);
}

function startRecoveryItem(
  job: PersistedContentReplacementJob,
  itemKey: string,
  at: string,
): PersistedContentReplacementJob {
  const item = job.proposals[itemKey];
  if (
    job.stage !== "recovery" || job.status !== "running" ||
    item?.status !== "ready-to-recover" || item.recovery?.preview?.status !== "recoverable"
  ) return job;
  const proposals = {
    ...job.proposals,
    [itemKey]: {
      ...item,
      status: "recovering" as const,
      failure: undefined,
      recovery: { ...item.recovery, preview: undefined, result: undefined },
    },
  };
  return touch({ ...job, proposals }, at);
}

function finishRecoveryItem(
  job: PersistedContentReplacementJob,
  itemKey: string,
  result: RecoveryApplyResponseResult,
  at: string,
): PersistedContentReplacementJob {
  const item = job.proposals[itemKey];
  if (item?.status !== "recovering" || !hasSuccessfulApply(item) || !item.recovery) return job;
  let nextItem: PersistedContentReplacementItem;
  if (result.status === "recovered" || result.status === "already-recovered") {
    nextItem = result.observedRequestChecksum === item.recovery.scannedRequestChecksum ? {
      ...item,
      status: "recovered",
      failure: undefined,
      recovery: {
        ...item.recovery,
        status: "applied",
        preview: undefined,
        result: {
          kind: "recovered",
          observedRequestChecksum: result.observedRequestChecksum,
          sourceAttemptCount: item.attemptCount,
          sourceApplyCompletedAt: item.result.completedAt,
          completedAt: at,
        },
      },
    } : {
      ...item,
      status: "recovery-conflict",
      failure: undefined,
      recovery: {
        ...item.recovery,
        status: "conflict",
        preview: undefined,
        result: {
          kind: "verification-failed",
          expectedRequestChecksum: item.recovery.scannedRequestChecksum,
          observedRequestChecksum: result.observedRequestChecksum,
          sourceAttemptCount: item.attemptCount,
          sourceApplyCompletedAt: item.result.completedAt,
          completedAt: at,
        },
      },
    };
  } else if (result.status === "conflict") {
    nextItem = {
      ...item,
      status: "recovery-conflict",
      failure: undefined,
      recovery: {
        ...item.recovery,
        status: "conflict",
        preview: undefined,
        result: {
          kind: "conflict",
          observedRequestChecksum: result.observedRequestChecksum,
          sourceAttemptCount: item.attemptCount,
          sourceApplyCompletedAt: item.result.completedAt,
          completedAt: at,
        },
      },
    };
  } else {
    const category = result.status === "permission" ? "authorization" :
      result.status === "failed" ? "server" : result.status;
    nextItem = {
      ...item,
      status: "recovery-failed",
      failure: {
        category,
        message: "error" in result ? result.error : "Unable to recover the content item.",
        retryable: result.status === "network" || result.status === "failed",
        occurredAt: at,
      },
      recovery: { ...item.recovery, status: "failed", preview: undefined, result: undefined },
    };
  }
  const proposals = { ...job.proposals, [itemKey]: nextItem };
  const hasRemaining = Object.values(proposals).some(
    (candidate) => candidate.status === "ready-to-recover" || candidate.status === "recovering",
  );
  const finishedJob = {
    ...job,
    proposals,
    progress: deriveTerminalProgress(job, proposals),
    ...(hasRemaining ? {} : { status: "completed" as const }),
  };
  const terminalRequestFailure = result.status === "permission" || result.status === "validation";
  return touch(terminalRequestFailure
    ? { ...finishedJob, status: "completed", activeOperation: undefined }
    : consumeActiveOperation(finishedJob, itemKey, "recovery-apply"), at);
}

function consumeActiveOperation(
  job: PersistedContentReplacementJob,
  itemKey: string,
  kind: "recovery-preview" | "recovery-apply",
): PersistedContentReplacementJob {
  const operation = job.activeOperation;
  if (operation?.kind !== kind || operation.remainingItemKeys[0] !== itemKey) return job;
  const remainingItemKeys = operation.remainingItemKeys.slice(1);
  const completedItemKeys = [...operation.completedItemKeys, itemKey];
  return remainingItemKeys.length > 0
    ? { ...job, status: "running", activeOperation: { ...operation, remainingItemKeys, completedItemKeys } }
    : { ...job, status: kind === "recovery-preview" ? "paused" : "completed", activeOperation: undefined };
}

function deleteRecoverySnapshots(
  job: PersistedContentReplacementJob,
  at: string,
): PersistedContentReplacementJob {
  if (
    (job.stage !== "results" && job.stage !== "recovery") ||
    job.status === "running" || job.activeOperation ||
    !Object.values(job.proposals).some((item) => item.recovery)
  ) return job;
  const proposals = Object.fromEntries(Object.entries(job.proposals).map(([key, item]) => {
    const status = item.status === "recovered" || item.status === "recovery-conflict" ||
      item.status === "recovery-failed" || item.status === "ready-to-recover"
      ? "applied" as const
      : item.status;
    const next = { ...item, status, recovery: undefined, failure: status === "applied" ? undefined : item.failure };
    return [key, next];
  }));
  return touch({
    ...job,
    stage: "results",
    status: "completed",
    proposals,
    recoverySnapshotStatus: "none",
    failure: undefined,
    nextRetryAt: undefined,
    progress: deriveTerminalProgress(job, proposals),
  }, at);
}

function resetReviewItems(
  source: PersistedContentReplacementJob["proposals"],
): PersistedContentReplacementJob["proposals"] {
  return Object.fromEntries(Object.entries(source).map(([key, item]) => [key, item.included
    ? { proposal: item.proposal, included: true, attemptCount: 0, status: "pending" as const }
    : {
        proposal: item.proposal,
        included: false,
        exclusionReason: item.exclusionReason ?? "user",
        attemptCount: 0,
        status: "excluded" as const,
        result: item.result?.kind === "excluded" ? item.result : undefined,
      },
  ]));
}

function deriveTerminalProgress(
  job: PersistedContentReplacementJob,
  proposals: PersistedContentReplacementJob["proposals"],
): PersistedContentReplacementJob["progress"] {
  const items = Object.values(proposals);
  return {
    ...job.progress,
    proposalsFound: items.length,
    applyCompleted: items.filter((item) => isApplyComplete(item.status)).length,
    recoveryCompleted: items.filter((item) =>
      item.status === "recovered" || item.status === "recovery-conflict" || item.status === "recovery-failed"
    ).length,
  };
}

function isApplyComplete(status: PersistedContentReplacementItem["status"]): boolean {
  return status === "applied" || status === "stale" || status === "failed" ||
    status === "ready-to-recover" || status === "recovering" || status === "recovered" ||
    status === "recovery-conflict" || status === "recovery-failed";
}

function hasSuccessfulApply(
  item: PersistedContentReplacementItem,
): item is PersistedContentReplacementItem & {
  result: Extract<NonNullable<PersistedContentReplacementItem["result"]>, { kind: "applied" | "unchanged" }>;
  recovery: NonNullable<PersistedContentReplacementItem["recovery"]> & { observedPostApplyChecksum: string };
} {
  return (item.result?.kind === "applied" || item.result?.kind === "unchanged") &&
    item.recovery?.observedPostApplyChecksum === item.result.observedRequestChecksum;
}

function touch(job: PersistedContentReplacementJob, at: string): PersistedContentReplacementJob {
  return { ...withoutUndefinedRoot(job), updatedAt: at };
}

function withoutUndefinedRoot(job: PersistedContentReplacementJob): PersistedContentReplacementJob {
  const next = { ...job };
  if (next.failure === undefined) delete next.failure;
  if (next.nextRetryAt === undefined) delete next.nextRetryAt;
  if (next.activeOperation === undefined) delete next.activeOperation;
  if (next.operationError === undefined) delete next.operationError;
  return next;
}

function normalizeOrigin(value: string): string {
  try {
    return new URL(value).origin;
  } catch {
    return value.trim();
  }
}

function inventoryCursorKey(cursor: InventoryCursor): string {
  return cursor.kind === "answers"
    ? `answers:${cursor.questionId}:${cursor.page}`
    : `${cursor.kind}:${cursor.page}`;
}

function isCursorRelevant(
  cursor: InventoryCursor,
  configuration: ReplacementConfiguration,
): boolean {
  if (cursor.kind === "questions") {
    return configuration.contentTypes.questions || configuration.contentTypes.answers;
  }
  if (cursor.kind === "answers") return configuration.contentTypes.answers;
  return configuration.contentTypes.articles;
}

function isRefRelevant(
  ref: ReplacementItemRef,
  configuration: ReplacementConfiguration,
): boolean {
  if (ref.kind === "question") return configuration.contentTypes.questions;
  if (ref.kind === "answer") return configuration.contentTypes.answers;
  return configuration.contentTypes.articles;
}

function sameCursor(left: InventoryCursor | undefined, right: InventoryCursor): boolean {
  return left !== undefined && inventoryCursorKey(left) === inventoryCursorKey(right);
}

function dedupeByKey<T>(values: readonly T[], keyOf: (value: T) => string): T[] {
  const keys = new Set<string>();
  return values.filter((value) => {
    const key = keyOf(value);
    if (keys.has(key)) return false;
    keys.add(key);
    return true;
  });
}
