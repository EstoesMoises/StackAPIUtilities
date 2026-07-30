# API v3 Rate-Limited User Group Preview Design

## Goal

Make Enterprise User Group Sync previews reliable for CSV files with more than
50 unique emails by preventing burst-throttle violations, retrying recoverable
read throttles, and refusing to build an unsafe partial preview when API lookup
capacity is unavailable.

## Context and Root Cause

Stack API v3 uses a short-term burst limiter and a longer-term token bucket.
The documented default burst limit is 50 requests in a two-second interval.

User Group Sync currently deduplicates CSV emails and starts every
`GET /users/by-email/{email}` request in one unbounded `Promise.all`. A CSV with
107 unique emails therefore starts 107 requests at once. This can exhaust the
burst allowance, cause user lookups to return HTTP 429, and leave the following
`GET /user-groups` request rate-limited as well.

The current runner catches every email lookup error and converts it to a missing
user. That behavior conflates a true 404 with rate limiting and can produce an
incomplete preview. In exact-sync mode, an incomplete desired membership set is
unsafe because it could plan removals for users whose lookups were throttled.

The API client also omits the recommended descriptive `User-Agent`, applies
throttle callbacks only to successful paginated reads, and has no bounded 429
retry behavior.

## Scope

This change covers:

- Email resolution during User Group Sync preview and preview revalidation
  before apply.
- Stack API v3 GET retries for HTTP 429.
- API v3 throttle-header parsing needed to calculate retry waits.
- A descriptive `User-Agent` on API v3 requests.
- Tests for batching, retries, persistent throttling, and non-retried writes.

This change does not:

- Add a bulk-user-directory synchronization strategy.
- Persist resolved users between separate preview requests.
- Retry ambiguous network failures for write operations.
- Change group naming, membership planning, or exact-sync semantics.
- Add a new UI control for batch size or retry count.

## Selected Approach

### Email lookup batching

The runner processes unique normalized emails in stable input order using
batches of 20.

For each batch:

1. Start at most 20 email lookups concurrently.
2. Wait for every lookup in the batch to settle.
3. If another batch remains, wait two seconds before starting it.
4. Continue until every unique email has a resolved user or a confirmed 404.

The batch size and interval are internal constants, not user-configurable
settings. Twenty requests per two-second batch stays below the documented
default burst threshold with substantial headroom for the group lookup and
other activity using the same token.

The runner accepts an injectable wait function for deterministic tests. Normal
server execution uses a timer-backed wait.

### Read-only 429 retries

The Stack API v3 client routes GET requests through a shared read helper. When a
GET response is HTTP 429, the helper retries it up to three times after waiting.

The client parses these possible wait durations:

1. A valid `Retry-After` header, supporting both integer seconds and an HTTP
   date.
2. `x-burst-throttle-seconds-until-full`.
3. `x-token-bucket-seconds-until-next-refill`.
If one or more valid durations are present, the client uses the longest value so
every reported rate-limit window can recover. If none are valid, it uses a
two-second fallback.

The client accepts injectable wait and clock functions for deterministic unit
tests. The retry count is fixed internally and is not exposed to the UI.

### Write safety

POST and DELETE requests remain sequential through the existing apply runner.
They are not automatically retried. This avoids repeating a group creation,
membership addition, or removal when the server-side outcome is uncertain.

An explicit 429 on a write remains an operation-level failure in the apply
summary. The user can preview again after the limit recovers and safely rerun
the apply workflow.

### Failure classification

A user lookup returning 404 remains a row-level unresolved user and appears as
`Email not found in Stack Enterprise`.

Any other lookup failure, including HTTP 429 after all retries, aborts the
preview. It must not be converted into an unresolved user. The API route returns
the safe error to the UI, the preview remains unavailable, and Apply stays
disabled.

This fail-closed behavior prevents exact sync from planning membership removals
from incomplete lookup data.

## API Client Changes

`StackApiV3Client` will:

- Add a fixed descriptive `User-Agent` to `createJsonHeaders`.
- Use a timer-backed wait by default and accept an injected wait function in
  client options.
- Retry GET requests on HTTP 429 using the calculated throttle delay.
- Inspect throttle headers on all GET responses, including user lookup
  responses, instead of only successful paginated responses.
- Preserve existing error formatting after retries are exhausted.
- Leave POST and DELETE retry behavior unchanged.

The initial user-agent value is:

```text
StackAPIUtilities/0.1 (+https://github.com/EstoesMoises/StackAPIUtilities)
```

## Runner Changes

`previewUserGroupSync` will use a batched email resolver:

- Deduplicate emails case-insensitively as it does today.
- Preserve the first occurrence and input order.
- Resolve batches of 20 concurrently.
- Pause two seconds only between non-empty batches.
- Propagate non-404 API failures rather than silently converting them to null.

The `UserGroupSyncClient` contract continues to represent a confirmed missing
user as `null`. It does not need to expose HTTP status details to the runner:
the API client already converts a 404 into `null` and throws other errors.

## Data Flow

1. The server validates credentials and parses the CSV.
2. The runner deduplicates emails in input order.
3. The runner resolves the first batch of at most 20 emails.
4. Each GET transparently retries a recoverable 429 up to three times.
5. The runner waits two seconds before each subsequent batch.
6. After all users are safely resolved, the runner loads existing groups.
7. The planner builds the complete preview.
8. Apply remains available only for a successful, current preview with no
   blocking errors.

Apply re-runs the same batched, rate-aware preview before comparing it with the
user-confirmed preview. This preserves the existing stale-preview protection.

## Error Handling

- `404` from user lookup: return `null`; preview lists the row as unresolved.
- `429` from GET: wait and retry up to three times.
- Persistent `429` from GET: throw the existing `StackApiError`; abort preview.
- Other `4xx` or `5xx` user lookup: throw and abort preview.
- Network failure during user lookup: throw and abort preview.
- `429` from POST or DELETE: record the operation as failed without automatic
  retry.
- Invalid or absent throttle headers: use the two-second retry fallback.

Errors continue through the existing credential-redaction layer before being
returned to the browser.

## Testing

### API client tests

- Every API v3 request includes the descriptive `User-Agent`.
- A GET returning 429 once waits for the header-directed duration and retries.
- A GET returning persistent 429 stops after three retries and throws the
  existing status-bearing error.
- Burst and token-bucket headers choose the longest applicable delay.
- Missing or malformed retry headers use the two-second fallback.
- POST and DELETE requests are not automatically retried after 429.

### User Group Sync runner tests

- Forty-one unique emails execute as batches of 20, 20, and 1.
- The runner waits exactly twice between those batches.
- No batch has more than 20 simultaneous lookups.
- Duplicate emails are still resolved only once.
- A confirmed missing user remains a skipped row.
- A thrown lookup error aborts preview and prevents group lookup.
- Preview revalidation before apply uses the same batching behavior.

### Server and regression verification

- A persistent lookup throttle returns a safe failure response and no preview.
- Existing user-group parser, planner, API, component, lint, and production
  build checks remain green.

## Success Criteria

- The 107-row Employer CSV and 153-row HP CSV can reach a complete preview
  without exceeding the documented default burst threshold from the utility's
  own email lookup traffic.
- A transient GET throttle is recovered automatically.
- A persistent throttle cannot produce an incomplete preview.
- Write requests are never duplicated by automatic retry.
- Existing add-only and exact-sync protections remain unchanged.
