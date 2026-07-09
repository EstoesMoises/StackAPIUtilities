# Tag Report Guided Output Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Tag Report easier and safer to run by adding guided volume presets with technical disclosure, honest run progress, capped-data warnings, curated Tag Health CSV output, and dashboard charts driven by the same tag-health transform.

**Architecture:** Add a small domain preset module that maps user intent to existing API volume settings, then keep the server contract explicit by sending resolved `pageSize`, `maxPagesPerDataset`, and `runPreset`. Extend API clients to expose pagination metadata so the runner can produce real capped-data warnings. Keep Tag Report business logic in `src/reports/tagReport.ts`; React components consume transformed rows for dashboard, table, and CSV downloads while raw datasets stay in the Datasets panel.

**Tech Stack:** Next.js App Router, React 18, TypeScript, Vitest, Testing Library, Stacks-style CSS, PapaParse CSV utilities.

---

## File Structure

- Create `src/domain/reportRunPresets.ts`: preset IDs, labels, API volume values, accessible technical disclosure, max-record calculations, and helpers.
- Create `src/domain/reportRunPresets.test.ts`: unit tests for preset defaults, disclosure copy, and max-record calculations.
- Modify `src/domain/types.ts`: add `ReportRunPresetId`, include optional `runPreset` metadata on request/run/session types, and add optional report-output warnings already supported by existing structures.
- Modify `src/domain/reportScope.ts`: set `DEFAULT_REPORT_RUN_SCOPE` from the Standard report preset and keep validation unchanged.
- Modify `src/components/ReportScopePanel.tsx`: render Tag Report preset controls with hover/focus/tap disclosure and collapsed advanced API settings; keep non-Tag reports on the current numeric controls.
- Modify `src/components/ReportScopePanel.test.tsx`: cover preset selection, disclosure text, advanced controls, and current non-Tag numeric controls.
- Modify `src/components/ReportWorkspace.tsx` and `src/components/ReportWorkspace.test.tsx`: pass `reportId` into scope controls and expose Tag Report output download controls.
- Modify `src/App.tsx`: send `runPreset` with live report requests, initialize progress state, and store warnings/results from Tag Report runs.
- Modify `src/components/RunStatus.tsx`: render a progress bar and step labels while a live run is active.
- Create `src/components/RunStatus.test.tsx`: component tests for progress, completed, failed, and warning states.
- Modify `src/api/stackApiV2.ts`, `src/api/stackApiV3.ts`, and their tests: add `getPagedResult()` while keeping `getPagedItems()` backwards compatible.
- Modify `src/collectors/liveCollectors.ts`: return records plus pagination metadata for each dataset collection.
- Modify `src/collectors/liveReportRunner.ts` and tests: accept `runPreset`, attach capped-data warnings, and preserve existing report results.
- Modify `src/server/reportRunApi.ts` and tests: accept and forward optional `runPreset`.
- Modify `src/importers/reportImporters.ts` and tests: preserve additional Tag Report fields needed by health rows.
- Modify `src/reports/tagReport.ts` and `src/reports/reportTransforms.test.ts`: build Tag Health rows, summary cards, warning metadata, and dashboard row groups.
- Create `src/utils/reportDownloads.ts` and `src/utils/reportDownloads.test.ts`: build/download curated report CSVs without changing raw dataset downloads.
- Modify `src/components/ReportDashboard.tsx` and tests: render Tag Report charts/lists from Tag Health rows and visible warnings.
- Modify `src/styles/app.css`: style preset controls, accessible disclosure, advanced settings, progress bar, warning banner, and report download controls.
- Update `e2e/reporting-mvp.spec.ts`: smoke-test the Tag Report preset disclosure, progress state, and curated CSV action.

---

### Task 1: Preset Domain Model And Tag Report Scope Controls

**Files:**
- Create: `src/domain/reportRunPresets.ts`
- Create: `src/domain/reportRunPresets.test.ts`
- Modify: `src/domain/types.ts`
- Modify: `src/domain/reportScope.ts`
- Modify: `src/components/ReportScopePanel.tsx`
- Modify: `src/components/ReportScopePanel.test.tsx`
- Modify: `src/components/ReportWorkspace.tsx`
- Modify: `src/components/ReportWorkspace.test.tsx`
- Modify: `src/styles/app.css`

- [ ] **Step 1: Write failing preset domain tests**

Create `src/domain/reportRunPresets.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  DEFAULT_REPORT_RUN_PRESET_ID,
  REPORT_RUN_PRESETS,
  applyReportRunPreset,
  getReportRunPreset,
  getReportRunPresetDisclosure,
  getReportRunPresetMaxRecords,
} from "./reportRunPresets";

describe("report run presets", () => {
  it("uses Standard report as the default preset", () => {
    expect(DEFAULT_REPORT_RUN_PRESET_ID).toBe("standard");
    expect(getReportRunPreset(DEFAULT_REPORT_RUN_PRESET_ID)).toEqual(
      expect.objectContaining({
        id: "standard",
        label: "Standard report",
        pageSize: 100,
        maxPagesPerDataset: 5,
      }),
    );
  });

  it("calculates the maximum requested records per dataset", () => {
    expect(getReportRunPresetMaxRecords("quick-sample")).toBe(50);
    expect(getReportRunPresetMaxRecords("standard")).toBe(500);
    expect(getReportRunPresetMaxRecords("deep-audit")).toBe(2000);
  });

  it("discloses technical settings in user-facing copy", () => {
    expect(getReportRunPresetDisclosure("deep-audit")).toBe(
      "Requests up to 2,000 records per dataset with pageSize 100 and maxPagesPerDataset 20. Slower, but reduces the chance of capped results.",
    );
  });

  it("applies preset volume settings to an existing report scope", () => {
    expect(
      applyReportRunPreset(
        {
          current: { startDate: "2026-01-01" },
          pageSize: 50,
          maxPagesPerDataset: 1,
          runPreset: "quick-sample",
        },
        "deep-audit",
      ),
    ).toEqual({
      current: { startDate: "2026-01-01" },
      pageSize: 100,
      maxPagesPerDataset: 20,
      runPreset: "deep-audit",
    });
  });

  it("keeps the expected preset ordering", () => {
    expect(REPORT_RUN_PRESETS.map((preset) => preset.id)).toEqual([
      "quick-sample",
      "standard",
      "deep-audit",
    ]);
  });
});
```

- [ ] **Step 2: Run preset tests to verify failure**

Run: `pnpm test -- src/domain/reportRunPresets.test.ts`

Expected: FAIL with a module-not-found error for `./reportRunPresets`.

- [ ] **Step 3: Add preset types**

Modify `src/domain/types.ts`:

```ts
export type ReportRunPresetId = "quick-sample" | "standard" | "deep-audit";

export interface ReportRunScope {
  current: PeriodScope;
  comparison?: PeriodScope;
  pageSize: number;
  maxPagesPerDataset: number;
  runPreset: ReportRunPresetId;
}

export interface ReportRunSnapshot {
  id: string;
  reportId: ReportId;
  periodRole: RunPeriodRole;
  scope: PeriodScope;
  pageSize: number;
  maxPagesPerDataset: number;
  runPreset?: ReportRunPresetId;
  loadedAt: string;
  datasetIds: string[];
  warnings: ReportWarning[];
}
```

Keep `runPreset` optional on snapshots because existing uploaded/session data has no preset.

- [ ] **Step 4: Implement preset helper**

Create `src/domain/reportRunPresets.ts`:

