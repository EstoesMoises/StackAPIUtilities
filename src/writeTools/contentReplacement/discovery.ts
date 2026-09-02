import Papa from "papaparse";

import {
  canonicalReplacementRefKey,
  createExactTargetManifest,
} from "./exactManifest";
import {
  MAX_CONTENT_REPLACEMENT_CSV_INPUT_BYTES,
  MAX_CONTENT_REPLACEMENT_EXACT_TARGETS,
  MAX_CONTENT_REPLACEMENT_PASTE_BYTES,
  utf8ByteLength,
} from "./limits";
import type {
  ExactTargetSelection,
  ReplacementDiscovery,
  ReplacementItemRef,
} from "./types";

export const MAX_EXACT_REPLACEMENT_TARGETS = MAX_CONTENT_REPLACEMENT_EXACT_TARGETS;
export { verifyExactTargetProof } from "./exactManifest";

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
  | "input-too-large"
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
  if (utf8ByteLength(value) > MAX_CONTENT_REPLACEMENT_PASTE_BYTES) {
    return { targets, errors: [{ code: "input-too-large", sourceLine: 1 }], duplicateCount: 0 };
  }
  let origin: string;
  try {
    origin = new URL(connectedOrigin).origin;
  } catch {
    return { targets, errors: [{ code: "invalid-url", sourceLine: 1 }], duplicateCount: 0 };
  }

  const seen = new Set<string>();
  let duplicateCount = 0;
  const lines = value.split(/\r?\n/u);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const source = line.trim();
    if (source === "") continue;
    const parsed = parseExactTargetUrl(source, origin);
    if ("code" in parsed) {
      errors.push({ code: parsed.code, sourceLine: index + 1 });
      continue;
    }
    const key = canonicalReplacementRefKey(parsed.ref);
    if (seen.has(key)) {
      duplicateCount += 1;
      continue;
    }
    if (targets.length >= MAX_EXACT_REPLACEMENT_TARGETS) {
      errors.push({ code: "too-many-targets", sourceLine: index + 1 });
      break;
    }
    seen.add(key);
    targets.push(parsed.ref);
  }

  return { targets: normalizeExactTargets(targets), errors, duplicateCount };
}

export function parseExactTargetCsv(value: string, _connectedOrigin: string): ExactTargetParseResult {
  if (utf8ByteLength(value) > MAX_CONTENT_REPLACEMENT_CSV_INPUT_BYTES) {
    return { targets: [], errors: [{ code: "input-too-large", sourceLine: 1 }], duplicateCount: 0 };
  }
  const errors: ExactTargetParseError[] = [];
  const targets: ReplacementItemRef[] = [];
  const seen = new Set<string>();
  let duplicateCount = 0;
  let rowIndex = 0;
  let validHeader = false;
  Papa.parse<string[]>(value, {
    delimiter: ",",
    header: false,
    dynamicTyping: false,
    skipEmptyLines: false,
    step(result, parser) {
      const sourceLine = rowIndex + 1;
      rowIndex += 1;
      errors.push(...result.errors.map(() => ({ code: "malformed-csv" as const, sourceLine })));
      const row = result.data;
      if (sourceLine === 1) {
        validHeader = hasExactCsvHeaders(row);
        if (!validHeader) {
          errors.unshift({ code: "invalid-headers", sourceLine: 1 });
          parser.abort();
        }
        return;
      }
      if (!validHeader || row.every((cell) => cell.trim() === "")) return;
      const parsed = parseExactTargetCsvRow(row, sourceLine);
      if ("code" in parsed) {
        errors.push({ code: parsed.code, sourceLine });
        return;
      }
      const key = canonicalReplacementRefKey(parsed.ref);
      if (seen.has(key)) {
        duplicateCount += 1;
        return;
      }
      if (targets.length >= MAX_EXACT_REPLACEMENT_TARGETS) {
        errors.push({ code: "too-many-targets", sourceLine });
        parser.abort();
        return;
      }
      seen.add(key);
      targets.push(parsed.ref);
    },
  });
  return { targets: normalizeExactTargets(targets), errors, duplicateCount };
}

function parseExactTargetCsvRow(
  row: string[],
  _sourceLine: number,
): { ref: ReplacementItemRef } | { code: ExactTargetParseErrorCode } {
  if (row.length > 3) return { code: "extra-columns" };
  if (row.length !== 3) return { code: "invalid-columns" };
  const type = (row[0] ?? "").trim();
  const id = parsePositiveSafeInteger((row[1] ?? "").trim());
  const parentQuestionId = (row[2] ?? "").trim();
  if (!id) return { code: "invalid-id" };
  if (type === "question" || type === "article") {
    if (parentQuestionId !== "") return { code: "unexpected-parent-question" };
    return type === "question"
      ? { ref: { kind: "question", questionId: id } }
      : { ref: { kind: "article", articleId: id } };
  }
  if (type === "answer") {
    const parent = parsePositiveSafeInteger(parentQuestionId);
    return parent
      ? { ref: { kind: "answer", questionId: parent, answerId: id } }
      : { code: "missing-parent-question" };
  }
  return { code: "invalid-type" };
}

export function createExactTargetCsvTemplate(): string {
  return "type,id,parent_question_id\n";
}

export function normalizeExactTargets(targets: readonly ReplacementItemRef[]): ReplacementItemRef[] {
  const normalized: ReplacementItemRef[] = [];
  const seen = new Set<string>();
  for (const target of targets) {
    const normalizedTarget = normalizeExactTarget(target);
    const key = canonicalReplacementRefKey(normalizedTarget);
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push(normalizedTarget);
    if (normalized.length > MAX_EXACT_REPLACEMENT_TARGETS) {
      throw new RangeError("Exact target lists cannot contain more than 5,000 unique targets.");
    }
  }
  return normalized.sort((left, right) => {
    const leftKey = canonicalReplacementRefKey(left);
    const rightKey = canonicalReplacementRefKey(right);
    return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
  });
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
  const manifest = await createExactTargetManifest(targets);
  return {
    discovery: {
      mode: "exact",
      targetCount: targets.length,
      targetDigest: manifest.root,
    },
    targets,
    proofs: manifest.proofs,
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
