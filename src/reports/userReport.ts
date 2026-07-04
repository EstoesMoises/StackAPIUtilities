import type { CountMap } from "./reportModels";

export interface UserMetricRow {
  userId: number;
  displayName: string;
  netReputation: number;
  accountInactivityDays: number;
  answers: number;
  questions: number;
  accountStatus: string;
  department?: string;
}

export function summarizeUsers(rows: UserMetricRow[]) {
  return {
    totalUsers: rows.length,
    accountStatusCounts: countBy(rows, (row) => row.accountStatus || "Unknown"),
    departmentCounts: countBy(rows, (row) => row.department || "Unknown"),
    topContributors: [...rows].sort((a, b) => b.netReputation - a.netReputation).slice(0, 10),
  };
}

function countBy<T>(rows: T[], getKey: (row: T) => string): CountMap {
  return rows.reduce<CountMap>((counts, row) => {
    const key = getKey(row);
    counts[key] = (counts[key] ?? 0) + 1;
    return counts;
  }, {});
}
