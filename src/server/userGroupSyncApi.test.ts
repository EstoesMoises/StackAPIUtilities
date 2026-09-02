import { describe, expect, it, vi } from "vitest";
import { StackApiError } from "../api/httpClient";
import type { SessionCredentials } from "../domain/types";
import type { UserGroupSyncClient } from "../writeTools/userGroupSyncRunner";
import { handleUserGroupSyncRequest } from "./userGroupSyncApi";

const credentials: SessionCredentials = {
  instanceType: "enterprise",
  baseUrl: "https://demo.stackenterprise.co",
  accessToken: "oauth-token",
  authSource: "oauth-pkce",
  oauthScopes: ["write_access", "no_expiry"],
};

const csvText = [
  "Director,Senior Manager,User Group Member,First Name,Last Name,Colleague ID,Email,Job Title",
  "Pat Director,Ada Lovelace,Grace Hopper,Grace,Hopper,1001,grace@example.com,Engineer",
].join("\n");

const addOnlyExpectedPreview = {
  syncMode: "add-only" as const,
  groupNameTemplate: "{Senior Manager} VRM",
  blockingErrors: [],
  skippedRows: [],
  groups: [
    {
      manager: "Ada Lovelace",
      groupName: "Ada Lovelace VRM",
      existingGroupId: null,
      createGroup: true,
      desiredUserIds: [1],
      addUserIds: [1],
      removeUserIds: [],
    },
  ],
};

