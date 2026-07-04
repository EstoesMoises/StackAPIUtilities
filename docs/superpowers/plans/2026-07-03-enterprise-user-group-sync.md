# Enterprise User Group Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a guarded Enterprise write tool that creates and updates Stack user groups from an uploaded user export CSV.

**Architecture:** Keep write operations separate from read-only reporting by adding a focused `writeTools` domain module, a small Enterprise v3 mutation surface, a dedicated server route, and one new UI panel. The pure planner parses CSV data, renders `{Senior Manager}` group names, resolves users by email through the server, previews changes, then applies add-only or exact-sync operations.

**Tech Stack:** TypeScript, Next.js App Router route handlers, React, Vitest, Testing Library, Papa Parse, existing Stack API v3 client utilities.

---

## File Structure

- Create `src/writeTools/userGroupSync.ts`: pure CSV parsing, template rendering, plan construction, and result types.
- Create `src/writeTools/userGroupSync.test.ts`: unit tests for CSV parsing and add-only/exact-sync planning.
- Modify `src/api/stackApiV3.ts`: add specific Enterprise user/group read and write methods.
- Modify `src/api/stackApiV3.test.ts`: tests for email lookup, group creation, member add, and member removal.
- Create `src/writeTools/userGroupSyncRunner.ts`: orchestrates preview/apply by combining the planner with a client interface.
- Create `src/writeTools/userGroupSyncRunner.test.ts`: service tests with a fake client.
- Create `src/server/userGroupSyncApi.ts`: validates request payloads and returns JSON responses for preview/apply.
- Create `src/server/userGroupSyncApi.test.ts`: server handler tests.
- Create `src/app/api/write-tools/user-group-sync/route.ts`: Next.js route delegating to the server handler.
- Create `src/components/UserGroupSyncPanel.tsx`: upload/template/sync-mode UI plus preview/apply summaries.
- Create `src/components/UserGroupSyncPanel.test.tsx`: UI tests for preview, add-only, exact-sync confirmation, and blocking errors.
- Modify `src/components/AppShell.tsx`: add `Write Tools` as a top-level panel.
- Modify `src/App.tsx`: render the new panel and pass session credentials.
- Modify `src/components/AppShell.test.tsx`: prove the new panel is reachable in the app shell.
- Modify `src/styles/app.css`: add compact table/form styles used by the write tool.

## Task 1: Pure User Group Sync Planner

**Files:**
- Create: `src/writeTools/userGroupSync.ts`
- Create: `src/writeTools/userGroupSync.test.ts`

- [ ] **Step 1: Write the failing unit tests**

Create `src/writeTools/userGroupSync.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  parseUserExportCsv,
  planUserGroupSync,
  renderGroupName,
  type ExistingUserGroup,
  type ResolvedStackUser,
} from "./userGroupSync";

const csv = [
  "Director,Senior Manager,User Group Member,First Name,Last Name,Colleague ID,Email,Job Title",
  "Pat Director,Ada Lovelace,Grace Hopper,Grace,Hopper,1001,grace@example.com,Engineer",
  "Pat Director,Ada Lovelace,Linus Torvalds,Linus,Torvalds,1002,linus@example.com,Engineer",
  "Pat Director,Alan Turing,Katherine Johnson,Katherine,Johnson,1003,katherine@example.com,Analyst",
].join("\n");

describe("parseUserExportCsv", () => {
  it("accepts the expected user export headers and normalizes rows", () => {
    expect(parseUserExportCsv(csv)).toEqual([
      expect.objectContaining({
        rowNumber: 2,
        seniorManager: "Ada Lovelace",
        email: "grace@example.com",
      }),
      expect.objectContaining({
        rowNumber: 3,
        seniorManager: "Ada Lovelace",
        email: "linus@example.com",
      }),
      expect.objectContaining({
        rowNumber: 4,
        seniorManager: "Alan Turing",
        email: "katherine@example.com",
      }),
    ]);
  });

  it("reports missing required columns", () => {
    expect(() => parseUserExportCsv("Senior Manager,Email\nAda Lovelace,ada@example.com")).toThrow(
      "User export CSV is missing required column(s): Director, User Group Member, First Name, Last Name, Colleague ID, Job Title",
    );
  });
});

describe("renderGroupName", () => {
  it("renders the configurable senior-manager template", () => {
    expect(renderGroupName("{Senior Manager} VRM", "Ada Lovelace")).toBe("Ada Lovelace VRM");
    expect(renderGroupName("VRM - {Senior Manager}", "Ada Lovelace")).toBe("VRM - Ada Lovelace");
  });
});

describe("planUserGroupSync", () => {
  const resolvedUsers: Record<string, ResolvedStackUser | null> = {
    "grace@example.com": { id: 1, email: "grace@example.com", name: "Grace Hopper" },
    "linus@example.com": { id: 2, email: "linus@example.com", name: "Linus Torvalds" },
    "katherine@example.com": { id: 3, email: "katherine@example.com", name: "Katherine Johnson" },
  };

  const existingGroups: ExistingUserGroup[] = [
    {
      id: 10,
      name: "Ada Lovelace VRM",
      users: [{ id: 1, name: "Grace Hopper" }, { id: 99, name: "Former Member" }],
    },
  ];

  it("plans add-only creates and additions without removals", () => {
    const plan = planUserGroupSync({
      rows: parseUserExportCsv(csv),
      groupNameTemplate: "{Senior Manager} VRM",
      syncMode: "add-only",
      existingGroups,
      resolvedUsers,
    });

    expect(plan.blockingErrors).toEqual([]);
    expect(plan.groups).toEqual([
      expect.objectContaining({
        manager: "Ada Lovelace",
        groupName: "Ada Lovelace VRM",
        existingGroupId: 10,
        createGroup: false,
        desiredUserIds: [1, 2],
        addUserIds: [2],
        removeUserIds: [],
      }),
      expect.objectContaining({
        manager: "Alan Turing",
        groupName: "Alan Turing VRM",
        existingGroupId: null,
        createGroup: true,
        desiredUserIds: [3],
        addUserIds: [3],
        removeUserIds: [],
      }),
    ]);
  });

  it("plans exact-sync removals for matching generated groups", () => {
    const plan = planUserGroupSync({
      rows: parseUserExportCsv(csv),
      groupNameTemplate: "{Senior Manager} VRM",
      syncMode: "exact-sync",
      existingGroups,
      resolvedUsers,
    });

    expect(plan.groups[0]).toEqual(expect.objectContaining({ removeUserIds: [99] }));
  });

  it("records skipped rows for blank values, duplicates, and unresolved emails", () => {
    const rows = parseUserExportCsv([
      "Director,Senior Manager,User Group Member,First Name,Last Name,Colleague ID,Email,Job Title",
      "Pat Director,,Grace Hopper,Grace,Hopper,1001,grace@example.com,Engineer",
      "Pat Director,Ada Lovelace,Missing Email,Missing,Email,1002,,Engineer",
      "Pat Director,Ada Lovelace,Grace Hopper,Grace,Hopper,1003,grace@example.com,Engineer",
      "Pat Director,Ada Lovelace,Unresolved User,Unresolved,User,1004,nope@example.com,Engineer",
    ].join("\n"));

    const plan = planUserGroupSync({
      rows,
      groupNameTemplate: "{Senior Manager} VRM",
      syncMode: "add-only",
      existingGroups: [],
      resolvedUsers: { "grace@example.com": { id: 1, email: "grace@example.com", name: "Grace Hopper" }, "nope@example.com": null },
    });

    expect(plan.skippedRows.map((row) => row.reason)).toEqual([
      "Missing Senior Manager",
      "Missing Email",
      "Duplicate Email",
      "Email not found in Stack Enterprise",
    ]);
  });

  it("blocks apply when distinct managers render to the same group name", () => {
    const plan = planUserGroupSync({
      rows: parseUserExportCsv(csv),
      groupNameTemplate: "VRM",
      syncMode: "add-only",
      existingGroups: [],
      resolvedUsers,
    });

    expect(plan.blockingErrors).toEqual([
      "Group name \"VRM\" is produced by multiple Senior Manager values: Ada Lovelace, Alan Turing.",
    ]);
  });
});
```

