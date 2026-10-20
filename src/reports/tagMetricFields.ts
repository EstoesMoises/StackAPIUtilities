/** Additional script metrics. Null means the source did not supply the metric. */
export const TAG_DETAIL_FIELDS = {
  webhooks: ["Webhooks", "webhookCount", "webhook_count"],
  communities: ["Communities", "communityCount", "community_count"],
  median_first_response_hours: ["Median Time To First Response Hours", "medianTimeToFirstResponseHours", "median_time_to_first_response_hours"],
  unique_askers: ["Unique Askers", "uniqueAskers"],
  unique_answerers: ["Unique Answerers", "uniqueAnswerers"],
  unique_commenters: ["Unique Commenters", "uniqueCommenters"],
  unique_article_contributors: ["Unique Article Contributors", "uniqueArticleContributors"],
  question_score: ["Question Score", "questionScore"],
  question_comments: ["Question Comments", "questionComments"],
  questions_accepted_answer: ["Questions Accepted Answer", "questionsAcceptedAnswer"],
  questions_self_answered: ["Questions Self Answered", "questionsSelfAnswered"],
  sme_answers: ["Sme Answers", "smeAnswers"],
  answer_score: ["Answer Score", "answerScore"],
  answer_comments: ["Answer Comments", "answerComments"],
  article_score: ["Article Score", "articleScore"],
  article_comments: ["Article Comments", "articleComments"],
} as const;

export type TagDetailMetrics = Record<keyof typeof TAG_DETAIL_FIELDS, number | null>;
export const TAG_DETAIL_HEADERS = Object.keys(TAG_DETAIL_FIELDS) as (keyof TagDetailMetrics)[];

export function readTagDetailMetrics(row: Record<string, unknown>): TagDetailMetrics {
  return Object.fromEntries(Object.entries(TAG_DETAIL_FIELDS).map(([key, aliases]) => [
    key, readOptionalNumber(row, key, ...aliases),
  ])) as TagDetailMetrics;
}

export function readOptionalNumber(row: Record<string, unknown>, ...aliases: string[]): number | null {
  for (const alias of aliases) {
    const value = row[alias];
    if (typeof value !== "number" && (typeof value !== "string" || value.trim() === "")) continue;
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}
