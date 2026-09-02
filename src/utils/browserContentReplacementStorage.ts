import {
  isOriginOnlyInstanceUrl,
  isSha256Digest,
  sameRef,
  validateConfiguration,
  validateItemRef,
} from "../server/contentReplacementRequestValidation";
import {
  buildReplacementProposal,
  checksumRequestModel,
  createJobFingerprint,
  stableSerialize,
} from "../writeTools/contentReplacement/proposals";
import type {
  ArticlePermissionsRequest,
  InventoryCursor,
  PersistedContentReplacementFailure,
  PersistedContentReplacementItem,
  PersistedContentReplacementRecovery,
  PersistedContentReplacementRecoveryPreview,
  PersistedContentReplacementRecoveryResult,
  PersistedContentReplacementResult,
  PersistedContentReplacementJob,
  PersistedContentReplacementProgress,
  ReplacementMetadata,
  ReplacementOccurrence,
  ReplacementProposal,
  ReplacementProtectedOccurrence,
  ReplacementRequestModel,
  ReplacementWireRequestModel,
  ReplacementItemRef,
} from "../writeTools/contentReplacement/types";

const DATABASE_NAME = "stack-api-content-replacement";
const DATABASE_VERSION = 1;
const STORE_NAME = "jobs";
const JOB_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const MAX_QUEUE_ITEMS = 100_000;
const MAX_SCHEMA_ARRAY_LENGTH = 100_000;
const MAX_GRAPH_DEPTH = 256;
const MAX_GRAPH_NODES = 150_000;
const MAX_GRAPH_ENTRIES = 300_000;
const MAX_CANONICAL_VALIDATION_CONCURRENCY = 16;
const MAX_INVENTORY_PAGE = 10_000;
const MAX_PROPOSALS = 100_000;
const MAX_OCCURRENCES = 100_000;
const MAX_CONTENT_LENGTH = 1_048_576;
const MAX_LIST_ITEMS = 10_000;
const JOB_KEYS = [
  "schemaVersion", "id", "fingerprint", "baseUrl", "target", "configuration",
  "stage", "status", "inventoryQueue", "detailQueue", "progress", "proposals",
  "recoverySnapshotStatus", "nextRetryAt", "failure", "createdAt", "updatedAt",
] as const;
const PROGRESS_KEYS = [
  "questionPages", "answerPages", "articlePages", "inventoryItems", "detailsInspected",
  "proposalsFound", "protectedOccurrences", "applyCompleted", "recoveryCompleted",
] as const;

export async function listContentReplacementJobs(): Promise<PersistedContentReplacementJob[]> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(STORE_NAME, "readonly");
    const [values] = await Promise.all([
      requestToPromise<unknown[]>(transaction.objectStore(STORE_NAME).getAll()),
      transactionToPromise(transaction),
    ]);
    const jobs: PersistedContentReplacementJob[] = [];
    for (const value of values) jobs.push(await parseContentReplacementJob(value));
    return jobs.sort(compareJobs);
  } finally {
    database.close();
  }
}

export async function loadContentReplacementJob(
  id: string,
): Promise<PersistedContentReplacementJob | null> {
  assertJobId(id);
  const database = await openDatabase();
  try {
    const transaction = database.transaction(STORE_NAME, "readonly");
    const [value] = await Promise.all([
      requestToPromise<unknown>(transaction.objectStore(STORE_NAME).get(id)),
      transactionToPromise(transaction),
    ]);
    return value === undefined ? null : await parseContentReplacementJob(value);
  } finally {
    database.close();
  }
}

export async function saveContentReplacementJob(job: PersistedContentReplacementJob): Promise<void> {
  const normalized = await parseContentReplacementJob(job);
  const database = await openDatabase();
  try {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    const request = transaction.objectStore(STORE_NAME).put(normalized);
    await Promise.all([requestToPromise(request), transactionToPromise(transaction)]);
  } finally {
    database.close();
  }
}

export async function deleteContentReplacementJob(id: string): Promise<void> {
  assertJobId(id);
  const database = await openDatabase();
  try {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    const request = transaction.objectStore(STORE_NAME).delete(id);
    await Promise.all([requestToPromise(request), transactionToPromise(transaction)]);
  } finally {
    database.close();
  }
}

async function parseContentReplacementJob(value: unknown): Promise<PersistedContentReplacementJob> {
  const normalized = normalizeContentReplacementJob(value);
  try {
    const expectedFingerprint = await createJobFingerprint({
      baseUrl: normalized.baseUrl,
      configuration: normalized.configuration,
    });
    if (expectedFingerprint !== normalized.fingerprint) throw corruptJob();
    const items = Object.values(normalized.proposals);
    for (let offset = 0; offset < items.length; offset += MAX_CANONICAL_VALIDATION_CONCURRENCY) {
      await Promise.all(
        items.slice(offset, offset + MAX_CANONICAL_VALIDATION_CONCURRENCY)
          .map((item) => validateCanonicalItem(item, normalized.configuration, normalized.updatedAt)),
      );
    }
    return normalized;
  } catch {
    throw corruptJob();
  }
}

async function validateCanonicalItem(
  item: PersistedContentReplacementItem,
  configuration: PersistedContentReplacementJob["configuration"],
  jobUpdatedAt: string,
): Promise<void> {
  const canonicalProposal = await buildReplacementProposal(item.proposal.before, configuration);
  if (!canonicalProposal || stableSerialize(canonicalProposal) !== stableSerialize(item.proposal)) {
    throw corruptJob();
  }
  if (!item.recovery) return;
  if (
    stableSerialize(item.recovery.priorRequestModel) !== stableSerialize(item.proposal.before) ||
    await checksumRequestModel(item.recovery.priorRequestModel) !== item.recovery.scannedRequestChecksum
  ) {
    throw corruptJob();
  }
  const preview = item.recovery.preview;
  if (!preview) return;
  const result = item.result;
  if (result?.kind !== "applied" && result?.kind !== "unchanged") throw corruptJob();
  const observedChecksum = await checksumRequestModel(preview.currentRequestModel);
  const expectedStatus = observedChecksum === item.recovery.scannedRequestChecksum
    ? "already-recovered"
    : observedChecksum === item.recovery.observedPostApplyChecksum
      ? "recoverable"
      : "conflict";
  if (
    observedChecksum !== preview.observedCurrentChecksum ||
    preview.expectedPostApplyChecksum !== item.recovery.observedPostApplyChecksum ||
    preview.status !== expectedStatus ||
    preview.sourceAttemptCount !== item.attemptCount ||
    preview.sourceApplyCompletedAt !== result.completedAt ||
    Date.parse(result.completedAt) > Date.parse(preview.previewedAt) ||
    Date.parse(preview.previewedAt) > Date.parse(jobUpdatedAt)
  ) throw corruptJob();
}

