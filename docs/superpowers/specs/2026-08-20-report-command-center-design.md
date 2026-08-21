# Report Command Center Design

## Summary

Replace long, vertically stacked generated results with a shared Report Command Center. A completed report becomes a deliverable-first workspace: polished PDF and complete CSV exports remain visible at the top, conclusions are separated from evidence through report sections, and large datasets are explored through a searchable, filterable, paginated table instead of an effectively infinite page.

SME Coverage Analyzer is the first complete implementation because it currently combines the largest number of report concerns: warnings, snapshot metadata, executive metrics, three priority queues, copy-ready narrative, methodology, canonical evidence, and multiple exports. The shared structure must also support Script reports without forcing empty or irrelevant sections onto them.

## Job And Audience

Stack Overflow for Teams and Stack Enterprise administrators, community managers, enablement leads, and technical operators reach this surface immediately after a report succeeds or a compatible result is restored locally. Their primary job is to package a trustworthy deliverable for internal or customer-facing stakeholders. Their secondary job is to explore the findings and verify the evidence behind them.

Success means a user can:

- Export the finished deliverable without searching the page.
- Understand the report's quality, scope, and primary conclusions before opening raw evidence.
- Navigate directly to findings, evidence, or methodology without traversing unrelated content.
- Search, filter, sort, and page through thousands of evidence rows without extending the page indefinitely.
- Trace every conclusion and exported finding back to canonical evidence.

The surface remains an **Operate** experience. It should feel like a precise Stack Overflow-native operations console, not a decorative analytics portal.

## Selected Direction

Use a **Report Command Center** with three layers:

1. A persistent report command bar identifies the result and keeps the primary exports available.
2. Section tabs divide the result into Overview, Priority findings, Evidence, and Methodology when those sections contain useful content.
3. Each section uses a bounded layout optimized for its job instead of composing one long document in the browser.

The first viewport communicates that the report is ready, shows its quality and scope, exposes `Export polished PDF` and `Export evidence CSV`, and presents the executive brief beside a compact deliverable preview. The memorable interaction is switching from the packaged conclusion to a full evidence explorer without leaving the report or losing export access.

The approved export hierarchy is:

- `Export polished PDF`: filled primary action.
- `Export evidence CSV`: prominent outlined action beside PDF, never hidden in a menu.
- `More formats`: lower-emphasis menu for report-specific secondary formats such as Markdown.
- `Run again`: standard secondary action, visually separated from deliverable exports where space permits.

## Scope

### Included

- A reusable command-center shell for generated Utility and Script results.
- SME Coverage Analyzer as the first full decision-pack integration.
- Direct PDF and CSV exports in the persistent command bar.
- A polished, neutral, share-ready SME coverage PDF.
- Section navigation with content-aware tabs.
- A unified, ranked SME priority-findings view.
- A bounded evidence explorer with search, tier and quality filters, sorting, pagination, and column visibility.
- Existing Markdown and copy-assessment actions in contextually appropriate secondary locations.
- Responsive, keyboard-accessible behavior and explicit export feedback.

### Not Included

- A persistent report library, run history, report versioning, or cloud storage.
- Server-side PDF rendering or transmission of browser-local datasets to a new service.
- User-authored report layouts, branding controls, or PDF theme customization.
- Changes to SME coverage formulas, rankings, narrative rules, or canonical export ordering.
- New report conclusions where an existing Script only supports a dataset summary.
- Charts or report sections that do not help the user understand or package the available data.

## Information Architecture

### Report Command Bar

The command bar is the report's stable identity and action surface. It contains:

- Report title.
- Instance or source identifier when available.
- Generation date.
- Record or evidence-row count.
- Analysis or collection quality label.
- Direct PDF and CSV export actions when supported.
- Secondary formats and run-again action.
- A compact live region for generation, success, and failure feedback.

On desktop, the command bar remains sticky below the application chrome while the user changes sections or explores evidence. On narrow layouts it becomes a normal stacked block so it does not consume most of the viewport.

PDF appears only when a report adapter can provide a meaningful report model containing a summary plus supporting content. CSV appears whenever canonical rows exist. Tabs appear only when their sections contain useful content.

### Overview

Overview is the share-ready story rather than a second raw dashboard. For SME Coverage it contains:

- Evidence notes before conclusions when warnings exist.
- Executive metrics.
- Deterministic overview and assessment content.
- The three highest-priority examples, each linked conceptually to its evidence row.
- A compact deliverable panel describing what the PDF and CSV contain.

The desktop layout places the executive brief in the wider column and the deliverable panel in a narrower companion column. Mobile stacks the brief before the deliverable panel.

### Priority Findings

