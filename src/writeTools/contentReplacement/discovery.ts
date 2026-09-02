import Papa from "papaparse";

import { replacementItemKey } from "./jobState";
import { stableSerialize } from "./proposals";
import type {
  ExactTargetSelection,
  ReplacementDiscovery,
  ReplacementItemRef,
} from "./types";

export const MAX_EXACT_REPLACEMENT_TARGETS = 100_000;

export interface DiscoveryPresentation {
  label: string;
  exhaustive: boolean;
}

export type ExactTargetParseErrorCode =
  | "invalid-url"
  | "wrong-origin"
  | "credentials-not-allowed"
  | "query-not-allowed"
  | "malformed-fragment"
  | "unsupported-path"
  | "invalid-id"
  | "invalid-type"
  | "missing-parent-question"
  | "unexpected-parent-question"
  | "invalid-headers"
  | "extra-columns"
  | "invalid-columns"
  | "malformed-csv"
  | "too-many-targets";

export interface ExactTargetParseError {
  code: ExactTargetParseErrorCode;
  sourceLine: number;
}

export interface ExactTargetParseResult {
  targets: ReplacementItemRef[];
  errors: ExactTargetParseError[];
  duplicateCount: number;
}

export function parseExactTargetLines(value: string, connectedOrigin: string): ExactTargetParseResult {
  const errors: ExactTargetParseError[] = [];
  const targets: ReplacementItemRef[] = [];
  let origin: string;
  try {
    origin = new URL(connectedOrigin).origin;
  } catch {
    return { targets, errors: [{ code: "invalid-url", sourceLine: 1 }], duplicateCount: 0 };
  }

  value.split(/\r?\n/u).forEach((line, index) => {
    const source = line.trim();
    if (source === "") return;
    const parsed = parseExactTargetUrl(source, origin);
    if ("code" in parsed) {
      errors.push({ code: parsed.code, sourceLine: index + 1 });
      return;
    }
    targets.push(parsed.ref);
  });

  return finalizeParsedTargets(targets, errors);
}

export function parseExactTargetCsv(value: string, _connectedOrigin: string): ExactTargetParseResult {
  const parsed = Papa.parse<string[]>(value, {
    delimiter: ",",
    header: false,
    dynamicTyping: false,
    skipEmptyLines: false,
  });
  const errors: ExactTargetParseError[] = parsed.errors.map((error) => ({
    code: "malformed-csv",
    sourceLine: (error.row ?? 0) + 1,
  }));
  const header = parsed.data[0] ?? [];
  if (!hasExactCsvHeaders(header)) {
    errors.unshift({ code: "invalid-headers", sourceLine: 1 });
    return { targets: [], errors, duplicateCount: 0 };
  }

  const targets: ReplacementItemRef[] = [];
  parsed.data.slice(1).forEach((row, index) => {
    const sourceLine = index + 2;
    if (row.every((cell) => cell.trim() === "")) return;
    if (row.length > 3) {
      errors.push({ code: "extra-columns", sourceLine });
      return;
    }
    if (row.length !== 3) {
      errors.push({ code: "invalid-columns", sourceLine });
      return;
    }

    const type = (row[0] ?? "").trim();
    const id = parsePositiveSafeInteger((row[1] ?? "").trim());
    const parentQuestionId = (row[2] ?? "").trim();
    if (!id) {
      errors.push({ code: "invalid-id", sourceLine });
      return;
    }
    if (type === "question") {
      if (parentQuestionId !== "") {
        errors.push({ code: "unexpected-parent-question", sourceLine });
        return;
      }
      targets.push({ kind: "question", questionId: id });
      return;
    }
    if (type === "article") {
      if (parentQuestionId !== "") {
        errors.push({ code: "unexpected-parent-question", sourceLine });
        return;
      }
      targets.push({ kind: "article", articleId: id });
      return;
    }
    if (type === "answer") {
      const parent = parsePositiveSafeInteger(parentQuestionId);
      if (!parent) {
        errors.push({ code: "missing-parent-question", sourceLine });
        return;
      }
      targets.push({ kind: "answer", questionId: parent, answerId: id });
      return;
    }
    errors.push({ code: "invalid-type", sourceLine });
  });

  return finalizeParsedTargets(targets, errors);
}

export function createExactTargetCsvTemplate(): string {
  return "type,id,parent_question_id\n";
}

export function normalizeExactTargets(targets: readonly ReplacementItemRef[]): ReplacementItemRef[] {
  const normalized: ReplacementItemRef[] = [];
  const seen = new Set<string>();
  for (const target of targets) {
    const normalizedTarget = normalizeExactTarget(target);
    const key = replacementItemKey(normalizedTarget);
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push(normalizedTarget);
    if (normalized.length > MAX_EXACT_REPLACEMENT_TARGETS) {
      throw new RangeError("Exact target lists cannot contain more than 100,000 unique targets.");
    }
  }
  return normalized;
}

