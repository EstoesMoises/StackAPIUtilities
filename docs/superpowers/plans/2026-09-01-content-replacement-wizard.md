# Content Replacement Wizard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a guided Enterprise API v3 wizard that safely replaces one or many exact terms across question titles and bodies, answer bodies, and article titles and bodies, with exhaustive discovery, optional line-by-line review, resumable browser-owned progress, guarded apply, recovery, and audit exports.

**Architecture:** Add a pure content-replacement domain layer for validation, Markdown-safe transformation, canonical API request models, checksums, and job state. Extend the API v3 client with bounded page/detail/PUT primitives, then expose stateless same-origin scan, apply, and recovery routes that revalidate credentials and recompute every proposal. The React wizard coordinates bounded calls and persists credential-free state in a dedicated IndexedDB database; OAuth tokens remain in the existing in-memory session only.

**Tech Stack:** TypeScript 5.5, Next.js 14 App Router, React 18, Vitest 2, Testing Library, Playwright, Papa Parse, `mdast-util-from-markdown`, GFM Markdown extensions, `parse5`, Web Crypto SHA-256, IndexedDB, Stack Overflow Stacks CSS.

**Spec:** `docs/superpowers/specs/2026-09-01-content-replacement-wizard-design.md`

## Global Constraints

- Implement Enterprise main-site execution only. Do not expose a Private Team selector or team-scoped claim in this release.
- Require Enterprise OAuth `write_access` through the existing credential workflow. Never persist or export tokens, API keys, authorization headers, PKCE values, or credential-bearing errors.
- Inventory every accessible question page, every question's answer pages, and every article page required by the selected content types. Search results may never establish scan completeness.
- Never modify comments, tags, URL destinations, image destinations, autolink targets, or raw HTML attributes. Tags and article permissions are preserved only as required PUT fields.
- Apply rules simultaneously to each original field. A post receives at most one PUT per apply attempt.
- Never forward a browser-supplied proposed body directly. Re-fetch, rebuild the allowed request model, compare the scanned checksum, recompute the proposal, and compare the proposal fingerprint on the server.
- Materialize and persist a complete recovery snapshot for every selected post before enabling the first PUT. Recovery must compare the current post-apply checksum before restoring the prior full request model.
- Limit one inventory page or ten candidate details per scan request and one post per apply/recovery request. Persist client progress after every bounded response.
- Default writes to sequential execution. Honor `Retry-After` and throttle headers; use bounded retries for 429, 502, 503, 504, and transient network failures.
- Keep detailed review optional and bounded: paginate the table at 50 rows and allow at most three expanded detail rows at once.
- Preserve the existing User Group Sync behavior while extracting any shared Enterprise write-route safeguards.

---

## File Structure

- Create `src/writeTools/contentReplacement/types.ts`: replacement configuration, API request-model unions, scan cursors, proposals, recovery records, result categories, and persisted job types.
- Create `src/writeTools/contentReplacement/rules.ts` and `.test.ts`: manual/CSV rule normalization, simultaneous-rule validation, and local CSV parsing/template generation.
- Create `src/writeTools/contentReplacement/markdown.ts` and `.test.ts`: Markdown-aware source-offset replacement and protected-occurrence reporting.
- Create `src/writeTools/contentReplacement/proposals.ts` and `.test.ts`: full request-model normalization, transformations, stable serialization, SHA-256 checksums, and fingerprints.
- Modify `src/api/stackApiV3.ts` and `.test.ts`: bounded single-page GET, detail GET, idempotent PUT, retry, and throttle support.
- Create `src/writeTools/contentReplacement/contentApi.ts` and `.test.ts`: typed Enterprise question/answer/article adapter and exact request-model reconstruction.
- Create `src/writeTools/contentReplacement/scanner.ts` and `.test.ts`: conservative HTML candidate filtering plus bounded inventory/detail scan operations.
- Create `src/server/enterpriseWriteRequest.ts` and `.test.ts`: shared target, scope, payload-size, and credential-redaction safeguards.
- Modify `src/server/userGroupSyncApi.ts` and `.test.ts`: consume the shared write safeguards without behavior changes.
- Create `src/server/contentReplacementScanApi.ts` and `.test.ts`, plus `src/app/api/write-tools/content-replacement/scan/route.ts`: stateless bounded scan route.
- Create `src/server/contentReplacementApplyApi.ts` and `.test.ts`, plus `src/app/api/write-tools/content-replacement/apply/route.ts`: guarded, idempotent single-item apply route.
- Create `src/server/contentReplacementRecoveryApi.ts` and `.test.ts`, plus `src/app/api/write-tools/content-replacement/recover/route.ts`: guarded, idempotent single-item recovery route.
- Create `src/utils/browserContentReplacementStorage.ts` and `.test.ts`: dedicated credential-free IndexedDB job persistence.
- Create `src/writeTools/contentReplacement/jobState.ts` and `.test.ts`: pure queue/reducer transitions for scan, selection, apply, results, and recovery.
- Create `src/hooks/useContentReplacementJob.ts` and `.test.tsx`: browser coordinator, persistence, pausing, resuming, retries, and unload protection.
- Create `src/components/ContentReplacementWizard.tsx` and `.test.tsx`: four-stage wizard shell and routing.
- Create `src/components/ContentReplacementDefineStep.tsx` and `.test.tsx`: mappings, CSV import, scope, advanced options, and rule checkpoint.
- Create `src/components/ContentReplacementScanStep.tsx` and `.test.tsx`: scan progress, backoff, pause, resume, cancel, and blocking errors.
- Create `src/components/ContentReplacementReviewStep.tsx` and `.test.tsx`: paginated filters, bounded optional detail, exclusions, and preview export.
- Create `src/components/ContentReplacementApplyStep.tsx` and `.test.tsx`: typed confirmation, apply/results, exceptions, result exports, and recovery controls.
- Create `src/components/ContentReplacementJobManager.tsx` and `.test.tsx`: list and delete sensitive browser-local replacement jobs from the wizard and Datasets area.
- Create `src/utils/contentReplacementDownloads.ts` and `.test.ts`: deterministic CSV templates, preview, results, and exception exports.
- Modify `src/components/WriteToolsCatalog.tsx`, `src/components/DatasetsPanel.tsx`, `src/components/DatasetsPanel.test.tsx`, `src/App.tsx`, `src/components/AppShell.test.tsx`, `src/components/CredentialsPanel.test.tsx`, and `src/styles/app.css`: register, manage, and polish the full-page wizard.
- Create `e2e/content-replacement-wizard.spec.ts`: mocked end-to-end Define → Scan → Review → Apply coverage.
- Modify `README.md`: document supported fields, browser-open behavior, safeguards, recovery, and live-canary procedure.

## Task 1: Define Replacement Rules and CSV Contracts

**Files:**
- Create: `src/writeTools/contentReplacement/types.ts`
- Create: `src/writeTools/contentReplacement/rules.ts`
- Create: `src/writeTools/contentReplacement/rules.test.ts`

- [ ] **Step 1: Write failing rule and CSV tests**

Create tests covering literal defaults, trimming only empty-row padding rather than meaningful term whitespace, identical duplicate deduplication, conflict reporting, and CSV row numbers:

```ts
import { describe, expect, it } from "vitest";
import {
  createDefaultReplacementConfiguration,
  parseReplacementCsv,
  validateReplacementRules,
} from "./rules";

describe("content replacement rules", () => {
  it("uses the safe matching defaults", () => {
    expect(createDefaultReplacementConfiguration()).toMatchObject({
      contentTypes: { questions: true, answers: true, articles: true },
      options: {
        caseSensitive: true,
        wholeTerm: true,
        replaceInCode: false,
      },
      target: { kind: "enterprise-main" },
    });
  });

  it("deduplicates identical rows and blocks ambiguous simultaneous rules", () => {
    const result = validateReplacementRules(
      [
        { id: "1", find: "MyPVM", replace: "MyPBM" },
        { id: "2", find: "MyPVM", replace: "MyPBM" },
        { id: "3", find: "MyPBM", replace: "myBenefits" },
        { id: "4", find: "PVM", replace: "PBM" },
      ],
      { caseSensitive: true, wholeTerm: true, replaceInCode: false },
    );

    expect(result.rules).toHaveLength(3);
    expect(result.notices).toContain('Removed duplicate rule "MyPVM" → "MyPBM".');
    expect(result.errors.map((error) => error.code)).toEqual([
      "replacement-is-source",
      "overlapping-sources",
    ]);
  });

  it("parses the canonical CSV and retains invalid rows for correction", () => {
    expect(parseReplacementCsv("find,replace\nMyPVM,MyPBM\nCPR,")).toEqual({
      rows: [
        { id: "csv-2", sourceRow: 2, find: "MyPVM", replace: "MyPBM" },
        { id: "csv-3", sourceRow: 3, find: "CPR", replace: "" },
      ],
      fileErrors: [],
    });
  });
});
```

- [ ] **Step 2: Run the focused test and confirm the missing-module failure**

