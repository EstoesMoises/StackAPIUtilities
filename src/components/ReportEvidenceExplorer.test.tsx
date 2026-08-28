import { createColumnHelper, type ColumnDef } from "@tanstack/react-table";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Profiler } from "react";
import { describe, expect, it } from "vitest";
import {
  ReportEvidenceExplorer,
  type EvidenceFacet,
} from "./ReportEvidenceExplorer";

interface TestRow {
  readonly id: string;
  readonly name: string;
  readonly tier: "Critical" | "Adequate";
  readonly owner: "Acme" | "Beta";
  readonly detail: string;
  readonly score: number | null;
}

const columnHelper = createColumnHelper<TestRow>();
const columns = [
  columnHelper.accessor("name", { header: "Name" }),
  columnHelper.accessor("tier", { header: "Tier" }),
  columnHelper.accessor("owner", { header: "Owner", enableSorting: false }),
  columnHelper.accessor("detail", { header: "Detail" }),
  columnHelper.accessor("score", { header: "Score" }),
] as const;
const facets: readonly EvidenceFacet<TestRow>[] = [
  {
    id: "tier",
    label: "Tier",
    allLabel: "All tiers",
    options: ["Critical", "Adequate"],
    matches: (row, value) => row.tier === value,
  },
  {
    id: "owner",
    label: "Owner",
    allLabel: "All owners",
    options: ["Acme", "Beta"],
    matches: (row, value) => row.owner === value,
  },
];
const rows = createRows(60);

