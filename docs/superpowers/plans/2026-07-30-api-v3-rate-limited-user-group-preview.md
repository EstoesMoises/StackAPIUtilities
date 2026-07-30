# API v3 Rate-Limited User Group Preview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve complete Enterprise User Group Sync previews by resolving emails in batches of 20, retrying read-only HTTP 429 responses, and failing closed when lookup capacity remains unavailable.

**Architecture:** `StackApiV3Client` will centralize rate-aware GET behavior, including a descriptive `User-Agent`, bounded 429 retries, and header-directed waits; write requests remain non-retried. `userGroupSyncRunner` will deduplicate emails in stable order, resolve batches of 20 concurrently with a two-second inter-batch pause, and propagate lookup failures so an incomplete exact-sync preview can never reach Apply.

**Tech Stack:** TypeScript 5.5, native Fetch/Response/Headers, Vitest 2, Next.js 14 server routes.

## Global Constraints

- Process email lookups in batches of exactly 20.
- Wait two seconds only between non-empty email batches.
- Retry GET requests at most three times after the initial attempt.
- Never automatically retry POST or DELETE requests.
- Treat only a confirmed user-lookup 404 as `Email not found in Stack Enterprise`.
- Abort preview after any other user-lookup failure.
- Use `StackAPIUtilities/0.1 (+https://github.com/EstoesMoises/StackAPIUtilities)` as the API v3 `User-Agent`.
- Preserve existing credential redaction, preview confirmation, stale-preview checks, add-only behavior, and exact-sync behavior.
- Do not add dependencies or user-configurable throttling controls.

---

### Task 1: Rate-aware Stack API v3 GET requests

**Files:**
- Modify: `src/api/stackApiV3.ts`
- Test: `src/api/stackApiV3.test.ts`

**Interfaces:**
- Consumes: native `fetch`, `Response`, `Headers`, and existing `readJsonResponse`.
- Produces: `StackApiV3ClientOptions.waitFn?: (seconds: number) => Promise<void>` and `StackApiV3ClientOptions.nowFn?: () => number`; all client GET methods use a private bounded-retry helper.

- [ ] **Step 1: Add failing tests for headers, retries, delays, and write safety**

Add tests that construct the client with injected `fetchFn`, `waitFn`, and
`nowFn`. The transient response sequence must be:

```ts
const waitFn = vi.fn(async () => undefined);
const fetchMock = vi.fn()
  .mockResolvedValueOnce(
    new Response("rate limited", {
      status: 429,
      headers: { "Retry-After": "3" },
    }),
  )
  .mockResolvedValueOnce(
    new Response(
      JSON.stringify({ id: 42, email: "ada@example.com" }),
      { status: 200 },
    ),
  );
```

Assert:

```ts
expect(fetchMock).toHaveBeenCalledTimes(2);
expect(waitFn).toHaveBeenCalledWith(3);
expect(fetchMock.mock.calls[0][1]).toEqual(
  expect.objectContaining({
    headers: expect.objectContaining({
      "User-Agent":
        "StackAPIUtilities/0.1 (+https://github.com/EstoesMoises/StackAPIUtilities)",
    }),
  }),
);
```

Add separate tests for:

```ts
new Headers({
  "Retry-After": "1",
  "x-burst-throttle-seconds-until-full": "4",
  "x-token-bucket-seconds-until-next-refill": "2",
});
```

The selected wait must be four seconds. Add an HTTP-date `Retry-After` test
using an injected fixed clock, a malformed-header fallback test expecting two
seconds, and a persistent 429 test expecting four total fetch attempts followed
by the existing `Stack API v3 request failed with 429` error.

Return HTTP 429 from `createUserGroup`, `addUserGroupMembers`, and
`removeUserGroupMember`. Each call must reject and invoke `fetchFn` exactly once;
`waitFn` must remain unused.

Add a successful GET test with `x-burst-throttle-calls-left: 4` and
`x-burst-throttle-seconds-until-full: 2`; assert `onThrottle` receives
`{ kind: "burst", seconds: 2, remaining: 4 }`. Extend existing request-header
assertions so GET, POST, and DELETE requests all contain the fixed user agent.

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
./node_modules/.bin/vitest run src/api/stackApiV3.test.ts --reporter verbose
```

Expected: FAIL because the client neither accepts `waitFn`/`nowFn` nor retries
429 responses, the expected `User-Agent` is absent, and burst notices are not
emitted.

- [ ] **Step 3: Implement the minimal rate-aware GET helper**

Extend the client options and class fields:

```ts
type WaitFn = (seconds: number) => Promise<void>;
type NowFn = () => number;

const API_V3_USER_AGENT =
  "StackAPIUtilities/0.1 (+https://github.com/EstoesMoises/StackAPIUtilities)";
