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
});