- [ ] **Step 2: Run the planner tests and verify they fail**

Run: `pnpm test -- src/writeTools/userGroupSync.test.ts`

Expected: FAIL because `src/writeTools/userGroupSync.ts` does not exist.

- [ ] **Step 3: Implement the pure planner**

Create `src/writeTools/userGroupSync.ts`:

```ts
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

export interface UserGroupSyncSkippedRow {
  rowNumber: number;
  email: string;
  seniorManager: string;
  reason: "Missing Senior Manager" | "Missing Email" | "Duplicate Email" | "Email not found in Stack Enterprise";
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

interface PlanUserGroupSyncInput {
  rows: UserExportRow[];
  groupNameTemplate: string;
  syncMode: UserGroupSyncMode;
  existingGroups: ExistingUserGroup[];
  resolvedUsers: Record<string, ResolvedStackUser | null>;
}

export function parseUserExportCsv(csvText: string): UserExportRow[] {
  const parsed = Papa.parse<Record<UserExportHeader, string>>(csvText, {
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
    director: normalizeCell(row.Director),
    seniorManager: normalizeCell(row["Senior Manager"]),
    userGroupMember: normalizeCell(row["User Group Member"]),
    firstName: normalizeCell(row["First Name"]),
    lastName: normalizeCell(row["Last Name"]),
    colleagueId: normalizeCell(row["Colleague ID"]),
    email: normalizeCell(row.Email),
    jobTitle: normalizeCell(row["Job Title"]),
  }));
}

export function renderGroupName(template: string, seniorManager: string): string {
  return template.replaceAll("{Senior Manager}", seniorManager).trim();
}

export function planUserGroupSync(input: PlanUserGroupSyncInput): UserGroupSyncPlan {
  const skippedRows: UserGroupSyncSkippedRow[] = [];
  const seenEmails = new Set<string>();
  const desiredUsersByGroupName = new Map<string, { manager: string; userIds: Set<number> }>();
  const managersByGroupName = new Map<string, Set<string>>();

  for (const row of input.rows) {
    const emailKey = row.email.toLowerCase();

    if (!row.seniorManager) {
      skippedRows.push(toSkippedRow(row, "Missing Senior Manager"));
      continue;
    }

    if (!emailKey) {
      skippedRows.push(toSkippedRow(row, "Missing Email"));
      continue;
    }

    if (seenEmails.has(emailKey)) {
      skippedRows.push(toSkippedRow(row, "Duplicate Email"));
      continue;
    }
    seenEmails.add(emailKey);

    const resolvedUser = input.resolvedUsers[emailKey];
    if (!resolvedUser) {
      skippedRows.push(toSkippedRow(row, "Email not found in Stack Enterprise"));
      continue;
    }

    const groupName = renderGroupName(input.groupNameTemplate, row.seniorManager);
    const managers = managersByGroupName.get(groupName) ?? new Set<string>();
    managers.add(row.seniorManager);
    managersByGroupName.set(groupName, managers);

    const group = desiredUsersByGroupName.get(groupName) ?? {
      manager: row.seniorManager,
      userIds: new Set<number>(),
    };
    group.userIds.add(resolvedUser.id);
    desiredUsersByGroupName.set(groupName, group);
  }

  const blockingErrors = buildBlockingErrors(managersByGroupName);
  const existingGroupsByName = new Map(input.existingGroups.map((group) => [normalizeGroupName(group.name), group]));
  const groups = [...desiredUsersByGroupName.entries()]
    .map(([groupName, desired]) => {
      const existingGroup = existingGroupsByName.get(normalizeGroupName(groupName));
      const currentUserIds = new Set(existingGroup?.users.map((user) => user.id) ?? []);
      const desiredUserIds = [...desired.userIds].sort((a, b) => a - b);
      const addUserIds = desiredUserIds.filter((userId) => !currentUserIds.has(userId));
      const removeUserIds =
        input.syncMode === "exact-sync"
          ? [...currentUserIds].filter((userId) => !desired.userIds.has(userId)).sort((a, b) => a - b)
          : [];

      return {
        manager: desired.manager,
        groupName,
        existingGroupId: existingGroup?.id ?? null,
        createGroup: existingGroup === undefined,
        desiredUserIds,
        addUserIds,
        removeUserIds,
      };
    })
    .sort((left, right) => left.groupName.localeCompare(right.groupName));

  return {
    syncMode: input.syncMode,
    groupNameTemplate: input.groupNameTemplate,
    groups,
    skippedRows,
    blockingErrors,
  };
}

function buildBlockingErrors(managersByGroupName: Map<string, Set<string>>): string[] {
  const errors: string[] = [];

  for (const [groupName, managers] of managersByGroupName) {
    if (!groupName) {
      errors.push("Generated group name is blank.");
    }

    if (managers.size > 1) {
      errors.push(
        `Group name "${groupName}" is produced by multiple Senior Manager values: ${[...managers].join(", ")}.`,
      );
    }
  }

  return errors;
}

function toSkippedRow(
  row: UserExportRow,
  reason: UserGroupSyncSkippedRow["reason"],
): UserGroupSyncSkippedRow {
  return {
    rowNumber: row.rowNumber,
    email: row.email,
    seniorManager: row.seniorManager,
    reason,
  };
}

function normalizeCell(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeGroupName(name: string): string {
  return name.trim().toLowerCase();
}
```

- [ ] **Step 4: Run the planner tests and verify they pass**

Run: `pnpm test -- src/writeTools/userGroupSync.test.ts`

Expected: PASS for all tests in `src/writeTools/userGroupSync.test.ts`.

- [ ] **Step 5: Commit**

