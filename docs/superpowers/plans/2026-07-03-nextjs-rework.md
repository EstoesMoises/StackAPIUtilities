# Next.js Rework Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move live report execution behind a Next.js server route so Stack Enterprise API calls are no longer blocked by browser CORS.

**Architecture:** Preserve the existing React workspace, report registry, importers, collectors, dashboards, and session-only UI model. Replace the Vite shell with Next.js App Router and route `Run report` actions through a same-origin `/api/reports/run` endpoint that calls the existing live report runner server-side.

**Tech Stack:** Next.js App Router, React 18, TypeScript, Vitest, Testing Library, Playwright, existing report modules.

---

### Task 1: Next.js Shell

**Files:**
- Modify: `package.json`
- Modify: `tsconfig.json`
- Modify: `playwright.config.ts`
- Create: `next.config.mjs`
- Create: `src/app/layout.tsx`
- Create: `src/app/page.tsx`
- Modify: `src/App.tsx`
- Delete after migration: `index.html`, `vite.config.ts`, `src/main.tsx`

- [ ] Change scripts from Vite to `next dev`, `next build`, and `next start`.
- [ ] Add `next` to dependencies and remove Vite-specific dependencies.
- [ ] Add App Router layout and page files.
- [ ] Mark the existing `App` component as a client component.
- [ ] Keep global Stacks and app CSS imports in `src/app/layout.tsx`.
- [ ] Run component tests to verify the workspace still renders.

### Task 2: Server Report Route

**Files:**
- Create: `src/server/reportRunApi.ts`
- Create: `src/server/reportRunApi.test.ts`
- Create: `src/app/api/reports/run/route.ts`
- Modify: `src/App.tsx`

- [ ] Write a failing test that a valid run request calls `runLiveReport` and returns datasets.
- [ ] Write a failing test that invalid request JSON returns a 400-style result.
- [ ] Implement a small server handler around `runLiveReport`.
- [ ] Add a Next route that adapts `Request` to the server handler.
- [ ] Replace direct browser `runLiveReport` calls in `App` with `fetch("/api/reports/run")`.
- [ ] Preserve unsupported-dataset and API-error messages in the run queue.

### Task 3: Verification

**Files:**
- Modify: tests as needed for API route behavior.
- Modify: `README.md`

- [ ] Update README to describe the hybrid Next.js runner.
- [ ] Run `pnpm install` to update `pnpm-lock.yaml`.
- [ ] Run `pnpm test`.
- [ ] Run `pnpm build`.
- [ ] Run `pnpm e2e` if localhost binding is available.
- [ ] Start `pnpm dev` and verify the app loads in the browser.

### Self-Review

- Spec coverage: this plan covers the CORS-driven Next.js migration, server-side report execution, preserved client UI, tests, and README update.
- Placeholder scan: no TBD/TODO placeholders are present.
- Type consistency: route payloads use existing `ReportId`, `SessionCredentials`, and `LiveReportRunResult` shapes.
