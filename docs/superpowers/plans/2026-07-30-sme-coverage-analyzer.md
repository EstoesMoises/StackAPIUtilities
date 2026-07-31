# SME Coverage Analyzer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a self-contained, deterministic SME Coverage Analyzer that collects all-time tag demand and current assigned-SME counts, classifies coverage risk, and returns a customer-ready decision pack with traceable evidence.

**Architecture:** A dedicated utility pipeline will collect only v2 tags, v2 all-time questions, and v3 tags; null-preserving source normalizers feed a pure analyzer, deterministic narrative composer, and fixed-schema exporters. The root application will add Utilities as a separate product area, persist the decision pack and supporting datasets browser-locally, and keep credentials in memory only.

**Tech Stack:** TypeScript 5.5, React 18, Next.js 14 App Router, native Fetch/Response/IndexedDB/Clipboard APIs, TanStack React Table 8, Vitest 2, Testing Library, Playwright.

## Global Constraints

- The utility is self-contained, read-only, deterministic, and evidence-based.
- The result is labeled `All-time demand · Current SME coverage`.
- Collect only v2 `/tags`, v2 `/questions` with no date scope, and v3 `/tags`.
- Use only v3 `subjectMatterExpertCount` as assigned-SME coverage; never use v2 top answerers as the denominator.
- Numeric v3 zero is the only value interpreted as zero SMEs; missing, null, malformed, conflicting, capped-unmatched, or absent values are unknown.
- Sum question `view_count` once for each distinct normalized tag on each deduplicated question; never add a tag-level page-view field.
- Normalize tag keys with Unicode NFKC, surrounding-whitespace trim, and locale-independent ECMAScript lowercase; preserve punctuation, hyphens, and interior whitespace.
- Keep unavailable or invalid metrics as `null`; never coerce them to zero in evidence, narrative, or exports.
- Use the existing Deep audit settings by default. Quick, Standard, capped, or custom capped runs must say `partial sample` in every conclusion-bearing output.
- An active tag has at least one question or more than 25 page views.
- Use the conventional active-tag page-view median and nearest-rank P75/P90 thresholds over active covered tags.
- Fewer than four eligible covered active tags suppresses critical, light, and adequate conclusions; covered rows become `Not classified`.
- Calculations and sorting use unrounded values. UI and narrative ratios round to the nearest whole page view with separators.
- The executive summary, findings, assessment, Markdown, and CSV derive from the same canonical evidence rows.
- Interactive evidence search and sorting must not mutate canonical evidence order or exported CSV order.
- Supporting datasets and utility results are browser-local. Credentials, tokens, keys, OAuth metadata, run progress, and request payloads are never persisted or exported.
- Do not add an LLM call, date controls, uploaded-report input, SME identities, write behavior, generic recipe engine, Google document output, or new runtime dependency.

---

## Planned File Structure

### Shared domain and collection seams

- `src/domain/types.ts` — add utility IDs/metadata, API-volume setting values, utility provenance, `tagSmeCounts`, and utility-aware warnings.
- `src/domain/utilityRegistry.ts` — own the one-entry utility catalog and executable lookup.
- `src/domain/tagNormalization.ts` — own canonical tag keys, deterministic display spelling, aliases, and null-preserving numeric/ID readers.
- `src/domain/reportScope.ts` — expose no-date API-volume validation used by both report and utility routes.
- `src/credentials/credentialRules.ts` — add mixed v2/v3 credential validation for utilities.
- `src/collectors/liveCollectorClients.ts` — create authenticated v2/v3 clients for both report and utility runners.
- `src/collectors/liveCollectors.ts` — map `tagSmeCounts` to v3 `/tags`, emit the correct v3 `pageSize`, and retain pagination metadata.

### SME Coverage domain

- `src/utilities/smeCoverage/model.ts` — define source, evidence, analysis, metadata, warning, and decision-pack contracts.
- `src/utilities/smeCoverage/settings.ts` — own the Deep-default utility volume settings and utility-specific preset disclosure.
- `src/utilities/smeCoverage/tagDemand.ts` — normalize/deduplicate v2 tag and question demand without silently repairing bad data.
- `src/utilities/smeCoverage/tagSmeCounts.ts` — normalize/deduplicate authoritative v3 SME counts.
- `src/utilities/smeCoverage/analyzer.ts` — join sources, calculate ratios/thresholds/percentiles, classify tiers, and sort evidence.
- `src/utilities/smeCoverage/narrative.ts` — build only deterministic overview and assessment text from completed analysis.
- `src/utilities/smeCoverage/decisionPack.ts` — compose metadata, completeness, warnings, analysis, and narrative into one immutable result.
- `src/utilities/smeCoverage/exports.ts` — serialize the completed pack to fixed Markdown and evidence CSV.
- `src/utilities/smeCoverage/runner.ts` — collect exactly three sources and produce the server-side run result.
- `src/utilities/smeCoverage/persistence.ts` — strictly parse persisted SME Coverage decision packs.

### Server, state, and browser integration

- `src/server/smeCoverageRunApi.ts` — validate the no-date request and return discriminated validation/collection/unsupported failures.
- `src/app/api/utilities/sme-coverage/run/route.ts` — thin Node.js POST route.
- `src/domain/sessionStore.ts` — select utilities, replace active utility output, and append supporting dataset snapshots.
- `src/domain/datasetPersistence.ts` — migrate v1 snapshots to v2 and round-trip utility state without credentials.
- `src/utils/smeCoverageDownloads.ts` — build stable download descriptors and invoke `downloadTextFile`.

### UI

- `src/components/ApiVolumeSettings.tsx` — reusable preset and Advanced API-volume controls without date fields.
- `src/components/UtilityCatalog.tsx` — accessible utility selection.
- `src/components/SmeCoverageWorkspace.tsx` — pre-run explanation, settings, primary action, progress, and result composition.
- `src/components/SmeCoverageRunProgress.tsx` — truthful aggregate run status plus the ordered utility stages.
- `src/components/SmeCoverageDecisionPack.tsx` — warnings-first snapshot, KPIs, overview, and result actions.
- `src/components/SmeCoverageFindings.tsx` — three ranked finding sections and explicit empty states.
- `src/components/SmeCoverageAssessment.tsx` — prepared assessment plus clipboard feedback.
- `src/components/SmeCoverageMethodology.tsx` — activity, formula, thresholds, sample size, basis, rounding, and caveats.
- `src/components/SmeCoverageEvidenceTable.tsx` — searchable/sortable semantic evidence table with null-last sorting.
- `src/test/fixtures/smeCoverageFixtures.ts` — reusable complete, partial, empty, unknown, and small-sample fixtures.
- `e2e/sme-coverage-analyzer.spec.ts` — mocked self-contained browser workflow.

---

### Task 1: Utility identity, volume defaults, and credential contract

**Files:**
- Create: `src/domain/utilityRegistry.ts`
- Create: `src/domain/utilityRegistry.test.ts`
- Create: `src/utilities/smeCoverage/settings.ts`
- Create: `src/utilities/smeCoverage/settings.test.ts`
- Modify: `src/domain/types.ts:1-152`
- Modify: `src/domain/reportScope.ts:1-65`
- Modify: `src/domain/reportScope.test.ts`
- Modify: `src/credentials/credentialRules.ts:1-162`
- Modify: `src/credentials/credentialRules.test.ts`

**Interfaces:**
- Consumes: existing `ReportRunPresetId`, `REPORT_RUN_PRESETS`, `getReportRunPreset`, `validateEnterpriseV3OAuthCredentials`, and `SessionCredentials`.
- Produces: `UtilityId`, `UtilityMetadata`, `ApiVolumeSettingsValue`, `utilityRegistry`, `getExecutableUtilities()`, `DEFAULT_SME_COVERAGE_SETTINGS`, `applySmeCoveragePreset()`, `validateApiVolumeSettings()`, and `validateCredentialsForUtility()`.

- [ ] **Step 1: Write failing utility registry, default-setting, and credential tests**

Add exact registry assertions:

```ts
expect(getExecutableUtilities()).toEqual([
  expect.objectContaining({
    id: "sme-coverage-analyzer",
    title: "SME Coverage Analyzer",
    scopeLabel: "All-time demand · Current SME coverage",
    mode: "read-only",
    description: "Find tags where knowledge demand is not matched by enough SME coverage.",
    supportedInstances: ["basic-business", "enterprise"],
    credentialRequirements: ["api-key", "access-token"],
    requiredDatasets: ["tags", "questions", "tagSmeCounts"],
  }),
]);
```

Assert the default and preset transition:

```ts
expect(DEFAULT_SME_COVERAGE_SETTINGS).toEqual({
  pageSize: 100,
  maxPagesPerDataset: 20,
  runPreset: "deep-audit",
});

expect(applySmeCoveragePreset(DEFAULT_SME_COVERAGE_SETTINGS, "quick-sample")).toEqual({
  pageSize: 50,
  maxPagesPerDataset: 1,
  runPreset: "quick-sample",
});
```

Add a table-driven credential test with these exact outcomes:

```ts
it.each([
  ["basic PAT", basicCredentials({ pat: "pat" }), true],
  ["basic missing PAT", basicCredentials({}), false],
  ["enterprise mixed credentials", enterpriseCredentials({ apiKey: "key", accessToken: "token" }), true],
  ["enterprise missing API key", enterpriseCredentials({ accessToken: "token" }), false],
  ["enterprise missing v3 token", enterpriseCredentials({ apiKey: "key" }), false],
])("%s", (_label, credentials, valid) => {
  expect(validateCredentialsForUtility("sme-coverage-analyzer", credentials).valid).toBe(valid);
});
```

Also assert `validateApiVolumeSettings({ pageSize: 0, maxPagesPerDataset: 0 })` returns both current validation messages while `validateReportRunScope` retains its date validation.

- [ ] **Step 2: Run focused tests and verify RED**

Run:

```bash
./node_modules/.bin/vitest run \
  src/domain/utilityRegistry.test.ts \
  src/utilities/smeCoverage/settings.test.ts \
  src/credentials/credentialRules.test.ts \
  src/domain/reportScope.test.ts \
  --reporter verbose
```

Expected: FAIL because utility types, metadata, defaults, and utility credential/volume validation do not exist.

- [ ] **Step 3: Add the minimal utility contracts and validation**

Add these domain contracts:

```ts
export type UtilityId = "sme-coverage-analyzer";

export interface ApiVolumeSettingsValue {
  pageSize: number;
  maxPagesPerDataset: number;
  runPreset?: ReportRunPresetId;
}

export interface UtilityMetadata {
  readonly id: UtilityId;
  readonly title: string;
  readonly scopeLabel: string;
  readonly mode: "read-only";
  readonly description: string;
  readonly supportedInstances: readonly InstanceType[];
  readonly credentialRequirements: readonly CredentialRequirement[];
  readonly requiredDatasets: readonly DatasetName[];
}
```

Add `"tagSmeCounts"` to `DatasetName`. Extend `ReportWarning` with
`utilityId?: UtilityId`, but do not yet add it to persistence.
Have `ReportRunScope` extend `ApiVolumeSettingsValue` so report and utility
volume controls share one exact value contract.

Create the registry:

```ts
export const utilityRegistry: readonly UtilityMetadata[] = [
  {
    id: "sme-coverage-analyzer",
    title: "SME Coverage Analyzer",
    scopeLabel: "All-time demand · Current SME coverage",
    mode: "read-only",
    description: "Find tags where knowledge demand is not matched by enough SME coverage.",
    supportedInstances: ["basic-business", "enterprise"],
    credentialRequirements: ["api-key", "access-token"],
    requiredDatasets: ["tags", "questions", "tagSmeCounts"],
  },
];

export function getExecutableUtilities(): readonly UtilityMetadata[] {
  return utilityRegistry;
}
```

Create the Deep-default settings and use `getReportRunPreset()` to apply all
three existing preset limits. Add a utility-specific disclosure that names
tags, questions, and assigned-SME counts and says a cap produces a partial
sample; do not call `getReportRunPresetDisclosure()`, because its top-answerer
copy is report-specific.

Extract `validateApiVolumeSettings()` from `validateReportRunScope()`:

```ts
export function validateApiVolumeSettings(
  settings: Pick<ApiVolumeSettingsValue, "pageSize" | "maxPagesPerDataset">,
): ValidationResult {
  const messages: string[] = [];
  if (!Number.isInteger(settings.pageSize) || settings.pageSize < 1 || settings.pageSize > 100) {
    messages.push("Page size must be between 1 and 100.");
  }
  if (!Number.isInteger(settings.maxPagesPerDataset) || settings.maxPagesPerDataset < 1) {
    messages.push("Max pages per dataset must be at least 1.");
  }
  return { valid: messages.length === 0, messages };
}
```

Have `validateReportRunScope()` start with those messages, then append period
messages. Implement utility credential validation with fixed mixed-lane rules:

```ts
export function validateCredentialsForUtility(
  utilityId: UtilityId,
  credentials: SessionCredentials,
  now: Date = new Date(),
): ValidationResult {
  const utility = utilityRegistry.find((candidate) => candidate.id === utilityId);
  if (!utility) return { valid: false, messages: [`Unknown utility: ${utilityId}`] };

  const messages: string[] = [];
  if (!utility.supportedInstances.includes(credentials.instanceType)) {
    messages.push(`${utility.title} is not available for the selected instance type.`);
  } else if (credentials.instanceType === "basic-business") {
    if (!credentials.pat?.trim()) {
      messages.push("Personal access token is required for Basic/Business API calls.");
    }
  } else {
    if (!credentials.apiKey?.trim()) {
      messages.push("API key is required for Stack API v2.3 Enterprise calls.");
    }
    messages.push(...validateEnterpriseV3OAuthCredentials(credentials, { now }).messages);
  }

  return { valid: messages.length === 0, messages };
}
```

- [ ] **Step 4: Run focused tests and verify GREEN**

Run the Step 2 command. Expected: all utility registry, setting, volume, report
scope, and credential tests pass.

- [ ] **Step 5: Commit Task 1**

```bash
git add src/domain/types.ts src/domain/utilityRegistry.ts src/domain/utilityRegistry.test.ts
git add src/domain/reportScope.ts src/domain/reportScope.test.ts
git add src/credentials/credentialRules.ts src/credentials/credentialRules.test.ts
git add src/utilities/smeCoverage/settings.ts src/utilities/smeCoverage/settings.test.ts
git commit -m "feat: define SME coverage utility contract"
```

---

### Task 2: Shared null-preserving tag normalization

**Files:**
- Create: `src/domain/tagNormalization.ts`
- Create: `src/domain/tagNormalization.test.ts`
- Modify: `src/reports/tagReport.ts:106-120,562-814`
- Modify: `src/reports/reportTransforms.test.ts`

**Interfaces:**
- Consumes: raw v2/v3 records.
- Produces: `normalizeTagIdentity(value)`, `chooseDisplayTagName(values)`, `readTagIdentity(record)`, `readQuestionTags(record)`, `readNonNegativeNumber(record, aliases)`, `readStableQuestionId(record)`, and `compareCodeUnits(left, right)`.

- [ ] **Step 1: Write failing normalization tests**

Use an exact canonicalization matrix:

```ts
expect(normalizeTagIdentity("  Café  ")).toEqual({ key: "café", displayName: "Café" });
expect(normalizeTagIdentity("Ｃ＃")).toEqual({ key: "c#", displayName: "C#" });
expect(normalizeTagIdentity("edge-gateway")).toEqual({
  key: "edge-gateway",
  displayName: "edge-gateway",
});
expect(normalizeTagIdentity("go  code")).toEqual({ key: "go  code", displayName: "go  code" });
expect(normalizeTagIdentity("   ")).toBeNull();
```

Assert distinct per-question tags and deterministic display spelling:

```ts
expect(readQuestionTags({ tags: [" JavaScript ", "javascript", "Café", "Cafe\u0301"] })).toEqual([
  { key: "javascript", displayName: "JavaScript" },
  { key: "café", displayName: "Café" },
]);
expect(chooseDisplayTagName(["python", "Python", " PYTHON "])).toBe("PYTHON");
```

Use default ECMAScript code-unit order in expected values; do not use
`localeCompare()`. Add numeric tests proving finite numeric strings and zero are
accepted while negative, empty, `NaN`, and infinity return `null`. Add stable ID
tests for `question_id`, `questionId`, and `id`.

Extend report transforms with a question containing duplicate/case-variant tags
and assert its views count once for the canonical tag. Preserve the existing
test that explicitly expects Tag Report to add legacy tag-level and question
page views; this task shares parsing, not the utility's no-double-count policy.

- [ ] **Step 2: Run focused tests and verify RED**

Run:

```bash
./node_modules/.bin/vitest run \
  src/domain/tagNormalization.test.ts \
  src/reports/reportTransforms.test.ts \
  --reporter verbose
```

Expected: FAIL because canonical, null-preserving readers and distinct
question-tag handling do not exist.

- [ ] **Step 3: Implement canonical identities and readers**

Use these exact identity rules:

```ts
export function normalizeTagIdentity(value: unknown): NormalizedTagIdentity | null {
  if (typeof value !== "string") return null;
  const displayName = value.normalize("NFKC").trim();
  if (displayName === "") return null;
  return { key: displayName.toLowerCase(), displayName };
}

export function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function chooseDisplayTagName(values: readonly string[]): string | null {
  const names = values
    .map(normalizeTagIdentity)
    .filter((value): value is NormalizedTagIdentity => value !== null)
    .map((value) => value.displayName)
    .sort(compareCodeUnits);
  return names[0] ?? null;
}
```

`readQuestionTags()` must accept `tags`, `tagNames`, `tag_names`, or the
single-name aliases, split string lists on comma/semicolon, deduplicate by key,
and preserve the first normalized spelling within that question. Define alias
constants for question views, tag counts, question IDs, and tag names so later
modules import the same lists.

`readNonNegativeNumber()` accepts only finite values greater than or equal to
zero, including a non-empty numeric string. `readStableQuestionId()` returns a
trimmed string for a non-empty string or finite integer ID and otherwise
returns `null`.

Refactor `buildTagHealthRowsFromLiveRecords()` to use the shared tag and numeric
readers. At the legacy Tag Report boundary, use `readNonNegativeNumber(...) ??
0` so this extraction does not silently redesign existing report outputs.
Key live aggregates by the canonical key and use the lexicographically first
observed display spelling.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run the Step 2 command. Expected: normalization and all existing report
transform tests pass.

- [ ] **Step 5: Commit Task 2**

```bash
git add src/domain/tagNormalization.ts src/domain/tagNormalization.test.ts
git add src/reports/tagReport.ts src/reports/reportTransforms.test.ts
git commit -m "refactor: share tag metric normalization"
```

---

### Task 3: Normalize v2 demand and v3 SME-count sources

**Files:**
- Create: `src/utilities/smeCoverage/model.ts`
- Create: `src/utilities/smeCoverage/tagDemand.ts`
- Create: `src/utilities/smeCoverage/tagDemand.test.ts`
- Create: `src/utilities/smeCoverage/tagSmeCounts.ts`
- Create: `src/utilities/smeCoverage/tagSmeCounts.test.ts`
- Create: `src/test/fixtures/smeCoverageFixtures.ts`

**Interfaces:**
- Consumes: `CollectedSource`, raw v2 tag/question records, raw v3 tag records, and shared tag readers.
- Produces: `normalizeTagDemand() -> NormalizedTagDemandResult` and `normalizeTagSmeCounts() -> NormalizedTagSmeResult`.

- [ ] **Step 1: Define failing source-normalization fixtures and tests**

Create a complete fixture with these source facts:

```ts
export const completeRawSources = {
  tags: collected([
    { name: "piper", count: 8 },
    { name: "kafka", count: 6 },
    { name: "timeout", count: 2 },
  ]),
  questions: collected([
    { question_id: 1, tags: ["piper", "piper"], view_count: 500 },
    { question_id: 2, tags: ["piper", "kafka"], view_count: 300 },
    { question_id: 3, tags: ["timeout"], view_count: 80 },
  ]),
  tagSmeCounts: collected([
    { name: "piper", subjectMatterExpertCount: 1 },
    { name: "kafka", subjectMatterExpertCount: 2 },
    { name: "timeout", subjectMatterExpertCount: 0 },
  ]),
};
```

`collected(records, pagination?)` must default to:

```ts
{ records, pagination: { pageCount: 1, reachedMaxPages: false, hasMore: false } }
```

Demand tests must assert:

```ts
expect(byTag(result.rows, "piper")).toMatchObject({
  pageViews: 800,
  questionCount: 2,
  questionCountBasis: "Complete question enumeration",
  demandQuality: "Complete",
});
```

Add exact cases for:

- Identical question IDs with identical normalized tags/views count once.
- Conflicting duplicate question tags or views invalidate every named tag and
  exclude that question from totals.
- A missing stable ID or invalid view count invalidates every usable named tag.
- A question contributes once to each distinct canonical tag.
- Tag-level `page_views` is ignored.
- Complete questions override v2 tag `count`, including conflicting duplicate
  tag counts.
- Capped questions use a single trustworthy v2 tag count with basis
  `All-time tag total`.
- Capped questions with no trustworthy tag count use the deduplicated collected
  count with basis `Partial question sample`.
- A conflicting duplicate v2 fallback count is not selected; the capped row
  falls through to `Partial question sample` and adds a conflict warning.
- A v3-only tag is retained by SME normalization and will later receive invalid
  demand rather than an invented zero.
- A non-empty tag record with no usable identity is skipped and emits a
  partial-data warning with the skipped-record count.

SME tests must assert:

```ts
expect(byTag(result.rows, "timeout")).toMatchObject({
  smeCount: 0,
  smeQuality: "Complete",
});
```

Add exact cases proving a numeric-string count is malformed, alongside
missing/null/negative/non-finite counts, identical numeric duplicates,
conflicting numeric duplicates, and a numeric plus unavailable duplicate.
Every malformed or conflicting case yields `smeCount: null`,
`smeQuality: "Unknown"`; counts are never summed or selected.

- [ ] **Step 2: Run focused tests and verify RED**

Run:

```bash
./node_modules/.bin/vitest run \
  src/utilities/smeCoverage/tagDemand.test.ts \
  src/utilities/smeCoverage/tagSmeCounts.test.ts \
  --reporter verbose
```

Expected: FAIL because the model and source normalizers do not exist.

- [ ] **Step 3: Define the exact source and evidence contracts**

Define these unions verbatim:

```ts
export type QuestionCountBasis =
  | "Complete question enumeration"
  | "All-time tag total"
  | "Partial question sample"
  | "Unavailable";

export type DemandQuality = "Complete" | "Partial sample" | "Invalid";
export type SmeQuality = "Complete" | "Unknown";

export type CoverageTier =
  | "Immediate gap"
  | "Critical under-coverage"
  | "Light coverage"
  | "Adequate coverage"
  | "Not classified"
  | "Low-demand uncovered"
  | "Unknown";

export interface SourcePagination {
  pageCount: number;
  reachedMaxPages: boolean;
  hasMore: boolean;
}

export interface CollectedSource {
  records: readonly Record<string, unknown>[];
  pagination: SourcePagination;
}

export interface SmeCoverageSourceStatus {
  tags: SourcePagination;
  questions: SourcePagination;
  tagSmeCounts: SourcePagination;
}
```

Define `NormalizedTagDemandRow`, `NormalizedTagSmeRow`, and the final
`SmeCoverageEvidenceRow` with every field from the approved spec. Use `null`,
not optional numbers, for unavailable page views, question counts, SME counts,
ratios, and percentiles.

- [ ] **Step 4: Implement v2 demand normalization**

Implement `normalizeTagDemand({ tags, questions })` in this order:

1. Gather canonical identities and all normalized spellings from v2 tags.
2. Normalize tag-count candidates without selecting conflicting duplicates.
3. Group questions by stable ID.
4. Collapse identical normalized duplicates.
5. For conflicts, mark the union of all named tag keys invalid and exclude the
   whole question ID.
6. Exclude an ID-less or invalid-view question and mark its usable tags invalid.
7. Add each valid question's views once to each distinct tag and increment the
   deduplicated collected question count.
8. Build the v2 universe from tag records plus question tags.
9. Apply question-count precedence and demand quality.

Use this precedence:

```ts
if (questionsComplete) {
  basis = "Complete question enumeration";
  questionCount = collectedQuestionCount;
} else if (tagCountIsTrustworthy) {
  basis = "All-time tag total";
  questionCount = tagCount;
} else if (collectedQuestionCountIsTrustworthy) {
  basis = "Partial question sample";
  questionCount = collectedQuestionCount;
} else {
  basis = "Unavailable";
  questionCount = null;
}
```

Any affected invalid-question conflict makes `pageViews` and `questionCount`
null and `demandQuality: "Invalid"`. Otherwise capped question pagination makes
`demandQuality: "Partial sample"`; complete question pagination makes it
`"Complete"`. A valid v2 tag with no questions has zero page views and zero
questions when enumeration is complete. Return stable warnings for skipped
identities, duplicate-count conflicts, invalid question records, and affected
tag counts; warnings contain no raw records or credentials.

- [ ] **Step 5: Implement v3 SME-count normalization**

For each canonical v3 tag key, collect all normalized spellings and the exact
`subjectMatterExpertCount` candidate from every record. Accept only a JavaScript
number that is finite and nonnegative. Do not accept a numeric string, a
snake-case alias, or unrelated top-answerer/user fields.

Use:

```ts
const oneUniqueNumericValue =
  candidates.length > 0 &&
  candidates.every((value) => value !== null) &&
  new Set(candidates).size === 1;
```

Only that condition produces `smeQuality: "Complete"` and the numeric value.
A missing record is handled during the later join. Any missing, malformed,
negative, mixed, or conflicting duplicate candidate produces `smeCount: null`
and `smeQuality: "Unknown"`.

- [ ] **Step 6: Run focused tests and verify GREEN**

Run the Step 2 command. Expected: all demand and SME normalization cases pass
with no infinity, silent conflict selection, or zero coercion.

- [ ] **Step 7: Commit Task 3**

```bash
git add src/utilities/smeCoverage/model.ts
git add src/utilities/smeCoverage/tagDemand.ts src/utilities/smeCoverage/tagDemand.test.ts
git add src/utilities/smeCoverage/tagSmeCounts.ts src/utilities/smeCoverage/tagSmeCounts.test.ts
git add src/test/fixtures/smeCoverageFixtures.ts
git commit -m "feat: normalize SME coverage source data"
```

---

### Task 4: Pure ratio, percentile, tier, and ordering analyzer

**Files:**
- Create: `src/utilities/smeCoverage/analyzer.ts`
- Create: `src/utilities/smeCoverage/analyzer.test.ts`
- Modify: `src/utilities/smeCoverage/model.ts`
- Modify: `src/test/fixtures/smeCoverageFixtures.ts`

**Interfaces:**
- Consumes: `NormalizedTagDemandResult`, `NormalizedTagSmeResult`, `SmeCoverageSourceStatus`, and source-level warnings.
- Produces: `analyzeSmeCoverage(input) -> SmeCoverageAnalysisResult` with canonical evidence, summary, methodology, findings, and analysis warnings.

- [ ] **Step 1: Write failing calculation and tier tests**

Create fixture rows that yield these covered active ratios:

```ts
[
  { tagName: "alpha", pageViews: 100, smeCount: 4, ratio: 25 },
  { tagName: "bravo", pageViews: 200, smeCount: 4, ratio: 50 },
  { tagName: "charlie", pageViews: 300, smeCount: 3, ratio: 100 },
  { tagName: "delta", pageViews: 800, smeCount: 2, ratio: 400 },
  { tagName: "echo", pageViews: 1000, smeCount: 1, ratio: 1000 },
]
```

Assert:

```ts
expect(result.methodology.activeTagMedianPageViews).toBe(300);
expect(result.methodology.coveredActiveSampleSize).toBe(5);
expect(result.methodology.p75PageViewsPerSme).toBe(400);
expect(result.methodology.p90PageViewsPerSme).toBe(1000);
expect(evidence(result, "echo")).toMatchObject({
  pageViewsPerSme: 1000,
  coveragePercentile: 100,
  coverageTier: "Critical under-coverage",
});
expect(evidence(result, "delta").coverageTier).toBe("Light coverage");
```

Add focused tests for:

- Odd median `[10, 20, 90] -> 20` and even median `[10, 20, 90, 100] -> 55`.
- Nearest-rank P75/P90 at sample sizes 4, 5, and 10.
- Empirical upper-bound percentile for tied ratios.
- Ratio stored at full precision, with no rounding in analysis.
- Numeric zero producing `pageViewsPerSme: null`, never infinity.
- Active zero-SME rows becoming `Immediate gap`.
- Zero-SME rows with zero questions and at most 25 page views becoming
  `Low-demand uncovered`.
- Demand-invalid, SME-unknown, and both-unknown rows receiving distinct reasons
  and actions.
- A covered tag above P90 but below the active median demand remaining
  `Adequate coverage`.
- Equal P75/P90 values making the qualifying row critical and leaving light
  coverage empty.
- Three eligible covered active tags making every covered row
  `Not classified`; no covered row is adequate.
- Four eligible covered active tags enabling percentile classification.
- Immediate, critical, light, unknown, not-classified, low-demand, and adequate
  canonical tier priority.
- Every numeric tie-breaker, with null values after valid numbers and code-unit
  tag-name order last.
- Stable warning codes/counts for invalid demand, unknown SME coverage, and the
  insufficient covered sample; warnings name tags only when the list remains
  concise and otherwise report the affected-row count.

- [ ] **Step 2: Run analyzer tests and verify RED**

Run:

```bash
./node_modules/.bin/vitest run \
  src/utilities/smeCoverage/analyzer.test.ts \
  --reporter verbose
```

Expected: FAIL because no join, threshold, tier, or ordering analyzer exists.

- [ ] **Step 3: Define completed-analysis types**

Add:

```ts
export interface SmeCoverageEvidenceRow {
  tagName: string;
  pageViews: number | null;
  questionCount: number | null;
  questionCountBasis: QuestionCountBasis;
  smeCount: number | null;
  pageViewsPerSme: number | null;
  coveragePercentile: number | null;
  coverageTier: CoverageTier;
  reason: string;
  recommendedAction: string;
  demandQuality: DemandQuality;
  smeQuality: SmeQuality;
}

export interface SmeCoverageSummary {
  tagsAnalyzed: number;
  tagsWithSmes: number;
  immediateGaps: number;
  criticalUnderCoverage: number;
  lightCoverage: number;
  unknownRows: number;
}

export interface SmeCoverageMethodology {
  activityQuestionMinimum: 1;
  activityPageViewThresholdExclusive: 25;
  activeTagMedianPageViews: number | null;
  coveredActiveSampleSize: number;
  p75PageViewsPerSme: number | null;
  p90PageViewsPerSme: number | null;
  percentileSampleSufficient: boolean;
  ratioFormula: "pageViews / smeCount";
  roundingRule: "Nearest whole page view for display; unrounded for calculation";
}
```

`SmeCoverageAnalysisResult` contains `evidence`, `summary`, `methodology`,
`findings.immediateGaps`, `findings.criticalUnderCoverage`,
`findings.lightCoverage`, `sourceStatus`, and `warnings`. Findings hold
references to rows from the canonical evidence array; they do not rebuild rows.

- [ ] **Step 4: Implement the join and threshold calculations**

Build the evidence universe from the union of demand and SME keys. Select the
display name from every observed spelling with `chooseDisplayTagName()`. A
missing demand row becomes invalid demand; a missing SME row becomes unknown
SME coverage.

Calculate:

```ts
const active = questionCount !== null && pageViews !== null &&
  (questionCount >= 1 || pageViews > 25);
const ratio = smeCount !== null && smeCount >= 1 && pageViews !== null
  ? pageViews / smeCount
  : null;
```

The covered percentile sample contains active rows with valid complete or
partial demand, complete SME quality, and `smeCount >= 1`. The demand median
contains every active row with known page views, regardless of SME coverage.

Use:

```ts
function nearestRank(values: readonly number[], percentile: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const rank = Math.min(sorted.length, Math.max(1, Math.ceil(percentile * sorted.length)));
  return sorted[rank - 1];
}

function conventionalMedian(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}
```

Assign empirical percentile only when the sample has at least four rows:

```ts
coveragePercentile =
  (sampleRatios.filter((candidate) => candidate <= pageViewsPerSme).length /
    sampleRatios.length) *
  100;
```

Summary calculation must count every evidence row as analyzed. `Tags with
SMEs` counts complete SME rows with `smeCount >= 1`, including partial demand.
Unknown rows never increment immediate, critical, or light gap counts.

- [ ] **Step 5: Implement ordered tier rules, reasons, actions, and stable sorting**

Evaluate the seven tier rules in the approved order. Use exact deterministic
reason/action constants:

```ts
const COPY = {
  unknownBoth: {
    reason: "Demand metrics and assigned-SME coverage are unavailable or invalid.",
    action: "Inspect both source lanes before drawing a coverage conclusion.",
  },
  unknownDemand: {
    reason: "Demand metrics are unavailable or invalid.",
    action: "Rerun or inspect the v2 tag/question source.",
  },
  unknownSme: {
    reason: "Assigned-SME coverage is unavailable.",
    action: "Rerun or inspect the v3 tag source.",
  },
  immediate: {
    reason: "Active tag has no assigned SMEs.",
    action: "Assign or confirm at least one SME.",
  },
  lowDemand: {
    reason: "Uncovered tag has no questions and at most 25 page views.",
    action: "Review whether the tag needs ownership or consolidation.",
  },
  notClassified: {
    reason: "Covered-tag sample is too small for relative classification.",
    action: "Review the raw ratio without making a percentile-based coverage conclusion.",
  },
  critical: {
    reason: "Demand meets the active-tag median and the ratio meets or exceeds P90.",
    action: "Expand and validate SME ownership.",
  },
  light: {
    reason: "Demand meets the active-tag median and the ratio is between P75 and P90.",
    action: "Review whether additional SMEs would improve resilience.",
  },
  adequate: {
    reason: "The tag does not meet an under-coverage rule.",
    action: "Maintain current coverage.",
  },
} as const;
```

