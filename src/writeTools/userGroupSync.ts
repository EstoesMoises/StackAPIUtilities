import Papa from "papaparse";

export const USER_EXPORT_HEADERS = [
  "Director",
  "Senior Manager",
  "User Group Member",
  "First Name",
  "Last Name",
  "Colleague ID",
  "Email",
  "Job Title",
] as const;

type UserExportHeader = (typeof USER_EXPORT_HEADERS)[number];

type RawUserExportRow = Record<UserExportHeader, string | undefined>;

export type UserGroupSyncMode = "add-only" | "exact-sync";

export interface UserExportRow {
  rowNumber: number;
  director: string;
  seniorManager: string;
  userGroupMember: string;
  firstName: string;
  lastName: string;
  colleagueId: string;
  email: string;
  jobTitle: string;
}

export interface ResolvedStackUser {
  id: number;
  email: string;
  name?: string;
}

export interface ExistingUserGroupMember {
  id: number;
  name?: string;
}

export interface ExistingUserGroup {
  id: number;
  name: string;
  users: ExistingUserGroupMember[];
}

export type UserGroupSyncSkippedRowReason =
  | "Missing Senior Manager"
  | "Missing Email"
  | "Duplicate Email"
  | "Email not found in Stack Enterprise";

export interface UserGroupSyncSkippedRow {
  rowNumber: number;
  email: string;
  seniorManager: string;
  reason: UserGroupSyncSkippedRowReason;
}

export interface PlannedUserGroupSyncGroup {
  manager: string;
  groupName: string;
  existingGroupId: number | null;
  createGroup: boolean;
  desiredUserIds: number[];
  addUserIds: number[];
  removeUserIds: number[];
}

export interface UserGroupSyncPlan {
  syncMode: UserGroupSyncMode;
  groupNameTemplate: string;
  groups: PlannedUserGroupSyncGroup[];
  skippedRows: UserGroupSyncSkippedRow[];
  blockingErrors: string[];
}

export interface PlanUserGroupSyncInput {
  rows: UserExportRow[];
  groupNameTemplate: string;
  syncMode: UserGroupSyncMode;
  existingGroups: ExistingUserGroup[];
  resolvedUsers: Record<string, ResolvedStackUser | null | undefined>;
}

interface DesiredGroup {
  groupName: string;
  managers: Set<string>;
  desiredUserIds: Set<number>;
}

export function parseUserExportCsv(csvText: string): UserExportRow[] {
  const parsed = Papa.parse<RawUserExportRow>(csvText, {
    header: true,
    dynamicTyping: false,
    skipEmptyLines: true,
  });

  if (parsed.errors.length > 0) {
    throw new Error(parsed.errors.map((error) => error.message).join("; "));
  }

  const fields = parsed.meta.fields ?? [];
  const missingHeaders = USER_EXPORT_HEADERS.filter((header) => !fields.includes(header));
  if (missingHeaders.length > 0) {
    throw new Error(`User export CSV is missing required column(s): ${missingHeaders.join(", ")}`);
  }

  return parsed.data.map((row, index) => ({
    rowNumber: index + 2,
    director: readCell(row, "Director"),
    seniorManager: readCell(row, "Senior Manager"),
    userGroupMember: readCell(row, "User Group Member"),
    firstName: readCell(row, "First Name"),
    lastName: readCell(row, "Last Name"),
    colleagueId: readCell(row, "Colleague ID"),
    email: readCell(row, "Email"),
    jobTitle: readCell(row, "Job Title"),
  }));
}

export function renderGroupName(template: string, seniorManager: string): string {
  return template.split("{Senior Manager}").join(seniorManager).trim();
}

