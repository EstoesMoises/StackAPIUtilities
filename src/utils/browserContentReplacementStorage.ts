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
import {
  normalizeExactTargetProof,
  verifyExactTargetProof,
} from "../writeTools/contentReplacement/exactManifest";
import {
  isJsonWithinUtf8ByteLimit,
  MAX_CONTENT_REPLACEMENT_JOB_BYTES,
  utf8ByteLength,
} from "../writeTools/contentReplacement/limits";
import { MAX_CONTENT_REPLACEMENT_PROPOSALS } from "../writeTools/contentReplacement/jobState";
import type {
  ArticlePermissionsRequest,
  ExactTargetProof,
  InventoryCursor,
  PersistedContentReplacementFailure,
  PersistedContentReplacementActiveOperation,
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
const DATABASE_VERSION = 5;
const STORE_NAME = "jobs";
const ITEM_STORE_NAME = "job-items";
const SUMMARY_INDEX_NAME = "by-summary";
const ITEM_JOB_INDEX_NAME = "by-job";
const SIDECAR_STORAGE_FORMAT = "proposal-sidecars-sha256-merkle-v1";
const SIDECAR_LEAF_DOMAIN = "content-replacement-storage-item\u0000sha256-merkle\u00001\u0000";
const SIDECAR_NODE_DOMAIN = "content-replacement-storage-node\u0000sha256-merkle\u00001\u0000";
const SIDECAR_EMPTY_DOMAIN = "content-replacement-storage-empty\u0000sha256-merkle\u00001\u0000";
const MAX_INCREMENTAL_ITEM_CHANGES = 16;
const SUMMARY_INDEX_PATH = [
  "summary.sortKey",
  "summary.updatedAt",
  "summary.baseUrl",
  "summary.stage",
  "summary.status",
  "summary.mappingCount",
  "summary.proposedPostCount",
  "summary.recoverySnapshotStatus",
  "summary.scanCompatibility",
  "summary.activeOperationKind",
] as const;
const MAX_SUMMARY_PAGE_SIZE = 100;
const MAX_SUMMARY_OFFSET = 1_000_000;
const MAX_DATE_MILLISECONDS = 8_640_000_000_000_000;
const JOB_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const MAX_QUEUE_ITEMS = 100_000;
const MAX_SCHEMA_ARRAY_LENGTH = 100_000;
const MAX_GRAPH_DEPTH = 256;
const BASE_MAX_GRAPH_NODES = 150_000;
const BASE_MAX_GRAPH_ENTRIES = 500_000;
// Queue allowances cover one array slot plus the largest cursor/ref record.
// Proposal allowances cover the ordinary richest canonical article shape:
// metadata, permissions, result, recovery snapshot, and recovery preview, with
// headroom for occurrence evidence. Independent per-object, depth, and content
// limits still reject unusually complex jobs before the 5,000-proposal ceiling.
const MAX_GRAPH_NODES_PER_QUEUE_ITEM = 2;
const MAX_GRAPH_ENTRIES_PER_QUEUE_ITEM = 5;
const MAX_GRAPH_NODES_PER_PROPOSAL = 64;
const MAX_GRAPH_ENTRIES_PER_PROPOSAL = 192;
const MAX_CANONICAL_VALIDATION_CONCURRENCY = 16;
const MAX_PROPOSAL_VALIDATION_CACHE_ENTRIES = 512;
const MAX_PROPOSAL_VALIDATION_CACHE_CHARACTERS = 16 * 1_048_576;
const MAX_INVENTORY_PAGE = 10_000;
const MAX_OCCURRENCES = 100_000;
const MAX_CONTENT_LENGTH = 1_048_576;
const MAX_LIST_ITEMS = 10_000;
const JOB_KEYS = [
  "schemaVersion", "scanCompatibility", "revision", "id", "fingerprint", "baseUrl", "target", "configuration",
  "stage", "status", "inventoryQueue", "detailQueue", "exactProofQueue", "progress", "proposals",
  "recoverySnapshotStatus", "activeOperation", "operationError", "nextRetryAt", "failure", "createdAt", "updatedAt",
] as const;
const LEGACY_JOB_KEYS = [
  "schemaVersion", "revision", "id", "fingerprint", "baseUrl", "target", "configuration",
  "stage", "status", "inventoryQueue", "detailQueue", "progress", "proposals",
  "recoverySnapshotStatus", "activeOperation", "operationError", "nextRetryAt", "failure", "createdAt", "updatedAt",
] as const;
const PROGRESS_KEYS = [
  "apiRequestsCompleted", "questionPages", "answerPages", "articlePages", "searchPages",
  "searchTermsCompleted", "indexedReferences", "answerBearingQuestionsQueued", "zeroAnswerQuestionsSkipped",
  "inventoryItems", "detailsInspected",
  "proposalsFound", "protectedOccurrences", "applyCompleted", "recoveryCompleted",
] as const;
const LEGACY_PROGRESS_KEYS = [
  "questionPages", "answerPages", "articlePages", "inventoryItems", "detailsInspected",
  "proposalsFound", "protectedOccurrences", "applyCompleted", "recoveryCompleted",
] as const;
const SUMMARY_KEYS = [
  "id", "sortKey", "baseUrl", "stage", "status", "mappingCount", "proposedPostCount",
  "recoverySnapshotStatus", "scanCompatibility", "activeOperationKind", "updatedAt",
] as const;
const proposalValidationCache = new Map<string, string>();
let proposalValidationCacheCharacters = 0;

export interface ContentReplacementJobSummary {
  id: string;
  baseUrl: string;
  stage: PersistedContentReplacementJob["stage"];
  status: PersistedContentReplacementJob["status"];
  mappingCount: number;
  proposedPostCount: number;
  recoverySnapshotStatus: PersistedContentReplacementJob["recoverySnapshotStatus"];
  scanCompatibility: PersistedContentReplacementJob["scanCompatibility"];
  activeOperationKind: NonNullable<PersistedContentReplacementJob["activeOperation"]>["kind"] | "none";
  updatedAt: string;
}

export interface ContentReplacementJobSummaryPage {
  jobs: ContentReplacementJobSummary[];
  totalCount: number;
}

interface StoredContentReplacementJobSummary extends ContentReplacementJobSummary {
  sortKey: string;
}

interface StoredContentReplacementJobRecord {
  id: string;
  job: PersistedContentReplacementJob;
  summary: StoredContentReplacementJobSummary;
}

interface StoredNormalizedContentReplacementJobRecord {
  id: string;
  storageFormat: typeof SIDECAR_STORAGE_FORMAT;
  proposalCount: number;
  proposalRoot: string;
  job: PersistedContentReplacementJob;
  summary: StoredContentReplacementJobSummary;
}

interface StoredContentReplacementItemRecord {
  jobId: string;
  jobFingerprint: string;
  itemIndex: number;
  itemKey: string;
  itemDigest: string;
  item: PersistedContentReplacementItem;
}

interface ValidatedStorageSnapshot {
  job: PersistedContentReplacementJob;
  keys: string[];
  keyIndexes: Map<string, number>;
  itemIndexes: number[];
  itemDigests: string[];
  merkleLevels: string[][];
  itemEntryBytes: number[];
  totalJobBytes: number;
  rootRecord: StoredNormalizedContentReplacementJobRecord;
}

interface PreparedStorageSnapshot {
  snapshot: ValidatedStorageSnapshot;
  changedItemKeys: string[] | null;
  expectedProposalRoot?: string;
  expectedProposalCount?: number;
}

let validatedStorageSnapshot: ValidatedStorageSnapshot | null = null;

export async function listContentReplacementJobs({
  offset,
  limit,
}: {
  offset: number;
  limit: number;
}): Promise<ContentReplacementJobSummaryPage> {
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > MAX_SUMMARY_OFFSET ||
    !Number.isSafeInteger(limit) || limit < 1 || limit > MAX_SUMMARY_PAGE_SIZE) {
    throw new TypeError("Content replacement summary page is invalid.");
  }
  const database = await openDatabase();
  try {
    const transaction = database.transaction(STORE_NAME, "readonly");
    const store = transaction.objectStore(STORE_NAME);
    const index = store.index(SUMMARY_INDEX_NAME);
    const [jobs, totalCount] = await Promise.all([
      readSummaryPage(index, offset, limit),
      requestToPromise<number>(index.count()),
      transactionToPromise(transaction),
    ]);
    return { jobs, totalCount };
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
    const transaction = database.transaction([STORE_NAME, ITEM_STORE_NAME], "readonly");
    const itemStore = transaction.objectStore(ITEM_STORE_NAME);
    const [stored, storedItems] = await Promise.all([
      requestValueToPromise<unknown>(transaction.objectStore(STORE_NAME).get(id)),
      requestToPromise<unknown[]>(itemStore.index(ITEM_JOB_INDEX_NAME).getAll(id)),
      transactionToPromise(transaction),
    ]);
    const value = stored.value;
    if (value === undefined) return null;
    const normalizedRecord = storedNormalizedRecordEnvelope(value);
    let snapshot: ValidatedStorageSnapshot;
    if (normalizedRecord) {
      snapshot = await loadNormalizedStorageSnapshot(normalizedRecord, storedItems, id);
    } else {
      if (storedItems.length !== 0) throw corruptJob();
      const job = await parseContentReplacementJob(storedJobValue(value));
      assertStoredRecordCoherence(value, id, job);
      snapshot = await createValidatedStorageSnapshot(job);
    }
    validatedStorageSnapshot = snapshot;
    return snapshot.job;
  } finally {
    database.close();
  }
}

export type ContentReplacementJobSaveResult =
  | { status: "saved"; readonly job?: PersistedContentReplacementJob }
  | { status: "conflict" };