Use explicit tier priority:

```ts
const TIER_PRIORITY: Record<CoverageTier, number> = {
  "Immediate gap": 0,
  "Critical under-coverage": 1,
  "Light coverage": 2,
  Unknown: 3,
  "Not classified": 4,
  "Low-demand uncovered": 5,
  "Adequate coverage": 6,
};
```

Implement the tier-specific comparators from the specification and finish every
tie with `compareCodeUnits(tagName)`. Sort copies; never mutate normalized
source arrays.

- [ ] **Step 6: Run analyzer tests and verify GREEN**

Run the Step 2 command. Expected: every calculation, evaluation-order, small
sample, equality, null, and ordering test passes.

- [ ] **Step 7: Commit Task 4**

```bash
git add src/utilities/smeCoverage/model.ts
git add src/utilities/smeCoverage/analyzer.ts src/utilities/smeCoverage/analyzer.test.ts
git add src/test/fixtures/smeCoverageFixtures.ts
git commit -m "feat: classify SME coverage evidence"
```

---

### Task 5: Deterministic narrative and decision-pack composition

**Files:**
- Create: `src/utilities/smeCoverage/narrative.ts`
- Create: `src/utilities/smeCoverage/narrative.test.ts`
- Create: `src/utilities/smeCoverage/decisionPack.ts`
- Create: `src/utilities/smeCoverage/decisionPack.test.ts`
- Modify: `src/utilities/smeCoverage/model.ts`
- Modify: `src/test/fixtures/smeCoverageFixtures.ts`

**Interfaces:**
- Consumes: only `SmeCoverageAnalysisResult`, snapshot metadata, and source warnings.
- Produces: `buildSmeCoverageNarrative(analysis)` and `buildSmeCoverageDecisionPack(input) -> SmeCoverageDecisionPack`.

- [ ] **Step 1: Write failing narrative traceability and caveat tests**

For a complete pack, assert every backticked tag and every formatted ratio in
the assessment can be found in the exact evidence rows selected from critical,
immediate, or light findings. Assert no paragraph names more than 10 rows.

Use these mandatory assertions:

```ts
expect(narrative.assessment).toContain("`echo`");
expect(narrative.assessment).toContain("1,000 page views per SME");
expect(narrative.assessment).not.toMatch(/burnout|answer quality|slow response|caused/i);
```

For capped questions:

```ts
expect(narrative.overview).toMatch(/partial sample/i);
expect(narrative.assessment).toMatch(/collected-sample page views/i);
expect(narrative.assessment).not.toMatch(/complete all-time total/i);
```

For a capped tag or v3 source with complete question enumeration, assert the
overview and assessment still say the conclusions cover a collected source
sample; they must not infer partiality only from row-level demand quality.

For three eligible covered rows plus an immediate gap:

```ts
expect(narrative.assessment).toContain(
  "Relative covered-tag risk could not be classified because only 3 eligible covered active tags were available; review the raw ratios.",
);
expect(narrative.overview).not.toMatch(/no priority coverage gaps/i);
```

Add empty-tier, no-risk-with-sufficient-sample, unknown-only, and empty-instance
tests. The no-risk sentence is permitted only when the sample is sufficient.

- [ ] **Step 2: Write failing decision-pack completeness tests**

Assert a composed pack has:

```ts
expect(pack.snapshot).toEqual({
  instanceHost: "example.stackenterprise.co",
  generatedAt: "2026-07-30T12:00:00.000Z",
  scopeLabel: "All-time demand · Current SME coverage",
  completeness: "Complete",
  pageSize: 100,
  maxPagesPerDataset: 20,
  runPreset: "deep-audit",
});
```

Assert any source cap, invalid/unknown row, or insufficient percentile sample
makes completeness `Partial`; zero evidence with successfully empty sources
makes it `Empty`. Warnings are deduplicated by code and message and precede
analysis warnings in stable source order.

- [ ] **Step 3: Run narrative and pack tests and verify RED**

Run:

```bash
./node_modules/.bin/vitest run \
  src/utilities/smeCoverage/narrative.test.ts \
  src/utilities/smeCoverage/decisionPack.test.ts \
  --reporter verbose
```

Expected: FAIL because narrative and pack composition do not exist.

- [ ] **Step 4: Implement deterministic templates**

Export one formatter:

```ts
export function formatDisplayedRatio(value: number): string {
  return Math.round(value).toLocaleString("en-US");
}
```

Use the same formatter in narrative and later UI. Read cap state directly from
`analysis.sourceStatus`; never parse warning text to decide whether conclusions
are partial. Build at most three finding
paragraphs in this order:

1. Critical covered gaps.
2. Immediate no-SME gaps.
3. Light coverage.

Each selection uses `.slice(0, 10)`. A question cap uses `partial sample` and
`collected-sample page views` templates. A tag or v3 cap uses `collected source
sample` language without mislabeling complete page-view enumeration. Append the
insufficient-sample sentence to the last emitted paragraph, or use it as the
only paragraph, so the assessment still has at most three paragraphs.

The overview priority is immediate, critical, then light. If the percentile
sample is insufficient, append the classification limitation regardless of
immediate gaps. Unknown rows appear only in completeness warnings.

- [ ] **Step 5: Compose one immutable decision pack**

Define:

```ts
export type SmeCoverageCompleteness = "Complete" | "Partial" | "Empty";

export interface SmeCoverageDecisionPack {
  snapshot: SmeCoverageSnapshot;
  warnings: readonly ReportWarning[];
  summary: SmeCoverageSummary;
  overview: string;
  assessment: string;
  findings: SmeCoverageAnalysisResult["findings"];
  methodology: SmeCoverageMethodology;
  evidence: readonly SmeCoverageEvidenceRow[];
}
```

`buildSmeCoverageDecisionPack()` calls the narrative builder once, freezes or
copies all returned arrays, and calculates completeness from evidence count,
`analysis.sourceStatus`, row quality, and sample sufficiency. It must not parse
warnings to infer source caps or recalculate a tier, ratio, threshold, finding
list, or summary.

- [ ] **Step 6: Run narrative and pack tests and verify GREEN**

Run the Step 3 command. Expected: all templates, caveats, traceability,
completeness, empty-state, and prohibited-claim tests pass.

- [ ] **Step 7: Commit Task 5**

```bash
git add src/utilities/smeCoverage/model.ts
git add src/utilities/smeCoverage/narrative.ts src/utilities/smeCoverage/narrative.test.ts
git add src/utilities/smeCoverage/decisionPack.ts src/utilities/smeCoverage/decisionPack.test.ts
git add src/test/fixtures/smeCoverageFixtures.ts
git commit -m "feat: compose SME coverage decision pack"
```

---

### Task 6: Fixed Markdown and evidence CSV exports

**Files:**
- Create: `src/utilities/smeCoverage/exports.ts`
- Create: `src/utilities/smeCoverage/exports.test.ts`
- Create: `src/utils/smeCoverageDownloads.ts`
- Create: `src/utils/smeCoverageDownloads.test.ts`
- Modify: `src/utils/downloads.ts`
- Modify: `src/utils/downloads.test.ts`

**Interfaces:**
- Consumes: a completed `SmeCoverageDecisionPack` in canonical evidence order.
- Produces: `buildSmeCoverageMarkdown(pack)`, `buildSmeCoverageEvidenceCsv(pack)`, `buildSmeCoverageMarkdownDownload(pack)`, `buildSmeCoverageCsvDownload(pack)`, and browser download wrappers.

- [ ] **Step 1: Write failing exact export tests**

Assert this fixed CSV header:

```text
tag_name,page_views,question_count,question_count_basis,sme_count,page_views_per_sme,coverage_percentile,coverage_tier,reason,recommended_action,demand_quality,sme_quality,result_completeness,completeness_warnings
```

Assert canonical rows remain in `pack.evidence` order; full-precision ratios are
serialized; `null` page views, question counts, SMEs, ratios, and percentiles
become empty cells. `result_completeness` repeats the prepared snapshot
completeness on every row. `completeness_warnings` joins canonical prepared
warnings in order as `code: message` entries separated by ` | `. An empty pack
still emits the full header.

Assert Markdown section order:

```text
# SME Coverage Decision Pack
## Snapshot
## Completeness warnings
## Executive summary
## Copy-ready assessment
## Immediate no-SME risks
## Highest-demand critical gaps
## Light SME coverage
## Methodology
```

Empty finding sections contain their tier-specific plain-language empty state.
Partial warnings and question-count basis are present. Markdown values use
display rounding, while CSV ratios retain full precision.

Assert descriptors:

```ts
expect(buildSmeCoverageMarkdownDownload(pack)).toMatchObject({
  fileName: "sme-coverage-decision-pack-example-stackenterprise-co-2026-07-30.md",
  mimeType: "text/markdown;charset=utf-8",
});
expect(buildSmeCoverageCsvDownload(pack)).toMatchObject({
  fileName: "sme-coverage-evidence-example-stackenterprise-co-2026-07-30.csv",
  mimeType: "text/csv;charset=utf-8",
});
```

Mock `downloadTextFile` and assert both wrappers pass the exact descriptor.

- [ ] **Step 2: Run export tests and verify RED**

Run:

```bash
./node_modules/.bin/vitest run \
  src/utilities/smeCoverage/exports.test.ts \
  src/utils/smeCoverageDownloads.test.ts \
  src/utils/downloads.test.ts \
  --reporter verbose
```

Expected: FAIL because the utility serializers and stable descriptors do not
exist.

- [ ] **Step 3: Add a fixed-header CSV helper and utility serializers**

Extend the shared helper without changing `recordsToCsv()`:

```ts
export function recordsToCsvWithHeaders(
  headers: readonly string[],
  records: readonly Record<string, unknown>[],
): string {
  return [
    headers.join(","),
    ...records.map((record) => headers.map((header) => escapeCsvValue(record[header])).join(",")),
  ].join("\n");
}
```

Map each evidence row to snake-case keys in the fixed header order. Do not sort
inside the exporter. Build Markdown exclusively from snapshot, warnings,
summary, assessment, findings, methodology, and evidence already present on
the pack.

- [ ] **Step 4: Implement stable browser download descriptors**

Sanitize the instance host with the same alphanumeric/hyphen rule used by
report downloads. Use `snapshot.generatedAt.slice(0, 10)` for the date. Export
pure builder functions separately from side-effect wrappers:

```ts
export function downloadSmeCoverageMarkdown(pack: SmeCoverageDecisionPack): void {
  const download = buildSmeCoverageMarkdownDownload(pack);
  downloadTextFile(download.fileName, download.contents, download.mimeType);
}

export function downloadSmeCoverageEvidenceCsv(pack: SmeCoverageDecisionPack): void {
  const download = buildSmeCoverageCsvDownload(pack);
  downloadTextFile(download.fileName, download.contents, download.mimeType);
}
```

- [ ] **Step 5: Run export tests and verify GREEN**

Run the Step 2 command. Expected: exact Markdown, CSV, null, order, filename,
MIME, and wrapper tests pass.

- [ ] **Step 6: Commit Task 6**

