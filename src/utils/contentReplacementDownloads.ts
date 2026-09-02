import { recordsToCsvWithHeaders } from "./downloads";
import { getDiscoveryPresentation } from "../writeTools/contentReplacement/discovery";
import type {
  PersistedContentReplacementItem,
  PersistedContentReplacementItemStatus,
  PersistedContentReplacementRecoveryResult,
  PersistedContentReplacementResult,
  ReplacementConfiguration,
  ReplacementItemRef,
  ReplacementProposal,
} from "../writeTools/contentReplacement/types";

const CSV_MIME_TYPE = "text/csv;charset=utf-8";

const PREVIEW_HEADERS = [
  "contentType",
  "itemId",
  "questionId",
  "title",
  "webUrl",
  "discoveryMode",
  "coverage",
  "suppliedTargetCount",
  "ruleIds",
  "fields",
  "changedOccurrences",
  "protectedOccurrences",
  "beforeTitle",
  "afterTitle",
  "beforeBodyMarkdown",
  "afterBodyMarkdown",
  "caseSensitive",
  "wholeTerm",
  "replaceInCode",
  "selected",
] as const;

const RESULT_HEADERS = [
  "contentType",
  "itemId",
  "questionId",
  "title",
  "webUrl",
  "discoveryMode",
  "coverage",
  "suppliedTargetCount",
  "status",
  "outcome",
  "attemptCount",
  "changedOccurrences",
  "protectedOccurrences",
  "completedAt",
  "observedRequestChecksum",
] as const;

const EXCEPTION_HEADERS = [
  "contentType",
  "itemId",
  "questionId",
  "title",
  "webUrl",
  "discoveryMode",
  "coverage",
  "suppliedTargetCount",
  "status",
  "category",
  "message",
  "retryable",
  "statusCode",
  "occurredAt",
  "observedRequestChecksum",
] as const;

export interface ReplacementDownloadAnchor {
  href: string;
  download: string;
  click(): void;
  remove(): void;
}

export interface ReplacementDownloadEnvironment {
  createObjectURL(blob: Blob): string;
  revokeObjectURL(url: string): void;
  createAnchor(): ReplacementDownloadAnchor;
  appendAnchor(anchor: ReplacementDownloadAnchor): void;
}

type PreviewInput = ReplacementProposal | PersistedContentReplacementItem;

export function downloadReplacementTemplate(
  environment: ReplacementDownloadEnvironment = browserDownloadEnvironment(),
): void {
  downloadCsv("content-replacement-template.csv", "find,replace", environment);
}

export function createReplacementPreviewCsv(
  input: readonly PreviewInput[],
  configuration: ReplacementConfiguration,
): string {
  const records = sortInputs(input).map((entry) => {
    const proposal = proposalFrom(entry);
    return {
      ...identityRecord(proposal),
      ...discoveryRecord(configuration),
      ruleIds: sortNatural(proposal.appliedRuleIds).join("; "),
      fields: sortNatural([...new Set(proposal.changedOccurrences.map(({ field }) => field))]).join("; "),
      changedOccurrences: proposal.changedOccurrences.length,
      protectedOccurrences: protectedOccurrencesValue(proposal),
      beforeTitle: proposal.fields.title?.beforeMarkdown ?? "",
      afterTitle: proposal.fields.title?.afterMarkdown ?? "",
      beforeBodyMarkdown: proposal.fields.body.beforeMarkdown,
      afterBodyMarkdown: proposal.fields.body.afterMarkdown,
      caseSensitive: configuration.options.caseSensitive,
      wholeTerm: configuration.options.wholeTerm,
      replaceInCode: configuration.options.replaceInCode,
      selected: isPersistedItem(entry) ? entry.included : true,
    };
  });
  return toRfc4180Csv(PREVIEW_HEADERS, records);
}

export function createReplacementResultsCsv(
  items: readonly PersistedContentReplacementItem[],
  configuration: ReplacementConfiguration,
): string {
  const records = sortInputs(items).map((item) => {
    const result = projectResult(item);
    return {
      ...identityRecord(item.proposal),
      ...discoveryRecord(configuration),
      status: item.status,
      outcome: result.outcome,
      attemptCount: item.attemptCount,
      changedOccurrences: item.proposal.changedOccurrences.length,
      protectedOccurrences: item.proposal.protectedOccurrences.length,
      completedAt: result.completedAt,
      observedRequestChecksum: result.observedRequestChecksum,
    };
  });
  return toRfc4180Csv(RESULT_HEADERS, records);
}

export function createReplacementExceptionsCsv(
  items: readonly PersistedContentReplacementItem[],
  configuration: ReplacementConfiguration,
): string {
  const records = sortInputs(items)
    .flatMap((item) => {
      const exception = exceptionDetails(item);
      return exception ? [{
        ...identityRecord(item.proposal),
        ...discoveryRecord(configuration),
        status: item.status,
        ...exception,
      }] : [];
    });
  return toRfc4180Csv(EXCEPTION_HEADERS, records);
}

