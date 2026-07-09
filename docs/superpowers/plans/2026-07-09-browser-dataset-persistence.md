# Browser Dataset Persistence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist report datasets automatically in browser-local IndexedDB, restore them on app load, and provide a bulk flush action while keeping credentials memory-only.

**Architecture:** Add a pure domain snapshot/hydration module that explicitly excludes credentials and run queue state. Add a small browser IndexedDB adapter in `src/utils`, then wire it from `App` through React effects after initial hydration. Keep `DatasetsPanel` presentation-only by passing the bulk flush callback from `App`.

**Tech Stack:** Next.js 14, React 18, TypeScript, browser IndexedDB API, Vitest, Testing Library, jsdom.

---

## File Structure

- Create `src/domain/datasetPersistence.ts`: pure snapshot creation, snapshot validation, and state hydration from persisted dataset state.
- Create `src/domain/datasetPersistence.test.ts`: unit tests for credential exclusion, valid hydration, invalid snapshot fallback, and invalid report selection fallback.
- Modify `src/domain/sessionStore.ts`: add reducer actions for persisted dataset hydration and bulk dataset flushing.
- Modify `src/domain/sessionStore.test.ts`: prove reducer hydration delegates safely and flush preserves credentials while clearing dataset/report state.
- Create `src/utils/browserDatasetStorage.ts`: client-only IndexedDB load/save/clear helper for the latest dataset snapshot.
- Create `src/utils/browserDatasetStorage.test.ts`: unit tests for no-IndexedDB no-op behavior and thrown IndexedDB failures.
- Modify `src/components/DatasetsPanel.tsx`: add a bulk flush button that only appears when datasets exist.
- Modify `src/components/DatasetsPanel.test.tsx`: cover hidden empty-state behavior and click behavior for the bulk button.
- Modify `src/App.tsx`: load persisted datasets after mount, persist non-credential snapshots after dataset state changes, catch storage failures, and dispatch flush from the Datasets panel.
- Modify `src/components/AppShell.test.tsx`: mock browser storage and cover hydration, persistence without credentials, flush, and storage warning behavior.
- Modify `README.md`: update credential/dataset persistence copy.
- Modify `PRODUCT.md`: update the product data-handling principle so it no longer claims report data is always session-only.
- Modify `src/components/ReportWorkspace.tsx`: update readiness copy to mention browser-local dataset storage.
- Modify `src/components/ReportWorkspace.test.tsx`: update the readiness copy assertion.

---

### Task 1: Domain Snapshot And Reducer Actions

**Files:**
- Create: `src/domain/datasetPersistence.ts`
- Create: `src/domain/datasetPersistence.test.ts`
- Modify: `src/domain/sessionStore.ts`
- Modify: `src/domain/sessionStore.test.ts`

- [ ] **Step 1: Write failing persistence domain tests**

Create `src/domain/datasetPersistence.test.ts` with this content:

```ts
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
```

- [ ] **Step 2: Run domain tests to verify they fail**

Run:

```bash
pnpm test -- src/domain/datasetPersistence.test.ts
```

Expected: FAIL because `src/domain/datasetPersistence.ts` does not exist.

- [ ] **Step 3: Implement the pure persistence domain module**

Create `src/domain/datasetPersistence.ts` with this content:

```ts
import { reportRegistry } from "./reportRegistry";
import type {
  DatasetName,
  ReportId,
  ReportOutput,
  ReportRunSnapshot,
  ReportWarning,
  RunPeriodRole,
  SessionDataset,
  SessionState,
} from "./types";

export const DATASET_SESSION_PERSISTENCE_VERSION = 1;

export interface PersistedDatasetSessionSnapshot {
  version: typeof DATASET_SESSION_PERSISTENCE_VERSION;
  selectedReportId: ReportId;
  selectedReportIds: ReportId[];
  datasets: Record<string, SessionDataset>;
  reportOutputs: Partial<Record<ReportId, ReportOutput>>;
  reportRunSnapshots: ReportRunSnapshot[];
  warnings: ReportWarning[];
}

const knownDatasetNames = new Set<DatasetName>([
  "users",
  "tags",
  "questions",
  "answers",
  "comments",
  "articles",
  "communities",
  "userGroups",
  "tagSmes",
  "reputationHistory",
  "interactions",
  "dataExport",
]);
const knownReportIds = new Set<ReportId>(reportRegistry.map((report) => report.id));
const runPeriodRoles = new Set<RunPeriodRole>(["current", "comparison"]);

export function createDatasetSessionSnapshot(state: SessionState): PersistedDatasetSessionSnapshot {
  return {
    version: DATASET_SESSION_PERSISTENCE_VERSION,
    selectedReportId: state.selectedReportId,
    selectedReportIds: [...state.selectedReportIds],
    datasets: state.datasets,
    reportOutputs: state.reportOutputs,
    reportRunSnapshots: state.reportRunSnapshots,
    warnings: state.warnings,
  };
}

export function hydrateDatasetSessionState(state: SessionState, value: unknown): SessionState {
  const snapshot = parseDatasetSessionSnapshot(value);

  if (!snapshot) {
    return state;
  }

  const selectedReportId = knownReportIds.has(snapshot.selectedReportId)
    ? snapshot.selectedReportId
    : state.selectedReportId;
  const selectedReportIds = snapshot.selectedReportIds.filter((reportId) => knownReportIds.has(reportId));

  return {
    ...state,
    selectedReportId,
    selectedReportIds: selectedReportIds.length > 0 ? selectedReportIds : [selectedReportId],
    datasets: snapshot.datasets,
    reportOutputs: snapshot.reportOutputs,
    reportRunSnapshots: snapshot.reportRunSnapshots,
    warnings: snapshot.warnings,
  };
}

export function parseDatasetSessionSnapshot(value: unknown): PersistedDatasetSessionSnapshot | null {
  if (!isRecord(value) || value.version !== DATASET_SESSION_PERSISTENCE_VERSION) {
    return null;
  }

  const selectedReportId = isKnownReportId(value.selectedReportId) ? value.selectedReportId : "tag-report";
  const selectedReportIds = Array.isArray(value.selectedReportIds)
    ? value.selectedReportIds.filter(isKnownReportId)
    : [selectedReportId];
  const datasets = parseDatasetRecord(value.datasets);

  if (!datasets) {
    return null;
  }

  return {
    version: DATASET_SESSION_PERSISTENCE_VERSION,
    selectedReportId,
    selectedReportIds: selectedReportIds.length > 0 ? selectedReportIds : [selectedReportId],
    datasets,
    reportOutputs: parseReportOutputs(value.reportOutputs),
    reportRunSnapshots: parseReportRunSnapshots(value.reportRunSnapshots, datasets),
    warnings: parseWarnings(value.warnings),
  };
}

function parseDatasetRecord(value: unknown): Record<string, SessionDataset> | null {
  if (!isRecord(value)) {
    return null;
  }

  const datasets: Record<string, SessionDataset> = {};

  for (const [key, dataset] of Object.entries(value)) {
    if (!isSessionDataset(dataset) || dataset.id !== key) {
      return null;
    }

    datasets[key] = dataset;
  }

  return datasets;
}

function parseReportOutputs(value: unknown): Partial<Record<ReportId, ReportOutput>> {
  if (!isRecord(value)) {
    return {};
  }

  const outputs: Partial<Record<ReportId, ReportOutput>> = {};

  for (const [key, output] of Object.entries(value)) {
    if (isKnownReportId(key) && isReportOutput(output)) {
      outputs[key] = output;
    }
  }

  return outputs;
}

function parseReportRunSnapshots(
  value: unknown,
  datasets: Record<string, SessionDataset>,
): ReportRunSnapshot[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((snapshot): snapshot is ReportRunSnapshot => {
    return (
      isRecord(snapshot) &&
      typeof snapshot.id === "string" &&
      isKnownReportId(snapshot.reportId) &&
      isRunPeriodRole(snapshot.periodRole) &&
      isPeriodScope(snapshot.scope) &&
      Number.isInteger(snapshot.pageSize) &&
      Number.isInteger(snapshot.maxPagesPerDataset) &&
      typeof snapshot.loadedAt === "string" &&
      Array.isArray(snapshot.datasetIds) &&
      snapshot.datasetIds.every((datasetId) => typeof datasetId === "string" && datasets[datasetId]) &&
      Array.isArray(snapshot.warnings)
    );
  });
}

function parseWarnings(value: unknown): ReportWarning[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((warning): warning is ReportWarning => {
    return (
      isRecord(warning) &&
      typeof warning.code === "string" &&
      typeof warning.message === "string" &&
      (typeof warning.reportId === "undefined" || isKnownReportId(warning.reportId))
    );
  });
}

function isSessionDataset(value: unknown): value is SessionDataset {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    isDatasetName(value.name) &&
    Array.isArray(value.records) &&
    typeof value.loadedAt === "string" &&
    (value.source === "live-api" || value.source === "upload") &&
    (typeof value.snapshotId === "undefined" || typeof value.snapshotId === "string") &&
    (typeof value.reportId === "undefined" || isKnownReportId(value.reportId)) &&
    (typeof value.periodRole === "undefined" || isRunPeriodRole(value.periodRole)) &&
    (typeof value.scope === "undefined" || isPeriodScope(value.scope)) &&
    (typeof value.fileName === "undefined" || typeof value.fileName === "string") &&
    (typeof value.warnings === "undefined" || Array.isArray(value.warnings))
  );
}

function isReportOutput(value: unknown): value is ReportOutput {
  return (
    isRecord(value) &&
    isKnownReportId(value.reportId) &&
    isDatasetName(value.datasetName) &&
    typeof value.fileName === "string" &&
    Array.isArray(value.records) &&
    typeof value.loadedAt === "string" &&
    (value.source === "live-api" || value.source === "upload") &&
    (typeof value.comparisonRecords === "undefined" || Array.isArray(value.comparisonRecords)) &&
    (typeof value.currentScope === "undefined" || isPeriodScope(value.currentScope)) &&
    (typeof value.comparisonScope === "undefined" || isPeriodScope(value.comparisonScope)) &&
    (typeof value.currentSnapshotId === "undefined" || typeof value.currentSnapshotId === "string") &&
    (typeof value.comparisonSnapshotId === "undefined" || typeof value.comparisonSnapshotId === "string") &&
    (typeof value.warnings === "undefined" || Array.isArray(value.warnings))
  );
}

function isKnownReportId(value: unknown): value is ReportId {
  return typeof value === "string" && knownReportIds.has(value as ReportId);
}

function isDatasetName(value: unknown): value is DatasetName {
  return typeof value === "string" && knownDatasetNames.has(value as DatasetName);
}

function isRunPeriodRole(value: unknown): value is RunPeriodRole {
  return typeof value === "string" && runPeriodRoles.has(value as RunPeriodRole);
}

function isPeriodScope(value: unknown): value is { startDate?: string; endDate?: string } {
  return (
    isRecord(value) &&
    (typeof value.startDate === "undefined" || typeof value.startDate === "string") &&
    (typeof value.endDate === "undefined" || typeof value.endDate === "string")
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
```

