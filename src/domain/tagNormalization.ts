export interface NormalizedTagIdentity {
  key: string;
  displayName: string;
}

export const QUESTION_VIEW_ALIASES = ["view_count", "viewCount", "page_views", "pageViews", "totalPageViews"] as const;
export const TAG_COUNT_ALIASES = ["questionCount", "question_count", "count"] as const;
export const QUESTION_ID_ALIASES = ["question_id", "questionId", "id"] as const;
export const QUESTION_TAG_ALIASES = ["tags", "tagNames", "tag_names"] as const;
export const TAG_NAME_ALIASES = ["tagName", "tag_name", "name"] as const;

export function normalizeTagIdentity(value: unknown): NormalizedTagIdentity | null {
  if (typeof value !== "string") return null;
  const displayName = value.normalize("NFKC").trim();
  if (displayName === "") return null;
  return { key: displayName.toLowerCase(), displayName };
}

export function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function chooseDisplayTagName(values: readonly string[]): string | null {
  const names = values
    .map(normalizeTagIdentity)
    .filter((value): value is NormalizedTagIdentity => value !== null)
    .map((value) => value.displayName)
    .sort(compareCodeUnits);
  return names[0] ?? null;
}

export function readTagIdentity(record: Record<string, unknown>): NormalizedTagIdentity | null {
  for (const alias of TAG_NAME_ALIASES) {
    const identity = normalizeTagIdentity(record[alias]);
    if (identity !== null) return identity;
  }

  return null;
}

export function readQuestionTags(record: Record<string, unknown>): NormalizedTagIdentity[] {
  const values = QUESTION_TAG_ALIASES.flatMap((alias) => readTagValues(record[alias]));
  if (values.length === 0) {
    const singleTag = readTagIdentity(record);
    return singleTag === null ? [] : [singleTag];
  }

  const identities = new Map<string, NormalizedTagIdentity>();
  for (const value of values) {
    const identity = normalizeTagIdentity(value);
    if (identity !== null && !identities.has(identity.key)) identities.set(identity.key, identity);
  }

  return [...identities.values()];
}

export function readNonNegativeNumber(record: Record<string, unknown>, aliases: readonly string[]): number | null {
  for (const alias of aliases) {
    const value = record[alias];
    const number =
      typeof value === "number"
        ? value
        : typeof value === "string" && value.trim() !== ""
          ? Number(value)
          : null;

    if (number !== null && Number.isFinite(number) && number >= 0) return number;
  }

  return null;
}

export function readStableQuestionId(record: Record<string, unknown>): string | null {
  for (const alias of QUESTION_ID_ALIASES) {
    const value = record[alias];
    if (typeof value === "string" && value.trim() !== "") return value.trim();
    if (typeof value === "number" && Number.isFinite(value) && Number.isInteger(value)) return String(value);
  }

  return null;
}

function readTagValues(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((tag): tag is string => typeof tag === "string");
  if (typeof value === "string") return value.split(/[;,]/);
  return [];
}