Run: `pnpm test -- src/writeTools/contentReplacement/rules.test.ts`

Expected: FAIL because `./rules` does not exist.

- [ ] **Step 3: Add the public types and validation contracts**

Define these exact public shapes in `types.ts`:

```ts
export type ReplacementContentKind = "question" | "answer" | "article";
export type ReplacementItemRef =
  | { kind: "question"; questionId: number }
  | { kind: "answer"; questionId: number; answerId: number }
  | { kind: "article"; articleId: number };

export interface ReplacementRule {
  id: string;
  find: string;
  replace: string;
  sourceRow?: number;
}

export interface ReplacementOptions {
  caseSensitive: boolean;
  wholeTerm: boolean;
  replaceInCode: boolean;
}

export interface ReplacementConfiguration {
  target: { kind: "enterprise-main" };
  contentTypes: { questions: boolean; answers: boolean; articles: boolean };
  rules: ReplacementRule[];
  options: ReplacementOptions;
}

export type ReplacementRuleErrorCode =
  | "blank-source"
  | "blank-replacement"
  | "no-op"
  | "duplicate-source"
  | "replacement-is-source"
  | "overlapping-sources";
```

In `rules.ts`, export `MAX_REPLACEMENT_RULES = 500`, `MAX_FIND_LENGTH = 200`, `MAX_REPLACEMENT_LENGTH = 500`, `createDefaultReplacementConfiguration`, `parseReplacementCsv`, `validateReplacementRules`, and `createReplacementCsvTemplate`. Validate headers as exactly `find,replace` after BOM removal and surrounding header whitespace normalization. Treat case-insensitive comparisons with `toLocaleLowerCase("en-US")`. Block any source contained by another normalized source as a conservative overlap. Do not silently drop invalid CSV rows.

- [ ] **Step 4: Run the rule tests and type checker**

Run: `pnpm test -- src/writeTools/contentReplacement/rules.test.ts && pnpm lint`

Expected: PASS.

- [ ] **Step 5: Commit the rule domain**

```bash
git add src/writeTools/contentReplacement/types.ts src/writeTools/contentReplacement/rules.ts src/writeTools/contentReplacement/rules.test.ts
git commit -m "feat: define content replacement rules"
```

## Task 2: Implement Markdown-Safe Simultaneous Replacement

**Files:**
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Create: `src/writeTools/contentReplacement/markdown.ts`
- Create: `src/writeTools/contentReplacement/markdown.test.ts`

- [ ] **Step 1: Write failing transformer tests**

Cover headings, emphasis, list items, blockquotes, GFM tables, explicit link labels, fenced/indented/inline code, link/image destinations, autolinks, raw HTML, Unicode term boundaries, case-insensitive mode, and non-cascading mappings:

```ts
import { describe, expect, it } from "vitest";
import { replaceMarkdown } from "./markdown";

const rules = [{ id: "rule-1", find: "MyPVM", replace: "MyPBM" }];
const safe = { caseSensitive: true, wholeTerm: true, replaceInCode: false };

describe("replaceMarkdown", () => {
  it("changes visible Markdown text while preserving protected destinations and code", () => {
    const source = [
      "# MyPVM guide",
      "",
      "Use **MyPVM** and [MyPVM](https://docs/MyPVM).",
      "",
      "`MyPVM` ![MyPVM](https://img/MyPVM.png) <https://docs/MyPVM>",
      "",
      "| Product |",
      "| --- |",
      "| MyPVM |",
    ].join("\n");

    const result = replaceMarkdown(source, rules, safe);

    expect(result.markdown).toContain("# MyPBM guide");
    expect(result.markdown).toContain("**MyPBM** and [MyPBM](https://docs/MyPVM)");
    expect(result.markdown).toContain("`MyPVM` ![MyPVM](https://img/MyPVM.png)");
    expect(result.markdown).toContain("<https://docs/MyPVM>");
    expect(result.markdown).toContain("| MyPBM |");
    expect(result.changedOccurrences).toHaveLength(4);
    expect(result.protectedOccurrences.map((item) => item.reason)).toContain("code");
    expect(result.protectedOccurrences.map((item) => item.reason)).toContain("destination");
  });

  it("applies rules to the original source without cascading", () => {
    const result = replaceMarkdown(
      "MyPVM and PBM",
      [
        { id: "1", find: "MyPVM", replace: "PBM" },
        { id: "2", find: "PBM", replace: "Benefits" },
      ],
      safe,
    );
    expect(result.markdown).toBe("PBM and Benefits");
  });

  it("uses Unicode letters, numbers, and underscore as whole-term boundaries", () => {
    expect(replaceMarkdown("MyPVM MyPVM2 _MyPVM caféMyPVM", rules, safe).markdown).toBe(
      "MyPBM MyPVM2 _MyPVM caféMyPVM",
    );
  });

  it("changes raw HTML text but never an HTML attribute", () => {
    expect(
      replaceMarkdown('<span data-product="MyPVM">MyPVM</span>', rules, safe).markdown,
    ).toBe('<span data-product="MyPVM">MyPBM</span>');
  });
});
```

- [ ] **Step 2: Run the test and confirm failure**

Run: `pnpm test -- src/writeTools/contentReplacement/markdown.test.ts`

Expected: FAIL because `./markdown` does not exist.

- [ ] **Step 3: Install the Markdown parser dependencies**

Run: `pnpm add mdast-util-from-markdown mdast-util-gfm micromark-extension-gfm parse5 && pnpm add -D @types/mdast`

Expected: `package.json` and `pnpm-lock.yaml` contain the five new packages.

- [ ] **Step 4: Implement source-offset transformation**

Export these result types and function:

```ts
export type ProtectedOccurrenceReason = "code" | "destination" | "raw-html-attribute";

export interface ReplacementOccurrence {
  ruleId: string;
  start: number;
  end: number;
  before: string;
  after: string;
}

export interface MarkdownReplacementResult {
  markdown: string;
  changedOccurrences: ReplacementOccurrence[];
  protectedOccurrences: Array<
    Omit<ReplacementOccurrence, "after"> & { reason: ProtectedOccurrenceReason }
  >;
}

export function replaceMarkdown(
  markdown: string,
  rules: readonly ReplacementRule[],
  options: ReplacementOptions,
): MarkdownReplacementResult;
```

Parse with `fromMarkdown` plus GFM extensions. Walk only source-positioned leaf text nodes; descend through explicit `[label](destination)` links but classify autolink text, image nodes, definitions, and destination spans as protected. For raw HTML spans, parse with `parse5` source-location data and transform text-node ranges only; report matching attribute ranges as `raw-html-attribute`. Classify inline, fenced, and indented code as protected unless `replaceInCode` is true. Match literal source slices, reject Unicode `\p{L}`, `\p{N}`, or `_` neighbors for whole-term mode, collect all edits against the original source, then splice in descending offset order. If decoded Markdown or HTML text cannot be mapped exactly to the source slice, leave it unchanged and report it as protected instead of rewriting syntax.

- [ ] **Step 5: Run transformer tests and the full rule-domain tests**

Run: `pnpm test -- src/writeTools/contentReplacement/markdown.test.ts src/writeTools/contentReplacement/rules.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit the transformer**

```bash
git add package.json pnpm-lock.yaml src/writeTools/contentReplacement/markdown.ts src/writeTools/contentReplacement/markdown.test.ts
git commit -m "feat: replace terms safely in Markdown"
```

## Task 3: Build Canonical Request Models, Proposals, and Fingerprints

**Files:**
- Modify: `src/writeTools/contentReplacement/types.ts`
- Create: `src/writeTools/contentReplacement/proposals.ts`
- Create: `src/writeTools/contentReplacement/proposals.test.ts`

- [ ] **Step 1: Write failing canonicalization and proposal tests**

```ts
import { describe, expect, it } from "vitest";
import {
  buildReplacementProposal,
  checksumRequestModel,
  createJobFingerprint,
} from "./proposals";

