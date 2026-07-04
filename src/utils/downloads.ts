export function recordsToJson(records: unknown[]): string {
  return JSON.stringify(records, null, 2);
}

export function recordsToCsv(records: Record<string, unknown>[]): string {
  if (records.length === 0) return "";

  const headers = Object.keys(records[0]);
  const lines = [
    headers.join(","),
    ...records.map((record) => headers.map((header) => escapeCsvValue(record[header])).join(",")),
  ];

  return lines.join("\n");
}

function escapeCsvValue(value: unknown): string {
  const text = String(value ?? "");

  if (/[",\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;

  return text;
}

export function downloadTextFile(fileName: string, contents: string, mimeType: string) {
  const blob = new Blob([contents], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}
