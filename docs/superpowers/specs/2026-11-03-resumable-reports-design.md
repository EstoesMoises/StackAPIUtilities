# Resumable live reports

Approved direction: browser-coordinated collection, saved progress, pause/resume, and measured time estimates. No background worker or server-side customer-data store.

## Execution

Reuse the existing collectors and report transforms. Run collection in the browser through a same-origin read endpoint that performs exactly one allowlisted upstream GET with a 20-second deadline and a bounded response. The browser retains retry/backoff responsibility. Checkpoint successful API responses individually in IndexedDB before allowing collection to advance. On resume, replay completed reads locally, then continue at the first missing request. Cache keys include API version, canonical path and sorted query parameters; each immutable report job owns its cache. This provides page-level and nested answer/comment checkpoints without duplicating metric logic.

Run identity includes report, periods, scopes, normalized connection and a non-reversible SHA-256 credential fingerprint. Raw tokens and API keys never enter stored metadata, request keys, diagnostics, or exports. A different credential fingerprint requires a new job to prevent mixing permission views. Only one tab may run a job at a time. Completed results are published atomically across comparison periods.

## Bounds and recovery

The server accepts only report GET routes and known query fields, reconstructs credentials internally, refuses redirects, and caps request/response bodies. Browser requests are cancellable. Persist backoff deadlines separately from cached bodies, so resuming cannot replay or bypass waits. Stop visibly on invalid pagination, network errors, storage failures or capacity limits. Never mark partial data complete. Pause cancels in-flight work, keeping prior checkpoints. Cancel/delete removes the saved job. Restored jobs remain paused until explicit Resume. Browser storage limits are surfaced, not hidden by truncation.

## Progress and estimates

Show current dataset, successful upstream request count, saved bytes and active collection duration. Discover list inventories before expensive Tag Report enrichment; cached list reads are reused by normal collectors. Derive a remaining-request range from inventory counts and update it from observed response structure. Estimate duration using measured request timings, with conservative uncertainty for unseen detail pages and rate limiting. Unknown workload or insufficient samples displays “Estimating time remaining…” rather than a fabricated total. ETA excludes user pause/offline time and labels rate-limit waits separately. Multi-hour estimates use hours, never a fixed timer or fake percent.

## Performance

Reuse identical reads, including all-history scans when the requested period is unscoped. Skip legacy top-answerer lookups when authoritative assigned-SME metadata exists. Preserve complete child collections and all existing date semantics. Keep upstream concurrency conservative; pause, throttle and storage correctness take priority over speculative parallelism.

## Verification

Test request allowlisting, deadline/size failure, no credential forwarding to redirects, checkpoint persistence, credential mismatch, interrupted nested pagination, quota/backoff resume, duplicate suppression, comparison atomicity, storage failure, stage-aware estimates and large synthetic workloads. Run existing collector/metric regressions, TypeScript, full unit suite, production build and browser pause/reload/resume checks.
