# Script Report Command Center Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move generated Script results onto the shared Report Command Center so every large report has direct CSV export, clear Overview/Evidence navigation, and bounded table exploration.

**Architecture:** Reuse `ReportCommandCenter`, `ReportExportBar`, and `ReportEvidenceExplorer` delivered by the SME plan. Add a pure Script presentation adapter for result identity, quality, sections, and export capability; keep existing specialized dashboards as Overview content; and replace the raw unbounded `DataTable` with the shared explorer. The configuration/run workspace remains separate and unchanged in behavior.

**Tech Stack:** Next.js 14, React 18, TypeScript, Stack Overflow Stacks CSS, TanStack React Table, Vitest, Testing Library, Playwright.

**Prerequisite:** Complete `docs/superpowers/plans/2026-08-20-sme-report-command-center.md` first.

---

## File Structure

- Create `src/reports/scriptReportPresentation.ts`: pure Script result identity, quality, section, and export metadata.
- Create `src/reports/scriptReportPresentation.test.ts`: live, legacy, upload, empty, and comparison-only adapter tests.
- Modify `src/components/ReportExportBar.tsx`: allow a report-specific direct CSV label.
- Modify `src/components/ReportExportBar.test.tsx`: label override coverage.
- Modify `src/components/DataTable.tsx`: dynamic-column configuration over `ReportEvidenceExplorer`.
- Create `src/components/DataTable.test.tsx`: dynamic fields, pagination, search, sorting, and immutability tests.
- Modify `src/components/ReportWorkspace.tsx`: split setup and generated result, compose Overview/Evidence command-center sections, and expose CSV directly.
- Modify `src/components/ReportWorkspace.test.tsx`: command-center, export, empty-result, comparison, and navigation tests.
- Modify `src/App.tsx`: pass the canonical output dataset name into `ReportWorkspace`.
- Modify `src/styles/app.css`: Script result spacing and responsive integration.
- Modify `e2e/reporting-mvp.spec.ts`: new section labels, direct CSV download, large-table pagination, and mobile overflow.

## Task 1: Add Script Presentation Metadata

**Files:**
- Create: `src/reports/scriptReportPresentation.ts`
- Create: `src/reports/scriptReportPresentation.test.ts`

- [ ] **Step 1: Write the failing adapter tests**

```ts
import { describe, expect, it } from "vitest";
import { createScriptReportPresentation } from "./scriptReportPresentation";

describe("createScriptReportPresentation", () => {
  it("describes an exhaustive live result with Overview and Evidence", () => {
    const result = createScriptReportPresentation({
      reportId: "inactive-users",
      records: [{ datasetName: "users", user_id: 1 }],
      loadedAt: "2026-08-20T12:00:00.000Z",
      outputSource: "live-api",
      currentScope: { startDate: "2026-08-01", endDate: "2026-08-20" },
      warnings: [],
    });
    expect(result.qualityLabel).toBe("All available data collected");
    expect(result.availableSections).toEqual(["overview", "evidence"]);
    expect(result.exports).toEqual({ pdf: false, csv: true, markdown: false });
  });

  it("labels legacy and uploaded results without overstating completeness", () => {
    const legacy = createScriptReportPresentation({
      reportId: "inactive-users",
      records: [{ user_id: 1 }],
      loadedAt: "2026-08-20T12:00:00.000Z",
      outputSource: "live-api",
      warnings: [{
        reportId: "inactive-users",
        code: "collection.legacy-unverified",
        message: "Legacy run — completeness not verified under current collection rules.",
      }],
    });
    const upload = createScriptReportPresentation({
      reportId: "inactive-users",
      records: [{ user_id: 1 }],
      loadedAt: "2026-08-20T12:00:00.000Z",
      outputSource: "upload",
      warnings: [],
    });
    expect(legacy.qualityLabel).toMatch(/Legacy/);
    expect(legacy.qualityTone).toBe("warning");
    expect(upload.qualityLabel).toBe("Uploaded result");
  });
});
```

- [ ] **Step 2: Run the tests and verify the missing-module failure**

Run: `pnpm vitest run src/reports/scriptReportPresentation.test.ts`

Expected: FAIL because `scriptReportPresentation.ts` does not exist.

- [ ] **Step 3: Implement the pure adapter**

