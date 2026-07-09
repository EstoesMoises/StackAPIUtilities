import { describe, expect, it } from "vitest";
import type { SessionState } from "./types";
import {
  createDatasetSessionSnapshot,
  hydrateDatasetSessionState,
  parseDatasetSessionSnapshot,
} from "./datasetPersistence";
import { createInitialSessionState } from "./sessionStore";

describe("datasetPersistence", () => {
  it("creates a persistable snapshot without credentials or run queue state", () => {
    const state: SessionState = {
      ...createInitialSessionState(),
      credentials: {
        instanceType: "basic-business",
        baseUrl: "https://stackoverflowteams.com/c/example",
        pat: "secret-pat",
        authSource: "manual-pat",
      },
      selectedReportId: "inactive-users",
      selectedReportIds: ["inactive-users"],
      datasets: {
        "dataset-1": {
          id: "dataset-1",
          name: "users",
          records: [{ user_id: 1 }],
          loadedAt: "2026-07-09T12:00:00.000Z",
          source: "live-api",
          reportId: "inactive-users",
          periodRole: "current",
          scope: { startDate: "2026-06-01", endDate: "2026-06-30" },
        },
      },
      reportOutputs: {
        "inactive-users": {
          reportId: "inactive-users",
          datasetName: "users",
          fileName: "Live API run",
          records: [{ datasetName: "users", user_id: 1 }],
          loadedAt: "2026-07-09T12:00:00.000Z",
          source: "live-api",
          currentScope: { startDate: "2026-06-01", endDate: "2026-06-30" },
          currentSnapshotId: "snapshot-1",
        },
      },
      reportRunSnapshots: [
        {
          id: "snapshot-1",
          reportId: "inactive-users",
          periodRole: "current",
          scope: { startDate: "2026-06-01", endDate: "2026-06-30" },
          pageSize: 100,
          maxPagesPerDataset: 5,
          loadedAt: "2026-07-09T12:00:00.000Z",
          datasetIds: ["dataset-1"],
          warnings: [],
        },
      ],
      warnings: [{ reportId: "inactive-users", code: "dataset-cap-reached", message: "Partial data." }],
      runQueue: [
        {
          id: "run-1",
          reportId: "inactive-users",
          status: "succeeded",
          message: "Finished.",
        },
      ],
    };

    const snapshot = createDatasetSessionSnapshot(state);

    expect(snapshot).toEqual({
      version: 1,
      selectedReportId: "inactive-users",
      selectedReportIds: ["inactive-users"],
      datasets: state.datasets,
      reportOutputs: state.reportOutputs,
      reportRunSnapshots: state.reportRunSnapshots,
      warnings: state.warnings,
    });
    expect(snapshot).not.toHaveProperty("credentials");
    expect(snapshot).not.toHaveProperty("runQueue");
  });

  it("hydrates valid persisted dataset state while preserving memory-only credentials", () => {
    const baseState: SessionState = {
      ...createInitialSessionState(),
      credentials: {
        instanceType: "enterprise",
        baseUrl: "https://enterprise.example.com",
        accessToken: "memory-only-token",
        authSource: "manual-enterprise-token",
      },
      runQueue: [
        {
          id: "queued",
          reportId: "tag-report",
          status: "queued",
          message: "Queued.",
        },
      ],
    };
    const persisted = {
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
    };

    const hydrated = hydrateDatasetSessionState(baseState, persisted);

    expect(hydrated.credentials).toBe(baseState.credentials);
    expect(hydrated.runQueue).toBe(baseState.runQueue);
    expect(hydrated.selectedReportId).toBe("inactive-users");
    expect(hydrated.selectedReportIds).toEqual(["inactive-users"]);
    expect(hydrated.datasets["dataset-1"]?.records).toEqual([{ user_id: 1 }]);
  });

  it("returns null for invalid persisted snapshot shapes", () => {
    expect(parseDatasetSessionSnapshot(null)).toBeNull();
    expect(parseDatasetSessionSnapshot({ version: 2 })).toBeNull();
    expect(
      parseDatasetSessionSnapshot({
        version: 1,
        selectedReportId: "tag-report",
        selectedReportIds: ["tag-report"],
        datasets: {
          broken: {
            id: "broken",
            name: "not-a-dataset",
            records: [],
            loadedAt: "2026-07-09T12:00:00.000Z",
            source: "upload",
          },
        },
        reportOutputs: {},
        reportRunSnapshots: [],
        warnings: [],
      }),
    ).toBeNull();
  });

  it("falls back to the initial report selection when persisted report ids are unknown", () => {
    const hydrated = hydrateDatasetSessionState(createInitialSessionState(), {
      version: 1,
      selectedReportId: "deleted-report",
      selectedReportIds: ["deleted-report"],
      datasets: {},
      reportOutputs: {},
      reportRunSnapshots: [],
      warnings: [],
    });

    expect(hydrated.selectedReportId).toBe("tag-report");
    expect(hydrated.selectedReportIds).toEqual(["tag-report"]);
  });
});
