import {
  isOriginOnlyInstanceUrl,
  isSha256Digest,
  sameRef,
  validateExactPriorRequestModel,
  validateConfiguration,
  validateItemRef,
} from "../server/contentReplacementRequestValidation";
import {
  checksumRequestModel,
  createJobFingerprint,
} from "../writeTools/contentReplacement/proposals";
import type {
  ArticlePermissionsRequest,
  InventoryCursor,
  PersistedContentReplacementFailure,
  PersistedContentReplacementItem,
  PersistedContentReplacementRecovery,
  PersistedContentReplacementResult,
  PersistedContentReplacementJob,
  PersistedContentReplacementProgress,
  ReplacementMetadata,
  ReplacementOccurrence,
  ReplacementProposal,
  ReplacementProtectedOccurrence,
  ReplacementRequestModel,
  ReplacementItemRef,
} from "../writeTools/contentReplacement/types";

const DATABASE_NAME = "stack-api-content-replacement";
const DATABASE_VERSION = 1;
const STORE_NAME = "jobs";
const JOB_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const MAX_QUEUE_ITEMS = 100_000;
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
    const jobs = await Promise.all(values.map(parseContentReplacementJob));
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
    for (const item of Object.values(normalized.proposals)) {
      const scannedChecksum = await checksumRequestModel(item.proposal.before);
      const proposedChecksum = await checksumRequestModel(item.proposal.after);
      if (
        scannedChecksum !== item.proposal.scannedRequestChecksum ||
        proposedChecksum !== item.proposal.proposedRequestChecksum
      ) throw corruptJob();
      if (
        item.recovery &&
        await checksumRequestModel(item.recovery.priorRequestModel) !== item.recovery.scannedRequestChecksum
      ) throw corruptJob();
    }
    return normalized;
  } catch {
    throw corruptJob();
  }
}

function normalizeContentReplacementJob(value: unknown): PersistedContentReplacementJob {
  assertSafeDataGraph(value);
  const record = exactObject(value, JOB_KEYS, ["nextRetryAt", "failure"]);
  const configuration = validateConfiguration(record.configuration);
  const baseUrl = stringValue(record.baseUrl);
  const target = exactObject(record.target, ["kind"]);
  const createdAt = timestamp(record.createdAt);
  const updatedAt = timestamp(record.updatedAt);
  if (
    record.schemaVersion !== 1 ||
    !isJobId(record.id) ||
    !isSha256Digest(record.fingerprint) ||
    !isEnterpriseBaseUrl(baseUrl) ||
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
  return {
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
  const record = exactObject(value, ["kind", "ref", "request", "metadata"], ["metadata"]);
  const ref = parseItemRef(record.ref);
  if (record.kind !== ref.kind) throw corruptJob();
  const metadata = record.metadata === undefined ? undefined : parseMetadata(record.metadata);
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
    "observedPostApplyChecksum", "status",
  ], ["observedPostApplyChecksum"]);
  const priorRef = parseItemRef(plainRecord(record.priorRequestModel).ref);
  const priorRequestModel = validateExactPriorRequestModel(record.priorRequestModel, priorRef);
  const scannedRequestChecksum = digest(record.scannedRequestChecksum);
  const proposedRequestChecksum = digest(record.proposedRequestChecksum);
  const observedPostApplyChecksum = record.observedPostApplyChecksum === undefined
    ? undefined
    : digest(record.observedPostApplyChecksum);
  if (
    !priorRequestModel ||
    !sameRef(priorRequestModel.ref, proposal.before.ref) ||
    scannedRequestChecksum !== proposal.scannedRequestChecksum ||
    proposedRequestChecksum !== proposal.proposedRequestChecksum ||
    !isRecoveryStatus(record.status)
  ) throw corruptJob();
  return {
    priorRequestModel,
    scannedRequestChecksum,
    proposedRequestChecksum,
    ...(observedPostApplyChecksum === undefined ? {} : { observedPostApplyChecksum }),
    status: record.status,
  };
}

function parseResult(value: unknown): PersistedContentReplacementResult {
  const record = plainRecord(value);
  if (record.kind === "applied" || record.kind === "recovered") {
    exactObject(record, ["kind", "observedRequestChecksum", "completedAt"]);
    return {
      kind: record.kind,
      observedRequestChecksum: digest(record.observedRequestChecksum),
      completedAt: timestamp(record.completedAt),
    };
  }
  if (
    record.kind === "unchanged" || record.kind === "stale" || record.kind === "excluded" ||
    record.kind === "recovery-conflict"
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

function isEnterpriseBaseUrl(value: string): boolean {
  if (!isOriginOnlyInstanceUrl(value)) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.origin === value && url.hostname.endsWith(".stackenterprise.co");
  } catch {
    return false;
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
    value === "recovery-conflict";
}

function isRecoveryStatus(value: unknown): value is PersistedContentReplacementRecovery["status"] {
  return value === "pending" || value === "ready" || value === "applied" ||
    value === "conflict" || value === "failed";
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

function stringValue(value: unknown): string {
  if (typeof value !== "string") throw corruptJob();
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

function assertSafeDataGraph(value: unknown): void {
  const seen = new WeakSet<object>();
  const active = new WeakSet<object>();
  const visit = (item: unknown): void => {
    if (!item || typeof item !== "object") return;
    if (active.has(item as object)) throw corruptJob();
    if (seen.has(item as object)) return;
    const prototype = Object.getPrototypeOf(item);
    if (Array.isArray(item)) {
      if (prototype !== Array.prototype) throw corruptJob();
    } else if (prototype !== Object.prototype && prototype !== null) {
      throw corruptJob();
    }
    active.add(item as object);
    const descriptors = Object.getOwnPropertyDescriptors(item);
    const keys = Reflect.ownKeys(descriptors);
    if (keys.some((key) => typeof key !== "string")) throw corruptJob();
    if (Array.isArray(item)) {
      const expectedKeys = Array.from({ length: item.length }, (_, index) => String(index));
      const dataKeys = keys.filter((key) => key !== "length");
      if (dataKeys.length !== expectedKeys.length || dataKeys.some((key, index) => key !== expectedKeys[index])) {
        throw corruptJob();
      }
    }
    for (const key of keys) {
      if (key === "length" && Array.isArray(item)) continue;
      if (key === "__proto__" || key === "prototype" || key === "constructor") throw corruptJob();
      const descriptor = descriptors[key as string];
      if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) throw corruptJob();
      visit(descriptor.value);
    }
    active.delete(item as object);
    seen.add(item as object);
  };
  visit(value);
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
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error("Content replacement storage could not be opened."));
    request.onblocked = () => reject(new Error("Content replacement storage upgrade was blocked."));
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