export async function saveContentReplacementJob(
  job: PersistedContentReplacementJob,
  expectedRevision: number | null,
): Promise<ContentReplacementJobSaveResult> {
  const incrementallyPrepared = await prepareIncrementalStorageSnapshot(job, expectedRevision);
  const prepared = incrementallyPrepared ?? {
    snapshot: await createValidatedStorageSnapshot(await parseContentReplacementJob(job)),
    changedItemKeys: null,
  };
  const normalized = prepared.snapshot.job;
  if (
    (expectedRevision !== null && (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0)) ||
    (expectedRevision === null
      ? normalized.revision !== 0
      : expectedRevision === Number.MAX_SAFE_INTEGER || normalized.revision !== expectedRevision + 1)
  ) throw corruptJob();
  const database = await openDatabase();
  try {
    const transaction = database.transaction([STORE_NAME, ITEM_STORE_NAME], "readwrite");
    const transactionPromise = transactionToPromise(transaction);
    const store = transaction.objectStore(STORE_NAME);
    const itemStore = transaction.objectStore(ITEM_STORE_NAME);
    const stored = await requestValueToPromise<unknown>(store.get(normalized.id));
    const actualRevision = storedJobRevision(stored.value, normalized.id);
    if (actualRevision !== expectedRevision) {
      await transactionPromise;
      return { status: "conflict" };
    }
    const actualNormalizedRecord = stored.value === undefined
      ? null
      : storedNormalizedRecordEnvelope(stored.value);
    if (
      prepared.expectedProposalRoot !== undefined && actualNormalizedRecord &&
      (actualNormalizedRecord.proposalRoot !== prepared.expectedProposalRoot ||
        actualNormalizedRecord.proposalCount !== prepared.expectedProposalCount)
    ) throw corruptJob();
    try {
      const rootWrite = requestToPromise(store.put(prepared.snapshot.rootRecord));
      if (prepared.changedItemKeys !== null && actualNormalizedRecord) {
        const itemWrites = prepared.changedItemKeys.map((itemKey) => requestToPromise(
          itemStore.put(storedItemRecord(prepared.snapshot, itemKey)),
        ));
        await Promise.all([rootWrite, ...itemWrites, transactionPromise]);
      } else {
        await replaceStoredSidecars(itemStore, normalized.id, prepared.snapshot);
        await Promise.all([rootWrite, transactionPromise]);
      }
    } catch (error) {
      try { transaction.abort(); } catch { /* preserve the originating storage error */ }
      throw error;
    }
    validatedStorageSnapshot = prepared.snapshot;
    return savedResult(prepared.snapshot.job);
  } finally {
    database.close();
  }
}

function storedJobRevision(value: unknown, expectedId: string): number | null {
  if (value === undefined) return null;
  try {
    const job = storedJobValue(value);
    if (typeof job !== "object" || job === null || Array.isArray(job)) throw corruptJob();
    const id = Object.getOwnPropertyDescriptor(job, "id");
    const revision = Object.getOwnPropertyDescriptor(job, "revision");
    if (
      !id || !("value" in id) || id.value !== expectedId ||
      !revision || !("value" in revision) ||
      !Number.isSafeInteger(revision.value) || revision.value < 0
    ) throw corruptJob();
    return revision.value as number;
  } catch {
    throw corruptJob();
  }
}

function storedJobValue(value: unknown): unknown {
  return storedNormalizedRecordEnvelope(value)?.job ?? storedRecordEnvelope(value)?.job ?? value;
}

function storedNormalizedRecordEnvelope(value: unknown): StoredNormalizedContentReplacementJobRecord | null {
  try {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const format = Object.getOwnPropertyDescriptor(value, "storageFormat");
    if (!format) return null;
    const keys = Reflect.ownKeys(value);
    const expected = new Set(["id", "storageFormat", "proposalCount", "proposalRoot", "job", "summary"]);
    if (keys.length !== expected.size || keys.some((key) => typeof key !== "string" || !expected.has(key))) {
      throw corruptJob();
    }
    const record: Record<string, unknown> = {};
    for (const key of expected) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) throw corruptJob();
      record[key] = descriptor.value;
    }
    if (
      record.storageFormat !== SIDECAR_STORAGE_FORMAT || !isJobId(record.id) ||
      !Number.isSafeInteger(record.proposalCount) || (record.proposalCount as number) < 0 ||
      (record.proposalCount as number) > MAX_CONTENT_REPLACEMENT_PROPOSALS ||
      !isSha256Digest(record.proposalRoot)
    ) throw corruptJob();
    return record as unknown as StoredNormalizedContentReplacementJobRecord;
  } catch {
    throw corruptJob();
  }
}

function storedRecordEnvelope(value: unknown): StoredContentReplacementJobRecord | null {
  try {
    if (!value || typeof value !== "object") return null;
    if (Array.isArray(value)) return null;
    const keys = Reflect.ownKeys(value);
    const wrapperCandidate = keys.includes("job") || keys.includes("summary");
    if (!wrapperCandidate) return null;
    if (keys.length !== 3 || keys.some((key) => typeof key !== "string" ||
      (key !== "id" && key !== "job" && key !== "summary"))) throw corruptJob();
    const id = Object.getOwnPropertyDescriptor(value, "id");
    const job = Object.getOwnPropertyDescriptor(value, "job");
    const summary = Object.getOwnPropertyDescriptor(value, "summary");
    if (!id || !("value" in id) || !id.enumerable ||
      !job || !("value" in job) || !job.enumerable ||
      !summary || !("value" in summary) || !summary.enumerable) throw corruptJob();
    return { id: id.value, job: job.value, summary: summary.value } as StoredContentReplacementJobRecord;
  } catch {
    throw corruptJob();
  }
}

function assertStoredRecordCoherence(
  value: unknown,
  expectedId: string,
  job: PersistedContentReplacementJob,
): void {
  const wrapper = storedNormalizedRecordEnvelope(value) ?? storedRecordEnvelope(value);
  if (!wrapper) return;
  if (wrapper.id !== expectedId || job.id !== expectedId) throw corruptJob();
  try {
    const summary = exactObject(cloneSafeDataGraph(wrapper.summary), SUMMARY_KEYS);
    const expectedSummary = summaryFromJob(job);
    if (SUMMARY_KEYS.some((key) => summary[key] !== expectedSummary[key])) throw corruptJob();
  } catch {
    throw corruptJob();
  }
}

export async function deleteContentReplacementJob(id: string): Promise<void> {
  assertJobId(id);
  const database = await openDatabase();
  try {
    const transaction = database.transaction([STORE_NAME, ITEM_STORE_NAME], "readwrite");
    const itemStore = transaction.objectStore(ITEM_STORE_NAME);
    const requests = [
      requestToPromise(transaction.objectStore(STORE_NAME).delete(id)),
      deleteStoredSidecars(itemStore, id),
      transactionToPromise(transaction),
    ];
    await Promise.all(requests);
    if (validatedStorageSnapshot?.job.id === id) validatedStorageSnapshot = null;
  } finally {
    database.close();
  }
}

function savedResult(job: PersistedContentReplacementJob): ContentReplacementJobSaveResult {
  return { status: "saved", job };
}

async function replaceStoredSidecars(
  store: IDBObjectStore,
  jobId: string,
  snapshot: ValidatedStorageSnapshot,
): Promise<void> {
  const existingKeys = await requestToPromise<IDBValidKey[]>(
    store.index(ITEM_JOB_INDEX_NAME).getAllKeys(jobId),
  );
  const expectedKeys = new Set(snapshot.keys.map((itemKey) => sidecarPrimaryKey(jobId, itemKey)));
  const requests: Array<Promise<unknown>> = [];
  for (const key of existingKeys) {
    if (!expectedKeys.has(serializedPrimaryKey(key))) requests.push(requestToPromise(store.delete(key)));
  }
  for (const itemKey of snapshot.keys) {
    requests.push(requestToPromise(store.put(storedItemRecord(snapshot, itemKey))));
  }
  await Promise.all(requests);
}

async function deleteStoredSidecars(store: IDBObjectStore, jobId: string): Promise<void> {
  const keys = await requestToPromise<IDBValidKey[]>(store.index(ITEM_JOB_INDEX_NAME).getAllKeys(jobId));
  await Promise.all(keys.map((key) => requestToPromise(store.delete(key))));
}

function sidecarPrimaryKey(jobId: string, itemKey: string): string {
  return serializedPrimaryKey([jobId, itemKey]);
}

function serializedPrimaryKey(key: IDBValidKey): string {
  if (Array.isArray(key) && key.length === 2 && key.every((part) => typeof part === "string")) {
    return `${key[0]}\u0000${key[1]}`;
  }
  return "invalid";
}

function storedItemRecord(
  snapshot: ValidatedStorageSnapshot,
  itemKey: string,
): StoredContentReplacementItemRecord {
  const index = snapshot.keyIndexes.get(itemKey);
  if (index === undefined) throw corruptJob();
  return {
    jobId: snapshot.job.id,
    jobFingerprint: snapshot.job.fingerprint,
    itemIndex: snapshot.itemIndexes[index],
    itemKey,
    itemDigest: snapshot.itemDigests[index],
    item: snapshot.job.proposals[itemKey],
  };
}

async function createValidatedStorageSnapshot(
  job: PersistedContentReplacementJob,
): Promise<ValidatedStorageSnapshot> {
  const proposalOrder = Object.keys(job.proposals);
  const proposalIndexes = new Map(proposalOrder.map((itemKey, index) => [itemKey, index]));
  const keys = [...proposalOrder].sort(compareOrdinal);
  const itemIndexes = keys.map((itemKey) => proposalIndexes.get(itemKey)!);
  const itemDigests = await mapCanonicalEntries(keys, (itemKey) =>
    hashStoredItem(
      job.id,
      job.fingerprint,
      proposalIndexes.get(itemKey)!,
      itemKey,
      job.proposals[itemKey],
    ));
  const merkleLevels = await buildStorageMerkleLevels(itemDigests);
  return finalizeValidatedStorageSnapshot(job, keys, itemIndexes, itemDigests, merkleLevels, false);
}

async function loadNormalizedStorageSnapshot(
  record: StoredNormalizedContentReplacementJobRecord,
  storedItems: unknown[],
  expectedId: string,
): Promise<ValidatedStorageSnapshot> {
  if (record.id !== expectedId || record.proposalCount !== storedItems.length) throw corruptJob();
  const rootPreflight = preflightContentReplacementJobRoot(record.job);
  if (rootPreflight.cardinalities.proposals !== 0) throw corruptJob();
  const safeRoot = cloneSafeDataGraph(
    rootPreflight.snapshot,
    contentReplacementGraphBudget({ ...rootPreflight.cardinalities, proposals: record.proposalCount }),
    rootPreflight.sourceSnapshots,
  ) as PersistedContentReplacementJob;
  const items = await mapCanonicalEntries(storedItems, (value) =>
    parseStoredItemRecord(value, record.id, safeRoot.fingerprint, record.proposalCount));
  const seen = new Set<string>();
  const seenIndexes = new Set<number>();
  for (const item of items) {
    if (seen.has(item.itemKey) || seenIndexes.has(item.itemIndex)) throw corruptJob();
    seen.add(item.itemKey);
    seenIndexes.add(item.itemIndex);
  }
  if (items.some((_item, index) => !seenIndexes.has(index))) throw corruptJob();
  items.sort((left, right) => compareOrdinal(left.itemKey, right.itemKey));
  const keys = items.map((item) => item.itemKey);
  const itemIndexes = items.map((item) => item.itemIndex);
  const itemDigests = items.map((item) => item.itemDigest);
  const merkleLevels = await buildStorageMerkleLevels(itemDigests);
  if (storageMerkleRoot(merkleLevels) !== record.proposalRoot) throw corruptJob();
  const proposals = Object.fromEntries(
    [...items].sort((left, right) => left.itemIndex - right.itemIndex)
      .map((item) => [item.itemKey, item.item]),
  );
  safeRoot.proposals = proposals;
  const job = await parseContentReplacementJob(safeRoot);
  if (
    stableSerialize({ ...safeRoot, proposals: {} }) !== stableSerialize({ ...job, proposals: {} }) ||
    keys.some((key, index) => stableSerialize(items[index].item) !== stableSerialize(job.proposals[key]))
  ) throw corruptJob();
  assertStoredRecordCoherence(record, expectedId, job);
  const snapshot = finalizeValidatedStorageSnapshot(job, keys, itemIndexes, itemDigests, merkleLevels, false);
  if (snapshot.rootRecord.proposalRoot !== record.proposalRoot) throw corruptJob();
  return snapshot;
}

