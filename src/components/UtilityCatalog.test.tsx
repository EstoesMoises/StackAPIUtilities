import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { UtilityCatalog } from "./UtilityCatalog";

describe("UtilityCatalog", () => {
  it("renders executable utility metadata and exposes the selected utility", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();

    render(
      <UtilityCatalog
        selectedUtilityId="sme-coverage-analyzer"
        onSelect={onSelect}
      />,
    );

    expect(screen.getByRole("heading", { name: "Utility Catalog" })).toBeInTheDocument();
    const utility = screen.getByRole("button", { name: "SME Coverage Analyzer" });
    expect(utility).toHaveAttribute("aria-pressed", "true");
    expect(within(utility).getByText("SME Coverage Analyzer")).toBeInTheDocument();
    expect(within(utility).getByText("All-time demand · Current SME coverage")).toBeInTheDocument();
    expect(within(utility).getByText("Read-only")).toBeInTheDocument();
    expect(
      within(utility).getByText("Find tags where knowledge demand is not matched by enough SME coverage."),
    ).toBeInTheDocument();

    await user.click(utility);

    expect(onSelect).toHaveBeenCalledWith("sme-coverage-analyzer");
  });
});
