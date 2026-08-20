import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { completeSmeCoverageDecisionPack } from "../test/fixtures/smeCoverageFixtures";
import { SmeCoverageEvidenceTable } from "./SmeCoverageEvidenceTable";

const headers = [
  "Tag",
  "Page views",
  "Questions",
  "Question-count basis",
  "SMEs",
  "Page views per SME",
  "Coverage percentile",
  "Coverage tier",
  "Demand quality",
  "SME quality",
  "Reason",
  "Recommended action",
] as const;

describe("SmeCoverageEvidenceTable", () => {
  it("uses semantic fixed headers, a focusable labeled scroll region, and visible tier text", () => {
    render(<SmeCoverageEvidenceTable evidence={completeSmeCoverageDecisionPack().evidence} />);

    const region = screen.getByRole("region", { name: "SME coverage evidence table" });
    expect(region).toHaveAttribute("tabindex", "0");
    for (const header of headers) {
      expect(within(region).getByRole("columnheader", { name: header })).toHaveAttribute(
        "scope",
        "col",
      );
    }
    for (const tier of [
      "Immediate gap",
      "Critical under-coverage",
      "Light coverage",
      "Adequate coverage",
    ]) {
      expect(
        within(region).getAllByText(tier, { selector: ".sme-tier-badge" }).length,
      ).toBeGreaterThan(0);
    }
    expect(within(region).getAllByText("Unavailable").length).toBeGreaterThan(0);
  });

  it.each([
    ["alpha", "Alpha-platform"],
    ["critical under", "Alpha-platform"],
    ["between p75", "beta-data"],
    ["improve resilience", "beta-data"],
  ])("searches all prepared evidence text for %s", async (query, expectedTag) => {
    const user = userEvent.setup();
    render(<SmeCoverageEvidenceTable evidence={completeSmeCoverageDecisionPack().evidence} />);

    await user.type(screen.getByRole("searchbox", { name: "Search evidence" }), query);

    expect(screen.getByRole("cell", { name: expectedTag })).toBeInTheDocument();
    expect(screen.getAllByRole("row")).toHaveLength(2);
  });

  it("shows a useful no-match state", async () => {
    const user = userEvent.setup();
    render(<SmeCoverageEvidenceTable evidence={completeSmeCoverageDecisionPack().evidence} />);
    await user.type(screen.getByRole("searchbox", { name: "Search evidence" }), "not-a-real-tag");
    expect(screen.getByText("No evidence matches this search.")).toBeInTheDocument();
  });

  it.each([
    ["Page views", ["gamma-tools", "delta-service", "beta-data", "Alpha-platform", "zeta-runtime"], ["zeta-runtime", "Alpha-platform", "beta-data", "delta-service", "gamma-tools"]],
    ["Page views per SME", ["gamma-tools", "delta-service", "beta-data", "Alpha-platform", "zeta-runtime"], ["Alpha-platform", "beta-data", "delta-service", "gamma-tools", "zeta-runtime"]],
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

  it("sorts text with code-unit ordering and never mutates canonical evidence", async () => {
    const user = userEvent.setup();
    const evidence = completeSmeCoverageDecisionPack().evidence;
    const before = JSON.stringify(evidence);
    render(<SmeCoverageEvidenceTable evidence={evidence} />);

    const tagHeader = screen.getByRole("columnheader", { name: "Tag" });
    await user.click(within(tagHeader).getByRole("button", { name: "Tag" }));
    expect(dataRowTags()).toEqual(["Alpha-platform", "beta-data", "delta-service", "gamma-tools", "zeta-runtime"]);
    await user.click(within(tagHeader).getByRole("button", { name: "Tag" }));
    expect(dataRowTags()).toEqual(["zeta-runtime", "gamma-tools", "delta-service", "beta-data", "Alpha-platform"]);
    expect(JSON.stringify(evidence)).toBe(before);
  });
});

function dataRowTags(): string[] {
  return screen
    .getAllByRole("row")
    .slice(1)
    .map((row) => within(row).getAllByRole("cell")[0]!.textContent ?? "");
}
