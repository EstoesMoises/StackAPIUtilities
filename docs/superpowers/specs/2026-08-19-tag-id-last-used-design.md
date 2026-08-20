# Tag ID and All-Time Last Used Design

## Summary

Bring the Tag Report changes from [StackExchange/so4t_tag_report PR #6](https://github.com/StackExchange/so4t_tag_report/pull/6) into this application. Tag Health output will include a stable API v3 tag identifier, the tag creation date already present in the upstream report, and the latest date on which a question or article was created with the tag.

`last_used` is all-time metadata. It does not change meaning when a user selects a current or comparison period for the other Tag Report metrics.

## Goals

- Add `tag_id`, `tag_creation_date`, and `last_used` to normalized Tag Health rows, table output, and curated CSV downloads.
- Preserve the upstream definition of `last_used`: the latest UTC `creation_date` among questions and articles that currently carry the tag.
- Keep question, answer, page-view, response, and SME health metrics scoped to the selected report period.
- Keep the source data for tag metadata auditable in stored live datasets.
- Import both the updated upstream CSV shape and legacy Tag Report files that do not contain the new metadata columns.
- Warn users when collection caps may make all-time `last_used` values incomplete.

## Non-Goals

- Do not treat answers, comments, edits, votes, or views as tag use.
- Do not change Tag Health status thresholds, classifications, sorting, or dashboard charts.
- Do not add tag-specific API requests.
- Do not redesign report presets, comparison behavior, or the raw dataset download experience.
- Do not infer identifiers or dates for legacy uploads that omit them.

## Architecture

Use explicit datasets and join them in the Tag Report transform.

1. Keep the existing v2 `tags`, scoped `questions`, scoped `articles`, and `tagSmes` datasets used by Tag Health metrics.
2. Add the existing v3 `tagSmeCounts` dataset to the Tag Report plan. Its `/tags` records supply the stable tag `id`, `creationDate`, and canonical tag name.
3. Add a `tagLastUsed` dataset. Its collector fetches v2 questions and articles without current/comparison date parameters, calculates one latest valid creation timestamp per known v3 tag, and emits compact metadata rows.
4. Extend `buildTagHealthRowsFromLiveRecords` to join `tags`, `tagSmeCounts`, and `tagLastUsed` by normalized tag identity before it builds Tag Health rows.
5. Keep React components presentation-only. The table, dashboard, session storage, and CSV export continue consuming normalized Tag Health rows.

This keeps period-scoped metrics and all-time metadata separate. It also makes the extra collection visible in stored datasets and lets the existing warning pipeline identify incomplete results.

Adding `tagSmeCounts` means live Enterprise Tag Report runs use both API v2 and API v3. Under the application's existing credential policy, Enterprise runs therefore require an API key and a valid v3 access token. Basic/Business runs continue using the configured personal access token.

## Data Model

Add `tagLastUsed` to `DatasetName` and add these fields to every normalized `TagHealthRow`:

- `tag_id: number | null`
- `tag_creation_date: string`
- `last_used: string`

Live records normally provide all three fields. Updated upstream CSV imports populate all three. Legacy imports and incomplete source data use `null` for `tag_id` and an empty string for either date. This keeps the normalized row and CSV header stable without fabricating metadata.

The curated Tag Health CSV column order begins with:

1. `tag_name`
2. `tag_id`
3. `tag_creation_date`
4. `last_used`

The existing health and activity columns follow unchanged.

## Collection and Data Flow

The Tag Report dataset plan orders `tagSmeCounts` before `tagLastUsed` so the latter can restrict its output to known v3 tags.

For the selected current or comparison period:

1. Collect the existing scoped datasets normally.
2. Collect v3 tags through `tagSmeCounts` without date parameters.
3. Collect questions and articles again for `tagLastUsed`, using the selected page size and page cap but deliberately omitting `fromdate` and `todate`.
4. Normalize tag names with the shared NFKC, trim, and case-insensitive identity rules.
5. Ignore content tags absent from the v3 tag collection.
6. For each known tag, select the greatest valid creation timestamp across questions and articles.
7. Convert that timestamp to a UTC `YYYY-MM-DD` value and emit a blank value for unused tags.
8. Store the compact `tagLastUsed` rows and join them into the period's normalized Tag Health rows.

Current and comparison runs collect their metadata independently, keeping each snapshot self-contained. The dashboard comparison continues comparing only health metrics; identifiers and dates are descriptive output fields rather than trend metrics.

## Timestamp and Matching Rules

- Accept finite numeric Unix timestamps in seconds or milliseconds, numeric strings, and parseable date strings supported by existing live-record normalization.
- Reject booleans, missing values, non-finite numbers, and timestamps that cannot produce a valid UTC date.
- Compare valid timestamps before formatting, then emit `YYYY-MM-DD` in UTC.
- Questions and articles both count; the later value wins across content types.
- Duplicate or case-variant tags on one content record do not affect the maximum-date calculation.
- Unknown content tags are ignored.
- An unused known tag receives an empty `last_used` value.

## Errors and Partial Data

Collection failures continue using the existing live-run failure path.

If either unscoped questions or unscoped articles reaches the configured page cap while more pages remain, merge that pagination state into `tagLastUsed`. The existing report warning pipeline then attaches a Tag Last Used cap warning to the run and keeps it visible above the dashboard and near exports. The run succeeds because the remaining Tag Health data is still useful, but it does not silently claim complete all-time dates.

Invalid timestamps and unknown content tags are skipped rather than failing a report. Missing v3 metadata produces blank normalized fields. Legacy uploads remain usable without warnings solely because they predate these columns.

## Imports and Exports

The `tag_metrics.csv` importer reads these upstream headers when present:

- `Tag Id`
- `Tag Creation Date`
- `Last Used`

It continues importing older files with only the existing metric columns. Curated downloads always emit the normalized snake-case headers, including blank metadata cells when source data is unavailable. Empty Tag Health downloads retain the complete updated header.

Raw dataset CSV and JSON downloads remain unchanged and continue exposing the source records separately.

## Product Surface

No dashboard redesign is required. The new fields appear in normalized report table data and curated Tag Health CSVs. Dashboard health cards, distribution, queues, and comparison charts retain their current behavior because tag ID and dates are descriptive metadata rather than health signals.

Preset disclosure text should state that Tag Report also requests all-time questions and articles for last-used metadata. This prevents users from mistaking the extra collection for period-scoped work.

## Testing Strategy

Use test-first coverage for:

- Tag Report planning includes v3 tag metadata before `tagLastUsed`.
- Enterprise credential validation reflects the mixed v2/v3 Tag Report plan.
- `tagLastUsed` requests questions and articles without report date parameters.
- Page size and page cap still apply to both all-time requests.
- Latest valid question/article timestamp wins and formats in UTC.
- Boolean, missing, invalid, non-finite, and out-of-range timestamps are ignored.
- Unknown tags are ignored and unused known tags receive blank values.
- Case and Unicode-normalized tag identities join correctly.
- Live Tag Health rows include v3 ID, creation date, and last-used date.
- Scoped health metrics are unchanged by the all-time metadata collection.
- A capped all-time source produces a visible partial-data warning.
- Updated upstream CSV imports populate the metadata fields.
- Legacy CSV imports remain compatible with blank metadata.
- Curated CSV contents and empty-output headers use the new stable column order.
- Existing dashboard, session persistence, and comparison tests continue passing.

## Acceptance Criteria

- Live Tag Report rows and CSVs include `tag_id`, `tag_creation_date`, and `last_used`.
- `last_used` uses the latest UTC creation date from all fetched question/article history, regardless of the report period.
- Period-scoped Tag Health metrics retain their existing semantics.
- Updated and legacy upstream Tag Report CSVs both import successfully.
- Collection caps that can make `last_used` incomplete produce visible warnings.
- Raw source datasets remain downloadable and normalized report output remains deterministic.
- Focused tests, the complete unit suite, and TypeScript checks pass.