```ts
import type { ReportRunPresetId, ReportRunScope } from "./types";

interface ReportRunPreset {
  id: ReportRunPresetId;
  label: string;
  shortDescription: string;
  completenessTradeoff: string;
  pageSize: number;
  maxPagesPerDataset: number;
}

export const REPORT_RUN_PRESETS: readonly ReportRunPreset[] = [
  {
    id: "quick-sample",
    label: "Quick sample",
    shortDescription: "Fast preview to confirm credentials, scope, and data shape.",
    completenessTradeoff: "Fastest option; use only to preview data shape.",
    pageSize: 50,
    maxPagesPerDataset: 1,
  },
  {
    id: "standard",
    label: "Standard report",
    shortDescription: "Balanced default for normal Tag Report use.",
    completenessTradeoff: "Balanced default for normal reports.",
    pageSize: 100,
    maxPagesPerDataset: 5,
  },
  {
    id: "deep-audit",
    label: "Deep audit",
    shortDescription: "More complete extraction when longer runtime is acceptable.",
    completenessTradeoff: "Slower, but reduces the chance of capped results.",
    pageSize: 100,
    maxPagesPerDataset: 20,
  },
];

export const DEFAULT_REPORT_RUN_PRESET_ID: ReportRunPresetId = "standard";

export function getReportRunPreset(id: ReportRunPresetId): ReportRunPreset {
  return REPORT_RUN_PRESETS.find((preset) => preset.id === id) ?? REPORT_RUN_PRESETS[1];
}

export function getReportRunPresetMaxRecords(id: ReportRunPresetId): number {
  const preset = getReportRunPreset(id);
  return preset.pageSize * preset.maxPagesPerDataset;
}

export function getReportRunPresetDisclosure(id: ReportRunPresetId): string {
  const preset = getReportRunPreset(id);
  return `Requests up to ${getReportRunPresetMaxRecords(id).toLocaleString(
    "en-US",
  )} records per dataset with pageSize ${preset.pageSize} and maxPagesPerDataset ${preset.maxPagesPerDataset}. ${preset.completenessTradeoff}`;
}

export function applyReportRunPreset(
  scope: ReportRunScope,
  presetId: ReportRunPresetId,
): ReportRunScope {
  const preset = getReportRunPreset(presetId);

  return {
    ...scope,
    pageSize: preset.pageSize,
    maxPagesPerDataset: preset.maxPagesPerDataset,
    runPreset: preset.id,
  };
}
```

- [ ] **Step 5: Update default scope**

Modify `src/domain/reportScope.ts`:

```ts
import { DEFAULT_REPORT_RUN_PRESET_ID, getReportRunPreset } from "./reportRunPresets";
import type { PeriodScope, ReportRunScope } from "./types";

const defaultPreset = getReportRunPreset(DEFAULT_REPORT_RUN_PRESET_ID);

export const DEFAULT_REPORT_RUN_SCOPE: ReportRunScope = {
  current: {},
  pageSize: defaultPreset.pageSize,
  maxPagesPerDataset: defaultPreset.maxPagesPerDataset,
  runPreset: defaultPreset.id,
};
```

Keep `validateReportRunScope`, `dateToUnixSeconds`, and `formatPeriodLabel` behavior unchanged.

- [ ] **Step 6: Run domain tests to verify pass**

Run: `pnpm test -- src/domain/reportRunPresets.test.ts src/domain/reportScope.test.ts`

Expected: PASS.

- [ ] **Step 7: Write failing Tag Report preset UI tests**

Modify `src/components/ReportScopePanel.test.tsx`:

```tsx
it("shows Tag Report run presets with accessible technical details", async () => {
  const user = userEvent.setup();
  const onChange = vi.fn();

  render(<ReportScopePanel reportId="tag-report" scope={DEFAULT_REPORT_RUN_SCOPE} onChange={onChange} />);

  expect(screen.getByRole("group", { name: "Run depth" })).toBeInTheDocument();
  expect(screen.getByRole("radio", { name: /Standard report/ })).toBeChecked();
  expect(screen.getByText(/Requests up to 500 records per dataset/)).toBeInTheDocument();
  expect(screen.getByText(/pageSize 100 and maxPagesPerDataset 5/)).toBeInTheDocument();

  await user.click(screen.getByRole("radio", { name: /Deep audit/ }));

  expect(onChange).toHaveBeenCalledWith(expect.objectContaining({
    pageSize: 100,
    maxPagesPerDataset: 20,
    runPreset: "deep-audit",
  }));
});

it("keeps advanced API volume settings available for Tag Report", async () => {
  const user = userEvent.setup();
  const onChange = vi.fn();

  render(<ReportScopePanel reportId="tag-report" scope={DEFAULT_REPORT_RUN_SCOPE} onChange={onChange} />);

  await user.click(screen.getByRole("button", { name: "Advanced API volume settings" }));

  expect(screen.getByLabelText("Page size")).toHaveValue(100);
  expect(screen.getByLabelText("Max pages per dataset")).toHaveValue(5);

  await user.clear(screen.getByLabelText("Max pages per dataset"));
  await user.type(screen.getByLabelText("Max pages per dataset"), "8");

  expect(onChange).toHaveBeenCalledWith(expect.objectContaining({
    maxPagesPerDataset: 8,
    runPreset: "standard",
  }));
});

it("uses numeric volume controls for non-Tag reports", async () => {
  const user = userEvent.setup();
  const onChange = vi.fn();

  render(<ReportScopePanel reportId="inactive-users" scope={DEFAULT_REPORT_RUN_SCOPE} onChange={onChange} />);

  expect(screen.queryByRole("group", { name: "Run depth" })).not.toBeInTheDocument();
  await user.clear(screen.getByLabelText("Page size"));
  await user.type(screen.getByLabelText("Page size"), "50");

  expect(onChange).toHaveBeenCalled();
});
```

- [ ] **Step 8: Run component tests to verify failure**

Run: `pnpm test -- src/components/ReportScopePanel.test.tsx src/components/ReportWorkspace.test.tsx`

Expected: FAIL because `ReportScopePanel` does not accept `reportId` and does not render preset controls.

- [ ] **Step 9: Implement Tag Report preset UI**

Modify `src/components/ReportWorkspace.tsx`:

```tsx
<ReportScopePanel reportId={reportId} scope={scope} onChange={onScopeChange} />
```

Modify `src/components/ReportScopePanel.tsx`:

```tsx
import {
  REPORT_RUN_PRESETS,
  applyReportRunPreset,
  getReportRunPresetDisclosure,
} from "../domain/reportRunPresets";
import { validateReportRunScope } from "../domain/reportScope";
import type { ReportId, ReportRunPresetId, ReportRunScope } from "../domain/types";

interface ReportScopePanelProps {
  reportId: ReportId;
  scope: ReportRunScope;
  onChange: (scope: ReportRunScope) => void;
}
```

Use this helper in the component:

```tsx
function updatePreset(presetId: ReportRunPresetId) {
  onChange(applyReportRunPreset(scope, presetId));
}

function updateNumber(field: "pageSize" | "maxPagesPerDataset", value: string) {
  onChange({
    ...scope,
    [field]: Number.parseInt(value, 10),
  });
}
```

Render this Tag Report-specific control above the advanced controls:

```tsx
{reportId === "tag-report" && (
  <fieldset className="preset-group" aria-label="Run depth">
    <legend>Run depth</legend>
    <div className="preset-options">
      {REPORT_RUN_PRESETS.map((preset) => (
        <label className="preset-option" key={preset.id}>
          <input
            type="radio"
            name="tag-report-run-preset"
            checked={scope.runPreset === preset.id}
            onChange={() => updatePreset(preset.id)}
          />
          <span className="preset-option-main">
            <span className="preset-option-label">{preset.label}</span>
            <span className="preset-option-copy">{preset.shortDescription}</span>
            <span className="preset-option-disclosure">
              {getReportRunPresetDisclosure(preset.id)}
            </span>
          </span>
        </label>
      ))}
    </div>
  </fieldset>
)}
```

For Tag Report, wrap the existing numeric fields in:

```tsx
<details className="scope-advanced">
  <summary>Advanced API volume settings</summary>
  <p className="scope-help">
    These collection caps affect runtime and completeness. Increase them when avoiding capped results matters more than speed.
  </p>
  <div className="scope-grid">
    {/* existing Page size and Max pages per dataset labels */}
  </div>
</details>
```

For non-Tag reports, keep the existing `scope-grid` with numeric fields visible.

- [ ] **Step 10: Add minimal preset styles**

Append to `src/styles/app.css`:

```css
.preset-group {
  margin: 0 0 16px;
  padding: 0;
  border: 0;
}

.preset-group legend {
  margin-bottom: 8px;
  color: var(--so-ink);
  font-size: 13px;
  font-weight: 800;
}

.preset-options {
  display: grid;
  gap: 10px;
}

.preset-option {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 10px;
  align-items: start;
  padding: 12px;
  border: 1px solid var(--so-border);
  border-radius: 8px;
  background: var(--so-surface);
  cursor: pointer;
}

.preset-option:focus-within,
.preset-option:hover {
  border-color: var(--so-orange);
  background: var(--so-orange-soft);
}

.preset-option-main {
  display: grid;
  gap: 4px;
}

.preset-option-label {
  color: var(--so-ink);
  font-weight: 800;
}

.preset-option-copy,
.preset-option-disclosure,
.scope-help {
  color: var(--so-text-muted);
  font-size: 13px;
  line-height: 1.4;
}

.scope-advanced {
  margin-top: 12px;
}

.scope-advanced summary {
  cursor: pointer;
  color: var(--so-ink);
  font-weight: 800;
}
```

- [ ] **Step 11: Run component tests to verify pass**

Run: `pnpm test -- src/domain/reportRunPresets.test.ts src/components/ReportScopePanel.test.tsx src/components/ReportWorkspace.test.tsx`