```ts
// src/reports/scriptReportPresentation.ts
import { isLegacyCollectionWarning } from "../domain/collectionWarnings";
import { formatPeriodLabel } from "../domain/reportScope";
import { reportRegistry } from "../domain/reportRegistry";
import type { PeriodScope, ReportId, ReportWarning } from "../domain/types";
import type { ReportPresentationModel } from "./reportPresentation";

interface ScriptPresentationInput {
  reportId: ReportId;
  records: readonly Record<string, unknown>[];
  comparisonRecords?: readonly Record<string, unknown>[];
  loadedAt: string;
  outputSource: "live-api" | "upload";
  currentScope?: PeriodScope;
  comparisonScope?: PeriodScope;
  warnings: readonly ReportWarning[];
}

export function createScriptReportPresentation(
  input: ScriptPresentationInput,
): ReportPresentationModel<Record<string, unknown>, never> {
  const report = reportRegistry.find((candidate) => candidate.id === input.reportId)!;
  const legacy = input.warnings.some((warning) => isLegacyCollectionWarning(warning, input.reportId));
  const qualityLabel = input.outputSource === "upload"
    ? "Uploaded result"
    : legacy
      ? "Legacy result — completeness unverified"
      : "All available data collected";
  const evidence = input.records.length > 0 ? input.records : input.comparisonRecords ?? [];
  return {
    reportKey: `${input.reportId}:${input.loadedAt}:${input.currentScope?.startDate ?? ""}:${input.comparisonScope?.startDate ?? ""}`,
    kindLabel: "Script report",
    title: report.title,
    sourceLabel: report.sourceRepo,
    generatedAt: input.loadedAt,
    scopeLabel: input.currentScope
      ? formatPeriodLabel(input.currentScope)
      : input.comparisonScope
        ? `Comparison: ${formatPeriodLabel(input.comparisonScope)}`
        : "All available history",
    collectionLabel: qualityLabel,
    qualityLabel,
    qualityTone: legacy ? "warning" : input.outputSource === "live-api" ? "success" : "neutral",
    rowCount: evidence.length,
    warnings: input.warnings,
    metrics: [],
    overview: report.description,
    findings: [],
    evidence,
    availableSections: ["overview", ...(evidence.length > 0 ? (["evidence"] as const) : [])],
    exports: { pdf: false, csv: evidence.length > 0, markdown: false },
  };
}
```

- [ ] **Step 4: Run the adapter tests**

Run: `pnpm vitest run src/reports/scriptReportPresentation.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit the adapter**

```bash
git add src/reports/scriptReportPresentation.ts src/reports/scriptReportPresentation.test.ts
git commit -m "feat: add Script report presentation metadata"
```

## Task 2: Move Generic Tables Onto the Evidence Explorer

**Files:**
- Modify: `src/components/DataTable.tsx`
- Create: `src/components/DataTable.test.tsx`
- Modify: `src/components/ReportExportBar.tsx`
- Modify: `src/components/ReportExportBar.test.tsx`

- [ ] **Step 1: Write failing dynamic-table tests**

```tsx
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it } from "vitest";
import { DataTable } from "./DataTable";

it("paginates dynamic report fields and preserves records", async () => {
  const user = userEvent.setup();
  const records = Array.from({ length: 55 }, (_, index) => ({
    user_id: index + 1,
    display_name: `User ${index + 1}`,
    department: index % 2 === 0 ? "Engineering" : "Product",
  }));
  const before = JSON.stringify(records);
  render(<DataTable records={records} />);
  const region = screen.getByRole("region", { name: "Report evidence table" });
  expect(within(region).getAllByRole("row")).toHaveLength(51);
  expect(screen.getByText("Rows 1–50 of 55")).toBeVisible();
  await user.click(screen.getByRole("button", { name: "Next page" }));
  expect(screen.getByText("Rows 51–55 of 55")).toBeVisible();
  await user.type(screen.getByRole("searchbox", { name: "Search evidence" }), "User 3");
  expect(screen.getByRole("cell", { name: "User 3" })).toBeVisible();
  expect(JSON.stringify(records)).toBe(before);
});
```

Add a `ReportExportBar` test that passes `csvLabel="Export report CSV"` and asserts that exact direct label.

- [ ] **Step 2: Run the tests and verify failures**

Run: `pnpm vitest run src/components/DataTable.test.tsx src/components/ReportExportBar.test.tsx`

Expected: FAIL because `DataTable` is unpaginated and `csvLabel` is unsupported.

- [ ] **Step 3: Configure dynamic columns on the generic explorer**

```tsx
// src/components/DataTable.tsx
import { useMemo } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { ReportEvidenceExplorer } from "./ReportEvidenceExplorer";

