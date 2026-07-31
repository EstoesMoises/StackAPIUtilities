import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { completeSmeCoverageDecisionPack } from "../test/fixtures/smeCoverageFixtures";
import { DEFAULT_SME_COVERAGE_SETTINGS } from "../utilities/smeCoverage/settings";
import { SmeCoverageWorkspace } from "./SmeCoverageWorkspace";

vi.mock("../utils/smeCoverageDownloads", () => ({
  downloadSmeCoverageEvidenceCsv: vi.fn(),
  downloadSmeCoverageMarkdown: vi.fn(),
}));

describe("SmeCoverageWorkspace", () => {
  it("presents a read-only all-time utility without Script, upload, or date prerequisites", () => {
    render(
      <SmeCoverageWorkspace
        settings={DEFAULT_SME_COVERAGE_SETTINGS}
        onSettingsChange={vi.fn()}
        onRun={vi.fn()}
        runState={{ status: "idle" }}
      />,
    );

    expect(screen.getByRole("heading", { name: "SME Coverage Analyzer" })).toBeInTheDocument();
    expect(screen.getByText("All-time demand · Current SME coverage")).toBeInTheDocument();
    expect(screen.getByText("Read-only")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Run SME coverage analysis" })).toBeInTheDocument();
    expect(screen.getByText(/compares all-time page-view demand with assigned SMEs at run time/i)).toBeInTheDocument();
    expect(screen.getByText(/transparent hybrid rules/i)).toBeInTheDocument();
    expect(screen.getByText(/requires both API lanes/i)).toBeInTheDocument();
    expect(screen.getByText(/do not need to run a Script first or provide an upload/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/date/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/prior Script run|upload required/i)).not.toBeInTheDocument();
  });

  it("disables only a pending run and sends both primary and rerun actions to the same callback", async () => {
    const user = userEvent.setup();
    const onRun = vi.fn();
    const decisionPack = completeSmeCoverageDecisionPack();
    const { rerender } = render(
      <SmeCoverageWorkspace
        settings={DEFAULT_SME_COVERAGE_SETTINGS}
        onSettingsChange={vi.fn()}
        onRun={onRun}
        runState={{ status: "idle" }}
        decisionPack={decisionPack}
      />,
    );

    const primaryRun = screen.getByRole("button", { name: "Run SME coverage analysis" });
    const rerun = screen.getByRole("button", { name: "Run again" });
    expect(primaryRun).toBeEnabled();
    expect(rerun).toBeEnabled();
    await user.click(primaryRun);
    await user.click(rerun);
    expect(onRun).toHaveBeenCalledTimes(2);

    rerender(
      <SmeCoverageWorkspace
        settings={DEFAULT_SME_COVERAGE_SETTINGS}
        onSettingsChange={vi.fn()}
        onRun={onRun}
        runState={{ status: "running" }}
        decisionPack={decisionPack}
      />,
    );
    expect(screen.getByRole("button", { name: "Run SME coverage analysis" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Run again" })).toBeDisabled();

    rerender(
      <SmeCoverageWorkspace
        settings={DEFAULT_SME_COVERAGE_SETTINGS}
        onSettingsChange={vi.fn()}
        onRun={onRun}
        runState={{ status: "succeeded" }}
        decisionPack={decisionPack}
      />,
    );
    expect(screen.getByRole("button", { name: "Run SME coverage analysis" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Run again" })).toBeEnabled();
  });

  it("resets copy and download feedback when a new prepared pack replaces the prior result", async () => {
    const user = userEvent.setup();
    vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue(undefined);
    const firstPack = completeSmeCoverageDecisionPack();
    const secondPack = {
      ...completeSmeCoverageDecisionPack(),
      snapshot: {
        ...completeSmeCoverageDecisionPack().snapshot,
        generatedAt: "2026-07-30T13:00:00.000Z",
      },
      assessment: "A newly prepared assessment.",
    };
    const props = {
      settings: DEFAULT_SME_COVERAGE_SETTINGS,
      onSettingsChange: vi.fn(),
      onRun: vi.fn(),
      runState: { status: "succeeded" as const },
    };
    const { rerender } = render(<SmeCoverageWorkspace {...props} decisionPack={firstPack} />);

    await user.click(screen.getByRole("button", { name: "Copy assessment" }));
    await user.click(screen.getByRole("button", { name: "Download Markdown" }));
    expect(screen.getByText("Assessment copied to the clipboard.")).toBeInTheDocument();
    expect(screen.getByText("Markdown download started.")).toBeInTheDocument();

    rerender(<SmeCoverageWorkspace {...props} decisionPack={secondPack} />);

    expect(screen.getByText("A newly prepared assessment.")).toBeInTheDocument();
    expect(screen.queryByText("Assessment copied to the clipboard.")).not.toBeInTheDocument();
    expect(screen.queryByText("Markdown download started.")).not.toBeInTheDocument();
  });
});