describe("handleUserGroupSyncRequest", () => {
  it("returns preview results", async () => {
    const client = createClient({
      getUserByEmail: vi.fn().mockResolvedValue({ id: 1, email: "grace@example.com", name: "Grace Hopper" }),
      getUserGroups: vi.fn().mockResolvedValue([]),
    });
    const createClientDependency = vi.fn((_credentials: SessionCredentials) => client);

    const response = await handleUserGroupSyncRequest(
      {
        action: "preview",
        credentials,
        csvText,
        groupNameTemplate: "{Senior Manager} VRM",
        syncMode: "add-only",
      },
      { createClient: createClientDependency },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/json");
    await expect(response.json()).resolves.toEqual({
      ok: true,
      result: expect.objectContaining({
        groups: [
          expect.objectContaining({
            groupName: "Ada Lovelace VRM",
            createGroup: true,
          }),
        ],
      }),
    });
    expect(createClientDependency).toHaveBeenCalledWith(credentials);
  });

  it("fails preview closed when an email lookup remains rate limited", async () => {
    const client = createClient({
      getUserByEmail: vi.fn().mockRejectedValue(
        new StackApiError(
          "Stack API v3 request failed with 429",
          429,
          "https://demo.stackenterprise.co/api/v3/users/by-email/grace%40example.com",
          "rate limited",
        ),
      ),
      getUserGroups: vi.fn(),
    });

    const response = await handleUserGroupSyncRequest(
      {
        action: "preview",
        credentials,
        csvText,
        groupNameTemplate: "{Senior Manager} VRM",
        syncMode: "add-only",
      },
      { createClient: () => client },
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: "Stack API v3 request failed with 429",
    });
    expect(client.getUserGroups).not.toHaveBeenCalled();
    expect(client.createUserGroup).not.toHaveBeenCalled();
    expect(client.addUserGroupMembers).not.toHaveBeenCalled();
    expect(client.removeUserGroupMember).not.toHaveBeenCalled();
  });

  it("returns preview results with manual Enterprise access token credentials", async () => {
    const manualTokenCredentials: SessionCredentials = {
      instanceType: "enterprise",
      baseUrl: "https://demo.stackenterprise.co",
      accessToken: "manual-token",
      authSource: "manual-enterprise-token",
    };
    const client = createClient({
      getUserByEmail: vi.fn().mockResolvedValue({ id: 1, email: "grace@example.com", name: "Grace Hopper" }),
      getUserGroups: vi.fn().mockResolvedValue([]),
    });
    const createClientDependency = vi.fn((_credentials: SessionCredentials) => client);

    const response = await handleUserGroupSyncRequest(
      {
        action: "preview",
        credentials: manualTokenCredentials,
        csvText,
        groupNameTemplate: "{Senior Manager} VRM",
        syncMode: "add-only",
      },
      { createClient: createClientDependency },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      result: expect.objectContaining({
        groups: [
          expect.objectContaining({
            groupName: "Ada Lovelace VRM",
          }),
        ],
      }),
    });
    expect(createClientDependency).toHaveBeenCalledWith(manualTokenCredentials);
  });

  it("preserves the successful response contract when a short token matches the ok key", async () => {
    const shortTokenCredentials: SessionCredentials = {
      instanceType: "enterprise",
      baseUrl: "https://demo.stackenterprise.co",
      accessToken: "ok",
      authSource: "manual-enterprise-token",
    };
    const client = createClient({
      getUserByEmail: vi.fn().mockResolvedValue({ id: 1, email: "grace@example.com", name: "Grace Hopper" }),
      getUserGroups: vi.fn().mockResolvedValue([]),
    });

    const response = await handleUserGroupSyncRequest(
      {
        action: "preview",
        credentials: shortTokenCredentials,
        csvText,
        groupNameTemplate: "{Senior Manager} VRM",
        syncMode: "add-only",
      },
      { createClient: () => client },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      result: expect.objectContaining({
        groups: [
          expect.objectContaining({
            groupName: "Ada Lovelace VRM",
            createGroup: true,
          }),
        ],
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

  it("rejects enterprise credentials with a Basic/Business URL", async () => {
    const createClient = vi.fn();

    const response = await handleUserGroupSyncRequest(
      {
        action: "preview",
        credentials: {
          ...credentials,
          baseUrl: "https://stackoverflowteams.com/c/team",
        },
        csvText,
        groupNameTemplate: "{Senior Manager} VRM",
        syncMode: "add-only",
      },
      { createClient },
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: "Enterprise user group sync requires Enterprise session credentials.",
    });
    expect(createClient).not.toHaveBeenCalled();
  });

  it("returns a 400 response for malformed instance URLs", async () => {
    const createClient = vi.fn();

    const response = await handleUserGroupSyncRequest(
      {
        action: "preview",
        credentials: {
          ...credentials,
          baseUrl: "not a url",
        },
        csvText,
        groupNameTemplate: "{Senior Manager} VRM",
        syncMode: "add-only",
      },
      { createClient },
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: "Enterprise user group sync requires a valid instance URL.",
    });
    expect(createClient).not.toHaveBeenCalled();
  });

  it("rejects arbitrary public hosts as Enterprise write targets", async () => {
    const createClient = vi.fn();

    const response = await handleUserGroupSyncRequest(
      {
        action: "preview",
        credentials: {
          ...credentials,
          baseUrl: "https://example.com",
        },
        csvText,
        groupNameTemplate: "{Senior Manager} VRM",
        syncMode: "add-only",
      },
      { createClient },
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: "Enterprise user group sync requires a Stack Enterprise instance URL.",
    });
    expect(createClient).not.toHaveBeenCalled();
  });

  it("rejects Stack Enterprise hostname suffix attacks", async () => {
    const createClient = vi.fn();

    const response = await handleUserGroupSyncRequest(
      {
        action: "preview",
        credentials: {
          ...credentials,
          baseUrl: "https://stackenterprise.co.evil.example",
        },
        csvText,
        groupNameTemplate: "{Senior Manager} VRM",
        syncMode: "add-only",
      },
      { createClient },
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: "Enterprise user group sync requires a Stack Enterprise instance URL.",
    });
    expect(createClient).not.toHaveBeenCalled();
  });

  it("rejects local HTTP targets as Enterprise write targets", async () => {
    const createClient = vi.fn();

    const response = await handleUserGroupSyncRequest(
      {
        action: "preview",
        credentials: {
          ...credentials,
          baseUrl: "http://127.0.0.1:3000",
        },
        csvText,
        groupNameTemplate: "{Senior Manager} VRM",
        syncMode: "add-only",
      },
      { createClient },
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: "Enterprise user group sync requires a Stack Enterprise instance URL.",
    });
    expect(createClient).not.toHaveBeenCalled();
  });

  it("accepts Stack Enterprise instance URLs", async () => {
    const client = createClient({
      getUserByEmail: vi.fn().mockResolvedValue({ id: 1, email: "grace@example.com", name: "Grace Hopper" }),
      getUserGroups: vi.fn().mockResolvedValue([]),
    });
    const createClientDependency = vi.fn((_credentials: SessionCredentials) => client);
    const stackEnterpriseCredentials: SessionCredentials = {
      ...credentials,
      baseUrl: "https://stackenterprise.co",
    };

    const response = await handleUserGroupSyncRequest(
      {
        action: "preview",
        credentials: stackEnterpriseCredentials,
        csvText,
        groupNameTemplate: "{Senior Manager} VRM",
        syncMode: "add-only",
      },
      { createClient: createClientDependency },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      result: expect.objectContaining({
        groups: [
          expect.objectContaining({
            groupName: "Ada Lovelace VRM",
            createGroup: true,
          }),
        ],
      }),
    });
    expect(createClientDependency).toHaveBeenCalledWith(stackEnterpriseCredentials);
  });

  it("applies changes through the runner", async () => {
    const client = createClient({
      getUserByEmail: vi.fn().mockResolvedValue({ id: 1, email: "grace@example.com", name: "Grace Hopper" }),
      getUserGroups: vi.fn().mockResolvedValue([]),
      createUserGroup: vi.fn().mockResolvedValue({ id: 10, name: "Ada Lovelace VRM", users: [{ id: 1 }] }),
    });

    const response = await handleUserGroupSyncRequest(
      {
        action: "apply",
        credentials,
        csvText,
        groupNameTemplate: "{Senior Manager} VRM",
        syncMode: "add-only",
        expectedPreview: addOnlyExpectedPreview,
      },
      { createClient: () => client },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      result: expect.objectContaining({
        operations: [
          expect.objectContaining({
            kind: "create-group",
            groupName: "Ada Lovelace VRM",
            userIds: [1],
            status: "succeeded",
          }),
        ],
      }),
    });
    expect(client.createUserGroup).toHaveBeenCalledWith({ name: "Ada Lovelace VRM", userIds: [1] });
  });

  it("preserves operation status structurally while redacting the same literal from free-form values", async () => {
    const statusTokenCredentials: SessionCredentials = {
      instanceType: "enterprise",
      baseUrl: "https://demo.stackenterprise.co",
      accessToken: "succeeded",
      authSource: "manual-enterprise-token",
    };
    const succeededExpectedPreview = {
      syncMode: "add-only" as const,
      groupNameTemplate: "succeeded",
      blockingErrors: [],
      skippedRows: [],
      groups: [
        {
          manager: "Ada Lovelace",
          groupName: "succeeded",
          existingGroupId: null,
          createGroup: true,
          desiredUserIds: [1],
          addUserIds: [1],
          removeUserIds: [],
        },
      ],
    };
    const client = createClient({
      getUserByEmail: vi.fn().mockResolvedValue({ id: 1, email: "grace@example.com", name: "Grace Hopper" }),
      getUserGroups: vi.fn().mockResolvedValue([]),
      createUserGroup: vi.fn().mockResolvedValue({ id: 10, name: "succeeded", users: [{ id: 1 }] }),
    });

    const response = await handleUserGroupSyncRequest(
      {
        action: "apply",
        credentials: statusTokenCredentials,
        csvText,
        groupNameTemplate: "succeeded",
        syncMode: "add-only",
        expectedPreview: succeededExpectedPreview,
      },
      { createClient: () => client },
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({
      ok: true,
      result: {
        operations: [
          {
            kind: "create-group",
            groupName: expect.not.stringContaining("succeeded"),
            userIds: [1],
            status: "succeeded",
          },
        ],
      },
    });
    expect(body.result.preview.groupNameTemplate).not.toContain("succeeded");
    expect(body.result.preview.groups[0].groupName).not.toContain("succeeded");
  });

  it("preserves the sync-mode enum when a short token matches its literal", async () => {
    const syncModeTokenCredentials: SessionCredentials = {
      instanceType: "enterprise",
      baseUrl: "https://demo.stackenterprise.co",
      accessToken: "add-only",
      authSource: "manual-enterprise-token",
    };
    const client = createClient({
      getUserByEmail: vi.fn().mockResolvedValue({ id: 1, email: "grace@example.com", name: "Grace Hopper" }),
      getUserGroups: vi.fn().mockResolvedValue([]),
    });

    const response = await handleUserGroupSyncRequest(
      {
        action: "preview",
        credentials: syncModeTokenCredentials,
        csvText,
        groupNameTemplate: "{Senior Manager} VRM",
        syncMode: "add-only",
      },
      { createClient: () => client },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      result: {
        syncMode: "add-only",
      },
    });
  });

  it.each(["create-group", "add-members", "remove-member"] as const)(
    "preserves operation kind %s only at its declared path",
    async (kind) => {
      const syncMode = kind === "remove-member" ? "exact-sync" : "add-only";
      const existingGroup =
        kind === "create-group"
          ? null
          : {
              id: 10,
              name: kind,
              users: kind === "remove-member" ? [{ id: 1 }, { id: 2 }] : [],
            };
      const expectedPreview = {
        syncMode,
        groupNameTemplate: kind,
        blockingErrors: [],
        skippedRows: [],
        groups: [
          {
            manager: "Ada Lovelace",
            groupName: kind,
            existingGroupId: existingGroup?.id ?? null,
            createGroup: existingGroup === null,
            desiredUserIds: [1],
            addUserIds: kind === "remove-member" ? [] : [1],
            removeUserIds: kind === "remove-member" ? [2] : [],
          },
        ],
      };
      const client = createClient({
        getUserByEmail: vi.fn().mockResolvedValue({ id: 1, email: "grace@example.com", name: "Grace Hopper" }),
        getUserGroups: vi.fn().mockResolvedValue(existingGroup ? [existingGroup] : []),
        createUserGroup: vi.fn().mockResolvedValue({ id: 10, name: kind, users: [{ id: 1 }] }),
        addUserGroupMembers: vi.fn().mockResolvedValue({ id: 10, name: kind, users: [{ id: 1 }] }),
        removeUserGroupMember: vi.fn().mockResolvedValue(undefined),
      });

      const response = await handleUserGroupSyncRequest(
        {
          action: "apply",
          credentials: manualCredentials(kind),
          csvText,
          groupNameTemplate: kind,
          syncMode,
          expectedPreview,
        },
        { createClient: () => client },
      );

      expect(response.status).toBe(200);
      const body = await response.json();
      const operation = body.result.operations.find(
        (candidate: { kind: string }) => candidate.kind === kind,
      );
      expect(operation).toMatchObject({
        kind,
        groupName: expect.not.stringContaining(kind),
      });
      expect(body.result.preview.groupNameTemplate).not.toContain(kind);
    },
  );

  it.each(["succeeded", "failed"] as const)(
    "preserves operation status %s only at its declared path",
    async (operationStatus) => {
      const client = createClient({
        getUserByEmail: vi.fn().mockResolvedValue({ id: 1, email: "grace@example.com", name: "Grace Hopper" }),
        getUserGroups: vi.fn().mockResolvedValue([]),
        createUserGroup:
          operationStatus === "succeeded"
            ? vi.fn().mockResolvedValue({ id: 10, name: operationStatus, users: [{ id: 1 }] })
            : vi.fn().mockRejectedValue(new Error(`free-form ${operationStatus}`)),
      });
      const expectedPreview = expectedPreviewForGroup(operationStatus, "add-only");

      const response = await handleUserGroupSyncRequest(
        {
          action: "apply",
          credentials: manualCredentials(operationStatus),
          csvText,
          groupNameTemplate: operationStatus,
          syncMode: "add-only",
          expectedPreview,
        },
        { createClient: () => client },
      );

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.result.operations[0].status).toBe(operationStatus);
      expect(body.result.operations[0].groupName).not.toContain(operationStatus);
      expect(body.result.preview.groupNameTemplate).not.toContain(operationStatus);
      if (operationStatus === "failed") {
        expect(body.result.operations[0].error).not.toContain(operationStatus);
      }
    },
  );

  it.each(["add-only", "exact-sync"] as const)(
    "preserves sync mode %s only at its declared path",
    async (syncMode) => {
      const client = createClient({
        getUserByEmail: vi.fn().mockResolvedValue({ id: 1, email: "grace@example.com", name: "Grace Hopper" }),
        getUserGroups: vi.fn().mockResolvedValue([]),
      });

      const response = await handleUserGroupSyncRequest(
        {
          action: "preview",
          credentials: manualCredentials(syncMode),
          csvText,
          groupNameTemplate: syncMode,
          syncMode,
        },
        { createClient: () => client },
      );

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.result.syncMode).toBe(syncMode);
      expect(body.result.groupNameTemplate).not.toContain(syncMode);
      expect(body.result.groups[0].groupName).not.toContain(syncMode);
    },
  );

  it.each([
    ["Missing Senior Manager", [userExportRow({ seniorManager: "" })]],
    ["Missing Email", [userExportRow({ email: "" })]],
    [
      "Duplicate Email",
      [userExportRow(), userExportRow({ firstName: "Second", lastName: "Person" })],
    ],
    ["Email not found in Stack Enterprise", [userExportRow()]],
  ] as const)(
    "preserves skipped-row reason %s only at its declared path",
    async (reason, rows) => {
      const client = createClient({
        getUserByEmail: vi
          .fn()
          .mockResolvedValue(reason === "Email not found in Stack Enterprise" ? null : {
            id: 1,
            email: "grace@example.com",
            name: "Grace Hopper",
          }),
        getUserGroups: vi.fn().mockResolvedValue([]),
      });

      const response = await handleUserGroupSyncRequest(
        {
          action: "preview",
          credentials: manualCredentials(reason),
          csvText: [userExportHeader, ...rows].join("\n"),
          groupNameTemplate: reason,
          syncMode: "add-only",
        },
        { createClient: () => client },
      );

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.result.skippedRows[0].reason).toBe(reason);
      expect(body.result.groupNameTemplate).not.toContain(reason);
    },
  );

  it("redacts submitted credentials from operation-level apply failures", async () => {
    const accessToken = "se_access_1234567890abcdef1234567890abcdef";
    const pat = "se_pat_abcdef1234567890abcdef1234567890";
    const requestCredentials: SessionCredentials = {
      ...credentials,
      accessToken: `  ${accessToken}  `,
      pat: ` ${pat} `,
    };
    const client = createClient({
      getUserByEmail: vi.fn().mockResolvedValue({ id: 1, email: "grace@example.com", name: "Grace Hopper" }),
      getUserGroups: vi.fn().mockResolvedValue([]),
      createUserGroup: vi
        .fn()
        .mockRejectedValue(new Error(`Create failed with ${accessToken}, ${pat}, and ${requestCredentials.pat}`)),
    });

    const response = await handleUserGroupSyncRequest(
      {
        action: "apply",
        credentials: requestCredentials,
        csvText,
        groupNameTemplate: "{Senior Manager} VRM",
        syncMode: "add-only",
        expectedPreview: addOnlyExpectedPreview,
      },
      { createClient: () => client },
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({
      ok: true,
      result: expect.objectContaining({
        operations: [
          expect.objectContaining({
            status: "failed",
            error: expect.stringContaining("[redacted]"),
          }),
        ],
      }),
    });
    const operationError = body.result.operations[0].error;
    expect(operationError).not.toContain(accessToken);
    expect(operationError).not.toContain(requestCredentials.accessToken);
    expect(operationError).not.toContain(pat);
    expect(operationError).not.toContain(requestCredentials.pat);
  });

  it("rejects apply requests without an expected preview before writes", async () => {
    const client = createClient({
      getUserByEmail: vi.fn().mockResolvedValue({ id: 1, email: "grace@example.com", name: "Grace Hopper" }),
      getUserGroups: vi.fn().mockResolvedValue([]),
      createUserGroup: vi.fn().mockResolvedValue({ id: 10, name: "Ada Lovelace VRM", users: [{ id: 1 }] }),
    });

    const response = await handleUserGroupSyncRequest(
      {
        action: "apply",
        credentials,
        csvText,
        groupNameTemplate: "{Senior Manager} VRM",
        syncMode: "add-only",
      },
      { createClient: () => client },
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: "Preview changes before applying user group sync changes.",
    });
    expect(client.createUserGroup).not.toHaveBeenCalled();
    expect(client.addUserGroupMembers).not.toHaveBeenCalled();
    expect(client.removeUserGroupMember).not.toHaveBeenCalled();
  });

  it("rejects stale exact-sync previews before newly detected removals are applied", async () => {
    const client = createClient({
      getUserByEmail: vi.fn().mockResolvedValue({ id: 1, email: "grace@example.com", name: "Grace Hopper" }),
      getUserGroups: vi.fn().mockResolvedValue([
        {
          id: 10,
          name: "Ada Lovelace VRM",
          users: [
            { id: 1, name: "Grace Hopper" },
            { id: 99, name: "Newly Added Member" },
          ],
        },
      ]),
    });
    const expectedPreview = {
      syncMode: "exact-sync" as const,
      groupNameTemplate: "{Senior Manager} VRM",
      blockingErrors: [],
      skippedRows: [],
      groups: [
        {
          manager: "Ada Lovelace",
          groupName: "Ada Lovelace VRM",
          existingGroupId: 10,
          createGroup: false,
          desiredUserIds: [1],
          addUserIds: [],
          removeUserIds: [],
        },
      ],
    };

    const response = await handleUserGroupSyncRequest(
      {
        action: "apply",
        credentials,
        csvText,
        groupNameTemplate: "{Senior Manager} VRM",
        syncMode: "exact-sync",
        expectedPreview,
      },
      { createClient: () => client },
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: "User group sync preview is stale. Preview changes again before applying.",
    });
    expect(client.createUserGroup).not.toHaveBeenCalled();
    expect(client.addUserGroupMembers).not.toHaveBeenCalled();
    expect(client.removeUserGroupMember).not.toHaveBeenCalled();
  });

  it("applies the verified exact-sync preview without recomputing a different write plan", async () => {
    const getUserGroups = vi
      .fn()
      .mockResolvedValueOnce([
        {
          id: 10,
          name: "Ada Lovelace VRM",
          users: [{ id: 1, name: "Grace Hopper" }],
        },
      ])
      .mockResolvedValueOnce([
        {
          id: 10,
          name: "Ada Lovelace VRM",
          users: [
            { id: 1, name: "Grace Hopper" },
            { id: 99, name: "Late Added Member" },
          ],
        },
      ]);
    const client = createClient({
      getUserByEmail: vi.fn().mockResolvedValue({ id: 1, email: "grace@example.com", name: "Grace Hopper" }),
      getUserGroups,
    });
    const expectedPreview = {
      syncMode: "exact-sync" as const,
      groupNameTemplate: "{Senior Manager} VRM",
      blockingErrors: [],
      skippedRows: [],
      groups: [
        {
          manager: "Ada Lovelace",
          groupName: "Ada Lovelace VRM",
          existingGroupId: 10,
          createGroup: false,
          desiredUserIds: [1],
          addUserIds: [],
          removeUserIds: [],
        },
      ],
    };

    const response = await handleUserGroupSyncRequest(
      {
        action: "apply",
        credentials,
        csvText,
        groupNameTemplate: "{Senior Manager} VRM",
        syncMode: "exact-sync",
        expectedPreview,
      },
      { createClient: () => client },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      result: expect.objectContaining({
        operations: [],
      }),
    });
    expect(client.getUserGroups).toHaveBeenCalledTimes(1);
    expect(client.createUserGroup).not.toHaveBeenCalled();
    expect(client.addUserGroupMembers).not.toHaveBeenCalled();
    expect(client.removeUserGroupMember).not.toHaveBeenCalled();
  });

  it("returns a 400 response for invalid request payloads", async () => {
    const response = await handleUserGroupSyncRequest({ action: "preview" });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: "User group sync request is invalid.",
    });
  });

  it.each([
    ["invalid authSource", { authSource: "manual-access-token" }],
    ["non-string oauthClientId", { oauthClientId: 123 }],
    ["non-array oauthScopes", { oauthScopes: {} }],
    ["non-string oauthScopes entry", { oauthScopes: ["write_access", 123] }],
    ["non-string accessTokenExpiresAt", { accessTokenExpiresAt: {} }],
  ])("returns a 400 response for malformed OAuth metadata: %s", async (_caseName, credentialOverrides) => {
    const createClient = vi.fn();

    const response = await handleUserGroupSyncRequest(
      {
        action: "preview",
        credentials: {
          ...credentials,
          ...credentialOverrides,
        },
        csvText,
        groupNameTemplate: "{Senior Manager} VRM",
        syncMode: "add-only",
      },
      { createClient },
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: "User group sync request is invalid.",
    });
    expect(createClient).not.toHaveBeenCalled();
  });

  it("returns a 400 response for invalid user export CSV", async () => {
    const client = createClient({
      getUserByEmail: vi.fn(),
      getUserGroups: vi.fn().mockResolvedValue([]),
    });
    const createClientDependency = vi.fn((_credentials: SessionCredentials) => client);

    const response = await handleUserGroupSyncRequest(
      {
        action: "preview",
        credentials,
        csvText: "Senior Manager,Email\nAda Lovelace,ada@example.com",
        groupNameTemplate: "{Senior Manager} VRM",
        syncMode: "add-only",
      },
      { createClient: createClientDependency },
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error:
        "User export CSV is missing required column(s): Director, User Group Member, First Name, Last Name, Colleague ID, Job Title",
    });
  });

  it("returns a 400 response for malformed quoted CSV", async () => {
    const client = createClient({
      getUserByEmail: vi.fn(),
      getUserGroups: vi.fn().mockResolvedValue([]),
    });
    const createClientDependency = vi.fn((_credentials: SessionCredentials) => client);
    const malformedCsvText = [
      "Director,Senior Manager,User Group Member,First Name,Last Name,Colleague ID,Email,Job Title",
      'Pat Director,Ada Lovelace,"Grace" Hopper,Grace,Hopper,1001,grace@example.com,Engineer',
    ].join("\n");

    const response = await handleUserGroupSyncRequest(
      {
        action: "preview",
        credentials,
        csvText: malformedCsvText,
        groupNameTemplate: "{Senior Manager} VRM",
        syncMode: "add-only",
      },
      { createClient: createClientDependency },
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error:
        "Trailing quote on quoted field is malformed; Quoted field unterminated; Too few fields: expected 8 fields but parsed 3",
    });
  });

  it("rejects Enterprise credentials without an access token", async () => {
    const createClient = vi.fn();

    const response = await handleUserGroupSyncRequest(
      {
        action: "preview",
        credentials: {
          ...credentials,
          accessToken: undefined,
        },
        csvText,
        groupNameTemplate: "{Senior Manager} VRM",
        syncMode: "add-only",
      },
      { createClient },
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: "Enterprise access token is required for Stack API v3 calls.",
    });
    expect(createClient).not.toHaveBeenCalled();
  });

  it("rejects blank access tokens before creating an API client", async () => {
    const createClient = vi.fn();

    const response = await handleUserGroupSyncRequest(
      {
        action: "preview",
        credentials: { ...credentials, accessToken: "   " },
        csvText,
        groupNameTemplate: "{Senior Manager} VRM",
        syncMode: "add-only",
      },
      { createClient },
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: "Enterprise access token is required for Stack API v3 calls.",
    });
    expect(createClient).not.toHaveBeenCalled();
  });

  it("rejects Enterprise PAT credentials for user group sync", async () => {
    const client = createClient({
      getUserByEmail: vi.fn().mockResolvedValue({ id: 1, email: "grace@example.com", name: "Grace Hopper" }),
      getUserGroups: vi.fn().mockResolvedValue([]),
    });
    const createClientDependency = vi.fn(() => client);
    const requestCredentials: SessionCredentials = {
      instanceType: "enterprise",
      baseUrl: "https://demo.stackenterprise.co",
      pat: "pat-token",
      authSource: "manual-pat",
    };

    const response = await handleUserGroupSyncRequest(
      {
        action: "preview",
        credentials: requestCredentials,
        csvText,
        groupNameTemplate: "{Senior Manager} VRM",
        syncMode: "add-only",
      },
      { createClient: createClientDependency },
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: "Enterprise access token is required for Stack API v3 calls.",
    });
    expect(createClientDependency).not.toHaveBeenCalled();
  });

  it("rejects OAuth tokens that do not include write_access", async () => {
    const createClientDependency = vi.fn();

    const response = await handleUserGroupSyncRequest(
      {
        action: "preview",
        credentials: {
          ...credentials,
          oauthScopes: ["no_expiry"],
        },
        csvText,
        groupNameTemplate: "{Senior Manager} VRM",
        syncMode: "add-only",
      },
      { createClient: createClientDependency },
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: "Enterprise OAuth token is missing required scope: write_access.",
    });
    expect(createClientDependency).not.toHaveBeenCalled();
  });

  it("rejects expired OAuth tokens before creating an API client", async () => {
    const createClientDependency = vi.fn();

    const response = await handleUserGroupSyncRequest(
      {
        action: "preview",
        credentials: {
          ...credentials,
          accessTokenExpiresAt: "2000-01-01T00:00:00.000Z",
        },
        csvText,
        groupNameTemplate: "{Senior Manager} VRM",
        syncMode: "add-only",
      },
      { createClient: createClientDependency },
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: "Enterprise OAuth token has expired. Reconnect with Enterprise OAuth.",
    });
    expect(createClientDependency).not.toHaveBeenCalled();
  });

  it("trims OAuth access tokens before creating the client without a PAT fallback", async () => {
    const client = createClient({
      getUserByEmail: vi.fn().mockResolvedValue({ id: 1, email: "grace@example.com", name: "Grace Hopper" }),
      getUserGroups: vi.fn().mockResolvedValue([]),
    });
    const createClientDependency = vi.fn((_credentials: SessionCredentials) => client);
    const requestCredentials: SessionCredentials = {
      ...credentials,
      accessToken: "  oauth-token  ",
      pat: "   ",
    };

    const response = await handleUserGroupSyncRequest(
      {
        action: "preview",
        credentials: requestCredentials,
        csvText,
        groupNameTemplate: "{Senior Manager} VRM",
        syncMode: "add-only",
      },
      { createClient: createClientDependency },
    );

    expect(response.status).toBe(200);
    const [normalizedCredentials] = createClientDependency.mock.calls[0];
    const { pat: _pat, ...expectedCredentials } = requestCredentials;
    expect(normalizedCredentials).toEqual({
      ...expectedCredentials,
      accessToken: "oauth-token",
    });
    expect(normalizedCredentials).not.toHaveProperty("pat");
  });

  it("uses the OAuth token for the default Stack API v3 client when PAT is also submitted", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: 1, email: "grace@example.com", name: "Grace Hopper" }), {
          status: 200,
        }),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ items: [], totalPages: 1 }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    try {
      const response = await handleUserGroupSyncRequest({
        action: "preview",
        credentials: {
          ...credentials,
          accessToken: "oauth-token",
          pat: "pat-token",
        },
        csvText,
        groupNameTemplate: "{Senior Manager} VRM",
        syncMode: "add-only",
      });

      expect(response.status).toBe(200);
      expect(fetchMock).toHaveBeenCalledTimes(2);
      for (const [, init] of fetchMock.mock.calls) {
        expect(init?.headers).toEqual(
          expect.objectContaining({
            Authorization: "Bearer oauth-token",
          }),
        );
        expect(init?.headers).not.toEqual(
          expect.objectContaining({
            Authorization: "Bearer pat-token",
          }),
        );
      }
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("returns client failures that look like parser errors as 500 responses", async () => {
    const parserLikeError =
      "User export CSV is missing required column(s): Director, User Group Member";
    const client = createClient({
      getUserByEmail: vi.fn().mockResolvedValue({ id: 1, email: "grace@example.com", name: "Grace Hopper" }),
      getUserGroups: vi.fn().mockRejectedValue(new Error(parserLikeError)),
    });

    const response = await handleUserGroupSyncRequest(
      {
        action: "preview",
        credentials,
        csvText,
        groupNameTemplate: "{Senior Manager} VRM",
        syncMode: "add-only",
      },
      { createClient: () => client },
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: parserLikeError,
    });
  });

  it("returns runner errors as 500 responses", async () => {
    const client = createClient({
      getUserByEmail: vi.fn().mockResolvedValue({ id: 1, email: "grace@example.com", name: "Grace Hopper" }),
      getUserGroups: vi.fn().mockRejectedValue(new Error("Stack group load failed")),
    });

    const response = await handleUserGroupSyncRequest(
      {
        action: "preview",
        credentials,
        csvText,
        groupNameTemplate: "{Senior Manager} VRM",
        syncMode: "add-only",
      },
      { createClient: () => client },
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: "Stack group load failed",
    });
  });

  it("redacts submitted credentials from top-level errors", async () => {
    const accessToken = "se_access_1234567890abcdef1234567890abcdef";
    const pat = "se_pat_abcdef1234567890abcdef1234567890";
    const requestCredentials: SessionCredentials = {
      ...credentials,
      accessToken: ` ${accessToken} `,
      pat: `  ${pat}  `,
    };
    const client = createClient({
      getUserByEmail: vi.fn().mockResolvedValue({ id: 1, email: "grace@example.com", name: "Grace Hopper" }),
      getUserGroups: vi
        .fn()
        .mockRejectedValue(new Error(`Group load failed for ${requestCredentials.accessToken} and ${pat}`)),
    });

    const response = await handleUserGroupSyncRequest(
      {
        action: "preview",
        credentials: requestCredentials,
        csvText,
        groupNameTemplate: "{Senior Manager} VRM",
        syncMode: "add-only",
      },
      { createClient: () => client },
    );

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body).toEqual({
      ok: false,
      error: expect.stringContaining("[redacted]"),
    });
    expect(body.error).not.toContain(accessToken);
    expect(body.error).not.toContain(requestCredentials.accessToken);
    expect(body.error).not.toContain(pat);
    expect(body.error).not.toContain(requestCredentials.pat);
  });
});