export function downloadReplacementPreview(
  items: readonly PreviewInput[],
  configuration: ReplacementConfiguration,
  environment: ReplacementDownloadEnvironment = browserDownloadEnvironment(),
): void {
  downloadCsv(
    "content-replacement-preview.csv",
    createReplacementPreviewCsv(items, configuration),
    environment,
  );
}

export function downloadReplacementResults(
  items: readonly PersistedContentReplacementItem[],
  configuration: ReplacementConfiguration,
  environment: ReplacementDownloadEnvironment = browserDownloadEnvironment(),
): void {
  downloadCsv("content-replacement-results.csv", createReplacementResultsCsv(items, configuration), environment);
}

export function downloadReplacementExceptions(
  items: readonly PersistedContentReplacementItem[],
  configuration: ReplacementConfiguration,
  environment: ReplacementDownloadEnvironment = browserDownloadEnvironment(),
): void {
  downloadCsv("content-replacement-exceptions.csv", createReplacementExceptionsCsv(items, configuration), environment);
}

function toRfc4180Csv(
  headers: readonly string[],
  records: readonly Record<string, unknown>[],
): string {
  const header = recordsToCsvWithHeaders(headers, []);
  return records.reduce((csv, record) => {
    const rowWithHeader = recordsToCsvWithHeaders(headers, [record]);
    return `${csv}\r\n${rowWithHeader.slice(header.length + 1)}`;
  }, header);
}

function downloadCsv(
  filename: string,
  contents: string,
  environment: ReplacementDownloadEnvironment,
): void {
  const blob = new Blob([contents], { type: CSV_MIME_TYPE });
  const url = environment.createObjectURL(blob);
  let anchor: ReplacementDownloadAnchor | undefined;
  try {
    anchor = environment.createAnchor();
    anchor.href = url;
    anchor.download = filename;
    environment.appendAnchor(anchor);
    anchor.click();
  } finally {
    try {
      anchor?.remove();
    } finally {
      environment.revokeObjectURL(url);
    }
  }
}

function browserDownloadEnvironment(): ReplacementDownloadEnvironment {
  return {
    createObjectURL: (blob) => URL.createObjectURL(blob),
    revokeObjectURL: (url) => URL.revokeObjectURL(url),
    createAnchor: () => document.createElement("a"),
    appendAnchor: (anchor) => document.body.append(anchor as HTMLAnchorElement),
  };
}

function identityRecord(proposal: ReplacementProposal): Record<string, unknown> {
  const metadata = proposal.metadata ?? proposal.before.metadata;
  return {
    contentType: proposal.before.kind,
    itemId: itemId(proposal.before.ref),
    questionId: proposal.before.ref.kind === "answer" ? proposal.before.ref.questionId : "",
    title: metadata?.titleContext ?? titleFrom(proposal),
    webUrl: metadata?.webUrl ?? "",
  };
}

function discoveryRecord(configuration: ReplacementConfiguration): Record<string, string | number> {
  const { discovery } = configuration;
  return {
    discoveryMode: discovery.mode,
    coverage: getDiscoveryPresentation(discovery).label,
    suppliedTargetCount: discovery.mode === "exact" ? discovery.targetCount : "",
  };
}

function titleFrom(proposal: ReplacementProposal): string {
  return proposal.before.kind === "answer" ? "" : proposal.before.request.title;
}

function itemId(ref: ReplacementItemRef): number {
  if (ref.kind === "question") return ref.questionId;
  if (ref.kind === "answer") return ref.answerId;
  return ref.articleId;
}

function sortInputs<T extends PreviewInput>(input: readonly T[]): T[] {
  return [...input].sort((left, right) => {
    const leftRef = proposalFrom(left).before.ref;
    const rightRef = proposalFrom(right).before.ref;
    return itemId(leftRef) - itemId(rightRef) ||
      kindRank(leftRef.kind) - kindRank(rightRef.kind) ||
      questionContextId(leftRef) - questionContextId(rightRef);
  });
}

function kindRank(kind: ReplacementItemRef["kind"]): number {
  return kind === "question" ? 0 : kind === "answer" ? 1 : 2;
}

function questionContextId(ref: ReplacementItemRef): number {
  if (ref.kind === "article") return -1;
  return ref.questionId;
}

function proposalFrom(input: PreviewInput): ReplacementProposal {
  return isPersistedItem(input) ? input.proposal : input;
}

function isPersistedItem(input: PreviewInput): input is PersistedContentReplacementItem {
  return "proposal" in input;
}

function sortNatural(values: readonly string[]): string[] {
  return [...values].sort(compareNaturalStrings);
}

function compareNaturalStrings(left: string, right: string): number {
  const leftParts = left.match(/\d+|\D+/g) ?? [left];
  const rightParts = right.match(/\d+|\D+/g) ?? [right];
  const length = Math.max(leftParts.length, rightParts.length);
  for (let index = 0; index < length; index += 1) {
    const leftPart = leftParts[index];
    const rightPart = rightParts[index];
    if (leftPart === undefined) return -1;
    if (rightPart === undefined) return 1;
    if (leftPart === rightPart) continue;
    const leftIsNumber = /^\d+$/.test(leftPart);
    const rightIsNumber = /^\d+$/.test(rightPart);
    if (leftIsNumber && rightIsNumber) {
      const numericDifference = Number(leftPart) - Number(rightPart);
      if (numericDifference !== 0) return numericDifference;
    }
    return leftPart < rightPart ? -1 : 1;
  }
  return 0;
}

