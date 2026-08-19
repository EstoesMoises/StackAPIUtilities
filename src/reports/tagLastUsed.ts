import { readQuestionTags, readTagIdentity } from "../domain/tagNormalization";

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
    lastUsed: formatUtcDate(latestUsed.get(key)),
  }));
}

function readContentTimestamp(record: Record<string, unknown>): number | null {
  const timestamps = [record.creation_date, record.creationDate]
    .map(parseTimestamp)
    .filter((timestamp): timestamp is number => timestamp !== null);

  return timestamps.length === 0 ? null : Math.max(...timestamps);
}

function parseTimestamp(value: unknown): number | null {
  if (typeof value === "boolean" || value === null || value === undefined) return null;

  const numeric = typeof value === "number"
    ? value
    : typeof value === "string" && value.trim() !== "" ? Number(value) : null;
  if (numeric !== null && Number.isFinite(numeric)) {
    const secondsAsMilliseconds = numeric * 1_000;
    const preferSeconds = Math.abs(numeric) < 1_000_000_000_000;
    const primary = preferSeconds ? secondsAsMilliseconds : numeric;
    const fallback = preferSeconds ? numeric : secondsAsMilliseconds;

    return isValidDateMilliseconds(primary)
      ? primary
      : isValidDateMilliseconds(fallback) ? fallback : null;
  }

  if (typeof value !== "string") return null;
  if (!hasValidIsoCalendarDate(value)) return null;
  const milliseconds = Date.parse(value);
  return isValidDateMilliseconds(milliseconds) ? milliseconds : null;
}

function hasValidIsoCalendarDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:T|$)/.exec(value);
  if (match === null) return true;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1) return false;

  const daysInMonth = [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day <= daysInMonth[month - 1];
}

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function isValidDateMilliseconds(milliseconds: number): boolean {
  if (!Number.isFinite(milliseconds) || Math.abs(milliseconds) > 8.64e15) return false;

  const year = new Date(milliseconds).getUTCFullYear();
  return year >= 0 && year <= 9_999;
}

function formatUtcDate(milliseconds: number | undefined): string {
  return milliseconds === undefined ? "" : new Date(milliseconds).toISOString().slice(0, 10);
}
