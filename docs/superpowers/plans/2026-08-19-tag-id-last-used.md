# Tag ID and All-Time Last Used Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add stable v3 tag IDs, tag creation dates, and all-time last-used dates to live and imported Tag Health output while preserving period-scoped health metrics.

**Architecture:** Extend the Tag Report plan with v3 tag records and a compact `tagLastUsed` dataset. A focused pure transform derives the newest UTC question/article creation date from unscoped content, the live collector stores that auditable result, and `src/reports/tagReport.ts` joins metadata into the existing normalized Tag Health rows consumed by sessions, tables, dashboards, and CSV exports.

**Tech Stack:** TypeScript 5, React 18, Next.js 14, Vitest, Testing Library, Stack API v2.3 and v3 clients, pnpm.

---

## File structure

- Modify `src/domain/types.ts`: add the `tagLastUsed` dataset name.
- Modify `src/domain/reportRegistry.ts`: add v3 tag metadata and last-used derivation to Tag Report in dependency order.
- Modify `src/domain/reportRegistry.test.ts` and `src/collectors/datasetPlanner.test.ts`: lock the new plan and ordering.
- Modify `src/credentials/credentialRules.test.ts`: verify Enterprise Tag Report now requires both API lanes.
- Modify `src/components/CredentialsPanel.tsx` and `src/components/CredentialsPanel.test.tsx`: keep report OAuth read-only now that Tag Report uses v3.
- Modify `src/components/AppShell.test.tsx`: keep the integrated Tag Report credential flow read-only.
- Modify `src/domain/reportRunPresets.ts` and `src/domain/reportRunPresets.test.ts`: disclose the extra all-time collection.
- Create `src/reports/tagLastUsed.ts`: derive deterministic per-tag last-used rows from already collected records.
- Create `src/reports/tagLastUsed.test.ts`: cover UTC dates, matching, invalid data, and unused tags.
- Modify `src/collectors/liveCollectors.ts` and its tests: collect unscoped questions/articles and emit `tagLastUsed` metadata with merged pagination.
- Modify `src/collectors/liveReportRunner.ts` and its tests: label and warn about capped last-used collection; verify the complete Tag Report request graph.
- Modify `src/reports/tagReport.ts` and `src/reports/reportTransforms.test.ts`: join metadata into normalized Tag Health rows.
- Modify `src/domain/sessionStore.test.ts`: verify curated output retains metadata while raw sources remain stored.
- Modify `src/utils/reportDownloads.test.ts`: lock the updated curated CSV contract.
- Modify `src/test/fixtures/reportFixtures.ts`, `src/importers/reportImporters.ts`, and `src/importers/reportImporters.test.ts`: support updated and legacy upstream CSVs.
- Modify `README.md`: document field semantics and the all-time collection exception.

Tasks 1-3 form one infrastructure TDD batch. Do not commit after Tasks 1 or 2: registering the dataset intentionally makes the live-run expectations red until the collector and runner integration are complete. Task 3 runs the complete test suite and creates the first green implementation commit.

### Task 1: Register the metadata datasets and read-only credential requirements

**Files:**
- Modify: `src/domain/types.ts:33-46`
- Modify: `src/domain/reportRegistry.ts:4-14`
- Modify: `src/domain/reportRegistry.test.ts:4-20`
- Modify: `src/collectors/datasetPlanner.test.ts:6-17`
- Modify: `src/credentials/credentialRules.test.ts:89-189`
- Modify: `src/components/CredentialsPanel.tsx:65-75`
- Modify: `src/components/CredentialsPanel.test.tsx:125-177`
- Modify: `src/components/AppShell.test.tsx:112-139`
- Modify: `src/domain/reportRunPresets.ts:67-73`
- Modify: `src/domain/reportRunPresets.test.ts:39-43`

- [ ] **Step 1: Write failing plan, credential, OAuth-scope, and disclosure tests**

Add this registry test:

```ts
it("orders Tag Report metadata before all-time last-used derivation", () => {
  const tagReport = reportRegistry.find((report) => report.id === "tag-report");

  expect(tagReport?.requiredDatasets).toEqual([
    "tags",
    "users",
    "questions",
    "articles",
    "tagSmes",
    "tagSmeCounts",
    "tagLastUsed",
  ]);
  expect(tagReport!.requiredDatasets.indexOf("tagSmeCounts")).toBeLessThan(
    tagReport!.requiredDatasets.indexOf("tagLastUsed"),
  );
});
```

Replace the shared-plan expectation in `datasetPlanner.test.ts` with:

