import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../App";
import { tagMetricsCsv } from "../test/fixtures/reportFixtures";
import {
  completeSmeCoverageDecisionPack,
  partialSmeCoverageDecisionPack,
} from "../test/fixtures/smeCoverageFixtures";
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
    expect(
      within(screen.getByRole("navigation", { name: "Application panels" }))
        .getAllByRole("button")
        .map((button) => button.textContent),
    ).toEqual(["Scripts", "Utilities", "Credentials", "Uploads", "Datasets", "Write Tools"]);
    expect(screen.getByRole("button", { name: "Scripts" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Utilities" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByText(/mostly untested and is not ready for production instances/i)).toBeInTheDocument();
    expect(screen.getByText(/reach out to Moises on Slack/i)).toBeInTheDocument();
    expect(screen.getByText("No credentials")).toBeInTheDocument();
    expect(screen.getByText("0 datasets")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Tag Report" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Data Export" })).toBeInTheDocument();
    await waitFor(() => expect(clearPersistedDatasetSessionMock).toHaveBeenCalled());
  });

  it("opens the self-contained SME Coverage Analyzer and redirects missing credentials", async () => {
    const user = userEvent.setup();

    render(<App />);

    await user.click(screen.getByRole("button", { name: "Utilities" }));
    await user.click(screen.getByRole("button", { name: "SME Coverage Analyzer" }));

    expect(screen.getByRole("heading", { name: "SME Coverage Analyzer" })).toBeInTheDocument();
    expect(screen.getAllByText("All-time demand · Current SME coverage")).toHaveLength(2);
    expect(screen.getByRole("button", { name: "Run SME coverage analysis" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Run SME coverage analysis" }));

    expect(screen.getByRole("heading", { name: "Session Credentials" })).toBeInTheDocument();
    expect(screen.getByText("SME Coverage Analyzer credential notes")).toBeInTheDocument();
    expect(screen.getByText(/add session credentials before running SME Coverage Analyzer/i)).toBeInTheDocument();
  });

  it("inherits utility credential context after direct Utilities navigation", async () => {
    const user = userEvent.setup();
    const popup = createPopup();
    vi.spyOn(window, "open").mockReturnValue(popup as unknown as Window);
    const fetchMock = mockOAuthEndpoints(
      "https://demo.stackenterprise.co/oauth?state=utility",
    );

    render(<App />);

    await user.click(screen.getByRole("button", { name: "Utilities" }));
    await user.click(screen.getByRole("button", { name: "Credentials" }));

    expect(screen.getByText("SME Coverage Analyzer credential notes")).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("Instance type"), "enterprise");
    await user.type(screen.getByLabelText("Instance URL"), "https://demo.stackenterprise.co");
    await user.type(screen.getByLabelText("OAuth Client ID"), "client-123");
    await user.click(screen.getByRole("button", { name: "Connect with Enterprise OAuth" }));

    await waitFor(() => {
      expect(oauthEndpointCallCount(fetchMock, "/api/oauth/pkce/config", "GET")).toBe(1);
      expect(oauthEndpointCallCount(fetchMock, "/api/oauth/pkce/start", "POST")).toBe(1);
    });
    expect(JSON.parse(String(findOAuthStartCall(fetchMock)?.[1]?.body))).toEqual({
      baseUrl: "https://demo.stackenterprise.co",
      clientId: "client-123",
      scopes: [],
      includeNoExpiry: false,
    });
  });

  it("restores report credential context after direct Scripts navigation", async () => {
    const user = userEvent.setup();
    const popup = createPopup();
    vi.spyOn(window, "open").mockReturnValue(popup as unknown as Window);
    const fetchMock = mockOAuthEndpoints(
      "https://demo.stackenterprise.co/oauth?state=report",
    );

    render(<App />);

    await openSmeCoverageAnalyzer(user);
    await user.click(screen.getByRole("button", { name: "Scripts" }));
    await user.click(screen.getByRole("button", { name: "Credentials" }));

    expect(screen.getByText("Tag Report credential notes")).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("Instance type"), "enterprise");
    await user.type(screen.getByLabelText("Instance URL"), "https://demo.stackenterprise.co");
    await user.type(screen.getByLabelText("OAuth Client ID"), "client-123");
    await user.click(screen.getByRole("button", { name: "Connect with Enterprise OAuth" }));

    await waitFor(() => {
      expect(oauthEndpointCallCount(fetchMock, "/api/oauth/pkce/config", "GET")).toBe(1);
      expect(oauthEndpointCallCount(fetchMock, "/api/oauth/pkce/start", "POST")).toBe(1);
    });
    expect(JSON.parse(String(findOAuthStartCall(fetchMock)?.[1]?.body))).toEqual({
      baseUrl: "https://demo.stackenterprise.co",
      clientId: "client-123",
      scopes: [],
      includeNoExpiry: false,
    });
  });

  it("requests no-expiry read-only report OAuth without write_access", async () => {
    const user = userEvent.setup();
    const popup = createPopup();
    vi.spyOn(window, "open").mockReturnValue(popup as unknown as Window);
    const fetchMock = mockOAuthEndpoints(
      "https://demo.stackenterprise.co/oauth?state=report-no-expiry",
    );

    render(<App />);

    await openSmeCoverageAnalyzer(user);
    await user.click(screen.getByRole("button", { name: "Scripts" }));
    await user.click(screen.getByRole("button", { name: "Credentials" }));
    await user.selectOptions(screen.getByLabelText("Instance type"), "enterprise");
    await user.type(screen.getByLabelText("Instance URL"), "https://demo.stackenterprise.co");
    await user.type(screen.getByLabelText("OAuth Client ID"), "client-123");
    await user.click(screen.getByLabelText("Request non-expiring token"));
    await user.click(screen.getByRole("button", { name: "Connect with Enterprise OAuth" }));

    await waitFor(() => {
      expect(oauthEndpointCallCount(fetchMock, "/api/oauth/pkce/config", "GET")).toBe(1);
      expect(oauthEndpointCallCount(fetchMock, "/api/oauth/pkce/start", "POST")).toBe(1);
    });
    expect(JSON.parse(String(findOAuthStartCall(fetchMock)?.[1]?.body))).toEqual({
      baseUrl: "https://demo.stackenterprise.co",
      clientId: "client-123",
      scopes: [],
      includeNoExpiry: true,
    });
  });

  it("binds User Group Sync credential ownership after Utilities -> Write Tools navigation", async () => {
    const user = userEvent.setup();
    const popup = createPopup();
    vi.spyOn(window, "open").mockReturnValue(popup as unknown as Window);
    const fetchMock = mockOAuthEndpoints(
      "https://demo.stackenterprise.co/oauth?state=write-tool",
    );

    render(<App />);

    await user.click(screen.getByRole("button", { name: "Utilities" }));
    await user.click(screen.getByRole("button", { name: "Write Tools" }));
    await user.click(screen.getByRole("button", { name: "Credentials" }));

    expect(screen.getByText("User Group Sync credential notes")).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("Instance type"), "enterprise");
    await user.type(screen.getByLabelText("Instance URL"), "https://demo.stackenterprise.co");
    await user.type(screen.getByLabelText("OAuth Client ID"), "client-123");
    await user.click(screen.getByRole("button", { name: "Connect with Enterprise OAuth" }));

    await waitFor(() => {
      expect(oauthEndpointCallCount(fetchMock, "/api/oauth/pkce/config", "GET")).toBe(1);
      expect(oauthEndpointCallCount(fetchMock, "/api/oauth/pkce/start", "POST")).toBe(1);
    });
    expect(JSON.parse(String(findOAuthStartCall(fetchMock)?.[1]?.body))).toEqual({
      baseUrl: "https://demo.stackenterprise.co",
      clientId: "client-123",
      scopes: ["write_access"],
      includeNoExpiry: false,
    });
  });

  it("invalidates a pending utility run when direct navigation crosses to Scripts", async () => {
    const user = userEvent.setup();
    const pendingRun = createDeferred<Response>();
    const fetchMock = vi.spyOn(globalThis, "fetch").mockReturnValue(pendingRun.promise);
    const stalePack = {
      ...completeSmeCoverageDecisionPack(),
      overview: "This utility result must not commit after switching workflows.",
    };

    render(<App />);

    await saveBasicBusinessCredentials(user);
    await openSmeCoverageAnalyzer(user);
    await user.click(screen.getByRole("button", { name: "Run SME coverage analysis" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("progressbar", { name: "SME Coverage Analyzer progress" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Scripts" }));
    expect(screen.getByRole("button", { name: "Scripts" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("heading", { name: "Tag Report" })).toBeInTheDocument();
    expect(screen.queryByRole("progressbar", { name: "SME Coverage Analyzer progress" })).not.toBeInTheDocument();

    await act(async () => {
      pendingRun.resolve(jsonResponse(makeSmeCoverageRunBody(stalePack, "stale")));
      await pendingRun.promise;
    });

    expect(screen.getByRole("button", { name: "Scripts" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("heading", { name: "Tag Report" })).toBeInTheDocument();
    expect(screen.queryByText(stalePack.overview)).not.toBeInTheDocument();
    expect(screen.queryByRole("progressbar", { name: "SME Coverage Analyzer progress" })).not.toBeInTheDocument();
    expect(screen.getByText("0 datasets")).toBeInTheDocument();
  });

  it("invalidates a pending utility run when direct navigation crosses to Write Tools", async () => {
    const user = userEvent.setup();
    const pendingRun = createDeferred<Response>();
    const fetchMock = vi.spyOn(globalThis, "fetch").mockReturnValue(pendingRun.promise);
    const stalePack = {
      ...completeSmeCoverageDecisionPack(),
      overview: "This utility result must not commit after switching to Write Tools.",
    };

    render(<App />);

    await saveBasicBusinessCredentials(user);
    await openSmeCoverageAnalyzer(user);
    await user.click(screen.getByRole("button", { name: "Run SME coverage analysis" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    await user.click(screen.getByRole("button", { name: "Write Tools" }));
    expect(screen.getByRole("heading", { name: "User Group Sync" })).toBeInTheDocument();
    expect(screen.queryByRole("progressbar", { name: "SME Coverage Analyzer progress" })).not.toBeInTheDocument();

    await act(async () => {
      pendingRun.resolve(jsonResponse(makeSmeCoverageRunBody(stalePack, "stale")));
      await pendingRun.promise;
    });

    expect(screen.getByRole("button", { name: "Write Tools" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("heading", { name: "User Group Sync" })).toBeInTheDocument();
    expect(screen.queryByText(stalePack.overview)).not.toBeInTheDocument();
    expect(screen.getByText("0 datasets")).toBeInTheDocument();
  });

  it("posts only credentials and API-volume settings, shows progress, and stores the completed utility result", async () => {
    const user = userEvent.setup();
    const pendingRun = createDeferred<Response>();
    const fetchMock = vi.spyOn(globalThis, "fetch").mockReturnValue(pendingRun.promise);

    render(<App />);

    await saveBasicBusinessCredentials(user);
    await openSmeCoverageAnalyzer(user);
    await user.click(screen.getByRole("button", { name: "Run SME coverage analysis" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith("/api/utilities/sme-coverage/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          credentials: basicBusinessPatCredentials,
          pageSize: 100,
          maxPagesPerDataset: 20,
          runPreset: "deep-audit",
        }),
      });
    });
    expect(screen.getByRole("progressbar", { name: "SME Coverage Analyzer progress" })).toBeInTheDocument();
    expect(screen.getByText(/server is running the following stages in order/i)).toBeInTheDocument();

    pendingRun.resolve(jsonResponse(makeSmeCoverageRunBody(completeSmeCoverageDecisionPack(), "first")));

    expect(await screen.findByRole("heading", { name: "Highest-demand critical gaps" })).toBeInTheDocument();
    expect(screen.getAllByText("Alpha-platform").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("3 datasets")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Datasets" }));
    const datasetsPanel = screen.getByRole("region", { name: "Datasets" });
    expect(within(datasetsPanel).getAllByText("SME Coverage Analyzer")).toHaveLength(3);
  });

  it("renders partial utility warnings before the executive summary", async () => {
    const user = userEvent.setup();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse(makeSmeCoverageRunBody(partialSmeCoverageDecisionPack(), "partial")),
    );

    render(<App />);

    await saveBasicBusinessCredentials(user);
    await openSmeCoverageAnalyzer(user);
    await user.click(screen.getByRole("button", { name: "Run SME coverage analysis" }));

    const warning = await screen.findByText("Question evidence reached the configured collection cap.");
    const overview = screen.getByText(
      "This prepared result is partial; interpret priority findings with the warnings above.",
    );
    expect(warning.compareDocumentPosition(overview) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("replaces the active utility pack on rerun while retaining six supporting datasets", async () => {
    const user = userEvent.setup();
    const firstPack = completeSmeCoverageDecisionPack();
    const secondPack = {
      ...completeSmeCoverageDecisionPack(),
      overview: "The second prepared decision pack is active.",
    };
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse(makeSmeCoverageRunBody(firstPack, "first")))
      .mockResolvedValueOnce(jsonResponse(makeSmeCoverageRunBody(secondPack, "second")));

    render(<App />);

    await saveBasicBusinessCredentials(user);
    await openSmeCoverageAnalyzer(user);
    await user.click(screen.getByRole("button", { name: "Run SME coverage analysis" }));
    expect(await screen.findByText(firstPack.overview)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Run again" }));

    expect(await screen.findByText(secondPack.overview)).toBeInTheDocument();
    expect(screen.queryByText(firstPack.overview)).not.toBeInTheDocument();
    expect(screen.getByText("6 datasets")).toBeInTheDocument();
  });

  it("does not let an older utility response replace a newer run", async () => {
    const user = userEvent.setup();
    const olderRun = createDeferred<Response>();
    const newerRun = createDeferred<Response>();
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockReturnValueOnce(olderRun.promise)
      .mockReturnValueOnce(newerRun.promise);
    const freshPack = { ...completeSmeCoverageDecisionPack(), overview: "Fresh utility result." };

    render(<App />);

    await saveBasicBusinessCredentials(user);
    await openSmeCoverageAnalyzer(user);
    await user.click(screen.getByRole("button", { name: "Run SME coverage analysis" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    await user.click(screen.getByRole("button", { name: "Scripts" }));
    await openSmeCoverageAnalyzer(user);
    await user.click(screen.getByRole("button", { name: "Run SME coverage analysis" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    newerRun.resolve(jsonResponse(makeSmeCoverageRunBody(freshPack, "fresh")));
    expect(await screen.findByText("Fresh utility result.")).toBeInTheDocument();

    await act(async () => {
      olderRun.resolve(
        jsonResponse(makeSmeCoverageRunBody({ ...completeSmeCoverageDecisionPack(), overview: "Stale utility result." }, "stale")),
      );
      await olderRun.promise;
    });

    expect(screen.getByText("Fresh utility result.")).toBeInTheDocument();
    expect(screen.queryByText("Stale utility result.")).not.toBeInTheDocument();
    expect(screen.getByText("3 datasets")).toBeInTheDocument();
  });

  it("hydrates a persisted utility pack without credentials", async () => {
    const user = userEvent.setup();
    const pack = persistableEmptySmeCoverageDecisionPack();
    loadPersistedDatasetSessionMock.mockResolvedValueOnce(makePersistedUtilitySnapshot(pack));

    render(<App />);

    expect(await screen.findByText("No credentials")).toBeInTheDocument();
    await openSmeCoverageAnalyzer(user);

    expect(screen.getByText(pack.overview)).toBeInTheDocument();
    expect(screen.getByText("No credentials")).toBeInTheDocument();
  });

  it("persists and restores an empty successful utility pack", async () => {
    const user = userEvent.setup();
    const pack = persistableEmptySmeCoverageDecisionPack();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse(makeSmeCoverageRunBody(pack, "empty", true)),
    );

    render(<App />);

    await saveBasicBusinessCredentials(user);
    await openSmeCoverageAnalyzer(user);
    await user.click(screen.getByRole("button", { name: "Run SME coverage analysis" }));

    expect(await screen.findByText(pack.overview)).toBeInTheDocument();
    await waitFor(() => expect(savePersistedDatasetSessionMock).toHaveBeenCalled());
    const saveCalls = savePersistedDatasetSessionMock.mock.calls;
    const saved = saveCalls[saveCalls.length - 1]?.[0];
    expect(saved?.utilityOutputs["sme-coverage-analyzer"]?.decisionPack).toEqual(pack);
    expect(saved?.datasets).toBeDefined();
  });

  it("hydrates persisted browser datasets without credentials", async () => {
    const user = userEvent.setup();
    loadPersistedDatasetSessionMock.mockResolvedValueOnce({
      version: 2,
      selectedReportId: "inactive-users",
      selectedReportIds: ["inactive-users"],
      selectedUtilityId: "sme-coverage-analyzer",
      utilityOutputs: {},
      utilityRunSnapshots: [],
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

  it("uses a restored Tag Report run preset for the next live run", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse(makeTagReportRunBody("Collected restored-preset tags for Tag Report.")),
    );
    loadPersistedDatasetSessionMock.mockResolvedValueOnce({
      version: 2,
      selectedReportId: "tag-report",
      selectedReportIds: ["tag-report"],
      selectedUtilityId: "sme-coverage-analyzer",
      utilityOutputs: {},
      utilityRunSnapshots: [],
      datasets: {
        "dataset-1": {
          id: "dataset-1",
          snapshotId: "snapshot-1",
          reportId: "tag-report",
          name: "tags",
          records: [{ name: "python", totalPageViews: 500, questionCount: 4 }],
          loadedAt: "2026-07-09T12:00:00.000Z",
          source: "live-api",
          periodRole: "current",
        },
      },
      reportOutputs: {},
      reportRunSnapshots: [
        {
          id: "snapshot-1",
          reportId: "tag-report",
          periodRole: "current",
          scope: {},
          pageSize: 100,
          maxPagesPerDataset: 20,
          runPreset: "deep-audit",
          loadedAt: "2026-07-09T12:00:00.000Z",
          datasetIds: ["dataset-1"],
          warnings: [],
        },
      ],
      warnings: [],
    });

    render(<App />);

    expect(await screen.findByText("1 dataset")).toBeInTheDocument();
    await saveBasicBusinessCredentials(user);
    await user.click(screen.getByRole("button", { name: "Scripts" }));
    await user.click(screen.getByRole("button", { name: "Run current period" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/reports/run", expect.any(Object)));
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toMatchObject({
      runPreset: "deep-audit",
      pageSize: 100,
      maxPagesPerDataset: 20,
    });
  });

  it("uses restored current and comparison scopes for the next paired Tag Report run", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
      const payload = JSON.parse(String(init?.body));

      return jsonResponse({
        ok: true,
        result: {
          reportId: "tag-report",
          reportTitle: "Tag Report",
          periodRole: payload.periodRole,
          scope: payload.scope,
          pageSize: payload.pageSize,
          maxPagesPerDataset: payload.maxPagesPerDataset,
          runPreset: payload.runPreset,
          warnings: [],
          datasets: [
            {
              datasetName: "tags",
              records:
                payload.periodRole === "comparison"
                  ? [{ name: "javascript", totalPageViews: 250, questionCount: 2 }]
                  : [{ name: "python", totalPageViews: 500, questionCount: 4 }],
            },
          ],
          messages: [`Collected ${payload.periodRole} tags for Tag Report.`],
        },
      });
    });
    loadPersistedDatasetSessionMock.mockResolvedValueOnce({
      version: 2,
      selectedReportId: "tag-report",
      selectedReportIds: ["tag-report"],
      selectedUtilityId: "sme-coverage-analyzer",
      utilityOutputs: {},
      utilityRunSnapshots: [],
      datasets: {
        "current-tags": {
          id: "current-tags",
          snapshotId: "current-snapshot",
          reportId: "tag-report",
          name: "tags",
          records: [{ name: "python", totalPageViews: 500, questionCount: 4 }],
          loadedAt: "2026-07-09T12:00:00.000Z",
          source: "live-api",
          periodRole: "current",
        },
        "comparison-tags": {
          id: "comparison-tags",
          snapshotId: "comparison-snapshot",
          reportId: "tag-report",
          name: "tags",
          records: [{ name: "javascript", totalPageViews: 250, questionCount: 2 }],
          loadedAt: "2026-07-09T12:00:00.000Z",
          source: "live-api",
          periodRole: "comparison",
        },
      },
      reportOutputs: {
        "tag-report": {
          reportId: "tag-report",
          datasetName: "tags",
          fileName: "Live API run",
          records: [{ tag_name: "python", page_views: 500 }],
          comparisonRecords: [{ tag_name: "javascript", page_views: 250 }],
          loadedAt: "2026-07-09T12:00:00.000Z",
          source: "live-api",
          currentScope: { startDate: "2026-07-01", endDate: "2026-07-08" },
          comparisonScope: { startDate: "2026-06-01", endDate: "2026-06-08" },
          currentSnapshotId: "current-snapshot",
          comparisonSnapshotId: "comparison-snapshot",
        },
      },
      reportRunSnapshots: [
        {
          id: "current-snapshot",
          reportId: "tag-report",
          periodRole: "current",
          scope: { startDate: "2026-07-01", endDate: "2026-07-08" },
          pageSize: 100,
          maxPagesPerDataset: 20,
          runPreset: "deep-audit",
          loadedAt: "2026-07-09T12:00:00.000Z",
          datasetIds: ["current-tags"],
          warnings: [],
        },
        {
          id: "comparison-snapshot",
          reportId: "tag-report",
          periodRole: "comparison",
          scope: { startDate: "2026-06-01", endDate: "2026-06-08" },
          pageSize: 100,
          maxPagesPerDataset: 20,
          runPreset: "deep-audit",
          loadedAt: "2026-07-09T12:00:00.000Z",
          datasetIds: ["comparison-tags"],
          warnings: [],
        },
      ],
      warnings: [],
    });

    render(<App />);

    expect(await screen.findByText("2 datasets")).toBeInTheDocument();
    await saveBasicBusinessCredentials(user);
    await user.click(screen.getByRole("button", { name: "Scripts" }));
    await user.click(screen.getByRole("button", { name: "Run both periods" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const currentRunBody = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    const comparisonRunBody = JSON.parse(String(fetchMock.mock.calls[1][1]?.body));
    expect(currentRunBody).toMatchObject({
      periodRole: "current",
      scope: { startDate: "2026-07-01", endDate: "2026-07-08" },
      runPreset: "deep-audit",
      pageSize: 100,
      maxPagesPerDataset: 20,
    });
    expect(comparisonRunBody).toMatchObject({
      periodRole: "comparison",
      scope: { startDate: "2026-06-01", endDate: "2026-06-08" },
      runPreset: "deep-audit",
      pageSize: 100,
      maxPagesPerDataset: 20,
    });
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
    await user.click(screen.getByRole("button", { name: "Scripts" }));
    await user.click(screen.getByRole("button", { name: "Run current period" }));

    expect(await screen.findByText("Live API run completed for Inactive Users.")).toBeInTheDocument();
    await waitFor(() => expect(savePersistedDatasetSessionMock).toHaveBeenCalled());

    const saveCalls = savePersistedDatasetSessionMock.mock.calls;
    const savedSnapshot = saveCalls[saveCalls.length - 1]?.[0] as unknown as Record<string, unknown>;
    expect(savedSnapshot).toMatchObject({
      version: 2,
      selectedReportId: "inactive-users",
      selectedReportIds: ["inactive-users"],
      selectedUtilityId: "sme-coverage-analyzer",
      utilityOutputs: {},
      utilityRunSnapshots: [],
    });
    expect(savedSnapshot).not.toHaveProperty("credentials");
    expect(savedSnapshot).not.toHaveProperty("runQueue");
  });

  it("flushes current and persisted datasets in bulk", async () => {
    const user = userEvent.setup();
    loadPersistedDatasetSessionMock.mockResolvedValueOnce({
      version: 2,
      selectedReportId: "inactive-users",
      selectedReportIds: ["inactive-users"],
      selectedUtilityId: "sme-coverage-analyzer",
      utilityOutputs: {},
      utilityRunSnapshots: [],
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
    await user.click(screen.getByRole("button", { name: "Scripts" }));
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
    expect(screen.getByText("Top tags by page views")).toBeInTheDocument();
    expect(screen.getAllByText("machine-learning").length).toBeGreaterThan(0);
    expect(screen.getByText("551,412")).toBeInTheDocument();

    await act(async () => {
      loadDeferred.resolve({
        version: 2,
        selectedReportId: "inactive-users",
        selectedReportIds: ["inactive-users"],
        selectedUtilityId: "sme-coverage-analyzer",
        utilityOutputs: {},
        utilityRunSnapshots: [],
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

    expect(screen.getByText("Top tags by page views")).toBeInTheDocument();
    expect(screen.getAllByText("machine-learning").length).toBeGreaterThan(0);
    expect(screen.getByText("551,412")).toBeInTheDocument();
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
        version: 2,
        selectedReportId: "inactive-users",
        selectedReportIds: ["inactive-users"],
        selectedUtilityId: "sme-coverage-analyzer",
        utilityOutputs: {},
        utilityRunSnapshots: [],
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

  it("clears stored datasets when row removal empties browser-local data before slow hydration resolves", async () => {
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
    await user.click(screen.getByRole("button", { name: "Remove tags upload dataset" }));

    expect(screen.getByText("0 datasets")).toBeInTheDocument();

    await act(async () => {
      loadDeferred.resolve({
        version: 2,
        selectedReportId: "inactive-users",
        selectedReportIds: ["inactive-users"],
        selectedUtilityId: "sme-coverage-analyzer",
        utilityOutputs: {},
        utilityRunSnapshots: [],
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
        version: 2,
        selectedReportId: "data-export",
        selectedReportIds: ["data-export"],
        selectedUtilityId: "sme-coverage-analyzer",
        utilityOutputs: {},
        utilityRunSnapshots: [],
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
      version: 2,
      selectedReportId: "inactive-users",
      selectedReportIds: ["inactive-users"],
      selectedUtilityId: "sme-coverage-analyzer",
      utilityOutputs: {},
      utilityRunSnapshots: [],
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
    expect(screen.getByText("Tags Covered")).toBeInTheDocument();
    expect(screen.getByText("SME Gaps")).toBeInTheDocument();
    expect(screen.getByText("Top tags by page views")).toBeInTheDocument();
    expect(screen.getByLabelText("machine-learning: 551412")).toBeInTheDocument();
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

  it("runs a server-backed live API report and stores live datasets locally", async () => {
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
    await user.click(screen.getByRole("button", { name: "Scripts" }));
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

    await user.click(screen.getByRole("button", { name: "Scripts" }));
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
          maxPagesPerDataset: 20,
          warnings: [
            {
              reportId: "tag-report",
              code: "dataset-page-cap",
              message: "Questions hit the configured page cap; results may be partial.",
            },
          ],
          datasets: [
            { datasetName: "tags", records: [{ name: "python", totalPageViews: 500, questionCount: 4 }] },
            { datasetName: "users", records: [{ user_id: 1 }] },
            { datasetName: "questions", records: [{ question_id: 10, tags: ["python"], answer_count: 1 }] },
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
    await user.click(screen.getByRole("button", { name: "Scripts" }));
    await user.click(screen.getByRole("radio", { name: "Deep audit" }));
    await user.click(screen.getByRole("button", { name: "Run current period" }));

    expect(await screen.findByText("Live API run completed for Tag Report.")).toBeInTheDocument();
    expect(fetchMock.mock.calls[0][0]).toBe("/api/reports/run");
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toMatchObject({
      credentials: basicBusinessPatCredentials,
      runPreset: "deep-audit",
      pageSize: 100,
      maxPagesPerDataset: 20,
    });
    expect(screen.getByText("5 datasets")).toBeInTheDocument();
    expect(screen.getByText("Questions hit the configured page cap; results may be partial.")).toBeInTheDocument();
    expect(screen.getByText("Tags Covered")).toBeInTheDocument();
    expect(screen.getByText("Top tags by page views")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Datasets" }));

    expect(screen.getAllByText("tagSmes").length).toBeGreaterThanOrEqual(1);
  });

  it("shows Tag Report progress while live collection is pending", async () => {
    const user = userEvent.setup();
    const pendingRun = createDeferred<Response>();
    const fetchMock = vi.spyOn(globalThis, "fetch").mockReturnValue(pendingRun.promise);

    render(<App />);

    await user.click(screen.getByRole("button", { name: "Credentials" }));
    await user.type(screen.getByLabelText("Instance URL"), "https://stackoverflowteams.com/c/example-team");
    await user.type(screen.getByLabelText("Personal access token"), "pat-token");
    await user.click(screen.getByRole("button", { name: "Save session credentials" }));
    await user.click(screen.getByRole("button", { name: "Scripts" }));
    await user.click(screen.getByRole("button", { name: "Run current period" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/reports/run", expect.any(Object)));

    const status = screen.getByRole("region", { name: "Run status" });
    expect(within(status).getByRole("heading", { name: "Running Tag Report" })).toBeInTheDocument();
    expect(within(status).getByText("Collecting live API datasets")).toBeInTheDocument();
    expect(within(status).getByRole("progressbar", { name: "Tag Report progress" })).toHaveAttribute(
      "aria-valuenow",
      "50",
    );
    expect(
      within(status).getByText("Running Tag Report current period live API collection..."),
    ).toBeInTheDocument();

    pendingRun.resolve(jsonResponse({
      ok: true,
      result: {
        reportId: "tag-report",
        reportTitle: "Tag Report",
        periodRole: "current",
        scope: {},
        pageSize: 100,
        maxPagesPerDataset: 20,
        warnings: [],
        datasets: [
          { datasetName: "tags", records: [{ name: "python", totalPageViews: 500, questionCount: 4 }] },
        ],
        messages: ["Collected tags (1 record) for Tag Report."],
      },
    }));
    expect(await screen.findByText("Live API run completed for Tag Report.")).toBeInTheDocument();
  });

  it("ignores an older live run completion after a newer run starts", async () => {
    const user = userEvent.setup();
    const firstRun = createDeferred<Response>();
    const secondRun = createDeferred<Response>();
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockReturnValueOnce(firstRun.promise)
      .mockReturnValueOnce(secondRun.promise);

    render(<App />);

    await saveBasicBusinessCredentials(user);
    await user.click(screen.getByRole("button", { name: "Scripts" }));
    await user.click(screen.getByRole("button", { name: "Run current period" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await user.click(screen.getByRole("button", { name: "Run current period" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    await act(async () => {
      firstRun.resolve(jsonResponse(makeTagReportRunBody("Collected stale tags for Tag Report.")));
      await firstRun.promise;
    });

    const status = screen.getByRole("region", { name: "Run status" });
    expect(within(status).getByRole("heading", { name: "Running Tag Report" })).toBeInTheDocument();
    expect(within(status).getByText("Running Tag Report current period live API collection...")).toBeInTheDocument();
    expect(screen.queryByText("Live API run completed for Tag Report.")).not.toBeInTheDocument();
    expect(screen.queryByText("Collected stale tags for Tag Report.")).not.toBeInTheDocument();

    secondRun.resolve(jsonResponse(makeTagReportRunBody("Collected fresh tags for Tag Report.")));
    expect(await screen.findByText("Collected fresh tags for Tag Report.")).toBeInTheDocument();
    expect(screen.getByText("Live API run completed for Tag Report.")).toBeInTheDocument();
  });

  it("does not continue a stale run-both request after a newer run starts", async () => {
    const user = userEvent.setup();
    const runBothCurrent = createDeferred<Response>();
    const newerCurrentRun = createDeferred<Response>();
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockReturnValueOnce(runBothCurrent.promise)
      .mockReturnValueOnce(newerCurrentRun.promise);

    render(<App />);

    await saveBasicBusinessCredentials(user);
    await user.click(screen.getByRole("button", { name: "Scripts" }));
    await user.click(screen.getByLabelText("Enable comparison period"));
    await user.click(screen.getByRole("button", { name: "Run both periods" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    await user.click(screen.getByRole("button", { name: "Run current period" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    await act(async () => {
      runBothCurrent.resolve(jsonResponse(makeTagReportRunBody("Collected stale run-both tags for Tag Report.")));
      await runBothCurrent.promise;
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const status = screen.getByRole("region", { name: "Run status" });
    expect(within(status).getByRole("heading", { name: "Running Tag Report" })).toBeInTheDocument();
    expect(within(status).getByText("Running Tag Report current period live API collection...")).toBeInTheDocument();
    expect(screen.queryByText("Collected stale run-both tags for Tag Report.")).not.toBeInTheDocument();
  });

  it("clears stale running queue messages when switching reports during a pending run", async () => {
    const user = userEvent.setup();
    const pendingRun = createDeferred<Response>();
    vi.spyOn(globalThis, "fetch").mockReturnValue(pendingRun.promise);

    render(<App />);

    await saveBasicBusinessCredentials(user);
    await user.click(screen.getByRole("button", { name: "Scripts" }));
    await user.click(screen.getByRole("button", { name: "Run current period" }));

    expect(await screen.findByText("Running Tag Report current period live API collection...")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Inactive Users" }));

    expect(screen.getByRole("heading", { name: "Inactive Users" })).toBeInTheDocument();
    expect(screen.queryByText("Running Tag Report current period live API collection...")).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Run status" })).not.toBeInTheDocument();

    await act(async () => {
      pendingRun.resolve(jsonResponse(makeTagReportRunBody("Collected stale tags for Tag Report.")));
      await pendingRun.promise;
    });

    expect(screen.queryByText("Running Tag Report current period live API collection...")).not.toBeInTheDocument();
    expect(screen.queryByText("Live API run completed for Tag Report.")).not.toBeInTheDocument();
    expect(screen.queryByText("Collected stale tags for Tag Report.")).not.toBeInTheDocument();
  });

  it("ignores an older live run completion after an upload replaces the run status", async () => {
    const user = userEvent.setup();
    const pendingRun = createDeferred<Response>();
    vi.spyOn(globalThis, "fetch").mockReturnValue(pendingRun.promise);

    render(<App />);

    await saveBasicBusinessCredentials(user);
    await user.click(screen.getByRole("button", { name: "Scripts" }));
    await user.click(screen.getByRole("button", { name: "Run current period" }));
    expect(await screen.findByRole("progressbar", { name: "Tag Report progress" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Uploads" }));
    await user.upload(
      screen.getByLabelText("Upload report outputs"),
      new File([tagMetricsCsv], "tag_metrics.csv", { type: "text/csv" }),
    );

    expect(await screen.findByText("Imported tag_metrics.csv for Tag Report.")).toBeInTheDocument();
    expect(screen.queryByRole("progressbar", { name: "Tag Report progress" })).not.toBeInTheDocument();

    await act(async () => {
      pendingRun.resolve(jsonResponse(makeTagReportRunBody("Collected stale tags for Tag Report.")));
      await pendingRun.promise;
    });

    expect(screen.getByText("Imported tag_metrics.csv for Tag Report.")).toBeInTheDocument();
    expect(screen.queryByText("Live API run completed for Tag Report.")).not.toBeInTheDocument();
    expect(screen.queryByText("Collected stale tags for Tag Report.")).not.toBeInTheDocument();
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
    await user.click(screen.getByRole("button", { name: "Scripts" }));
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
    const fetchMock = mockOAuthEndpoints();

    render(<App />);

    await user.click(screen.getByRole("button", { name: "Credentials" }));
    await user.selectOptions(screen.getByLabelText("Instance type"), "enterprise");
    await user.type(screen.getByLabelText("Instance URL"), "https://demo.stackenterprise.co");
    await user.type(screen.getByLabelText("OAuth Client ID"), "client-123");
    await user.click(screen.getByRole("button", { name: "Connect with Enterprise OAuth" }));

    await waitFor(() => {
      expect(popup.location.href).toBe("https://demo.stackenterprise.co/oauth?state=abc");
    });
    expect(oauthEndpointCallCount(fetchMock, "/api/oauth/pkce/config", "GET")).toBe(1);
    expect(oauthEndpointCallCount(fetchMock, "/api/oauth/pkce/start", "POST")).toBe(1);
    expect(findOAuthStartCall(fetchMock)?.[0]).toBe("/api/oauth/pkce/start");

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

async function saveBasicBusinessCredentials(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "Credentials" }));
  await user.type(screen.getByLabelText("Instance URL"), "https://stackoverflowteams.com/c/example-team");
  await user.type(screen.getByLabelText("Personal access token"), "pat-token");
  await user.click(screen.getByRole("button", { name: "Save session credentials" }));
}

async function openSmeCoverageAnalyzer(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "Utilities" }));
  await user.click(screen.getByRole("button", { name: "SME Coverage Analyzer" }));
}

function makeSmeCoverageRunBody(
  decisionPack: ReturnType<typeof completeSmeCoverageDecisionPack>,
  marker: string,
  empty = false,
) {
  const pagination = { pageCount: empty ? 0 : 1, reachedMaxPages: false, hasMore: false };
  return {
    ok: true as const,
    result: {
      utilityId: "sme-coverage-analyzer" as const,
      utilityTitle: "SME Coverage Analyzer" as const,
      pageSize: decisionPack.snapshot.pageSize,
      maxPagesPerDataset: decisionPack.snapshot.maxPagesPerDataset,
      runPreset: decisionPack.snapshot.runPreset,
      datasets: [
        { datasetName: "tags" as const, records: empty ? [] : [{ name: marker }], pagination },
        { datasetName: "questions" as const, records: empty ? [] : [{ question_id: marker }], pagination },
        { datasetName: "tagSmeCounts" as const, records: empty ? [] : [{ name: marker }], pagination },
      ],
      messages: [],
      warnings: [...decisionPack.warnings],
      decisionPack,
    },
  };
}

function makePersistedUtilitySnapshot(decisionPack: ReturnType<typeof completeSmeCoverageDecisionPack>) {
  return {
    version: 2 as const,
    selectedReportId: "tag-report" as const,
    selectedReportIds: ["tag-report" as const],
    selectedUtilityId: "sme-coverage-analyzer" as const,
    datasets: {},
    reportOutputs: {},
    reportRunSnapshots: [],
    utilityOutputs: {
      "sme-coverage-analyzer": {
        utilityId: "sme-coverage-analyzer" as const,
        loadedAt: "2026-07-30T12:00:00.000Z",
        decisionPack,
      },
    },
    utilityRunSnapshots: [],
    warnings: [],
  };
}

function persistableEmptySmeCoverageDecisionPack(): ReturnType<typeof completeSmeCoverageDecisionPack> {
  return {
    snapshot: {
      instanceHost: "example.stackenterprise.co",
      generatedAt: "2026-07-30T12:00:00.000Z",
      scopeLabel: "All-time demand · Current SME coverage",
      completeness: "Empty",
      pageSize: 100,
      maxPagesPerDataset: 20,
      runPreset: "deep-audit",
    },
    warnings: [],
    summary: {
      tagsAnalyzed: 0,
      tagsWithSmes: 0,
      immediateGaps: 0,
      criticalUnderCoverage: 0,
      lightCoverage: 0,
      unknownRows: 0,
    },
    overview: "No tags were available.",
    assessment: "No assessment can be made.",
    findings: { immediateGaps: [], criticalUnderCoverage: [], lightCoverage: [] },
    methodology: {
      activityQuestionMinimum: 1,
      activityPageViewThresholdExclusive: 25,
      activeTagMedianPageViews: null,
      coveredActiveSampleSize: 0,
      p75PageViewsPerSme: null,
      p90PageViewsPerSme: null,
      percentileSampleSufficient: false,
      ratioFormula: "pageViews / smeCount",
      roundingRule: "Nearest whole page view for display; unrounded for calculation",
    },
    evidence: [],
  };
}

function makeTagReportRunBody(message: string) {
  return {
    ok: true,
    result: {
      reportId: "tag-report",
      reportTitle: "Tag Report",
      periodRole: "current",
      scope: {},
      pageSize: 100,
      maxPagesPerDataset: 20,
      warnings: [],
      datasets: [
        { datasetName: "tags", records: [{ name: "python", totalPageViews: 500, questionCount: 4 }] },
      ],
      messages: [message],
    },
  };
}

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });

  return { promise, resolve, reject };
}

function mockOAuthEndpoints(
  authorizationUrl = "https://demo.stackenterprise.co/oauth?state=abc",
) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    if (String(input) === "/api/oauth/pkce/config") {
      return jsonResponse({
        ok: true,
        redirectUri: "https://utilities.example.com/api/oauth/pkce/callback",
      });
    }
    if (String(input) === "/api/oauth/pkce/start" && init?.method === "POST") {
      return jsonResponse({ ok: true, authorizationUrl });
    }
    throw new Error(`Unexpected fetch: ${String(input)}`);
  });
}

function findOAuthStartCall(fetchMock: ReturnType<typeof mockOAuthEndpoints>) {
  return fetchMock.mock.calls.find(([input, init]) =>
    String(input) === "/api/oauth/pkce/start" && init?.method === "POST");
}

function oauthEndpointCallCount(
  fetchMock: ReturnType<typeof mockOAuthEndpoints>,
  url: string,
  method: "GET" | "POST",
) {
  return fetchMock.mock.calls.filter(([input, init]) =>
    String(input) === url && (init?.method ?? "GET") === method).length;
}
