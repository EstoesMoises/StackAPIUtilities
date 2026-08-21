# Exhaustive Date-Scoped Collection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove collection-depth choices and make every successful Script or SME Coverage run exhaust all available API pages for its effective date scope.

**Architecture:** Keep dates as the only report scope supplied by the browser. The server owns a page size of 100, collectors omit normal page limits, and API clients enforce only a non-user-configurable runaway-pagination guard that throws instead of returning partial success. Persist only successful runs, migrate pre-change browser data as legacy-unverified, and communicate completion and scope in the result UI.

**Tech Stack:** Next.js 14, React 18, TypeScript, Vitest, Testing Library, Playwright, IndexedDB-backed browser persistence

---

## File Structure

- Create `src/api/paginationSafety.ts` to own the internal runaway-pagination error and guard.
- Modify `src/api/stackApiV2.ts` and `src/api/stackApiV3.ts` to exhaust normal pagination and abort malformed endless pagination.
- Modify `src/domain/types.ts` and `src/domain/reportScope.ts` so report scope contains dates only and new snapshots contain no preset/cap configuration.
- Modify `src/collectors/liveCollectors.ts` and `src/collectors/liveReportRunner.ts` so the server-owned page size is used and pagination evidence travels with every collected dataset.
- Modify `src/server/reportRunApi.ts` and `src/server/smeCoverageRunApi.ts` so obsolete volume fields are rejected instead of accepted or normalized.
- Modify `src/components/ReportScopePanel.tsx`, `src/components/ReportWorkspace.tsx`, `src/components/SmeCoverageWorkspace.tsx`, and `src/components/SmeCoverageDecisionPack.tsx` to remove depth controls and show scope/completion.
- Modify `src/App.tsx` and `src/domain/sessionStore.ts` to send date-only requests and commit results only after complete responses.
- Modify `src/utilities/smeCoverage/{runner,analyzer,model,decisionPack,exports,persistence}.ts` to remove configured-sampling semantics while preserving evidence-quality warnings and legacy packs.
- Modify `src/domain/datasetPersistence.ts` to write version 3 and mark versions 1–2 as legacy-unverified.
- Delete `src/components/ApiVolumeSettings.tsx`, `src/components/ApiVolumeSettings.test.tsx`, `src/domain/reportRunPresets.ts`, `src/domain/reportRunPresets.test.ts`, `src/utilities/smeCoverage/settings.ts`, and `src/utilities/smeCoverage/settings.test.ts` after all consumers migrate.
- Update affected unit, integration, and Playwright tests plus `README.md`.

### Task 1: Add a fail-closed pagination safety guard

**Files:**
- Create: `src/api/paginationSafety.ts`
- Create: `src/api/paginationSafety.test.ts`
- Modify: `src/api/stackApiV2.ts`
- Modify: `src/api/stackApiV2.test.ts`
- Modify: `src/api/stackApiV3.ts`
- Modify: `src/api/stackApiV3.test.ts`

- [ ] **Step 1: Write the failing guard tests**

Create `src/api/paginationSafety.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { PaginationSafetyError, assertSafePaginationPage } from "./paginationSafety";

describe("assertSafePaginationPage", () => {
  it("allows pages through the internal safety limit", () => {
    expect(() => assertSafePaginationPage("Stack API v2.3", "/users", 3, 3)).not.toThrow();
  });

  it("fails instead of returning a partial result past the safety limit", () => {
    expect(() => assertSafePaginationPage("Stack API v3", "/tags", 4, 3)).toThrow(
      new PaginationSafetyError(
        "Stack API v3 pagination for /tags exceeded the internal safety limit of 3 pages. No complete result was produced.",
      ),
    );
  });
});
```

Add one client test per API using `paginationSafetyLimit: 2`, a response that always claims another page, and this assertion:

```ts
await expect(client.getPagedItems("/users")).rejects.toThrow(
  "exceeded the internal safety limit of 2 pages. No complete result was produced.",
);
expect(fetchMock).toHaveBeenCalledTimes(2);
```

- [ ] **Step 2: Run the focused tests and verify failure**

Run:

```bash
pnpm vitest run src/api/paginationSafety.test.ts src/api/stackApiV2.test.ts src/api/stackApiV3.test.ts
```

Expected: FAIL because `paginationSafety.ts` and `paginationSafetyLimit` do not exist.

- [ ] **Step 3: Implement the internal guard**

Create `src/api/paginationSafety.ts`:

```ts
export const DEFAULT_PAGINATION_SAFETY_LIMIT = 10_000;

export class PaginationSafetyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PaginationSafetyError";
  }
}

export function assertSafePaginationPage(
  apiName: string,
  path: string,
  page: number,
  limit: number,
): void {
  if (page <= limit) return;

  throw new PaginationSafetyError(
    `${apiName} pagination for ${path} exceeded the internal safety limit of ${limit.toLocaleString("en-US")} pages. No complete result was produced.`,
  );
}
```

