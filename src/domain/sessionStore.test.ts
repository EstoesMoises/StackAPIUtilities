import { describe, expect, it } from "vitest";
import type { SmeCoverageDecisionPack } from "../utilities/smeCoverage/model";
import { createInitialSessionState, sessionReducer } from "./sessionStore";

function createStorageShim(): Storage {
  const values = new Map<string, string>();

  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => Array.from(values.keys())[index] ?? null,
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, value),
  };
}

if (typeof globalThis.localStorage === "undefined") {
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: createStorageShim(),
  });
}

if (typeof globalThis.sessionStorage === "undefined") {
  Object.defineProperty(globalThis, "sessionStorage", {
    configurable: true,
    value: createStorageShim(),
  });
}

const completePagination = { pageCount: 1, reachedMaxPages: false, hasMore: false };

describe("sessionStore", () => {
  it("starts with the tag report selected and empty session data", () => {
    expect(createInitialSessionState()).toEqual({
      credentials: null,
      selectedReportId: "tag-report",
      selectedReportIds: ["tag-report"],
      selectedUtilityId: "sme-coverage-analyzer",
      datasets: {},
      reportOutputs: {},
      reportRunSnapshots: [],
      utilityOutputs: {},
      utilityRunSnapshots: [],
      warnings: [],
      runQueue: [],
    });
  });

  it("selects the active utility", () => {
    const state = sessionReducer(createInitialSessionState(), {
      type: "utility/select",
      utilityId: "sme-coverage-analyzer",
    } as never);

    expect(state.selectedUtilityId).toBe("sme-coverage-analyzer");
  });

  it("stores every utility source dataset, provenance, snapshot metadata, and active pack", () => {
    const pack = createUtilityDecisionPack();
    const warning = {
      utilityId: "sme-coverage-analyzer" as const,
      code: "coverage.partial-sample",
      message: "The approved sample may be partial.",
    };
    const state = sessionReducer(createInitialSessionState(), {
      type: "utility/loaded",
      result: {
        utilityId: "sme-coverage-analyzer",
        utilityTitle: "SME Coverage Analyzer",
        pageSize: 100,
        maxPagesPerDataset: 20,
        runPreset: "deep-audit",
        datasets: [
          { datasetName: "tags", records: [{ name: "python" }], pagination: { pageCount: 1, reachedMaxPages: false, hasMore: false } },
          { datasetName: "questions", records: [], pagination: { pageCount: 0, reachedMaxPages: false, hasMore: false } },
          { datasetName: "tagSmeCounts", records: [{ tagName: "python", count: 0 }], pagination: { pageCount: 1, reachedMaxPages: false, hasMore: false } },
        ],
        messages: [],
        warnings: [warning],
        decisionPack: pack,
      },
    } as never);

    expect(Object.values(state.datasets).map((dataset) => dataset.name)).toEqual([
      "tags",
      "questions",
      "tagSmeCounts",
    ]);
    expect(Object.values(state.datasets).every(
      (dataset) => dataset.utilityId === "sme-coverage-analyzer",
    )).toBe(true);
    expect(Object.values(state.datasets)[0]).toMatchObject({
      pageCount: 1,
      reachedMaxPages: false,
      hasMore: false,
    });
    expect(state.utilityOutputs["sme-coverage-analyzer"]?.decisionPack).toEqual(pack);
    expect(state.utilityRunSnapshots[0]).toMatchObject({
      utilityId: "sme-coverage-analyzer",
      pageSize: 100,
      maxPagesPerDataset: 20,
      runPreset: "deep-audit",
      warnings: [warning],
    });
    expect(state.warnings).toEqual([warning]);
  });

  it("replaces the active utility pack on rerun while retaining all source snapshots", () => {
    const firstPack = createUtilityDecisionPack();
    const secondPack = { ...createUtilityDecisionPack("Partial"), assessment: "Second run." };
    const first = sessionReducer(createInitialSessionState(), createUtilityLoadedAction(firstPack) as never);
    const second = sessionReducer(first, createUtilityLoadedAction(secondPack) as never);

    expect(Object.values(second.datasets)).toHaveLength(6);
    expect(second.utilityRunSnapshots).toHaveLength(2);
    expect(second.utilityOutputs["sme-coverage-analyzer"]?.decisionPack).toEqual(secondPack);
  });

  it("keeps rerun snapshot ids unique after an earlier utility snapshot is removed", () => {
    const first = sessionReducer(
      createInitialSessionState(),
      createUtilityLoadedAction(createUtilityDecisionPack()) as never,
    );
    const second = sessionReducer(first, createUtilityLoadedAction(createUtilityDecisionPack()) as never);
    const firstSnapshotId = first.utilityRunSnapshots[0]!.id;
    const withoutFirst = Object.values(first.datasets).reduce(
      (state, dataset) => sessionReducer(state, { type: "dataset/remove", datasetId: dataset.id }),
      second,
    );

    expect(withoutFirst.utilityRunSnapshots.map((snapshot) => snapshot.id)).not.toContain(firstSnapshotId);
    const rerun = sessionReducer(withoutFirst, createUtilityLoadedAction(createUtilityDecisionPack()) as never);
    expect(new Set(rerun.utilityRunSnapshots.map((snapshot) => snapshot.id)).size).toBe(2);
    expect(Object.values(rerun.datasets)).toHaveLength(6);
  });

  it("prunes utility dataset provenance and empty snapshots but keeps the self-contained active pack", () => {
    const pack = createUtilityDecisionPack();
    const loaded = sessionReducer(createInitialSessionState(), createUtilityLoadedAction(pack) as never);
    const snapshotId = loaded.utilityRunSnapshots[0]?.id;
    const snapshotDatasets = Object.values(loaded.datasets).filter((dataset) => dataset.snapshotId === snapshotId);
    const partiallyRemoved = sessionReducer(loaded, { type: "dataset/remove", datasetId: snapshotDatasets[0]!.id });

    expect(partiallyRemoved.utilityRunSnapshots[0]?.datasetIds).toHaveLength(2);

    const fullyRemoved = snapshotDatasets.slice(1).reduce(
      (state, dataset) => sessionReducer(state, { type: "dataset/remove", datasetId: dataset.id }),
      partiallyRemoved,
    );
    expect(fullyRemoved.utilityRunSnapshots).toEqual([]);
    expect(fullyRemoved.utilityOutputs["sme-coverage-analyzer"]?.decisionPack).toEqual(pack);
  });

  it.each(["datasets/flush", "session/reset"] as const)("clears utility data on %s", (type) => {
    const loaded = sessionReducer(createInitialSessionState(), createUtilityLoadedAction(createUtilityDecisionPack()) as never);
    const cleared = sessionReducer(loaded, { type });

    expect(cleared.utilityOutputs).toEqual({});
    expect(cleared.utilityRunSnapshots).toEqual([]);
  });

  it("stores credentials only in memory state", () => {
    const state = sessionReducer(createInitialSessionState(), {
      type: "credentials/set",
      credentials: {
        instanceType: "enterprise",
        baseUrl: "https://example.stackenterprise.co",
        apiKey: "key",
        accessToken: "token",
      },
    });

    expect(state.credentials?.accessToken).toBe("token");
    expect(localStorage.getItem("credentials")).toBeNull();
    expect(sessionStorage.getItem("credentials")).toBeNull();
  });

  it("selects one report and collapses any existing multi-selection", () => {
    const multiSelected = sessionReducer(createInitialSessionState(), {
      type: "reports/selectMany",
      reportIds: ["tag-report", "api-user-report", "inactive-users"],
    });

    const selected = sessionReducer(multiSelected, {
      type: "report/select",
      reportId: "api-user-report",
    });

    expect(selected.selectedReportId).toBe("api-user-report");
    expect(selected.selectedReportIds).toEqual(["api-user-report"]);
  });

  it("stores multi-report selections", () => {
    const state = sessionReducer(createInitialSessionState(), {
      type: "reports/selectMany",
      reportIds: ["tag-report", "community-members"],
    });

    expect(state.selectedReportId).toBe("tag-report");
    expect(state.selectedReportIds).toEqual(["tag-report", "community-members"]);
  });

  it("stores uploaded datasets with metadata", () => {
    const state = sessionReducer(createInitialSessionState(), {
      type: "dataset/set",
      datasetName: "users",
      records: [{ id: 1 }],
    });

    const [dataset] = Object.values(state.datasets);
    expect(dataset?.name).toBe("users");
    expect(dataset?.records).toEqual([{ id: 1 }]);
    expect(dataset?.source).toBe("upload");
    expect(dataset?.loadedAt).toEqual(expect.any(String));
  });

  it("stores imported report outputs by report", () => {
    const state = sessionReducer(createInitialSessionState(), {
      type: "import/loaded",
      datasetName: "tags",
      fileName: "tag_metrics.csv",
      records: [{ tagName: "python" }],
      reportId: "tag-report",
    });

    expect(state.selectedReportId).toBe("tag-report");
    expect(Object.values(state.datasets)[0]?.records).toEqual([{ tagName: "python" }]);
    expect(state.reportOutputs["tag-report"]?.fileName).toBe("tag_metrics.csv");
    expect(state.reportOutputs["tag-report"]?.records).toEqual([{ tagName: "python" }]);
  });

  it("removes uploaded report output when removing its uploaded dataset", () => {
    const state = sessionReducer(createInitialSessionState(), {
      type: "import/loaded",
      datasetName: "tags",
      fileName: "tag_metrics.csv",
      records: [{ tagName: "python" }],
      reportId: "tag-report",
    });
    const [datasetId] = Object.keys(state.datasets);
    const withoutDataset = sessionReducer(state, { type: "dataset/remove", datasetId });

    expect(withoutDataset.datasets[datasetId]).toBeUndefined();
    expect(withoutDataset.reportOutputs["tag-report"]).toBeUndefined();
  });

  it("stores live API datasets and exposes raw live report records", () => {
    const state = sessionReducer(createInitialSessionState(), {
      type: "live/loaded",
      reportId: "inactive-users",
      periodRole: "current",
      scope: { startDate: "2026-01-01", endDate: "2026-01-31" },
      warnings: [],
      datasets: [
        {
          datasetName: "users",
          records: [{ user_id: 1, display_name: "Ada" }],
          pagination: { pageCount: 3, reachedMaxPages: false, hasMore: false },
        },
      ],
    });

    expect(state.selectedReportId).toBe("inactive-users");
    const [dataset] = Object.values(state.datasets);
    expect(dataset?.source).toBe("live-api");
    expect(dataset?.periodRole).toBe("current");
    expect(dataset?.scope).toEqual({ startDate: "2026-01-01", endDate: "2026-01-31" });
    expect(dataset?.records).toEqual([{ user_id: 1, display_name: "Ada" }]);
    expect(dataset).toMatchObject({ pageCount: 3, reachedMaxPages: false, hasMore: false });
    expect(state.reportRunSnapshots).toHaveLength(1);
    expect(state.reportRunSnapshots[0]).toMatchObject({
      reportId: "inactive-users",
      periodRole: "current",
      scope: { startDate: "2026-01-01", endDate: "2026-01-31" },
    });
    expect(state.reportRunSnapshots[0]).not.toHaveProperty("pageSize");
    expect(state.reportRunSnapshots[0]).not.toHaveProperty("maxPagesPerDataset");
    expect(state.reportRunSnapshots[0]).not.toHaveProperty("runPreset");
    expect(state.reportOutputs["inactive-users"]?.source).toBe("live-api");
    expect(state.reportOutputs["inactive-users"]?.records).toEqual([
      { datasetName: "users", user_id: 1, display_name: "Ada" },
    ]);
  });

  it("stores curated Tag Health rows as visible live Tag Report output while retaining raw datasets", () => {
    const warnings = [
      {
        reportId: "tag-report" as const,
        code: "dataset-page-cap",
        message: "The run reached the configured page cap for questions.",
      },
    ];
    const state = sessionReducer(createInitialSessionState(), {
      type: "live/loaded",
      reportId: "tag-report",
      periodRole: "current",
      scope: { startDate: "2026-07-01", endDate: "2026-07-08" },
      warnings,
      datasets: [
        {
          datasetName: "tags",
          records: [{ name: "python", totalPageViews: 350, tagWatchers: 12 }],
          pagination: completePagination,
        },
        {
          datasetName: "tagSmeCounts",
          records: [{ id: 42, name: "PYTHON", creationDate: "2014-05-13T12:00:00Z" }],
          pagination: completePagination,
        },
        {
          datasetName: "questions",
          records: [
            {
              question_id: 10,
              tags: ["python"],
              answer_count: 1,
              is_answered: true,
              view_count: 50,
              creation_date: 1_700_000_000,
              first_answer_creation_date: 1_700_007_200,
            },
          ],
          pagination: completePagination,
        },
        {
          datasetName: "tagSmes",
          records: [{ tagName: "python", user_id: 1 }],
          pagination: completePagination,
        },
        {
          datasetName: "tagLastUsed",
          records: [{ tagName: "python", lastUsed: "2026-08-18" }],
          pagination: completePagination,
        },
      ],
    });

    expect(Object.values(state.datasets)).toHaveLength(5);
    expect(Object.values(state.datasets).find((dataset) => dataset.name === "tags")?.records).toEqual([
      { name: "python", totalPageViews: 350, tagWatchers: 12 },
    ]);
    expect(state.reportOutputs["tag-report"]?.records).toEqual([
      expect.objectContaining({
        tag_name: "PYTHON",
        tag_id: 42,
        tag_creation_date: "2014-05-13",
        last_used: "2026-08-18",
        health_status: "Healthy",
        page_views: 400,
        question_count: 1,
        sme_count: 1,
      }),
    ]);
    expect(state.reportOutputs["tag-report"]?.records[0]).not.toHaveProperty("datasetName");
    expect(state.reportOutputs["tag-report"]?.warnings).toEqual(warnings);
    expect(state.reportRunSnapshots[0]?.warnings).toEqual(warnings);
  });

  it("keeps report snapshots free of legacy volume and preset fields", () => {
    const state = sessionReducer(createInitialSessionState(), {
      type: "live/loaded",
      reportId: "tag-report",
      periodRole: "current",
      scope: {},
      warnings: [],
      datasets: [
        {
          datasetName: "tags",
          records: [{ name: "python" }],
          pagination: { pageCount: 1, reachedMaxPages: false, hasMore: false },
        },
      ],
    });

    expect(state.reportRunSnapshots[0]).toMatchObject({ reportId: "tag-report" });
    expect(state.reportRunSnapshots[0]).not.toHaveProperty("pageSize");
    expect(state.reportRunSnapshots[0]).not.toHaveProperty("maxPagesPerDataset");
    expect(state.reportRunSnapshots[0]).not.toHaveProperty("runPreset");
  });

  it("removes transformed live output rows when removing their backing dataset", () => {
    const state = sessionReducer(createInitialSessionState(), {
      type: "live/loaded",
      reportId: "tag-report",
      periodRole: "current",
      scope: {},
      warnings: [],
      datasets: [
        {
          datasetName: "tags",
          records: [{ name: "python", totalPageViews: 500, questionCount: 4 }],
          pagination: completePagination,
        },
      ],
    });
    const [dataset] = Object.values(state.datasets);

    expect(state.reportOutputs["tag-report"]?.records).toEqual([
      expect.objectContaining({
        tag_name: "python",
        page_views: 500,
      }),
    ]);
    expect(state.reportOutputs["tag-report"]?.records[0]).not.toHaveProperty("datasetName");

    const withoutDataset = sessionReducer(state, {
      type: "dataset/remove",
      datasetId: dataset?.id ?? "",
    });

    expect(withoutDataset.datasets).toEqual({});
    expect(withoutDataset.reportOutputs["tag-report"]).toBeUndefined();
    expect(withoutDataset.reportRunSnapshots).toEqual([]);
  });

  it("keeps transformed live output rows while their snapshot still has backing datasets", () => {
    const state = sessionReducer(createInitialSessionState(), {
      type: "live/loaded",
      reportId: "tag-report",
      periodRole: "current",
      scope: {},
      warnings: [],
      datasets: [
        {
          datasetName: "tags",
          records: [{ name: "python", totalPageViews: 500, questionCount: 4 }],
          pagination: completePagination,
        },
        {
          datasetName: "questions",
          records: [
            {
              question_id: 10,
              tags: ["python"],
              answer_count: 1,
              view_count: 25,
            },
          ],
          pagination: completePagination,
        },
      ],
    });
    const questionsDataset = Object.values(state.datasets).find((dataset) => dataset.name === "questions");

    expect(state.reportOutputs["tag-report"]?.records).toEqual([
      expect.objectContaining({
        tag_name: "python",
        page_views: 525,
      }),
    ]);
    expect(state.reportOutputs["tag-report"]?.records[0]).not.toHaveProperty("datasetName");

    const withoutQuestions = sessionReducer(state, {
      type: "dataset/remove",
      datasetId: questionsDataset?.id ?? "",
    });

    expect(Object.values(withoutQuestions.datasets)).toHaveLength(1);
    expect(Object.values(withoutQuestions.datasets)[0]?.name).toBe("tags");
    expect(withoutQuestions.reportRunSnapshots).toHaveLength(1);
    expect(withoutQuestions.reportRunSnapshots[0]?.datasetIds).toEqual([
      Object.values(withoutQuestions.datasets)[0]?.id,
    ]);
    expect(withoutQuestions.reportOutputs["tag-report"]?.records).toEqual([
      expect.objectContaining({
        tag_name: "python",
        page_views: 500,
        question_count: 4,
      }),
    ]);
    expect(withoutQuestions.reportOutputs["tag-report"]?.currentSnapshotId).toBe(questionsDataset?.snapshotId);
  });

  it("rebuilds transformed live output rows after removing their primary backing dataset", () => {
    const state = sessionReducer(createInitialSessionState(), {
      type: "live/loaded",
      reportId: "tag-report",
      periodRole: "current",
      scope: {},
      warnings: [],
      datasets: [
        {
          datasetName: "tags",
          records: [{ name: "python", totalPageViews: 500, questionCount: 4 }],
          pagination: completePagination,
        },
        {
          datasetName: "questions",
          records: [
            {
              question_id: 10,
              tags: ["python"],
              answer_count: 1,
              view_count: 25,
            },
          ],
          pagination: completePagination,
        },
        {
          datasetName: "tagSmes",
          records: [{ tagName: "python", user_id: 1 }],
          pagination: completePagination,
        },
      ],
    });
    const tagsDataset = Object.values(state.datasets).find((dataset) => dataset.name === "tags");

    expect(state.reportOutputs["tag-report"]?.records).toEqual([
      expect.objectContaining({
        tag_name: "python",
        page_views: 525,
        question_count: 1,
        sme_count: 1,
      }),
    ]);

    const withoutTags = sessionReducer(state, {
      type: "dataset/remove",
      datasetId: tagsDataset?.id ?? "",
    });

    expect(Object.values(withoutTags.datasets)).toHaveLength(2);
    expect(Object.values(withoutTags.datasets).map((dataset) => dataset.name)).toEqual(["questions", "tagSmes"]);
    expect(withoutTags.reportRunSnapshots).toHaveLength(1);
    expect(withoutTags.reportOutputs["tag-report"]?.records).toEqual([
      expect.objectContaining({
        tag_name: "python",
        page_views: 25,
        question_count: 1,
        sme_count: 1,
      }),
    ]);
    expect(withoutTags.reportOutputs["tag-report"]?.currentSnapshotId).toBe(tagsDataset?.snapshotId);
  });

  it("stores current and comparison live snapshots without overwriting dataset names", () => {
    const current = sessionReducer(createInitialSessionState(), {
      type: "live/loaded",
      reportId: "inactive-users",
      periodRole: "current",
      scope: { startDate: "2026-06-01", endDate: "2026-06-30" },
      warnings: [],
      datasets: [
        {
          datasetName: "users",
          records: [{ user_id: 1, display_name: "Ada" }],
          pagination: completePagination,
        },
      ],
    });
    const comparison = sessionReducer(current, {
      type: "live/loaded",
      reportId: "inactive-users",
      periodRole: "comparison",
      scope: { startDate: "2026-05-01", endDate: "2026-05-31" },
      warnings: [],
      datasets: [
        {
          datasetName: "users",
          records: [{ user_id: 2, display_name: "Grace" }],
          pagination: completePagination,
        },
      ],
    });

    expect(Object.values(comparison.datasets)).toHaveLength(2);
    expect(Object.values(comparison.datasets).map((dataset) => dataset.periodRole)).toEqual([
      "current",
      "comparison",
    ]);
    expect(comparison.reportRunSnapshots).toHaveLength(2);
    expect(comparison.reportOutputs["inactive-users"]?.records).toEqual([
      { datasetName: "users", user_id: 1, display_name: "Ada" },
    ]);
    expect(comparison.reportOutputs["inactive-users"]?.comparisonRecords).toEqual([
      { datasetName: "users", user_id: 2, display_name: "Grace" },
    ]);
  });

  it("preserves visible current and comparison warnings while replacing rerun period warnings", () => {
    const currentWarning = {
      reportId: "tag-report" as const,
      code: "dataset-page-cap",
      message: "Current questions reached the configured page cap.",
    };
    const comparisonWarning = {
      reportId: "tag-report" as const,
      code: "dataset-page-cap",
      message: "Comparison questions reached the configured page cap.",
    };
    const currentWithWarning = sessionReducer(createInitialSessionState(), {
      type: "live/loaded",
      reportId: "tag-report",
      periodRole: "current",
      scope: { startDate: "2026-06-01", endDate: "2026-06-30" },
      warnings: [currentWarning],
      datasets: [{ datasetName: "tags", records: [{ name: "python", totalPageViews: 100 }], pagination: completePagination }],
    });
    const comparisonWithoutWarning = sessionReducer(currentWithWarning, {
      type: "live/loaded",
      reportId: "tag-report",
      periodRole: "comparison",
      scope: { startDate: "2026-05-01", endDate: "2026-05-31" },
      warnings: [],
      datasets: [{ datasetName: "tags", records: [{ name: "python", totalPageViews: 90 }], pagination: completePagination }],
    });
    const comparisonWithWarning = sessionReducer(comparisonWithoutWarning, {
      type: "live/loaded",
      reportId: "tag-report",
      periodRole: "comparison",
      scope: { startDate: "2026-04-01", endDate: "2026-04-30" },
      warnings: [comparisonWarning, comparisonWarning],
      datasets: [{ datasetName: "tags", records: [{ name: "python", totalPageViews: 80 }], pagination: completePagination }],
    });
    const currentRerunWithoutWarning = sessionReducer(comparisonWithWarning, {
      type: "live/loaded",
      reportId: "tag-report",
      periodRole: "current",
      scope: { startDate: "2026-07-01", endDate: "2026-07-31" },
      warnings: [],
      datasets: [{ datasetName: "tags", records: [{ name: "python", totalPageViews: 120 }], pagination: completePagination }],
    });

    expect(comparisonWithoutWarning.reportOutputs["tag-report"]?.warnings).toEqual([currentWarning]);
    expect(comparisonWithWarning.reportOutputs["tag-report"]?.warnings).toEqual([
      currentWarning,
      comparisonWarning,
    ]);
    expect(currentRerunWithoutWarning.reportOutputs["tag-report"]?.warnings).toEqual([comparisonWarning]);
  });

  it("removes a managed dataset from the active session", () => {
    const withDataset = sessionReducer(createInitialSessionState(), {
      type: "dataset/set",
      datasetName: "users",
      records: [{ id: 1 }],
    });
    const [datasetId] = Object.keys(withDataset.datasets);
    const withoutDataset = sessionReducer(withDataset, { type: "dataset/remove", datasetId });

    expect(withoutDataset.datasets[datasetId]).toBeUndefined();
  });

  it("prunes live report output records when removing one dataset from a multi-dataset snapshot", () => {
    const state = sessionReducer(createInitialSessionState(), {
      type: "live/loaded",
      reportId: "inactive-users",
      periodRole: "current",
      scope: { startDate: "2026-01-01", endDate: "2026-01-31" },
      warnings: [],
      datasets: [
        {
          datasetName: "users",
          records: [{ user_id: 1, display_name: "Ada" }],
          pagination: completePagination,
        },
        {
          datasetName: "tags",
          records: [{ name: "python" }],
          pagination: completePagination,
        },
      ],
    });
    const datasetToRemove = Object.values(state.datasets).find((dataset) => dataset.name === "users");

    expect(datasetToRemove).toBeDefined();
    const withoutDataset = sessionReducer(state, {
      type: "dataset/remove",
      datasetId: datasetToRemove?.id ?? "",
    });

    expect(Object.values(withoutDataset.datasets)).toHaveLength(1);
    expect(Object.values(withoutDataset.datasets)[0]?.name).toBe("tags");
    expect(withoutDataset.reportRunSnapshots).toHaveLength(1);
    expect(withoutDataset.reportRunSnapshots[0]?.datasetIds).toEqual([Object.values(withoutDataset.datasets)[0]?.id]);
    expect(withoutDataset.reportOutputs["inactive-users"]?.records).toEqual([
      { datasetName: "tags", name: "python" },
    ]);
    expect(withoutDataset.reportOutputs["inactive-users"]?.currentScope).toEqual({
      startDate: "2026-01-01",
      endDate: "2026-01-31",
    });
    expect(withoutDataset.reportOutputs["inactive-users"]?.currentSnapshotId).toEqual(datasetToRemove?.snapshotId);
  });

  it("keeps live warnings until the last dataset from the warned snapshot is removed", () => {
    const state = sessionReducer(createInitialSessionState(), {
      type: "live/loaded",
      reportId: "inactive-users",
      periodRole: "current",
      scope: { startDate: "2026-01-01", endDate: "2026-01-31" },
      warnings: [{ reportId: "inactive-users", code: "dataset-cap-reached", message: "Partial data." }],
      datasets: [
        {
          datasetName: "users",
          records: [{ user_id: 1, display_name: "Ada" }],
          pagination: completePagination,
        },
        {
          datasetName: "tags",
          records: [{ name: "python" }],
          pagination: completePagination,
        },
      ],
    });
    const usersDataset = Object.values(state.datasets).find((dataset) => dataset.name === "users");
    const tagsDataset = Object.values(state.datasets).find((dataset) => dataset.name === "tags");

    expect(usersDataset).toBeDefined();
    expect(tagsDataset).toBeDefined();

    const withoutUsers = sessionReducer(state, {
      type: "dataset/remove",
      datasetId: usersDataset?.id ?? "",
    });

    expect(withoutUsers.warnings).toEqual([
      { reportId: "inactive-users", code: "dataset-cap-reached", message: "Partial data." },
    ]);

    const withoutTags = sessionReducer(withoutUsers, {
      type: "dataset/remove",
      datasetId: tagsDataset?.id ?? "",
    });

    expect(withoutTags.reportRunSnapshots).toEqual([]);
    expect(withoutTags.warnings).toEqual([]);
  });

  it("keeps current output records when removing only a comparison live dataset", () => {
    const current = sessionReducer(createInitialSessionState(), {
      type: "live/loaded",
      reportId: "inactive-users",
      periodRole: "current",
      scope: { startDate: "2026-06-01", endDate: "2026-06-30" },
      warnings: [],
      datasets: [
        {
          datasetName: "users",
          records: [{ user_id: 1, display_name: "Ada" }],
          pagination: completePagination,
        },
      ],
    });
    const comparison = sessionReducer(current, {
      type: "live/loaded",
      reportId: "inactive-users",
      periodRole: "comparison",
      scope: { startDate: "2026-05-01", endDate: "2026-05-31" },
      warnings: [],
      datasets: [
        {
          datasetName: "users",
          records: [{ user_id: 2, display_name: "Grace" }],
          pagination: completePagination,
        },
      ],
    });
    const comparisonDataset = Object.values(comparison.datasets).find(
      (dataset) => dataset.periodRole === "comparison",
    );

    expect(comparisonDataset).toBeDefined();
    const withoutComparison = sessionReducer(comparison, {
      type: "dataset/remove",
      datasetId: comparisonDataset?.id ?? "",
    });

    expect(Object.values(withoutComparison.datasets)).toHaveLength(1);
    expect(withoutComparison.reportRunSnapshots).toHaveLength(1);
    expect(withoutComparison.reportRunSnapshots[0]?.periodRole).toBe("current");
    expect(withoutComparison.reportOutputs["inactive-users"]?.records).toEqual([
      { datasetName: "users", user_id: 1, display_name: "Ada" },
    ]);
    expect(withoutComparison.reportOutputs["inactive-users"]?.currentSnapshotId).toEqual(
      current.reportOutputs["inactive-users"]?.currentSnapshotId,
    );
    expect(withoutComparison.reportOutputs["inactive-users"]?.comparisonRecords).toBeUndefined();
    expect(withoutComparison.reportOutputs["inactive-users"]?.comparisonScope).toBeUndefined();
    expect(withoutComparison.reportOutputs["inactive-users"]?.comparisonSnapshotId).toBeUndefined();
  });

  it("keeps comparison output records when removing only a current live dataset", () => {
    const current = sessionReducer(createInitialSessionState(), {
      type: "live/loaded",
      reportId: "inactive-users",
      periodRole: "current",
      scope: { startDate: "2026-06-01", endDate: "2026-06-30" },
      warnings: [],
      datasets: [
        {
          datasetName: "users",
          records: [{ user_id: 1, display_name: "Ada" }],
          pagination: completePagination,
        },
      ],
    });
    const comparison = sessionReducer(current, {
      type: "live/loaded",
      reportId: "inactive-users",
      periodRole: "comparison",
      scope: { startDate: "2026-05-01", endDate: "2026-05-31" },
      warnings: [],
      datasets: [
        {
          datasetName: "users",
          records: [{ user_id: 2, display_name: "Grace" }],
          pagination: completePagination,
        },
      ],
    });
    const currentDataset = Object.values(comparison.datasets).find((dataset) => dataset.periodRole === "current");

    expect(currentDataset).toBeDefined();
    const withoutCurrent = sessionReducer(comparison, {
      type: "dataset/remove",
      datasetId: currentDataset?.id ?? "",
    });

    expect(Object.values(withoutCurrent.datasets)).toHaveLength(1);
    expect(withoutCurrent.reportRunSnapshots).toHaveLength(1);
    expect(withoutCurrent.reportRunSnapshots[0]?.periodRole).toBe("comparison");
    expect(withoutCurrent.reportOutputs["inactive-users"]?.records).toEqual([]);
    expect(withoutCurrent.reportOutputs["inactive-users"]?.currentScope).toBeUndefined();
    expect(withoutCurrent.reportOutputs["inactive-users"]?.currentSnapshotId).toBeUndefined();
    expect(withoutCurrent.reportOutputs["inactive-users"]?.comparisonRecords).toEqual([
      { datasetName: "users", user_id: 2, display_name: "Grace" },
    ]);
    expect(withoutCurrent.reportOutputs["inactive-users"]?.comparisonSnapshotId).toEqual(
      comparison.reportOutputs["inactive-users"]?.comparisonSnapshotId,
    );
  });

  it("clears credentials and datasets on reset", () => {
    const withData = sessionReducer(createInitialSessionState(), {
      type: "dataset/set",
      datasetName: "users",
      records: [{ id: 1 }],
    });
    const reset = sessionReducer(withData, { type: "session/reset" });

    expect(reset.credentials).toBeNull();
    expect(reset.datasets).toEqual({});
    expect(reset.reportOutputs).toEqual({});
    expect(reset.reportRunSnapshots).toEqual([]);
  });

  it("hydrates persisted datasets without changing memory-only credentials", () => {
    const withCredentials = sessionReducer(createInitialSessionState(), {
      type: "credentials/set",
      credentials: {
        instanceType: "basic-business",
        baseUrl: "https://stackoverflowteams.com/c/example",
        pat: "pat-token",
        authSource: "manual-pat",
      },
    });
    const hydrated = sessionReducer(withCredentials, {
      type: "session/hydratePersistentDatasets",
      snapshot: {
        version: 1,
        selectedReportId: "inactive-users",
        selectedReportIds: ["inactive-users"],
        datasets: {
          "dataset-1": {
            id: "dataset-1",
            name: "users",
            records: [{ user_id: 1 }],
            loadedAt: "2026-07-09T12:00:00.000Z",
            source: "upload",
          },
        },
        reportOutputs: {},
        reportRunSnapshots: [],
        warnings: [],
      },
    });

    expect(hydrated.credentials).toBe(withCredentials.credentials);
    expect(hydrated.selectedReportId).toBe("inactive-users");
    expect(hydrated.datasets["dataset-1"]?.records).toEqual([{ user_id: 1 }]);
  });

  it("preserves a newer utility selection while hydrating stored content", () => {
    const current = {
      ...createInitialSessionState(),
      selectedUtilityId: "future-utility",
    } as unknown as ReturnType<typeof createInitialSessionState>;
    const hydrated = sessionReducer(current, {
      type: "session/hydratePersistentDatasets",
      snapshot: {
        version: 2,
        selectedReportId: "tag-report",
        selectedReportIds: ["tag-report"],
        selectedUtilityId: "sme-coverage-analyzer",
        datasets: {},
        reportOutputs: {},
        reportRunSnapshots: [],
        utilityOutputs: {},
        utilityRunSnapshots: [],
        warnings: [],
      },
      preserveSelection: {
        selectedReportId: "tag-report",
        selectedReportIds: ["tag-report"],
        selectedUtilityId: "future-utility",
      },
    } as never);

    expect(hydrated.selectedUtilityId).toBe("future-utility");
    expect(hydrated.utilityOutputs).toEqual({});
  });

  it("leaves existing state unchanged when persistent hydration is invalid", () => {
    const withDataset = sessionReducer(createInitialSessionState(), {
      type: "import/loaded",
      datasetName: "tags",
      fileName: "tag_metrics.csv",
      records: [{ tagName: "python" }],
      reportId: "tag-report",
    });
    const hydrated = sessionReducer(withDataset, {
      type: "session/hydratePersistentDatasets",
      snapshot: {
        version: 1,
        selectedReportId: "inactive-users",
        selectedReportIds: ["inactive-users"],
        datasets: {},
        reportOutputs: [],
        reportRunSnapshots: [],
        warnings: [],
      },
    });

    expect(hydrated).toBe(withDataset);
  });

  it("flushes datasets and report state while keeping credentials", () => {
    const withCredentials = sessionReducer(createInitialSessionState(), {
      type: "credentials/set",
      credentials: {
        instanceType: "basic-business",
        baseUrl: "https://stackoverflowteams.com/c/example",
        pat: "pat-token",
        authSource: "manual-pat",
      },
    });
    const withDataset = sessionReducer(withCredentials, {
      type: "import/loaded",
      datasetName: "tags",
      fileName: "tag_metrics.csv",
      records: [{ tagName: "python" }],
      reportId: "tag-report",
    });
    const flushed = sessionReducer(withDataset, { type: "datasets/flush" });

    expect(flushed.credentials).toBe(withCredentials.credentials);
    expect(flushed.datasets).toEqual({});
    expect(flushed.reportOutputs).toEqual({});
    expect(flushed.reportRunSnapshots).toEqual([]);
    expect(flushed.warnings).toEqual([]);
  });
});