export function DataTable({ records }: { records: Record<string, unknown>[] }) {
  const keys = useMemo(
    () => Array.from(new Set(records.flatMap((record) => Object.keys(record)))),
    [records],
  );
  const columns = useMemo<ColumnDef<Record<string, unknown>>[]>(
    () => keys.map((key) => ({
      id: key,
      accessorFn: (record) => record[key],
      header: key,
      cell: ({ getValue }) => String(getValue() ?? ""),
    })),
    [keys],
  );
  const defaultColumnVisibility = useMemo(
    () => Object.fromEntries(keys.map((key, index) => [key, index < 8])),
    [keys],
  );

  if (records.length === 0) return <div className="empty-panel" role="status">No records loaded yet.</div>;
  return (
    <ReportEvidenceExplorer
      rows={records}
      columns={columns}
      defaultColumnVisibility={defaultColumnVisibility}
      ariaLabel="Report evidence table"
      emptyMessage="No records match the current search."
    />
  );
}
```

- [ ] **Step 4: Add the export label override**

Add `csvLabel?: string` to `ReportExportBarProps` and render `props.csvLabel ?? "Export evidence CSV"` inside the direct CSV button.

- [ ] **Step 5: Run the focused tests**

Run: `pnpm vitest run src/components/DataTable.test.tsx src/components/ReportExportBar.test.tsx`

Expected: PASS.

- [ ] **Step 6: Commit the shared Script table behavior**

```bash
git add src/components/DataTable.tsx src/components/DataTable.test.tsx src/components/ReportExportBar.tsx src/components/ReportExportBar.test.tsx
git commit -m "feat: bound generic report evidence tables"
```

## Task 3: Compose Script Results in the Command Center

**Files:**
- Modify: `src/components/ReportWorkspace.tsx`
- Modify: `src/components/ReportWorkspace.test.tsx`
- Modify: `src/App.tsx`
- Modify: `src/styles/app.css`

- [ ] **Step 1: Write failing workspace tests**

Update `ReportWorkspace.test.tsx` so a populated Tag Report asserts:

```tsx
expect(screen.getByRole("region", { name: "Generated report" })).toBeInTheDocument();
expect(screen.getByRole("button", { name: "Export report CSV" })).toBeVisible();
expect(screen.getByRole("tab", { name: "Overview" })).toHaveAttribute("aria-selected", "true");
expect(screen.getByRole("tab", { name: "Evidence · 1" })).toBeVisible();
await user.click(screen.getByRole("tab", { name: "Evidence · 1" }));
expect(screen.getByRole("region", { name: "Report evidence table" })).toBeVisible();
```

Assert the run/scope controls remain in a separate `workspace-panel`, an absent `loadedAt` renders no command center, and an empty but loaded result renders Overview without an Evidence tab. Update the CSV mock assertion to cover every report, using the passed `datasetName` and falling back to comparison records only when current records are empty.

- [ ] **Step 2: Run workspace tests and verify failures**

Run: `pnpm vitest run src/components/ReportWorkspace.test.tsx`

Expected: FAIL against the current combined workspace and Dashboard/Raw Table tabs.

- [ ] **Step 3: Add canonical dataset identity to the workspace boundary**

Add `datasetName?: DatasetName` to `ReportWorkspaceProps`. In `App.tsx`, pass:

```tsx
datasetName={selectedReportOutput?.datasetName}
```

Do not infer the dataset from record keys.

- [ ] **Step 4: Split configuration and generated result rendering**

Keep the existing heading, description, readiness, scope, run controls, and collection status in the first `workspace-panel`. Remove the old Tag-only download placement and Dashboard/Raw Table tab state. When `loadedAt` and `outputSource` exist, create the presentation and render a sibling command center:

```tsx
const presentation = loadedAt && outputSource
  ? createScriptReportPresentation({
      reportId,
      records,
      comparisonRecords,
      loadedAt,
      outputSource,
      currentScope,
      comparisonScope,
      warnings: warnings ?? [],
    })
  : undefined;