const MAX_GET_RETRIES = 3;
const FALLBACK_RETRY_SECONDS = 2;

interface StackApiV3ClientOptions {
  apiV3Url: string;
  token: string;
  fetchFn?: FetchLike;
  onThrottle?: (notice: ThrottleNotice) => void | Promise<void>;
  waitFn?: WaitFn;
  nowFn?: NowFn;
}
```

Use timer and clock defaults:

```ts
const waitSeconds: WaitFn = (seconds) =>
  new Promise((resolve) => setTimeout(resolve, seconds * 1_000));

this.waitFn = options.waitFn ?? waitSeconds;
this.nowFn = options.nowFn ?? (() => Date.now());
```

Create a private GET helper:

```ts
private async readResponse(url: URL): Promise<Response> {
  for (let retryCount = 0; ; retryCount += 1) {
    const response = await this.fetchFn(url, {
      headers: this.createJsonHeaders(),
    });

    if (response.status !== 429) {
      await this.notifyThrottle(response.headers);
      return response;
    }

    if (retryCount >= MAX_GET_RETRIES) {
      return response;
    }

    await this.waitFn(getRetryDelaySeconds(response.headers, this.nowFn()));
  }
}
```

Use the helper from `getPagedResult` and `getUserByEmail`. Keep all POST and
DELETE fetch calls unchanged.

Calculate the wait by parsing non-negative finite values from `Retry-After`,
`x-burst-throttle-seconds-until-full`, and
`x-token-bucket-seconds-until-next-refill`; use the maximum valid value or the
two-second fallback. HTTP dates use `Math.max(0, Math.ceil((dateMs - nowMs) /
1_000))`.

Add the user agent:

```ts
private createJsonHeaders(): HeadersInit {
  return {
    Authorization: `Bearer ${this.token}`,
    "Content-Type": "application/json",
    "User-Agent": API_V3_USER_AGENT,
  };
}
```

Extend `notifyThrottle` to emit a burst notice when the remaining burst calls
are below five and the refill duration is positive. Retain the existing token
bucket low-watermark behavior.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run:

```bash
./node_modules/.bin/vitest run src/api/stackApiV3.test.ts --reporter verbose
```

Expected: every Stack API v3 client test passes with no unexpected warnings.

- [ ] **Step 5: Commit Task 1**

```bash
git add src/api/stackApiV3.ts src/api/stackApiV3.test.ts
git commit -m "fix: retry throttled Stack API reads"
```

---

### Task 2: Batch User Group Sync email resolution

**Files:**
- Modify: `src/writeTools/userGroupSyncRunner.ts`
- Test: `src/writeTools/userGroupSyncRunner.test.ts`
- Test: `src/server/userGroupSyncApi.test.ts`

**Interfaces:**
- Consumes: `UserGroupSyncClient.getUserByEmail(email)` returning a user or confirmed `null`.
- Produces: `UserGroupSyncRunnerInput.waitFn?: (seconds: number) => Promise<void>`; preview resolves unique emails in ordered batches of 20 and propagates thrown lookup errors.

- [ ] **Step 1: Replace the permissive lookup-failure test with a failing fail-closed test**

Change the existing `continues preview when one email lookup fails` expectation
to:

```ts
await expect(previewUserGroupSync(createInput(client))).rejects.toThrow(
  "Stack lookup failed",
);
expect(client.getUserGroups).not.toHaveBeenCalled();
```

Keep the existing confirmed-missing behavior covered by returning `null` and
asserting the skipped-row reason remains
`Email not found in Stack Enterprise`.

Add a server test whose injected client throws `new StackApiError(...)` with
status 429 from `getUserByEmail`. Assert the response is 500 with the safe
status-only error and that group lookup and all write methods remain untouched.

- [ ] **Step 2: Run the focused runner and server tests and verify RED**

Run:

```bash
./node_modules/.bin/vitest run \
  src/writeTools/userGroupSyncRunner.test.ts \
  src/server/userGroupSyncApi.test.ts \
  --reporter verbose
```

Expected: both new expectations FAIL because the current resolver catches the
thrown error and continues to `getUserGroups`.

- [ ] **Step 3: Add the failing 41-email and duplicate-email batching tests**

Build a CSV fixture containing 41 unique emails. Inject:

```ts
const waitFn = vi.fn(async () => undefined);
let activeLookups = 0;
let maximumActiveLookups = 0;
const callsAtWait: number[] = [];
```

The lookup mock must increment `activeLookups`, update
`maximumActiveLookups`, await `Promise.resolve()`, decrement the count, and
return a user. The wait mock records the lookup call count each time it runs.

Assert:

```ts
expect(client.getUserByEmail).toHaveBeenCalledTimes(41);
expect(waitFn).toHaveBeenCalledTimes(2);
expect(callsAtWait).toEqual([20, 40]);
expect(maximumActiveLookups).toBe(20);
```

Use mixed-case duplicate emails across batch boundaries. Assert the resolver
calls `getUserByEmail` once for the normalized email and batch counts are based
on unique emails, not CSV rows.

- [ ] **Step 4: Re-run the focused tests and verify the batching tests are RED**

Run the same runner and server test command. Expected: the fail-closed tests and
batching tests fail for the intended missing behavior.

- [ ] **Step 5: Implement ordered batches of 20**

Extend the input and add constants:

```ts
type WaitFn = (seconds: number) => Promise<void>;

