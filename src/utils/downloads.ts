import { formatApiDateTime } from "./apiDates";

export function recordsToJson(records: unknown[]): string {
  return JSON.stringify(records, null, 2);
}

export function recordsToCsv(records: Record<string, unknown>[]): string {
  if (records.length === 0) return "";

  const headers = [...new Set(records.flatMap((record) => Object.keys(record)))];
  return recordsToCsvWithHeaders(headers, records);
}

export function recordsToCsvWithHeaders(
  headers: readonly string[],
  records: readonly Record<string, unknown>[],
): string {
  const lines = [
    headers.join(","),
    ...records.map((record) => headers.map((header) => escapeCsvValue(formatCsvValue(header, record[header]))).join(",")),
  ];

  return lines.join("\n");
}

function formatCsvValue(key: string, value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => formatCsvValue(key, item));
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([childKey, childValue]) => [
      childKey, formatCsvValue(childKey, childValue),
    ]));
  }

  // Restrict conversion to date columns so large IDs, counts, and duration metrics stay numeric.
  const normalizedKey = key.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
  const isDateField = /(?:^|_)(?:date|timestamp|at)$/.test(normalizedKey) ||
    ["last_used", "last_seen", "last_active", "last_activity", "last_login"].includes(normalizedKey);
  return isDateField ? formatApiDateTime(value) || value : value;
}

function escapeCsvValue(value: unknown): string {
  const text = value !== null && typeof value === "object" ? JSON.stringify(value) : String(value ?? "");

  if (/[",\r\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;

  return text;
}

export function downloadBlobFile(fileName: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = fileName;

  try {
    link.click();
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function downloadTextFile(fileName: string, contents: string, mimeType: string): void {
  downloadBlobFile(fileName, new Blob([contents], { type: mimeType }));
}