async function parseStoredItemRecord(
  value: unknown,
  jobId: string,
  jobFingerprint: string,
  proposalCount: number,
): Promise<StoredContentReplacementItemRecord> {
  try {
    const cloned = cloneSafeDataGraph(
      value,
      contentReplacementGraphBudget({ inventoryQueue: 0, detailQueue: 0, exactProofQueue: 0, proposals: 1 }),
    );
    const record = exactObject(
      cloned,
      ["jobId", "jobFingerprint", "itemIndex", "itemKey", "itemDigest", "item"],
    );
    if (
      record.jobId !== jobId || record.jobFingerprint !== jobFingerprint ||
      !Number.isSafeInteger(record.itemIndex) || (record.itemIndex as number) < 0 ||
      (record.itemIndex as number) >= proposalCount ||
      typeof record.itemKey !== "string" || !isCanonicalItemKey(record.itemKey) ||
      typeof record.itemDigest !== "string" || !isSha256Digest(record.itemDigest)
    ) throw corruptJob();
    const expectedDigest = await hashStoredItem(
      record.jobId,
      record.jobFingerprint,
      record.itemIndex as number,
      record.itemKey as string,
      record.item as PersistedContentReplacementItem,
    );
    if (expectedDigest !== record.itemDigest) throw corruptJob();
    return record as unknown as StoredContentReplacementItemRecord;
  } catch {
    throw corruptJob();
  }
}

async function prepareIncrementalStorageSnapshot(
  candidate: PersistedContentReplacementJob,
  expectedRevision: number | null,
): Promise<PreparedStorageSnapshot | null> {
  const previous = validatedStorageSnapshot;
  if (!previous || expectedRevision === null || previous.job.revision !== expectedRevision) return null;
  try {
    const preflight = preflightContentReplacementJobRoot(candidate);
    if (
      preflight.cardinalities.proposals !== previous.keys.length ||
      preflight.cardinalities.inventoryQueue !== 0 || preflight.cardinalities.detailQueue !== 0 ||
      preflight.cardinalities.exactProofQueue !== 0 ||
      previous.job.inventoryQueue.length !== 0 || previous.job.detailQueue.length !== 0 ||
      (previous.job.exactProofQueue?.length ?? 0) !== 0 ||
      previous.job.activeOperation?.kind === "stale-rescan" ||
      optionalActiveOperationKind(preflight.snapshot) === "stale-rescan"
    ) return null;
    const proposalSnapshot = exactDynamicMap(preflight.snapshot.proposals);
    const candidateOrder = Object.keys(proposalSnapshot);
    const previousOrder = Object.keys(previous.job.proposals);
    if (candidateOrder.some((key, index) => key !== previousOrder[index])) return null;
    const candidateKeys = [...candidateOrder].sort(compareOrdinal);
    if (candidateKeys.some((key, index) => key !== previous.keys[index])) return null;
    const changedItemKeys: string[] = [];
    for (const itemKey of candidateKeys) {
      if (proposalSnapshot[itemKey] !== previous.job.proposals[itemKey]) changedItemKeys.push(itemKey);
    }
    if (changedItemKeys.length > MAX_INCREMENTAL_ITEM_CHANGES) return null;

    const proposals = { ...previous.job.proposals };
    const configuredRuleIds = new Set(previous.job.configuration.rules.map((rule) => rule.id));
    for (const itemKey of changedItemKeys) {
      const sourceItem = proposalSnapshot[itemKey];
      if (ownDataProperty(sourceItem, "proposal") !== previous.job.proposals[itemKey].proposal) return null;
      const safeItem = cloneSafeDataGraph(
        sourceItem,
        contentReplacementGraphBudget({ inventoryQueue: 0, detailQueue: 0, exactProofQueue: 0, proposals: 1 }),
      );
      proposals[itemKey] = {
        ...parsePersistedItem(safeItem, itemKey, configuredRuleIds),
        proposal: previous.job.proposals[itemKey].proposal,
      };
    }
    Object.defineProperty(preflight.snapshot, "proposals", {
      value: {}, enumerable: true, configurable: true, writable: true,
    });
    const safeRoot = cloneSafeDataGraph(
      preflight.snapshot,
      contentReplacementGraphBudget({ ...preflight.cardinalities, proposals: 0 }),
      preflight.sourceSnapshots,
    );
    const normalized = normalizeClonedContentReplacementJob(safeRoot, proposals);
    if (
      normalized.id !== previous.job.id || normalized.fingerprint !== previous.job.fingerprint ||
      normalized.baseUrl !== previous.job.baseUrl || normalized.scanCompatibility !== previous.job.scanCompatibility ||
      stableSerialize(normalized.target) !== stableSerialize(previous.job.target) ||
      stableSerialize(normalized.configuration) !== stableSerialize(previous.job.configuration) ||
      Date.parse(normalized.updatedAt) < Date.parse(previous.job.updatedAt)
    ) return null;
    for (const itemKey of changedItemKeys) {
      await validateRecoveryEvidence(normalized.proposals[itemKey], normalized.updatedAt);
    }

    const itemDigests = [...previous.itemDigests];
    const itemEntryBytes = [...previous.itemEntryBytes];
    for (const itemKey of changedItemKeys) {
      const index = previous.keyIndexes.get(itemKey);
      if (index === undefined) throw corruptJob();
      itemDigests[index] = await hashStoredItem(
        normalized.id,
        normalized.fingerprint,
        previous.itemIndexes[index],
        itemKey,
        normalized.proposals[itemKey],
      );
      itemEntryBytes[index] = storedProposalEntryBytes(itemKey, normalized.proposals[itemKey]);
    }
    const merkleLevels = await updateStorageMerkleLevels(
      previous.merkleLevels,
      itemDigests,
      changedItemKeys.map((itemKey) => previous.keyIndexes.get(itemKey)!),
    );
    const snapshot = finalizeValidatedStorageSnapshot(
      normalized,
      previous.keys,
      previous.itemIndexes,
      itemDigests,
      merkleLevels,
      true,
      itemEntryBytes,
    );
    return {
      snapshot,
      changedItemKeys,
      expectedProposalRoot: previous.rootRecord.proposalRoot,
      expectedProposalCount: previous.keys.length,
    };
  } catch {
    return null;
  }
}

function finalizeValidatedStorageSnapshot(
  job: PersistedContentReplacementJob,
  keys: string[],
  itemIndexes: number[],
  itemDigests: string[],
  merkleLevels: string[][],
  incrementally: boolean,
  knownItemEntryBytes?: number[],
): ValidatedStorageSnapshot {
  const itemEntryBytes = knownItemEntryBytes ?? keys.map((itemKey) =>
    storedProposalEntryBytes(itemKey, job.proposals[itemKey]));
  const rootJob = { ...job, proposals: {} };
  const rootBytes = utf8ByteLength(JSON.stringify(rootJob));
  const totalJobBytes = rootBytes + itemEntryBytes.reduce((total, bytes) => total + bytes, 0) +
    Math.max(0, keys.length - 1);
  if (totalJobBytes > MAX_CONTENT_REPLACEMENT_JOB_BYTES) {
    throw new TypeError("Content replacement job exceeds the 64 MiB storage limit.");
  }
  const frozenJob = incrementally
    ? freezeIncrementalJob(job, new Set(keys.filter((key, index) =>
      validatedStorageSnapshot?.job.proposals[key] !== job.proposals[key] ||
      validatedStorageSnapshot?.itemDigests[index] !== itemDigests[index])))
    : deepFreezeDataGraph(job);
  const proposalRoot = storageMerkleRoot(merkleLevels);
  const rootRecord: StoredNormalizedContentReplacementJobRecord = {
    id: frozenJob.id,
    storageFormat: SIDECAR_STORAGE_FORMAT,
    proposalCount: keys.length,
    proposalRoot,
    job: { ...frozenJob, proposals: {} },
    summary: summaryFromJob(frozenJob),
  };
  return {
    job: frozenJob,
    keys: [...keys],
    keyIndexes: new Map(keys.map((key, index) => [key, index])),
    itemIndexes: [...itemIndexes],
    itemDigests: [...itemDigests],
    merkleLevels: merkleLevels.map((level) => [...level]),
    itemEntryBytes,
    totalJobBytes,
    rootRecord,
  };
}

function storedProposalEntryBytes(itemKey: string, item: PersistedContentReplacementItem): number {
  return utf8ByteLength(JSON.stringify(itemKey)) + 1 + utf8ByteLength(JSON.stringify(item));
}

async function hashStoredItem(
  jobId: string,
  jobFingerprint: string,
  itemIndex: number,
  itemKey: string,
  item: PersistedContentReplacementItem,
): Promise<string> {
  return sha256Storage(
    `${SIDECAR_LEAF_DOMAIN}${stableSerialize([jobId, jobFingerprint, itemIndex, itemKey, item])}`,
  );
}

async function buildStorageMerkleLevels(itemDigests: string[]): Promise<string[][]> {
  if (itemDigests.length === 0) return [[await sha256Storage(SIDECAR_EMPTY_DOMAIN)]];
  const levels = [[...itemDigests]];
  while (levels[levels.length - 1].length > 1) {
    const current = levels[levels.length - 1];
    const pairs = Array.from({ length: Math.ceil(current.length / 2) }, (_, index) => index * 2);
    levels.push(await mapCanonicalEntries(pairs, (index) =>
      hashStorageNode(current[index], current[index + 1] ?? current[index])));
  }
  return levels;
}