function normalizeContentReplacementJob(value: unknown): PersistedContentReplacementJob {
  const safeValue = cloneSafeDataGraph(value);
  const record = exactObject(safeValue, JOB_KEYS, ["nextRetryAt", "failure"]);
  const configuration = validateConfiguration(record.configuration);
  const baseUrl = normalizeEnterpriseBaseUrl(record.baseUrl);
  const target = exactObject(record.target, ["kind"]);
  const createdAt = timestamp(record.createdAt);
  const updatedAt = timestamp(record.updatedAt);
  if (
    record.schemaVersion !== 1 ||
    !isJobId(record.id) ||
    !isSha256Digest(record.fingerprint) ||
    target.kind !== "enterprise-main" ||
    !configuration ||
    !sameTarget(configuration.target, target) ||
    !isStage(record.stage) ||
    !isStatus(record.status) ||
    !isRecoverySnapshotStatus(record.recoverySnapshotStatus) ||
    Date.parse(createdAt) > Date.parse(updatedAt)
  ) {
    throw corruptJob();
  }
  const inventoryQueue = boundedArray(record.inventoryQueue, MAX_QUEUE_ITEMS).map(parseInventoryCursor);
  const detailQueue = boundedArray(record.detailQueue, MAX_QUEUE_ITEMS).map(parseItemRef);
  const progress = parseProgress(record.progress);
  const proposals = exactDynamicMap(record.proposals);
  const proposalEntries = Object.entries(proposals);
  if (proposalEntries.length > MAX_PROPOSALS) throw corruptJob();
  const normalizedProposals: Record<string, PersistedContentReplacementItem> = {};
  const configuredRuleIds = new Set(configuration.rules.map((rule) => rule.id));
  for (const [key, item] of proposalEntries) {
    if (!isCanonicalItemKey(key)) throw corruptJob();
    normalizedProposals[key] = parsePersistedItem(item, key, configuredRuleIds);
  }
  const nextRetryAt = record.nextRetryAt === undefined ? undefined : timestamp(record.nextRetryAt);
  const failure = record.failure === undefined ? undefined : parseFailure(record.failure);
  const normalized: PersistedContentReplacementJob = {
    schemaVersion: 1,
    id: record.id,
    fingerprint: record.fingerprint,
    baseUrl,
    target: { kind: "enterprise-main" },
    configuration,
    stage: record.stage,
    status: record.status,
    inventoryQueue,
    detailQueue,
    progress,
    proposals: normalizedProposals,
    recoverySnapshotStatus: record.recoverySnapshotStatus,
    ...(nextRetryAt === undefined ? {} : { nextRetryAt }),
    ...(failure === undefined ? {} : { failure }),
    createdAt,
    updatedAt,
  };
  assertJobInvariants(normalized);
  return normalized;
}

function assertJobInvariants(job: PersistedContentReplacementJob): void {
  const items = Object.values(job.proposals);
  const protectedOccurrences = items.reduce(
    (countValue, item) => countValue + item.proposal.protectedOccurrences.length,
    0,
  );
  const applyCompleted = items.filter((item) => isApplyCompletedStatus(item.status)).length;
  const recoveryCompleted = items.filter((item) =>
    item.status === "recovered" || item.status === "recovery-conflict" ||
    item.status === "recovery-failed"
  ).length;
  if (
    job.progress.proposalsFound !== items.length ||
    job.progress.detailsInspected < job.progress.proposalsFound ||
    job.progress.inventoryItems < job.progress.detailsInspected ||
    !Number.isSafeInteger(protectedOccurrences) ||
    job.progress.protectedOccurrences < protectedOccurrences ||
    job.progress.applyCompleted !== applyCompleted ||
    job.progress.recoveryCompleted !== recoveryCompleted ||
    (!job.configuration.contentTypes.answers && job.progress.answerPages !== 0) ||
    (!job.configuration.contentTypes.articles && job.progress.articlePages !== 0) ||
    (!(job.configuration.contentTypes.questions || job.configuration.contentTypes.answers) &&
      job.progress.questionPages !== 0) ||
    job.inventoryQueue.some((cursor) => !isInventoryCursorRelevant(cursor, job.configuration)) ||
    job.detailQueue.some((ref) => !isItemRefRelevant(ref, job.configuration)) ||
    items.some((item) => !isItemRefRelevant(item.proposal.before.ref, job.configuration))
  ) throw corruptJob();

  if ((job.status === "failed") !== (job.failure !== undefined)) throw corruptJob();
  if (job.failure && !isWithinJobTime(job.failure.occurredAt, job)) throw corruptJob();
  for (const item of items) {
    assertItemInvariants(item, job.recoverySnapshotStatus);
    if (item.result && !isWithinJobTime(item.result.completedAt, job)) throw corruptJob();
    if (item.recovery?.result && !isWithinJobTime(item.recovery.result.completedAt, job)) {
      throw corruptJob();
    }
    if (item.failure && !isWithinJobTime(item.failure.occurredAt, job)) throw corruptJob();
  }
  assertStageInvariants(job, items);
  if (
    job.recoverySnapshotStatus === "ready" &&
    items.some((item) => item.included && (
      !isCompleteRecoverySnapshot(item.recovery) ||
      item.recovery.status === "pending" ||
      (item.recovery.status === "failed" && item.status !== "recovery-failed")
    ))
  ) throw corruptJob();
  if (
    job.recoverySnapshotStatus === "none" &&
    items.some((item) => item.recovery !== undefined)
  ) throw corruptJob();
}