```ts
expect(planDatasetsForReports(["tag-report", "api-user-report"])).toEqual([
  "tags",
  "users",
  "questions",
  "articles",
  "tagSmes",
  "tagSmeCounts",
  "tagLastUsed",
  "reputationHistory",
  "communities",
]);
```

Add this Enterprise credential test:

```ts
it("requires v3 credentials for Enterprise Tag Report metadata", () => {
  const result = validateCredentialsForReport("tag-report", {
    instanceType: "enterprise",
    baseUrl: "https://demo.stackenterprise.co",
    apiKey: "key",
  }, NOW);

  expect(result.valid).toBe(false);
  expect(result.messages).toContain(CONNECTION_REQUIRED_MESSAGE);
});
```

Replace the default report OAuth test with this read-only expectation:

```ts
it("starts Tag Report Enterprise OAuth without write scopes", async () => {
  const user = userEvent.setup();
  const popup = createPopup();
  vi.spyOn(window, "open").mockReturnValue(popup as unknown as Window);
  const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
    jsonResponse({ ok: true, authorizationUrl: "https://demo.stackenterprise.co/oauth?state=abc" }),
  );

  renderCredentialsPanel();
  await user.selectOptions(screen.getByLabelText("Instance type"), "enterprise");
  await user.type(screen.getByLabelText("Instance URL"), "https://demo.stackenterprise.co");
  await user.type(screen.getByLabelText("OAuth Client ID"), "client-123");
  await user.click(screen.getByRole("button", { name: "Connect with Enterprise OAuth" }));

  await waitFor(() => expect(fetchMock).toHaveBeenCalled());
  expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toMatchObject({ scopes: [] });
});
```

In the `starts Enterprise OAuth with no-expiry opt in` test, change the expected request fields to:

```ts
scopes: [],
includeNoExpiry: true,
```

In the App shell test `restores report credential context after direct Scripts navigation`, change the expected request field to:

```ts
scopes: [],
```

Change the preset disclosure expectation to:

```ts
expect(getReportRunPresetDisclosure("deep-audit")).toBe(
  "Last-used metadata separately requests up to 2,000 all-time questions and 2,000 all-time articles. SME detail is separate: up to 2,000 top-answerer records for each collected tag. Technical settings: pageSize 100, maxPagesPerDataset 20. Slower, but reduces the chance of capped results.",
);
```

- [ ] **Step 2: Run the focused tests and verify the intended failures**

Run:

```bash
pnpm test -- src/domain/reportRegistry.test.ts src/collectors/datasetPlanner.test.ts src/credentials/credentialRules.test.ts src/components/CredentialsPanel.test.tsx src/components/AppShell.test.tsx src/domain/reportRunPresets.test.ts
```

Expected: FAIL because `tagLastUsed` is not a `DatasetName`, Tag Report does not plan v3 metadata, report OAuth still requests `write_access`, and disclosure omits all-time requests.

- [ ] **Step 3: Add the dataset, plan ordering, read-only OAuth scopes, and disclosure**

Add the new union member in `DatasetName`:

```ts
  | "tagSmeCounts"
  | "tagLastUsed"
  | "reputationHistory"
```

Set Tag Report's datasets to:

```ts
requiredDatasets: [
  "tags",
  "users",
  "questions",
  "articles",
  "tagSmes",
  "tagSmeCounts",
  "tagLastUsed",
],
```

Replace the OAuth-scope selection in `CredentialsPanel.tsx` with:

```ts
const oauthScopes = workflow.kind === "write-tool" ? [...writeTool!.oauthScopes] : [];
```

Replace the returned string in `getReportRunPresetDisclosure` with:

```ts
return `Last-used metadata separately requests up to ${formatNumber(
  maxRecords,
)} all-time questions and ${formatNumber(
  maxRecords,
)} all-time articles. SME detail is separate: up to ${formatNumber(
  maxRecords,
)} top-answerer records for each collected tag. Technical settings: pageSize ${preset.pageSize}, maxPagesPerDataset ${preset.maxPagesPerDataset}. ${preset.completenessTradeoff}`;
```

- [ ] **Step 4: Run the focused tests and verify they pass**

Run the command from Step 2.

Expected: PASS for all six test files.

- [ ] **Step 5: Keep the infrastructure batch uncommitted and continue directly to Task 2**

Expected: the focused Task 1 tests are green. The complete suite is not a commit gate until the new planned dataset has its collector and runner expectations in Tasks 2-3.

### Task 2: Derive and collect all-time last-used metadata