async function updateStorageMerkleLevels(
  previousLevels: string[][],
  nextLeaves: string[],
  changedIndexes: number[],
): Promise<string[][]> {
  if (nextLeaves.length === 0) return previousLevels.map((level) => [...level]);
  if (previousLevels.length === 0 || previousLevels[0].length !== nextLeaves.length) throw corruptJob();
  const levels = previousLevels.map((level) => [...level]);
  levels[0] = [...nextLeaves];
  let affected = [...new Set(changedIndexes)];
  for (let level = 0; level < levels.length - 1 && affected.length > 0; level += 1) {
    const current = levels[level];
    const parentIndexes = [...new Set(affected.map((index) => Math.floor(index / 2)))];
    const hashes = await mapCanonicalEntries(parentIndexes, (parentIndex) => {
      const childIndex = parentIndex * 2;
      return hashStorageNode(current[childIndex], current[childIndex + 1] ?? current[childIndex]);
    });
    for (let index = 0; index < parentIndexes.length; index += 1) {
      levels[level + 1][parentIndexes[index]] = hashes[index];
    }
    affected = parentIndexes;
  }
  return levels;
}

function storageMerkleRoot(levels: string[][]): string {
  if (levels.length === 0) throw corruptJob();
  const root = levels[levels.length - 1][0];
  if (!isSha256Digest(root)) throw corruptJob();
  return root;
}

async function hashStorageNode(left: string, right: string): Promise<string> {
  return sha256Storage(`${SIDECAR_NODE_DOMAIN}${left}${right}`);
}

async function sha256Storage(value: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function deepFreezeDataGraph<T>(value: T): T {
  if (!value || typeof value !== "object") return value;
  const seen = new Set<object>();
  const stack = [value as object];
  while (stack.length > 0) {
    const current = stack.pop()!;
    if (seen.has(current)) continue;
    seen.add(current);
    for (const child of Object.values(current)) {
      if (child && typeof child === "object") stack.push(child);
    }
    Object.freeze(current);
  }
  return value;
}

function freezeIncrementalJob(
  job: PersistedContentReplacementJob,
  changedKeys: ReadonlySet<string>,
): PersistedContentReplacementJob {
  for (const key of changedKeys) deepFreezeDataGraph(job.proposals[key]);
  const stack = Object.entries(job)
    .filter(([key]) => key !== "proposals")
    .map(([, value]) => value)
    .filter((value): value is object => Boolean(value) && typeof value === "object");
  const seen = new Set<object>();
  while (stack.length > 0) {
    const current = stack.pop()!;
    if (seen.has(current) || current === job.proposals) continue;
    seen.add(current);
    for (const child of Object.values(current)) {
      if (child && typeof child === "object") stack.push(child);
    }
    Object.freeze(current);
  }
  Object.freeze(job.proposals);
  return Object.freeze(job);
}

function optionalActiveOperationKind(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const descriptor = Object.getOwnPropertyDescriptor(value, "activeOperation");
  if (!descriptor) return undefined;
  if (!("value" in descriptor) || !descriptor.enumerable) throw corruptJob();
  if (descriptor.value === undefined) return undefined;
  return ownDataProperty(descriptor.value, "kind");
}

function summaryFromJob(job: PersistedContentReplacementJob): StoredContentReplacementJobSummary {
  return {
    id: job.id,
    sortKey: summarySortKey(job.updatedAt, job.id),
    baseUrl: job.baseUrl,
    stage: job.stage,
    status: job.status,
    mappingCount: job.configuration.rules.length,
    proposedPostCount: job.progress.proposalsFound,
    recoverySnapshotStatus: job.recoverySnapshotStatus,
    scanCompatibility: job.scanCompatibility,
    activeOperationKind: job.activeOperation?.kind ?? "none",
    updatedAt: job.updatedAt,
  };
}

function summaryFromLegacyJob(value: unknown): StoredContentReplacementJobSummary {
  const source = storedRecordEnvelope(value)?.job ?? value;
  const id = ownDataProperty(source, "id");
  const baseUrl = ownDataProperty(source, "baseUrl");
  const stage = ownDataProperty(source, "stage");
  const status = ownDataProperty(source, "status");
  const recoverySnapshotStatus = ownDataProperty(source, "recoverySnapshotStatus");
  const updatedAt = timestamp(ownDataProperty(source, "updatedAt"));
  const configuration = ownDataProperty(source, "configuration");
  const rules = ownDataProperty(configuration, "rules");
  const progress = ownDataProperty(source, "progress");
  const proposedPostCount = ownDataProperty(progress, "proposalsFound");
  const schemaVersion = ownDataProperty(source, "schemaVersion");
  const scanCompatibility = schemaVersion === 1
    ? "legacy-restart-required"
    : ownDataProperty(source, "scanCompatibility");
  const activeOperationKind = summaryActiveOperationKind(source);
  if (!isJobId(id) || typeof baseUrl !== "string" || normalizeEnterpriseBaseUrl(baseUrl) !== baseUrl ||
    !isStage(stage) || !isStatus(status) || !isRecoverySnapshotStatus(recoverySnapshotStatus) ||
    (schemaVersion !== 1 && schemaVersion !== 2) || !isScanCompatibility(scanCompatibility) ||
    !Array.isArray(rules) || rules.length > MAX_SCHEMA_ARRAY_LENGTH ||
    !Number.isSafeInteger(proposedPostCount) || (proposedPostCount as number) < 0) {
    throw corruptJob();
  }
  return {
    id,
    sortKey: summarySortKey(updatedAt, id),
    baseUrl,
    stage,
    status,
    mappingCount: rules.length,
    proposedPostCount: proposedPostCount as number,
    recoverySnapshotStatus,
    scanCompatibility,
    activeOperationKind,
    updatedAt,
  };
}

function summaryActiveOperationKind(source: unknown): ContentReplacementJobSummary["activeOperationKind"] {
  if (!source || typeof source !== "object" || Array.isArray(source)) throw corruptJob();
  const descriptor = Object.getOwnPropertyDescriptor(source, "activeOperation");
  if (!descriptor) return "none";
  if (!("value" in descriptor) || !descriptor.enumerable) throw corruptJob();
  if (descriptor.value === undefined) return "none";
  const kind = ownDataProperty(descriptor.value, "kind");
  if (kind !== "stale-rescan" && kind !== "recovery-preview" && kind !== "recovery-apply") {
    throw corruptJob();
  }
  return kind;
}

function ownDataProperty(value: unknown, key: string): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw corruptJob();
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor || !("value" in descriptor)) throw corruptJob();
  return descriptor.value;
}

function summarySortKey(updatedAt: string, id: string): string {
  const inverse = MAX_DATE_MILLISECONDS - Date.parse(updatedAt);
  if (!Number.isSafeInteger(inverse) || inverse < 0) throw corruptJob();
  return `${String(inverse).padStart(16, "0")}:${id}`;
}

function readSummaryPage(
  index: IDBIndex,
  offset: number,
  limit: number,
): Promise<ContentReplacementJobSummary[]> {
  return new Promise((resolve, reject) => {
    const jobs: ContentReplacementJobSummary[] = [];
    let advanced = offset === 0;
    const request = index.openKeyCursor();
    request.onerror = () => reject(new Error("Content replacement storage request failed."));
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) {
        resolve(jobs);
        return;
      }
      if (!advanced) {
        advanced = true;
        cursor.advance(offset);
        return;
      }
      jobs.push(summaryFromIndexEntry(cursor.key, cursor.primaryKey));
      if (jobs.length >= limit) {
        resolve(jobs);
        return;
      }
      cursor.continue();
    };
  });
}

function summaryFromIndexEntry(key: IDBValidKey, primaryKey: IDBValidKey): ContentReplacementJobSummary {
  if (!Array.isArray(key) || key.length !== SUMMARY_INDEX_PATH.length || !isJobId(primaryKey)) throw corruptJob();
  const [
    sortKey, updatedAtValue, baseUrl, stage, status, mappingCount, proposedPostCount,
    recoverySnapshotStatus, scanCompatibility,
    activeOperationKind,
  ] = key;
  const updatedAt = timestamp(updatedAtValue);
  if (sortKey !== summarySortKey(updatedAt, primaryKey) ||
    typeof baseUrl !== "string" || normalizeEnterpriseBaseUrl(baseUrl) !== baseUrl ||
    !isStage(stage) || !isStatus(status) || !isRecoverySnapshotStatus(recoverySnapshotStatus) ||
    !isScanCompatibility(scanCompatibility) ||
    !isSummaryActiveOperationKind(activeOperationKind) ||
    !Number.isSafeInteger(mappingCount) || (mappingCount as number) < 0 ||
    !Number.isSafeInteger(proposedPostCount) || (proposedPostCount as number) < 0) throw corruptJob();
  return {
    id: primaryKey,
    baseUrl,
    stage,
    status,
    mappingCount: mappingCount as number,
    proposedPostCount: proposedPostCount as number,
    recoverySnapshotStatus,
    scanCompatibility,
    activeOperationKind,
    updatedAt,
  };
}

export async function parseContentReplacementJob(value: unknown): Promise<PersistedContentReplacementJob> {
  const schemaVersion = contentReplacementSchemaVersion(value);
  if (schemaVersion === 1) {
    const migrated = await migrateLegacyContentReplacementJob(value);
    assertPersistedJobByteBudget(migrated);
    return migrated;
  }
  if (schemaVersion !== 2) throw corruptJob();
  const normalized = normalizeContentReplacementJob(value);
  assertPersistedJobByteBudget(normalized);
  if (normalized.scanCompatibility === "exact-proof-restart-required" &&
    ownDataProperty(value, "scanCompatibility") === "current") {
    const sourceFingerprint = await createJobFingerprint({
      baseUrl: normalized.baseUrl,
      configuration: normalized.configuration,
      scanCompatibility: "current",
    });
    if (normalized.fingerprint !== sourceFingerprint) throw corruptJob();
    const migrated = {
      ...normalized,
      fingerprint: await createJobFingerprint({
        baseUrl: normalized.baseUrl,
        configuration: normalized.configuration,
        scanCompatibility: "exact-proof-restart-required",
      }),
    };
    await validateCurrentContentReplacementJob(migrated);
    return migrated;
  }
  await validateCurrentContentReplacementJob(normalized);
  return normalized;
}

function assertPersistedJobByteBudget(job: PersistedContentReplacementJob): void {
  if (!isJsonWithinUtf8ByteLimit(job, MAX_CONTENT_REPLACEMENT_JOB_BYTES)) {
    throw new TypeError("Content replacement job exceeds the 64 MiB storage limit.");
  }
}

function contentReplacementSchemaVersion(value: unknown): 1 | 2 | null {
  try {
    const schemaVersion = ownDataProperty(value, "schemaVersion");
    return schemaVersion === 1 || schemaVersion === 2 ? schemaVersion : null;
  } catch {
    return null;
  }
}