```bash
git add src/utils/downloads.ts src/utils/downloads.test.ts
git add src/utilities/smeCoverage/exports.ts src/utilities/smeCoverage/exports.test.ts
git add src/utils/smeCoverageDownloads.ts src/utils/smeCoverageDownloads.test.ts
git commit -m "feat: export SME coverage decision packs"
```

---

### Task 7: Shared collection seam and three-source utility runner

**Files:**
- Create: `src/collectors/liveCollectorClients.ts`
- Create: `src/utilities/smeCoverage/runner.ts`
- Create: `src/utilities/smeCoverage/runner.test.ts`
- Modify: `src/collectors/liveReportRunner.ts:1-206`
- Create: `src/collectors/liveCollectors.test.ts`
- Modify: `src/collectors/liveCollectors.ts:1-277`
- Modify: `src/domain/types.ts`

**Interfaces:**
- Consumes: credentials, `ApiVolumeSettingsValue`, injected `fetchFn`/`onThrottle`/clock, `collectDataset()`, source normalizers, analyzer, and decision-pack composer.
- Produces: `createLiveCollectorClients()`, v3 `tagSmeCounts` collection, `runSmeCoverageAnalysis() -> SmeCoverageRunResult`, and typed `SmeCoverageRunError`.

- [ ] **Step 1: Write failing collection-seam regressions**

Add a live-collector test that collects `tagSmeCounts` and asserts the URL uses:

```text
/api/v3/tags?pageSize=50&page=1
```

For Basic/Business, assert:

```text
https://api.stackoverflowteams.com/v3/teams/example-team/tags?pageSize=50&page=1
```

Keep existing v2 URLs on lowercase `pagesize`. Extend the dataset-client tests
so `getLiveDatasetClient("tagSmeCounts")` is `"v3"`. Existing report runner
auth/header/throttle tests must still pass after the client factory moves.

- [ ] **Step 2: Write failing runner tests**

Mock by URL and return:

```ts
if (url.includes("/2.3/tags")) {
  return v2Page([{ name: "piper", count: 8 }], false);
}
if (url.includes("/2.3/questions")) {
  return v2Page([{ question_id: 1, tags: ["piper"], view_count: 800 }], false);
}
if (url.includes("/v3/") && url.includes("/tags")) {
  return v3Page([{ name: "piper", subjectMatterExpertCount: 1 }], 1);
}
throw new Error(`Unexpected URL: ${url}`);
```

Assert exactly three source paths, no users/articles, and:

```ts
expect(requestUrls.some((url) => url.includes("top-answerers"))).toBe(false);
expect(result.datasets.map((dataset) => dataset.datasetName)).toEqual([
  "tags",
  "questions",
  "tagSmeCounts",
]);
expect(result.decisionPack.evidence[0]).toMatchObject({
  tagName: "piper",
  pageViews: 800,
  smeCount: 1,
  pageViewsPerSme: 800,
});
```

Add exact runner cases for:

- Basic/Business PAT headers on both API lanes.
- Enterprise v2 API key plus v3 bearer token.
- Missing credentials fail before fetch.
- Each individual v2 tags, v2 questions, and v3 tags fetch failure reports its
  stage.
- Each source page cap is preserved on its dataset and pack warnings.
- Question cap makes demand and conclusions partial-sample.
- V3 cap leaves retrieved numeric tags complete and unmatched tags unknown.
- V2 has usable tags but no matching numeric v3 SME count: unsupported
  capability error.
- Non-empty records with no usable tag identities: hard collection error.
- All three successfully empty sources: successful empty decision pack.
- A custom clock fixes `generatedAt` and instance host.
- Result JSON contains no PAT, API key, access token, auth source, or OAuth
  metadata.

- [ ] **Step 3: Run collector and runner tests and verify RED**

Run:

```bash
./node_modules/.bin/vitest run \
  src/collectors/liveCollectors.test.ts \
  src/collectors/liveReportRunner.test.ts \
  src/utilities/smeCoverage/runner.test.ts \
  --reporter verbose
```

Expected: FAIL because `tagSmeCounts`, the shared client factory, correct v3
query, and utility runner do not exist.

- [ ] **Step 4: Extract the authenticated client factory**

Move the existing `createLiveCollectorClients()` and `createV2Headers()` from
`liveReportRunner.ts` into `liveCollectorClients.ts`. Export only:

```ts
export interface LiveCollectorClientOptions {
  fetchFn?: FetchLike;
  onThrottle?: (notice: ThrottleNotice) => void | Promise<void>;
}

export function createLiveCollectorClients(
  credentials: SessionCredentials,
  options: LiveCollectorClientOptions = {},
): LiveCollectorClients;
```

Have `runLiveReport()` import it. Preserve exact Basic/Business PAT,
Enterprise API-key, v3 bearer, retry, and throttle behavior.

- [ ] **Step 5: Add the v3 tag-SME collection endpoint**

Map:

```ts
tagSmeCounts: { client: "v3", path: "/tags" },
```

Change the query builder to take the client lane:

```ts
const pageSizeKey = client === "v2" ? "pagesize" : "pageSize";
const query = { [pageSizeKey]: String(context.pageSize ?? 100) };
```

Only add `fromdate`/`todate` for v2 datasets when a scope value is actually
present. The utility supplies no scope, so its questions represent all
available history.

- [ ] **Step 6: Implement the dedicated utility runner**

Define:

```ts
export interface SmeCoverageRunDataset {
  datasetName: "tags" | "questions" | "tagSmeCounts";
  records: Record<string, unknown>[];
  pagination: SourcePagination;
}

export interface SmeCoverageRunResult {
  utilityId: "sme-coverage-analyzer";
  utilityTitle: "SME Coverage Analyzer";
  pageSize: number;
  maxPagesPerDataset: number;
  runPreset?: ReportRunPresetId;
  datasets: SmeCoverageRunDataset[];
  messages: string[];
  warnings: ReportWarning[];
  decisionPack: SmeCoverageDecisionPack;
}
```

`SmeCoverageRunError` has
`kind: "validation" | "collection" | "unsupported" | "unexpected"` and an
optional stage string.

Validate credentials and volume before creating clients. Collect the three
datasets with `collectDataset()` and stage-wrap each promise. Normalize the
requested preset with `getReportRunPresetForSettings()` so custom settings do
not retain a stale preset label. Preserve each source's pagination.

After normalization:

- Succeed empty only when all three sources are successfully empty.
- Fail if non-empty source records yield no usable tag identity.
- If v2 contains usable tag records but no corresponding v3 tag has a numeric
  assigned-SME count, throw the unsupported-capability explanation.
- Otherwise analyze and compose the pack.

Create one warning per capped source. The v2 tag warning says the pack covers a
collected tag sample; the question warning says page views are a collected
partial sample; the v3 warning says unmatched assigned-SME coverage may be
unknown. Add data-conflict/unknown/small-sample warnings from the pure layers,
deduplicated in decision-pack composition.

- [ ] **Step 7: Run collector and runner tests and verify GREEN**

Run the Step 3 command. Expected: the three-source runner, all degraded states,
and every existing report collection test pass.

- [ ] **Step 8: Commit Task 7**

```bash
git add src/domain/types.ts
git add src/collectors/liveCollectorClients.ts
git add src/collectors/liveCollectors.ts src/collectors/liveCollectors.test.ts
git add src/collectors/liveReportRunner.ts src/collectors/liveReportRunner.test.ts
git add src/utilities/smeCoverage/runner.ts src/utilities/smeCoverage/runner.test.ts
git commit -m "feat: run three-source SME coverage analysis"
```

---

### Task 8: No-date utility API handler and route

**Files:**
- Create: `src/server/smeCoverageRunApi.ts`
- Create: `src/server/smeCoverageRunApi.test.ts`
- Create: `src/app/api/utilities/sme-coverage/run/route.ts`

**Interfaces:**
- Consumes: JSON payload, Deep-default settings, utility credential/volume validation, and an injected `runSmeCoverageAnalysis`.
- Produces: `handleSmeCoverageRunRequest()` and `SmeCoverageRunResponseBody`.

- [ ] **Step 1: Write failing API contract tests**

Use a dependency-injected runner and assert a credentials-only request calls it
with:

```ts
expect(runSmeCoverageAnalysis).toHaveBeenCalledWith(credentials, {
  pageSize: 100,
  maxPagesPerDataset: 20,
  runPreset: "deep-audit",
});
```

Add exact tests for:

- Quick, Standard, Deep, and matching custom settings.
- A requested preset whose numeric settings do not match is cleared.
- Page size 0 or 101 and max pages 0 return validation errors before the runner.
- Missing/malformed credentials return `kind: "validation"` with HTTP 400.
- Any `scope`, `startDate`, or `endDate` property is rejected with
  `SME Coverage Analyzer does not accept a date scope.` and HTTP 400.
- `SmeCoverageRunError` kinds map to validation 400, unsupported 422,
  collection 502, and unexpected 500.
- A stage-bearing collection error includes the stage in the response.
- Complete, partial, and empty successful packs all return HTTP 200 unchanged.
- The response body never contains submitted credentials.

- [ ] **Step 2: Run server tests and verify RED**

Run:

```bash
./node_modules/.bin/vitest run \
  src/server/smeCoverageRunApi.test.ts \
  --reporter verbose
```

Expected: FAIL because the handler and response contract do not exist.

- [ ] **Step 3: Implement strict request parsing and error mapping**

Define:

```ts
export type SmeCoverageRunResponseBody =
  | { ok: true; result: SmeCoverageRunResult }
  | {
      ok: false;
      kind: "validation" | "collection" | "unsupported" | "unexpected";
      stage?: string;
      error: string;
    };
```

The request contains only `credentials`, optional `runPreset`, optional
`pageSize`, and optional `maxPagesPerDataset`. Reuse the report handler's
credential shape guards, including OAuth string-array validation, but keep the
utility payload guard local so a report/date field cannot slip through.

Start from `DEFAULT_SME_COVERAGE_SETTINGS`, validate the final numeric settings,
normalize the preset with `getReportRunPresetForSettings()`, validate utility
credentials, then invoke the runner. Return stage only when it is a non-empty
string on `SmeCoverageRunError`.

- [ ] **Step 4: Add the thin Node route**

Use:

```ts
import { handleSmeCoverageRunRequest } from "../../../../../server/smeCoverageRunApi";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    payload = null;
  }
  return handleSmeCoverageRunRequest(payload);
}
```

- [ ] **Step 5: Run API and runner tests and verify GREEN**

Run:

```bash
./node_modules/.bin/vitest run \
  src/server/smeCoverageRunApi.test.ts \
  src/utilities/smeCoverage/runner.test.ts \
  --reporter verbose
```

Expected: all request, status, error-kind, no-date, and runner tests pass.

- [ ] **Step 6: Commit Task 8**

```bash
git add src/server/smeCoverageRunApi.ts src/server/smeCoverageRunApi.test.ts
git add src/app/api/utilities/sme-coverage/run/route.ts
git commit -m "feat: expose SME coverage run API"
```

---

### Task 9: Utility session state and browser-local persistence migration

