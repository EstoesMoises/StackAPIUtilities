# Scoped Report Runs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add report scope controls, current/comparison scoped live runs, manageable session datasets, and generic dashboard comparison cards.

**Progress:**
- [x] Task 1: Scope Types And Validation
- [x] Task 2: Scoped API Runner Contract
- [x] Task 3: Report Scope Controls
- [x] Task 4: Session Snapshots And Dataset Management
- [x] Task 5: Generic Comparison Dashboard Cards
- [ ] Task 6: Final Verification And E2E

**Architecture:** Scope is modeled in `src/domain/types.ts` and validated in a small domain helper. The client sends one scoped period run per request to `/api/reports/run`; the server runner applies pagination/date limits and returns snapshot metadata. Session state stores current and comparison snapshots, while the report workspace and Datasets panel render those snapshots.

**Tech Stack:** Next.js App Router, React 18, TypeScript, Vitest, Testing Library, Playwright.

---

## File Structure

- Modify `src/domain/types.ts`: add `RunPeriodRole`, `PeriodScope`, `ReportRunScope`, `ReportRunSnapshot`, and scope metadata on datasets/outputs.
- Create `src/domain/reportScope.ts`: defaults, validation, date conversion, and labels.
- Modify `src/api/stackApiV2.ts` and `src/api/stackApiV3.ts`: support `maxPages`.
- Modify `src/collectors/liveCollectors.ts`: accept scope context and map `pagesize`, `fromdate`, `todate`, and `maxPages`.
- Modify `src/collectors/liveReportRunner.ts`: accept period role and scope, return warnings and scope metadata.
- Modify `src/server/reportRunApi.ts`: validate scoped request payload.
- Create `src/components/ReportScopePanel.tsx`: current/comparison date and volume controls.
- Create `src/components/DatasetsPanel.tsx`: dataset inventory and preview/remove controls.
- Modify `src/components/AppShell.tsx`: add `datasets` top-level panel.
- Modify `src/App.tsx`: manage report scope form state, run current/comparison/both, and route Datasets panel actions.
- Modify `src/components/ReportDashboard.tsx`: render generic comparison cards from current/comparison records.
- Update tests in matching `*.test.ts` files and `e2e/reporting-mvp.spec.ts`.

---

### Task 1: Scope Types And Validation

**Files:**
- Modify: `src/domain/types.ts`
- Create: `src/domain/reportScope.ts`
- Test: `src/domain/reportScope.test.ts`

- [ ] **Step 1: Write failing scope validation tests**

Create `src/domain/reportScope.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  DEFAULT_REPORT_RUN_SCOPE,
  dateToUnixSeconds,
  formatPeriodLabel,
  validateReportRunScope,
} from "./reportScope";

describe("report scope", () => {
  it("accepts the default scope", () => {
    expect(validateReportRunScope(DEFAULT_REPORT_RUN_SCOPE)).toEqual({ valid: true, messages: [] });
  });

  it("rejects invalid page limits and reversed date ranges", () => {
    expect(
      validateReportRunScope({
        current: { startDate: "2026-04-30", endDate: "2026-04-01" },
        pageSize: 0,
        maxPagesPerDataset: 0,
      }),
    ).toEqual({
      valid: false,
      messages: [
        "Page size must be between 1 and 100.",
        "Max pages per dataset must be at least 1.",
        "Current period end date must be on or after its start date.",
      ],
    });
  });

  it("converts YYYY-MM-DD dates to Stack API epoch seconds", () => {
    expect(dateToUnixSeconds("1970-01-02")).toBe(86400);
  });

  it("formats explicit and all-history period labels", () => {
    expect(formatPeriodLabel({ startDate: "2026-01-01", endDate: "2026-03-31" })).toBe("2026-01-01 to 2026-03-31");
    expect(formatPeriodLabel({})).toBe("All available history");
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `env CI=true pnpm test -- src/domain/reportScope.test.ts`

Expected: FAIL because `src/domain/reportScope.ts` does not exist.

- [ ] **Step 3: Add scope types**

In `src/domain/types.ts`, add:

```ts
export type RunPeriodRole = "current" | "comparison";

export interface PeriodScope {
  startDate?: string;
  endDate?: string;
}

