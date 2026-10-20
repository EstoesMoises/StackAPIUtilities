import { StackApiError } from "../api/httpClient";
import { readNonNegativeNumber, readTagIdentity } from "../domain/tagNormalization";
import type { InstanceType } from "../domain/types";
import type { CollectedDatasetResult, DatasetClient, DatasetPaginationMetadata } from "./liveCollectors";

type RecordData = Record<string, unknown>;

const answerFields = [
  "id", "answerId", "answer_id", "questionId", "question_id", "creationDate", "creation_date",
  "score", "isAccepted", "is_accepted", "isDeleted", "is_deleted", "isSubjectMatterExpert",
  "commentCount", "comment_count", "ownerUserId", "owner_user_id",
] as const;
const commentFields = [
  "id", "commentId", "comment_id", "postId", "post_id", "ownerUserId", "owner_user_id",
  "creationDate", "creation_date", "isDeleted", "is_deleted",
] as const;

/** Complete child collections are authoritative, including empty arrays. */
export async function enrichTagReportDataset(
  dataset: "questions" | "articles" | "tagSmeCounts",
  client: DatasetClient,
  collected: CollectedDatasetResult,
  instanceType?: InstanceType,
  tagsWithAnswers?: ReadonlySet<string>,
): Promise<CollectedDatasetResult> {
  assertComplete(collected.pagination, dataset);
  const pagination = { ...collected.pagination };
  const records: unknown[] = [];

  async function getJson(path: string): Promise<unknown> {
    if (!client.getJson) throw new Error("Tag Report enrichment requires a v3 client with getJson support.");
    const result = await client.getJson(path);
    pagination.pageCount += 1;
    return result;
  }

  async function getComments(path: string): Promise<RecordData[]> {
    return requireRecords(await getJson(path), path).map((comment) => projectChild(comment, commentFields));
  }

  for (const record of collected.records) {
    if (!isRecord(record)) {
      records.push(record);
      continue;
    }
    const id = getId(record, dataset === "questions" ? ["question_id", "questionId", "id"]
      : dataset === "articles" ? ["article_id", "articleId", "id"] : ["tag_id", "tagId", "id"]);
    if (id === null) {
      records.push(record);
      continue;
    }

    if (dataset === "tagSmeCounts") {
      const tag = readTagIdentity(record);
      // The list already provides counts and metadata for every tag. Memberships are only
      // needed to attribute answers on the selected questions to assigned experts.
      if ((readNonNegativeNumber(record, ["subjectMatterExpertCount"]) ?? 0) === 0
        || (tagsWithAnswers !== undefined && tag !== null && !tagsWithAnswers.has(tag.key))) {
        records.push(record);
        continue;
      }
      const path = `/tags/${id}`;
      const detail = await getJson(path);
      if (!isRecord(detail)) throw invalidResult(path);
      // Current tag detail exposes memberships; older installations use the script's endpoint.
      const membership = detail.subjectMatterExperts ?? await getJson(`${path}/subject-matter-experts`);
      assertMembership(membership, path);
      records.push({ ...record, ...detail, subjectMatterExperts: membership });
      continue;
    }

    const path = `/${dataset}/${id}`;
    const answers: RecordData[] = [];
    if (dataset === "questions" && readNonNegativeNumber(record, ["answer_count", "answerCount"]) !== 0) {
      const answerPath = `${path}/answers`;
      const result = await client.getPagedResult(answerPath, { pageSize: "100", sort: "creation", order: "asc" });
      assertComplete(result, answerPath);
      pagination.pageCount += result.pageCount;
      for (const answer of requireRecords(result.items, answerPath)) {
        const answerId = getId(answer, ["id", "answerId", "answer_id"]);
        const comments = answer.isDeleted || answer.is_deleted
          || readNonNegativeNumber(answer, ["commentCount", "comment_count"]) === 0
          ? [] : answerId === null ? undefined : await getComments(`${answerPath}/${answerId}/comments`);
        answers.push({ ...projectChild(answer, answerFields), ...(comments === undefined ? {} : { comments }) });
      }
    }
    // v2 question/article list records may omit comment counts, so only an explicit zero skips collection.
    const comments = readNonNegativeNumber(record, ["comment_count", "commentCount"]) === 0
      ? [] : await getComments(`${path}/comments`);
    records.push({ ...record, ...(dataset === "questions" ? { answers } : {}), comments });
  }

  const result = { records, pagination };
  return dataset === "tagSmeCounts" && instanceType === "enterprise" && records.length > 0
    ? enrichCommunityCounts(client, result) : result;
}

async function enrichCommunityCounts(client: DatasetClient, collected: CollectedDatasetResult): Promise<CollectedDatasetResult> {
  let result;
  try {
    result = await client.getPagedResult("/communities", { pageSize: "100" });
  } catch (error) {
    // Communities only exist on supported Enterprise sites and may require additional access.
    if (error instanceof StackApiError && (error.status === 403 || error.status === 404)) return collected;
    throw error;
  }
  assertComplete(result, "/communities");
  const counts = new Map<string, number>();
  for (const community of requireRecords(result.items, "/communities")) {
    const tags = requireRecords(community.tags, "/communities tags");
    const tagNames = new Set<string>();
    for (const record of tags) {
      const tag = readTagIdentity(record);
      if (tag === null) throw invalidResult("/communities tags");
      tagNames.add(tag.key);
    }
    for (const name of tagNames) counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return {
    records: collected.records.map((record) => {
      if (!isRecord(record)) return record;
      const tag = readTagIdentity(record);
      return tag === null ? record : { ...record, communities: counts.get(tag.key) ?? 0 };
    }),
    pagination: { ...collected.pagination, pageCount: collected.pagination.pageCount + result.pageCount },
  };
}

function projectChild(record: RecordData, fields: readonly string[]): RecordData {
  const projected = Object.fromEntries(fields.filter((field) => record[field] !== undefined).map((field) => [field, record[field]]));
  const owner = record.owner;
  if (isRecord(owner)) {
    projected.owner = Object.fromEntries(["id", "user_id", "userId", "accountId", "account_id"].filter((field) => owner[field] !== undefined)
      .map((field) => [field, owner[field]]));
  } else if (owner === null) projected.owner = null;
  return projected;
}

function assertMembership(value: unknown, path: string): asserts value is RecordData {
  if (!isRecord(value)) throw invalidResult(`${path} subject matter experts`);
  requireRecords(value.users, `${path} subject matter expert users`);
  const groups = requireRecords(value.userGroups, `${path} subject matter expert groups`);
  for (const group of groups) requireRecords(group.users, `${path} subject matter expert group users`);
}

function requireRecords(value: unknown, path: string): RecordData[] {
  if (!Array.isArray(value) || !value.every(isRecord)) throw invalidResult(path);
  return value;
}

function invalidResult(path: string): Error {
  return new Error(`Tag Report received an invalid result for ${path}. No complete result was produced.`);
}

function assertComplete(pagination: DatasetPaginationMetadata, path: string): void {
  if (pagination.hasMore || pagination.reachedMaxPages) {
    throw new Error(`Incomplete ${path} lookup for Tag Report. No complete result was produced.`);
  }
}

function getId(record: RecordData, aliases: readonly string[]): string | null {
  for (const alias of aliases) {
    const value = record[alias];
    if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) return String(value);
    if (typeof value === "string" && value.trim() !== "") return encodeURIComponent(value.trim());
  }
  return null;
}

function isRecord(value: unknown): value is RecordData {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