function assertStageInvariants(
  job: PersistedContentReplacementJob,
  items: readonly PersistedContentReplacementItem[],
): void {
  const allowedRootStatuses: Record<
    PersistedContentReplacementJob["stage"],
    ReadonlySet<PersistedContentReplacementJob["status"]>
  > = {
    define: new Set(["idle"]),
    scan: new Set(["running", "paused", "completed", "failed", "cancelled"]),
    review: new Set(["completed", "paused", "cancelled"]),
    apply: new Set(["running", "paused", "completed", "failed", "cancelled"]),
    results: new Set(["completed", "failed"]),
    recovery: new Set(["running", "paused", "completed", "failed", "cancelled"]),
  };
  const allowedStatuses: Record<
    PersistedContentReplacementJob["stage"],
    ReadonlySet<PersistedContentReplacementItem["status"]>
  > = {
    define: new Set(),
    scan: new Set(["pending"]),
    review: new Set(["pending", "excluded"]),
    apply: new Set(["pending", "excluded", "ready-to-apply", "applying", "applied", "stale", "failed"]),
    results: new Set(["excluded", "applied", "stale", "failed"]),
    recovery: new Set([
      "excluded", "applied", "stale", "ready-to-recover", "recovering", "recovered",
      "recovery-conflict", "recovery-failed", "failed",
    ]),
  };
  if (!allowedRootStatuses[job.stage].has(job.status)) throw corruptJob();
  if (items.some((item) => !allowedStatuses[job.stage].has(item.status))) throw corruptJob();
  if (job.stage !== "scan" && (job.inventoryQueue.length > 0 || job.detailQueue.length > 0)) {
    throw corruptJob();
  }
  if (
    job.stage === "scan" && job.status === "completed" &&
    (job.inventoryQueue.length > 0 || job.detailQueue.length > 0)
  ) throw corruptJob();
  if (
    (job.stage === "define" || job.stage === "scan" || job.stage === "review") &&
    job.recoverySnapshotStatus !== "none"
  ) throw corruptJob();
  if (job.stage === "results" && job.recoverySnapshotStatus !== "ready" &&
    job.recoverySnapshotStatus !== "none") throw corruptJob();
  if (job.stage === "recovery" && job.recoverySnapshotStatus !== "ready") throw corruptJob();
  if (
    job.stage === "apply" && job.recoverySnapshotStatus === "ready" &&
    items.some((item) => item.included && item.status === "pending")
  ) throw corruptJob();
  if (
    job.stage === "apply" &&
    (job.recoverySnapshotStatus === "none" || job.recoverySnapshotStatus === "preparing") &&
    items.some((item) => item.included && item.status !== "pending" && item.status !== "ready-to-apply")
  ) throw corruptJob();
  if (
    job.stage === "apply" && job.recoverySnapshotStatus === "failed" && job.status !== "failed"
  ) throw corruptJob();
  if (
    job.status === "completed" && job.stage === "apply" &&
    items.some((item) => item.included && (
      item.status === "pending" || item.status === "ready-to-apply" || item.status === "applying"
    ))
  ) throw corruptJob();
  if (
    job.status === "completed" && job.stage === "recovery" &&
    items.some((item) => item.status === "ready-to-recover" || item.status === "recovering")
  ) throw corruptJob();
  if (
    items.some((item) => item.status === "applying") &&
    (job.stage !== "apply" || job.status !== "running" || job.recoverySnapshotStatus !== "ready")
  ) throw corruptJob();
  if (
    items.some((item) => item.status === "recovering") &&
    (job.stage !== "recovery" || job.status !== "running" || job.recoverySnapshotStatus !== "ready")
  ) throw corruptJob();
}

function assertItemInvariants(
  item: PersistedContentReplacementItem,
  snapshotStatus: PersistedContentReplacementJob["recoverySnapshotStatus"],
): void {
  const { failure, recovery, result, status } = item;
  if (!item.included) {
    if (
      status !== "excluded" || !item.exclusionReason || item.attemptCount !== 0 ||
      result?.kind !== "excluded" || failure || recovery
    ) throw corruptJob();
    return;
  }
  if (item.exclusionReason || status === "excluded" || result?.kind === "excluded") throw corruptJob();

  if (status === "pending") {
    if (item.attemptCount !== 0 || result || failure || recovery) throw corruptJob();
    return;
  }
  if (status === "ready-to-apply" || status === "applying") {
    if (
      result || failure || !isCompleteRecoverySnapshot(recovery) ||
      recovery.status !== "ready" || recovery.preview || recovery.result ||
      recovery.observedPostApplyChecksum ||
      (status === "applying" && item.attemptCount < 1)
    ) {
      throw corruptJob();
    }
    return;
  }
  if (status === "failed") {
    if (!recovery && snapshotStatus === "none") {
      if (item.attemptCount < 1 || result || !failure) throw corruptJob();
      return;
    }
    if (
      item.attemptCount < 1 || result || !failure || !isCompleteRecoverySnapshot(recovery) ||
      recovery.preview || recovery.result || recovery.observedPostApplyChecksum ||
      (recovery.status !== "ready" && recovery.status !== "failed")
    ) {
      throw corruptJob();
    }
    return;
  }
  if (status === "stale") {
    if (!recovery && snapshotStatus === "none") {
      if (item.attemptCount < 1 || result?.kind !== "stale" || failure) throw corruptJob();
      return;
    }
    if (
      item.attemptCount < 1 || result?.kind !== "stale" || failure ||
      !isCompleteRecoverySnapshot(recovery) || recovery.preview || recovery.result ||
      recovery.observedPostApplyChecksum ||
      recovery.status !== "ready"
    ) {
      throw corruptJob();
    }
    return;
  }
  if (status === "recovery-failed") {
    if (
      !hasSuccessfulApplyEvidence(item) || !failure || !recovery || recovery.preview ||
      recovery.status !== "failed" || recovery.result ||
      Date.parse(result?.completedAt ?? "") > Date.parse(failure.occurredAt)
    ) throw corruptJob();
    return;
  }
  if (status === "recovered") {
    if (
      !hasSuccessfulApplyEvidence(item) || failure || !recovery || recovery.preview ||
      recovery.status !== "applied" || recovery.result?.kind !== "recovered" ||
      !matchesRecoveryGeneration(item, recovery.result) ||
      Date.parse(result?.completedAt ?? "") > Date.parse(recovery.result.completedAt)
    ) throw corruptJob();
    return;
  }
  if (status === "recovery-conflict") {
    if (
      !hasSuccessfulApplyEvidence(item) || failure || !recovery || recovery.preview ||
      recovery.status !== "conflict" || recovery.result?.kind !== "conflict" ||
      !matchesRecoveryGeneration(item, recovery.result) ||
      recovery.result.observedRequestChecksum === recovery.scannedRequestChecksum ||
      recovery.result.observedRequestChecksum === recovery.observedPostApplyChecksum ||
      Date.parse(result?.completedAt ?? "") > Date.parse(recovery.result.completedAt)
    ) throw corruptJob();
    return;
  }

  if (status === "applied" && !recovery && snapshotStatus === "none") {
    if (
      item.attemptCount < 1 || failure ||
      (result?.kind !== "applied" && result?.kind !== "unchanged")
    ) throw corruptJob();
    return;
  }

  if (
    item.attemptCount < 1 || failure || !recovery ||
    (result?.kind !== "applied" && result?.kind !== "unchanged") ||
    recovery.observedPostApplyChecksum !== result.observedRequestChecksum ||
    recovery.status !== "ready" || recovery.result
  ) throw corruptJob();
  if (status === "ready-to-recover") {
    if (!recovery.preview || recovery.status !== "ready") throw corruptJob();
  } else if (status === "recovering") {
    if (recovery.preview) throw corruptJob();
  } else if (status === "applied") {
    if (recovery.preview) throw corruptJob();
  } else {
    throw corruptJob();
  }
}