function normalizeExactTarget(target: ReplacementItemRef): ReplacementItemRef {
  if (target.kind === "question") return { kind: "question", questionId: target.questionId };
  if (target.kind === "answer") {
    return { kind: "answer", questionId: target.questionId, answerId: target.answerId };
  }
  return { kind: "article", articleId: target.articleId };
}

export async function createExactTargetSelection(
  inputTargets: readonly ReplacementItemRef[],
): Promise<ExactTargetSelection> {
  const targets = normalizeExactTargets(inputTargets);
  if (targets.length === 0) {
    throw new RangeError("Exact target lists must contain at least one target.");
  }
  return {
    discovery: {
      mode: "exact",
      targetCount: targets.length,
      targetDigest: await sha256(stableSerialize(targets)),
    },
    targets,
  };
}

export function getDiscoveryPresentation(discovery: ReplacementDiscovery): Readonly<DiscoveryPresentation> {
  if (discovery.mode === "targeted") return TARGETED_PRESENTATION;
  if (discovery.mode === "full") return FULL_PRESENTATION;
  return Object.freeze({
    label: `Exact target list · complete for ${discovery.targetCount} supplied posts`,
    exhaustive: true,
  });
}

const TARGETED_PRESENTATION = Object.freeze<DiscoveryPresentation>({
  label: "Search-assisted · may miss matches",
  exhaustive: false,
});

const FULL_PRESENTATION = Object.freeze<DiscoveryPresentation>({
  label: "Exhaustive · all accessible selected content",
  exhaustive: true,
});

function finalizeParsedTargets(
  targets: ReplacementItemRef[],
  errors: ExactTargetParseError[],
): ExactTargetParseResult {
  try {
    const normalized = normalizeExactTargets(targets);
    return { targets: normalized, errors, duplicateCount: targets.length - normalized.length };
  } catch (error) {
    if (error instanceof RangeError) {
      errors.push({ code: "too-many-targets", sourceLine: targets.length });
      return { targets, errors, duplicateCount: 0 };
    }
    throw error;
  }
}

function parseExactTargetUrl(
  value: string,
  expectedOrigin: string,
): { ref: ReplacementItemRef } | { code: ExactTargetParseErrorCode } {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return { code: "invalid-url" };
  }
  if (url.username !== "" || url.password !== "") return { code: "credentials-not-allowed" };
  if (url.origin !== expectedOrigin) return { code: "wrong-origin" };
  if (url.search !== "") return { code: "query-not-allowed" };

  const segments = url.pathname.split("/").filter(Boolean);
  const fragment = url.hash === "" ? (value.endsWith("#") ? "" : undefined) : url.hash.slice(1);
  if (segments[0] === "articles") {
    const articleId = parsePositiveSafeInteger(segments[1] ?? "");
    if (!articleId || segments.length < 2 || segments.length > 3) return { code: "unsupported-path" };
    if (fragment !== undefined) return { code: "malformed-fragment" };
    return { ref: { kind: "article", articleId } };
  }

  if (segments[0] !== "questions") return { code: "unsupported-path" };
  const questionId = parsePositiveSafeInteger(segments[1] ?? "");
  if (!questionId) return { code: "unsupported-path" };
  if (segments.length === 2 || (segments.length === 3 && !parsePositiveSafeInteger(segments[2]))) {
    if (fragment !== undefined) return { code: "malformed-fragment" };
    return { ref: { kind: "question", questionId } };
  }

  const answerId = segments[2] === "answers"
    ? parsePositiveSafeInteger(segments[3] ?? "")
    : parsePositiveSafeInteger(segments[segments.length - 1] ?? "");
  const validAnswerPath =
    (segments.length === 3 && answerId !== null) ||
    (segments.length === 4 && (segments[2] === "answers" || answerId !== null));
  if (!validAnswerPath || !answerId) return { code: "unsupported-path" };
  if (fragment !== undefined && fragment !== String(answerId)) return { code: "malformed-fragment" };
  return { ref: { kind: "answer", questionId, answerId } };
}

function hasExactCsvHeaders(header: string[]): boolean {
  return header.length === 3 &&
    normalizeHeader(header[0], true) === "type" &&
    normalizeHeader(header[1], false) === "id" &&
    normalizeHeader(header[2], false) === "parent_question_id";
}

function normalizeHeader(value: string | undefined, isFirstHeader: boolean): string {
  return (isFirstHeader ? (value ?? "").replace(/^\uFEFF/u, "") : (value ?? "")).trim();
}

function parsePositiveSafeInteger(value: string): number | null {
  if (!/^[1-9]\d*$/u.test(value)) return null;
  const number = Number(value);
  return Number.isSafeInteger(number) ? number : null;
}

async function sha256(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const hash = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
