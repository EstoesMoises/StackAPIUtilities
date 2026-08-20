import type { ReportId, ReportWarning } from "./types";

export const LEGACY_COLLECTION_WARNING: Readonly<ReportWarning> = Object.freeze({
  code: "collection.legacy-unverified",
  message: "Legacy run — completeness not verified under current collection rules.",
});

export function isLegacyCollectionWarning(
  warning: Readonly<ReportWarning>,
  reportId: ReportId,
): boolean {
  return (
    warning.reportId === reportId &&
    warning.code === LEGACY_COLLECTION_WARNING.code &&
    warning.message === LEGACY_COLLECTION_WARNING.message
  );
}