Expected: PASS.

- [ ] **Step 12: Commit**

```bash
git add src/domain/types.ts src/domain/reportRunPresets.ts src/domain/reportRunPresets.test.ts src/domain/reportScope.ts src/components/ReportScopePanel.tsx src/components/ReportScopePanel.test.tsx src/components/ReportWorkspace.tsx src/components/ReportWorkspace.test.tsx src/styles/app.css
git commit -m "Add guided Tag Report run presets"
```

---

### Task 2: Pagination Metadata And Capped-Data Warnings

**Files:**
- Modify: `src/api/stackApiV2.ts`
- Modify: `src/api/stackApiV2.test.ts`
- Modify: `src/api/stackApiV3.ts`
- Modify: `src/api/stackApiV3.test.ts`
- Modify: `src/collectors/liveCollectors.ts`
- Modify: `src/collectors/liveReportRunner.ts`
- Modify: `src/collectors/liveReportRunner.test.ts`
- Modify: `src/server/reportRunApi.ts`
- Modify: `src/server/reportRunApi.test.ts`
- Modify: `src/domain/types.ts`

- [ ] **Step 1: Write failing API metadata tests**

Add to `src/api/stackApiV2.test.ts`:

```ts
it("returns pagination metadata when a max page cap leaves more v2 data", async () => {
  const fetchMock = vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ items: [{ id: 1 }], has_more: true }), { status: 200 }),
  );
  const client = new StackApiV2Client({
    apiV2Url: "https://api.stackoverflowteams.com/2.3",
    teamSlug: "example-team",
    fetchFn: fetchMock,
  });

  await expect(client.getPagedResult("/users", { pagesize: "50" }, { maxPages: 1 })).resolves.toEqual({
    items: [{ id: 1 }],
    pageCount: 1,
    reachedMaxPages: true,
    hasMore: true,
  });
});
```

Add to `src/api/stackApiV3.test.ts`:

```ts
it("returns pagination metadata when a max page cap leaves more v3 data", async () => {
  const fetchMock = vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ items: [{ id: "a" }], totalPages: 3 }), { status: 200 }),
  );
  const client = new StackApiV3Client({
    apiV3Url: "https://api.stackoverflowteams.com/v3/teams/example-team",
    token: "token",
    fetchFn: fetchMock,
  });

  await expect(client.getPagedResult("/tags", {}, { maxPages: 1 })).resolves.toEqual({
    items: [{ id: "a" }],
    pageCount: 1,
    reachedMaxPages: true,
    hasMore: true,
  });
});
```

- [ ] **Step 2: Run API tests to verify failure**

Run: `pnpm test -- src/api/stackApiV2.test.ts src/api/stackApiV3.test.ts`

Expected: FAIL because `getPagedResult` is not defined.

- [ ] **Step 3: Add paged result APIs**

In both `src/api/stackApiV2.ts` and `src/api/stackApiV3.ts`, export:

```ts
export interface PagedResult<T> {
  items: T[];
  pageCount: number;
  reachedMaxPages: boolean;
  hasMore: boolean;
}
```

In `StackApiV2Client`, implement:

```ts
async getPagedResult<T = unknown>(
  path: string,
  query: Record<string, string> = {},
  options: PagingOptions = {},
): Promise<PagedResult<T>> {
  const items: T[] = [];
  let page = 1;
  let hasMore = true;
  let pageCount = 0;
  const maxPages = options.maxPages ?? Number.POSITIVE_INFINITY;

  while (hasMore && page <= maxPages) {
    const url = this.buildUrl(path, { ...query, page: String(page) });
    const response = await this.fetchFn(url, { headers: this.headers });
    const body = await readJsonResponse<StackApiV2Page<T>>(response, "Stack API v2.3");

    items.push(...(body.items ?? []));
    pageCount += 1;
    await this.notifyBackoff(body);

    hasMore = body.has_more === true;
    page += 1;
  }

  return {
    items,
    pageCount,
    reachedMaxPages: hasMore && page > maxPages,
    hasMore,
  };
}

async getPagedItems<T = unknown>(
  path: string,
  query: Record<string, string> = {},
  options: PagingOptions = {},
): Promise<T[]> {
  return (await this.getPagedResult<T>(path, query, options)).items;
}
```

In `StackApiV3Client`, implement the same method with `totalPages`:

```ts
async getPagedResult<T = unknown>(
  path: string,
  query: Record<string, string> = {},
  options: PagingOptions = {},
): Promise<PagedResult<T>> {
  const items: T[] = [];
  let page = 1;
  let totalPages = 1;
  let pageCount = 0;
  const maxPages = options.maxPages ?? Number.POSITIVE_INFINITY;

  do {
    const url = this.buildUrl(path, { ...query, page: String(page) });
    const response = await this.fetchFn(url, { headers: this.createJsonHeaders() });
    const body = await readJsonResponse<StackApiV3Page<T>>(response, "Stack API v3");

    items.push(...(body.items ?? []));
    totalPages = body.totalPages ?? totalPages;
    pageCount += 1;
    await this.notifyThrottle(response.headers);
    page += 1;
  } while (page <= totalPages && page <= maxPages);

  return {
    items,
    pageCount,
    reachedMaxPages: page <= totalPages && page > maxPages,
    hasMore: page <= totalPages,
  };
}
```

- [ ] **Step 4: Run API tests to verify pass**

Run: `pnpm test -- src/api/stackApiV2.test.ts src/api/stackApiV3.test.ts`

Expected: PASS.

- [ ] **Step 5: Write failing runner warning tests**

Add to `src/collectors/liveReportRunner.test.ts`:

```ts
it("warns when a preset cap leaves more Tag Report dataset records available", async () => {
  const fetchMock = vi.fn().mockImplementation((input: RequestInfo | URL) => {
    const url = input.toString();
    const hasMore = url.includes("/tags?");

    return Promise.resolve(
      new Response(JSON.stringify({ items: itemsForTagReportUrl(url), has_more: hasMore }), {
        status: 200,
      }),
    );
  });

  const result = await runLiveReport("tag-report", basicCredentials, {
    fetchFn: fetchMock,
    pageSize: 50,
    maxPagesPerDataset: 1,
    runPreset: "quick-sample",
  });

  expect(result.warnings).toContainEqual({
    reportId: "tag-report",
    code: "dataset-cap-reached",
    message:
      "Tags reached the Quick sample cap of 50 records. Use Deep audit or Advanced API volume settings for a more complete run.",
  });
});
```

Add to `src/server/reportRunApi.test.ts`:

```ts
it("forwards the optional run preset to the live runner", async () => {
  const result: LiveReportRunResult = {
    reportId: "tag-report",
    reportTitle: "Tag Report",
    periodRole: "current",
    scope: {},
    pageSize: 50,
    maxPagesPerDataset: 1,
    runPreset: "quick-sample",
    datasets: [],
    messages: [],
    warnings: [],
  };
  const runLiveReport = vi.fn().mockResolvedValue(result);

  const response = await handleReportRunRequest(
    {
      reportId: "tag-report",
      credentials,
      pageSize: 50,
      maxPagesPerDataset: 1,
      runPreset: "quick-sample",
    },
    { runLiveReport },
  );

  expect(response.status).toBe(200);
  expect(runLiveReport).toHaveBeenCalledWith("tag-report", credentials, {
    periodRole: "current",
    scope: {},
    pageSize: 50,
    maxPagesPerDataset: 1,
    runPreset: "quick-sample",
  });
});
```

- [ ] **Step 6: Run runner/server tests to verify failure**

Run: `pnpm test -- src/collectors/liveReportRunner.test.ts src/server/reportRunApi.test.ts`

Expected: FAIL because runner options do not include `runPreset` and collectors do not return pagination metadata.

- [ ] **Step 7: Add collector metadata**

Modify `src/collectors/liveCollectors.ts`:

```ts
import type { DatasetName, PeriodScope, RunPeriodRole } from "../domain/types";

export interface DatasetCollectionResult {
  records: unknown[];
  pageCount: number;
  reachedMaxPages: boolean;
  hasMore: boolean;
}

export interface DatasetClient {
  getPagedItems(
    path: string,
    query?: Record<string, string>,
    options?: { maxPages?: number },
  ): Promise<unknown[]>;
  getPagedResult?(
    path: string,
    query?: Record<string, string>,
    options?: { maxPages?: number },
  ): Promise<{
    items: unknown[];
    pageCount: number;
    reachedMaxPages: boolean;
    hasMore: boolean;
  }>;
}
```

Change `collectDataset()` to return `Promise<DatasetCollectionResult>`. Use this wrapper for simple datasets:

```ts
async function getPagedResult(
  client: DatasetClient,
  path: string,
  query: Record<string, string>,
  context: LiveCollectorContext,
): Promise<DatasetCollectionResult> {
  const options = typeof context.maxPagesPerDataset === "number"
    ? { maxPages: context.maxPagesPerDataset }
    : undefined;

  if (client.getPagedResult) {
    const result = await client.getPagedResult(path, query, options);
    return {
      records: result.items,
      pageCount: result.pageCount,
      reachedMaxPages: result.reachedMaxPages,
      hasMore: result.hasMore,
    };
  }

  const records = await client.getPagedItems(path, query, options);
  return { records, pageCount: 0, reachedMaxPages: false, hasMore: false };
}
```

For dependent datasets, aggregate metadata:

```ts
function combineCollectionResults(results: DatasetCollectionResult[]): DatasetCollectionResult {
  return {
    records: results.flatMap((result) => result.records),
    pageCount: results.reduce((sum, result) => sum + result.pageCount, 0),
    reachedMaxPages: results.some((result) => result.reachedMaxPages),
    hasMore: results.some((result) => result.hasMore),
  };
}
```

- [ ] **Step 8: Add run preset metadata and warnings**

Modify `src/collectors/liveReportRunner.ts`:

```ts
import type {
  DatasetName,
  PeriodScope,
  ReportId,
  ReportRunPresetId,
  ReportWarning,
  RunPeriodRole,
  SessionCredentials,
} from "../domain/types";
import { getReportRunPreset, getReportRunPresetMaxRecords } from "../domain/reportRunPresets";
```

Extend result and options:

```ts
export interface LiveReportRunResult {
  reportId: ReportId;
  reportTitle: string;
  periodRole: RunPeriodRole;
  scope: PeriodScope;
  pageSize: number;
  maxPagesPerDataset: number;
  runPreset?: ReportRunPresetId;
  datasets: LiveReportDataset[];
  messages: string[];
  warnings: ReportWarning[];
}

export interface LiveReportRunOptions {
  fetchFn?: FetchLike;
  onThrottle?: (notice: ThrottleNotice) => void | Promise<void>;
  periodRole?: RunPeriodRole;
  scope?: PeriodScope;
  pageSize?: number;
  maxPagesPerDataset?: number;
  runPreset?: ReportRunPresetId;
}
```

Inside the dataset loop:

```ts
const collection = await collectDataset(datasetName, clients, {
  collectedDatasets,
  periodRole,
  scope,
  pageSize,
  maxPagesPerDataset,
});
const records = toRecordList(collection.records);
collectedDatasets[datasetName] = records;
datasets.push({ datasetName, records });
if (collection.reachedMaxPages) {
  warnings.push(formatCapWarning(reportId, datasetName, options.runPreset, pageSize, maxPagesPerDataset));
}
```

Use a local `warnings: ReportWarning[] = [];` before the loop and return it.

Add helpers:

```ts
function formatCapWarning(
  reportId: ReportId,
  datasetName: DatasetName,
  runPreset: ReportRunPresetId | undefined,
  pageSize: number,
  maxPagesPerDataset: number,
): ReportWarning {
  const cap = runPreset
    ? getReportRunPresetMaxRecords(runPreset)
    : pageSize * maxPagesPerDataset;
  const presetLabel = runPreset ? getReportRunPreset(runPreset).label : "selected";

  return {
    reportId,
    code: "dataset-cap-reached",
    message: `${formatDatasetLabel(datasetName)} reached the ${presetLabel} cap of ${cap.toLocaleString(
      "en-US",
    )} records. Use Deep audit or Advanced API volume settings for a more complete run.`,
  };
}

function formatDatasetLabel(datasetName: DatasetName): string {
  return datasetName
    .replace(/([A-Z])/g, " $1")
    .replace(/^./, (first) => first.toUpperCase());
}
```

- [ ] **Step 9: Accept `runPreset` in the server API**

Modify `src/server/reportRunApi.ts`:

```ts
import type {
  PeriodScope,
  ReportId,
  ReportRunPresetId,
  RunPeriodRole,
  SessionCredentials,
} from "../domain/types";

interface ReportRunRequestPayload {
  reportId: ReportId;
  credentials: SessionCredentials;
  periodRole?: RunPeriodRole;
  scope?: PeriodScope;
  pageSize?: number;
  maxPagesPerDataset?: number;
  runPreset?: ReportRunPresetId;
}
```

Pass it through:

```ts
{
  periodRole,
  scope,
  pageSize,
  maxPagesPerDataset,
  runPreset: payload.runPreset,
}
```

Add payload validation:

```ts
if (
  value.runPreset !== undefined &&
  value.runPreset !== "quick-sample" &&
  value.runPreset !== "standard" &&
  value.runPreset !== "deep-audit"
) {
  return false;
}
```

- [ ] **Step 10: Run warning/server tests to verify pass**

Run: `pnpm test -- src/api/stackApiV2.test.ts src/api/stackApiV3.test.ts src/collectors/liveReportRunner.test.ts src/server/reportRunApi.test.ts`

Expected: PASS.

- [ ] **Step 11: Commit**

```bash
git add src/api/stackApiV2.ts src/api/stackApiV2.test.ts src/api/stackApiV3.ts src/api/stackApiV3.test.ts src/collectors/liveCollectors.ts src/collectors/liveReportRunner.ts src/collectors/liveReportRunner.test.ts src/server/reportRunApi.ts src/server/reportRunApi.test.ts src/domain/types.ts
git commit -m "Warn when report presets cap API data"
```

---

### Task 3: Tag Health Transform And Curated CSV Download

**Files:**
- Modify: `src/importers/reportImporters.ts`
- Modify: `src/importers/reportImporters.test.ts`
- Modify: `src/reports/tagReport.ts`
- Modify: `src/reports/reportTransforms.test.ts`
- Create: `src/utils/reportDownloads.ts`
- Create: `src/utils/reportDownloads.test.ts`
- Modify: `src/components/ReportWorkspace.tsx`
- Modify: `src/components/ReportWorkspace.test.tsx`
- Modify: `src/styles/app.css`

- [ ] **Step 1: Write failing Tag Health transform tests**

Append to `src/reports/reportTransforms.test.ts`:

```ts
import {
  buildTagHealthRows,
  buildTagHealthRowsFromLiveRecords,
  summarizeTagHealthRows,
} from "./tagReport";

it("builds Tag Health rows with conservative statuses and actions", () => {
  const rows = buildTagHealthRows([
    {
      tagName: "python",
      totalPageViews: 1000,
      tagWatchers: 20,
      totalSmes: 0,
      questionCount: 10,
      answerCount: 4,
      questionsNoAnswers: 6,
      medianTimeToFirstAnswerHours: 50,
    },
    {
      tagName: "release-management",
      totalPageViews: 25,
      tagWatchers: 2,
      totalSmes: 1,
      questionCount: 0,
      answerCount: 0,
      questionsNoAnswers: 0,
      medianTimeToFirstAnswerHours: 0,
    },
  ]);

  expect(rows).toEqual([
    {
      tag_name: "python",
      health_status: "Needs SME coverage",
      page_views: 1000,
      question_count: 10,
      answer_count: 4,
      sme_count: 0,
      watcher_count: 20,
      unanswered_questions: 6,
      median_first_answer_hours: 50,
      recommended_action: "Assign or confirm SMEs for this active tag.",
    },
    {
      tag_name: "release-management",
      health_status: "Low activity",
      page_views: 25,
      question_count: 0,
      answer_count: 0,
      sme_count: 1,
      watcher_count: 2,
      unanswered_questions: 0,
      median_first_answer_hours: 0,
      recommended_action: "Review whether this tag still needs active tracking.",
    },
  ]);
});

it("summarizes Tag Health rows for dashboard charts", () => {
  const summary = summarizeTagHealthRows([
    {
      tag_name: "python",
      health_status: "Needs response attention",
      page_views: 500,
      question_count: 5,
      answer_count: 1,
      sme_count: 1,
      watcher_count: 12,
      unanswered_questions: 4,
      median_first_answer_hours: 60,
      recommended_action: "Review unanswered questions and response-time coverage.",
    },
  ]);

  expect(summary.metricCards).toContainEqual({ label: "Tags Covered", value: 1 });
  expect(summary.metricCards).toContainEqual({ label: "Response Attention", value: 1 });
  expect(summary.tagsNeedingResponse[0].tag_name).toBe("python");
});

it("builds Tag Health rows from live dataset records", () => {
  const rows = buildTagHealthRowsFromLiveRecords([
    { datasetName: "tags", name: "python", count: 2 },
    { datasetName: "questions", question_id: 1, tags: ["python"], answer_count: 0, view_count: 30, is_answered: false },
    { datasetName: "questions", question_id: 2, tags: ["python"], answer_count: 2, view_count: 70, is_answered: true },
    { datasetName: "tagSmes", tagName: "python", user_id: 1 },
  ]);

  expect(rows).toEqual([
    expect.objectContaining({
      tag_name: "python",
      page_views: 100,
      question_count: 2,
      answer_count: 2,
      sme_count: 1,
      unanswered_questions: 1,
    }),
  ]);
});
```

