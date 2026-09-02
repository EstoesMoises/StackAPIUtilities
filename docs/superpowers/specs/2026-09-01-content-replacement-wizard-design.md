# Content Replacement Wizard Design

## Summary

Stack API Utilities will add an Enterprise API v3 write tool for replacing renamed products, acronyms, and terms across questions, answers, and articles. The tool will support replacement rules entered manually in the browser or imported from CSV, scale to thousands of affected posts, and require a completed mode-specific scan and review before any write occurs.

The interaction is a guided full-page wizard rather than a single replace form or dense workbench. It follows four stages:

1. Define replacement rules.
2. Scan accessible content using an explicit discovery mode.
3. Review proposed changes.
4. Confirm, apply, and inspect results.

The browser must remain open during scanning and applying. Work is split into bounded same-origin requests, with credential-free job state persisted in browser IndexedDB so an interrupted run can resume after credentials are reconnected. OAuth access tokens remain memory-only.

## Goals

- Replace exact terms across question titles and bodies, answer bodies, and article titles and bodies.
- Accept one or many replacement rules through manual entry and CSV import.
- Make every proposed write inspectable before execution without forcing full-document detail into the default table view.
- Let operators choose between fast search-assisted discovery, an exact supplied target list, and an exhaustive content-space audit.
- State each mode's coverage guarantee everywhere the scan result is used; search-index results never imply exhaustive completeness.
- Process thousands of posts without a single long-running browser or server request.
- Preserve unrelated content, Markdown structure, tags, article permissions, and other required API fields.
- Isolate write failures, protect posts changed after scanning, and produce audit-friendly results.
- Keep credentials out of persistent storage, exports, error messages, and logs.
- Provide a guarded recovery path for successfully applied edits.

## Non-Goals

- Editing comments or tags.
- Replacing text in link destinations, image destinations, raw HTML attributes, or other URL fields.
- Continuing a run after the browser is closed.
- Running across multiple Enterprise instances or content spaces in one job.
- Regex-based replacement or an unrestricted scripting language.
- A server-side scheduler, durable queue, shared job database, or persisted server credentials.
- Treating the API search endpoint as an exhaustive content inventory or describing zero indexed candidates as proof that the term is absent from the site.
- Automatically overwriting a post that changed after the scan or after a completed replacement run.

## Supported Deployment and Scope

The first version is an Enterprise API v3 write tool and requires an OAuth access token with `write_access`.

Each job targets exactly one explicit content space:

- the Enterprise main site; or
- one selected Private Team when team-scoped execution is enabled.

The target instance URL, content-space identifier, discovery mode and exact target list when present, replacement rules, and matching options form part of the job fingerprint. Changing any of them invalidates the existing scan and requires a new scan before apply. Jobs created before discovery modes exist cannot be silently reclassified; they remain locally visible but require a new scan.

The first implementation should target the Enterprise main site, matching the existing User Group Sync precedent. Team-scoped routes remain an extension point and must not be implied as supported until credentials, target selection, and endpoint construction are implemented and tested end to end.

## Replacement Rule Input

### Manual entry

The Define stage presents an editable mapping table with `Find` and `Replace with` fields. Users can add, remove, and reorder rows. The primary path is optimized for a small number of product or acronym changes without making CSV upload mandatory.

### CSV import

Users can upload a CSV with the required headers:

```csv
find,replace
MyPVM,MyPBM
CPR,myBenefitPlans
RxNavigator,myReporting
```

The screen provides a downloadable template. Import replaces neither valid manual rows nor existing imported rows without confirmation. The user can choose to append valid rows or replace the current mapping list.

CSV parsing and rule validation happen locally before any API request. Invalid rows remain visible with their row number and a specific correction message.

### Blocking validation

The wizard cannot scan while any rule has:

- a blank source;
- a blank replacement;
- the same source and replacement under the selected case rule;
- a duplicate source mapped to different replacements;
- a replacement target that is also another rule's source;
- an overlapping source pattern that could produce order-dependent output.

Identical duplicate rules may be deduplicated with a visible notice. Multiple different sources may map to the same replacement.

Replacement rules are applied simultaneously to the original field value. A replacement introduced by one rule is never consumed by another rule in the same job. Every affected post receives at most one API update per apply attempt, regardless of how many rules match it.

## Matching and Markdown Safety

The default policy is:

- literal matching;
- case-sensitive;
- whole term;
- visible text only;
- code and URL destinations excluded.

For whole-term matching, a match is rejected when immediately adjacent to a Unicode letter, number, or underscore. The source term is always escaped as literal text.

Advanced options may enable:

- case-insensitive matching;
- partial matching; and
- replacement inside fenced code, indented code, or inline code.

Advanced choices remain visible in every subsequent wizard stage and in exported audit data. Link destinations, image destinations, autolink targets, and raw HTML attributes remain protected in the first version even when code replacement is enabled.

The Markdown transformer operates on parsed Markdown structure rather than applying a regular expression to the full source string. It replaces text in headings, paragraphs, lists, blockquotes, tables, and link labels while preserving Markdown syntax and protected nodes. Question and article titles use the same literal matching semantics without Markdown parsing.

The tool does not modify tags. It preserves the existing tag names in the full request model required by the API.

## Enterprise API Flow

### Discovery modes

The Define stage offers three mutually exclusive discovery modes. The selected mode is a durable part of the job, review evidence, confirmation summary, results, and exports.

#### Targeted scan — recommended default

Targeted scan queries `GET /search` once per distinct source term using the maximum page size and paginates every result page returned for that query. It accepts question, answer, and article search results, filters them by the selected content types, converts them to canonical item references, and deduplicates references found by more than one rule. Every returned reference is then fetched through its detail endpoint and evaluated with the exact replacement matcher; a search hit does not become a proposal unless the canonical Markdown or title contains an eligible occurrence.

This mode is intentionally fast and intentionally non-exhaustive. The search specification does not define indexing freshness, tokenization, punctuation, case, code, URL, permissions, or maximum-result guarantees. The UI therefore labels it `Search-assisted · may miss matches` in Define, Scan, Review, Apply, Results, and every export. A zero-result run says `No indexed candidates found`; it never claims that the terms do not exist elsewhere on the instance. Apply confirmation requires a visible acknowledgement of this limitation.

Failure to paginate every result page for any source term makes the targeted scan incomplete and blocks Review. Unknown or malformed search result shapes also fail the scan rather than being silently ignored.

#### Exact IDs or URLs

Exact-target scan accepts up to 5,000 deduplicated known questions, answers, and articles. Operators may add typed ID or URL rows in the browser, paste canonical Enterprise URLs one per line, or import a target CSV with the exact headers:

```csv
type,id,parent_question_id
question,20118,
answer,20119,20118
article,20120,
```

`type` is one of `question`, `answer`, or `article`. `id` must be a positive safe integer. `parent_question_id` is required only for answers because the answer detail endpoint is nested under its question. A numeric browser row requires its adjacent Type selection; a pasted canonical URL may infer the type, and an answer URL supplies both IDs. URLs must have the connected Enterprise origin and a supported question, answer, or article path. Invalid and duplicate rows remain visible with source-line errors; duplicates may be removed with a notice.

The scan canonicalizes, sorts, and deduplicates every valid supplied target, commits the manifest with a versioned domain-separated SHA-256 Merkle root, and carries each ref's membership proof through detail scan, proposal persistence, stale rescan, Apply, and Recovery. A swapped or misrouted ref must fail before a canonical read or write. The matcher then reports `Exact target list · complete for N supplied posts`. A zero-result run means no eligible occurrence was found in the supplied posts only. Exact-target mode is the required mode for disposable canaries and for narrowly scoped corrections where the post list is already known.

Target and replacement CSV files are checked against a 1 MiB file-size limit before `text()` and parsing stops when its relevant row ceiling is crossed. Exact-target paste has a 1 MiB UTF-8 limit. Inputs are rejected rather than truncated.

#### Full audit

Full audit uses paginated content endpoints as the source of content-space completeness:

- `GET /questions`
- `GET /questions/{questionId}/answers`
- `GET /articles`

The team-scoped equivalents are used only after Private Team execution is implemented.

Collection requests use the maximum supported page size. When answers are selected, a question summary with a valid `answerCount` of zero does not create an answer-collection request. A positive count creates the first answer cursor, and a missing, negative, non-integral, or otherwise invalid count is treated conservatively by fetching the answer collection. This optimization changes request volume, not completeness.

Question, answer, and article summary HTML is parsed and decoded only as a conservative candidate filter. The filter must inspect every visible text node and prefer false positives over false negatives. Every candidate is fetched through its detail endpoint before a proposed change is created so replacements are computed from canonical Markdown and the required current metadata:

