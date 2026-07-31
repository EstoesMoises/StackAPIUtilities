import { compareCodeUnits, readTagIdentity, type NormalizedTagIdentity } from "../../domain/tagNormalization";
import type { ReportWarning } from "../../domain/types";
import type { CollectedSource, NormalizedTagSmeResult } from "./model";

interface SmeAccumulator {
  readonly key: string;
  readonly tagNames: Set<string>;
  readonly candidates: Array<number | null>;
}

export function normalizeTagSmeCounts(source: CollectedSource): NormalizedTagSmeResult {
  const byKey = new Map<string, SmeAccumulator>();
  let skippedTagIdentities = 0;

  for (const record of source.records) {
    const identity = readTagIdentity(record);
    if (identity === null) {
      if (Object.keys(record).length > 0) skippedTagIdentities++;
      continue;
    }

    const accumulator = ensureAccumulator(byKey, identity);
    accumulator.candidates.push(readExactSmeCount(record));
  }

  const warnings: ReportWarning[] = [];
  if (skippedTagIdentities > 0) {
    warnings.push({
      utilityId: "sme-coverage-analyzer",
      code: "sme-coverage.skipped-sme-tag-identities",
      message: `Skipped ${skippedTagIdentities} v3 tag record${skippedTagIdentities === 1 ? "" : "s"} with no usable tag identity.`,
    });
  }

  const rows = [...byKey.values()]
    .sort((left, right) => compareCodeUnits(left.key, right.key))
    .map((accumulator) => {
      const oneUniqueNumericValue =
        accumulator.candidates.length > 0 &&
        accumulator.candidates.every((value) => value !== null) &&
        new Set(accumulator.candidates).size === 1;
      const smeCount = oneUniqueNumericValue ? accumulator.candidates[0] : null;
      return {
        key: accumulator.key,
        tagNames: [...accumulator.tagNames].sort(compareCodeUnits),
        smeCount,
        smeQuality: oneUniqueNumericValue ? ("Complete" as const) : ("Unknown" as const),
      };
    });

  return { rows, warnings };
}

function ensureAccumulator(byKey: Map<string, SmeAccumulator>, identity: NormalizedTagIdentity): SmeAccumulator {
  let accumulator = byKey.get(identity.key);
  if (!accumulator) {
    accumulator = { key: identity.key, tagNames: new Set<string>(), candidates: [] };
    byKey.set(identity.key, accumulator);
  }
  accumulator.tagNames.add(identity.displayName);
  return accumulator;
}

function readExactSmeCount(record: Record<string, unknown>): number | null {
  const value = record.subjectMatterExpertCount;
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}