const USER_LOOKUP_BATCH_SIZE = 20;
const USER_LOOKUP_BATCH_DELAY_SECONDS = 2;

export interface UserGroupSyncRunnerInput {
  csvText: string;
  groupNameTemplate: string;
  syncMode: UserGroupSyncMode;
  client: UserGroupSyncClient;
  waitFn?: WaitFn;
}
```

Pass `input.waitFn` into `resolveUsersByEmail`. Use a timer-backed default and
replace the unbounded `Promise.all` with:

```ts
const entries = [...uniqueEmailsByKey.entries()];

for (let start = 0; start < entries.length; start += USER_LOOKUP_BATCH_SIZE) {
  const batch = entries.slice(start, start + USER_LOOKUP_BATCH_SIZE);

  await Promise.all(
    batch.map(async ([emailKey, email]) => {
      const user = await client.getUserByEmail(email);
      resolvedUsers[emailKey] =
        user === null
          ? null
          : {
              id: user.id,
              email: user.email ?? email,
              name: user.name,
            };
    }),
  );

  if (start + USER_LOOKUP_BATCH_SIZE < entries.length) {
    await waitFn(USER_LOOKUP_BATCH_DELAY_SECONDS);
  }
}
```

Do not catch lookup errors in the batch mapper.

- [ ] **Step 6: Run focused runner and server tests and verify GREEN**

Run:

```bash
./node_modules/.bin/vitest run \
  src/writeTools/userGroupSyncRunner.test.ts \
  src/server/userGroupSyncApi.test.ts \
  --reporter verbose
```

Expected: batching, deduplication, fail-closed behavior, add-only, and exact-sync
tests all pass.

- [ ] **Step 7: Commit Task 2**

```bash
git add src/writeTools/userGroupSyncRunner.ts src/writeTools/userGroupSyncRunner.test.ts
git add src/server/userGroupSyncApi.test.ts
git commit -m "fix: batch user group email lookups"
```

---

### Task 3: Complete regression verification

**Files:**
- Verify: `src/server/userGroupSyncApi.test.ts`
- Verify: `src/server/userGroupSyncApi.ts`
- Verify: `src/components/UserGroupSyncPanel.test.tsx`
- Verify: `docs/superpowers/specs/2026-07-30-api-v3-rate-limited-user-group-preview-design.md`

**Interfaces:**
- Consumes: the Task 1 rate-aware client and Task 2 fail-closed batched runner.
- Produces: verified application behavior with no additional production interface.

- [ ] **Step 1: Run all focused rate-limit and user-group tests**

Run:

```bash
./node_modules/.bin/vitest run \
  src/api/stackApiV3.test.ts \
  src/writeTools/userGroupSync.test.ts \
  src/writeTools/userGroupSyncRunner.test.ts \
  src/server/userGroupSyncApi.test.ts \
  src/components/UserGroupSyncPanel.test.tsx \
  --reporter verbose
```

Expected: all focused test files pass.

- [ ] **Step 2: Run TypeScript checks**

Run:

```bash
pnpm lint
```

Expected: both TypeScript projects exit successfully with zero errors.

- [ ] **Step 3: Run the scoped repository regression suite**

Run:

```bash
./node_modules/.bin/vitest run src --reporter dot
```

Expected: all repository `src` tests pass. The broad unscoped command is not
used because this checkout contains cached `.worktrees/` and `.pnpm-store/`
copies whose nested Playwright specs are incorrectly discovered by Vitest.

- [ ] **Step 4: Run the production build**

Run:

```bash
pnpm build
```

Expected: Next.js completes its optimized production build successfully.

- [ ] **Step 5: Review the final diff for scope and secrets**

Run:

```bash
git diff --check
git diff --stat main...HEAD
git diff --stat
git status --short
```

Confirm only the API client, sync runner, tests, and approved design/plan files
changed. Confirm no access token, PAT, CSV data, or normalized output file is
staged.

- [ ] **Step 6: Commit the implementation plan**

```bash
git add \
  docs/superpowers/plans/2026-07-30-api-v3-rate-limited-user-group-preview.md
git commit -m "docs: plan API v3 rate-limited previews"
```