- `GET /questions/{questionId}`
- `GET /questions/{questionId}/answers/{answerId}`
- `GET /articles/{articleId}`

Candidate filtering must prefer harmless extra detail requests over a possible false negative. Full audit is labeled `Exhaustive · all accessible selected content` only after every required inventory and detail request completes. It is not the default because a large instance may require thousands of requests.

### Shared scan accounting and control

Before a scan starts, the mode choice shows its coverage meaning and request-volume profile. Exact-target mode shows its exact target count. Targeted and Full audit explain that the total is discovered progressively. During scanning, the UI reports actual API requests completed, queued candidate details, rate-limit state, and the mode-specific inventory counts. Any remaining-request figure derived from pagination metadata is labeled as an estimate.

Pause and Cancel remain available in every mode. Rate-limit backoff auto-pauses as already specified. Switching modes never resumes or mutates an existing scan; it creates a new scan fingerprint and requires explicit Start scan.

### Updates

Apply uses:

- `PUT /questions/{questionId}` with the complete current `title`, transformed Markdown `body`, and current tag names;
- `PUT /questions/{questionId}/answers/{answerId}` with the transformed Markdown `body`; and
- `PUT /articles/{articleId}` with the complete current `title`, transformed Markdown `body`, current tag names, `type`, `expirationDate`, and permissions translated back to the request model's user and user-group IDs.

Each write preserves fields not targeted by the replacement and sends only request properties allowed by the OpenAPI schema. Response-only fields are never echoed into a request.

### Rate limits and retries

Reads and writes honor server rate-limit headers and `Retry-After`. The job automatically pauses for backoff and displays the reason and next retry time. Reads may use small bounded concurrency; writes default to sequential or minimal concurrency until live-instance testing establishes a safe rate.

Transient network failures and retryable server errors use bounded retries with server-directed delays. Authorization failures, invalid request errors, and exhausted retries become item-level failures during apply. A discovery failure is blocking because the tool cannot claim that the chosen scan mode finished from a partial result.

## Browser-Coordinated Job Architecture

The browser owns the durable job state and invokes stateless, bounded same-origin server routes. No request is expected to scan or update the entire instance.

IndexedDB stores:

- job identifier and fingerprint;
- target content space;
- validated rules and matching options;
- scan cursors and stage progress;
- discovered item identifiers and types;
- canonical request models needed for review and recovery;
- scanned request-model checksums;
- proposed request models and proposed request-model checksums;
- selection state;
- per-item apply status, attempt count, and sanitized error;
- completion and recovery metadata.

A job has a 5,000-proposal ceiling and a 64 MiB aggregate serialized UTF-8 budget enforced before write and after load. Canonical request models are limited to 2 MiB, configuration to 1 MiB, credentials to 512 KiB, and the same constants keep client preflight inside the 4 MiB Recovery route envelope. A budget or quota failure keeps Scan incomplete and Review/Apply locked. Existing Targeted/Full jobs and guarded schema-v1 Recovery remain readable; a current Exact checkpoint without Merkle proof evidence becomes read-only and requires a new scan.

It never stores access tokens, API keys, OAuth authorization data, or credential-bearing request headers. Exported previews and result files likewise exclude credentials.

The client persists progress after every bounded scan or apply batch. Closing the browser pauses the run. Reopening the job requires reconnecting valid credentials, revalidating the target content space, and then explicitly resuming. A `beforeunload` warning appears only while a batch is actively scanning or applying.

### Stateless server boundaries

The server exposes bounded scan and apply operations rather than a process-global job map.

A scan request contains credentials, validated replacement configuration, the explicit content-space target, and a bounded cursor. The server validates the complete payload, fetches the requested inventory slice and candidate details, computes canonical request models and checksums, and returns sanitized proposals and the next cursor.

An apply request contains credentials, the same job fingerprint and matching configuration, an item identity, and the expected scanned request-model checksum. The server re-fetches the current post, reconstructs its complete allowed request model, and recomputes the replacement. It writes only when the current request-model checksum still equals the scanned checksum and the recomputed proposal equals the reviewed proposal fingerprint.

The checksum covers every field the corresponding PUT request must send, including unchanged tags and, for articles, type, expiration date, and permissions. A concurrent change to any required field therefore makes the proposal stale instead of being overwritten by an older snapshot.

