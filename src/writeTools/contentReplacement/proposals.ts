import { replaceMarkdown } from "./markdown";
import { normalizeExactTargetProof, verifyExactTargetProof } from "./exactManifest";
import type {
  ExactTargetProof,
  ReplacementConfiguration,
  ContentReplacementScanCompatibility,
  ReplacementOccurrence,
  ReplacementOptions,
  ReplacementProposal,
  ReplacementRequestModel,
  ReplacementRule,
  ReplacementWireRequestModel,
} from "./types";

interface TitleReplacementResult {
  value: string;
  occurrences: ReplacementOccurrence[];
}

interface TitleCandidate extends Omit<ReplacementOccurrence, "field"> {
  ruleIndex: number;
}

interface SemanticRule {
  find: string;
  replace: string;
}

export function stableSerialize(value: unknown): string {
  return JSON.stringify(normalizeForSerialization(value));
}

export function toReplacementWireRequestModel(
  model: ReplacementRequestModel,
): ReplacementWireRequestModel {
  if (model.kind === "answer") {
    return {
      kind: "answer",
      ref: { kind: "answer", questionId: model.ref.questionId, answerId: model.ref.answerId },
      request: { body: model.request.body },
    };
  }
  if (model.kind === "question") {
    return {
      kind: "question",
      ref: { kind: "question", questionId: model.ref.questionId },
      request: {
        title: model.request.title,
        body: model.request.body,
        tags: [...model.request.tags],
      },
    };
  }
  return {
    kind: "article",
    ref: { kind: "article", articleId: model.ref.articleId },
    request: {
      title: model.request.title,
      body: model.request.body,
      tags: [...model.request.tags],
      type: model.request.type,
      ...(model.request.expirationDate === undefined
        ? {}
        : { expirationDate: model.request.expirationDate }),
      permissions: {
        ...(model.request.permissions.editableBy === undefined
          ? {}
          : { editableBy: model.request.permissions.editableBy }),
        editorUserIds: [...model.request.permissions.editorUserIds],
        editorUserGroupIds: [...model.request.permissions.editorUserGroupIds],
      },
    },
  };
}

export async function checksumRequestModel(model: ReplacementRequestModel): Promise<string> {
  return sha256(stableSerialize(model.request));
}

export async function createJobFingerprint(input: {
  baseUrl: string;
  configuration: ReplacementConfiguration;
  scanCompatibility: ContentReplacementScanCompatibility;
}): Promise<string> {
  return sha256(
    stableSerialize({
      baseUrl: normalizeBaseUrl(input.baseUrl),
      configuration: semanticConfiguration(input.configuration),
      scanCompatibility: input.scanCompatibility,
    }),
  );
}

export async function buildReplacementProposal(
  model: ReplacementRequestModel,
  configuration: ReplacementConfiguration,
  exactProofValue?: ExactTargetProof,
): Promise<ReplacementProposal | null> {
  const exactProof = await validatedExactProof(model, configuration, exactProofValue);
  const title = model.kind === "answer"
    ? undefined
    : replaceTitle(model.request.title, configuration.rules, configuration.options);
  const body = replaceMarkdown(model.request.body, configuration.rules, configuration.options);
  const changedOccurrences: ReplacementOccurrence[] = [
    ...(title?.occurrences ?? []),
    ...body.changedOccurrences.map((occurrence) => ({ ...occurrence, field: "body" as const })),
  ];

  if (changedOccurrences.length === 0) return null;

  const after = buildAfterModel(model, title?.value, body.markdown);
  const scannedRequestChecksum = await checksumRequestModel(model);
  const proposedRequestChecksum = await checksumRequestModel(after);
  const proposalFingerprint = await sha256(
    stableSerialize({
      ref: model.ref,
      configuration: semanticConfiguration(configuration),
      scannedRequestChecksum,
      proposedRequestChecksum,
      ...(exactProof === undefined ? {} : { exactProof }),
    }),
  );

  return {
    before: model,
    after,
    scannedRequestChecksum,
    proposedRequestChecksum,
    proposalFingerprint,
    ...(exactProof === undefined ? {} : { exactProof }),
    fields: {
      ...(title && {
        title: {
          beforeMarkdown: titleBefore(model),
          afterMarkdown: title.value,
        },
      }),
      body: { beforeMarkdown: model.request.body, afterMarkdown: body.markdown },
    },
    changedOccurrences,
    protectedOccurrences: body.protectedOccurrences.map((occurrence) => ({
      ...occurrence,
      field: "body" as const,
    })),
    appliedRuleIds: [...new Set(changedOccurrences.map((occurrence) => occurrence.ruleId))],
    metadata: model.metadata,
  };
}

