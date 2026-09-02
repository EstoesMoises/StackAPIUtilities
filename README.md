# Stack API Utilities

Next.js app for Stack Overflow for Teams and Stack Enterprise API workflows.

## Product Areas

Scripts produce reusable datasets and report outputs. The current browser-ready,
read-only Scripts are:

- Tag Report
- API User Report
- Inactive Users
- Interactions
- Community Members
- Data Export

Tag Report includes the stable Enterprise API v3 tag ID and tag creation date.
Its `last_used` value is the latest UTC `creation_date` among questions or
articles that currently carry the tag, not tag assignment, edit, or general
activity time. Last-used collection scans all available history even when health
metrics are date-scoped.

Utilities answer defined operational questions directly from API data. The SME
Coverage Analyzer produces an evidence-first decision pack for the question:
where is all-time knowledge demand not matched by current assigned-SME coverage?
It is self-contained and read-only; it does not require a prior Script run or an
uploaded report.

The analyzer's three-source pipeline collects all-time v2 tags and questions plus
v3 tags. Only the v3 `subjectMatterExpertCount` field represents assigned-SME
coverage. V2 top answerers are never used as the assigned-SME denominator.

Live Script runs collect every API page available for the selected date scope.
The SME Coverage Analyzer does the same for its fixed all-time scope. Pagination,
page size, rate-limit backoff, and retries are handled automatically. If
collection cannot finish, the run fails and no partial result is published as
complete.

Uploaded Script outputs are parsed locally in the browser and rendered as
dashboards plus raw tables. Script datasets, Utility decision packs, and Utility
supporting datasets are stored browser-locally by default so they can survive
refreshes, tab closes, and browser restarts until the user removes individual
datasets or flushes all stored datasets from the Datasets panel. Credentials
remain in memory only, except for API keys explicitly saved in browser-local
Stack Enterprise customer profiles. Credentials are never included in persisted
or exported report results.
Browser-saved Script outputs and SME decision packs created before exhaustive
collection was introduced are retained, but display `Legacy run — completeness
not verified under current collection rules` instead of claiming complete
collection.

SME evidence CSV exports intentionally use `collection_status`,
`analysis_quality`, and `evidence_notes`. These replace the former
`result_completeness` and `completeness_warnings` headers so collection status is
not confused with the quality of the available evidence.

Live Script execution uses the same-origin Next.js route at `/api/reports/run`.
SME Coverage Analyzer execution uses the same-origin route at
`/api/utilities/sme-coverage/run`. These routes let the server call Stack
Enterprise or Teams APIs without browser CORS blocking credential headers.
Scripts that still need unsupported live datasets stop before fetching and
direct users to upload existing CSV or JSON outputs.

## Content Replacement

Content Replacement is an Enterprise API v3 write tool for the Enterprise main
site. It requires an Enterprise OAuth access token with `write_access`; Private
Team and multi-instance jobs are not supported. One job can replace literal
terms in question titles and bodies, answer bodies, and article titles and
bodies. Question tags are preserved. Article tags, type, expiration date, and
user and user-group editor permissions are also preserved in the complete API
request model. Comments, tags, URL destinations, and other non-content fields
are never replacement targets.

Choose the discovery mode to match the operational need:

| Mode | Use when | Coverage | Request profile |
|---|---|---|---|
| Targeted | You know the term but not the posts | Search-assisted; may miss matches | Search pages plus canonical candidate reads |
| Exact IDs or URLs | You know the posts or are running a canary | Complete for supplied targets | One canonical read per target, batched through the browser |
| Full audit | Missing any accessible match is unacceptable | Exhaustive after complete inventory | Every selected collection; zero-answer questions skip answer reads |

New jobs default to Targeted scan. It paginates search results separately for
each source term and deduplicates the resulting canonical references, but a
search index is not a complete content inventory. Exact IDs or URLs keeps the
normalized target list in the browser-local job and reads only those canonical
posts. Full audit inventories every accessible selected collection before
candidate-detail reads; it skips an answer collection only when the question
summary reports a valid zero answer count.

Rules can be entered in the mapping table or imported locally from CSV. The
canonical CSV headers are exactly:

```csv
find,replace
SOURCE_TERM,REPLACEMENT_TERM
```

Imported rows can be appended to or replace the current mapping list. Blank,
no-op, conflicting duplicate, chained, and overlapping rules block scanning.
Rules run simultaneously against the original field value, so replacement text
introduced by one rule is not processed by another rule.

