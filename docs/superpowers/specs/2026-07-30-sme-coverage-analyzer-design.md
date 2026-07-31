# SME Coverage Analyzer Design

## Summary

Add a top-level Utilities product area and introduce SME Coverage Analyzer as its first utility. The analyzer runs independently from Tag Report, reuses the existing Stack API clients and tag-metric normalization logic, joins all-time demand metrics to authoritative current SME counts from the Internal v3 Tags API, and produces a decision pack instead of only a dataset or spreadsheet.

The MVP is:

- Self-contained: users do not run or upload Tag Report first.
- Read-only: it never changes customer data.
- Deterministic: every classification and sentence comes from explicit rules.
- Evidence-based: every highlighted tag and metric traces to one evidence row.
- Customer-relative: risk thresholds adapt to the current instance while remaining visible and reproducible.

## Context

The current application treats its read-only workflows as reports. Tag Report can collect API data, normalize it into Tag Health rows, classify zero-SME tags, display operational queues, and export CSV. Community managers still need to move that data into spreadsheets or prompts before they receive the decision-ready information they use in customer work.

A common example is an SME coverage assessment that:

- Calculates total page views per SME for every tag.
- Identifies high-demand tags with no SMEs.
- Finds tags with some SMEs but unusually thin coverage.
- Explains which gaps matter most and why.
- Produces copy-ready language for a brief, email, or presentation workflow.

The product is missing a decision layer between raw reports and customer-ready recommendations.

## Product Model

The application will distinguish three kinds of workflow:

- **Scripts** collect and transform API data into trustworthy datasets and report outputs.
- **Utilities** answer a defined business question using API data and shared script logic.
- **Write Tools** preview and perform guarded mutations.

The existing Reports navigation label becomes Scripts. Utilities becomes a new top-level product area. Credentials, Uploads, Datasets, and Write Tools remain shared supporting areas.

The resulting navigation order is:

`Scripts · Utilities · Credentials · Uploads · Datasets · Write Tools`

## Goals

- Establish a clear Scripts/Utilities boundary.
- Let a community manager run SME coverage analysis without first running Tag Report.
- Collect only the API datasets required for the analysis.
- Calculate page views per SME consistently for every analyzable tag.
- Distinguish immediate no-SME risk from critical and light under-coverage.
- Generate a deterministic executive summary and copy-ready assessment.
- Show formulas, thresholds, completeness, and source evidence.
- Export the decision pack as Markdown and the complete evidence as CSV.
- Preserve the application's credential and browser-local data guarantees.
- Create only the reusable utility abstractions justified by this first utility.

## Non-Goals

- Recent-period or period-over-period SME coverage analysis.
- User-defined risk thresholds in the MVP.
- AI-generated or AI-rewritten narrative.
- Google Docs, Google Slides, or branded presentation generation.
- Cross-document recommendation synthesis.
- Uploading an existing Tag Report as the analyzer's input.
- Listing individual SME identities or expanding SME user groups.
- Adding SME assignments or performing any other write action.
- Creating a generic declarative analysis-recipe engine.
- Redesigning the existing Script dashboards.

## Chosen Approach

Implement a dedicated utility pipeline.

SME Coverage Analyzer receives its own catalog entry, run route, runner, pure analysis module, deterministic narrative builder, and decision-pack UI. It reuses API clients, pagination behavior, throttling, and canonical tag normalization rather than reimplementing Tag Report.

This approach was selected over:

- A Tag Report tab, which would keep the outcome hidden inside a data-producing script and blur the new product boundary.
- A generic recipe engine, which would generalize from one example and enlarge the MVP before a second utility reveals the truly reusable concepts.

## Product Structure And User Flow

### Scripts

The current Reports panel is renamed Scripts. Its report catalog and run behavior otherwise remain unchanged in this slice.

### Utilities

Utilities receives a sidebar catalog. SME Coverage Analyzer is the first entry and includes:

- Title: `SME Coverage Analyzer`
- Scope: `All-time demand · Current SME coverage`
- Mode: `Read-only`
- Description: `Find tags where knowledge demand is not matched by enough SME coverage.`

Selecting it opens a focused workspace that explains:

- The analysis compares all-time tag page views with current assigned-SME coverage at the time of the run.
- It applies transparent hybrid risk rules.
- It requires valid session credentials for both the tag-metrics and SME-count APIs.
- It does not require a prior Script run or upload.

