import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_REPORT_RUN_SCOPE } from "../domain/reportScope";
import type { ReportRunScope } from "../domain/types";
import { ReportScopePanel } from "./ReportScopePanel";

describe("ReportScopePanel", () => {
  it("edits current period and volume controls", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    render(<ReportScopePanel reportId="inactive-users" scope={DEFAULT_REPORT_RUN_SCOPE} onChange={onChange} />);

    await user.type(screen.getByLabelText("Current start date"), "2026-01-01");
    await user.clear(screen.getByLabelText("Page size"));
    await user.type(screen.getByLabelText("Page size"), "50");

    expect(onChange).toHaveBeenCalled();
  });

  it("enables comparison period controls", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    render(<ReportScopePanel reportId="tag-report" scope={DEFAULT_REPORT_RUN_SCOPE} onChange={onChange} />);
    await user.click(screen.getByLabelText("Enable comparison period"));

    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ comparison: {} }));
  });

  it("shows Tag Report run presets with accessible technical details", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    render(<ReportScopePanel reportId="tag-report" scope={DEFAULT_REPORT_RUN_SCOPE} onChange={onChange} />);

    expect(screen.getByRole("group", { name: "Record coverage" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Standard report" })).toBeChecked();
    expect(screen.getByText("Up to 500 each")).toBeInTheDocument();
    expect(screen.getAllByText("Users, tags, questions, articles")).toHaveLength(3);
    expect(
      screen.getByText(/SME detail is separate: up to 500 top-answerer records for each collected tag/),
    ).toBeInTheDocument();
    expect(screen.getByText(/Technical settings: pageSize 100, maxPagesPerDataset 5/)).toBeInTheDocument();

    await user.click(screen.getByRole("radio", { name: "Deep audit" }));

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        pageSize: 100,
        maxPagesPerDataset: 20,
        runPreset: "deep-audit",
      }),
    );
  });

  it("keeps advanced API volume settings available for Tag Report", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    render(<ReportScopePanel reportId="tag-report" scope={DEFAULT_REPORT_RUN_SCOPE} onChange={onChange} />);

    await user.click(screen.getByRole("button", { name: "Advanced API volume settings" }));

    expect(screen.getByLabelText("Page size")).toHaveValue(100);
    expect(screen.getByLabelText("Max pages per dataset")).toHaveValue(5);

    await user.clear(screen.getByLabelText("Max pages per dataset"));
    await user.type(screen.getByLabelText("Max pages per dataset"), "8");

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        maxPagesPerDataset: 8,
        runPreset: undefined,
      }),
    );
  });

  it("shows custom volume state when Tag Report settings do not match a preset", async () => {
    const user = userEvent.setup();

    render(<ControlledReportScopePanel />);

    await user.click(screen.getByRole("button", { name: "Advanced API volume settings" }));
    await user.clear(screen.getByLabelText("Max pages per dataset"));
    await user.type(screen.getByLabelText("Max pages per dataset"), "8");

    expect(screen.getByRole("radio", { name: "Standard report" })).not.toBeChecked();
    expect(screen.getByRole("radio", { name: "Quick sample" })).not.toBeChecked();
    expect(screen.getByRole("radio", { name: "Deep audit" })).not.toBeChecked();
    expect(screen.getByRole("status")).toHaveTextContent(
      /Custom record coverage: Up to 800 each for users, tags, questions, articles/,
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      /SME detail is separate and can add up to 800 top-answerer records for each collected tag/,
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      /Technical settings: pageSize 100 and maxPagesPerDataset 8/,
    );

    await user.click(screen.getByRole("radio", { name: "Standard report" }));

    expect(screen.getByRole("radio", { name: "Standard report" })).toBeChecked();
    expect(screen.getByLabelText("Max pages per dataset")).toHaveValue(5);
  });

  it("uses numeric volume controls for non-Tag reports", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    render(<ReportScopePanel reportId="inactive-users" scope={DEFAULT_REPORT_RUN_SCOPE} onChange={onChange} />);

    expect(screen.queryByRole("group", { name: "Record coverage" })).not.toBeInTheDocument();
    await user.clear(screen.getByLabelText("Page size"));
    await user.type(screen.getByLabelText("Page size"), "50");

    expect(onChange).toHaveBeenCalled();
  });
});

function ControlledReportScopePanel({ initialScope = DEFAULT_REPORT_RUN_SCOPE }: { initialScope?: ReportRunScope }) {
  const [scope, setScope] = useState(initialScope);

  return <ReportScopePanel reportId="tag-report" scope={scope} onChange={setScope} />;
}
