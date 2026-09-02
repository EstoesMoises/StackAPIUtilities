# Content Replacement Scan Modes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add search-assisted, exact-target, and exhaustive scan modes to Content Replacement so operators can control request volume without confusing indexed search coverage with content-space completeness.

**Architecture:** Extend the replacement configuration and persisted job protocol with a discriminated discovery mode. Reuse the canonical detail/proposal pipeline for all modes: Targeted scan discovers deduplicated references through paginated `/search`, Exact IDs or URLs seeds the existing bounded detail queue directly, and Full audit retains content pagination while skipping answer collections only for valid zero-answer summaries. A shared presentation helper carries the mode's coverage label through the wizard and CSV evidence.

**Tech Stack:** TypeScript 5.5, Next.js 14 App Router, React 18, Vitest 2, Testing Library, Playwright, Papa Parse, IndexedDB, Stack Overflow Stacks CSS.

**Spec:** `docs/superpowers/specs/2026-09-01-content-replacement-wizard-design.md`

## Global Constraints

- Implement Enterprise main-site execution only. Do not expose Private Team execution.
- Default new jobs to `Targeted scan`; label it exactly `Search-assisted · may miss matches` in Define, Scan, Review, Apply, Results, and preview/result exports.
- Targeted scan must query `GET /search` once per distinct source term with `pageSize=100`, paginate every returned page, validate result discriminators and identifiers, deduplicate references, and fetch canonical details before proposing a write.
- Targeted zero-results copy must never claim site-wide absence.
- Exact-target mode accepts at most 100,000 deduplicated question, answer, and article references. Answer IDs require a parent question ID. Persist the normalized refs once in the job queue; same-origin scan/apply/recovery requests carry only the exact target count and SHA-256 digest, never the full target list.
- Exact-target URLs must use the connected Enterprise origin and supported `/questions/...` or `/articles/...` paths.
- Full audit inventories every accessible selected item. Skip an answer collection only when `answerCount` is the valid integer `0`; fetch conservatively when it is absent or invalid.
- Discovery mode and normalized exact targets form part of the job fingerprint. Changing either requires a new scan.
- Existing pre-mode jobs must remain browser-locally visible. An unfinished legacy scan cannot resume or apply; prior completed write evidence must remain available for guarded recovery.
- Every mode remains read-only until Review and uses the existing canonical Markdown transformer, stale checksum, proposal fingerprint, recovery snapshot, sequential write, credential-redaction, throttle, and retry safeguards.
- Continue to limit one inventory/search page or ten candidate details per same-origin scan request and one post per apply/recovery request.
- Keep the existing 100,000-proposal ceiling, 50-row review pages, and three expanded detail rows.
- Never persist or export tokens, API keys, authorization headers, PKCE values, or credential-bearing errors.
- Do not use the protected customer term in any demo-instance action. The approved disposable canary uses only `DEMOZXQ7` → `DEMOZXR7`.
- Preserve the incumbent Stack-native Operate surface: restrained light canvas, border-led hierarchy, compact Inter type, orange only for action/selection/focus, visible text for every status, WCAG AA contrast, keyboard operation, and reduced-motion-safe feedback.

---

## File Structure