**Files:**
- Create: `src/reports/tagLastUsed.ts`
- Create: `src/reports/tagLastUsed.test.ts`
- Modify: `src/collectors/liveCollectors.ts:1-163`
- Modify: `src/collectors/liveCollectors.test.ts:12-37`
- Modify: `src/collectors/datasetPlanner.test.ts:50-158`

- [ ] **Step 1: Write failing pure derivation tests**

Create `src/reports/tagLastUsed.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildTagLastUsedRows } from "./tagLastUsed";

describe("buildTagLastUsedRows", () => {
  it("selects the latest UTC creation date across questions and articles", () => {
    expect(buildTagLastUsedRows(
      [{ name: "Python" }, { name: "unused" }],
      [
        { tags: ["python"], creation_date: 1_704_067_200 },
        { tags: ["PYTHON"], creationDate: "2025-03-04T23:59:59-05:00" },
      ],
    )).toEqual([
      { tagName: "Python", lastUsed: "2025-03-05" },
      { tagName: "unused", lastUsed: "" },
    ]);
  });

  it("joins Unicode and case variants while ignoring unknown tags", () => {
    expect(buildTagLastUsedRows(
      [{ name: "Café" }],
      [
        { tags: ["Cafe\u0301", "CAFÉ"], creation_date: "1767225600" },
        { tags: ["unknown"], creation_date: 1_799_000_000 },
      ],
    )).toEqual([{ tagName: "Café", lastUsed: "2026-01-01" }]);
  });

  it("ignores missing, boolean, non-finite, and out-of-range timestamps", () => {
    expect(buildTagLastUsedRows(
      [{ name: "python" }],
      [
        { tags: ["python"] },
        { tags: ["python"], creation_date: true },
        { tags: ["python"], creation_date: Number.POSITIVE_INFINITY },
        { tags: ["python"], creation_date: 1e20 },
        { tags: ["python"], creation_date: "not-a-date" },
      ],
    )).toEqual([{ tagName: "python", lastUsed: "" }]);
  });
});
```

- [ ] **Step 2: Run the pure tests and verify they fail because the module is missing**

Run:

```bash
pnpm test -- src/reports/tagLastUsed.test.ts
```

Expected: FAIL because `./tagLastUsed` cannot be resolved.

- [ ] **Step 3: Implement the focused derivation module**

Create `src/reports/tagLastUsed.ts`:

```ts
import { readQuestionTags, readTagIdentity } from "../domain/tagNormalization";

export interface TagLastUsedRow {
  tagName: string;
  lastUsed: string;
}

interface TagUseAggregate {
  tagName: string;
  lastUsedMilliseconds: number | null;
}

const CREATION_DATE_ALIASES = ["creation_date", "creationDate"] as const;
const MILLISECOND_THRESHOLD = 1_000_000_000_000;

export function buildTagLastUsedRows(
  tags: readonly Record<string, unknown>[],
  contentRecords: readonly Record<string, unknown>[],
): TagLastUsedRow[] {
  const aggregates = new Map<string, TagUseAggregate>();

  for (const record of tags) {
    const tag = readTagIdentity(record);
    if (tag !== null && !aggregates.has(tag.key)) {
      aggregates.set(tag.key, { tagName: tag.displayName, lastUsedMilliseconds: null });
    }
  }

  for (const record of contentRecords) {
    const createdAt = readCreationMilliseconds(record);
    if (createdAt === null) continue;

    for (const tag of readQuestionTags(record)) {
      const aggregate = aggregates.get(tag.key);
      if (aggregate === undefined) continue;
      if (aggregate.lastUsedMilliseconds === null || createdAt > aggregate.lastUsedMilliseconds) {
        aggregate.lastUsedMilliseconds = createdAt;
      }
    }
  }

  return [...aggregates.values()].map(({ tagName, lastUsedMilliseconds }) => ({
    tagName,
    lastUsed: lastUsedMilliseconds === null
      ? ""
      : new Date(lastUsedMilliseconds).toISOString().slice(0, 10),
  }));
}

function readCreationMilliseconds(record: Record<string, unknown>): number | null {
  for (const alias of CREATION_DATE_ALIASES) {
    const milliseconds = normalizeTimestamp(record[alias]);
    if (milliseconds !== null) return milliseconds;
  }
  return null;
}

function normalizeTimestamp(value: unknown): number | null {
  if (typeof value === "boolean" || value === null || value === undefined) return null;

  let milliseconds: number;
  if (typeof value === "number") {
    milliseconds = value > MILLISECOND_THRESHOLD ? value : value * 1_000;
  } else if (typeof value === "string" && value.trim() !== "") {
    const numericValue = Number(value);
    milliseconds = Number.isFinite(numericValue)
      ? numericValue > MILLISECOND_THRESHOLD
        ? numericValue
        : numericValue * 1_000
      : Date.parse(value);
  } else {
    return null;
  }

  const date = new Date(milliseconds);
  return Number.isFinite(milliseconds) && !Number.isNaN(date.getTime()) ? date.getTime() : null;
}
```