Client-provided replacement bodies are not forwarded directly to the Enterprise API.

## Stale Content and Concurrency Safety

Immediately before each write, the server re-fetches the post and compares its complete request-model checksum with the reviewed scan snapshot.

If they differ:

- the post is not updated;
- its status becomes `stale`;
- the final report explains that the post changed after review; and
- the user may rescan that post and review a new proposal.

The OpenAPI specification does not advertise ETags or another conditional-update primitive. Therefore, a small race remains between the final read and the subsequent PUT. The application must describe this honestly and issue the PUT immediately after the comparison. A live demo-instance canary must validate actual permission, response, throttling, and revision behavior before broad apply testing.

## Guided Full-Page Wizard

The feature appears as `Content Replacement` in the existing Write Tools catalog, alongside User Group Sync. It uses the established restrained, light Stack-native operations design: white and cool-neutral work surfaces, dark ink, compact Inter typography, border-led grouping, and Stack orange for primary action, selection, and focus.

The wizard is a full workspace, not a modal. A four-step progress indicator stays visible and uses text plus state styling:

1. Define
2. Scan
3. Review
4. Apply

### Step 1: Define

The first step includes:

- manual `Find` and `Replace with` mapping rows;
- CSV upload and template download;
- append-versus-replace choice when importing into an existing mapping list;
- selected content types: Questions, Answers, and Articles;
- a three-card discovery choice with Targeted scan selected by default, Exact IDs or URLs, and Full audit;
- a persistent coverage label and request-volume explanation for the selected discovery mode;
- an inline URL/list entry and target-CSV importer only when Exact IDs or URLs is selected;
- exact, case-sensitive, whole-term defaults;
- collapsed Advanced options;
- inline blocking validation and conflict resolution; and
- a concise review of protected Markdown contexts.

The primary action is `Review rules`, followed by a rule-and-scope summary checkpoint and `Start scan`. Starting a scan never performs writes. Selecting Full audit shows a prominent large-instance warning; selecting Targeted scan states that search may miss matches without hiding the limitation in Advanced options.

### Step 2: Scan

The scan screen keeps the selected mode and coverage guarantee in the page heading and reports real stages and counts appropriate to that mode:

- question pages inventoried;
- answer collections inventoried;
- article pages inventoried;
- candidate details inspected;
- proposed posts found; and
- safety-excluded occurrences found.

It also reports completed API requests. Targeted mode replaces question/answer/article inventory counts with source terms searched, search pages read, indexed references found, and candidate details inspected. Exact-target mode reports supplied, validated, fetched, matched, and failed targets. Full audit retains the exhaustive inventory counters and distinguishes answer-bearing questions queued from zero-answer questions skipped.

It exposes Pause and Cancel actions. Rate-limit backoff, credential expiry, network retry, and browser-storage failure have explicit states. A credential-expired scan pauses and resumes only after reconnection. A partially completed scan cannot advance to Review or claim its mode-specific coverage result.

### Step 3: Review

The default review view is a paginated or virtualized table showing:

- selection checkbox;
- content type and ID;
- title or answer context;
- replacement rule;
- affected fields;
- changed occurrence count;
- protected occurrence count; and
- `View details`.

Users can filter by content type, rule, affected field, review status, and free-text title or ID. They can exclude individual posts or select and exclude groups. Selection changes update the exact post and occurrence counts shown in the confirmation summary.

`View details` expands inline and is optional. The detail view shows:

- complete before and after Markdown for every affected field;
- highlighted changed occurrences;
- protected code or link-target occurrences and the reason they remain unchanged;
- mapping rules applied to the post;
- post owner and last-edit metadata when provided by the API;
- the complete normalized API request payload; and
- an `Exclude this post` action.

Only a small number of details should remain expanded at once so thousands of results do not create an unbounded DOM. The user may export the complete preview as CSV before continuing. Preview, result, and exception CSVs have a 32 MiB UTF-8 ceiling. Before RFC 4180 quoting, any string cell whose first non-space/control character is `=`, `+`, `-`, or `@` receives a leading apostrophe; the rest of the cell preserves the original evidence.

### Step 4: Confirm, apply, and results

Confirmation is inline, not a browser confirmation dialog or modal. It repeats:

- target instance and content space;
- selected mapping rules;
- matching and Markdown-protection options;
- selected post count by content type;
- total proposed replacements;
- protected occurrences;
- discovery mode and its coverage guarantee;
- local recovery-snapshot behavior; and
- the limitation that the API offers no all-post transaction.