- [ ] **Step 4: Add reducer actions for hydration and flushing**

Modify `src/domain/sessionStore.ts`:

```ts
import { hydrateDatasetSessionState } from "./datasetPersistence";
```

Extend `SessionAction`:

```ts
  | { type: "session/hydratePersistentDatasets"; snapshot: unknown }
  | { type: "datasets/flush" }
```

Add these cases to `sessionReducer` before `session/reset`:

```ts
    case "session/hydratePersistentDatasets":
      return hydrateDatasetSessionState(state, action.snapshot);
    case "datasets/flush":
      return {
        ...state,
        datasets: {},
        reportOutputs: {},
        reportRunSnapshots: [],
        warnings: [],
      };
```

- [ ] **Step 5: Add reducer tests for the new actions**

Append these tests inside `describe("sessionStore", () => { ... })` in `src/domain/sessionStore.test.ts`:

```ts
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
```

- [ ] **Step 6: Run domain tests to verify they pass**

Run:

```bash
pnpm test -- src/domain/datasetPersistence.test.ts src/domain/sessionStore.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit Task 1**

```bash
git add src/domain/datasetPersistence.ts src/domain/datasetPersistence.test.ts src/domain/sessionStore.ts src/domain/sessionStore.test.ts
git commit -m "feat: add dataset persistence state model"
```

---

### Task 2: Browser IndexedDB Adapter

**Files:**
- Create: `src/utils/browserDatasetStorage.ts`
- Create: `src/utils/browserDatasetStorage.test.ts`

- [ ] **Step 1: Write failing browser storage tests**

Create `src/utils/browserDatasetStorage.test.ts` with this content:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearPersistedDatasetSession,
  loadPersistedDatasetSession,
  savePersistedDatasetSession,
} from "./browserDatasetStorage";

const originalIndexedDB = globalThis.indexedDB;

afterEach(() => {
  vi.unstubAllGlobals();
  if (originalIndexedDB) {
    vi.stubGlobal("indexedDB", originalIndexedDB);
  }
});

describe("browserDatasetStorage", () => {
  it("treats missing IndexedDB as empty browser storage", async () => {
    vi.stubGlobal("indexedDB", undefined);

    await expect(loadPersistedDatasetSession()).resolves.toBeNull();
    await expect(
      savePersistedDatasetSession({
        version: 1,
        selectedReportId: "tag-report",
        selectedReportIds: ["tag-report"],
        datasets: {},
        reportOutputs: {},
        reportRunSnapshots: [],
        warnings: [],
      }),
    ).resolves.toBeUndefined();
    await expect(clearPersistedDatasetSession()).resolves.toBeUndefined();
  });

  it("rejects when IndexedDB cannot open", async () => {
    vi.stubGlobal("indexedDB", {
      open: () => {
        throw new Error("IndexedDB blocked");
      },
    });

    await expect(loadPersistedDatasetSession()).rejects.toThrow("IndexedDB blocked");
  });
});
```