Run:

```bash
git add src/writeTools/userGroupSync.ts src/writeTools/userGroupSync.test.ts
git commit -m "Add user group sync planner"
```

## Task 2: Enterprise V3 User Group API Methods

**Files:**
- Modify: `src/api/stackApiV3.ts`
- Modify: `src/api/stackApiV3.test.ts`

- [ ] **Step 1: Add failing client tests**

Append these tests inside `describe("StackApiV3Client", () => { ... })` in `src/api/stackApiV3.test.ts`:

```ts
  it("retrieves a user by email", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: 42, email: "ada@example.com", name: "Ada Lovelace" }), { status: 200 }),
    );
    const client = new StackApiV3Client({
      apiV3Url: "https://demo.stackenterprise.co/api/v3",
      token: "token",
      fetchFn: fetchMock,
    });

    await expect(client.getUserByEmail("ada+vrm@example.com")).resolves.toEqual({
      id: 42,
      email: "ada@example.com",
      name: "Ada Lovelace",
    });
    expect(fetchMock.mock.calls[0][0].toString()).toBe(
      "https://demo.stackenterprise.co/api/v3/users/by-email/ada%2Bvrm%40example.com",
    );
  });

  it("returns null when user lookup by email is not found", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("not found", { status: 404 }));
    const client = new StackApiV3Client({
      apiV3Url: "https://demo.stackenterprise.co/api/v3",
      token: "token",
      fetchFn: fetchMock,
    });

    await expect(client.getUserByEmail("missing@example.com")).resolves.toBeNull();
  });

  it("creates user groups and adds members with write access bearer auth", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 7, name: "Ada Lovelace VRM", users: [] }), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 7, name: "Ada Lovelace VRM", users: [{ id: 1 }] }), { status: 200 }));
    const client = new StackApiV3Client({
      apiV3Url: "https://demo.stackenterprise.co/api/v3",
      token: "token",
      fetchFn: fetchMock,
    });

    await expect(client.createUserGroup({ name: "Ada Lovelace VRM", userIds: [1, 2] })).resolves.toEqual(
      expect.objectContaining({ id: 7, name: "Ada Lovelace VRM" }),
    );
    await expect(client.addUserGroupMembers(7, [3])).resolves.toEqual(
      expect.objectContaining({ id: 7, name: "Ada Lovelace VRM" }),
    );
    expect(fetchMock.mock.calls[0][1]).toEqual(expect.objectContaining({
      method: "POST",
      headers: expect.objectContaining({ Authorization: "Bearer token", "Content-Type": "application/json" }),
      body: JSON.stringify({ name: "Ada Lovelace VRM", userIds: [1, 2] }),
    }));
    expect(fetchMock.mock.calls[1][0].toString()).toBe(
      "https://demo.stackenterprise.co/api/v3/user-groups/7/members",
    );
    expect(fetchMock.mock.calls[1][1]).toEqual(expect.objectContaining({
      method: "POST",
      body: JSON.stringify([3]),
    }));
  });

  it("removes a group member with DELETE", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    const client = new StackApiV3Client({
      apiV3Url: "https://demo.stackenterprise.co/api/v3",
      token: "token",
      fetchFn: fetchMock,
    });

    await expect(client.removeUserGroupMember(7, 3)).resolves.toBeUndefined();
    expect(fetchMock.mock.calls[0][0].toString()).toBe(
      "https://demo.stackenterprise.co/api/v3/user-groups/7/members/3",
    );
    expect(fetchMock.mock.calls[0][1]).toEqual(expect.objectContaining({ method: "DELETE" }));
  });
```

- [ ] **Step 2: Run the client tests and verify they fail**

Run: `pnpm test -- src/api/stackApiV3.test.ts`

Expected: FAIL because the new methods do not exist.

- [ ] **Step 3: Add API model exports and methods**

Modify `src/api/stackApiV3.ts` by adding these interfaces near the existing interfaces:

```ts
export interface StackApiV3UserSummary {
  id: number;
  email?: string | null;
  name?: string;
}

export interface StackApiV3UserGroup {
  id: number;
  name: string;
  description?: string | null;
  users?: StackApiV3UserSummary[];
}

interface CreateUserGroupInput {
  name: string;
  description?: string;
  userIds: number[];
}
```

Add these public methods to `StackApiV3Client`:

```ts
  async getUserByEmail(email: string): Promise<StackApiV3UserSummary | null> {
    const response = await this.fetchFn(this.buildUrl(`/users/by-email/${encodeURIComponent(email)}`, {}), {
      headers: this.createJsonHeaders(),
    });

    if (response.status === 404) {
      return null;
    }

    return readJsonResponse<StackApiV3UserSummary>(response, "Stack API v3");
  }

  async getUserGroups(): Promise<StackApiV3UserGroup[]> {
    return this.getPagedItems<StackApiV3UserGroup>("/user-groups", { pageSize: "100" });
  }

  async createUserGroup(input: CreateUserGroupInput): Promise<StackApiV3UserGroup> {
    return this.writeJson<StackApiV3UserGroup>("/user-groups", "POST", input);
  }

  async addUserGroupMembers(userGroupId: number, userIds: number[]): Promise<StackApiV3UserGroup> {
    return this.writeJson<StackApiV3UserGroup>(`/user-groups/${userGroupId}/members`, "POST", userIds);
  }

  async removeUserGroupMember(userGroupId: number, userId: number): Promise<void> {
    const response = await this.fetchFn(this.buildUrl(`/user-groups/${userGroupId}/members/${userId}`, {}), {
      method: "DELETE",
      headers: this.createJsonHeaders(),
    });

    if (!response.ok) {
      await readJsonResponse<unknown>(response, "Stack API v3");
    }
  }
```

Add these private helpers inside `StackApiV3Client`:

```ts
  private async writeJson<T>(path: string, method: "POST" | "PUT", body: unknown): Promise<T> {
    const response = await this.fetchFn(this.buildUrl(path, {}), {
      method,
      headers: this.createJsonHeaders(),
      body: JSON.stringify(body),
    });

    return readJsonResponse<T>(response, "Stack API v3");
  }

  private createJsonHeaders(): HeadersInit {
    return {
      Authorization: `Bearer ${this.token}`,
      "Content-Type": "application/json",
    };
  }
```

Then replace the repeated headers object in `getPagedItems` with `headers: this.createJsonHeaders()`.

- [ ] **Step 4: Run the client tests and verify they pass**

Run: `pnpm test -- src/api/stackApiV3.test.ts`

Expected: PASS for `StackApiV3Client`.

- [ ] **Step 5: Commit**

Run:

```bash
git add src/api/stackApiV3.ts src/api/stackApiV3.test.ts
git commit -m "Add Enterprise user group API methods"
```

## Task 3: Preview And Apply Runner

**Files:**
- Create: `src/writeTools/userGroupSyncRunner.ts`
- Create: `src/writeTools/userGroupSyncRunner.test.ts`

