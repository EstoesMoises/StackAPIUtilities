import { useMemo, useState } from "react";
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  useReactTable,
  type SortingFn,
  type SortingState,
} from "@tanstack/react-table";
import type { SmeCoverageEvidenceRow } from "../utilities/smeCoverage/model";
import { formatDisplayedRatio } from "../utilities/smeCoverage/narrative";

interface SmeCoverageEvidenceTableProps {
  evidence: readonly SmeCoverageEvidenceRow[];
}

const columnHelper = createColumnHelper<SmeCoverageEvidenceRow>();
const codeUnitSort: SortingFn<SmeCoverageEvidenceRow> = (left, right, columnId) => {
  const leftValue = String(left.getValue(columnId));
  const rightValue = String(right.getValue(columnId));
  return leftValue < rightValue ? -1 : leftValue > rightValue ? 1 : 0;
};

const columns = [
  columnHelper.accessor("tagName", {
    header: "Tag",
    sortingFn: codeUnitSort,
    cell: (context) => <strong>{context.getValue()}</strong>,
  }),
  columnHelper.accessor((row) => row.pageViews ?? undefined, {
    id: "pageViews",
    header: "Page views",
    sortUndefined: "last",
    cell: (context) => formatNumber(context.getValue()),
  }),
  columnHelper.accessor((row) => row.questionCount ?? undefined, {
    id: "questionCount",
    header: "Questions",
    sortUndefined: "last",
    cell: (context) => formatNumber(context.getValue()),
  }),
  columnHelper.accessor("questionCountBasis", {
    header: "Question-count basis",
    sortingFn: codeUnitSort,
  }),
  columnHelper.accessor((row) => row.smeCount ?? undefined, {
    id: "smeCount",
    header: "SMEs",
    sortUndefined: "last",
    cell: (context) => formatSmeCount(context.getValue()),
  }),
  columnHelper.accessor((row) => row.pageViewsPerSme ?? undefined, {
    id: "pageViewsPerSme",
    header: "Page views per SME",
    sortUndefined: "last",
    cell: (context) => {
      const value = context.getValue();
      return value === undefined ? "Unavailable" : formatDisplayedRatio(value);
    },
  }),
  columnHelper.accessor((row) => row.coveragePercentile ?? undefined, {
    id: "coveragePercentile",
    header: "Coverage percentile",
    sortUndefined: "last",
    cell: (context) => formatNumber(context.getValue()),
  }),
  columnHelper.accessor("coverageTier", {
    header: "Coverage tier",
    sortingFn: codeUnitSort,
    cell: (context) => (
      <span className={`sme-tier-badge sme-tier-badge__${tierClass(context.getValue())}`}>
        {context.getValue()}
      </span>
    ),
  }),
  columnHelper.accessor("demandQuality", {
    header: "Demand quality",
    sortingFn: codeUnitSort,
  }),
  columnHelper.accessor("smeQuality", {
    header: "SME quality",
    sortingFn: codeUnitSort,
  }),
  columnHelper.accessor("reason", {
    header: "Reason",
    sortingFn: codeUnitSort,
  }),
  columnHelper.accessor("recommendedAction", {
    header: "Recommended action",
    sortingFn: codeUnitSort,
  }),
];

export function SmeCoverageEvidenceTable({ evidence }: SmeCoverageEvidenceTableProps) {
  const [search, setSearch] = useState("");
  const [sorting, setSorting] = useState<SortingState>([]);
  const tableData = useMemo(() => [...evidence], [evidence]);
  const table = useReactTable({
    data: tableData,
    columns,
    state: { globalFilter: search, sorting },
    onGlobalFilterChange: setSearch,
    onSortingChange: setSorting,
    globalFilterFn: (row, _columnId, filterValue) => {
      const query = String(filterValue).toLocaleLowerCase("en-US");
      return Object.values(row.original).some((value) =>
        String(value ?? "Unavailable").toLocaleLowerCase("en-US").includes(query),
      );
    },
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getSortedRowModel: getSortedRowModel(),
    enableSortingRemoval: false,
    sortDescFirst: false,
  });
  const rows = table.getRowModel().rows;

  return (
    <div className="sme-evidence">
      <label className="sme-evidence-search">
        <span>Search evidence</span>
        <input
          className="s-input"
          type="search"
          value={search}
          onChange={(event) => setSearch(event.currentTarget.value)}
        />
      </label>
      <div
        className="sme-evidence-table-wrap"
        role="region"
        aria-label="SME coverage evidence table"
        tabIndex={0}
      >
        <table className="s-table sme-evidence-table">
          <thead>
            {table.getHeaderGroups().map((headerGroup) => (
              <tr key={headerGroup.id}>
                {headerGroup.headers.map((header) => {
                  const sorted = header.column.getIsSorted();
                  return (
                    <th
                      key={header.id}
                      scope="col"
                      aria-sort={
                        sorted === "asc" ? "ascending" : sorted === "desc" ? "descending" : "none"
                      }
                    >
                      <button
                        className="sme-sort-button"
                        type="button"
                        onClick={header.column.getToggleSortingHandler()}
                      >
                        {flexRender(header.column.columnDef.header, header.getContext())}
                        <span className="sme-sort-indicator" aria-hidden="true">
                          {sorted === "asc" ? "↑" : sorted === "desc" ? "↓" : "↕"}
                        </span>
                      </button>
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>
          <tbody>
            {rows.length > 0 ? (
              rows.map((row) => (
                <tr key={row.id}>
                  {row.getVisibleCells().map((cell) => (
                    <td key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</td>
                  ))}
                </tr>
              ))
            ) : (
              <tr>
                <td className="sme-evidence-empty" colSpan={columns.length}>
                  {search ? "No evidence matches this search." : "No evidence rows are in this decision pack."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function formatNumber(value: number | undefined): string {
  return value === undefined
    ? "Unavailable"
    : value.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

function formatSmeCount(value: number | undefined): string {
  if (value === undefined) return "Unavailable";
  if (value === 0) return "No SME";
  return value.toLocaleString("en-US");
}

function tierClass(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-");
}