function hasSuccessfulApplyEvidence(item: PersistedContentReplacementItem): boolean {
  const { recovery, result } = item;
  return item.attemptCount >= 1 && recovery !== undefined &&
    (result?.kind === "applied" || result?.kind === "unchanged") &&
    recovery.observedPostApplyChecksum === result.observedRequestChecksum;
}

function matchesRecoveryGeneration(
  item: PersistedContentReplacementItem,
  recoveryResult: PersistedContentReplacementRecoveryResult,
): boolean {
  return recoveryResult.sourceAttemptCount === item.attemptCount &&
    recoveryResult.sourceApplyCompletedAt === item.result?.completedAt;
}

function isWithinJobTime(
  value: string,
  job: Pick<PersistedContentReplacementJob, "createdAt" | "updatedAt">,
): boolean {
  const time = Date.parse(value);
  return Date.parse(job.createdAt) <= time && time <= Date.parse(job.updatedAt);
}

function isCompleteRecoverySnapshot(
  recovery: PersistedContentReplacementRecovery | undefined,
): recovery is PersistedContentReplacementRecovery {
  return recovery !== undefined;
}

function isApplyCompletedStatus(status: PersistedContentReplacementItem["status"]): boolean {
  return status === "applied" || status === "stale" || status === "failed" ||
    status === "ready-to-recover" || status === "recovering" || status === "recovered" ||
    status === "recovery-conflict" || status === "recovery-failed";
}

function isInventoryCursorRelevant(
  cursor: InventoryCursor,
  configuration: PersistedContentReplacementJob["configuration"],
): boolean {
  if (cursor.kind === "questions") {
    return configuration.contentTypes.questions || configuration.contentTypes.answers;
  }
  if (cursor.kind === "answers") return configuration.contentTypes.answers;
  return configuration.contentTypes.articles;
}

function isItemRefRelevant(
  ref: ReplacementItemRef,
  configuration: PersistedContentReplacementJob["configuration"],
): boolean {
  if (ref.kind === "question") return configuration.contentTypes.questions;
  if (ref.kind === "answer") return configuration.contentTypes.answers;
  return configuration.contentTypes.articles;
}

function parsePersistedItem(
  value: unknown,
  itemKey: string,
  configuredRuleIds: ReadonlySet<string>,
): PersistedContentReplacementItem {
  const record = exactObject(
    value,
    ["proposal", "included", "exclusionReason", "attemptCount", "status", "result", "failure", "recovery"],
    ["exclusionReason", "result", "failure", "recovery"],
  );
  const proposal = parseProposal(record.proposal, itemKey, configuredRuleIds);
  if (typeof record.included !== "boolean" || !isItemStatus(record.status)) throw corruptJob();
  const exclusionReason = record.exclusionReason;
  if (exclusionReason !== undefined && exclusionReason !== "user" && exclusionReason !== "bulk") throw corruptJob();
  if (record.included && exclusionReason !== undefined) throw corruptJob();
  return {
    proposal,
    included: record.included,
    ...(exclusionReason === undefined ? {} : { exclusionReason }),
    attemptCount: count(record.attemptCount),
    status: record.status,
    ...(record.result === undefined ? {} : { result: parseResult(record.result) }),
    ...(record.failure === undefined ? {} : { failure: parseFailure(record.failure) }),
    ...(record.recovery === undefined ? {} : {
      recovery: parseRecovery(record.recovery, proposal),
    }),
  };
}

function parseProposal(
  value: unknown,
  itemKey: string,
  configuredRuleIds: ReadonlySet<string>,
): ReplacementProposal {
  const record = exactObject(value, [
    "before", "after", "scannedRequestChecksum", "proposedRequestChecksum", "proposalFingerprint",
    "fields", "changedOccurrences", "protectedOccurrences", "appliedRuleIds", "metadata",
  ], ["metadata"]);
  const before = parseRequestModel(record.before);
  const after = parseRequestModel(record.after);
  if (!sameRef(before.ref, after.ref) || canonicalItemKey(before.ref) !== itemKey) throw corruptJob();
  const scannedRequestChecksum = digest(record.scannedRequestChecksum);
  const proposedRequestChecksum = digest(record.proposedRequestChecksum);
  const proposalFingerprint = digest(record.proposalFingerprint);
  const fields = parseProposalFields(record.fields, before.ref.kind);
  const changedOccurrences = boundedArray(record.changedOccurrences, MAX_OCCURRENCES)
    .map(parseChangedOccurrence);
  const protectedOccurrences = boundedArray(record.protectedOccurrences, MAX_OCCURRENCES)
    .map(parseProtectedOccurrence);
  const appliedRuleIds = stringList(record.appliedRuleIds, 500, 200);
  const changedRuleIds = [...new Set(changedOccurrences.map((occurrence) => occurrence.ruleId))];
  if (
    changedOccurrences.length === 0 ||
    !proposalFieldsMatch(fields, before, after) ||
    changedOccurrences.some((occurrence) => !configuredRuleIds.has(occurrence.ruleId)) ||
    protectedOccurrences.some((occurrence) => !configuredRuleIds.has(occurrence.ruleId)) ||
    appliedRuleIds.length !== changedRuleIds.length ||
    appliedRuleIds.some((id, index) => id !== changedRuleIds[index])
  ) {
    throw corruptJob();
  }
  const metadata = record.metadata === undefined ? undefined : parseMetadata(record.metadata);
  return {
    before,
    after,
    scannedRequestChecksum,
    proposedRequestChecksum,
    proposalFingerprint,
    fields,
    changedOccurrences,
    protectedOccurrences,
    appliedRuleIds,
    ...(metadata === undefined ? {} : { metadata }),
  };
}