function createUtilityLoadedAction(decisionPack: SmeCoverageDecisionPack) {
  return {
    type: "utility/loaded",
    result: {
      utilityId: "sme-coverage-analyzer",
      utilityTitle: "SME Coverage Analyzer",
      pageSize: 100,
      maxPagesPerDataset: 20,
      runPreset: "deep-audit",
      datasets: [
        { datasetName: "tags", records: [], pagination: { pageCount: 0, reachedMaxPages: false, hasMore: false } },
        { datasetName: "questions", records: [], pagination: { pageCount: 0, reachedMaxPages: false, hasMore: false } },
        { datasetName: "tagSmeCounts", records: [], pagination: { pageCount: 0, reachedMaxPages: false, hasMore: false } },
      ],
      messages: [],
      warnings: [],
      decisionPack,
    },
  };
}

function createUtilityDecisionPack(
  completeness: "Complete" | "Partial" | "Empty" = "Empty",
): SmeCoverageDecisionPack {
  return {
    snapshot: {
      instanceHost: "example.stackenterprise.co",
      generatedAt: "2026-07-30T12:00:00.000Z",
      scopeLabel: "All-time demand · Current SME coverage",
      completeness,
      pageSize: 100,
      maxPagesPerDataset: 20,
      runPreset: "deep-audit",
    },
    warnings: [],
    summary: {
      tagsAnalyzed: 0,
      tagsWithSmes: 0,
      immediateGaps: 0,
      criticalUnderCoverage: 0,
      lightCoverage: 0,
      unknownRows: 0,
    },
    overview: "No tags were available.",
    assessment: "No assessment can be made.",
    findings: { immediateGaps: [], criticalUnderCoverage: [], lightCoverage: [] },
    methodology: {
      activityQuestionMinimum: 1,
      activityPageViewThresholdExclusive: 25,
      activeTagMedianPageViews: null,
      coveredActiveSampleSize: 0,
      p75PageViewsPerSme: null,
      p90PageViewsPerSme: null,
      percentileSampleSufficient: false,
      ratioFormula: "pageViews / smeCount",
      roundingRule: "Nearest whole page view for display; unrounded for calculation",
    },
    evidence: [],
  };
}