describe("replacement proposals", () => {
  it("changes only allowed question fields and keeps tag names", async () => {
    const proposal = await buildReplacementProposal(
      {
        kind: "question",
        ref: { kind: "question", questionId: 42 },
        request: { title: "MyPVM setup", body: "Use MyPVM.", tags: ["support", "product"] },
        metadata: { webUrl: "https://demo.stackenterprise.co/questions/42" },
      },
      {
        target: { kind: "enterprise-main" },
        contentTypes: { questions: true, answers: true, articles: true },
        rules: [{ id: "r1", find: "MyPVM", replace: "MyPBM" }],
        options: { caseSensitive: true, wholeTerm: true, replaceInCode: false },
      },
    );

    expect(proposal?.after.request).toEqual({
      title: "MyPBM setup",
      body: "Use MyPBM.",
      tags: ["support", "product"],
    });
    expect(proposal?.changedOccurrences).toHaveLength(2);
  });

  it("includes permissions and expiration in article stale detection", async () => {
    const first = await checksumRequestModel({
      kind: "article",
      ref: { kind: "article", articleId: 7 },
      request: {
        title: "MyPVM",
        body: "MyPVM",
        tags: ["product"],
        type: "policy",
        expirationDate: null,
        permissions: { editableBy: "specificEditors", editorUserIds: [2], editorUserGroupIds: [8] },
      },
    });
    const second = await checksumRequestModel({
      kind: "article",
      ref: { kind: "article", articleId: 7 },
      request: {
        title: "MyPVM",
        body: "MyPVM",
        tags: ["product"],
        type: "policy",
        expirationDate: null,
        permissions: { editableBy: "specificEditors", editorUserIds: [2], editorUserGroupIds: [9] },
      },
    });
    expect(first).not.toBe(second);
  });

  it("fingerprints instance, target, rules, options, and content types", async () => {
    const base = {
      baseUrl: "https://demo.stackenterprise.co",
      configuration: {
        target: { kind: "enterprise-main" as const },
        contentTypes: { questions: true, answers: true, articles: true },
        rules: [{ id: "r1", find: "MyPVM", replace: "MyPBM" }],
        options: { caseSensitive: true, wholeTerm: true, replaceInCode: false },
      },
    };
    expect(await createJobFingerprint(base)).not.toBe(
      await createJobFingerprint({
        ...base,
        configuration: { ...base.configuration, options: { ...base.configuration.options, wholeTerm: false } },
      }),
    );
  });
});
```

- [ ] **Step 2: Run the test and confirm failure**

Run: `pnpm test -- src/writeTools/contentReplacement/proposals.test.ts`

Expected: FAIL because `./proposals` does not exist.

- [ ] **Step 3: Add the full request-model and proposal unions**

Add these exact allowed API request shapes to `types.ts`:

```ts
export interface QuestionUpdateRequest { title: string; body: string; tags: string[] }
export interface AnswerUpdateRequest { body: string }
export type ArticleType = "knowledgeArticle" | "announcement" | "policy" | "howToGuide";
export interface ArticlePermissionsRequest {
  editableBy?: "ownerOnly" | "specificEditors" | "everyone";
  editorUserIds: number[];
  editorUserGroupIds: number[];
}
export interface ArticleUpdateRequest {
  title: string;
  body: string;
  tags: string[];
  type: ArticleType;
  expirationDate?: string | null;
  permissions: ArticlePermissionsRequest;
}

export interface ReplacementMetadata {
  titleContext?: string;
  webUrl?: string;
  owner?: { id: number; name?: string };
  lastEditor?: { id: number; name?: string };
  lastActivityDate?: string | null;
}

export type ReplacementRequestModel =
  | { kind: "question"; ref: Extract<ReplacementItemRef, { kind: "question" }>; request: QuestionUpdateRequest; metadata: ReplacementMetadata }
  | { kind: "answer"; ref: Extract<ReplacementItemRef, { kind: "answer" }>; request: AnswerUpdateRequest; metadata: ReplacementMetadata }
  | { kind: "article"; ref: Extract<ReplacementItemRef, { kind: "article" }>; request: ArticleUpdateRequest; metadata: ReplacementMetadata };
```

Define `ReplacementProposal` with `before`, `after`, `scannedRequestChecksum`, `proposedRequestChecksum`, `proposalFingerprint`, field-level before/after Markdown, changed/protected occurrence arrays, applied rule IDs, and metadata.

- [ ] **Step 4: Implement deterministic normalization and SHA-256**

In `proposals.ts`, sort object keys recursively while preserving every request-model array's original order, encode with `TextEncoder`, and hash with `globalThis.crypto.subtle.digest("SHA-256", bytes)`. The proposal must preserve every unchanged request field byte-for-byte, including tag and editor-ID array order. For job/configuration fingerprints only, omit transient rule `id` and `sourceRow` values and sort the semantic `{find,replace}` pairs because validated rules are simultaneous. Export:

```ts
export function stableSerialize(value: unknown): string;
export async function checksumRequestModel(model: ReplacementRequestModel): Promise<string>;
export async function createJobFingerprint(input: {
  baseUrl: string;
  configuration: ReplacementConfiguration;
}): Promise<string>;
export async function buildReplacementProposal(
  model: ReplacementRequestModel,
  configuration: ReplacementConfiguration,
): Promise<ReplacementProposal | null>;
```

Titles use the same literal matcher and whole-term semantics without Markdown parsing. Bodies use `replaceMarkdown`. Proposal fingerprints cover the normalized item identity, configuration, scanned checksum, and proposed request checksum.

- [ ] **Step 5: Run proposal, Markdown, and rule tests**

Run: `pnpm test -- src/writeTools/contentReplacement/proposals.test.ts src/writeTools/contentReplacement/markdown.test.ts src/writeTools/contentReplacement/rules.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit canonical proposals**

```bash
git add src/writeTools/contentReplacement/types.ts src/writeTools/contentReplacement/proposals.ts src/writeTools/contentReplacement/proposals.test.ts
git commit -m "feat: build canonical replacement proposals"
```

## Task 4: Extend the API v3 Client for Bounded Content Operations

**Files:**
- Modify: `src/api/stackApiV3.ts`
- Modify: `src/api/stackApiV3.test.ts`

- [ ] **Step 1: Add failing API client tests**

Add tests proving a caller can fetch exactly page 3, fetch one detail object, PUT one allowlisted request body, notify a `backoff` event before waiting and retrying a 429 PUT, retry a 503 GET, notify throttle headers, stop after three retries, and avoid retrying 400/401/403/409 responses:

```ts
it("fetches one requested page without walking earlier pages", async () => {
  const fetchFn = vi.fn().mockResolvedValue(new Response(JSON.stringify({ items: [{ id: 9 }], totalPages: 5 })));
  const client = createClient({ fetchFn });

  await expect(client.getPage<{ id: number }>("/questions", { pageSize: "100" }, 3)).resolves.toEqual({
    items: [{ id: 9 }],
    page: 3,
    totalPages: 5,
    hasMore: true,
  });
  expect(String(fetchFn.mock.calls[0][0])).toContain("page=3");
});

it("retries an idempotent PUT after Retry-After", async () => {
  const waitFn = vi.fn().mockResolvedValue(undefined);
  const fetchFn = vi.fn()
    .mockResolvedValueOnce(new Response("{}", { status: 429, headers: { "Retry-After": "2" } }))
    .mockResolvedValueOnce(new Response(JSON.stringify({ id: 42 }), { status: 200 }));
  const client = createClient({ fetchFn, waitFn });

  await client.putJson("/questions/42", { title: "MyPBM", body: "Body", tags: [] });
  expect(waitFn).toHaveBeenCalledWith(2);
  expect(fetchFn).toHaveBeenCalledTimes(2);
});
```

- [ ] **Step 2: Run the API client tests and confirm missing methods**

Run: `pnpm test -- src/api/stackApiV3.test.ts`

Expected: FAIL because `getPage`, `getJson`, and `putJson` do not exist.

- [ ] **Step 3: Add bounded public methods and shared retry logic**

Export:

```ts
export interface StackApiV3Page<T> {
  items: T[];
  page: number;
  totalPages: number | null;
  hasMore: boolean;
}
```

Add `getPage<T>(path, query, page)`, `getJson<T>(path)`, and `putJson<T>(path, body)`. Refactor GET and PUT through a private request loop with at most three retries after the first attempt. Retry network errors and status 429/502/503/504, using the maximum server-directed delay from `Retry-After` and throttle headers; use two seconds when no delay is supplied. Invoke `onThrottle({kind:"backoff",seconds})` before every 429 wait, and continue reporting low burst/token-bucket headers on successful responses. Do not add automatic retry to non-idempotent POST or DELETE behavior used by User Group Sync. Keep the pagination safety check on explicit page numbers.

- [ ] **Step 4: Run all API v3 tests**

Run: `pnpm test -- src/api/stackApiV3.test.ts`

Expected: PASS, including all pre-existing user-group tests.

- [ ] **Step 5: Commit the client extension**

```bash
git add src/api/stackApiV3.ts src/api/stackApiV3.test.ts
git commit -m "feat: add bounded API v3 content calls"
```

## Task 5: Reconstruct Exact Question, Answer, and Article PUT Models

**Files:**
- Create: `src/writeTools/contentReplacement/contentApi.ts`
- Create: `src/writeTools/contentReplacement/contentApi.test.ts`

- [ ] **Step 1: Write failing adapter tests**

Test page paths/query parameters, detail paths, PUT paths, response validation, tag-name extraction, owner/edit metadata, article permission conversion, nullable expiration, and rejection of incomplete details:

```ts
it("converts an article detail response into the exact allowed PUT model", async () => {
  const client = fakeClient({
    id: 7,
    title: "MyPVM policy",
    bodyMarkdown: "Use MyPVM.",
    tags: [{ name: "product" }],
    type: "policy",
    expirationDate: null,
    permissions: {
      editableBy: "specificEditors",
      editorUsers: [{ id: 2 }],
      editorUserGroups: [{ id: 8 }],
    },
    owner: { id: 3, name: "Ada" },
    lastActivityDate: "2026-09-01T12:00:00Z",
  });

  await expect(createContentReplacementClient(client).getItem({ kind: "article", articleId: 7 })).resolves.toMatchObject({
    kind: "article",
    request: {
      title: "MyPVM policy",
      body: "Use MyPVM.",
      tags: ["product"],
      type: "policy",
      expirationDate: null,
      permissions: {
        editableBy: "specificEditors",
        editorUserIds: [2],
        editorUserGroupIds: [8],
      },
    },
  });
});
```

- [ ] **Step 2: Run the adapter test and confirm failure**

Run: `pnpm test -- src/writeTools/contentReplacement/contentApi.test.ts`

Expected: FAIL because `./contentApi` does not exist.

- [ ] **Step 3: Implement the typed adapter**

Define `ContentReplacementClient` with:

```ts
export interface ContentReplacementClient {
  getQuestionsPage(page: number): Promise<ContentInventoryPage<QuestionSummary>>;
  getAnswersPage(questionId: number, page: number): Promise<ContentInventoryPage<AnswerSummary>>;
  getArticlesPage(page: number): Promise<ContentInventoryPage<ArticleSummary>>;
  getItem(ref: ReplacementItemRef): Promise<ReplacementRequestModel>;
  updateItem(model: ReplacementRequestModel): Promise<void>;
}
```

Use `pageSize=100`. Reconstruct question requests as `{title, body: bodyMarkdown, tags: tag.name[]}`, answers as `{body: bodyMarkdown}`, and articles with title/body/tags/type/expiration/permission IDs. Reject missing IDs, missing canonical Markdown, missing required request fields, invalid types, or malformed permissions with a sanitized error naming only the content type and ID. Send only the request object to PUT.

- [ ] **Step 4: Run adapter and API client tests**

Run: `pnpm test -- src/writeTools/contentReplacement/contentApi.test.ts src/api/stackApiV3.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit the content adapter**

```bash
git add src/writeTools/contentReplacement/contentApi.ts src/writeTools/contentReplacement/contentApi.test.ts
git commit -m "feat: adapt API v3 editable content"
```

## Task 6: Implement Exhaustive Bounded Scan Operations

**Files:**
- Modify: `src/writeTools/contentReplacement/types.ts`
- Create: `src/writeTools/contentReplacement/scanner.ts`
- Create: `src/writeTools/contentReplacement/scanner.test.ts`

- [ ] **Step 1: Write failing scanner tests**

Test that question inventory always emits answer cursors, unselected questions are still inventoried when answers are selected, HTML text is decoded for conservative filtering, URL attributes do not become proposals, an unknown/malformed summary becomes a candidate rather than a false negative, detail batches reject more than ten refs, and scan failures never claim completion:

```ts
it("enqueues answer inventory for every question and returns the next question page", async () => {
  const result = await scanInventorySlice(fakeContentClient(), {
    cursor: { kind: "questions", page: 1 },
    configuration,
  });

  expect(result.answerCursors).toEqual([
    { kind: "answers", questionId: 10, page: 1 },
    { kind: "answers", questionId: 11, page: 1 },
  ]);
  expect(result.nextCursor).toEqual({ kind: "questions", page: 2 });
});

it("builds proposals only from canonical detail Markdown", async () => {
  const result = await scanDetailBatch(fakeContentClient(), {
    refs: [{ kind: "question", questionId: 10 }],
    configuration,
  });
  expect(result.proposals[0].before.request.body).toBe("Canonical MyPVM Markdown");
  expect(result.proposals[0].after.request.body).toBe("Canonical MyPBM Markdown");
});
```

- [ ] **Step 2: Run the scanner test and confirm failure**

Run: `pnpm test -- src/writeTools/contentReplacement/scanner.test.ts`

Expected: FAIL because `./scanner` does not exist.

- [ ] **Step 3: Add scan cursor and response types**

```ts
export type InventoryCursor =
  | { kind: "questions"; page: number }
  | { kind: "answers"; questionId: number; page: number }
  | { kind: "articles"; page: number };

export interface InventorySliceResult {
  candidates: ReplacementItemRef[];
  answerCursors: Extract<InventoryCursor, { kind: "answers" }>[];
  nextCursor: InventoryCursor | null;
  inspectedCount: number;
  pageKind: InventoryCursor["kind"];
}

export interface DetailBatchResult {
  proposals: ReplacementProposal[];
  inspectedCount: number;
  protectedOccurrenceCount: number;
}
```

- [ ] **Step 4: Implement conservative inventory and canonical detail scanning**

Use `parse5.parseFragment` and traverse every text node for candidate terms. Include title text separately. Candidate filtering may return false positives; malformed or uninspectable HTML must return `true`. Process exactly one cursor per `scanInventorySlice` call. When answers are selected, each question summary produces an answer cursor regardless of `answerCount`. Add a next page cursor only when the API page has `hasMore`. `scanDetailBatch` accepts 1–10 unique refs, fetches with concurrency at most four, builds proposals from detail models, and returns only non-null proposals.

- [ ] **Step 5: Run scanner, proposal, and adapter tests**

Run: `pnpm test -- src/writeTools/contentReplacement/scanner.test.ts src/writeTools/contentReplacement/proposals.test.ts src/writeTools/contentReplacement/contentApi.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit bounded scanning**

```bash
git add src/writeTools/contentReplacement/types.ts src/writeTools/contentReplacement/scanner.ts src/writeTools/contentReplacement/scanner.test.ts
git commit -m "feat: scan editable content exhaustively"
```

## Task 7: Share Enterprise Write-Route Safeguards

**Files:**
- Create: `src/server/enterpriseWriteRequest.ts`
- Create: `src/server/enterpriseWriteRequest.test.ts`
- Modify: `src/server/userGroupSyncApi.ts`
- Modify: `src/server/userGroupSyncApi.test.ts`

- [ ] **Step 1: Write failing shared safeguard tests**

Cover HTTPS `stackenterprise.co` allowlisting, `write_access`, manual Enterprise tokens, OAuth expiry, unknown instance types, whitespace token normalization, secret redaction in nested values, and a 1 MiB route-body limit. Verify a hostname such as `stackenterprise.co.evil.example` is rejected.

```ts
it("returns a normalized write context without exposing credentials", () => {
  const result = prepareEnterpriseWriteContext({
    instanceType: "enterprise",
    baseUrl: "https://demo.stackenterprise.co/",
    accessToken: " token-value ",
    authSource: "manual-enterprise-token",
  });
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error("expected a valid context");
  expect(result.instance.apiV3Url).toBe("https://demo.stackenterprise.co/api/v3");
  expect(result.redact("failed token-value request")).toBe("failed [redacted] request");
});
```

- [ ] **Step 2: Run the safeguard test and confirm failure**

Run: `pnpm test -- src/server/enterpriseWriteRequest.test.ts`

Expected: FAIL because `./enterpriseWriteRequest` does not exist.

- [ ] **Step 3: Implement shared validation, redaction, and bounded JSON parsing**

Export `MAX_WRITE_ROUTE_BYTES = 1_048_576`, `prepareEnterpriseWriteContext`, `redactedJsonResponse`, and `readBoundedJsonRequest`. The success context contains normalized credentials for server-only client construction, the normalized Enterprise instance, and a recursive string redactor. The failure result contains a safe status and message. `readBoundedJsonRequest` reads text once, rejects an oversized body with 413, and returns a generic 400 for invalid JSON.

- [ ] **Step 4: Refactor User Group Sync onto the shared helper**

Replace its local token normalization, instance allowlist, scope validation, and redaction helpers with `prepareEnterpriseWriteContext` and `redactedJsonResponse`. Keep its public payload/response types, status codes, messages, preview comparison, and runner behavior stable.

- [ ] **Step 5: Run shared and User Group Sync tests**

Run: `pnpm test -- src/server/enterpriseWriteRequest.test.ts src/server/userGroupSyncApi.test.ts src/components/UserGroupSyncPanel.test.tsx`

Expected: PASS with no User Group Sync regressions.

- [ ] **Step 6: Commit the shared boundary**

```bash
git add src/server/enterpriseWriteRequest.ts src/server/enterpriseWriteRequest.test.ts src/server/userGroupSyncApi.ts src/server/userGroupSyncApi.test.ts
git commit -m "refactor: share Enterprise write safeguards"
```

## Task 8: Add the Stateless Scan Route

**Files:**
- Create: `src/server/contentReplacementScanApi.ts`
- Create: `src/server/contentReplacementScanApi.test.ts`
- Create: `src/app/api/write-tools/content-replacement/scan/route.ts`

- [ ] **Step 1: Write failing scan-handler tests**

Test exact payload-key validation, credential redaction, server-side rule revalidation, job fingerprint verification, main-target enforcement, page bounds, ten-detail limit, inventory response, detail response, 400/401-safe errors, and sanitized upstream failures:

```ts
it("rejects a client fingerprint that does not match the normalized configuration", async () => {
  const response = await handleContentReplacementScanRequest(
    validScanPayload({ jobFingerprint: "tampered" }),
    { createClient: () => fakeContentClient() },
  );
  expect(response.status).toBe(409);
  await expect(response.json()).resolves.toEqual({
    ok: false,
    error: "Replacement job configuration changed. Start a new scan.",
  });
});
```

- [ ] **Step 2: Run the handler test and confirm failure**

Run: `pnpm test -- src/server/contentReplacementScanApi.test.ts`

Expected: FAIL because `./contentReplacementScanApi` does not exist.

- [ ] **Step 3: Implement the action union and handler**

Use this request union:

```ts
export type ContentReplacementScanPayload = {
  credentials: SessionCredentials;
  configuration: ReplacementConfiguration;
  jobFingerprint: string;
} & (
  | { action: "inventory"; cursor: InventoryCursor }
  | { action: "details"; refs: ReplacementItemRef[] }
);
```

Reject unknown top-level and action-specific keys. Enforce 1–500 validated rules, selected content types, main target, safe integers, page 1–10,000, and unique detail refs of length 1–10. Recompute the job fingerprint from the normalized credential base URL and configuration. Instantiate `StackApiV3Client` only after validation, with an `onThrottle` collector. Return `{ok:true,result,throttleNotices}` from `scanInventorySlice` or `scanDetailBatch`; never return credentials. The browser uses returned notices to pause before the next bounded call, while an exhausted 429 becomes a typed backoff result with its safe retry delay.

- [ ] **Step 4: Add the bounded POST route**

The Node runtime route must call `readBoundedJsonRequest`, return its early response when invalid, and delegate valid JSON to the handler:

```ts
export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  const parsed = await readBoundedJsonRequest(request);
  return parsed.ok ? handleContentReplacementScanRequest(parsed.value) : parsed.response;
}
```

- [ ] **Step 5: Run scan server and domain tests**

Run: `pnpm test -- src/server/contentReplacementScanApi.test.ts src/writeTools/contentReplacement/scanner.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit the scan boundary**

```bash
git add src/server/contentReplacementScanApi.ts src/server/contentReplacementScanApi.test.ts src/app/api/write-tools/content-replacement/scan/route.ts
git commit -m "feat: add bounded content scan route"
```

## Task 9: Add Guarded Apply and Recovery Routes

**Files:**
- Create: `src/server/contentReplacementApplyApi.ts`
- Create: `src/server/contentReplacementApplyApi.test.ts`
- Create: `src/server/contentReplacementRecoveryApi.ts`
- Create: `src/server/contentReplacementRecoveryApi.test.ts`
- Create: `src/app/api/write-tools/content-replacement/apply/route.ts`
- Create: `src/app/api/write-tools/content-replacement/recover/route.ts`

- [ ] **Step 1: Write failing apply tests**

Cover exact payload validation, before-checksum match, stale required-field changes, recomputed proposal mismatch, one PUT, post-write detail checksum, retry-after-lost-response idempotency, and item-level permission/validation/network categorization:

```ts
it("does not write when a required field changed after review", async () => {
  const client = fakeContentClientWithCurrent(changedTagsQuestion);
  const response = await handleContentReplacementApplyRequest(validApplyPayload(), {
    createClient: () => client,
  });
  expect(response.status).toBe(200);
  await expect(response.json()).resolves.toMatchObject({ ok: true, result: { status: "stale" } });
  expect(client.updateItem).not.toHaveBeenCalled();
});

