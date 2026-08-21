import { useMemo } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { ReportEvidenceExplorer } from "./ReportEvidenceExplorer";

type DataRecord = Readonly<Record<string, unknown>>;

interface DataTableProps {
  readonly records: readonly DataRecord[];
}

type SortableKind = "bigint" | "boolean" | "number" | "string";

interface PreparedValue {
  readonly value: unknown;
  readonly text: string;
  readonly readable: boolean;
}

interface PreparedRecord {
  readonly values: ReadonlyMap<string, PreparedValue>;
  readonly searchText: string;
}

interface PreparedColumn {
  readonly id: string;
  readonly key: string;
  readonly sortableKind: SortableKind | null;
}

interface MutableColumn {
  readonly id: string;
  readonly key: string;
  sortableKind: SortableKind | null;
  sortingDisabled: boolean;
}

interface PreparedTable {
  readonly rows: readonly PreparedRecord[];
  readonly columns: readonly PreparedColumn[];
}

const unreadableText = "[Unreadable]";
const unrenderableText = "[Unrenderable]";
const maxFormattedLength = 2_000;
const maxScalarLength = 256;
const maxCollectionItems = 24;
const maxDepth = 6;
const maxNodes = 128;

export function DataTable({ records }: DataTableProps) {
  const prepared = useMemo(() => prepareTable(records), [records]);
  const columnShapeKey = useMemo(
    () => JSON.stringify(prepared.columns.map((column) => column.key)),
    [prepared.columns],
  );
  const columns = useMemo<ColumnDef<PreparedRecord>[]>(
    () =>
      prepared.columns.map((column) => ({
        id: column.id,
        accessorFn: (record) => record.values.get(column.key)?.value,
        header: column.key,
        cell: ({ row }) => row.original.values.get(column.key)?.text ?? "",
        enableSorting: column.sortableKind !== null,
        sortingFn: column.sortableKind
          ? (rowA, rowB) =>
              compareValues(rowA.original, rowB.original, column.key, column.sortableKind!)
          : undefined,
      })),
    [prepared.columns],
  );
  const defaultColumnVisibility = useMemo(
    () =>
      Object.fromEntries(
        prepared.columns.map((column, index) => [column.id, index < 8]),
      ),
    [prepared.columns],
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
      rows={prepared.rows}
      columns={columns}
      defaultColumnVisibility={defaultColumnVisibility}
      ariaLabel="Report evidence table"
      emptyMessage="No records match the current search."
      getSearchText={(record) => record.searchText}
    />
  );
}

function prepareTable(records: readonly DataRecord[]): PreparedTable {
  const mutableColumns: MutableColumn[] = [];
  const columnsByKey = new Map<string, MutableColumn>();
  const rows = records.map((record) => {
    const values = new Map<string, PreparedValue>();
    const searchParts: string[] = [];
    const keys = safeEnumerableKeys(record) ?? [];
    for (const key of keys) {
      let column = columnsByKey.get(key);
      if (!column) {
        column = {
          id: `report-field-${mutableColumns.length}`,
          key,
          sortableKind: null,
          sortingDisabled: false,
        };
        columnsByKey.set(key, column);
        mutableColumns.push(column);
      }

      const preparedValue = prepareProperty(record, key);
      values.set(key, preparedValue);
      searchParts.push(preparedValue.text);
      updateSortableKind(column, preparedValue);
    }
    return { values, searchText: searchParts.join(" ") };
  });
  const columns = mutableColumns.map((column) => ({
    id: column.id,
    key: column.key,
    sortableKind: column.sortingDisabled ? null : column.sortableKind,
  }));
  return { rows, columns };
}

function prepareProperty(record: DataRecord, key: string): PreparedValue {
  try {
    const value = Reflect.get(record, key);
    return { value, text: formatValue(value), readable: true };
  } catch {
    return { value: undefined, text: unreadableText, readable: false };
  }
}

function updateSortableKind(column: MutableColumn, prepared: PreparedValue): void {
  if (column.sortingDisabled) return;
  if (!prepared.readable) {
    column.sortingDisabled = true;
    return;
  }
  const value = prepared.value;
  if (value === null || value === undefined) return;
  const kind = typeof value;
  if (
    (kind !== "bigint" && kind !== "boolean" && kind !== "number" && kind !== "string") ||
    (kind === "number" && !Number.isFinite(value))
  ) {
    column.sortingDisabled = true;
    return;
  }
  if (column.sortableKind !== null && column.sortableKind !== kind) {
    column.sortingDisabled = true;
    return;
  }
  column.sortableKind = kind;
}

