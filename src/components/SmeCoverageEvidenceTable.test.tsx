import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import {
  completeSmeCoverageDecisionPack,
  partialSmeCoverageDecisionPack,
} from "../test/fixtures/smeCoverageFixtures";
import { SmeCoverageEvidenceTable } from "./SmeCoverageEvidenceTable";

describe("SmeCoverageEvidenceTable", () => {
  it("shows the decision-ready columns by default and keeps technical fields optional", async () => {
    const user = userEvent.setup();
    render(<SmeCoverageEvidenceTable evidence={completeSmeCoverageDecisionPack().evidence} />);

    const region = screen.getByRole("region", { name: "SME coverage evidence table" });
    expect(region).toHaveAttribute("tabindex", "0");
    expect(within(region).getByRole("columnheader", { name: "Tag" })).toBeVisible();
    expect(within(region).getByRole("columnheader", { name: "Evidence quality" })).toBeVisible();
    expect(
      within(region).queryByRole("columnheader", { name: "Question-count basis" }),
    ).not.toBeInTheDocument();

    await user.click(screen.getByText("Columns", { selector: "summary" }));
    await user.click(screen.getByRole("checkbox", { name: "Question-count basis" }));

    expect(
      within(region).getByRole("columnheader", { name: "Question-count basis" }),
    ).toBeVisible();
  });

  it("filters by the actual coverage tiers in the evidence", async () => {
    const user = userEvent.setup();
    render(<SmeCoverageEvidenceTable evidence={completeSmeCoverageDecisionPack().evidence} />);

    const tierFilter = screen.getByRole("combobox", { name: "Coverage tier" });
    expect(within(tierFilter).getByRole("option", { name: "All coverage tiers" })).toBeVisible();
    await user.selectOptions(tierFilter, "Immediate gap");

    expect(dataRowTags()).toEqual(["zeta-runtime"]);
  });

  it("filters and searches by derived evidence quality", async () => {
    const user = userEvent.setup();
    render(<SmeCoverageEvidenceTable evidence={partialSmeCoverageDecisionPack().evidence} />);

    const qualityFilter = screen.getByRole("combobox", { name: "Evidence quality" });
    expect(within(qualityFilter).getByRole("option", { name: "Complete" })).toBeVisible();
    expect(within(qualityFilter).getByRole("option", { name: "Needs review" })).toBeVisible();
    await user.selectOptions(qualityFilter, "Needs review");
    expect(dataRowTags()).toEqual(["unknown-source"]);

    await user.selectOptions(qualityFilter, "");
    await user.type(screen.getByRole("searchbox", { name: "Search evidence" }), "needs review");
    expect(dataRowTags()).toEqual(["unknown-source"]);
  });

  it.each([
    ["2500.8", "beta-data"],
    ["1250.4", "beta-data"],
  ])("searches canonical numeric evidence for %s", async (query, expectedTag) => {
    const user = userEvent.setup();
    render(<SmeCoverageEvidenceTable evidence={completeSmeCoverageDecisionPack().evidence} />);

    await user.type(screen.getByRole("searchbox", { name: "Search evidence" }), query);

    expect(dataRowTags()).toEqual([expectedTag]);
  });

  it.each([
    [
      "Page views",
      ["gamma-tools", "delta-service", "beta-data", "Alpha-platform", "zeta-runtime"],
      ["zeta-runtime", "Alpha-platform", "beta-data", "delta-service", "gamma-tools"],
    ],
    [
      "Page views per SME",
      ["gamma-tools", "delta-service", "beta-data", "Alpha-platform", "zeta-runtime"],
      ["Alpha-platform", "beta-data", "delta-service", "gamma-tools", "zeta-runtime"],
    ],
  ] as const)("sorts %s numerically both ways with unavailable values last", async (header, ascending, descending) => {
    const user = userEvent.setup();
    render(<SmeCoverageEvidenceTable evidence={completeSmeCoverageDecisionPack().evidence} />);
    const columnHeader = screen.getByRole("columnheader", { name: header });

    await user.click(within(columnHeader).getByRole("button", { name: header }));
    expect(columnHeader).toHaveAttribute("aria-sort", "ascending");
    expect(dataRowTags()).toEqual(ascending);

    await user.click(within(columnHeader).getByRole("button", { name: header }));
    expect(columnHeader).toHaveAttribute("aria-sort", "descending");
    expect(dataRowTags()).toEqual(descending);
  });

  it("retains text sorting and explicit unavailable formatting", async () => {
    const user = userEvent.setup();
    const evidence = completeSmeCoverageDecisionPack().evidence;
    const before = JSON.stringify(evidence);
    render(<SmeCoverageEvidenceTable evidence={evidence} />);

    expect(screen.getByRole("cell", { name: "No SME" })).toBeVisible();
    expect(screen.getAllByRole("cell", { name: "Unavailable" }).length).toBeGreaterThan(0);
    const tagHeader = screen.getByRole("columnheader", { name: "Tag" });
    await user.click(within(tagHeader).getByRole("button", { name: "Tag" }));
    expect(dataRowTags()).toEqual([
      "Alpha-platform",
      "beta-data",
      "delta-service",
      "gamma-tools",
      "zeta-runtime",
    ]);
    await user.click(within(tagHeader).getByRole("button", { name: "Tag" }));
    expect(dataRowTags()).toEqual([
      "zeta-runtime",
      "gamma-tools",
      "delta-service",
      "beta-data",
      "Alpha-platform",
    ]);
    expect(JSON.stringify(evidence)).toBe(before);
  });

  it("bounds large evidence without mutating canonical rows", async () => {
    const user = userEvent.setup();
    const source = completeSmeCoverageDecisionPack().evidence;
    const evidence = Array.from({ length: 55 }, (_, index) => ({
      ...source[index % source.length]!,
      tagName: `tag-${String(index + 1).padStart(2, "0")}`,
    }));
    const before = JSON.stringify(evidence);
    render(<SmeCoverageEvidenceTable evidence={evidence} />);

    expect(screen.getAllByRole("row")).toHaveLength(51);
    expect(screen.getByText("Rows 1–50 of 55")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Next page" }));
    expect(screen.getAllByRole("row")).toHaveLength(6);
    expect(screen.getByText("Rows 51–55 of 55")).toBeVisible();
    expect(JSON.stringify(evidence)).toBe(before);
  });

  it("shows the pack empty message when no evidence exists", () => {
    render(<SmeCoverageEvidenceTable evidence={[]} />);
    expect(screen.getByText("No evidence rows are in this decision pack.")).toBeVisible();
  });
});

function dataRowTags(): string[] {
  return within(screen.getByRole("region", { name: "SME coverage evidence table" }))
    .getAllByRole("row")
    .slice(1)
    .filter((row) => within(row).queryAllByRole("cell").length > 1)
    .map((row) => within(row).getAllByRole("cell")[0]!.textContent ?? "");
}