Replacement and exact-target CSV files are limited to 1 MiB and checked by file
size before the browser reads them. Exact-target paste input has the same 1 MiB
UTF-8 limit. Exact lists stop at 5,000 canonical deduplicated targets; split a
larger run into narrower jobs rather than relying on truncation.

One job accepts at most 500 mappings. Each `find` value is limited to 200
characters and each `replace` value to 500 characters. The Define step reports
the offending row and blocks Review and scanning until these limits and the
other mapping validations pass.

The safe defaults are literal, case-sensitive, whole-term matching with code
replacement off. Fenced, indented, and inline code is protected by default.
Link and image destinations, autolink targets, raw HTML attributes and syntax,
and hidden raw HTML content remain protected. Advanced settings may enable
case-insensitive or partial matching and replacement inside code, but they do
not unprotect URL destinations or raw HTML attributes.

Full-audit scanning is exhaustive for the selected content types within the enforced
guardrails: it paginates all accessible questions, each question's answer
collection, and all articles, then fetches canonical detail records for
conservative candidates. Inventory cursors have a 10,000-page ceiling, detail
inspection sends at most 10 item references per request, and a persisted job is
subject to a hard 5,000-proposal item ceiling. Detail requests are shortened
to the remaining proposal capacity; once the ceiling is full, queued references
are not fetched or silently discarded. The scan fails closed, keeps those
references, and asks the operator to start a narrower job instead of claiming an
exhaustive Review. Persisted input with 5,001 proposal keys is rejected before
any proposal body is inspected or storage transaction opens. Exactly 5,000
minimal canonical proposals pass parsing and the storage transaction logic, but
this is an item ceiling, not a promise that every arbitrarily complex
5,000-proposal graph will fit. Independent finite 1 MiB field-content,
100,000-entry per-collection, 256-level graph-depth, and aggregate
graph-traversal safeguards can reject unusually complex jobs earlier. A
serialized job may not exceed 64 MiB; the browser checks this before IndexedDB
write and after load. Actual browser quota can be lower and is surfaced as a
storage failure, leaving Scan incomplete and Review/Apply locked.
Search-index results are not
treated as a complete inventory. An incomplete inventory, a response that would
continue past page 10,000, or a job that cannot be validated within the
persisted proposal cap fails closed and cannot advance to Review or Apply; the
page-limit response explicitly reports the 10,000-page safety limit, while
invalid stored jobs are reported as unavailable rather than partially trusted.
The review table is
paginated in 50-row pages and offers
filters, exact selected-post and occurrence counts, a complete credential-free
preview CSV, and optional bounded detail. Detail includes complete before/after
Markdown, protected occurrences and reasons, metadata when available, rules
applied, and the normalized API request payload.

Apply uses bounded, one-post requests. Immediately before each PUT, the server
re-fetches the post and compares a checksum of the complete allowed request
model—not only the edited text—with the reviewed scan. This includes unchanged
question tags and all required article fields and permissions. A changed model
is reported as stale and skipped. Stack Enterprise does not advertise a
conditional-update primitive, so a small read-to-PUT race remains after that
final check; the tool issues the PUT immediately and does not claim an all-post
transaction.

Results distinguish updated, already-applied, excluded, stale, permission,
validation, exhausted network/API, and intentionally protected outcomes. A
failure or stale result for one item does not describe successful items as
rolled back. Result and exception CSVs are one-shot browser downloads generated
on demand and are not retained by the app. Each CSV is limited to 32 MiB. To
prevent spreadsheet formula execution, a string whose first non-space/control
character is `=`, `+`, `-`, or `@` is prefixed with an apostrophe before RFC 4180
quoting; the remaining cell text is the original visible evidence.

Recovery is a separate guarded job, not an unconditional undo. Apply stays
disabled until complete prior request-model snapshots are durably available for
every selected post. Recovery first previews the exact prior request model,
re-fetches current content, and restores only a post whose full checksum still
matches the observed successful post-apply checksum. Later edits become recovery
conflicts and are never overwritten. Before preview or write, the server rebuilds
the reviewed forward replacement from the prior model and immutable configuration
and requires its ref, checksums, and fingerprint to match Apply evidence. Exact
jobs additionally carry versioned SHA-256 Merkle membership proofs from scan
through Apply and Recovery; old proofless Exact jobs remain exportable read-only
checkpoints and require a new scan.

Canonical request models are limited to 2 MiB of aggregate UTF-8 JSON,
configuration to 1 MiB, and credentials to 512 KiB. The same constants keep the
client preflight and 4 MiB same-origin route envelope aligned; oversized content
fails the scan instead of becoming Apply-ready.