function compareValues(
  rowA: PreparedRecord,
  rowB: PreparedRecord,
  key: string,
  kind: SortableKind,
): number {
  const valueA = rowA.values.get(key)?.value;
  const valueB = rowB.values.get(key)?.value;
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

function formatValue(value: unknown): string {
  try {
    const text = serializeValue(
      value,
      { ancestors: new WeakSet<object>(), nodesRemaining: maxNodes },
      0,
      false,
    );
    return text.length <= maxFormattedLength
      ? text
      : `${text.slice(0, maxFormattedLength - 1)}…`;
  } catch {
    return unrenderableText;
  }
}

interface SerializationState {
  readonly ancestors: WeakSet<object>;
  nodesRemaining: number;
}

function serializeValue(
  value: unknown,
  state: SerializationState,
  depth: number,
  nested: boolean,
): string {
  if (state.nodesRemaining <= 0) return quoteMarker("Truncated");
  state.nodesRemaining -= 1;

  if (value === null) return "null";
  switch (typeof value) {
    case "undefined":
      return "undefined";
    case "string":
      return nested ? quoteString(value) : truncateScalar(value);
    case "number":
    case "boolean":
      return String(value);
    case "bigint":
      return `${value}n`;
    case "symbol":
      return Symbol.prototype.toString.call(value);
    case "function":
      return nested ? quoteMarker("Function") : "[Function]";
  }

  if (depth >= maxDepth) return quoteMarker("Max depth");
  if (state.ancestors.has(value)) return quoteMarker("Circular");
  state.ancestors.add(value);
  try {
    let isArray: boolean;
    try {
      isArray = Array.isArray(value);
    } catch {
      return quoteMarker("Uninspectable");
    }
    return isArray
      ? serializeArray(value, state, depth + 1)
      : serializeObject(value, state, depth + 1);
  } finally {
    state.ancestors.delete(value);
  }
}

function serializeArray(
  value: object,
  state: SerializationState,
  depth: number,
): string {
  let length: number;
  try {
    const candidate = Reflect.get(value, "length");
    length = typeof candidate === "number" && Number.isSafeInteger(candidate) && candidate >= 0
      ? candidate
      : 0;
  } catch {
    return quoteMarker("Uninspectable");
  }
  const itemCount = Math.min(length, maxCollectionItems);
  const parts: string[] = [];
  for (let index = 0; index < itemCount; index += 1) {
    const item = safeRead(value, String(index));
    parts.push(
      item.readable
        ? serializeValue(item.value, state, depth, true)
        : quoteMarker("Unreadable"),
    );
  }
  if (length > itemCount) parts.push(quoteMarker("Truncated"));
  return `[${parts.join(",")}]`;
}

function serializeObject(
  value: object,
  state: SerializationState,
  depth: number,
): string {
  const keys = safeEnumerableKeys(value);
  if (keys === null) return quoteMarker("Uninspectable");
  const visibleKeys = keys.slice(0, maxCollectionItems);
  const parts = visibleKeys.map((key) => {
    const property = safeRead(value, key);
    const rendered = property.readable
      ? serializeValue(property.value, state, depth, true)
      : quoteMarker("Unreadable");
    return `${quoteString(key)}:${rendered}`;
  });
  if (keys.length > visibleKeys.length) {
    parts.push(`${quoteString("…")}:${quoteMarker("Truncated")}`);
  }
  return `{${parts.join(",")}}`;
}

function safeEnumerableKeys(value: object): readonly string[] | null {
  try {
    return Object.keys(value);
  } catch {
    return null;
  }
}

function safeRead(
  value: object,
  key: string,
): { readonly readable: true; readonly value: unknown } | { readonly readable: false } {
  try {
    return { readable: true, value: Reflect.get(value, key) };
  } catch {
    return { readable: false };
  }
}

function quoteMarker(marker: string): string {
  return `"[${marker}]"`;
}

function quoteString(value: string): string {
  return JSON.stringify(truncateScalar(value));
}

function truncateScalar(value: string): string {
  return value.length <= maxScalarLength
    ? value
    : `${value.slice(0, maxScalarLength - 1)}…`;
}
