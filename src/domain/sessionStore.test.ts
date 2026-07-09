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

  it("clears live report output when removing a dataset from its run snapshot", () => {
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
        {
          datasetName: "tags",
          records: [{ name: "python" }],
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
    expect(withoutDataset.reportOutputs["inactive-users"]).toBeUndefined();
  });

  it("keeps current output records when removing only a comparison live dataset", () => {
    const current = sessionReducer(createInitialSessionState(), {
      type: "live/loaded",
      reportId: "inactive-users",
      periodRole: "current",
      scope: { startDate: "2026-06-01", endDate: "2026-06-30" },
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
    const comparison = sessionReducer(current, {
      type: "live/loaded",
      reportId: "inactive-users",
      periodRole: "comparison",
      scope: { startDate: "2026-05-01", endDate: "2026-05-31" },
      pageSize: 50,
      maxPagesPerDataset: 2,
      warnings: [],
      datasets: [
        {
          datasetName: "users",
          records: [{ user_id: 2, display_name: "Grace" }],
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
    const comparison = sessionReducer(current, {
      type: "live/loaded",
      reportId: "inactive-users",
      periodRole: "comparison",
      scope: { startDate: "2026-05-01", endDate: "2026-05-31" },
      pageSize: 50,
      maxPagesPerDataset: 2,
      warnings: [],
      datasets: [
        {
          datasetName: "users",
          records: [{ user_id: 2, display_name: "Grace" }],
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