- [ ] **Step 2: Run browser storage tests to verify they fail**

Run:

```bash
pnpm test -- src/utils/browserDatasetStorage.test.ts
```

Expected: FAIL because `src/utils/browserDatasetStorage.ts` does not exist.

- [ ] **Step 3: Implement the IndexedDB adapter**

Create `src/utils/browserDatasetStorage.ts` with this content:

```ts
import type { PersistedDatasetSessionSnapshot } from "../domain/datasetPersistence";

const DATABASE_NAME = "stack-api-utilities";
const DATABASE_VERSION = 1;
const STORE_NAME = "dataset-session";
const SNAPSHOT_KEY = "latest";

export async function loadPersistedDatasetSession(): Promise<PersistedDatasetSessionSnapshot | null> {
  const database = await openDatabase();

  if (!database) {
    return null;
  }

  try {
    const store = database.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME);
    const snapshot = await requestToPromise<PersistedDatasetSessionSnapshot | undefined>(
      store.get(SNAPSHOT_KEY),
    );
    return snapshot ?? null;
  } finally {
    database.close();
  }
}

export async function savePersistedDatasetSession(
  snapshot: PersistedDatasetSessionSnapshot,
): Promise<void> {
  const database = await openDatabase();

  if (!database) {
    return;
  }

  try {
    const store = database.transaction(STORE_NAME, "readwrite").objectStore(STORE_NAME);
    await requestToPromise(store.put(snapshot, SNAPSHOT_KEY));
  } finally {
    database.close();
  }
}

export async function clearPersistedDatasetSession(): Promise<void> {
  const database = await openDatabase();

  if (!database) {
    return;
  }

  try {
    const store = database.transaction(STORE_NAME, "readwrite").objectStore(STORE_NAME);
    await requestToPromise(store.delete(SNAPSHOT_KEY));
  } finally {
    database.close();
  }
}

async function openDatabase(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") {
    return null;
  }

  const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);

  request.onupgradeneeded = () => {
    const database = request.result;

    if (!database.objectStoreNames.contains(STORE_NAME)) {
      database.createObjectStore(STORE_NAME);
    }
  };

  return requestToPromise(request);
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed."));
  });
}
```

