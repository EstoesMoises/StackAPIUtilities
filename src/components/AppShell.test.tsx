import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "../App";
import { tagMetricsCsv } from "../test/fixtures/reportFixtures";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("AppShell", () => {
  it("renders report catalog and all MVP reports", () => {
    render(<App />);

    expect(screen.getByRole("heading", { name: "Stack API Utilities" })).toBeInTheDocument();
    expect(screen.getByText("No credentials")).toBeInTheDocument();
    expect(screen.getByText("0 datasets")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Tag Report" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Data Export" })).toBeInTheDocument();
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
    expect(screen.getByLabelText("API key")).toBeInTheDocument();
    expect(screen.getByLabelText("Access token")).toBeInTheDocument();
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
    await user.type(screen.getByLabelText("Access token"), "token");
    await user.click(screen.getByRole("button", { name: "Save session credentials" }));
    await user.click(screen.getByRole("button", { name: "Reports" }));
    await user.click(screen.getByRole("button", { name: "Run current period" }));

    expect(await screen.findByText("Live API run completed for Inactive Users.")).toBeInTheDocument();
    expect(fetchMock.mock.calls[0][0]).toBe("/api/reports/run");
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({
      reportId: "inactive-users",
      credentials: {
        instanceType: "basic-business",
        baseUrl: "https://stackoverflowteams.com/c/example-team",
        accessToken: "token",
      },
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
    await user.type(screen.getByLabelText("Access token"), "token");
    await user.click(screen.getByRole("button", { name: "Save session credentials" }));
    await user.click(screen.getByRole("button", { name: "Reports" }));
    await user.click(screen.getByRole("button", { name: "Run current period" }));

    expect(await screen.findByText("Live API run completed for Tag Report.")).toBeInTheDocument();
    expect(fetchMock.mock.calls[0][0]).toBe("/api/reports/run");
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
    await user.type(screen.getByLabelText("Access token"), "token");
    await user.click(screen.getByRole("button", { name: "Save session credentials" }));
    await user.click(screen.getByRole("button", { name: "Reports" }));
    await user.click(screen.getByLabelText("Enable comparison period"));
    await user.click(screen.getByRole("button", { name: "Run both periods" }));

    expect(await screen.findByText("Period comparison")).toBeInTheDocument();
    expect(screen.getByText("Current Records")).toBeInTheDocument();
    expect(screen.getByText("Comparison Records")).toBeInTheDocument();
    expect(screen.getAllByText("+1").length).toBeGreaterThanOrEqual(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body)).periodRole).toBe("current");
    expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body)).periodRole).toBe("comparison");
  });

  it("saves credentials for the current browser session", async () => {
    const user = userEvent.setup();

    render(<App />);

    await user.click(screen.getByRole("button", { name: "Credentials" }));
    await user.type(screen.getByLabelText("Instance URL"), "https://stackoverflowteams.com/c/demo");
    await user.type(screen.getByLabelText("Access token"), "token");
    await user.click(screen.getByRole("button", { name: "Save session credentials" }));

    expect(screen.getByText("Credentials saved for this browser session.")).toBeInTheDocument();
  });
});
