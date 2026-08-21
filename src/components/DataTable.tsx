import { useMemo } from "react";
import type { ColumnDef, Row } from "@tanstack/react-table";
import { ReportEvidenceExplorer } from "./ReportEvidenceExplorer";

type DataRecord = Readonly<Record<string, unknown>>;

interface DataTableProps {
  readonly records: readonly DataRecord[];
}

type SortableKind = "bigint" | "boolean" | "number" | "string";

export function DataTable({ records }: DataTableProps) {
  const keys = useMemo(
    () => Array.from(new Set(records.flatMap((record) => Object.keys(record)))),
    [records],
  );
  const columnShapeKey = useMemo(() => JSON.stringify(keys), [keys]);
  const columns = useMemo<ColumnDef<DataRecord>[]>(
    () =>
      keys.map((key) => {
        const sortableKind = getSortableKind(records, key);
        return {
          id: key,
          accessorFn: (record) => record[key],
          header: key,
          cell: ({ getValue }) => formatValue(getValue()),
          enableSorting: sortableKind !== null,
          sortingFn: sortableKind
            ? (rowA, rowB, columnId) => compareValues(rowA, rowB, columnId, sortableKind)
            : undefined,
        };
      }),
    [keys, records],
  );
  const defaultColumnVisibility = useMemo(
    () => Object.fromEntries(keys.map((key, index) => [key, index < 8])),
    [keys],
  );
  const getSearchText = useMemo(
    () => (record: DataRecord) => keys.map((key) => formatValue(record[key])).join(" "),
    [keys],
  );

  if (records.length === 0) {
    return (
      <div className="empty-panel" role="status">
        No records loaded yet.
      </div>
    );
  }

  return (
    <ReportEvidenceExplorer
      key={columnShapeKey}
      rows={records}
      columns={columns}
      defaultColumnVisibility={defaultColumnVisibility}
      ariaLabel="Report evidence table"
      emptyMessage="No records match the current search."
      getSearchText={getSearchText}
    />
  );
}

function formatValue(value: unknown): string {
  if (value === undefined) return "";
  if (value === null) return "null";
  if (typeof value === "string") return value;
  if (typeof value !== "object") return String(value);

  try {
    return JSON.stringify(value, (_key, nestedValue: unknown) =>
      typeof nestedValue === "bigint" ? String(nestedValue) : nestedValue,
    );
  } catch {
    return String(value);
  }
}

function getSortableKind(records: readonly DataRecord[], key: string): SortableKind | null {
  let kind: SortableKind | null = null;
  for (const record of records) {
    const value = record[key];
    if (value === null || value === undefined) continue;
    const valueKind = typeof value;
    if (
      (valueKind !== "bigint" &&
        valueKind !== "boolean" &&
        valueKind !== "number" &&
        valueKind !== "string") ||
      (valueKind === "number" && !Number.isFinite(value))
    ) {
      return null;
    }
    if (kind !== null && kind !== valueKind) return null;
    kind = valueKind;
  }
  return kind;
}

function compareValues(
  rowA: Row<DataRecord>,
  rowB: Row<DataRecord>,
  columnId: string,
  kind: SortableKind,
): number {
  const valueA = rowA.getValue(columnId);
  const valueB = rowB.getValue(columnId);
  if (valueA === null || valueA === undefined) {
    return valueB === null || valueB === undefined ? 0 : -1;
  }
  if (valueB === null || valueB === undefined) return 1;

  switch (kind) {
    case "number":
      return (valueA as number) - (valueB as number);
    case "bigint":
      return valueA === valueB ? 0 : (valueA as bigint) < (valueB as bigint) ? -1 : 1;
    case "boolean":
      return Number(valueA) - Number(valueB);
    case "string":
      return String(valueA).localeCompare(String(valueB), "en-US", {
        numeric: true,
        sensitivity: "base",
      });
  }
}
