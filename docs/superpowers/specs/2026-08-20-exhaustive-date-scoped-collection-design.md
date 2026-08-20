# Exhaustive Date-Scoped Collection Design

## Summary

Stack API Utilities will remove Quick sample, Standard report, Deep audit, and custom API volume settings from the user experience. A report run will mean one thing: collect every record the APIs make available for the selected date scope.

Users will choose current-period dates and, optionally, comparison-period dates. The application will own pagination and rate-limit behavior. A run will succeed only after all required datasets finish collection; interrupted or safety-aborted pagination will fail explicitly instead of producing a capped result labeled as complete.

The SME Coverage Analyzer follows the same mental model for its fixed all-time scope. It will collect all available records without asking the user to choose a collection depth.

## Product Contract

- Users choose the time scope, not a collection-depth mode.
- A successful run contains all records returned by exhaustive pagination for that scope.
- Quick sample, Standard report, Deep audit, record caps, and advanced API volume controls are not user-facing concepts.
- The application automatically handles page size, pagination, API backoff, and retry behavior.
- A collection that cannot finish is not a successful or complete report.
- Results identify their date scope and completion status.
- The SME Coverage Analyzer exhausts pagination for its fixed all-time scope.

## User Experience

### Report scope

The Scope panel contains only:

- current start date;
- current end date;
- an optional comparison-period toggle;
- comparison start and end dates when comparison is enabled.

Leaving both dates blank means all available history. The existing current-period, comparison-period, and run-both actions remain. Preset radios, record-coverage descriptions, page-size fields, maximum-page fields, and custom-volume notices are removed.

Supporting copy explains that a run collects all available data for the chosen dates and may take longer for large instances. It does not ask users to trade completeness for speed.

### SME Coverage Analyzer

The analyzer keeps its fixed all-time scope and read-only purpose. API volume settings are removed. The primary action automatically collects all available tags, questions, assigned-SME counts, and other required supporting records.

### Progress and completion

Progress can report which dataset is being collected and when the application is respecting API backoff. Rate limiting is an expected execution state rather than a configuration decision.

A completed result states that all available data was collected and names the effective date scope. All-time workflows state that their scope is all available history. Page and record counts remain available as operational evidence, but preset names and configured caps do not appear.

## Architecture

### Request and domain models

`ReportRunScope` becomes a date-scope model containing `current` and optional `comparison` periods. User-facing request payloads no longer contain `pageSize`, `maxPagesPerDataset`, or `runPreset`.

Collection page size becomes an internal server-owned constant set to the maximum supported by each API. Normal collection has no maximum-page setting. Utility settings follow the same rule and are no longer passed from the browser.

The obsolete preset domain and the shared API volume settings component can be removed after remaining consumers migrate.

### Collection flow

For each required dataset, collectors request the maximum supported page size and continue until the API proves completion:

- Stack API v2.3 returns `has_more: false`;
- Stack API v3 exhausts `totalPages`; or
- a v3 endpoint without total-page metadata returns an empty terminal page.

The existing client behavior already supports uncapped pagination when `maxPages` is omitted. Report and utility runners will stop passing a maximum-page option and will remove cap-warning generation.

Date-aware fact datasets receive the selected start and end dates. Reference datasets that an API cannot date-filter are collected exhaustively and used as supporting context for the scoped result. This distinction remains an implementation concern; the completed report clearly describes the period represented by its conclusions.

### Completion and safety

The run is atomic at the report or utility level. Datasets are committed to session and browser persistence only after every required collection finishes. If authentication, networking, API validation, throttling retries, or pagination safety checks fail, the run ends in a failed state and does not publish partial records as a completed result.

An internal runaway-pagination circuit breaker protects against malformed or non-advancing API pagination. Crossing that boundary raises an explicit collection error. It is not a user-selectable cap, and the application must not relabel the partial response as complete.

## Persistence and Compatibility

New report and utility snapshots store:

- the effective date scope for reports, or the fixed all-time scope for the utility;
- collection time;
- dataset identifiers;
- record and page counts needed for evidence or diagnostics;
- warnings unrelated to user-configured caps.

A snapshot is created only for a successful, fully collected run. Failed runs retain runtime error state but create no snapshot, so a persisted new-format snapshot is complete by definition.

New snapshots do not store preset names, requested maximum pages, or user-configured page sizes.

The browser-storage reader remains backward compatible with existing snapshots and decision packs. It accepts and preserves legacy `runPreset`, `pageSize`, `maxPagesPerDataset`, and cap-warning metadata while ignoring those fields for new execution. Every pre-change saved output is labeled `Legacy run — completeness not verified under current collection rules`; its original cap warning remains visible when one exists. Migration must not rewrite a historically capped result as complete.

## Errors and Messaging

- Rate-limit waits appear in progress messaging and resume automatically.
- Authentication and authorization failures keep their actionable credential guidance.
- API or network failures say that a complete result was not produced.
- Pagination safety failures identify the affected dataset and say collection stopped before completion.
- No message recommends Deep audit, Standard report, Quick sample, advanced volume settings, or increasing a page cap.
- A successful run may say `All available data collected` and include the formatted date scope.

## Testing

### Unit and integration coverage

- v2 pagination continues through every page until `has_more` is false.
- v3 pagination continues through `totalPages` or an empty terminal page.
- report and utility runners omit maximum-page options.
- selected dates propagate to every date-aware request.
- required unscoped reference datasets still collect fully.
- current, comparison, and run-both flows preserve their distinct scopes.
- backoff and throttling waits do not change completeness semantics.
- a mid-run failure does not persist or publish a partial completed result.
- the runaway-pagination circuit breaker produces an explicit failure.
- legacy stored snapshots and decision packs remain readable without being upgraded to complete.
- Scope and SME Coverage interfaces contain no preset or API-volume controls.
- user-facing copy contains no Standard, Deep audit, Quick sample, or cap-recovery guidance.

### End-to-end coverage

- a user can run a report by selecting only dates;
- leaving dates blank collects all available history;
- a comparison run exhausts both periods independently;
- multi-page fixtures return all records rather than the first 500 or 2,000;
- successful results communicate scope and completion;
- interrupted runs communicate failure and do not show a completed report.

## Acceptance Criteria

1. No normal report or SME Coverage screen asks the user to choose collection depth or API volume.
2. No new run request accepts a user-selected preset or maximum-page cap.
3. Successful live runs exhaust all required dataset pagination for their effective scope.
4. Incomplete collection fails visibly and is not stored or rendered as a completed result.
5. Date and comparison behavior remains available and is the only report-scope choice.
6. Legacy browser-stored outputs remain readable and retain honest historical completeness semantics.
7. Automated tests prove exhaustive pagination, failure atomicity, date propagation, compatibility, and removal of obsolete controls and terminology.

## Out of Scope

- Adding new report types or dataset endpoints.
- Changing credential requirements or OAuth behavior.
- Offering a developer-facing sampling mode in the production UI.
- Redesigning report dashboards beyond completion and scope messaging required by this change.
