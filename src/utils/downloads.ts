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
    ...records.map((record) => headers.map((header) => escapeCsvValue(record[header])).join(",")),
  ];

  return lines.join("\n");
}

function escapeCsvValue(value: unknown): string {
  const text = String(value ?? "");

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