export interface ReportRunScope {
  current: PeriodScope;
  comparison?: PeriodScope;
  pageSize: number;
  maxPagesPerDataset: number;
}
```

Extend `SessionDataset`, `ReportOutput`, and `RunQueueItem` later in Task 4.

- [ ] **Step 4: Implement scope helper**

Create `src/domain/reportScope.ts`:

```ts
import type { PeriodScope, ReportRunScope } from "./types";

export const DEFAULT_REPORT_RUN_SCOPE: ReportRunScope = {
  current: {},
  pageSize: 100,
  maxPagesPerDataset: 5,
};

interface ValidationResult {
  valid: boolean;
  messages: string[];
}

export function validateReportRunScope(scope: ReportRunScope): ValidationResult {
  const messages: string[] = [];

  if (!Number.isInteger(scope.pageSize) || scope.pageSize < 1 || scope.pageSize > 100) {
    messages.push("Page size must be between 1 and 100.");
  }

  if (!Number.isInteger(scope.maxPagesPerDataset) || scope.maxPagesPerDataset < 1) {
    messages.push("Max pages per dataset must be at least 1.");
  }

  validatePeriod("Current period", scope.current, messages);
  if (scope.comparison) validatePeriod("Comparison period", scope.comparison, messages);

  return { valid: messages.length === 0, messages };
}

export function dateToUnixSeconds(date: string): number {
  return Math.floor(new Date(`${date}T00:00:00.000Z`).getTime() / 1000);
}

export function formatPeriodLabel(scope: PeriodScope): string {
  if (scope.startDate && scope.endDate) return `${scope.startDate} to ${scope.endDate}`;
  if (scope.startDate) return `From ${scope.startDate}`;
  if (scope.endDate) return `Through ${scope.endDate}`;
  return "All available history";
}

function validatePeriod(label: string, scope: PeriodScope, messages: string[]) {
  if (scope.startDate && !isValidDate(scope.startDate)) messages.push(`${label} start date must use YYYY-MM-DD.`);
  if (scope.endDate && !isValidDate(scope.endDate)) messages.push(`${label} end date must use YYYY-MM-DD.`);
  if (
    scope.startDate &&
    scope.endDate &&
    isValidDate(scope.startDate) &&
    isValidDate(scope.endDate) &&
    scope.endDate < scope.startDate
  ) {
    messages.push(`${label} end date must be on or after its start date.`);
  }
}

function isValidDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(new Date(`${value}T00:00:00.000Z`).getTime());
}
```

- [ ] **Step 5: Run tests to verify pass**

Run: `env CI=true pnpm test -- src/domain/reportScope.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/domain/types.ts src/domain/reportScope.ts src/domain/reportScope.test.ts
git commit -m "Add report scope validation"
```

---

### Task 2: Scoped API Runner Contract

**Files:**
- Modify: `src/api/stackApiV2.ts`
- Modify: `src/api/stackApiV2.test.ts`
- Modify: `src/api/stackApiV3.ts`
- Modify: `src/api/stackApiV3.test.ts`
- Modify: `src/collectors/liveCollectors.ts`
- Modify: `src/collectors/datasetPlanner.test.ts`
- Modify: `src/collectors/liveReportRunner.ts`
- Modify: `src/collectors/liveReportRunner.test.ts`
- Modify: `src/server/reportRunApi.ts`
- Modify: `src/server/reportRunApi.test.ts`

- [ ] **Step 1: Write failing tests for max pages and scoped payload**

Add tests that assert:

```ts
await client.getPagedItems("/users", { pagesize: "50" }, { maxPages: 1 });
expect(fetchMock).toHaveBeenCalledTimes(1);
```

and:

```ts
const result = await runLiveReport("inactive-users", basicCredentials, {
  periodRole: "current",
  scope: { startDate: "2026-01-01", endDate: "2026-01-31" },
  pageSize: 50,
  maxPagesPerDataset: 1,
  fetchFn: fetchMock,
});
expect(result.periodRole).toBe("current");
expect(result.scope).toEqual({ startDate: "2026-01-01", endDate: "2026-01-31" });
expect(fetchMock.mock.calls[0][0].toString()).toContain("pagesize=50");
expect(fetchMock.mock.calls[0][0].toString()).toContain("fromdate=1767225600");
expect(fetchMock.mock.calls[0][0].toString()).toContain("todate=1769817600");
```

Also add an API handler test that invalid scope returns `400`.

- [ ] **Step 2: Run scoped runner tests to verify failure**

Run: `env CI=true pnpm test -- src/api/stackApiV2.test.ts src/api/stackApiV3.test.ts src/collectors/liveReportRunner.test.ts src/server/reportRunApi.test.ts`

Expected: FAIL because signatures and payload validation are not implemented.

- [ ] **Step 3: Implement max page support in API clients**

Add:

```ts
interface PagingOptions {
  maxPages?: number;
}
```

Update `getPagedItems` signatures in both clients to:

```ts
async getPagedItems<T = unknown>(
  path: string,
  query: Record<string, string> = {},
  options: PagingOptions = {},
): Promise<T[]>
```

Stop loops when `page > (options.maxPages ?? Number.POSITIVE_INFINITY)`.

- [ ] **Step 4: Implement scoped collector query**

Update `LiveCollectorContext`:

```ts
periodRole?: RunPeriodRole;
scope?: PeriodScope;
pageSize?: number;
maxPagesPerDataset?: number;
```

Use:

```ts
const query = buildDatasetQuery(context);
return clients[endpoint.client].getPagedItems(endpoint.path, query, { maxPages: context.maxPagesPerDataset });
```

where `buildDatasetQuery` adds `pagesize`, `fromdate`, and `todate`.

- [ ] **Step 5: Implement runner response metadata**

Extend `LiveReportRunResult` with:

```ts
periodRole: RunPeriodRole;
scope: PeriodScope;
pageSize: number;
maxPagesPerDataset: number;
warnings: ReportWarning[];
```

Default role is `"current"`, default scope comes from `DEFAULT_REPORT_RUN_SCOPE.current`.

- [ ] **Step 6: Validate API payload**

Accept `periodRole`, `scope`, `pageSize`, and `maxPagesPerDataset` in `src/server/reportRunApi.ts`; call `validateReportRunScope` against a single-period wrapper before running.

- [ ] **Step 7: Run tests to verify pass**

Run: `env CI=true pnpm test -- src/api/stackApiV2.test.ts src/api/stackApiV3.test.ts src/collectors/liveReportRunner.test.ts src/server/reportRunApi.test.ts`

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/api/stackApiV2.ts src/api/stackApiV2.test.ts src/api/stackApiV3.ts src/api/stackApiV3.test.ts src/collectors/liveCollectors.ts src/collectors/datasetPlanner.test.ts src/collectors/liveReportRunner.ts src/collectors/liveReportRunner.test.ts src/server/reportRunApi.ts src/server/reportRunApi.test.ts
git commit -m "Support scoped live report API runs"
```

---

### Task 3: Report Scope Controls

**Files:**
- Create: `src/components/ReportScopePanel.tsx`
- Create: `src/components/ReportScopePanel.test.tsx`
- Modify: `src/components/ReportWorkspace.tsx`
- Modify: `src/components/ReportWorkspace.test.tsx`
- Modify: `src/App.tsx`
- Modify: `src/components/AppShell.test.tsx`

- [ ] **Step 1: Write failing component tests**

Create `src/components/ReportScopePanel.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_REPORT_RUN_SCOPE } from "../domain/reportScope";
import { ReportScopePanel } from "./ReportScopePanel";

describe("ReportScopePanel", () => {
  it("edits current period and volume controls", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    render(<ReportScopePanel scope={DEFAULT_REPORT_RUN_SCOPE} onChange={onChange} />);

    await user.type(screen.getByLabelText("Current start date"), "2026-01-01");
    await user.clear(screen.getByLabelText("Page size"));
    await user.type(screen.getByLabelText("Page size"), "50");

    expect(onChange).toHaveBeenCalled();
  });

  it("enables comparison period controls", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    render(<ReportScopePanel scope={DEFAULT_REPORT_RUN_SCOPE} onChange={onChange} />);
    await user.click(screen.getByLabelText("Enable comparison period"));

    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ comparison: {} }));
  });
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `env CI=true pnpm test -- src/components/ReportScopePanel.test.tsx`

Expected: FAIL because component does not exist.

- [ ] **Step 3: Implement `ReportScopePanel`**

Create the component with labeled date inputs, checkbox, number inputs, and validation messages from `validateReportRunScope`.

- [ ] **Step 4: Wire workspace actions**

Change `ReportWorkspace` props:

```ts
scope: ReportRunScope;
onScopeChange: (scope: ReportRunScope) => void;
onRun: (periodRole: RunPeriodRole) => void;
onRunBoth: () => void;
```

Render buttons:

- `Run current period`
- `Run comparison period`
- `Run both periods`

- [ ] **Step 5: Wire App request payloads**

Store `reportScope` with `useState(DEFAULT_REPORT_RUN_SCOPE)`. Send one request for the requested period role. For `Run both`, call current then comparison.

- [ ] **Step 6: Run tests**

Run: `env CI=true pnpm test -- src/components/ReportScopePanel.test.tsx src/components/ReportWorkspace.test.tsx src/components/AppShell.test.tsx`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/components/ReportScopePanel.tsx src/components/ReportScopePanel.test.tsx src/components/ReportWorkspace.tsx src/components/ReportWorkspace.test.tsx src/App.tsx src/components/AppShell.test.tsx
git commit -m "Add report run scope controls"
```