describe("ReportEvidenceExplorer", () => {
  it("shows 50 of 60 rows on the first page and the remaining 10 on the next page", async () => {
    const user = userEvent.setup();
    renderExplorer();

    const region = screen.getByRole("region", { name: "Test evidence" });
    expect(within(region).getAllByRole("row")).toHaveLength(51);
    expect(screen.getByText("Rows 1–50 of 60")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Next page" }));

    expect(within(region).getAllByRole("row")).toHaveLength(11);
    expect(screen.getByText("Rows 51–60 of 60")).toBeInTheDocument();
  });

  it("resets to the first page when a facet narrows the result to five rows", async () => {
    const user = userEvent.setup();
    renderExplorer();
    await user.click(screen.getByRole("button", { name: "Next page" }));

    await user.selectOptions(screen.getByRole("combobox", { name: "Tier" }), "Critical");

    expect(screen.getByText("Rows 1–5 of 5")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Previous page" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Next page" })).toBeDisabled();
  });

  it("searches case-insensitively and resets pagination", async () => {
    const user = userEvent.setup();
    renderExplorer();
    await user.click(screen.getByRole("button", { name: "Next page" }));

    await user.type(screen.getByRole("searchbox", { name: "Search evidence" }), "aLpHa NeEdLe");

    expect(screen.getByRole("cell", { name: "Alpha Needle" })).toBeInTheDocument();
    expect(screen.getByText("Rows 1–1 of 1")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Previous page" })).toBeDisabled();
  });

  it("searches caller-projected derived text without matching excluded raw fields", async () => {
    const user = userEvent.setup();
    interface DerivedRow {
      readonly state: "open" | "closed";
      readonly internalCode: string;
    }
    const derivedHelper = createColumnHelper<DerivedRow>();
    render(
      <ReportEvidenceExplorer
        rows={[
          { state: "open", internalCode: "hidden-needle" },
          { state: "closed", internalCode: "private-value" },
        ]}
        columns={[
          derivedHelper.display({
            id: "status",
            header: "Status",
            cell: (context) => context.row.original.state === "open" ? "Needs review" : "Ready",
          }),
        ]}
        getSearchText={(row) => row.state === "open" ? "Needs review" : "Ready"}
        ariaLabel="Derived evidence"
        emptyMessage="No derived rows."
      />,
    );

    const search = screen.getByRole("searchbox", { name: "Search evidence" });
    await user.type(search, "nEeDs ReViEw");
    expect(screen.getByRole("cell", { name: "Needs review" })).toBeInTheDocument();
    expect(screen.queryByRole("cell", { name: "Ready" })).not.toBeInTheDocument();

    await user.clear(search);
    await user.type(search, "hidden-needle");
    expect(screen.getByText("No evidence matches the current filters.")).toBeInTheDocument();
  });

  it("searches array values displayed by generic columns", async () => {
    const user = userEvent.setup();
    interface ArrayRow {
      readonly tags: readonly string[];
    }
    const arrayHelper = createColumnHelper<ArrayRow>();
    render(
      <ReportEvidenceExplorer
        rows={[
          { tags: ["react", "typescript"] },
          { tags: ["python", "pandas"] },
        ]}
        columns={[
          arrayHelper.display({
            id: "tags",
            header: "Tags",
            cell: (context) => context.row.original.tags.join(", "),
          }),
        ]}
        ariaLabel="Array evidence"
        emptyMessage="No array rows."
      />,
    );

    await user.type(screen.getByRole("searchbox", { name: "Search evidence" }), "TypeScript");
    expect(screen.getByRole("cell", { name: "react, typescript" })).toBeInTheDocument();
    expect(screen.queryByRole("cell", { name: "python, pandas" })).not.toBeInTheDocument();
  });

  it("sorts rows without mutating the caller's canonical order", async () => {
    const user = userEvent.setup();
    const sourceRows = [
      createRow(0, { id: "z", name: "Zulu" }),
      createRow(1, { id: "a", name: "Alpha" }),
      createRow(2, { id: "m", name: "Mike" }),
    ];
    const originalOrder = sourceRows.map((row) => row.name);
    renderExplorer({ rows: sourceRows });

    expect(dataRowNames()).toEqual(originalOrder);
    await user.click(screen.getByRole("button", { name: "Name" }));

    expect(dataRowNames()).toEqual(["Alpha", "Mike", "Zulu"]);
    expect(sourceRows.map((row) => row.name)).toEqual(originalOrder);
  });

  it("starts with a configured column hidden and exposes it through Columns", async () => {
    const user = userEvent.setup();
    renderExplorer({ defaultColumnVisibility: { detail: false } });

    expect(screen.queryByRole("columnheader", { name: "Detail" })).not.toBeInTheDocument();
    await user.click(screen.getByText("Columns", { selector: "summary" }));
    await user.click(screen.getByRole("checkbox", { name: "Detail" }));

    expect(screen.getByRole("columnheader", { name: "Detail" })).toBeInTheDocument();
  });

  it("does not allow the final visible data column to be hidden", async () => {
    const user = userEvent.setup();
    renderExplorer();
    await user.click(screen.getByText("Columns", { selector: "summary" }));

    await user.click(screen.getByRole("checkbox", { name: "Tier" }));
    await user.click(screen.getByRole("checkbox", { name: "Owner" }));
    await user.click(screen.getByRole("checkbox", { name: "Score" }));

    const nameToggle = screen.getByRole("checkbox", { name: "Name" });
    expect(nameToggle).toBeChecked();
    expect(nameToggle).toBeDisabled();
    await user.click(nameToggle);
    expect(screen.getByRole("columnheader", { name: "Name" })).toBeInTheDocument();
  });

  it("combines facets with search and distinguishes filtered-empty copy", async () => {
    const user = userEvent.setup();
    renderExplorer({
      rows: [
        createRow(0, { name: "Intersection", tier: "Critical", owner: "Acme", detail: "shared term" }),
        createRow(1, { name: "Tier only", tier: "Critical", owner: "Beta", detail: "shared term" }),
        createRow(2, { name: "Owner only", tier: "Adequate", owner: "Acme", detail: "shared term" }),
        createRow(3, { name: "Search only", tier: "Critical", owner: "Acme", detail: "different" }),
      ],
    });

    await user.selectOptions(screen.getByRole("combobox", { name: "Tier" }), "Critical");
    await user.selectOptions(screen.getByRole("combobox", { name: "Owner" }), "Acme");
    await user.type(screen.getByRole("searchbox", { name: "Search evidence" }), "shared term");
    expect(screen.getByText("Rows 1–1 of 1")).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "Intersection" })).toBeInTheDocument();
    expect(screen.queryByRole("cell", { name: "Tier only" })).not.toBeInTheDocument();
    expect(screen.queryByRole("cell", { name: "Owner only" })).not.toBeInTheDocument();

    await user.clear(screen.getByRole("searchbox", { name: "Search evidence" }));
    await user.type(screen.getByRole("searchbox", { name: "Search evidence" }), "no such evidence");
    expect(screen.getByText("No evidence matches the current filters.")).toBeInTheDocument();
    expect(screen.queryByText("No rows available.")).not.toBeInTheDocument();
  });

  it("changes page size, resets to page one, and disables pagination at each boundary", async () => {
    const user = userEvent.setup();
    renderExplorer();

    const previous = screen.getByRole("button", { name: "Previous page" });
    const next = screen.getByRole("button", { name: "Next page" });
    expect(previous).toBeDisabled();
    expect(next).toBeEnabled();

    await user.selectOptions(screen.getByLabelText("Rows per page"), "25");
    expect(screen.getByText("Rows 1–25 of 60")).toBeInTheDocument();
    await user.click(next);
    await user.click(next);
    expect(screen.getByText("Rows 51–60 of 60")).toBeInTheDocument();
    expect(previous).toBeEnabled();
    expect(next).toBeDisabled();

    await user.selectOptions(screen.getByLabelText("Rows per page"), "100");
    expect(screen.getByText("Rows 1–60 of 60")).toBeInTheDocument();
    expect(previous).toBeDisabled();
    expect(next).toBeDisabled();
  });

  it("does not mutate frozen row or column inputs", async () => {
    const user = userEvent.setup();
    const frozenRows = Object.freeze(
      createRows(4).map((row) => Object.freeze({ ...row })),
    );
    const frozenColumns = Object.freeze(
      columns.map((column) => Object.freeze({ ...column })),
    ) as readonly ColumnDef<TestRow, any>[];
    const rowSnapshot = JSON.stringify(frozenRows);
    const columnKeys = frozenColumns.map((column) => Object.keys(column).sort());

    renderExplorer({ rows: frozenRows, columns: frozenColumns });
    await user.click(screen.getByRole("button", { name: "Name" }));
    await user.type(screen.getByRole("searchbox", { name: "Search evidence" }), "tag");
    await user.click(screen.getByText("Columns", { selector: "summary" }));
    await user.click(screen.getByRole("checkbox", { name: "Detail" }));

    expect(JSON.stringify(frozenRows)).toBe(rowSnapshot);
    expect(frozenColumns.map((column) => Object.keys(column).sort())).toEqual(columnKeys);
  });

  it("labels the focusable region and only renders sort controls for sortable columns", async () => {
    const user = userEvent.setup();
    renderExplorer();

    const region = screen.getByRole("region", { name: "Test evidence" });
    expect(region).toHaveAttribute("tabindex", "0");
    const nameHeader = within(region).getByRole("columnheader", { name: "Name" });
    const ownerHeader = within(region).getByRole("columnheader", { name: "Owner" });
    expect(nameHeader).toHaveAttribute("aria-sort", "none");
    expect(within(nameHeader).getByRole("button", { name: "Name" })).toBeInTheDocument();
    expect(ownerHeader).not.toHaveAttribute("aria-sort");
    expect(within(ownerHeader).queryByRole("button")).not.toBeInTheDocument();

    await user.click(within(nameHeader).getByRole("button", { name: "Name" }));
    expect(nameHeader).toHaveAttribute("aria-sort", "ascending");
    await user.click(within(nameHeader).getByRole("button", { name: "Name" }));
    expect(nameHeader).toHaveAttribute("aria-sort", "descending");

    const tierHeader = within(region).getByRole("columnheader", { name: "Tier" });
    await user.keyboard("[ShiftLeft>]");
    await user.click(within(tierHeader).getByRole("button", { name: "Tier" }));
    await user.keyboard("[/ShiftLeft]");
    expect(nameHeader).toHaveAttribute("aria-sort", "none");
    expect(tierHeader).toHaveAttribute("aria-sort", "ascending");
  });

  it("uses the unfiltered empty message and normalizes an invalid page after rows change", async () => {
    const user = userEvent.setup();
    const committedSummaries: string[] = [];
    const recordSummary = () => {
      const summary = document.querySelector(".report-evidence-page-summary")?.textContent;
      if (summary) committedSummaries.push(summary);
    };
    const { rerender } = render(
      <Profiler id="evidence" onRender={recordSummary}>
        {explorer()}
      </Profiler>,
    );
    await user.click(screen.getByRole("button", { name: "Next page" }));

    committedSummaries.length = 0;
    rerender(
      <Profiler id="evidence" onRender={recordSummary}>
        {explorer({ rows: rows.slice(0, 5) })}
      </Profiler>,
    );
    expect(await screen.findByText("Rows 1–5 of 5")).toBeInTheDocument();
    expect(committedSummaries).not.toContain("Rows 51–50 of 5");
    expect(committedSummaries.every((summary) => summary === "Rows 1–5 of 5")).toBe(true);
    expect(screen.getByRole("cell", { name: "tag-1" })).toBeInTheDocument();

    rerender(
      <Profiler id="evidence" onRender={recordSummary}>
        {explorer({ rows: [] })}
      </Profiler>,
    );
    expect(screen.getByText("No rows available.")).toBeInTheDocument();
    expect(screen.getByText("Rows 0–0 of 0")).toBeInTheDocument();
  });

  it("globally filters rows whose accessor values are only boolean or null", async () => {
    const user = userEvent.setup();
    const booleanHelper = createColumnHelper<{
      readonly id: string;
      readonly active: boolean;
      readonly note: null;
    }>();
    render(
      <ReportEvidenceExplorer
        rows={[
          { id: "active", active: true, note: null },
          { id: "inactive", active: false, note: null },
        ]}
        columns={[
          booleanHelper.display({
            id: "active",
            header: "Active",
            cell: (context) => String(context.row.original.active),
          }),
          booleanHelper.display({
            id: "note",
            header: "Note",
            cell: (context) => String(context.row.original.note ?? ""),
          }),
        ]}
        ariaLabel="Boolean evidence"
        emptyMessage="No booleans."
      />,
    );

    await user.type(screen.getByRole("searchbox", { name: "Search evidence" }), "true");

    expect(screen.getByText("Rows 1–1 of 1")).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "Boolean evidence" })).getAllByRole("row")).toHaveLength(2);
    expect(screen.getByRole("cell", { name: "true" })).toBeInTheDocument();
    expect(screen.queryByRole("cell", { name: "false" })).not.toBeInTheDocument();
  });

  it("keeps fallback row IDs tied to canonical positions when facets remove earlier rows", async () => {
    const user = userEvent.setup();
    interface IdlessRow {
      readonly name: string;
      readonly tier: "Critical" | "Adequate";
    }
    const idlessHelper = createColumnHelper<IdlessRow>();
    render(
      <ReportEvidenceExplorer
        rows={[
          { name: "First", tier: "Critical" },
          { name: "Second", tier: "Adequate" },
          { name: "Third", tier: "Adequate" },
        ]}
        columns={[
          idlessHelper.display({
            id: "rowId",
            header: "Row ID",
            cell: (context) => context.row.id,
            enableSorting: false,
          }),
          idlessHelper.accessor("name", { header: "Name" }),
        ]}
        facets={[{
          id: "tier",
          label: "Tier filter",
          allLabel: "All tiers",
          options: ["Critical", "Adequate"],
          matches: (row, value) => row.tier === value,
        }]}
        ariaLabel="ID evidence"
        emptyMessage="No IDs."
      />,
    );

    await user.selectOptions(screen.getByRole("combobox", { name: "Tier filter" }), "Adequate");

    const region = screen.getByRole("region", { name: "ID evidence" });
    expect(within(region).getByRole("cell", { name: "1" })).toBeInTheDocument();
    expect(within(region).getByRole("cell", { name: "2" })).toBeInTheDocument();
    expect(within(region).queryByRole("cell", { name: "0" })).not.toBeInTheDocument();
  });

  it("uses unique canonical fallback IDs when rows contain duplicate id fields", async () => {
    const user = userEvent.setup();
    interface DuplicateIdRow {
      readonly id: string;
      readonly name: string;
    }
    const duplicateHelper = createColumnHelper<DuplicateIdRow>();
    render(
      <ReportEvidenceExplorer
        rows={[
          { id: "duplicate", name: "First" },
          { id: "duplicate", name: "Second" },
        ]}
        columns={[
          duplicateHelper.display({
            id: "rowId",
            header: "Row ID",
            cell: (context) => context.row.id,
            enableSorting: false,
          }),
          duplicateHelper.accessor("name", { header: "Name" }),
        ]}
        getSearchText={(row) => row.name}
        ariaLabel="Duplicate ID evidence"
        emptyMessage="No duplicate IDs."
      />,
    );

    const region = screen.getByRole("region", { name: "Duplicate ID evidence" });
    expect(within(region).getByRole("cell", { name: "0" })).toBeInTheDocument();
    expect(within(region).getByRole("cell", { name: "1" })).toBeInTheDocument();

    await user.type(screen.getByRole("searchbox", { name: "Search evidence" }), "Second");
    expect(within(region).getByRole("cell", { name: "1" })).toBeInTheDocument();
    expect(within(region).queryByRole("cell", { name: "0" })).not.toBeInTheDocument();
  });
});

