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

  it("renders warnings and Tag Health dashboard sections", () => {
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
    expect(screen.getByText("Tags Covered")).toBeInTheDocument();
    expect(screen.getByText("Healthy Tags")).toBeInTheDocument();
    expect(screen.getByText("Response Attention")).toBeInTheDocument();
    expect(screen.getByText("SME Coverage")).toBeInTheDocument();
    expect(screen.getByText("Top tags by page views")).toBeInTheDocument();
    expect(screen.getByText("Tags needing SME coverage")).toBeInTheDocument();
    expect(screen.getByText("Tags needing response attention")).toBeInTheDocument();
    expect(screen.getByLabelText("python: 900")).toBeInTheDocument();
    expect(screen.getByLabelText("react: 4")).toBeInTheDocument();
    expect(screen.getByLabelText("java: 3")).toBeInTheDocument();
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
    expect(screen.getByText("Tags needing SME coverage")).toBeInTheDocument();
    expect(screen.getByLabelText("typescript: 450")).toBeInTheDocument();
    expect(screen.getByLabelText("typescript: 8")).toBeInTheDocument();
  });
});