**Files:**
- Create: `src/utilities/smeCoverage/persistence.ts`
- Create: `src/utilities/smeCoverage/persistence.test.ts`
- Modify: `src/utilities/smeCoverage/model.ts`
- Modify: `src/domain/types.ts:80-152`
- Modify: `src/domain/sessionStore.ts:1-514`
- Modify: `src/domain/sessionStore.test.ts`
- Modify: `src/domain/datasetPersistence.ts:1-472`
- Modify: `src/domain/datasetPersistence.test.ts`
- Modify: `src/utils/browserDatasetStorage.ts`
- Modify: `src/utils/browserDatasetStorage.test.ts`

**Interfaces:**
- Consumes: `SmeCoverageRunResult`, strict decision-pack parser, and existing dataset persistence.
- Produces: `selectedUtilityId`, `utilityOutputs`, `utilityRunSnapshots`, utility dataset provenance, `utility/select`, `utility/loaded`, and a backward-compatible persisted snapshot version 2.

- [ ] **Step 1: Write failing reducer tests**

Assert initial utility state:

```ts
expect(createInitialSessionState()).toMatchObject({
  selectedUtilityId: "sme-coverage-analyzer",
  utilityOutputs: {},
  utilityRunSnapshots: [],
});
```

Dispatch `utility/loaded` with three source datasets and assert:

```ts
expect(Object.values(state.datasets).map((dataset) => dataset.name)).toEqual([
  "tags",
  "questions",
  "tagSmeCounts",
]);
expect(Object.values(state.datasets).every(
  (dataset) => dataset.utilityId === "sme-coverage-analyzer",
)).toBe(true);
expect(state.utilityOutputs["sme-coverage-analyzer"]?.decisionPack).toEqual(pack);
expect(state.utilityRunSnapshots[0]).toMatchObject({
  utilityId: "sme-coverage-analyzer",
  pageSize: 100,
  maxPagesPerDataset: 20,
  runPreset: "deep-audit",
});
```

Run the action twice. Assert the active output is replaced by the second pack
while all six source dataset snapshots remain separately listed. Remove one
supporting dataset and assert its utility snapshot is pruned when empty but the
self-contained active decision pack remains. Assert `datasets/flush` and
`session/reset` clear utility output/snapshots.

- [ ] **Step 2: Write failing strict decision-pack parser tests**

Round-trip complete, partial, small-sample, and empty fixture packs. Mutate one
field at a time to an invalid enum, negative numeric metric, non-finite number,
wrong summary type, non-array findings/evidence, mismatched finding row, or
missing snapshot label and assert `parseSmeCoverageDecisionPack()` returns
`null`.

Add nested fake fields:

```ts
{
  credentials: { pat: "secret" },
  accessToken: "secret",
  runQueue: [{ id: "secret-run" }],
}
```

at snapshot, warning, evidence, and methodology levels. Assert the parser
reconstructs allowed fields and strips all extras.

- [ ] **Step 3: Write failing v1 migration and v2 persistence tests**

Pass a current valid version-1 report-only snapshot. Assert parsing returns a
version-2 snapshot with:

```ts
{
  selectedUtilityId: "sme-coverage-analyzer",
  utilityOutputs: {},
  utilityRunSnapshots: [],
}
```

Create state with credentials plus a utility output and supporting datasets.
Assert `createDatasetSessionSnapshot()` returns version 2, round-trips the
utility fields, and contains none of:

```ts
["credentials", "apiKey", "accessToken", "pat", "authSource", "oauthClientId", "oauthScopes", "runQueue"]
```

Assert malformed utility state is discarded without losing valid legacy report
datasets. Assert a dataset cannot claim both `reportId` and `utilityId`.

- [ ] **Step 4: Run state and persistence tests and verify RED**

Run:

```bash
./node_modules/.bin/vitest run \
  src/domain/sessionStore.test.ts \
  src/utilities/smeCoverage/persistence.test.ts \
  src/domain/datasetPersistence.test.ts \
  src/utils/browserDatasetStorage.test.ts \
  --reporter verbose
```

Expected: FAIL because utility state, strict parsing, and migration do not
exist.

- [ ] **Step 5: Add utility state types and reducer actions**

Add:

```ts
export interface UtilityRunSnapshot {
  id: string;
  utilityId: UtilityId;
  pageSize: number;
  maxPagesPerDataset: number;
  runPreset?: ReportRunPresetId;
  loadedAt: string;
  datasetIds: string[];
  warnings: ReportWarning[];
}
```

Add `utilityId?: UtilityId` and optional pagination metadata to
`SessionDataset`. In `model.ts`, define:

```ts
export interface SmeCoverageStoredOutput {
  utilityId: "sme-coverage-analyzer";
  loadedAt: string;
  decisionPack: SmeCoverageDecisionPack;
}
```

Type `SessionState.utilityOutputs` as
`Partial<Record<UtilityId, SmeCoverageStoredOutput>>`.

`utility/loaded` always creates three live-API `SessionDataset` entries,
including empty arrays, with one utility snapshot ID and preserved pagination.
It appends raw datasets/snapshot, replaces only the active output for that
utility ID, and appends warnings to top-level warnings. Dataset removal prunes
utility snapshot references; active packs remain valid because their evidence
is self-contained.

- [ ] **Step 6: Implement the strict decision-pack parser**

Reconstruct every nested object from an allowlist. Validate:

- All string unions exactly.
- Every required string as a string.
- Every count as a finite nonnegative number.
- Every nullable metric as `null` or a finite nonnegative number.
- Percentiles as `null` or a finite value from 0 through 100.
- Summary counts as nonnegative integers.
- Snapshot scope label exactly
  `All-time demand · Current SME coverage`.
- Finding rows as canonical evidence members with the expected tier. Rebuild
  each finding list by resolving validated tag names back to the parsed
  canonical evidence objects so restored consumers share the same row objects.
- Evidence tag names as non-empty strings and canonical pack order as supplied;
  parsing preserves order rather than resorting.

Return `null` for an incoherent pack. Never spread an untrusted persisted
object.

- [ ] **Step 7: Migrate dataset persistence to version 2**

Set `DATASET_SESSION_PERSISTENCE_VERSION = 2`, but accept both version 1 and
version 2 input. Version 1 is parsed by the existing report/dataset rules, then
augmented with empty utility fields. Version 2 additionally parses:

```ts
selectedUtilityId
utilityOutputs
utilityRunSnapshots
```

Add `tagSmeCounts` to the dataset-name allowlist. Parse utility-aware warnings
and require a warning to name at most one of `reportId` or `utilityId`. Parse
utility dataset provenance and reject a dataset containing both owners. Keep
the IndexedDB database/store version unchanged because the stored value shape,
not the object-store schema, changes.

Have `loadPersistedDatasetSession()` parse the raw IndexedDB value through
`parseDatasetSessionSnapshot()` before returning it. That function therefore
returns a normalized version-2 snapshot for both stored v1 and v2 values; the
App never needs to branch on a raw persistence version.

- [ ] **Step 8: Run state and persistence tests and verify GREEN**

Run the Step 4 command. Expected: reducer replacement/snapshot behavior, strict
pack parsing, v1 migration, v2 round-trip, storage, and credential stripping
all pass.

- [ ] **Step 9: Commit Task 9**

```bash
git add src/utilities/smeCoverage/model.ts
git add src/utilities/smeCoverage/persistence.ts src/utilities/smeCoverage/persistence.test.ts
git add src/domain/types.ts src/domain/sessionStore.ts src/domain/sessionStore.test.ts
git add src/domain/datasetPersistence.ts src/domain/datasetPersistence.test.ts
git add src/utils/browserDatasetStorage.ts src/utils/browserDatasetStorage.test.ts
git commit -m "feat: persist utility decision packs locally"
```

---

### Task 10: Utilities navigation, catalog, volume controls, and run progress

**Files:**
- Create: `src/components/ApiVolumeSettings.tsx`
- Create: `src/components/ApiVolumeSettings.test.tsx`
- Create: `src/components/UtilityCatalog.tsx`
- Create: `src/components/UtilityCatalog.test.tsx`
- Create: `src/components/SmeCoverageRunProgress.tsx`
- Create: `src/components/SmeCoverageRunProgress.test.tsx`
- Modify: `src/components/AppShell.tsx:1-75`
- Modify: `src/components/AppShell.test.tsx`
- Modify: `src/components/ReportScopePanel.tsx:1-295`
- Modify: `src/components/ReportScopePanel.test.tsx`
- Modify: `src/styles/app.css`

**Interfaces:**
- Consumes: utility registry, `ApiVolumeSettingsValue`, existing presets, utility disclosure copy, and aggregate run state.
- Produces: `utilities` app panel, Scripts label, accessible utility catalog, reusable volume editor, and honest utility progress display.

- [ ] **Step 1: Write failing navigation and catalog tests**

Render the shell and assert the top-level button order:

```ts
expect(
  within(screen.getByRole("navigation", { name: "Application panels" }))
    .getAllByRole("button")
    .map((button) => button.textContent),
).toEqual(["Scripts", "Utilities", "Credentials", "Uploads", "Datasets", "Write Tools"]);
```

Render `UtilityCatalog` and assert exact title, scope, mode, description,
selected `aria-pressed`, and callback:

```ts
await user.click(screen.getByRole("button", { name: "SME Coverage Analyzer" }));
expect(onSelect).toHaveBeenCalledWith("sme-coverage-analyzer");
```

- [ ] **Step 2: Write failing reusable volume-control tests**

Render with Deep settings and assert Deep is checked. Click Quick and Standard
and assert exact numeric values. Open Advanced, set max pages to 8, and assert
`runPreset` becomes undefined. Assert utility disclosure says partial sample
and contains no `top-answerer`, `users`, `articles`, date, or comparison copy.

Re-run existing `ReportScopePanel` expectations to prove the extracted control
retains Tag Report's current Standard default and report-specific disclosure.

- [ ] **Step 3: Write failing progress tests**

Define these ordered stage labels:

```ts
[
  "Validate credentials and instance support",
  "Collect all-time tag demand",
  "Collect current assigned-SME counts",
  "Normalize and join tag evidence",
  "Calculate thresholds and coverage tiers",
  "Build deterministic assessment",
  "Store browser-local result",
  "Render decision pack",
]
```

For `running`, assert `aria-live="polite"`, a progressbar with an indeterminate
text label, and all stages shown without claiming they are individually
complete. For `succeeded`, all stages are complete. For `failed`, render the
server-provided failed stage and actionable error. The component must not use
timers to pretend it has live server-stage telemetry.

- [ ] **Step 4: Run component tests and verify RED**

Run:

```bash
./node_modules/.bin/vitest run \
  src/components/ApiVolumeSettings.test.tsx \
  src/components/UtilityCatalog.test.tsx \
  src/components/SmeCoverageRunProgress.test.tsx \
  src/components/ReportScopePanel.test.tsx \
  src/components/AppShell.test.tsx \
  --reporter verbose
```

Expected: FAIL because Utilities, the extracted controls, and utility progress
do not exist.

- [ ] **Step 5: Extract controlled API-volume settings**

`ApiVolumeSettings` receives:

```ts
interface ApiVolumeSettingsProps {
  value: ApiVolumeSettingsValue;
  radioName: string;
  helpText: string;
  recordDetail: string;
  getDisclosure: (presetId: ReportRunPresetId) => string;
  onChange: (value: ApiVolumeSettingsValue) => void;
}
```

It owns only UI disclosure state. Preset and numeric changes are emitted to the
parent. Numeric custom settings use `getReportRunPresetForSettings()` to clear
or restore a matching preset ID. Retain accessible labels/descriptions and the
existing number-draft behavior.