async function validatedExactProof(
  model: ReplacementRequestModel,
  configuration: ReplacementConfiguration,
  value: ExactTargetProof | undefined,
): Promise<ExactTargetProof | undefined> {
  if (configuration.discovery.mode !== "exact") {
    if (value !== undefined) throw new TypeError("Exact manifest proofs are only valid for Exact discovery.");
    return undefined;
  }
  const proof = normalizeExactTargetProof(value);
  if (!proof || !await verifyExactTargetProof(model.ref, proof, configuration.discovery)) {
    throw new TypeError("A valid Exact manifest proof is required for every Exact proposal.");
  }
  return proof;
}

function normalizeForSerialization(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeForSerialization);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, item]) => item !== undefined)
        .sort(([left], [right]) => compareStrings(left, right))
        .map(([key, item]) => [key, normalizeForSerialization(item)]),
    );
  }
  return value;
}

function normalizeBaseUrl(value: string): string {
  const trimmed = value.trim();
  try {
    return new URL(trimmed).origin;
  } catch {
    return trimmed;
  }
}

function semanticConfiguration(configuration: ReplacementConfiguration): Omit<ReplacementConfiguration, "rules"> & {
  rules: SemanticRule[];
} {
  return {
    target: configuration.target,
    contentTypes: configuration.contentTypes,
    discovery: configuration.discovery,
    options: configuration.options,
    rules: configuration.rules
      .map(({ find, replace }) => ({ find, replace }))
      .sort(
        (left, right) =>
          compareStrings(left.find, right.find) || compareStrings(left.replace, right.replace),
      ),
  };
}

async function sha256(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const hash = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function buildAfterModel(
  model: ReplacementRequestModel,
  title: string | undefined,
  body: string,
): ReplacementRequestModel {
  if (model.kind === "answer") {
    return { ...model, request: { ...model.request, body } };
  }
  if (model.kind === "question") {
    return {
      ...model,
      request: { ...model.request, title: title ?? model.request.title, body },
    };
  }
  return {
    ...model,
    request: { ...model.request, title: title ?? model.request.title, body },
  };
}

function titleBefore(model: ReplacementRequestModel): string {
  if (model.kind === "answer") throw new Error("Answers do not have titles.");
  return model.request.title;
}

function replaceTitle(
  source: string,
  rules: readonly ReplacementRule[],
  options: ReplacementOptions,
): TitleReplacementResult {
  const candidates: TitleCandidate[] = [];
  rules.forEach((rule, ruleIndex) => {
    if (!rule.find) return;
    const matcher = new RegExp(escapeRegExp(rule.find), options.caseSensitive ? "gu" : "giu");
    for (const match of source.matchAll(matcher)) {
      const start = match.index;
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

  const selected = candidates
    .sort(
      (left, right) =>
        left.start - right.start || left.ruleIndex - right.ruleIndex || right.end - left.end,
    )
    .reduce<TitleCandidate[]>((occurrences, candidate) => {
      const previous = occurrences[occurrences.length - 1];
      if (candidate.start >= (previous?.end ?? -1)) occurrences.push(candidate);
      return occurrences;
    }, []);
  const occurrences = selected.map(({ ruleIndex: _ruleIndex, ...occurrence }) => ({
    ...occurrence,
    field: "title" as const,
  }));
  let value = source;
  for (const occurrence of [...occurrences].sort((left, right) => right.start - left.start)) {
    value = value.slice(0, occurrence.start) + occurrence.after + value.slice(occurrence.end);
  }
  return { value, occurrences };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function hasWholeTermBoundaries(source: string, start: number, end: number): boolean {
  const previous = characterBefore(source, start);
  const following = end < source.length ? String.fromCodePoint(source.codePointAt(end)!) : undefined;
  return !/[\p{L}\p{N}_]/u.test(previous ?? "") && !/[\p{L}\p{N}_]/u.test(following ?? "");
}

function characterBefore(value: string, index: number): string | undefined {
  if (index <= 0) return undefined;
  const lastCodeUnit = value.charCodeAt(index - 1);
  const start = lastCodeUnit >= 0xdc00 && lastCodeUnit <= 0xdfff ? index - 2 : index - 1;
  return String.fromCodePoint(value.codePointAt(start)!);
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