function proposalFieldsMatch(
  fields: ReplacementProposal["fields"],
  before: ReplacementRequestModel,
  after: ReplacementRequestModel,
): boolean {
  if (fields.body.beforeMarkdown !== before.request.body || fields.body.afterMarkdown !== after.request.body) {
    return false;
  }
  if (before.kind === "answer" || after.kind === "answer") return fields.title === undefined;
  return fields.title?.beforeMarkdown === before.request.title &&
    fields.title.afterMarkdown === after.request.title;
}

function parseRequestModel(value: unknown): ReplacementRequestModel {
  return parseRequestModelInternal(value, true);
}

function parseWireRequestModel(value: unknown): ReplacementWireRequestModel {
  return parseRequestModelInternal(value, false);
}

function parseRequestModelInternal(
  value: unknown,
  allowMetadata: true,
): ReplacementRequestModel;
function parseRequestModelInternal(
  value: unknown,
  allowMetadata: false,
): ReplacementWireRequestModel;
function parseRequestModelInternal(
  value: unknown,
  allowMetadata: boolean,
): ReplacementRequestModel {
  const record = allowMetadata
    ? exactObject(value, ["kind", "ref", "request", "metadata"], ["metadata"])
    : exactObject(value, ["kind", "ref", "request"]);
  const ref = parseItemRef(record.ref);
  if (record.kind !== ref.kind) throw corruptJob();
  const metadata = allowMetadata && record.metadata !== undefined
    ? parseMetadata(record.metadata)
    : undefined;
  const withMetadata = <T extends ReplacementRequestModel>(model: T): T =>
    (metadata === undefined ? model : { ...model, metadata });
  if (ref.kind === "answer") {
    const request = exactObject(record.request, ["body"]);
    return withMetadata({ kind: "answer", ref, request: { body: contentString(request.body) } });
  }
  if (ref.kind === "question") {
    const request = exactObject(record.request, ["title", "body", "tags"]);
    return withMetadata({
      kind: "question",
      ref,
      request: {
        title: contentString(request.title),
        body: contentString(request.body),
        tags: stringList(request.tags, MAX_LIST_ITEMS, 200),
      },
    });
  }
  const request = exactObject(
    record.request,
    ["title", "body", "tags", "type", "expirationDate", "permissions"],
    ["expirationDate"],
  );
  if (!isArticleType(request.type)) throw corruptJob();
  const expirationDate = request.expirationDate;
  if (expirationDate !== undefined && expirationDate !== null && typeof expirationDate !== "string") throw corruptJob();
  return withMetadata({
    kind: "article",
    ref,
    request: {
      title: contentString(request.title),
      body: contentString(request.body),
      tags: stringList(request.tags, MAX_LIST_ITEMS, 200),
      type: request.type,
      ...(expirationDate === undefined ? {} : { expirationDate }),
      permissions: parsePermissions(request.permissions),
    },
  });
}

function parsePermissions(value: unknown): ArticlePermissionsRequest {
  const record = exactObject(
    value,
    ["editableBy", "editorUserIds", "editorUserGroupIds"],
    ["editableBy"],
  );
  if (
    record.editableBy !== undefined && record.editableBy !== "ownerOnly" &&
    record.editableBy !== "specificEditors" && record.editableBy !== "everyone"
  ) throw corruptJob();
  return {
    ...(record.editableBy === undefined ? {} : { editableBy: record.editableBy }),
    editorUserIds: idList(record.editorUserIds),
    editorUserGroupIds: idList(record.editorUserGroupIds),
  };
}

function parseMetadata(value: unknown): ReplacementMetadata {
  const record = exactObject(
    value,
    ["titleContext", "webUrl", "owner", "lastEditor", "lastActivityDate"],
    ["titleContext", "webUrl", "owner", "lastEditor", "lastActivityDate"],
  );
  const titleContext = optionalContentString(record.titleContext);
  const webUrl = optionalContentString(record.webUrl);
  const owner = record.owner === undefined ? undefined : parseMetadataUser(record.owner);
  const lastEditor = record.lastEditor === undefined ? undefined : parseMetadataUser(record.lastEditor);
  const lastActivityDate = record.lastActivityDate;
  if (lastActivityDate !== undefined && lastActivityDate !== null && typeof lastActivityDate !== "string") throw corruptJob();
  return {
    ...(titleContext === undefined ? {} : { titleContext }),
    ...(webUrl === undefined ? {} : { webUrl }),
    ...(owner === undefined ? {} : { owner }),
    ...(lastEditor === undefined ? {} : { lastEditor }),
    ...(lastActivityDate === undefined ? {} : { lastActivityDate }),
  };
}

function parseMetadataUser(value: unknown): { id: number; name?: string } {
  const record = exactObject(value, ["id", "name"], ["name"]);
  const name = record.name === undefined ? undefined : contentString(record.name);
  return { id: positiveInteger(record.id), ...(name === undefined ? {} : { name }) };
}

function parseProposalFields(
  value: unknown,
  kind: ReplacementItemRef["kind"],
): ReplacementProposal["fields"] {
  const record = exactObject(value, ["title", "body"], ["title"]);
  const title = record.title === undefined ? undefined : parseMarkdownField(record.title);
  if ((kind === "answer" && title !== undefined) || (kind !== "answer" && title === undefined)) throw corruptJob();
  return {
    ...(title === undefined ? {} : { title }),
    body: parseMarkdownField(record.body),
  };
}

