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
    expect(screen.getByText("SME Coverage")).toBeInTheDocument();
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