function exceptionDetails(item: PersistedContentReplacementItem): Record<string, unknown> | null {
  const recoveryResult = item.recovery?.result;
  if (recoveryResult) return recoveryException(recoveryResult);
  if (item.result) {
    const resultException = applyException(item.result);
    if (resultException) return resultException;
  }
  if (item.failure) return {
    category: item.failure.category,
    message: item.failure.message,
    retryable: item.failure.retryable,
    statusCode: item.failure.statusCode ?? "",
    occurredAt: item.failure.occurredAt,
    observedRequestChecksum: "",
  };
  return statusException(item.status);
}

interface ResultProjection {
  outcome: string;
  completedAt: string;
  observedRequestChecksum: string;
}

function projectResult(item: PersistedContentReplacementItem): ResultProjection {
  if (item.recovery?.result) return projectRecoveryResult(item.recovery.result);
  if (item.result) return projectApplyResult(item.result);
  return { outcome: "", completedAt: "", observedRequestChecksum: "" };
}

function projectRecoveryResult(result: PersistedContentReplacementRecoveryResult): ResultProjection {
  switch (result.kind) {
    case "recovered":
    case "conflict":
    case "verification-failed":
      return {
        outcome: result.kind,
        completedAt: result.completedAt,
        observedRequestChecksum: result.observedRequestChecksum,
      };
    default:
      return assertNever(result.kind);
  }
}

function projectApplyResult(result: PersistedContentReplacementResult): ResultProjection {
  switch (result.kind) {
    case "applied":
    case "unchanged":
      return {
        outcome: result.kind,
        completedAt: result.completedAt,
        observedRequestChecksum: result.observedRequestChecksum,
      };
    case "stale":
    case "excluded":
      return { outcome: result.kind, completedAt: result.completedAt, observedRequestChecksum: "" };
    case "verification-failed":
      return {
        outcome: result.kind,
        completedAt: result.completedAt,
        observedRequestChecksum: result.observedRequestChecksum,
      };
    default:
      return assertNever(result);
  }
}

function recoveryException(result: PersistedContentReplacementRecoveryResult): Record<string, unknown> | null {
  switch (result.kind) {
    case "recovered":
      return null;
    case "conflict":
      return auditException(
        "recovery-conflict",
        "The post changed after replacement and was not recovered.",
        result.completedAt,
        result.observedRequestChecksum,
      );
    case "verification-failed":
      return auditException(
        "recovery-verification",
        "The recovered content could not be verified.",
        result.completedAt,
        result.observedRequestChecksum,
      );
    default:
      return assertNever(result.kind);
  }
}

function applyException(result: PersistedContentReplacementResult): Record<string, unknown> | null {
  switch (result.kind) {
    case "applied":
    case "unchanged":
    case "excluded":
      return null;
    case "stale":
      return auditException("stale", "The post changed after review and was not updated.", result.completedAt, "");
    case "verification-failed":
      return auditException(
        "verification",
        "The applied content could not be verified.",
        result.completedAt,
        result.observedRequestChecksum,
      );
    default:
      return assertNever(result);
  }
}

function statusException(status: PersistedContentReplacementItemStatus): Record<string, unknown> | null {
  switch (status) {
    case "stale":
      return auditException("stale", "The post changed after review and was not updated.", "", "");
    case "recovery-conflict":
      return auditException("recovery-conflict", "The post changed after replacement and was not recovered.", "", "");
    case "recovery-failed":
      return auditException("recovery-failed", "The recovery attempt failed.", "", "");
    case "failed":
      return auditException("unknown", "The replacement attempt failed.", "", "");
    case "pending":
    case "excluded":
    case "ready-to-apply":
    case "applying":
    case "applied":
    case "ready-to-recover":
    case "recovering":
    case "recovered":
      return null;
    default:
      return assertNever(status);
  }
}

function auditException(
  category: string,
  message: string,
  occurredAt: string,
  observedRequestChecksum: string,
): Record<string, unknown> {
  return { category, message, retryable: false, statusCode: "", occurredAt, observedRequestChecksum };
}

function protectedOccurrencesValue(proposal: ReplacementProposal): string {
  const counts = new Map<string, number>();
  for (const { reason } of proposal.protectedOccurrences) {
    counts.set(reason, (counts.get(reason) ?? 0) + 1);
  }
  if (counts.size === 0) return "0";
  const reasons = [...counts.entries()]
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    .map(([reason, count]) => `${reason}:${count}`)
    .join(";");
  return `${proposal.protectedOccurrences.length} [${reasons}]`;
}

function assertNever(value: never): never {
  throw new Error(`Unhandled content replacement audit state: ${String(value)}`);
}
