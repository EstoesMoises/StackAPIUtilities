import type { UtilityMetadata } from "./types";

export const utilityRegistry: readonly UtilityMetadata[] = [
  {
    id: "sme-coverage-analyzer",
    title: "SME Coverage Analyzer",
    scopeLabel: "All-time demand · Current SME coverage",
    mode: "read-only",
    description: "Find tags where knowledge demand is not matched by enough SME coverage.",
    supportedInstances: ["basic-business", "enterprise"],
    credentialRequirements: ["api-key", "access-token"],
    requiredDatasets: ["tags", "questions", "tagSmeCounts"],
  },
];

export function getExecutableUtilities(): readonly UtilityMetadata[] {
  return utilityRegistry;
}
