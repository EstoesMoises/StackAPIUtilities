import { compareCodeUnits, readNonNegativeNumber, readQuestionTags, readTagIdentity, type NormalizedTagIdentity } from "../domain/tagNormalization";
import { formatApiDateTime, parseApiTimestamp } from "../utils/apiDates";
import { readOptionalNumber, type TagDetailMetrics } from "./tagMetricFields";

type RecordRow = Record<string, unknown>;
type Role = "askers" | "answerers" | "commenters" | "articleContributors";
interface Aggregate {
  tag: NormalizedTagIdentity;
  metadata: RecordRow;
  v3: boolean;
  views: number;
  hasViews: boolean;
  questions: number;
  articles: number;
  answers: number;
  unanswered: number;
  accepted: number;
  selfAnswered: number;
  questionScore: number;
  answerScore: number;
  articleScore: number;
  questionComments: number;
  answerComments: number;
  articleComments: number;
  smeAnswers: number;
  smeAnswersKnown: boolean;
  smes: Set<string>;
  smeMembersKnown: boolean;
  people: Record<Role, Set<string>>;
  answerTimes: number[];
  responseTimes: number[];
  unavailable: Set<keyof TagDetailMetrics>;
}

/** Join source records once; nested children are complete, unscoped collections for selected posts. */
export function buildLiveTagMetricRows(records: readonly RecordRow[]): RecordRow[] {
  const aggregates = new Map<string, Aggregate>();
  const accountIds = new Map<string, string>();
  for (const record of flattenChildren(records)) {
    const user = asRecord(record.owner) ?? record;
    const userId = readId(user, "user_id", "userId", ...(record.datasetName === "users" || record.owner ? ["id"] : []));
    const accountId = readId(user, "account_id", "accountId");
    if (userId !== null && accountId !== null) accountIds.set(accountId, userId);
  }
  const person = (record: RecordRow): string | null => {
    const owner = asRecord(record.owner);
    const id = owner ? readId(owner, "user_id", "userId", "id") : null;
    const directId = id ?? readId(record, "owner_user_id", "ownerUserId", "owner_id", "ownerId", "user_id", "userId");
    if (directId !== null) return `user:${directId}`;
    const account = readId(owner ?? record, "account_id", "accountId");
    if (account === null) return null;
    const mapped = accountIds.get(account);
    return mapped === undefined ? `account:${account}` : `user:${mapped}`;
  };
  const ensure = (tag: NormalizedTagIdentity, v3 = false): Aggregate => {
    const existing = aggregates.get(tag.key);
    if (existing) {
      if ((v3 && !existing.v3) || (v3 === existing.v3 && compareCodeUnits(tag.displayName, existing.tag.displayName) < 0)) existing.tag = tag;
      existing.v3 ||= v3;
      return existing;
    }
    const created: Aggregate = {
      tag, metadata: {}, v3, views: 0, hasViews: false, questions: 0, articles: 0, answers: 0,
      unanswered: 0, accepted: 0, selfAnswered: 0, questionScore: 0, answerScore: 0, articleScore: 0,
      questionComments: 0, answerComments: 0, articleComments: 0, smeAnswers: 0, smeAnswersKnown: true,
      smes: new Set(), smeMembersKnown: false,
      people: { askers: new Set(), answerers: new Set(), commenters: new Set(), articleContributors: new Set() },
      answerTimes: [], responseTimes: [], unavailable: new Set(),
    };
    aggregates.set(tag.key, created);
    return created;
  };
  // Metadata from v3 wins over v2, including explicit zero watcher/SME counts.
  for (const dataset of ["tagSmeCounts", "tags", "tagLastUsed", "tagSmes"]) {
    for (const record of records.filter((row) => row.datasetName === dataset)) {
      const tag = readTagIdentity(record);
      if (!tag) continue;
      const aggregate = ensure(tag, dataset === "tagSmeCounts");
      if (dataset === "tagSmes") {
        // The legacy dataset contains top answerers, not assigned v3 SMEs.
        if (aggregate.smeMembersKnown || aggregate.metadata.subjectMatterExpertCount !== undefined) continue;
        const id = person(record);
        if (id !== null) aggregate.smes.add(id);
        continue;
      }
      if (dataset === "tagLastUsed") {
        const date = readDate(record, "lastUsed", "last_used");
        if (date > String(aggregate.metadata.last_used ?? "")) aggregate.metadata.last_used = date;
        continue;
      }
      for (const [key, value] of Object.entries(record)) {
        if (aggregate.metadata[key] === undefined || aggregate.metadata[key] === null) aggregate.metadata[key] = value;
      }
      const creation = readDate(record, "tagCreationDate", "tag_creation_date", "creationDate", "creation_date");
      if (creation && !aggregate.metadata.tag_creation_date) aggregate.metadata.tag_creation_date = creation;
      if (aggregate.metadata.watcher_count === undefined) {
        const watchers = readNonNegativeNumber(record, ["watcherCount", "watcher_count", "tagWatchers", "followers", "follower_count"]);
        if (watchers !== null) aggregate.metadata.watcher_count = watchers;
      }
      const membership = asRecord(record.subjectMatterExperts) ?? asRecord(record.smes);
      if (membership) {
        aggregate.smeMembersKnown = Array.isArray(membership.users) && Array.isArray(membership.userGroups)
          && recordList(membership.userGroups).every((group) => Array.isArray(group.users));
        const users = [...recordList(membership.users), ...recordList(membership.userGroups).flatMap((group) => recordList(group.users))];
        for (const user of users) {
          const id = person({ owner: user });
          if (id !== null) aggregate.smes.add(id);
        }
      }
      if (readOptionalNumber(record, "subjectMatterExpertCount") === 0) aggregate.smeMembersKnown = true;
    }
  }

  const questionRows = records.filter((row) => row.datasetName === "questions" && !isDeleted(row));
  const articleRows = records.filter((row) => row.datasetName === "articles" && !isDeleted(row));
  const answerRows = records.filter((row) => row.datasetName === "answers" && !isDeleted(row));
  const commentRows = records.filter((row) => row.datasetName === "comments" && !isDeleted(row));
  const answersByQuestion = groupBy(answerRows, (row) => readId(row, "question_id", "questionId"));
  const commentsByPost = groupBy(commentRows, (row) => readId(row, "post_id", "postId"));
  const postTags = new Map<string, NormalizedTagIdentity[]>();
  const excludedPosts = new Set(records.filter((row) => row.datasetName !== "comments" && isDeleted(row))
    .map((row) => readId(row, "answer_id", "article_id", "question_id", "id")).filter((id): id is string => id !== null));
  const nestedAnswerIds = new Set<string>();
  const nestedCommentIds = new Set<string>();
  for (const row of flattenChildren(records)) {
    for (const answer of recordList(row.answers)) {
      const id = readId(answer, "answer_id", "answerId", "id");
      if (id !== null) { nestedAnswerIds.add(id); if (isDeleted(answer) || isDeleted(row)) excludedPosts.add(id); }
    }
    for (const comment of recordList(row.comments)) {
      const id = readId(comment, "comment_id", "commentId", "id");
      if (id !== null) nestedCommentIds.add(id);
    }
  }
  const addPerson = (aggregate: Aggregate, role: Role, record: RecordRow) => {
    const id = person(record);
    if (id !== null) aggregate.people[role].add(id);
  };
  const children = (row: RecordRow, field: string, fallback: RecordRow[]): RecordRow[] =>
    (Array.isArray(row[field]) ? recordList(row[field]) : fallback).filter((child) => !isDeleted(child));
  const responseHours = (question: RecordRow, responses: RecordRow[]): number | null => {
    const start = timestamp(question);
    if (start === null) return null;
    const asker = person(question);
    const times = responses.filter((response) => asker === null || person(response) !== asker)
      .map(timestamp).filter((time): time is number => time !== null && time >= start);
    return times.length === 0 ? null : (Math.min(...times) - start) / 3_600_000;
  };

  for (const question of questionRows) {
    const tags = readTags(question);
    const id = readId(question, "question_id", "questionId", "id");
    if (id !== null) postTags.set(id, tags);
    const answers = children(question, "answers", id === null ? [] : answersByQuestion.get(id) ?? []);
    const comments = children(question, "comments", id === null ? [] : commentsByPost.get(id) ?? []);
    const answerCount = Array.isArray(question.answers) ? answers.length
      : readNonNegativeNumber(question, ["answer_count", "answerCount"]) ?? answers.length;
    const answersComplete = completeChildren(question, "answers", answers, "answer_count", "answerCount");
    const commentsComplete = completeChildren(question, "comments", comments, "comment_count", "commentCount");
    let firstAnswer = responseHours(question, answers);
    if (firstAnswer === null && !Array.isArray(question.answers) && answers.length === 0) {
      const first = readTimestamp(question, "first_answer_creation_date", "firstAnswerCreationDate", "first_answer_date", "firstAnswerDate", "first_answered_at", "firstAnsweredAt");
      const start = timestamp(question);
      if (start !== null && first !== null && first >= start) firstAnswer = (first - start) / 3_600_000;
    }
    const firstComment = responseHours(question, comments);
    const positiveResponses = [firstAnswer, firstComment].filter((hours): hours is number => hours !== null && hours > 0);
    const chronological = answers.filter((answer) => timestamp(answer) !== null).sort((a, b) => timestamp(a)! - timestamp(b)!);
    const isSelfAnswered = chronological.length > 0 && person(question) !== null && person(chronological[0]) === person(question);
    for (const answer of answers) {
      const answerId = readId(answer, "answer_id", "answerId", "id");
      if (answerId !== null) postTags.set(answerId, tags);
    }
    for (const tag of tags) {
      const a = ensure(tag);
      if (readOptionalNumber(question, "score") === null) a.unavailable.add("question_score");
      if (!answersComplete) for (const field of ["answer_score", "answer_comments", "questions_self_answered", "unique_answerers", "unique_commenters", "median_first_response_hours"] as const) a.unavailable.add(field);
      if (!commentsComplete) { a.unavailable.add("unique_commenters"); a.unavailable.add("median_first_response_hours"); }
      if (!Array.isArray(question.comments) && readNonNegativeNumber(question, ["comment_count", "commentCount"]) === null) a.unavailable.add("question_comments");
      if (answers.some((answer) => timestamp(answer) === null)) a.unavailable.add("questions_self_answered");
      a.questions += 1;
      a.questionScore += readOptionalNumber(question, "score") ?? 0;
      a.answers += answerCount;
      if (answerCount === 0) a.unanswered += 1;
      if (answers.some((answer) => readBoolean(answer, "is_accepted", "isAccepted") === true)
        || (!Array.isArray(question.answers) && readId(question, "accepted_answer_id", "acceptedAnswerId") !== null)) a.accepted += 1;
      else if (!answersComplete) a.unavailable.add("questions_accepted_answer");
      if (isSelfAnswered) a.selfAnswered += 1;
      a.questionComments += Array.isArray(question.comments) ? comments.length : readNonNegativeNumber(question, ["comment_count", "commentCount"]) ?? comments.length;
      if (firstAnswer !== null && firstAnswer > 0) a.answerTimes.push(firstAnswer);
      if (positiveResponses.length > 0) a.responseTimes.push(Math.min(...positiveResponses));
      addViews(a, question);
      addPerson(a, "askers", question);
      for (const comment of comments) addPerson(a, "commenters", comment);
      for (const answer of answers) {
        addPerson(a, "answerers", answer);
        a.answerScore += readOptionalNumber(answer, "score") ?? 0;
        if (readOptionalNumber(answer, "score") === null) a.unavailable.add("answer_score");
        const answerId = readId(answer, "answer_id", "answerId", "id");
        const answerComments = children(answer, "comments", answerId === null ? [] : commentsByPost.get(answerId) ?? []);
        a.answerComments += Array.isArray(answer.comments) ? answerComments.length : readNonNegativeNumber(answer, ["comment_count", "commentCount"]) ?? answerComments.length;
        if (!completeChildren(answer, "comments", answerComments, "comment_count", "commentCount")) a.unavailable.add("unique_commenters");
        if (!Array.isArray(answer.comments) && readNonNegativeNumber(answer, ["comment_count", "commentCount"]) === null) a.unavailable.add("answer_comments");
        for (const comment of answerComments) addPerson(a, "commenters", comment);
        const author = person(answer);
        if (a.smeMembersKnown) {
          if (author !== null && a.smes.has(author)) a.smeAnswers += 1;
        } else {
          const isSme = readBoolean(answer, "isSubjectMatterExpert", "is_subject_matter_expert");
          if (isSme === null) a.smeAnswersKnown = false;
          else if (isSme) a.smeAnswers += 1;
        }
      }
      if (answerCount > answers.length) a.smeAnswersKnown = false;
    }
  }
  for (const article of articleRows) {
    const tags = readTags(article);
    const id = readId(article, "article_id", "articleId", "id");
    if (id !== null) postTags.set(id, tags);
    const comments = children(article, "comments", id === null ? [] : commentsByPost.get(id) ?? []);
    for (const tag of tags) {
      const a = ensure(tag);
      a.articles += 1;
      a.articleScore += readOptionalNumber(article, "score") ?? 0;
      if (readOptionalNumber(article, "score") === null) a.unavailable.add("article_score");
      a.articleComments += Array.isArray(article.comments) ? comments.length : readNonNegativeNumber(article, ["comment_count", "commentCount"]) ?? comments.length;
      if (!completeChildren(article, "comments", comments, "comment_count", "commentCount")) a.unavailable.add("unique_commenters");
      if (!Array.isArray(article.comments) && readNonNegativeNumber(article, ["comment_count", "commentCount"]) === null) a.unavailable.add("article_comments");
      addViews(a, article);
      addPerson(a, "articleContributors", article);
      for (const comment of comments) addPerson(a, "commenters", comment);
    }
  }
  // Keep period-scoped contributors on older posts; sets prevent duplicate nested children.
  for (const answer of answerRows) {
    const id = readId(answer, "answer_id", "answerId", "id");
    if (id !== null && (nestedAnswerIds.has(id) || excludedPosts.has(id))) continue;
    const questionId = readId(answer, "question_id", "questionId");
    if (questionId !== null && excludedPosts.has(questionId)) continue;
    const tags = (questionId === null ? undefined : postTags.get(questionId)) ?? readTags(answer);
    if (id !== null) postTags.set(id, tags);
    for (const tag of tags) addPerson(ensure(tag), "answerers", answer);
  }
  for (const comment of commentRows) {
    const id = readId(comment, "comment_id", "commentId", "id");
    if (id !== null && nestedCommentIds.has(id)) continue;
    const postId = readId(comment, "post_id", "postId");
    if (postId !== null && excludedPosts.has(postId)) continue;
    const tags = (postId === null ? undefined : postTags.get(postId)) ?? readTags(comment);
    for (const tag of tags) addPerson(ensure(tag), "commenters", comment);
  }
  return [...aggregates.values()].map((a) => ({
    ...a.metadata,
    tagName: a.tag.displayName,
    totalPageViews: a.hasViews ? a.views : readOptionalNumber(a.metadata, "totalPageViews", "page_views", "view_count", "viewCount") ?? 0,
    questionCount: a.questions,
    articleCount: a.articles,
    answerCount: a.answers,
    questionsNoAnswers: a.unanswered,
    totalSmes: readOptionalNumber(a.metadata, "subjectMatterExpertCount") ?? a.smes.size,
    totalUniqueContributors: new Set(Object.values(a.people).flatMap((people) => [...people])).size,
    unique_askers: a.people.askers.size,
    unique_answerers: a.people.answerers.size,
    unique_commenters: a.people.commenters.size,
    unique_article_contributors: a.people.articleContributors.size,
    question_score: a.questionScore, question_comments: a.questionComments,
    questions_accepted_answer: a.accepted, questions_self_answered: a.selfAnswered,
    answer_score: a.answerScore, answer_comments: a.answerComments,
    sme_answers: a.smeAnswersKnown ? a.smeAnswers : null,
    article_score: a.articleScore, article_comments: a.articleComments,
    medianFirstAnswerHours: median(a.answerTimes), median_first_response_hours: median(a.responseTimes),
    ...Object.fromEntries([...a.unavailable].map((field) => [field, null])),
  }));
}