- [ ] **Step 2: Run transform tests to verify failure**

Run: `pnpm test -- src/reports/reportTransforms.test.ts`

Expected: FAIL because the new Tag Health functions are not exported.

- [ ] **Step 3: Expand imported Tag Report fields**

Modify `src/importers/reportImporters.ts` inside `importTagMetrics()`:

```ts
function importTagMetrics(text: string) {
  return parseCsvRecords<Record<string, string>>(text).map((row) => ({
    tagName: row["Tag Name"],
    totalPageViews: toNumber(row["Total Page Views"]),
    webhooks: toNumber(row.Webhooks),
    tagWatchers: toNumber(row["Tag Watchers"]),
    totalSmes: toNumber(row["Total Smes"]),
    questionCount: toNumber(row["Question Count"]),
    answerCount: toNumber(row["Answer Count"]),
    questionsNoAnswers: toNumber(row["Questions No Answers"]),
    medianTimeToFirstAnswerHours: toNumber(row["Median Time To First Answer Hours"]),
  }));
}
```

Add importer assertion in `src/importers/reportImporters.test.ts`:

```ts
expect(result.records[0]).toEqual(expect.objectContaining({
  questionsNoAnswers: 222,
  medianTimeToFirstAnswerHours: 7.41,
}));
```

- [ ] **Step 4: Implement Tag Health transform**

Modify `src/reports/tagReport.ts`:

```ts
import type { MetricCard } from "./reportModels";

export interface TagMetricRow {
  tagName: string;
  totalPageViews?: number;
  tagWatchers?: number;
  totalSmes?: number;
  questionCount?: number;
  answerCount?: number;
  questionsNoAnswers?: number;
  medianTimeToFirstAnswerHours?: number;
}

export type TagHealthStatus =
  | "Healthy"
  | "Needs SME coverage"
  | "Needs response attention"
  | "Low activity";

export interface TagHealthRow {
  tag_name: string;
  health_status: TagHealthStatus;
  page_views: number;
  question_count: number;
  answer_count: number;
  sme_count: number;
  watcher_count: number;
  unanswered_questions: number;
  median_first_answer_hours: number;
  recommended_action: string;
}
```

Add:

```ts
export function buildTagHealthRows(rows: TagMetricRow[]): TagHealthRow[] {
  return rows.map((row) => {
    const normalized = {
      tag_name: row.tagName,
      page_views: metricNumber(row.totalPageViews),
      question_count: metricNumber(row.questionCount),
      answer_count: metricNumber(row.answerCount),
      sme_count: metricNumber(row.totalSmes),
      watcher_count: metricNumber(row.tagWatchers),
      unanswered_questions: metricNumber(row.questionsNoAnswers),
      median_first_answer_hours: metricNumber(row.medianTimeToFirstAnswerHours),
    };
    const health_status = classifyTagHealth(normalized);

    return {
      ...normalized,
      health_status,
      recommended_action: recommendedActionForStatus(health_status),
    };
  });
}

export function summarizeTagHealthRows(rows: TagHealthRow[]) {
  const responseAttention = rows.filter((row) => row.health_status === "Needs response attention");
  const smeCoverage = rows.filter((row) => row.health_status === "Needs SME coverage");
  const totalQuestions = rows.reduce((sum, row) => sum + row.question_count, 0);
  const coveredTags = rows.filter((row) => row.sme_count > 0).length;
  const metricCards: MetricCard[] = [
    { label: "Tags Covered", value: rows.length },
    { label: "Questions", value: totalQuestions },
    { label: "SME Coverage", value: `${coveredTags}/${rows.length}` },
    { label: "Response Attention", value: responseAttention.length },
  ];

  return {
    metricCards,
    topTagsByViews: [...rows].sort((a, b) => b.page_views - a.page_views).slice(0, 10),
    tagsNeedingSmeCoverage: [...smeCoverage].sort((a, b) => b.question_count - a.question_count).slice(0, 10),
    tagsNeedingResponse: [...responseAttention]
      .sort((a, b) => b.unanswered_questions - a.unanswered_questions || b.median_first_answer_hours - a.median_first_answer_hours)
      .slice(0, 10),
  };
}

export function buildTagHealthRowsFromLiveRecords(records: Record<string, unknown>[]): TagHealthRow[] {
  const tags = records.filter((record) => record.datasetName === "tags");
  const questions = records.filter((record) => record.datasetName === "questions");
  const tagSmes = records.filter((record) => record.datasetName === "tagSmes");

  return buildTagHealthRows(tags.map((tag) => {
    const tagName = getStringField(tag, "name", "tagName", "tag_name") ?? "unknown";
    const tagQuestions = questions.filter((question) => getQuestionTags(question).includes(tagName));
    const questionCount = tagQuestions.length || getNumberField(tag, "count") || 0;
    const answerCount = tagQuestions.reduce((sum, question) => sum + (getNumberField(question, "answer_count", "answerCount") ?? 0), 0);
    const questionsNoAnswers = tagQuestions.filter((question) => {
      const answerCount = getNumberField(question, "answer_count", "answerCount") ?? 0;
      const isAnswered = question.is_answered === true || question.isAnswered === true;
      return answerCount === 0 || !isAnswered;
    }).length;
    const totalPageViews = tagQuestions.reduce((sum, question) => sum + (getNumberField(question, "view_count", "viewCount") ?? 0), 0);
    const totalSmes = tagSmes.filter((sme) => getStringField(sme, "tagName", "tag_name") === tagName).length;

    return {
      tagName,
      totalPageViews,
      tagWatchers: getNumberField(tag, "tagWatchers", "watcher_count") ?? 0,
      totalSmes,
      questionCount,
      answerCount,
      questionsNoAnswers,
      medianTimeToFirstAnswerHours: 0,
    };
  }));
}
```

Add helper functions in the same file:

```ts
function classifyTagHealth(row: Omit<TagHealthRow, "health_status" | "recommended_action">): TagHealthStatus {
  if (row.question_count === 0 && row.page_views < 100) return "Low activity";
  if (row.question_count > 0 && row.sme_count === 0) return "Needs SME coverage";
  if (row.unanswered_questions > 0 || row.median_first_answer_hours >= 48) return "Needs response attention";
  return "Healthy";
}

function recommendedActionForStatus(status: TagHealthStatus): string {
  switch (status) {
    case "Needs SME coverage":
      return "Assign or confirm SMEs for this active tag.";
    case "Needs response attention":
      return "Review unanswered questions and response-time coverage.";
    case "Low activity":
      return "Review whether this tag still needs active tracking.";
    case "Healthy":
      return "Keep monitoring this tag in normal reporting cycles.";
  }
}

function getQuestionTags(record: Record<string, unknown>): string[] {
  const tags = record.tags;
  if (Array.isArray(tags)) return tags.filter((tag): tag is string => typeof tag === "string");
  if (typeof tags === "string") return tags.split(";").map((tag) => tag.trim()).filter(Boolean);
  return [];
}

function getStringField(record: Record<string, unknown>, ...fieldNames: string[]): string | null {
  for (const fieldName of fieldNames) {
    const value = record[fieldName];
    if (typeof value === "string" && value.trim() !== "") return value;
  }
  return null;
}

function getNumberField(record: Record<string, unknown>, ...fieldNames: string[]): number | null {
  for (const fieldName of fieldNames) {
    const value = record[fieldName];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string") {
      const parsed = Number.parseFloat(value);
      if (!Number.isNaN(parsed)) return parsed;
    }
  }
  return null;
}
```

- [ ] **Step 5: Run transform/importer tests to verify pass**

Run: `pnpm test -- src/reports/reportTransforms.test.ts src/importers/reportImporters.test.ts`

Expected: PASS.

- [ ] **Step 6: Write failing curated CSV download tests**

