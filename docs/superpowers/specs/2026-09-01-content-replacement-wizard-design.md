# Content Replacement Wizard Design

## Summary

Stack API Utilities will add an Enterprise API v3 write tool for replacing renamed products, acronyms, and terms across questions, answers, and articles. The tool will support replacement rules entered manually in the browser or imported from CSV, scale to thousands of affected posts, and require a complete scan and review before any write occurs.

The interaction is a guided full-page wizard rather than a single replace form or dense workbench. It follows four stages:

1. Define replacement rules.
2. Scan accessible content.
3. Review proposed changes.
4. Confirm, apply, and inspect results.

The browser must remain open during scanning and applying. Work is split into bounded same-origin requests, with credential-free job state persisted in browser IndexedDB so an interrupted run can resume after credentials are reconnected. OAuth access tokens remain memory-only.

## Goals

- Replace exact terms across question titles and bodies, answer bodies, and article titles and bodies.
- Accept one or many replacement rules through manual entry and CSV import.
- Make every proposed write inspectable before execution without forcing full-document detail into the default table view.
- Exhaustively scan the selected Enterprise content space rather than treating search-index results as proof of completeness.
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
- Treating the API search endpoint as an exhaustive content inventory.
- Automatically overwriting a post that changed after the scan or after a completed replacement run.

## Supported Deployment and Scope

The first version is an Enterprise API v3 write tool and requires an OAuth access token with `write_access`.

Each job targets exactly one explicit content space:

- the Enterprise main site; or
- one selected Private Team when team-scoped execution is enabled.

The target instance URL, content-space identifier, replacement rules, and matching options form part of the job fingerprint. Changing any of them invalidates the existing scan and requires a new scan before apply.

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

### Exhaustive discovery

The scan uses paginated content endpoints as the source of completeness:

- `GET /questions`
- `GET /questions/{questionId}/answers`
- `GET /articles`

The team-scoped equivalents are used only after Private Team execution is implemented.

Collection requests use the maximum supported page size. Question, answer, and article summary HTML is parsed and decoded only as a conservative candidate filter. The filter must inspect every visible text node and prefer false positives over false negatives. Every candidate is fetched through its detail endpoint before a proposed change is created so replacements are computed from canonical Markdown and the required current metadata:

- `GET /questions/{questionId}`
- `GET /questions/{questionId}/answers/{answerId}`
- `GET /articles/{articleId}`

Candidate filtering must prefer harmless extra detail requests over a possible false negative. The `/search` endpoint may provide a quick estimate or navigation aid, but it cannot replace exhaustive pagination because the specification does not define exact indexing, tokenization, case, or freshness guarantees.

### Updates

Apply uses:

- `PUT /questions/{questionId}` with the complete current `title`, transformed Markdown `body`, and current tag names;
- `PUT /questions/{questionId}/answers/{answerId}` with the transformed Markdown `body`; and
- `PUT /articles/{articleId}` with the complete current `title`, transformed Markdown `body`, current tag names, `type`, `expirationDate`, and permissions translated back to the request model's user and user-group IDs.

Each write preserves fields not targeted by the replacement and sends only request properties allowed by the OpenAPI schema. Response-only fields are never echoed into a request.

### Rate limits and retries

Reads and writes honor server rate-limit headers and `Retry-After`. The job automatically pauses for backoff and displays the reason and next retry time. Reads may use small bounded concurrency; writes default to sequential or minimal concurrency until live-instance testing establishes a safe rate.

Transient network failures and retryable server errors use bounded retries with server-directed delays. Authorization failures, invalid request errors, and exhausted retries become item-level failures during apply. A scan inventory failure is blocking because the tool cannot claim exhaustive review from partial discovery.

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
- exact, case-sensitive, whole-term defaults;
- collapsed Advanced options;
- inline blocking validation and conflict resolution; and
- a concise review of protected Markdown contexts.

The primary action is `Review rules`, followed by a rule-summary checkpoint and `Start scan`. Starting a scan never performs writes.

### Step 2: Scan

The scan screen reports real stages and counts:

- question pages inventoried;
- answer collections inventoried;
- article pages inventoried;
- candidate details inspected;
- proposed posts found; and
- safety-excluded occurrences found.

It exposes Pause and Cancel actions. Rate-limit backoff, credential expiry, network retry, and browser-storage failure have explicit states. A credential-expired scan pauses and resumes only after reconnection. A partially completed scan cannot advance to Review or claim complete coverage.

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

Only a small number of details should remain expanded at once so thousands of results do not create an unbounded DOM. The user may export the complete preview as CSV before continuing.

### Step 4: Confirm, apply, and results

Confirmation is inline, not a browser confirmation dialog or modal. It repeats:

- target instance and content space;
- selected mapping rules;
- matching and Markdown-protection options;
- selected post count by content type;
- total proposed replacements;
- protected occurrences;
- local recovery-snapshot behavior; and
- the limitation that the API offers no all-post transaction.

For a multi-post run, the user must acknowledge that the preview was reviewed and enter `APPLY` before the primary action becomes available. The button includes the exact scope, for example `Apply changes to 1,106 posts`.

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

1. fetches the current canonical content;
2. verifies that it still matches the exact successful post-apply checksum;
3. reconstructs the original request model from the recovery snapshot; and
4. restores the original editable fields only when the checksum still matches.

Posts changed since the replacement run are skipped as recovery conflicts and never overwritten. Recovery has its own preview, confirmation, progress, and exception report. Because the API does not expose a multi-post transaction, neither apply nor recovery is globally atomic.

## Error and Empty States

- **No credentials:** explain that an Enterprise OAuth token with `write_access` is required.
- **Invalid CSV:** retain valid rows and identify invalid row numbers and fields.
- **Conflicting rules:** block scanning and show the exact source-target conflict.
- **No matches:** report a successful exhaustive scan with zero proposals; never present Apply.
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

- Exhaustive question, nested-answer, and article pagination cannot publish a partial scan as complete.
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
2. Scan inventories every accessible question, nested answer, and article page in the selected supported content space before Review is enabled.
3. The default matcher is exact, case-sensitive, whole-term, and protects code and URL destinations.
4. Every proposed write is reviewable, and optional detail exposes complete before/after Markdown and the normalized request payload.
5. Apply cannot begin without a completed current scan, explicit selection, a complete local recovery snapshot, acknowledgment, and typed confirmation.
6. Every item is re-fetched and checksum-checked immediately before PUT; changed posts are skipped.
7. Thousands of posts are processed through bounded resumable batches while the browser remains open.
8. Credentials remain memory-only and absent from persisted jobs, exports, logs, and user-visible errors.
9. Item-level permission or API failures do not stop unrelated safe writes and appear in an exportable exception report.
10. Recovery restores only posts that still match the successful post-apply checksum and reports all conflicts.
