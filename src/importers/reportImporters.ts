import type { ReportId } from "../domain/types";
import { parseCsvRecords, toBoolean, toNumber } from "./csv";
import { parseJsonRecords } from "./json";

interface ImportedReportFile {
  reportId: ReportId;
  records: Record<string, unknown>[];
}

export async function importReportFile(fileName: string, text: string): Promise<ImportedReportFile> {
  const lower = fileName.toLowerCase();
  const stem = lower.replace(/\.[^.]+$/, "");

  if (lower.endsWith(".json")) {
    return { reportId: "data-export", records: parseJsonRecords(text) as Record<string, unknown>[] };
  }

  if (stem === "tag_metrics") return { reportId: "tag-report", records: importTagMetrics(text) };
  if (stem === "user_metrics") return { reportId: "api-user-report", records: importUserMetrics(text) };
  if (stem === "inactive_users") return { reportId: "inactive-users", records: importInactiveUsers(text) };
  if (/^\d{4}-\d{2}-\d{2}_community_members(?:_.+)?$/.test(stem)) {
    return { reportId: "community-members", records: importCommunityMembers(text) };
  }
  if (stem === "interaction_matrix") return { reportId: "interactions", records: importInteractionMatrix(text) };

  throw new Error(`Unsupported report output file: ${fileName}`);
}

function importTagMetrics(text: string) {
  return parseCsvRecords<Record<string, string>>(text).map((row) => ({
    tagName: row["Tag Name"],
    totalPageViews: toNumber(row["Total Page Views"]),
    webhooks: toNumber(row.Webhooks),
    tagWatchers: toNumber(row["Tag Watchers"]),
    totalSmes: toNumber(row["Total Smes"]),
    questionCount: toNumber(row["Question Count"]),
    answerCount: toNumber(row["Answer Count"]),
  }));
}

function importUserMetrics(text: string) {
  return parseCsvRecords<Record<string, string>>(text).map((row) => ({
    userId: toNumber(row["User ID"]),
    displayName: row["Display Name"],
    netReputation: toNumber(row["Net Reputation"]),
    accountInactivityDays: toNumber(row["Account Inactivity (Days)"]),
    answers: toNumber(row.Answers),
    questions: toNumber(row.Questions),
    accountStatus: row["Account Status"],
    department: row.Department,
  }));
}

function importInactiveUsers(text: string) {
  return parseCsvRecords<Record<string, string>>(text).map((row) => ({
    userId: toNumber(row.user_id),
    email: row.verified_email,
    displayName: row.display_name,
    inactiveDays: toNumber(row.inactive_days),
    isDeactivated: toBoolean(row.is_deactivated),
    reputation: toNumber(row.reputation),
    answerCount: toNumber(row.answer_count),
    questionCount: toNumber(row.question_count),
    articleCount: toNumber(row.article_count),
  }));
}

function importCommunityMembers(text: string) {
  return parseCsvRecords<Record<string, string>>(text).map((row) => ({
    name: row.Name,
    email: row.Email,
    memberSince: row["Member Since"],
    isSme: toBoolean(row["Is SME"]),
    jobTitle: row["Job Title"],
    department: row.Department,
  }));
}

function importInteractionMatrix(text: string) {
  const rows = parseCsvRecords<Record<string, string>>(text);

  return rows.flatMap((row) => {
    const source = row.source;

    return Object.entries(row)
      .filter(([key]) => key !== "source")
      .map(([target, weight]) => ({ source, target, weight: toNumber(weight) }))
      .filter((entry) => entry.weight > 0);
  });
}
