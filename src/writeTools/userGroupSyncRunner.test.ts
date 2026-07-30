import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyUserGroupSync,
  previewUserGroupSync,
  type UserGroupSyncClient,
  type UserGroupSyncRunnerInput,
} from "./userGroupSyncRunner";

const csvText = [
  "Director,Senior Manager,User Group Member,First Name,Last Name,Colleague ID,Email,Job Title",
  "Pat Director,Ada Lovelace,Grace Hopper,Grace,Hopper,1001,grace@example.com,Engineer",
  "Pat Director,Ada Lovelace,Linus Torvalds,Linus,Torvalds,1002,linus@example.com,Engineer",
].join("\n");

function createClient(): UserGroupSyncClient {
  return {
    getUserByEmail: vi.fn(async (email: string) => {
      if (email.toLowerCase() === "grace@example.com") {
        return { id: 1, email, name: "Grace Hopper" };
      }

      if (email.toLowerCase() === "linus@example.com") {
        return { id: 2, email, name: "Linus Torvalds" };
      }

      return null;
    }),
    getUserGroups: vi.fn(async () => [
      {
        id: 10,
        name: "Ada Lovelace VRM",
        users: [{ id: 1, name: "Grace Hopper" }],
      },
    ]),
    createUserGroup: vi.fn(async ({ name, userIds }: { name: string; userIds: number[] }) => ({
      id: 20,
      name,
      users: userIds.map((id) => ({ id })),
    })),
    addUserGroupMembers: vi.fn(async (userGroupId: number, userIds: number[]) => ({
      id: userGroupId,
      name: "Ada Lovelace VRM",
      users: userIds.map((id) => ({ id })),
    })),
    removeUserGroupMember: vi.fn(async () => undefined),
  };
}

function createInput(client = createClient()): UserGroupSyncRunnerInput {
  return {
    csvText,
    groupNameTemplate: "{Senior Manager} VRM",
    syncMode: "add-only",
    client,
  };
}

function createCsvWithEmails(emails: string[]): string {
  return [
    "Director,Senior Manager,User Group Member,First Name,Last Name,Colleague ID,Email,Job Title",
    ...emails.map(
      (email, index) =>
        `Pat Director,Ada Lovelace,Member ${index},Member,${index},${1000 + index},${email},Engineer`,
    ),
  ].join("\n");
}