- [ ] **Step 1: Write failing runner tests**

Create `src/writeTools/userGroupSyncRunner.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { previewUserGroupSync, applyUserGroupSync } from "./userGroupSyncRunner";

const csv = [
  "Director,Senior Manager,User Group Member,First Name,Last Name,Colleague ID,Email,Job Title",
  "Pat Director,Ada Lovelace,Grace Hopper,Grace,Hopper,1001,grace@example.com,Engineer",
  "Pat Director,Ada Lovelace,Linus Torvalds,Linus,Torvalds,1002,linus@example.com,Engineer",
].join("\n");

describe("userGroupSyncRunner", () => {
  it("previews creates and additions after resolving users by email", async () => {
    const client = {
      getUserByEmail: vi.fn()
        .mockResolvedValueOnce({ id: 1, email: "grace@example.com", name: "Grace Hopper" })
        .mockResolvedValueOnce({ id: 2, email: "linus@example.com", name: "Linus Torvalds" }),
      getUserGroups: vi.fn().mockResolvedValue([{ id: 10, name: "Ada Lovelace VRM", users: [{ id: 1 }] }]),
      createUserGroup: vi.fn(),
      addUserGroupMembers: vi.fn(),
      removeUserGroupMember: vi.fn(),
    };

    const preview = await previewUserGroupSync({
      csvText: csv,
      groupNameTemplate: "{Senior Manager} VRM",
      syncMode: "add-only",
      client,
    });

    expect(preview.blockingErrors).toEqual([]);
    expect(preview.groups).toEqual([
      expect.objectContaining({ groupName: "Ada Lovelace VRM", addUserIds: [2], removeUserIds: [] }),
    ]);
    expect(client.getUserByEmail).toHaveBeenCalledWith("grace@example.com");
    expect(client.getUserGroups).toHaveBeenCalledTimes(1);
  });

  it("applies add-only changes without removals", async () => {
    const client = {
      getUserByEmail: vi.fn()
        .mockResolvedValueOnce({ id: 1, email: "grace@example.com", name: "Grace Hopper" })
        .mockResolvedValueOnce({ id: 2, email: "linus@example.com", name: "Linus Torvalds" }),
      getUserGroups: vi.fn().mockResolvedValue([{ id: 10, name: "Ada Lovelace VRM", users: [{ id: 1 }] }]),
      createUserGroup: vi.fn(),
      addUserGroupMembers: vi.fn().mockResolvedValue({ id: 10, name: "Ada Lovelace VRM", users: [{ id: 1 }, { id: 2 }] }),
      removeUserGroupMember: vi.fn(),
    };

    const result = await applyUserGroupSync({
      csvText: csv,
      groupNameTemplate: "{Senior Manager} VRM",
      syncMode: "add-only",
      client,
    });

    expect(client.addUserGroupMembers).toHaveBeenCalledWith(10, [2]);
    expect(client.removeUserGroupMember).not.toHaveBeenCalled();
    expect(result.operations).toEqual([
      { kind: "add-members", groupName: "Ada Lovelace VRM", userIds: [2], status: "succeeded" },
    ]);
  });

  it("applies exact-sync removals only when exact sync is selected", async () => {
    const client = {
      getUserByEmail: vi.fn()
        .mockResolvedValueOnce({ id: 1, email: "grace@example.com", name: "Grace Hopper" })
        .mockResolvedValueOnce({ id: 2, email: "linus@example.com", name: "Linus Torvalds" }),
      getUserGroups: vi.fn().mockResolvedValue([{ id: 10, name: "Ada Lovelace VRM", users: [{ id: 1 }, { id: 99 }] }]),
      createUserGroup: vi.fn(),
      addUserGroupMembers: vi.fn().mockResolvedValue({ id: 10, name: "Ada Lovelace VRM", users: [] }),
      removeUserGroupMember: vi.fn().mockResolvedValue(undefined),
    };

    const result = await applyUserGroupSync({
      csvText: csv,
      groupNameTemplate: "{Senior Manager} VRM",
      syncMode: "exact-sync",
      client,
    });

    expect(client.addUserGroupMembers).toHaveBeenCalledWith(10, [2]);
    expect(client.removeUserGroupMember).toHaveBeenCalledWith(10, 99);
    expect(result.operations).toContainEqual({
      kind: "remove-member",
      groupName: "Ada Lovelace VRM",
      userIds: [99],
      status: "succeeded",
    });
  });
});
```

- [ ] **Step 2: Run runner tests and verify they fail**

Run: `pnpm test -- src/writeTools/userGroupSyncRunner.test.ts`

Expected: FAIL because `src/writeTools/userGroupSyncRunner.ts` does not exist.

- [ ] **Step 3: Implement preview/apply runner**

Create `src/writeTools/userGroupSyncRunner.ts`:

```ts
import {
  parseUserExportCsv,
  planUserGroupSync,
  type ExistingUserGroup,
  type ExistingUserGroupMember,
  type ResolvedStackUser,
  type UserGroupSyncMode,
  type UserGroupSyncPlan,
} from "./userGroupSync";

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

export async function previewUserGroupSync(input: UserGroupSyncRunnerInput): Promise<UserGroupSyncPlan> {
  const rows = parseUserExportCsv(input.csvText);
  const resolvedUsers = await resolveUsersByEmail(input.client, rows.map((row) => row.email));
  const existingGroups = (await input.client.getUserGroups()).map(normalizeExistingGroup);

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
  if (preview.blockingErrors.length > 0) {
    return { preview, operations: [] };
  }

  const operations: UserGroupSyncOperationResult[] = [];

  for (const group of preview.groups) {
    let userGroupId = group.existingGroupId;

    if (group.createGroup) {
      try {
        const created = await input.client.createUserGroup({ name: group.groupName, userIds: group.desiredUserIds });
        userGroupId = created.id;
        operations.push({
          kind: "create-group",
          groupName: group.groupName,
          userIds: group.desiredUserIds,
          status: "succeeded",
        });
      } catch (error) {
        operations.push(toFailedOperation("create-group", group.groupName, group.desiredUserIds, error));
        continue;
      }
    }

    if (userGroupId !== null && !group.createGroup && group.addUserIds.length > 0) {
      try {
        await input.client.addUserGroupMembers(userGroupId, group.addUserIds);
        operations.push({
          kind: "add-members",
          groupName: group.groupName,
          userIds: group.addUserIds,
          status: "succeeded",
        });
      } catch (error) {
        operations.push(toFailedOperation("add-members", group.groupName, group.addUserIds, error));
      }
    }

    if (userGroupId !== null && input.syncMode === "exact-sync") {
      for (const userId of group.removeUserIds) {
        try {
          await input.client.removeUserGroupMember(userGroupId, userId);
          operations.push({
            kind: "remove-member",
            groupName: group.groupName,
            userIds: [userId],
            status: "succeeded",
          });
        } catch (error) {
          operations.push(toFailedOperation("remove-member", group.groupName, [userId], error));
        }
      }
    }
  }

  return { preview, operations };
}

async function resolveUsersByEmail(
  client: UserGroupSyncClient,
  emails: string[],
): Promise<Record<string, ResolvedStackUser | null>> {
  const resolvedUsers: Record<string, ResolvedStackUser | null> = {};
  const uniqueEmails = [...new Set(emails.map((email) => email.trim().toLowerCase()).filter(Boolean))];

  for (const email of uniqueEmails) {
    const user = await client.getUserByEmail(email);
    resolvedUsers[email] = user ? { id: user.id, email: user.email ?? email, name: user.name } : null;
  }

  return resolvedUsers;
}

function normalizeExistingGroup(group: UserGroupSyncClientGroup): ExistingUserGroup {
  return {
    id: group.id,
    name: group.name,
    users: group.users ?? [],
  };
}

function toFailedOperation(
  kind: UserGroupSyncOperationResult["kind"],
  groupName: string,
  userIds: number[],
  error: unknown,
): UserGroupSyncOperationResult {
  return {
    kind,
    groupName,
    userIds,
    status: "failed",
    error: error instanceof Error ? error.message : String(error),
  };
}
```

