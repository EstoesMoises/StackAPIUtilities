import { readQuestionTags, readTagIdentity } from "../domain/tagNormalization";
import { formatUtcDateTime, parseApiTimestamp } from "../utils/apiDates";

export interface TagLastUsedRow {
  tagName: string;
  lastUsed: string;
}

export function buildTagLastUsedRows(
  tags: readonly Record<string, unknown>[],
  contentRecords: readonly Record<string, unknown>[],
): TagLastUsedRow[] {
  const knownTags = new Map<string, string>();

  for (const tag of tags) {
    const identity = readTagIdentity(tag);
    if (identity !== null && !knownTags.has(identity.key)) {
      knownTags.set(identity.key, identity.displayName);
    }
  }

  const latestUsed = new Map<string, number>();
  for (const record of contentRecords) {
    const timestamp = readContentTimestamp(record);
    if (timestamp === null) continue;

    for (const tag of readQuestionTags(record)) {
      if (!knownTags.has(tag.key)) continue;
      const previous = latestUsed.get(tag.key);
      if (previous === undefined || timestamp > previous) latestUsed.set(tag.key, timestamp);
    }
  }

  return [...knownTags].map(([key, tagName]) => ({
    tagName,
    lastUsed: formatUtcDateTime(latestUsed.get(key)),
  }));
}

function readContentTimestamp(record: Record<string, unknown>): number | null {
  const timestamps = [record.creation_date, record.creationDate]
    .map(parseApiTimestamp)
    .filter((timestamp): timestamp is number => timestamp !== null);

  return timestamps.length === 0 ? null : Math.max(...timestamps);
}
