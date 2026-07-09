import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ReportDashboard } from "./ReportDashboard";

describe("ReportDashboard", () => {
  it("renders generic current versus comparison period metrics", () => {
    render(
      <ReportDashboard
        reportId="inactive-users"
        outputSource="live-api"
        records={[
          { datasetName: "users", user_id: 1 },
          { datasetName: "users", user_id: 2 },
          { datasetName: "questions", question_id: 10 },
        ]}
        comparisonRecords={[
          { datasetName: "users", user_id: 3 },
          { datasetName: "questions", question_id: 11 },
        ]}
        currentScope={{ startDate: "2026-06-01", endDate: "2026-06-30" }}
        comparisonScope={{ startDate: "2026-05-01", endDate: "2026-05-31" }}
      />,
    );

    expect(screen.getByText("Period comparison")).toBeInTheDocument();
    expect(screen.getByText("Current Records")).toBeInTheDocument();
    expect(screen.getByText("Comparison Records")).toBeInTheDocument();
    expect(screen.getAllByText("Change").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("+1").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("2026-06-01 to 2026-06-30")).toBeInTheDocument();
    expect(screen.getByText("2026-05-01 to 2026-05-31")).toBeInTheDocument();

    const usersRow = screen.getByRole("row", { name: /users 2 1 \+1/ });
    expect(within(usersRow).getByText("users")).toBeInTheDocument();
  });

  it("omits comparison metrics when no comparison records are available", () => {
    render(
      <ReportDashboard
        reportId="inactive-users"
        outputSource="live-api"
        records={[{ datasetName: "users", user_id: 1 }]}
      />,
    );

    expect(screen.queryByText("Period comparison")).not.toBeInTheDocument();
  });

  it("renders warnings and the Tag Health operations overview", () => {
    render(
      <ReportDashboard
        reportId="tag-report"
        outputSource="live-api"
        records={[
          {
            tag_name: "python",
            health_status: "Healthy",
            page_views: 900,
            question_count: 2,
            answer_count: 3,
            sme_count: 1,
            watcher_count: 8,
            unanswered_questions: 0,
            median_first_answer_hours: 2,
            recommended_action: "Maintain current coverage and response habits.",
          },
          {
            tag_name: "react",
            health_status: "Needs SME coverage",
            page_views: 700,
            question_count: 4,
            answer_count: 1,
            sme_count: 0,
            watcher_count: 12,
            unanswered_questions: 0,
            median_first_answer_hours: 4,
            recommended_action: "Assign or confirm SMEs for this tag.",
          },
          {
            tag_name: "java",
            health_status: "Needs response attention",
            page_views: 600,
            question_count: 5,
            answer_count: 2,
            sme_count: 2,
            watcher_count: 10,
            unanswered_questions: 3,
            median_first_answer_hours: 30,
            recommended_action: "Review unanswered questions and response time for this tag.",
          },
        ]}
        warnings={[
          {
            reportId: "tag-report",
            code: "dataset-page-cap",
            message: "Questions hit the configured page cap; results may be partial.",
          },
        ]}
      />,
    );

    const warningArea = screen.getByRole("alert", { name: "Report warnings" });
    expect(within(warningArea).getByText("dataset-page-cap")).toBeInTheDocument();
    expect(
      within(warningArea).getByText("Questions hit the configured page cap; results may be partial."),
    ).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Tag Health Dashboard" })).toBeInTheDocument();
    expect(screen.getByText("Tags Covered")).toBeInTheDocument();
    expect(screen.getByText("Healthy Tags")).toBeInTheDocument();
    expect(screen.getByText("SME Gaps")).toBeInTheDocument();
    expect(screen.getByText("Response Attention")).toBeInTheDocument();
    expect(within(screen.getByLabelText("Tag Health metrics")).getByText("Questions")).toBeInTheDocument();
    expect(screen.getByText("Status distribution")).toBeInTheDocument();
    expect(screen.getByText("Top tags by page views")).toBeInTheDocument();
    expect(screen.getByText("SME coverage queue")).toBeInTheDocument();
    expect(screen.getByText("Response attention queue")).toBeInTheDocument();
    expect(screen.getByLabelText("python: 900")).toBeInTheDocument();

    const smeQueue = screen.getByRole("region", { name: "SME coverage queue" });
    const reactRow = getRowByCellText(smeQueue, "react");
    expect(within(smeQueue).getByRole("columnheader", { name: "Questions" })).toHaveTextContent(/^Questions$/);
    expect(within(smeQueue).getByRole("columnheader", { name: "SMEs" })).toHaveTextContent(/^SMEs$/);
    expect(reactRow).not.toHaveAttribute("aria-label");
    expect(within(reactRow).getByRole("cell", { name: "react" })).toBeInTheDocument();
    expect(within(reactRow).getByRole("cell", { name: "4" })).toBeInTheDocument();
    expect(within(reactRow).getByRole("cell", { name: "0" })).toBeInTheDocument();
    expect(within(reactRow).getByRole("cell", { name: "Assign or confirm SMEs for this tag." })).toBeInTheDocument();

    const responseQueue = screen.getByRole("region", { name: "Response attention queue" });
    const javaRow = getRowByCellText(responseQueue, "java");
    expect(within(responseQueue).getByRole("columnheader", { name: "Unanswered" })).toHaveTextContent(/^Unanswered$/);
    expect(within(responseQueue).getByRole("columnheader", { name: "Median first answer" })).toHaveTextContent(
      /^Median first answer$/,
    );
    expect(javaRow).not.toHaveAttribute("aria-label");
    expect(within(javaRow).getByRole("cell", { name: "java" })).toBeInTheDocument();
    expect(within(javaRow).getByRole("cell", { name: "3" })).toBeInTheDocument();
    expect(within(javaRow).getByRole("cell", { name: "30h" })).toBeInTheDocument();
    expect(
      within(javaRow).getByRole("cell", { name: "Review unanswered questions and response time for this tag." }),
    ).toBeInTheDocument();
    expect(screen.queryByText("Period comparison")).not.toBeInTheDocument();
  });

  it("renders the Tag Health operations overview for empty Tag Reports", () => {
    render(<ReportDashboard reportId="tag-report" outputSource="live-api" records={[]} />);

    expect(screen.getByRole("heading", { name: "Tag Health Dashboard" })).toBeInTheDocument();
    expect(screen.getByText("Current-period context")).toBeInTheDocument();
    expect(screen.getByText("Top tags by page views")).toBeInTheDocument();
    expect(screen.getByText("No chart data loaded.")).toBeInTheDocument();

    const smeQueue = screen.getByRole("region", { name: "SME coverage queue" });
    expect(within(smeQueue).getByText("No tags need SME coverage.")).toBeInTheDocument();

    const responseQueue = screen.getByRole("region", { name: "Response attention queue" });
    expect(within(responseQueue).getByText("No tags need response attention.")).toBeInTheDocument();
  });

  it("compares curated Tag Health rows by health status", () => {
    render(
      <ReportDashboard
        reportId="tag-report"
        records={[
          tagHealthRecord("python", "Healthy"),
          tagHealthRecord("react", "Needs SME coverage"),
          tagHealthRecord("typescript", "Needs SME coverage"),
        ]}
        comparisonRecords={[
          tagHealthRecord("python", "Healthy"),
          tagHealthRecord("javascript", "Healthy"),
          tagHealthRecord("java", "Needs response attention"),
        ]}
      />,
    );

    expect(screen.getByText("Period comparison")).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Health status" })).toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "Dataset" })).not.toBeInTheDocument();
    expect(screen.queryByRole("row", { name: /Records/ })).not.toBeInTheDocument();
    expect(screen.getByRole("row", { name: /Needs SME coverage 2 0 \+2/ })).toBeInTheDocument();
    expect(screen.getByRole("row", { name: /Needs response attention 0 1 -1/ })).toBeInTheDocument();
    expect(screen.getByRole("row", { name: /Healthy 1 2 -1/ })).toBeInTheDocument();
  });

  it("normalizes imported Tag Metric rows into Tag Health dashboard rows", () => {
    render(
      <ReportDashboard
        reportId="tag-report"
        records={[
          {
            tagName: "typescript",
            totalPageViews: 450,
            questionCount: 8,
            answerCount: 4,
            totalSmes: 0,
            questionsNoAnswers: 0,
            medianFirstAnswerHours: 6,
          },
        ]}
      />,
    );

    expect(screen.getByText("Tags Covered")).toBeInTheDocument();
    expect(screen.getByText("SME coverage queue")).toBeInTheDocument();
    expect(screen.getByLabelText("typescript: 450")).toBeInTheDocument();
    const smeQueue = screen.getByRole("region", { name: "SME coverage queue" });
    const typescriptRow = getRowByCellText(smeQueue, "typescript");
    expect(within(typescriptRow).getByRole("cell", { name: "8" })).toBeInTheDocument();
    expect(within(typescriptRow).getByRole("cell", { name: "0" })).toBeInTheDocument();
  });
});

function getRowByCellText(region: HTMLElement, cellText: string) {
  const row = within(region)
    .getAllByRole("row")
    .find((candidate) => within(candidate).queryByRole("cell", { name: cellText }));

  expect(row).toBeDefined();
  return row as HTMLElement;
}

function tagHealthRecord(tagName: string, healthStatus: string) {
  return {
    tag_name: tagName,
    health_status: healthStatus,
    page_views: 100,
    question_count: 1,
    answer_count: 1,
    sme_count: healthStatus === "Needs SME coverage" ? 0 : 1,
    watcher_count: 1,
    unanswered_questions: healthStatus === "Needs response attention" ? 1 : 0,
    median_first_answer_hours: 2,
    recommended_action: "Maintain current coverage and response habits.",
  };
}
