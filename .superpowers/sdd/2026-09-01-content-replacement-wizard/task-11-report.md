# Task 11 Report: Coordinate Resumable Replacement Jobs

## Files

- `src/writeTools/contentReplacement/jobState.ts`
  - Added the pure, timestamp-driven replacement job reducer, canonical item keys, FIFO queue selectors, apply/recovery selectors, review gating, and exact derived summaries.
- `src/writeTools/contentReplacement/jobState.test.ts`
  - Added reducer coverage for inventory selection, answer expansion, queue bounds/order/deduplication, blocking failures, pause/resume, review gating, protected-only scans, selection, atomic recovery preparation, apply categories/retries, stale rescans, idempotent apply, recovery generations/conflicts, snapshot deletion, and lost-response-safe pause behavior.
- `src/hooks/useContentReplacementJob.ts`
  - Added the sequential browser coordinator with request-time credentials, injected ID/clock/fetch/wait/storage seams, strict response parsing, atomic persistence gates, abortable fetch/backoff handling, unload protection, apply/recovery revalidation, retries, bounded stale rescans, and explicit deletion controls.
- `src/hooks/useContentReplacementJob.test.tsx`
  - Added coordinator coverage for credential exclusion, normalized origins, response-before-next-call persistence, throttling, pause/resume races, storage failures, apply preparation/revalidation, strict safe unions, new credentials, recovery wire models/generations, eligible retry, stale-only rescans, deletion, configuration invalidation, and unload listener lifetime.
- `src/utils/browserContentReplacementStorage.ts`
  - Narrowly extended the Task 10 matrix so results may retain successful apply evidence after recovery snapshots are explicitly deleted and may persist a sanitized blocking stale-rescan failure.
- `src/utils/browserContentReplacementStorage.test.ts`
  - Added round-trip tests for those two legitimate reducer states and updated the documented results-stage root matrix.

## RED / GREEN Evidence

### Pure reducer

- Initial RED: `pnpm test -- src/writeTools/contentReplacement/jobState.test.ts`
  - Failed because `./jobState` did not exist; the repository runner reported the new suite as unresolved while the pre-existing 1,657 tests passed.
- Initial GREEN: `pnpm exec vitest run src/writeTools/contentReplacement/jobState.test.ts`
  - Passed 24 reducer tests after the first implementation.
- Refinement RED/GREEN cycles caught and fixed:
  - answer cursors enqueued when answers were not selected;
  - out-of-order and 11-item detail completions were accepted;
  - protected-only stale rescans retained obsolete proposals;
  - interrupted apply work remained `applying` in a paused root state;
  - stale-rescan failures had no persisted root state;
  - recovery-conflict summaries hid the retained successful apply result;
  - snapshot deletion retained a stale root failure;
  - apply items could start out of FIFO order; and
  - a failed drained scan could incorrectly enter review.
- Final focused GREEN: 32 reducer tests passed.

### Browser coordinator

- Initial RED: `pnpm exec vitest run src/hooks/useContentReplacementJob.test.tsx`
  - Failed because `./useContentReplacementJob` did not exist.
- Initial GREEN: 11 hook tests passed after the first sequential coordinator implementation.
- Refinement RED/GREEN cycles caught and fixed:
  - request credentials used an unnormalized URL;
  - recovery-preview throttling did not persist a deadline before waiting;
  - recovery item failures were treated as malformed responses;
  - HTTP 4xx recovery runs continued to the next item;
  - the hook targeted `/recovery` instead of the real `/recover` route;
  - malformed throttle unions were accepted;
  - immediate Resume could overtake the paused persistence checkpoint;
  - deterministic recovery order followed caller order rather than proposal FIFO;
  - stale-rescan transport failures were not persisted; and
  - the second stale-rescan batch was ignored and double-counted detail inspection.
- Final focused GREEN: 22 hook tests passed.

### Storage compatibility

- RED: explicit recovery-snapshot deletion and a blocking stale-rescan failure were rejected by the Task 10 matrix.
- GREEN: both states round-trip through the exact parser while contradictory `none`/recovery-data states remain rejected.
- Final focused command:
  - `pnpm exec vitest run src/writeTools/contentReplacement/jobState.test.ts src/hooks/useContentReplacementJob.test.tsx src/utils/browserContentReplacementStorage.test.ts`
  - 3 files / 219 tests passed.

## Verification

- Full repository test run: `pnpm test`
  - 84 files / 1,713 tests passed in the final verification run.
- Type/lint verification: `pnpm lint`
  - Passed both TypeScript projects.
- Whitespace verification: `git diff --check`
  - Passed.

## Security and Correctness Self-Review

- The reducer imports no storage, fetch, credential, clock, random, or browser APIs. Every time-sensitive event carries an ISO timestamp.
- Persisted jobs contain no credential fields. The coordinator reads the latest credential ref for each request, overrides only the request base URL with the persisted normalized origin, and never sends credentials to the reducer or storage.
- Every bounded response is parsed into an expected exact safe union, reduced, and saved before another request. Invalid/network error text is replaced with stable content-free messages.
- Apply requests contain only credentials, configuration/fingerprint evidence, item refs, and reviewed checksums/fingerprints; they contain no client-authored replacement body.
- Recovery requests use `toReplacementWireRequestModel`; metadata remains in local canonical recovery evidence and never crosses the wire boundary.
- Apply starts only after reloading and comparing the exact persisted credential-free snapshot. Recovery starts only from a current recoverable preview bound to the successful apply attempt and completion timestamp.
- Pause aborts the active fetch/wait, converts active apply/recovery work to a safely resumable state, persists that checkpoint, and prevents an immediate Resume from overtaking the save.
- A reviewer subagent was not used because the Task 11 assignment explicitly prohibited subagents; this report records the required local self-review instead.

## Commit

- Subject: `feat: coordinate resumable replacement jobs`
- Base: `756553dca951baca155dd58d1d9dfa1a06f45bd8`

## Risks

- The browser must remain open during active work; this task deliberately provides resumable local checkpoints rather than background execution.
- An interrupted recovery write invalidates its preview and requires a fresh explicit preview before another recovery confirmation; this is conservative lost-response handling.
- Focused stale rescans fetch only requested stale refs. Entering the resulting review generation resets apply readiness so all recovery records are rebuilt atomically before another write.
