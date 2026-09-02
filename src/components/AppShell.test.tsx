import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../App";
import type { DatasetName } from "../domain/types";
import { tagMetricsCsv } from "../test/fixtures/reportFixtures";
import {
  completeSmeCoverageDecisionPack,
  emptySmeCoverageDecisionPack,
  insufficientSampleSmeCoverageDecisionPack,
} from "../test/fixtures/smeCoverageFixtures";
import {
  clearPersistedDatasetSession,
  loadPersistedDatasetSession,
  savePersistedDatasetSession,
} from "../utils/browserDatasetStorage";
import {
  deleteContentReplacementJob,
  listContentReplacementJobs,
  loadContentReplacementJob,
  saveContentReplacementJob,
  type ContentReplacementJobSummary,
} from "../utils/browserContentReplacementStorage";
import type { PersistedContentReplacementJob } from "../writeTools/contentReplacement/types";

vi.mock("../utils/browserDatasetStorage", () => ({
  clearPersistedDatasetSession: vi.fn(),
  loadPersistedDatasetSession: vi.fn(),
  savePersistedDatasetSession: vi.fn(),
}));

vi.mock("../utils/browserContentReplacementStorage", async () => {
  const actual = await vi.importActual<typeof import("../utils/browserContentReplacementStorage")>(
    "../utils/browserContentReplacementStorage",
  );
  return {
    ...actual,
    deleteContentReplacementJob: vi.fn(),
    listContentReplacementJobs: vi.fn(),
    loadContentReplacementJob: vi.fn(),
    saveContentReplacementJob: vi.fn(),
  };
});

const loadPersistedDatasetSessionMock = vi.mocked(loadPersistedDatasetSession);
const savePersistedDatasetSessionMock = vi.mocked(savePersistedDatasetSession);
const clearPersistedDatasetSessionMock = vi.mocked(clearPersistedDatasetSession);
const deleteContentReplacementJobMock = vi.mocked(deleteContentReplacementJob);
const listContentReplacementJobsMock = vi.mocked(listContentReplacementJobs);
const loadContentReplacementJobMock = vi.mocked(loadContentReplacementJob);
const saveContentReplacementJobMock = vi.mocked(saveContentReplacementJob);

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
  deleteContentReplacementJobMock.mockResolvedValue(undefined);
  listContentReplacementJobsMock.mockResolvedValue({ jobs: [], totalCount: 0 });
  loadContentReplacementJobMock.mockResolvedValue(null);
  saveContentReplacementJobMock.mockResolvedValue({ status: "saved" });
});

afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe("AppShell", () => {
  it("gives the credentials flow a focused workspace without a catalog sidebar", async () => {
    const user = userEvent.setup();

    render(<App />);
    await user.click(screen.getByRole("button", { name: "Credentials" }));

    expect(
      screen.getByRole("heading", { name: "Connect your Stack environment" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Report Catalog" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Back to scripts" }));

    expect(screen.getByRole("button", { name: "Scripts" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("heading", { name: "Report Catalog" })).toBeInTheDocument();
  });

  it("renders report catalog and all MVP reports", async () => {
    render(<App />);

    expect(screen.getByRole("heading", { name: "Stack API Utilities" })).toBeInTheDocument();
    expect(screen.queryByText("Enterprise API tools")).not.toBeInTheDocument();
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
    const configuredReport = screen.getByRole("region", { name: "Configure Tag Report" });
    expect(within(configuredReport).queryByText("Run scope")).not.toBeInTheDocument();
    expect(
      within(configuredReport).queryByText("StackExchange/so4t_tag_report"),
    ).not.toBeInTheDocument();
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

    expect(screen.getByRole("heading", { name: "Connect your Stack environment" })).toBeInTheDocument();
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
    expect(screen.getByRole("heading", { name: "Configure Tag Report" })).toBeInTheDocument();
    expect(screen.queryByRole("progressbar", { name: "SME Coverage Analyzer progress" })).not.toBeInTheDocument();

    await act(async () => {
      pendingRun.resolve(jsonResponse(makeSmeCoverageRunBody(stalePack, "stale")));
      await pendingRun.promise;
    });

    expect(screen.getByRole("button", { name: "Scripts" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("heading", { name: "Configure Tag Report" })).toBeInTheDocument();
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

  it("posts credentials only, shows progress, and stores the completed utility result", async () => {
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
        }),
      });
    });
    expect(screen.getByRole("progressbar", { name: "SME Coverage Analyzer progress" })).toBeInTheDocument();
    expect(screen.getByText(/server is running the following stages in order/i)).toBeInTheDocument();

    pendingRun.resolve(jsonResponse(makeSmeCoverageRunBody(completeSmeCoverageDecisionPack(), "first")));

    expect(await screen.findByRole("region", { name: "Generated report" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Overview" })).toHaveAttribute("aria-selected", "true");
    await user.click(screen.getByRole("tab", { name: /Priority findings/ }));
    expect(screen.getByRole("heading", { name: "Priority findings" })).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Highest-demand critical gaps" }),
    ).not.toBeInTheDocument();
    expect(screen.getAllByText("Alpha-platform").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("3 datasets")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Datasets" }));
    const datasetsPanel = screen.getByRole("region", { name: "Datasets" });
    expect(within(datasetsPanel).getAllByText("SME Coverage Analyzer")).toHaveLength(3);
  });

  it("renders partial utility evidence notes before the executive summary", async () => {
    const user = userEvent.setup();
    const pack = insufficientSampleSmeCoverageDecisionPack();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse(makeSmeCoverageRunBody(pack, "partial")),
    );

    render(<App />);

    await saveBasicBusinessCredentials(user);
    await openSmeCoverageAnalyzer(user);
    await user.click(screen.getByRole("button", { name: "Run SME coverage analysis" }));

    const evidenceNote = await screen.findByText(pack.warnings[0]!.message);
    const overview = screen.getByText(pack.overview);
    expect(
      evidenceNote.compareDocumentPosition(overview) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("replaces the active utility pack on rerun while retaining six supporting datasets", async () => {
    const user = userEvent.setup();
    const firstPack = completeSmeCoverageDecisionPack();
    const secondPack = persistableEmptySmeCoverageDecisionPack();
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse(makeSmeCoverageRunBody(firstPack, "first")))
      .mockResolvedValueOnce(jsonResponse(makeSmeCoverageRunBody(secondPack, "second", true)));

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
    const freshPack = persistableEmptySmeCoverageDecisionPack();

    render(<App />);

    await saveBasicBusinessCredentials(user);
    await openSmeCoverageAnalyzer(user);
    await user.click(screen.getByRole("button", { name: "Run SME coverage analysis" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    await user.click(screen.getByRole("button", { name: "Scripts" }));
    await openSmeCoverageAnalyzer(user);
    await user.click(screen.getByRole("button", { name: "Run SME coverage analysis" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    newerRun.resolve(jsonResponse(makeSmeCoverageRunBody(freshPack, "fresh", true)));
    expect(await screen.findByText(freshPack.overview)).toBeInTheDocument();

    await act(async () => {
      olderRun.resolve(
        jsonResponse(makeSmeCoverageRunBody(completeSmeCoverageDecisionPack(), "stale")),
      );
      await olderRun.promise;
    });

    expect(screen.getByText(freshPack.overview)).toBeInTheDocument();
    expect(screen.queryByText(completeSmeCoverageDecisionPack().overview)).not.toBeInTheDocument();
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

  it.each([
    ["a missing source dataset", (body: ReturnType<typeof makeSmeCoverageRunBody>) => {
      body.result.datasets = body.result.datasets.slice(0, 2);
    }],
    ["a duplicate source dataset", (body: ReturnType<typeof makeSmeCoverageRunBody>) => {
      body.result.datasets = [...body.result.datasets, body.result.datasets[0]!];
    }],
    ["nonterminal pagination", (body: ReturnType<typeof makeSmeCoverageRunBody>) => {
      body.result.datasets[1] = {
        ...body.result.datasets[1]!,
        pagination: { pageCount: 1, reachedMaxPages: false, hasMore: true },
      };
    }],
    ["malformed pagination", (body: ReturnType<typeof makeSmeCoverageRunBody>) => {
      body.result.datasets[1] = {
        ...body.result.datasets[1]!,
        pagination: { pageCount: -1, reachedMaxPages: false, hasMore: false },
      };
    }],
    ["a malformed decision pack", (body: ReturnType<typeof makeSmeCoverageRunBody>) => {
      body.result.decisionPack = {} as typeof body.result.decisionPack;
    }],
    ["malformed methodology", (body: ReturnType<typeof makeSmeCoverageRunBody>) => {
      body.result.decisionPack = {
        ...body.result.decisionPack,
        methodology: {} as typeof body.result.decisionPack.methodology,
      };
    }],
    ["a malformed evidence row", (body: ReturnType<typeof makeSmeCoverageRunBody>) => {
      body.result.decisionPack = {
        ...body.result.decisionPack,
        evidence: [{}] as unknown as typeof body.result.decisionPack.evidence,
      };
    }],
    ["a negative evidence metric", (body: ReturnType<typeof makeSmeCoverageRunBody>) => {
      mutableSmeDecisionPack(body).evidence[0].pageViews = -1;
    }],
    ["a percentile above 100", (body: ReturnType<typeof makeSmeCoverageRunBody>) => {
      mutableSmeDecisionPack(body).evidence[1].coveragePercentile = 101;
    }],
    ["a summary that does not match the evidence", (body: ReturnType<typeof makeSmeCoverageRunBody>) => {
      mutableSmeDecisionPack(body).summary.tagsAnalyzed += 1;
    }],
    ["a finding that does not match the evidence", (body: ReturnType<typeof makeSmeCoverageRunBody>) => {
      const pack = mutableSmeDecisionPack(body);
      pack.findings.immediateGaps[0] = {
        ...pack.findings.immediateGaps[0],
        reason: "Tampered finding.",
      };
    }],
    ["an invalid evidence tier", (body: ReturnType<typeof makeSmeCoverageRunBody>) => {
      mutableSmeDecisionPack(body).evidence[0].coverageTier = "Impossible";
    }],
    ["incoherent methodology", (body: ReturnType<typeof makeSmeCoverageRunBody>) => {
      mutableSmeDecisionPack(body).methodology.coveredActiveSampleSize += 1;
    }],
    ["an evidence ratio that does not match its inputs", (body: ReturnType<typeof makeSmeCoverageRunBody>) => {
      mutableSmeDecisionPack(body).evidence[1].pageViewsPerSme += 1;
    }],
    ["a completeness label that does not match the evidence", (body: ReturnType<typeof makeSmeCoverageRunBody>) => {
      mutableSmeDecisionPack(body).snapshot.completeness = "Partial";
    }],
    ["source records that do not match the pack", (body: ReturnType<typeof makeSmeCoverageRunBody>) => {
      body.result.datasets[1]!.records = [{ question_id: "tampered", tags: ["unrelated"], view_count: 1 }];
    }],
  ])("fails visibly without publishing a utility result containing %s", async (_label, mutate) => {
    const user = userEvent.setup();
    const body = makeSmeCoverageRunBody(completeSmeCoverageDecisionPack(), "invalid");
    mutate(body);
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse(body));

    render(<App />);

    await saveBasicBusinessCredentials(user);
    await openSmeCoverageAnalyzer(user);
    savePersistedDatasetSessionMock.mockClear();
    await user.click(screen.getByRole("button", { name: "Run SME coverage analysis" }));

    expect(await screen.findByRole("heading", { name: "SME Coverage Analyzer failed" })).toBeInTheDocument();
    expect(screen.getByText(/No complete result was produced\.$/)).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Priority findings" })).not.toBeInTheDocument();
    expect(screen.getByText("0 datasets")).toBeInTheDocument();
    expect(savePersistedDatasetSessionMock).not.toHaveBeenCalled();
  });

  it("hydrates persisted browser datasets without credentials", async () => {
    const user = userEvent.setup();
    loadPersistedDatasetSessionMock.mockResolvedValueOnce({
      version: 3,
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
          pageCount: 1,
          reachedMaxPages: false,
          hasMore: false,
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

  it("restores a selected report date scope without requiring a legacy preset", async () => {
    const user = userEvent.setup();
    const persistedCurrent = makePersistedTagReportRun("current", {}, "snapshot-1", [
      { name: "python", totalPageViews: 500, questionCount: 4 },
    ]);
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse(makeTagReportRunBody("Collected restored-preset tags for Tag Report.")),
    );
    loadPersistedDatasetSessionMock.mockResolvedValueOnce({
      version: 3,
      selectedReportId: "tag-report",
      selectedReportIds: ["tag-report"],
      selectedUtilityId: "sme-coverage-analyzer",
      utilityOutputs: {},
      utilityRunSnapshots: [],
      datasets: persistedCurrent.datasets,
      reportOutputs: {},
      reportRunSnapshots: [persistedCurrent.snapshot],
      warnings: [],
    });

    render(<App />);

    expect(await screen.findByText("7 datasets")).toBeInTheDocument();
    await saveBasicBusinessCredentials(user);
    await user.click(screen.getByRole("button", { name: "Scripts" }));
    await user.click(screen.getByRole("button", { name: "Run current period" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/reports/run", expect.any(Object)));
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toMatchObject({
      periodRole: "current",
      scope: {},
    });
  });

  it("uses restored current and comparison scopes for the next paired Tag Report run", async () => {
    const user = userEvent.setup();
    const currentScope = { startDate: "2026-07-01", endDate: "2026-07-08" };
    const comparisonScope = { startDate: "2026-06-01", endDate: "2026-06-08" };
    const persistedCurrent = makePersistedTagReportRun("current", currentScope, "current-snapshot", [
      { name: "python", totalPageViews: 500, questionCount: 4 },
    ]);
    const persistedComparison = makePersistedTagReportRun("comparison", comparisonScope, "comparison-snapshot", [
      { name: "javascript", totalPageViews: 250, questionCount: 2 },
    ]);
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
      const payload = JSON.parse(String(init?.body));

      return jsonResponse({
        ok: true,
        result: {
          reportId: "tag-report",
          reportTitle: "Tag Report",
          periodRole: payload.periodRole,
          scope: payload.scope,
          warnings: [],
          datasets: makeCompleteTagReportDatasets(
            payload.periodRole === "comparison"
              ? [{ name: "javascript", totalPageViews: 250, questionCount: 2 }]
              : [{ name: "python", totalPageViews: 500, questionCount: 4 }],
          ),
          messages: [`Collected ${payload.periodRole} tags for Tag Report.`],
        },
      });
    });
    loadPersistedDatasetSessionMock.mockResolvedValueOnce({
      version: 3,
      selectedReportId: "tag-report",
      selectedReportIds: ["tag-report"],
      selectedUtilityId: "sme-coverage-analyzer",
      utilityOutputs: {},
      utilityRunSnapshots: [],
      datasets: { ...persistedCurrent.datasets, ...persistedComparison.datasets },
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
      reportRunSnapshots: [persistedCurrent.snapshot, persistedComparison.snapshot],
      warnings: [],
    });

    render(<App />);

    expect(await screen.findByText("14 datasets")).toBeInTheDocument();
    await saveBasicBusinessCredentials(user);
    await user.click(screen.getByRole("button", { name: "Scripts" }));
    await user.click(screen.getByRole("button", { name: "Run both periods" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const currentRunBody = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    const comparisonRunBody = JSON.parse(String(fetchMock.mock.calls[1][1]?.body));
    expect(currentRunBody).toMatchObject({
      periodRole: "current",
      scope: { startDate: "2026-07-01", endDate: "2026-07-08" },
    });
    expect(currentRunBody).not.toHaveProperty("runPreset");
    expect(currentRunBody).not.toHaveProperty("pageSize");
    expect(currentRunBody).not.toHaveProperty("maxPagesPerDataset");
    expect(comparisonRunBody).toMatchObject({
      periodRole: "comparison",
      scope: { startDate: "2026-06-01", endDate: "2026-06-08" },
    });
    expect(comparisonRunBody).not.toHaveProperty("runPreset");
    expect(comparisonRunBody).not.toHaveProperty("pageSize");
    expect(comparisonRunBody).not.toHaveProperty("maxPagesPerDataset");
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
          warnings: [],
          datasets: [
            {
              datasetName: "users",
              records: [{ user_id: 1, display_name: "Ada" }],
              pagination: { pageCount: 1, reachedMaxPages: false, hasMore: false },
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
      version: 3,
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
      version: 3,
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
          pageCount: 1,
          reachedMaxPages: false,
          hasMore: false,
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
          loadedAt: "2026-07-09T12:00:00.000Z",
          datasetIds: ["dataset-1"],
          warnings: [],
        },
      ],
      warnings: [],
    });

    render(<App />);

    expect(await screen.findByText("1 dataset")).toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: "Evidence · 1" }));
    expect(screen.getByText("Ada")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Datasets" }));
    await user.click(screen.getByRole("button", { name: "Flush stored datasets" }));

    expect(screen.getByText("0 datasets")).toBeInTheDocument();
    expect(screen.getByText("No datasets loaded or stored in this browser.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Scripts" }));
    expect(screen.queryByRole("region", { name: "Generated report" })).not.toBeInTheDocument();
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
        version: 3,
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
            pageCount: 1,
            reachedMaxPages: false,
            hasMore: false,
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
        version: 3,
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
            pageCount: 1,
            reachedMaxPages: false,
            hasMore: false,
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
        version: 3,
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
            pageCount: 1,
            reachedMaxPages: false,
            hasMore: false,
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
    expect(screen.getByRole("heading", { name: "Configure Inactive Users" })).toBeInTheDocument();

    await act(async () => {
      loadDeferred.resolve({
        version: 3,
        selectedReportId: "community-members",
        selectedReportIds: ["community-members"],
        selectedUtilityId: "sme-coverage-analyzer",
        utilityOutputs: {},
        utilityRunSnapshots: [],
        datasets: {
          "dataset-communities": {
            id: "dataset-communities",
            snapshotId: "snapshot-1",
            reportId: "community-members",
            name: "communities",
            records: [{ id: 1, value: "persisted" }],
            loadedAt: "2026-07-09T12:00:00.000Z",
            source: "live-api",
            periodRole: "current",
            pageCount: 1,
            reachedMaxPages: false,
            hasMore: false,
          },
          "dataset-users": {
            id: "dataset-users",
            snapshotId: "snapshot-1",
            reportId: "community-members",
            name: "users",
            records: [],
            loadedAt: "2026-07-09T12:00:00.000Z",
            source: "live-api",
            periodRole: "current",
            pageCount: 0,
            reachedMaxPages: false,
            hasMore: false,
          },
        },
        reportOutputs: {
          "community-members": {
            reportId: "community-members",
            datasetName: "communities",
            fileName: "Live API run",
            records: [{ datasetName: "communities", id: 1, value: "persisted" }],
            loadedAt: "2026-07-09T12:00:00.000Z",
            source: "live-api",
            currentSnapshotId: "snapshot-1",
          },
        },
        reportRunSnapshots: [
          {
            id: "snapshot-1",
            reportId: "community-members",
            periodRole: "current",
            scope: {},
            loadedAt: "2026-07-09T12:00:00.000Z",
            datasetIds: ["dataset-communities", "dataset-users"],
            warnings: [],
          },
        ],
        warnings: [],
      });
      await loadDeferred.promise;
      await Promise.resolve();
    });

    expect(screen.getByText("2 datasets")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Inactive Users" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("heading", { name: "Configure Inactive Users" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Community Members" })).toHaveAttribute("aria-pressed", "false");
    expect(clearPersistedDatasetSessionMock).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Datasets" }));

    const datasetsPanel = screen.getByRole("region", { name: "Datasets" });
    expect(within(datasetsPanel).getAllByText("Community Members")).toHaveLength(2);
    expect(within(datasetsPanel).getByText("communities")).toBeInTheDocument();
  });

  it("does not persist an incomplete report run after one required dataset is deleted", async () => {
    const user = userEvent.setup();
    loadPersistedDatasetSessionMock.mockResolvedValueOnce({
      version: 3,
      selectedReportId: "community-members",
      selectedReportIds: ["community-members"],
      selectedUtilityId: "sme-coverage-analyzer",
      utilityOutputs: {},
      utilityRunSnapshots: [],
      datasets: {
        "dataset-users": {
          id: "dataset-users",
          snapshotId: "snapshot-1",
          reportId: "community-members",
          name: "users",
          records: [{ user_id: 1, display_name: "Ada" }],
          loadedAt: "2026-07-09T12:00:00.000Z",
          source: "live-api",
          periodRole: "current",
          scope: { startDate: "2026-06-01", endDate: "2026-06-30" },
          pageCount: 1,
          reachedMaxPages: false,
          hasMore: false,
        },
        "dataset-communities": {
          id: "dataset-communities",
          snapshotId: "snapshot-1",
          reportId: "community-members",
          name: "communities",
          records: [{ name: "python" }],
          loadedAt: "2026-07-09T12:00:00.000Z",
          source: "live-api",
          periodRole: "current",
          scope: { startDate: "2026-06-01", endDate: "2026-06-30" },
          pageCount: 1,
          reachedMaxPages: false,
          hasMore: false,
        },
      },
      reportOutputs: {
        "community-members": {
          reportId: "community-members",
          datasetName: "users",
          fileName: "Live API run",
          records: [
            { datasetName: "users", user_id: 1, display_name: "Ada" },
            { datasetName: "communities", name: "python" },
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
          reportId: "community-members",
          periodRole: "current",
          scope: { startDate: "2026-06-01", endDate: "2026-06-30" },
          loadedAt: "2026-07-09T12:00:00.000Z",
          datasetIds: ["dataset-users", "dataset-communities"],
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
    expect(savedSnapshot?.datasets).toHaveProperty("dataset-communities");
    expect(savedSnapshot?.datasets["dataset-communities"]).not.toHaveProperty("snapshotId");
    expect(savedSnapshot?.datasets).not.toHaveProperty("dataset-users");
    expect(savedSnapshot?.reportOutputs).toEqual({});
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

    expect(screen.getByRole("heading", { name: "Connect your Stack environment" })).toBeInTheDocument();
    const credentialAssurance = screen.getByRole("complementary", {
      name: "Credential privacy and requirements",
    });
    expect(
      within(credentialAssurance).getByText(/they are not written to browser storage/i),
    ).toBeInTheDocument();
    expect(
      within(credentialAssurance).getByText(/API keys persist only when you explicitly save/i),
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

  it("registers Content Replacement immediately after User Group Sync and opens the full wizard", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: "Write Tools" }));
    const catalog = screen.getByRole("heading", { name: "Write Tools" }).closest("section")!;
    const tools = within(catalog).getAllByRole("button");
    expect(tools.map((button) => button.getAttribute("aria-label"))).toEqual([
      "User Group Sync",
      "Content Replacement",
    ]);
    expect(within(tools[1]).getByText("Enterprise main site")).toBeVisible();
    expect(within(tools[1]).getByText("Preview required")).toBeVisible();

    await user.click(tools[1]);
    expect(screen.getByRole("heading", { name: "Content Replacement", level: 1 })).toBeVisible();
    const progress = screen.getByRole("list", { name: "Content replacement progress" });
    expect(within(progress).getByText("Define", { selector: "[aria-current='step']" })).toBeVisible();
    expect(progress).toHaveTextContent("Scan");
    expect(progress).toHaveTextContent("Review");
    expect(progress).toHaveTextContent("Apply");
  });

  it("does not abort a newly created scan when controlled job identity feeds back from App", async () => {
    const user = userEvent.setup();
    const popup = createPopup();
    const firstScan = createDeferred<Response>();
    const scanAbort = vi.fn();
    let storedJob: PersistedContentReplacementJob | null = null;
    saveContentReplacementJobMock.mockImplementation(async (job) => {
      storedJob = job;
      return { status: "saved" };
    });
    loadContentReplacementJobMock.mockImplementation(async (id) => storedJob?.id === id ? storedJob : null);
    vi.spyOn(window, "open").mockReturnValue(popup as unknown as Window);
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      if (String(input) === "/api/oauth/pkce/config") {
        return jsonResponse({ ok: true, redirectUri: "https://utilities.example.com/api/oauth/pkce/callback" });
      }
      if (String(input) === "/api/oauth/pkce/start") {
        return jsonResponse({ ok: true, authorizationUrl: "https://demo.stackenterprise.co/oauth?state=create-scan" });
      }
      if (String(input) === "/api/write-tools/content-replacement/scan") {
        const signal = init?.signal;
        signal?.addEventListener("abort", scanAbort);
        const body = JSON.parse(String(init?.body)) as { cursor?: { kind: "questions" | "answers" | "articles" | "search" } };
        if (fetchMock.mock.calls.filter(([url]) => String(url) === "/api/write-tools/content-replacement/scan").length === 1) {
          return firstScan.promise;
        }
        return jsonResponse({
          ok: true,
          result: {
            candidates: [], answerCursors: [], nextCursor: null, inspectedCount: 0,
            pageKind: body.cursor?.kind ?? "questions",
            progress: {
              apiRequestsCompleted: 1,
              searchPages: body.cursor?.kind === "search" ? 1 : 0,
              searchTermsCompleted: body.cursor?.kind === "search" ? 1 : 0,
              answerBearingQuestionsQueued: 0,
              zeroAnswerQuestionsSkipped: 0,
            },
          },
          throttleNotices: [],
        });
      }
      throw new Error(`Unexpected fetch: ${String(input)}`);
    });

    render(<App />);
    await user.click(screen.getByRole("button", { name: "Write Tools" }));
    await user.click(screen.getByRole("button", { name: "Content Replacement" }));
    await user.click(screen.getByRole("button", { name: "Credentials" }));
    await user.selectOptions(screen.getByLabelText("Instance type"), "enterprise");
    await user.type(screen.getByLabelText("Instance URL"), "https://demo.stackenterprise.co");
    await user.type(screen.getByLabelText("OAuth Client ID"), "client-123");
    await user.click(screen.getByRole("button", { name: "Connect with Enterprise OAuth" }));
    act(() => {
      window.dispatchEvent(new MessageEvent("message", {
        origin: window.location.origin,
        source: popup as unknown as MessageEventSource,
        data: {
          type: "stack-api-oauth-pkce-result",
          ok: true,
          credential: {
            instanceType: "enterprise", baseUrl: "https://demo.stackenterprise.co",
            accessToken: "oauth-token", authSource: "oauth-pkce", oauthClientId: "client-123",
            oauthScopes: ["write_access", "no_expiry"],
          },
        },
      }));
    });
    expect(await screen.findByText("Credentials saved for this browser session.")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Write Tools" }));
    await user.type(screen.getByLabelText("Find term 1"), "Old term");
    await user.type(screen.getByLabelText("Replace term 1 with"), "New term");
    await user.click(screen.getByRole("button", { name: "Review rules" }));
    const startScanButton = screen.getByRole("button", { name: "Start scan" });
    expect(startScanButton).toBeEnabled();
    await user.click(startScanButton);

    await waitFor(() => expect(saveContentReplacementJobMock).toHaveBeenCalled());
    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) =>
      String(url) === "/api/write-tools/content-replacement/scan")).toBe(true));
    expect(loadContentReplacementJobMock).not.toHaveBeenCalled();
    await act(async () => { await Promise.resolve(); });
    expect(scanAbort).not.toHaveBeenCalled();

    firstScan.resolve(jsonResponse({
      ok: true,
      result: {
        candidates: [], answerCursors: [], nextCursor: null, inspectedCount: 0,
        pageKind: "search",
        progress: {
          apiRequestsCompleted: 1,
          searchPages: 1,
          searchTermsCompleted: 1,
          answerBearingQuestionsQueued: 0,
          zeroAnswerQuestionsSkipped: 0,
        },
      },
      throttleNotices: [],
    }));
    await waitFor(() => expect(storedJob?.status).toBe("completed"));
    expect(screen.getByRole("heading", { name: "Scan content" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "User Group Sync" }));
    await user.click(screen.getByRole("button", { name: "Content Replacement" }));
    expect(await screen.findByRole("heading", { name: "Scan content" })).toBeVisible();
    expect(loadContentReplacementJobMock).toHaveBeenCalledWith(storedJob!.id);
  });

  it("keeps a job opened from Define selected across write-tool remounts", async () => {
    const user = userEvent.setup();
    const job = contentReplacementJob({ id: "job-from-define", stage: "scan", status: "paused" });
    listContentReplacementJobsMock.mockResolvedValue({ jobs: [contentReplacementSummary(job)], totalCount: 1 });
    loadContentReplacementJobMock.mockImplementation(async (id) => id === job.id ? job : null);

    render(<App />);
    await user.click(screen.getByRole("button", { name: "Write Tools" }));
    await user.click(screen.getByRole("button", { name: "Content Replacement" }));
    await user.click(await screen.findByRole("button", { name: `Resume content replacement job ${job.id}` }));
    expect(await screen.findByRole("heading", { name: "Scan content" })).toBeVisible();

    await user.click(screen.getByRole("button", { name: "User Group Sync" }));
    await user.click(screen.getByRole("button", { name: "Content Replacement" }));

    expect(await screen.findByRole("heading", { name: "Scan content" })).toBeVisible();
    expect(loadContentReplacementJobMock).toHaveBeenCalledWith(job.id);
  });

  it("keeps a job opened from Datasets selected across panel remounts", async () => {
    const user = userEvent.setup();
    const job = contentReplacementJob({ id: "job-from-datasets", stage: "scan", status: "paused" });
    listContentReplacementJobsMock.mockResolvedValue({ jobs: [contentReplacementSummary(job)], totalCount: 1 });
    loadContentReplacementJobMock.mockImplementation(async (id) => id === job.id ? job : null);

    render(<App />);
    await user.click(screen.getByRole("button", { name: "Datasets" }));
    await user.click(await screen.findByRole("button", { name: `Resume content replacement job ${job.id}` }));
    expect(await screen.findByRole("heading", { name: "Scan content" })).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Scripts" }));
    await user.click(screen.getByRole("button", { name: "Write Tools" }));

    expect(await screen.findByRole("heading", { name: "Scan content" })).toBeVisible();
  });

  it("clears App selection when the Define job manager deletes the selected job", async () => {
    const user = userEvent.setup();
    const job = contentReplacementJob({ id: "delete-from-define", stage: "review", status: "completed" });
    listContentReplacementJobsMock.mockResolvedValue({ jobs: [contentReplacementSummary(job)], totalCount: 1 });
    loadContentReplacementJobMock.mockImplementation(async (id) => id === job.id ? job : null);

    render(<App />);
    await user.click(screen.getByRole("button", { name: "Datasets" }));
    await user.click(await screen.findByRole("button", { name: `Resume content replacement job ${job.id}` }));
    expect(await screen.findByRole("heading", { name: "Review proposed changes" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Edit configuration" }));
    await user.click(screen.getByRole("button", { name: "Create a new job" }));
    await user.click(await screen.findByRole("button", { name: `Delete content replacement job ${job.id}` }));
    await user.click(screen.getByRole("button", { name: `Confirm delete ${job.id}` }));
    await waitFor(() => expect(deleteContentReplacementJobMock).toHaveBeenCalledWith(job.id));

    await user.click(screen.getByRole("button", { name: "User Group Sync" }));
    await user.click(screen.getByRole("button", { name: "Content Replacement" }));

    expect(await screen.findByRole("heading", { name: "Define replacements" })).toBeVisible();
    expect(screen.queryByRole("heading", { name: "Review proposed changes" })).not.toBeInTheDocument();
  });

  it("does not resurrect a job deleted from Apply after the wizard remounts", async () => {
    const user = userEvent.setup();
    const job = contentReplacementJob({ id: "delete-from-apply", stage: "results", status: "completed" });
    listContentReplacementJobsMock.mockResolvedValue({ jobs: [contentReplacementSummary(job)], totalCount: 1 });
    loadContentReplacementJobMock.mockImplementation(async (id) => id === job.id ? job : null);

    render(<App />);
    await user.click(screen.getByRole("button", { name: "Datasets" }));
    await user.click(await screen.findByRole("button", { name: `Resume content replacement job ${job.id}` }));
    expect(await screen.findByRole("heading", { name: "Apply results" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Delete entire local job" }));
    await user.click(screen.getByRole("button", { name: "Confirm delete entire local job" }));
    await waitFor(() => expect(deleteContentReplacementJobMock).toHaveBeenCalledWith(job.id));

    await user.click(screen.getByRole("button", { name: "User Group Sync" }));
    await user.click(screen.getByRole("button", { name: "Content Replacement" }));

    expect(await screen.findByRole("heading", { name: "Define replacements" })).toBeVisible();
    expect(screen.queryByRole("heading", { name: "Apply results" })).not.toBeInTheDocument();
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
    expect(
      within(screen.getByRole("region", { name: "Tag Report result" })).getByRole("heading", {
        name: "Tag Report result",
      }),
    ).toBeInTheDocument();
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
    expect(screen.getByRole("heading", { name: "Connect your Stack environment" })).toBeInTheDocument();
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
          warnings: [],
          datasets: [
            {
              datasetName: "users",
              records: [{ user_id: 1, display_name: "Ada" }],
              pagination: { pageCount: 1, reachedMaxPages: false, hasMore: false },
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
    await user.type(screen.getByLabelText("Current start date"), "2026-06-01");
    await user.type(screen.getByLabelText("Current end date"), "2026-06-30");
    await user.click(screen.getByRole("button", { name: "Run current period" }));

    expect(await screen.findByText("Live API run completed for Inactive Users.")).toBeInTheDocument();
    expect(fetchMock.mock.calls[0][0]).toBe("/api/reports/run");
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({
      reportId: "inactive-users",
      credentials: basicBusinessPatCredentials,
      periodRole: "current",
      scope: { startDate: "2026-06-01", endDate: "2026-06-30" },
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
    await user.click(screen.getByRole("tab", { name: "Evidence · 1" }));

    expect(screen.getByText("Ada")).toBeInTheDocument();
  });

  it("omits a cleared date from the requested and returned report scope", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse(makeInactiveUsersReportRunBody("current", {})),
    );

    render(<App />);

    await user.click(screen.getByRole("button", { name: "Inactive Users" }));
    await saveBasicBusinessCredentials(user);
    await user.click(screen.getByRole("button", { name: "Scripts" }));
    const startDate = screen.getByLabelText("Current start date");
    await user.type(startDate, "2026-06-01");
    await user.clear(startDate);
    await user.click(screen.getByRole("button", { name: "Run current period" }));

    expect(await screen.findByText("Live API run completed for Inactive Users.")).toBeInTheDocument();
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toMatchObject({ scope: {} });
    expect(screen.getByText("1 dataset")).toBeInTheDocument();
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
          warnings: [
            {
              reportId: "tag-report",
              code: "dataset-page-cap",
              message: "Questions hit the configured page cap; results may be partial.",
            },
          ],
          datasets: [
            { datasetName: "tags", records: [{ name: "python", totalPageViews: 500, questionCount: 4 }], pagination: { pageCount: 1, reachedMaxPages: false, hasMore: false } },
            { datasetName: "users", records: [{ user_id: 1 }], pagination: { pageCount: 1, reachedMaxPages: false, hasMore: false } },
            { datasetName: "questions", records: [{ question_id: 10, tags: ["python"], answer_count: 1 }], pagination: { pageCount: 1, reachedMaxPages: false, hasMore: false } },
            { datasetName: "articles", records: [{ article_id: 20 }], pagination: { pageCount: 1, reachedMaxPages: false, hasMore: false } },
            { datasetName: "tagSmes", records: [{ tagName: "python", user_id: 1 }], pagination: { pageCount: 1, reachedMaxPages: false, hasMore: false } },
            { datasetName: "tagSmeCounts", records: [], pagination: { pageCount: 0, reachedMaxPages: false, hasMore: false } },
            { datasetName: "tagLastUsed", records: [], pagination: { pageCount: 0, reachedMaxPages: false, hasMore: false } },
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
    await user.click(screen.getByRole("button", { name: "Run current period" }));

    expect(await screen.findByText("Live API run completed for Tag Report.")).toBeInTheDocument();
    expect(fetchMock.mock.calls[0][0]).toBe("/api/reports/run");
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({
      reportId: "tag-report",
      credentials: basicBusinessPatCredentials,
      periodRole: "current",
      scope: {},
    });
    expect(screen.getByText("7 datasets")).toBeInTheDocument();
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
      within(status).getByText("Collecting all available data for Tag Report…"),
    ).toBeInTheDocument();

    pendingRun.resolve(jsonResponse({
      ok: true,
      result: {
        reportId: "tag-report",
        reportTitle: "Tag Report",
        periodRole: "current",
        scope: {},
        warnings: [],
        datasets: makeCompleteTagReportDatasets([
          { name: "python", totalPageViews: 500, questionCount: 4 },
        ]),
        messages: ["Collected tags (1 record) for Tag Report."],
      },
    }));
    expect(await screen.findByText("Live API run completed for Tag Report.")).toBeInTheDocument();
  });

  it.each([
    ["Collection failed.", "Collection failed. No complete result was produced."],
    [
      "Collection failed. No complete result was produced.",
      "Collection failed. No complete result was produced.",
    ],
    [
      "No complete result was produced. Upstream timeout.",
      "Upstream timeout. No complete result was produced.",
    ],
  ])("ends report errors with a single completion disclaimer", async (error, expectedMessage) => {
    const user = userEvent.setup();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ ok: false, error }));

    render(<App />);

    await saveBasicBusinessCredentials(user);
    await user.click(screen.getByRole("button", { name: "Scripts" }));
    await user.click(screen.getByRole("button", { name: "Run current period" }));

    expect(await screen.findByText(expectedMessage)).toBeInTheDocument();
    expect(screen.getByText(expectedMessage).textContent?.match(/No complete result was produced\./g)).toHaveLength(1);
  });

  it.each([
    ["missing pagination", undefined],
    ["more pages available", { pageCount: 1, reachedMaxPages: false, hasMore: true }],
    ["page limit reached", { pageCount: 1, reachedMaxPages: true, hasMore: false }],
    ["a negative page count", { pageCount: -1, reachedMaxPages: false, hasMore: false }],
  ])("rejects a successful report response with %s evidence", async (_label, pagination) => {
    const user = userEvent.setup();
    const datasets = makeCompleteTagReportDatasets([{ name: "python" }]);
    if (pagination) {
      datasets[0]!.pagination = pagination;
    } else {
      delete (datasets[0] as Partial<(typeof datasets)[number]>).pagination;
    }
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({
        ok: true,
        result: {
          reportId: "tag-report",
          reportTitle: "Tag Report",
          periodRole: "current",
          scope: {},
          warnings: [],
          datasets,
          messages: ["Collected tags for Tag Report."],
        },
      }),
    );

    render(<App />);

    await saveBasicBusinessCredentials(user);
    await user.click(screen.getByRole("button", { name: "Scripts" }));
    savePersistedDatasetSessionMock.mockClear();
    await user.click(screen.getByRole("button", { name: "Run current period" }));

    const status = await screen.findByRole("region", { name: "Run status" });
    expect(within(status).getByRole("heading", { name: "Tag Report run failed" })).toBeInTheDocument();
    expect(within(status).getByText(/No complete result was produced\.$/)).toBeInTheDocument();
    expect(screen.queryByText("Live API run completed for Tag Report.")).not.toBeInTheDocument();
    expect(screen.getByText("0 datasets")).toBeInTheDocument();
    expect(savePersistedDatasetSessionMock).not.toHaveBeenCalled();
  });

  it("rejects a successful report response with no datasets", async () => {
    const user = userEvent.setup();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({
        ok: true,
        result: {
          reportId: "tag-report",
          reportTitle: "Tag Report",
          periodRole: "current",
          scope: {},
          warnings: [],
          datasets: [],
          messages: [],
        },
      }),
    );

    render(<App />);

    await saveBasicBusinessCredentials(user);
    await user.click(screen.getByRole("button", { name: "Scripts" }));
    savePersistedDatasetSessionMock.mockClear();
    await user.click(screen.getByRole("button", { name: "Run current period" }));

    const status = await screen.findByRole("region", { name: "Run status" });
    expect(within(status).getByRole("heading", { name: "Tag Report run failed" })).toBeInTheDocument();
    expect(within(status).getByText(/No complete result was produced\.$/)).toBeInTheDocument();
    expect(screen.queryByText("Live API run completed for Tag Report.")).not.toBeInTheDocument();
    expect(screen.getByText("0 datasets")).toBeInTheDocument();
    expect(savePersistedDatasetSessionMock).not.toHaveBeenCalled();
  });

  it("rejects all datasets when one dataset has invalid pagination evidence", async () => {
    const user = userEvent.setup();
    const datasets = makeCompleteTagReportDatasets([{ name: "python" }]);
    datasets.find((dataset) => dataset.datasetName === "questions")!.pagination = {
      pageCount: 1,
      reachedMaxPages: false,
      hasMore: true,
    };
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({
        ok: true,
        result: {
          reportId: "tag-report",
          reportTitle: "Tag Report",
          periodRole: "current",
          scope: {},
          warnings: [],
          datasets,
          messages: ["Collected tags for Tag Report.", "Collected questions for Tag Report."],
        },
      }),
    );

    render(<App />);

    await saveBasicBusinessCredentials(user);
    await user.click(screen.getByRole("button", { name: "Scripts" }));
    savePersistedDatasetSessionMock.mockClear();
    await user.click(screen.getByRole("button", { name: "Run current period" }));

    const status = await screen.findByRole("region", { name: "Run status" });
    expect(within(status).getByRole("heading", { name: "Tag Report run failed" })).toBeInTheDocument();
    expect(within(status).getByText(/No complete result was produced\.$/)).toBeInTheDocument();
    expect(screen.queryByText("Live API run completed for Tag Report.")).not.toBeInTheDocument();
    expect(screen.getByText("0 datasets")).toBeInTheDocument();
    expect(savePersistedDatasetSessionMock).not.toHaveBeenCalled();
  });

  it.each([
    ["a missing required dataset", (body: ReturnType<typeof makeInactiveUsersReportRunBody>) => {
      body.result.datasets = [];
    }],
    ["a duplicate required dataset", (body: ReturnType<typeof makeInactiveUsersReportRunBody>) => {
      body.result.datasets = [...body.result.datasets, body.result.datasets[0]!];
    }],
    ["an extra dataset", (body: ReturnType<typeof makeInactiveUsersReportRunBody>) => {
      body.result.datasets.push({
        datasetName: "tags",
        records: [],
        pagination: { pageCount: 0, reachedMaxPages: false, hasMore: false },
      } as unknown as (typeof body.result.datasets)[number]);
    }],
    ["the wrong report", (body: ReturnType<typeof makeInactiveUsersReportRunBody>) => {
      body.result.reportId = "tag-report";
    }],
    ["the wrong period role", (body: ReturnType<typeof makeInactiveUsersReportRunBody>) => {
      body.result.periodRole = "comparison";
    }],
    ["the wrong scope", (body: ReturnType<typeof makeInactiveUsersReportRunBody>) => {
      body.result.scope = { startDate: "2025-01-01" };
    }],
    ["malformed records", (body: ReturnType<typeof makeInactiveUsersReportRunBody>) => {
      body.result.datasets[0]!.records = null as unknown as { user_id: number }[];
    }],
    ["malformed messages", (body: ReturnType<typeof makeInactiveUsersReportRunBody>) => {
      body.result.messages = null as unknown as string[];
    }],
  ])("rejects a report success envelope containing %s", async (_label, mutate) => {
    const user = userEvent.setup();
    const body = makeInactiveUsersReportRunBody("current", {});
    mutate(body);
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse(body));

    render(<App />);

    await user.click(screen.getByRole("button", { name: "Inactive Users" }));
    await saveBasicBusinessCredentials(user);
    await user.click(screen.getByRole("button", { name: "Scripts" }));
    savePersistedDatasetSessionMock.mockClear();
    await user.click(screen.getByRole("button", { name: "Run current period" }));

    const status = await screen.findByRole("region", { name: "Run status" });
    expect(within(status).getByRole("heading", { name: "Inactive Users run failed" })).toBeInTheDocument();
    expect(within(status).getByText(/No complete result was produced\.$/)).toBeInTheDocument();
    expect(screen.getByText("0 datasets")).toBeInTheDocument();
    expect(savePersistedDatasetSessionMock).not.toHaveBeenCalled();
  });

  it("accepts the known synthetic output dataset for the Interactions report", async () => {
    const user = userEvent.setup();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({
      ok: true,
      result: {
        reportId: "interactions",
        reportTitle: "Interactions",
        periodRole: "current",
        scope: {},
        warnings: [],
        datasets: ["users", "questions", "answers", "comments", "interactions"].map((datasetName) => ({
          datasetName,
          records: [],
          pagination: { pageCount: 0, reachedMaxPages: false, hasMore: false },
        })),
        messages: ["Built interactions (0 records) for Interactions."],
      },
    }));

    render(<App />);

    await user.click(screen.getByRole("button", { name: "Interactions" }));
    await saveBasicBusinessCredentials(user);
    await user.click(screen.getByRole("button", { name: "Scripts" }));
    await user.click(screen.getByRole("button", { name: "Run current period" }));

    expect(await screen.findByText("Live API run completed for Interactions.")).toBeInTheDocument();
    expect(screen.getByText("5 datasets")).toBeInTheDocument();
  });

  it("does not request a comparison period when the current period fails", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({ ok: false, error: "Current collection failed." }),
    );

    render(<App />);

    await user.click(screen.getByRole("button", { name: "Inactive Users" }));
    await saveBasicBusinessCredentials(user);
    await user.click(screen.getByRole("button", { name: "Scripts" }));
    await user.click(screen.getByLabelText("Enable comparison period"));
    savePersistedDatasetSessionMock.mockClear();
    await user.click(screen.getByRole("button", { name: "Run both periods" }));

    expect(await screen.findByRole("heading", { name: "Inactive Users run failed" })).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(screen.getByText("0 datasets")).toBeInTheDocument();
    expect(savePersistedDatasetSessionMock).not.toHaveBeenCalled();
  });

  it("publishes neither period when comparison fails after current is staged", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse(makeInactiveUsersReportRunBody("current", {})))
      .mockResolvedValueOnce(jsonResponse({ ok: false, error: "Comparison collection failed." }));

    render(<App />);

    await user.click(screen.getByRole("button", { name: "Inactive Users" }));
    await saveBasicBusinessCredentials(user);
    await user.click(screen.getByRole("button", { name: "Scripts" }));
    await user.click(screen.getByLabelText("Enable comparison period"));
    savePersistedDatasetSessionMock.mockClear();
    await user.click(screen.getByRole("button", { name: "Run both periods" }));

    expect(await screen.findByRole("heading", { name: "Inactive Users run failed" })).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(screen.getByText("0 datasets")).toBeInTheDocument();
    expect(screen.queryByText("Live API run completed for Inactive Users.")).not.toBeInTheDocument();
    expect(savePersistedDatasetSessionMock).not.toHaveBeenCalled();
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
    expect(within(status).getByText("Collecting all available data for Tag Report…")).toBeInTheDocument();
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
    expect(within(status).getByText("Collecting all available data for Tag Report…")).toBeInTheDocument();
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

    expect(await screen.findByText("Collecting all available data for Tag Report…")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Inactive Users" }));

    expect(screen.getByRole("heading", { name: "Configure Inactive Users" })).toBeInTheDocument();
    expect(screen.queryByText("Collecting all available data for Tag Report…")).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Run status" })).not.toBeInTheDocument();

    await act(async () => {
      pendingRun.resolve(jsonResponse(makeTagReportRunBody("Collected stale tags for Tag Report.")));
      await pendingRun.promise;
    });

    expect(screen.queryByText("Collecting all available data for Tag Report…")).not.toBeInTheDocument();
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
              pagination: { pageCount: 1, reachedMaxPages: false, hasMore: false },
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
    expect(screen.getByText("2 datasets")).toBeInTheDocument();
    expect(screen.getByText("Live API run completed for Inactive Users.")).toBeInTheDocument();
    await waitFor(() => expect(savePersistedDatasetSessionMock).toHaveBeenCalled());
    const saveCalls = savePersistedDatasetSessionMock.mock.calls;
    const saved = saveCalls[saveCalls.length - 1]?.[0];
    expect(saved?.reportRunSnapshots.map((snapshot) => snapshot.periodRole)).toEqual(["current", "comparison"]);
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
  const evidence = empty ? [] : decisionPack.evidence;
  const tags = evidence.map((row) => ({ name: row.tagName, count: row.questionCount ?? 0 }));
  const questions = evidence.flatMap((row, rowIndex) => {
    if (
      row.demandQuality !== "Complete" ||
      !Number.isInteger(row.questionCount) ||
      row.questionCount === null ||
      row.questionCount < 0 ||
      row.pageViews === null
    ) {
      return [];
    }
    return Array.from({ length: row.questionCount }, (_, questionIndex) => ({
      question_id: `${marker}-${rowIndex}-${questionIndex}`,
      tags: [row.tagName],
      view_count: questionIndex === 0 ? row.pageViews : 0,
    }));
  });
  const tagSmeCounts = evidence.flatMap((row) => row.smeCount === null
    ? []
    : [{ name: row.tagName, subjectMatterExpertCount: row.smeCount }]);
  return {
    ok: true as const,
    result: {
      utilityId: "sme-coverage-analyzer" as const,
      utilityTitle: "SME Coverage Analyzer" as const,
      datasets: [
        { datasetName: "tags" as const, records: tags, pagination },
        { datasetName: "questions" as const, records: questions, pagination },
        { datasetName: "tagSmeCounts" as const, records: tagSmeCounts, pagination },
      ],
      messages: [],
      warnings: [...decisionPack.warnings],
      decisionPack,
    },
  };
}

function mutableSmeDecisionPack(body: ReturnType<typeof makeSmeCoverageRunBody>): Record<string, any> {
  const decisionPack = structuredClone(body.result.decisionPack);
  body.result.decisionPack = decisionPack;
  return decisionPack as unknown as Record<string, any>;
}

function makePersistedUtilitySnapshot(decisionPack: ReturnType<typeof completeSmeCoverageDecisionPack>) {
  const loadedAt = "2026-07-30T12:00:00.000Z";
  const snapshotId = "utility-snapshot";
  const pagination = { pageCount: 0, reachedMaxPages: false, hasMore: false };
  const datasets = {
    "utility-tags": {
      id: "utility-tags",
      snapshotId,
      utilityId: "sme-coverage-analyzer" as const,
      name: "tags" as const,
      records: [],
      loadedAt,
      source: "live-api" as const,
      ...pagination,
    },
    "utility-questions": {
      id: "utility-questions",
      snapshotId,
      utilityId: "sme-coverage-analyzer" as const,
      name: "questions" as const,
      records: [],
      loadedAt,
      source: "live-api" as const,
      ...pagination,
    },
    "utility-tag-sme-counts": {
      id: "utility-tag-sme-counts",
      snapshotId,
      utilityId: "sme-coverage-analyzer" as const,
      name: "tagSmeCounts" as const,
      records: [],
      loadedAt,
      source: "live-api" as const,
      ...pagination,
    },
  };
  return {
    version: 3 as const,
    selectedReportId: "tag-report" as const,
    selectedReportIds: ["tag-report" as const],
    selectedUtilityId: "sme-coverage-analyzer" as const,
    datasets,
    reportOutputs: {},
    reportRunSnapshots: [],
    utilityOutputs: {
      "sme-coverage-analyzer": {
        utilityId: "sme-coverage-analyzer" as const,
        loadedAt,
        decisionPack,
      },
    },
    utilityRunSnapshots: [{
      id: snapshotId,
      utilityId: "sme-coverage-analyzer" as const,
      loadedAt,
      datasetIds: Object.keys(datasets),
      warnings: [],
    }],
    warnings: [],
  };
}

function persistableEmptySmeCoverageDecisionPack(): ReturnType<typeof completeSmeCoverageDecisionPack> {
  return emptySmeCoverageDecisionPack();
}

function makeTagReportRunBody(message: string) {
  return {
    ok: true,
    result: {
      reportId: "tag-report",
      reportTitle: "Tag Report",
      periodRole: "current",
      scope: {},
      warnings: [],
      datasets: [
        {
          datasetName: "tags",
          records: [{ name: "python", totalPageViews: 500, questionCount: 4 }],
          pagination: { pageCount: 1, reachedMaxPages: false, hasMore: false },
        },
        { datasetName: "users", records: [], pagination: { pageCount: 0, reachedMaxPages: false, hasMore: false } },
        { datasetName: "questions", records: [], pagination: { pageCount: 0, reachedMaxPages: false, hasMore: false } },
        { datasetName: "articles", records: [], pagination: { pageCount: 0, reachedMaxPages: false, hasMore: false } },
        { datasetName: "tagSmes", records: [], pagination: { pageCount: 0, reachedMaxPages: false, hasMore: false } },
        { datasetName: "tagSmeCounts", records: [], pagination: { pageCount: 0, reachedMaxPages: false, hasMore: false } },
        { datasetName: "tagLastUsed", records: [], pagination: { pageCount: 0, reachedMaxPages: false, hasMore: false } },
      ],
      messages: [message],
    },
  };
}

function makeCompleteTagReportDatasets(
  tagRecords: Record<string, unknown>[],
  tagPagination = { pageCount: 1, reachedMaxPages: false, hasMore: false },
): Array<{
  datasetName: DatasetName;
  records: Record<string, unknown>[];
  pagination: { pageCount: number; reachedMaxPages: boolean; hasMore: boolean };
}> {
  const emptyPagination = { pageCount: 0, reachedMaxPages: false, hasMore: false };
  return [
    { datasetName: "tags", records: tagRecords, pagination: tagPagination },
    { datasetName: "users", records: [], pagination: emptyPagination },
    { datasetName: "questions", records: [], pagination: emptyPagination },
    { datasetName: "articles", records: [], pagination: emptyPagination },
    { datasetName: "tagSmes", records: [], pagination: emptyPagination },
    { datasetName: "tagSmeCounts", records: [], pagination: emptyPagination },
    { datasetName: "tagLastUsed", records: [], pagination: emptyPagination },
  ];
}

function makePersistedTagReportRun(
  periodRole: "current" | "comparison",
  scope: { startDate?: string; endDate?: string },
  snapshotId: string,
  tagRecords: Record<string, unknown>[],
) {
  const loadedAt = "2026-07-09T12:00:00.000Z";
  const datasets = Object.fromEntries(
    makeCompleteTagReportDatasets(tagRecords).map((dataset) => {
      const id = `${snapshotId}-${dataset.datasetName}`;
      return [id, {
        id,
        snapshotId,
        reportId: "tag-report" as const,
        name: dataset.datasetName,
        records: dataset.records,
        loadedAt,
        source: "live-api" as const,
        periodRole,
        scope,
        pageCount: dataset.pagination.pageCount,
        reachedMaxPages: dataset.pagination.reachedMaxPages,
        hasMore: dataset.pagination.hasMore,
      }];
    }),
  );
  return {
    datasets,
    snapshot: {
      id: snapshotId,
      reportId: "tag-report" as const,
      periodRole,
      scope,
      loadedAt,
      datasetIds: Object.keys(datasets),
      warnings: [],
    },
  };
}

function makeInactiveUsersReportRunBody(
  periodRole: "current" | "comparison",
  scope: { startDate?: string; endDate?: string },
) {
  return {
    ok: true as const,
    result: {
      reportId: "inactive-users" as "inactive-users" | "tag-report",
      reportTitle: "Inactive Users",
      periodRole,
      scope,
      warnings: [],
      datasets: [
        {
          datasetName: "users",
          records: [{ user_id: periodRole === "current" ? 1 : 2 }],
          pagination: { pageCount: 1, reachedMaxPages: false, hasMore: false },
        },
      ],
      messages: [`Collected users for ${periodRole}.`],
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

function contentReplacementJob(
  overrides: Partial<PersistedContentReplacementJob> = {},
): PersistedContentReplacementJob {
  return {
    schemaVersion: 1,
    revision: 0,
    id: "content-replacement-job",
    fingerprint: "f".repeat(64),
    baseUrl: "https://example.stackenterprise.co",
    target: { kind: "enterprise-main" },
    configuration: {
      target: { kind: "enterprise-main" },
      contentTypes: { questions: true, answers: true, articles: true },
      discovery: { mode: "full" },
      rules: [{ id: "rule-1", find: "Old term", replace: "New term" }],
      options: { caseSensitive: true, wholeTerm: true, replaceInCode: false },
    },
    stage: "scan",
    status: "paused",
    inventoryQueue: [],
    detailQueue: [],
    progress: {
      apiRequestsCompleted: 0,
      questionPages: 0,
      answerPages: 0,
      articlePages: 0,
      searchPages: 0,
      searchTermsCompleted: 0,
      indexedReferences: 0,
      answerBearingQuestionsQueued: 0,
      zeroAnswerQuestionsSkipped: 0,
      inventoryItems: 0,
      detailsInspected: 0,
      proposalsFound: 0,
      protectedOccurrences: 0,
      applyCompleted: 0,
      recoveryCompleted: 0,
    },
    proposals: {},
    recoverySnapshotStatus: "none",
    createdAt: "2026-09-01T12:00:00.000Z",
    updatedAt: "2026-09-02T12:00:00.000Z",
    ...overrides,
  };
}

function contentReplacementSummary(job: PersistedContentReplacementJob): ContentReplacementJobSummary {
  return {
    id: job.id,
    updatedAt: job.updatedAt,
    baseUrl: job.baseUrl,
    stage: job.stage,
    status: job.status,
    mappingCount: job.configuration.rules.length,
    proposedPostCount: Object.keys(job.proposals).length,
    recoverySnapshotStatus: job.recoverySnapshotStatus,
  };
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