function flattenChildren(rows: readonly RecordRow[]): RecordRow[] {
  const all = [...rows];
  for (let index = 0; index < all.length; index += 1) all.push(...recordList(all[index].answers), ...recordList(all[index].comments));
  return all;
}
function completeChildren(parent: RecordRow, field: string, children: RecordRow[], ...countAliases: string[]): boolean {
  return Array.isArray(parent[field]) || readNonNegativeNumber(parent, countAliases) === children.length;
}

function addViews(a: Aggregate, record: RecordRow): void {
  const views = readNonNegativeNumber(record, ["view_count", "viewCount", "page_views", "pageViews", "totalPageViews"]);
  if (views !== null) { a.views += views; a.hasViews = true; }
}
function readTags(record: RecordRow): NormalizedTagIdentity[] {
  return readQuestionTags(Array.isArray(record.tags) ? { ...record, tags: record.tags.map((tag) => asRecord(tag)?.name ?? tag) } : record);
}
function asRecord(value: unknown): RecordRow | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as RecordRow : null;
}
function recordList(value: unknown): RecordRow[] {
  return Array.isArray(value) ? value.map(asRecord).filter((row): row is RecordRow => row !== null) : [];
}
function readId(row: RecordRow, ...aliases: string[]): string | null {
  for (const alias of aliases) {
    const value = row[alias];
    if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return String(value);
    if (typeof value === "string" && value.trim() !== "") return value.trim();
  }
  return null;
}
function readBoolean(row: RecordRow, ...aliases: string[]): boolean | null {
  for (const alias of aliases) {
    const value = row[alias];
    if (value === true || value === "true") return true;
    if (value === false || value === "false") return false;
  }
  return null;
}
function isDeleted(row: RecordRow): boolean { return readBoolean(row, "is_deleted", "isDeleted") === true; }
function timestamp(row: RecordRow): number | null { return readTimestamp(row, "creation_date", "creationDate", "created_at", "createdAt"); }
function readTimestamp(row: RecordRow, ...aliases: string[]): number | null {
  for (const alias of aliases) { const value = parseApiTimestamp(row[alias]); if (value !== null) return value; }
  return null;
}
export function readDate(row: RecordRow, ...aliases: string[]): string {
  for (const alias of aliases) { const date = formatApiDateTime(row[alias]); if (date) return date; }
  return "";
}
function groupBy(rows: RecordRow[], key: (row: RecordRow) => string | null): Map<string, RecordRow[]> {
  const grouped = new Map<string, RecordRow[]>();
  for (const row of rows) {
    const id = key(row);
    if (id === null) continue;
    const group = grouped.get(id);
    if (group) group.push(row);
    else grouped.set(id, [row]);
  }
  return grouped;
}
function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return Number((sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2).toFixed(2));
}
