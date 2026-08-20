import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
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

  it("shows report scope notes, run controls, dashboard tab, and raw table tab", async () => {
    render(
      <ReportWorkspace
        {...defaultWorkspaceProps()}
        reportId="tag-report"
        records={[{ tagName: "python", totalPageViews: 100 }]}
      />,
    );

    expect(screen.getByRole("heading", { name: "Tag Report" })).toBeInTheDocument();
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

    await userEvent.click(screen.getByRole("tab", { name: "Raw Table" }));

    expect(screen.getByText("python")).toBeInTheDocument();
  });

  it("summarizes live API output as raw collected datasets", () => {
    render(
      <ReportWorkspace
        {...defaultWorkspaceProps()}
        reportId="inactive-users"
        records={[{ datasetName: "users", user_id: 1, display_name: "Ada" }]}
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
        outputSource="live-api"
      />,
    );

    expect(screen.getByText("Interaction Weight")).toBeInTheDocument();
    expect(screen.getByText("Top interactions")).toBeInTheDocument();
    expect(screen.getByText("Engineering")).toBeInTheDocument();
    expect(screen.getByText("Product")).toBeInTheDocument();
  });

  it("downloads visible Tag Report records as Tag Health CSV", async () => {
    const records = [{ tagName: "python", totalPageViews: 100 }];

    render(
      <ReportWorkspace
        {...defaultWorkspaceProps()}
        reportId="tag-report"
        records={records}
        loadedAt="2026-07-08T12:00:00.000Z"
        outputSource="live-api"
        currentScope={{ startDate: "2026-07-01", endDate: "2026-07-08" }}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "Download Tag Health CSV" }));

    expect(downloadReportCsv).toHaveBeenCalledWith({
      reportId: "tag-report",
      datasetName: "tags",
      loadedAt: "2026-07-08T12:00:00.000Z",
      source: "live-api",
      periodRole: "current",
      currentScope: { startDate: "2026-07-01", endDate: "2026-07-08" },
      comparisonScope: undefined,
      records,
    });
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