- [ ] **Step 4: Run runner tests and verify they pass**

Run: `pnpm test -- src/writeTools/userGroupSyncRunner.test.ts`

Expected: PASS for runner tests.

- [ ] **Step 5: Commit**

Run:

```bash
git add src/writeTools/userGroupSyncRunner.ts src/writeTools/userGroupSyncRunner.test.ts
git commit -m "Add user group sync runner"
```

## Task 4: Server Handler And Route

**Files:**
- Create: `src/server/userGroupSyncApi.ts`
- Create: `src/server/userGroupSyncApi.test.ts`
- Create: `src/app/api/write-tools/user-group-sync/route.ts`

- [ ] **Step 1: Write failing server tests**

Create `src/server/userGroupSyncApi.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import type { StackApiV3Client } from "../api/stackApiV3";
import type { SessionCredentials } from "../domain/types";
import { handleUserGroupSyncRequest } from "./userGroupSyncApi";

const credentials: SessionCredentials = {
  instanceType: "enterprise",
  baseUrl: "https://demo.stackenterprise.co",
  accessToken: "token",
};

const csvText = [
  "Director,Senior Manager,User Group Member,First Name,Last Name,Colleague ID,Email,Job Title",
  "Pat Director,Ada Lovelace,Grace Hopper,Grace,Hopper,1001,grace@example.com,Engineer",
].join("\n");

describe("handleUserGroupSyncRequest", () => {
  it("returns preview results", async () => {
    const client = {
      getUserByEmail: vi.fn().mockResolvedValue({ id: 1, email: "grace@example.com", name: "Grace Hopper" }),
      getUserGroups: vi.fn().mockResolvedValue([]),
      createUserGroup: vi.fn(),
      addUserGroupMembers: vi.fn(),
      removeUserGroupMember: vi.fn(),
    } as unknown as StackApiV3Client;

    const response = await handleUserGroupSyncRequest(
      { action: "preview", credentials, csvText, groupNameTemplate: "{Senior Manager} VRM", syncMode: "add-only" },
      { createClient: () => client },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      result: expect.objectContaining({
        groups: [expect.objectContaining({ groupName: "Ada Lovelace VRM", createGroup: true })],
      }),
    });
  });

  it("rejects non-enterprise credentials", async () => {
    const response = await handleUserGroupSyncRequest({
      action: "preview",
      credentials: { ...credentials, instanceType: "basic-business" },
      csvText,
      groupNameTemplate: "{Senior Manager} VRM",
      syncMode: "add-only",
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: "Enterprise user group sync requires Enterprise session credentials.",
    });
  });

  it("applies changes through the runner", async () => {
    const client = {
      getUserByEmail: vi.fn().mockResolvedValue({ id: 1, email: "grace@example.com", name: "Grace Hopper" }),
      getUserGroups: vi.fn().mockResolvedValue([]),
      createUserGroup: vi.fn().mockResolvedValue({ id: 10, name: "Ada Lovelace VRM", users: [{ id: 1 }] }),
      addUserGroupMembers: vi.fn(),
      removeUserGroupMember: vi.fn(),
    } as unknown as StackApiV3Client;

    const response = await handleUserGroupSyncRequest(
      { action: "apply", credentials, csvText, groupNameTemplate: "{Senior Manager} VRM", syncMode: "add-only" },
      { createClient: () => client },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      result: expect.objectContaining({
        operations: [{ kind: "create-group", groupName: "Ada Lovelace VRM", userIds: [1], status: "succeeded" }],
      }),
    });
    expect(client.createUserGroup).toHaveBeenCalledWith({ name: "Ada Lovelace VRM", userIds: [1] });
  });
});
```

- [ ] **Step 2: Run server tests and verify they fail**

Run: `pnpm test -- src/server/userGroupSyncApi.test.ts`

Expected: FAIL because the server handler does not exist.

- [ ] **Step 3: Implement server handler**

Create `src/server/userGroupSyncApi.ts`:

```ts
import { StackApiV3Client } from "../api/stackApiV3";
import { normalizeInstanceUrl } from "../credentials/credentialRules";
import type { SessionCredentials } from "../domain/types";
import {
  applyUserGroupSync,
  previewUserGroupSync,
  type UserGroupSyncApplyResult,
} from "../writeTools/userGroupSyncRunner";
import type { UserGroupSyncMode, UserGroupSyncPlan } from "../writeTools/userGroupSync";

interface UserGroupSyncRequestPayload {
  action: "preview" | "apply";
  credentials: SessionCredentials;
  csvText: string;
  groupNameTemplate: string;
  syncMode: UserGroupSyncMode;
}

interface UserGroupSyncDependencies {
  createClient?: (credentials: SessionCredentials) => StackApiV3Client;
}

export type UserGroupSyncResponseBody =
  | { ok: true; result: UserGroupSyncPlan | UserGroupSyncApplyResult }
  | { ok: false; error: string };

export async function handleUserGroupSyncRequest(
  payload: unknown,
  dependencies: UserGroupSyncDependencies = {},
): Promise<Response> {
  if (!isPayload(payload)) {
    return jsonResponse({ ok: false, error: "User group sync request is invalid." }, 400);
  }

  if (payload.credentials.instanceType !== "enterprise") {
    return jsonResponse({ ok: false, error: "Enterprise user group sync requires Enterprise session credentials." }, 400);
  }

  if (!payload.credentials.accessToken && !payload.credentials.pat) {
    return jsonResponse({ ok: false, error: "Enterprise user group sync requires an access token with write_access." }, 400);
  }

  try {
    const client = (dependencies.createClient ?? createDefaultClient)(payload.credentials);
    const input = {
      csvText: payload.csvText,
      groupNameTemplate: payload.groupNameTemplate,
      syncMode: payload.syncMode,
      client,
    };
    const result = payload.action === "preview"
      ? await previewUserGroupSync(input)
      : await applyUserGroupSync(input);

    return jsonResponse({ ok: true, result }, 200);
  } catch (error) {
    return jsonResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }, 500);
  }
}

function createDefaultClient(credentials: SessionCredentials): StackApiV3Client {
  const instance = normalizeInstanceUrl(credentials.baseUrl);
  return new StackApiV3Client({
    apiV3Url: instance.apiV3Url,
    token: credentials.accessToken ?? credentials.pat ?? "",
  });
}

function isPayload(value: unknown): value is UserGroupSyncRequestPayload {
  if (!isRecord(value) || !isRecord(value.credentials)) {
    return false;
  }

  return (
    (value.action === "preview" || value.action === "apply") &&
    typeof value.csvText === "string" &&
    typeof value.groupNameTemplate === "string" &&
    (value.syncMode === "add-only" || value.syncMode === "exact-sync") &&
    typeof value.credentials.instanceType === "string" &&
    typeof value.credentials.baseUrl === "string"
  );
}

function jsonResponse(body: UserGroupSyncResponseBody, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
```