Add `paginationSafetyLimit?: number` to each client constructor option, default it to `DEFAULT_PAGINATION_SAFETY_LIMIT`, and call the guard immediately before every paged fetch:

```ts
assertSafePaginationPage("Stack API v2.3", path, page, this.paginationSafetyLimit);
```

```ts
assertSafePaginationPage("Stack API v3", path, page, this.paginationSafetyLimit);
```

Keep the existing optional `maxPages` client API temporarily for compatibility; normal runners will stop using it in Task 2.

- [ ] **Step 4: Run the focused tests and verify success**

Run the command from Step 2.

Expected: PASS, including existing backoff, retry, and exhaustive-pagination tests.

- [ ] **Step 5: Commit**

```bash
git add src/api/paginationSafety.ts src/api/paginationSafety.test.ts src/api/stackApiV2.ts src/api/stackApiV2.test.ts src/api/stackApiV3.ts src/api/stackApiV3.test.ts
git commit -m "feat: fail closed on runaway pagination"
```

### Task 2: Make Scripts use a date-only exhaustive collection contract

**Files:**
- Modify: `src/domain/types.ts`
- Modify: `src/domain/reportScope.ts`
- Modify: `src/domain/reportScope.test.ts`
- Modify: `src/collectors/liveCollectors.ts`
- Modify: `src/collectors/liveCollectors.test.ts`
- Modify: `src/collectors/liveReportRunner.ts`
- Modify: `src/collectors/liveReportRunner.test.ts`
- Modify: `src/server/reportRunApi.ts`
- Modify: `src/server/reportRunApi.test.ts`

- [ ] **Step 1: Write failing domain and server contract tests**

Replace preset/cap assertions in `src/domain/reportScope.test.ts` with:

```ts
it("defaults to all available history with no collection-depth configuration", () => {
  expect(DEFAULT_REPORT_RUN_SCOPE).toEqual({ current: {} });
});

it("validates only current and comparison date periods", () => {
  expect(validateReportRunScope({ current: { startDate: "2026-02-01", endDate: "2026-01-01" } })).toEqual({
    valid: false,
    messages: ["Current period end date must be on or after its start date."],
  });
});
```

In `src/server/reportRunApi.test.ts`, make the successful dependency assertion date-only:

```ts
expect(runLiveReport).toHaveBeenCalledWith("inactive-users", credentials, {
  periodRole: "current",
  scope: { startDate: "2026-01-01", endDate: "2026-01-31" },
});
```

Add a rejection test for every obsolete key:

```ts
it.each(["pageSize", "maxPagesPerDataset", "runPreset"])(
  "rejects obsolete %s configuration",
  async (key) => {
    const runLiveReport = vi.fn();
    const response = await handleReportRunRequest(
      { reportId: "inactive-users", credentials, [key]: key === "runPreset" ? "deep-audit" : 100 },
      { runLiveReport },
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: "Report runs accept credentials, a period role, and a date scope only.",
    });
    expect(runLiveReport).not.toHaveBeenCalled();
  },
);
```

- [ ] **Step 2: Write failing exhaustive runner tests**

Replace cap-warning tests in `src/collectors/liveReportRunner.test.ts` with a two-page fixture:

```ts
it("collects every available page with the server-owned page size", async () => {
  const fetchMock = vi.fn((input: RequestInfo | URL) => {
    const page = new URL(input.toString()).searchParams.get("page");
    return Promise.resolve(new Response(JSON.stringify({
      items: [{ user_id: page === "1" ? 1 : 2 }],
      has_more: page === "1",
    }), { status: 200 }));
  });

  const result = await runLiveReport("inactive-users", basicCredentials, {
    periodRole: "current",
    scope: { startDate: "2026-01-01", endDate: "2026-01-31" },
    fetchFn: fetchMock,
  });

  expect(result.datasets[0]).toEqual({
    datasetName: "users",
    records: [{ user_id: 1 }, { user_id: 2 }],
    pagination: { pageCount: 2, reachedMaxPages: false, hasMore: false },
  });
  expect(result.warnings).toEqual([]);
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(fetchMock.mock.calls[0][0].toString()).toContain("pagesize=100");
});
```

Add an atomic failure test where page two returns 500 and assert `runLiveReport(...)` rejects with `Failed to collect users. No complete result was produced. Stack API v2.3 request failed with 500` and returns no result object.

- [ ] **Step 3: Run focused tests and verify failure**

```bash
pnpm vitest run src/domain/reportScope.test.ts src/collectors/liveCollectors.test.ts src/collectors/liveReportRunner.test.ts src/server/reportRunApi.test.ts
```

Expected: FAIL because scope, runner results, and request parsing still contain volume configuration.

- [ ] **Step 4: Simplify the report domain contract**