function validateLegacyConfiguration(
  value: unknown,
): PersistedContentReplacementJob["configuration"] | null {
  try {
    const record = exactObject(value, ["target", "contentTypes", "rules", "options"]);
    return validateConfiguration({
      target: record.target,
      contentTypes: record.contentTypes,
      discovery: { mode: "full" },
      rules: record.rules,
      options: record.options,
    });
  } catch {
    return null;
  }
}

async function createLegacyJobFingerprint(
  baseUrl: string,
  configuration: PersistedContentReplacementJob["configuration"],
): Promise<string> {
  return legacySha256(stableSerialize({
    baseUrl,
    configuration: legacySemanticConfiguration(configuration),
  }));
}

async function createLegacyProposalFingerprint(
  proposal: ReplacementProposal,
  configuration: PersistedContentReplacementJob["configuration"],
): Promise<string> {
  return legacySha256(stableSerialize({
    ref: proposal.before.ref,
    configuration: legacySemanticConfiguration(configuration),
    scannedRequestChecksum: proposal.scannedRequestChecksum,
    proposedRequestChecksum: proposal.proposedRequestChecksum,
  }));
}

function legacySemanticConfiguration(
  configuration: PersistedContentReplacementJob["configuration"],
): unknown {
  return {
    target: configuration.target,
    contentTypes: configuration.contentTypes,
    options: configuration.options,
    rules: configuration.rules
      .map(({ find, replace }) => ({ find, replace }))
      .sort((left, right) => compareOrdinal(left.find, right.find) || compareOrdinal(left.replace, right.replace)),
  };
}