- Create `src/writeTools/contentReplacement/discovery.ts`: exact-target parsing, CSV template/parsing, discovery-mode presentation, and reference normalization.
- Create `src/writeTools/contentReplacement/discovery.test.ts`: same-origin URL, typed ID, answer-parent, CSV, deduplication, limit, and presentation coverage.
- Modify `src/writeTools/contentReplacement/types.ts`: discovery union, search cursor/result shapes, mode-aware progress, compatibility marker, and schema version 2.
- Modify `src/writeTools/contentReplacement/proposals.ts` and `.test.ts`: fingerprint normalized discovery semantics and exact targets.
- Modify `src/writeTools/contentReplacement/contentApi.ts` and `.test.ts`: read `answerCount` and expose one paginated validated `/search` operation.
- Modify `src/writeTools/contentReplacement/scanner.ts` and `.test.ts`: implement Targeted and optimized Full-audit inventory slices.
- Modify `src/server/contentReplacementScanApi.ts` and `.test.ts`: validate mode-specific cursors and return bounded request-count evidence.
- Modify `src/server/contentReplacementRequestValidation.ts` and affected apply/recovery tests: accept only the exact discovery union in every server boundary.
- Modify `src/writeTools/contentReplacement/jobState.ts` and `.test.ts`: initialize mode-specific queues and reduce mode-specific metrics.
- Modify `src/utils/browserContentReplacementStorage.ts` and `.test.ts`: schema-v2 parsing plus safe legacy-job migration/invalidation.
- Modify `src/hooks/useContentReplacementJob.ts` and `.test.tsx`: run and resume all cursor kinds without crossing mode/fingerprint boundaries.
- Create `src/components/ContentReplacementDiscoveryFields.tsx` and `.test.tsx`: discovery cards and exact target browser/CSV controls.
- Modify `src/components/ContentReplacementDefineStep.tsx` and `.test.tsx`: include discovery in validation and the reviewed checkpoint.
- Modify `src/components/ContentReplacementScanStep.tsx` and `.test.tsx`: mode-aware coverage and progress.
- Modify `src/components/ContentReplacementReviewStep.tsx`, `src/components/ContentReplacementApplyStep.tsx`, and tests: persist coverage language and require the Targeted acknowledgement.
- Modify `src/utils/contentReplacementDownloads.ts` and `.test.ts`: export discovery mode and coverage.
- Modify `src/app/globals.css`: style the discovery choice and exact-target editor using the incumbent design system.
- Modify `e2e/content-replacement-wizard.spec.ts` and `e2e/content-replacement-polish.spec.ts`: cover all modes, warnings, responsive layout, and resumability.
- Modify `README.md`: document coverage guarantees, request-volume behavior, and operator selection guidance.

---

### Task 1: Discovery configuration, exact-target parsing, fingerprints, and compatibility types

**Files:**
- Create: `src/writeTools/contentReplacement/discovery.ts`
- Create: `src/writeTools/contentReplacement/discovery.test.ts`
- Modify: `src/writeTools/contentReplacement/types.ts`
- Modify: `src/writeTools/contentReplacement/proposals.ts`
- Modify: `src/writeTools/contentReplacement/proposals.test.ts`

**Interfaces:**
- Produces: `ReplacementDiscovery`, `ReplacementDiscoveryMode`, `ExactTargetSelection`, `DiscoveryPresentation`, `parseExactTargetLines`, `parseExactTargetCsv`, `createExactTargetCsvTemplate`, `normalizeExactTargets`, `createExactTargetSelection`, and `getDiscoveryPresentation`.
- Changes: `ReplacementConfiguration` gains required `discovery`; `PersistedContentReplacementJob.schemaVersion` becomes `2`; jobs gain `scanCompatibility: "current" | "legacy-restart-required"`.
- Consumes: existing `ReplacementItemRef`, RFC 4180 parsing conventions, 100,000 item ceiling, and stable serialization.

- [ ] **Step 1: Write failing discovery and fingerprint tests**

Add focused tests like:

```ts
it("parses same-origin canonical URLs and deduplicates normalized references", () => {
  const result = parseExactTargetLines([
    "https://demo.example.test/questions/42",
    "https://demo.example.test/questions/42/87#87",
    "https://demo.example.test/articles/9",
    "https://demo.example.test/questions/42",
  ].join("\n"), "https://demo.example.test");

  expect(result.errors).toEqual([]);
  expect(result.targets).toEqual([
    { kind: "question", questionId: 42 },
    { kind: "answer", questionId: 42, answerId: 87 },
    { kind: "article", articleId: 9 },
  ]);
  expect(result.duplicateCount).toBe(1);
});

it("rejects cross-origin URLs and answers without a parent question", () => {
  expect(parseExactTargetLines("https://other.test/questions/42", "https://demo.example.test").errors[0].code)
    .toBe("wrong-origin");
  expect(parseExactTargetCsv("type,id,parent_question_id\nanswer,87,", "https://demo.example.test").errors[0].code)
    .toBe("missing-parent-question");
});

it("fingerprints discovery mode and normalized exact targets", async () => {
  const targeted = configuration({ mode: "targeted" });
  const exactSelection = await createExactTargetSelection([
    { kind: "question", questionId: 42 },
  ]);
  const exact = configuration(exactSelection.discovery);
  expect(await createJobFingerprint({ baseUrl: ORIGIN, configuration: targeted }))
    .not.toBe(await createJobFingerprint({ baseUrl: ORIGIN, configuration: exact }));
});
```

Also pin: typed positive-safe-integer rows, supported URL path variants, URL credentials/query rejection, malformed fragments, exact CSV headers, extra columns, stable first-seen order, 100,001-target rejection, and exact coverage strings.

