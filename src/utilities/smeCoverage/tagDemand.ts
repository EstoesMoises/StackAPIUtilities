import {
  compareCodeUnits,
  QUESTION_VIEW_ALIASES,
  readNonNegativeNumber,
  readQuestionTags,
  readStableQuestionId,
  readTagIdentity,
  TAG_COUNT_ALIASES,
  type NormalizedTagIdentity,
} from "../../domain/tagNormalization";
import type { ReportWarning } from "../../domain/types";
import type {
  CollectedSource,
  DemandQuality,
  NormalizedTagDemandResult,
  QuestionCountBasis,
} from "./model";

interface TagDemandAccumulator {
  readonly key: string;
  readonly tagNames: Set<string>;
  readonly tagCountCandidates: number[];
  pageViews: number;
  collectedQuestionCount: number;
}

interface QuestionCandidate {
  readonly tags: readonly NormalizedTagIdentity[];
  readonly viewCount: number | null;
}

export function normalizeTagDemand({
  tags,
  questions,
}: {
  tags: CollectedSource;
  questions: CollectedSource;
}): NormalizedTagDemandResult {
  const byKey = new Map<string, TagDemandAccumulator>();
  const invalidKeys = new Set<string>();
  const warnings: ReportWarning[] = [];
  let skippedTagIdentities = 0;

  for (const record of tags.records) {
    const identity = readTagIdentity(record);
    if (identity === null) {
      if (Object.keys(record).length > 0) skippedTagIdentities++;
      continue;
    }

    const accumulator = ensureAccumulator(byKey, identity);
    const tagCount = readNonNegativeNumber(record, TAG_COUNT_ALIASES);
    if (tagCount !== null) accumulator.tagCountCandidates.push(tagCount);
  }

  if (skippedTagIdentities > 0) {
    warnings.push({
      utilityId: "sme-coverage-analyzer",
      code: "sme-coverage.skipped-tag-identities",
      message: `Skipped ${skippedTagIdentities} tag record${pluralSuffix(skippedTagIdentities)} with no usable tag identity.`,
    });
  }

  const groupedQuestions = new Map<string, QuestionCandidate[]>();
  let invalidQuestionRecords = 0;
  for (const record of questions.records) {
    const candidate: QuestionCandidate = {
      tags: readQuestionTags(record),
      viewCount: readNonNegativeNumber(record, QUESTION_VIEW_ALIASES),
    };
    for (const tag of candidate.tags) ensureAccumulator(byKey, tag);

    const stableId = readStableQuestionId(record);
    if (stableId === null) {
      invalidQuestionRecords++;
      markInvalid(invalidKeys, candidate.tags);
      continue;
    }

    const group = groupedQuestions.get(stableId) ?? [];
    group.push(candidate);
    groupedQuestions.set(stableId, group);
  }

  for (const candidates of groupedQuestions.values()) {
    const allTags = uniqueTags(candidates.flatMap((candidate) => candidate.tags));
    if (candidates.some((candidate) => candidate.viewCount === null) || hasQuestionConflict(candidates)) {
      invalidQuestionRecords += candidates.length;
      markInvalid(invalidKeys, allTags);
      continue;
    }

    const candidate = candidates[0];
    if (candidate.viewCount === null) continue;
    for (const tag of candidate.tags) {
      const accumulator = ensureAccumulator(byKey, tag);
      accumulator.pageViews += candidate.viewCount;
      accumulator.collectedQuestionCount++;
    }
  }

  if (invalidQuestionRecords > 0) {
    const affectedTags = [...invalidKeys].sort(compareCodeUnits);
    warnings.push({
      utilityId: "sme-coverage-analyzer",
      code: "sme-coverage.invalid-question-demand",
      message: `Excluded ${invalidQuestionRecords} invalid question record${pluralSuffix(invalidQuestionRecords)} affecting ${affectedTags.length} tag${pluralSuffix(affectedTags.length)}.`,
    });
  }

  const conflictingTagCountKeys = [...byKey.values()]
    .filter((accumulator) => new Set(accumulator.tagCountCandidates).size > 1)
    .map((accumulator) => accumulator.key)
    .sort(compareCodeUnits);
  if (conflictingTagCountKeys.length > 0) {
    warnings.push({
      utilityId: "sme-coverage-analyzer",
      code: "sme-coverage.conflicting-tag-counts",
      message: `Ignored conflicting v2 tag count${pluralSuffix(conflictingTagCountKeys.length)} for ${conflictingTagCountKeys.length} tag${pluralSuffix(conflictingTagCountKeys.length)}.`,
    });
  }

  const questionsComplete = !questions.pagination.reachedMaxPages && !questions.pagination.hasMore;
  const rows = [...byKey.values()]
    .sort((left, right) => compareCodeUnits(left.key, right.key))
    .map((accumulator) => {
      const tagNames = [...accumulator.tagNames].sort(compareCodeUnits);
      if (invalidKeys.has(accumulator.key)) {
        return {
          key: accumulator.key,
          tagNames,
          pageViews: null,
          questionCount: null,
          questionCountBasis: "Unavailable" as const,
          demandQuality: "Invalid" as const,
        };
      }

      const tagCount = oneUniqueValue(accumulator.tagCountCandidates);
      const { questionCount, questionCountBasis } = chooseQuestionCount({
        questionsComplete,
        tagCount,
        collectedQuestionCount: accumulator.collectedQuestionCount,
      });
      const demandQuality: DemandQuality = questionsComplete ? "Complete" : "Partial sample";
      return {
        key: accumulator.key,
        tagNames,
        pageViews: accumulator.pageViews,
        questionCount,
        questionCountBasis,
        demandQuality,
      };
    });

  return { rows, warnings };
}