async function legacySha256(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function validateCurrentContentReplacementJob(
  normalized: PersistedContentReplacementJob,
): Promise<void> {
  try {
    const expectedFingerprint = await createJobFingerprint({
      baseUrl: normalized.baseUrl,
      configuration: normalized.configuration,
      scanCompatibility: normalized.scanCompatibility,
    });
    if (expectedFingerprint !== normalized.fingerprint) throw corruptJob();
    await validatePersistedExactProofs(normalized);
    const items = Object.values(normalized.proposals);
    for (let offset = 0; offset < items.length; offset += MAX_CANONICAL_VALIDATION_CONCURRENCY) {
      await Promise.all(
        items.slice(offset, offset + MAX_CANONICAL_VALIDATION_CONCURRENCY)
          .map((item) => validateCanonicalItem(
            item,
            normalized.configuration,
            normalized.scanCompatibility,
            normalized.updatedAt,
          )),
      );
    }
    if (normalized.activeOperation?.kind === "stale-rescan") {
      for (const [key, proposal] of Object.entries(normalized.activeOperation.proposals)) {
        if (canonicalItemKey(proposal.before.ref) !== key || !await isCanonicalPersistedProposal(
          proposal,
          normalized.configuration,
          normalized.scanCompatibility,
        )) throw corruptJob();
      }
    }
  } catch {
    throw corruptJob();
  }
}

async function migrateLegacyContentReplacementJob(value: unknown): Promise<PersistedContentReplacementJob> {
  try {
    const preflight = preflightContentReplacementJobRoot(value, LEGACY_JOB_KEYS);
    const safeValue = cloneSafeDataGraph(
      preflight.snapshot,
      contentReplacementGraphBudget(preflight.cardinalities),
      preflight.sourceSnapshots,
    );
    const record = exactObject(
      safeValue,
      LEGACY_JOB_KEYS,
      ["activeOperation", "operationError", "nextRetryAt", "failure"],
    );
    if (record.schemaVersion !== 1) throw corruptJob();
    const configuration = validateLegacyConfiguration(record.configuration);
    if (!configuration) throw corruptJob();
    const candidate = {
      ...record,
      schemaVersion: 2,
      scanCompatibility: "legacy-restart-required",
      configuration,
      progress: parseLegacyProgress(record.progress),
    };
    const normalized = normalizeContentReplacementJob(candidate);
    if (normalized.fingerprint !== await createLegacyJobFingerprint(normalized.baseUrl, configuration)) {
      throw corruptJob();
    }

    const proposalEntries = await mapCanonicalEntries(
      Object.entries(normalized.proposals),
      ([key, item]) => migrateLegacyItem(item, configuration, normalized.updatedAt)
        .then((migrated) => [key, migrated] as const),
    );
    let activeOperation = normalized.activeOperation;
    if (activeOperation?.kind === "stale-rescan") {
      const proposals = Object.fromEntries(await mapCanonicalEntries(
        Object.entries(activeOperation.proposals),
        ([key, proposal]) => migrateLegacyProposal(proposal, configuration)
          .then((migrated) => [key, migrated] as const),
      ));
      activeOperation = { ...activeOperation, proposals };
    }
    const migrated: PersistedContentReplacementJob = {
      ...normalized,
      fingerprint: await createJobFingerprint({
        baseUrl: normalized.baseUrl,
        configuration,
        scanCompatibility: "legacy-restart-required",
      }),
      proposals: Object.fromEntries(proposalEntries),
      ...(activeOperation === undefined ? {} : { activeOperation }),
    };
    await validateCurrentContentReplacementJob(migrated);
    return migrated;
  } catch {
    throw corruptJob();
  }
}

async function mapCanonicalEntries<T, R>(
  entries: readonly T[],
  map: (entry: T) => Promise<R>,
): Promise<R[]> {
  const mapped: R[] = [];
  for (let offset = 0; offset < entries.length; offset += MAX_CANONICAL_VALIDATION_CONCURRENCY) {
    mapped.push(...await Promise.all(
      entries.slice(offset, offset + MAX_CANONICAL_VALIDATION_CONCURRENCY).map(map),
    ));
  }
  return mapped;
}

async function migrateLegacyItem(
  item: PersistedContentReplacementItem,
  configuration: PersistedContentReplacementJob["configuration"],
  jobUpdatedAt: string,
): Promise<PersistedContentReplacementItem> {
  const proposal = await migrateLegacyProposal(item.proposal, configuration);
  const recovery = item.recovery === undefined
    ? undefined
    : { ...item.recovery, proposalFingerprint: proposal.proposalFingerprint };
  const migrated = { ...item, proposal, ...(recovery === undefined ? {} : { recovery }) };
  await validateRecoveryEvidence(migrated, jobUpdatedAt);
  return migrated;
}

async function migrateLegacyProposal(
  proposal: ReplacementProposal,
  configuration: PersistedContentReplacementJob["configuration"],
): Promise<ReplacementProposal> {
  const canonical = await buildReplacementProposal(proposal.before, configuration);
  if (!canonical) throw corruptJob();
  const legacyFingerprint = await createLegacyProposalFingerprint(canonical, configuration);
  if (stableSerialize({ ...canonical, proposalFingerprint: legacyFingerprint }) !== stableSerialize(proposal)) {
    throw corruptJob();
  }
  return canonical;
}

async function validateCanonicalItem(
  item: PersistedContentReplacementItem,
  configuration: PersistedContentReplacementJob["configuration"],
  scanCompatibility: PersistedContentReplacementJob["scanCompatibility"],
  jobUpdatedAt: string,
): Promise<void> {
  if (!await isCanonicalPersistedProposal(item.proposal, configuration, scanCompatibility)) {
    throw corruptJob();
  }
  await validateRecoveryEvidence(item, jobUpdatedAt);
}

async function isCanonicalPersistedProposal(
  proposal: ReplacementProposal,
  configuration: PersistedContentReplacementJob["configuration"],
  scanCompatibility: PersistedContentReplacementJob["scanCompatibility"],
): Promise<boolean> {
  const serialized = stableSerialize(proposal);
  const key = stableSerialize([
    scanCompatibility,
    currentSemanticConfiguration(configuration),
    proposal.proposalFingerprint,
  ]);
  const cached = proposalValidationCache.get(key);
  if (cached === serialized) {
    proposalValidationCache.delete(key);
    proposalValidationCache.set(key, cached);
    return true;
  }
  const canonical = await buildCanonicalPersistedProposal(proposal, configuration, scanCompatibility);
  if (!canonical || stableSerialize(canonical) !== serialized) return false;
  cacheCanonicalProposal(key, serialized);
  return true;
}

function cacheCanonicalProposal(key: string, serialized: string): void {
  const characters = key.length + serialized.length;
  if (characters > MAX_PROPOSAL_VALIDATION_CACHE_CHARACTERS) return;
  const previous = proposalValidationCache.get(key);
  if (previous !== undefined) {
    proposalValidationCacheCharacters -= key.length + previous.length;
    proposalValidationCache.delete(key);
  }
  proposalValidationCache.set(key, serialized);
  proposalValidationCacheCharacters += characters;
  while (proposalValidationCache.size > MAX_PROPOSAL_VALIDATION_CACHE_ENTRIES ||
    proposalValidationCacheCharacters > MAX_PROPOSAL_VALIDATION_CACHE_CHARACTERS) {
    const oldest = proposalValidationCache.entries().next().value as [string, string] | undefined;
    if (!oldest) break;
    proposalValidationCache.delete(oldest[0]);
    proposalValidationCacheCharacters -= oldest[0].length + oldest[1].length;
  }
}

async function validateRecoveryEvidence(
  item: PersistedContentReplacementItem,
  jobUpdatedAt: string,
): Promise<void> {
  if (!item.recovery) return;
  if (
    stableSerialize(item.recovery.priorRequestModel) !== stableSerialize(item.proposal.before) ||
    await checksumRequestModel(item.recovery.priorRequestModel) !== item.recovery.scannedRequestChecksum ||
    item.recovery.proposalFingerprint !== item.proposal.proposalFingerprint ||
    stableSerialize(item.recovery.exactProof) !== stableSerialize(item.proposal.exactProof)
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

async function buildCanonicalPersistedProposal(
  proposal: ReplacementProposal,
  configuration: PersistedContentReplacementJob["configuration"],
  scanCompatibility: PersistedContentReplacementJob["scanCompatibility"],
): Promise<ReplacementProposal | null> {
  if (scanCompatibility !== "exact-proof-restart-required") {
    return buildReplacementProposal(proposal.before, configuration, proposal.exactProof);
  }
  if (configuration.discovery.mode !== "exact" || proposal.exactProof !== undefined) throw corruptJob();
  const withoutExactDiscovery = {
    ...configuration,
    discovery: { mode: "full" as const },
  };
  const canonical = await buildReplacementProposal(proposal.before, withoutExactDiscovery);
  if (!canonical) return null;
  return {
    ...canonical,
    proposalFingerprint: await legacySha256(stableSerialize({
      ref: canonical.before.ref,
      configuration: currentSemanticConfiguration(configuration),
      scannedRequestChecksum: canonical.scannedRequestChecksum,
      proposedRequestChecksum: canonical.proposedRequestChecksum,
    })),
  };
}

function currentSemanticConfiguration(
  configuration: PersistedContentReplacementJob["configuration"],
): unknown {
  return {
    target: configuration.target,
    contentTypes: configuration.contentTypes,
    discovery: configuration.discovery,
    options: configuration.options,
    rules: configuration.rules
      .map(({ find, replace }) => ({ find, replace }))
      .sort((left, right) => compareOrdinal(left.find, right.find) || compareOrdinal(left.replace, right.replace)),
  };
}

async function validatePersistedExactProofs(job: PersistedContentReplacementJob): Promise<void> {
  const staleProposals = job.activeOperation?.kind === "stale-rescan"
    ? Object.values(job.activeOperation.proposals)
    : [];
  const proposals = [...Object.values(job.proposals).map((item) => item.proposal), ...staleProposals];
  if (job.configuration.discovery.mode !== "exact") {
    if (job.exactProofQueue !== undefined || proposals.some((proposal) => proposal.exactProof !== undefined)) {
      throw corruptJob();
    }
    return;
  }
  if (job.scanCompatibility === "exact-proof-restart-required") {
    if (job.exactProofQueue !== undefined || proposals.some((proposal) => proposal.exactProof !== undefined)) {
      throw corruptJob();
    }
    return;
  }
  if (job.scanCompatibility !== "current" || !job.exactProofQueue ||
    job.exactProofQueue.length !== job.detailQueue.length) throw corruptJob();
  await Promise.all(job.detailQueue.map(async (ref, index) => {
    const proof = job.exactProofQueue![index];
    if (proof.targetIndex !== job.progress.detailsInspected + index ||
      !await verifyExactTargetProof(ref, proof, job.configuration.discovery)) throw corruptJob();
  }));
  await Promise.all(proposals.map(async (proposal) => {
    const proof = proposal.exactProof;
    if (!proof || proof.targetIndex >= job.progress.detailsInspected ||
      !await verifyExactTargetProof(proposal.before.ref, proof, job.configuration.discovery)) throw corruptJob();
  }));
}

function normalizeContentReplacementJob(value: unknown): PersistedContentReplacementJob {
  const preflight = preflightContentReplacementJobRoot(value);
  const safeValue = cloneSafeDataGraph(
    preflight.snapshot,
    contentReplacementGraphBudget(preflight.cardinalities),
    preflight.sourceSnapshots,
  );
  return normalizeClonedContentReplacementJob(safeValue);
}

function normalizeClonedContentReplacementJob(
  safeValue: unknown,
  trustedProposals?: PersistedContentReplacementJob["proposals"],
): PersistedContentReplacementJob {
  const record = exactObject(safeValue, JOB_KEYS, [
    "exactProofQueue", "activeOperation", "operationError", "nextRetryAt", "failure",
  ]);
  const configuration = validateConfiguration(record.configuration);
  const baseUrl = normalizeEnterpriseBaseUrl(record.baseUrl);
  const target = exactObject(record.target, ["kind"]);
  const createdAt = timestamp(record.createdAt);
  const updatedAt = timestamp(record.updatedAt);
  if (
    record.schemaVersion !== 2 ||
    !isScanCompatibility(record.scanCompatibility) ||
    !Number.isSafeInteger(record.revision) ||
    (record.revision as number) < 0 ||
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
  const exactProofQueue = record.exactProofQueue === undefined
    ? undefined
    : boundedArray(record.exactProofQueue, MAX_CONTENT_REPLACEMENT_PROPOSALS).map(parseExactTargetProof);
  const progress = parseProgress(record.progress);
  let normalizedProposals: Record<string, PersistedContentReplacementItem>;
  const configuredRuleIds = new Set(configuration.rules.map((rule) => rule.id));
  if (trustedProposals) {
    normalizedProposals = trustedProposals;
  } else {
    const proposals = exactDynamicMap(record.proposals);
    const proposalEntries = Object.entries(proposals);
    if (proposalEntries.length > MAX_CONTENT_REPLACEMENT_PROPOSALS) throw corruptJob();
    normalizedProposals = {};
    for (const [key, item] of proposalEntries) {
      if (!isCanonicalItemKey(key)) throw corruptJob();
      normalizedProposals[key] = parsePersistedItem(item, key, configuredRuleIds);
    }
  }
  const nextRetryAt = record.nextRetryAt === undefined ? undefined : timestamp(record.nextRetryAt);
  const failure = record.failure === undefined ? undefined : parseFailure(record.failure);
  const operationError = record.operationError === undefined ? undefined : parseFailure(record.operationError);
  const activeOperation = record.activeOperation === undefined
    ? undefined
    : parseActiveOperation(record.activeOperation, normalizedProposals, configuredRuleIds);
  const scanCompatibility = record.scanCompatibility === "current" &&
    configuration.discovery.mode === "exact" && exactProofQueue === undefined
    ? "exact-proof-restart-required"
    : record.scanCompatibility;
  const normalized: PersistedContentReplacementJob = {
    schemaVersion: 2,
    scanCompatibility,
    revision: record.revision as number,
    id: record.id,
    fingerprint: record.fingerprint,
    baseUrl,
    target: { kind: "enterprise-main" },
    configuration,
    stage: record.stage,
    status: record.status,
    inventoryQueue,
    detailQueue,
    ...(exactProofQueue === undefined ? {} : { exactProofQueue }),
    progress,
    proposals: normalizedProposals,
    recoverySnapshotStatus: record.recoverySnapshotStatus,
    ...(activeOperation === undefined ? {} : { activeOperation }),
    ...(operationError === undefined ? {} : { operationError }),
    ...(nextRetryAt === undefined ? {} : { nextRetryAt }),
    ...(failure === undefined ? {} : { failure }),
    createdAt,
    updatedAt,
  };
  assertJobInvariants(normalized);
  return normalized;
}

interface ContentReplacementGraphCardinalities {
  inventoryQueue: number;
  detailQueue: number;
  exactProofQueue: number;
  proposals: number;
}

interface SafeGraphBudget {
  nodes: number;
  entries: number;
}

interface ContentReplacementGraphPreflight {
  snapshot: Record<string, unknown>;
  cardinalities: ContentReplacementGraphCardinalities;
  sourceSnapshots: WeakMap<object, object>;
}

interface PreflightContainerSnapshot {
  snapshot: object;
  cardinality: number;
}

function preflightContentReplacementJobRoot(
  value: unknown,
  jobKeys: readonly string[] = JOB_KEYS,
): ContentReplacementGraphPreflight {
  try {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw corruptJob();
    const prototype = Reflect.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) throw corruptJob();
    const keys = Reflect.ownKeys(value);
    const allowed = new Set<string>(jobKeys);
    const optional = new Set(["exactProofQueue", "activeOperation", "operationError", "nextRetryAt", "failure"]);
    if (
      keys.length > jobKeys.length ||
      keys.some((key) => typeof key !== "string" || !allowed.has(key)) ||
      jobKeys.some((key) => !optional.has(key) && !keys.includes(key))
    ) throw corruptJob();
    const snapshot = Object.create(prototype) as Record<string, unknown>;
    const sourceSnapshots = new WeakMap<object, object>();
    sourceSnapshots.set(value, snapshot);
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !("value" in descriptor) || !descriptor.enumerable || typeof descriptor.value === "function") {
        throw corruptJob();
      }
      Object.defineProperty(snapshot, key, {
        value: descriptor.value,
        enumerable: true,
        configurable: true,
        writable: true,
      });
    }
    const inventoryQueue = preflightArraySnapshot(snapshot.inventoryQueue, MAX_QUEUE_ITEMS, sourceSnapshots);
    const detailQueue = preflightArraySnapshot(snapshot.detailQueue, MAX_QUEUE_ITEMS, sourceSnapshots);
    const exactProofQueue = snapshot.exactProofQueue === undefined
      ? { snapshot: undefined, cardinality: 0 }
      : preflightArraySnapshot(snapshot.exactProofQueue, MAX_CONTENT_REPLACEMENT_PROPOSALS, sourceSnapshots);
    const proposals = preflightProposalSnapshot(snapshot.proposals, sourceSnapshots);
    snapshot.inventoryQueue = inventoryQueue.snapshot;
    snapshot.detailQueue = detailQueue.snapshot;
    if (exactProofQueue.snapshot !== undefined) snapshot.exactProofQueue = exactProofQueue.snapshot;
    snapshot.proposals = proposals.snapshot;
    return {
      snapshot,
      cardinalities: {
        inventoryQueue: inventoryQueue.cardinality,
        detailQueue: detailQueue.cardinality,
        exactProofQueue: exactProofQueue.cardinality,
        proposals: proposals.cardinality,
      },
      sourceSnapshots,
    };
  } catch {
    throw corruptJob();
  }
}

function preflightArraySnapshot(
  value: unknown,
  maximum: number,
  sourceSnapshots: WeakMap<object, object>,
): PreflightContainerSnapshot {
  if (value && typeof value === "object") {
    const existing = sourceSnapshots.get(value);
    if (existing) {
      return { snapshot: existing, cardinality: Array.isArray(existing) ? existing.length : 0 };
    }
  }
  if (!Array.isArray(value) || Reflect.getPrototypeOf(value) !== Array.prototype) throw corruptJob();
  const length = Object.getOwnPropertyDescriptor(value, "length");
  if (!length || !("value" in length) || !Number.isInteger(length.value) || length.value < 0 || length.value > maximum) {
    throw corruptJob();
  }
  const keys = Reflect.ownKeys(value);
  if (keys.length !== length.value + 1) throw corruptJob();
  const snapshot = new Array(length.value as number);
  sourceSnapshots.set(value, snapshot);
  let elementCount = 0;
  for (const key of keys) {
    if (key === "length") continue;
    if (typeof key !== "string" || !isCanonicalArrayIndex(key, length.value as number)) throw corruptJob();
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable || typeof descriptor.value === "function") {
      throw corruptJob();
    }
    snapshot[Number(key)] = descriptor.value;
    elementCount += 1;
  }
  if (elementCount !== length.value) throw corruptJob();
  return { snapshot, cardinality: length.value as number };
}

