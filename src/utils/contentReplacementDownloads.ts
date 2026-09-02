import { recordsToCsvWithHeaders } from "./downloads";
import type {
  PersistedContentReplacementItem,
  ReplacementConfiguration,
  ReplacementItemRef,
  ReplacementProposal,
  ReplacementProtectedOccurrenceReason,
} from "../writeTools/contentReplacement/types";

const CSV_MIME_TYPE = "text/csv;charset=utf-8";

const PREVIEW_HEADERS = [
  "contentType",
  "itemId",
  "questionId",
  "title",
  "webUrl",
  "owner",
  "lastEditor",
  "lastActivityDate",
  "ruleIds",
  "fields",
  "changedOccurrences",
  "protectedOccurrences",
  "protectedReasons",
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
  "status",
  "outcome",
  "attemptCount",
  "changedOccurrences",
  "protectedOccurrences",
  "completedAt",
] as const;

const EXCEPTION_HEADERS = [
  "contentType",
  "itemId",
  "questionId",
  "title",
  "webUrl",
  "status",
  "category",
  "message",
  "retryable",
  "statusCode",
  "occurredAt",
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
    const metadata = proposal.metadata ?? proposal.before.metadata;
    return {
      ...identityRecord(proposal),
      owner: formatPerson(metadata?.owner),
      lastEditor: formatPerson(metadata?.lastEditor),
      lastActivityDate: metadata?.lastActivityDate ?? "",
      ruleIds: sortNatural(proposal.appliedRuleIds).join("; "),
      fields: sortNatural([...new Set(proposal.changedOccurrences.map(({ field }) => field))]).join("; "),
      changedOccurrences: proposal.changedOccurrences.length,
      protectedOccurrences: proposal.protectedOccurrences.length,
      protectedReasons: sortNatural([...new Set(proposal.protectedOccurrences.map(({ reason }) => reasonLabel(reason)))])
        .join("; "),
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
): string {
  const records = sortInputs(items).map((item) => ({
    ...identityRecord(item.proposal),
    status: item.status,
    outcome: item.result?.kind ?? "",
    attemptCount: item.attemptCount,
    changedOccurrences: item.proposal.changedOccurrences.length,
    protectedOccurrences: item.proposal.protectedOccurrences.length,
    completedAt: item.result?.completedAt ?? "",
  }));
  return toRfc4180Csv(RESULT_HEADERS, records);
}

export function createReplacementExceptionsCsv(
  items: readonly PersistedContentReplacementItem[],
): string {
  const records = sortInputs(items)
    .flatMap((item) => {
      const exception = exceptionDetails(item);
      return exception ? [{
        ...identityRecord(item.proposal),
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
  environment: ReplacementDownloadEnvironment = browserDownloadEnvironment(),
): void {
  downloadCsv("content-replacement-results.csv", createReplacementResultsCsv(items), environment);
}

export function downloadReplacementExceptions(
  items: readonly PersistedContentReplacementItem[],
  environment: ReplacementDownloadEnvironment = browserDownloadEnvironment(),
): void {
  downloadCsv("content-replacement-exceptions.csv", createReplacementExceptionsCsv(items), environment);
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

function titleFrom(proposal: ReplacementProposal): string {
  return proposal.before.kind === "answer" ? "" : proposal.before.request.title;
}

function formatPerson(person: { id: number; name?: string } | undefined): string {
  if (!person) return "";
  return person.name ? `${person.name} (#${person.id})` : `#${person.id}`;
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

function reasonLabel(reason: ReplacementProtectedOccurrenceReason): string {
  switch (reason) {
    case "code": return "Code — unchanged";
    case "destination": return "Link or image destination — unchanged";
    case "raw-html-attribute": return "Raw HTML attribute — unchanged";
    case "raw-html-syntax": return "Raw HTML syntax — unchanged";
    case "raw-html-hidden": return "Raw HTML script or style content — unchanged";
  }
}

function exceptionDetails(item: PersistedContentReplacementItem): Record<string, unknown> | null {
  if (item.failure) {
    return {
      category: item.failure.category,
      message: item.failure.message,
      retryable: item.failure.retryable,
      statusCode: item.failure.statusCode ?? "",
      occurredAt: item.failure.occurredAt,
    };
  }
  if (item.result?.kind === "stale" || item.status === "stale") {
    return {
      category: "stale",
      message: "The post changed after review and was not updated.",
      retryable: false,
      statusCode: "",
      occurredAt: item.result?.completedAt ?? "",
    };
  }
  if (item.result?.kind === "verification-failed") {
    return {
      category: "verification",
      message: "The applied content could not be verified.",
      retryable: false,
      statusCode: "",
      occurredAt: item.result.completedAt,
    };
  }
  if (item.recovery?.result?.kind === "conflict" || item.status === "recovery-conflict") {
    return {
      category: "recovery-conflict",
      message: "The post changed after replacement and was not recovered.",
      retryable: false,
      statusCode: "",
      occurredAt: item.recovery?.result?.completedAt ?? "",
    };
  }
  if (item.recovery?.result?.kind === "verification-failed") {
    return {
      category: "recovery-verification",
      message: "The recovered content could not be verified.",
      retryable: false,
      statusCode: "",
      occurredAt: item.recovery.result.completedAt,
    };
  }
  return null;
}