Refactor `ReportScopePanel` to render it for Tag Report while keeping date and
comparison controls outside. Utilities later pass
`getSmeCoveragePresetDisclosure()` and never render `ReportScopePanel`.

- [ ] **Step 6: Add navigation, catalog, and truthful progress**

Keep the internal report panel key to minimize report churn:

```ts
export type AppPanel =
  | "report"
  | "utilities"
  | "credentials"
  | "uploads"
  | "datasets"
  | "write-tools";

const panelLabels: Record<AppPanel, string> = {
  report: "Scripts",
  utilities: "Utilities",
  credentials: "Credentials",
  uploads: "Uploads",
  datasets: "Datasets",
  "write-tools": "Write Tools",
};
```

Object insertion order supplies the approved navigation order. Build
`UtilityCatalog` from `getExecutableUtilities()` using the selected-state
pattern from `ReportCatalog`.

`SmeCoverageRunProgress` receives
`status: "idle" | "running" | "succeeded" | "failed"`, optional `failedStage`,
and optional `error`. While the single POST is pending, say the server is
running the listed stages in order; do not animate fake stage completion.

- [ ] **Step 7: Add styles and responsive coverage**

Reuse existing catalog, panel, preset, focus, and reduced-motion tokens. Add
utility selectors only where semantics differ. Raise or supplement the
top-bar collapse breakpoint so six nav buttons do not collide between 1080px
and 1200px. At narrow widths, keep the navigation keyboard reachable and allow
wrapping without horizontal page overflow.

- [ ] **Step 8: Run component tests and verify GREEN**

Run the Step 4 command. Expected: navigation order, catalog, volume extraction,
report regressions, progress semantics, and responsive class expectations pass.

- [ ] **Step 9: Commit Task 10**

```bash
git add src/components/ApiVolumeSettings.tsx src/components/ApiVolumeSettings.test.tsx
git add src/components/UtilityCatalog.tsx src/components/UtilityCatalog.test.tsx
git add src/components/SmeCoverageRunProgress.tsx src/components/SmeCoverageRunProgress.test.tsx
git add src/components/AppShell.tsx src/components/AppShell.test.tsx
git add src/components/ReportScopePanel.tsx src/components/ReportScopePanel.test.tsx
git add src/styles/app.css
git commit -m "feat: add Utilities product navigation"
```

---

### Task 11: Decision-pack workspace and evidence UI

**Files:**
- Create: `src/components/SmeCoverageWorkspace.tsx`
- Create: `src/components/SmeCoverageWorkspace.test.tsx`
- Create: `src/components/SmeCoverageDecisionPack.tsx`
- Create: `src/components/SmeCoverageDecisionPack.test.tsx`
- Create: `src/components/SmeCoverageFindings.tsx`
- Create: `src/components/SmeCoverageAssessment.tsx`
- Create: `src/components/SmeCoverageAssessment.test.tsx`
- Create: `src/components/SmeCoverageMethodology.tsx`
- Create: `src/components/SmeCoverageEvidenceTable.tsx`
- Create: `src/components/SmeCoverageEvidenceTable.test.tsx`
- Modify: `src/test/fixtures/smeCoverageFixtures.ts`
- Modify: `src/styles/app.css`

**Interfaces:**
- Consumes: prepared `SmeCoverageDecisionPack`, utility settings, aggregate run state, download wrappers, and `navigator.clipboard`.
- Produces: the full conclusion-to-evidence workspace; components format values but never calculate tiers, thresholds, or finding membership.

- [ ] **Step 1: Write failing workspace and decision-pack composition tests**

Render the pre-run workspace and assert:

```ts
expect(screen.getByRole("heading", { name: "SME Coverage Analyzer" })).toBeInTheDocument();
expect(screen.getByText("All-time demand · Current SME coverage")).toBeInTheDocument();
expect(screen.getByText("Read-only")).toBeInTheDocument();
expect(screen.getByRole("button", { name: "Run SME coverage analysis" })).toBeInTheDocument();
expect(screen.queryByLabelText(/date/i)).not.toBeInTheDocument();
expect(screen.queryByText(/prior Script run|upload required/i)).not.toBeInTheDocument();
```

The explanation must explicitly say the utility:

- Compares all-time page-view demand with assigned SMEs at run time.
- Uses transparent hybrid rules.
- Requires both API lanes.
- Requires no prior Script run or upload.

For a completed pack, assert DOM order places every warning before the executive
summary. Assert snapshot host/time/scope/completeness, all five KPIs, overview,
three finding sections, assessment, methodology, evidence, and four result
actions. Render complete, partial, empty, and insufficient-sample fixtures.
Mock each download wrapper to succeed and throw; assert explicit accessible
success and error feedback for both Markdown and CSV actions.

- [ ] **Step 2: Write failing findings and methodology assertions**

Every visible finding row must show:

```text
Tag · Page views · SMEs · Questions · Question-count basis · Page views per SME · Tier reason · Recommended next action
```

Assert zero SMEs displays `No SME`; unknown SMEs and demand display
`Unavailable`; ratios round with separators. Assert each empty tier has
tier-specific copy rather than a generic blank panel.

Open methodology and assert it shows:

- `At least 1 question or more than 25 page views`.
- `pageViews / smeCount`.
- Active-tag median page views.
- Eligible covered active-tag sample size.
- P75 and P90 or `Not calculated`.
- Nearest-rank and empirical-percentile wording.
- Nearest-whole display/unrounded calculation.
- Question-count precedence and basis values.
- Completeness caveats.

- [ ] **Step 3: Write failing clipboard tests**

Mock:

```ts
Object.assign(navigator, {
  clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
});
```

Click `Copy assessment` and assert the exact prepared `pack.assessment` is
written. Assert a `role="status"` success message. Reject `writeText` and assert
an actionable `role="alert"` without changing the assessment.

- [ ] **Step 4: Write failing evidence-table tests**

Assert fixed semantic headers and `scope="col"`. Search by tag, tier, reason,
and basis. Assert a no-match state.

Click page-view and ratio headers through ascending and descending states.
Assert numeric ordering, null always last in both directions, and `aria-sort`
updates. Sort text columns with code-unit ordering. Confirm the input
`pack.evidence` array remains byte-for-byte equal to a pre-render deep clone.

The horizontally scrollable table container has an accessible label and can
receive keyboard focus. Every risk state has visible tier text; color is
supplementary only.

- [ ] **Step 5: Run UI tests and verify RED**

Run:

```bash
./node_modules/.bin/vitest run \
  src/components/SmeCoverageWorkspace.test.tsx \
  src/components/SmeCoverageDecisionPack.test.tsx \
  src/components/SmeCoverageAssessment.test.tsx \
  src/components/SmeCoverageEvidenceTable.test.tsx \
  --reporter verbose
```

Expected: FAIL because the workspace and result components do not exist.

- [ ] **Step 6: Implement the workspace and warnings-first composition**

Use:

```ts
export interface SmeCoverageWorkspaceProps {
  settings: ApiVolumeSettingsValue;
  onSettingsChange: (settings: ApiVolumeSettingsValue) => void;
  onRun: () => void;
  runState: SmeCoverageRunUiState;
  decisionPack?: SmeCoverageDecisionPack;
}
```

The workspace renders the utility header/explanation, utility-specific
`ApiVolumeSettings`, primary action, truthful run progress, and the pack when
present. Disable the primary action only while its own run is pending. `Run
again` calls the same `onRun`.

`SmeCoverageDecisionPack` renders warnings first, then snapshot/KPIs/overview,
findings, assessment, methodology, evidence, and actions. Invoke download
wrappers with the untouched pack. Catch synchronous download failures and
publish a concise `role="alert"`; successful starts publish a `role="status"`.
Summary labels are exactly:

```text
Tags analyzed
Tags with SMEs
Immediate gaps
Critical under-coverage
Light-coverage tags
```

- [ ] **Step 7: Implement findings, assessment, and methodology**

`SmeCoverageFindings` receives only `pack.findings`. Reuse one internal semantic
table renderer while supplying three exact headings and empty messages.

`SmeCoverageAssessment` splits the already-built assessment on blank lines for
display and copies the original string. Track `idle | copied | failed` feedback
without putting assessment content in an aria-live region.

`SmeCoverageMethodology` uses native `<details>`/`<summary>` and renders pack
values directly. It must not invoke median, percentile, ratio, tier, or source
normalization functions.

- [ ] **Step 8: Implement searchable/sortable evidence without mutating pack order**

Use TanStack React Table with a fixed column definition. Numeric accessors
return `undefined` for `null` and specify `sortUndefined: "last"` so unavailable
values remain last in either direction. Render from the table row model, not a
sorted in-place copy.

Fixed columns:

```ts
[
  "Tag",
  "Page views",
  "Questions",
  "Question-count basis",
  "SMEs",
  "Page views per SME",
  "Coverage percentile",
  "Coverage tier",
  "Demand quality",
  "SME quality",
  "Reason",
  "Recommended action",
]
```

Use prepared formatters only. Percentiles show at most two decimal places,
ratios use `formatDisplayedRatio()`, and unavailable values use plain text.
The table's search/sort state never leaves the component and is never passed to
downloads.

- [ ] **Step 9: Add accessible responsive styles**

Extend the existing Stack-like tokens for:

- Snapshot metadata and completeness badge.
- KPI strip.
- Warning stack before conclusions.
- Tier text badges with labels.
- Finding and evidence horizontal overflow.
- Assessment reading measure.
- Methodology disclosure.
- Copy/download feedback.

At 640px and below, stack KPI cards and actions. Preserve semantic tables with
horizontal scrolling rather than hiding columns. Add focus-visible styling to
scroll containers, sort buttons, copy, and download actions. Honor the existing
reduced-motion rule.

- [ ] **Step 10: Run UI and export tests and verify GREEN**

Run:

```bash
./node_modules/.bin/vitest run \
  src/components/SmeCoverageWorkspace.test.tsx \
  src/components/SmeCoverageDecisionPack.test.tsx \
  src/components/SmeCoverageAssessment.test.tsx \
  src/components/SmeCoverageEvidenceTable.test.tsx \
  src/utils/smeCoverageDownloads.test.ts \
  --reporter verbose
```

Expected: complete, partial, empty, small-sample, clipboard, download, sorting,
search, accessibility, and non-mutation tests pass.

- [ ] **Step 11: Commit Task 11**

```bash
git add src/components/SmeCoverageWorkspace.tsx src/components/SmeCoverageWorkspace.test.tsx
git add src/components/SmeCoverageDecisionPack.tsx src/components/SmeCoverageDecisionPack.test.tsx
git add src/components/SmeCoverageFindings.tsx
git add src/components/SmeCoverageAssessment.tsx src/components/SmeCoverageAssessment.test.tsx
git add src/components/SmeCoverageMethodology.tsx
git add src/components/SmeCoverageEvidenceTable.tsx src/components/SmeCoverageEvidenceTable.test.tsx
git add src/test/fixtures/smeCoverageFixtures.ts src/styles/app.css
git commit -m "feat: render SME coverage decision packs"
```

---

### Task 12: Root application, credentials, datasets, and persistence orchestration

