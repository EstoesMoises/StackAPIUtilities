import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_REPORT_RUN_SCOPE } from "../domain/reportScope";
import { ReportScopePanel } from "./ReportScopePanel";

describe("ReportScopePanel", () => {
  it("exposes date scope and explains exhaustive collection without depth controls", () => {
    render(<ReportScopePanel scope={DEFAULT_REPORT_RUN_SCOPE} onChange={vi.fn()} />);

    expect(screen.getByLabelText("Current start date")).toBeInTheDocument();
    expect(screen.getByLabelText("Current end date")).toBeInTheDocument();
    expect(
      screen.getByText(/collects all available data for the selected dates/i),
    ).toHaveTextContent(
      "Each run collects all available data for the selected dates. Large instances can take longer while the API pages and rate limits are handled automatically.",
    );
    expect(screen.queryAllByRole("radio")).toHaveLength(0);
    expect(screen.queryByText("Quick sample")).not.toBeInTheDocument();
    expect(screen.queryByText("Standard report")).not.toBeInTheDocument();
    expect(screen.queryByText("Deep audit")).not.toBeInTheDocument();
    expect(screen.queryByText("Record coverage")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Page size")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Max pages per dataset")).not.toBeInTheDocument();
  });

  it("edits current period dates", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    render(<ReportScopePanel scope={DEFAULT_REPORT_RUN_SCOPE} onChange={onChange} />);

    await user.type(screen.getByLabelText("Current start date"), "2026-01-01");

    expect(onChange).toHaveBeenCalled();
  });

  it("enables comparison period controls", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    render(<ReportScopePanel scope={DEFAULT_REPORT_RUN_SCOPE} onChange={onChange} />);
    await user.click(screen.getByLabelText("Enable comparison period"));

    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ comparison: {} }));
  });
});