Keep the browser open while a scan, apply batch, recovery preview, or recovery
batch is actively making calls; work does not continue after the browser closes.
Credential-free progress, proposal content, results, and recovery snapshots are
saved in a dedicated browser IndexedDB database after each bounded operation.
Rate-limit pauses are persisted locally. Reopen the saved local job, reconnect
valid credentials for the same Enterprise origin, and explicitly resume when
the persisted deadline has passed.
After an interruption, reopen the saved local job, reconnect valid credentials
for the same Enterprise origin, and explicitly choose Resume or Retry; completed
bounded calls are not repeated. Retryable failures remain visible with their
saved progress. A stale result is never written automatically: use **Rescan
stale posts** from Results to refresh only those exact items, review the new
evidence, and explicitly confirm any later apply. A scope that genuinely exceeds
an enforced inventory or persistence guardrail cannot become exhaustive by
repeatedly retrying the same job; cancel it and start a narrower content-type
scope (or address the Enterprise inventory size) before rescanning. OAuth
tokens, API keys, authorization headers, and other credentials are never written
into replacement job IndexedDB records or included in preview, result, or
exception exports.

## Credentials

The app keeps OAuth access tokens and PATs session-only and in memory. API keys
also remain memory-only unless the user explicitly saves one in a browser-local
Stack Enterprise customer profile. OAuth authorization codes and client secrets
are not persisted. The server-mediated PKCE flow temporarily stores OAuth state,
the verifier, and pending transaction details in a protected cookie for at most
10 minutes. That cookie is `HttpOnly`, `SameSite=Lax`, `Secure` when applicable,
scoped to `/api/oauth/pkce`, and cleared after the callback succeeds or fails.
These OAuth secrets never enter the customer-profile IndexedDB database.

For Stack Enterprise OAuth, users may explicitly save browser-local customer
profiles containing a customer name, Enterprise instance URL, optional OAuth client ID,
the non-expiring-token preference, and an optional API key. A client ID is required
to start OAuth, but not when the customer is saved with a manually supplied access
token. The API key is stored
directly in browser IndexedDB and is readable by scripts running under the app
origin; customer profiles are not a secret vault. The server-controlled OAuth
redirect URL is displayed read-only and is never overridden by a saved profile.
Saved customer profiles survive refreshes and browser restarts until the user
deletes them or clears browser site data. Dataset flushing and session reset do
not remove customer profiles.

Loaded Script datasets and Utility supporting datasets and decision packs are
stored locally in this browser by default. Use the Datasets panel to remove
individual datasets or flush all stored datasets.

The shared credentials screen supports three authentication lanes:

- Stack Overflow Basic/Business: instance URL plus personal access token.
- Stack Overflow Enterprise API v3: OAuth Authorization Code with PKCE, using the Enterprise instance URL and OAuth Client ID.
- Stack Overflow Enterprise API v2.3: API key remains available for workflows that still call v2.3 endpoints.

Enterprise OAuth requests the minimum workflow scope by default. User Group Sync
and Content Replacement request `write_access`. `no_expiry` is off by default
and is included only when explicitly selected.

In production, Enterprise OAuth uses the app's HTTPS request origin as the callback origin by default. If the app is behind a proxy or needs a fixed callback URL, set one of these server environment variables:

- `STACK_API_UTILITIES_PUBLIC_ORIGIN=https://your-app.example.com`
- `STACK_API_UTILITIES_OAUTH_REDIRECT_URI=https://your-app.example.com/api/oauth/pkce/callback`

### Local Enterprise OAuth Test

For Enterprise OAuth clients that require a non-localhost redirect URI, run the app through `redirectmeto` while keeping the local PKCE callback:

```bash
STACK_API_UTILITIES_OAUTH_REDIRECT_URI=http://redirectmeto.com/http://127.0.0.1:3002/api/oauth/pkce/callback pnpm exec next dev -H 127.0.0.1 -p 3002
```

Register this exact redirect URI with the Enterprise OAuth client:

```text
http://redirectmeto.com/http://127.0.0.1:3002/api/oauth/pkce/callback
```

## Development

Install dependencies:

```bash
pnpm install
```

Start the dev server:

```bash
pnpm dev
```

Run verification:

```bash
pnpm test
pnpm build
pnpm e2e
```

## Production Build

Create the production build:

```bash
pnpm build
```

Run the production server:

```bash
pnpm preview
```