**Files:**
- Modify: `src/App.tsx:1-542`
- Modify: `src/components/AppShell.test.tsx`
- Modify: `src/components/CredentialsPanel.tsx:1-360`
- Modify: `src/components/CredentialsPanel.test.tsx`
- Modify: `src/components/DatasetsPanel.tsx:1-124`
- Modify: `src/components/DatasetsPanel.test.tsx`
- Modify: `src/components/SessionOverview.tsx`
- Modify: `src/domain/sessionStore.ts`
- Modify: `src/domain/sessionStore.test.ts`
- Modify: `src/domain/datasetPersistence.ts`
- Modify: `src/domain/datasetPersistence.test.ts`

**Interfaces:**
- Consumes: Utilities panel/catalog/workspace, session reducer, utility API response, utility credential validation, and persistence.
- Produces: end-to-end in-app utility selection/run/rerun/restore behavior with workflow-aware credential notes and dataset provenance.

- [ ] **Step 1: Write failing App navigation and run tests**

Extend `AppShell.test.tsx` with:

1. Click Utilities, select SME Coverage Analyzer, and see the pre-run workspace.
2. Click run without credentials; assert the app opens Credentials and shows
   `SME Coverage Analyzer credential notes`.
3. Save Basic/Business PAT credentials, return to Utilities, run, and assert:

```ts
expect(fetch).toHaveBeenCalledWith("/api/utilities/sme-coverage/run", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    credentials: basicBusinessPatCredentials,
    pageSize: 100,
    maxPagesPerDataset: 20,
    runPreset: "deep-audit",
  }),
});
```

4. While the promise is pending, assert truthful utility progress.
5. Resolve a complete pack and assert ranked findings plus three new datasets.
6. Resolve a partial pack and assert warnings precede the overview.
7. Run twice and assert the second pack replaces the active result while six
   supporting datasets remain.
8. Resolve an older request after a newer one and assert it cannot overwrite
   the new pack or progress.
9. Hydrate a persisted utility pack without credentials and assert it renders
   after opening Utilities.
10. Persist an empty successful pack and assert it survives reload.

Update every existing top-nav query from `Reports` to `Scripts` and keep all
Script run/upload/comparison assertions unchanged.

- [ ] **Step 2: Write failing workflow-aware credential tests**

Generalize the render helper to pass:

```ts
{ kind: "utility", utilityId: "sme-coverage-analyzer" }
```

Assert utility title, mixed-lane requirements, and read-only wording. When
starting Enterprise OAuth for this utility, assert:

```ts
expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toMatchObject({
  scopes: [],
});
```

The utility must not request `write_access`. Existing report and User Group
Sync credential behavior remains covered by its existing tests.

- [ ] **Step 3: Write failing utility dataset provenance tests**

Render datasets carrying `utilityId: "sme-coverage-analyzer"` and assert:

```text
Workflow: SME Coverage Analyzer
Period: Snapshot
Scope: All-time demand · Current SME coverage
Source: Live API
```

Assert CSV/JSON downloads and removal use explicit accessible names containing
the utility source label. Change the table heading from `Report` to `Workflow`
without altering report rows.

- [ ] **Step 4: Run App, credentials, datasets, and state tests and verify RED**

Run:

```bash
./node_modules/.bin/vitest run \
  src/components/AppShell.test.tsx \
  src/components/CredentialsPanel.test.tsx \
  src/components/DatasetsPanel.test.tsx \
  src/domain/sessionStore.test.ts \
  src/domain/datasetPersistence.test.ts \
  --reporter verbose
```

Expected: FAIL because the root app does not select, run, persist, or restore
utilities and supporting panels are report-only.

- [ ] **Step 5: Wire selected utility, settings, and isolated run state**

In `App`, add:

```ts
const [smeCoverageSettings, setSmeCoverageSettings] =
  useState(DEFAULT_SME_COVERAGE_SETTINGS);
const [smeCoverageRunState, setSmeCoverageRunState] =
  useState<SmeCoverageRunUiState>({ status: "idle" });
const [credentialContext, setCredentialContext] =
  useState<CredentialWorkflow>({ kind: "report", reportId: "tag-report" });
```

`selectReport()` sets report credential context; `selectUtility()` dispatches
`utility/select`, clears stale utility UI errors, sets utility credential
context, and opens Utilities. Sidebar selection is:

```ts
activePanel === "write-tools"
  ? <WriteToolsCatalog />
  : activePanel === "utilities"
    ? <UtilityCatalog />
    : activePanel === "report"
      ? <ReportCatalog />
      : credentialContext.kind === "utility"
        ? <UtilityCatalog />
        : <ReportCatalog />;
```

Credentials, Uploads, and Datasets therefore retain the most recently selected
workflow catalog in the sidebar while their main content remains the selected
supporting panel.

- [ ] **Step 6: Implement guarded utility POST orchestration**

`queueSmeCoverageRun()`:

1. Sets utility credential context.
2. Redirects missing/invalid credentials with actionable utility messages.
3. Uses the shared monotonically increasing active-run ID.
4. Sets aggregate progress to running.
5. POSTs only credentials and API-volume settings.
6. Parses `SmeCoverageRunResponseBody`.
7. On the newest successful response, marks dataset content changed, dispatches
   `utility/loaded`, sets success, and keeps Utilities active.
8. On the newest failure, records `kind`, `stage`, and error without erasing the
   last completed pack.

Use the same stale-run guard as reports. Selecting a different Script/Utility,
importing data, or starting a newer run prevents an older response from
overwriting visible status.

- [ ] **Step 7: Generalize credential context without adding write scope**

Export:

```ts
export type CredentialWorkflow =
  | { kind: "report"; reportId: ReportId }
  | { kind: "utility"; utilityId: UtilityId };
```

Resolve title and requirements from the corresponding registry. For utilities,
label notes `Scope notes for selected utility`. Derive OAuth scopes from the
workflow: SME Coverage Analyzer uses `[]`; do not reuse the component's current
global `["write_access"]` constant for this read-only run.

- [ ] **Step 8: Persist utility output and show utility dataset provenance**

Add utility outputs/snapshots/selection to the persistence effect dependencies.
Persist when either datasets or utility outputs exist:

```ts
const hasPersistentContent =
  Object.keys(state.datasets).length > 0 ||
  Object.keys(state.utilityOutputs).length > 0;
```

Track utility selection revisions during slow hydration just as report
selection is protected, so a newer user choice wins while stored datasets and
outputs still hydrate.

In `DatasetsPanel`, resolve report or utility owner metadata. Utility rows show
`Snapshot` and the utility scope label. The app's dataset count includes utility
sources. `Flush stored datasets` clears packs and utility snapshots through the
existing reducer action.

- [ ] **Step 9: Run App and supporting-panel tests and verify GREEN**

Run the Step 4 command. Expected: all new utility flows and every existing
Script, credential, upload, dataset, persistence-race, and stale-run test pass.

- [ ] **Step 10: Commit Task 12**

```bash
git add src/App.tsx src/components/AppShell.test.tsx
git add src/components/CredentialsPanel.tsx src/components/CredentialsPanel.test.tsx
git add src/components/DatasetsPanel.tsx src/components/DatasetsPanel.test.tsx
git add src/components/SessionOverview.tsx
git add src/domain/sessionStore.ts src/domain/sessionStore.test.ts
git add src/domain/datasetPersistence.ts src/domain/datasetPersistence.test.ts
git commit -m "feat: integrate SME coverage utility workflow"
```

---

### Task 13: Browser acceptance, product documentation, and full verification

**Files:**
- Create: `e2e/sme-coverage-analyzer.spec.ts`
- Modify: `e2e/reporting-mvp.spec.ts`
- Modify: `README.md`
- Modify: `PRODUCT.md`

**Interfaces:**
- Consumes: completed application and mocked utility API response.
- Produces: executable acceptance proof, accurate Scripts/Utilities product documentation, and a verified branch.

- [ ] **Step 1: Write the failing mocked browser acceptance test**

Before navigation, route:

```ts
await page.route("**/api/utilities/sme-coverage/run", async (route) => {
  await route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ ok: true, result: completeSmeCoverageRunResult }),
  });
});
```

Also route `**/api/reports/run` to increment a counter and fail the request. The
test must:

1. Add Basic/Business credentials.
2. Open Utilities.
3. Select SME Coverage Analyzer.
4. Confirm Deep audit is selected and no date controls exist.
5. Run without opening or running Tag Report.
6. See deterministic immediate, critical, and light findings plus the snapshot
   scope.
7. Copy the assessment and see success feedback.
8. Download Markdown and assert its suggested filename and section headings.
9. Download CSV and assert its suggested filename, fixed header, canonical
   first row, and blank unknown cells.
10. Assert the report route counter is zero.

Add a 375-pixel-wide test that the six-button navigation remains usable and
the evidence table is reachable inside its labeled horizontal-scroll region.

- [ ] **Step 2: Run the new browser test and verify RED**

Run:

```bash
pnpm exec playwright test e2e/sme-coverage-analyzer.spec.ts --project=chromium
```

Expected: FAIL until the integrated utility workflow and final selectors are
present.

- [ ] **Step 3: Update product documentation**

Update README to define:

- Scripts produce datasets and report outputs.
- Utilities answer defined operational questions from API data.
- SME Coverage Analyzer is self-contained and read-only.
- It uses v2 tags/questions plus v3 `subjectMatterExpertCount`.
- It never treats v2 top answerers as assigned SMEs.
- Deep is the default; capped runs are partial samples.
- Decision packs and supporting datasets stay browser-local; credentials stay
  memory-only.
- New same-origin route `/api/utilities/sme-coverage/run`.

Update PRODUCT purpose and design principles to include evidence-first decision
packs, transparent methodology, and conclusion-before-evidence hierarchy.
Rename visible product references from Reports to Scripts where they describe
navigation; keep API/code terms such as `/api/reports/run` unchanged.

- [ ] **Step 4: Run focused and full unit suites**

Run:

```bash
./node_modules/.bin/vitest run \
  src/domain/tagNormalization.test.ts \
  src/utilities/smeCoverage/tagDemand.test.ts \
  src/utilities/smeCoverage/tagSmeCounts.test.ts \
  src/utilities/smeCoverage/analyzer.test.ts \
  src/utilities/smeCoverage/narrative.test.ts \
  src/utilities/smeCoverage/decisionPack.test.ts \
  src/utilities/smeCoverage/exports.test.ts \
  src/utilities/smeCoverage/runner.test.ts \
  src/server/smeCoverageRunApi.test.ts \
  --reporter verbose
pnpm test
```

Expected: all focused and full Vitest suites pass with no unhandled rejection,
React act warning, or snapshot update.

- [ ] **Step 5: Run static and production verification**

Run:

```bash
pnpm lint
pnpm build
```

Expected: both TypeScript projects pass and Next.js creates a production build
including `/api/utilities/sme-coverage/run`.

- [ ] **Step 6: Run full browser verification**

Run:

```bash
pnpm e2e
```

Expected: existing reporting acceptance plus complete and narrow-screen SME
Coverage Analyzer flows pass.

- [ ] **Step 7: Inspect the final diff and commit**

Run:

```bash
git diff --check
git status --short
```

Expected: no whitespace errors and only intentional feature/test/documentation
changes.

```bash
git add e2e/sme-coverage-analyzer.spec.ts e2e/reporting-mvp.spec.ts
git add README.md PRODUCT.md
git commit -m "test: verify SME coverage analyzer workflow"
```

- [ ] **Step 8: Request final code review**

Invoke `superpowers:requesting-code-review` against the complete branch. Address
only verified, in-scope findings, rerun Steps 4 through 6 after any change, and
finish with `superpowers:verification-before-completion` before claiming the
implementation is complete.
