import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { UserGroupSyncPanel } from "./UserGroupSyncPanel";

afterEach(() => {
  vi.restoreAllMocks();
});

const credentials = {
  instanceType: "enterprise" as const,
  baseUrl: "https://demo.stackenterprise.co",
  accessToken: "oauth-token",
  authSource: "oauth-pkce" as const,
  oauthScopes: ["write_access"],
  accessTokenExpiresAt: "2026-07-05T12:00:00.000Z",
};

const csv = [
  "Director,Senior Manager,User Group Member,First Name,Last Name,Colleague ID,Email,Job Title",
  "Pat Director,Ada Lovelace,Grace Hopper,Grace,Hopper,1001,grace@example.com,Engineer",
].join("\n");

const addOnlyPreviewBody = {
  ok: true,
  result: {
    syncMode: "add-only",
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
  },
};

const exactSyncPreviewBody = {
  ok: true,
  result: {
    syncMode: "exact-sync",
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
        removeUserIds: [99],
      },
    ],
  },
};

describe("UserGroupSyncPanel", () => {
  it("prompts for Enterprise OAuth credentials when missing", () => {
    render(<UserGroupSyncPanel credentials={null} />);

    expect(screen.getByText("Connect with Enterprise OAuth before using User Group Sync.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Preview changes" })).toBeDisabled();
  });

  it("uploads a CSV and previews add-only changes", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse(addOnlyPreviewBody));

    render(<UserGroupSyncPanel credentials={credentials} />);

    expect(screen.getByRole("region", { name: "User Group Sync" })).toHaveClass("workspace-panel");

    await user.upload(
      screen.getByLabelText("Upload user export CSV"),
      new File([csv], "users.csv", { type: "text/csv" }),
    );
    await user.click(screen.getByRole("button", { name: "Preview changes" }));

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/write-tools/user-group-sync",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          action: "preview",
          credentials,
          csvText: csv,
          groupNameTemplate: "{Senior Manager} VRM",
          syncMode: "add-only",
        }),
      }),
    );
    expect(await screen.findByText("Ada Lovelace VRM")).toBeInTheDocument();
    expect(screen.getByText("Add-only")).toBeInTheDocument();
    expect(screen.queryByText("Members to remove")).not.toBeInTheDocument();
  });

  it("shows exact-sync removals and asks for browser confirmation before apply", async () => {
    const user = userEvent.setup();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse(exactSyncPreviewBody))
      .mockResolvedValueOnce(
        jsonResponse({
          ok: true,
          result: {
            preview: {
              groups: [],
              skippedRows: [],
              blockingErrors: [],
              syncMode: "exact-sync",
              groupNameTemplate: "{Senior Manager} VRM",
            },
            operations: [
              {
                kind: "remove-member",
                groupName: "Ada Lovelace VRM",
                userIds: [99],
                status: "succeeded",
              },
            ],
          },
        }),
      );

    render(<UserGroupSyncPanel credentials={credentials} />);

    await user.upload(
      screen.getByLabelText("Upload user export CSV"),
      new File([csv], "users.csv", { type: "text/csv" }),
    );
    await user.click(screen.getByLabelText("Exact sync"));
    await user.click(screen.getByRole("button", { name: "Preview changes" }));
    expect(await screen.findByText("Members to remove")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Apply changes" }));

    expect(window.confirm).toHaveBeenCalledWith(
      "Exact sync can remove users from generated VRM groups. Apply these changes?",
    );
    expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body))).toEqual(
      expect.objectContaining({
        action: "apply",
        syncMode: "exact-sync",
        expectedPreview: exactSyncPreviewBody.result,
      }),
    );
    expect(await screen.findByText("remove-member succeeded for Ada Lovelace VRM: 99")).toBeInTheDocument();
  });

  it("does not send duplicate apply requests while apply is pending", async () => {
    const user = userEvent.setup();
    const pendingApply = deferred<Response>();
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse(addOnlyPreviewBody))
      .mockReturnValueOnce(pendingApply.promise);

    render(<UserGroupSyncPanel credentials={credentials} />);

    await user.upload(
      screen.getByLabelText("Upload user export CSV"),
      new File([csv], "users.csv", { type: "text/csv" }),
    );
    await user.click(screen.getByRole("button", { name: "Preview changes" }));
    expect(await screen.findByText("Ada Lovelace VRM")).toBeInTheDocument();

    const applyButton = screen.getByRole("button", { name: "Apply changes" });
    act(() => {
      applyButton.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      applyButton.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });

    expect(fetchActions(fetchMock).filter((action) => action === "apply")).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Preview changes" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Apply changes" })).toBeDisabled();

    pendingApply.resolve(
      jsonResponse({
        ok: true,
        result: {
          preview: {
            groups: [],
            skippedRows: [],
            blockingErrors: [],
            syncMode: "add-only",
            groupNameTemplate: "{Senior Manager} VRM",
          },
          operations: [
            {
              kind: "create-group",
              groupName: "Ada Lovelace VRM",
              userIds: [1],
              status: "succeeded",
            },
          ],
        },
      }),
    );
    expect(await screen.findByText("create-group succeeded for Ada Lovelace VRM: 1")).toBeInTheDocument();
  });

  it("ignores a pending apply success response when inputs change before it resolves", async () => {
    const user = userEvent.setup();
    const pendingApply = deferred<Response>();
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse(addOnlyPreviewBody))
      .mockReturnValueOnce(pendingApply.promise);

    render(<UserGroupSyncPanel credentials={credentials} />);

    await user.upload(
      screen.getByLabelText("Upload user export CSV"),
      new File([csv], "users.csv", { type: "text/csv" }),
    );
    await user.click(screen.getByRole("button", { name: "Preview changes" }));
    expect(await screen.findByText("Ada Lovelace VRM")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Apply changes" }));
    await user.clear(screen.getByLabelText("Group name template"));
    await user.type(screen.getByLabelText("Group name template"), "Owners");

    pendingApply.resolve(
      jsonResponse({
        ok: true,
        result: {
          preview: {
            groups: [],
            skippedRows: [],
            blockingErrors: [],
            syncMode: "add-only",
            groupNameTemplate: "{Senior Manager} VRM",
          },
          operations: [
            {
              kind: "create-group",
              groupName: "Ada Lovelace VRM",
              userIds: [1],
              status: "succeeded",
            },
          ],
        },
      }),
    );

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Preview changes" })).toBeEnabled();
    });
    expect(fetchActions(fetchMock)).toEqual(["preview", "apply"]);
    expect(screen.queryByText("Apply completed.")).not.toBeInTheDocument();
    expect(screen.queryByText("create-group succeeded for Ada Lovelace VRM: 1")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Apply changes" })).toBeDisabled();
  });

  it("ignores a pending apply error response when inputs change before it resolves", async () => {
    const user = userEvent.setup();
    const pendingApply = deferred<Response>();
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse(addOnlyPreviewBody))
      .mockReturnValueOnce(pendingApply.promise);

    render(<UserGroupSyncPanel credentials={credentials} />);

    await user.upload(
      screen.getByLabelText("Upload user export CSV"),
      new File([csv], "users.csv", { type: "text/csv" }),
    );
    await user.click(screen.getByRole("button", { name: "Preview changes" }));
    expect(await screen.findByText("Ada Lovelace VRM")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Apply changes" }));
    await user.clear(screen.getByLabelText("Group name template"));
    await user.type(screen.getByLabelText("Group name template"), "Owners");

    pendingApply.resolve(jsonResponse({ ok: false, error: "Apply failed" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Preview changes" })).toBeEnabled();
    });
    expect(fetchActions(fetchMock)).toEqual(["preview", "apply"]);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByText("Apply failed")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Apply changes" })).toBeDisabled();
  });

  it("ignores a pending preview response when inputs change before it resolves", async () => {
    const user = userEvent.setup();
    const pendingPreview = deferred<Response>();
    const fetchMock = vi.spyOn(globalThis, "fetch").mockReturnValueOnce(pendingPreview.promise);

    render(<UserGroupSyncPanel credentials={credentials} />);

    await user.upload(
      screen.getByLabelText("Upload user export CSV"),
      new File([csv], "users.csv", { type: "text/csv" }),
    );
    await user.click(screen.getByRole("button", { name: "Preview changes" }));
    await user.clear(screen.getByLabelText("Group name template"));
    await user.type(screen.getByLabelText("Group name template"), "Owners");

    pendingPreview.resolve(jsonResponse(addOnlyPreviewBody));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Preview changes" })).toBeEnabled();
    });
    expect(fetchActions(fetchMock)).toEqual(["preview"]);
    expect(screen.queryByText("Ada Lovelace VRM")).not.toBeInTheDocument();
    expect(screen.queryByText("Preview ready.")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Apply changes" })).toBeDisabled();
  });

  it("ignores a pending preview error response when inputs change before it resolves", async () => {
    const user = userEvent.setup();
    const pendingPreview = deferred<Response>();
    const fetchMock = vi.spyOn(globalThis, "fetch").mockReturnValueOnce(pendingPreview.promise);

    render(<UserGroupSyncPanel credentials={credentials} />);

    await user.upload(
      screen.getByLabelText("Upload user export CSV"),
      new File([csv], "users.csv", { type: "text/csv" }),
    );
    await user.click(screen.getByRole("button", { name: "Preview changes" }));
    await user.clear(screen.getByLabelText("Group name template"));
    await user.type(screen.getByLabelText("Group name template"), "Owners");

    pendingPreview.resolve(jsonResponse({ ok: false, error: "Preview failed" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Preview changes" })).toBeEnabled();
    });
    expect(fetchActions(fetchMock)).toEqual(["preview"]);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByText("Preview failed")).not.toBeInTheDocument();
  });

  it("ignores a pending rejected preview request when inputs change before it rejects", async () => {
    const user = userEvent.setup();
    const pendingPreview = deferred<Response>();
    const fetchMock = vi.spyOn(globalThis, "fetch").mockReturnValueOnce(pendingPreview.promise);

    render(<UserGroupSyncPanel credentials={credentials} />);

    await user.upload(
      screen.getByLabelText("Upload user export CSV"),
      new File([csv], "users.csv", { type: "text/csv" }),
    );
    await user.click(screen.getByRole("button", { name: "Preview changes" }));
    await user.clear(screen.getByLabelText("Group name template"));
    await user.type(screen.getByLabelText("Group name template"), "Owners");

    pendingPreview.reject(new Error("Network failed"));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Preview changes" })).toBeEnabled();
    });
    expect(fetchActions(fetchMock)).toEqual(["preview"]);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByText("Network failed")).not.toBeInTheDocument();
  });

  it("clears stale apply summaries when a later apply is pending and then fails", async () => {
    const user = userEvent.setup();
    const pendingFailedApply = deferred<Response>();
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse(addOnlyPreviewBody))
      .mockResolvedValueOnce(
        jsonResponse({
          ok: true,
          result: {
            preview: {
              groups: [],
              skippedRows: [],
              blockingErrors: [],
              syncMode: "add-only",
              groupNameTemplate: "{Senior Manager} VRM",
            },
            operations: [
              {
                kind: "create-group",
                groupName: "Ada Lovelace VRM",
                userIds: [1],
                status: "succeeded",
              },
            ],
          },
        }),
      )
      .mockReturnValueOnce(pendingFailedApply.promise);

    render(<UserGroupSyncPanel credentials={credentials} />);

    await user.upload(
      screen.getByLabelText("Upload user export CSV"),
      new File([csv], "users.csv", { type: "text/csv" }),
    );
    await user.click(screen.getByRole("button", { name: "Preview changes" }));
    expect(await screen.findByText("Ada Lovelace VRM")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Apply changes" }));
    expect(await screen.findByText("create-group succeeded for Ada Lovelace VRM: 1")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Apply changes" }));
    expect(screen.queryByText("create-group succeeded for Ada Lovelace VRM: 1")).not.toBeInTheDocument();

    pendingFailedApply.resolve(jsonResponse({ ok: false, error: "Apply failed" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Apply failed");
    expect(screen.queryByText("create-group succeeded for Ada Lovelace VRM: 1")).not.toBeInTheDocument();
    expect(fetchActions(fetchMock).filter((action) => action === "apply")).toHaveLength(2);
  });

  it("does not apply exact-sync changes when browser confirmation is cancelled", async () => {
    const user = userEvent.setup();
    vi.spyOn(window, "confirm").mockReturnValue(false);
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(jsonResponse(exactSyncPreviewBody));

    render(<UserGroupSyncPanel credentials={credentials} />);

    await user.upload(
      screen.getByLabelText("Upload user export CSV"),
      new File([csv], "users.csv", { type: "text/csv" }),
    );
    await user.click(screen.getByLabelText("Exact sync"));
    await user.click(screen.getByRole("button", { name: "Preview changes" }));
    expect(await screen.findByText("Members to remove")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Apply changes" }));

    expect(window.confirm).toHaveBeenCalledWith(
      "Exact sync can remove users from generated VRM groups. Apply these changes?",
    );
    expect(fetchActions(fetchMock)).toEqual(["preview"]);
  });

  it("clears stale preview state when a new CSV file cannot be read", async () => {
    const user = userEvent.setup();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse(addOnlyPreviewBody));

    render(<UserGroupSyncPanel credentials={credentials} />);

    await user.upload(
      screen.getByLabelText("Upload user export CSV"),
      new File([csv], "users.csv", { type: "text/csv" }),
    );
    await user.click(screen.getByRole("button", { name: "Preview changes" }));
    expect(await screen.findByText("Ada Lovelace VRM")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Apply changes" })).toBeEnabled();

    const unreadableFile = new File([""], "bad.csv", { type: "text/csv" });
    Object.defineProperty(unreadableFile, "text", {
      value: vi.fn().mockRejectedValue(new Error("Cannot read bad.csv")),
    });
    await user.upload(screen.getByLabelText("Upload user export CSV"), unreadableFile);

    expect(await screen.findByRole("alert")).toHaveTextContent("Cannot read bad.csv");
    expect(screen.getByRole("button", { name: "Preview changes" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Apply changes" })).toBeDisabled();
    expect(screen.queryByText("Ada Lovelace VRM")).not.toBeInTheDocument();
  });

  it("keeps the latest selected CSV when an earlier file read resolves later", async () => {
    const user = userEvent.setup();
    const firstRead = deferred<string>();
    const secondRead = deferred<string>();
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse(addOnlyPreviewBody));
    const newerCsv = [
      "Director,Senior Manager,User Group Member,First Name,Last Name,Colleague ID,Email,Job Title",
      "Pat Director,Ada Lovelace,Linus Torvalds,Linus,Torvalds,1002,linus@example.com,Engineer",
    ].join("\n");
    const firstFile = new File([""], "old.csv", { type: "text/csv" });
    const secondFile = new File([""], "new.csv", { type: "text/csv" });
    Object.defineProperty(firstFile, "text", {
      value: vi.fn().mockReturnValue(firstRead.promise),
    });
    Object.defineProperty(secondFile, "text", {
      value: vi.fn().mockReturnValue(secondRead.promise),
    });

    render(<UserGroupSyncPanel credentials={credentials} />);

    const input = screen.getByLabelText("Upload user export CSV");
    await user.upload(input, firstFile);
    await user.upload(input, secondFile);

    await act(async () => {
      secondRead.resolve(newerCsv);
      await secondRead.promise;
    });
    expect(await screen.findByText("Loaded file: new.csv")).toBeInTheDocument();

    await act(async () => {
      firstRead.resolve(csv);
      await firstRead.promise;
    });

    expect(screen.getByText("Loaded file: new.csv")).toBeInTheDocument();
    expect(screen.queryByText("Loaded file: old.csv")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Preview changes" }));

    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual(
      expect.objectContaining({
        action: "preview",
        csvText: newerCsv,
      }),
    );
  });

  it("disables apply when preview has blocking errors", async () => {
    const user = userEvent.setup();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
          result: {
            syncMode: "add-only",
            groupNameTemplate: "VRM",
            blockingErrors: [
              'Group name "VRM" is produced by multiple Senior Manager values: Ada Lovelace, Alan Turing.',
            ],
            skippedRows: [],
            groups: [],
          },
        }),
        { status: 200 },
      ),
    );

    render(<UserGroupSyncPanel credentials={credentials} />);

    await user.upload(
      screen.getByLabelText("Upload user export CSV"),
      new File([csv], "users.csv", { type: "text/csv" }),
    );
    await user.clear(screen.getByLabelText("Group name template"));
    await user.type(screen.getByLabelText("Group name template"), "VRM");
    await user.click(screen.getByRole("button", { name: "Preview changes" }));

    const alert = await screen.findByRole("alert");
    expect(within(alert).getByText(/multiple Senior Manager values/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Apply changes" })).toBeDisabled();
  });

  it("warns when credentials are missing and keeps preview disabled after CSV upload", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.spyOn(globalThis, "fetch");

    render(<UserGroupSyncPanel credentials={null} />);

    expect(screen.getByRole("status")).toHaveTextContent(
      "Connect with Enterprise OAuth before using User Group Sync.",
    );

    await user.upload(
      screen.getByLabelText("Upload user export CSV"),
      new File([csv], "users.csv", { type: "text/csv" }),
    );

    expect(screen.getByRole("button", { name: "Preview changes" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Apply changes" })).toBeDisabled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200 });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });

  return { promise, resolve, reject };
}

function fetchActions(fetchMock: { mock: { calls: Parameters<typeof fetch>[] } }) {
  return fetchMock.mock.calls.map((call) => {
    const body = call[1]?.body;
    return JSON.parse(String(body)).action as string;
  });
}