The primary action is `Run SME coverage analysis`.

The workspace uses the existing Deep audit API volume preset by default because the result analyzes all-time demand. An Advanced API volume disclosure exposes the existing Quick sample, Standard, and Deep audit presets without making configuration a prerequisite for the primary action. Quick, Standard, or otherwise capped runs are labeled as partial samples rather than complete instance snapshots.

### Run Flow

1. Validate the current session credentials and instance support.
2. Collect the v2 tag list and all-time question records required for demand metrics.
3. Collect authoritative assigned-SME counts from the Internal v3 Tags API.
4. Normalize v2 demand records and join them to v3 SME counts by canonical tag name.
5. Build evidence rows and calculate customer-relative thresholds.
6. Assign coverage tiers and stable rankings.
7. Generate the deterministic narrative and decision pack.
8. Store the supporting datasets and utility result in browser-local state.
9. Render the completed decision pack in the utility workspace.

Progress uses plain-language stages that match this flow. The utility does not expose date controls because the MVP compares all-time demand with the current SME assignment snapshot.

## Scope And Data Sources

The analyzer collects only:

- `tags`: the existing v2 `/tags` collection used for the tag universe and all-time question-count fallback
- `questions`: the existing v2 `/questions` collection used to aggregate all-time page views by tag
- `tagSmeCounts`: the Internal v3 `/tags` collection used for `subjectMatterExpertCount`

It does not collect the full Tag Report dataset plan of tags, users, questions, articles, and per-tag top answerers; users, articles, and top answerers are omitted.

The v2 sources provide:

- Tag name
- All-time question count from the tag record when present
- Question tag assignments
- Per-question all-time `view_count`

The analyzer calculates a tag's total page views by summing `view_count` for every collected all-time question carrying that tag. Each question contributes its views once to each of its distinct normalized tags. Tag-level page-view fields are not added to the question sum, preventing double counting.

Question count follows explicit source precedence:

1. Complete question enumeration: use the deduplicated number of collected questions for the tag.
2. Capped question enumeration with a valid v2 tag `count`: use that all-time tag total.
3. Capped question enumeration without a valid tag total: use the deduplicated collected-question count as a labeled partial sample.
4. No trustworthy source: leave question count unavailable.

The v3 tag records provide the authoritative assigned-SME count. A numeric `subjectMatterExpertCount`, including numeric zero, is trustworthy for that retrieved tag. A missing or null count means SME coverage is unavailable, not zero.