function parseMarkdownField(value: unknown): { beforeMarkdown: string; afterMarkdown: string } {
  const record = exactObject(value, ["beforeMarkdown", "afterMarkdown"]);
  return {
    beforeMarkdown: contentString(record.beforeMarkdown),
    afterMarkdown: contentString(record.afterMarkdown),
  };
}

function parseChangedOccurrence(value: unknown): ReplacementOccurrence {
  const record = exactObject(value, ["field", "ruleId", "start", "end", "before", "after"]);
  if (!isProposalField(record.field)) throw corruptJob();
  const start = count(record.start);
  const end = count(record.end);
  if (end < start) throw corruptJob();
  return {
    field: record.field,
    ruleId: boundedString(record.ruleId, 1, 200),
    start,
    end,
    before: contentString(record.before),
    after: contentString(record.after),
  };
}

function parseProtectedOccurrence(value: unknown): ReplacementProtectedOccurrence {
  const record = exactObject(value, ["field", "ruleId", "start", "end", "before", "reason"]);
  if (!isProposalField(record.field) || !isProtectedReason(record.reason)) throw corruptJob();
  const start = count(record.start);
  const end = count(record.end);
  if (end < start) throw corruptJob();
  return {
    field: record.field,
    ruleId: boundedString(record.ruleId, 1, 200),
    start,
    end,
    before: contentString(record.before),
    reason: record.reason,
  };
}

function parseRecovery(
  value: unknown,
  proposal: ReplacementProposal,
): PersistedContentReplacementRecovery {
  const record = exactObject(value, [
    "priorRequestModel", "scannedRequestChecksum", "proposedRequestChecksum",
    "observedPostApplyChecksum", "status", "preview", "result",
  ], ["observedPostApplyChecksum", "preview", "result"]);
  const priorRequestModel = parseRequestModel(record.priorRequestModel);
  const scannedRequestChecksum = digest(record.scannedRequestChecksum);
  const proposedRequestChecksum = digest(record.proposedRequestChecksum);
  const observedPostApplyChecksum = record.observedPostApplyChecksum === undefined
    ? undefined
    : digest(record.observedPostApplyChecksum);
  if (
    !sameRef(priorRequestModel.ref, proposal.before.ref) ||
    scannedRequestChecksum !== proposal.scannedRequestChecksum ||
    proposedRequestChecksum !== proposal.proposedRequestChecksum ||
    !isRecoveryStatus(record.status)
  ) throw corruptJob();
  const preview = record.preview === undefined
    ? undefined
    : parseRecoveryPreview(record.preview, proposal.before.ref);
  const result = record.result === undefined ? undefined : parseRecoveryResult(record.result);
  if (preview && observedPostApplyChecksum === undefined) throw corruptJob();
  return {
    priorRequestModel,
    scannedRequestChecksum,
    proposedRequestChecksum,
    ...(observedPostApplyChecksum === undefined ? {} : { observedPostApplyChecksum }),
    status: record.status,
    ...(preview === undefined ? {} : { preview }),
    ...(result === undefined ? {} : { result }),
  };
}

function parseRecoveryResult(value: unknown): PersistedContentReplacementRecoveryResult {
  const record = exactObject(value, [
    "kind", "observedRequestChecksum", "sourceAttemptCount", "sourceApplyCompletedAt", "completedAt",
  ]);
  if (record.kind !== "recovered" && record.kind !== "conflict") throw corruptJob();
  return {
    kind: record.kind,
    observedRequestChecksum: digest(record.observedRequestChecksum),
    sourceAttemptCount: count(record.sourceAttemptCount),
    sourceApplyCompletedAt: timestamp(record.sourceApplyCompletedAt),
    completedAt: timestamp(record.completedAt),
  };
}

function parseRecoveryPreview(
  value: unknown,
  expectedRef: ReplacementItemRef,
): PersistedContentReplacementRecoveryPreview {
  const record = exactObject(value, [
    "status", "currentRequestModel", "observedCurrentChecksum",
    "expectedPostApplyChecksum", "sourceAttemptCount", "sourceApplyCompletedAt", "previewedAt",
  ]);
  if (!isRecoveryPreviewStatus(record.status)) throw corruptJob();
  const currentRequestModel = parseWireRequestModel(record.currentRequestModel);
  if (!sameRef(currentRequestModel.ref, expectedRef)) throw corruptJob();
  return {
    status: record.status,
    currentRequestModel,
    observedCurrentChecksum: digest(record.observedCurrentChecksum),
    expectedPostApplyChecksum: digest(record.expectedPostApplyChecksum),
    sourceAttemptCount: count(record.sourceAttemptCount),
    sourceApplyCompletedAt: timestamp(record.sourceApplyCompletedAt),
    previewedAt: timestamp(record.previewedAt),
  };
}

function parseResult(value: unknown): PersistedContentReplacementResult {
  const record = plainRecord(value);
  if (record.kind === "applied" || record.kind === "unchanged") {
    exactObject(record, ["kind", "observedRequestChecksum", "completedAt"]);
    return {
      kind: record.kind,
      observedRequestChecksum: digest(record.observedRequestChecksum),
      completedAt: timestamp(record.completedAt),
    };
  }
  if (
    record.kind === "stale" || record.kind === "excluded"
  ) {
    exactObject(record, ["kind", "completedAt"]);
    return { kind: record.kind, completedAt: timestamp(record.completedAt) };
  }
  throw corruptJob();
}

function parseFailure(value: unknown): PersistedContentReplacementFailure {
  const record = exactObject(
    value,
    ["category", "message", "retryable", "statusCode", "occurredAt"],
    ["statusCode"],
  );
  if (!isFailureCategory(record.category) || typeof record.retryable !== "boolean") throw corruptJob();
  const statusCode = record.statusCode;
  if (
    statusCode !== undefined &&
    (typeof statusCode !== "number" || !Number.isSafeInteger(statusCode) || statusCode < 100 || statusCode > 599)
  ) throw corruptJob();
  return {
    category: record.category,
    message: boundedString(record.message, 1, 2_000),
    retryable: record.retryable,
    ...(statusCode === undefined ? {} : { statusCode }),
    occurredAt: timestamp(record.occurredAt),
  };
}

