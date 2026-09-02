import type { Nodes } from "mdast";
import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { gfm } from "micromark-extension-gfm";
import { parseFragment } from "parse5";
import type { ReplacementOptions, ReplacementRule } from "./types";

export type ProtectedOccurrenceReason = "code" | "destination" | "raw-html-attribute";

export interface ReplacementOccurrence {
  ruleId: string;
  start: number;
  end: number;
  before: string;
  after: string;
}

export interface MarkdownReplacementResult {
  markdown: string;
  changedOccurrences: ReplacementOccurrence[];
  protectedOccurrences: Array<
    Omit<ReplacementOccurrence, "after"> & { reason: ProtectedOccurrenceReason }
  >;
}

interface SourceSpan {
  start: number;
  end: number;
}

interface ProtectedSpan extends SourceSpan {
  reason: ProtectedOccurrenceReason;
}

interface CandidateOccurrence extends ReplacementOccurrence {
  ruleIndex: number;
}

interface HtmlSourceLocation {
  startOffset: number;
  endOffset: number;
  attrs?: Record<string, HtmlSourceLocation>;
}

interface HtmlNode {
  nodeName: string;
  tagName?: string;
  value?: string;
  childNodes?: HtmlNode[];
  sourceCodeLocation?: HtmlSourceLocation;
}