function createClient(overrides: Partial<UserGroupSyncClient> = {}): UserGroupSyncClient {
  return {
    getUserByEmail: vi.fn(),
    getUserGroups: vi.fn(),
    createUserGroup: vi.fn(),
    addUserGroupMembers: vi.fn(),
    removeUserGroupMember: vi.fn(),
    ...overrides,
  };
}

const userExportHeader = csvText.split("\n")[0];

function manualCredentials(accessToken: string): SessionCredentials {
  return {
    instanceType: "enterprise",
    baseUrl: "https://demo.stackenterprise.co",
    accessToken,
    authSource: "manual-enterprise-token",
  };
}

function expectedPreviewForGroup(groupName: string, syncMode: "add-only" | "exact-sync") {
  return {
    syncMode,
    groupNameTemplate: groupName,
    blockingErrors: [],
    skippedRows: [],
    groups: [
      {
        manager: "Ada Lovelace",
        groupName,
        existingGroupId: null,
        createGroup: true,
        desiredUserIds: [1],
        addUserIds: [1],
        removeUserIds: [],
      },
    ],
  };
}

function userExportRow(
  overrides: { seniorManager?: string; email?: string; firstName?: string; lastName?: string } = {},
): string {
  return [
    "Pat Director",
    overrides.seniorManager ?? "Ada Lovelace",
    `${overrides.firstName ?? "Grace"} ${overrides.lastName ?? "Hopper"}`,
    overrides.firstName ?? "Grace",
    overrides.lastName ?? "Hopper",
    "1001",
    overrides.email ?? "grace@example.com",
    "Engineer",
  ].join(",");
}
