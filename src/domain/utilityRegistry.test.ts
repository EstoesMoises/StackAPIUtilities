import { describe, expect, it } from "vitest";
import { getExecutableUtilities } from "./utilityRegistry";

describe("utility registry", () => {
  it("exposes the executable SME Coverage Analyzer metadata", () => {
    expect(getExecutableUtilities()).toEqual([
      expect.objectContaining({
        id: "sme-coverage-analyzer",
        title: "SME Coverage Analyzer",
        scopeLabel: "All-time demand · Current SME coverage",
        mode: "read-only",
        description: "Find tags where knowledge demand is not matched by enough SME coverage.",
        supportedInstances: ["basic-business", "enterprise"],
        credentialRequirements: ["api-key", "access-token"],
        requiredDatasets: ["tags", "questions", "tagSmeCounts"],
      }),
    ]);
  });
});