- [ ] **Step 2: Run the focused tests and confirm failure**

Run: `pnpm test -- src/writeTools/contentReplacement/discovery.test.ts src/writeTools/contentReplacement/proposals.test.ts`

Expected: FAIL because discovery types/helpers and fingerprint semantics do not exist.

- [ ] **Step 3: Implement the minimal discovery domain**

Add the exact discriminated union:

```ts
export type ReplacementDiscovery =
  | { mode: "targeted" }
  | { mode: "exact"; targetCount: number; targetDigest: string }
  | { mode: "full" };

export interface ExactTargetSelection {
  discovery: Extract<ReplacementDiscovery, { mode: "exact" }>;
  targets: ReplacementItemRef[];
}

export interface ReplacementConfiguration {
  target: { kind: "enterprise-main" };
  contentTypes: { questions: boolean; answers: boolean; articles: boolean };
  discovery: ReplacementDiscovery;
  rules: ReplacementRule[];
  options: ReplacementOptions;
}
```

Normalize exact targets by `replacementItemKey`, retain first-seen order, reject more than `100_000`, and require exact CSV headers `type,id,parent_question_id`. `createExactTargetSelection()` computes SHA-256 over stable normalized refs and returns a compact discovery descriptor plus the refs that seed the new job once. `getDiscoveryPresentation()` must return immutable product copy:

```ts
targeted: { label: "Search-assisted · may miss matches", exhaustive: false }
exact: { label: `Exact target list · complete for ${count} supplied posts`, exhaustive: true }
full: { label: "Exhaustive · all accessible selected content", exhaustive: true }
```

Update semantic fingerprinting so rule IDs and CSV row metadata remain excluded while `discovery.mode`, `targetCount`, and `targetDigest` are included. The exact target array must not be present in `ReplacementConfiguration`, proposal fingerprints, apply payloads, or recovery payloads.

- [ ] **Step 4: Run focused tests**

Run: `pnpm test -- src/writeTools/contentReplacement/discovery.test.ts src/writeTools/contentReplacement/proposals.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/writeTools/contentReplacement/discovery.ts src/writeTools/contentReplacement/discovery.test.ts src/writeTools/contentReplacement/types.ts src/writeTools/contentReplacement/proposals.ts src/writeTools/contentReplacement/proposals.test.ts
git commit -m "feat: model replacement discovery modes"
```

---

### Task 2: Search adapter and zero-answer Full-audit optimization

**Files:**
- Modify: `src/writeTools/contentReplacement/contentApi.ts`
- Modify: `src/writeTools/contentReplacement/contentApi.test.ts`
- Modify: `src/writeTools/contentReplacement/scanner.ts`
- Modify: `src/writeTools/contentReplacement/scanner.test.ts`

**Interfaces:**
- Adds: `QuestionSummary.answerCount?: number | null`.
- Adds: `SearchSummary` discriminated by `type` and `ContentReplacementClient.getSearchPage(query: string, page: number)`.
- Changes: `InventoryCursor` gains `{ kind: "search"; ruleId: string; page: number }`.
- Produces: mode-aware `InventorySliceResult` with `apiRequestsCompleted`, search counters, and answer-queue/skip counters.

- [ ] **Step 1: Write failing adapter and scanner tests**

Cover the exact upstream query and conservative answer behavior:

```ts
it("reads one validated search page with the maximum page size", async () => {
  await client.getSearchPage("AcmeLegacy", 3);
  expect(transport.getPage).toHaveBeenCalledWith(
    "/search",
    { query: "AcmeLegacy", pageSize: "100" },
    3,
  );
});

it.each([
  { answerCount: 0, expected: 0, skipped: 1 },
  { answerCount: 2, expected: 1, skipped: 0 },
  { answerCount: undefined, expected: 1, skipped: 0 },
  { answerCount: -1, expected: 1, skipped: 0 },
  { answerCount: 1.5, expected: 1, skipped: 0 },
])("queues answers conservatively for $answerCount", async ({ answerCount, expected, skipped }) => {
  questionsPage.mockResolvedValue(page([{ id: 42, answerCount }]));
  const result = await scanInventorySlice(client, fullAuditInput());
  expect(result.answerCursors).toHaveLength(expected);
  expect(result.progress.zeroAnswerQuestionsSkipped).toBe(skipped);
});
```