- [ ] **Step 4: Add route handler**

Create `src/app/api/write-tools/user-group-sync/route.ts`:

```ts
import { handleUserGroupSyncRequest } from "../../../../server/userGroupSyncApi";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  let payload: unknown;

  try {
    payload = await request.json();
  } catch {
    payload = null;
  }

  return handleUserGroupSyncRequest(payload);
}
```

- [ ] **Step 5: Run server tests and verify they pass**

Run: `pnpm test -- src/server/userGroupSyncApi.test.ts`

Expected: PASS for server handler tests.

- [ ] **Step 6: Commit**

Run:

```bash
git add src/server/userGroupSyncApi.ts src/server/userGroupSyncApi.test.ts src/app/api/write-tools/user-group-sync/route.ts
git commit -m "Add user group sync API route"
```

## Task 5: User Group Sync Panel

**Files:**
- Create: `src/components/UserGroupSyncPanel.tsx`
- Create: `src/components/UserGroupSyncPanel.test.tsx`

- [ ] **Step 1: Write failing component tests**

Create `src/components/UserGroupSyncPanel.test.tsx`:

```ts
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { UserGroupSyncPanel } from "./UserGroupSyncPanel";

afterEach(() => {
  vi.restoreAllMocks();
});

const credentials = {
  instanceType: "enterprise" as const,
  baseUrl: "https://demo.stackenterprise.co",
  accessToken: "token",
};

const csv = [
  "Director,Senior Manager,User Group Member,First Name,Last Name,Colleague ID,Email,Job Title",
  "Pat Director,Ada Lovelace,Grace Hopper,Grace,Hopper,1001,grace@example.com,Engineer",
].join("\n");

describe("UserGroupSyncPanel", () => {
  it("uploads a CSV and previews add-only changes", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({
        ok: true,
        result: {
          syncMode: "add-only",
          groupNameTemplate: "{Senior Manager} VRM",
          blockingErrors: [],
          skippedRows: [],
          groups: [{ manager: "Ada Lovelace", groupName: "Ada Lovelace VRM", existingGroupId: null, createGroup: true, desiredUserIds: [1], addUserIds: [1], removeUserIds: [] }],
        },
      }), { status: 200 }),
    );

    render(<UserGroupSyncPanel credentials={credentials} />);

    await user.upload(screen.getByLabelText("Upload user export CSV"), new File([csv], "users.csv", { type: "text/csv" }));
    await user.click(screen.getByRole("button", { name: "Preview changes" }));

    expect(fetchMock).toHaveBeenCalledWith("/api/write-tools/user-group-sync", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({
        action: "preview",
        credentials,
        csvText: csv,
        groupNameTemplate: "{Senior Manager} VRM",
        syncMode: "add-only",
      }),
    }));
    expect(await screen.findByText("Ada Lovelace VRM")).toBeInTheDocument();
    expect(screen.getByText("Add-only")).toBeInTheDocument();
    expect(screen.queryByText("Members to remove")).not.toBeInTheDocument();
  });

  it("shows exact-sync removals and asks for browser confirmation before apply", async () => {
    const user = userEvent.setup();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({
        ok: true,
        result: {
          syncMode: "exact-sync",
          groupNameTemplate: "{Senior Manager} VRM",
          blockingErrors: [],
          skippedRows: [],
          groups: [{ manager: "Ada Lovelace", groupName: "Ada Lovelace VRM", existingGroupId: 10, createGroup: false, desiredUserIds: [1], addUserIds: [], removeUserIds: [99] }],
        },
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        ok: true,
        result: {
          preview: { groups: [], skippedRows: [], blockingErrors: [], syncMode: "exact-sync", groupNameTemplate: "{Senior Manager} VRM" },
          operations: [{ kind: "remove-member", groupName: "Ada Lovelace VRM", userIds: [99], status: "succeeded" }],
        },
      }), { status: 200 }));

    render(<UserGroupSyncPanel credentials={credentials} />);

    await user.upload(screen.getByLabelText("Upload user export CSV"), new File([csv], "users.csv", { type: "text/csv" }));
    await user.click(screen.getByLabelText("Exact sync"));
    await user.click(screen.getByRole("button", { name: "Preview changes" }));
    expect(await screen.findByText("Members to remove")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Apply changes" }));

    expect(window.confirm).toHaveBeenCalledWith("Exact sync can remove users from generated VRM groups. Apply these changes?");
    expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body))).toEqual(expect.objectContaining({
      action: "apply",
      syncMode: "exact-sync",
    }));
    expect(await screen.findByText("remove-member succeeded for Ada Lovelace VRM: 99")).toBeInTheDocument();
  });

  it("disables apply when preview has blocking errors", async () => {
    const user = userEvent.setup();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({
        ok: true,
        result: {
          syncMode: "add-only",
          groupNameTemplate: "VRM",
          blockingErrors: ["Group name \"VRM\" is produced by multiple Senior Manager values: Ada Lovelace, Alan Turing."],
          skippedRows: [],
          groups: [],
        },
      }), { status: 200 }),
    );

    render(<UserGroupSyncPanel credentials={credentials} />);

    await user.upload(screen.getByLabelText("Upload user export CSV"), new File([csv], "users.csv", { type: "text/csv" }));
    await user.clear(screen.getByLabelText("Group name template"));
    await user.type(screen.getByLabelText("Group name template"), "VRM");
    await user.click(screen.getByRole("button", { name: "Preview changes" }));

    const alert = await screen.findByRole("alert");
    expect(within(alert).getByText(/multiple Senior Manager values/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Apply changes" })).toBeDisabled();
  });
});
```

- [ ] **Step 2: Run component tests and verify they fail**