function ensureAccumulator(
  byKey: Map<string, TagDemandAccumulator>,
  identity: NormalizedTagIdentity,
): TagDemandAccumulator {
  let accumulator = byKey.get(identity.key);
  if (!accumulator) {
    accumulator = {
      key: identity.key,
      tagNames: new Set<string>(),
      tagCountCandidates: [],
      pageViews: 0,
      collectedQuestionCount: 0,
    };
    byKey.set(identity.key, accumulator);
  }
  accumulator.tagNames.add(identity.displayName);
  return accumulator;
}

function uniqueTags(tags: readonly NormalizedTagIdentity[]): NormalizedTagIdentity[] {
  const byKey = new Map<string, NormalizedTagIdentity>();
  for (const tag of tags) byKey.set(tag.key, tag);
  return [...byKey.values()];
}

function hasQuestionConflict(candidates: readonly QuestionCandidate[]): boolean {
  const signatures = new Set(
    candidates.map((candidate) =>
      JSON.stringify({
        tagKeys: candidate.tags.map((tag) => tag.key).sort(compareCodeUnits),
        viewCount: candidate.viewCount,
      }),
    ),
  );
  return signatures.size > 1;
}

function markInvalid(keys: Set<string>, tags: readonly NormalizedTagIdentity[]): void {
  for (const tag of tags) keys.add(tag.key);
}

function oneUniqueValue(values: readonly number[]): number | null {
  return values.length > 0 && new Set(values).size === 1 ? values[0] : null;
}

function chooseQuestionCount({
  questionsComplete,
  tagCount,
  collectedQuestionCount,
}: {
  questionsComplete: boolean;
  tagCount: number | null;
  collectedQuestionCount: number;
}): { questionCount: number | null; questionCountBasis: QuestionCountBasis } {
  if (questionsComplete) {
    return { questionCount: collectedQuestionCount, questionCountBasis: "Complete question enumeration" };
  }
  if (tagCount !== null) return { questionCount: tagCount, questionCountBasis: "All-time tag total" };
  if (Number.isFinite(collectedQuestionCount) && collectedQuestionCount >= 0) {
    return { questionCount: collectedQuestionCount, questionCountBasis: "Partial question sample" };
  }
  return { questionCount: null, questionCountBasis: "Unavailable" };
}

function pluralSuffix(count: number): string {
  return count === 1 ? "" : "s";
}
