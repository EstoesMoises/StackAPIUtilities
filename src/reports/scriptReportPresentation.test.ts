import { describe, expect, it } from "vitest";
import { LEGACY_COLLECTION_WARNING } from "../domain/collectionWarnings";
import { createScriptReportPresentation } from "./scriptReportPresentation";

describe("createScriptReportPresentation", () => {
  it("describes an exhaustive live result with stable identity and report metadata", () => {
    const records = [{ datasetName: "users", user_id: 1 }];
    const warnings = Object.freeze([]);

    const result = createScriptReportPresentation({
      reportId: "inactive-users",
      records,
      loadedAt: "2026-08-20T12:00:00.000Z",
      outputSource: "live-api",
      currentScope: { startDate: "2026-08-01", endDate: "2026-08-20" },
      comparisonScope: { startDate: "2026-07-01", endDate: "2026-07-20" },
      warnings,
    });

    expect(result).toMatchObject({
      reportKey:
        "inactive-users:2026-08-20T12:00:00.000Z:2026-08-01:2026-07-01",
      kindLabel: "Script report",
      title: "Inactive Users",
      sourceLabel: "StackExchange/so4t_inactive_users",
      generatedAt: "2026-08-20T12:00:00.000Z",
      scopeLabel: "2026-08-01 to 2026-08-20",
      collectionLabel: "All available data collected",
      qualityLabel: "All available data collected",
      qualityTone: "success",
      rowCount: 1,
      overview: "Inactive user cohorts and content-risk segmentation.",
    });
    expect(result.warnings).toBe(warnings);
    expect(result.evidence).toBe(records);
    expect(result.metrics).toEqual([]);
    expect(result.findings).toEqual([]);
    expect(result.availableSections).toEqual(["overview", "evidence"]);
    expect(result.exports).toEqual({ pdf: false, csv: true, markdown: false });
  });

  it("warns when a live result has the canonical legacy warning for this report", () => {
    const warnings = [
      {
        ...LEGACY_COLLECTION_WARNING,
        reportId: "inactive-users" as const,
      },
    ];

    const result = createScriptReportPresentation({
      reportId: "inactive-users",
      records: [{ user_id: 1 }],
      loadedAt: "2026-08-20T12:00:00.000Z",
      outputSource: "live-api",
      warnings,
    });

    expect(result.qualityLabel).toBe("Legacy result — completeness unverified");
    expect(result.collectionLabel).toBe("Legacy result — completeness unverified");
    expect(result.qualityTone).toBe("warning");
    expect(result.scopeLabel).toBe("All available history");
  });

  it("labels an uploaded result neutrally without claiming exhaustive collection", () => {
    const result = createScriptReportPresentation({
      reportId: "inactive-users",
      records: [{ user_id: 1 }],
      loadedAt: "2026-08-20T12:00:00.000Z",
      outputSource: "upload",
      warnings: [],
    });

    expect(result.qualityLabel).toBe("Uploaded result");
    expect(result.collectionLabel).toBe("Uploaded result");
    expect(result.qualityTone).toBe("neutral");
  });

  it("keeps an empty current result overview-only and disables every unavailable export", () => {
    const result = createScriptReportPresentation({
      reportId: "tag-report",
      records: [],
      loadedAt: "2026-08-20T12:00:00.000Z",
      outputSource: "live-api",
      currentScope: {},
      warnings: [],
    });

    expect(result.scopeLabel).toBe("All available history");
    expect(result.rowCount).toBe(0);
    expect(result.evidence).toEqual([]);
    expect(result.availableSections).toEqual(["overview"]);
    expect(result.exports).toEqual({ pdf: false, csv: false, markdown: false });
  });

  it("uses comparison-only records and scope as evidence fallback", () => {
    const comparisonRecords = [{ datasetName: "users", user_id: 2 }];

    const result = createScriptReportPresentation({
      reportId: "inactive-users",
      records: [],
      comparisonRecords,
      loadedAt: "2026-08-20T12:00:00.000Z",
      outputSource: "live-api",
      comparisonScope: { endDate: "2026-07-31" },
      warnings: [],
    });

    expect(result.reportKey).toBe(
      "inactive-users:2026-08-20T12:00:00.000Z::",
    );
    expect(result.scopeLabel).toBe("Comparison: Through 2026-07-31");
    expect(result.evidence).toBe(comparisonRecords);
    expect(result.rowCount).toBe(1);
    expect(result.availableSections).toEqual(["overview", "evidence"]);
    expect(result.exports.csv).toBe(true);
  });

  it("ignores legacy warnings belonging to a different report", () => {
    const result = createScriptReportPresentation({
      reportId: "inactive-users",
      records: [{ user_id: 1 }],
      loadedAt: "2026-08-20T12:00:00.000Z",
      outputSource: "live-api",
      warnings: [
        {
          ...LEGACY_COLLECTION_WARNING,
          reportId: "tag-report",
        },
      ],
    });

    expect(result.qualityLabel).toBe("All available data collected");
    expect(result.qualityTone).toBe("success");
  });

  it("does not mutate records, comparison records, scopes, or warnings", () => {
    const record = Object.freeze({ user_id: 1 });
    const comparisonRecord = Object.freeze({ user_id: 2 });
    const records = Object.freeze([record]);
    const comparisonRecords = Object.freeze([comparisonRecord]);
    const currentScope = Object.freeze({ startDate: "2026-08-01" });
    const comparisonScope = Object.freeze({ startDate: "2026-07-01" });
    const warning = Object.freeze({
      reportId: "inactive-users" as const,
      code: "report.fixture-note",
      message: "Fixture note.",
    });
    const warnings = Object.freeze([warning]);

    const result = createScriptReportPresentation({
      reportId: "inactive-users",
      records,
      comparisonRecords,
      loadedAt: "2026-08-20T12:00:00.000Z",
      outputSource: "live-api",
      currentScope,
      comparisonScope,
      warnings,
    });

    expect(result.evidence).toBe(records);
    expect(result.warnings).toBe(warnings);
    expect(records).toEqual([record]);
    expect(comparisonRecords).toEqual([comparisonRecord]);
    expect(currentScope).toEqual({ startDate: "2026-08-01" });
    expect(comparisonScope).toEqual({ startDate: "2026-07-01" });
    expect(warnings).toEqual([warning]);
  });
});
