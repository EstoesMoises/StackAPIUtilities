import { describe, expect, it } from "vitest";
import {
  CONTENT_REPLACEMENT_RECOVERY_ENVELOPE_OVERHEAD_BYTES,
  MAX_CONTENT_REPLACEMENT_CONFIGURATION_BYTES,
  MAX_CONTENT_REPLACEMENT_CREDENTIALS_BYTES,
  MAX_CONTENT_REPLACEMENT_CSV_INPUT_BYTES,
  MAX_CONTENT_REPLACEMENT_EXACT_TARGETS,
  MAX_CONTENT_REPLACEMENT_EXPORT_BYTES,
  MAX_CONTENT_REPLACEMENT_JOB_BYTES,
  MAX_CONTENT_REPLACEMENT_PASTE_BYTES,
  MAX_CONTENT_REPLACEMENT_PROPOSALS,
  MAX_CONTENT_REPLACEMENT_REQUEST_MODEL_BYTES,
  MAX_CONTENT_REPLACEMENT_ROUTE_BODY_BYTES,
  jsonUtf8ByteLength,
  utf8ByteLength,
} from "./limits";

describe("content replacement limits", () => {
  it("publishes one aligned 5,000-item ceiling", () => {
    expect(MAX_CONTENT_REPLACEMENT_EXACT_TARGETS).toBe(5_000);
    expect(MAX_CONTENT_REPLACEMENT_PROPOSALS).toBe(MAX_CONTENT_REPLACEMENT_EXACT_TARGETS);
  });

  it("measures UTF-8 rather than UTF-16 code units", () => {
    expect(utf8ByteLength("ASCII")).toBe(5);
    expect(utf8ByteLength("é")).toBe(2);
    expect(utf8ByteLength("😀")).toBe(4);
    expect(jsonUtf8ByteLength({ value: "é" })).toBe(14);
    expect(jsonUtf8ByteLength(undefined)).toBeNull();
  });

  it("reserves a route envelope for one recoverable model plus bounded configuration and credentials", () => {
    expect(
      MAX_CONTENT_REPLACEMENT_REQUEST_MODEL_BYTES +
      MAX_CONTENT_REPLACEMENT_CONFIGURATION_BYTES +
      MAX_CONTENT_REPLACEMENT_CREDENTIALS_BYTES +
      CONTENT_REPLACEMENT_RECOVERY_ENVELOPE_OVERHEAD_BYTES,
    ).toBeLessThanOrEqual(MAX_CONTENT_REPLACEMENT_ROUTE_BODY_BYTES);
  });

  it("sets finite local input, storage, and export budgets", () => {
    for (const limit of [
      MAX_CONTENT_REPLACEMENT_CSV_INPUT_BYTES,
      MAX_CONTENT_REPLACEMENT_PASTE_BYTES,
      MAX_CONTENT_REPLACEMENT_JOB_BYTES,
      MAX_CONTENT_REPLACEMENT_EXPORT_BYTES,
    ]) {
      expect(Number.isSafeInteger(limit)).toBe(true);
      expect(limit).toBeGreaterThan(0);
    }
  });
});
