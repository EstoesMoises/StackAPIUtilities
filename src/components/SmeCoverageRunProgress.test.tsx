import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  SmeCoverageRunProgress,
  type SmeCoverageRunStage,
} from "./SmeCoverageRunProgress";

const stageLabels = [
  "Validate credentials and instance support",
  "Collect all-time tag demand",
  "Collect current assigned-SME counts",
  "Normalize and join tag evidence",
  "Calculate thresholds and coverage tiers",
  "Build deterministic assessment",
  "Store browser-local result",
  "Render decision pack",
] as const;

describe("SmeCoverageRunProgress", () => {
  it("announces a running aggregate request without inventing per-stage completion", () => {
    render(<SmeCoverageRunProgress status="running" />);

    const region = screen.getByRole("region", { name: "SME Coverage Analyzer run progress" });
    expect(region).toHaveAttribute("aria-live", "polite");
    expect(
      within(region).getByText(/server is running the following stages in order/i),
    ).toBeInTheDocument();

    const progressbar = within(region).getByRole("progressbar", {
      name: "SME Coverage Analyzer progress",
    });
    expect(progressbar).not.toHaveAttribute("aria-valuenow");
    expect(progressbar).toHaveAttribute(
      "aria-valuetext",
      "Running all stages in order; stage completion is available after the server responds.",
    );

    const stages = within(region).getAllByRole("listitem");
    expect(stages.map((stage) => stage.textContent)).toEqual(
      stageLabels.map((label) => `${label}Awaiting server result`),
    );
    expect(within(region).queryByText("Complete")).not.toBeInTheDocument();
  });

  it("marks every ordered stage complete only after the request succeeds", () => {
    render(<SmeCoverageRunProgress status="succeeded" />);

    const progressbar = screen.getByRole("progressbar", { name: "SME Coverage Analyzer progress" });
    expect(progressbar).toHaveAttribute("aria-valuenow", "100");
    expect(progressbar).toHaveAttribute("aria-valuetext", "8 of 8 stages complete");

    const stages = screen.getAllByRole("listitem");
    expect(stages.map((stage) => stage.textContent)).toEqual(
      stageLabels.map((label) => `${label}Complete`),
    );
  });

  it("identifies the server-provided failed stage and exposes an actionable error", () => {
    render(
      <SmeCoverageRunProgress
        status="failed"
        failedStage="Collect current assigned-SME counts"
        error="Confirm the credential can read assigned SMEs, then retry the utility."
      />,
    );

    const failedStage = screen
      .getAllByRole("listitem")
      .find((stage) => stage.textContent?.includes("Collect current assigned-SME counts"));
    expect(failedStage).toBeDefined();
    expect(within(failedStage!).getByText("Failed")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Confirm the credential can read assigned SMEs, then retry the utility.",
    );
    expect(screen.queryByText("Complete")).not.toBeInTheDocument();
  });

  it("renders an actionable alert and identified fallback when failure details are missing", () => {
    render(<SmeCoverageRunProgress status="failed" />);

    expect(screen.getByRole("alert")).toHaveTextContent(
      "The utility could not complete. Review the failed stage, confirm credentials and instance access, then retry.",
    );
    const fallbackStage = screen
      .getAllByRole("listitem")
      .find((stage) => stage.textContent?.includes("Failed stage was not reported by the server"));
    expect(fallbackStage).toBeDefined();
    expect(within(fallbackStage!).getByText("Failed")).toBeInTheDocument();
  });

  it("identifies a defensive fallback for a runtime-invalid failed stage", () => {
    const runtimeInvalidStage = "Resolve undocumented server stage" as SmeCoverageRunStage;

    render(<SmeCoverageRunProgress status="failed" failedStage={runtimeInvalidStage} />);

    const fallbackStage = screen
      .getAllByRole("listitem")
      .find((stage) =>
        stage.textContent?.includes("Server-reported stage: Resolve undocumented server stage"),
      );
    expect(fallbackStage).toBeDefined();
    expect(within(fallbackStage!).getByText("Failed")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });
});