Create `src/utils/reportDownloads.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import type { ReportOutput } from "../domain/types";
import { buildReportCsvDownload, downloadReportCsv } from "./reportDownloads";
import { downloadTextFile } from "./downloads";

vi.mock("./downloads", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./downloads")>();
  return { ...actual, downloadTextFile: vi.fn() };
});

describe("reportDownloads", () => {
  it("builds a curated Tag Health CSV download", () => {
    const output: ReportOutput = {
      reportId: "tag-report",
      datasetName: "tags",
      fileName: "Live API run",
      loadedAt: "2026-07-08T10:00:00.000Z",
      source: "live-api",
      records: [
        {
          tag_name: "python",
          health_status: "Needs SME coverage",
          page_views: 100,
          question_count: 4,
          answer_count: 2,
          sme_count: 0,
          watcher_count: 3,
          unanswered_questions: 1,
          median_first_answer_hours: 72,
          recommended_action: "Assign or confirm SMEs for this active tag.",
        },
      ],
    };

    expect(buildReportCsvDownload(output)).toEqual({
      fileName: "tag-report-tag-health-current-2026-07-08.csv",
      contents:
        "tag_name,health_status,page_views,question_count,answer_count,sme_count,watcher_count,unanswered_questions,median_first_answer_hours,recommended_action\npython,Needs SME coverage,100,4,2,0,3,1,72,Assign or confirm SMEs for this active tag.",
      mimeType: "text/csv;charset=utf-8",
    });
  });

  it("downloads a curated report CSV through the shared text helper", () => {
    const output: ReportOutput = {
      reportId: "tag-report",
      datasetName: "tags",
      fileName: "Live API run",
      loadedAt: "2026-07-08T10:00:00.000Z",
      source: "live-api",
      records: [],
    };

    downloadReportCsv(output);

    expect(downloadTextFile).toHaveBeenCalledWith(
      "tag-report-tag-health-current-2026-07-08.csv",
      "",
      "text/csv;charset=utf-8",
    );
  });
});
```

- [ ] **Step 7: Run download tests to verify failure**

Run: `pnpm test -- src/utils/reportDownloads.test.ts`

Expected: FAIL because `src/utils/reportDownloads.ts` does not exist.

- [ ] **Step 8: Implement report CSV downloads**

Create `src/utils/reportDownloads.ts`:

```ts
import type { ReportOutput } from "../domain/types";
import { downloadTextFile, recordsToCsv } from "./downloads";

interface ReportCsvDownload {
  fileName: string;
  contents: string;
  mimeType: string;
}

export function buildReportCsvDownload(output: ReportOutput): ReportCsvDownload {
  return {
    fileName: `${buildReportFileStem(output)}.csv`,
    contents: recordsToCsv(output.records),
    mimeType: "text/csv;charset=utf-8",
  };
}

export function downloadReportCsv(output: ReportOutput) {
  const download = buildReportCsvDownload(output);
  downloadTextFile(download.fileName, download.contents, download.mimeType);
}

function buildReportFileStem(output: ReportOutput): string {
  const outputName = output.reportId === "tag-report" ? "tag-health" : output.datasetName;
  return [
    output.reportId,
    outputName,
    output.comparisonScope ? "comparison" : "current",
    output.loadedAt.slice(0, 10),
  ]
    .map(sanitizeFileNamePart)
    .join("-");
}

function sanitizeFileNamePart(value: string): string {
  return value.trim().replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-|-$/g, "") || "report";
}
```

- [ ] **Step 9: Add Tag Health download button tests**

Modify `src/components/ReportWorkspace.test.tsx`:

```tsx
vi.mock("../utils/reportDownloads", () => ({
  downloadReportCsv: vi.fn(),
}));

it("downloads curated Tag Health CSV output separately from raw datasets", async () => {
  render(
    <ReportWorkspace
      {...defaultWorkspaceProps()}
      reportId="tag-report"
      records={[{ tag_name: "python", health_status: "Healthy" }]}
      outputSource="live-api"
      loadedAt="2026-07-08T10:00:00.000Z"
    />,
  );

  await userEvent.click(screen.getByRole("button", { name: "Download Tag Health CSV" }));

  expect(downloadReportCsv).toHaveBeenCalledWith(expect.objectContaining({
    reportId: "tag-report",
    records: [{ tag_name: "python", health_status: "Healthy" }],
  }));
});
```

Add `loadedAt?: string` to `ReportWorkspaceProps`. In `defaultWorkspaceProps`, no `loadedAt` is needed.

- [ ] **Step 10: Implement report output download controls**

Modify `src/components/ReportWorkspace.tsx`:

```tsx
import { downloadReportCsv } from "../utils/reportDownloads";
```

Add prop:

```ts
loadedAt?: string;
```

Build a local output for CSV:

```tsx
const canDownloadTagHealthCsv = reportId === "tag-report" && records.length > 0;
```

Render before tabs:

```tsx
{canDownloadTagHealthCsv && (
  <div className="report-output-actions">
    <button
      className="s-btn s-btn__outlined report-run-secondary"
      type="button"
      onClick={() =>
        downloadReportCsv({
          reportId,
          datasetName: "tags",
          fileName: "Tag Health CSV",
          records,
          loadedAt: loadedAt ?? new Date().toISOString(),
          source: outputSource ?? "upload",
          currentScope,
          comparisonScope,
        })
      }
    >
      Download Tag Health CSV
    </button>
  </div>
)}
```

Pass `loadedAt={selectedReportOutput?.loadedAt}` from `src/App.tsx`.

- [ ] **Step 11: Run download/workspace tests to verify pass**

Run: `pnpm test -- src/utils/reportDownloads.test.ts src/components/ReportWorkspace.test.tsx`

Expected: PASS.

- [ ] **Step 12: Commit**

```bash
git add src/importers/reportImporters.ts src/importers/reportImporters.test.ts src/reports/tagReport.ts src/reports/reportTransforms.test.ts src/utils/reportDownloads.ts src/utils/reportDownloads.test.ts src/components/ReportWorkspace.tsx src/components/ReportWorkspace.test.tsx src/App.tsx src/styles/app.css
git commit -m "Add curated Tag Health CSV output"
```

---

### Task 4: Store Curated Tag Report Output And Render Dashboard Warnings

**Files:**
- Modify: `src/domain/sessionStore.ts`
- Modify: `src/domain/sessionStore.test.ts`
- Modify: `src/components/ReportDashboard.tsx`
- Modify: `src/components/ReportDashboard.test.tsx`
- Modify: `src/components/AppShell.test.tsx`
- Modify: `src/components/ReportWorkspace.tsx`
- Modify: `src/styles/app.css`

- [ ] **Step 1: Write failing session reducer tests**

Add to `src/domain/sessionStore.test.ts`:

```ts
it("stores curated Tag Health rows as the visible Tag Report output while retaining raw datasets", () => {
  const state = createInitialSessionState();
  const next = sessionReducer(state, {
    type: "live/loaded",
    reportId: "tag-report",
    periodRole: "current",
    scope: {},
    pageSize: 100,
    maxPagesPerDataset: 5,
    runPreset: "standard",
    warnings: [],
    datasets: [
      { datasetName: "tags", records: [{ name: "python", count: 1 }] },
      { datasetName: "questions", records: [{ question_id: 1, tags: ["python"], answer_count: 0, view_count: 25, is_answered: false }] },
      { datasetName: "tagSmes", records: [] },
    ],
  });

  expect(Object.values(next.datasets).map((dataset) => dataset.name)).toEqual(["tags", "questions", "tagSmes"]);
  expect(next.reportOutputs["tag-report"]?.records).toEqual([
    expect.objectContaining({
      tag_name: "python",
      question_count: 1,
      unanswered_questions: 1,
    }),
  ]);
});
```

- [ ] **Step 2: Run reducer tests to verify failure**

Run: `pnpm test -- src/domain/sessionStore.test.ts`

Expected: FAIL because `live/loaded` does not accept `runPreset` and still flattens raw datasets into visible report output.

- [ ] **Step 3: Store curated output for Tag Report**

Modify `src/domain/sessionStore.ts` imports:

```ts
import { buildTagHealthRowsFromLiveRecords } from "../reports/tagReport";
import type { ReportRunPresetId } from "./types";
```

Add `runPreset?: ReportRunPresetId` to the `live/loaded` action and snapshot creation.

Replace:

```ts
const reportRecords = action.datasets.flatMap(({ datasetName, records }) =>
  records.map((record) => ({ datasetName, ...record })),
);
```

with:

```ts
const rawReportRecords = action.datasets.flatMap(({ datasetName, records }) =>
  records.map((record) => ({ datasetName, ...record })),
);
const reportRecords =
  action.reportId === "tag-report"
    ? buildTagHealthRowsFromLiveRecords(rawReportRecords)
    : rawReportRecords;
```

In the snapshot object add:

```ts
runPreset: action.runPreset,
```

- [ ] **Step 4: Run reducer tests to verify pass**