interface ExplorerOverrides {
  rows?: readonly TestRow[];
  columns?: readonly ColumnDef<TestRow, any>[];
  defaultColumnVisibility?: Record<string, boolean>;
}

function explorer(overrides: ExplorerOverrides = {}) {
  return (
    <ReportEvidenceExplorer
      rows={overrides.rows ?? rows}
      columns={overrides.columns ?? columns}
      defaultColumnVisibility={overrides.defaultColumnVisibility ?? { detail: false }}
      facets={facets}
      ariaLabel="Test evidence"
      emptyMessage="No rows available."
      getRowId={(row) => row.id}
    />
  );
}

function renderExplorer(overrides: ExplorerOverrides = {}) {
  return render(explorer(overrides));
}

function dataRowNames(): string[] {
  return within(screen.getByRole("region", { name: "Test evidence" }))
    .getAllByRole("row")
    .slice(1)
    .map((row) => within(row).getAllByRole("cell")[0]?.textContent ?? "");
}

function createRows(count: number): TestRow[] {
  return Array.from({ length: count }, (_, index) =>
    createRow(index, index === 2 ? { name: "Alpha Needle" } : undefined),
  );
}

function createRow(index: number, overrides: Partial<TestRow> = {}): TestRow {
  return {
    id: `row-${index + 1}`,
    name: `tag-${index + 1}`,
    tier: index < 5 ? "Critical" : "Adequate",
    owner: index % 2 === 0 ? "Acme" : "Beta",
    detail: `Escalation note ${index + 1}`,
    score: index === 1 ? null : index,
    ...overrides,
  };
}