Search tests must cover question, answer with `parentQuestionId`, and article result refs; malformed type/IDs must raise the sanitized schema error; duplicate results remain legal because job state deduplicates them.

- [ ] **Step 2: Run tests and confirm failure**

Run: `pnpm test -- src/writeTools/contentReplacement/contentApi.test.ts src/writeTools/contentReplacement/scanner.test.ts`

Expected: FAIL because `/search`, result discrimination, and `answerCount` behavior are absent.

- [ ] **Step 3: Implement bounded search and Full-audit behavior**

The adapter must expose only safe canonical refs:

```ts
export type SearchSummary =
  | { type: "question"; questionId: number }
  | { type: "answer"; answerId: number; parentQuestionId: number }
  | { type: "article"; articleId: number };
```

`scanInventorySlice()` must reject cursor/mode mismatches. For `{ kind: "search" }`, locate the rule by ID server-side, call `getSearchPage(rule.find, page)`, filter selected content types, and return a next cursor only while that page has more. For Full audit, enqueue an answer cursor when `answerCount > 0` or is not a non-negative safe integer; skip only exact zero. Keep summary candidate filtering unchanged.

- [ ] **Step 4: Run focused tests**

Run: `pnpm test -- src/writeTools/contentReplacement/contentApi.test.ts src/writeTools/contentReplacement/scanner.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/writeTools/contentReplacement/contentApi.ts src/writeTools/contentReplacement/contentApi.test.ts src/writeTools/contentReplacement/scanner.ts src/writeTools/contentReplacement/scanner.test.ts
git commit -m "feat: add targeted replacement discovery"
```

---

### Task 3: Mode-aware server protocol and persisted job reducer

**Files:**
- Modify: `src/server/contentReplacementScanApi.ts`
- Modify: `src/server/contentReplacementScanApi.test.ts`
- Modify: `src/server/contentReplacementRequestValidation.ts`
- Modify: `src/server/contentReplacementApplyApi.test.ts`
- Modify: `src/server/contentReplacementRecoveryApi.test.ts`
- Modify: `src/writeTools/contentReplacement/jobState.ts`
- Modify: `src/writeTools/contentReplacement/jobState.test.ts`

**Interfaces:**
- Consumes: Task 1 discovery union and Task 2 cursors/results.
- Produces: mode-specific initial queues, one-time exact target detail seeding, committed upstream request counts, and scan-completion guards.
- Preserves: exact payload validation, fingerprint revalidation, redaction, bounded request sizes, and proposal ceiling.

- [ ] **Step 1: Write failing route and reducer tests**

Pin these behaviors:

```ts
it("seeds exact mode directly into the bounded detail queue", () => {
  const targets = [questionRef(42), answerRef(42, 87), articleRef(9)];
  const job = createReplacementJob(await inputWithExactTargets(targets));
  expect(job.inventoryQueue).toEqual([]);
  expect(job.detailQueue).toEqual([questionRef(42), answerRef(42, 87), articleRef(9)]);
});

it("seeds one targeted cursor per distinct configured source term", () => {
  const job = createReplacementJob(inputWithDiscovery({ mode: "targeted" }));
  expect(job.inventoryQueue).toEqual([
    { kind: "search", ruleId: "rule-1", page: 1 },
    { kind: "search", ruleId: "rule-2", page: 1 },
  ]);
});

it("rejects a search cursor on a Full-audit configuration", async () => {
  const response = await handleContentReplacementScanRequest(payload({
    configuration: fullConfiguration(),
    cursor: { kind: "search", ruleId: "rule-1", page: 1 },
  }));
  expect(response.status).toBe(400);
});
```

Also test: exact targets inconsistent with selected content types; unknown search rule IDs; full cursors on Targeted; inventory cursors on Exact; request metrics increment only from accepted current-queue responses; paginated search advances the current rule without losing later rules; deduplication across rules/pages; and no Review on partial discovery.

- [ ] **Step 2: Run tests and confirm failure**

Run: `pnpm test -- src/server/contentReplacementScanApi.test.ts src/server/contentReplacementApplyApi.test.ts src/server/contentReplacementRecoveryApi.test.ts src/writeTools/contentReplacement/jobState.test.ts`

Expected: FAIL because server validation and job queues assume exhaustive inventory only.

- [ ] **Step 3: Implement exact protocol validation and reducer transitions**

Create mode-specific queues in `createReplacementJob()`:

```ts
if (discovery.mode === "targeted") {
  inventoryQueue.push(...configuration.rules.map(({ id }) => ({ kind: "search" as const, ruleId: id, page: 1 })));
} else if (discovery.mode === "exact") {
  assertExactTargetSeed(input.exactTargets, discovery);
  detailQueue.push(...input.exactTargets);
} else {
  if (contentTypes.questions || contentTypes.answers) inventoryQueue.push({ kind: "questions", page: 1 });
  if (contentTypes.articles) inventoryQueue.push({ kind: "articles", page: 1 });
}
```

`CreateReplacementJobInput` gains `exactTargets?: ReplacementItemRef[]`. The controller calls `createExactTargetSelection()` immediately before fingerprinting and job creation; synchronous creation verifies normalized first-seen refs and count, then persists them once as the detail queue. Keep a single compact route payload shape. Apply and recovery routes accept `configuration.discovery` but never receive the target array and continue to recompute proposals from canonical server reads. Reducer events must match the queue head and discovery mode before consuming results. Store counters for `apiRequestsCompleted`, `searchPages`, `searchTermsCompleted`, `indexedReferences`, `answerBearingQuestionsQueued`, and `zeroAnswerQuestionsSkipped`; exact fetched/matched counts derive from detail progress and proposals.

- [ ] **Step 4: Run route and reducer tests**

Run: `pnpm test -- src/server/contentReplacementScanApi.test.ts src/server/contentReplacementApplyApi.test.ts src/server/contentReplacementRecoveryApi.test.ts src/writeTools/contentReplacement/jobState.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/contentReplacementScanApi.ts src/server/contentReplacementScanApi.test.ts src/server/contentReplacementRequestValidation.ts src/server/contentReplacementApplyApi.test.ts src/server/contentReplacementRecoveryApi.test.ts src/writeTools/contentReplacement/jobState.ts src/writeTools/contentReplacement/jobState.test.ts
git commit -m "feat: orchestrate replacement scan modes"
```

---

### Task 4: Browser persistence migration and resumable orchestration

**Files:**
- Modify: `src/utils/browserContentReplacementStorage.ts`
- Modify: `src/utils/browserContentReplacementStorage.test.ts`
- Modify: `src/hooks/useContentReplacementJob.ts`
- Modify: `src/hooks/useContentReplacementJob.test.tsx`
- Modify: `src/components/ContentReplacementJobManager.tsx`
- Modify: `src/components/ContentReplacementJobManager.test.tsx`

**Interfaces:**
- Consumes: schema version 2 and mode-aware queues.
- Produces: safe migration of schema-v1 jobs and resumable mode-specific scan requests.
- Migration rule: unfinished v1 scans/reviews without writes become `legacy-restart-required`; completed apply/recovery evidence remains readable and recoverable.

- [ ] **Step 1: Write failing storage and hook tests**

Tests must prove:

```ts
it("keeps a paused v1 job visible but blocks its scan from resuming", async () => {
  const migrated = await parseContentReplacementJob(v1PausedScan());
  expect(migrated.schemaVersion).toBe(2);
  expect(migrated.scanCompatibility).toBe("legacy-restart-required");
  render(<ContentReplacementJobManager storage={storageContaining(migrated)} onOpenJob={vi.fn()} />);
  expect(await screen.findByText("New scan required")).toBeVisible();
});

it("preserves guarded recovery evidence from a completed v1 write", async () => {
  const migrated = await parseContentReplacementJob(v1AppliedResult());
  expect(migrated.proposals["question:42"].recovery?.observedPostApplyChecksum).toBe(HASH);
  expect(migrated.scanCompatibility).toBe("legacy-restart-required");
});
```

Hook tests must show a resumed Targeted job sends the exact saved search cursor, an Exact job starts with detail batches only, a Full job resumes its answer cursor, a legacy job sends no request, and switching/new-job creation never mutates the old paused job.

- [ ] **Step 2: Run tests and confirm failure**

Run: `pnpm test -- src/utils/browserContentReplacementStorage.test.ts src/hooks/useContentReplacementJob.test.tsx src/components/ContentReplacementJobManager.test.tsx`

Expected: FAIL because schema-v1 is the only recognized format and resume is not compatibility-gated.

- [ ] **Step 3: Implement schema-v2 parsing and operation fences**

Parse only exact schema-v2 shapes for new saves. Add a narrowly scoped v1 migration that clones validated credential-free fields, adds `{ discovery: { mode: "full" } }` for evidence interpretation, sets `scanCompatibility: "legacy-restart-required"`, and never recomputes or authorizes a new apply from the legacy fingerprint. Recovery continues to use the saved request models and checksums.