const exportRecords = records.length > 0 ? records : comparisonRecords ?? [];
const exportPeriodRole = records.length > 0 ? "current" : "comparison";
```

Build sections:

```tsx
const sections: ReportCommandCenterSection[] = [
  {
    id: "overview",
    label: "Overview",
    content: (
      <ReportDashboard
        reportId={reportId}
        records={records}
        comparisonRecords={comparisonRecords}
        currentScope={currentScope}
        comparisonScope={comparisonScope}
        outputSource={outputSource}
        warnings={warnings}
      />
    ),
  },
  ...(presentation.evidence.length > 0 ? [{
    id: "evidence" as const,
    label: `Evidence · ${presentation.rowCount.toLocaleString("en-US")}`,
    content: <DataTable records={[...presentation.evidence]} />,
  }] : []),
];
```

The header shows Script report, title, source repo, generated date, scope, quality, and direct CSV. `ReportExportBar` receives no PDF/Markdown callbacks and uses `csvLabel="Export report CSV"`.

- [ ] **Step 5: Wire direct CSV with feedback**

```tsx
function exportCsv() {
  if (!datasetName || !loadedAt || !outputSource) return;
  try {
    downloadReportCsv({
      reportId,
      datasetName,
      records: [...exportRecords],
      loadedAt,
      source: outputSource,
      periodRole: exportPeriodRole,
      currentScope,
      comparisonScope,
    });
    setExportFeedback({ state: "success", message: `CSV download started for ${exportRecords.length.toLocaleString("en-US")} rows.` });
  } catch {
    setExportFeedback({ state: "failed", message: "The CSV download could not start. Check browser download permissions and try again." });
  }
}
```

Reset export feedback when `presentation.reportKey` changes.

- [ ] **Step 6: Add Script integration styles**

Use `.workspace-stack` spacing between configuration and command center. Remove `.report-tabs`, `.raw-table-panel`, `.workspace-actions`, and `.report-download-button` styles only after `rg` confirms no remaining consumers. At phone widths, use the same full-width direct export treatment as SME results.

- [ ] **Step 7: Run component and application tests**

Run: `pnpm vitest run src/components/ReportWorkspace.test.tsx src/components/DataTable.test.tsx src/components/AppShell.test.tsx`

Expected: PASS.

- [ ] **Step 8: Commit Script command-center integration**

```bash
git add src/components/ReportWorkspace.tsx src/components/ReportWorkspace.test.tsx src/App.tsx src/styles/app.css
git commit -m "feat: move Script results into report command center"
```

## Task 4: Update End-to-End and Finish Verification

**Files:**
- Modify: `e2e/reporting-mvp.spec.ts`
- Modify only additional files identified by the bounded verification pass.

- [ ] **Step 1: Update section navigation assertions**

Replace `Raw Table` interactions with the populated Evidence label:

```ts
await page.getByRole("tab", { name: "Evidence · 2" }).click();
await expect(page.getByRole("cell", { name: "page-one-tag", exact: true })).toBeVisible();
await expect(page.getByRole("cell", { name: "page-two-tag", exact: true })).toBeVisible();
```

Keep collection-status and period-comparison assertions in Overview.

- [ ] **Step 2: Add direct Script CSV coverage**

```ts
const csvDownloadPromise = page.waitForEvent("download");
await page.getByRole("button", { name: "Export report CSV" }).click();
const csvDownload = await csvDownloadPromise;
expect(csvDownload.suggestedFilename()).toBe("tag-report-tag-health-current-2026-08-20.csv");
```

Assert the success live region names the exported row count.

- [ ] **Step 3: Add large generic evidence coverage**

Return 120 tag records from the mocked route. Open Evidence, verify `Rows 1–50 of 120`, advance to `Rows 51–100 of 120`, search for the last tag, and reveal a ninth dynamic column through `Columns` in a test fixture that includes at least nine keys.

- [ ] **Step 4: Add narrow viewport coverage**

At 375px, assert the setup panel appears before the result, `Export report CSV` is visible and full-width, tabs wrap without clipped labels, the evidence region can scroll internally, and `document.documentElement.scrollWidth <= 375`.

- [ ] **Step 5: Run focused and full verification**

Run: `pnpm exec playwright test e2e/reporting-mvp.spec.ts`

Expected: PASS.

Run: `pnpm test`

Expected: all Vitest tests PASS.

Run: `pnpm lint`

Expected: TypeScript checks PASS.

Run: `pnpm build`

Expected: Next.js build succeeds.

Run: `pnpm e2e`

Expected: all Playwright tests PASS.

- [ ] **Step 6: Perform one bounded desktop/mobile visual pass**

Load the Impeccable craft-floor reference before any UI edit. Inspect one Tag Report and one non-tag report at desktop and 375px. Check direct CSV prominence, section hierarchy, dashboard containment, 50-row table bound, column disclosure, focus states, wrapped actions, and absence of page-wide overflow. Batch material fixes, then confirm once.

- [ ] **Step 7: Run detector and finish review**

Run `node .agents/skills/impeccable/scripts/detect.mjs --json` once on the final changed targets. Then use the required no-history Impeccable finish reviewer with the original request, approved spec, changed paths, desktop/mobile screenshots, craft-floor path, and detector findings. Apply its material corrections in one batch, recapture, and obtain the final verdict.

- [ ] **Step 8: Commit verification fixes**

```bash
git add src/components/ReportWorkspace.tsx src/components/ReportWorkspace.test.tsx src/components/DataTable.tsx src/components/DataTable.test.tsx src/components/ReportExportBar.tsx src/components/ReportExportBar.test.tsx src/reports/scriptReportPresentation.ts src/reports/scriptReportPresentation.test.ts src/App.tsx src/styles/app.css e2e/reporting-mvp.spec.ts
git commit -m "fix: finish Script report command center"
```
