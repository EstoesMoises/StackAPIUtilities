import { describe, expect, it } from "vitest";
import { MAX_CONTENT_REPLACEMENT_REQUEST_MODEL_BYTES } from "../writeTools/contentReplacement/limits";
import {
  normalizeCurrentRequestModel,
  validateExactPriorRequestModel,
} from "./contentReplacementRequestValidation";

describe("content replacement request-model budgets", () => {
  it("rejects a structurally valid canonical model over the aggregate UTF-8 budget", () => {
    const ref = { kind: "question" as const, questionId: 10 };
    const model = {
      kind: "question" as const,
      ref,
      request: { title: "A", body: "é".repeat(1_048_576), tags: [] },
    };
    expect(new TextEncoder().encode(JSON.stringify(model)).byteLength)
      .toBeGreaterThan(MAX_CONTENT_REPLACEMENT_REQUEST_MODEL_BYTES);

    expect(normalizeCurrentRequestModel(model, ref)).toBeNull();
    expect(validateExactPriorRequestModel(model, ref)).toBeNull();
  });
});
