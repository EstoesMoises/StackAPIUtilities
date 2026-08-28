import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { reportRegistry } from "../domain/reportRegistry";
import { DEFAULT_REPORT_RUN_SCOPE } from "../domain/reportScope";
import { downloadReportCsv } from "../utils/reportDownloads";
import type { ReportWorkspaceProps } from "./ReportWorkspace";
import { ReportWorkspace } from "./ReportWorkspace";

vi.mock("../utils/reportDownloads", () => ({
  downloadReportCsv: vi.fn(),
}));

describe("ReportWorkspace", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("keeps setup controls separate and composes populated results in the command center", async () => {
    const user = userEvent.setup();
    render(
      <ReportWorkspace
        {...defaultWorkspaceProps()}
        reportId="tag-report"
        records={[{ tagName: "python", totalPageViews: 100 }]}
        datasetName="tags"
        loadedAt="2026-08-20T12:00:00.000Z"
        outputSource="live-api"
      />,
    );

    const setupHeading = screen.getByRole("heading", { name: "Configure Tag Report", level: 2 });
    const resultHeading = screen.getByRole("heading", { name: "Tag Report result", level: 2 });
    const setupPanel = setupHeading.closest(".workspace-panel");
    const commandCenter = screen.getByRole("region", { name: "Tag Report result" });

    expect(setupPanel).toBeInTheDocument();
    expect(setupPanel).not.toContainElement(commandCenter);
    expect(commandCenter).toHaveAttribute("aria-labelledby", resultHeading.id);
    expect(commandCenter).not.toHaveAttribute("aria-label");
    expect(
      screen.getByText(
        "Ready for session credentials. Live API runs collect mapped datasets; uploads render full script outputs. Loaded datasets stay in this browser until removed.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Run current period" })).toBeInTheDocument();
    expect(screen.getByText("Tags Covered")).toBeInTheDocument();
    expect(screen.getByText("SME Gaps")).toBeInTheDocument();
    expect(screen.getByText("Top tags by page views")).toBeInTheDocument();
    expect(screen.getByLabelText("python: 100")).toBeInTheDocument();
    expect(screen.queryByText("NaN")).not.toBeInTheDocument();
    expect(screen.queryByText("Dashboard cards and charts render here when data is loaded.")).not.toBeInTheDocument();
    expect(within(commandCenter).getByRole("button", { name: "Export report CSV" })).toBeVisible();
    expect(within(commandCenter).queryByRole("button", { name: "Export polished PDF" })).not.toBeInTheDocument();
    expect(within(commandCenter).queryByRole("button", { name: "More formats" })).not.toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Overview" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "Evidence · 1" })).toBeVisible();

    await user.click(screen.getByRole("tab", { name: "Evidence · 1" }));

    expect(screen.getByRole("region", { name: "Report evidence table" })).toBeVisible();
  });

  it("does not render a command center until both result identity fields exist", () => {
    const props = {
      ...defaultWorkspaceProps(),
      reportId: "inactive-users" as const,
      records: [{ user_id: 1 }],
      datasetName: "users" as const,
    };
    const { rerender } = render(<ReportWorkspace {...props} />);

    expect(screen.queryByRole("region", { name: "Inactive Users result" })).not.toBeInTheDocument();

    rerender(<ReportWorkspace {...props} loadedAt="2026-08-20T12:00:00.000Z" />);
    expect(screen.queryByRole("region", { name: "Inactive Users result" })).not.toBeInTheDocument();

    rerender(<ReportWorkspace {...props} outputSource="live-api" />);
    expect(screen.queryByRole("region", { name: "Inactive Users result" })).not.toBeInTheDocument();
  });

  it("renders an empty loaded result as Overview only without CSV capability", () => {
    render(
      <ReportWorkspace
        {...defaultWorkspaceProps()}
        reportId="inactive-users"
        records={[]}
        datasetName="users"
        loadedAt="2026-08-20T12:00:00.000Z"
        outputSource="live-api"
      />,
    );

    expect(screen.getByRole("region", { name: "Inactive Users result" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Overview" })).toBeVisible();
    expect(screen.queryByRole("tab", { name: /Evidence/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Export report CSV" })).not.toBeInTheDocument();
  });

  it("omits CSV capability when canonical dataset identity is unavailable", () => {
    render(
      <ReportWorkspace
        {...defaultWorkspaceProps()}
        reportId="inactive-users"
        records={[{ user_id: 1 }]}
        loadedAt="2026-08-20T12:00:00.000Z"
        outputSource="live-api"
      />,
    );

    expect(screen.getByRole("tab", { name: "Evidence · 1" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Export report CSV" })).not.toBeInTheDocument();
    expect(screen.getByText("CSV export unavailable because this result has no canonical dataset identity.")).toBeVisible();
  });

  it("summarizes live API output as raw collected datasets", () => {
    render(
      <ReportWorkspace
        {...defaultWorkspaceProps()}
        reportId="inactive-users"
        records={[{ datasetName: "users", user_id: 1, display_name: "Ada" }]}
        loadedAt="2026-08-20T12:00:00.000Z"
        outputSource="live-api"
      />,
    );

    expect(screen.getByText("Live Records")).toBeInTheDocument();
    expect(screen.getByText("Live datasets")).toBeInTheDocument();
    expect(screen.getByLabelText("users: 1")).toBeInTheDocument();
  });

  it("communicates exhaustive live collection for the current date scope", () => {
    render(
      <ReportWorkspace
        {...defaultWorkspaceProps()}
        reportId="inactive-users"
        records={[{ datasetName: "users", user_id: 1 }]}
        outputSource="live-api"
        currentScope={{ startDate: "2026-01-01", endDate: "2026-01-31" }}
      />,
    );

    const status = screen.getByRole("status", { name: "Collection status" });
    expect(status).toHaveTextContent(
      "All available data collected · 2026-01-01 to 2026-01-31",
    );
    expect(status).toHaveClass("s-notice__success");
    expect(status).not.toHaveClass("s-notice__warning");
  });

  it("labels legacy live collection without claiming current completeness", () => {
    render(
      <ReportWorkspace
        {...defaultWorkspaceProps()}
        reportId="inactive-users"
        records={[{ datasetName: "users", user_id: 1 }]}
        outputSource="live-api"
        currentScope={{ startDate: "2026-01-01", endDate: "2026-01-31" }}
        warnings={[
          {
            reportId: "inactive-users",
            code: "collection.legacy-unverified",
            message: "Legacy run — completeness not verified under current collection rules.",
          },
        ]}
      />,
    );

    const status = screen.getByRole("status", { name: "Collection status" });
    expect(status).toHaveTextContent(
      "Legacy run — completeness not verified under current collection rules. · 2026-01-01 to 2026-01-31",
    );
    expect(status).not.toHaveTextContent("All available data collected");
    expect(status).toHaveClass("s-notice__warning");
    expect(status).not.toHaveClass("s-notice__success");
  });

  it("ignores legacy-like warnings that are noncanonical or owned by another report", () => {
    render(
      <ReportWorkspace
        {...defaultWorkspaceProps()}
        reportId="inactive-users"
        records={[{ datasetName: "users", user_id: 1 }]}
        outputSource="live-api"
        warnings={[
          {
            reportId: "tag-report",
            code: "collection.legacy-unverified",
            message: "Legacy run — completeness not verified under current collection rules.",
          },
          {
            reportId: "inactive-users",
            code: "collection.legacy-unverified",
            message: "Legacy collection warning with noncanonical copy.",
          },
        ]}
      />,
    );

    const status = screen.getByRole("status", { name: "Collection status" });
    expect(status).toHaveTextContent("All available data collected");
    expect(status).toHaveClass("s-notice__success");
    expect(status).not.toHaveClass("s-notice__warning");
  });

  it("appends the comparison scope to live collection status", () => {
    render(
      <ReportWorkspace
        {...defaultWorkspaceProps()}
        reportId="inactive-users"
        records={[{ datasetName: "users", user_id: 1 }]}
        outputSource="live-api"
        currentScope={{ startDate: "2026-01-01", endDate: "2026-01-31" }}
        comparisonScope={{ startDate: "2025-01-01", endDate: "2025-01-31" }}
      />,
    );

    expect(screen.getByRole("status", { name: "Collection status" })).toHaveTextContent(
      "All available data collected · 2026-01-01 to 2026-01-31 · Compared with 2025-01-01 to 2025-01-31",
    );
  });

  it("labels a comparison-only live collection without inventing a current scope", () => {
    render(
      <ReportWorkspace
        {...defaultWorkspaceProps()}
        reportId="inactive-users"
        records={[]}
        comparisonRecords={[{ datasetName: "users", user_id: 1 }]}
        outputSource="live-api"
        comparisonScope={{ startDate: "2025-01-01", endDate: "2025-01-31" }}
      />,
    );

    expect(screen.getByRole("status", { name: "Collection status" })).toHaveTextContent(
      "All available data collected · Comparison: 2025-01-01 to 2025-01-31",
    );
    expect(screen.getByRole("status", { name: "Collection status" })).not.toHaveTextContent(
      "All available history",
    );
  });

  it("does not claim API collection completeness for uploaded output", () => {
    render(
      <ReportWorkspace
        {...defaultWorkspaceProps()}
        reportId="inactive-users"
        records={[{ user_id: 1 }]}
        outputSource="upload"
        currentScope={{ startDate: "2026-01-01", endDate: "2026-01-31" }}
      />,
    );

    expect(screen.queryByRole("status", { name: "Collection status" })).not.toBeInTheDocument();
    expect(screen.queryByText(/All available data collected/)).not.toBeInTheDocument();
  });

  it("renders synthetic live interactions with the interactions dashboard", () => {
    render(
      <ReportWorkspace
        {...defaultWorkspaceProps()}
        reportId="interactions"
        records={[{ datasetName: "interactions", source: "Engineering", target: "Product", weight: 3 }]}
        loadedAt="2026-08-20T12:00:00.000Z"
        outputSource="live-api"
      />,
    );

    expect(screen.getByText("Interaction Weight")).toBeInTheDocument();
    expect(screen.getByText("Top interactions")).toBeInTheDocument();
    expect(screen.getByText("Engineering")).toBeInTheDocument();
    expect(screen.getByText("Product")).toBeInTheDocument();
  });

  it.each(reportRegistry)("downloads $id records with the passed canonical dataset identity", async (report) => {
    const user = userEvent.setup();
    const records = [{ opaqueReportField: report.id }];
    const datasetName = report.requiredDatasets[0] ?? "dataExport";

    render(
      <ReportWorkspace
        {...defaultWorkspaceProps()}
        reportId={report.id}
        records={records}
        datasetName={datasetName}
        loadedAt="2026-07-08T12:00:00.000Z"
        outputSource="live-api"
        currentScope={{ startDate: "2026-07-01", endDate: "2026-07-08" }}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Export report CSV" }));

    expect(downloadReportCsv).toHaveBeenCalledWith({
      reportId: report.id,
      datasetName,
      loadedAt: "2026-07-08T12:00:00.000Z",
      source: "live-api",
      periodRole: "current",
      currentScope: { startDate: "2026-07-01", endDate: "2026-07-08" },
      comparisonScope: undefined,
      records,
    });
  });

  it("exports comparison records with comparison scope metadata when current records are empty", async () => {
    const user = userEvent.setup();
    const comparisonRecords = [{ user_id: 2 }];

    render(
      <ReportWorkspace
        {...defaultWorkspaceProps()}
        reportId="inactive-users"
        records={[]}
        comparisonRecords={comparisonRecords}
        datasetName="users"
        loadedAt="2026-07-08T12:00:00.000Z"
        outputSource="upload"
        currentScope={{ startDate: "2026-07-01", endDate: "2026-07-08" }}
        comparisonScope={{ startDate: "2026-06-01", endDate: "2026-06-08" }}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Export report CSV" }));

    expect(downloadReportCsv).toHaveBeenCalledWith({
      reportId: "inactive-users",
      datasetName: "users",
      loadedAt: "2026-07-08T12:00:00.000Z",
      source: "upload",
      periodRole: "comparison",
      currentScope: { startDate: "2026-07-01", endDate: "2026-07-08" },
      comparisonScope: { startDate: "2026-06-01", endDate: "2026-06-08" },
      records: comparisonRecords,
    });
    expect(screen.getByRole("status")).toHaveTextContent(
      "CSV download started for 1 rows.",
    );
  });

  it("announces an exact-row export failure and resets feedback when report identity changes", async () => {
    const user = userEvent.setup();
    vi.mocked(downloadReportCsv).mockImplementationOnce(() => {
      throw new Error("blocked");
    });
    const props = {
      ...defaultWorkspaceProps(),
      reportId: "inactive-users" as const,
      records: [{ user_id: 1 }, { user_id: 2 }],
      datasetName: "users" as const,
      loadedAt: "2026-07-08T12:00:00.000Z",
      outputSource: "live-api" as const,
    };
    const { rerender } = render(<ReportWorkspace {...props} />);

    await user.click(screen.getByRole("button", { name: "Export report CSV" }));

    expect(screen.getByRole("alert")).toHaveTextContent(
      "The CSV download could not start for 2 rows. Check browser download permissions and try again.",
    );

    rerender(
      <ReportWorkspace
        {...props}
        reportId="api-user-report"
        loadedAt="2026-07-09T12:00:00.000Z"
      />,
    );

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Overview" })).toHaveAttribute("aria-selected", "true");
  });

  it("does not reprepare visited Evidence when export feedback or an equivalent parent render updates", async () => {
    const user = userEvent.setup();
    let evidenceReads = 0;
    const records = Array.from({ length: 55 }, (_, index) => {
      const record: Record<string, unknown> = { user_id: index + 1 };
      Object.defineProperty(record, "display_name", {
        enumerable: true,
        get() {
          evidenceReads += 1;
          return `User ${index + 1}`;
        },
      });
      return record;
    });
    const props = {
      ...defaultWorkspaceProps(),
      reportId: "inactive-users" as const,
      records,
      datasetName: "users" as const,
      loadedAt: "2026-07-08T12:00:00.000Z",
      outputSource: "upload" as const,
    };
    const { rerender } = render(<ReportWorkspace {...props} />);

    await user.click(screen.getByRole("tab", { name: "Evidence · 55" }));
    expect(screen.getByRole("region", { name: "Report evidence table" })).toBeVisible();
    const readsAfterPreparation = evidenceReads;
    expect(readsAfterPreparation).toBeGreaterThanOrEqual(55);

    await user.click(screen.getByRole("tab", { name: "Overview" }));
    await user.click(screen.getByRole("button", { name: "Export report CSV" }));

    expect(screen.getByText("CSV download started for 55 rows.")).toBeInTheDocument();
    expect(evidenceReads).toBe(readsAfterPreparation);

    rerender(<ReportWorkspace {...props} />);
    expect(evidenceReads).toBe(readsAfterPreparation);
  });

  it("resets export feedback when canonical dataset identity changes or is removed", async () => {
    const user = userEvent.setup();
    const props = {
      ...defaultWorkspaceProps(),
      reportId: "inactive-users" as const,
      records: [{ user_id: 1 }],
      datasetName: "users" as const,
      loadedAt: "2026-07-08T12:00:00.000Z",
      outputSource: "live-api" as const,
      currentSnapshotId: "current-snapshot-1",
    };
    vi.mocked(downloadReportCsv).mockImplementationOnce(() => {
      throw new Error("blocked");
    });
    const { rerender } = render(<ReportWorkspace {...props} />);
    await user.click(screen.getByRole("button", { name: "Export report CSV" }));
    expect(screen.getByRole("alert")).toBeInTheDocument();

    rerender(<ReportWorkspace {...props} datasetName="tags" />);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    vi.mocked(downloadReportCsv).mockImplementationOnce(() => {
      throw new Error("blocked again");
    });
    await user.click(screen.getByRole("button", { name: "Export report CSV" }));
    expect(screen.getByRole("alert")).toBeInTheDocument();

    rerender(<ReportWorkspace {...props} datasetName={undefined} />);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByText(/no canonical dataset identity/i)).toBeVisible();
  });

  it("resets Evidence navigation when an existing snapshot identity changes", async () => {
    const user = userEvent.setup();
    const props = {
      ...defaultWorkspaceProps(),
      reportId: "inactive-users" as const,
      records: [{ user_id: 1 }],
      datasetName: "users" as const,
      loadedAt: "2026-07-08T12:00:00.000Z",
      outputSource: "live-api" as const,
      currentSnapshotId: "current-snapshot-1",
    };
    const { rerender } = render(<ReportWorkspace {...props} />);
    await user.click(screen.getByRole("tab", { name: "Evidence · 1" }));

    rerender(<ReportWorkspace {...props} currentSnapshotId="current-snapshot-2" />);

    expect(screen.getByRole("tab", { name: "Overview" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "Evidence · 1" })).toHaveAttribute("aria-selected", "false");
  });

  it("resets Evidence navigation when the report identity changes", async () => {
    const user = userEvent.setup();
    const props = {
      ...defaultWorkspaceProps(),
      records: [{ user_id: 1 }],
      datasetName: "users" as const,
      loadedAt: "2026-07-08T12:00:00.000Z",
      outputSource: "live-api" as const,
    };
    const { rerender } = render(
      <ReportWorkspace {...props} reportId="inactive-users" />,
    );
    await user.click(screen.getByRole("tab", { name: "Evidence · 1" }));
    expect(screen.getByRole("tab", { name: "Evidence · 1" })).toHaveAttribute("aria-selected", "true");

    rerender(<ReportWorkspace {...props} reportId="api-user-report" />);

    expect(screen.getByRole("tab", { name: "Overview" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "Evidence · 1" })).toHaveAttribute("aria-selected", "false");
  });
});

function defaultWorkspaceProps(): Pick<
  ReportWorkspaceProps,
  "scope" | "onScopeChange" | "onRun" | "onRunBoth"
> {
  return {
    scope: DEFAULT_REPORT_RUN_SCOPE,
    onScopeChange: () => undefined,
    onRun: () => undefined,
    onRunBoth: () => undefined,
  };
}