Gate `startScan`, `resume`, `prepareApply`, and `startApply` on `scanCompatibility === "current"`. Keep recovery gates independent when a prior successful apply has valid recovery evidence. Preserve the existing job/storage-scoped mutation barrier across remounts.

- [ ] **Step 4: Run storage and orchestration tests**

Run: `pnpm test -- src/utils/browserContentReplacementStorage.test.ts src/hooks/useContentReplacementJob.test.tsx src/components/ContentReplacementJobManager.test.tsx`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/utils/browserContentReplacementStorage.ts src/utils/browserContentReplacementStorage.test.ts src/hooks/useContentReplacementJob.ts src/hooks/useContentReplacementJob.test.tsx src/components/ContentReplacementJobManager.tsx src/components/ContentReplacementJobManager.test.tsx
git commit -m "feat: persist resumable replacement discovery"
```

---

### Task 5: Define-stage discovery selector and exact-target editor

**Files:**
- Create: `src/components/ContentReplacementDiscoveryFields.tsx`
- Create: `src/components/ContentReplacementDiscoveryFields.test.tsx`
- Modify: `src/components/ContentReplacementDefineStep.tsx`
- Modify: `src/components/ContentReplacementDefineStep.test.tsx`
- Modify: `src/components/ContentReplacementWizard.tsx`
- Modify: `src/components/ContentReplacementWizard.test.tsx`
- Modify: `src/app/globals.css`

**Interfaces:**
- Consumes: discovery parsers/presentation from Task 1 and connected credential origin.
- Produces: a validated compact `ReplacementConfiguration.discovery` plus an immutable one-time `exactTargets` seed inside the existing review checkpoint.
- Defaults: Targeted selected; Exact reveals typed rows, paste, and target CSV; Full shows a large-instance warning.

- [ ] **Step 1: Load the Impeccable UI quality floor**

Run: `cat .agents/skills/impeccable/reference/craft-floor.md`

Apply the incumbent `PRODUCT.md` and `DESIGN.md` Operate rules. This is a refinement: preserve the existing wizard identity, field vocabulary, and compact density.

- [ ] **Step 2: Write failing interaction and accessibility tests**

Add tests for:

```tsx
expect(screen.getByRole("radio", { name: /Targeted scan/i })).toBeChecked();
expect(screen.getByText("Search-assisted · may miss matches")).toBeVisible();

await user.click(screen.getByRole("radio", { name: /Exact IDs or URLs/i }));
await user.type(screen.getByLabelText("Paste target URLs"), `${ORIGIN}/questions/42`);
await user.click(screen.getByRole("button", { name: "Add pasted targets" }));
expect(screen.getByText("1 valid target")).toBeVisible();

await user.click(screen.getByRole("radio", { name: /Full audit/i }));
expect(screen.getByRole("note")).toHaveTextContent("may require thousands of API requests");
```

Also cover keyboard radio navigation, visible focus, wrong-origin and missing-parent focus routing, target CSV template/import, 100,000 limit messaging, content-type mismatch, configuration checkpoint invalidation after any mode/target change, narrow layout, and no modal.

- [ ] **Step 3: Run tests and confirm failure**

Run: `pnpm test -- src/components/ContentReplacementDiscoveryFields.test.tsx src/components/ContentReplacementDefineStep.test.tsx src/components/ContentReplacementWizard.test.tsx`

Expected: FAIL because the selector and exact-target editor do not exist.

- [ ] **Step 4: Implement the guided discovery choice**

Use a semantic fieldset with three radio-backed choice cards. Each card must state coverage and request profile in visible copy. Keep Targeted's warning always visible. Exact mode uses bounded rows with a native Type select, ID/URL field, answer parent field when required, a paste area for canonical URLs, and a separate target-CSV import/template action. Full audit uses a warning notice, not a blocking modal.

Pass `expectedOrigin` from validated connected credentials through `ContentReplacementWizard` so URL validation never trusts arbitrary pasted hosts. Add discovery state and normalized target digest to `configurationSnapshotKey`; `Review rules` must focus the first discovery error. `Start scan` passes the reviewed compact configuration and, only for Exact mode, the immutable normalized target seed to `controller.createJob(configuration, exactTargets)`; subsequent scan/apply/recovery requests never carry the array.

- [ ] **Step 5: Run UI tests**

Run: `pnpm test -- src/components/ContentReplacementDiscoveryFields.test.tsx src/components/ContentReplacementDefineStep.test.tsx src/components/ContentReplacementWizard.test.tsx`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/ContentReplacementDiscoveryFields.tsx src/components/ContentReplacementDiscoveryFields.test.tsx src/components/ContentReplacementDefineStep.tsx src/components/ContentReplacementDefineStep.test.tsx src/components/ContentReplacementWizard.tsx src/components/ContentReplacementWizard.test.tsx src/app/globals.css
git commit -m "feat: guide replacement scan selection"
```

