import { describe, expect, it } from "vitest";
import { LEGACY_COLLECTION_WARNING } from "../domain/collectionWarnings";
import type { ReportId } from "../domain/types";
import { createScriptReportPresentation } from "./scriptReportPresentation";

const allReportIds = [
  "tag-report",
  "api-user-report",
  "inactive-users",
  "interactions",
  "community-members",
  "data-export",
  "webhook-report",
  "search-log-report",
  "api-import",
  "user-groups",
  "scim-user-activation",
  "scim-user-deactivation",
  "scim-user-deletion",
] as const satisfies readonly ReportId[];

const allReportIdsCovered: Exclude<ReportId, (typeof allReportIds)[number]> extends never
  ? true
  : false = true;

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
    expect(result.warnings).toEqual(warnings);
    expect(result.warnings).not.toBe(warnings);
    expect(result.evidence).toEqual(records);
    expect(result.evidence).not.toBe(records);
    expect(result.metrics).toEqual([]);
    expect(result.findings).toEqual([]);
    expect(result.availableSections).toEqual(["overview", "evidence"]);
    expect(result.exports).toEqual({ pdf: false, csv: true, markdown: false });
  });

  it("builds a stable identity from output source and complete period scopes", () => {
    const input = {
      reportId: "inactive-users" as const,
      records: [{ user_id: 1 }],
      loadedAt: "2026-08-20T12:00:00.000Z",
      outputSource: "live-api" as const,
      currentScope: { startDate: "2026-08-01", endDate: "2026-08-20" },
      comparisonScope: { startDate: "2026-07-01", endDate: "2026-07-20" },
      warnings: [],
    };

    const reportKey = createScriptReportPresentation(input).reportKey;
    const sameReportKey = createScriptReportPresentation({
      ...input,
      currentScope: { ...input.currentScope },
      comparisonScope: { ...input.comparisonScope },
    }).reportKey;
    const differentCurrentEnd = createScriptReportPresentation({
      ...input,
      currentScope: { ...input.currentScope, endDate: "2026-08-21" },
    }).reportKey;
    const differentComparisonEnd = createScriptReportPresentation({
      ...input,
      comparisonScope: { ...input.comparisonScope, endDate: "2026-07-21" },
    }).reportKey;
    const uploaded = createScriptReportPresentation({
      ...input,
      outputSource: "upload",
    }).reportKey;

    expect(sameReportKey).toBe(reportKey);
    expect(new Set([reportKey, differentCurrentEnd, differentComparisonEnd, uploaded]).size).toBe(4);
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

  it("labels an uploaded result neutrally even when persisted warnings include a legacy marker", () => {
    const result = createScriptReportPresentation({
      reportId: "inactive-users",
      records: [{ user_id: 1 }],
      loadedAt: "2026-08-20T12:00:00.000Z",
      outputSource: "upload",
      warnings: [
        {
          ...LEGACY_COLLECTION_WARNING,
          reportId: "inactive-users",
        },
      ],
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

  it("labels comparison evidence with its scope when both period scopes are present", () => {
    const comparisonRecords = [{ datasetName: "users", user_id: 2 }];

    const result = createScriptReportPresentation({
      reportId: "inactive-users",
      records: [],
      comparisonRecords,
      loadedAt: "2026-08-20T12:00:00.000Z",
      outputSource: "live-api",
      currentScope: { startDate: "2026-08-01", endDate: "2026-08-20" },
      comparisonScope: { startDate: "2026-07-01", endDate: "2026-07-20" },
      warnings: [],
    });

    expect(result.scopeLabel).toBe("Comparison: 2026-07-01 to 2026-07-20");
    expect(result.evidence).toEqual(comparisonRecords);
    expect(result.evidence).not.toBe(comparisonRecords);
    expect(result.rowCount).toBe(1);
    expect(result.availableSections).toEqual(["overview", "evidence"]);
    expect(result.exports.csv).toBe(true);

    comparisonRecords.push({ datasetName: "users", user_id: 3 });
    expect(result.evidence).toHaveLength(1);
    expect(result.rowCount).toBe(1);
  });

  it("does not borrow a comparison scope for current evidence without a current scope", () => {
    const result = createScriptReportPresentation({
      reportId: "inactive-users",
      records: [{ datasetName: "users", user_id: 1 }],
      comparisonRecords: [{ datasetName: "users", user_id: 2 }],
      loadedAt: "2026-08-20T12:00:00.000Z",
      outputSource: "live-api",
      comparisonScope: { startDate: "2026-07-01", endDate: "2026-07-20" },
      warnings: [],
    });

    expect(result.scopeLabel).toBe("All available history");
    expect(result.evidence).toEqual([{ datasetName: "users", user_id: 1 }]);
    expect(result.rowCount).toBe(1);
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

  it.each(allReportIds)("uses registered metadata for %s", (reportId) => {
    const result = createScriptReportPresentation({
      reportId,
      records: [],
      loadedAt: "2026-08-20T12:00:00.000Z",
      outputSource: "live-api",
      warnings: [],
    });

    expect(allReportIdsCovered).toBe(true);
    expect(result.title).not.toBe("");
    expect(result.sourceLabel).not.toBe("");
  });

  it("fails explicitly rather than inventing metadata for an unknown report id", () => {
    expect(() =>
      createScriptReportPresentation({
        reportId: "missing-report" as ReportId,
        records: [],
        loadedAt: "2026-08-20T12:00:00.000Z",
        outputSource: "live-api",
        warnings: [],
      }),
    ).toThrowError('Missing report metadata for Script report "missing-report".');
  });

  it("snapshots presentation collections against later caller mutation", () => {
    const record = Object.freeze({ user_id: 1 });
    const comparisonRecord = Object.freeze({ user_id: 2 });
    const records = [record];
    const comparisonRecords = [comparisonRecord];
    const currentScope = Object.freeze({ startDate: "2026-08-01" });
    const comparisonScope = Object.freeze({ startDate: "2026-07-01" });
    const warning = Object.freeze({
      reportId: "inactive-users" as const,
      code: "report.fixture-note",
      message: "Fixture note.",
    });
    const warnings = [warning];

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

    records.push(record);
    comparisonRecords.push(comparisonRecord);
    warnings.push(warning);

    expect(result.evidence).toEqual([record]);
    expect(result.warnings).toEqual([warning]);
    expect(result.rowCount).toBe(1);
    expect(records).toEqual([record, record]);
    expect(comparisonRecords).toEqual([comparisonRecord, comparisonRecord]);
    expect(currentScope).toEqual({ startDate: "2026-08-01" });
    expect(comparisonScope).toEqual({ startDate: "2026-07-01" });
    expect(warnings).toEqual([warning, warning]);
  });
});