Run: `pnpm test -- src/components/UserGroupSyncPanel.test.tsx`

Expected: FAIL because the component does not exist.

- [ ] **Step 3: Implement the component**

Create `src/components/UserGroupSyncPanel.tsx` with this structure:

```ts
import { useState } from "react";
import type { SessionCredentials } from "../domain/types";
import type { UserGroupSyncResponseBody } from "../server/userGroupSyncApi";
import type { UserGroupSyncApplyResult } from "../writeTools/userGroupSyncRunner";
import type { UserGroupSyncMode, UserGroupSyncPlan } from "../writeTools/userGroupSync";

interface UserGroupSyncPanelProps {
  credentials: SessionCredentials | null;
}

const DEFAULT_TEMPLATE = "{Senior Manager} VRM";

export function UserGroupSyncPanel({ credentials }: UserGroupSyncPanelProps) {
  const [csvText, setCsvText] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [groupNameTemplate, setGroupNameTemplate] = useState(DEFAULT_TEMPLATE);
  const [syncMode, setSyncMode] = useState<UserGroupSyncMode>("add-only");
  const [preview, setPreview] = useState<UserGroupSyncPlan | null>(null);
  const [applyResult, setApplyResult] = useState<UserGroupSyncApplyResult | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const exactSync = syncMode === "exact-sync";
  const canPreview = credentials !== null && csvText.trim() !== "";
  const canApply = preview !== null && preview.blockingErrors.length === 0 && credentials !== null && csvText.trim() !== "";

  async function handleFile(fileList: FileList | null) {
    const file = fileList?.[0];
    if (!file) return;
    const text = await file.text();
    setCsvText(text);
    setFileName(file.name);
    setPreview(null);
    setApplyResult(null);
    setError(null);
    setMessage(`Loaded ${file.name}.`);
  }

  async function runAction(action: "preview" | "apply") {
    if (!credentials) {
      setError("Save Enterprise session credentials before using write tools.");
      return;
    }

    if (action === "apply" && exactSync && !window.confirm("Exact sync can remove users from generated VRM groups. Apply these changes?")) {
      return;
    }

    setError(null);
    const response = await fetch("/api/write-tools/user-group-sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, credentials, csvText, groupNameTemplate, syncMode }),
    });
    const body = (await response.json()) as UserGroupSyncResponseBody;

    if (!body.ok) {
      setError(body.error);
      return;
    }

    if (action === "preview") {
      setPreview(body.result as UserGroupSyncPlan);
      setApplyResult(null);
      setMessage("Preview ready.");
    } else {
      setApplyResult(body.result as UserGroupSyncApplyResult);
      setMessage("Apply completed.");
    }
  }

  return (
    <section className="workspace-panel" aria-labelledby="write-tools-heading">
      <div className="workspace-header">
        <p className="fs-caption fc-light mb4">Enterprise write tool</p>
        <h2 className="fs-headline2 m0" id="write-tools-heading">
          User Group Sync
        </h2>
      </div>

      <p className="workspace-copy">
        Upload the user export CSV, preview generated VRM groups, then apply Enterprise user group changes.
      </p>

      <div className="write-tool-form">
        <label className="d-block">
          <span className="d-block fs-caption tt-uppercase fc-light mb4">User export CSV</span>
          <input
            className="s-input"
            type="file"
            accept=".csv,text/csv"
            aria-label="Upload user export CSV"
            onChange={(event) => void handleFile(event.currentTarget.files)}
          />
        </label>

        <label className="d-block">
          <span className="d-block fs-caption tt-uppercase fc-light mb4">Group name template</span>
          <input
            className="s-input"
            aria-label="Group name template"
            value={groupNameTemplate}
            onChange={(event) => {
              setGroupNameTemplate(event.currentTarget.value);
              setPreview(null);
              setApplyResult(null);
            }}
          />
        </label>

        <label className="write-tool-checkbox">
          <input
            type="checkbox"
            aria-label="Exact sync"
            checked={exactSync}
            onChange={(event) => {
              setSyncMode(event.currentTarget.checked ? "exact-sync" : "add-only");
              setPreview(null);
              setApplyResult(null);
            }}
          />
          <span>Exact sync</span>
        </label>

        {exactSync && (
          <div className="s-notice s-notice__warning" role="note">
            Exact sync can remove users from generated VRM groups when they are not present in the current CSV.
          </div>
        )}

        <div className="write-tool-actions">
          <button className="s-btn s-btn__primary" type="button" disabled={!canPreview} onClick={() => void runAction("preview")}>
            Preview changes
          </button>
          <button className="s-btn" type="button" disabled={!canApply} onClick={() => void runAction("apply")}>
            Apply changes
          </button>
        </div>
      </div>

      {!credentials && (
        <div className="s-notice s-notice__warning mt16" role="status">
          Save Enterprise session credentials before using write tools.
        </div>
      )}
      {fileName && <p className="fs-caption fc-light mt12">Loaded file: {fileName}</p>}
      {message && <div className="s-notice s-notice__success mt16" role="status">{message}</div>}
      {error && <div className="s-notice s-notice__danger mt16" role="alert">{error}</div>}
      {preview && <PreviewSummary preview={preview} />}
      {applyResult && <ApplySummary result={applyResult} />}
    </section>
  );
}
```

In the same file, add compact summary components:

```ts
function PreviewSummary({ preview }: { preview: UserGroupSyncPlan }) {
  return (
    <div className="write-tool-preview">
      <h3 className="fs-subheading mt24">Preview</h3>
      <p className="fs-body2">{preview.syncMode === "exact-sync" ? "Exact sync" : "Add-only"}</p>
      {preview.blockingErrors.length > 0 && (
        <div className="s-notice s-notice__danger" role="alert">
          {preview.blockingErrors.map((error) => <p className="m0" key={error}>{error}</p>)}
        </div>
      )}
      <table className="write-tool-table">
        <thead>
          <tr>
            <th>Group</th>
            <th>Manager</th>
            <th>Action</th>
            <th>Members to add</th>
            {preview.syncMode === "exact-sync" && <th>Members to remove</th>}
          </tr>
        </thead>
        <tbody>
          {preview.groups.map((group) => (
            <tr key={group.groupName}>
              <td>{group.groupName}</td>
              <td>{group.manager}</td>
              <td>{group.createGroup ? "Create group" : "Update group"}</td>
              <td>{group.addUserIds.join(", ") || "None"}</td>
              {preview.syncMode === "exact-sync" && <td>{group.removeUserIds.join(", ") || "None"}</td>}
            </tr>
          ))}
        </tbody>
      </table>
      {preview.skippedRows.length > 0 && (
        <>
          <h3 className="fs-subheading mt24">Skipped rows</h3>
          <ul>
            {preview.skippedRows.map((row) => (
              <li key={`${row.rowNumber}-${row.reason}`}>Row {row.rowNumber}: {row.reason}</li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function ApplySummary({ result }: { result: UserGroupSyncApplyResult }) {
  return (
    <div className="write-tool-preview">
      <h3 className="fs-subheading mt24">Apply summary</h3>
      <ul>
        {result.operations.map((operation, index) => (
          <li key={`${operation.kind}-${operation.groupName}-${index}`}>
            {operation.kind} {operation.status} for {operation.groupName}: {operation.userIds.join(", ") || "none"}
            {operation.error ? ` (${operation.error})` : ""}
          </li>
        ))}
      </ul>
    </div>
  );
}
```

