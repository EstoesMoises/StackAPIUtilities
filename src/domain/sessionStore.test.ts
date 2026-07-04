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

    expect(state.datasets.users?.records).toEqual([{ id: 1 }]);
    expect(state.datasets.users?.source).toBe("upload");
    expect(state.datasets.users?.loadedAt).toEqual(expect.any(String));
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
  });
});
