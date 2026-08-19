import { describe, expect, it } from "vitest";
import { buildTagLastUsedRows } from "./tagLastUsed";

describe("buildTagLastUsedRows", () => {
  it("uses the latest valid timestamp across question and article records", () => {
    expect(buildTagLastUsedRows(
      [{ name: "python" }, { name: "Café" }, { name: "unused" }],
      [
        { tags: ["python"], creation_date: 1_735_689_600 },
        { tags: ["PYTHON"], creationDate: "2025-03-04T23:59:59-05:00" },
        { tags: ["Cafe\u0301", "café"], creationDate: "2024-01-01" },
        { tags: ["unknown"], creation_date: 1_735_689_600 },
      ],
    )).toEqual([
      { tagName: "python", lastUsed: "2025-03-05" },
      { tagName: "Café", lastUsed: "2024-01-01" },
      { tagName: "unused", lastUsed: "" },
    ]);
  });

  it("ignores boolean, missing, non-finite, out-of-range, and invalid timestamps", () => {
    expect(buildTagLastUsedRows(
      [{ name: "python" }],
      [
        { tags: ["python"], creation_date: true },
        { tags: ["python"] },
        { tags: ["python"], creation_date: "Infinity" },
        { tags: ["python"], creation_date: 1e20 },
        { tags: ["python"], creation_date: "not a date" },
      ],
    )).toEqual([{ tagName: "python", lastUsed: "" }]);
  });

  it("treats large finite Unix-second timestamps as seconds", () => {
    expect(buildTagLastUsedRows(
      [{ name: "python" }],
      [{ tags: ["python"], creation_date: 100_000_000_000 }],
    )).toEqual([{ tagName: "python", lastUsed: "5138-11-16" }]);
  });

  it("accepts Unix milliseconds supplied as numbers and numeric strings", () => {
    expect(buildTagLastUsedRows(
      [{ name: "python" }, { name: "javascript" }],
      [
        { tags: ["python"], creation_date: 946_684_800_000 },
        { tags: ["javascript"], creationDate: "946684800000" },
      ],
    )).toEqual([
      { tagName: "python", lastUsed: "2000-01-01" },
      { tagName: "javascript", lastUsed: "2000-01-01" },
    ]);
  });

  it("rejects numeric timestamps outside the four-digit UTC date range", () => {
    expect(buildTagLastUsedRows(
      [{ name: "python" }],
      [{ tags: ["python"], creation_date: 300_000_000_000_000 }],
    )).toEqual([{ tagName: "python", lastUsed: "" }]);
  });

  it("rejects ISO calendar dates that Date.parse would roll over", () => {
    expect(buildTagLastUsedRows(
      [{ name: "python" }, { name: "javascript" }],
      [
        { tags: ["python"], creationDate: "2025-02-29T12:00:00Z" },
        { tags: ["javascript"], creation_date: "2024-02-30" },
      ],
    )).toEqual([
      { tagName: "python", lastUsed: "" },
      { tagName: "javascript", lastUsed: "" },
    ]);
  });

  it("keeps valid ISO leap-day timestamps", () => {
    expect(buildTagLastUsedRows(
      [{ name: "python" }],
      [{ tags: ["python"], creationDate: "2024-02-29T12:00:00Z" }],
    )).toEqual([{ tagName: "python", lastUsed: "2024-02-29" }]);
  });

  it("rejects rollover dates with lowercase-t and space separators", () => {
    expect(buildTagLastUsedRows(
      [{ name: "python" }, { name: "javascript" }],
      [
        { tags: ["python"], creationDate: "2025-02-29t12:00:00Z" },
        { tags: ["javascript"], creationDate: "2024-02-30 12:00:00Z" },
      ],
    )).toEqual([
      { tagName: "python", lastUsed: "" },
      { tagName: "javascript", lastUsed: "" },
    ]);
  });

  it("keeps valid leap-day timestamps with lowercase-t and space separators", () => {
    expect(buildTagLastUsedRows(
      [{ name: "python" }, { name: "javascript" }],
      [
        { tags: ["python"], creationDate: "2024-02-29t12:00:00Z" },
        { tags: ["javascript"], creationDate: "2024-02-29 12:00:00Z" },
      ],
    )).toEqual([
      { tagName: "python", lastUsed: "2024-02-29" },
      { tagName: "javascript", lastUsed: "2024-02-29" },
    ]);
  });

  it("trims padded strings before rejecting rollover dates and blank values", () => {
    expect(buildTagLastUsedRows(
      [{ name: "python" }, { name: "javascript" }],
      [
        { tags: ["python"], creationDate: "\t2025-02-29 12:00:00Z\n" },
        { tags: ["javascript"], creationDate: " \t\n" },
      ],
    )).toEqual([
      { tagName: "python", lastUsed: "" },
      { tagName: "javascript", lastUsed: "" },
    ]);
  });

  it("accepts padded valid ISO timestamps", () => {
    expect(buildTagLastUsedRows(
      [{ name: "python" }],
      [{ tags: ["python"], creationDate: " \n2024-02-29T12:00:00Z\t" }],
    )).toEqual([{ tagName: "python", lastUsed: "2024-02-29" }]);
  });
});