SME Coverage's three separate horizontal tables become one ranked findings table. The canonical tier and stable decision-pack order determine ranking; the component does not recompute priority.

The table exposes the most decision-relevant columns by default:

- Priority tier.
- Tag.
- Why it matters.
- SME count.
- Demand signal.
- Recommended action.

Tier filters let users isolate Immediate gap, Critical under-coverage, or Light coverage without navigating between repeated sections. Technical fields such as question-count basis remain available through row details or optional columns rather than widening the default table.

### Evidence

The evidence explorer is a bounded data workspace, not an extension of the page. It includes:

- Global search across prepared evidence text.
- Coverage-tier filter.
- Evidence-quality filter.
- Existing deterministic column sorting.
- A column-visibility control with a concise default column set.
- Client-side pagination with page sizes of 25, 50, and 100; default 50.
- Visible `rows x–y of n` status.
- A horizontally scrollable table region only when selected columns cannot fit.
- Explicit empty and no-match states.

Search, filters, sort, visible columns, and the current page are presentation state only. They never change the canonical decision pack, PDF ordering, CSV ordering, or downloaded values. Any search or filter change returns pagination to the first page.

The existing 12 SME evidence fields remain available. Default columns are Tag, Page views, SMEs, Page views per SME, Coverage tier, evidence quality, and Recommended action. Questions, question-count basis, percentile, detailed reason, and separate demand/SME quality fields can be enabled from the column control.

### Methodology

Methodology gets a dedicated section instead of appearing between conclusions and evidence in the main reading path. It retains all existing formulas, thresholds, source precedence, quality explanations, and collection caveats. Analysis quality and evidence notes remain visible elsewhere; moving methodology does not hide uncertainty.

## PDF Deliverable

The PDF is neutral enough for internal or customer-facing circulation and carries Stack API Utilities identification without adding customer claims or invented branding. It is generated locally in the browser from a deterministic report model.

The SME coverage PDF contains:

1. Cover and report identity: title, instance, generation date, scope, collection status, and analysis quality.
2. Evidence notes and limitations, before conclusions when present.
3. Executive summary metrics and overview.
4. Copy-ready assessment.
5. Ranked priority findings grouped by tier, preserving canonical order within each tier.
6. Methodology and evidence-quality note.
7. Supporting evidence appendix containing the canonical rows referenced by included findings.
8. A note that the accompanying CSV contains the complete canonical evidence dataset.

The PDF does not place all thousands of evidence rows into the appendix. The direct CSV is the complete machine-readable deliverable; the PDF is the concise decision document. Both exports use the same generated timestamp and filename stem so recipients can recognize them as a pair.

PDF generation is lazy-loaded when requested to avoid increasing the initial application bundle unnecessarily. Generation shows a busy state, prevents duplicate clicks, and completes through the existing browser download behavior. No report data leaves the browser for PDF generation.