function preflightProposalSnapshot(
  value: unknown,
  sourceSnapshots: WeakMap<object, object>,
): PreflightContainerSnapshot {
  if (value && typeof value === "object") {
    const existing = sourceSnapshots.get(value);
    if (existing) {
      return {
        snapshot: existing,
        cardinality: Array.isArray(existing) ? 0 : Object.keys(existing).length,
      };
    }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw corruptJob();
  const prototype = Reflect.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw corruptJob();
  const keys = Reflect.ownKeys(value);
  if (
    keys.length > MAX_CONTENT_REPLACEMENT_PROPOSALS ||
    keys.some((key) => typeof key !== "string" || !isCanonicalItemKey(key))
  ) throw corruptJob();
  const snapshot = Object.create(prototype) as Record<string, unknown>;
  sourceSnapshots.set(value, snapshot);
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable || typeof descriptor.value === "function") {
      throw corruptJob();
    }
    Object.defineProperty(snapshot, key, {
      value: descriptor.value,
      enumerable: true,
      configurable: true,
      writable: true,
    });
  }
  return { snapshot, cardinality: keys.length };
}

function contentReplacementGraphBudget(
  cardinalities: ContentReplacementGraphCardinalities,
): SafeGraphBudget {
  const queueItems = cardinalities.inventoryQueue + cardinalities.detailQueue + cardinalities.exactProofQueue;
  return {
    nodes: BASE_MAX_GRAPH_NODES +
      queueItems * MAX_GRAPH_NODES_PER_QUEUE_ITEM +
      cardinalities.proposals * MAX_GRAPH_NODES_PER_PROPOSAL,
    entries: BASE_MAX_GRAPH_ENTRIES +
      queueItems * MAX_GRAPH_ENTRIES_PER_QUEUE_ITEM +
      cardinalities.proposals * MAX_GRAPH_ENTRIES_PER_PROPOSAL,
  };
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
    (job.scanCompatibility === "legacy-restart-required" && job.configuration.discovery.mode !== "full") ||
    (job.scanCompatibility === "exact-proof-restart-required" && job.configuration.discovery.mode !== "exact") ||
    job.progress.proposalsFound !== items.length ||
    job.progress.detailsInspected < job.progress.proposalsFound ||
    (job.configuration.discovery.mode !== "exact" &&
      job.progress.inventoryItems < job.progress.detailsInspected) ||
    !Number.isSafeInteger(protectedOccurrences) ||
    job.progress.protectedOccurrences < protectedOccurrences ||
    job.progress.applyCompleted !== applyCompleted ||
    job.progress.recoveryCompleted !== recoveryCompleted ||
    (!job.configuration.contentTypes.answers && job.progress.answerPages !== 0) ||
    (!job.configuration.contentTypes.articles && job.progress.articlePages !== 0) ||
    (!(job.configuration.contentTypes.questions || job.configuration.contentTypes.answers) &&
      job.progress.questionPages !== 0) ||
    (job.configuration.discovery.mode !== "targeted" &&
      (job.progress.searchPages !== 0 || job.progress.searchTermsCompleted !== 0 ||
        job.progress.indexedReferences !== 0)) ||
    (job.configuration.discovery.mode !== "full" &&
      (job.progress.answerBearingQuestionsQueued !== 0 || job.progress.zeroAnswerQuestionsSkipped !== 0)) ||
    (job.configuration.discovery.mode === "exact" &&
      (job.progress.inventoryItems !== 0 ||
        job.inventoryQueue.length !== 0 ||
        job.progress.detailsInspected > job.configuration.discovery.targetCount ||
        job.detailQueue.length > job.configuration.discovery.targetCount ||
        job.progress.apiRequestsCompleted !== job.progress.detailsInspected ||
        job.progress.detailsInspected + job.detailQueue.length !== job.configuration.discovery.targetCount)) ||
    job.inventoryQueue.some((cursor) => !isInventoryCursorRelevant(cursor, job.configuration)) ||
    job.detailQueue.some((ref) => !isItemRefRelevant(ref, job.configuration)) ||
    items.some((item) => !isItemRefRelevant(item.proposal.before.ref, job.configuration))
  ) throw corruptJob();

  if ((job.status === "failed") !== (job.failure !== undefined)) throw corruptJob();
  if (job.operationError && (job.status !== "paused" || !isWithinJobTime(job.operationError.occurredAt, job))) {
    throw corruptJob();
  }
  if (job.failure && !isWithinJobTime(job.failure.occurredAt, job)) throw corruptJob();
  for (const item of items) {
    assertItemInvariants(item, job.recoverySnapshotStatus);
    if (item.result && !isWithinJobTime(item.result.completedAt, job)) throw corruptJob();
    if (item.recovery?.result && !isWithinJobTime(item.recovery.result.completedAt, job)) {
      throw corruptJob();
    }
    if (item.failure && !isWithinJobTime(item.failure.occurredAt, job)) throw corruptJob();
  }
  if (job.activeOperation) {
    const consumedCount = job.activeOperation.requestedItemKeys.length - job.activeOperation.remainingItemKeys.length;
    const consumed = job.activeOperation.requestedItemKeys.slice(0, consumedCount);
    if (!isWithinJobTime(job.activeOperation.generation, job) ||
      !isNonemptyExactSuffix(job.activeOperation.requestedItemKeys, job.activeOperation.remainingItemKeys) ||
      job.activeOperation.completedItemKeys.length !== consumed.length ||
      job.activeOperation.completedItemKeys.some((key, index) => key !== consumed[index])) {
      throw corruptJob();
    }
    if (job.activeOperation.kind === "recovery-preview" &&
      (job.stage !== "recovery" ||
        job.activeOperation.remainingItemKeys.some((key) => !hasSuccessfulApplyEvidence(job.proposals[key])) ||
        consumed.some((key) => !hasCompletedRecoveryPreviewEvidence(
          job.proposals[key], job.activeOperation!.generation,
        )))) {
      throw corruptJob();
    }
    if (job.activeOperation.kind === "recovery-apply" &&
      (job.stage !== "recovery" || job.activeOperation.remainingItemKeys.some((key) => {
        const item = job.proposals[key];
        return item.status !== "ready-to-recover" && item.status !== "recovering";
      }) || consumed.some((key) => !hasCompletedRecoveryApplyEvidence(
        job.proposals[key], job.activeOperation!.generation,
      )))) throw corruptJob();
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
    results: new Set(["running", "paused", "completed", "failed"]),
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
  if (job.stage === "results" && (job.status === "running" || job.status === "paused") &&
    job.activeOperation?.kind !== "stale-rescan") throw corruptJob();
  if (items.some((item) => !allowedStatuses[job.stage].has(item.status) && !(
    job.stage === "recovery" && job.scanCompatibility === "legacy-restart-required" &&
    (item.status === "pending" || item.status === "ready-to-apply" || item.status === "applying")
  ))) throw corruptJob();
  if (job.activeOperation?.kind === "stale-rescan") {
    if (job.stage !== "results" || job.status === "completed") throw corruptJob();
    const requested = new Set(job.activeOperation.requestedItemKeys);
    const consumedCount = job.activeOperation.requestedItemKeys.length - job.activeOperation.remainingItemKeys.length;
    const consumed = job.activeOperation.requestedItemKeys.slice(0, consumedCount);
    const consumedSet = new Set(consumed);
    if (requested.size !== job.activeOperation.requestedItemKeys.length ||
      job.activeOperation.remainingItemKeys.some((key) => !requested.has(key) || job.proposals[key]?.status !== "stale") ||
      job.activeOperation.inspectedCount !== consumed.length ||
      Object.keys(job.activeOperation.proposals).some((key) => !consumedSet.has(key))) throw corruptJob();
  }
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
    if (result?.kind === "verification-failed" &&
      (result.expectedRequestChecksum !== item.proposal.proposedRequestChecksum ||
        result.observedRequestChecksum === result.expectedRequestChecksum ||
        failure?.category !== "validation" || failure.retryable)) throw corruptJob();
    if (!recovery && snapshotStatus === "none") {
      if (item.attemptCount < 1 || (result && result.kind !== "verification-failed") || !failure) throw corruptJob();
      return;
    }
    if (
      item.attemptCount < 1 || (result && result.kind !== "verification-failed") || !failure || !isCompleteRecoverySnapshot(recovery) ||
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
      recovery.result.observedRequestChecksum !== recovery.scannedRequestChecksum ||
      Date.parse(result?.completedAt ?? "") > Date.parse(recovery.result.completedAt)
    ) throw corruptJob();
    return;
  }
  if (status === "recovery-conflict") {
    if (
      !hasSuccessfulApplyEvidence(item) || failure || !recovery || recovery.preview ||
      recovery.status !== "conflict" ||
      (recovery.result?.kind !== "conflict" && recovery.result?.kind !== "verification-failed") ||
      !matchesRecoveryGeneration(item, recovery.result) ||
      recovery.result.observedRequestChecksum === recovery.scannedRequestChecksum ||
      (recovery.result.kind === "conflict" &&
        recovery.result.observedRequestChecksum === recovery.observedPostApplyChecksum) ||
      Date.parse(result?.completedAt ?? "") > Date.parse(recovery.result.completedAt)
    ) throw corruptJob();
    if (recovery.result.kind === "verification-failed" &&
      (recovery.result.expectedRequestChecksum !== recovery.scannedRequestChecksum ||
        recovery.result.observedRequestChecksum === recovery.result.expectedRequestChecksum)) throw corruptJob();
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
  if (configuration.discovery.mode === "exact") return false;
  if (configuration.discovery.mode === "targeted") {
    return cursor.kind === "search" && configuration.rules.some((rule) => rule.id === cursor.ruleId);
  }
  if (cursor.kind === "questions") {
    return configuration.contentTypes.questions || configuration.contentTypes.answers;
  }
  if (cursor.kind === "answers") return configuration.contentTypes.answers;
  return cursor.kind === "articles" && configuration.contentTypes.articles;
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
    "exactProof", "fields", "changedOccurrences", "protectedOccurrences", "appliedRuleIds", "metadata",
  ], ["exactProof", "metadata"]);
  const before = parseRequestModel(record.before);
  const after = parseRequestModel(record.after);
  if (!sameRef(before.ref, after.ref) || canonicalItemKey(before.ref) !== itemKey) throw corruptJob();
  const scannedRequestChecksum = digest(record.scannedRequestChecksum);
  const proposedRequestChecksum = digest(record.proposedRequestChecksum);
  const proposalFingerprint = digest(record.proposalFingerprint);
  const exactProof = record.exactProof === undefined ? undefined : parseExactTargetProof(record.exactProof);
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
    ...(exactProof === undefined ? {} : { exactProof }),
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
    "proposalFingerprint", "exactProof", "observedPostApplyChecksum", "status", "preview", "result",
  ], ["proposalFingerprint", "exactProof", "observedPostApplyChecksum", "preview", "result"]);
  const priorRequestModel = parseRequestModel(record.priorRequestModel);
  const scannedRequestChecksum = digest(record.scannedRequestChecksum);
  const proposedRequestChecksum = digest(record.proposedRequestChecksum);
  const proposalFingerprint = record.proposalFingerprint === undefined
    ? proposal.proposalFingerprint
    : digest(record.proposalFingerprint);
  const exactProof = record.exactProof === undefined
    ? proposal.exactProof
    : parseExactTargetProof(record.exactProof);
  const observedPostApplyChecksum = record.observedPostApplyChecksum === undefined
    ? undefined
    : digest(record.observedPostApplyChecksum);
  if (
    !sameRef(priorRequestModel.ref, proposal.before.ref) ||
    scannedRequestChecksum !== proposal.scannedRequestChecksum ||
    proposedRequestChecksum !== proposal.proposedRequestChecksum ||
    proposalFingerprint !== proposal.proposalFingerprint ||
    stableSerialize(exactProof) !== stableSerialize(proposal.exactProof) ||
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
    proposalFingerprint,
    ...(exactProof === undefined ? {} : { exactProof }),
    ...(observedPostApplyChecksum === undefined ? {} : { observedPostApplyChecksum }),
    status: record.status,
    ...(preview === undefined ? {} : { preview }),
    ...(result === undefined ? {} : { result }),
  };
}

