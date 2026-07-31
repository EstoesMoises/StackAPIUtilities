import { describe, expect, it } from "vitest";
import {
  chooseDisplayTagName,
  compareCodeUnits,
  normalizeTagIdentity,
  readNonNegativeNumber,
  readQuestionTags,
  readStableQuestionId,
  readTagIdentity,
} from "./tagNormalization";

describe("tag normalization", () => {
  it("canonicalizes tag identities without collapsing internal whitespace", () => {
    expect(normalizeTagIdentity("  Café  ")).toEqual({ key: "café", displayName: "Café" });
    expect(normalizeTagIdentity("Ｃ＃")).toEqual({ key: "c#", displayName: "C#" });
    expect(normalizeTagIdentity("edge-gateway")).toEqual({
      key: "edge-gateway",
      displayName: "edge-gateway",
    });
    expect(normalizeTagIdentity("go  code")).toEqual({ key: "go  code", displayName: "go  code" });
    expect(normalizeTagIdentity("   ")).toBeNull();
  });

  it("uses code-unit order to select a deterministic display spelling", () => {
    expect(compareCodeUnits("Python", "python")).toBeLessThan(0);
    expect(chooseDisplayTagName(["python", "Python", " PYTHON "])).toBe("PYTHON");
  });

  it("reads distinct normalized tags from question tag fields", () => {
    expect(readQuestionTags({ tags: [" JavaScript ", "javascript", "Café", "Cafe\u0301"] })).toEqual([
      { key: "javascript", displayName: "JavaScript" },
      { key: "café", displayName: "Café" },
    ]);
    expect(readQuestionTags({ tagNames: "python; JavaScript, javascript" })).toEqual([
      { key: "python", displayName: "python" },
      { key: "javascript", displayName: "JavaScript" },
    ]);
    expect(readQuestionTags({ tag_name: "  C#  " })).toEqual([{ key: "c#", displayName: "C#" }]);
  });

  it("reads a tag identity from supported single-tag aliases", () => {
    expect(readTagIdentity({ tagName: "  Café  " })).toEqual({ key: "café", displayName: "Café" });
    expect(readTagIdentity({ name: "  " })).toBeNull();
  });

  it("accepts only non-negative finite numeric metric values", () => {
    expect(readNonNegativeNumber({ value: "12.5" }, ["value"])).toBe(12.5);
    expect(readNonNegativeNumber({ value: 0 }, ["value"])).toBe(0);
    expect(readNonNegativeNumber({ value: -1 }, ["value"])).toBeNull();
    expect(readNonNegativeNumber({ value: "" }, ["value"])).toBeNull();
    expect(readNonNegativeNumber({ value: "NaN" }, ["value"])).toBeNull();
    expect(readNonNegativeNumber({ value: Infinity }, ["value"])).toBeNull();
  });

  it("reads stable question IDs from supported fields", () => {
    expect(readStableQuestionId({ question_id: 42 })).toBe("42");
    expect(readStableQuestionId({ questionId: "  abc-123  " })).toBe("abc-123");
    expect(readStableQuestionId({ id: 0 })).toBe("0");
    expect(readStableQuestionId({ question_id: 1.5, questionId: "", id: Infinity })).toBeNull();
  });
});
