# Resumable Live Reports Implementation Plan

> **For agentic workers:** Execute the independent transport and storage tasks in parallel, then integrate with collector orchestration and UI. Use test-first implementation and review the integrated result.

**Goal:** Live reports survive request timeouts and browser interruptions, with saved checkpoints and honest ETA ranges.
**Architecture:** Existing collectors run in the browser over bounded same-origin API reads. An IndexedDB response journal replays completed reads on resume; only complete results enter report output state.
**Tech Stack:** Next.js 14, TypeScript, React, IndexedDB, Vitest, Playwright.
**Spec:** docs/superpowers/specs/2026-11-03-resumable-reports-design.md

## Global Constraints

- Raw credentials never enter persisted job metadata, request keys, logs or exports.
- Each server request performs one allowlisted GET; 20-second upstream timeout; 2 MiB upstream response and 1 MiB incoming request limits.
- Persist complete successful responses before advancing; reject over-capacity jobs without truncating.
- Restore paused; explicit resume; credential/connection fingerprint must match; no automatic background work.
- Preserve existing metric semantics and publish comparison results atomically.
- ETA must be measured, distinguish discovery and waits, and exclude user pause time.

### Task 1: Bounded server transport

Files: src/server/reportReadApi.ts, src/server/reportReadApi.test.ts, src/app/api/reports/read/route.ts.
Interface: POST {reportId, credentials, request:{api:'v2'|'v3',path,query}} returns {ok:true,response:{status,body,headers}} or {ok:false,error}. body is parsed JSON; headers are allowlisted throttle headers. Browser clients consume reconstructed Response objects.
- [x] Write tests for one-page forwarding, credentials, paths/query rejection, timeout, payload limits, redirects and sanitized failures.
- [x] Observe expected test failures; implement bounded read handling; rerun covering tests.

### Task 2: Durable browser checkpoint store

Files: src/reports/resumable/reportJobStore.ts and tests.
Interface: typed job metadata and successful response entries; create/load/save/getResponse/putResponse/delete. Response writes and metadata counters commit atomically. No whole-cache rewrites. Explicit storage errors, size limits and metadata validation.
- [x] Write storage round-trip, malformed input, conflict, quota/abort and deletion tests.
- [x] Observe failures; implement IndexedDB transactions and bounded records; run tests.

### Task 3: Resumable runner and estimates

Files: src/reports/resumable/reportJobRunner.ts, reportEstimate.ts, tests; collector options and optimization files.
- [x] Test interrupted collection against uninterrupted results, cache replay without repeated API calls, saved throttle waits, abort, changed credentials and large workloads.
- [x] Implement transport serialization, read-through checkpoints, abortable waits and collector progress callbacks.
- [x] Add inventory-derived request estimates and measured ETA range tests; reuse discovery reads in collection.
- [x] Test and implement authoritative-SME and duplicate-read optimizations without changing metrics.

### Task 4: UI integration and final verification

Files: src/hooks/useReportJob.ts, src/components/ReportJobStatus.tsx, src/App.tsx, associated tests, styles, README.md, e2e/reporting-mvp.spec.ts.
- [x] Test restored paused jobs, pause/resume/cancel, connection mismatch and atomic completed result publication.
- [x] Integrate status and controls with existing Stacks styles; preserve other workflows.
- [x] Run unit suite, TypeScript, build and browser interruption/reload checks; review all diff and resolve findings.

## Verification results

- Full unit suite: 104 files, 2,465 tests passed.
- TypeScript checks and production build passed.
- Reporting and pause/reload/resume browser flows: 9 tests passed against the production build.
- Independent review findings resolved: reject malformed responses before checkpointing, and retain connection throttle deadlines across completion, replacement, discard, and reload.
- Desktop and mobile progress controls visually checked. No deployment performed.
