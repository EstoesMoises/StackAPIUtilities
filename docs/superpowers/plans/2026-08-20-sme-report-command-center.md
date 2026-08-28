# SME Report Command Center Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the long SME coverage result with a deliverable-first Report Command Center featuring direct PDF/CSV exports, navigable report sections, unified findings, and bounded evidence exploration.

**Architecture:** Add a report presentation boundary that maps the existing immutable SME decision pack into UI/export metadata without recalculating conclusions. Build shared command-center and evidence-explorer components, configure them for SME coverage, and generate the PDF locally with `@react-pdf/renderer` from the same prepared model. Keep CSV and Markdown builders unchanged so canonical row ordering remains authoritative.

**Tech Stack:** Next.js 14, React 18, TypeScript, Stack Overflow Stacks CSS, TanStack React Table, `@react-pdf/renderer`, Vitest, Testing Library, Playwright.

---

## File Structure

- Create `src/reports/reportPresentation.ts`: shared report identity, section, metric, export, and finding types.
- Create `src/utilities/smeCoverage/presentation.ts`: pure adapter from `SmeCoverageDecisionPack` to the shared presentation model.
- Create `src/utilities/smeCoverage/presentation.test.ts`: adapter invariants and reference-traceability tests.
- Create `src/components/ReportCommandCenter.tsx`: report shell, tabs, reset behavior, and section rendering.
- Create `src/components/ReportCommandCenter.test.tsx`: tab semantics, keyboard behavior, content-aware sections, and report reset tests.
- Create `src/components/ReportExportBar.tsx`: visible PDF/CSV actions, secondary-format disclosure, run-again action, and live feedback.
- Create `src/components/ReportExportBar.test.tsx`: action hierarchy, busy state, menu, and feedback tests.
- Create `src/components/ReportEvidenceExplorer.tsx`: generic search, facets, sorting, column visibility, and pagination.
- Create `src/components/ReportEvidenceExplorer.test.tsx`: generic explorer interaction tests.
- Modify `src/components/SmeCoverageEvidenceTable.tsx`: SME columns and filters configured on the shared explorer.
- Modify `src/components/SmeCoverageEvidenceTable.test.tsx`: SME field visibility, filters, pagination, and canonical-order tests.
- Modify `src/components/SmeCoverageFindings.tsx`: replace three tables with one ranked and tier-filterable table.
- Modify `src/components/SmeCoverageDecisionPack.tsx`: compose Overview, Findings, Evidence, and Methodology in the command center.
- Modify `src/components/SmeCoverageDecisionPack.test.tsx`: command-center navigation and direct export assertions.
- Modify `src/components/SmeCoverageMethodology.tsx`: allow expanded standalone rendering in its dedicated section.
- Create `src/utilities/smeCoverage/pdfModel.ts`: deterministic PDF-specific view model with bounded evidence appendix.
- Create `src/utilities/smeCoverage/pdfModel.test.ts`: PDF ordering, limitation, and appendix tests.
- Create `src/utilities/smeCoverage/SmeCoveragePdfDocument.tsx`: A4 paged document.
- Create `src/utils/smeCoveragePdfDownload.tsx`: lazy browser-side PDF rendering and download.
- Create `src/utils/smeCoveragePdfDownload.test.tsx`: renderer/download success and failure tests.
- Modify `src/utils/downloads.ts`: shared Blob download helper.
- Modify `src/utils/downloads.test.ts`: Blob helper coverage.
- Modify `src/styles/app.css`: command-center, export, findings, evidence, responsive, focus, and print-independent styles.
- Modify `src/components/SmeCoverageWorkspace.test.tsx`: new-result state reset coverage.
- Modify `e2e/sme-coverage-analyzer.spec.ts`: section navigation, pagination, direct exports, PDF download, and narrow viewport coverage.
- Modify `package.json` and `pnpm-lock.yaml`: add `@react-pdf/renderer`.

## Task 1: Define the Presentation Boundary

**Files:**
- Create: `src/reports/reportPresentation.ts`
- Create: `src/utilities/smeCoverage/presentation.ts`
- Test: `src/utilities/smeCoverage/presentation.test.ts`

- [ ] **Step 1: Write the failing adapter tests**

```ts
import { describe, expect, it } from "vitest";
import {
  completeSmeCoverageDecisionPack,
  emptySmeCoverageDecisionPack,
} from "../../test/fixtures/smeCoverageFixtures";
import { createSmeCoveragePresentation } from "./presentation";

describe("createSmeCoveragePresentation", () => {
  it("preserves report identity, metrics, warning order, and evidence references", () => {
    const pack = completeSmeCoverageDecisionPack();
    const result = createSmeCoveragePresentation(pack);

    expect(result.reportKey).toBe(
      `sme-coverage-analyzer:${pack.snapshot.instanceHost}:${pack.snapshot.generatedAt}`,
    );
    expect(result.metrics.map((metric) => metric.value)).toEqual([5, 4, 1, 1, 1]);
    expect(result.warnings).toBe(pack.warnings);
    expect(result.evidence).toBe(pack.evidence);
    expect(result.findings.map((finding) => finding.evidence)).toEqual([
      ...pack.findings.immediateGaps,
      ...pack.findings.criticalUnderCoverage,
      ...pack.findings.lightCoverage,
    ]);
  });

  it("omits empty findings and evidence sections", () => {
    const result = createSmeCoveragePresentation(emptySmeCoverageDecisionPack());
    expect(result.availableSections).toEqual(["overview", "methodology"]);
  });
});
```

- [ ] **Step 2: Run the tests and verify the missing-module failure**

Run: `pnpm vitest run src/utilities/smeCoverage/presentation.test.ts`

Expected: FAIL because `./presentation` does not exist.

- [ ] **Step 3: Add focused shared types**

```ts
// src/reports/reportPresentation.ts
import type { ReportWarning } from "../domain/types";

export type ReportSectionId = "overview" | "findings" | "evidence" | "methodology";
export type ReportQualityTone = "success" | "warning" | "neutral";

export interface ReportMetric {
  readonly label: string;
  readonly value: number | string;
}

export interface ReportFinding<TEvidence> {
  readonly tier: string;
  readonly evidence: TEvidence;
}

export interface ReportPresentationModel<TEvidence, TMethodology> {
  readonly reportKey: string;
  readonly kindLabel: string;
  readonly title: string;
  readonly sourceLabel: string;
  readonly generatedAt: string;
  readonly scopeLabel: string;
  readonly collectionLabel: string;
  readonly qualityLabel: string;
  readonly qualityTone: ReportQualityTone;
  readonly rowCount: number;
  readonly warnings: readonly ReportWarning[];
  readonly metrics: readonly ReportMetric[];
  readonly overview: string;
  readonly assessment?: string;
  readonly findings: readonly ReportFinding<TEvidence>[];
  readonly evidence: readonly TEvidence[];
  readonly methodology?: TMethodology;
  readonly availableSections: readonly ReportSectionId[];
  readonly exports: {
    readonly pdf: boolean;
    readonly csv: boolean;
    readonly markdown: boolean;
  };
}
```

- [ ] **Step 4: Implement the pure SME adapter**

