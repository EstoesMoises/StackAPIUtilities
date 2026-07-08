# Tag Report Guided Output Design

## Summary

Improve the Tag Report so nontechnical Stack Overflow for Teams and Stack Enterprise admins can run it confidently, understand progress while it runs, and leave with a purpose-built Tag Health CSV plus dashboard insights. Raw live API datasets remain available for technical audit/debug workflows, but the primary report experience should answer Tag Report questions instead of exposing API pagination details.

## Problem

The current live report scope exposes `pageSize` and `maxPagesPerDataset` directly. Those controls are accurate but confusing for admins and community managers who do not think in API pages. The current live Tag Report output also behaves mostly like raw collected datasets, so users can inspect data but do not get the same clear report artifact they would expect from a reporting utility.

## Goals

- Replace the default Tag Report run-sizing experience with plain-language presets.
- Keep advanced API volume controls available for technical users without making them the main path.
- Show meaningful progress while a Tag Report run is in progress.
- Produce a curated Tag Health CSV from Tag Report data.
- Render Tag Report dashboard charts that match the CSV's derived metrics.
- Preserve raw dataset CSV/JSON downloads in the Datasets panel.
- Surface partial-data warnings before users trust charts or exports.

## Non-Goals

- Do not remove raw dataset downloads.
- Do not redesign every report in this slice.
- Do not build a background job system or persistent report history.
- Do not invent exact percentage progress when the API cannot provide a reliable final total.
- Do not add write actions or automated remediation for tags.

## Recommended Approach

Use a guided Tag Report run model:

1. Tag Report defaults to a `Standard report` preset.
2. Users can choose `Quick sample`, `Standard report`, or `Deep audit`.
3. Each preset maps to the existing `pageSize` and `maxPagesPerDataset` API controls.
4. Advanced API volume settings are collapsed by default and show the selected preset values.
5. The app runs the same live collection path, but progress and outputs are report-oriented.

This approach solves the confusing controls, gives users meaningful report artifacts, and creates a pattern that can later be reused by the other reports.

## Run Presets

The first implementation should define three presets:

| Preset | Intended use | API behavior |
| --- | --- | --- |
| Quick sample | Fast preview to confirm credentials, scope, and data shape | `pageSize: 50`, `maxPagesPerDataset: 1` |
| Standard report | Default balanced run for normal Tag Report use | `pageSize: 100`, `maxPagesPerDataset: 5` |
| Deep audit | More complete extraction when the user accepts longer runtime | `pageSize: 100`, `maxPagesPerDataset: 20` |

These values keep the Stack API page size within the existing validation range and treat completeness as a preset depth decision instead of an exposed pagination decision.

Preset controls should disclose their technical API settings at the point of choice. Each preset should have accessible detail text available on hover, focus, and tap/click, not hover alone. The detail should show:

- `pageSize`
- `maxPagesPerDataset`
- maximum records requested per dataset, calculated as `pageSize * maxPagesPerDataset`
- plain-language completeness tradeoff

Example copy:

- Quick sample: `Requests up to 50 records per dataset. Fastest option; use only to preview data shape.`
- Standard report: `Requests up to 500 records per dataset. Balanced default for normal reports.`
- Deep audit: `Requests up to 2,000 records per dataset. Slower, but reduces the chance of capped results.`

The UI should make clear that these are collection caps, not invisible cost-saving shortcuts. If the user cares about avoiding omitted data, the interface should point them toward `Deep audit` or advanced volume settings before the run starts.

Advanced controls should remain available in a collapsed section labeled `Advanced API volume settings`. The section should explain that these settings affect runtime and completeness, show the currently resolved preset values, and show validation messages using the existing scope validation rules.

## Progress Feedback

Tag Report should show a progress panel during a live run. Progress should be step-based, not a fake exact percentage.

Required progress states:

- Validate credentials.
- Plan required datasets.
- Collect each dataset required by Tag Report.
- Build Tag Health CSV rows and dashboard metrics.
- Complete, fail, or complete with warnings.

The progress panel should include:

- A progress bar based on known stages.
- Current stage label.
- Dataset currently being collected when the server has emitted that information.
- Page or record counts only when they come from real collection events.
- Completed stages.
- Error or warning messages tied to the stage that produced them.

Implementation must not fake dataset/page precision. If the app keeps the current single JSON response for the first pass, the progress panel should show a determinate pre-run stage, an indeterminate `Collecting live API datasets` stage, and completion/failure. If the implementation adds dataset/page-level details in this slice, it should do so through real progress events emitted by the runner and delivered through a same-request streaming response or equivalent non-persistent mechanism. This remains separate from a background job system.