function parseRecoveryResult(value: unknown): PersistedContentReplacementRecoveryResult {
  const raw = plainRecord(value);
  const verification = raw.kind === "verification-failed";
  const record = exactObject(raw, [
    "kind", "observedRequestChecksum", "expectedRequestChecksum", "sourceAttemptCount", "sourceApplyCompletedAt", "completedAt",
  ], verification ? [] : ["expectedRequestChecksum"]);
  if (record.kind !== "recovered" && record.kind !== "conflict" && !verification) throw corruptJob();
  const kind = verification ? "verification-failed" : record.kind as "recovered" | "conflict";
  return {
    kind,
    observedRequestChecksum: digest(record.observedRequestChecksum),
    ...(verification ? { expectedRequestChecksum: digest(record.expectedRequestChecksum) } : {}),
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
  if (record.kind === "verification-failed") {
    exactObject(record, ["kind", "expectedRequestChecksum", "observedRequestChecksum", "completedAt"]);
    return {
      kind: "verification-failed",
      expectedRequestChecksum: digest(record.expectedRequestChecksum),
      observedRequestChecksum: digest(record.observedRequestChecksum),
      completedAt: timestamp(record.completedAt),
    };
  }
  throw corruptJob();
}

function parseActiveOperation(
  value: unknown,
  proposals: PersistedContentReplacementJob["proposals"],
  configuredRuleIds: ReadonlySet<string>,
): PersistedContentReplacementActiveOperation {
  const raw = plainRecord(value);
  const common = ["kind", "requestedItemKeys", "remainingItemKeys", "completedItemKeys", "generation"] as const;
  const requestedItemKeys = stringList(raw.requestedItemKeys, MAX_QUEUE_ITEMS, 200);
  const remainingItemKeys = stringList(raw.remainingItemKeys, MAX_QUEUE_ITEMS, 200);
  const completedItemKeys = stringList(raw.completedItemKeys, MAX_QUEUE_ITEMS, 200);
  if (requestedItemKeys.some((key) => !isCanonicalItemKey(key) || !proposals[key]) ||
    remainingItemKeys.some((key) => !isCanonicalItemKey(key) || !proposals[key])) throw corruptJob();
  const generation = timestamp(raw.generation);
  if (raw.kind === "recovery-preview" || raw.kind === "recovery-apply") {
    exactObject(raw, common);
    return { kind: raw.kind, requestedItemKeys, remainingItemKeys, completedItemKeys, generation };
  }
  if (raw.kind !== "stale-rescan") throw corruptJob();
  exactObject(raw, [...common, "proposals", "inspectedCount", "protectedOccurrenceCount"]);
  const candidateMap = exactDynamicMap(raw.proposals);
  const parsed: Record<string, ReplacementProposal> = {};
  for (const [key, candidate] of Object.entries(candidateMap)) {
    if (!isCanonicalItemKey(key)) throw corruptJob();
    parsed[key] = parseProposal(candidate, key, configuredRuleIds);
  }
  return {
    kind: "stale-rescan", requestedItemKeys, remainingItemKeys, generation,
    completedItemKeys,
    proposals: parsed,
    inspectedCount: count(raw.inspectedCount),
    protectedOccurrenceCount: count(raw.protectedOccurrenceCount),
  };
}

function isNonemptyExactSuffix(requested: readonly string[], remaining: readonly string[]): boolean {
  if (requested.length === 0 || remaining.length === 0 || remaining.length > requested.length ||
    new Set(requested).size !== requested.length || new Set(remaining).size !== remaining.length) return false;
  const offset = requested.length - remaining.length;
  return remaining.every((key, index) => key === requested[offset + index]);
}

function hasCompletedRecoveryPreviewEvidence(
  item: PersistedContentReplacementItem,
  generation: string,
): boolean {
  if (!hasSuccessfulApplyEvidence(item)) return false;
  if (item.status === "ready-to-recover" && item.recovery?.preview) {
    return Date.parse(item.recovery.preview.previewedAt) >= Date.parse(generation);
  }
  return item.status === "recovery-failed" && !!item.failure &&
    item.recovery?.status === "failed" && Date.parse(item.failure.occurredAt) >= Date.parse(generation);
}

function hasCompletedRecoveryApplyEvidence(
  item: PersistedContentReplacementItem,
  generation: string,
): boolean {
  if (!hasSuccessfulApplyEvidence(item)) return false;
  if (item.status === "recovered" || item.status === "recovery-conflict") {
    return !!item.recovery?.result && Date.parse(item.recovery.result.completedAt) >= Date.parse(generation);
  }
  return item.status === "recovery-failed" && !!item.failure &&
    item.recovery?.status === "failed" && Date.parse(item.failure.occurredAt) >= Date.parse(generation);
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

function parseLegacyProgress(value: unknown): PersistedContentReplacementProgress {
  const record = exactObject(value, LEGACY_PROGRESS_KEYS);
  return {
    apiRequestsCompleted: 0,
    questionPages: count(record.questionPages),
    answerPages: count(record.answerPages),
    articlePages: count(record.articlePages),
    searchPages: 0,
    searchTermsCompleted: 0,
    indexedReferences: 0,
    answerBearingQuestionsQueued: 0,
    zeroAnswerQuestionsSkipped: 0,
    inventoryItems: count(record.inventoryItems),
    detailsInspected: count(record.detailsInspected),
    proposalsFound: count(record.proposalsFound),
    protectedOccurrences: count(record.protectedOccurrences),
    applyCompleted: count(record.applyCompleted),
    recoveryCompleted: count(record.recoveryCompleted),
  };
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
  if (record.kind === "search") {
    exactObject(record, ["kind", "ruleId", "page"]);
    return {
      kind: "search",
      ruleId: boundedString(record.ruleId, 1, 200),
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

function parseExactTargetProof(value: unknown): ExactTargetProof {
  const proof = normalizeExactTargetProof(value);
  if (!proof || proof.targetCount > MAX_CONTENT_REPLACEMENT_PROPOSALS) throw corruptJob();
  return proof;
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

function isSummaryActiveOperationKind(
  value: unknown,
): value is ContentReplacementJobSummary["activeOperationKind"] {
  return value === "none" || value === "stale-rescan" ||
    value === "recovery-preview" || value === "recovery-apply";
}

function isScanCompatibility(
  value: unknown,
): value is PersistedContentReplacementJob["scanCompatibility"] {
  return value === "current" || value === "legacy-restart-required" ||
    value === "exact-proof-restart-required";
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

function compareOrdinal(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
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

function cloneSafeDataGraph(
  value: unknown,
  budget: SafeGraphBudget = { nodes: BASE_MAX_GRAPH_NODES, entries: BASE_MAX_GRAPH_ENTRIES },
  sourceSnapshots?: WeakMap<object, object>,
): unknown {
  try {
    return cloneDataGraphFromDescriptors(value, budget, sourceSnapshots);
  } catch {
    throw corruptJob();
  }
}

function cloneDataGraphFromDescriptors(
  value: unknown,
  budget: SafeGraphBudget,
  sourceSnapshots?: WeakMap<object, object>,
): unknown {
  if (!value || typeof value !== "object") return value;
  type Entry = { key: string; value: unknown };
  type Inspected = { clone: object; entries: Entry[] };
  type Frame = { item: object; clone: object; entries: Entry[]; index: number; depth: number };
  let nodeCount = 0;
  let entryCount = 0;

  const inspect = (item: object, depth: number): Inspected => {
    nodeCount += 1;
    if (nodeCount > budget.nodes || depth > MAX_GRAPH_DEPTH) throw corruptJob();

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
    if (entryCount > budget.entries) throw corruptJob();
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
      const sourceChild = entry.value as object;
      const child = sourceSnapshots?.get(sourceChild) ?? sourceChild;
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
  request.onupgradeneeded = (event) => {
    try {
      const store = request.result.objectStoreNames.contains(STORE_NAME)
        ? request.transaction!.objectStore(STORE_NAME)
        : request.result.createObjectStore(STORE_NAME, { keyPath: "id" });
      if (event.oldVersion < 4 && store.indexNames.contains(SUMMARY_INDEX_NAME)) {
        store.deleteIndex(SUMMARY_INDEX_NAME);
      }
      if (!store.indexNames.contains(SUMMARY_INDEX_NAME)) {
        store.createIndex(SUMMARY_INDEX_NAME, [...SUMMARY_INDEX_PATH], { unique: true });
      }
      const itemStore = request.result.objectStoreNames.contains(ITEM_STORE_NAME)
        ? request.transaction!.objectStore(ITEM_STORE_NAME)
        : request.result.createObjectStore(ITEM_STORE_NAME, { keyPath: ["jobId", "itemKey"] });
      if (!itemStore.indexNames.contains(ITEM_JOB_INDEX_NAME)) {
        itemStore.createIndex(ITEM_JOB_INDEX_NAME, "jobId", { unique: false });
      }
      if (event.oldVersion < 4) {
        const cursorRequest = store.openCursor();
        cursorRequest.onsuccess = () => {
          const cursor = cursorRequest.result;
          if (!cursor) return;
          const value = cursor.value;
          try {
            const summary = summaryFromLegacyJob(value);
            cursor.update({ id: summary.id, job: storedJobValue(value) as PersistedContentReplacementJob, summary });
          } catch {
            // Root-corrupt legacy records remain unindexed and are rejected if explicitly opened.
          }
          cursor.continue();
        };
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

function requestValueToPromise<T>(request: IDBRequest<T>): Promise<{ value: T }> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve({ value: request.result });
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