```ts
// src/utilities/smeCoverage/presentation.ts
import type { ReportPresentationModel } from "../../reports/reportPresentation";
import type {
  SmeCoverageDecisionPack,
  SmeCoverageEvidenceRow,
  SmeCoverageMethodology,
} from "./model";

const summaryMetrics = [
  ["Tags analyzed", "tagsAnalyzed"],
  ["Tags with SMEs", "tagsWithSmes"],
  ["Immediate gaps", "immediateGaps"],
  ["Critical under-coverage", "criticalUnderCoverage"],
  ["Light-coverage tags", "lightCoverage"],
] as const;

export type SmeCoveragePresentation = ReportPresentationModel<
  SmeCoverageEvidenceRow,
  SmeCoverageMethodology
>;

export function createSmeCoveragePresentation(
  pack: SmeCoverageDecisionPack,
): SmeCoveragePresentation {
  const findings = [
    ...pack.findings.immediateGaps,
    ...pack.findings.criticalUnderCoverage,
    ...pack.findings.lightCoverage,
  ].map((evidence) => ({ tier: evidence.coverageTier, evidence }));
  const availableSections: SmeCoveragePresentation["availableSections"] = [
    "overview",
    ...(findings.length > 0 ? (["findings"] as const) : []),
    ...(pack.evidence.length > 0 ? (["evidence"] as const) : []),
    "methodology",
  ];

  return {
    reportKey: `sme-coverage-analyzer:${pack.snapshot.instanceHost}:${pack.snapshot.generatedAt}`,
    kindLabel: "Decision pack",
    title: "SME coverage report",
    sourceLabel: pack.snapshot.instanceHost,
    generatedAt: pack.snapshot.generatedAt,
    scopeLabel: pack.snapshot.scopeLabel,
    collectionLabel: pack.snapshot.collectionLabel,
    qualityLabel: `Analysis quality: ${pack.snapshot.completeness}`,
    qualityTone:
      pack.snapshot.completeness === "Complete"
        ? "success"
        : pack.snapshot.completeness === "Partial"
          ? "warning"
          : "neutral",
    rowCount: pack.evidence.length,
    warnings: pack.warnings,
    metrics: summaryMetrics.map(([label, key]) => ({ label, value: pack.summary[key] })),
    overview: pack.overview,
    assessment: pack.assessment,
    findings,
    evidence: pack.evidence,
    methodology: pack.methodology,
    availableSections,
    exports: { pdf: true, csv: pack.evidence.length > 0, markdown: true },
  };
}
```

- [ ] **Step 5: Run the adapter tests**

Run: `pnpm vitest run src/utilities/smeCoverage/presentation.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit the presentation boundary**

```bash
git add src/reports/reportPresentation.ts src/utilities/smeCoverage/presentation.ts src/utilities/smeCoverage/presentation.test.ts
git commit -m "feat: add SME report presentation model"
```

## Task 2: Build the Command Center Shell and Export Bar

**Files:**
- Create: `src/components/ReportCommandCenter.tsx`
- Create: `src/components/ReportCommandCenter.test.tsx`
- Create: `src/components/ReportExportBar.tsx`
- Create: `src/components/ReportExportBar.test.tsx`
- Modify: `src/styles/app.css`

- [ ] **Step 1: Write failing shell and export tests**

```tsx
// src/components/ReportCommandCenter.test.tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { ReportCommandCenter } from "./ReportCommandCenter";

const sections = [
  { id: "overview" as const, label: "Overview", content: <p>Overview content</p> },
  { id: "evidence" as const, label: "Evidence · 60", content: <p>Evidence content</p> },
];

describe("ReportCommandCenter", () => {
  it("uses accessible tabs and resets to Overview for a new report key", async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <ReportCommandCenter reportKey="first" header={<div>Header</div>} sections={sections} />,
    );
    await user.click(screen.getByRole("tab", { name: "Evidence · 60" }));
    expect(screen.getByText("Evidence content")).toBeVisible();

    rerender(
      <ReportCommandCenter reportKey="second" header={<div>Header</div>} sections={sections} />,
    );
    expect(screen.getByRole("tab", { name: "Overview" })).toHaveAttribute("aria-selected", "true");
  });
});
```

```tsx
// src/components/ReportExportBar.test.tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ReportExportBar } from "./ReportExportBar";

it("keeps PDF and CSV visible while Markdown stays secondary", async () => {
  const user = userEvent.setup();
  render(
    <ReportExportBar
      onExportPdf={vi.fn()}
      onExportCsv={vi.fn()}
      onExportMarkdown={vi.fn()}
      onRunAgain={vi.fn()}
      pdfPending={false}
      runPending={false}
      feedback={{ state: "idle" }}
    />,
  );
  expect(screen.getByRole("button", { name: "Export polished PDF" })).toBeVisible();
  expect(screen.getByRole("button", { name: "Export evidence CSV" })).toBeVisible();
  expect(screen.queryByRole("button", { name: "Download Markdown brief" })).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "More formats" }));
  expect(screen.getByRole("button", { name: "Download Markdown brief" })).toBeVisible();
});
```

- [ ] **Step 2: Run the component tests and verify missing-module failures**

Run: `pnpm vitest run src/components/ReportCommandCenter.test.tsx src/components/ReportExportBar.test.tsx`

Expected: FAIL because both components are missing.

- [ ] **Step 3: Implement the command-center tabs**

```tsx
// src/components/ReportCommandCenter.tsx
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import type { ReportSectionId } from "../reports/reportPresentation";

export interface ReportCommandCenterSection {
  id: ReportSectionId;
  label: string;
  content: ReactNode;
}

interface ReportCommandCenterProps {
  reportKey: string;
  header: ReactNode;
  sections: readonly ReportCommandCenterSection[];
}

export function ReportCommandCenter({ reportKey, header, sections }: ReportCommandCenterProps) {
  const [activeSection, setActiveSection] = useState<ReportSectionId>(sections[0]!.id);
  const tabListId = useId();
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  useEffect(() => setActiveSection(sections[0]!.id), [reportKey]);

  function onTabKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const offset = event.key === "ArrowRight" ? 1 : -1;
    const nextIndex = (index + offset + sections.length) % sections.length;
    tabRefs.current[nextIndex]?.focus();
    setActiveSection(sections[nextIndex]!.id);
  }

  return (
    <section className="report-command-center" aria-label="Generated report">
      {header}
      <div className="report-section-tabs" role="tablist" aria-label="Report sections" id={tabListId}>
        {sections.map((section, index) => (
          <button
            key={section.id}
            ref={(node) => { tabRefs.current[index] = node; }}
            className="report-section-tab"
            type="button"
            role="tab"
            id={`${tabListId}-${section.id}-tab`}
            aria-controls={`${tabListId}-${section.id}-panel`}
            aria-selected={activeSection === section.id}
            onClick={() => setActiveSection(section.id)}
            onKeyDown={(event) => onTabKeyDown(event, index)}
          >
            {section.label}
          </button>
        ))}
      </div>
      {sections.map((section) => (
        <div
          key={section.id}
          id={`${tabListId}-${section.id}-panel`}
          role="tabpanel"
          aria-labelledby={`${tabListId}-${section.id}-tab`}
          hidden={activeSection !== section.id}
          className="report-section-panel"
        >
          {section.content}
        </div>
      ))}
    </section>
  );
}
```

- [ ] **Step 4: Implement the export bar**

```tsx
// src/components/ReportExportBar.tsx
export type ExportFeedback =
  | { state: "idle" }
  | { state: "success" | "failed"; message: string };

interface ReportExportBarProps {
  onExportPdf?: () => void;
  onExportCsv?: () => void;
  onExportMarkdown?: () => void;
  onRunAgain: () => void;
  pdfPending: boolean;
  runPending: boolean;
  feedback: ExportFeedback;
}