function parseProgress(value: unknown): PersistedContentReplacementProgress {
  const record = exactObject(value, PROGRESS_KEYS);
  const output = {} as Record<(typeof PROGRESS_KEYS)[number], number>;
  for (const key of PROGRESS_KEYS) output[key] = count(record[key]);
  return output;
}

function parseInventoryCursor(value: unknown): InventoryCursor {
  const record = plainRecord(value);
  if (record.kind === "questions" || record.kind === "articles") {
    exactObject(record, ["kind", "page"]);
    return { kind: record.kind, page: inventoryPage(record.page) };
  }
  if (record.kind === "answers") {
    exactObject(record, ["kind", "questionId", "page"]);
    return {
      kind: "answers",
      questionId: positiveInteger(record.questionId),
      page: inventoryPage(record.page),
    };
  }
  throw corruptJob();
}

function parseItemRef(value: unknown): ReplacementItemRef {
  const ref = validateItemRef(value);
  if (!ref) throw corruptJob();
  return ref;
}

function canonicalItemKey(ref: ReplacementItemRef): string {
  if (ref.kind === "question") return `question:${ref.questionId}`;
  if (ref.kind === "answer") return `answer:${ref.questionId}:${ref.answerId}`;
  return `article:${ref.articleId}`;
}

function isCanonicalItemKey(value: string): boolean {
  return /^(?:question:[1-9]\d*|article:[1-9]\d*|answer:[1-9]\d*:[1-9]\d*)$/.test(value);
}

function normalizeEnterpriseBaseUrl(value: unknown): string {
  if (typeof value !== "string" || !isOriginOnlyInstanceUrl(value)) throw corruptJob();
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase();
    if (
      url.protocol !== "https:" ||
      (hostname !== "stackenterprise.co" && !hostname.endsWith(".stackenterprise.co"))
    ) throw corruptJob();
    return url.origin;
  } catch {
    throw corruptJob();
  }
}

function sameTarget(left: { kind: string }, right: Record<string, unknown>): boolean {
  return left.kind === right.kind;
}

function isStage(value: unknown): value is PersistedContentReplacementJob["stage"] {
  return value === "define" || value === "scan" || value === "review" || value === "apply" ||
    value === "results" || value === "recovery";
}

function isStatus(value: unknown): value is PersistedContentReplacementJob["status"] {
  return value === "idle" || value === "running" || value === "paused" || value === "completed" ||
    value === "failed" || value === "cancelled";
}

function isItemStatus(value: unknown): value is PersistedContentReplacementItem["status"] {
  return value === "pending" || value === "excluded" || value === "ready-to-apply" ||
    value === "applying" || value === "applied" || value === "stale" || value === "failed" ||
    value === "ready-to-recover" || value === "recovering" || value === "recovered" ||
    value === "recovery-conflict" || value === "recovery-failed";
}

function isRecoveryStatus(value: unknown): value is PersistedContentReplacementRecovery["status"] {
  return value === "pending" || value === "ready" || value === "applied" ||
    value === "conflict" || value === "failed";
}

function isRecoveryPreviewStatus(
  value: unknown,
): value is PersistedContentReplacementRecoveryPreview["status"] {
  return value === "recoverable" || value === "already-recovered" || value === "conflict";
}

function isRecoverySnapshotStatus(
  value: unknown,
): value is PersistedContentReplacementJob["recoverySnapshotStatus"] {
  return value === "none" || value === "preparing" || value === "ready" || value === "failed";
}

function isFailureCategory(value: unknown): value is PersistedContentReplacementFailure["category"] {
  return value === "network" || value === "authorization" || value === "validation" ||
    value === "rate-limit" || value === "storage" || value === "server" || value === "unknown";
}

function isProposalField(value: unknown): value is ReplacementOccurrence["field"] {
  return value === "title" || value === "body";
}

function isProtectedReason(value: unknown): value is ReplacementProtectedOccurrence["reason"] {
  return value === "code" || value === "destination" || value === "raw-html-attribute" ||
    value === "raw-html-syntax" || value === "raw-html-hidden";
}

function isArticleType(value: unknown): value is Extract<ReplacementRequestModel, { kind: "article" }>["request"]["type"] {
  return value === "knowledgeArticle" || value === "announcement" || value === "policy" ||
    value === "howToGuide";
}

function compareJobs(left: PersistedContentReplacementJob, right: PersistedContentReplacementJob): number {
  const updatedAtOrder = right.updatedAt < left.updatedAt ? -1 : right.updatedAt > left.updatedAt ? 1 : 0;
  return updatedAtOrder || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
}

function assertJobId(value: unknown): asserts value is string {
  if (!isJobId(value)) throw new TypeError("Content replacement job ID is invalid.");
}

function isJobId(value: unknown): value is string {
  return typeof value === "string" && JOB_ID_PATTERN.test(value);
}

function timestamp(value: unknown): string {
  if (typeof value !== "string") throw corruptJob();
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString() !== value) throw corruptJob();
  return value;
}

function digest(value: unknown): string {
  if (!isSha256Digest(value)) throw corruptJob();
  return value;
}

function boundedString(value: unknown, minimum: number, maximum: number): string {
  if (typeof value !== "string" || value.length < minimum || value.length > maximum) throw corruptJob();
  return value;
}

function contentString(value: unknown): string {
  return boundedString(value, 0, MAX_CONTENT_LENGTH);
}

function optionalContentString(value: unknown): string | undefined {
  return value === undefined ? undefined : contentString(value);
}

function stringList(value: unknown, maximumItems: number, maximumLength: number): string[] {
  return boundedArray(value, maximumItems).map((item) => boundedString(item, 1, maximumLength));
}

function idList(value: unknown): number[] {
  return boundedArray(value, MAX_LIST_ITEMS).map(positiveInteger);
}

function count(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw corruptJob();
  return value;
}

function positiveInteger(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) throw corruptJob();
  return value;
}

function inventoryPage(value: unknown): number {
  const page = positiveInteger(value);
  if (page > MAX_INVENTORY_PAGE) throw corruptJob();
  return page;
}

function arrayValue(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw corruptJob();
  return value;
}

function boundedArray(value: unknown, maximumItems: number): unknown[] {
  const array = arrayValue(value);
  if (array.length > maximumItems) throw corruptJob();
  return array;
}

function plainRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw corruptJob();
  return value as Record<string, unknown>;
}