For a multi-post run, the user must acknowledge that the preview was reviewed and enter `APPLY` before the primary action becomes available. Targeted scans also require acknowledgement that search-assisted discovery may have missed matches outside the reviewed set. The button includes the exact scope, for example `Apply changes to 1,106 posts`.

During apply, the screen shows completed, remaining, stale, failed, and rate-limited counts. Users may pause after the current bounded batch. They cannot edit mappings or selection while writes are in progress.

The completed result separates:

- updated posts;
- unchanged or excluded posts;
- stale posts skipped before writing;
- permission failures;
- validation failures;
- exhausted network or API failures; and
- protected occurrences intentionally left unchanged.

Users can export a result CSV and an exception CSV, retry only eligible failures, rescan stale items, or begin guarded recovery.

## Recovery

Before apply begins, the browser verifies that a complete local recovery snapshot exists for every selected post. If the snapshot cannot be persisted, apply remains disabled.

Recovery is a new guarded job, not an unconditional undo button. For each previously updated post, the server:

1. rebuilds the reviewed forward proposal from the prior canonical model and immutable configuration, requiring ref/checksum/fingerprint and any Exact Merkle proof to match Apply evidence;
2. fetches the current canonical content;
3. verifies that it still matches the exact successful post-apply checksum;
4. reconstructs the original request model from the recovery snapshot; and
4. restores the original editable fields only when the checksum still matches.

Posts changed since the replacement run are skipped as recovery conflicts and never overwritten. Recovery has its own preview, confirmation, progress, and exception report. Because the API does not expose a multi-post transaction, neither apply nor recovery is globally atomic.

## Error and Empty States

- **No credentials:** explain that an Enterprise OAuth token with `write_access` is required.
- **Invalid CSV:** retain valid rows and identify invalid row numbers and fields.
- **Conflicting rules:** block scanning and show the exact source-target conflict.
- **No full-audit matches:** report a successful exhaustive scan with zero proposals; never present Apply.
- **No targeted matches:** report `No indexed candidates found` or `No eligible matches in indexed candidates`; never claim site-wide absence and never present Apply.
- **No exact-target matches:** report that no eligible matches were found within the supplied targets; never present Apply.
- **Invalid exact target:** retain valid targets, identify the source line and reason, and block scanning until every target row is valid.
- **Incomplete inventory:** fail the scan and retain resumable progress without presenting a complete review.
- **Rate limited:** show automatic backoff and next retry time.
- **Expired credentials:** pause, reconnect, validate the same target, and resume.
- **Browser storage unavailable or full:** block scanning or apply before losing recovery guarantees.
- **Stale item:** skip and offer item rescan.
- **Permission denied:** continue applying other items and include the item in the exception report.
- **Partial completion:** distinguish successfully updated posts from skipped and failed posts without calling the run fully successful.
- **Cancelled run:** stop after the current request, preserve results already written, and explain that prior writes are not automatically reversed.

## Accessibility and Responsive Behavior

- Use semantic headings, fieldsets, labels, tables, buttons, progress bars, and `aria-current` for the active step.
- Announce stage transitions, pauses, rate-limit waits, and completion summaries through polite live regions; validation failures use alerts.
- Keep visible focus rings and keyboard-operable row selection, filters, expansion, pagination, and confirmation.
- Do not rely on color alone for done, active, warning, stale, failed, or protected states.
- At narrow widths, collapse the app rail, stack summary content below the review table, wrap actions before labels truncate, and contain unavoidable table overflow in a labeled focusable region.
- Respect reduced motion. Motion communicates state changes only.

## Security and Privacy

- Credentials remain in memory and are sent only to same-origin API routes over HTTPS in production.
- Server errors redact credential values and never echo request authorization data.
- Browser-persisted jobs contain post content and are labeled as sensitive local data.
- Users can delete individual jobs, recovery snapshots, and exports from the tool and Datasets area.
- Job exports exclude credentials and internal authorization headers.
- Server routes validate exact payload shapes, allowed target hosts, content types, identifiers, rule limits, string sizes, and batch sizes.
- Apply recomputes proposals server-side and never trusts a client-supplied body as the Enterprise PUT payload.

## Testing

### Replacement engine

