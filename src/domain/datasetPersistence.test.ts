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

  it("creates a snapshot with sanitized nested dataset and report state", () => {
    const state = {
      ...createInitialSessionState(),
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
          warnings: [
            {
              reportId: "inactive-users",
              code: "dataset-warning",
              message: "Dataset warning.",
              credentials: { pat: "dataset-warning-secret" },
              runQueue: [{ id: "dataset-warning-run" }],
            },
          ],
          credentials: { pat: "dataset-secret" },
          runQueue: [{ id: "dataset-run" }],
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
          warnings: [
            {
              reportId: "inactive-users",
              code: "output-warning",
              message: "Output warning.",
              credentials: { pat: "output-warning-secret" },
              runQueue: [{ id: "output-warning-run" }],
            },
          ],
          credentials: { pat: "output-secret" },
          runQueue: [{ id: "output-run" }],
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
          warnings: [
            {
              reportId: "inactive-users",
              code: "snapshot-warning",
              message: "Snapshot warning.",
              credentials: { pat: "snapshot-warning-secret" },
              runQueue: [{ id: "snapshot-warning-run" }],
            },
          ],
          credentials: { pat: "snapshot-secret" },
          runQueue: [{ id: "snapshot-run" }],
        },
      ],
      warnings: [
        {
          reportId: "inactive-users",
          code: "top-level-warning",
          message: "Top-level warning.",
          credentials: { pat: "top-level-secret" },
          runQueue: [{ id: "top-level-run" }],
        },
      ],
    } as unknown as SessionState;

    const snapshot = createDatasetSessionSnapshot(state);

    expect(snapshot.datasets["dataset-1"]).not.toHaveProperty("credentials");
    expect(snapshot.datasets["dataset-1"]).not.toHaveProperty("runQueue");
    expect(snapshot.datasets["dataset-1"]?.warnings?.[0]).toEqual({
      reportId: "inactive-users",
      code: "dataset-warning",
      message: "Dataset warning.",
    });
    expect(snapshot.reportOutputs["inactive-users"]).not.toHaveProperty("credentials");
    expect(snapshot.reportOutputs["inactive-users"]).not.toHaveProperty("runQueue");
    expect(snapshot.reportOutputs["inactive-users"]?.warnings?.[0]).toEqual({
      reportId: "inactive-users",
      code: "output-warning",
      message: "Output warning.",
    });
    expect(snapshot.reportRunSnapshots[0]).not.toHaveProperty("credentials");
    expect(snapshot.reportRunSnapshots[0]).not.toHaveProperty("runQueue");
    expect(snapshot.reportRunSnapshots[0]?.warnings[0]).toEqual({
      reportId: "inactive-users",
      code: "snapshot-warning",
      message: "Snapshot warning.",
    });
    expect(snapshot.warnings[0]).toEqual({
      reportId: "inactive-users",
      code: "top-level-warning",
      message: "Top-level warning.",
    });
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

  it("returns null for malformed top-level report state fields", () => {
    const baseSnapshot = {
      version: 1,
      selectedReportId: "tag-report",
      selectedReportIds: ["tag-report"],
      datasets: {},
      reportOutputs: {},
      reportRunSnapshots: [],
      warnings: [],
    };

    expect(parseDatasetSessionSnapshot({ ...baseSnapshot, reportOutputs: [] })).toBeNull();
    expect(parseDatasetSessionSnapshot({ ...baseSnapshot, reportRunSnapshots: {} })).toBeNull();
    expect(parseDatasetSessionSnapshot({ ...baseSnapshot, warnings: {} })).toBeNull();
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

  it("strips extra nested memory-only properties from parsed and hydrated snapshots", () => {
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
          source: "live-api",
          reportId: "inactive-users",
          periodRole: "current",
          scope: { startDate: "2026-06-01", endDate: "2026-06-30" },
          warnings: [
            {
              reportId: "inactive-users",
              code: "dataset-cap-reached",
              message: "Partial data.",
              credentials: { pat: "nested-secret" },
              runQueue: [{ id: "nested-run" }],
            },
          ],
          credentials: { pat: "dataset-secret" },
          runQueue: [{ id: "dataset-run" }],
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
          warnings: [
            {
              reportId: "inactive-users",
              code: "output-warning",
              message: "Output warning.",
              credentials: { pat: "output-warning-secret" },
              runQueue: [{ id: "output-warning-run" }],
            },
          ],
          credentials: { pat: "output-secret" },
          runQueue: [{ id: "output-run" }],
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
          warnings: [
            {
              reportId: "inactive-users",
              code: "snapshot-warning",
              message: "Snapshot warning.",
              credentials: { pat: "snapshot-warning-secret" },
              runQueue: [{ id: "snapshot-warning-run" }],
            },
          ],
          credentials: { pat: "snapshot-secret" },
          runQueue: [{ id: "snapshot-run" }],
        },
      ],
      warnings: [
        {
          reportId: "inactive-users",
          code: "top-level-warning",
          message: "Top-level warning.",
          credentials: { pat: "top-level-secret" },
          runQueue: [{ id: "top-level-run" }],
        },
      ],
    };

    const parsed = parseDatasetSessionSnapshot(persisted);
    const hydrated = hydrateDatasetSessionState(createInitialSessionState(), persisted);

    expect(parsed?.datasets["dataset-1"]).not.toHaveProperty("credentials");
    expect(parsed?.datasets["dataset-1"]).not.toHaveProperty("runQueue");
    expect(parsed?.datasets["dataset-1"]?.warnings?.[0]).toEqual({
      reportId: "inactive-users",
      code: "dataset-cap-reached",
      message: "Partial data.",
    });
    expect(parsed?.reportOutputs["inactive-users"]).not.toHaveProperty("credentials");
    expect(parsed?.reportOutputs["inactive-users"]).not.toHaveProperty("runQueue");
    expect(parsed?.reportOutputs["inactive-users"]?.warnings?.[0]).toEqual({
      reportId: "inactive-users",
      code: "output-warning",
      message: "Output warning.",
    });
    expect(parsed?.reportRunSnapshots[0]).not.toHaveProperty("credentials");
    expect(parsed?.reportRunSnapshots[0]).not.toHaveProperty("runQueue");
    expect(parsed?.reportRunSnapshots[0]?.warnings[0]).toEqual({
      reportId: "inactive-users",
      code: "snapshot-warning",
      message: "Snapshot warning.",
    });
    expect(parsed?.warnings[0]).toEqual({
      reportId: "inactive-users",
      code: "top-level-warning",
      message: "Top-level warning.",
    });
    expect(hydrated.datasets["dataset-1"]).toEqual(parsed?.datasets["dataset-1"]);
    expect(hydrated.reportOutputs["inactive-users"]).toEqual(parsed?.reportOutputs["inactive-users"]);
    expect(hydrated.reportRunSnapshots).toEqual(parsed?.reportRunSnapshots);
    expect(hydrated.warnings).toEqual(parsed?.warnings);
  });

  it("ignores report outputs when the map key does not match the output report id", () => {
    const parsed = parseDatasetSessionSnapshot({
      version: 1,
      selectedReportId: "inactive-users",
      selectedReportIds: ["inactive-users"],
      datasets: {},
      reportOutputs: {
        "inactive-users": {
          reportId: "tag-report",
          datasetName: "tags",
          fileName: "tag_metrics.csv",
          records: [{ tagName: "python" }],
          loadedAt: "2026-07-09T12:00:00.000Z",
          source: "upload",
        },
      },
      reportRunSnapshots: [],
      warnings: [],
    });

    expect(parsed?.reportOutputs).toEqual({});
  });

  it("normalizes persisted selections so the selected report id is first and present", () => {
    const parsed = parseDatasetSessionSnapshot({
      version: 1,
      selectedReportId: "deleted-report",
      selectedReportIds: ["inactive-users", "tag-report"],
      datasets: {},
      reportOutputs: {},
      reportRunSnapshots: [],
      warnings: [],
    });

    expect(parsed?.selectedReportId).toBe("tag-report");
    expect(parsed?.selectedReportIds).toEqual(["tag-report", "inactive-users"]);
  });
});
