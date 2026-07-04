export interface InactiveUserRow {
  userId: number;
  inactiveDays: number;
  isDeactivated: boolean;
  reputation: number;
  answerCount: number;
  questionCount: number;
  articleCount: number;
}

export function summarizeInactiveUsers(rows: InactiveUserRow[]) {
  return {
    totalInactiveUsers: rows.length,
    deactivatedInactiveUsers: rows.filter((row) => row.isDeactivated).length,
    contributingInactiveUsers: rows.filter(
      (row) => row.answerCount + row.questionCount + row.articleCount > 0,
    ).length,
    highReputationInactiveUsers: rows.filter((row) => row.reputation >= 100).length,
  };
}