- [ ] **Step 4: Run component tests and verify they pass**

Run: `pnpm test -- src/components/UserGroupSyncPanel.test.tsx`

Expected: PASS for the User Group Sync panel tests.

- [ ] **Step 5: Commit**

Run:

```bash
git add src/components/UserGroupSyncPanel.tsx src/components/UserGroupSyncPanel.test.tsx
git commit -m "Add user group sync panel"
```

## Task 6: App Navigation Wiring

**Files:**
- Modify: `src/components/AppShell.tsx`
- Modify: `src/App.tsx`
- Modify: `src/components/AppShell.test.tsx`

- [ ] **Step 1: Add failing app-shell test coverage**

Append this test to `src/components/AppShell.test.tsx`:

```ts
  it("opens the write tools panel", async () => {
    const user = userEvent.setup();

    render(<App />);

    await user.click(screen.getByRole("button", { name: "Write Tools" }));

    expect(screen.getByRole("heading", { name: "User Group Sync" })).toBeInTheDocument();
    expect(screen.getByLabelText("Upload user export CSV")).toBeInTheDocument();
  });
```

- [ ] **Step 2: Run app-shell tests and verify they fail**

Run: `pnpm test -- src/components/AppShell.test.tsx`

Expected: FAIL because `Write Tools` is not in the nav.

- [ ] **Step 3: Add the panel type and label**

Modify `src/components/AppShell.tsx`:

```ts
export type AppPanel = "report" | "credentials" | "uploads" | "datasets" | "write-tools";
```

Update `panelLabels`:

```ts
const panelLabels: Record<AppPanel, string> = {
  report: "Reports",
  credentials: "Credentials",
  uploads: "Uploads",
  datasets: "Datasets",
  "write-tools": "Write Tools",
};
```

- [ ] **Step 4: Render the panel from App**

Modify `src/App.tsx` imports:

```ts
import { UserGroupSyncPanel } from "./components/UserGroupSyncPanel";
```

Add this render branch before the report branch:

```tsx
      {activePanel === "write-tools" && (
        <UserGroupSyncPanel credentials={state.credentials} />
      )}
```

- [ ] **Step 5: Run app-shell tests and verify they pass**

Run: `pnpm test -- src/components/AppShell.test.tsx`

Expected: PASS for the full AppShell suite.

- [ ] **Step 6: Commit**

Run:

```bash
git add src/components/AppShell.tsx src/App.tsx src/components/AppShell.test.tsx
git commit -m "Wire user group sync into app shell"
```

## Task 7: Write Tool Styles

**Files:**
- Modify: `src/styles/app.css`
- Test: `src/components/UserGroupSyncPanel.test.tsx`

- [ ] **Step 1: Add focused class assertions to the panel test**

In `src/components/UserGroupSyncPanel.test.tsx`, add these assertions in the first test after the component renders:

```ts
    expect(screen.getByRole("region", { name: "User Group Sync" })).toHaveClass("workspace-panel");
```

If the `section` is not discoverable as a region, update the component opening tag to include `role="region"`:

```tsx
    <section className="workspace-panel" aria-labelledby="write-tools-heading" role="region">
```

- [ ] **Step 2: Run panel tests**

Run: `pnpm test -- src/components/UserGroupSyncPanel.test.tsx`

Expected: PASS after adding `role="region"` if needed.

- [ ] **Step 3: Add compact styles**

Append to `src/styles/app.css`:

```css
.write-tool-form {
  display: grid;
  gap: 16px;
  max-width: 760px;
  margin-top: 20px;
}

.write-tool-checkbox {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-weight: 700;
}

.write-tool-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.write-tool-preview {
  margin-top: 20px;
}

.write-tool-table {
  width: 100%;
  margin-top: 12px;
  border-collapse: collapse;
  font-size: 14px;
}

.write-tool-table th,
.write-tool-table td {
  padding: 10px 12px;
  border-bottom: 1px solid var(--black-100);
  text-align: left;
  vertical-align: top;
}

.write-tool-table th {
  color: var(--black-600);
  background: var(--black-050);
  font-size: 12px;
  text-transform: uppercase;
}
```

- [ ] **Step 4: Run lint to catch CSS-adjacent TypeScript regressions**

Run: `pnpm lint`

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git add src/styles/app.css src/components/UserGroupSyncPanel.tsx src/components/UserGroupSyncPanel.test.tsx
git commit -m "Style user group sync panel"
```

## Task 8: Full Verification

**Files:**
- Verify all files changed by Tasks 1-7.

- [ ] **Step 1: Run focused tests**

Run:

```bash
pnpm test -- src/writeTools/userGroupSync.test.ts src/writeTools/userGroupSyncRunner.test.ts src/api/stackApiV3.test.ts src/server/userGroupSyncApi.test.ts src/components/UserGroupSyncPanel.test.tsx src/components/AppShell.test.tsx
```

Expected: PASS for all focused tests.

- [ ] **Step 2: Run full unit test suite**

Run: `pnpm test`

Expected: PASS for the full Vitest suite.

- [ ] **Step 3: Run TypeScript lint**

Run: `pnpm lint`

Expected: PASS for both `tsconfig.json` and `tsconfig.node.json`.

- [ ] **Step 4: Run production build**

Run: `pnpm build`

Expected: PASS and produce a Next.js production build.

- [ ] **Step 5: Inspect git status**

Run: `git status --short`

Expected: no unstaged files after the final verification commit.

## Spec Coverage Self-Review

- CSV upload and required columns: Task 1 parser and Task 5 UI upload.
- Fixed `Senior Manager` grouping and `Email` lookup: Task 1 planner, Task 3 runner.
- Configurable group name template only: Task 1 renderer, Task 5 template input.
- Enterprise `/users/by-email/{email}` and `/user-groups` endpoints: Task 2 API client, Task 4 server route.
- Add-only default: Task 1 planner tests, Task 5 UI default state.
- Optional exact sync checkbox: Task 1 exact-sync planner test, Task 5 exact-sync UI test.
- Preview before write: Task 3 runner and Task 5 UI require preview before apply.
- Blocking errors for duplicate generated names: Task 1 planner test, Task 5 disabled apply test.
- Session-only credentials/data: Task 4 request handler uses passed session credentials; Task 5 component stores data in React state only.
- Non-goals preserved: no column mapping builder, no SCIM operations, no team-scoped endpoints, no persistence.
