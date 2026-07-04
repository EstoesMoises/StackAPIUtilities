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
      users: [
        { id: 1, name: "Grace Hopper" },
        { id: 99, name: "Former Member" },
      ],
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
    const rows = parseUserExportCsv(
      [
        "Director,Senior Manager,User Group Member,First Name,Last Name,Colleague ID,Email,Job Title",
        "Pat Director,,Grace Hopper,Grace,Hopper,1001,grace@example.com,Engineer",
        "Pat Director,Ada Lovelace,Missing Email,Missing,Email,1002,,Engineer",
        "Pat Director,Ada Lovelace,Grace Hopper,Grace,Hopper,1003,grace@example.com,Engineer",
        "Pat Director,Ada Lovelace,Grace Hopper Again,Grace,Hopper,1004,GRACE@example.com,Engineer",
        "Pat Director,Ada Lovelace,Unresolved User,Unresolved,User,1005,nope@example.com,Engineer",
      ].join("\n"),
    );

    const plan = planUserGroupSync({
      rows,
      groupNameTemplate: "{Senior Manager} VRM",
      syncMode: "add-only",
      existingGroups: [],
      resolvedUsers: {
        "grace@example.com": { id: 1, email: "grace@example.com", name: "Grace Hopper" },
        "nope@example.com": null,
      },
    });

    expect(plan.skippedRows).toEqual([
      {
        rowNumber: 2,
        email: "grace@example.com",
        seniorManager: "",
        reason: "Missing Senior Manager",
      },
      {
        rowNumber: 3,
        email: "",
        seniorManager: "Ada Lovelace",
        reason: "Missing Email",
      },
      {
        rowNumber: 5,
        email: "GRACE@example.com",
        seniorManager: "Ada Lovelace",
        reason: "Duplicate Email",
      },
      {
        rowNumber: 6,
        email: "nope@example.com",
        seniorManager: "Ada Lovelace",
        reason: "Email not found in Stack Enterprise",
      },
    ]);
  });

  it("does not let a missing-manager row reserve its email", () => {
    const rows = parseUserExportCsv(
      [
        "Director,Senior Manager,User Group Member,First Name,Last Name,Colleague ID,Email,Job Title",
        "Pat Director,,Grace Hopper,Grace,Hopper,1001,grace@example.com,Engineer",
        "Pat Director,Ada Lovelace,Grace Hopper,Grace,Hopper,1002,GRACE@example.com,Engineer",
      ].join("\n"),
    );

    const plan = planUserGroupSync({
      rows,
      groupNameTemplate: "{Senior Manager} VRM",
      syncMode: "add-only",
      existingGroups: [],
      resolvedUsers: {
        "grace@example.com": { id: 1, email: "grace@example.com", name: "Grace Hopper" },
      },
    });

    expect(plan.skippedRows).toEqual([
      {
        rowNumber: 2,
        email: "grace@example.com",
        seniorManager: "",
        reason: "Missing Senior Manager",
      },
    ]);
    expect(plan.groups).toEqual([
      expect.objectContaining({
        manager: "Ada Lovelace",
        desiredUserIds: [1],
        addUserIds: [1],
      }),
    ]);
  });

  it("detects duplicate emails case-insensitively after a valid row claims the email", () => {
    const rows = parseUserExportCsv(
      [
        "Director,Senior Manager,User Group Member,First Name,Last Name,Colleague ID,Email,Job Title",
        "Pat Director,Ada Lovelace,Grace Hopper,Grace,Hopper,1001,Grace@Example.com,Engineer",
        "Pat Director,Ada Lovelace,Grace Hopper Again,Grace,Hopper,1002,grace@example.com,Engineer",
      ].join("\n"),
    );

    const plan = planUserGroupSync({
      rows,
      groupNameTemplate: "{Senior Manager} VRM",
      syncMode: "add-only",
      existingGroups: [],
      resolvedUsers: {
        "grace@example.com": { id: 1, email: "grace@example.com", name: "Grace Hopper" },
      },
    });

    expect(plan.groups[0]).toEqual(expect.objectContaining({ desiredUserIds: [1] }));
    expect(plan.skippedRows).toEqual([
      {
        rowNumber: 3,
        email: "grace@example.com",
        seniorManager: "Ada Lovelace",
        reason: "Duplicate Email",
      },
    ]);
  });

  it("matches existing groups case-insensitively after trimming whitespace", () => {
    const plan = planUserGroupSync({
      rows: parseUserExportCsv(csv),
      groupNameTemplate: "{Senior Manager} VRM",
      syncMode: "add-only",
      existingGroups: [
        {
          id: 42,
          name: "  ada lovelace vrm  ",
          users: [{ id: 1, name: "Grace Hopper" }],
        },
      ],
      resolvedUsers,
    });

    expect(plan.groups[0]).toEqual(
      expect.objectContaining({
        groupName: "Ada Lovelace VRM",
        existingGroupId: 42,
        createGroup: false,
        addUserIds: [2],
      }),
    );
  });

  it("blocks apply when the template renders a blank group name", () => {
    const plan = planUserGroupSync({
      rows: parseUserExportCsv(
        [
          "Director,Senior Manager,User Group Member,First Name,Last Name,Colleague ID,Email,Job Title",
          "Pat Director,Ada Lovelace,Grace Hopper,Grace,Hopper,1001,grace@example.com,Engineer",
        ].join("\n"),
      ),
      groupNameTemplate: "   ",
      syncMode: "add-only",
      existingGroups: [],
      resolvedUsers,
    });

    expect(plan.blockingErrors).toEqual([
      "Group name template produced a blank group name for Senior Manager value(s): Ada Lovelace.",
    ]);
  });

  it("sorts groups and user id changes deterministically", () => {
    const rows = parseUserExportCsv(
      [
        "Director,Senior Manager,User Group Member,First Name,Last Name,Colleague ID,Email,Job Title",
        "Pat Director,Beta Manager,Beta User,Beta,User,1001,beta@example.com,Engineer",
        "Pat Director,Alpha Manager,Alpha Four,Alpha,Four,1002,alpha4@example.com,Engineer",
        "Pat Director,Gamma Manager,Gamma User,Gamma,User,1003,gamma@example.com,Engineer",
        "Pat Director,Alpha Manager,Alpha Two,Alpha,Two,1004,alpha2@example.com,Engineer",
      ].join("\n"),
    );

    const plan = planUserGroupSync({
      rows,
      groupNameTemplate: "{Senior Manager} VRM",
      syncMode: "exact-sync",
      existingGroups: [
        {
          id: 101,
          name: "Alpha Manager VRM",
          users: [{ id: 7 }, { id: 2 }],
        },
        {
          id: 102,
          name: "Beta Manager VRM",
          users: [{ id: 5 }, { id: 1 }],
        },
      ],
      resolvedUsers: {
        "beta@example.com": { id: 5, email: "beta@example.com" },
        "alpha4@example.com": { id: 4, email: "alpha4@example.com" },
        "gamma@example.com": { id: 3, email: "gamma@example.com" },
        "alpha2@example.com": { id: 2, email: "alpha2@example.com" },
      },
    });

    expect(plan.groups.map((group) => group.groupName)).toEqual([
      "Alpha Manager VRM",
      "Beta Manager VRM",
      "Gamma Manager VRM",
    ]);
    expect(plan.groups[0]).toEqual(
      expect.objectContaining({
        desiredUserIds: [2, 4],
        addUserIds: [4],
        removeUserIds: [7],
      }),
    );
    expect(plan.groups[1]).toEqual(
      expect.objectContaining({
        desiredUserIds: [5],
        addUserIds: [],
        removeUserIds: [1],
      }),
    );
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
      'Group name "VRM" is produced by multiple Senior Manager values: Ada Lovelace, Alan Turing.',
    ]);
  });
});
