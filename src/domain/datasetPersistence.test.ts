import { describe, expect, it } from "vitest";
import type { SessionState } from "./types";
import {
  DATASET_SESSION_PERSISTENCE_VERSION,
  LEGACY_COLLECTION_WARNING,
  createDatasetSessionSnapshot,
  hydrateDatasetSessionState,
  parseDatasetSessionSnapshot,
} from "./datasetPersistence";
import { createInitialSessionState } from "./sessionStore";
import type { SmeCoverageDecisionPack } from "../utilities/smeCoverage/model";
import {
  buildSmeCoverageEvidenceCsv,
  buildSmeCoverageMarkdown,
} from "../utilities/smeCoverage/exports";

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
      version: 3,
      selectedReportId: "inactive-users",
      selectedReportIds: ["inactive-users"],
      selectedUtilityId: "sme-coverage-analyzer",
      datasets: state.datasets,
      reportOutputs: state.reportOutputs,
      reportRunSnapshots: state.reportRunSnapshots,
      utilityOutputs: {},
      utilityRunSnapshots: [],
      warnings: state.warnings,
    });
    expect(snapshot).not.toHaveProperty("credentials");
    expect(snapshot).not.toHaveProperty("runQueue");
  });

  it("persists and hydrates collected Tag last used source data", () => {
    const state: SessionState = {
      ...createInitialSessionState(),
      datasets: {
        "tag-last-used": {
          id: "tag-last-used",
          reportId: "tag-report",
          name: "tagLastUsed",
          records: [{ tagName: "python", lastUsed: "2025-01-01" }],
          loadedAt: "2026-07-09T12:00:00.000Z",
          source: "live-api",
        },
      },
    };

    const snapshot = createDatasetSessionSnapshot(state);
    const hydrated = hydrateDatasetSessionState(createInitialSessionState(), snapshot);

    expect(snapshot.datasets).toEqual(state.datasets);
    expect(hydrated.datasets).toEqual(state.datasets);
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

  it("recursively strips prohibited fields from dataset and report records during snapshot creation", () => {
    const loadedAt = "2026-07-30T12:00:00.000Z";
    const unsafeRecord = {
      safe: "keep",
      nested: {
        credentials: { pat: "secret" },
        children: [
          { safeNumber: 1, apiKey: "secret" },
          { safeText: "ok", accessToken: "secret" },
          { safeBoolean: true, token: "secret", refreshToken: "secret" },
        ],
        requestPayload: { secret: true },
      },
      oauthClientId: "secret-client",
      runProgress: { stage: "secret-stage" },
    };
    const state = {
      ...createInitialSessionState(),
      datasets: {
        upload: {
          id: "upload",
          reportId: "tag-report",
          name: "tags",
          records: [unsafeRecord],
          loadedAt,
          source: "upload",
          fileName: "tags.json",
        },
      },
      reportOutputs: {
        "tag-report": {
          reportId: "tag-report",
          datasetName: "tags",
          fileName: "tags.json",
          records: [unsafeRecord],
          comparisonRecords: [{ safe: "comparison", oauthScopes: ["secret"] }],
          loadedAt,
          source: "upload",
        },
      },
    } as unknown as SessionState;

    const snapshot = createDatasetSessionSnapshot(state);
    const expected = {
      safe: "keep",
      nested: {
        children: [{ safeNumber: 1 }, { safeText: "ok" }, { safeBoolean: true }],
      },
    };

    expect(snapshot.datasets.upload?.records).toEqual([expected]);
    expect(snapshot.reportOutputs["tag-report"]?.records).toEqual([expected]);
    expect(snapshot.reportOutputs["tag-report"]?.comparisonRecords).toEqual([{ safe: "comparison" }]);
    expect(JSON.stringify(snapshot)).not.toMatch(
      /"(?:credentials|apiKey|accessToken|pat|token|refreshToken|authSource|oauthClientId|oauthScopes|accessTokenExpiresAt|runQueue|requestPayload|runProgress)"/,
    );
  });

  it("strips nested request bodies from persisted supporting utility records", () => {
    const state = {
      ...createInitialSessionState(),
      datasets: {
        utility: {
          id: "utility",
          snapshotId: "utility-snapshot",
          utilityId: "sme-coverage-analyzer",
          name: "questions",
          records: [
            {
              question_id: 1,
              nested: {
                requestBody: { credentials: { pat: "secret" }, pageSize: 100 },
                requestBodies: [{ accessToken: "secret" }],
              },
            },
          ],
          loadedAt: "2026-07-30T12:00:00.000Z",
          source: "live-api",
        },
      },
      utilityOutputs: {
        "sme-coverage-analyzer": {
          utilityId: "sme-coverage-analyzer",
          loadedAt: "2026-07-30T12:00:00.000Z",
          decisionPack: createPersistedUtilityPack(),
        },
      },
    } as unknown as SessionState;

    const serialized = JSON.stringify(createDatasetSessionSnapshot(state));

    expect(serialized).not.toMatch(/requestBod(?:y|ies)/);
    expect(serialized).not.toContain("secret");
  });

  it("recursively strips prohibited fields when parsing stored records and safely omits cycles", () => {
    const cycle: Record<string, unknown> = { safe: "cycle-root" };
    cycle.self = cycle;
    const value = createVersion2SnapshotValue({
      datasets: {
        stored: {
          id: "stored",
          name: "tags",
          records: [
            {
              safe: "keep",
              nested: [{ pat: "secret", safe: 1 }, { requestPayload: { token: "secret" }, safe: 2 }],
              authSource: "secret-source",
            },
            cycle,
          ],
          loadedAt: "2026-07-30T12:00:00.000Z",
          source: "upload",
        },
      },
    });

    const parsed = parseDatasetSessionSnapshot(value);

    expect(parsed?.datasets.stored?.records).toEqual([
      { safe: "keep", nested: [{ safe: 1 }, { safe: 2 }] },
      { safe: "cycle-root" },
    ]);
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
    expect(hydrated.selectedUtilityId).toBe("sme-coverage-analyzer");
    expect(hydrated.utilityOutputs).toEqual({});
    expect(hydrated.utilityRunSnapshots).toEqual([]);
  });

  it("migrates a valid report-only version 1 snapshot to normalized version 3 utility defaults", () => {
    const parsed = parseDatasetSessionSnapshot({
      version: 1,
      selectedReportId: "tag-report",
      selectedReportIds: ["tag-report"],
      datasets: {},
      reportOutputs: {},
      reportRunSnapshots: [],
      warnings: [],
    });

    expect(parsed).toMatchObject({
      version: 3,
      selectedUtilityId: "sme-coverage-analyzer",
      utilityOutputs: {},
      utilityRunSnapshots: [],
    });
  });

  it("migrates a version 2 live report to version 3 without legacy collection controls", () => {
    const parsed = parseDatasetSessionSnapshot(createLegacyLiveReportSnapshot(2));
    const legacyWarning = {
      reportId: "inactive-users",
      ...LEGACY_COLLECTION_WARNING,
    };

    expect(parsed?.version).toBe(DATASET_SESSION_PERSISTENCE_VERSION);
    expect(parsed?.reportRunSnapshots).toEqual([
      {
        id: "snapshot-1",
        reportId: "inactive-users",
        periodRole: "current",
        scope: { startDate: "2026-06-01", endDate: "2026-06-30" },
        loadedAt: "2026-07-09T12:00:00.000Z",
        datasetIds: ["dataset-1"],
        warnings: [],
      },
    ]);
    expect(parsed?.reportRunSnapshots[0]).not.toHaveProperty("pageSize");
    expect(parsed?.reportRunSnapshots[0]).not.toHaveProperty("maxPagesPerDataset");
    expect(parsed?.reportRunSnapshots[0]).not.toHaveProperty("runPreset");
    expect(parsed?.datasets["dataset-1"]?.warnings).toEqual([
      {
        reportId: "inactive-users",
        code: "dataset-cap-reached",
        message: "Original dataset warning.",
      },
      legacyWarning,
    ]);
    expect(parsed?.reportOutputs["inactive-users"]?.warnings).toEqual([
      {
        reportId: "inactive-users",
        code: "output-cap-reached",
        message: "Original output warning.",
      },
      legacyWarning,
    ]);
  });

  it("labels hydrated version 1 live report outputs and datasets as legacy", () => {
    const hydrated = hydrateDatasetSessionState(
      createInitialSessionState(),
      createLegacyLiveReportSnapshot(1),
    );
    const legacyWarning = {
      reportId: "inactive-users",
      ...LEGACY_COLLECTION_WARNING,
    };

    expect(hydrated.datasets["dataset-1"]?.warnings).toContainEqual(legacyWarning);
    expect(hydrated.reportOutputs["inactive-users"]?.warnings).toContainEqual(legacyWarning);
  });

  it("does not label legacy uploaded outputs or datasets as unverified live collections", () => {
    const parsed = parseDatasetSessionSnapshot({
      version: 2,
      selectedReportId: "tag-report",
      selectedReportIds: ["tag-report"],
      selectedUtilityId: "sme-coverage-analyzer",
      datasets: {
        upload: {
          id: "upload",
          reportId: "tag-report",
          name: "tags",
          records: [{ tagName: "python" }],
          loadedAt: "2026-07-09T12:00:00.000Z",
          source: "upload",
          fileName: "tags.csv",
          warnings: [{ reportId: "tag-report", code: "upload-warning", message: "Keep me." }],
        },
      },
      reportOutputs: {
        "tag-report": {
          reportId: "tag-report",
          datasetName: "tags",
          fileName: "tags.csv",
          records: [{ tagName: "python" }],
          loadedAt: "2026-07-09T12:00:00.000Z",
          source: "upload",
          warnings: [{ reportId: "tag-report", code: "upload-warning", message: "Keep me." }],
        },
      },
      reportRunSnapshots: [],
      utilityOutputs: {},
      utilityRunSnapshots: [],
      warnings: [],
    });

    expect(parsed?.datasets.upload?.warnings).toEqual([
      { reportId: "tag-report", code: "upload-warning", message: "Keep me." },
    ]);
    expect(parsed?.reportOutputs["tag-report"]?.warnings).toEqual([
      { reportId: "tag-report", code: "upload-warning", message: "Keep me." },
    ]);
  });

  it("round-trips version 3 live reports without legacy labels or collection controls", () => {
    const state: SessionState = {
      ...createInitialSessionState(),
      selectedReportId: "inactive-users",
      selectedReportIds: ["inactive-users"],
      datasets: {
        "dataset-1": {
          id: "dataset-1",
          snapshotId: "snapshot-1",
          reportId: "inactive-users",
          name: "users",
          records: [{ user_id: 1 }],
          loadedAt: "2026-07-09T12:00:00.000Z",
          source: "live-api",
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
          loadedAt: "2026-07-09T12:00:00.000Z",
          datasetIds: ["dataset-1"],
          warnings: [],
        },
      ],
    };

    const snapshot = createDatasetSessionSnapshot(state);
    const parsed = parseDatasetSessionSnapshot(snapshot);

    expect(snapshot.version).toBe(DATASET_SESSION_PERSISTENCE_VERSION);
    expect(parsed).toEqual(snapshot);
    expect(parsed?.reportRunSnapshots[0]).not.toHaveProperty("pageSize");
    expect(parsed?.reportRunSnapshots[0]).not.toHaveProperty("maxPagesPerDataset");
    expect(parsed?.reportRunSnapshots[0]).not.toHaveProperty("runPreset");
    expect(parsed?.datasets["dataset-1"]?.warnings).toBeUndefined();
    expect(parsed?.reportOutputs["inactive-users"]?.warnings).toBeUndefined();
  });

  it.each([
    ["negative page size", "pageSize", -1],
    ["fractional page limit", "maxPagesPerDataset", 1.5],
    ["unknown preset", "runPreset", "unbounded"],
  ])("drops a legacy report snapshot with %s", (_label, field, invalidValue) => {
    const value = createLegacyLiveReportSnapshot(2);
    const [snapshot] = value.reportRunSnapshots as Record<string, unknown>[];
    snapshot[field] = invalidValue;

    const parsed = parseDatasetSessionSnapshot(value);

    expect(parsed?.reportRunSnapshots).toEqual([]);
    expect(parsed?.reportOutputs).toEqual({});
  });

  it("persists and restores utility output and provenance without memory-only secrets", () => {
    const pack = createPersistedUtilityPack();
    const state = {
      ...createInitialSessionState(),
      credentials: {
        instanceType: "enterprise",
        baseUrl: "https://example.stackenterprise.co",
        apiKey: "secret-api-key",
        accessToken: "secret-access-token",
        pat: "secret-pat",
        authSource: "oauth-pkce",
        oauthClientId: "secret-client",
        oauthScopes: ["secret-scope"],
      },
      datasets: {
        "utility-dataset": {
          id: "utility-dataset",
          snapshotId: "utility-snapshot",
          utilityId: "sme-coverage-analyzer",
          name: "tagSmeCounts",
          records: [{ tagName: "python", count: 0 }],
          loadedAt: "2026-07-30T12:00:00.000Z",
          source: "live-api",
          pageCount: 1,
          reachedMaxPages: false,
          hasMore: false,
        },
      },
      utilityOutputs: {
        "sme-coverage-analyzer": {
          utilityId: "sme-coverage-analyzer",
          loadedAt: "2026-07-30T12:00:00.000Z",
          decisionPack: pack,
          credentials: { accessToken: "nested-output-token" },
          runQueue: [{ id: "nested-output-run" }],
        },
      },
      utilityRunSnapshots: [
        {
          id: "utility-snapshot",
          utilityId: "sme-coverage-analyzer",
          pageSize: 100,
          maxPagesPerDataset: 20,
          runPreset: "deep-audit",
          loadedAt: "2026-07-30T12:00:00.000Z",
          datasetIds: ["utility-dataset"],
          warnings: [],
          progress: { stage: "secret-progress" },
        },
      ],
      runQueue: [{ id: "secret-run", reportId: "tag-report", status: "running", message: "secret" }],
    } as unknown as SessionState;

    const snapshot = createDatasetSessionSnapshot(state);
    const restored = parseDatasetSessionSnapshot(snapshot);
    const serialized = JSON.stringify(snapshot);

    expect(snapshot.version).toBe(3);
    expect(restored?.utilityOutputs["sme-coverage-analyzer"]?.decisionPack).toEqual(pack);
    expect(restored?.utilityRunSnapshots[0]).toMatchObject({
      id: "utility-snapshot",
      datasetIds: ["utility-dataset"],
      pageSize: 100,
      maxPagesPerDataset: 20,
    });
    expect(serialized).not.toMatch(
      /"(?:credentials|apiKey|accessToken|pat|authSource|oauthClientId|oauthScopes|runQueue|progress)"/,
    );
  });

  it("migrates a legacy configured-partial v2 utility pack through parse and hydration exports", () => {
    const legacyPack = createLegacyConfiguredPartialUtilityPack();
    const persisted = createVersion2SnapshotValue({
      utilityOutputs: {
        "sme-coverage-analyzer": {
          utilityId: "sme-coverage-analyzer",
          loadedAt: "2026-07-30T12:00:00.000Z",
          decisionPack: legacyPack,
        },
      },
    });

    const parsed = parseDatasetSessionSnapshot(persisted);
    const hydrated = hydrateDatasetSessionState(createInitialSessionState(), persisted);
    const parsedPack = parsed?.utilityOutputs["sme-coverage-analyzer"]?.decisionPack;
    const hydratedPack = hydrated.utilityOutputs["sme-coverage-analyzer"]?.decisionPack;

    expect(parsed?.version).toBe(3);
    expect(parsedPack).toEqual(hydratedPack);
    expect(parsedPack?.warnings).toEqual([
      {
        utilityId: "sme-coverage-analyzer",
        code: "sme-coverage.partial-sample",
        message:
          "This decision pack is a partial sample because configured limits or source caps limited the analyzed evidence.",
      },
    ]);
    expect(Object.isFrozen(parsedPack)).toBe(true);
    expect(buildSmeCoverageMarkdown(parsedPack!)).toContain(
      "- sme-coverage.partial-sample: This decision pack is a partial sample because configured limits or source caps limited the analyzed evidence.",
    );
    expect(buildSmeCoverageEvidenceCsv(parsedPack!).split("\n")[1]).toBe(
      "python,100,1,Complete question enumeration,0,,,Immediate gap,Active tag has no assigned SMEs.,Assign or confirm at least one SME.,Complete,Complete,Partial,sme-coverage.partial-sample: This decision pack is a partial sample because configured limits or source caps limited the analyzed evidence.",
    );
  });

  it("drops malformed v2 utility state while retaining valid legacy datasets", () => {
    const parsed = parseDatasetSessionSnapshot({
      version: 2,
      selectedReportId: "tag-report",
      selectedReportIds: ["tag-report"],
      selectedUtilityId: "sme-coverage-analyzer",
      datasets: {
        legacy: {
          id: "legacy",
          name: "tags",
          records: [{ name: "python" }],
          loadedAt: "2026-07-30T12:00:00.000Z",
          source: "upload",
        },
      },
      reportOutputs: {},
      reportRunSnapshots: [],
      utilityOutputs: {
        "sme-coverage-analyzer": {
          utilityId: "sme-coverage-analyzer",
          loadedAt: "2026-07-30T12:00:00.000Z",
          decisionPack: { malformed: true },
        },
      },
      utilityRunSnapshots: [{ malformed: true }],
      warnings: [],
    });

    expect(parsed?.datasets.legacy?.records).toEqual([{ name: "python" }]);
    expect(parsed?.utilityOutputs).toEqual({});
    expect(parsed?.utilityRunSnapshots).toEqual([]);
  });

  it.each([
    ["empty snapshot id", [{ id: "", datasetIds: ["utility-dataset"] }]],
    ["empty dataset list", [{ id: "utility-snapshot", datasetIds: [] }]],
    ["empty dataset id", [{ id: "utility-snapshot", datasetIds: [""] }]],
    ["duplicate dataset reference", [{ id: "utility-snapshot", datasetIds: ["utility-dataset", "utility-dataset"] }]],
  ])("drops utility provenance with %s", (_label, overrides) => {
    const value = createUtilitySnapshotValue(
      overrides.map((override) => ({ ...createUtilityRunSnapshotValue(), ...override })),
    );

    expect(parseDatasetSessionSnapshot(value)?.utilityRunSnapshots).toEqual([]);
  });

  it("rejects every utility provenance entry sharing a duplicate snapshot id", () => {
    const snapshot = createUtilityRunSnapshotValue();
    const value = createUtilitySnapshotValue([snapshot, { ...snapshot }]);

    expect(parseDatasetSessionSnapshot(value)?.utilityRunSnapshots).toEqual([]);
  });

  it("rejects a dataset that claims both report and utility provenance", () => {
    const parsed = parseDatasetSessionSnapshot({
      version: 2,
      selectedReportId: "tag-report",
      selectedReportIds: ["tag-report"],
      selectedUtilityId: "sme-coverage-analyzer",
      datasets: {
        conflicting: {
          id: "conflicting",
          reportId: "tag-report",
          utilityId: "sme-coverage-analyzer",
          name: "tags",
          records: [],
          loadedAt: "2026-07-30T12:00:00.000Z",
          source: "live-api",
        },
      },
      reportOutputs: {},
      reportRunSnapshots: [],
      utilityOutputs: {},
      utilityRunSnapshots: [],
      warnings: [],
    });

    expect(parsed).toBeNull();
  });

  it("drops warnings that claim both report and utility ownership", () => {
    const parsed = parseDatasetSessionSnapshot({
      version: 2,
      selectedReportId: "tag-report",
      selectedReportIds: ["tag-report"],
      selectedUtilityId: "sme-coverage-analyzer",
      datasets: {},
      reportOutputs: {},
      reportRunSnapshots: [],
      utilityOutputs: {},
      utilityRunSnapshots: [],
      warnings: [
        {
          reportId: "tag-report",
          utilityId: "sme-coverage-analyzer",
          code: "conflicting-owner",
          message: "Invalid warning.",
        },
      ],
    });

    expect(parsed?.warnings).toEqual([]);
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

  it("ignores report outputs with invalid record arrays", () => {
    const parsed = parseDatasetSessionSnapshot({
      version: 1,
      selectedReportId: "inactive-users",
      selectedReportIds: ["inactive-users"],
      datasets: {},
      reportOutputs: {
        "inactive-users": {
          reportId: "inactive-users",
          datasetName: "users",
          fileName: "invalid_records.csv",
          records: [null],
          loadedAt: "2026-07-09T12:00:00.000Z",
          source: "upload",
        },
        "tag-report": {
          reportId: "tag-report",
          datasetName: "tags",
          fileName: "invalid_comparison_records.csv",
          records: [{ tagName: "python" }],
          comparisonRecords: [null],
          loadedAt: "2026-07-09T12:00:00.000Z",
          source: "upload",
        },
      },
      reportRunSnapshots: [],
      warnings: [],
    });

    expect(parsed?.reportOutputs).toEqual({});
  });

  it("drops report outputs that have no backing persisted dataset state", () => {
    const parsed = parseDatasetSessionSnapshot({
      version: 1,
      selectedReportId: "inactive-users",
      selectedReportIds: ["inactive-users"],
      datasets: {
        "upload-dataset": {
          id: "upload-dataset",
          name: "tags",
          records: [{ tagName: "python" }],
          loadedAt: "2026-07-09T12:00:00.000Z",
          source: "upload",
          reportId: "tag-report",
          fileName: "tag_metrics.csv",
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
          currentSnapshotId: "missing-snapshot",
        },
        "tag-report": {
          reportId: "tag-report",
          datasetName: "tags",
          fileName: "tag_metrics.csv",
          records: [{ tagName: "python" }],
          loadedAt: "2026-07-09T12:00:00.000Z",
          source: "upload",
        },
        "api-user-report": {
          reportId: "api-user-report",
          datasetName: "users",
          fileName: "users.csv",
          records: [{ userId: 1 }],
          loadedAt: "2026-07-09T12:00:00.000Z",
          source: "upload",
        },
      },
      reportRunSnapshots: [],
      warnings: [],
    });

    expect(parsed?.reportOutputs).toEqual({
      "tag-report": {
        reportId: "tag-report",
        datasetName: "tags",
        fileName: "tag_metrics.csv",
        records: [{ tagName: "python" }],
        loadedAt: "2026-07-09T12:00:00.000Z",
        source: "upload",
      },
    });
  });

  it("drops report run snapshots whose dataset ids only exist on the object prototype", () => {
    const parsed = parseDatasetSessionSnapshot({
      version: 1,
      selectedReportId: "inactive-users",
      selectedReportIds: ["inactive-users"],
      datasets: {},
      reportOutputs: {},
      reportRunSnapshots: [
        {
          id: "snapshot-1",
          reportId: "inactive-users",
          periodRole: "current",
          scope: { startDate: "2026-06-01", endDate: "2026-06-30" },
          pageSize: 100,
          maxPagesPerDataset: 5,
          loadedAt: "2026-07-09T12:00:00.000Z",
          datasetIds: ["toString"],
          warnings: [],
        },
      ],
      warnings: [],
    });

    expect(parsed?.reportRunSnapshots).toEqual([]);
  });

  it("validates and discards legacy collection metadata on persisted report run snapshots", () => {
    const parsed = parseDatasetSessionSnapshot({
      version: 1,
      selectedReportId: "tag-report",
      selectedReportIds: ["tag-report"],
      datasets: {
        "dataset-1": {
          id: "dataset-1",
          snapshotId: "snapshot-1",
          reportId: "tag-report",
          name: "tags",
          records: [{ name: "python" }],
          loadedAt: "2026-07-09T12:00:00.000Z",
          source: "live-api",
          periodRole: "current",
        },
      },
      reportOutputs: {},
      reportRunSnapshots: [
        {
          id: "snapshot-1",
          reportId: "tag-report",
          periodRole: "current",
          scope: {},
          pageSize: 100,
          maxPagesPerDataset: 20,
          runPreset: "deep-audit",
          loadedAt: "2026-07-09T12:00:00.000Z",
          datasetIds: ["dataset-1"],
          warnings: [],
        },
      ],
      warnings: [],
    });

    expect(parsed?.reportRunSnapshots[0]).toEqual({
      id: "snapshot-1",
      reportId: "tag-report",
      periodRole: "current",
      scope: {},
      loadedAt: "2026-07-09T12:00:00.000Z",
      datasetIds: ["dataset-1"],
      warnings: [],
    });
  });

  it("rejects persisted datasets with unsafe prototype keys", () => {
    const parsed = parseDatasetSessionSnapshot(
      JSON.parse(`{
        "version": 1,
        "selectedReportId": "inactive-users",
        "selectedReportIds": ["inactive-users"],
        "datasets": {
          "__proto__": {
            "id": "__proto__",
            "name": "users",
            "records": [],
            "loadedAt": "2026-07-09T12:00:00.000Z",
            "source": "upload"
          }
        },
        "reportOutputs": {},
        "reportRunSnapshots": [],
        "warnings": []
      }`),
    );

    expect(parsed).toBeNull();
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

function createPersistedUtilityPack(): SmeCoverageDecisionPack {
  return {
    snapshot: {
      instanceHost: "example.stackenterprise.co",
      generatedAt: "2026-07-30T12:00:00.000Z",
      scopeLabel: "All-time demand · Current SME coverage",
      completeness: "Empty",
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

function createLegacyConfiguredPartialUtilityPack(): SmeCoverageDecisionPack {
  const row = {
    tagName: "python",
    pageViews: 100,
    questionCount: 1,
    questionCountBasis: "Complete question enumeration" as const,
    smeCount: 0,
    pageViewsPerSme: null,
    coveragePercentile: null,
    coverageTier: "Immediate gap" as const,
    reason: "Active tag has no assigned SMEs.",
    recommendedAction: "Assign or confirm at least one SME.",
    demandQuality: "Complete" as const,
    smeQuality: "Complete" as const,
  };
  return {
    snapshot: {
      instanceHost: "example.stackenterprise.co",
      generatedAt: "2026-07-30T12:00:00.000Z",
      scopeLabel: "All-time demand · Current SME coverage",
      completeness: "Partial",
      pageSize: 50,
      maxPagesPerDataset: 1,
      runPreset: "quick-sample",
    },
    warnings: [],
    summary: {
      tagsAnalyzed: 1,
      tagsWithSmes: 0,
      immediateGaps: 1,
      criticalUnderCoverage: 0,
      lightCoverage: 0,
      unknownRows: 0,
    },
    overview: "This analysis is a partial sample.",
    assessment: "This analysis is a partial sample.",
    findings: { immediateGaps: [row], criticalUnderCoverage: [], lightCoverage: [] },
    methodology: {
      activityQuestionMinimum: 1,
      activityPageViewThresholdExclusive: 25,
      activeTagMedianPageViews: 100,
      coveredActiveSampleSize: 0,
      p75PageViewsPerSme: null,
      p90PageViewsPerSme: null,
      percentileSampleSufficient: false,
      ratioFormula: "pageViews / smeCount",
      roundingRule: "Nearest whole page view for display; unrounded for calculation",
    },
    evidence: [row],
  };
}

function createVersion2SnapshotValue(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
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
    ...overrides,
  };
}

function createLegacyLiveReportSnapshot(version: 1 | 2): Record<string, unknown> {
  return {
    version,
    selectedReportId: "inactive-users",
    selectedReportIds: ["inactive-users"],
    selectedUtilityId: "sme-coverage-analyzer",
    datasets: {
      "dataset-1": {
        id: "dataset-1",
        snapshotId: "snapshot-1",
        reportId: "inactive-users",
        name: "users",
        records: [{ user_id: 1 }],
        loadedAt: "2026-07-09T12:00:00.000Z",
        source: "live-api",
        periodRole: "current",
        scope: { startDate: "2026-06-01", endDate: "2026-06-30" },
        warnings: [
          {
            reportId: "inactive-users",
            code: "dataset-cap-reached",
            message: "Original dataset warning.",
          },
        ],
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
            code: "output-cap-reached",
            message: "Original output warning.",
          },
        ],
      },
    },
    reportRunSnapshots: [
      {
        id: "snapshot-1",
        reportId: "inactive-users",
        periodRole: "current",
        scope: { startDate: "2026-06-01", endDate: "2026-06-30" },
        pageSize: 100,
        maxPagesPerDataset: 20,
        runPreset: "standard",
        loadedAt: "2026-07-09T12:00:00.000Z",
        datasetIds: ["dataset-1"],
        warnings: [],
      },
    ],
    utilityOutputs: {},
    utilityRunSnapshots: [],
    warnings: [],
  };
}

function createUtilitySnapshotValue(
  utilityRunSnapshots: Record<string, unknown>[],
): Record<string, unknown> {
  return createVersion2SnapshotValue({
    datasets: {
      "utility-dataset": {
        id: "utility-dataset",
        snapshotId: "utility-snapshot",
        utilityId: "sme-coverage-analyzer",
        name: "tags",
        records: [],
        loadedAt: "2026-07-30T12:00:00.000Z",
        source: "live-api",
      },
    },
    utilityRunSnapshots,
  });
}

function createUtilityRunSnapshotValue(): Record<string, unknown> {
  return {
    id: "utility-snapshot",
    utilityId: "sme-coverage-analyzer",
    pageSize: 100,
    maxPagesPerDataset: 20,
    runPreset: "deep-audit",
    loadedAt: "2026-07-30T12:00:00.000Z",
    datasetIds: ["utility-dataset"],
    warnings: [],
  };
}