---

### Task 4: Session Snapshots And Dataset Management

**Files:**
- Modify: `src/domain/types.ts`
- Modify: `src/domain/sessionStore.ts`
- Modify: `src/domain/sessionStore.test.ts`
- Create: `src/components/DatasetsPanel.tsx`
- Create: `src/components/DatasetsPanel.test.tsx`
- Modify: `src/components/AppShell.tsx`
- Modify: `src/components/AppShell.test.tsx`
- Modify: `src/App.tsx`

- [ ] **Step 1: Write failing session tests**

Add tests in `src/domain/sessionStore.test.ts`:

```ts
it("stores current and comparison live run snapshots separately", () => {
  let state = createInitialSessionState();
  state = sessionReducer(state, {
    type: "live/loaded",
    reportId: "inactive-users",
    periodRole: "current",
    scope: { startDate: "2026-01-01", endDate: "2026-01-31" },
    pageSize: 50,
    maxPagesPerDataset: 1,
    warnings: [],
    datasets: [{ datasetName: "users", records: [{ user_id: 1 }] }],
  });
  state = sessionReducer(state, {
    type: "live/loaded",
    reportId: "inactive-users",
    periodRole: "comparison",
    scope: { startDate: "2025-01-01", endDate: "2025-01-31" },
    pageSize: 50,
    maxPagesPerDataset: 1,
    warnings: [],
    datasets: [{ datasetName: "users", records: [{ user_id: 2 }] }],
  });

  expect(state.reportRunSnapshots).toHaveLength(2);
  expect(state.reportOutputs["inactive-users"]?.comparisonRecords).toEqual([
    { datasetName: "users", user_id: 2 },
  ]);
});
```

- [ ] **Step 2: Write failing dataset panel test**

Create `src/components/DatasetsPanel.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { SessionDataset } from "../domain/types";
import { DatasetsPanel } from "./DatasetsPanel";

describe("DatasetsPanel", () => {
  it("lists datasets and removes one from the session", async () => {
    const user = userEvent.setup();
    const onRemove = vi.fn();
    const datasets: SessionDataset[] = [{
      id: "snapshot-1-users-current",
      snapshotId: "snapshot-1",
      reportId: "inactive-users",
      periodRole: "current",
      name: "users",
      records: [{ user_id: 1 }],
      loadedAt: "2026-07-03T00:00:00.000Z",
      source: "live-api",
      scope: { startDate: "2026-01-01", endDate: "2026-01-31" },
      warnings: [],
    }];

    render(<DatasetsPanel datasets={datasets} onRemoveDataset={onRemove} />);

    expect(screen.getByText("users")).toBeInTheDocument();
    expect(screen.getByText("inactive-users")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Remove users current dataset" }));
    expect(onRemove).toHaveBeenCalledWith("snapshot-1-users-current");
  });
});
```

- [ ] **Step 3: Run tests to verify failure**

Run: `env CI=true pnpm test -- src/domain/sessionStore.test.ts src/components/DatasetsPanel.test.tsx`

Expected: FAIL.

- [ ] **Step 4: Implement snapshot state**

Add `reportRunSnapshots` to `SessionState`, dataset ids, `dataset/remove`, and snapshot-aware `live/loaded`.