function nodeSpan(node: Nodes): SourceSpan | undefined {
  const start = node.position?.start.offset;
  const end = node.position?.end.offset;
  return start === undefined || end === undefined ? undefined : { start, end };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function decodedCharacterReference(reference: string): string | undefined {
  const fragment = parseFragment(reference) as unknown as HtmlNode;
  const text = fragment.childNodes?.[0];
  return text?.nodeName === "#text" ? text.value : undefined;
}

function exactSourceSpans(raw: string, decoded: string, absoluteStart: number): SourceSpan[] {
  if (raw === decoded) return raw ? [{ start: absoluteStart, end: absoluteStart + raw.length }] : [];

  const spans: SourceSpan[] = [];
  let rawIndex = 0;
  let decodedIndex = 0;
  let exactStart: number | undefined;

  const closeExactSpan = (): void => {
    if (exactStart !== undefined && rawIndex > exactStart) {
      spans.push({ start: absoluteStart + exactStart, end: absoluteStart + rawIndex });
    }
    exactStart = undefined;
  };

  while (rawIndex < raw.length && decodedIndex < decoded.length) {
    const reference = raw
      .slice(rawIndex)
      .match(/^&(?:#[0-9]+|#[xX][0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]+);/)?.[0];
    if (reference) {
      const referenceValue = decodedCharacterReference(reference);
      if (referenceValue && decoded.startsWith(referenceValue, decodedIndex)) {
        closeExactSpan();
        rawIndex += reference.length;
        decodedIndex += referenceValue.length;
        continue;
      }
    }

    if (raw[rawIndex] === "\\" && rawIndex + 1 < raw.length) {
      const escaped = String.fromCodePoint(raw.codePointAt(rawIndex + 1)!);
      if (decoded.startsWith(escaped, decodedIndex)) {
        closeExactSpan();
        rawIndex += 1 + escaped.length;
        decodedIndex += escaped.length;
        continue;
      }
    }

    if (raw.startsWith("\r\n", rawIndex) && decoded[decodedIndex] === "\n") {
      closeExactSpan();
      rawIndex += 2;
      decodedIndex += 1;
      continue;
    }

    const rawCharacter = String.fromCodePoint(raw.codePointAt(rawIndex)!);
    const decodedCharacter = String.fromCodePoint(decoded.codePointAt(decodedIndex)!);
    if (rawCharacter !== decodedCharacter) {
      closeExactSpan();
      return spans;
    }

    exactStart ??= rawIndex;
    rawIndex += rawCharacter.length;
    decodedIndex += decodedCharacter.length;
  }

  if (rawIndex === raw.length && decodedIndex === decoded.length) closeExactSpan();
  return spans;
}

function hasWholeTermBoundaries(source: string, start: number, end: number): boolean {
  const preceding = source.slice(0, start).match(/[\p{L}\p{N}_]$/u)?.[0];
  const following = source.slice(end).match(/^[\p{L}\p{N}_]/u)?.[0];
  return !preceding && !following;
}

function matchesInSpan(
  source: string,
  span: SourceSpan,
  rules: readonly ReplacementRule[],
  options: ReplacementOptions,
): CandidateOccurrence[] {
  const candidates: CandidateOccurrence[] = [];
  const slice = source.slice(span.start, span.end);

  rules.forEach((rule, ruleIndex) => {
    if (!rule.find) return;

    const flags = options.caseSensitive ? "gu" : "giu";
    const matcher = new RegExp(escapeRegExp(rule.find), flags);
    for (const match of slice.matchAll(matcher)) {
      const relativeStart = match.index;
      const start = span.start + relativeStart;
      const end = start + match[0].length;
      if (options.wholeTerm && !hasWholeTermBoundaries(source, start, end)) continue;

      candidates.push({
        ruleId: rule.id,
        start,
        end,
        before: source.slice(start, end),
        after: rule.replace,
        ruleIndex,
      });
    }
  });

  return candidates;
}

function selectNonOverlapping(candidates: CandidateOccurrence[]): CandidateOccurrence[] {
  const sorted = [...candidates].sort(
    (left, right) =>
      left.start - right.start || left.ruleIndex - right.ruleIndex || right.end - left.end,
  );
  const selected: CandidateOccurrence[] = [];
  let occupiedUntil = -1;

  for (const candidate of sorted) {
    if (candidate.start < occupiedUntil) continue;
    selected.push(candidate);
    occupiedUntil = candidate.end;
  }

  return selected;
}

function complement(span: SourceSpan, exclusions: SourceSpan[]): SourceSpan[] {
  const ordered = exclusions
    .filter((item) => item.start >= span.start && item.end <= span.end && item.end > item.start)
    .sort((left, right) => left.start - right.start || left.end - right.end);
  const result: SourceSpan[] = [];
  let cursor = span.start;

  for (const exclusion of ordered) {
    if (exclusion.start > cursor) result.push({ start: cursor, end: exclusion.start });
    cursor = Math.max(cursor, exclusion.end);
  }
  if (cursor < span.end) result.push({ start: cursor, end: span.end });
  return result;
}

function childrenOf(node: Nodes): Nodes[] {
  return "children" in node ? (node.children as Nodes[]) : [];
}

function addCodeSpans(
  source: string,
  span: SourceSpan,
  nodeType: "code" | "inlineCode",
  replaceInCode: boolean,
  editable: SourceSpan[],
  protectedSpans: ProtectedSpan[],
): void {
  if (!replaceInCode) {
    protectedSpans.push({ ...span, reason: "code" });
    return;
  }

  const raw = source.slice(span.start, span.end);
  if (nodeType === "inlineCode") {
    const opening = raw.match(/^(`+)/)?.[0];
    if (!opening || !raw.endsWith(opening) || raw.length < opening.length * 2) {
      protectedSpans.push({ ...span, reason: "code" });
      return;
    }

    editable.push({ start: span.start + opening.length, end: span.end - opening.length });
    protectedSpans.push(
      { start: span.start, end: span.start + opening.length, reason: "code" },
      { start: span.end - opening.length, end: span.end, reason: "code" },
    );
    return;
  }

  const firstLineEnd = raw.search(/\r?\n|\r/);
  const firstLine = firstLineEnd < 0 ? raw : raw.slice(0, firstLineEnd);
  const fence = firstLine.match(/^ {0,3}(`{3,}|~{3,})/)?.[1];
  if (fence) {
    const newlineLength =
      firstLineEnd < 0
        ? 0
        : raw[firstLineEnd] === "\r" && raw[firstLineEnd + 1] === "\n"
          ? 2
          : 1;
    const contentStart = firstLineEnd < 0 ? raw.length : firstLineEnd + newlineLength;
    const lastNewline = Math.max(raw.lastIndexOf("\n"), raw.lastIndexOf("\r"));
    const finalLineStart = lastNewline < contentStart ? contentStart : lastNewline + 1;
    const finalLine = raw.slice(finalLineStart);
    const hasClosingFence = new RegExp(
      `^ {0,3}${escapeRegExp(fence[0])}{${fence.length},}[ \\t]*$`,
    ).test(finalLine);
    const contentEnd = hasClosingFence ? finalLineStart : raw.length;

    protectedSpans.push({ start: span.start, end: span.start + contentStart, reason: "code" });
    if (contentEnd > contentStart) {
      editable.push({ start: span.start + contentStart, end: span.start + contentEnd });
    }
    if (hasClosingFence) {
      protectedSpans.push({ start: span.start + contentEnd, end: span.end, reason: "code" });
    }
    return;
  }

  let cursor = 0;
  while (cursor < raw.length) {
    const match = raw.slice(cursor).match(/\r\n|\r|\n/);
    const lineEnd = match?.index === undefined ? raw.length : cursor + match.index;
    const nextLine = match ? lineEnd + match[0].length : raw.length;
    const line = raw.slice(cursor, lineEnd);
    const indentation = line.startsWith("    ") ? 4 : line.startsWith("\t") ? 1 : 0;

    if (indentation === 0) {
      protectedSpans.push({ start: span.start + cursor, end: span.start + nextLine, reason: "code" });
    } else {
      protectedSpans.push({
        start: span.start + cursor,
        end: span.start + cursor + indentation,
        reason: "code",
      });
      editable.push({ start: span.start + cursor + indentation, end: span.start + lineEnd });
    }
    cursor = nextLine;
  }
}

function addHtmlSpans(
  source: string,
  span: SourceSpan,
  editable: SourceSpan[],
  protectedSpans: ProtectedSpan[],
): void {
  const raw = source.slice(span.start, span.end);
  const fragment = parseFragment(raw, { sourceCodeLocationInfo: true }) as unknown as HtmlNode;

  const visit = (node: HtmlNode, hidden: boolean): void => {
    const location = node.sourceCodeLocation;
    const isHiddenContent = hidden || node.tagName === "script" || node.tagName === "style";

    if (location?.attrs) {
      for (const attributeLocation of Object.values(location.attrs)) {
        protectedSpans.push({
          start: span.start + attributeLocation.startOffset,
          end: span.start + attributeLocation.endOffset,
          reason: "raw-html-attribute",
        });
      }
    }

    if (node.nodeName === "#text" && location && !isHiddenContent && node.value !== undefined) {
      editable.push(
        ...exactSourceSpans(
          raw.slice(location.startOffset, location.endOffset),
          node.value,
          span.start + location.startOffset,
        ),
      );
    }

    node.childNodes?.forEach((child) => visit(child, isHiddenContent));
  };

  visit(fragment, false);
}

function collectSourceSpans(source: string, root: Nodes, replaceInCode: boolean): {
  editable: SourceSpan[];
  protectedSpans: ProtectedSpan[];
} {
  const editable: SourceSpan[] = [];
  const protectedSpans: ProtectedSpan[] = [];

  const visit = (node: Nodes): void => {
    const span = nodeSpan(node);
    if (!span) return;

    if (node.type === "text") {
      editable.push(...exactSourceSpans(source.slice(span.start, span.end), node.value, span.start));
      return;
    }

    if (node.type === "inlineCode" || node.type === "code") {
      addCodeSpans(source, span, node.type, replaceInCode, editable, protectedSpans);
      return;
    }

    if (node.type === "image" || node.type === "imageReference" || node.type === "definition") {
      protectedSpans.push({ ...span, reason: "destination" });
      return;
    }

    if (node.type === "link") {
      const raw = source.slice(span.start, span.end);
      if (!raw.startsWith("[")) {
        protectedSpans.push({ ...span, reason: "destination" });
        return;
      }

      const childSpans = childrenOf(node).flatMap((child) => {
        const childSpan = nodeSpan(child);
        return childSpan ? [childSpan] : [];
      });
      complement(span, childSpans).forEach((item) =>
        protectedSpans.push({ ...item, reason: "destination" }),
      );
      childrenOf(node).forEach(visit);
      return;
    }

    if (node.type === "linkReference") {
      const childSpans = childrenOf(node).flatMap((child) => {
        const childSpan = nodeSpan(child);
        return childSpan ? [childSpan] : [];
      });
      complement(span, childSpans).forEach((item) =>
        protectedSpans.push({ ...item, reason: "destination" }),
      );
      childrenOf(node).forEach(visit);
      return;
    }

    if (node.type === "html") {
      addHtmlSpans(source, span, editable, protectedSpans);
      return;
    }

    childrenOf(node).forEach(visit);
  };

  visit(root);
  return { editable, protectedSpans };
}

export function replaceMarkdown(
  markdown: string,
  rules: readonly ReplacementRule[],
  options: ReplacementOptions,
): MarkdownReplacementResult {
  const tree = fromMarkdown(markdown, {
    extensions: [gfm()],
    mdastExtensions: [gfmFromMarkdown()],
  });
  const { editable, protectedSpans } = collectSourceSpans(markdown, tree, options.replaceInCode);
  const candidates = editable.flatMap((span) => matchesInSpan(markdown, span, rules, options));
  const selected = selectNonOverlapping(candidates);

  const changedOccurrences = selected.map(({ ruleIndex: _ruleIndex, ...occurrence }) => occurrence);
  const protectedOccurrences = protectedSpans
    .flatMap((span) =>
      matchesInSpan(markdown, span, rules, options).map(
        ({ after: _after, ruleIndex: _ruleIndex, ...occurrence }) => ({
          ...occurrence,
          reason: span.reason,
        }),
      ),
    )
    .filter(
      (occurrence, index, all) =>
        all.findIndex(
          (item) =>
            item.ruleId === occurrence.ruleId &&
            item.start === occurrence.start &&
            item.end === occurrence.end &&
            item.reason === occurrence.reason,
        ) === index,
    )
    .sort((left, right) => left.start - right.start || left.end - right.end);

  let transformed = markdown;
  for (const occurrence of [...changedOccurrences].sort((left, right) => right.start - left.start)) {
    transformed =
      transformed.slice(0, occurrence.start) + occurrence.after + transformed.slice(occurrence.end);
  }

  return { markdown: transformed, changedOccurrences, protectedOccurrences };
}