describe("previewUserGroupSync", () => {
  it("previews creates and additions after resolving users by email", async () => {
    const client = createClient();

    const preview = await previewUserGroupSync(createInput(client));

    expect(preview.blockingErrors).toEqual([]);
    expect(preview.groups).toEqual([
      expect.objectContaining({
        groupName: "Ada Lovelace VRM",
        addUserIds: [2],
        removeUserIds: [],
      }),
    ]);
    expect(client.getUserByEmail).toHaveBeenCalledWith("grace@example.com");
    expect(client.getUserByEmail).toHaveBeenCalledWith("linus@example.com");
    expect(client.getUserByEmail).toHaveBeenCalledTimes(2);
    expect(client.getUserGroups).toHaveBeenCalledTimes(1);
  });

  it("aborts preview when one email lookup fails", async () => {
    const client = createClient();
    vi.mocked(client.getUserByEmail).mockImplementation(async (email: string) => {
      if (email.toLowerCase() === "linus@example.com") {
        throw new Error("Stack lookup failed");
      }

      return { id: 1, email, name: "Grace Hopper" };
    });
    vi.mocked(client.getUserGroups).mockResolvedValue([]);

    await expect(previewUserGroupSync(createInput(client))).rejects.toThrow("Stack lookup failed");
    expect(client.getUserByEmail).toHaveBeenCalledWith("grace@example.com");
    expect(client.getUserByEmail).toHaveBeenCalledWith("linus@example.com");
    expect(client.getUserGroups).not.toHaveBeenCalled();
  });

  it("skips a row only when the email lookup confirms the user is missing", async () => {
    const client = createClient();
    vi.mocked(client.getUserByEmail).mockImplementation(async (email: string) =>
      email.toLowerCase() === "linus@example.com"
        ? null
        : { id: 1, email, name: "Grace Hopper" },
    );
    vi.mocked(client.getUserGroups).mockResolvedValue([]);

    const preview = await previewUserGroupSync(createInput(client));

    expect(preview.skippedRows).toEqual([
      {
        rowNumber: 3,
        email: "linus@example.com",
        seniorManager: "Ada Lovelace",
        reason: "Email not found in Stack Enterprise",
      },
    ]);
  });

  it("resolves unique emails in batches of 20 with a two-second pause between batches", async () => {
    const emails = Array.from({ length: 41 }, (_, index) => `member${index}@example.com`);
    const client = createClient();
    let activeLookups = 0;
    let maxActiveLookups = 0;
    const callsAtWait: number[] = [];
    const waitFn = vi.fn(async () => {
      callsAtWait.push(vi.mocked(client.getUserByEmail).mock.calls.length);
    });
    vi.mocked(client.getUserByEmail).mockImplementation(async (email: string) => {
      activeLookups += 1;
      maxActiveLookups = Math.max(maxActiveLookups, activeLookups);
      await Promise.resolve();
      activeLookups -= 1;
      return {
        id: Number(email.match(/\d+/)?.[0] ?? 0) + 1,
        email,
      };
    });
    vi.mocked(client.getUserGroups).mockResolvedValue([]);

    await previewUserGroupSync({
      ...createInput(client),
      csvText: createCsvWithEmails(emails),
      waitFn,
    });

    expect(client.getUserByEmail).toHaveBeenCalledTimes(41);
    expect(maxActiveLookups).toBe(20);
    expect(waitFn).toHaveBeenCalledTimes(2);
    expect(waitFn).toHaveBeenNthCalledWith(1, 2);
    expect(waitFn).toHaveBeenNthCalledWith(2, 2);
    expect(callsAtWait).toEqual([20, 40]);
  });

  it("deduplicates email lookups case-insensitively across batch boundaries", async () => {
    const uniqueEmails = Array.from({ length: 21 }, (_, index) => `member${index}@example.com`);
    const client = createClient();
    const waitFn = vi.fn(async () => undefined);
    vi.mocked(client.getUserByEmail).mockImplementation(async (email: string) => ({
      id: Number(email.match(/\d+/)?.[0] ?? 0) + 1,
      email,
    }));
    vi.mocked(client.getUserGroups).mockResolvedValue([]);

    await previewUserGroupSync({
      ...createInput(client),
      csvText: createCsvWithEmails([...uniqueEmails, "MEMBER0@EXAMPLE.COM"]),
      waitFn,
    });

    expect(client.getUserByEmail).toHaveBeenCalledTimes(21);
    expect(client.getUserByEmail).toHaveBeenCalledWith("member0@example.com");
    expect(client.getUserByEmail).not.toHaveBeenCalledWith("MEMBER0@EXAMPLE.COM");
    expect(waitFn).toHaveBeenCalledTimes(1);
    expect(waitFn).toHaveBeenCalledWith(2);
  });
});