- [ ] **Step 5: Implement `DatasetsPanel`**

Render a table with dataset name, report, period role, date range, source, records, loaded timestamp, warnings, preview, and remove button.

- [ ] **Step 6: Add `datasets` navigation**

Update `AppPanel = "report" | "credentials" | "uploads" | "datasets"` and wire `DatasetsPanel` in `App.tsx`.

- [ ] **Step 7: Run tests**

Run: `env CI=true pnpm test -- src/domain/sessionStore.test.ts src/components/DatasetsPanel.test.tsx src/components/AppShell.test.tsx`

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/domain/types.ts src/domain/sessionStore.ts src/domain/sessionStore.test.ts src/components/DatasetsPanel.tsx src/components/DatasetsPanel.test.tsx src/components/AppShell.tsx src/components/AppShell.test.tsx src/App.tsx
git commit -m "Add session dataset management"
```

---

### Task 5: Generic Comparison Dashboard Cards

**Files:**
- Modify: `src/components/ReportDashboard.tsx`
- Modify: `src/components/ReportWorkspace.tsx`
- Modify: `src/components/ReportWorkspace.test.tsx`
- Modify: `src/domain/sessionStore.ts`
- Modify: `src/domain/sessionStore.test.ts`

- [ ] **Step 1: Write failing dashboard comparison test**

Add to `src/components/ReportWorkspace.test.tsx`:

```tsx
it("shows comparison deltas when current and comparison records are available", () => {
  render(
    <ReportWorkspace
      reportId="inactive-users"
      records={[{ datasetName: "users", user_id: 1 }, { datasetName: "users", user_id: 2 }]}
      comparisonRecords={[{ datasetName: "users", user_id: 3 }]}
      outputSource="live-api"
      scope={DEFAULT_REPORT_RUN_SCOPE}
      onScopeChange={() => undefined}
      onRun={() => undefined}
      onRunBoth={() => undefined}
    />,
  );

  expect(screen.getByText("Comparison")).toBeInTheDocument();
  expect(screen.getByText("+1")).toBeInTheDocument();
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `env CI=true pnpm test -- src/components/ReportWorkspace.test.tsx`

Expected: FAIL because comparison props/cards do not exist.

- [ ] **Step 3: Add comparison props**

Add `comparisonRecords?: Record<string, unknown>[]` and `comparisonScope?: PeriodScope` to `ReportWorkspace` and `ReportDashboard`.

- [ ] **Step 4: Render generic comparison cards**

For live outputs, render:

- Current records
- Comparison records
- Delta

Use signed formatting: `+1`, `0`, `-3`.

- [ ] **Step 5: Run tests**

Run: `env CI=true pnpm test -- src/components/ReportWorkspace.test.tsx`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/ReportDashboard.tsx src/components/ReportWorkspace.tsx src/components/ReportWorkspace.test.tsx src/domain/sessionStore.ts src/domain/sessionStore.test.ts
git commit -m "Add generic report comparison cards"
```

---

### Task 6: Final Verification And E2E

**Files:**
- Modify: `e2e/reporting-mvp.spec.ts`
- Modify: `README.md`

- [ ] **Step 1: Add e2e coverage**

Extend `e2e/reporting-mvp.spec.ts` to assert scope controls and Datasets navigation:

```ts
await expect(page.getByLabel("Current start date")).toBeVisible();
await expect(page.getByLabel("Page size")).toBeVisible();
await expect(page.getByRole("button", { name: "Datasets" })).toBeVisible();
```

- [ ] **Step 2: Update README**

Document:

- scoped current/comparison runs
- page size and max pages controls
- session-only Datasets panel

- [ ] **Step 3: Run full verification**

Run:

```bash
env CI=true pnpm test
env CI=true pnpm lint
env CI=true pnpm build
env CI=true pnpm e2e
```

Expected: all pass.

- [ ] **Step 4: Restart dev server**

Run:

```bash
./node_modules/.bin/next dev -H 127.0.0.1 -p 5180
```

Expected: app is ready at `http://127.0.0.1:5180/`.

- [ ] **Step 5: Commit final docs/e2e polish**

```bash
git add e2e/reporting-mvp.spec.ts README.md
git commit -m "Document scoped report workflows"
```