In `src/domain/types.ts`, replace the report scope and snapshot types with:

```ts
export interface ReportRunScope {
  current: PeriodScope;
  comparison?: PeriodScope;
}

export interface ReportRunSnapshot {
  id: string;
  reportId: ReportId;
  periodRole: RunPeriodRole;
  scope: PeriodScope;
  loadedAt: string;
  datasetIds: string[];
  warnings: ReportWarning[];
}
```

Retain `ApiVolumeSettingsValue`, `ReportRunPresetId`, and the old utility snapshot fields until the SME migration in Task 5.

In `src/domain/reportScope.ts`, set:

```ts
export const DEFAULT_REPORT_RUN_SCOPE: ReportRunScope = { current: {} };

export function validateReportRunScope(scope: ReportRunScope): ValidationResult {
  const messages: string[] = [];
  validatePeriod("Current period", scope.current, messages);
  if (scope.comparison) validatePeriod("Comparison period", scope.comparison, messages);
  return { valid: messages.length === 0, messages };
}
```

Remove `validateApiVolumeSettings` only after Task 5 migrates its remaining SME callers.

- [ ] **Step 5: Make collectors exhaustive and attach pagination evidence**

In `src/collectors/liveCollectors.ts`, replace volume context with:

```ts
export const INTERNAL_API_PAGE_SIZE = 100;

export interface LiveCollectorContext {
  collectedDatasets?: Partial<Record<DatasetName, Record<string, unknown>[]>>;
  periodRole?: RunPeriodRole;
  scope?: PeriodScope;
}
```

Always call:

```ts
const result = await client.getPagedResult(path, query);
```

and build the query using `String(INTERNAL_API_PAGE_SIZE)`. Do not pass `maxPages`.

In `src/collectors/liveReportRunner.ts`, use:

```ts
export interface LiveReportDataset {
  datasetName: DatasetName;
  records: Record<string, unknown>[];
  pagination: DatasetPaginationMetadata;
}

export interface LiveReportRunResult {
  reportId: ReportId;
  reportTitle: string;
  periodRole: RunPeriodRole;
  scope: PeriodScope;
  datasets: LiveReportDataset[];
  messages: string[];
  warnings: ReportWarning[];
}

export interface LiveReportRunOptions {
  fetchFn?: FetchLike;
  onThrottle?: (notice: ThrottleNotice) => void | Promise<void>;
  periodRole?: RunPeriodRole;
  scope?: PeriodScope;
}
```

Push `{ datasetName, records, pagination: collection.pagination }`, remove cap-warning creation and preset normalization, and leave `warnings` empty unless a non-cap warning is produced.

Wrap each dataset collection failure in a `LiveReportCollectionError` so the runner fails atomically with:

```ts
export class LiveReportCollectionError extends Error {
  constructor(datasetName: DatasetName, cause: unknown) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    super(`Failed to collect ${datasetName}. No complete result was produced. ${detail}`);
    this.name = "LiveReportCollectionError";
    (this as Error & { cause?: unknown }).cause = cause;
  }
}
```

Give synthetic interaction datasets terminal evidence rather than leaving the new field unset:

```ts
pagination: { pageCount: 0, reachedMaxPages: false, hasMore: false },
```

- [ ] **Step 6: Enforce the date-only server payload**

In `src/server/reportRunApi.ts`, allow exactly `reportId`, `credentials`, `periodRole`, and `scope`. Validate with:

```ts
const validation = validateReportRunScope({ current: scope });
```

Call the dependency with:

```ts
await run(payload.reportId, payload.credentials, { periodRole, scope });
```

Return the explicit obsolete-shape error from Step 1 when any other own key is present.

- [ ] **Step 7: Run focused tests and verify success**

Run the command from Step 3.

Expected: PASS with two-page collection, date validation, and obsolete-field rejection.

- [ ] **Step 8: Commit**

```bash
git add src/domain/types.ts src/domain/reportScope.ts src/domain/reportScope.test.ts src/collectors/liveCollectors.ts src/collectors/liveCollectors.test.ts src/collectors/liveReportRunner.ts src/collectors/liveReportRunner.test.ts src/server/reportRunApi.ts src/server/reportRunApi.test.ts
git commit -m "feat: make report collection exhaustive"
```

### Task 3: Remove report depth controls and communicate completion

**Files:**
- Modify: `src/components/ReportScopePanel.tsx`
- Modify: `src/components/ReportScopePanel.test.tsx`
- Modify: `src/components/ReportWorkspace.tsx`
- Modify: `src/components/ReportWorkspace.test.tsx`
- Modify: `src/App.tsx`
- Modify: `src/components/AppShell.test.tsx`
- Modify: `src/domain/sessionStore.ts`
- Modify: `src/domain/sessionStore.test.ts`

- [ ] **Step 1: Write failing report UI tests**