export function planUserGroupSync(input: PlanUserGroupSyncInput): UserGroupSyncPlan {
  const existingGroupsByName = new Map(
    input.existingGroups.map((group) => [normalizeKey(group.name), group] as const),
  );
  const resolvedUsersByEmail = new Map(
    Object.entries(input.resolvedUsers).map(([email, user]) => [normalizeKey(email), user] as const),
  );

  const skippedRows: UserGroupSyncSkippedRow[] = [];
  const seenEmails = new Set<string>();
  const desiredGroupsByName = new Map<string, DesiredGroup>();

  for (const row of input.rows) {
    const email = row.email.trim();
    const seniorManager = row.seniorManager.trim();

    if (!email) {
      skippedRows.push(toSkippedRow(row, "Missing Email", email, seniorManager));
      continue;
    }

    const emailKey = normalizeKey(email);
    const isDuplicateEmail = seenEmails.has(emailKey);

    if (!seniorManager) {
      skippedRows.push(toSkippedRow(row, "Missing Senior Manager", email, seniorManager));
      continue;
    }

    if (isDuplicateEmail) {
      skippedRows.push(toSkippedRow(row, "Duplicate Email", email, seniorManager));
      continue;
    }

    seenEmails.add(emailKey);

    const resolvedUser = resolvedUsersByEmail.get(emailKey);
    if (!resolvedUser) {
      skippedRows.push(toSkippedRow(row, "Email not found in Stack Enterprise", email, seniorManager));
      continue;
    }

    const groupName = renderGroupName(input.groupNameTemplate, seniorManager);
    const groupKey = normalizeKey(groupName);
    const desiredGroup = desiredGroupsByName.get(groupKey) ?? {
      groupName,
      managers: new Set<string>(),
      desiredUserIds: new Set<number>(),
    };

    desiredGroup.managers.add(seniorManager);
    desiredGroup.desiredUserIds.add(resolvedUser.id);
    desiredGroupsByName.set(groupKey, desiredGroup);
  }

  const blockingErrors = collectBlockingErrors(desiredGroupsByName);
  const groups = [...desiredGroupsByName.values()]
    .map((desiredGroup) => toPlannedGroup(desiredGroup, existingGroupsByName, input.syncMode))
    .sort((left, right) => compareStrings(left.groupName, right.groupName));

  return {
    syncMode: input.syncMode,
    groupNameTemplate: input.groupNameTemplate,
    groups,
    skippedRows,
    blockingErrors,
  };
}

function readCell(row: RawUserExportRow, header: UserExportHeader): string {
  return String(row[header] ?? "").trim();
}

function normalizeKey(value: string): string {
  return value.trim().toLowerCase();
}

function toSkippedRow(
  row: UserExportRow,
  reason: UserGroupSyncSkippedRowReason,
  email: string,
  seniorManager: string,
): UserGroupSyncSkippedRow {
  return {
    rowNumber: row.rowNumber,
    email,
    seniorManager,
    reason,
  };
}

function collectBlockingErrors(desiredGroupsByName: Map<string, DesiredGroup>): string[] {
  const blockingErrors: string[] = [];

  for (const desiredGroup of desiredGroupsByName.values()) {
    const managers = [...desiredGroup.managers].sort(compareStrings);

    if (!desiredGroup.groupName) {
      blockingErrors.push(
        `Group name template produced a blank group name for Senior Manager value(s): ${managers.join(", ")}.`,
      );
    }

    if (managers.length > 1) {
      blockingErrors.push(
        `Group name "${desiredGroup.groupName}" is produced by multiple Senior Manager values: ${managers.join(", ")}.`,
      );
    }
  }

  return blockingErrors;
}

function toPlannedGroup(
  desiredGroup: DesiredGroup,
  existingGroupsByName: Map<string, ExistingUserGroup>,
  syncMode: UserGroupSyncMode,
): PlannedUserGroupSyncGroup {
  const existingGroup = existingGroupsByName.get(normalizeKey(desiredGroup.groupName)) ?? null;
  const existingUserIds = new Set(existingGroup?.users.map((user) => user.id) ?? []);
  const desiredUserIds = sortNumbers([...desiredGroup.desiredUserIds]);

  return {
    manager: [...desiredGroup.managers].sort(compareStrings)[0] ?? "",
    groupName: desiredGroup.groupName,
    existingGroupId: existingGroup?.id ?? null,
    createGroup: existingGroup === null,
    desiredUserIds,
    addUserIds: desiredUserIds.filter((userId) => !existingUserIds.has(userId)),
    removeUserIds:
      syncMode === "exact-sync"
        ? sortNumbers([...existingUserIds].filter((userId) => !desiredGroup.desiredUserIds.has(userId)))
        : [],
  };
}

function sortNumbers(values: number[]): number[] {
  return values.sort((left, right) => left - right);
}

function compareStrings(left: string, right: string): number {
  const normalizedLeft = normalizeKey(left);
  const normalizedRight = normalizeKey(right);

  if (normalizedLeft < normalizedRight) {
    return -1;
  }

  if (normalizedLeft > normalizedRight) {
    return 1;
  }

  if (left < right) {
    return -1;
  }

  if (left > right) {
    return 1;
  }

  return 0;
}