it("treats an already-proposed current checksum as an idempotent success", async () => {
  const client = fakeContentClientWithCurrent(proposedQuestion);
  const response = await handleContentReplacementApplyRequest(validApplyPayload(), {
    createClient: () => client,
  });
  await expect(response.json()).resolves.toMatchObject({
    ok: true,
    result: { status: "already-applied" },
  });
  expect(client.updateItem).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run apply tests and confirm failure**

Run: `pnpm test -- src/server/contentReplacementApplyApi.test.ts`

Expected: FAIL because `./contentReplacementApplyApi` does not exist.

- [ ] **Step 3: Implement guarded apply**

Use an exact payload containing credentials, configuration, job fingerprint, item ref, `expectedScannedRequestChecksum`, `expectedProposedRequestChecksum`, and `expectedProposalFingerprint`. Recompute the job fingerprint. Fetch the current full request model and checksum:

1. If current equals the proposed request checksum, return `already-applied` without PUT so a lost prior response can resume safely.
2. If current differs from the scanned checksum, return `stale` without PUT.
3. Rebuild the proposal from current content and require both proposed request checksum and proposal fingerprint to match reviewed values.
4. PUT the server-recomputed `after` request.
5. GET the item again and return its observed post-apply checksum as `updated`.

Map 401/403 to `permission`, upstream 400/422 to `validation`, retry exhaustion/network failures to `network`, and unexpected sanitized failures to `failed`. Return collected throttle notices with the item result so the browser can pause before the next item. Keep item failures as HTTP 200 typed results; reserve 4xx for an invalid browser request.

- [ ] **Step 4: Write failing recovery tests**

Test both recovery actions. `preview` must GET without PUT and return the current/prior normalized request models plus `recoverable`, `already-recovered`, or `conflict`. `apply` restores only an exact allowlisted prior request model when the current checksum equals `expectedPostApplyChecksum`, returns `already-recovered` if current equals the prior request checksum, and returns `conflict` for any third state. Verify no response/request extra fields pass to PUT.

- [ ] **Step 5: Run recovery tests and confirm failure**

Run: `pnpm test -- src/server/contentReplacementRecoveryApi.test.ts`

Expected: FAIL because `./contentReplacementRecoveryApi` does not exist.

- [ ] **Step 6: Implement guarded recovery and both routes**

Use an exact recovery payload containing `action: "preview" | "apply"`, credentials, job fingerprint, item ref, the validated `priorRequestModel`, `expectedPriorRequestChecksum`, and `expectedPostApplyChecksum`. Require the prior model identity to equal the item ref and its checksum to equal `expectedPriorRequestChecksum`. GET current and apply the three-state comparison. For `preview`, return the normalized current and prior models without a PUT. For `apply`, require the recoverable state, PUT only the prior request object, GET again, and return the observed checksum. Return collected throttle notices in both action responses. Add the bounded Node POST route using `readBoundedJsonRequest`.

- [ ] **Step 7: Run all write-boundary tests**

Run: `pnpm test -- src/server/contentReplacementApplyApi.test.ts src/server/contentReplacementRecoveryApi.test.ts src/server/contentReplacementScanApi.test.ts src/server/userGroupSyncApi.test.ts`

Expected: PASS.

- [ ] **Step 8: Commit apply and recovery**

```bash
git add src/server/contentReplacementApplyApi.ts src/server/contentReplacementApplyApi.test.ts src/server/contentReplacementRecoveryApi.ts src/server/contentReplacementRecoveryApi.test.ts src/app/api/write-tools/content-replacement/apply/route.ts src/app/api/write-tools/content-replacement/recover/route.ts
git commit -m "feat: guard content apply and recovery"
```

## Task 10: Persist Credential-Free Job State in IndexedDB

**Files:**
- Modify: `src/writeTools/contentReplacement/types.ts`
- Create: `src/utils/browserContentReplacementStorage.ts`
- Create: `src/utils/browserContentReplacementStorage.test.ts`

- [ ] **Step 1: Write failing persistence tests**

Use the existing project's fake IndexedDB testing pattern. Cover save/load/list/delete, corrupt record rejection, unavailable IndexedDB, failed transactions, thousands of proposals, and exact-schema rejection of forbidden credential keys. Post Markdown is arbitrary content and must remain byte-for-byte intact even when it discusses authorization or bearer tokens.

```ts
it("persists a resumable job without credentials", async () => {
  await saveContentReplacementJob(exampleJob);
  expect(await loadContentReplacementJob(exampleJob.id)).toEqual(exampleJob);
  expect(JSON.stringify(await loadContentReplacementJob(exampleJob.id))).not.toMatch(
    /"accessToken"|"apiKey"|"authorizationHeader"/i,
  );
});
```

- [ ] **Step 2: Run storage tests and confirm failure**

Run: `pnpm test -- src/utils/browserContentReplacementStorage.test.ts`

Expected: FAIL because `./browserContentReplacementStorage` does not exist.

- [ ] **Step 3: Define the versioned job schema**

Define `PersistedContentReplacementJob` with `schemaVersion: 1`, ID, fingerprint, normalized base URL, main target, validated configuration, stage/status, inventory and detail queues, progress counters, proposals keyed by stable item key, selection/exclusion status, per-item attempt/result, recovery record, sanitized failures, and timestamps. A recovery record contains the prior full request model, scanned checksum, proposed checksum, observed post-apply checksum when available, and recovery status.

- [ ] **Step 4: Implement dedicated IndexedDB storage**

Use database `stack-api-content-replacement`, version 1, store `jobs`, and the job ID as key. Export:

```ts
export async function listContentReplacementJobs(): Promise<PersistedContentReplacementJob[]>;
export async function loadContentReplacementJob(id: string): Promise<PersistedContentReplacementJob | null>;
export async function saveContentReplacementJob(job: PersistedContentReplacementJob): Promise<void>;
export async function deleteContentReplacementJob(id: string): Promise<void>;
```

Run every value through an exact parser before save and after load. Never share the dataset database version, preventing version conflicts with `browserDatasetStorage.ts`. Reject any unknown keys in security-sensitive configuration, request-model, checksum, or recovery objects.

- [ ] **Step 5: Run persistence tests**

Run: `pnpm test -- src/utils/browserContentReplacementStorage.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit browser persistence**

```bash
git add src/writeTools/contentReplacement/types.ts src/utils/browserContentReplacementStorage.ts src/utils/browserContentReplacementStorage.test.ts
git commit -m "feat: persist replacement jobs locally"
```

## Task 11: Build the Pure Job State Machine and Browser Coordinator

**Files:**
- Create: `src/writeTools/contentReplacement/jobState.ts`
- Create: `src/writeTools/contentReplacement/jobState.test.ts`
- Create: `src/hooks/useContentReplacementJob.ts`
- Create: `src/hooks/useContentReplacementJob.test.tsx`

- [ ] **Step 1: Write failing state-machine tests**

Cover initial queues for each content-type selection, question→answer queue expansion, detail batches of ten, duplicate candidate suppression, blocking inventory failure, pause/resume, scan completion only when both queues are empty, exclusions and exact selected counts, recovery snapshot creation for every selected post before any apply item becomes eligible, result categorization, eligible-failure retry, stale-item rescan, idempotent already-applied success, and recovery conflict.

```ts
it("cannot enter review until inventory and detail queues are empty", () => {
  const job = createReplacementJob(jobInput);
  expect(canEnterReview(job)).toBe(false);
  const complete = reduceReplacementJob(job, { type: "scan/queues-drained" });
  expect(complete.stage).toBe("review");
});

it("prepares recovery for every selected item before making apply eligible", () => {
  const next = reduceReplacementJob(reviewJob, { type: "apply/prepare-recovery" });
  const selected = Object.values(next.items).filter((item) => item.included);
  expect(selected.map((item) => item.recovery?.priorRequestModel)).toEqual(
    selected.map((item) => item.proposal.before),
  );
  expect(next.recoverySnapshotStatus).toBe("ready");
  expect(selected.every((item) => item.status === "ready-to-apply")).toBe(true);
});
```

- [ ] **Step 2: Run state tests and confirm failure**

Run: `pnpm test -- src/writeTools/contentReplacement/jobState.test.ts`

Expected: FAIL because `./jobState` does not exist.

- [ ] **Step 3: Implement deterministic reducer helpers**

Export `createReplacementJob`, `reduceReplacementJob`, `getNextInventoryCursor`, `getNextDetailBatch`, `getNextApplyItem`, `getNextRecoveryItem`, `canEnterReview`, and `summarizeReplacementJob`. The reducer must be pure and use stable keys `question:{id}`, `answer:{questionId}:{answerId}`, and `article:{id}`.

- [ ] **Step 4: Write failing hook tests**

Mock `fetch` and storage. Prove the hook persists after every scan/apply/recovery response, persists every selected recovery record before the first apply fetch, requests and persists fresh recovery previews before recovery confirmation, sends credentials only in fetch payloads, resumes with newly supplied in-memory credentials, aborts after Pause, warns on unload only while a request is active, converts returned throttle notices into a persisted next-retry timestamp and waits before the next bounded call, stops on storage failure, retries only eligible failures, rescans stale refs through canonical detail calls, deletes local jobs/recovery records on explicit confirmation, and invalidates a job after a fingerprint-changing configuration edit.

- [ ] **Step 5: Run hook tests and confirm failure**

Run: `pnpm test -- src/hooks/useContentReplacementJob.test.tsx`

Expected: FAIL because `./useContentReplacementJob` does not exist.

- [ ] **Step 6: Implement the sequential browser coordinator**

Expose:

```ts
export interface ContentReplacementJobController {
  job: PersistedContentReplacementJob | null;
  busy: boolean;
  storageError: string | null;
  createJob(configuration: ReplacementConfiguration): Promise<void>;
  startScan(): Promise<void>;
  pause(): void;
  resume(): Promise<void>;
  cancel(): Promise<void>;
  deleteJob(): Promise<void>;
  deleteRecoverySnapshots(): Promise<void>;
  setItemIncluded(itemKey: string, included: boolean): Promise<void>;
  prepareApply(): Promise<void>;
  startApply(): Promise<void>;
  retryEligibleFailures(): Promise<void>;
  rescanStaleItems(itemKeys: string[]): Promise<void>;
  prepareRecovery(itemKeys: string[]): Promise<void>;
  startRecovery(itemKeys: string[]): Promise<void>;
}
```

The hook processes one bounded route call at a time, uses an `AbortController`, dispatches a pure transition, awaits IndexedDB persistence, then continues. `prepareApply` builds all selected recovery records and persists the resulting job atomically; `startApply` refuses to fetch until that persisted snapshot is current. `prepareRecovery` calls recovery `preview` sequentially for the selected items and persists the fresh recoverable/conflict models; `startRecovery` refuses items without a current recoverable preview and calls recovery `apply`. It must stop immediately on persistence failure. Credentials are read from the current hook argument at request time and never passed to the reducer or store. Add and remove `beforeunload` only while `busy` is true.

- [ ] **Step 7: Run state and hook tests**

Run: `pnpm test -- src/writeTools/contentReplacement/jobState.test.ts src/hooks/useContentReplacementJob.test.tsx src/utils/browserContentReplacementStorage.test.ts`

Expected: PASS.

- [ ] **Step 8: Commit the coordinator**

```bash
git add src/writeTools/contentReplacement/jobState.ts src/writeTools/contentReplacement/jobState.test.ts src/hooks/useContentReplacementJob.ts src/hooks/useContentReplacementJob.test.tsx
git commit -m "feat: coordinate resumable replacement jobs"
```

## Task 12: Build the Define and Scan Wizard Stages

**Files:**
- Create: `src/components/ContentReplacementWizard.tsx`
- Create: `src/components/ContentReplacementWizard.test.tsx`
- Create: `src/components/ContentReplacementDefineStep.tsx`
- Create: `src/components/ContentReplacementDefineStep.test.tsx`
- Create: `src/components/ContentReplacementScanStep.tsx`
- Create: `src/components/ContentReplacementScanStep.test.tsx`

- [ ] **Step 1: Write failing Define-stage interaction tests**

Test accessible Find/Replace labels, add/remove/reorder, default scope/options, collapsed Advanced section, case/partial/code warnings, per-row validation, identical duplicate notice, CSV template download, append/replace import choice, invalid CSV rows remaining visible, `Review rules`, and `Start scan` disabled until confirmation.

```tsx
it("requires a rule-summary checkpoint before scan", async () => {
  render(<ContentReplacementDefineStep {...props} />);
  await user.type(screen.getByLabelText("Find term 1"), "MyPVM");
  await user.type(screen.getByLabelText("Replace term 1 with"), "MyPBM");
  expect(screen.getByRole("button", { name: "Start scan" })).toBeDisabled();
  await user.click(screen.getByRole("button", { name: "Review rules" }));
  expect(screen.getByText("MyPVM → MyPBM")).toBeVisible();
  expect(screen.getByRole("button", { name: "Start scan" })).toBeEnabled();
});
```

- [ ] **Step 2: Run Define tests and confirm failure**

Run: `pnpm test -- src/components/ContentReplacementDefineStep.test.tsx`

Expected: FAIL because the component does not exist.

- [ ] **Step 3: Implement the Define stage**

Render an editable semantic table for mappings, a CSV drop/input control with canonical template download, inline append/replace confirmation, content-type checkboxes, and a disclosure for advanced options. Any edit after the rule checkpoint clears that checkpoint and requires review again. State exactly which contexts remain protected.

- [ ] **Step 4: Write failing Scan-stage tests**

Cover real counters, progress labels, pause/resume, cancellation confirmation, rate-limit next-retry time, credential expiry reconnection message, storage failure, inventory failure blocking, and absence of a Review action until scan completion.

- [ ] **Step 5: Run Scan tests and confirm failure**

Run: `pnpm test -- src/components/ContentReplacementScanStep.test.tsx`

Expected: FAIL because the component does not exist.

- [ ] **Step 6: Implement the Scan stage and wizard shell**

The shell renders a persistent ordered progress indicator with Define, Scan, Review, Apply; current step uses `aria-current="step"`, completed steps include text status, and future steps are not clickable. The Scan stage shows question pages, answer collections, article pages, candidate details, proposals, and protected occurrences. It exposes Pause and Cancel while active and Resume only with valid credentials.

- [ ] **Step 7: Run all new wizard-stage tests**

Run: `pnpm test -- src/components/ContentReplacementWizard.test.tsx src/components/ContentReplacementDefineStep.test.tsx src/components/ContentReplacementScanStep.test.tsx`

Expected: PASS.

- [ ] **Step 8: Commit Define and Scan UI**

```bash
git add src/components/ContentReplacementWizard.tsx src/components/ContentReplacementWizard.test.tsx src/components/ContentReplacementDefineStep.tsx src/components/ContentReplacementDefineStep.test.tsx src/components/ContentReplacementScanStep.tsx src/components/ContentReplacementScanStep.test.tsx
git commit -m "feat: guide replacement definition and scan"
```

## Task 13: Build Detailed Review, Filtering, and Preview Export

**Files:**
- Create: `src/components/ContentReplacementReviewStep.tsx`
- Create: `src/components/ContentReplacementReviewStep.test.tsx`
- Create: `src/utils/contentReplacementDownloads.ts`
- Create: `src/utils/contentReplacementDownloads.test.ts`

- [ ] **Step 1: Write failing deterministic export tests**

Verify template, preview, results, and exception column order; RFC 4180 quoting for multiline Markdown; stable item sorting; visible advanced options; credential exclusion; and protected-reason output.

```ts
it("exports complete preview Markdown without credential fields", () => {
  const csv = createReplacementPreviewCsv([exampleProposal], configuration);
  expect(csv.split("\n")[0]).toBe(
    "contentType,itemId,questionId,title,webUrl,ruleIds,fields,changedOccurrences,protectedOccurrences,beforeTitle,afterTitle,beforeBodyMarkdown,afterBodyMarkdown,caseSensitive,wholeTerm,replaceInCode,selected",
  );
  expect(csv).toContain('"First line\nMyPVM"');
  expect(csv).not.toMatch(/accessToken|apiKey|authorization/i);
});
```

- [ ] **Step 2: Run download tests and confirm failure**

Run: `pnpm test -- src/utils/contentReplacementDownloads.test.ts`

Expected: FAIL because `./contentReplacementDownloads` does not exist.

- [ ] **Step 3: Implement deterministic downloads**

Build on `recordsToCsvWithHeaders` and `downloadTextFile`. Export `downloadReplacementTemplate`, `createReplacementPreviewCsv`, `createReplacementResultsCsv`, and `createReplacementExceptionsCsv`. Preview rows contain the complete before/after title and Markdown body, but exports never contain the raw credential object or recovery secrets.

- [ ] **Step 4: Write failing Review-stage tests**

Cover 50-row pagination, content/rule/field/status/free-text filters, group exclusion, exact selected post/occurrence summary, up to three expanded rows, complete before/after fields, changed highlights, protected reasons, owner/edit metadata, complete normalized API request, exclude-from-detail, preview download, and keyboard/ARIA operation.

```tsx
it("optionally expands a full proposal and keeps the reviewed payload visible", async () => {
  render(<ContentReplacementReviewStep {...propsWithQuestionProposal} />);
  await user.click(screen.getByRole("button", { name: "View details for question 42" }));
  expect(screen.getByRole("region", { name: "Question 42 proposed changes" })).toHaveTextContent(
    "Use MyPVM. Use MyPBM.",
  );
  expect(screen.getByText('"tags": [')).toBeVisible();
  expect(screen.getByText("Link destination — unchanged")).toBeVisible();
});
```

- [ ] **Step 5: Run Review tests and confirm failure**

Run: `pnpm test -- src/components/ContentReplacementReviewStep.test.tsx`

Expected: FAIL because the component does not exist.

- [ ] **Step 6: Implement the paginated Review stage**

Use a semantic table with sticky headings and a separate inline detail row. Keep an LRU list of at most three expanded item keys. Highlight changed source/target spans from recorded offsets without `dangerouslySetInnerHTML`. Show protected occurrences by reason, the normalized `after.request` JSON, and selection controls. Filters operate locally over persisted proposals and reset to page 1. The Continue action displays exact selected posts and changed occurrences.

- [ ] **Step 7: Run Review and download tests**

Run: `pnpm test -- src/components/ContentReplacementReviewStep.test.tsx src/utils/contentReplacementDownloads.test.ts`

Expected: PASS.

- [ ] **Step 8: Commit Review UI and exports**

```bash
git add src/components/ContentReplacementReviewStep.tsx src/components/ContentReplacementReviewStep.test.tsx src/utils/contentReplacementDownloads.ts src/utils/contentReplacementDownloads.test.ts
git commit -m "feat: review and export replacement proposals"
```

## Task 14: Build Typed Confirmation, Results, and Recovery UI

**Files:**
- Create: `src/components/ContentReplacementApplyStep.tsx`
- Create: `src/components/ContentReplacementApplyStep.test.tsx`
- Modify: `src/components/ContentReplacementWizard.tsx`
- Modify: `src/components/ContentReplacementWizard.test.tsx`

- [ ] **Step 1: Write failing Apply-stage tests**

Cover acknowledgement checkbox, exact uppercase `APPLY`, disabled action until both checks and the persisted recovery snapshot pass, selected post/occurrence counts, remaining race disclosure, live progress, safe pause, updated/already-applied/excluded/stale/permission/validation/network/protected summaries, exceptions/results downloads, eligible-failure retry, stale-item rescan, recovery selection and preview, recovery typed confirmation, conflicts, local job/recovery deletion, and no automatic navigation away.

```tsx
it("requires explicit acknowledgement and APPLY before writes", async () => {
  render(<ContentReplacementApplyStep {...readyProps} />);
  const apply = screen.getByRole("button", { name: "Apply changes to 3 posts" });
  expect(apply).toBeDisabled();
  await user.click(screen.getByLabelText(/I understand these edits use the live Enterprise API/));
  await user.type(screen.getByLabelText("Type APPLY to confirm"), "APPLY");
  expect(apply).toBeEnabled();
  await user.click(apply);
  expect(readyProps.onApply).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 2: Run Apply tests and confirm failure**

Run: `pnpm test -- src/components/ContentReplacementApplyStep.test.tsx`

Expected: FAIL because the component does not exist.

- [ ] **Step 3: Implement confirmation, results, and recovery**

Show the exact instance hostname, content types, rule summary, selected post count, changed occurrence count, protected count, recovery-snapshot readiness, and concurrency-race warning immediately above confirmation. Clear the typed confirmation whenever selection or configuration changes. During apply, display the current item and completed count; never claim rollback for failed/stale items. Results use separate counts and filterable rows, with `Retry eligible failures` and `Rescan stale posts` actions limited to applicable rows. Recovery is offered only for items with observed successful post-apply checksums. Before recovery confirmation, show a dedicated preview of every selected current replacement state and the prior full request model that will be restored; then require a second acknowledgement plus exact `RECOVER` typing. Label jobs as sensitive browser-local content and provide separate confirmed actions to delete only recovery snapshots or delete the entire job. Downloaded files are one-shot exports and are not retained by the app.

- [ ] **Step 4: Wire Review and Apply stages into the shell**

Route persisted stage/status to the correct screen. Back navigation from Review to Define must warn that any configuration edit invalidates the scan; a confirmed edit creates a new job rather than mutating reviewed proposals. Once apply begins, the reviewed configuration and proposals are immutable.

- [ ] **Step 5: Run the complete wizard component suite**

Run: `pnpm test -- src/components/ContentReplacementWizard.test.tsx src/components/ContentReplacementDefineStep.test.tsx src/components/ContentReplacementScanStep.test.tsx src/components/ContentReplacementReviewStep.test.tsx src/components/ContentReplacementApplyStep.test.tsx`

Expected: PASS.

- [ ] **Step 6: Commit Apply and recovery UI**

```bash
git add src/components/ContentReplacementApplyStep.tsx src/components/ContentReplacementApplyStep.test.tsx src/components/ContentReplacementWizard.tsx src/components/ContentReplacementWizard.test.tsx
git commit -m "feat: confirm and recover content replacements"
```

## Task 15: Register and Polish the Impeccable Full-Page Experience

**Files:**
- Create: `src/components/ContentReplacementJobManager.tsx`
- Create: `src/components/ContentReplacementJobManager.test.tsx`
- Modify: `src/components/ContentReplacementDefineStep.tsx`
- Modify: `src/components/ContentReplacementDefineStep.test.tsx`
- Modify: `src/components/WriteToolsCatalog.tsx`
- Modify: `src/components/DatasetsPanel.tsx`
- Modify: `src/components/DatasetsPanel.test.tsx`
- Modify: `src/App.tsx`
- Modify: `src/components/AppShell.test.tsx`
- Modify: `src/components/CredentialsPanel.test.tsx`
- Modify: `src/styles/app.css`

- [ ] **Step 1: Write failing app-shell and local-job management tests**

Assert that `Content Replacement` appears after `User Group Sync`, declares Enterprise / Preview required / `write_access`, opens the full wizard, receives the in-memory session credentials, and participates in the existing credential workflow without saving credentials locally. In `ContentReplacementJobManager.test.tsx` and `DatasetsPanel.test.tsx`, assert browser-local jobs are labeled as sensitive, resumable jobs can be opened from the wizard, and confirmed deletion removes the job and recovery records from both the wizard and Datasets area.

- [ ] **Step 2: Run shell tests and confirm failure**

Run: `pnpm test -- src/components/AppShell.test.tsx src/components/CredentialsPanel.test.tsx src/components/ContentReplacementJobManager.test.tsx src/components/DatasetsPanel.test.tsx`

Expected: FAIL because `content-replacement` is not a `WriteToolId` and the wizard is not rendered.

- [ ] **Step 3: Register the write tool**

Change the union and add the definition:

```ts
export type WriteToolId = "user-group-sync" | "content-replacement";

{
  id: "content-replacement",
  title: "Content Replacement",
  scope: "Enterprise main site",
  status: "Preview required",
  supportedInstances: ["enterprise"],
  credentialRequirements: ["access-token"],
  oauthScopes: ["write_access"],
}
```

Add the exhaustive `renderWriteToolPanel` switch case returning `<ContentReplacementWizard credentials={credentials} />`.

Create `ContentReplacementJobManager` over `listContentReplacementJobs` and `deleteContentReplacementJob`, render it in the Define stage, and add a `Browser-local replacement jobs` section to `DatasetsPanel`. Deletion requires an inline confirmation and announces completion in a live region. Opening a job from Datasets navigates to Write Tools → Content Replacement without placing its post content into the dataset reducer.

- [ ] **Step 4: Add the approved restrained operations styling**

Use the existing font and light Stack-native palette. Add one wide wizard surface, a quiet border-led stepper, compact editable rows, orange primary action/focus, neutral secondary actions, semantic status colors with text/icons, sticky review headers, readable monospace before/after blocks, and visible focus rings. Avoid gradients, decorative cards around every section, pill-shaped containers, and motion that obscures status. Respect `prefers-reduced-motion`.

At widths below 900px, stack the summary rail and workspace; below 640px, turn mapping rows and review summaries into labeled blocks while keeping actions reachable without horizontal page scrolling. Keep detail code blocks internally scrollable. Verify contrast, 44px touch targets for primary controls, keyboard order, error association, and non-color status cues.

- [ ] **Step 5: Run shell, credential, and wizard tests**

Run: `pnpm test -- src/components/AppShell.test.tsx src/components/CredentialsPanel.test.tsx src/components/DatasetsPanel.test.tsx src/components/ContentReplacementJobManager.test.tsx src/components/ContentReplacementDefineStep.test.tsx src/components/ContentReplacementWizard.test.tsx`

Expected: PASS.

- [ ] **Step 6: Commit registration and visual polish**

```bash
git add src/components/ContentReplacementJobManager.tsx src/components/ContentReplacementJobManager.test.tsx src/components/ContentReplacementDefineStep.tsx src/components/ContentReplacementDefineStep.test.tsx src/components/WriteToolsCatalog.tsx src/components/DatasetsPanel.tsx src/components/DatasetsPanel.test.tsx src/App.tsx src/components/AppShell.test.tsx src/components/CredentialsPanel.test.tsx src/styles/app.css
git commit -m "feat: add content replacement wizard"
```

## Task 16: Add End-to-End Coverage, Documentation, and Large-Fixture Verification

**Files:**
- Create: `e2e/content-replacement-wizard.spec.ts`
- Modify: `README.md`

- [ ] **Step 1: Write the mocked end-to-end happy path and safety path**

Intercept scan/apply/recovery routes with deterministic fixtures. The test must:

1. connect mocked Enterprise credentials through the existing credential screen;
2. select Content Replacement;
3. enter `MyPVM → MyPBM` plus a CSV rule;
4. verify safe defaults and review the rules;
5. scan question, answer, and article slices;
6. inspect a complete before/after detail and normalized request payload;
7. exclude one post and verify exact counts;
8. confirm with `APPLY`;
9. show one updated, one stale, and one protected result;
10. export results; and
11. recover the updated item with `RECOVER`.

- [ ] **Step 2: Run the e2e spec and confirm it fails before fixtures/wiring are complete**

Run: `pnpm e2e -- e2e/content-replacement-wizard.spec.ts`

Expected: FAIL until the route fixtures and selectors in the new test are complete.

- [ ] **Step 3: Complete the e2e route fixtures and assertions**

Assert every mocked apply request contains expected scanned/proposed checksums and fingerprints, never contains a client-authored free-form replacement body outside the reviewed request-model evidence, and never sends more than one item. Assert recovery requests contain only the exact prior request-model union plus checksums.

- [ ] **Step 4: Add a 10,000-item domain fixture test**

Generate 10,000 proposal records in `jobState.test.ts` and verify deterministic batching, selection counts, 50-row review pagination helpers, serialization/parsing, and absence of recursion/stack overflow. Keep the timing assertion generous and non-flaky: the pure reducer and serialization round trip must finish within 10 seconds in Vitest.

- [ ] **Step 5: Document operator behavior and limits**

In `README.md`, document supported fields, canonical CSV headers, safe defaults, protected contexts, Enterprise main-site scope, required `write_access`, browser-open requirement, resumability with credential reconnection, exhaustive pagination, detailed review, full-payload stale checks, remaining read→PUT race, result categories, recovery guard, and credential-free IndexedDB/exports.

- [ ] **Step 6: Run focused e2e and full automated verification**

Run:

```bash
pnpm test
pnpm lint
pnpm build
pnpm e2e -- e2e/content-replacement-wizard.spec.ts
```

Expected: all commands exit 0.

- [ ] **Step 7: Inspect the UI at desktop and mobile widths**

Run `pnpm dev`, then inspect at 1440×1000, 900×900, and 390×844. Verify no page-level horizontal overflow, the stepper remains understandable, mapping inputs retain labels, review detail is optional and bounded, tables/blocks are keyboard reachable, focus is visible, Pause/Cancel are not confused with Apply, and all status meanings survive without color.

- [ ] **Step 8: Commit tests and documentation**

```bash
git add e2e/content-replacement-wizard.spec.ts src/writeTools/contentReplacement/jobState.test.ts README.md
git commit -m "test: verify content replacement workflow"
```

## Task 17: Run the Disposable Demo-Instance Canary

This task requires user-provided demo-instance access and must not be replaced by production testing.

- [ ] **Step 1: Prepare disposable content in the demo instance**

Create one disposable question, one answer to it, and one article. Put `MyPVM` in every supported field. Also include `MyPVM` in inline code, a fenced code block, a link label, a link destination, an image destination, and an article permission set that includes both an editor user and editor group.

- [ ] **Step 2: Scan and review without writing**

Connect OAuth with `write_access`, run the wizard with `MyPVM → MyPBM`, filter to the three disposable IDs, exclude every other proposal, inspect all before/after Markdown and normalized payloads, and export the preview. Verify code and destinations are protected by default and tags/permissions are unchanged.

- [ ] **Step 3: Apply only the three disposable posts**

Confirm with `APPLY`. Verify the question title/body, answer body, and article title/body through both the UI and fresh API GETs. Verify tags, article type, expiration, and article permissions remain unchanged. Record actual throttle headers, retry behavior, edit attribution, and revision behavior in the implementation task notes without recording credentials.

- [ ] **Step 4: Exercise stale and idempotent behavior**

Rescan a disposable item, edit one required field manually before Apply, and verify the wizard marks it stale without PUT. For another disposable item, interrupt the browser response after a successful PUT and resume; verify it becomes `already-applied` without a second PUT.

- [ ] **Step 5: Recover the three successful edits**

Confirm with `RECOVER`, verify the old full request models are restored, and verify a manual post-apply edit produces a recovery conflict instead of being overwritten.

- [ ] **Step 6: Run final regression verification**

Run:

```bash
pnpm test
pnpm lint
pnpm build
```

Expected: all commands exit 0 after any canary-driven fixes.

- [ ] **Step 7: Commit only canary-driven code or documentation corrections**

If the canary required tracked corrections, stage their exact files and commit with:

```bash
git commit -m "fix: harden replacement canary behavior"
```

If no tracked file changed, do not create an empty commit.

## Acceptance Traceability

- Manual and CSV rules: Tasks 1 and 12.
- Simultaneous exact matching and Markdown protection: Tasks 2 and 3.
- Questions, answers, and articles with complete PUT models: Tasks 5 and 9.
- Exhaustive thousands-scale discovery: Tasks 4, 6, 8, 10, 11, and 16.
- Optional full proposal detail and filters: Task 13.
- Browser-open, resumable, credential-free execution: Tasks 10 and 11.
- Stale protection, idempotent resume, result isolation, and recovery: Tasks 9, 11, and 14.
- Impeccable guided full-page design and accessibility: Tasks 12–15.
- Automated and live-instance confidence: Tasks 16 and 17.