Replace volume-control tests in `src/components/ReportScopePanel.test.tsx` with:

```ts
it("offers dates and comparison only", () => {
  render(<ReportScopePanel reportId="tag-report" scope={DEFAULT_REPORT_RUN_SCOPE} onChange={vi.fn()} />);

  expect(screen.getByLabelText("Current start date")).toBeInTheDocument();
  expect(screen.getByLabelText("Current end date")).toBeInTheDocument();
  expect(screen.getByLabelText("Enable comparison period")).toBeInTheDocument();
  expect(screen.getByText(/collects all available data for the selected dates/i)).toBeInTheDocument();
  expect(screen.queryByRole("radio")).not.toBeInTheDocument();
  expect(screen.queryByText(/quick sample|standard report|deep audit|record coverage|page size|max pages/i)).not.toBeInTheDocument();
});
```

In `src/components/ReportWorkspace.test.tsx`, add:

```ts
it("states the completed live scope", () => {
  renderWorkspace({
    outputSource: "live-api",
    currentScope: { startDate: "2026-01-01", endDate: "2026-01-31" },
    records: [{ user_id: 1 }],
  });

  expect(screen.getByRole("status", { name: "Collection status" })).toHaveTextContent(
    "All available data collected · 2026-01-01 to 2026-01-31",
  );
});
```

Add an App request assertion that the JSON body contains no `pageSize`, `maxPagesPerDataset`, or `runPreset` keys.

- [ ] **Step 2: Run focused tests and verify failure**

```bash
pnpm vitest run src/components/ReportScopePanel.test.tsx src/components/ReportWorkspace.test.tsx src/components/AppShell.test.tsx src/domain/sessionStore.test.ts
```

Expected: FAIL because volume controls and request fields still render.

- [ ] **Step 3: Reduce `ReportScopePanel` to dates and comparison**

Remove all preset imports, number-field state, `ApiVolumeSettings`, and the `reportId` conditional. Keep the existing date inputs and comparison toggle. Add:

```tsx
<p className="scope-help">
  Each run collects all available data for the selected dates. Large instances can take longer while the API pages and rate limits are handled automatically.
</p>
```

Keep `reportId` in props only if callers/tests still require it; otherwise remove it from the component and `ReportWorkspace` call together.

- [ ] **Step 4: Send and store only exhaustive report data**

In `src/App.tsx`, make the request body:

```ts
body: JSON.stringify({
  reportId: state.selectedReportId,
  credentials: state.credentials,
  periodRole,
  scope: periodScope,
}),
```

Dispatch only `reportId`, `periodRole`, `scope`, `warnings`, and `datasets`. Restore saved scope by snapshot role regardless of whether a legacy preset exists.

Change the running queue message to:

```ts
message: `Collecting all available data for ${report.title}…`,
```

Make every caught run error end with `No complete result was produced.` if the server error does not already contain that sentence.

In `src/domain/sessionStore.ts`, add `pagination: DatasetPaginationMetadata` to `LiveDatasetPayload`, remove volume fields from `live/loaded` and `ReportRunSnapshot`, and copy each dataset's pagination evidence into `SessionDataset`:

```ts
pageCount: dataset.pagination.pageCount,
reachedMaxPages: dataset.pagination.reachedMaxPages,
hasMore: dataset.pagination.hasMore,
```

- [ ] **Step 5: Render report completion and scope**

In `src/components/ReportWorkspace.tsx`, render only for `outputSource === "live-api"`:

```tsx
<div className="collection-status" role="status" aria-label="Collection status">
  <strong>All available data collected</strong>
  <span> · {formatPeriodLabel(currentScope ?? {})}</span>
  {comparisonScope && <span> · Compared with {formatPeriodLabel(comparisonScope)}</span>}
</div>
```

Task 4 will replace this message with the legacy label when the migrated warning is present.

- [ ] **Step 6: Run focused tests and verify success**

Run the command from Step 2.

Expected: PASS; the rendered report surface contains no collection-depth controls.

- [ ] **Step 7: Commit**

```bash
git add src/components/ReportScopePanel.tsx src/components/ReportScopePanel.test.tsx src/components/ReportWorkspace.tsx src/components/ReportWorkspace.test.tsx src/App.tsx src/components/AppShell.test.tsx src/domain/sessionStore.ts src/domain/sessionStore.test.ts
git commit -m "feat: reduce report scope to dates"
```

### Task 4: Version persistence and label legacy report runs honestly

**Files:**
- Modify: `src/domain/datasetPersistence.ts`
- Modify: `src/domain/datasetPersistence.test.ts`
- Modify: `src/components/ReportWorkspace.tsx`
- Modify: `src/components/ReportWorkspace.test.tsx`

- [ ] **Step 1: Write failing persistence migration tests**

Add these exported constants to the test expectation:

```ts
export const LEGACY_COLLECTION_WARNING = {
  code: "collection.legacy-unverified",
  message: "Legacy run — completeness not verified under current collection rules.",
} as const;
```

Add a test that feeds an otherwise valid version-2 snapshot containing `pageSize: 100`, `maxPagesPerDataset: 5`, and `runPreset: "standard"`. Assert the parsed snapshot:

```ts
expect(parsed?.version).toBe(3);
expect(parsed?.reportRunSnapshots[0]).not.toHaveProperty("pageSize");
expect(parsed?.reportRunSnapshots[0]).not.toHaveProperty("maxPagesPerDataset");
expect(parsed?.reportRunSnapshots[0]).not.toHaveProperty("runPreset");
expect(parsed?.reportOutputs["tag-report"]?.warnings).toContainEqual({
  reportId: "tag-report",
  ...LEGACY_COLLECTION_WARNING,
});
```

Add a version-3 round-trip test asserting no legacy warning is injected.

- [ ] **Step 2: Run focused tests and verify failure**

```bash
pnpm vitest run src/domain/datasetPersistence.test.ts src/components/ReportWorkspace.test.tsx
```

Expected: FAIL because persistence version 2 is still current and no migration warning exists.

- [ ] **Step 3: Implement version-3 parsing and migration**

In `src/domain/datasetPersistence.ts`:

```ts
export const DATASET_SESSION_PERSISTENCE_VERSION = 3;

export const LEGACY_COLLECTION_WARNING: Readonly<ReportWarning> = Object.freeze({
  code: "collection.legacy-unverified",
  message: "Legacy run — completeness not verified under current collection rules.",
});
```

Accept versions 1, 2, and 3. For versions 1–2, parse the old numeric/preset fields for validation but discard them from normalized snapshots. Inject a report-scoped copy of `LEGACY_COLLECTION_WARNING` into every hydrated live report output and its datasets. Preserve original cap warnings and deduplicate by `code + message + owner`.

For version 3, require the new snapshot shape and inject nothing. `createDatasetSessionSnapshot` always writes version 3.

- [ ] **Step 4: Make completion copy legacy-aware**

In `ReportWorkspace`, derive:

```ts
const legacyCollection = warnings?.some(
  (warning) => warning.code === "collection.legacy-unverified",
) ?? false;
```

Render the exact legacy message instead of `All available data collected` when true.

- [ ] **Step 5: Run focused tests and verify success**

Run the command from Step 2.

Expected: PASS for v1/v2 migration, v3 round-trip, legacy UI, and original-warning preservation.

- [ ] **Step 6: Commit**

```bash
git add src/domain/datasetPersistence.ts src/domain/datasetPersistence.test.ts src/components/ReportWorkspace.tsx src/components/ReportWorkspace.test.tsx
git commit -m "feat: mark stored capped reports as legacy"
```

### Task 5: Make SME Coverage exhaustive and remove sampling configuration

**Files:**
- Modify: `src/server/smeCoverageRunApi.ts`
- Modify: `src/server/smeCoverageRunApi.test.ts`
- Modify: `src/utilities/smeCoverage/runner.ts`
- Modify: `src/utilities/smeCoverage/runner.test.ts`
- Modify: `src/utilities/smeCoverage/analyzer.ts`
- Modify: `src/utilities/smeCoverage/analyzer.test.ts`
- Modify: `src/utilities/smeCoverage/model.ts`
- Modify: `src/utilities/smeCoverage/decisionPack.ts`
- Modify: `src/utilities/smeCoverage/decisionPack.test.ts`

- [ ] **Step 1: Write failing credentials-only API tests**

In `src/server/smeCoverageRunApi.test.ts`, assert the runner dependency receives credentials only:

```ts
expect(runSmeCoverageAnalysis).toHaveBeenCalledWith(expect.objectContaining({
  baseUrl: credentials.baseUrl,
}));
```

Reject obsolete fields:

```ts
it.each(["pageSize", "maxPagesPerDataset", "runPreset"])(
  "rejects obsolete %s configuration",
  async (key) => {
    const response = await handleSmeCoverageRunRequest({
      credentials,
      [key]: key === "runPreset" ? "deep-audit" : 100,
    });
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      kind: "validation",
      error: "SME Coverage Analyzer accepts credentials only; its scope is all available history.",
    });
  },
);
```

- [ ] **Step 2: Write failing exhaustive runner and analysis tests**

In `runner.test.ts`, use two pages for each source and assert every `pagination` value ends with `reachedMaxPages: false` and `hasMore: false`. Assert the result has no `pageSize`, `maxPagesPerDataset`, or `runPreset`.

In `analyzer.test.ts`, call `analyzeSmeCoverage({ demand, smeCounts, sourceStatus })` and assert the result has no `sampling` property.

In `decisionPack.test.ts`, assert the new snapshot:

```ts
expect(pack.snapshot).toMatchObject({
  scopeLabel: "All-time demand · Current SME coverage",
  collectionLabel: "All available data collected",
});
expect(pack.snapshot).not.toHaveProperty("pageSize");
expect(pack.snapshot).not.toHaveProperty("maxPagesPerDataset");
expect(pack.snapshot).not.toHaveProperty("runPreset");
```

- [ ] **Step 3: Run focused tests and verify failure**

```bash
pnpm vitest run src/server/smeCoverageRunApi.test.ts src/utilities/smeCoverage/runner.test.ts src/utilities/smeCoverage/analyzer.test.ts src/utilities/smeCoverage/decisionPack.test.ts
```

Expected: FAIL because settings and partial-sample metadata remain.

- [ ] **Step 4: Simplify the SME request and runner**

Make `SmeCoverageRunRequestPayload` contain only `credentials`. Make its dependency signature:

```ts
runSmeCoverageAnalysis?: (credentials: SessionCredentials) => Promise<SmeCoverageRunResult>;
```

In `runner.ts`, remove `settings` from options, validation, normalization, collection calls, result fields, and snapshots. Collect with:

```ts
return await collectDataset(datasetName, clients);
```

Remove `buildCapWarnings`; a safety or API failure throws before a decision pack exists. Keep source-data warnings produced by tag normalization and SME-count validation.

- [ ] **Step 5: Remove configured-sampling semantics from analysis and decision packs**

Remove `SmeCoverageSamplingMetadata`, `analysis.sampling`, and settings parameters. Define the snapshot as:

```ts
export interface SmeCoverageSnapshot {
  readonly instanceHost: string;
  readonly generatedAt: string;
  readonly scopeLabel: "All-time demand · Current SME coverage";
  readonly collectionLabel:
    | "All available data collected"
    | "Legacy run — completeness not verified under current collection rules";
  readonly completeness: SmeCoverageCompleteness;
}
```

Set `collectionLabel: "All available data collected"` in `buildSmeCoverageDecisionPack`. Remove canonical sampling warnings and preset/cap completeness checks. Determine completeness from the completed analysis only:

```ts
function determineCompleteness(analysis: SmeCoverageAnalysisResult): SmeCoverageCompleteness {
  if (analysis.evidence.length === 0) return "Empty";
  return analysis.evidence.some(
    (row) => row.demandQuality !== "Complete" || row.smeQuality !== "Complete",
  ) || !analysis.methodology.percentileSampleSufficient
    ? "Partial"
    : "Complete";
}
```

Here `Partial` describes evidence quality, not intentionally capped collection; the separate collection label remains complete.

- [ ] **Step 6: Run focused tests and verify success**

Run the command from Step 3.

Expected: PASS; the API accepts credentials only and all sources exhaust pagination.

- [ ] **Step 7: Commit**

```bash
git add src/server/smeCoverageRunApi.ts src/server/smeCoverageRunApi.test.ts src/utilities/smeCoverage/runner.ts src/utilities/smeCoverage/runner.test.ts src/utilities/smeCoverage/analyzer.ts src/utilities/smeCoverage/analyzer.test.ts src/utilities/smeCoverage/model.ts src/utilities/smeCoverage/decisionPack.ts src/utilities/smeCoverage/decisionPack.test.ts
git commit -m "feat: make SME coverage collection exhaustive"
```

### Task 6: Remove SME volume UI and update outputs

**Files:**
- Modify: `src/components/SmeCoverageWorkspace.tsx`
- Modify: `src/components/SmeCoverageWorkspace.test.tsx`
- Modify: `src/components/SmeCoverageDecisionPack.tsx`
- Modify: `src/components/SmeCoverageDecisionPack.test.tsx`
- Modify: `src/utilities/smeCoverage/exports.ts`
- Modify: `src/utilities/smeCoverage/exports.test.ts`
- Modify: `src/App.tsx`
- Modify: `src/components/AppShell.test.tsx`

- [ ] **Step 1: Write failing UI and export tests**

In `SmeCoverageWorkspace.test.tsx`, render without settings props and assert:

```ts
expect(screen.getByText(/collects all available evidence automatically/i)).toBeInTheDocument();
expect(screen.queryByRole("radio")).not.toBeInTheDocument();
expect(screen.queryByText(/quick sample|standard report|deep audit|page size|max pages/i)).not.toBeInTheDocument();
```

In `SmeCoverageDecisionPack.test.tsx`, assert the snapshot displays:

```ts
expect(screen.getByText("All available data collected")).toBeInTheDocument();
expect(screen.queryByText("Page size")).not.toBeInTheDocument();
expect(screen.queryByText("Max pages per dataset")).not.toBeInTheDocument();
```

In `exports.test.ts`, assert Markdown includes `- Collection: All available data collected` and excludes page-size, maximum-pages, and preset lines.