Run: `pnpm test -- src/domain/sessionStore.test.ts`

Expected: PASS.

- [ ] **Step 5: Write failing dashboard warning tests**

Add to `src/components/ReportDashboard.test.tsx`:

```tsx
it("renders Tag Health dashboard sections and partial-data warnings", () => {
  render(
    <ReportDashboard
      reportId="tag-report"
      outputSource="live-api"
      records={[
        {
          tag_name: "python",
          health_status: "Needs SME coverage",
          page_views: 100,
          question_count: 4,
          answer_count: 2,
          sme_count: 0,
          watcher_count: 3,
          unanswered_questions: 1,
          median_first_answer_hours: 72,
          recommended_action: "Assign or confirm SMEs for this active tag.",
        },
      ]}
      warnings={[{
        reportId: "tag-report",
        code: "dataset-cap-reached",
        message: "Tags reached the Standard report cap of 500 records. Use Deep audit or Advanced API volume settings for a more complete run.",
      }]}
    />,
  );

  expect(screen.getByText("Tags reached the Standard report cap of 500 records. Use Deep audit or Advanced API volume settings for a more complete run.")).toBeInTheDocument();
  expect(screen.getByText("Tags Covered")).toBeInTheDocument();
  expect(screen.getByText("Tags needing SME coverage")).toBeInTheDocument();
  expect(screen.getByLabelText("python: 4")).toBeInTheDocument();
});
```

- [ ] **Step 6: Run dashboard tests to verify failure**

Run: `pnpm test -- src/components/ReportDashboard.test.tsx`

Expected: FAIL because `ReportDashboard` does not accept `warnings` and still uses the old Tag Report summary path.

- [ ] **Step 7: Render Tag Health dashboard and warnings**

Modify `src/components/ReportDashboard.tsx` imports:

```ts
import {
  buildTagHealthRows,
  summarizeTagHealthRows,
  type TagHealthRow,
  type TagMetricRow,
} from "../reports/tagReport";
import type { PeriodScope, ReportId, ReportWarning } from "../domain/types";
```

Add prop:

```ts
warnings?: ReportWarning[];
```

Pass `warnings` through `ReportWorkspace` from `App`.

Add a warning section in `DashboardLayout`:

```tsx
function DashboardLayout({
  cards,
  comparisonSection,
  warnings = [],
  children,
}: {
  cards: MetricCard[];
  comparisonSection?: ReactNode;
  warnings?: ReportWarning[];
  children?: ReactNode;
}) {
  return (
    <div className="dashboard-summary">
      {warnings.length > 0 && (
        <div className="dashboard-warning-list" role="alert">
          {warnings.map((warning) => (
            <p key={`${warning.code}-${warning.message}`}>{warning.message}</p>
          ))}
        </div>
      )}
      <DashboardCards cards={cards} />
      {comparisonSection}
      {children}
    </div>
  );
}
```

Replace the Tag Report branch:

```tsx
if (reportId === "tag-report") {
  const healthRows = normalizeTagHealthRows(records);
  const summary = summarizeTagHealthRows(healthRows);

  return (
    <DashboardLayout cards={summary.metricCards} comparisonSection={comparisonSection} warnings={warnings}>
      <DashboardSection title="Top tags by page views">
        <BarList rows={summary.topTagsByViews.map((row) => ({ label: row.tag_name, value: row.page_views }))} />
      </DashboardSection>
      <DashboardSection title="Tags needing SME coverage">
        <BarList
          rows={summary.tagsNeedingSmeCoverage.map((row) => ({ label: row.tag_name, value: row.question_count }))}
          emptyMessage="No SME coverage gaps found."
        />
      </DashboardSection>
      <DashboardSection title="Tags needing response attention">
        <BarList
          rows={summary.tagsNeedingResponse.map((row) => ({ label: row.tag_name, value: row.unanswered_questions }))}
          emptyMessage="No response attention gaps found."
        />
      </DashboardSection>
    </DashboardLayout>
  );
}
```

Add:

```ts
function normalizeTagHealthRows(records: Record<string, unknown>[]): TagHealthRow[] {
  if (records.every((record) => typeof record.tag_name === "string")) {
    return records as unknown as TagHealthRow[];
  }

  return buildTagHealthRows(records as unknown as TagMetricRow[]);
}
```

- [ ] **Step 8: Update App integration tests**

Modify the Tag Report live run test in `src/components/AppShell.test.tsx` so the mocked response includes a capped warning:

```ts
warnings: [{
  reportId: "tag-report",
  code: "dataset-cap-reached",
  message: "Tags reached the Standard report cap of 500 records. Use Deep audit or Advanced API volume settings for a more complete run.",
}],
```

Assert:

```ts
expect(screen.getByText("Tag Health CSV")).toBeInTheDocument();
expect(screen.getByText(/Tags reached the Standard report cap/)).toBeInTheDocument();
expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toMatchObject({
  runPreset: "standard",
  pageSize: 100,
  maxPagesPerDataset: 5,
});
```

- [ ] **Step 9: Run dashboard/app tests to verify pass**

Run: `pnpm test -- src/domain/sessionStore.test.ts src/components/ReportDashboard.test.tsx src/components/AppShell.test.tsx`

Expected: PASS.

- [ ] **Step 10: Add warning styles**

Append to `src/styles/app.css`:

```css
.dashboard-warning-list {
  display: grid;
  gap: 8px;
  padding: 12px;
  border: 1px solid oklch(0.82 0.08 88);
  border-radius: 8px;
  background: var(--so-yellow-soft);
  color: oklch(0.31 0.07 72);
  font-size: 13px;
  line-height: 1.4;
}

.dashboard-warning-list p {
  margin: 0;
}

.report-output-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin: 16px 0 0;
}
```

- [ ] **Step 11: Commit**

```bash
git add src/domain/sessionStore.ts src/domain/sessionStore.test.ts src/components/ReportDashboard.tsx src/components/ReportDashboard.test.tsx src/components/AppShell.test.tsx src/components/ReportWorkspace.tsx src/App.tsx src/styles/app.css
git commit -m "Render curated Tag Report dashboard output"
```

---

### Task 5: Honest Run Progress UI

**Files:**
- Modify: `src/domain/types.ts`
- Modify: `src/App.tsx`
- Modify: `src/components/RunStatus.tsx`
- Create: `src/components/RunStatus.test.tsx`
- Modify: `src/components/AppShell.test.tsx`
- Modify: `src/styles/app.css`

- [ ] **Step 1: Write failing RunStatus progress tests**

Create `src/components/RunStatus.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { RunStatus } from "./RunStatus";

describe("RunStatus", () => {
  it("renders step-based progress while a run is active", () => {
    render(
      <RunStatus
        queue={[]}
        progress={{
          reportTitle: "Tag Report",
          status: "running",
          currentStage: "Collecting live API datasets",
          completedStages: ["Validate credentials", "Plan required datasets"],
          totalStages: 4,
        }}
      />,
    );

    expect(screen.getByRole("progressbar", { name: "Tag Report progress" })).toHaveAttribute("aria-valuenow", "50");
    expect(screen.getByText("Running Tag Report")).toBeInTheDocument();
    expect(screen.getByText("Collecting live API datasets")).toBeInTheDocument();
    expect(screen.getByText("Validate credentials")).toBeInTheDocument();
  });

  it("keeps queue messages visible beside progress details", () => {
    render(
      <RunStatus
        queue={[{ id: "tag-report-warning", reportId: "tag-report", status: "failed", message: "Run failed." }]}
        progress={{
          reportTitle: "Tag Report",
          status: "failed",
          currentStage: "Run failed",
          completedStages: ["Validate credentials"],
          totalStages: 4,
        }}
      />,
    );

    expect(screen.getByText("Run failed.")).toBeInTheDocument();
    expect(screen.getByText("Run failed")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run RunStatus tests to verify failure**

Run: `pnpm test -- src/components/RunStatus.test.tsx`

Expected: FAIL because `RunStatus` does not accept `progress`.

- [ ] **Step 3: Add progress type**

Modify `src/domain/types.ts`:

```ts
export interface ReportRunProgress {
  reportTitle: string;
  status: "idle" | "running" | "succeeded" | "failed";
  currentStage: string;
  completedStages: string[];
  totalStages: number;
}
```

- [ ] **Step 4: Implement RunStatus progress panel**

Modify `src/components/RunStatus.tsx`:

```tsx
import type { ReportRunProgress, RunQueueItem } from "../domain/types";