---

### Task 6: Coverage evidence across Scan, Review, Apply, Results, and CSV

**Files:**
- Modify: `src/components/ContentReplacementScanStep.tsx`
- Modify: `src/components/ContentReplacementScanStep.test.tsx`
- Modify: `src/components/ContentReplacementReviewStep.tsx`
- Modify: `src/components/ContentReplacementReviewStep.test.tsx`
- Modify: `src/components/ContentReplacementApplyStep.tsx`
- Modify: `src/components/ContentReplacementApplyStep.test.tsx`
- Modify: `src/utils/contentReplacementDownloads.ts`
- Modify: `src/utils/contentReplacementDownloads.test.ts`
- Modify: `src/app/globals.css`

**Interfaces:**
- Consumes: `getDiscoveryPresentation()` and mode-aware progress.
- Produces: persistent coverage evidence and a second Targeted-only apply acknowledgement.
- Export columns: `discoveryMode`, `coverage`, and `suppliedTargetCount` are added to preview, result, and exception CSVs.

- [ ] **Step 1: Write failing coverage and confirmation tests**

Pin exact copy and guards:

```tsx
expect(screen.getByText("Search-assisted · may miss matches")).toBeVisible();
expect(screen.getByText("No indexed candidates found")).toBeVisible();
expect(screen.queryByText(/term is absent|no matches across/i)).not.toBeInTheDocument();

await user.click(screen.getByLabelText(/reviewed the proposed changes/i));
await user.type(screen.getByLabelText(/Type APPLY/i), "APPLY");
expect(screen.getByRole("button", { name: /Apply changes/i })).toBeDisabled();
await user.click(screen.getByLabelText(/search-assisted discovery may have missed matches/i));
expect(screen.getByRole("button", { name: /Apply changes/i })).toBeEnabled();
```

Test each mode's scan metrics, zero-result language, Review badge, Apply summary, Results badge, CSV column bytes, and confirmation-key invalidation. Exact and Full modes must not render the Targeted-only acknowledgement.

- [ ] **Step 2: Run tests and confirm failure**

Run: `pnpm test -- src/components/ContentReplacementScanStep.test.tsx src/components/ContentReplacementReviewStep.test.tsx src/components/ContentReplacementApplyStep.test.tsx src/utils/contentReplacementDownloads.test.ts`

Expected: FAIL because coverage is not yet persistent and the current status copy always claims exhaustive inventory.

- [ ] **Step 3: Implement mode-aware evidence and status copy**

Render a shared coverage banner at the top of Scan, Review, Apply, and Results. Scan counters are:

- Targeted: source terms completed, search pages, indexed references, canonical details, proposals, API reads completed.
- Exact: supplied targets, canonical details fetched, proposals, protected occurrences, API reads completed.
- Full: question pages, answer collections, article pages, answer-bearing questions queued, zero-answer questions skipped, canonical details, proposals, API reads completed.

Targeted no-results copy distinguishes `No indexed candidates found` from `No eligible matches in indexed candidates`. Add a Targeted-only checkbox to the existing inline confirmation; bind it to `applyScopeKey()` so any immutable scope change clears it. Extend all CSV producers with discovery evidence without including credentials or internal cursor state.

- [ ] **Step 4: Run focused tests**

Run: `pnpm test -- src/components/ContentReplacementScanStep.test.tsx src/components/ContentReplacementReviewStep.test.tsx src/components/ContentReplacementApplyStep.test.tsx src/utils/contentReplacementDownloads.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/ContentReplacementScanStep.tsx src/components/ContentReplacementScanStep.test.tsx src/components/ContentReplacementReviewStep.tsx src/components/ContentReplacementReviewStep.test.tsx src/components/ContentReplacementApplyStep.tsx src/components/ContentReplacementApplyStep.test.tsx src/utils/contentReplacementDownloads.ts src/utils/contentReplacementDownloads.test.ts src/app/globals.css
git commit -m "feat: expose replacement coverage evidence"
```