- [ ] **Step 4: Run the pure tests and verify they pass**

Run the command from Step 2.

Expected: PASS with three tests.

- [ ] **Step 5: Write failing collector tests for unscoped queries and merged pagination**

Extend the client-routing test:

```ts
expect(getLiveDatasetClient("tagLastUsed")).toBe("v2");
```

Add this `collectDataset` test in `datasetPlanner.test.ts`:

```ts
it("collects compact last-used rows without applying the report period", async () => {
  const clients = createMockClients();
  clients.v2.getPagedResult.mockImplementation((path: string) => Promise.resolve({
    items: path === "/questions"
      ? [{ tags: ["python"], creation_date: 1_704_067_200 }]
      : [{ tags: ["python"], creation_date: 1_735_689_600 }],
    pageCount: 1,
    reachedMaxPages: path === "/articles",
    hasMore: path === "/articles",
  }));

  await expect(collectDataset("tagLastUsed", clients, {
    collectedDatasets: { tagSmeCounts: [{ id: 42, name: "python" }] },
    scope: { startDate: "2026-07-01", endDate: "2026-07-31" },
    pageSize: 50,
    maxPagesPerDataset: 2,
  })).resolves.toEqual({
    records: [{ tagName: "python", lastUsed: "2025-01-01" }],
    pagination: { pageCount: 2, reachedMaxPages: true, hasMore: true },
  });

  expect(clients.v2.getPagedResult).toHaveBeenCalledWith(
    "/questions",
    { pagesize: "50" },
    { maxPages: 2 },
  );
  expect(clients.v2.getPagedResult).toHaveBeenCalledWith(
    "/articles",
    { pagesize: "50" },
    { maxPages: 2 },
  );
});
```

- [ ] **Step 6: Run the collector tests and verify they fail for unsupported `tagLastUsed`**

Run:

```bash
pnpm test -- src/collectors/liveCollectors.test.ts src/collectors/datasetPlanner.test.ts
```

Expected: FAIL because `tagLastUsed` has no live collector mapping.

- [ ] **Step 7: Implement the dependent collector**

Add the import:

```ts
import { buildTagLastUsedRows } from "../reports/tagLastUsed";
```

Add `tagLastUsed` to the dependent v2 set:

```ts
const dependentLiveDatasets = new Set<DatasetName>([
  "tagSmes",
  "tagLastUsed",
  "reputationHistory",
]);
```

Add this branch in `collectDataset` after `tagSmes`:

```ts
if (dataset === "tagLastUsed") {
  return collectTagLastUsed(clients, getCollectedDataset(context, "tagSmeCounts"), context);
}
```

Add the collector below `collectTagSmes`:

```ts
async function collectTagLastUsed(
  clients: LiveCollectorClients,
  tags: Record<string, unknown>[],
  context: LiveCollectorContext,
): Promise<CollectedDatasetResult> {
  if (tags.length === 0) {
    return { records: [], pagination: createEmptyPaginationMetadata() };
  }

  const query = buildDatasetQuery(context, "v2", false);
  const [questions, articles] = await Promise.all([
    collectPagedResult(clients.v2, "/questions", query, context),
    collectPagedResult(clients.v2, "/articles", query, context),
  ]);
  const contentRecords = [
    ...toRecordList(questions.records),
    ...toRecordList(articles.records),
  ];

  return {
    records: buildTagLastUsedRows(tags, contentRecords),
    pagination: mergePaginationMetadata(questions.pagination, articles.pagination),
  };
}
```

- [ ] **Step 8: Run derivation and collector tests together**

Run:

```bash
pnpm test -- src/reports/tagLastUsed.test.ts src/collectors/liveCollectors.test.ts src/collectors/datasetPlanner.test.ts
```

Expected: PASS.

- [ ] **Step 9: Keep the infrastructure batch uncommitted and continue directly to Task 3**

Expected: derivation and collector tests are green; live-run expectations are completed next.

### Task 3: Integrate metadata collection into live Tag Report runs

**Files:**
- Modify: `src/collectors/liveReportRunner.ts:203-234`
- Modify: `src/collectors/liveReportRunner.test.ts:128-259,342-352`

- [ ] **Step 1: Write failing end-to-end request and warning tests**

Add this request-graph test:

```ts
it("keeps scoped metrics separate from all-time last-used requests", async () => {
  const fetchMock = vi.fn().mockImplementation((input: RequestInfo | URL) => Promise.resolve(
    new Response(JSON.stringify({
      items: itemsForTagReportUrl(input.toString()),
      has_more: false,
      totalPages: 1,
    }), { status: 200 }),
  ));

  const result = await runLiveReport("tag-report", basicCredentials, {
    fetchFn: fetchMock,
    scope: { startDate: "2026-07-01", endDate: "2026-07-31" },
  });
  const urls = fetchMock.mock.calls.map((call) => call[0].toString());
  const questionUrls = urls.filter((url) => url.includes("/questions?"));
  const articleUrls = urls.filter((url) => url.includes("/articles?"));

  expect(questionUrls).toHaveLength(2);
  expect(articleUrls).toHaveLength(2);
  expect(questionUrls.some((url) => url.includes("fromdate=") && url.includes("todate="))).toBe(true);
  expect(questionUrls.some((url) => !url.includes("fromdate=") && !url.includes("todate="))).toBe(true);
  expect(articleUrls.some((url) => url.includes("fromdate=") && url.includes("todate="))).toBe(true);
  expect(articleUrls.some((url) => !url.includes("fromdate=") && !url.includes("todate="))).toBe(true);
  expect(result.datasets.map((dataset) => dataset.datasetName)).toEqual([
    "tags",
    "users",
    "questions",
    "articles",
    "tagSmes",
    "tagSmeCounts",
    "tagLastUsed",
  ]);
});
```

Add this warning test:

```ts
it("warns when all-time tag usage collection is capped", async () => {
  const fetchMock = vi.fn().mockImplementation((input: RequestInfo | URL) => {
    const url = input.toString();
    const isUnscopedUsage =
      (url.includes("/questions?") || url.includes("/articles?")) && !url.includes("fromdate=");
    return Promise.resolve(new Response(JSON.stringify({
      items: itemsForTagReportUrl(url),
      has_more: isUnscopedUsage,
      totalPages: 2,
    }), { status: 200 }));
  });

  const result = await runLiveReport("tag-report", basicCredentials, {
    fetchFn: fetchMock,
    scope: { startDate: "2026-07-01" },
    pageSize: 50,
    maxPagesPerDataset: 1,
    runPreset: "quick-sample",
  });

  expect(result.warnings).toContainEqual({
    reportId: "tag-report",
    code: "dataset-page-cap",
    message: "Tag last used hit the Quick sample page cap (requested up to 50 records per dataset). Use Deep audit or Advanced API volume settings for a more complete run.",
  });
});
```

Update `itemsForTagReportUrl` to express the desired source shapes:

```ts
function itemsForTagReportUrl(url: string): Record<string, unknown>[] {
  if (url.includes("/v3/") && url.includes("/tags?")) {
    return [{ id: 42, name: "python", creationDate: "2014-05-13T00:00:00Z" }];
  }
  if (url.includes("/tags?") && !url.includes("/top-answerers/")) {
    return [{ name: "python" }];
  }
  if (url.includes("/top-answerers/")) {
    return [{ user_id: 1, score: 12 }];
  }
  if (url.includes("/questions?")) {
    return [{ question_id: 1, tags: ["python"], creation_date: 1_735_689_600 }];
  }
  if (url.includes("/articles?")) {
    return [{ article_id: 1, tags: ["python"], creation_date: 1_704_067_200 }];
  }
  return [{ id: 1 }];
}
```

- [ ] **Step 2: Run the focused runner tests and verify the warning-label failure**

Run:

```bash
pnpm test -- src/collectors/liveReportRunner.test.ts
```

Expected: FAIL because the generic camel-case label is `Tag Last Used`, not the approved sentence-case `Tag last used`; existing Tag Report dataset expectations also need the two new datasets.

- [ ] **Step 3: Add the explicit user-facing dataset label and update existing expectations**

Add this entry to `formatDatasetName`:

```ts
tagLastUsed: "Tag last used",
```

Update the existing `runs Tag Report` dataset expectation to the seven-item array shown in Step 1, and assert:

```ts
expect(result.datasets.find((dataset) => dataset.datasetName === "tagSmeCounts")?.records).toEqual([
  { id: 42, name: "python", creationDate: "2014-05-13T00:00:00Z" },
]);
expect(result.datasets.find((dataset) => dataset.datasetName === "tagLastUsed")?.records).toEqual([
  { tagName: "python", lastUsed: "2025-01-01" },
]);
```