export function RunStatus({
  queue,
  progress,
}: {
  queue: RunQueueItem[];
  progress?: ReportRunProgress | null;
}) {
  if (queue.length === 0 && !progress) {
    return null;
  }

  const percent = progress
    ? Math.round((progress.completedStages.length / Math.max(progress.totalStages, 1)) * 100)
    : 0;

  return (
    <section className="s-notice s-notice__info mt16 run-status-panel" aria-label="Run status">
      {progress && (
        <div className="run-progress">
          <div className="run-progress-header">
            <strong>
              {progress.status === "running" ? `Running ${progress.reportTitle}` : progress.reportTitle}
            </strong>
            <span>{progress.currentStage}</span>
          </div>
          <div
            className="run-progress-bar"
            role="progressbar"
            aria-label={`${progress.reportTitle} progress`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent}
          >
            <span style={{ width: `${percent}%` }} />
          </div>
          <ul className="run-progress-steps">
            {progress.completedStages.map((stage) => (
              <li key={stage}>{stage}</li>
            ))}
          </ul>
        </div>
      )}
      {queue.length > 0 && (
        <ul className="m0">
          {queue.map((item) => (
            <li key={item.id}>{item.message}</li>
          ))}
        </ul>
      )}
    </section>
  );
}
```

- [ ] **Step 5: Run RunStatus tests to verify pass**

Run: `pnpm test -- src/components/RunStatus.test.tsx`

Expected: PASS.

- [ ] **Step 6: Write failing App progress test**

Add to `src/components/AppShell.test.tsx`:

```tsx
it("shows honest progress while Tag Report collection is in flight", async () => {
  const user = userEvent.setup();
  let resolveRun: (response: Response) => void = () => undefined;
  vi.spyOn(globalThis, "fetch").mockReturnValue(
    new Promise<Response>((resolve) => {
      resolveRun = resolve;
    }),
  );

  render(<App />);

  await user.click(screen.getByRole("button", { name: "Credentials" }));
  await user.type(screen.getByLabelText("Instance URL"), "https://stackoverflowteams.com/c/example-team");
  await user.type(screen.getByLabelText("Personal access token"), "pat-token");
  await user.click(screen.getByRole("button", { name: "Save session credentials" }));
  await user.click(screen.getByRole("button", { name: "Reports" }));
  await user.click(screen.getByRole("button", { name: "Run current period" }));

  expect(screen.getByRole("progressbar", { name: "Tag Report progress" })).toBeInTheDocument();
  expect(screen.getByText("Collecting live API datasets")).toBeInTheDocument();

  resolveRun(new Response(JSON.stringify({
    ok: true,
    result: {
      reportId: "tag-report",
      reportTitle: "Tag Report",
      periodRole: "current",
      scope: {},
      pageSize: 100,
      maxPagesPerDataset: 5,
      runPreset: "standard",
      warnings: [],
      datasets: [{ datasetName: "tags", records: [{ name: "python" }] }],
      messages: ["Collected tags (1 record) for Tag Report."],
    },
  }), { status: 200 }));

  expect(await screen.findByText("Live API run completed for Tag Report.")).toBeInTheDocument();
});
```

- [ ] **Step 7: Run App progress test to verify failure**

Run: `pnpm test -- src/components/AppShell.test.tsx`

Expected: FAIL because `App` does not pass progress into `RunStatus`.

- [ ] **Step 8: Wire progress in App**

Modify `src/App.tsx` imports:

```ts
import type {
  ReportId,
  ReportRunProgress,
  RunPeriodRole,
  RunQueueItem,
  SessionCredentials,
} from "./domain/types";
```

Add state:

```ts
const [runProgress, setRunProgress] = useState<ReportRunProgress | null>(null);
```

Before fetch in `queueSelectedReportRun`:

```ts
setRunProgress({
  reportTitle: report.title,
  status: "running",
  currentStage: "Collecting live API datasets",
  completedStages: ["Validate credentials", "Plan required datasets"],
  totalStages: 4,
});
```

Include `runPreset` in request body:

```ts
runPreset: reportScope.runPreset,
```

After success:

```ts
setRunProgress({
  reportTitle: report.title,
  status: "succeeded",
  currentStage: "Complete",
  completedStages: ["Validate credentials", "Plan required datasets", "Collecting live API datasets", "Build report output"],
  totalStages: 4,
});
```

After catch:

```ts
setRunProgress({
  reportTitle: report.title,
  status: "failed",
  currentStage: "Run failed",
  completedStages: ["Validate credentials"],
  totalStages: 4,
});
```

Pass progress:

```tsx
<RunStatus queue={runQueue} progress={runProgress} />
```

When dispatching `live/loaded`, include:

```ts
runPreset: result.runPreset ?? reportScope.runPreset,
```

- [ ] **Step 9: Add progress styles**

Append to `src/styles/app.css`:

```css
.run-status-panel {
  display: grid;
  gap: 12px;
}

.run-progress {
  display: grid;
  gap: 8px;
}

.run-progress-header {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 8px;
}

.run-progress-header strong {
  color: var(--so-ink);
}

.run-progress-bar {
  height: 10px;
  overflow: hidden;
  border-radius: 999px;
  background: var(--so-border);
}

.run-progress-bar span {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: var(--so-orange);
  transition: width var(--motion-base) var(--ease-out-product);
}

.run-progress-steps {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 12px;
  margin: 0;
  padding-left: 18px;
  color: var(--so-text-muted);
  font-size: 13px;
}

@media (prefers-reduced-motion: reduce) {
  .run-progress-bar span {
    transition: none;
  }
}
```

- [ ] **Step 10: Run progress/app tests to verify pass**

Run: `pnpm test -- src/components/RunStatus.test.tsx src/components/AppShell.test.tsx`

Expected: PASS.

- [ ] **Step 11: Commit**

```bash
git add src/domain/types.ts src/App.tsx src/components/RunStatus.tsx src/components/RunStatus.test.tsx src/components/AppShell.test.tsx src/styles/app.css
git commit -m "Show Tag Report run progress"
```

---

### Task 6: Final Verification And Browser Pass

**Files:**
- Modify: `e2e/reporting-mvp.spec.ts`
- Review: `README.md` if user-visible commands changed; no change is expected.

- [ ] **Step 1: Add focused e2e smoke coverage**

Modify `e2e/reporting-mvp.spec.ts` to include a Tag Report preset disclosure check:

```ts
test("Tag Report exposes guided preset details", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Tag Report" })).toBeVisible();
  await expect(page.getByRole("group", { name: "Run depth" })).toBeVisible();
  await expect(page.getByText("Requests up to 500 records per dataset")).toBeVisible();

  await page.getByRole("radio", { name: /Deep audit/ }).check();
  await expect(page.getByText("Requests up to 2,000 records per dataset")).toBeVisible();
});
```

- [ ] **Step 2: Run targeted unit/component tests**

Run:

```bash
pnpm test -- src/domain/reportRunPresets.test.ts src/domain/reportScope.test.ts src/api/stackApiV2.test.ts src/api/stackApiV3.test.ts src/collectors/liveReportRunner.test.ts src/server/reportRunApi.test.ts src/reports/reportTransforms.test.ts src/importers/reportImporters.test.ts src/utils/reportDownloads.test.ts src/domain/sessionStore.test.ts src/components/ReportScopePanel.test.tsx src/components/RunStatus.test.tsx src/components/ReportWorkspace.test.tsx src/components/ReportDashboard.test.tsx src/components/AppShell.test.tsx
```

Expected: PASS.

- [ ] **Step 3: Run full verification**

Run:

```bash
pnpm test
pnpm lint
pnpm build
```

Expected: all commands exit 0.

- [ ] **Step 4: Run e2e if browser dependencies are available**

Run:

```bash
pnpm e2e
```

Expected: PASS. If Playwright browser binaries are missing, run the project’s existing Playwright setup command only with user approval for network/download access.

- [ ] **Step 5: Inspect the UI in the browser**

Start the dev server:

```bash
pnpm dev
```

Open the local app in the in-app browser at the printed localhost URL. Verify:

- Tag Report shows Quick sample, Standard report, and Deep audit.
- Each preset exposes technical API settings without relying on hover alone.
- Advanced API volume settings expand and show numeric controls.
- Running Tag Report shows a progress bar while the request is pending.
- Capped-data warnings render above the Tag Report dashboard/export controls.
- Download Tag Health CSV appears only when Tag Report has rows.
- Raw dataset downloads remain in the Datasets panel.

- [ ] **Step 6: Commit e2e verification changes**

```bash
git add e2e/reporting-mvp.spec.ts
git commit -m "Verify guided Tag Report workflow"
```

- [ ] **Step 7: Final status**

Run:

```bash
git status --short
git log --oneline --decorate -6
```

Expected: clean worktree after the planned commits.