Use [`@react-pdf/renderer`](https://react-pdf.org/) as the PDF rendering boundary. It supports browser-side document rendering and gives the report a dedicated paged layout instead of depending on browser print styles. The renderer and SME PDF document component load only after the user requests PDF export.

## Shared Component And Data Model

Introduce a presentation boundary between domain report outputs and the command-center UI.

### `ReportPresentationModel`

A report adapter produces a presentation model with:

- Identity and snapshot metadata.
- Quality state and warnings.
- Summary metrics.
- Overview and optional assessment.
- Optional prepared findings.
- Canonical evidence rows and column definitions.
- Optional methodology.
- Explicit export capabilities.

The model carries prepared values and references; it does not own SME classification or other domain calculations.

### Shared Components

- `ReportCommandCenter`: shell, command bar, content-aware section tabs, section state, and responsive layout.
- `ReportExportBar`: direct PDF/CSV actions, secondary-format menu, run-again action, and live feedback.
- `ReportOverview`: summary metrics, conclusion content, warnings, and deliverable description.
- `ReportFindingsTable`: ranked, filterable prepared findings.
- `ReportEvidenceExplorer`: search, filters, sorting, column visibility, and pagination.
- `ReportMethodology`: transparent methodology content.
- `ReportDeliverablePreview`: concise description of the export package, not a pixel-perfect embedded PDF renderer.

### Report Adapters

- `createSmeCoveragePresentation(pack)` maps the existing decision pack without changing its values or canonical order.
- Script report adapters map existing dashboard summaries and raw records into only the sections and exports they can support honestly.
- A Script with no useful narrative can omit PDF and Overview, exposing CSV and Evidence without placeholder dashboard content.

This boundary prevents the command-center components, CSV exporter, and PDF exporter from independently interpreting source records.

## Data Flow

1. A run or restored local result produces the existing domain report output.
2. The report-specific adapter creates a `ReportPresentationModel` from that output.
3. `ReportCommandCenter` renders only the useful sections declared by the model.
4. Browser-only presentation state controls the active section and evidence exploration.
5. The PDF exporter consumes the presentation model and prepared finding references.
6. The CSV exporter continues consuming canonical evidence rows in canonical order.
7. Success or failure is announced in the command bar without navigating away or discarding the report.

For SME Coverage, warnings must remain before conclusions in the Overview and PDF. Findings, metrics, assessment, and appendix rows must all trace to the same existing `SmeCoverageDecisionPack` evidence rows.

## States And Feedback

- **No result:** keep the current run workspace; do not render an empty command center.
- **Loading a result:** preserve the current run-progress experience. The command center appears only after a usable result exists.
- **Complete or partial result:** show the corresponding quality label and evidence notes before conclusions.
- **Empty result:** show identity, quality, explanatory Overview content, and any meaningful exports; omit empty Findings and Evidence tabs when no rows exist.
- **Large result:** render the first evidence page only. Search, sort, and filtering remain client-side against browser-local rows.
- **PDF generating:** change the action label to `Preparing PDF…`, expose busy semantics, and disable that action until completion or failure.
- **Export success:** announce the named format and row count or report identity in a polite live region.
- **Export failure:** keep the report in place and explain that browser download permissions should be checked before retrying.
- **No filter matches:** preserve active controls and show a clear no-match message with the unfiltered total.

## Responsive Behavior

- At wide desktop sizes, Overview uses a main brief plus deliverable companion column.
- The command bar actions wrap before labels truncate. PDF and CSV remain visible; secondary formats and run-again may move to the next line.
- On tablets and phones, the Overview columns stack and section tabs wrap across lines without truncating their labels.
- On phones, the command bar is not sticky, direct export buttons are full-width, filters stack, and pagination controls remain reachable after the table.
- Evidence uses table overflow only inside its labeled focusable region; the entire page must never overflow horizontally.

## Accessibility

- Use semantic tabs with matching tabpanel relationships and keyboard arrow navigation.
- Keep native buttons, search input, selects, table elements, headings, and definition lists.
- Provide visible focus treatment for export actions, tabs, filters, sortable headers, column controls, the table region, and pagination.
- Pair color-coded quality and tier styles with visible text.
- Mark PDF generation as busy and announce completion or failure without stealing focus.
- Preserve logical focus when a section changes; focus moves only when the user explicitly activates a control.
- Ensure sticky content does not obscure focused controls or headings.

## Testing

### Unit And Component Tests

- Presentation adapters preserve domain values, warning order, canonical evidence order, and optional-section rules.
- The command bar exposes PDF and CSV as direct actions and keeps Markdown secondary.
- Tabs render only for populated, useful sections and satisfy tab semantics.
- Findings render in prepared ranking order and tier filters do not mutate source data.
- Evidence search, tier and quality filters, sorting, column visibility, and pagination compose correctly.
- Search and filter changes reset the page without changing canonical rows.
- PDF and CSV success/failure states are announced accessibly.
- A new report identity resets report-local navigation and explorer state.

### PDF Tests

- The PDF model preserves snapshot metadata, warnings-before-conclusions order, metrics, assessment, findings, methodology, and referenced appendix rows.
- The generated file has the expected filename, non-empty content, stable section headings, page count, and no missing required text.
- Partial and empty analysis-quality states produce accurate limitation language.
- Large reports keep the PDF appendix bounded while the CSV still contains every canonical evidence row.

### End-To-End And Visual Verification

- Run SME Coverage, move between every section, filter and page evidence, and verify exports without triggering a Script route.
- Confirm PDF and CSV downloads and suggested filenames.
- Verify the generated PDF visually at representative complete, partial, and empty states.
- Inspect desktop and narrow layouts for sticky-bar behavior, wrapped actions, tab access, table overflow, and focus visibility.
- Run `pnpm test`, `pnpm lint`, `pnpm build`, and the relevant Playwright coverage.

## Acceptance Criteria

- A completed SME coverage report opens in the Report Command Center instead of one long result stack.
- PDF and complete evidence CSV are both prominent, direct actions in the command bar.
- The PDF is locally generated, share-ready, and useful for both internal and customer-facing audiences.
- Overview, Findings, Evidence, and Methodology are separately navigable and appear only when useful.
- Thousands of evidence rows do not increase page length beyond the selected page size.
- Findings and exports remain traceable to unchanged canonical evidence.
- The redesign does not alter collection, analysis, ranking, warning, or persistence semantics.