In both existing preset-cap Tag Report tests, restrict `isTagsDataset` to the v2 source so the tests continue targeting the original `tags` warning:

```ts
const isTagsDataset = url.includes("/2.3/tags?") && !url.includes("/top-answerers/");
```

- [ ] **Step 4: Run the runner tests and the complete suite, then verify they pass**

Run:

```bash
pnpm test -- src/collectors/liveReportRunner.test.ts
pnpm test
```

Expected: PASS, including existing cap-warning, credentials, App shell, and Tag Report collection tests.

- [ ] **Step 5: Commit live-run integration**

```bash
git add src/domain/types.ts src/domain/reportRegistry.ts src/domain/reportRegistry.test.ts src/collectors/datasetPlanner.test.ts src/credentials/credentialRules.test.ts src/components/CredentialsPanel.tsx src/components/CredentialsPanel.test.tsx src/components/AppShell.test.tsx src/domain/reportRunPresets.ts src/domain/reportRunPresets.test.ts src/reports/tagLastUsed.ts src/reports/tagLastUsed.test.ts src/collectors/liveCollectors.ts src/collectors/liveCollectors.test.ts src/collectors/liveReportRunner.ts src/collectors/liveReportRunner.test.ts
git commit -m "feat: collect Tag Report metadata"
```

### Task 4: Join metadata into normalized Tag Health output

**Files:**
- Modify: `src/reports/tagReport.ts:12-126,163-206,302-319,574-697,758-810`
- Modify: `src/reports/reportTransforms.test.ts:46-128,589-671,739-753`
- Modify: `src/domain/sessionStore.test.ts:288-347`
- Modify: `src/utils/reportDownloads.test.ts:14-89`

- [ ] **Step 1: Write failing transform, session, and CSV contract tests**

Add metadata to the first live-record transform test input:

```ts
{ datasetName: "tagSmeCounts", id: 42, name: "PYTHON", creationDate: "2014-05-13T12:00:00Z" },
{ datasetName: "tagLastUsed", tagName: "python", lastUsed: "2026-08-18" },
```

Add these fields to its exact expected row:

```ts
tag_name: "PYTHON",
tag_id: 42,
tag_creation_date: "2014-05-13",
last_used: "2026-08-18",
```

Add a legacy fallback test:

```ts
it("uses blank metadata for legacy Tag Metric rows", () => {
  expect(buildTagHealthRows([{ tagName: "legacy" }])[0]).toMatchObject({
    tag_name: "legacy",
    tag_id: null,
    tag_creation_date: "",
    last_used: "",
  });
});
```

Add metadata source datasets to the Tag Report action in `sessionStore.test.ts`:

```ts
{
  datasetName: "tagSmeCounts",
  records: [{ id: 42, name: "python", creationDate: "2014-05-13T00:00:00Z" }],
},
{
  datasetName: "tagLastUsed",
  records: [{ tagName: "python", lastUsed: "2026-08-18" }],
},
```

Change the stored dataset count to five and extend the curated output expectation:

```ts
expect.objectContaining({
  tag_name: "python",
  tag_id: 42,
  tag_creation_date: "2014-05-13",
  last_used: "2026-08-18",
  health_status: "Healthy",
  page_views: 400,
  question_count: 1,
  sme_count: 1,
})
```

Change the download header and row expectations to:

```ts
"tag_name,tag_id,tag_creation_date,last_used,health_status,page_views,question_count,answer_count,sme_count,watcher_count,unanswered_questions,median_first_answer_hours,recommended_action"
"python,,,,Needs SME coverage,500,8,11,0,20,1,12,Assign or confirm SMEs for this tag."
```

Use the same updated header in the empty-download expectation and change the loose assertion to:

```ts
expect.stringContaining("tag_name,tag_id,tag_creation_date,last_used,health_status,page_views")
```

- [ ] **Step 2: Run focused tests and verify they fail because normalized rows omit metadata**

Run:

```bash
pnpm test -- src/reports/reportTransforms.test.ts src/domain/sessionStore.test.ts src/utils/reportDownloads.test.ts
```

Expected: FAIL on missing row fields and old CSV headers.

- [ ] **Step 3: Extend the Tag Health model and CSV order**

Add optional source fields to `TagMetricRow`:

```ts
tagId?: number | null;
tagCreationDate?: string;
lastUsed?: string;
```

Add required normalized fields immediately after `tag_name`:

```ts
tag_id: number | null;
tag_creation_date: string;
last_used: string;
```

Add the same keys after `tag_name` in `TAG_HEALTH_CSV_HEADERS`.

Extend `LiveTagAggregate` with:

```ts
tagId: number | null;
tagCreationDate: string;
lastUsed: string;
```

- [ ] **Step 4: Normalize metadata for imported and already-normalized rows**

In `buildTagHealthRows`, read metadata before health classification:

```ts
const tagId = getTagId(row);
const tagCreationDate = getDateText(row, "tagCreationDate", "tag_creation_date", "creationDate");
const lastUsed = getDateText(row, "lastUsed", "last_used");
```

Return those values immediately after `tag_name`.

In `normalizeTagHealthRow`, add defaults before the status fields:

```ts
tag_id: getTagId(row as unknown as Record<string, unknown>),
tag_creation_date: getDateText(
  row as unknown as Record<string, unknown>,
  "tag_creation_date",
  "tagCreationDate",
),
last_used: getDateText(row as unknown as Record<string, unknown>, "last_used", "lastUsed"),
```

Add these helpers beside `getText`:

```ts
function getTagId(record: Record<string, unknown>): number | null {
  const value = readNonNegativeNumber(record, ["tagId", "tag_id", "id"]);
  return value !== null && Number.isSafeInteger(value) ? value : null;
}

function getDateText(record: Record<string, unknown>, ...fieldNames: string[]): string {
  const value = getText(record, ...fieldNames);
  if (value === "") return "";
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) ? new Date(milliseconds).toISOString().slice(0, 10) : "";
}
```

- [ ] **Step 5: Join live v3 and last-used records**

Initialize new aggregate fields:

```ts
tagId: null,
tagCreationDate: "",
lastUsed: "",
```

Before the v2 tag loop, add:

```ts
for (const record of records.filter((candidate) => candidate.datasetName === "tagSmeCounts")) {
  const tag = readTagIdentity(record);
  if (tag === null) continue;
  const aggregate = ensureLiveAggregate(aggregates, tag);
  aggregate.tagId ??= getTagId(record);
  aggregate.tagCreationDate ||= getDateText(record, "creationDate", "tagCreationDate", "tag_creation_date");
}
```

After the v2 tag loop, add:

```ts
for (const record of records.filter((candidate) => candidate.datasetName === "tagLastUsed")) {
  const tag = readTagIdentity(record);
  if (tag === null) continue;
  const lastUsed = getDateText(record, "lastUsed", "last_used");
  const aggregate = ensureLiveAggregate(aggregates, tag);
  if (lastUsed > aggregate.lastUsed) aggregate.lastUsed = lastUsed;
}
```

Pass the metadata into `buildTagHealthRows`:

```ts
tagId: aggregate.tagId,
tagCreationDate: aggregate.tagCreationDate,
lastUsed: aggregate.lastUsed,
```

Add these defaults to the `tagHealthRow` test helper:

```ts
tag_id: null,
tag_creation_date: "",
last_used: "",
```

Convert every direct object passed to `summarizeTagHealthRows` in `reportTransforms.test.ts` to the existing helper so the required metadata defaults are present. For example:

```ts
const summary = summarizeTagHealthRows([
  tagHealthRow({
    tag_name: "python",
    health_status: "Needs response attention",
    page_views: 500,
    question_count: 8,
    answer_count: 11,
    sme_count: 2,
    watcher_count: 20,
    unanswered_questions: 3,
    median_first_answer_hours: 36,
    recommended_action: "Review unanswered questions and response time for this tag.",
  }),
]);
```

- [ ] **Step 6: Run the focused tests and verify they pass**

Run:

```bash
pnpm test -- src/reports/reportTransforms.test.ts src/domain/sessionStore.test.ts src/utils/reportDownloads.test.ts
pnpm lint
```

Expected: PASS with scoped counts unchanged, metadata present, and no TypeScript diagnostics from required `TagHealthRow` fields.

- [ ] **Step 7: Commit the normalized output contract**

```bash
git add src/reports/tagReport.ts src/reports/reportTransforms.test.ts src/domain/sessionStore.test.ts src/utils/reportDownloads.test.ts
git commit -m "feat: add tag metadata to Tag Health output"
```

### Task 5: Import updated upstream CSVs and document the fields

**Files:**
- Modify: `src/test/fixtures/reportFixtures.ts:1-3`
- Modify: `src/importers/reportImporters.ts:29-41`
- Modify: `src/importers/reportImporters.test.ts:1-24`
- Modify: `README.md:5-27`

- [ ] **Step 1: Add an updated upstream fixture and failing compatibility tests**

Keep `tagMetricsCsv` unchanged as the legacy fixture. Add:

```ts
export const tagMetricsWithMetadataCsv = `Tag Name,Tag Id,Tag Creation Date,Last Used,Total Page Views,Webhooks,Tag Watchers,Communities,Total Smes,Median Time To First Answer Hours,Median Time To First Response Hours,Total Unique Contributors,Unique Askers,Unique Answerers,Unique Commenters,Unique Article Contributors,Question Count,Question Upvotes,Question Downvotes,Question Comments,Questions No Answers,Questions Accepted Answer,Questions Self Answered,Answer Count,Sme Answers,Answer Upvotes,Answer Downvotes,Answer Comments,Article Count,Article Upvotes,Article Comments
machine-learning,42,2014-05-13,2026-08-18,551412,22,275,3,15,7.41,4.08,1781,970,763,1014,2,1355,3800,138,1899,222,519,56,1916,2,4426,99,1947,3,6,0`;
```

Import it in `reportImporters.test.ts` and add:

```ts
it("imports updated tag ID and last-used metadata", async () => {
  const result = await importReportFile("tag_metrics.csv", tagMetricsWithMetadataCsv);
  expect(result.records[0]).toMatchObject({
    tagName: "machine-learning",
    tagId: 42,
    tagCreationDate: "2014-05-13",
    lastUsed: "2026-08-18",
  });
});
```

Extend the existing legacy test with:

```ts
expect(result.records[0]).toMatchObject({
  tagId: null,
  tagCreationDate: "",
  lastUsed: "",
});
```

- [ ] **Step 2: Run the importer tests and verify the metadata test fails**

Run:

```bash
pnpm test -- src/importers/reportImporters.test.ts
```

Expected: FAIL because `importTagMetrics` drops the new columns.

- [ ] **Step 3: Preserve optional upstream metadata during import**

Add these fields after `tagName` in `importTagMetrics`:

```ts
tagId: toOptionalTagId(row["Tag Id"]),
tagCreationDate: row["Tag Creation Date"]?.trim() ?? "",
lastUsed: row["Last Used"]?.trim() ?? "",
```

Add this helper below `importTagMetrics`:

```ts
function toOptionalTagId(value: unknown): number | null {
  if (typeof value !== "string" || value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}
```

- [ ] **Step 4: Run importer and download contract tests**

Run:

```bash
pnpm test -- src/importers/reportImporters.test.ts src/utils/reportDownloads.test.ts
pnpm test
```

Expected: PASS for both updated and legacy files, the curated CSV order, and the complete suite.

- [ ] **Step 5: Document semantics and the extra all-time collection**

Add this paragraph after the browser-ready Scripts list in `README.md`:

```md
Tag Report output includes the stable API v3 tag ID, the tag creation date, and
`last_used`. `last_used` is the latest UTC creation date among questions and
articles that currently carry the tag; it is not an assignment, edit, or general
activity date. This field is collected from all fetched history even when the
other Tag Health metrics use a selected current or comparison period. Page-cap
warnings indicate when that all-time value may be incomplete.
```

- [ ] **Step 6: Commit import compatibility and documentation**

```bash
git add src/test/fixtures/reportFixtures.ts src/importers/reportImporters.ts src/importers/reportImporters.test.ts README.md
git commit -m "docs: support updated Tag Report metadata"
```

### Task 6: Full verification

**Files:**
- Verify: all files changed in Tasks 1-5

- [ ] **Step 1: Run all unit and component tests**

```bash
pnpm test
```

Expected: all Vitest suites pass with no unhandled errors or warnings.

- [ ] **Step 2: Run TypeScript validation**

```bash
pnpm lint
```

Expected: both TypeScript projects exit 0 with no diagnostics.

- [ ] **Step 3: Build the production application**

```bash
pnpm build
```

Expected: Next.js production build completes successfully.

- [ ] **Step 4: Check the cumulative diff and repository state**

```bash
git diff --check origin/main...HEAD
git status --short --branch
git log --oneline --decorate origin/main..HEAD
```

Expected: `git diff --check` exits 0; only the approved spec, plan, implementation, tests, and documentation are present; the worktree is clean after the planned commits.

- [ ] **Step 5: Review acceptance criteria against evidence**

Confirm from test output and the final diff that:

- Live Tag Health rows and CSVs contain `tag_id`, `tag_creation_date`, and `last_used`.
- The last-used collector omits period query parameters while scoped metric collectors retain them.
- Cap warnings identify incomplete Tag Last Used collection.
- Legacy upstream CSVs import with blank metadata.
- Updated upstream CSVs preserve all three metadata fields.
- Dashboard calculations and comparison metrics remain unchanged.
- Enterprise Tag Report OAuth remains read-only.
