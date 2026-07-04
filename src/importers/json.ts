export function parseJsonRecords(text: string): unknown[] {
  const parsed = JSON.parse(text);

  if (!Array.isArray(parsed)) {
    throw new Error("Expected a JSON array.");
  }

  return parsed;
}