export function ReportExportBar(props: ReportExportBarProps) {
  return (
    <div className="report-export-area">
      <div className="report-export-actions" aria-label="Report actions">
        {props.onExportPdf && (
          <button
            className="s-btn s-btn__filled report-export-pdf"
            type="button"
            aria-busy={props.pdfPending}
            disabled={props.pdfPending}
            onClick={props.onExportPdf}
          >
            {props.pdfPending ? "Preparing PDF…" : "Export polished PDF"}
          </button>
        )}
        {props.onExportCsv && (
          <button className="s-btn s-btn__outlined report-export-csv" type="button" onClick={props.onExportCsv}>
            Export evidence CSV
          </button>
        )}
        {props.onExportMarkdown && (
          <details className="report-export-more">
            <summary className="s-btn s-btn__outlined">More formats</summary>
            <div className="report-export-menu">
              <button className="s-btn" type="button" onClick={props.onExportMarkdown}>
                Download Markdown brief
              </button>
            </div>
          </details>
        )}
        <button className="s-btn s-btn__outlined" type="button" disabled={props.runPending} onClick={props.onRunAgain}>
          Run again
        </button>
      </div>
      {props.feedback.state !== "idle" && (
        <p
          className={`sme-action-feedback sme-action-feedback__${props.feedback.state === "success" ? "success" : "error"}`}
          role={props.feedback.state === "success" ? "status" : "alert"}
        >
          {props.feedback.message}
        </p>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Add the structural and focus styles**

```css
.report-command-center {
  width: min(100%, 1180px);
  border: 1px solid var(--so-border);
  border-radius: 8px;
  background: var(--so-surface);
  box-shadow: var(--so-shadow-hairline);
}

.report-command-header {
  position: sticky;
  top: 82px;
  z-index: calc(var(--so-z-sticky) - 1);
  display: flex;
  justify-content: space-between;
  gap: 20px;
  padding: 18px 20px;
  border-bottom: 1px solid var(--so-border);
  background: oklch(1 0 0 / 0.97);
}

.report-section-tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  padding: 8px 20px;
  border-bottom: 1px solid var(--so-border);
}

.report-section-tab[aria-selected="true"] {
  border-color: var(--so-border-strong);
  box-shadow: inset 0 -3px var(--so-orange-strong);
  background: var(--so-surface-raised);
}

.report-section-panel { padding: 20px; }
.report-export-actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 8px; }
.report-export-csv { border-color: var(--so-blue); color: var(--so-blue); }
.report-section-tab:focus-visible,
.report-export-actions .s-btn:focus-visible { outline: 3px solid var(--so-focus); outline-offset: 2px; }
```

- [ ] **Step 6: Run the focused tests**

Run: `pnpm vitest run src/components/ReportCommandCenter.test.tsx src/components/ReportExportBar.test.tsx`

Expected: PASS.

- [ ] **Step 7: Commit the shell**

```bash
git add src/components/ReportCommandCenter.tsx src/components/ReportCommandCenter.test.tsx src/components/ReportExportBar.tsx src/components/ReportExportBar.test.tsx src/styles/app.css
git commit -m "feat: add report command center shell"
```

## Task 3: Build the Generic Evidence Explorer

**Files:**
- Create: `src/components/ReportEvidenceExplorer.tsx`
- Create: `src/components/ReportEvidenceExplorer.test.tsx`
- Modify: `src/styles/app.css`

- [ ] **Step 1: Write the failing pagination/filter test**

```tsx
import { createColumnHelper } from "@tanstack/react-table";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it } from "vitest";
import { ReportEvidenceExplorer } from "./ReportEvidenceExplorer";

interface Row { name: string; tier: "Critical" | "Adequate"; detail: string }
const helper = createColumnHelper<Row>();
const rows = Array.from({ length: 60 }, (_, index): Row => ({
  name: `tag-${index + 1}`,
  tier: index < 5 ? "Critical" : "Adequate",
  detail: `detail-${index + 1}`,
}));

it("filters, paginates, and exposes hidden columns without mutating rows", async () => {
  const user = userEvent.setup();
  render(
    <ReportEvidenceExplorer
      rows={rows}
      columns={[
        helper.accessor("name", { header: "Name" }),
        helper.accessor("tier", { header: "Tier" }),
        helper.accessor("detail", { header: "Detail" }),
      ]}
      defaultColumnVisibility={{ detail: false }}
      facets={[{
        id: "tier",
        label: "Tier",
        allLabel: "All tiers",
        options: ["Critical", "Adequate"],
        matches: (row, value) => row.tier === value,
      }]}
      ariaLabel="Test evidence"
      emptyMessage="No rows."
    />,
  );
  expect(within(screen.getByRole("region", { name: "Test evidence" })).getAllByRole("row")).toHaveLength(51);
  expect(screen.getByText("Rows 1–50 of 60")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Next page" }));
  expect(screen.getByText("Rows 51–60 of 60")).toBeInTheDocument();
  await user.selectOptions(screen.getByLabelText("Tier"), "Critical");
  expect(screen.getByText("Rows 1–5 of 5")).toBeInTheDocument();
  expect(screen.queryByRole("columnheader", { name: "Detail" })).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `pnpm vitest run src/components/ReportEvidenceExplorer.test.tsx`

Expected: FAIL because `ReportEvidenceExplorer` does not exist.

- [ ] **Step 3: Implement generic explorer state and TanStack integration**

```tsx
// Core state and table configuration for ReportEvidenceExplorer.tsx
import { useMemo, useState } from "react";
import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type PaginationState,
  type SortingState,
  type VisibilityState,
} from "@tanstack/react-table";

export interface EvidenceFacet<TRow> {
  id: string;
  label: string;
  allLabel: string;
  options: readonly string[];
  matches: (row: TRow, value: string) => boolean;
}

interface ReportEvidenceExplorerProps<TRow> {
  rows: readonly TRow[];
  columns: readonly ColumnDef<TRow, any>[];
  defaultColumnVisibility?: VisibilityState;
  facets?: readonly EvidenceFacet<TRow>[];
  ariaLabel: string;
  emptyMessage: string;
}

export function ReportEvidenceExplorer<TRow>({
  rows,
  columns,
  defaultColumnVisibility = {},
  facets = [],
  ariaLabel,
  emptyMessage,
}: ReportEvidenceExplorerProps<TRow>) {
  const [search, setSearch] = useState("");
  const [sorting, setSorting] = useState<SortingState>([]);
  const [facetValues, setFacetValues] = useState<Record<string, string>>({});
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>(defaultColumnVisibility);
  const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 50 });
  const filteredRows = useMemo(
    () => rows.filter((row) => facets.every((facet) => {
      const value = facetValues[facet.id];
      return value === undefined || value === "" || facet.matches(row, value);
    })),
    [facetValues, facets, rows],
  );
  const table = useReactTable({
    data: [...filteredRows],
    columns: [...columns],
    state: { globalFilter: search, sorting, columnVisibility, pagination },
    onGlobalFilterChange: setSearch,
    onSortingChange: setSorting,
    onColumnVisibilityChange: setColumnVisibility,
    onPaginationChange: setPagination,
    globalFilterFn: (row, _columnId, value) => Object.values(row.original as object).some(
      (cell) => String(cell ?? "Unavailable").toLocaleLowerCase("en-US")
        .includes(String(value).toLocaleLowerCase("en-US")),
    ),
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    enableSortingRemoval: false,
  });

  const totalRows = table.getFilteredRowModel().rows.length;
  const pageRows = table.getRowModel().rows.length;
  const firstRow = totalRows === 0 ? 0 : pagination.pageIndex * pagination.pageSize + 1;
  const lastRow = totalRows === 0 ? 0 : firstRow + pageRows - 1;
  const hasActiveFilter = search !== "" || Object.values(facetValues).some(Boolean);

  return (
    <div className="report-evidence-explorer">
      <div className="report-evidence-controls">
        <label>
          <span>Search evidence</span>
          <input
            className="s-input"
            type="search"
            value={search}
            onChange={(event) => {
              setSearch(event.currentTarget.value);
              setPagination((current) => ({ ...current, pageIndex: 0 }));
            }}
          />
        </label>
        {facets.map((facet) => (
          <label key={facet.id}>
            <span>{facet.label}</span>
            <select
              className="s-select"
              value={facetValues[facet.id] ?? ""}
              onChange={(event) => {
                setFacetValues((current) => ({ ...current, [facet.id]: event.currentTarget.value }));
                setPagination((current) => ({ ...current, pageIndex: 0 }));
              }}
            >
              <option value="">{facet.allLabel}</option>
              {facet.options.map((option) => <option key={option} value={option}>{option}</option>)}
            </select>
          </label>
        ))}
        <details className="report-column-menu">
          <summary className="s-btn s-btn__outlined">Columns</summary>
          <div className="report-column-options">
            {table.getAllLeafColumns().filter((column) => column.getCanHide()).map((column) => {
              const header = column.columnDef.header;
              const label = typeof header === "string" ? header : column.id;
              return (
                <label key={column.id}>
                  <input
                    type="checkbox"
                    checked={column.getIsVisible()}
                    onChange={column.getToggleVisibilityHandler()}
                  />
                  <span>{label}</span>
                </label>
              );
            })}
          </div>
        </details>
      </div>
      <div className="report-evidence-table-wrap" role="region" aria-label={ariaLabel} tabIndex={0}>
        <table className="s-table report-evidence-table">
          <thead>
            {table.getHeaderGroups().map((headerGroup) => (
              <tr key={headerGroup.id}>
                {headerGroup.headers.map((header) => {
                  const sorted = header.column.getIsSorted();
                  return (
                    <th
                      key={header.id}
                      scope="col"
                      aria-sort={sorted === "asc" ? "ascending" : sorted === "desc" ? "descending" : "none"}
                    >
                      <button type="button" className="sme-sort-button" onClick={header.column.getToggleSortingHandler()}>
                        {flexRender(header.column.columnDef.header, header.getContext())}
                        <span aria-hidden="true">{sorted === "asc" ? "↑" : sorted === "desc" ? "↓" : "↕"}</span>
                      </button>
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.length > 0 ? table.getRowModel().rows.map((row) => (
              <tr key={row.id}>
                {row.getVisibleCells().map((cell) => (
                  <td key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</td>
                ))}
              </tr>
            )) : (
              <tr>
                <td colSpan={table.getVisibleLeafColumns().length}>
                  {hasActiveFilter ? "No evidence matches the current filters." : emptyMessage}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="report-evidence-pagination">
        <span>{`Rows ${firstRow}–${lastRow} of ${totalRows}`}</span>
        <label>
          <span>Rows per page</span>
          <select
            className="s-select"
            value={pagination.pageSize}
            onChange={(event) => setPagination({ pageIndex: 0, pageSize: Number(event.currentTarget.value) })}
          >
            {[25, 50, 100].map((size) => <option key={size} value={size}>{size}</option>)}
          </select>
        </label>
        <div>
          <button className="s-btn s-btn__outlined" type="button" aria-label="Previous page" disabled={!table.getCanPreviousPage()} onClick={() => table.previousPage()}>Previous</button>
          <button className="s-btn s-btn__outlined" type="button" aria-label="Next page" disabled={!table.getCanNextPage()} onClick={() => table.nextPage()}>Next</button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Add bounded explorer styles**

```css
.report-evidence-controls,
.report-evidence-pagination {
  display: flex;
  flex-wrap: wrap;
  align-items: end;
  justify-content: space-between;
  gap: 10px;
}

.report-evidence-table-wrap {
  width: 100%;
  overflow: auto;
  border: 1px solid var(--so-border);
  border-radius: 8px;
}

.report-evidence-table thead th {
  position: sticky;
  top: 0;
  z-index: 1;
  background: var(--so-surface-raised);
}

.report-column-menu { position: relative; }
.report-column-options {
  position: absolute;
  right: 0;
  z-index: 2;
  display: grid;
  min-width: 220px;
  padding: 10px;
  border: 1px solid var(--so-border-strong);
  border-radius: 8px;
  background: var(--so-surface);
  box-shadow: 0 8px 24px oklch(0.2 0.035 255 / 0.16);
}
```

- [ ] **Step 5: Run the explorer tests**

Run: `pnpm vitest run src/components/ReportEvidenceExplorer.test.tsx`

Expected: PASS.

- [ ] **Step 6: Commit the generic explorer**

```bash
git add src/components/ReportEvidenceExplorer.tsx src/components/ReportEvidenceExplorer.test.tsx src/styles/app.css
git commit -m "feat: add bounded report evidence explorer"
```

## Task 4: Configure SME Evidence and Unified Findings

**Files:**
- Modify: `src/components/SmeCoverageEvidenceTable.tsx`
- Modify: `src/components/SmeCoverageEvidenceTable.test.tsx`
- Modify: `src/components/SmeCoverageFindings.tsx`
- Modify: `src/components/SmeCoverageDecisionPack.test.tsx`
- Modify: `src/styles/app.css`

- [ ] **Step 1: Replace the existing table tests with failing configuration tests**

Add tests that assert:

```tsx
expect(screen.getByRole("columnheader", { name: "Tag" })).toBeVisible();
expect(screen.getByRole("columnheader", { name: "Evidence quality" })).toBeVisible();
expect(screen.queryByRole("columnheader", { name: "Question-count basis" })).not.toBeInTheDocument();
await user.selectOptions(screen.getByLabelText("Coverage tier"), "Immediate gap");
expect(dataRowTags()).toEqual(["gamma-tools"]);
await user.selectOptions(screen.getByLabelText("Evidence quality"), "Needs review");
expect(screen.getByRole("cell", { name: "zeta-runtime" })).toBeVisible();
```

Add this pagination case:

```tsx
it("bounds large evidence without mutating canonical rows", async () => {
  const user = userEvent.setup();
  const source = completeSmeCoverageDecisionPack().evidence;
  const evidence = Array.from({ length: 55 }, (_, index) => ({
    ...source[index % source.length]!,
    tagName: `tag-${String(index + 1).padStart(2, "0")}`,
  }));
  const before = JSON.stringify(evidence);
  render(<SmeCoverageEvidenceTable evidence={evidence} />);
  expect(screen.getAllByRole("row")).toHaveLength(51);
  expect(screen.getByText("Rows 1–50 of 55")).toBeVisible();
  await user.click(screen.getByRole("button", { name: "Next page" }));
  expect(screen.getAllByRole("row")).toHaveLength(6);
  expect(screen.getByText("Rows 51–55 of 55")).toBeVisible();
  expect(JSON.stringify(evidence)).toBe(before);
});
```

Add a failing `SmeCoverageDecisionPack` assertion that `Priority findings` is one region and that the old three table regions do not exist.

- [ ] **Step 2: Run the focused tests and verify failures**

Run: `pnpm vitest run src/components/SmeCoverageEvidenceTable.test.tsx src/components/SmeCoverageDecisionPack.test.tsx`

Expected: FAIL because the existing evidence table has no facets/pagination and findings remain split.

- [ ] **Step 3: Configure SME evidence on the shared explorer**

Retain the existing numeric/text sorting functions and cell formatting. Add a derived display column:

```tsx
columnHelper.display({
  id: "evidenceQuality",
  header: "Evidence quality",
  cell: ({ row }) =>
    row.original.demandQuality === "Complete" && row.original.smeQuality === "Complete"
      ? "Complete"
      : "Needs review",
}),
```

Render:

```tsx
<ReportEvidenceExplorer
  rows={evidence}
  columns={columns}
  defaultColumnVisibility={{
    questionCount: false,
    questionCountBasis: false,
    coveragePercentile: false,
    reason: false,
    demandQuality: false,
    smeQuality: false,
  }}
  facets={[
    {
      id: "coverageTier",
      label: "Coverage tier",
      allLabel: "All coverage tiers",
      options: [...new Set(evidence.map((row) => row.coverageTier))],
      matches: (row, value) => row.coverageTier === value,
    },
    {
      id: "evidenceQuality",
      label: "Evidence quality",
      allLabel: "All evidence quality",
      options: ["Complete", "Needs review"],
      matches: (row, value) =>
        value === "Complete"
          ? row.demandQuality === "Complete" && row.smeQuality === "Complete"
          : row.demandQuality !== "Complete" || row.smeQuality !== "Complete",
    },
  ]}
  ariaLabel="SME coverage evidence table"
  emptyMessage="No evidence rows are in this decision pack."
/>
```

- [ ] **Step 4: Replace three findings tables with one prepared queue**

Change `SmeCoverageFindings` to accept the flattened presentation findings and filter without sorting:

```tsx
type PriorityFilter = "All priorities" | CoverageTier;
const visibleFindings = filter === "All priorities"
  ? findings
  : findings.filter((finding) => finding.tier === filter);

return (
  <section className="sme-findings" aria-labelledby="sme-priority-findings-heading">
    <div className="sme-section-header">
      <div>
        <h3 id="sme-priority-findings-heading">Priority findings</h3>
        <p>{findings.length.toLocaleString("en-US")} prepared priorities</p>
      </div>
      <label>
        <span>Priority tier</span>
        <select className="s-select" value={filter} onChange={(event) => setFilter(event.currentTarget.value as PriorityFilter)}>
          <option>All priorities</option>
          <option>Immediate gap</option>
          <option>Critical under-coverage</option>
          <option>Light coverage</option>
        </select>
      </label>
    </div>
    <div className="sme-finding-table-wrap" role="region" aria-label="Priority findings table" tabIndex={0}>
      <table className="s-table sme-finding-table">
        <thead><tr><th>Priority</th><th>Tag</th><th>Why it matters</th><th>SMEs</th><th>Demand</th><th>Recommended action</th></tr></thead>
        <tbody>{visibleFindings.map(({ tier, evidence }) => (
          <tr key={`${tier}:${evidence.tagName}`}>
            <td><span className={`sme-tier-badge sme-tier-badge__${tierClass(tier)}`}>{tier}</span></td>
            <td><strong>{evidence.tagName}</strong></td>
            <td>{evidence.reason}</td>
            <td>{formatSmeCount(evidence.smeCount)}</td>
            <td>{formatNumber(evidence.pageViews)}</td>
            <td>{evidence.recommendedAction}</td>
          </tr>
        ))}</tbody>
      </table>
    </div>
  </section>
);
```

- [ ] **Step 5: Run the evidence and decision-pack tests**

Run: `pnpm vitest run src/components/SmeCoverageEvidenceTable.test.tsx src/components/SmeCoverageDecisionPack.test.tsx`

Expected: evidence tests PASS; the decision-pack test may still fail on the not-yet-integrated tabs, but the unified findings assertions PASS.

- [ ] **Step 6: Commit evidence and findings**

```bash
git add src/components/SmeCoverageEvidenceTable.tsx src/components/SmeCoverageEvidenceTable.test.tsx src/components/SmeCoverageFindings.tsx src/components/SmeCoverageDecisionPack.test.tsx src/styles/app.css
git commit -m "feat: make SME findings and evidence explorable"
```

## Task 5: Add the Browser-Local PDF Deliverable

**Files:**
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Create: `src/utilities/smeCoverage/pdfModel.ts`
- Create: `src/utilities/smeCoverage/pdfModel.test.ts`
- Create: `src/utilities/smeCoverage/SmeCoveragePdfDocument.tsx`
- Create: `src/utils/smeCoveragePdfDownload.tsx`
- Create: `src/utils/smeCoveragePdfDownload.test.tsx`
- Modify: `src/utils/downloads.ts`
- Modify: `src/utils/downloads.test.ts`

- [ ] **Step 1: Add the renderer dependency**

Run: `pnpm add @react-pdf/renderer`

Expected: `package.json` and `pnpm-lock.yaml` add the current compatible renderer release.

- [ ] **Step 2: Write failing PDF-model tests**

```ts
import { describe, expect, it } from "vitest";
import { partialSmeCoverageDecisionPack } from "../../test/fixtures/smeCoverageFixtures";
import { buildSmeCoveragePdfModel } from "./pdfModel";

describe("buildSmeCoveragePdfModel", () => {
  it("keeps warnings before conclusions and bounds the appendix to finding rows", () => {
    const pack = partialSmeCoverageDecisionPack();
    const model = buildSmeCoveragePdfModel(pack);
    expect(model.warnings).toEqual(pack.warnings.map((warning) => warning.message));
    expect(model.findingGroups.flatMap((group) => group.rows)).toEqual([
      ...pack.findings.immediateGaps,
      ...pack.findings.criticalUnderCoverage,
      ...pack.findings.lightCoverage,
    ]);
    expect(model.appendixRows).toEqual(model.findingGroups.flatMap((group) => group.rows));
    expect(model.appendixRows.length).toBeLessThan(pack.evidence.length);
    expect(model.completeEvidenceNote).toMatch(/complete.*CSV/i);
  });
});
```

- [ ] **Step 3: Run the model test and verify it fails**

Run: `pnpm vitest run src/utilities/smeCoverage/pdfModel.test.ts`

Expected: FAIL because `pdfModel.ts` is missing.

- [ ] **Step 4: Implement the deterministic PDF model**

```ts
// src/utilities/smeCoverage/pdfModel.ts
import type { CoverageTier, SmeCoverageDecisionPack, SmeCoverageEvidenceRow } from "./model";

export interface SmeCoveragePdfModel {
  title: "SME Coverage Decision Pack";
  snapshot: SmeCoverageDecisionPack["snapshot"];
  warnings: readonly string[];
  metrics: readonly { label: string; value: number }[];
  overview: string;
  assessmentParagraphs: readonly string[];
  findingGroups: readonly { tier: CoverageTier; rows: readonly SmeCoverageEvidenceRow[] }[];
  methodology: SmeCoverageDecisionPack["methodology"];
  appendixRows: readonly SmeCoverageEvidenceRow[];
  completeEvidenceNote: string;
}

export function buildSmeCoveragePdfModel(pack: SmeCoverageDecisionPack): SmeCoveragePdfModel {
  const findingGroups = [
    { tier: "Immediate gap" as const, rows: pack.findings.immediateGaps },
    { tier: "Critical under-coverage" as const, rows: pack.findings.criticalUnderCoverage },
    { tier: "Light coverage" as const, rows: pack.findings.lightCoverage },
  ].filter((group) => group.rows.length > 0);
  return {
    title: "SME Coverage Decision Pack",
    snapshot: pack.snapshot,
    warnings: pack.warnings.map((warning) => warning.message),
    metrics: [
      { label: "Tags analyzed", value: pack.summary.tagsAnalyzed },
      { label: "Tags with SMEs", value: pack.summary.tagsWithSmes },
      { label: "Immediate gaps", value: pack.summary.immediateGaps },
      { label: "Critical under-coverage", value: pack.summary.criticalUnderCoverage },
      { label: "Light coverage", value: pack.summary.lightCoverage },
    ],
    overview: pack.overview,
    assessmentParagraphs: pack.assessment.split(/\n\s*\n/),
    findingGroups,
    methodology: pack.methodology,
    appendixRows: findingGroups.flatMap((group) => group.rows),
    completeEvidenceNote: "The accompanying evidence CSV contains the complete canonical dataset in decision-pack order.",
  };
}
```

- [ ] **Step 5: Add a Blob download primitive and tests**

```ts
// src/utils/downloads.ts
export function downloadBlobFile(fileName: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  try { link.click(); } finally { URL.revokeObjectURL(url); }
}

export function downloadTextFile(fileName: string, contents: string, mimeType: string) {
  downloadBlobFile(fileName, new Blob([contents], { type: mimeType }));
}
```

Update `downloads.test.ts` to spy on `URL.createObjectURL`, `URL.revokeObjectURL`, and `HTMLAnchorElement.prototype.click`, then assert the filename and exact Blob are used.

- [ ] **Step 6: Build the paged A4 document**

Create `SmeCoveragePdfDocument.tsx` with `Document`, `Page`, `View`, `Text`, and `StyleSheet` from `@react-pdf/renderer`. Use built-in Helvetica, A4 pages, 36-point page padding, a 4-point orange rule at the top of the cover, neutral gray rules, and a fixed footer with page number. Render in this exact order:

```tsx
<Document title={model.title} author="Stack API Utilities">
  <Page size="A4" style={styles.page}>
    <View style={styles.coverRule} />
    <Text style={styles.eyebrow}>STACK API UTILITIES</Text>
    <Text style={styles.title}>{model.title}</Text>
    <Text>{model.snapshot.instanceHost}</Text>
    <Text>{model.snapshot.generatedAt}</Text>
    <Text>{model.snapshot.scopeLabel}</Text>
    <Text>{model.snapshot.collectionLabel}</Text>
    <Text>{`Analysis quality: ${model.snapshot.completeness}`}</Text>
  </Page>
  <Page size="A4" style={styles.page} wrap>
    {model.warnings.length > 0 && <PdfWarnings warnings={model.warnings} />}
    <PdfMetrics metrics={model.metrics} />
    <PdfSection title="Executive summary"><Text>{model.overview}</Text></PdfSection>
    <PdfSection title="Assessment">{model.assessmentParagraphs.map((paragraph) => <Text key={paragraph}>{paragraph}</Text>)}</PdfSection>
    {model.findingGroups.map((group) => <PdfFindingGroup key={group.tier} group={group} />)}
    <PdfMethodology methodology={model.methodology} />
    <PdfAppendix rows={model.appendixRows} note={model.completeEvidenceNote} />
    <Text fixed style={styles.footer} render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} />
  </Page>
</Document>
```

Define the document styles and helpers in the same file:

```tsx
const colors = {
  orange: "#d65f12",
  ink: "#232629",
  text: "#3b4045",
  muted: "#6a737c",
  border: "#d6d9dc",
  soft: "#f5f6f6",
  warning: "#fff4d1",
};

const styles = StyleSheet.create({
  page: { padding: 36, fontFamily: "Helvetica", fontSize: 9, color: colors.text },
  coverRule: { height: 4, marginBottom: 32, backgroundColor: colors.orange },
  eyebrow: { marginBottom: 8, fontSize: 9, color: colors.muted },
  title: { marginBottom: 18, fontSize: 26, fontFamily: "Helvetica-Bold", color: colors.ink },
  heading: { marginTop: 18, marginBottom: 8, fontSize: 14, fontFamily: "Helvetica-Bold", color: colors.ink },
  subheading: { marginTop: 12, marginBottom: 6, fontSize: 11, fontFamily: "Helvetica-Bold", color: colors.ink },
  paragraph: { marginBottom: 7, lineHeight: 1.45 },
  warning: { marginBottom: 6, padding: 8, backgroundColor: colors.warning },
  metricRow: { flexDirection: "row", marginBottom: 14, borderWidth: 1, borderColor: colors.border },
  metric: { flexGrow: 1, flexBasis: 0, padding: 8, borderRightWidth: 1, borderRightColor: colors.border },
  metricLabel: { marginBottom: 3, fontSize: 7, color: colors.muted },
  metricValue: { fontSize: 14, fontFamily: "Helvetica-Bold", color: colors.ink },
  tableHeader: { flexDirection: "row", paddingVertical: 5, backgroundColor: colors.soft, borderBottomWidth: 1, borderBottomColor: colors.border },
  tableRow: { flexDirection: "row", paddingVertical: 5, borderBottomWidth: 1, borderBottomColor: colors.border },
  tagCell: { width: "17%", paddingRight: 5 },
  numberCell: { width: "12%", paddingRight: 5 },
  tierCell: { width: "18%", paddingRight: 5 },
  actionCell: { width: "29%" },
  footer: { position: "absolute", bottom: 18, left: 36, right: 36, color: colors.muted, textAlign: "right" },
});

function PdfWarnings({ warnings }: { warnings: readonly string[] }) {
  return (
    <View>
      <Text style={styles.heading}>Evidence notes</Text>
      {warnings.map((warning) => <Text key={warning} style={styles.warning}>{warning}</Text>)}
    </View>
  );
}

function PdfMetrics({ metrics }: { metrics: SmeCoveragePdfModel["metrics"] }) {
  return (
    <View>
      <Text style={styles.heading}>Executive summary</Text>
      <View style={styles.metricRow}>
        {metrics.map((metric) => (
          <View key={metric.label} style={styles.metric}>
            <Text style={styles.metricLabel}>{metric.label}</Text>
            <Text style={styles.metricValue}>{metric.value.toLocaleString("en-US")}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

function PdfSection({ title, children }: { title: string; children: ReactNode }) {
  return <View><Text style={styles.heading}>{title}</Text>{children}</View>;
}

function PdfFindingGroup({ group }: { group: SmeCoveragePdfModel["findingGroups"][number] }) {
  return (
    <View>
      <Text style={styles.subheading}>{group.tier}</Text>
      {group.rows.map((row) => (
        <View key={row.tagName} style={styles.tableRow} wrap={false}>
          <Text style={styles.tagCell}>{row.tagName}</Text>
          <Text style={styles.numberCell}>{formatPdfNumber(row.pageViews)}</Text>
          <Text style={styles.numberCell}>{formatPdfNumber(row.smeCount)}</Text>
          <Text style={styles.actionCell}>{row.recommendedAction}</Text>
          <Text style={styles.tierCell}>{row.reason}</Text>
        </View>
      ))}
    </View>
  );
}

function PdfMethodology({ methodology }: { methodology: SmeCoveragePdfModel["methodology"] }) {
  return (
    <PdfSection title="Methodology">
      <Text style={styles.paragraph}>{`Coverage ratio: ${methodology.ratioFormula}.`}</Text>
      <Text style={styles.paragraph}>{`Covered active sample: ${methodology.coveredActiveSampleSize.toLocaleString("en-US")} tags.`}</Text>
      <Text style={styles.paragraph}>{`Display rounding: ${methodology.roundingRule}.`}</Text>
    </PdfSection>
  );
}

function PdfAppendix({ rows, note }: { rows: readonly SmeCoverageEvidenceRow[]; note: string }) {
  return (
    <PdfSection title="Supporting evidence appendix">
      <Text style={styles.paragraph}>{note}</Text>
      <View style={styles.tableHeader} fixed>
        <Text style={styles.tagCell}>Tag</Text>
        <Text style={styles.numberCell}>Page views</Text>
        <Text style={styles.numberCell}>SMEs</Text>
        <Text style={styles.numberCell}>Views / SME</Text>
        <Text style={styles.tierCell}>Tier</Text>
        <Text style={styles.actionCell}>Recommended action</Text>
      </View>
      {rows.map((row) => (
        <View key={`appendix:${row.tagName}`} style={styles.tableRow} wrap={false}>
          <Text style={styles.tagCell}>{row.tagName}</Text>
          <Text style={styles.numberCell}>{formatPdfNumber(row.pageViews)}</Text>
          <Text style={styles.numberCell}>{formatPdfNumber(row.smeCount)}</Text>
          <Text style={styles.numberCell}>{formatPdfNumber(row.pageViewsPerSme)}</Text>
          <Text style={styles.tierCell}>{row.coverageTier}</Text>
          <Text style={styles.actionCell}>{row.recommendedAction}</Text>
        </View>
      ))}
    </PdfSection>
  );
}

function formatPdfNumber(value: number | null) {
  return value === null ? "Unavailable" : value.toLocaleString("en-US", { maximumFractionDigits: 2 });
}
```

Import `type ReactNode`, `SmeCoverageEvidenceRow`, and `SmeCoveragePdfModel`. The appendix receives only `model.appendixRows`; never pass `pack.evidence` to the PDF component.

- [ ] **Step 7: Implement lazy rendering and download tests**

```tsx
// src/utils/smeCoveragePdfDownload.tsx
import type { SmeCoverageDecisionPack } from "../utilities/smeCoverage/model";
import { buildSmeCoveragePdfModel } from "../utilities/smeCoverage/pdfModel";
import { downloadBlobFile } from "./downloads";

export async function downloadSmeCoveragePdf(pack: SmeCoverageDecisionPack) {
  const [{ pdf }, { SmeCoveragePdfDocument }] = await Promise.all([
    import("@react-pdf/renderer"),
    import("../utilities/smeCoverage/SmeCoveragePdfDocument"),
  ]);
  const blob = await pdf(<SmeCoveragePdfDocument model={buildSmeCoveragePdfModel(pack)} />).toBlob();
  downloadBlobFile(buildPdfFileName(pack), blob);
}

export function buildPdfFileName(pack: SmeCoverageDecisionPack) {
  const instance = pack.snapshot.instanceHost.trim().replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "") || "report";
  return `sme-coverage-decision-pack-${instance}-${pack.snapshot.generatedAt.slice(0, 10)}.pdf`;
}
```

Mock `@react-pdf/renderer`, `SmeCoveragePdfDocument`, and `downloadBlobFile`; assert `toBlob()` is awaited and the filename matches the Markdown stem with `.pdf`.

- [ ] **Step 8: Run PDF/download tests**

Run: `pnpm vitest run src/utilities/smeCoverage/pdfModel.test.ts src/utils/downloads.test.ts src/utils/smeCoveragePdfDownload.test.tsx`

Expected: PASS.

- [ ] **Step 9: Commit the PDF deliverable**

```bash
git add package.json pnpm-lock.yaml src/utilities/smeCoverage/pdfModel.ts src/utilities/smeCoverage/pdfModel.test.ts src/utilities/smeCoverage/SmeCoveragePdfDocument.tsx src/utils/smeCoveragePdfDownload.tsx src/utils/smeCoveragePdfDownload.test.tsx src/utils/downloads.ts src/utils/downloads.test.ts
git commit -m "feat: add share-ready SME coverage PDF"
```

## Task 6: Compose the SME Command Center

**Files:**
- Modify: `src/components/SmeCoverageDecisionPack.tsx`
- Modify: `src/components/SmeCoverageDecisionPack.test.tsx`
- Modify: `src/components/SmeCoverageMethodology.tsx`
- Modify: `src/components/SmeCoverageWorkspace.test.tsx`
- Modify: `src/styles/app.css`

- [ ] **Step 1: Update the decision-pack tests to describe the approved experience**

Add assertions that:

```tsx
expect(screen.getByRole("region", { name: "Generated report" })).toBeInTheDocument();
expect(screen.getByRole("button", { name: "Export polished PDF" })).toBeVisible();
expect(screen.getByRole("button", { name: "Export evidence CSV" })).toBeVisible();
expect(screen.getByRole("tab", { name: "Overview" })).toHaveAttribute("aria-selected", "true");
expect(screen.getByRole("tab", { name: /Priority findings/ })).toBeVisible();
expect(screen.getByRole("tab", { name: /Evidence/ })).toBeVisible();
expect(screen.getByRole("tab", { name: "Methodology" })).toBeVisible();
```

Click each tab and assert only its content is visible. Update mocked modules to include `downloadSmeCoveragePdf`. Verify PDF busy copy and both success/failure messages. Verify an empty pack exposes only Overview and Methodology tabs.

- [ ] **Step 2: Run the decision-pack/workspace tests and verify failures**

Run: `pnpm vitest run src/components/SmeCoverageDecisionPack.test.tsx src/components/SmeCoverageWorkspace.test.tsx`

Expected: FAIL against the old long stack and footer actions.

- [ ] **Step 3: Compose the command-center header and sections**

In `SmeCoverageDecisionPack.tsx`:

```tsx
const presentation = useMemo(() => createSmeCoveragePresentation(pack), [pack]);
const [pdfPending, setPdfPending] = useState(false);
const [downloadFeedback, setDownloadFeedback] = useState<ExportFeedback>({ state: "idle" });

const sections: ReportCommandCenterSection[] = presentation.availableSections.map((id) => {
  switch (id) {
    case "overview": return {
      id,
      label: "Overview",
      content: <SmeOverview pack={pack} presentation={presentation} />,
    };
    case "findings": return {
      id,
      label: `Priority findings · ${presentation.findings.length.toLocaleString("en-US")}`,
      content: <SmeCoverageFindings findings={presentation.findings} />,
    };
    case "evidence": return {
      id,
      label: `Evidence · ${presentation.rowCount.toLocaleString("en-US")}`,
      content: <SmeCoverageEvidenceTable evidence={presentation.evidence} />,
    };
    case "methodology": return {
      id,
      label: "Methodology",
      content: <SmeCoverageMethodology methodology={pack.methodology} completeness={pack.snapshot.completeness} standalone />,
    };
  }
});
```

Build the header and the local Overview component in the same file:

```tsx
const header = (
  <div className="report-command-header">
    <div>
      <p className="workspace-kicker">{presentation.kindLabel}</p>
      <div className="sme-result-title-row">
        <h2 id="sme-decision-pack-heading">{presentation.title}</h2>
        <span className={`sme-completeness-badge sme-completeness-badge__${pack.snapshot.completeness.toLowerCase()}`}>
          {presentation.qualityLabel}
        </span>
      </div>
      <p className="report-command-meta">
        {presentation.sourceLabel} · {presentation.generatedAt} · {presentation.rowCount.toLocaleString("en-US")} evidence rows
      </p>
    </div>
    <ReportExportBar
      onExportPdf={startPdfDownload}
      onExportCsv={() => startTextDownload("CSV")}
      onExportMarkdown={() => startTextDownload("Markdown")}
      onRunAgain={onRunAgain}
      pdfPending={pdfPending}
      runPending={runPending}
      feedback={downloadFeedback}
    />
  </div>
);

function SmeOverview({ pack, presentation }: {
  pack: DecisionPack;
  presentation: SmeCoveragePresentation;
}) {
  return (
    <div className="sme-overview-layout">
      <div className="sme-overview-main">
        {pack.warnings.length > 0 && (
          <section className="sme-warning-stack" aria-labelledby="sme-warnings-heading">
            <h3 id="sme-warnings-heading">Evidence notes</h3>
            {pack.warnings.map((warning) => (
              <p className="s-notice s-notice__warning" role="alert" key={`${warning.code}-${warning.message}`}>
                {warning.message}
              </p>
            ))}
          </section>
        )}
        <dl className="sme-snapshot" aria-label="Analysis snapshot">
          <SnapshotItem label="Instance" value={pack.snapshot.instanceHost} />
          <SnapshotItem label="Generated" value={pack.snapshot.generatedAt} />
          <SnapshotItem label="Scope" value={pack.snapshot.scopeLabel} />
          <SnapshotItem label="Collection" value={pack.snapshot.collectionLabel} />
        </dl>
        <section className="sme-summary" aria-labelledby="sme-summary-heading">
          <h3 id="sme-summary-heading">Executive summary</h3>
          <dl className="sme-kpi-strip">
            {presentation.metrics.map((metric) => (
              <div className="sme-kpi" key={metric.label}>
                <dt>{metric.label}</dt>
                <dd>{typeof metric.value === "number" ? metric.value.toLocaleString("en-US") : metric.value}</dd>
              </div>
            ))}
          </dl>
          <p className="sme-overview">{presentation.overview}</p>
        </section>
        <SmeCoverageAssessment assessment={pack.assessment} />
      </div>
      <aside className="sme-deliverable-panel" aria-labelledby="sme-deliverable-heading">
        <h3 id="sme-deliverable-heading">Deliverable</h3>
        <strong>Ready to share</strong>
        <p>The PDF includes the executive brief, priority findings, methodology, and supporting evidence.</p>
        <p>The evidence CSV contains every canonical row in decision-pack order.</p>
      </aside>
    </div>
  );
}
```

Retain the existing local `SnapshotItem` helper. Render `<ReportCommandCenter reportKey={presentation.reportKey} header={header} sections={sections} />` as the component's only result surface.

- [ ] **Step 4: Wire export behavior**

```tsx
async function startPdfDownload() {
  setPdfPending(true);
  try {
    await downloadSmeCoveragePdf(pack);
    setDownloadFeedback({ state: "success", message: "PDF download started." });
  } catch {
    setDownloadFeedback({
      state: "failed",
      message: "The PDF download could not be prepared. Check browser download permissions and try again.",
    });
  } finally {
    setPdfPending(false);
  }
}

function startTextDownload(format: "Markdown" | "CSV") {
  try {
    if (format === "Markdown") downloadSmeCoverageMarkdown(pack);
    else downloadSmeCoverageEvidenceCsv(pack);
    setDownloadFeedback({ state: "success", message: `${format} download started.` });
  } catch {
    setDownloadFeedback({
      state: "failed",
      message: `The ${format} download could not start. Check browser download permissions and try again.`,
    });
  }
}
```

Pass PDF and CSV directly to the bar, Markdown to `More formats`, and retain `onRunAgain`.

- [ ] **Step 5: Make methodology standalone**

Add `standalone?: boolean` to `SmeCoverageMethodologyProps`. When true, render the existing methodology body beneath a visible `h3` without a nested `<details>` disclosure; when false, retain the current disclosure for compatibility until all callers migrate.

- [ ] **Step 6: Finish command-center responsive styles**

```css
.sme-overview-layout {
  display: grid;
  grid-template-columns: minmax(0, 1.65fr) minmax(240px, 0.75fr);
  gap: 18px;
  align-items: start;
}

.sme-overview-main { display: grid; min-width: 0; gap: 20px; }
.sme-deliverable-panel {
  display: grid;
  gap: 10px;
  padding: 16px;
  border: 1px solid var(--so-border);
  border-radius: 8px;
  background: var(--so-surface-raised);
}
.sme-deliverable-panel h3,
.sme-deliverable-panel p { margin: 0; }

@media (max-width: 860px) {
  .sme-overview-layout { grid-template-columns: 1fr; }
  .report-command-header { align-items: stretch; flex-direction: column; }
  .report-export-actions { justify-content: flex-start; }
}

@media (max-width: 640px) {
  .report-command-header { position: static; }
  .report-section-tabs { align-items: stretch; }
  .report-section-tab { flex: 1 1 140px; white-space: normal; }
  .report-export-actions { display: grid; grid-template-columns: 1fr; }
  .report-export-actions > .s-btn,
  .report-export-more,
  .report-export-more > summary { width: 100%; }
  .report-evidence-controls,
  .report-evidence-pagination { align-items: stretch; flex-direction: column; }
}
```

Remove obsolete `.sme-result-actions` rules only after `rg "sme-result-actions" src` returns no component consumers.

- [ ] **Step 7: Run all SME component tests**

Run: `pnpm vitest run src/components/SmeCoverageDecisionPack.test.tsx src/components/SmeCoverageEvidenceTable.test.tsx src/components/SmeCoverageWorkspace.test.tsx`

Expected: PASS.

- [ ] **Step 8: Commit the composed SME experience**

```bash
git add src/components/SmeCoverageDecisionPack.tsx src/components/SmeCoverageDecisionPack.test.tsx src/components/SmeCoverageMethodology.tsx src/components/SmeCoverageWorkspace.test.tsx src/styles/app.css
git commit -m "feat: redesign SME results as a command center"
```

## Task 7: Update End-to-End Coverage

**Files:**
- Modify: `e2e/sme-coverage-analyzer.spec.ts`

- [ ] **Step 1: Update the main flow to navigate report sections**

After the result appears, assert both direct exports. Click `Priority findings · 3`, assert `zeta-runtime`, `echo`, and `delta`; click `Evidence · 7`, assert `unknown-source`; click `Methodology`, assert `pageViews / smeCount`; return to Overview and copy the assessment.

- [ ] **Step 2: Add pagination coverage with a large mocked pack**

Create a test-local decision pack whose `evidence` has 120 uniquely named rows and whose summary/finding references remain valid. Assert:

```ts
await page.getByRole("tab", { name: "Evidence · 120" }).click();
await expect(page.getByText("Rows 1–50 of 120")).toBeVisible();
await page.getByRole("button", { name: "Next page" }).click();
await expect(page.getByText("Rows 51–100 of 120")).toBeVisible();
await page.getByLabel("Coverage tier").selectOption("Immediate gap");
await expect(page.getByText(/Rows 1–/)).toBeVisible();
```

- [ ] **Step 3: Add PDF and updated CSV download assertions**

```ts
const pdfDownloadPromise = page.waitForEvent("download");
await page.getByRole("button", { name: "Export polished PDF" }).click();
const pdfDownload = await pdfDownloadPromise;
expect(pdfDownload.suggestedFilename()).toBe(
  "sme-coverage-decision-pack-stackoverflowteams-com-2026-07-30.pdf",
);
const pdfPath = await pdfDownload.path();
expect(pdfPath).not.toBeNull();
expect((await readFile(pdfPath!)).subarray(0, 5).toString()).toBe("%PDF-");

const csvDownloadPromise = page.waitForEvent("download");
await page.getByRole("button", { name: "Export evidence CSV" }).click();
```

Open `More formats`, then run the existing Markdown assertions.

- [ ] **Step 4: Update the 375px accessibility test**

Navigate to Evidence before focusing the table region. Assert the page does not overflow, direct export buttons are visible, all section tabs are keyboard reachable, the default table has seven visible headers, and the Columns control can reveal `Question-count basis`.

- [ ] **Step 5: Run the SME Playwright spec**

Run: `pnpm exec playwright test e2e/sme-coverage-analyzer.spec.ts`

Expected: PASS.

- [ ] **Step 6: Commit end-to-end coverage**

```bash
git add e2e/sme-coverage-analyzer.spec.ts
git commit -m "test: cover SME report command center"
```

## Task 8: Verify Visual and PDF Quality

**Files:**
- Modify only files identified by the bounded verification pass.

- [ ] **Step 1: Run the full automated suite**

Run: `pnpm test`

Expected: all Vitest tests PASS.

Run: `pnpm lint`

Expected: both TypeScript checks PASS.

Run: `pnpm build`

Expected: Next.js production build succeeds.

Run: `pnpm e2e`

Expected: all Playwright tests PASS.

- [ ] **Step 2: Inspect the UI in one bounded desktop/mobile pass**

Before UI edits, load the Impeccable craft-floor reference. Start the app with `pnpm dev`, open SME Coverage in the in-app browser, run the mocked flow, and capture Overview and Evidence at a desktop viewport plus Overview and Evidence at 375px. Check the approved hierarchy, sticky desktop command bar, direct PDF/CSV visibility, no page overflow, focus visibility, and 50-row evidence bound. Apply all material corrections in one batch, then confirm once.

- [ ] **Step 3: Render and inspect the downloaded PDF**

Use the PDF skill's render-and-verify workflow. Render the complete and partial PDFs to page PNGs, then inspect the cover, warning placement, page breaks, finding groups, appendix table, footer, clipped text, and blank pages. Apply one batched correction and re-render once.

- [ ] **Step 4: Run the design detector once**

Run: `node .agents/skills/impeccable/scripts/detect.mjs --json`

Expected: no unreviewed mechanical design findings on changed UI targets.

- [ ] **Step 5: Request the required finish review**

Use the Impeccable finish-reviewer with no forked history. Pass the original request, approved design spec, changed artifact paths, desktop/mobile screenshots, PDF page screenshots, craft-floor path, and detector findings. Apply the reviewer's material fixes in one batch, recapture, and request its verdict. Do not claim completion with unresolved material findings.

- [ ] **Step 6: Commit verification fixes**

```bash
git add src/components src/styles/app.css src/utilities/smeCoverage src/utils e2e package.json pnpm-lock.yaml
git commit -m "fix: finish report command center experience"
```

## Handoff To Script Migration

After this plan passes, execute `docs/superpowers/plans/2026-08-20-script-report-command-center.md` to migrate generated Script results onto the same shell and bounded evidence explorer. The SME slice is complete and releasable before that migration begins.
