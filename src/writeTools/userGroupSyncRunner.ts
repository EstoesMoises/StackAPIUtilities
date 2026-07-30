import {
  parseUserExportCsv,
  planUserGroupSync,
  type ExistingUserGroup,
  type ExistingUserGroupMember,
  type ResolvedStackUser,
  type UserGroupSyncMode,
  type UserGroupSyncPlan,
} from "./userGroupSync";

type WaitFn = (seconds: number) => Promise<void>;

const USER_LOOKUP_BATCH_SIZE = 20;
const USER_LOOKUP_BATCH_DELAY_SECONDS = 2;
const waitSeconds: WaitFn = (seconds) =>
  new Promise((resolve) => setTimeout(resolve, seconds * 1_000));

export interface UserGroupSyncClientUser {
  id: number;
  email?: string | null;
  name?: string;
}

export interface UserGroupSyncClientGroup {
  id: number;
  name: string;
  users?: ExistingUserGroupMember[];
}

export interface UserGroupSyncClient {
  getUserByEmail(email: string): Promise<UserGroupSyncClientUser | null>;
  getUserGroups(): Promise<UserGroupSyncClientGroup[]>;
  createUserGroup(input: { name: string; userIds: number[] }): Promise<UserGroupSyncClientGroup>;
  addUserGroupMembers(userGroupId: number, userIds: number[]): Promise<UserGroupSyncClientGroup>;
  removeUserGroupMember(userGroupId: number, userId: number): Promise<void>;
}

export interface UserGroupSyncRunnerInput {
  csvText: string;
  groupNameTemplate: string;
  syncMode: UserGroupSyncMode;
  client: UserGroupSyncClient;
  waitFn?: WaitFn;
}

export interface UserGroupSyncOperationResult {
  kind: "create-group" | "add-members" | "remove-member";
  groupName: string;
  userIds: number[];
  status: "succeeded" | "failed";
  error?: string;
}

export interface UserGroupSyncApplyResult {
  preview: UserGroupSyncPlan;
  operations: UserGroupSyncOperationResult[];
}

export class UserGroupSyncInputError extends Error {
  constructor(error: unknown) {
    super(toErrorMessage(error));
    this.name = "UserGroupSyncInputError";
  }
}

export async function previewUserGroupSync(input: UserGroupSyncRunnerInput): Promise<UserGroupSyncPlan> {
  const rows = parseInputCsv(input.csvText);
  const resolvedUsers = await resolveUsersByEmail(
    input.client,
    rows.map((row) => row.email),
    input.waitFn ?? waitSeconds,
  );
  const existingGroups = normalizeExistingGroups(await input.client.getUserGroups());

  return planUserGroupSync({
    rows,
    groupNameTemplate: input.groupNameTemplate,
    syncMode: input.syncMode,
    existingGroups,
    resolvedUsers,
  });
}

export async function applyUserGroupSync(input: UserGroupSyncRunnerInput): Promise<UserGroupSyncApplyResult> {
  const preview = await previewUserGroupSync(input);

  return applyUserGroupSyncPlan(preview, input.client);
}

export async function applyUserGroupSyncPlan(
  preview: UserGroupSyncPlan,
  client: UserGroupSyncClient,
): Promise<UserGroupSyncApplyResult> {
  const operations: UserGroupSyncOperationResult[] = [];

  if (preview.blockingErrors.length > 0) {
    return { preview, operations };
  }

  for (const group of preview.groups) {
    let userGroupId = group.existingGroupId;
    let canRemoveUsers = group.addUserIds.length === 0;

    if (group.createGroup) {
      try {
        const createdGroup = await client.createUserGroup({
          name: group.groupName,
          userIds: group.desiredUserIds,
        });
        userGroupId = createdGroup.id;
        canRemoveUsers = true;
        operations.push({
          kind: "create-group",
          groupName: group.groupName,
          userIds: group.desiredUserIds,
          status: "succeeded",
        });
      } catch (error) {
        operations.push({
          kind: "create-group",
          groupName: group.groupName,
          userIds: group.desiredUserIds,
          status: "failed",
          error: toErrorMessage(error),
        });
        continue;
      }
    } else if (userGroupId !== null && group.addUserIds.length > 0) {
      try {
        await client.addUserGroupMembers(userGroupId, group.addUserIds);
        canRemoveUsers = true;
        operations.push({
          kind: "add-members",
          groupName: group.groupName,
          userIds: group.addUserIds,
          status: "succeeded",
        });
      } catch (error) {
        operations.push({
          kind: "add-members",
          groupName: group.groupName,
          userIds: group.addUserIds,
          status: "failed",
          error: toErrorMessage(error),
        });
        canRemoveUsers = false;
      }
    }

    if (preview.syncMode === "exact-sync" && userGroupId !== null && canRemoveUsers) {
      for (const userId of group.removeUserIds) {
        try {
          await client.removeUserGroupMember(userGroupId, userId);
          operations.push({
            kind: "remove-member",
            groupName: group.groupName,
            userIds: [userId],
            status: "succeeded",
          });
        } catch (error) {
          operations.push({
            kind: "remove-member",
            groupName: group.groupName,
            userIds: [userId],
            status: "failed",
            error: toErrorMessage(error),
          });
        }
      }
    }
  }

  return { preview, operations };
}

function parseInputCsv(csvText: string) {
  try {
    return parseUserExportCsv(csvText);
  } catch (error) {
    throw new UserGroupSyncInputError(error);
  }
}

async function resolveUsersByEmail(
  client: UserGroupSyncClient,
  emails: string[],
  waitFn: WaitFn,
): Promise<Record<string, ResolvedStackUser | null>> {
  const uniqueEmailsByKey = new Map<string, string>();

  for (const email of emails) {
    const normalizedEmail = email.trim();

    if (!normalizedEmail) {
      continue;
    }

    const emailKey = normalizeKey(normalizedEmail);
    if (!uniqueEmailsByKey.has(emailKey)) {
      uniqueEmailsByKey.set(emailKey, normalizedEmail);
    }
  }

  const resolvedUsers: Record<string, ResolvedStackUser | null> = {};
  const emailEntries = [...uniqueEmailsByKey.entries()];

  for (let start = 0; start < emailEntries.length; start += USER_LOOKUP_BATCH_SIZE) {
    const batch = emailEntries.slice(start, start + USER_LOOKUP_BATCH_SIZE);

    await Promise.all(
      batch.map(async ([emailKey, email]) => {
        const user = await client.getUserByEmail(email);
        resolvedUsers[emailKey] =
          user === null
            ? null
            : {
                id: user.id,
                email: user.email ?? email,
                name: user.name,
              };
      }),
    );

    if (start + USER_LOOKUP_BATCH_SIZE < emailEntries.length) {
      await waitFn(USER_LOOKUP_BATCH_DELAY_SECONDS);
    }
  }

  return resolvedUsers;
}

function normalizeExistingGroups(groups: UserGroupSyncClientGroup[]): ExistingUserGroup[] {
  return groups.map((group) => ({
    id: group.id,
    name: group.name,
    users: group.users ?? [],
  }));
}

function normalizeKey(value: string): string {
  return value.trim().toLowerCase();
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
