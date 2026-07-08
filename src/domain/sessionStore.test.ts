import { describe, expect, it } from "vitest";
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

describe("sessionStore", () => {
  it("starts with the tag report selected and empty session data", () => {
    expect(createInitialSessionState()).toEqual({
      credentials: null,
      selectedReportId: "tag-report",
      selectedReportIds: ["tag-report"],
      datasets: {},
      reportOutputs: {},
      reportRunSnapshots: [],
      warnings: [],
      runQueue: [],
    });
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

  it("stores live API datasets and exposes raw live report records", () => {
    const state = sessionReducer(createInitialSessionState(), {
      type: "live/loaded",
      reportId: "inactive-users",
      periodRole: "current",
      scope: { startDate: "2026-01-01", endDate: "2026-01-31" },
      pageSize: 50,
      maxPagesPerDataset: 2,
      warnings: [],
      datasets: [
        {
          datasetName: "users",
          records: [{ user_id: 1, display_name: "Ada" }],
        },
      ],
    });

    expect(state.selectedReportId).toBe("inactive-users");
    const [dataset] = Object.values(state.datasets);
    expect(dataset?.source).toBe("live-api");
    expect(dataset?.periodRole).toBe("current");
    expect(dataset?.scope).toEqual({ startDate: "2026-01-01", endDate: "2026-01-31" });
    expect(dataset?.records).toEqual([{ user_id: 1, display_name: "Ada" }]);
    expect(state.reportRunSnapshots).toHaveLength(1);
    expect(state.reportRunSnapshots[0]).toEqual(
      expect.objectContaining({
        reportId: "inactive-users",
        periodRole: "current",
        scope: { startDate: "2026-01-01", endDate: "2026-01-31" },
        pageSize: 50,
        maxPagesPerDataset: 2,
      }),
    );
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
      pageSize: 100,
      maxPagesPerDataset: 20,
      runPreset: "standard",
      warnings,
      datasets: [
        {
          datasetName: "tags",
          records: [{ name: "python", totalPageViews: 350, tagWatchers: 12 }],
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
        },
        {
          datasetName: "tagSmes",
          records: [{ tagName: "python", user_id: 1 }],
        },
      ],
    });

    expect(Object.values(state.datasets)).toHaveLength(3);
    expect(Object.values(state.datasets).find((dataset) => dataset.name === "tags")?.records).toEqual([
      { name: "python", totalPageViews: 350, tagWatchers: 12 },
    ]);
    expect(state.reportOutputs["tag-report"]?.records).toEqual([
      expect.objectContaining({
        tag_name: "python",
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

  it("persists the selected run preset on live snapshots", () => {
    const state = sessionReducer(createInitialSessionState(), {
      type: "live/loaded",
      reportId: "tag-report",
      periodRole: "current",
      scope: {},
      pageSize: 100,
      maxPagesPerDataset: 20,
      runPreset: "deep-audit",
      warnings: [],
      datasets: [
        {
          datasetName: "tags",
          records: [{ name: "python" }],
        },
      ],
    });

    expect(state.reportRunSnapshots[0]).toEqual(
      expect.objectContaining({
        reportId: "tag-report",
        pageSize: 100,
        maxPagesPerDataset: 20,
        runPreset: "deep-audit",
      }),
    );
  });

  it("stores current and comparison live snapshots without overwriting dataset names", () => {
    const current = sessionReducer(createInitialSessionState(), {
      type: "live/loaded",
      reportId: "inactive-users",
      periodRole: "current",
      scope: { startDate: "2026-06-01", endDate: "2026-06-30" },
      pageSize: 25,
      maxPagesPerDataset: 1,
      warnings: [],
      datasets: [
        {
          datasetName: "users",
          records: [{ user_id: 1, display_name: "Ada" }],
        },
      ],
    });
    const comparison = sessionReducer(current, {
      type: "live/loaded",
      reportId: "inactive-users",
      periodRole: "comparison",
      scope: { startDate: "2026-05-01", endDate: "2026-05-31" },
      pageSize: 25,
      maxPagesPerDataset: 1,
      warnings: [],
      datasets: [
        {
          datasetName: "users",
          records: [{ user_id: 2, display_name: "Grace" }],
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
});