- [ ] **Step 4: Run browser storage tests to verify they pass**

Run:

```bash
pnpm test -- src/utils/browserDatasetStorage.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit Task 2**

```bash
git add src/utils/browserDatasetStorage.ts src/utils/browserDatasetStorage.test.ts
git commit -m "feat: add browser dataset storage adapter"
```

---

### Task 3: Datasets Panel Bulk Flush Action

**Files:**
- Modify: `src/components/DatasetsPanel.tsx`
- Modify: `src/components/DatasetsPanel.test.tsx`

- [ ] **Step 1: Write failing Datasets panel tests**

Modify the empty-state test render in `src/components/DatasetsPanel.test.tsx`:

```ts
render(
  <DatasetsPanel
    datasets={[]}
    onRemoveDataset={() => undefined}
    onFlushDatasets={() => undefined}
  />,
);
```

Add this assertion to the same empty-state test:

```ts
expect(screen.queryByRole("button", { name: "Flush stored datasets" })).not.toBeInTheDocument();
```

Update the existing non-empty renders to pass `onFlushDatasets={() => undefined}`.

Add this test inside `describe("DatasetsPanel", () => { ... })`:

```ts
  it("shows a bulk flush action only when datasets exist", async () => {
    const user = userEvent.setup();
    const onFlushDatasets = vi.fn();

    render(
      <DatasetsPanel
        datasets={[liveDataset()]}
        onRemoveDataset={() => undefined}
        onFlushDatasets={onFlushDatasets}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Flush stored datasets" }));

    expect(onFlushDatasets).toHaveBeenCalledOnce();
  });
```

- [ ] **Step 2: Run Datasets panel tests to verify they fail**

Run:

```bash
pnpm test -- src/components/DatasetsPanel.test.tsx
```

Expected: FAIL because `DatasetsPanel` does not accept `onFlushDatasets` and does not render the bulk button.

- [ ] **Step 3: Implement the bulk flush button**

Modify `src/components/DatasetsPanel.tsx` props:

```ts
interface DatasetsPanelProps {
  datasets: SessionDataset[];
  onRemoveDataset: (datasetId: string) => void;
  onFlushDatasets: () => void;
}

export function DatasetsPanel({ datasets, onRemoveDataset, onFlushDatasets }: DatasetsPanelProps) {
```

Replace the current header block with:

```tsx
      <div className="workspace-header">
        <div>
          <p className="workspace-kicker">Browser-local data</p>
          <h2 className="workspace-heading" id="datasets-heading">
            Datasets
          </h2>
        </div>
        {sortedDatasets.length > 0 && (
          <button className="s-btn s-btn__outlined" type="button" onClick={onFlushDatasets}>
            Flush stored datasets
          </button>
        )}
      </div>
```

Replace the empty-state copy with:

```tsx
<p className="workspace-copy">No datasets loaded or stored in this browser.</p>
```

- [ ] **Step 4: Run Datasets panel tests to verify they pass**

Run:

```bash
pnpm test -- src/components/DatasetsPanel.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit Task 3**

```bash
git add src/components/DatasetsPanel.tsx src/components/DatasetsPanel.test.tsx
git commit -m "feat: add bulk dataset flush control"
```

---

### Task 4: App Hydration, Persistence, Flush, And Warnings

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/components/AppShell.test.tsx`

- [ ] **Step 1: Mock browser dataset storage in App tests**

Modify the imports and mocks at the top of `src/components/AppShell.test.tsx`:

```ts
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { App } from "../App";
import { tagMetricsCsv } from "../test/fixtures/reportFixtures";
import {
  clearPersistedDatasetSession,
  loadPersistedDatasetSession,
  savePersistedDatasetSession,
} from "../utils/browserDatasetStorage";

vi.mock("../utils/browserDatasetStorage", () => ({
  clearPersistedDatasetSession: vi.fn(),
  loadPersistedDatasetSession: vi.fn(),
  savePersistedDatasetSession: vi.fn(),
}));

const loadPersistedDatasetSessionMock = vi.mocked(loadPersistedDatasetSession);
const savePersistedDatasetSessionMock = vi.mocked(savePersistedDatasetSession);
const clearPersistedDatasetSessionMock = vi.mocked(clearPersistedDatasetSession);
```

Replace the current `afterEach` block with:

```ts
beforeEach(() => {
  loadPersistedDatasetSessionMock.mockResolvedValue(null);
  savePersistedDatasetSessionMock.mockResolvedValue(undefined);
  clearPersistedDatasetSessionMock.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
});
```

- [ ] **Step 2: Write failing App hydration and storage tests**

Add these tests inside `describe("AppShell", () => { ... })`:

```ts
  it("hydrates persisted browser datasets without credentials", async () => {
    const user = userEvent.setup();
    loadPersistedDatasetSessionMock.mockResolvedValueOnce({
      version: 1,
      selectedReportId: "inactive-users",
      selectedReportIds: ["inactive-users"],
      datasets: {
        "dataset-1": {
          id: "dataset-1",
          snapshotId: "snapshot-1",
          reportId: "inactive-users",
          name: "users",
          records: [{ user_id: 1, display_name: "Ada" }],
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
          records: [{ datasetName: "users", user_id: 1, display_name: "Ada" }],
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
      warnings: [],
    });

    render(<App />);

    expect(await screen.findByText("1 dataset")).toBeInTheDocument();
    expect(screen.getByText("No credentials")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Datasets" }));

    expect(screen.getByText("Inactive Users")).toBeInTheDocument();
    expect(screen.getByText("2026-06-01 to 2026-06-30")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Flush stored datasets" })).toBeInTheDocument();
  });

  it("persists live API datasets without credentials or run queue state", async () => {
    const user = userEvent.setup();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({
        ok: true,
        result: {
          reportId: "inactive-users",
          reportTitle: "Inactive Users",
          periodRole: "current",
          scope: {},
          pageSize: 100,
          maxPagesPerDataset: 5,
          warnings: [],
          datasets: [
            {
              datasetName: "users",
              records: [{ user_id: 1, display_name: "Ada" }],
            },
          ],
          messages: ["Collected users (1 record) for Inactive Users."],
        },
      }), {
        status: 200,
      }),
    );

    render(<App />);

    await user.click(screen.getByRole("button", { name: "Inactive Users" }));
    await user.click(screen.getByRole("button", { name: "Credentials" }));
    await user.type(screen.getByLabelText("Instance URL"), "https://stackoverflowteams.com/c/example-team");
    await user.type(screen.getByLabelText("Personal access token"), "pat-token");
    await user.click(screen.getByRole("button", { name: "Save session credentials" }));
    await user.click(screen.getByRole("button", { name: "Reports" }));
    await user.click(screen.getByRole("button", { name: "Run current period" }));

    expect(await screen.findByText("Live API run completed for Inactive Users.")).toBeInTheDocument();
    await waitFor(() => expect(savePersistedDatasetSessionMock).toHaveBeenCalled());

    const savedSnapshot = savePersistedDatasetSessionMock.mock.calls.at(-1)?.[0] as Record<string, unknown>;
    expect(savedSnapshot).toMatchObject({
      version: 1,
      selectedReportId: "inactive-users",
      selectedReportIds: ["inactive-users"],
    });
    expect(savedSnapshot).not.toHaveProperty("credentials");
    expect(savedSnapshot).not.toHaveProperty("runQueue");
  });

  it("flushes current and persisted datasets in bulk", async () => {
    const user = userEvent.setup();
    loadPersistedDatasetSessionMock.mockResolvedValueOnce({
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
    });

    render(<App />);

    expect(await screen.findByText("1 dataset")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Datasets" }));
    await user.click(screen.getByRole("button", { name: "Flush stored datasets" }));

    expect(screen.getByText("0 datasets")).toBeInTheDocument();
    expect(screen.getByText("No datasets loaded or stored in this browser.")).toBeInTheDocument();
    await waitFor(() => expect(clearPersistedDatasetSessionMock).toHaveBeenCalled());
  });

  it("shows a non-blocking warning when browser dataset storage fails", async () => {
    loadPersistedDatasetSessionMock.mockRejectedValueOnce(new Error("Blocked"));

    render(<App />);

    expect(
      await screen.findByText("Datasets could not be restored from browser storage. Current session data will still work."),
    ).toBeInTheDocument();
  });
```

- [ ] **Step 3: Run App tests to verify they fail**

Run:

```bash
pnpm test -- src/components/AppShell.test.tsx
```

Expected: FAIL because `App` does not hydrate, persist, pass `onFlushDatasets`, or show storage warnings.

- [ ] **Step 4: Implement App storage integration**

Modify the imports in `src/App.tsx`:

```ts
import { useEffect, useReducer, useState } from "react";
import { createDatasetSessionSnapshot } from "./domain/datasetPersistence";
import {
  clearPersistedDatasetSession,
  loadPersistedDatasetSession,
  savePersistedDatasetSession,
} from "./utils/browserDatasetStorage";
```

Add state inside `App` after existing `useState` calls:

```ts
  const [datasetStorageReady, setDatasetStorageReady] = useState(false);
  const [datasetStorageWarning, setDatasetStorageWarning] = useState<string | null>(null);
```

Add this hydration effect inside `App` before handler functions:

```ts
  useEffect(() => {
    let active = true;

    loadPersistedDatasetSession()
      .then((snapshot) => {
        if (!active) {
          return;
        }

        if (snapshot) {
          dispatch({ type: "session/hydratePersistentDatasets", snapshot });
        }
      })
      .catch(() => {
        if (active) {
          setDatasetStorageWarning(
            "Datasets could not be restored from browser storage. Current session data will still work.",
          );
        }
      })
      .finally(() => {
        if (active) {
          setDatasetStorageReady(true);
        }
      });

    return () => {
      active = false;
    };
  }, []);
```

Add this persistence effect after the hydration effect:

```ts
  useEffect(() => {
    if (!datasetStorageReady) {
      return;
    }

    const persist = Object.keys(state.datasets).length > 0
      ? savePersistedDatasetSession(createDatasetSessionSnapshot(state))
      : clearPersistedDatasetSession();

    persist.catch(() => {
      setDatasetStorageWarning(
        "Dataset changes could not be stored in this browser. Current session data will still work.",
      );
    });
  }, [
    datasetStorageReady,
    state.datasets,
    state.reportOutputs,
    state.reportRunSnapshots,
    state.selectedReportId,
    state.selectedReportIds,
    state.warnings,
  ]);
```

Add this handler near `importUploadedReport`:

```ts
  function flushStoredDatasets() {
    dispatch({ type: "datasets/flush" });
    setRunQueue([]);
  }
```

Render the storage warning after `<RunStatus queue={runQueue} />`:

```tsx
      {datasetStorageWarning && (
        <div className="s-notice s-notice__warning mt16" role="status">
          {datasetStorageWarning}
        </div>
      )}
```

Update the `DatasetsPanel` render:

```tsx
        <DatasetsPanel
          datasets={datasets}
          onRemoveDataset={(datasetId) => dispatch({ type: "dataset/remove", datasetId })}
          onFlushDatasets={flushStoredDatasets}
        />
```

- [ ] **Step 5: Run App tests to verify they pass**

Run:

```bash
pnpm test -- src/components/AppShell.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit Task 4**

```bash
git add src/App.tsx src/components/AppShell.test.tsx
git commit -m "feat: persist datasets in browser storage"
```

---

### Task 5: Product Copy, Full Verification, And Final Checks

**Files:**
- Modify: `README.md`
- Modify: `PRODUCT.md`
- Modify: `src/components/ReportWorkspace.tsx`
- Modify: `src/components/ReportWorkspace.test.tsx`

- [ ] **Step 1: Update README persistence copy**

In `README.md`, replace:

```md
Uploaded report outputs are parsed locally in the browser session and rendered as dashboards plus raw tables. Credentials and generated report data are session-only; the app does not persist credentials or report data in browser storage.
```

with:

```md
Uploaded report outputs are parsed locally in the browser and rendered as dashboards plus raw tables. Credentials are session-only and are not persisted in browser storage. Loaded datasets are stored locally in this browser by default so report runs and uploads can survive refreshes, tab closes, and browser restarts until the user removes individual datasets or flushes all stored datasets from the Datasets panel.
```

Replace:

```md
Credentials and generated report data are session-only; the app does not persist them in browser storage.
```

with:

```md
Credentials are session-only; the app does not persist access tokens, API keys, PATs, OAuth client IDs, or OAuth state in browser storage.

Loaded report datasets are stored locally in this browser by default. Use the Datasets panel to remove individual datasets or flush all stored datasets.
```

- [ ] **Step 2: Update PRODUCT data-handling copy**

In `PRODUCT.md`, replace:

```md
Stack Overflow for Teams and Stack Enterprise administrators, community managers, enablement leads, and technical operators who need to run reporting utilities without persisting credentials or report data. They use the app during focused operational workflows: preparing reports, checking user health, importing generated exports, and running scoped live API collections.
```

with:

```md
Stack Overflow for Teams and Stack Enterprise administrators, community managers, enablement leads, and technical operators who need to run reporting utilities without persisting credentials while keeping report datasets locally available in their browser. They use the app during focused operational workflows: preparing reports, checking user health, importing generated exports, and running scoped live API collections.
```

Replace this design principle:

```md
- Treat credentials and report data as sensitive session state, and make that constraint visible.
```

with:

```md
- Treat credentials as sensitive session state, treat datasets as browser-local sensitive data, and make both constraints visible.
```

- [ ] **Step 3: Update Report Workspace readiness copy**

In `src/components/ReportWorkspace.tsx`, replace:

```tsx
          Ready for session credentials. Live API runs collect mapped datasets; uploads
          render full script outputs.
```

with:

```tsx
          Ready for session credentials. Live API runs collect mapped datasets; uploads
          render full script outputs. Loaded datasets stay in this browser until removed.
```

- [ ] **Step 4: Update Report Workspace readiness copy test**

In `src/components/ReportWorkspace.test.tsx`, replace:

```ts
        "Ready for session credentials. Live API runs collect mapped datasets; uploads render full script outputs.",
```

with:

```ts
        "Ready for session credentials. Live API runs collect mapped datasets; uploads render full script outputs. Loaded datasets stay in this browser until removed.",
```

- [ ] **Step 5: Check for stale persistence copy**

Run:

```bash
rg -n "generated report data|does not persist credentials or report data|datasets.*session|No datasets loaded in this browser session" README.md PRODUCT.md src
```

Expected: no matches.

- [ ] **Step 6: Run focused tests**

Run:

```bash
pnpm test -- src/domain/datasetPersistence.test.ts src/domain/sessionStore.test.ts src/utils/browserDatasetStorage.test.ts src/components/DatasetsPanel.test.tsx src/components/AppShell.test.tsx src/components/ReportWorkspace.test.tsx
```

Expected: PASS.

- [ ] **Step 7: Run lint/typecheck**

Run:

```bash
pnpm lint
```

Expected: PASS.

- [ ] **Step 8: Run the full test suite**

Run:

```bash
pnpm test
```

Expected: PASS.

- [ ] **Step 9: Commit Task 5**

```bash
git add README.md PRODUCT.md src/components/ReportWorkspace.tsx src/components/ReportWorkspace.test.tsx
git commit -m "docs: clarify browser-local dataset storage"
```
