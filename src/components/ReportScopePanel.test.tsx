import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_REPORT_RUN_SCOPE } from "../domain/reportScope";
import { ReportScopePanel } from "./ReportScopePanel";

describe("ReportScopePanel", () => {
  it("edits current period and volume controls", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    render(<ReportScopePanel reportId="tag-report" scope={DEFAULT_REPORT_RUN_SCOPE} onChange={onChange} />);

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

    expect(screen.getByRole("group", { name: "Run depth" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /Standard report/ })).toBeChecked();
    expect(screen.getByText(/Requests up to 500 records per dataset/)).toBeInTheDocument();
    expect(screen.getByText(/pageSize 100 and maxPagesPerDataset 5/)).toBeInTheDocument();

    await user.click(screen.getByRole("radio", { name: /Deep audit/ }));

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
        runPreset: "standard",
      }),
    );
  });

  it("uses numeric volume controls for non-Tag reports", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    render(<ReportScopePanel reportId="inactive-users" scope={DEFAULT_REPORT_RUN_SCOPE} onChange={onChange} />);

    expect(screen.queryByRole("group", { name: "Run depth" })).not.toBeInTheDocument();
    await user.clear(screen.getByLabelText("Page size"));
    await user.type(screen.getByLabelText("Page size"), "50");

    expect(onChange).toHaveBeenCalled();
  });
});