function exactObject(
  value: unknown,
  allowedKeys: readonly string[],
  optionalKeys: readonly string[] = [],
): Record<string, unknown> {
  const record = plainRecord(value);
  const keys = Object.keys(record);
  const allowed = new Set(allowedKeys);
  const optional = new Set(optionalKeys);
  if (keys.some((key) => !allowed.has(key)) || allowedKeys.some((key) => !optional.has(key) && !keys.includes(key))) {
    throw corruptJob();
  }
  return record;
}

function exactDynamicMap(value: unknown): Record<string, unknown> {
  return plainRecord(value);
}

function cloneSafeDataGraph(value: unknown): unknown {
  try {
    return cloneDataGraphFromDescriptors(value);
  } catch {
    throw corruptJob();
  }
}

function cloneDataGraphFromDescriptors(value: unknown): unknown {
  if (!value || typeof value !== "object") return value;
  type Entry = { key: string; value: unknown };
  type Inspected = { clone: object; entries: Entry[] };
  type Frame = { item: object; clone: object; entries: Entry[]; index: number; depth: number };
  let nodeCount = 0;
  let entryCount = 0;

  const inspect = (item: object, depth: number): Inspected => {
    nodeCount += 1;
    if (nodeCount > MAX_GRAPH_NODES || depth > MAX_GRAPH_DEPTH) throw corruptJob();

    const isArray = Array.isArray(item);
    const prototype = Reflect.getPrototypeOf(item);
    if (
      (isArray && prototype !== Array.prototype) ||
      (!isArray && prototype !== Object.prototype && prototype !== null)
    ) throw corruptJob();

    let arrayLength: number | undefined;
    if (isArray) {
      const lengthDescriptor = Object.getOwnPropertyDescriptor(item, "length");
      if (
        !lengthDescriptor || !("value" in lengthDescriptor) ||
        typeof lengthDescriptor.value !== "number" ||
        !Number.isInteger(lengthDescriptor.value) ||
        lengthDescriptor.value < 0 || lengthDescriptor.value > MAX_SCHEMA_ARRAY_LENGTH
      ) throw corruptJob();
      arrayLength = lengthDescriptor.value;
    }

    const keys = Reflect.ownKeys(item);
    if (keys.length > MAX_SCHEMA_ARRAY_LENGTH + (isArray ? 1 : 0)) throw corruptJob();
    entryCount += keys.length;
    if (entryCount > MAX_GRAPH_ENTRIES) throw corruptJob();
    const entries: Entry[] = [];
    let arrayElementCount = 0;
    for (const key of keys) {
      if (typeof key !== "string") throw corruptJob();
      if (isArray && key === "length") continue;
      if (key === "__proto__" || key === "prototype" || key === "constructor") throw corruptJob();
      if (isArray) {
        if (!isCanonicalArrayIndex(key, arrayLength!)) throw corruptJob();
        arrayElementCount += 1;
      }
      const descriptor = Object.getOwnPropertyDescriptor(item, key);
      if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) throw corruptJob();
      if (typeof descriptor.value === "function") throw corruptJob();
      entries.push({ key, value: descriptor.value });
    }
    if (isArray && arrayElementCount !== arrayLength) throw corruptJob();
    return {
      clone: isArray ? new Array(arrayLength) : Object.create(prototype),
      entries,
    };
  };

  const root = inspect(value as object, 0);
  const seen = new WeakMap<object, object>([[value as object, root.clone]]);
  const active = new WeakSet<object>();
  active.add(value as object);
  const stack: Frame[] = [{
    item: value as object,
    clone: root.clone,
    entries: root.entries,
    index: 0,
    depth: 0,
  }];

  while (stack.length > 0) {
    const frame = stack[stack.length - 1];
    if (frame.index >= frame.entries.length) {
      active.delete(frame.item);
      stack.pop();
      continue;
    }
    const entry = frame.entries[frame.index++];
    let clonedValue = entry.value;
    if (entry.value && typeof entry.value === "object") {
      const child = entry.value as object;
      if (active.has(child)) throw corruptJob();
      const existing = seen.get(child);
      if (existing) {
        clonedValue = existing;
      } else {
        const inspected = inspect(child, frame.depth + 1);
        clonedValue = inspected.clone;
        seen.set(child, inspected.clone);
        active.add(child);
        stack.push({
          item: child,
          clone: inspected.clone,
          entries: inspected.entries,
          index: 0,
          depth: frame.depth + 1,
        });
      }
    }
    Object.defineProperty(frame.clone, entry.key, {
      value: clonedValue,
      enumerable: true,
      configurable: true,
      writable: true,
    });
  }
  return root.clone;
}

function isCanonicalArrayIndex(key: string, length: number): boolean {
  if (!/^(?:0|[1-9]\d*)$/.test(key)) return false;
  const index = Number(key);
  return Number.isSafeInteger(index) && index >= 0 && index < length && String(index) === key;
}

async function openDatabase(): Promise<IDBDatabase> {
  if (typeof globalThis.indexedDB === "undefined") throw storageUnavailable();
  let request: IDBOpenDBRequest;
  try {
    request = globalThis.indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
  } catch {
    throw new Error("Content replacement storage could not be opened.");
  }
  request.onupgradeneeded = () => {
    try {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    } catch {
      try { request.transaction?.abort(); } catch { /* preserve stable open failure */ }
    }
  };
  request.onblocked = () => undefined;
  return new Promise((resolve, reject) => {
    let settled = false;
    request.onsuccess = () => {
      if (settled) {
        request.result.close();
        return;
      }
      settled = true;
      resolve(request.result);
    };
    request.onerror = () => {
      if (settled) return;
      settled = true;
      reject(new Error("Content replacement storage could not be opened."));
    };
    request.onblocked = () => {
      if (settled) return;
      settled = true;
      reject(new Error("Content replacement storage upgrade was blocked."));
    };
  });
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error("Content replacement storage request failed."));
  });
}

function transactionToPromise(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(new Error("Content replacement storage transaction failed."));
    transaction.onabort = () => reject(new Error("Content replacement storage transaction aborted."));
  });
}

function storageUnavailable(): Error {
  return new Error("Content replacement storage is unavailable.");
}

function corruptJob(): TypeError {
  return new TypeError("Stored content replacement job is invalid.");
}