- [ ] **Step 2: Run focused tests and verify failure**

```bash
pnpm vitest run src/components/SmeCoverageWorkspace.test.tsx src/components/SmeCoverageDecisionPack.test.tsx src/utilities/smeCoverage/exports.test.ts src/components/AppShell.test.tsx
```

Expected: FAIL because settings still render and exports expose caps.

- [ ] **Step 3: Simplify the workspace and App request**

Remove `settings` and `onSettingsChange` from `SmeCoverageWorkspaceProps` and delete `ApiVolumeSettings` usage. Add:

```tsx
<p>
  The analyzer collects all available evidence automatically. Large instances can take longer while API pagination and rate limits are handled for you.
</p>
```

Remove `smeCoverageSettings` state from `App.tsx`. Send:

```ts
body: JSON.stringify({ credentials: state.credentials }),
```

- [ ] **Step 4: Replace technical settings with collection status**

In `SmeCoverageDecisionPack.tsx`, replace page-size/max-page rows with:

```tsx
<SnapshotItem label="Collection" value={pack.snapshot.collectionLabel} />
```

Label the existing badge as analysis quality so `Partial` cannot be mistaken for intentionally incomplete collection:

```tsx
<span className="sr-only">Analysis quality: </span>
{pack.snapshot.completeness}
```

Rename the visible warning heading from `Completeness warnings` to `Evidence notes`; collection completeness is communicated separately by `collectionLabel`.

In `exports.ts`, replace the three technical lines with:

```ts
`- Collection: ${pack.snapshot.collectionLabel}`,
```

- [ ] **Step 5: Run focused tests and verify success**

Run the command from Step 2.

Expected: PASS with credentials-only calls and no volume terminology.

- [ ] **Step 6: Commit**

```bash
git add src/components/SmeCoverageWorkspace.tsx src/components/SmeCoverageWorkspace.test.tsx src/components/SmeCoverageDecisionPack.tsx src/components/SmeCoverageDecisionPack.test.tsx src/utilities/smeCoverage/exports.ts src/utilities/smeCoverage/exports.test.ts src/App.tsx src/components/AppShell.test.tsx
git commit -m "feat: remove SME collection depth controls"
```

### Task 7: Migrate legacy utility data and delete obsolete preset code

**Files:**
- Modify: `src/utilities/smeCoverage/persistence.ts`
- Modify: `src/utilities/smeCoverage/persistence.test.ts`
- Modify: `src/domain/datasetPersistence.ts`
- Modify: `src/domain/datasetPersistence.test.ts`
- Modify: `src/domain/sessionStore.ts`
- Modify: `src/domain/sessionStore.test.ts`
- Modify: `src/domain/types.ts`
- Delete: `src/components/ApiVolumeSettings.tsx`
- Delete: `src/components/ApiVolumeSettings.test.tsx`
- Delete: `src/domain/reportRunPresets.ts`
- Delete: `src/domain/reportRunPresets.test.ts`
- Delete: `src/utilities/smeCoverage/settings.ts`
- Delete: `src/utilities/smeCoverage/settings.test.ts`

- [ ] **Step 1: Write failing legacy utility migration tests**

Feed `parseSmeCoverageDecisionPack` a valid old pack with `pageSize`, `maxPagesPerDataset`, and `runPreset`. Assert:

```ts
expect(parsed?.snapshot.collectionLabel).toBe(
  "Legacy run — completeness not verified under current collection rules",
);
expect(parsed?.warnings).toContainEqual({
  utilityId: "sme-coverage-analyzer",
  code: "collection.legacy-unverified",
  message: "Legacy run — completeness not verified under current collection rules.",
});
expect(parsed?.snapshot).not.toHaveProperty("pageSize");
expect(parsed?.snapshot).not.toHaveProperty("maxPagesPerDataset");
expect(parsed?.snapshot).not.toHaveProperty("runPreset");
```

Add a new-format pack round-trip test that retains `All available data collected` and receives no legacy warning.

- [ ] **Step 2: Run migration tests and verify failure**

```bash
pnpm vitest run src/utilities/smeCoverage/persistence.test.ts src/domain/datasetPersistence.test.ts src/domain/sessionStore.test.ts
```

Expected: FAIL because the parser still requires preset fields.

- [ ] **Step 3: Parse both utility snapshot formats**

In `src/utilities/smeCoverage/persistence.ts`, detect new format by a valid `collectionLabel`. When absent, require the historical numeric fields, normalize to the legacy label, retain original warnings, and inject the utility-scoped legacy warning once. Remove configured-partial-sample migration logic that depends on `DEFAULT_SME_COVERAGE_SETTINGS`; historical cap warnings remain untouched.

Update `datasetPersistence.ts` utility snapshot parsing so versions 1–2 accept and discard old settings, while version 3 reads the new `UtilityRunSnapshot` shape:

```ts
export interface UtilityRunSnapshot {
  id: string;
  utilityId: UtilityId;
  loadedAt: string;
  datasetIds: string[];
  warnings: ReportWarning[];
}
```

Update `sessionStore.ts` to create that shape only after a successful utility result.

- [ ] **Step 4: Remove obsolete shared types and files**

Delete `ReportRunPresetId`, `ApiVolumeSettingsValue`, preset functions, volume components, and SME settings after `rg` confirms no production import remains:

```bash
rg -n "ReportRunPreset|ApiVolumeSettings|DEFAULT_SME_COVERAGE_SETTINGS|pageSize|maxPagesPerDataset|runPreset|Quick sample|Standard report|Deep audit" src -g '!*.test.*'
```

Expected before deletion: only legacy parser string keys and API client paging internals. Expected after deletion: no product-model or UI references.

- [ ] **Step 5: Run migration and type checks**

```bash
pnpm vitest run src/utilities/smeCoverage/persistence.test.ts src/domain/datasetPersistence.test.ts src/domain/sessionStore.test.ts
pnpm lint
```

Expected: PASS and zero TypeScript errors.

- [ ] **Step 6: Commit**

```bash
git add -A src/components/ApiVolumeSettings.tsx src/components/ApiVolumeSettings.test.tsx src/domain/reportRunPresets.ts src/domain/reportRunPresets.test.ts src/utilities/smeCoverage/settings.ts src/utilities/smeCoverage/settings.test.ts src/utilities/smeCoverage/persistence.ts src/utilities/smeCoverage/persistence.test.ts src/domain/datasetPersistence.ts src/domain/datasetPersistence.test.ts src/domain/sessionStore.ts src/domain/sessionStore.test.ts src/domain/types.ts
git commit -m "refactor: remove collection preset model"
```

### Task 8: Update end-to-end behavior, documentation, and verify the feature

**Files:**
- Modify: `e2e/reporting-mvp.spec.ts`
- Modify: `e2e/sme-coverage-analyzer.spec.ts`
- Modify: `README.md`
- Modify: affected fixtures under `src/test/fixtures/`

- [ ] **Step 1: Replace preset-oriented end-to-end assertions**

In `e2e/reporting-mvp.spec.ts`, remove radio interaction and assert:

```ts
await expect(page.getByLabel("Current start date")).toBeVisible();
await expect(page.getByLabel("Current end date")).toBeVisible();
await expect(page.getByRole("radio")).toHaveCount(0);
await expect(page.getByText(/collects all available data for the selected dates/i)).toBeVisible();
```

Fulfill the report API route with at least two pages and assert both page records appear plus:

```ts
await expect(page.getByRole("status", { name: "Collection status" })).toContainText(
  "All available data collected",
);
```

In `e2e/sme-coverage-analyzer.spec.ts`, remove `runPreset` fixture fields and Deep-audit assertions. Assert no radios, credentials-only request payload, and `Collection / All available data collected` in the decision pack.

- [ ] **Step 2: Update README product language**

Replace the preset paragraph with:

```md
Live Script runs collect every API page available for the selected date scope. The SME Coverage Analyzer does the same for its fixed all-time scope. Pagination, page size, rate-limit backoff, and retries are handled automatically. If collection cannot finish, the run fails and no partial result is published as complete.
```

Document that pre-change browser-saved outputs are labeled legacy-unverified.

- [ ] **Step 3: Run terminology and placeholder scans**

```bash
rg -n -i "quick sample|standard report|deep audit|advanced api volume|record coverage|max pages per dataset|run preset" src e2e README.md
rg -n "T[B]D|T[O]DO|F[I]XME|implement[ ]later|fill[ ]in" docs/superpowers/plans/2026-08-20-exhaustive-date-scoped-collection.md
```

Expected: the first command finds only intentional legacy-parser fixtures/tests; the second finds no matches.

- [ ] **Step 4: Run the complete verification suite**

```bash
pnpm test
pnpm lint
pnpm build
pnpm e2e
```

Expected: all unit tests pass, both TypeScript projects type-check, the Next.js production build succeeds, and all Playwright tests pass.

- [ ] **Step 5: Review the final diff against acceptance criteria**

```bash
git diff --check
git status --short
```

Confirm:

- date fields are the only report scope controls;
- normal runners never pass a maximum-page option;
- success requires terminal pagination for every dataset;
- failed runs dispatch no loaded action;
- current results state `All available data collected` and their scope;
- legacy results state `Legacy run — completeness not verified under current collection rules`;
- SME requests contain credentials only;
- no user-facing preset terminology remains.

- [ ] **Step 6: Commit**

```bash
git add e2e/reporting-mvp.spec.ts e2e/sme-coverage-analyzer.spec.ts README.md src/test/fixtures
git commit -m "test: verify exhaustive collection flows"
```