- Literal sources are escaped correctly.
- Unicode-aware whole-term boundaries reject embedded matches.
- Case-sensitive, case-insensitive, and partial modes behave as labeled.
- Markdown prose and link labels change while protected contexts remain unchanged.
- Optional code replacement affects only code contexts when enabled.
- Multiple rules apply non-cascading changes from the original content.
- Duplicate, chained, and overlapping rules fail validation deterministically.
- Unchanged fields remain byte-for-byte identical.

### API and server boundaries

- Targeted search paginates every returned page per distinct source term, validates each result discriminator and identifier shape, deduplicates item references, and never treats search as exhaustive.
- Exact-target parsing accepts supported same-origin URLs and structured CSV rows, rejects ambiguous answer IDs without a parent question ID, and fetches every validated target directly.
- Exhaustive question, nested-answer, and article pagination cannot publish a partial scan as complete.
- Full audit skips answer collection only when `answerCount` is a valid zero and conservatively fetches when the count is absent or invalid.
- Candidate detail reads use canonical Markdown.
- Question, answer, and article PUT payloads contain all required request fields and no response-only fields.
- Article permissions convert from response objects to request IDs without changing access.
- Rate-limit headers and retry delays are honored for reads and writes.
- Credentials and authorization values are redacted from all errors.
- Apply rejects a changed job fingerprint, stale checksum, altered proposal fingerprint, invalid host, oversized batch, or unexpected property.

### Job orchestration and persistence

- Scan and apply resume from the last committed batch after refresh and credential reconnection.
- Credentials are never written to IndexedDB or exports.
- Changing rules, options, instance, or content space invalidates the scan.
- Storage failure blocks apply before any write.
- Pause and cancel stop after the active request without losing completed item status.
- Duplicate retries are idempotent at the job-model level and do not apply an already confirmed item twice.
- Recovery reverts only content still matching the post-apply checksum.

### User interface

- Manual and CSV rules normalize into the same editable mapping table.
- Discovery cards are keyboard-operable, expose coverage and request-volume tradeoffs, and default to Targeted scan.
- The selected coverage label persists through Scan, Review, Apply, Results, and exports.
- Blocking validation prevents scan.
- Scan progress, backoff, pause, resume, and failure states are accessible.
- Review filters, selection, optional detail expansion, and preview export preserve exact counts.
- Apply remains disabled until scan completion, valid selection, recovery persistence, acknowledgment, and `APPLY` confirmation.
- Results distinguish updated, excluded, protected, stale, and failed items.
- Responsive layouts preserve access to review details and primary actions.

### End-to-end and live canary

- A synthetic large fixture exercises thousands of proposals without unbounded rendering or one long request.
- A mixed job updates a question title/body, answer body, and article title/body while preserving unrelated fields.
- A post edited after review is skipped as stale.
- A permission failure does not stop unrelated eligible writes.
- An interrupted browser session resumes after credentials are reconnected.
- A guarded recovery run restores only unchanged post-apply content.
- Before broad demo testing, one disposable question, answer, and article validate live create/read/update behavior, permissions, rate-limit handling, returned Markdown, required PUT fields, and revision history.

## Acceptance Criteria

1. Users can create the same validated replacement-rule set manually or through CSV import.
2. Users can choose Targeted scan, Exact IDs or URLs, or Full audit before scanning; the choice is fingerprinted and cannot change without a new scan.
3. The default matcher is exact, case-sensitive, whole-term, and protects code and URL destinations.
4. Every proposed write is reviewable, and optional detail exposes complete before/after Markdown and the normalized request payload.
5. Apply cannot begin without a completed current scan, explicit selection, a complete local recovery snapshot, acknowledgment, and typed confirmation.
6. Every item is re-fetched and checksum-checked immediately before PUT; changed posts are skipped.
7. Thousands of posts are processed through bounded resumable batches while the browser remains open.
8. Credentials remain memory-only and absent from persisted jobs, exports, logs, and user-visible errors.
9. Item-level permission or API failures do not stop unrelated safe writes and appear in an exportable exception report.
10. Recovery restores only posts that still match the successful post-apply checksum and reports all conflicts.
11. Targeted scan paginates and verifies every indexed candidate returned for every source term while clearly stating that search may miss content.
12. Exact-target scan directly verifies every supplied valid question, answer, and article and reports completeness only for that supplied list.
13. Full audit inventories every accessible selected content item; answer collections are skipped only for valid zero-answer question summaries.
