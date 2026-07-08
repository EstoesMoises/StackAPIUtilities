import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { RunStatus } from "./RunStatus";

describe("RunStatus", () => {
  it("renders nothing when there is no queue or progress", () => {
    const { container } = render(<RunStatus queue={[]} />);

    expect(container).toBeEmptyDOMElement();
  });

  it("shows active run progress and keeps queue messages visible", () => {
    render(
      <RunStatus
        queue={[
          {
            id: "tag-report-live-running",
            reportId: "tag-report",
            status: "running",
            message: "Running Tag Report current period live API collection...",
          },
        ]}
        progress={{
          reportTitle: "Tag Report",
          status: "running",
          currentStage: "Collecting live API datasets",
          completedStages: ["Validate credentials", "Plan required datasets"],
          totalStages: 4,
        }}
      />,
    );

    const status = screen.getByRole("region", { name: "Run status" });
    expect(within(status).getByRole("heading", { name: "Running Tag Report" })).toBeInTheDocument();
    expect(within(status).getByText("Collecting live API datasets")).toBeInTheDocument();

    const progressbar = within(status).getByRole("progressbar", { name: "Tag Report progress" });
    expect(progressbar).toHaveAttribute("aria-valuemin", "0");
    expect(progressbar).toHaveAttribute("aria-valuemax", "100");
    expect(progressbar).toHaveAttribute("aria-valuenow", "50");

    expect(within(status).getByText("Validate credentials")).toBeInTheDocument();
    expect(within(status).getByText("Plan required datasets")).toBeInTheDocument();
    expect(
      within(status).getByText("Running Tag Report current period live API collection..."),
    ).toBeInTheDocument();
  });
});