The existing `tagSmes` collector is not an SME-assignment source for this utility. It calls v2 `/tags/{tag}/top-answerers/all_time`, which the [official v2 documentation](https://api.stackexchange.com/docs/top-answerers-on-tags) defines as the top 20 answerers rather than assigned SMEs. The analyzer must never use that record count as its denominator. Assigned-SME counts come from the `subjectMatterExpertCount` field documented for [Internal v3 Tags](https://sdk.stackoverflow.help/tags/getall/).

The evidence universe is the union of tag names from v2 tags, v2 question tag assignments, and v3 tags. Sources join by a canonical tag key created by applying Unicode NFKC normalization, trimming surrounding whitespace, and ECMAScript locale-independent lowercase conversion. Punctuation, interior whitespace, and hyphens are not rewritten. The displayed tag name is the lexicographically first trimmed, NFKC-normalized source spelling for that key.

Duplicate handling is conservative and deterministic:

- Duplicate v2 tag records with identical normalized metrics collapse to one. Conflicting duplicate `count` values invalidate question count only when that tag count fallback is actually used; a complete question enumeration remains authoritative and valid.
- Duplicate v3 tag records with the same numeric `subjectMatterExpertCount` collapse to one. Conflicting counts, or a mix of numeric and unavailable counts, make SME quality `Unknown`; counts are never summed or selected.
- Questions deduplicate by stable question ID before aggregation. Identical normalized duplicates count once. Conflicting tag sets or view counts make demand quality `Invalid` for every tag named by the conflicting records; the analyzer never selects one silently.
- A question without a stable ID or valid nonnegative `view_count` is excluded and makes demand quality `Invalid` for every usable tag named on that record.

A demand row with no trustworthy matching v3 SME count becomes `Unknown`; it never becomes zero SMEs. A v3-only tag remains in the evidence table with invalid demand quality instead of disappearing.

The analyzer reuses existing v2 field aliases and question-to-tag aggregation rules so Script and Utility interpretation of page views and question count cannot drift. The new v3 SME-count normalization is shared utility/domain logic. Utility-specific coverage fields and tiers live in the utility analysis module rather than in React components.

The utility is available only when the configured instance and credentials expose numeric assigned-SME counts through v3 Tags. Basic/Business uses its PAT-backed v3 lane when the field is available. Enterprise requires both its v2 API key for tag metrics and its v3 access token for SME counts. If v2 returns one or more tags and v3 exposes no numeric SME counts for any of them, the run stops with an unsupported-capability explanation rather than generating a misleading pack.

## Evidence Model

Every collected tag produces one `SmeCoverageEvidenceRow` with these conceptual fields:

- `tagName`
- `pageViews`, nullable when demand could not be calculated
- `questionCount`, nullable when no trustworthy complete, fallback, or sampled count exists
- `questionCountBasis`
- `smeCount`, or unknown when the authoritative v3 count was unavailable
- `pageViewsPerSme`, stored at full precision when calculable
- `coveragePercentile`, when the percentile sample is sufficient
- `coverageTier`
- `reason`
- `recommendedAction`
- `demandQuality`
- `smeQuality`

`coveragePercentile` is the empirical cumulative percentile of a tag's unrounded ratio within the eligible ratio sample: the count of sample ratios less than or equal to that ratio divided by the sample size, multiplied by 100. Tied ratios therefore share the same upper-bound percentile. Tags outside the eligible sample have no percentile value.

`questionCountBasis` is one of:

- `Complete question enumeration`
- `All-time tag total`
- `Partial question sample`
- `Unavailable`

The evidence table, prioritized findings, Markdown, and CSV carry this basis with the question count. Narrative text that names a question count labels it as all-time or sampled according to this field.

`demandQuality` is one of:

- `Complete`: question enumeration and required tag metrics are trustworthy.
- `Partial sample`: question pagination capped the page-view totals.
- `Invalid`: page views or question count is missing, non-finite, or negative.

`smeQuality` is one of:

- `Complete`: the joined v3 SME count is a trustworthy nonnegative number.
- `Unknown`: the v3 tag record is absent, its SME count is null, missing, negative, or malformed, or v3 pagination was incomplete before that tag was retrieved.

Keeping the two quality dimensions separate prevents a row with both partial demand and unknown SME coverage from losing either caveat. The `Unknown` coverage tier applies whenever `demandQuality` is `Invalid` or `smeQuality` is `Unknown`.

Coverage tiers are:

- `Immediate gap`
- `Critical under-coverage`
- `Light coverage`
- `Adequate coverage`
- `Not classified`
- `Low-demand uncovered`
- `Unknown`

The same evidence rows power summary counts, risk lists, narrative, Markdown, and CSV. None of those consumers recalculate tiers independently.

## Analytical Methodology

### Activity And Demand

An active tag has either:

- At least one all-time question, or
- More than 25 all-time page views.

This preserves the existing Tag Health low-activity safeguard.

Page views and question count must be finite, nonnegative values after shared alias normalization. A tag with an invalid required metric receives the `Unknown` tier and does not participate in activity, demand, percentile, or narrative calculations.

Missing and invalid numeric source values remain null in evidence and exports; they are never coerced to zero. Stable numeric sorting places null values after valid values before applying the next tie-breaker.

When question pagination is capped, otherwise valid rows remain analyzable as a customer-relative partial sample. Their ratios and tiers are calculated only from the collected page-view sample, and the snapshot header, overview, assessment, methodology, and Markdown must use `partial sample` language rather than claim complete all-time coverage.

The minimum-demand threshold for percentile-based risk is the conventional median page-view count across active tags with known page views. For an even number of values, the median is the arithmetic mean of the two central values.

### Page Views Per SME

For a tag with at least one known SME:

`pageViewsPerSme = pageViews / smeCount`

Calculations use the unrounded value. UI and narrative values are rounded to the nearest whole page view and formatted with locale-aware separators.

A tag with an authoritative numeric zero displays `No SME`; the analyzer does not manufacture an infinite numeric ratio. A tag whose authoritative SME count is unavailable remains `Unknown` and is excluded from zero-SME and ratio claims.

### Customer-Relative Percentiles

The ratio distribution contains active tags with:

- Valid complete or partial-sample demand metrics,
- A trustworthy numeric v3 SME count, and
- At least one SME.

The 75th- and 90th-percentile thresholds use the nearest-rank method:

1. Sort unrounded ratios in ascending order.
2. Calculate rank as `ceil(percentile × sample size)`.
3. Select the one-based ranked value, clamped to the available range.

The decision pack records the actual sample size and threshold values used.

If fewer than four eligible covered active tags exist, the analyzer suppresses percentile-based critical, light, and adequate conclusions. It still reports valid immediate no-SME gaps, assigns covered tags to `Not classified`, and returns an insufficient-sample warning.

### Tier Rules

Rules are evaluated in this order:

1. **Unknown**
   - `demandQuality` is `Invalid`, `smeQuality` is `Unknown`, or both.
   - Excluded from all risk rankings and threshold samples.
   - The row reason names the unavailable dimension or dimensions.

2. **Immediate gap**
   - SME count is zero.
   - Tag is active.

3. **Low-demand uncovered**
   - SME count is zero.
   - Tag has no questions and at most 25 page views.

4. **Not classified**
   - SME count is at least one.
   - Fewer than four eligible covered active tags exist.
   - No positive or negative percentile conclusion is made.

5. **Critical under-coverage**
   - SME count is at least one.
   - Page views meet or exceed the active-tag median demand threshold.
   - Ratio meets or exceeds the 90th-percentile threshold.

6. **Light coverage**
   - SME count is at least one.
   - Page views meet or exceed the active-tag median demand threshold.
   - Ratio meets or exceeds the 75th-percentile threshold but is below the 90th-percentile threshold.

7. **Adequate coverage**
   - Any remaining tag with known SME coverage.

When the 75th- and 90th-percentile thresholds are equal, a qualifying tag at that value is critical; the light-coverage tier may be empty. The UI must not force a tag into each tier merely to populate every section.

### Stable Ordering

Immediate gaps sort by:

1. Page views descending
2. Question count descending
3. Tag name ascending

Critical and light coverage rows sort by:

1. Page views per SME descending
2. Page views descending
3. Question count descending
4. Tag name ascending

Not-classified rows use the same ratio-first ordering when a ratio is available.

The full evidence list sorts by coverage-tier priority, then the appropriate tier ordering above. Adequate, low-demand, and unknown rows use page views descending, question count descending, and tag name ascending.

The explicit tier priority is:

1. Immediate gap
2. Critical under-coverage
3. Light coverage
4. Unknown
5. Not classified
6. Low-demand uncovered
7. Adequate coverage

## Deterministic Narrative

The narrative builder accepts only the completed analysis result. It does not inspect raw API records and does not call a language model.

It produces up to three paragraphs:

1. The largest covered high-demand gaps, with exact page-views-per-SME values.
2. Meaningful-demand tags with no SMEs.
3. Light-coverage findings when that tier is non-empty.

Narrative selection uses at most the first 10 ranked rows in each applicable tier so the result remains readable. If a tier is empty, its paragraph is omitted rather than filled with lower-priority tags. An insufficient percentile sample always adds an explicit caveat to the copied assessment—even when immediate no-SME gaps exist—stating that relative covered-tag risk could not be classified and directing the reader to raw ratios. The builder says no priority coverage gaps were found only when all risk tiers are empty and the percentile sample is sufficient.

Permitted interpretations include:

- Coverage is thin relative to observed demand.
- Knowledge demand is concentrated among a small number of SMEs.
- A tag has no identifiable SME coverage.
- A tag warrants assignment, confirmation, or expansion of SME ownership.

The narrative must not claim burnout, poor answer quality, slow response, or causation without supporting metrics. Every named tag, count, and ratio must appear in the evidence rows used for that run.

For a capped question source, the narrative describes the values as collected-sample page views and page views per SME. It never presents sampled demand as a complete all-time total.

Recommended actions are also deterministic:

- Immediate gap: assign or confirm at least one SME.
- Critical under-coverage: expand and validate SME ownership.
- Light coverage: review whether additional SMEs would improve resilience.
- Adequate coverage: maintain current coverage.
- Not classified: review the raw ratio without making a percentile-based coverage conclusion.
- Low-demand uncovered: review whether the tag needs ownership or consolidation.
- Unknown SME coverage: rerun or inspect the v3 tag source.
- Invalid demand metrics: rerun or inspect the v2 tag/question source.
- Both unknown: inspect both source lanes before drawing a coverage conclusion.

## Decision Pack

The completed workspace presents results from conclusion to evidence.

### Snapshot Header

- Instance host
- Generated time
- `All-time demand · Current SME coverage`
- Completeness status
- API limit or data-quality warnings

### Executive Summary

A compact KPI strip shows:

- Tags analyzed
- Tags with SMEs
- Immediate gaps
- Critical under-coverage
- Light-coverage tags

`Tags analyzed` counts all evidence rows. `Tags with SMEs` counts rows whose `smeQuality` is `Complete` and whose authoritative SME count is at least one, even when demand is a labeled partial sample. Rows in the `Unknown` tier do not contribute to coverage-gap KPI counts and are reported separately in completeness warnings.

A short deterministic overview states the highest-priority finding.

Overview priority is immediate gap, then critical under-coverage, then light coverage. When the percentile sample is insufficient, the overview always states that covered-tag risk was not classified, whether or not immediate gaps exist. It states that no priority gaps were found only when no risk tier has rows and the percentile sample is sufficient. Unknown rows are called out in completeness warnings rather than described as coverage findings.

### Prioritized Findings

Separate sections show:

- Immediate no-SME risks
- Highest-demand critical gaps
- Light SME coverage

Each visible row includes:

- Tag
- Page views
- SMEs
- Questions
- Question-count basis
- Page views per SME
- Tier reason
- Recommended next action

Empty tiers render a plain-language empty state.

### Copy-Ready Assessment

The generated paragraphs appear in a readable assessment panel. `Copy assessment` copies clean Markdown/plain text suitable for a brief, email, or future presentation workflow.

### Methodology And Evidence

An expandable methodology panel shows:

- Activity rule
- Ratio formula
- Active-tag median page views
- Covered active-tag sample size
- 75th-percentile threshold
- 90th-percentile threshold
- Rounding behavior
- Question-count source precedence and per-row basis
- Completeness caveats

A searchable and sortable evidence table contains every tag, including adequate, low-demand, and unknown rows.

### Result Actions

- `Copy assessment`
- `Download decision pack`
- `Download evidence CSV`
- `Run again`

The Markdown decision pack contains snapshot metadata, completeness warnings, executive summary, copy-ready assessment, prioritized findings, and methodology. The CSV contains the complete evidence rows in canonical pack order. Interactive table search and sorting never change the CSV contents or order.

## Architecture

### Utility Registry

A utility registry defines utility identity, label, description, instance support, credential requirements, mode, and required datasets. It begins with `sme-coverage-analyzer` but does not attempt to define a generic formula or narrative language.

### Utility Runner

The server-side SME coverage runner:

- Validates utility-specific credential requirements.
- Creates the existing Stack API clients.
- Collects the v2 tag list, v2 all-time questions, and v3 tag list with their existing API clients.
- Reuses existing pagination, throttling, and API retry behavior.
- Captures source-level pagination and completeness.
- Normalizes and joins tag metrics to authoritative SME counts.
- Invokes the pure analyzer and narrative builder.
- Returns datasets, warnings, run metadata, and the decision pack.

The runner should extract only the smallest shared paged-collection seam needed from the current report runner. It must not call the full Tag Report runner and discard unrelated datasets, and it must not call the v2 top-answerers endpoint.

### Pure Analyzer

The analyzer has no React, browser, network, or filesystem dependencies. Given normalized tag inputs and collection quality metadata, it returns:

- Evidence rows
- Summary counts
- Methodology values
- Ranked tier lists
- Deterministic assessment text
- Warnings

### API Route

`POST /api/utilities/sme-coverage/run` accepts session credentials and one of the existing API volume presets, plus the existing explicit page-size and max-pages values when Advanced settings are used. It does not accept a date scope. Its response distinguishes validation failures, collection failures, and successful complete or partial decision packs.

The MVP uses the existing Deep audit API volume preset by default. Any tag, question, or SME-count pagination cap makes completeness visible in the returned warnings and snapshot header. The workspace reuses the existing preset labels and technical disclosures while keeping utility state independent from Report scope state.

### Client State And Persistence

Client state gains:

- Selected utility
- Utility run progress
- Utility outputs keyed by utility ID

Supporting datasets use the existing browser-local dataset model with utility provenance. The decision pack is browser-local and restorable using the existing persistence and migration conventions. Re-running replaces the active analyzer result while preserving separately listed supporting dataset snapshots according to existing Datasets behavior.

Credentials remain memory-only and are never included in utility output persistence, Markdown, CSV, warnings, or logs.

### UI Components

Expected conceptual components are:

- `UtilityCatalog`
- `SmeCoverageWorkspace`
- `SmeCoverageRunProgress`
- `SmeCoverageDecisionPack`
- `SmeCoverageFindings`
- `SmeCoverageAssessment`
- `SmeCoverageMethodology`
- `SmeCoverageEvidenceTable`

These names are directional rather than a required one-file-per-component plan. Components receive prepared domain values and do not calculate analytical tiers.

## Error Handling And Completeness

### Hard Failures

The run stops when:

- Credentials are missing or invalid.
- The instance type is unsupported.
- The v2 tag-list dataset cannot be collected.
- The v2 all-time question dataset cannot be collected.
- The v3 tag dataset cannot be collected, or v2 has tags but v3 exposes no numeric assigned-SME counts for any of them.
- The response contains no usable tag identities.
- An unexpected server error prevents construction of a coherent pack.

Errors identify the failed stage and offer a clear next action.

Individual tag records without a usable identity are skipped with a partial-data warning; they do not fail an otherwise coherent run.

### Unknown SME Coverage

An absent v3 tag match or null, missing, or malformed `subjectMatterExpertCount` does not become zero SMEs. The affected tag:

- Receives the `Unknown` tier.
- Is excluded from percentile samples and risk rankings.
- Remains in the evidence table.
- Adds a warning naming the affected tag or affected-tag count.

The source join must therefore preserve v2/v3 match quality and pagination metadata. Numeric zero from a retrieved v3 tag record is the only source value interpreted as zero SMEs.

### Invalid Demand Metrics

A tag with no trustworthy page-view total or question count receives `demandQuality: Invalid` and the `Unknown` tier. The row:

- Is excluded from demand thresholds, ratios, and risk rankings.
- Remains in the evidence table with unavailable values left blank.
- Uses a demand-specific reason and recommended action.
- Adds a warning naming the affected tag or affected-tag count.

No importer, normalizer, summary, or export may coerce an unavailable demand metric to numeric zero.

### Partial Results

A partial pack may be returned when analyzable evidence remains but:

- The v2 tag, v2 question, or v3 SME-count source hit a page cap.
- One or more v2 metric rows have no trustworthy numeric v3 SME count.
- The percentile sample is too small.
- One or more tag rows have invalid required metrics.

Partial packs display warnings before executive conclusions and repeat completeness notes in Markdown. They never use unknown rows in claims. CSV represents unknown SME counts, invalid demand metrics, and unavailable ratios as empty values, never zero.

If the tag list is capped, the header must say the pack covers the collected tag sample rather than implying full-instance completeness.

### Empty Results

An instance with no tags returns a successful empty decision pack with:

- Zero-valued summary metrics
- No risk findings
- A clear empty-state explanation
- Methodology indicating that no thresholds were calculated

## Accessibility

- Utilities navigation and catalog items are keyboard operable and expose selected state.
- Run progress is announced without relying on animation.
- Risk tiers use text labels in addition to color.
- Tables use semantic headers and retain usable horizontal overflow.
- Warnings appear before the conclusions they qualify.
- Copy and download actions have explicit accessible names and success/error feedback.
- Empty states and unknown values use plain language rather than icons alone.
- Existing WCAG AA contrast, focus, and reduced-motion expectations continue to apply.

## Testing Strategy

### Analyzer Unit Tests

- All-time question views aggregate once per distinct normalized tag on each question.
- Tag-level page-view fields are not added to question-derived totals.
- Question-count source precedence and `questionCountBasis` follow complete, fallback, partial, and unavailable cases.
- Complete and capped question enumerations produce `Complete` and `Partial sample` demand quality respectively.
- Identical duplicate questions deduplicate; conflicting duplicates invalidate affected demand rows.
- Ratio calculation uses the authoritative numeric v3 SME count and unrounded internal values.
- Numeric zero is distinguished from null, missing, malformed, and unmatched SME counts.
- Canonical tag-name joins and display names follow the specified normalization.
- Identical source duplicates collapse; conflicting v2 tag counts invalidate only a fallback actually used, and conflicting v3 SME counts become unknown.
- Zero SMEs never produce a numeric infinity.
- Conventional median behavior covers odd and even samples.
- Nearest-rank P75 and P90 thresholds are exact.
- Demand gating prevents low-demand covered tags from becoming percentile risks.
- Immediate, critical, light, adequate, low-demand, and unknown tiers follow evaluation order.
- Equal P75/P90 thresholds classify qualifying rows as critical.
- Fewer than four eligible covered active tags assign covered rows to `Not classified`.
- Unknown reasons and actions distinguish demand, SME, and combined source failures.
- Stable ordering follows every specified tie-breaker.
- Missing and malformed numeric fields normalize predictably.

### Narrative And Export Unit Tests

- Every narrative tag and number exists in the source evidence rows.
- Capped question runs use partial-sample language in narrative and Markdown.
- Insufficient percentile samples always add the required caveat, including when immediate gaps exist.
- Empty tiers do not create unsupported paragraphs.
- The assessment avoids prohibited unsupported claims.
- Markdown and CSV use the decision pack rather than recalculating.
- CSV headers, row order, unknown values, and filenames are stable.
- Markdown includes partial-data warnings and methodology.

### Runner And API Tests

- Utility credential validation supports the intended Basic/Business and Enterprise lanes.
- Only v2 tags, v2 questions, and v3 tag SME counts are collected.
- The v2 top-answerers endpoint is never called.
- Existing throttle and retry behavior is reused.
- Missing or unavailable joined SME counts become unknown metadata instead of zero.
- v2 tag, v2 question, and v3 tag page caps propagate as warnings, sampled demand, or unmatched rows as specified.
- Complete, partial, empty, validation-error, and hard-failure responses are distinct.

### State And Component Tests

- Reports is renamed Scripts without changing Script behavior.
- Utilities navigation and catalog selection work.
- Missing credentials produce an actionable state.
- Run progress presents the utility-specific stages.
- Every decision-pack section renders complete, partial, empty, and small-sample states.
- Snapshot labels distinguish all-time demand from current SME assignments.
- Copy and download actions use the current decision pack.
- Evidence search and sort preserve traceability.
- Utility outputs and dataset provenance restore browser-locally.
- Credentials remain excluded from serialized state.

### End-To-End Test

A mocked API run proves that a user can:

1. Add credentials.
2. Open Utilities.
3. Select SME Coverage Analyzer.
4. Run the analysis without running Tag Report.
5. See deterministic ranked findings and warnings.
6. Copy the assessment.
7. Download Markdown and evidence CSV.

## Acceptance Criteria

- The existing Reports product area is presented as Scripts.
- Utilities is a separate top-level product area.
- SME Coverage Analyzer is self-contained and read-only.
- The utility combines v2 tag/question demand metrics with authoritative `subjectMatterExpertCount` values from v3 Tags.
- The utility never treats v2 top answerers as assigned SMEs.
- Results are explicitly framed as all-time demand compared with current SME coverage at the generated time.
- Capped question collection is explicitly framed as a partial demand sample in every conclusion-bearing output.
- Every displayed or exported question count carries its complete, all-time-fallback, partial-sample, or unavailable basis.
- Zero-SME, critical, light, adequate, not-classified, low-demand, and unknown outcomes follow the documented rules.
- P75/P90 thresholds and minimum-demand values are visible.
- Only an authoritative numeric zero becomes zero SMEs; null, missing, malformed, capped, or unmatched SME data becomes unknown.
- Insufficient percentile samples never produce an adequate-coverage conclusion.
- The executive summary, findings, narrative, Markdown, and CSV all derive from the same evidence rows.
- Users can copy a useful assessment without composing a separate prompt.
- Supporting datasets and results remain browser-local; credentials remain session-only.
- Unit, API, component, persistence, and end-to-end tests cover the required complete and degraded states.

## Future Extensions

This design intentionally leaves room for later utilities without implementing them now:

- Recent-activity prioritization layered onto the all-time coverage baseline.
- Period-over-period coverage comparison.
- User-adjustable thresholds.
- Cross-report community action planning.
- Optional AI rewriting over a locked deterministic evidence pack.
- Google Docs or branded slide generation from the decision pack.

The second utility should determine which registry, runner, result, and export concepts become generic.
