import type { CountMap } from "./reportModels";

export interface CommunityMemberRow {
  name: string;
  isSme: boolean;
  department?: string;
}

export function summarizeCommunityMembers(rows: CommunityMemberRow[]) {
  return {
    totalMembers: rows.length,
    smeMembers: rows.filter((row) => row.isSme).length,
    departmentCounts: rows.reduce<CountMap>((counts, row) => {
      const key = row.department || "Unknown";
      counts[key] = (counts[key] ?? 0) + 1;
      return counts;
    }, {}),
  };
}