describe("applyUserGroupSync", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("applies add-only changes without removals", async () => {
    const client = createClient();
    vi.mocked(client.getUserGroups).mockResolvedValue([
      {
        id: 10,
        name: "Ada Lovelace VRM",
        users: [
          { id: 1, name: "Grace Hopper" },
          { id: 99, name: "Former Member" },
        ],
      },
    ]);

    const result = await applyUserGroupSync(createInput(client));

    expect(client.addUserGroupMembers).toHaveBeenCalledWith(10, [2]);
    expect(client.removeUserGroupMember).not.toHaveBeenCalled();
    expect(result.preview.groups[0]).toEqual(expect.objectContaining({ removeUserIds: [] }));
    expect(result.operations).toEqual([
      {
        kind: "add-members",
        groupName: "Ada Lovelace VRM",
        userIds: [2],
        status: "succeeded",
      },
    ]);
  });

  it("records add-member failures", async () => {
    const client = createClient();
    vi.mocked(client.addUserGroupMembers).mockRejectedValue(new Error("add failed"));

    const result = await applyUserGroupSync(createInput(client));

    expect(result.operations).toEqual([
      {
        kind: "add-members",
        groupName: "Ada Lovelace VRM",
        userIds: [2],
        status: "failed",
        error: "add failed",
      },
    ]);
  });

  it("applies exact-sync removals only when exact sync is selected", async () => {
    const client = createClient();
    vi.mocked(client.getUserGroups).mockResolvedValue([
      {
        id: 10,
        name: "Ada Lovelace VRM",
        users: [
          { id: 1, name: "Grace Hopper" },
          { id: 99, name: "Former Member" },
        ],
      },
    ]);

    const result = await applyUserGroupSync({
      ...createInput(client),
      syncMode: "exact-sync",
    });

    expect(client.addUserGroupMembers).toHaveBeenCalledWith(10, [2]);
    expect(client.removeUserGroupMember).toHaveBeenCalledWith(10, 99);
    expect(result.operations).toEqual([
      {
        kind: "add-members",
        groupName: "Ada Lovelace VRM",
        userIds: [2],
        status: "succeeded",
      },
      {
        kind: "remove-member",
        groupName: "Ada Lovelace VRM",
        userIds: [99],
        status: "succeeded",
      },
    ]);
  });

  it("skips exact-sync removals for a group when adding members fails", async () => {
    const client = createClient();
    vi.mocked(client.getUserGroups).mockResolvedValue([
      {
        id: 10,
        name: "Ada Lovelace VRM",
        users: [
          { id: 1, name: "Grace Hopper" },
          { id: 99, name: "Former Member" },
        ],
      },
    ]);
    vi.mocked(client.addUserGroupMembers).mockRejectedValue(new Error("cannot add members"));

    const result = await applyUserGroupSync({
      ...createInput(client),
      syncMode: "exact-sync",
    });

    expect(client.removeUserGroupMember).not.toHaveBeenCalled();
    expect(result.operations).toEqual([
      {
        kind: "add-members",
        groupName: "Ada Lovelace VRM",
        userIds: [2],
        status: "failed",
        error: "cannot add members",
      },
    ]);
  });

  it("records per-user remove failures and continues removing remaining users", async () => {
    const client = createClient();
    vi.mocked(client.getUserGroups).mockResolvedValue([
      {
        id: 10,
        name: "Ada Lovelace VRM",
        users: [
          { id: 1, name: "Grace Hopper" },
          { id: 99, name: "Former Member" },
          { id: 100, name: "Another Former Member" },
        ],
      },
    ]);
    vi.mocked(client.removeUserGroupMember).mockImplementation(async (_userGroupId: number, userId: number) => {
      if (userId === 99) {
        throw new Error("cannot remove 99");
      }
    });

    const result = await applyUserGroupSync({
      ...createInput(client),
      syncMode: "exact-sync",
    });

    expect(client.removeUserGroupMember).toHaveBeenCalledWith(10, 99);
    expect(client.removeUserGroupMember).toHaveBeenCalledWith(10, 100);
    expect(result.operations).toEqual([
      {
        kind: "add-members",
        groupName: "Ada Lovelace VRM",
        userIds: [2],
        status: "succeeded",
      },
      {
        kind: "remove-member",
        groupName: "Ada Lovelace VRM",
        userIds: [99],
        status: "failed",
        error: "cannot remove 99",
      },
      {
        kind: "remove-member",
        groupName: "Ada Lovelace VRM",
        userIds: [100],
        status: "succeeded",
      },
    ]);
  });

  it("creates missing groups without separately adding the same members", async () => {
    const client = createClient();
    vi.mocked(client.getUserGroups).mockResolvedValue([]);

    const result = await applyUserGroupSync(createInput(client));

    expect(client.createUserGroup).toHaveBeenCalledWith({
      name: "Ada Lovelace VRM",
      userIds: [1, 2],
    });
    expect(client.addUserGroupMembers).not.toHaveBeenCalled();
    expect(result.operations).toEqual([
      {
        kind: "create-group",
        groupName: "Ada Lovelace VRM",
        userIds: [1, 2],
        status: "succeeded",
      },
    ]);
  });

  it("records create failures and skips later writes for that group", async () => {
    const client = createClient();
    vi.mocked(client.getUserGroups).mockResolvedValue([]);
    vi.mocked(client.createUserGroup).mockRejectedValue(new Error("create failed"));

    const result = await applyUserGroupSync({
      ...createInput(client),
      syncMode: "exact-sync",
    });

    expect(client.addUserGroupMembers).not.toHaveBeenCalled();
    expect(client.removeUserGroupMember).not.toHaveBeenCalled();
    expect(result.operations).toEqual([
      {
        kind: "create-group",
        groupName: "Ada Lovelace VRM",
        userIds: [1, 2],
        status: "failed",
        error: "create failed",
      },
    ]);
  });

  it("does not apply operations when preview has blocking errors", async () => {
    const client = createClient();

    const result = await applyUserGroupSync({
      ...createInput(client),
      groupNameTemplate: "   ",
    });

    expect(result.preview.blockingErrors).toEqual([
      "Group name template produced a blank group name for Senior Manager value(s): Ada Lovelace.",
    ]);
    expect(result.operations).toEqual([]);
    expect(client.createUserGroup).not.toHaveBeenCalled();
    expect(client.addUserGroupMembers).not.toHaveBeenCalled();
    expect(client.removeUserGroupMember).not.toHaveBeenCalled();
  });
});
