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
      { tagName: "python", lastUsed: "2025-03-05 04:59:59" },
      { tagName: "Café", lastUsed: "2024-01-01 00:00:00" },
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
    )).toEqual([{ tagName: "python", lastUsed: "5138-11-16 09:46:40" }]);
  });

  it("accepts Unix milliseconds supplied as numbers and numeric strings", () => {
    expect(buildTagLastUsedRows(
      [{ name: "python" }, { name: "javascript" }],
      [
        { tags: ["python"], creation_date: 946_684_800_000 },
        { tags: ["javascript"], creationDate: "946684800000" },
      ],
    )).toEqual([
      { tagName: "python", lastUsed: "2000-01-01 00:00:00" },
      { tagName: "javascript", lastUsed: "2000-01-01 00:00:00" },
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
    )).toEqual([{ tagName: "python", lastUsed: "2024-02-29 12:00:00" }]);
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
      { tagName: "python", lastUsed: "2024-02-29 12:00:00" },
      { tagName: "javascript", lastUsed: "2024-02-29 12:00:00" },
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
    )).toEqual([{ tagName: "python", lastUsed: "2024-02-29 12:00:00" }]);
  });

  it.each([
    ["2024-02-29T23:59:59.123Z", "2024-02-29 23:59:59.123"],
    ["2024-02-29T23:59Z", "2024-02-29 23:59:00"],
    ["2024-02-29t23:59:59z", "2024-02-29 23:59:59"],
    ["2024-02-29 23:59:59+02:30", "2024-02-29 21:29:59"],
    ["2024-02-29 23:59:59+14:00", "2024-02-29 09:59:59"],
    ["2024-02-29T12:00:00", "2024-02-29 12:00:00"],
    ["2024-02-29T12:00:00.1234567", "2024-02-29 12:00:00.123"],
  ])("preserves UTC time from ISO timestamp %s", (timestamp, expected) => {
    expect(buildTagLastUsedRows(
      [{ name: "python" }],
      [{ tags: ["python"], creationDate: timestamp }],
    )).toEqual([{ tagName: "python", lastUsed: expected }]);
  });

  it.each([
    "+002025-02-29T12:00:00Z",
    "2024/02/29",
    "2024-02-29Z",
    "2024-02-29T24:00:00Z",
    "2024-02-29T12:60:00Z",
    "2024-02-29T12:00:60Z",
    "2024-02-29T12:00:00+24:00",
    "2024-02-29T12:00:00+12:60",
    "2024-02-29T12:00:00+14:01",
    "2024-02-29T12:00:00-15:00",
  ])("rejects timestamp syntax outside the strict contract: %s", (timestamp) => {
    expect(buildTagLastUsedRows(
      [{ name: "python" }],
      [{ tags: ["python"], creationDate: timestamp }],
    )).toEqual([{ tagName: "python", lastUsed: "" }]);
  });
});