If a run reaches the selected preset cap, the app should preserve the warning after the run completes. The dashboard and export controls should make it clear that results may be partial.

Preset-cap warnings should name the affected dataset and selected preset when possible. For example: `Questions reached the Standard report cap of 500 records. Use Deep audit or Advanced API volume settings for a more complete run.`

## Tag Health CSV

Tag Report should generate a curated CSV intended for admins and community managers. The CSV should be separate from raw dataset exports.

Initial columns:

- `tag_name`
- `health_status`
- `page_views`
- `question_count`
- `answer_count`
- `sme_count`
- `watcher_count`
- `unanswered_questions`
- `median_first_answer_hours`
- `recommended_action`

The implementation should build these rows in a report transform module, not in React components. The dashboard and CSV download should consume the same transformed rows so metrics and exported data stay consistent.

`health_status` should be a small, explainable classification derived from available Tag Report metrics. The first version should keep the classification conservative and transparent, for example:

- `Healthy` when activity and coverage are present.
- `Needs SME coverage` when the tag has questions/activity but no SME coverage.
- `Needs response attention` when unanswered or slow-response indicators are present.
- `Low activity` when the tag has little recent activity.

`recommended_action` should be a short plain-language action based on the same classification. It should not imply the app has changed Stack Overflow data.

## Dashboard

The Tag Report dashboard should answer the same questions the CSV answers:

- Which tags are most active?
- Which tags have high page views or question volume?
- Which tags need SME coverage?
- Which tags may need response-time or unanswered-question attention?

Required dashboard elements:

- Summary cards for tags covered, questions, SME coverage, and response health.
- Bar chart for top tags by page views or activity.
- Chart/list for tags needing SME coverage.
- Chart/list for tags needing response attention.
- Visible warning state when data is partial.

The dashboard should remain dense and operational, matching the product's Stack Overflow-native console style. It should not become a decorative analytics landing page.

## Data Flow

The live run should continue to collect raw datasets through the existing report runner and collectors:

1. User selects Tag Report.
2. User chooses run dates, comparison state, and run preset.
3. UI sends the resolved API volume settings to `/api/reports/run`.
4. UI initializes progress with known planning/validation stages.
5. Server validates credentials and run scope.
6. Live collectors fetch Tag Report datasets.
7. Server returns the final result, and may emit real progress events if the implementation adds same-request streaming.
8. Session state stores raw datasets for audit/download.
9. Tag Report transform builds curated Tag Health rows.
10. Report output stores the curated rows for dashboard/table/CSV use.
11. Datasets panel continues to expose raw dataset CSV/JSON downloads.

For uploaded Tag Report outputs, the existing upload path should continue to work. If uploaded data already resembles the curated Tag Report CSV, the dashboard should use it directly. If uploaded data is raw or legacy-shaped, the app should normalize what it can and show missing-metric warnings for fields it cannot derive.

## Error Handling And Warnings

The app should distinguish:

- Validation errors that prevent the run from starting.
- Collection errors that stop the run.
- Partial-data warnings that allow the run to complete but require user attention.
- Transform warnings when CSV/dashboard metrics cannot be derived from available fields.

Warnings should be attached to report output and visible near dashboard/export actions. A user should not have to open the raw Datasets panel to discover that charts or CSVs are partial.

## UI Surfaces

Modify these surfaces in the implementation:

- Tag Report scope/run controls.
- Run status/progress display.
- Tag Report dashboard.
- Report output download controls.
- Raw Data/Table view labels if needed, so curated report output and raw datasets are clearly different.

The UI should keep existing Stacks-like controls, compact panels, accessible labels, visible focus states, and restrained Stack Overflow orange accents.

## Testing Strategy

Implementation should use test-first coverage for:

- Preset-to-API-volume mapping.
- Scope validation with preset and advanced controls.
- Preset technical detail text for hover/focus/tap disclosure.
- Progress panel stage rendering.
- Progress warnings for partial runs.
- Tag Health row generation from representative Tag Report records.
- Dashboard metrics derived from the same Tag Health rows as the CSV.
- CSV download contents and filename.
- Raw dataset downloads remaining available.
- Uploaded Tag Report compatibility where existing importers provide enough data.

## Acceptance Criteria

- Nontechnical users can run Tag Report without understanding page size or max pages.
- Users can inspect each preset's technical API settings before running the report.
- Technical users can still inspect or adjust advanced API volume settings.
- While the report runs, users see what stage is active and whether progress is being made.
- Completed Tag Report runs produce a Tag Health CSV download.
- Tag Report dashboard charts use the same transformed metrics as the CSV.
- Raw dataset downloads remain available separately.
- Partial or limited data is clearly warned about before export.
- Tests cover the new preset, progress, transform, dashboard, and export behavior.
