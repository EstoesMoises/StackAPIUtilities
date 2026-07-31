import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_SME_COVERAGE_SETTINGS } from "../utilities/smeCoverage/settings";
import { SmeCoverageWorkspace } from "./SmeCoverageWorkspace";

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
    const { rerender } = render(
      <SmeCoverageWorkspace
        settings={DEFAULT_SME_COVERAGE_SETTINGS}
        onSettingsChange={vi.fn()}
        onRun={onRun}
        runState={{ status: "idle" }}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Run SME coverage analysis" }));
    expect(onRun).toHaveBeenCalledTimes(1);

    rerender(
      <SmeCoverageWorkspace
        settings={DEFAULT_SME_COVERAGE_SETTINGS}
        onSettingsChange={vi.fn()}
        onRun={onRun}
        runState={{ status: "running" }}
      />,
    );
    expect(screen.getByRole("button", { name: "Run SME coverage analysis" })).toBeDisabled();
  });
});
