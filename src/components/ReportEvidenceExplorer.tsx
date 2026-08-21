import { useEffect, useMemo, useState } from "react";
import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type PaginationState,
  type Row,
  type SortingState,
  type VisibilityState,
} from "@tanstack/react-table";

export interface EvidenceFacet<TRow> {
  readonly id: string;
  readonly label: string;
  readonly allLabel: string;
  readonly options: readonly string[];
  readonly matches: (row: TRow, value: string) => boolean;
}

export interface ReportEvidenceExplorerProps<TRow> {
  readonly rows: readonly TRow[];
  readonly columns: readonly ColumnDef<TRow, any>[];
  readonly defaultColumnVisibility?: Readonly<VisibilityState>;
  readonly facets?: readonly EvidenceFacet<TRow>[];
  readonly ariaLabel: string;
  readonly emptyMessage: string;
  readonly getSearchText?: (row: TRow) => string;
  readonly getRowId?: (originalRow: TRow, index: number, parent?: Row<TRow>) => string;
}

const pageSizes = [25, 50, 100] as const;
const emptyFacets: readonly never[] = Object.freeze([]);
const searchColumnId = "__reportEvidenceSearchText";

export function ReportEvidenceExplorer<TRow>({
  rows,
  columns,
  defaultColumnVisibility = {},
  facets: providedFacets,
  ariaLabel,
  emptyMessage,
  getSearchText,
  getRowId,
}: ReportEvidenceExplorerProps<TRow>) {
  const facets = providedFacets ?? emptyFacets;
  const [search, setSearch] = useState("");
  const [sorting, setSorting] = useState<SortingState>([]);
  const [facetValues, setFacetValues] = useState<Record<string, string>>({});
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>(() => ({
    ...defaultColumnVisibility,
    [searchColumnId]: false,
  }));
  const [pagination, setPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: 50,
  });

  const facetFilteredRows = useMemo(
    () =>
      rows.filter((row) =>
        facets.every((facet) => {
          const selectedValue = facetValues[facet.id];
          return !selectedValue || facet.matches(row, selectedValue);
        }),
      ),
    [facetValues, facets, rows],
  );
  const query = normalizeSearch(search);
  const tableRows = useMemo(() => [...facetFilteredRows], [facetFilteredRows]);
  const tableColumns = useMemo<ColumnDef<TRow, any>[]>(
    () => [
      ...columns.map((column) => ({ ...column })),
      {
        id: searchColumnId,
        accessorFn: (row) => (getSearchText ?? defaultSearchText)(row),
        enableGlobalFilter: true,
        enableHiding: false,
        enableSorting: false,
      },
    ],
    [columns, getSearchText],
  );
  const canonicalIndexes = useMemo(() => {
    const indexes = new Map<unknown, number[]>();
    rows.forEach((row, index) => {
      const existing = indexes.get(row);
      if (existing) existing.push(index);
      else indexes.set(row, [index]);
    });
    return indexes;
  }, [rows]);

  const table = useReactTable({
    data: tableRows,
    columns: tableColumns,
    state: {
      globalFilter: search,
      sorting,
      columnVisibility,
      pagination,
    },
    onSortingChange: setSorting,
    onColumnVisibilityChange: setColumnVisibility,
    onPaginationChange: setPagination,
    globalFilterFn: (row, columnId, filterValue) =>
      normalizeSearch(row.getValue(columnId)).includes(normalizeSearch(filterValue)),
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getColumnCanGlobalFilter: (column) => column.id === searchColumnId,
    getRowId:
      getRowId ??
      ((row, index) => defaultRowId(row, index, tableRows, canonicalIndexes)),
    autoResetPageIndex: false,
    enableMultiSort: false,
    enableSortingRemoval: false,
    sortDescFirst: false,
  });

  const totalRows = table.getFilteredRowModel().rows.length;
  const maximumPageIndex = Math.max(
    0,
    Math.ceil(totalRows / pagination.pageSize) - 1,
  );
  const effectivePagination =
    pagination.pageIndex > maximumPageIndex
      ? { ...pagination, pageIndex: maximumPageIndex }
      : pagination;
  if (effectivePagination !== pagination) {
    table.setOptions((current) => ({
      ...current,
      state: { ...current.state, pagination: effectivePagination },
    }));
  }
  const pageRows = table.getRowModel().rows;
  const visibleDataColumnCount = table
    .getVisibleLeafColumns()
    .filter((column) => column.id !== searchColumnId).length;

  useEffect(() => {
    if (pagination.pageIndex > maximumPageIndex) {
      setPagination((current) => ({ ...current, pageIndex: maximumPageIndex }));
    }
  }, [maximumPageIndex, pagination.pageIndex]);

  const firstRow = totalRows === 0
    ? 0
    : effectivePagination.pageIndex * effectivePagination.pageSize + 1;
  const lastRow = totalRows === 0 ? 0 : firstRow + pageRows.length - 1;
  const hasActiveFilter =
    query !== "" || facets.some((facet) => Boolean(facetValues[facet.id]));

  const resetToFirstPage = () => {
    setPagination((current) =>
      current.pageIndex === 0 ? current : { ...current, pageIndex: 0 },
    );
  };

  return (
    <div className="report-evidence-explorer">
      <div className="report-evidence-controls">
        <label className="report-evidence-control report-evidence-search">
          <span>Search evidence</span>
          <input
            className="s-input"
            type="search"
            value={search}
            onChange={(event) => {
              setSearch(event.currentTarget.value);
              resetToFirstPage();
            }}
          />
        </label>
        {facets.map((facet) => (
          <label className="report-evidence-control" key={facet.id}>
            <span>{facet.label}</span>
            <select
              className="s-select"
              value={facetValues[facet.id] ?? ""}
              onChange={(event) => {
                const selectedValue = event.currentTarget.value;
                setFacetValues((current) => ({
                  ...current,
                  [facet.id]: selectedValue,
                }));
                resetToFirstPage();
              }}
            >
              <option value="">{facet.allLabel}</option>
              {facet.options.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
        ))}
        <details className="report-column-menu">
          <summary className="s-btn s-btn__outlined">Columns</summary>
          <div className="report-column-options">
            {table
              .getAllLeafColumns()
              .filter((column) => column.getCanHide())
              .map((column) => {
                const isLastVisibleColumn =
                  column.getIsVisible() && visibleDataColumnCount === 1;
                return (
                  <label key={column.id}>
                    <input
                      type="checkbox"
                      checked={column.getIsVisible()}
                      disabled={isLastVisibleColumn}
                      onChange={column.getToggleVisibilityHandler()}
                    />
                    <span>{getColumnLabel(column.columnDef.header, column.id)}</span>
                  </label>
                );
              })}
          </div>
        </details>
      </div>

      <div
        className="report-evidence-table-wrap"
        role="region"
        aria-label={ariaLabel}
        tabIndex={0}
      >
        <table className="s-table report-evidence-table">
          <thead>
            {table.getHeaderGroups().map((headerGroup) => (
              <tr key={headerGroup.id}>
                {headerGroup.headers.map((header) => {
                  const canSort = header.column.getCanSort();
                  const sorted = header.column.getIsSorted();
                  const ariaSort = canSort
                    ? sorted === "asc"
                      ? "ascending"
                      : sorted === "desc"
                        ? "descending"
                        : "none"
                    : undefined;

                  return (
                    <th
                      key={header.id}
                      scope="col"
                      colSpan={header.colSpan}
                      aria-sort={ariaSort}
                    >
                      {header.isPlaceholder ? null : canSort ? (
                        <button
                          className="report-evidence-sort-button"
                          type="button"
                          onClick={header.column.getToggleSortingHandler()}
                        >
                          {flexRender(
                            header.column.columnDef.header,
                            header.getContext(),
                          )}
                          <span
                            className="report-evidence-sort-indicator"
                            data-sort={sorted || "none"}
                            aria-hidden="true"
                          />
                        </button>
                      ) : (
                        flexRender(
                          header.column.columnDef.header,
                          header.getContext(),
                        )
                      )}
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>
          <tbody>
            {pageRows.length > 0 ? (
              pageRows.map((row) => (
                <tr key={row.id}>
                  {row.getVisibleCells().map((cell) => (
                    <td key={cell.id}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              ))
            ) : (
              <tr>
                <td
                  className="report-evidence-empty"
                  colSpan={Math.max(1, table.getVisibleLeafColumns().length)}
                >
                  {hasActiveFilter
                    ? "No evidence matches the current filters."
                    : emptyMessage}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="report-evidence-pagination">
        <span className="report-evidence-page-summary" aria-live="polite">
          {`Rows ${firstRow}–${lastRow} of ${totalRows}`}
        </span>
        <label className="report-evidence-page-size">
          <span>Rows per page</span>
          <select
            className="s-select"
            value={pagination.pageSize}
            onChange={(event) => {
              setPagination({
                pageIndex: 0,
                pageSize: Number(event.currentTarget.value),
              });
            }}
          >
            {pageSizes.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
        </label>
        <div className="report-evidence-page-actions">
          <button
            className="s-btn s-btn__outlined"
            type="button"
            aria-label="Previous page"
            disabled={!table.getCanPreviousPage()}
            onClick={() => table.previousPage()}
          >
            Previous
          </button>
          <button
            className="s-btn s-btn__outlined"
            type="button"
            aria-label="Next page"
            disabled={!table.getCanNextPage()}
            onClick={() => table.nextPage()}
          >
            Next
          </button>
        </div>
      </div>
    </div>
  );
}

function normalizeSearch(value: unknown): string {
  return String(value ?? "").trim().toLocaleLowerCase("en-US");
}

function defaultSearchText(row: unknown): string {
  const parts: string[] = [];
  const values = row !== null && typeof row === "object" && !Array.isArray(row)
    ? Object.values(row)
    : [row];
  values.forEach((value) => appendPrimitiveSearchValues(value, parts));
  return parts.join(" ");
}

function appendPrimitiveSearchValues(value: unknown, parts: string[]): void {
  if (Array.isArray(value)) {
    value.forEach((item) => appendPrimitiveSearchValues(item, parts));
    return;
  }
  switch (typeof value) {
    case "string":
    case "number":
    case "bigint":
    case "boolean":
      parts.push(String(value));
  }
}

function defaultRowId<TRow>(
  row: TRow,
  index: number,
  currentRows: readonly TRow[],
  canonicalIndexes: ReadonlyMap<unknown, readonly number[]>,
): string {
  const positions = canonicalIndexes.get(row);
  if (!positions || positions.length === 0) return String(index);
  if (positions.length === 1) return String(positions[0]);

  let occurrence = 0;
  for (let currentIndex = 0; currentIndex < index; currentIndex += 1) {
    if (Object.is(currentRows[currentIndex], row)) occurrence += 1;
  }
  return String(positions[occurrence] ?? positions[0]);
}

function getColumnLabel(header: unknown, columnId: string): string {
  if (typeof header === "string" && header.trim() !== "") return header;
  return columnId
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/^./, (character) => character.toLocaleUpperCase("en-US"));
}