---

### Task 7: End-to-end proof, operator documentation, and exact-target live canary

**Files:**
- Modify: `e2e/content-replacement-wizard.spec.ts`
- Modify: `e2e/content-replacement-polish.spec.ts`
- Modify: `README.md`
- Modify only if a canary exposes a defect: the smallest owning production and test files.

**Interfaces:**
- Verifies: all three discovery paths converge on the unchanged canonical Review/Apply/Recovery pipeline.
- Live scope: only the existing disposable demo question `20118`, answer `20119` under question `20118`, and article `20120`.

- [ ] **Step 1: Write mocked browser workflows for all three modes**

Add Playwright coverage that:

1. Starts a Targeted scan with two rules, paginates separate mocked search result sets, deduplicates a shared hit, shows the non-exhaustive badge, and blocks Apply until both confirmations are complete.
2. Imports the three-row exact-target CSV, issues no inventory/search request, fetches only the supplied detail refs, and labels completeness as limited to those targets.
3. Runs Full audit over questions containing answer counts `0`, `2`, and missing; proves only the latter two answer collections are requested; pauses, reloads, reconnects credentials, and resumes at the exact cursor.
4. Proves a schema-v1 paused scan remains listed as `New scan required` while a completed v1 job retains recovery access.

- [ ] **Step 2: Run E2E and confirm failures before final integration**

Run: `pnpm exec playwright test e2e/content-replacement-wizard.spec.ts e2e/content-replacement-polish.spec.ts`

Expected before completing integration: at least one new scenario FAILS on its new assertion. After Tasks 1–6 are present, make only the minimal fixture/test harness adjustments needed for the scenarios to pass.

- [ ] **Step 3: Document operator guidance**

Add a concise README comparison:

| Mode | Use when | Coverage | Request profile |
|---|---|---|---|
| Targeted | You know the term but not the posts | Search-assisted; may miss matches | Search pages plus canonical candidate reads |
| Exact IDs or URLs | You know the posts or are running a canary | Complete for supplied targets | One canonical read per target, batched through the browser |
| Full audit | Missing any accessible match is unacceptable | Exhaustive after complete inventory | Every selected collection; zero-answer questions skip answer reads |

State that the browser must remain open and that rate-limit pauses are persisted locally.

- [ ] **Step 4: Run complete local verification**

Run:

```bash
pnpm test
pnpm lint
pnpm build
pnpm exec playwright test e2e/content-replacement-wizard.spec.ts e2e/content-replacement-polish.spec.ts
```

Expected: all commands exit 0; no test failure, lint error, build error, or unhandled browser exception.

- [ ] **Step 5: Inspect desktop and mobile once, fix in one bounded pass, and confirm once**

Start the local app, inspect Define and Scan at desktop and mobile widths together, and capture one defect list. Fix the batch once, then perform one confirmation pass. Verify visible focus, radio semantics, warning persistence, narrow stacking, no page-level horizontal overflow, and reduced-motion behavior. Do not resume the old exhaustive demo scan.

- [ ] **Step 6: Run the disposable exact-target canary with action-time confirmation gates**

Use only:

```csv
type,id,parent_question_id
question,20118,
answer,20119,20118
article,20120,
```

Use only the approved synthetic replacement `DEMOZXQ7` → `DEMOZXR7`. Before transmitting credentials for the read-only exact scan, obtain action-time confirmation if the existing session is no longer active. Inspect the detailed before/after payloads and protected occurrences. Before Apply, stop for explicit external-write confirmation. Before Recovery, stop again for explicit external-write confirmation. Never type, search for, transmit, or log the protected customer term in the demo environment.

- [ ] **Step 7: Ask separately before deleting disposable demo content**

Deletion is a separate destructive cloud action. Do not delete the demo question, answer, or article without explicit confirmation naming all three targets. After confirmed deletion, report what was removed and whether the demo platform exposes recovery.

- [ ] **Step 8: Commit verified integration or canary-driven fixes**

```bash
git add e2e/content-replacement-wizard.spec.ts e2e/content-replacement-polish.spec.ts README.md
git commit -m "test: verify replacement scan modes"
```

If the canary required production fixes, include only their owning tests and source files in an additional `fix:` commit after rerunning the covering focused tests and the complete verification suite.
