import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../App";
import { tagMetricsCsv } from "../test/fixtures/reportFixtures";
import {
  clearPersistedDatasetSession,
  loadPersistedDatasetSession,
  savePersistedDatasetSession,
} from "../utils/browserDatasetStorage";

vi.mock("../utils/browserDatasetStorage", () => ({
  clearPersistedDatasetSession: vi.fn(),
  loadPersistedDatasetSession: vi.fn(),
  savePersistedDatasetSession: vi.fn(),
}));

const loadPersistedDatasetSessionMock = vi.mocked(loadPersistedDatasetSession);
const savePersistedDatasetSessionMock = vi.mocked(savePersistedDatasetSession);
const clearPersistedDatasetSessionMock = vi.mocked(clearPersistedDatasetSession);

const basicBusinessPatCredentials = {
  instanceType: "basic-business",
  baseUrl: "https://stackoverflowteams.com/c/example-team",
  pat: "pat-token",
  authSource: "manual-pat",
} as const;

beforeEach(() => {
  loadPersistedDatasetSessionMock.mockResolvedValue(null);
  savePersistedDatasetSessionMock.mockResolvedValue(undefined);
  clearPersistedDatasetSessionMock.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe("AppShell", () => {
  it("renders report catalog and all MVP reports", async () => {
    render(<App />);

    expect(screen.getByRole("heading", { name: "Stack API Utilities" })).toBeInTheDocument();
    expect(screen.getByText(/mostly untested and is not ready for production instances/i)).toBeInTheDocument();
    expect(screen.getByText(/reach out to Moises on Slack/i)).toBeInTheDocument();
    expect(screen.getByText("No credentials")).toBeInTheDocument();
    expect(screen.getByText("0 datasets")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Tag Report" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Data Export" })).toBeInTheDocument();
    await waitFor(() => expect(clearPersistedDatasetSessionMock).toHaveBeenCalled());
  });

  it("hydrates persisted browser datasets without credentials", async () => {
    const user = userEvent.setup();
    loadPersistedDatasetSessionMock.mockResolvedValueOnce({
      version: 1,
      selectedReportId: "inactive-users",
      selectedReportIds: ["inactive-users"],
      datasets: {
        "dataset-1": {
          id: "dataset-1",
          snapshotId: "snapshot-1",
          reportId: "inactive-users",
          name: "users",
          records: [{ user_id: 1, display_name: "Ada" }],
          loadedAt: "2026-07-09T12:00:00.000Z",
          source: "live-api",
          periodRole: "current",
          scope: { startDate: "2026-06-01", endDate: "2026-06-30" },
        },
      },
      reportOutputs: {
        "inactive-users": {
          reportId: "inactive-users",
          datasetName: "users",
          fileName: "Live API run",
          records: [{ datasetName: "users", user_id: 1, display_name: "Ada" }],
          loadedAt: "2026-07-09T12:00:00.000Z",
          source: "live-api",
          currentScope: { startDate: "2026-06-01", endDate: "2026-06-30" },
          currentSnapshotId: "snapshot-1",
        },
      },
      reportRunSnapshots: [
        {
          id: "snapshot-1",
          reportId: "inactive-users",
          periodRole: "current",
          scope: { startDate: "2026-06-01", endDate: "2026-06-30" },
          pageSize: 100,
          maxPagesPerDataset: 5,
          loadedAt: "2026-07-09T12:00:00.000Z",
          datasetIds: ["dataset-1"],
          warnings: [],
        },
      ],
      warnings: [],
    });

    render(<App />);

    expect(await screen.findByText("1 dataset")).toBeInTheDocument();
    expect(screen.getByText("No credentials")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Datasets" }));

    const datasetsPanel = screen.getByRole("region", { name: "Datasets" });
    expect(within(datasetsPanel).getByText("Inactive Users")).toBeInTheDocument();
    expect(within(datasetsPanel).getByText("2026-06-01 to 2026-06-30")).toBeInTheDocument();
    expect(within(datasetsPanel).getByRole("button", { name: "Flush stored datasets" })).toBeInTheDocument();
  });

  it("persists live API datasets without credentials or run queue state", async () => {
    const user = userEvent.setup();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({
        ok: true,
        result: {
          reportId: "inactive-users",
          reportTitle: "Inactive Users",
          periodRole: "current",
          scope: {},
          pageSize: 100,
          maxPagesPerDataset: 5,
          warnings: [],
          datasets: [
            {
              datasetName: "users",
              records: [{ user_id: 1, display_name: "Ada" }],
            },
          ],
          messages: ["Collected users (1 record) for Inactive Users."],
        },
      }), {
        status: 200,
      }),
    );

    render(<App />);

    await user.click(screen.getByRole("button", { name: "Inactive Users" }));
    await user.click(screen.getByRole("button", { name: "Credentials" }));
    await user.type(screen.getByLabelText("Instance URL"), "https://stackoverflowteams.com/c/example-team");
    await user.type(screen.getByLabelText("Personal access token"), "pat-token");
    await user.click(screen.getByRole("button", { name: "Save session credentials" }));
    await user.click(screen.getByRole("button", { name: "Reports" }));
    await user.click(screen.getByRole("button", { name: "Run current period" }));

    expect(await screen.findByText("Live API run completed for Inactive Users.")).toBeInTheDocument();
    await waitFor(() => expect(savePersistedDatasetSessionMock).toHaveBeenCalled());

    const saveCalls = savePersistedDatasetSessionMock.mock.calls;
    const savedSnapshot = saveCalls[saveCalls.length - 1]?.[0] as unknown as Record<string, unknown>;
    expect(savedSnapshot).toMatchObject({
      version: 1,
      selectedReportId: "inactive-users",
      selectedReportIds: ["inactive-users"],
    });
    expect(savedSnapshot).not.toHaveProperty("credentials");
    expect(savedSnapshot).not.toHaveProperty("runQueue");
  });

  it("flushes current and persisted datasets in bulk", async () => {
    const user = userEvent.setup();
    loadPersistedDatasetSessionMock.mockResolvedValueOnce({
      version: 1,
      selectedReportId: "inactive-users",
      selectedReportIds: ["inactive-users"],
      datasets: {
        "dataset-1": {
          id: "dataset-1",
          snapshotId: "snapshot-1",
          reportId: "inactive-users",
          name: "users",
          records: [{ user_id: 1, display_name: "Ada" }],
          loadedAt: "2026-07-09T12:00:00.000Z",
          source: "live-api",
          periodRole: "current",
          scope: { startDate: "2026-06-01", endDate: "2026-06-30" },
        },
      },
      reportOutputs: {
        "inactive-users": {
          reportId: "inactive-users",
          datasetName: "users",
          fileName: "Live API run",
          records: [{ datasetName: "users", user_id: 1, display_name: "Ada" }],
          loadedAt: "2026-07-09T12:00:00.000Z",
          source: "live-api",
          currentScope: { startDate: "2026-06-01", endDate: "2026-06-30" },
          currentSnapshotId: "snapshot-1",
        },
      },
      reportRunSnapshots: [
        {
          id: "snapshot-1",
          reportId: "inactive-users",
          periodRole: "current",
          scope: { startDate: "2026-06-01", endDate: "2026-06-30" },
          pageSize: 100,
          maxPagesPerDataset: 5,
          loadedAt: "2026-07-09T12:00:00.000Z",
          datasetIds: ["dataset-1"],
          warnings: [],
        },
      ],
      warnings: [],
    });

    render(<App />);

    expect(await screen.findByText("1 dataset")).toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: "Raw Table" }));
    expect(screen.getByText("Ada")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Datasets" }));
    await user.click(screen.getByRole("button", { name: "Flush stored datasets" }));

    expect(screen.getByText("0 datasets")).toBeInTheDocument();
    expect(screen.getByText("No datasets loaded or stored in this browser.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Reports" }));
    await user.click(screen.getByRole("tab", { name: "Raw Table" }));
    expect(screen.queryByText("Ada")).not.toBeInTheDocument();
    await waitFor(() => expect(clearPersistedDatasetSessionMock).toHaveBeenCalled());
  });

  it("clears storage after an in-flight dataset save settles when flushing", async () => {
    const user = userEvent.setup();
    const saveDeferred = createDeferred<void>();
    const operations: string[] = [];

    clearPersistedDatasetSessionMock.mockImplementation(() => {
      operations.push("clear");
      return Promise.resolve();
    });

    render(<App />);

    await waitFor(() => expect(clearPersistedDatasetSessionMock).toHaveBeenCalled());
    operations.length = 0;
    clearPersistedDatasetSessionMock.mockClear();
    savePersistedDatasetSessionMock.mockImplementationOnce(() => {
      operations.push("save:start");
      return saveDeferred.promise.then(() => {
        operations.push("save:resolved");
      });
    });

    await user.click(screen.getByRole("button", { name: "Uploads" }));
    await user.upload(
      screen.getByLabelText("Upload report outputs"),
      new File([tagMetricsCsv], "tag_metrics.csv", { type: "text/csv" }),
    );

    expect(await screen.findByText("Imported tag_metrics.csv for Tag Report.")).toBeInTheDocument();
    await waitFor(() => expect(savePersistedDatasetSessionMock).toHaveBeenCalled());

    await user.click(screen.getByRole("button", { name: "Datasets" }));
    await user.click(screen.getByRole("button", { name: "Flush stored datasets" }));

    expect(clearPersistedDatasetSessionMock).not.toHaveBeenCalled();

    await act(async () => {
      saveDeferred.resolve();
      await saveDeferred.promise;
    });

    await waitFor(() => expect(clearPersistedDatasetSessionMock).toHaveBeenCalledTimes(1));
    expect(operations).toEqual(["save:start", "save:resolved", "clear"]);
  });

  it("keeps newer imported data when slow browser hydration resolves later", async () => {
    const user = userEvent.setup();
    const loadDeferred = createDeferred<Awaited<ReturnType<typeof loadPersistedDatasetSession>>>();
    loadPersistedDatasetSessionMock.mockReturnValueOnce(loadDeferred.promise);

    render(<App />);

    await user.click(screen.getByRole("button", { name: "Uploads" }));
    await user.upload(
      screen.getByLabelText("Upload report outputs"),
      new File([tagMetricsCsv], "tag_metrics.csv", { type: "text/csv" }),
    );

    expect(await screen.findByText("Imported tag_metrics.csv for Tag Report.")).toBeInTheDocument();
    expect(screen.getByText("Page Views")).toBeInTheDocument();
    expect(screen.getByText("889,996")).toBeInTheDocument();

    await act(async () => {
      loadDeferred.resolve({
        version: 1,
        selectedReportId: "inactive-users",
        selectedReportIds: ["inactive-users"],
        datasets: {
          "stale-dataset": {
            id: "stale-dataset",
            snapshotId: "stale-snapshot",
            reportId: "inactive-users",
            name: "users",
            records: [{ user_id: 2, display_name: "Stale User" }],
            loadedAt: "2026-07-09T12:00:00.000Z",
            source: "live-api",
            periodRole: "current",
          },
        },
        reportOutputs: {
          "inactive-users": {
            reportId: "inactive-users",
            datasetName: "users",
            fileName: "Stale API run",
            records: [{ datasetName: "users", user_id: 2, display_name: "Stale User" }],
            loadedAt: "2026-07-09T12:00:00.000Z",
            source: "live-api",
            currentSnapshotId: "stale-snapshot",
          },
        },
        reportRunSnapshots: [
          {
            id: "stale-snapshot",
            reportId: "inactive-users",
            periodRole: "current",
            scope: {},
            pageSize: 100,
            maxPagesPerDataset: 5,
            loadedAt: "2026-07-09T12:00:00.000Z",
            datasetIds: ["stale-dataset"],
            warnings: [],
          },
        ],
        warnings: [],
      });
      await loadDeferred.promise;
      await Promise.resolve();
    });

    expect(screen.getByText("Page Views")).toBeInTheDocument();
    expect(screen.getByText("889,996")).toBeInTheDocument();
    expect(screen.queryByText("Stale User")).not.toBeInTheDocument();
  });

  it("clears stored datasets when an explicit flush happens before slow hydration resolves", async () => {
    const user = userEvent.setup();
    const loadDeferred = createDeferred<Awaited<ReturnType<typeof loadPersistedDatasetSession>>>();
    loadPersistedDatasetSessionMock.mockReturnValueOnce(loadDeferred.promise);

    render(<App />);

    await user.click(screen.getByRole("button", { name: "Uploads" }));
    await user.upload(
      screen.getByLabelText("Upload report outputs"),
      new File([tagMetricsCsv], "tag_metrics.csv", { type: "text/csv" }),
    );

    expect(await screen.findByText("Imported tag_metrics.csv for Tag Report.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Datasets" }));
    await user.click(screen.getByRole("button", { name: "Flush stored datasets" }));

    expect(screen.getByText("0 datasets")).toBeInTheDocument();

    await act(async () => {
      loadDeferred.resolve({
        version: 1,
        selectedReportId: "inactive-users",
        selectedReportIds: ["inactive-users"],
        datasets: {
          "stale-dataset": {
            id: "stale-dataset",
            snapshotId: "stale-snapshot",
            reportId: "inactive-users",
            name: "users",
            records: [{ user_id: 2, display_name: "Stale User" }],
            loadedAt: "2026-07-09T12:00:00.000Z",
            source: "live-api",
            periodRole: "current",
          },
        },
        reportOutputs: {
          "inactive-users": {
            reportId: "inactive-users",
            datasetName: "users",
            fileName: "Stale API run",
            records: [{ datasetName: "users", user_id: 2, display_name: "Stale User" }],
            loadedAt: "2026-07-09T12:00:00.000Z",
            source: "live-api",
            currentSnapshotId: "stale-snapshot",
          },
        },
        reportRunSnapshots: [
          {
            id: "stale-snapshot",
            reportId: "inactive-users",
            periodRole: "current",
            scope: {},
            pageSize: 100,
            maxPagesPerDataset: 5,
            loadedAt: "2026-07-09T12:00:00.000Z",
            datasetIds: ["stale-dataset"],
            warnings: [],
          },
        ],
        warnings: [],
      });
      await loadDeferred.promise;
      await Promise.resolve();
    });

    await waitFor(() => expect(clearPersistedDatasetSessionMock).toHaveBeenCalled());
    expect(screen.getByText("0 datasets")).toBeInTheDocument();
    expect(screen.getByText("No datasets loaded or stored in this browser.")).toBeInTheDocument();
    expect(screen.queryByText("Stale User")).not.toBeInTheDocument();
  });

  it("keeps newer report selection and hydrates stored datasets when slow browser hydration resolves later", async () => {
    const user = userEvent.setup();
    const loadDeferred = createDeferred<Awaited<ReturnType<typeof loadPersistedDatasetSession>>>();
    loadPersistedDatasetSessionMock.mockReturnValueOnce(loadDeferred.promise);

    render(<App />);

    await user.click(screen.getByRole("button", { name: "Inactive Users" }));

    expect(screen.getByRole("button", { name: "Inactive Users" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("heading", { name: "Inactive Users" })).toBeInTheDocument();

    await act(async () => {
      loadDeferred.resolve({
        version: 1,
        selectedReportId: "data-export",
        selectedReportIds: ["data-export"],
        datasets: {
          "dataset-1": {
            id: "dataset-1",
            snapshotId: "snapshot-1",
            reportId: "data-export",
            name: "dataExport",
            records: [{ id: 1, value: "persisted" }],
            loadedAt: "2026-07-09T12:00:00.000Z",
            source: "live-api",
            periodRole: "current",
          },
        },
        reportOutputs: {
          "data-export": {
            reportId: "data-export",
            datasetName: "dataExport",
            fileName: "Live API run",
            records: [{ datasetName: "dataExport", id: 1, value: "persisted" }],
            loadedAt: "2026-07-09T12:00:00.000Z",
            source: "live-api",
            currentSnapshotId: "snapshot-1",
          },
        },
        reportRunSnapshots: [
          {
            id: "snapshot-1",
            reportId: "data-export",
            periodRole: "current",
            scope: {},
            pageSize: 100,
            maxPagesPerDataset: 5,
            loadedAt: "2026-07-09T12:00:00.000Z",
            datasetIds: ["dataset-1"],
            warnings: [],
          },
        ],
        warnings: [],
      });
      await loadDeferred.promise;
      await Promise.resolve();
    });

    expect(screen.getByText("1 dataset")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Inactive Users" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("heading", { name: "Inactive Users" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Data Export" })).toHaveAttribute("aria-pressed", "false");
    expect(clearPersistedDatasetSessionMock).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Datasets" }));

    const datasetsPanel = screen.getByRole("region", { name: "Datasets" });
    expect(within(datasetsPanel).getByText("Data Export")).toBeInTheDocument();
    expect(within(datasetsPanel).getByText("dataExport")).toBeInTheDocument();
  });

  it("does not persist removed report output records when another dataset remains", async () => {
    const user = userEvent.setup();
    loadPersistedDatasetSessionMock.mockResolvedValueOnce({
      version: 1,
      selectedReportId: "inactive-users",
      selectedReportIds: ["inactive-users"],
      datasets: {
        "dataset-users": {
          id: "dataset-users",
          snapshotId: "snapshot-1",
          reportId: "inactive-users",
          name: "users",
          records: [{ user_id: 1, display_name: "Ada" }],
          loadedAt: "2026-07-09T12:00:00.000Z",
          source: "live-api",
          periodRole: "current",
          scope: { startDate: "2026-06-01", endDate: "2026-06-30" },
        },
        "dataset-tags": {
          id: "dataset-tags",
          snapshotId: "snapshot-1",
          reportId: "inactive-users",
          name: "tags",
          records: [{ name: "python" }],
          loadedAt: "2026-07-09T12:00:00.000Z",
          source: "live-api",
          periodRole: "current",
          scope: { startDate: "2026-06-01", endDate: "2026-06-30" },
        },
      },
      reportOutputs: {
        "inactive-users": {
          reportId: "inactive-users",
          datasetName: "users",
          fileName: "Live API run",
          records: [
            { datasetName: "users", user_id: 1, display_name: "Ada" },
            { datasetName: "tags", name: "python" },
          ],
          loadedAt: "2026-07-09T12:00:00.000Z",
          source: "live-api",
          currentScope: { startDate: "2026-06-01", endDate: "2026-06-30" },
          currentSnapshotId: "snapshot-1",
        },
      },
      reportRunSnapshots: [
        {
          id: "snapshot-1",
          reportId: "inactive-users",
          periodRole: "current",
          scope: { startDate: "2026-06-01", endDate: "2026-06-30" },
          pageSize: 100,
          maxPagesPerDataset: 5,
          loadedAt: "2026-07-09T12:00:00.000Z",
          datasetIds: ["dataset-users", "dataset-tags"],
          warnings: [],
        },
      ],
      warnings: [],
    });

    render(<App />);

    expect(await screen.findByText("2 datasets")).toBeInTheDocument();
    await waitFor(() => expect(savePersistedDatasetSessionMock).toHaveBeenCalled());
    savePersistedDatasetSessionMock.mockClear();

    await user.click(screen.getByRole("button", { name: "Datasets" }));
    await user.click(screen.getByRole("button", { name: "Remove users current dataset" }));

    expect(screen.getByText("1 dataset")).toBeInTheDocument();
    await waitFor(() => expect(savePersistedDatasetSessionMock).toHaveBeenCalled());

    const saveCalls = savePersistedDatasetSessionMock.mock.calls;
    const savedSnapshot = saveCalls[saveCalls.length - 1]?.[0];
    expect(savedSnapshot?.datasets).toHaveProperty("dataset-tags");
    expect(savedSnapshot?.datasets).not.toHaveProperty("dataset-users");
    expect(JSON.stringify(savedSnapshot?.reportOutputs)).toContain("python");
    expect(JSON.stringify(savedSnapshot?.reportOutputs)).not.toContain("Ada");
  });

  it("ignores stale persistence failures after a newer flush", async () => {
    const user = userEvent.setup();
    const saveDeferred = createDeferred<void>();

    render(<App />);

    await waitFor(() => expect(clearPersistedDatasetSessionMock).toHaveBeenCalled());
    clearPersistedDatasetSessionMock.mockClear();
    savePersistedDatasetSessionMock.mockImplementationOnce(() => saveDeferred.promise);

    await user.click(screen.getByRole("button", { name: "Uploads" }));
    await user.upload(
      screen.getByLabelText("Upload report outputs"),
      new File([tagMetricsCsv], "tag_metrics.csv", { type: "text/csv" }),
    );

    expect(await screen.findByText("Imported tag_metrics.csv for Tag Report.")).toBeInTheDocument();
    await waitFor(() => expect(savePersistedDatasetSessionMock).toHaveBeenCalled());

    await user.click(screen.getByRole("button", { name: "Datasets" }));
    await user.click(screen.getByRole("button", { name: "Flush stored datasets" }));

    await act(async () => {
      saveDeferred.reject(new Error("Quota exceeded"));
      await saveDeferred.promise.catch(() => undefined);
    });

    expect(
      screen.queryByText("Dataset changes could not be stored in this browser. Current session data will still work."),
    ).not.toBeInTheDocument();
    await waitFor(() => expect(clearPersistedDatasetSessionMock).toHaveBeenCalled());
  });

  it("does not warn after unmount when persistence rejects", async () => {
    const user = userEvent.setup();
    const saveDeferred = createDeferred<void>();
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const { unmount } = render(<App />);

    await waitFor(() => expect(clearPersistedDatasetSessionMock).toHaveBeenCalled());
    savePersistedDatasetSessionMock.mockImplementationOnce(() => saveDeferred.promise);

    await user.click(screen.getByRole("button", { name: "Uploads" }));
    await user.upload(
      screen.getByLabelText("Upload report outputs"),
      new File([tagMetricsCsv], "tag_metrics.csv", { type: "text/csv" }),
    );

    expect(await screen.findByText("Imported tag_metrics.csv for Tag Report.")).toBeInTheDocument();
    await waitFor(() => expect(savePersistedDatasetSessionMock).toHaveBeenCalled());

    unmount();

    await act(async () => {
      saveDeferred.reject(new Error("Quota exceeded"));
      await saveDeferred.promise.catch(() => undefined);
    });

    expect(consoleError).not.toHaveBeenCalled();
  });

  it("shows a non-blocking warning when browser dataset storage fails", async () => {
    loadPersistedDatasetSessionMock.mockRejectedValueOnce(new Error("Blocked"));

    render(<App />);

    expect(
      await screen.findByText("Datasets could not be restored from browser storage. Current session data will still work."),
    ).toBeInTheDocument();
  });

  it("opens the shared credentials panel", async () => {
    const user = userEvent.setup();

    render(<App />);

    await user.click(screen.getByRole("button", { name: "Credentials" }));

    expect(screen.getByRole("heading", { name: "Session Credentials" })).toBeInTheDocument();
    expect(
      screen.getByText("Credentials are kept in memory for this browser session only."),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Instance URL")).toBeInTheDocument();
    expect(screen.queryByLabelText("API key")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Access token")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Personal access token")).toBeInTheDocument();
    expect(screen.getByText("Tag Report credential notes")).toBeInTheDocument();
  });

  it("shows a distinct uploads placeholder", async () => {
    const user = userEvent.setup();

    render(<App />);

    const tagReportButton = screen.getByRole("button", { name: "Tag Report" });
    expect(tagReportButton).toHaveAttribute("aria-pressed", "true");

    await user.click(screen.getByRole("button", { name: "Uploads" }));

    expect(screen.getByRole("heading", { name: "Uploads" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Tag Report" })).not.toBeInTheDocument();
  });

  it("opens the write tools panel", async () => {
    const user = userEvent.setup();

    render(<App />);

    await user.click(screen.getByRole("button", { name: "Write Tools" }));

    expect(screen.getByRole("heading", { name: "Write Tools" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "User Group Sync" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByRole("heading", { name: "Report Catalog" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Tag Report" })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "User Group Sync" })).toBeInTheDocument();
    expect(screen.getByLabelText("Upload user export CSV")).toBeInTheDocument();
  });

  it("loads an uploaded report output into the selected dashboard", async () => {
    const user = userEvent.setup();

    render(<App />);

    await user.click(screen.getByRole("button", { name: "Uploads" }));
    await user.upload(
      screen.getByLabelText("Upload report outputs"),
      new File([tagMetricsCsv], "tag_metrics.csv", { type: "text/csv" }),
    );

    expect(await screen.findByText("Imported tag_metrics.csv for Tag Report.")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Tag Report" })).toBeInTheDocument();
    expect(screen.getByText("Page Views")).toBeInTheDocument();
    expect(screen.getByText("889,996")).toBeInTheDocument();
    expect(screen.getByText("Top tags by page views")).toBeInTheDocument();
  });

  it("shows a run status when the selected report run is requested", async () => {
    const user = userEvent.setup();

    render(<App />);

    await user.click(screen.getByRole("button", { name: "Run current period" }));

    expect(
      screen.getByText("Add session credentials before running Tag Report."),
    ).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Session Credentials" })).toBeInTheDocument();
  });

  it("runs a server-backed live API report and stores live datasets in session", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({
        ok: true,
        result: {
          reportId: "inactive-users",
          reportTitle: "Inactive Users",
          periodRole: "current",
          scope: { startDate: "2026-06-01", endDate: "2026-06-30" },
          pageSize: 100,
          maxPagesPerDataset: 5,
          warnings: [],
          datasets: [
            {
              datasetName: "users",
              records: [{ user_id: 1, display_name: "Ada" }],
            },
          ],
          messages: ["Collected users (1 record) for Inactive Users."],
        },
      }), {
        status: 200,
      }),
    );

    render(<App />);

    await user.click(screen.getByRole("button", { name: "Inactive Users" }));
    await user.click(screen.getByRole("button", { name: "Credentials" }));
    await user.type(screen.getByLabelText("Instance URL"), "https://stackoverflowteams.com/c/example-team");
    await user.type(screen.getByLabelText("Personal access token"), "pat-token");
    await user.click(screen.getByRole("button", { name: "Save session credentials" }));
    await user.click(screen.getByRole("button", { name: "Reports" }));
    await user.click(screen.getByRole("button", { name: "Run current period" }));

    expect(await screen.findByText("Live API run completed for Inactive Users.")).toBeInTheDocument();
    expect(fetchMock.mock.calls[0][0]).toBe("/api/reports/run");
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({
      reportId: "inactive-users",
      credentials: basicBusinessPatCredentials,
      periodRole: "current",
      scope: {},
      pageSize: 100,
      maxPagesPerDataset: 5,
    });
    expect(screen.getByText("1 dataset")).toBeInTheDocument();
    expect(screen.getAllByText("users").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("Live Records")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Datasets" }));

    const datasetsPanel = screen.getByRole("region", { name: "Datasets" });
    expect(within(datasetsPanel).getByRole("heading", { name: "Datasets" })).toBeInTheDocument();
    expect(within(datasetsPanel).getByText("Inactive Users")).toBeInTheDocument();
    expect(within(datasetsPanel).getByText("2026-06-01 to 2026-06-30")).toBeInTheDocument();
    expect(
      within(datasetsPanel).getByRole("button", { name: "Download users current dataset as CSV" }),
    ).toBeInTheDocument();
    expect(
      within(datasetsPanel).getByRole("button", { name: "Download users current dataset as JSON" }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Reports" }));
    await user.click(screen.getByRole("tab", { name: "Raw Table" }));

    expect(screen.getByText("Ada")).toBeInTheDocument();
  });

  it("runs Tag Report through the server-backed live API route", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({
        ok: true,
        result: {
          reportId: "tag-report",
          reportTitle: "Tag Report",
          periodRole: "current",
          scope: {},
          pageSize: 100,
          maxPagesPerDataset: 5,
          warnings: [],
          datasets: [
            { datasetName: "tags", records: [{ name: "python" }] },
            { datasetName: "users", records: [{ user_id: 1 }] },
            { datasetName: "questions", records: [{ question_id: 10 }] },
            { datasetName: "articles", records: [{ article_id: 20 }] },
            { datasetName: "tagSmes", records: [{ tagName: "python", user_id: 1 }] },
          ],
          messages: ["Collected tagSmes (1 record) for Tag Report."],
        },
      }), {
        status: 200,
      }),
    );

    render(<App />);

    await user.click(screen.getByRole("button", { name: "Credentials" }));
    await user.type(screen.getByLabelText("Instance URL"), "https://stackoverflowteams.com/c/example-team");
    await user.type(screen.getByLabelText("Personal access token"), "pat-token");
    await user.click(screen.getByRole("button", { name: "Save session credentials" }));
    await user.click(screen.getByRole("button", { name: "Reports" }));
    await user.click(screen.getByRole("button", { name: "Run current period" }));

    expect(await screen.findByText("Live API run completed for Tag Report.")).toBeInTheDocument();
    expect(fetchMock.mock.calls[0][0]).toBe("/api/reports/run");
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toMatchObject({
      credentials: basicBusinessPatCredentials,
    });
    expect(screen.getByText("5 datasets")).toBeInTheDocument();
    expect(screen.getAllByText("tagSmes").length).toBeGreaterThanOrEqual(1);
  });

  it("runs current and comparison periods and renders comparison metrics", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
      const payload = JSON.parse(String(init?.body));
      const periodRole = payload.periodRole;

      return new Response(JSON.stringify({
        ok: true,
        result: {
          reportId: "inactive-users",
          reportTitle: "Inactive Users",
          periodRole,
          scope: payload.scope,
          pageSize: payload.pageSize,
          maxPagesPerDataset: payload.maxPagesPerDataset,
          warnings: [],
          datasets: [
            {
              datasetName: "users",
              records:
                periodRole === "comparison"
                  ? [{ user_id: 3, display_name: "Grace" }]
                  : [
                      { user_id: 1, display_name: "Ada" },
                      { user_id: 2, display_name: "Linus" },
                    ],
            },
          ],
          messages: [`Collected users for ${periodRole}.`],
        },
      }), {
        status: 200,
      });
    });

    render(<App />);

    await user.click(screen.getByRole("button", { name: "Inactive Users" }));
    await user.click(screen.getByRole("button", { name: "Credentials" }));
    await user.type(screen.getByLabelText("Instance URL"), "https://stackoverflowteams.com/c/example-team");
    await user.type(screen.getByLabelText("Personal access token"), "pat-token");
    await user.click(screen.getByRole("button", { name: "Save session credentials" }));
    await user.click(screen.getByRole("button", { name: "Reports" }));
    await user.click(screen.getByLabelText("Enable comparison period"));
    await user.click(screen.getByRole("button", { name: "Run both periods" }));

    expect(await screen.findByText("Period comparison")).toBeInTheDocument();
    expect(screen.getByText("Current Records")).toBeInTheDocument();
    expect(screen.getByText("Comparison Records")).toBeInTheDocument();
    expect(screen.getAllByText("+1").length).toBeGreaterThanOrEqual(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const currentRunBody = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    const comparisonRunBody = JSON.parse(String(fetchMock.mock.calls[1][1]?.body));
    expect(currentRunBody).toMatchObject({
      credentials: basicBusinessPatCredentials,
      periodRole: "current",
    });
    expect(comparisonRunBody).toMatchObject({
      credentials: basicBusinessPatCredentials,
      periodRole: "comparison",
    });
  });

  it("saves credentials for the current browser session", async () => {
    const user = userEvent.setup();

    render(<App />);

    await user.click(screen.getByRole("button", { name: "Credentials" }));
    await user.type(screen.getByLabelText("Instance URL"), "https://stackoverflowteams.com/c/demo");
    await user.type(screen.getByLabelText("Personal access token"), "pat-token");
    await user.click(screen.getByRole("button", { name: "Save session credentials" }));

    expect(screen.getByText("Credentials saved for this browser session.")).toBeInTheDocument();
  });

  it("saves Enterprise OAuth credentials through the App reducer", async () => {
    const user = userEvent.setup();
    const popup = createPopup();
    vi.spyOn(window, "open").mockReturnValue(popup as unknown as Window);
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({ ok: true, authorizationUrl: "https://demo.stackenterprise.co/oauth?state=abc" }),
    );

    render(<App />);

    await user.click(screen.getByRole("button", { name: "Credentials" }));
    await user.selectOptions(screen.getByLabelText("Instance type"), "enterprise");
    await user.type(screen.getByLabelText("Instance URL"), "https://demo.stackenterprise.co");
    await user.type(screen.getByLabelText("OAuth Client ID"), "client-123");
    await user.click(screen.getByRole("button", { name: "Connect with Enterprise OAuth" }));

    await waitFor(() => {
      expect(popup.location.href).toBe("https://demo.stackenterprise.co/oauth?state=abc");
    });
    expect(fetchMock.mock.calls[0][0]).toBe("/api/oauth/pkce/start");

    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          origin: window.location.origin,
          source: popup as unknown as MessageEventSource,
          data: {
            type: "stack-api-oauth-pkce-result",
            ok: true,
            credential: {
              instanceType: "enterprise",
              baseUrl: "https://demo.stackenterprise.co",
              accessToken: "oauth-token",
              authSource: "oauth-pkce",
              oauthClientId: "client-123",
              oauthScopes: ["write_access"],
            },
          },
        }),
      );
    });

    expect(await screen.findByText("Credentials saved for this browser session.")).toBeInTheDocument();
    expect(screen.getByText("Credentials saved")).toBeInTheDocument();
  });
});

function createPopup() {
  return {
    location: { href: "" },
    close: vi.fn(),
  };
}

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });

  return { promise, reject, resolve };
}
