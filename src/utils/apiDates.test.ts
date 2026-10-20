import { describe, expect, it } from "vitest";
import { formatApiDateTime, formatUtcDateTime, parseApiTimestamp } from "./apiDates";

describe("API datetime normalization", () => {
  it.each([
    [1_735_689_600, "2025-01-01 00:00:00"],
    ["1735689600.125", "2025-01-01 00:00:00.125"],
    [1_735_689_600_125, "2025-01-01 00:00:00.125"],
    ["946684800000", "2000-01-01 00:00:00"],
    [0, "1970-01-01 00:00:00"],
    [-1, "1969-12-31 23:59:59"],
    ["2024-02-29", "2024-02-29 00:00:00"],
    ["2025-01-01T12:34", "2025-01-01 12:34:00"],
    ["2025-01-01 12:34:56.1", "2025-01-01 12:34:56.100"],
    ["2025-01-01T12:34:56.1234567Z", "2025-01-01 12:34:56.123"],
    ["2025-01-01T12:34:56.000001Z", "2025-01-01 12:34:56"],
    ["2025-01-01T00:00:00+01:00", "2024-12-31 23:00:00"],
    ["2025-01-01t23:00:00-02:00", "2025-01-02 01:00:00"],
    ["0000-01-01T00:00:00Z", "0000-01-01 00:00:00"],
    ["0099-01-01T00:00:00Z", "0099-01-01 00:00:00"],
    ["9999-12-31T23:59:59.999Z", "9999-12-31 23:59:59.999"],
  ])("formats %s in UTC without losing its time", (input, expected) => {
    expect(formatApiDateTime(input)).toBe(expected);
  });

  it.each([
    null, undefined, true, false, {}, [], "", " \t", Number.NaN, Infinity,
    "NaN", "Infinity", "0x1234", "2025-02-29", "1900-02-29", "2024-02-30",
    "2024-00-01", "2024-13-01", "2024-01-00", "2024-01-32", "2024/01/01",
    "2024-01-01T24:00:00", "2024-01-01T12:60:00", "2024-01-01T12:00:60",
    "2024-01-01T12:00:00+14:01", "2024-01-01T12:00:00-15:00", "2024-01-01T12:00:00+01:60",
    "0000-01-01T00:00:00+01:00", "9999-12-31T23:59:59-01:00", "10000-01-01", 300_000_000_000_000,
  ])("rejects malformed or out-of-range timestamp %s", (input) => {
    expect(parseApiTimestamp(input)).toBeNull();
    expect(formatApiDateTime(input)).toBe("");
  });

  it("returns milliseconds for duration calculations and normalizes absent timezones to UTC", () => {
    expect(parseApiTimestamp("2025-01-01T00:00:00.125")).toBe(1_735_689_600_125);
    expect(parseApiTimestamp(1_735_689_600)).toBe(1_735_689_600_000);
  });

  it("formats millisecond inputs directly and leaves missing or invalid milliseconds blank", () => {
    expect(formatUtcDateTime(1_000)).toBe("1970-01-01 00:00:01");
    expect(formatUtcDateTime(-1)).toBe("1969-12-31 23:59:59.999");
    for (const value of [null, undefined, NaN, Infinity, 8.64e15, 300_000_000_000_000]) {
      expect(formatUtcDateTime(value)).toBe("");
    }
  });
});
