# Browser OAuth Customer Profiles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let each browser user explicitly save, restore, update, and delete non-sensitive Stack Enterprise OAuth customer setup while excluding credentials and PKCE transaction values from profile storage and preserving the existing short-lived protected PKCE cookie.

**Architecture:** A pure domain module owns the exact persisted allowlist and validation. A dedicated IndexedDB database and a focused React hook own persistence and hydration independently from datasets and session credentials. `CredentialsPanel` composes a profile manager with the existing PKCE flow, while a read-only server endpoint exposes the same resolved redirect URL used by OAuth start.

**Tech Stack:** TypeScript 5.5, React 18, Next.js 14 App Router, IndexedDB, Vitest 2, Testing Library, Stack Overflow Stacks CSS

---

## File Structure

- Create `src/auth/enterpriseOAuthTarget.ts`: browser-safe Enterprise OAuth URL validation and normalization shared by PKCE and profiles.
- Create `src/auth/enterpriseOAuthTarget.test.ts`: unit coverage for the shared URL rules.
- Modify `src/auth/oauthPkce.ts`: import and re-export the shared URL helpers without changing its public API.
- Create `src/domain/oauthCustomerProfiles.ts`: allowlisted profile schema, parsing, validation, creation, updates, preferences, and dirty comparison.
- Create `src/domain/oauthCustomerProfiles.test.ts`: domain behavior and secret-stripping tests.
- Create `src/utils/browserOAuthProfileStorage.ts`: dedicated IndexedDB access and atomic profile/preference mutations.
- Create `src/utils/browserOAuthProfileStorage.test.ts`: persistence, corruption, unavailable storage, and transaction failure tests.
- Create `src/hooks/useOAuthCustomerProfiles.ts`: hydration and serialized React mutations.
- Create `src/hooks/useOAuthCustomerProfiles.test.tsx`: hook hydration, stale preference, mutation, and failure tests.
- Create `src/components/OAuthCustomerProfileManager.tsx`: saved-customer selector and explicit CRUD controls.
- Create `src/components/OAuthCustomerProfileManager.test.tsx`: interaction, confirmation, validation display, and accessibility tests.
- Modify `src/server/oauthPkceApi.ts`: expose the server-resolved redirect URL through a safe JSON result.
- Modify `src/server/oauthPkceApi.test.ts`: cover public configuration and route parity with OAuth start.
- Create `src/app/api/oauth/pkce/config/route.ts`: read-only same-origin OAuth configuration route.
- Modify `src/components/CredentialsPanel.tsx`: integrate profiles, pristine hydration, redirect display/copy, and existing OAuth start.
- Modify `src/components/CredentialsPanel.test.tsx`: cover browser profile flows and update OAuth fetch assertions for the configuration request.
- Modify `src/styles/app.css`: profile manager, actions, status, and redirect-row layout.
- Modify `README.md`: distinguish browser-local non-sensitive profiles from memory-only credentials.

### Task 1: Extract Browser-Safe Enterprise OAuth Target Rules

**Files:**
- Create: `src/auth/enterpriseOAuthTarget.ts`
- Create: `src/auth/enterpriseOAuthTarget.test.ts`
- Modify: `src/auth/oauthPkce.ts:1-66`
- Test: `src/auth/oauthPkce.test.ts`

- [ ] **Step 1: Write the failing shared-helper test**

```ts
import { describe, expect, it } from "vitest";
import {
  isSupportedEnterpriseOAuthTarget,
  normalizeOAuthBaseUrl,
} from "./enterpriseOAuthTarget";

describe("enterpriseOAuthTarget", () => {
  it("accepts only HTTPS stackenterprise.co origins", () => {
    expect(isSupportedEnterpriseOAuthTarget("https://demo.stackenterprise.co/path?x=1")).toBe(true);
    expect(isSupportedEnterpriseOAuthTarget("https://stackenterprise.co")).toBe(true);
    expect(isSupportedEnterpriseOAuthTarget("http://demo.stackenterprise.co")).toBe(false);
    expect(isSupportedEnterpriseOAuthTarget("https://example.com")).toBe(false);
    expect(isSupportedEnterpriseOAuthTarget("not a url")).toBe(false);
  });

  it("normalizes a supported URL to its origin", () => {
    expect(normalizeOAuthBaseUrl("https://demo.stackenterprise.co/path?x=1")).toBe(
      "https://demo.stackenterprise.co",
    );
  });
});
```

- [ ] **Step 2: Run the test and confirm the missing-module failure**

Run: `pnpm test src/auth/enterpriseOAuthTarget.test.ts`

Expected: FAIL because `./enterpriseOAuthTarget` does not exist.

- [ ] **Step 3: Add the browser-safe helper and preserve the existing PKCE exports**

Create `src/auth/enterpriseOAuthTarget.ts`:

```ts
export function isSupportedEnterpriseOAuthTarget(baseUrl: string): boolean {
  try {
    const url = new URL(baseUrl);
    const hostname = url.hostname.toLowerCase();

    return (
      url.protocol === "https:" &&
      (hostname === "stackenterprise.co" || hostname.endsWith(".stackenterprise.co"))
    );
  } catch {
    return false;
  }
}

export function normalizeOAuthBaseUrl(baseUrl: string): string {
  const url = new URL(baseUrl);
  return `${url.protocol}//${url.host}`;
}
```

In `src/auth/oauthPkce.ts`, import both helpers from `./enterpriseOAuthTarget`, delete their local implementations, and keep current imports working with:

```ts
import {
  isSupportedEnterpriseOAuthTarget,
  normalizeOAuthBaseUrl,
} from "./enterpriseOAuthTarget";

export {
  isSupportedEnterpriseOAuthTarget,
  normalizeOAuthBaseUrl,
} from "./enterpriseOAuthTarget";
```

- [ ] **Step 4: Run shared and existing PKCE tests**

Run: `pnpm test src/auth/enterpriseOAuthTarget.test.ts src/auth/oauthPkce.test.ts`

Expected: PASS with both test files green.

- [ ] **Step 5: Commit the extraction**

```bash
git add src/auth/enterpriseOAuthTarget.ts src/auth/enterpriseOAuthTarget.test.ts src/auth/oauthPkce.ts
git commit -m "refactor: share Enterprise OAuth target rules"
```

### Task 2: Build the Allowlisted Customer Profile Domain

**Files:**
- Create: `src/domain/oauthCustomerProfiles.ts`
- Create: `src/domain/oauthCustomerProfiles.test.ts`

- [ ] **Step 1: Write failing tests for normalization, uniqueness, updates, preferences, and secret stripping**

```ts
import { describe, expect, it } from "vitest";
import {
  createOAuthCustomerProfile,
  isOAuthCustomerProfileDraftDirty,
  parseOAuthCustomerProfile,
  parseOAuthCustomerProfilePreferences,
  toOAuthCustomerProfileDraft,
  updateOAuthCustomerProfile,
} from "./oauthCustomerProfiles";

const now = new Date("2026-08-19T12:00:00.000Z");
const draft = {
  customerName: " Demo Customer ",
  baseUrl: "https://demo.stackenterprise.co/path",
  oauthClientId: " client-123 ",
  includeNoExpiry: false,
};

describe("oauthCustomerProfiles", () => {
  it("creates a normalized allowlisted profile", () => {
    const result = createOAuthCustomerProfile(draft, [], {
      createId: () => "profile-1",
      now: () => now,
    });

    expect(result).toEqual({
      ok: true,
      profile: {
        schemaVersion: 1,
        id: "profile-1",
        customerName: "Demo Customer",
        baseUrl: "https://demo.stackenterprise.co",
        oauthClientId: "client-123",
        includeNoExpiry: false,
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
      },
    });
  });

  it("rejects case-insensitive duplicate names", () => {
    const existing = createOAuthCustomerProfile(draft, [], {
      createId: () => "profile-1",
      now: () => now,
    });
    if (!existing.ok) throw new Error("fixture failed");

    expect(createOAuthCustomerProfile({ ...draft, customerName: "demo customer" }, [existing.profile])).toEqual({
      ok: false,
      errors: { customerName: "Use a unique customer name." },
    });
  });

  it("preserves createdAt and refreshes updatedAt on update", () => {
    const original = createOAuthCustomerProfile(draft, [], {
      createId: () => "profile-1",
      now: () => now,
    });
    if (!original.ok) throw new Error("fixture failed");
    const later = new Date("2026-08-20T12:00:00.000Z");
    const result = updateOAuthCustomerProfile(
      original.profile,
      { ...draft, oauthClientId: "client-456" },
      [original.profile],
      { now: () => later },
    );

    expect(result).toMatchObject({
      ok: true,
      profile: {
        id: "profile-1",
        createdAt: now.toISOString(),
        updatedAt: later.toISOString(),
        oauthClientId: "client-456",
      },
    });
  });

  it("discards unknown and sensitive stored properties", () => {
    const parsed = parseOAuthCustomerProfile({
      schemaVersion: 1,
      id: "profile-1",
      customerName: "Demo",
      baseUrl: "https://demo.stackenterprise.co",
      oauthClientId: "client-123",
      includeNoExpiry: true,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      accessToken: "secret",
      apiKey: "secret",
      oauthScopes: ["write_access"],
      codeVerifier: "secret",
    });

    expect(parsed).not.toBeNull();
    expect(parsed).toEqual({
      schemaVersion: 1,
      id: "profile-1",
      customerName: "Demo",
      baseUrl: "https://demo.stackenterprise.co",
      oauthClientId: "client-123",
      includeNoExpiry: true,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    });
    expect(JSON.stringify(parsed)).not.toMatch(/accessToken|apiKey|oauthScopes|codeVerifier|secret/);
  });

  it("parses only valid preferences and compares drafts", () => {
    expect(parseOAuthCustomerProfilePreferences({
      schemaVersion: 1,
      lastSelectedProfileId: "profile-1",
      accessToken: "secret",
    })).toEqual({ schemaVersion: 1, lastSelectedProfileId: "profile-1" });
    expect(parseOAuthCustomerProfilePreferences({ schemaVersion: 2 })).toBeNull();

    const created = createOAuthCustomerProfile(draft, [], {
      createId: () => "profile-1",
      now: () => now,
    });
    if (!created.ok) throw new Error("fixture failed");
    expect(isOAuthCustomerProfileDraftDirty(created.profile, toOAuthCustomerProfileDraft(created.profile))).toBe(false);
    expect(isOAuthCustomerProfileDraftDirty(created.profile, { ...draft, customerName: "Changed" })).toBe(true);
  });
});
```

- [ ] **Step 2: Run the domain test and confirm the missing-module failure**

Run: `pnpm test src/domain/oauthCustomerProfiles.test.ts`

Expected: FAIL because the profile domain module does not exist.

- [ ] **Step 3: Implement the exact schema and mutation API**

Create `src/domain/oauthCustomerProfiles.ts` with these exported contracts and behaviors:

```ts
import {
  isSupportedEnterpriseOAuthTarget,
  normalizeOAuthBaseUrl,
} from "../auth/enterpriseOAuthTarget";

export const OAUTH_CUSTOMER_PROFILE_SCHEMA_VERSION = 1 as const;

export interface OAuthCustomerProfileDraft {
  customerName: string;
  baseUrl: string;
  oauthClientId: string;
  includeNoExpiry: boolean;
}

export interface OAuthCustomerProfile extends OAuthCustomerProfileDraft {
  schemaVersion: typeof OAUTH_CUSTOMER_PROFILE_SCHEMA_VERSION;
  id: string;
  createdAt: string;
  updatedAt: string;
}

export interface OAuthCustomerProfilePreferences {
  schemaVersion: typeof OAUTH_CUSTOMER_PROFILE_SCHEMA_VERSION;
  lastSelectedProfileId?: string;
}

export type OAuthCustomerProfileField = keyof OAuthCustomerProfileDraft;
export type OAuthCustomerProfileErrors = Partial<Record<OAuthCustomerProfileField, string>>;
export type OAuthCustomerProfileMutationResult =
  | { ok: true; profile: OAuthCustomerProfile }
  | { ok: false; errors: OAuthCustomerProfileErrors };

interface ProfileMutationDependencies {
  createId?: () => string;
  now?: () => Date;
}

export function createOAuthCustomerProfile(
  draft: OAuthCustomerProfileDraft,
  existingProfiles: readonly OAuthCustomerProfile[],
  dependencies: ProfileMutationDependencies = {},
): OAuthCustomerProfileMutationResult {
  const normalized = normalizeDraft(draft);
  const errors = validateDraft(normalized, existingProfiles);
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  const timestamp = (dependencies.now?.() ?? new Date()).toISOString();
  return {
    ok: true,
    profile: {
      schemaVersion: 1,
      id: dependencies.createId?.() ?? crypto.randomUUID(),
      ...normalized,
      createdAt: timestamp,
      updatedAt: timestamp,
    },
  };
}

export function updateOAuthCustomerProfile(
  profile: OAuthCustomerProfile,
  draft: OAuthCustomerProfileDraft,
  existingProfiles: readonly OAuthCustomerProfile[],
  dependencies: ProfileMutationDependencies = {},
): OAuthCustomerProfileMutationResult {
  const normalized = normalizeDraft(draft);
  const errors = validateDraft(normalized, existingProfiles, profile.id);
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    profile: {
      ...profile,
      ...normalized,
      updatedAt: (dependencies.now?.() ?? new Date()).toISOString(),
    },
  };
}

export function parseOAuthCustomerProfile(value: unknown): OAuthCustomerProfile | null {
  if (!isRecord(value)) return null;
  if (
    value.schemaVersion !== 1 ||
    !isNonBlankString(value.id) ||
    !isNonBlankString(value.customerName) ||
    !isNonBlankString(value.baseUrl) ||
    !isSupportedEnterpriseOAuthTarget(value.baseUrl) ||
    normalizeOAuthBaseUrl(value.baseUrl) !== value.baseUrl ||
    !isNonBlankString(value.oauthClientId) ||
    typeof value.includeNoExpiry !== "boolean" ||
    !isIsoTimestamp(value.createdAt) ||
    !isIsoTimestamp(value.updatedAt)
  ) return null;

  return {
    schemaVersion: 1,
    id: value.id,
    customerName: value.customerName,
    baseUrl: value.baseUrl,
    oauthClientId: value.oauthClientId,
    includeNoExpiry: value.includeNoExpiry,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  };
}

export function parseOAuthCustomerProfilePreferences(
  value: unknown,
): OAuthCustomerProfilePreferences | null {
  if (!isRecord(value) || value.schemaVersion !== 1) return null;
  if (value.lastSelectedProfileId !== undefined && !isNonBlankString(value.lastSelectedProfileId)) return null;
  return value.lastSelectedProfileId === undefined
    ? { schemaVersion: 1 }
    : { schemaVersion: 1, lastSelectedProfileId: value.lastSelectedProfileId };
}

export function toOAuthCustomerProfileDraft(profile: OAuthCustomerProfile): OAuthCustomerProfileDraft {
  return {
    customerName: profile.customerName,
    baseUrl: profile.baseUrl,
    oauthClientId: profile.oauthClientId,
    includeNoExpiry: profile.includeNoExpiry,
  };
}

export function isOAuthCustomerProfileDraftDirty(
  profile: OAuthCustomerProfile,
  draft: OAuthCustomerProfileDraft,
): boolean {
  const normalized = normalizeDraft(draft);
  return (
    profile.customerName !== normalized.customerName ||
    profile.baseUrl !== normalized.baseUrl ||
    profile.oauthClientId !== normalized.oauthClientId ||
    profile.includeNoExpiry !== normalized.includeNoExpiry
  );
}

function normalizeDraft(draft: OAuthCustomerProfileDraft): OAuthCustomerProfileDraft {
  const baseUrl = draft.baseUrl.trim();
  return {
    customerName: draft.customerName.trim(),
    baseUrl: isSupportedEnterpriseOAuthTarget(baseUrl) ? normalizeOAuthBaseUrl(baseUrl) : baseUrl,
    oauthClientId: draft.oauthClientId.trim(),
    includeNoExpiry: draft.includeNoExpiry,
  };
}

function validateDraft(
  draft: OAuthCustomerProfileDraft,
  profiles: readonly OAuthCustomerProfile[],
  excludedId?: string,
): OAuthCustomerProfileErrors {
  const errors: OAuthCustomerProfileErrors = {};
  if (!draft.customerName) errors.customerName = "Enter a customer name.";
  else if (profiles.some((profile) => profile.id !== excludedId && profile.customerName.toLocaleLowerCase() === draft.customerName.toLocaleLowerCase())) {
    errors.customerName = "Use a unique customer name.";
  }
  if (!isSupportedEnterpriseOAuthTarget(draft.baseUrl)) {
    errors.baseUrl = "Enter a Stack Enterprise HTTPS instance URL.";
  }
  if (!draft.oauthClientId) errors.oauthClientId = "Enter an OAuth client ID.";
  return errors;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isNonBlankString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && value === value.trim();
}

function isIsoTimestamp(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value;
}
```

- [ ] **Step 4: Add rejection cases and run the domain suite**

Append these exact rejection cases:

```ts
it.each([
  [{ ...draft, customerName: " " }, { customerName: "Enter a customer name." }],
  [{ ...draft, oauthClientId: " " }, { oauthClientId: "Enter an OAuth client ID." }],
  [
    { ...draft, baseUrl: "http://demo.stackenterprise.co" },
    { baseUrl: "Enter a Stack Enterprise HTTPS instance URL." },
  ],
  [
    { ...draft, baseUrl: "https://example.com" },
    { baseUrl: "Enter a Stack Enterprise HTTPS instance URL." },
  ],
] as const)("rejects invalid profile draft %#", (invalidDraft, errors) => {
  expect(createOAuthCustomerProfile(invalidDraft, [])).toEqual({ ok: false, errors });
});

it("rejects malformed stored booleans and timestamps", () => {
  const stored = {
    schemaVersion: 1,
    id: "profile-1",
    customerName: "Demo",
    baseUrl: "https://demo.stackenterprise.co",
    oauthClientId: "client-123",
    includeNoExpiry: false,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
  expect(parseOAuthCustomerProfile({ ...stored, includeNoExpiry: "yes" })).toBeNull();
  expect(parseOAuthCustomerProfile({ ...stored, createdAt: "not-a-date" })).toBeNull();
  expect(parseOAuthCustomerProfile({ ...stored, updatedAt: "2026-08-19" })).toBeNull();
});
```

Run:

`pnpm test src/domain/oauthCustomerProfiles.test.ts`

Expected: PASS; each invalid field produces the exact inline message or a `null` parse result.

- [ ] **Step 5: Commit the domain model**

```bash
git add src/domain/oauthCustomerProfiles.ts src/domain/oauthCustomerProfiles.test.ts
git commit -m "feat: define OAuth customer profiles"
```

### Task 3: Persist Profiles in a Dedicated IndexedDB Database

**Files:**
- Create: `src/utils/browserOAuthProfileStorage.ts`
- Create: `src/utils/browserOAuthProfileStorage.test.ts`

- [ ] **Step 1: Write failing storage contract tests**

Start `src/utils/browserOAuthProfileStorage.test.ts` with these imports and fixtures:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import type { OAuthCustomerProfile } from "../domain/oauthCustomerProfiles";
import {
  deleteOAuthCustomerProfile,
  loadOAuthCustomerProfileStore,
  saveLastSelectedOAuthCustomerProfileId,
  saveOAuthCustomerProfile,
} from "./browserOAuthProfileStorage";

const originalIndexedDB = globalThis.indexedDB;

afterEach(() => {
  vi.unstubAllGlobals();
  if (originalIndexedDB) vi.stubGlobal("indexedDB", originalIndexedDB);
});

function createProfile(): OAuthCustomerProfile {
  return {
    schemaVersion: 1,
    id: "profile-1",
    customerName: "Demo Customer",
    baseUrl: "https://demo.stackenterprise.co",
    oauthClientId: "client-123",
    includeNoExpiry: false,
    createdAt: "2026-08-19T12:00:00.000Z",
    updatedAt: "2026-08-19T12:00:00.000Z",
  };
}
```

Cover the public contract with these assertions:

```ts
describe("browserOAuthProfileStorage", () => {
  it("opens a dedicated database and creates profile and preference stores", async () => {
    const fake = installFakeIndexedDB();
    await loadOAuthCustomerProfileStore();
    expect(fake.openCalls).toEqual([{ name: "stack-api-utilities-oauth-profiles", version: 1 }]);
    expect(fake.createdObjectStores).toEqual(["profiles", "preferences"]);
  });

  it("round-trips an allowlisted profile and last-selected preference", async () => {
    const fake = installFakeIndexedDB({ existingStores: ["profiles", "preferences"] });
    const profile = {
      ...createProfile(),
      accessToken: "secret-token",
      apiKey: "secret-key",
      codeVerifier: "secret-verifier",
    } as OAuthCustomerProfile;
    await saveOAuthCustomerProfile(profile);
    await saveLastSelectedOAuthCustomerProfileId(profile.id);
    await expect(loadOAuthCustomerProfileStore()).resolves.toEqual({
      available: true,
      profiles: [createProfile()],
      preferences: { schemaVersion: 1, lastSelectedProfileId: profile.id },
      malformedProfileCount: 0,
    });
    const serializedRecords = JSON.stringify(
      [...fake.records.entries()].map(([store, records]) => [store, [...records.entries()]]),
    );
    expect(serializedRecords).not.toMatch(/accessToken|apiKey|pat|codeVerifier|secret-/);
  });

  it("deletes a profile and a matching selection in one transaction", async () => {
    installFakeIndexedDB({ existingStores: ["profiles", "preferences"] });
    const profile = createProfile();
    await saveOAuthCustomerProfile(profile);
    await saveLastSelectedOAuthCustomerProfileId(profile.id);
    await deleteOAuthCustomerProfile(profile.id);
    await expect(loadOAuthCustomerProfileStore()).resolves.toMatchObject({
      profiles: [],
      preferences: { schemaVersion: 1 },
    });
  });

  it("reports unavailable IndexedDB and rejects writes", async () => {
    vi.stubGlobal("indexedDB", undefined);
    await expect(loadOAuthCustomerProfileStore()).resolves.toEqual({
      available: false,
      profiles: [],
      preferences: { schemaVersion: 1 },
      malformedProfileCount: 0,
    });
    await expect(saveOAuthCustomerProfile(createProfile())).rejects.toThrow(
      "Saved customers are unavailable in this browser.",
    );
  });

  it("keeps valid records and counts malformed records", async () => {
    const fake = installFakeIndexedDB({ existingStores: ["profiles", "preferences"] });
    fake.records.get("profiles")!.set("valid", createProfile());
    fake.records.get("profiles")!.set("invalid", { accessToken: "secret" });
    await expect(loadOAuthCustomerProfileStore()).resolves.toMatchObject({
      profiles: [createProfile()],
      malformedProfileCount: 1,
    });
  });
});
```

Append the failure cases:

```ts
it("rejects a failed request", async () => {
  const fake = installFakeIndexedDB({ existingStores: ["profiles", "preferences"] });
  fake.failNextRequest(new Error("profile read failed"));
  await expect(loadOAuthCustomerProfileStore()).rejects.toThrow("profile read failed");
});

it("rejects an aborted write transaction", async () => {
  const fake = installFakeIndexedDB({ existingStores: ["profiles", "preferences"] });
  fake.abortNextTransaction(new Error("profile write aborted"));
  await expect(saveOAuthCustomerProfile(createProfile())).rejects.toThrow("profile write aborted");
});
```

Add this compact IndexedDB fake at the bottom of the test file. It deliberately implements only the request, store, upgrade, and transaction surface used by the storage module:

```ts
function installFakeIndexedDB(options: { existingStores?: string[] } = {}): FakeIndexedDB {
  const fake = new FakeIndexedDB(options.existingStores ?? []);
  vi.stubGlobal("indexedDB", fake.factory);
  return fake;
}

class FakeIndexedDB {
  readonly createdObjectStores: string[] = [];
  readonly openCalls: Array<{ name: string; version?: number }> = [];
  readonly records = new Map<string, Map<IDBValidKey, unknown>>();
  readonly factory = {
    open: (name: string, version?: number) => this.open(name, version),
  } as IDBFactory;
  private nextRequestError: Error | null = null;
  private nextAbort: Error | null = null;

  constructor(existingStores: string[]) {
    existingStores.forEach((name) => this.records.set(name, new Map()));
  }

  failNextRequest(error: Error): void { this.nextRequestError = error; }
  abortNextTransaction(error: Error): void { this.nextAbort = error; }
  consumeRequestError(): Error | null {
    const error = this.nextRequestError;
    this.nextRequestError = null;
    return error;
  }
  consumeAbort(): Error | null {
    const error = this.nextAbort;
    this.nextAbort = null;
    return error;
  }

  private open(name: string, version?: number): IDBOpenDBRequest {
    this.openCalls.push({ name, version });
    const request = new FakeOpenRequest();
    const database = new FakeDatabase(this);
    queueMicrotask(() => {
      request.result = database as unknown as IDBDatabase;
      if (!this.records.has("profiles") || !this.records.has("preferences")) {
        request.onupgradeneeded?.call(
          request as unknown as IDBOpenDBRequest,
          new Event("upgradeneeded") as IDBVersionChangeEvent,
        );
      }
      request.onsuccess?.call(request as unknown as IDBOpenDBRequest, new Event("success"));
    });
    return request as unknown as IDBOpenDBRequest;
  }
}

class FakeOpenRequest {
  result!: IDBDatabase;
  error: DOMException | null = null;
  onerror: ((this: IDBOpenDBRequest, ev: Event) => unknown) | null = null;
  onsuccess: ((this: IDBOpenDBRequest, ev: Event) => unknown) | null = null;
  onupgradeneeded: ((this: IDBOpenDBRequest, ev: IDBVersionChangeEvent) => unknown) | null = null;
}

class FakeDatabase {
  readonly objectStoreNames = {
    contains: (name: string) => this.owner.records.has(name),
  } as DOMStringList;

  constructor(private readonly owner: FakeIndexedDB) {}

  createObjectStore(name: string): IDBObjectStore {
    this.owner.records.set(name, new Map());
    this.owner.createdObjectStores.push(name);
    return {} as IDBObjectStore;
  }

  transaction(storeNames: string | string[], mode: IDBTransactionMode = "readonly"): IDBTransaction {
    return new FakeTransaction(
      this.owner,
      Array.isArray(storeNames) ? storeNames : [storeNames],
      mode,
    ) as unknown as IDBTransaction;
  }

  close(): void {}
}

class FakeTransaction {
  error: DOMException | null = null;
  onabort: ((this: IDBTransaction, ev: Event) => unknown) | null = null;
  oncomplete: ((this: IDBTransaction, ev: Event) => unknown) | null = null;
  onerror: ((this: IDBTransaction, ev: Event) => unknown) | null = null;
  private pending = 0;
  private completionScheduled = false;
  private readonly abortError: Error | null;

  constructor(
    private readonly owner: FakeIndexedDB,
    private readonly storeNames: string[],
    mode: IDBTransactionMode,
  ) {
    this.abortError = mode === "readwrite" ? owner.consumeAbort() : null;
    this.scheduleCompletion();
  }

  objectStore(name: string): IDBObjectStore {
    if (!this.storeNames.includes(name)) throw new Error(`Store ${name} is not in the transaction.`);
    const records = this.owner.records.get(name);
    if (!records) throw new Error(`Store ${name} does not exist.`);
    return new FakeObjectStore(records, this) as unknown as IDBObjectStore;
  }

  request<T>(operation: () => T): IDBRequest<T> {
    this.pending += 1;
    const request = new FakeRequest<T>();
    queueMicrotask(() => {
      const failure = this.owner.consumeRequestError();
      if (failure) {
        request.error = failure as unknown as DOMException;
        this.error = request.error;
        request.onerror?.call(request as unknown as IDBRequest<T>, new Event("error"));
        this.onerror?.call(this as unknown as IDBTransaction, new Event("error"));
      } else {
        request.result = operation();
        request.onsuccess?.call(request as unknown as IDBRequest<T>, new Event("success"));
      }
      this.pending -= 1;
      this.scheduleCompletion();
    });
    return request as unknown as IDBRequest<T>;
  }

  private scheduleCompletion(): void {
    if (this.completionScheduled) return;
    this.completionScheduled = true;
    queueMicrotask(() => {
      this.completionScheduled = false;
      if (this.pending > 0) return;
      if (this.abortError) {
        this.error = this.abortError as unknown as DOMException;
        this.onabort?.call(this as unknown as IDBTransaction, new Event("abort"));
      } else if (!this.error) {
        this.oncomplete?.call(this as unknown as IDBTransaction, new Event("complete"));
      }
    });
  }
}

class FakeRequest<T> {
  result!: T;
  error: DOMException | null = null;
  onerror: ((this: IDBRequest<T>, ev: Event) => unknown) | null = null;
  onsuccess: ((this: IDBRequest<T>, ev: Event) => unknown) | null = null;
}

class FakeObjectStore {
  constructor(
    private readonly records: Map<IDBValidKey, unknown>,
    private readonly transaction: FakeTransaction,
  ) {}

  get(key: IDBValidKey): IDBRequest<unknown> {
    return this.transaction.request(() => this.records.get(key));
  }
  getAll(): IDBRequest<unknown[]> {
    return this.transaction.request(() => [...this.records.values()]);
  }
  put(value: unknown, key: IDBValidKey): IDBRequest<IDBValidKey> {
    return this.transaction.request(() => {
      this.records.set(key, structuredClone(value));
      return key;
    });
  }
  delete(key: IDBValidKey): IDBRequest<undefined> {
    return this.transaction.request(() => {
      this.records.delete(key);
      return undefined;
    });
  }
}
```

- [ ] **Step 2: Run the storage test and confirm the missing-module failure**

Run: `pnpm test src/utils/browserOAuthProfileStorage.test.ts`

Expected: FAIL because the storage module does not exist.

- [ ] **Step 3: Implement the dedicated database and exact write sanitization**

Create `src/utils/browserOAuthProfileStorage.ts` with this public API and constants:

```ts
import {
  OAUTH_CUSTOMER_PROFILE_SCHEMA_VERSION,
  parseOAuthCustomerProfile,
  parseOAuthCustomerProfilePreferences,
  type OAuthCustomerProfile,
  type OAuthCustomerProfilePreferences,
} from "../domain/oauthCustomerProfiles";

const DATABASE_NAME = "stack-api-utilities-oauth-profiles";
const DATABASE_VERSION = 1;
const PROFILE_STORE_NAME = "profiles";
const PREFERENCES_STORE_NAME = "preferences";
const PREFERENCES_KEY = "current";

export interface OAuthCustomerProfileStoreSnapshot {
  available: boolean;
  profiles: OAuthCustomerProfile[];
  preferences: OAuthCustomerProfilePreferences;
  malformedProfileCount: number;
}

export async function loadOAuthCustomerProfileStore(): Promise<OAuthCustomerProfileStoreSnapshot> {
  const database = await openDatabase();
  if (!database) return emptySnapshot(false);
  try {
    const transaction = database.transaction([PROFILE_STORE_NAME, PREFERENCES_STORE_NAME], "readonly");
    const profileRequest = transaction.objectStore(PROFILE_STORE_NAME).getAll();
    const preferenceRequest = transaction.objectStore(PREFERENCES_STORE_NAME).get(PREFERENCES_KEY);
    const [profileValues, preferenceValue] = await Promise.all([
      requestToPromise<unknown[]>(profileRequest),
      requestToPromise<unknown>(preferenceRequest),
      transactionToPromise(transaction),
    ]);
    const parsedProfiles = profileValues.map(parseOAuthCustomerProfile);
    return {
      available: true,
      profiles: parsedProfiles.filter((profile): profile is OAuthCustomerProfile => profile !== null)
        .sort((left, right) => left.customerName.localeCompare(right.customerName)),
      preferences: parseOAuthCustomerProfilePreferences(preferenceValue) ?? { schemaVersion: 1 },
      malformedProfileCount: parsedProfiles.filter((profile) => profile === null).length,
    };
  } finally {
    database.close();
  }
}

export async function saveOAuthCustomerProfile(profile: OAuthCustomerProfile): Promise<void> {
  const sanitized = parseOAuthCustomerProfile(profile);
  if (!sanitized) throw new Error("The customer profile is invalid.");
  await withWriteTransaction([PROFILE_STORE_NAME], (transaction) => {
    transaction.objectStore(PROFILE_STORE_NAME).put(sanitized, sanitized.id);
  });
}

export async function saveLastSelectedOAuthCustomerProfileId(profileId?: string): Promise<void> {
  await withWriteTransaction([PREFERENCES_STORE_NAME], (transaction) => {
    const store = transaction.objectStore(PREFERENCES_STORE_NAME);
    const preferences: OAuthCustomerProfilePreferences = profileId
      ? { schemaVersion: OAUTH_CUSTOMER_PROFILE_SCHEMA_VERSION, lastSelectedProfileId: profileId }
      : { schemaVersion: OAUTH_CUSTOMER_PROFILE_SCHEMA_VERSION };
    store.put(preferences, PREFERENCES_KEY);
  });
}

export async function deleteOAuthCustomerProfile(profileId: string): Promise<void> {
  await withWriteTransaction([PROFILE_STORE_NAME, PREFERENCES_STORE_NAME], (transaction) => {
    transaction.objectStore(PROFILE_STORE_NAME).delete(profileId);
    const preferencesStore = transaction.objectStore(PREFERENCES_STORE_NAME);
    const request = preferencesStore.get(PREFERENCES_KEY);
    request.onsuccess = () => {
      const preferences = parseOAuthCustomerProfilePreferences(request.result);
      if (preferences?.lastSelectedProfileId === profileId) {
        preferencesStore.put({ schemaVersion: 1 }, PREFERENCES_KEY);
      }
    };
  });
}
```

Append the complete IndexedDB helpers:

```ts
function emptySnapshot(available: boolean): OAuthCustomerProfileStoreSnapshot {
  return {
    available,
    profiles: [],
    preferences: { schemaVersion: OAUTH_CUSTOMER_PROFILE_SCHEMA_VERSION },
    malformedProfileCount: 0,
  };
}

async function openDatabase(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return null;
  const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
  request.onupgradeneeded = () => {
    const database = request.result;
    if (!database.objectStoreNames.contains(PROFILE_STORE_NAME)) {
      database.createObjectStore(PROFILE_STORE_NAME);
    }
    if (!database.objectStoreNames.contains(PREFERENCES_STORE_NAME)) {
      database.createObjectStore(PREFERENCES_STORE_NAME);
    }
  };
  return requestToPromise(request);
}

async function withWriteTransaction(
  storeNames: string[],
  mutate: (transaction: IDBTransaction) => void,
): Promise<void> {
  const database = await openDatabase();
  if (!database) throw new Error("Saved customers are unavailable in this browser.");
  try {
    const transaction = database.transaction(storeNames, "readwrite");
    mutate(transaction);
    await transactionToPromise(transaction);
  } finally {
    database.close();
  }
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed."));
  });
}

function transactionToPromise(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("IndexedDB transaction failed."));
    transaction.onabort = () => reject(transaction.error ?? new Error("IndexedDB transaction aborted."));
  });
}
```

- [ ] **Step 4: Run storage tests, including request and transaction failures**

Run: `pnpm test src/utils/browserOAuthProfileStorage.test.ts`

Expected: PASS with dedicated-store, CRUD, atomic deletion, malformed-record, unavailable-browser, request-failure, and transaction-abort cases green.

- [ ] **Step 5: Commit browser persistence**

```bash
git add src/utils/browserOAuthProfileStorage.ts src/utils/browserOAuthProfileStorage.test.ts
git commit -m "feat: persist OAuth customer profiles"
```

### Task 4: Add the Profile Hydration and Mutation Hook

**Files:**
- Create: `src/hooks/useOAuthCustomerProfiles.ts`
- Create: `src/hooks/useOAuthCustomerProfiles.test.tsx`

- [ ] **Step 1: Write failing hook tests with injected storage operations**

```tsx
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type {
  OAuthCustomerProfile,
  OAuthCustomerProfileDraft,
} from "../domain/oauthCustomerProfiles";
import {
  useOAuthCustomerProfiles,
  type OAuthCustomerProfileStorageOperations,
} from "./useOAuthCustomerProfiles";

function createProfile(): OAuthCustomerProfile {
  return {
    schemaVersion: 1,
    id: "profile-1",
    customerName: "Demo Customer",
    baseUrl: "https://demo.stackenterprise.co",
    oauthClientId: "client-123",
    includeNoExpiry: false,
    createdAt: "2026-08-19T12:00:00.000Z",
    updatedAt: "2026-08-19T12:00:00.000Z",
  };
}

function validDraft(): OAuthCustomerProfileDraft {
  const { customerName, baseUrl, oauthClientId, includeNoExpiry } = createProfile();
  return { customerName, baseUrl, oauthClientId, includeNoExpiry };
}

function emptyAvailableSnapshot() {
  return {
    available: true,
    profiles: [],
    preferences: { schemaVersion: 1 as const },
    malformedProfileCount: 0,
  };
}

function createStorage(snapshot = emptyAvailableSnapshot()) {
  return {
    load: vi.fn().mockResolvedValue(snapshot),
    saveProfile: vi.fn().mockResolvedValue(undefined),
    saveLastSelectedProfileId: vi.fn().mockResolvedValue(undefined),
    deleteProfile: vi.fn().mockResolvedValue(undefined),
  } satisfies OAuthCustomerProfileStorageOperations;
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

it("hydrates the valid last-selected profile", async () => {
  const profile = createProfile();
  const storage = createStorage({
    available: true,
    profiles: [profile],
    preferences: { schemaVersion: 1, lastSelectedProfileId: profile.id },
    malformedProfileCount: 0,
  });
  const { result } = renderHook(() => useOAuthCustomerProfiles(storage));
  await waitFor(() => expect(result.current.ready).toBe(true));
  expect(result.current.selectedProfileId).toBe(profile.id);
  expect(result.current.selectedProfile).toEqual(profile);
});

it("clears a stale last-selected preference", async () => {
  const storage = createStorage({
    available: true,
    profiles: [],
    preferences: { schemaVersion: 1, lastSelectedProfileId: "missing" },
    malformedProfileCount: 0,
  });
  const { result } = renderHook(() => useOAuthCustomerProfiles(storage));
  await waitFor(() => expect(result.current.ready).toBe(true));
  expect(storage.saveLastSelectedProfileId).toHaveBeenCalledWith(undefined);
  expect(result.current.selectedProfileId).toBeUndefined();
});

it("does not update visible profiles when a create write fails", async () => {
  const storage = createStorage(emptyAvailableSnapshot());
  storage.saveProfile.mockRejectedValue(new Error("write failed"));
  const { result } = renderHook(() => useOAuthCustomerProfiles(storage));
  await waitFor(() => expect(result.current.ready).toBe(true));
  await act(async () => {
    const mutation = await result.current.createProfile(validDraft());
    expect(mutation.ok).toBe(false);
  });
  expect(result.current.profiles).toEqual([]);
  expect(result.current.warning).toBe("Customer profile changes could not be saved. Try again.");
});

it("serializes preference writes", async () => {
  const firstWrite = deferred<void>();
  const storage = createStorage(emptyAvailableSnapshot());
  storage.saveLastSelectedProfileId.mockReturnValueOnce(firstWrite.promise).mockResolvedValueOnce();
  const { result } = renderHook(() => useOAuthCustomerProfiles(storage));
  await waitFor(() => expect(result.current.ready).toBe(true));
  let firstSelection!: Promise<void>;
  let secondSelection!: Promise<void>;
  act(() => {
    firstSelection = result.current.selectProfile("profile-1");
    secondSelection = result.current.selectProfile(undefined);
  });
  await waitFor(() => expect(storage.saveLastSelectedProfileId).toHaveBeenCalledTimes(1));
  firstWrite.resolve();
  await act(async () => { await Promise.all([firstSelection, secondSelection]); });
  expect(storage.saveLastSelectedProfileId.mock.calls).toEqual([["profile-1"], [undefined]]);
});
```

Append the remaining state and failure assertions:

```tsx
it("keeps manual OAuth available when profile storage is unavailable", async () => {
  const storage = createStorage({
    available: false,
    profiles: [],
    preferences: { schemaVersion: 1 },
    malformedProfileCount: 0,
  });
  const { result } = renderHook(() => useOAuthCustomerProfiles(storage));
  await waitFor(() => expect(result.current.ready).toBe(true));
  expect(result.current.available).toBe(false);
  expect(result.current.warning).toMatch(/enter OAuth details manually/i);
});

it("reports malformed records while retaining valid profiles", async () => {
  const storage = createStorage({
    available: true,
    profiles: [createProfile()],
    preferences: { schemaVersion: 1 },
    malformedProfileCount: 2,
  });
  const { result } = renderHook(() => useOAuthCustomerProfiles(storage));
  await waitFor(() => expect(result.current.ready).toBe(true));
  expect(result.current.profiles).toEqual([createProfile()]);
  expect(result.current.warning).toBe("One or more saved customer profiles could not be read.");
});

it("persists selection, updates the selected profile, and deletes it", async () => {
  const profile = createProfile();
  const storage = createStorage({
    available: true,
    profiles: [profile],
    preferences: { schemaVersion: 1 },
    malformedProfileCount: 0,
  });
  const { result } = renderHook(() => useOAuthCustomerProfiles(storage));
  await waitFor(() => expect(result.current.ready).toBe(true));
  await act(async () => { await result.current.selectProfile(profile.id); });
  expect(storage.saveLastSelectedProfileId).toHaveBeenCalledWith(profile.id);
  await act(async () => {
    await result.current.updateProfile({ ...validDraft(), oauthClientId: "client-456" });
  });
  expect(result.current.selectedProfile?.oauthClientId).toBe("client-456");
  await act(async () => { expect(await result.current.deleteSelectedProfile()).toBe(true); });
  expect(storage.deleteProfile).toHaveBeenCalledWith(profile.id);
  expect(result.current.profiles).toEqual([]);
  expect(result.current.selectedProfileId).toBeUndefined();
});

it("retains the selected profile when delete fails", async () => {
  const profile = createProfile();
  const storage = createStorage({
    available: true,
    profiles: [profile],
    preferences: { schemaVersion: 1, lastSelectedProfileId: profile.id },
    malformedProfileCount: 0,
  });
  storage.deleteProfile.mockRejectedValue(new Error("delete failed"));
  const { result } = renderHook(() => useOAuthCustomerProfiles(storage));
  await waitFor(() => expect(result.current.ready).toBe(true));
  await act(async () => { expect(await result.current.deleteSelectedProfile()).toBe(false); });
  expect(result.current.selectedProfile).toEqual(profile);
  expect(result.current.warning).toBe("Customer profile changes could not be saved. Try again.");
});
```

- [ ] **Step 2: Run the hook tests and confirm the missing-module failure**

Run: `pnpm test src/hooks/useOAuthCustomerProfiles.test.tsx`

Expected: FAIL because the hook module does not exist.

- [ ] **Step 3: Implement the hook with an injectable storage boundary**

Export `OAuthCustomerProfileStorageOperations` and default it to the functions from `browserOAuthProfileStorage.ts`. The hook returns this stable shape:

```ts
export interface UseOAuthCustomerProfilesResult {
  profiles: OAuthCustomerProfile[];
  selectedProfile?: OAuthCustomerProfile;
  selectedProfileId?: string;
  ready: boolean;
  available: boolean;
  busy: boolean;
  warning: string | null;
  selectProfile: (profileId?: string) => Promise<void>;
  createProfile: (draft: OAuthCustomerProfileDraft) => Promise<OAuthCustomerProfileMutationResult>;
  updateProfile: (draft: OAuthCustomerProfileDraft) => Promise<OAuthCustomerProfileMutationResult>;
  deleteSelectedProfile: () => Promise<boolean>;
  clearWarning: () => void;
}
```

Implement the hook with `profilesRef` and `selectedProfileIdRef` alongside React state so queued mutations always read the latest committed state. Use this storage mapping and queue:

```ts
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  createOAuthCustomerProfile,
  updateOAuthCustomerProfile,
  type OAuthCustomerProfile,
  type OAuthCustomerProfileDraft,
  type OAuthCustomerProfileMutationResult,
} from "../domain/oauthCustomerProfiles";
import {
  deleteOAuthCustomerProfile,
  loadOAuthCustomerProfileStore,
  saveLastSelectedOAuthCustomerProfileId,
  saveOAuthCustomerProfile,
  type OAuthCustomerProfileStoreSnapshot,
} from "../utils/browserOAuthProfileStorage";

export interface OAuthCustomerProfileStorageOperations {
  load: () => Promise<OAuthCustomerProfileStoreSnapshot>;
  saveProfile: (profile: OAuthCustomerProfile) => Promise<void>;
  saveLastSelectedProfileId: (profileId?: string) => Promise<void>;
  deleteProfile: (profileId: string) => Promise<void>;
}

const defaultStorage: OAuthCustomerProfileStorageOperations = {
  load: loadOAuthCustomerProfileStore,
  saveProfile: saveOAuthCustomerProfile,
  saveLastSelectedProfileId: saveLastSelectedOAuthCustomerProfileId,
  deleteProfile: deleteOAuthCustomerProfile,
};

export function useOAuthCustomerProfiles(
  storage: OAuthCustomerProfileStorageOperations = defaultStorage,
): UseOAuthCustomerProfilesResult {
  const [profiles, setProfilesState] = useState<OAuthCustomerProfile[]>([]);
  const [selectedProfileId, setSelectedProfileIdState] = useState<string>();
  const [ready, setReady] = useState(false);
  const [available, setAvailable] = useState(true);
  const [busy, setBusy] = useState(false);
  const [warning, setWarning] = useState<string | null>(null);
  const profilesRef = useRef<OAuthCustomerProfile[]>([]);
  const selectedProfileIdRef = useRef<string>();
  const mountedRef = useRef(true);
  const mutationQueueRef = useRef<Promise<void>>(Promise.resolve());

  const setProfiles = useCallback((next: OAuthCustomerProfile[]) => {
    profilesRef.current = next;
    if (mountedRef.current) setProfilesState(next);
  }, []);
  const setSelectedProfileId = useCallback((next?: string) => {
    selectedProfileIdRef.current = next;
    if (mountedRef.current) setSelectedProfileIdState(next);
  }, []);
  const enqueue = useCallback(<T,>(operation: () => Promise<T>): Promise<T> => {
    const result = mutationQueueRef.current.catch(() => undefined).then(operation);
    mutationQueueRef.current = result.then(() => undefined, () => undefined);
    return result;
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    storage.load().then((snapshot) => {
      if (!mountedRef.current) return;
      setAvailable(snapshot.available);
      setProfiles(snapshot.profiles);
      const restoredId = snapshot.preferences.lastSelectedProfileId;
      const restored = restoredId && snapshot.profiles.some((profile) => profile.id === restoredId)
        ? restoredId
        : undefined;
      setSelectedProfileId(restored);
      if (!snapshot.available) setWarning(UNAVAILABLE_WARNING);
      else if (snapshot.malformedProfileCount > 0) setWarning(CORRUPT_WARNING);
      if (restoredId && !restored && snapshot.available) {
        void enqueue(() => storage.saveLastSelectedProfileId(undefined)).catch(() => {
          if (mountedRef.current) setWarning(WRITE_WARNING);
        });
      }
    }).catch(() => {
      if (mountedRef.current) {
        setAvailable(false);
        setWarning(UNAVAILABLE_WARNING);
      }
    }).finally(() => {
      if (mountedRef.current) setReady(true);
    });
    return () => { mountedRef.current = false; };
  }, [enqueue, setProfiles, setSelectedProfileId, storage]);

  const selectProfile = useCallback(async (profileId?: string) => {
    setSelectedProfileId(profileId);
    try {
      await enqueue(() => storage.saveLastSelectedProfileId(profileId));
    } catch {
      if (mountedRef.current) setWarning(WRITE_WARNING);
    }
  }, [enqueue, setSelectedProfileId, storage]);

  const createProfile = useCallback(async (draft: OAuthCustomerProfileDraft) => {
    const result = createOAuthCustomerProfile(draft, profilesRef.current);
    if (!result.ok) return result;
    setBusy(true);
    try {
      await enqueue(async () => {
        await storage.saveProfile(result.profile);
        await storage.saveLastSelectedProfileId(result.profile.id);
      });
      setProfiles([...profilesRef.current, result.profile].sort(compareProfiles));
      setSelectedProfileId(result.profile.id);
      return result;
    } catch {
      if (mountedRef.current) setWarning(WRITE_WARNING);
      return { ok: false, errors: {} } as OAuthCustomerProfileMutationResult;
    } finally {
      if (mountedRef.current) setBusy(false);
    }
  }, [enqueue, setProfiles, setSelectedProfileId, storage]);

  const updateProfile = useCallback(async (draft: OAuthCustomerProfileDraft) => {
    const selected = profilesRef.current.find((profile) => profile.id === selectedProfileIdRef.current);
    if (!selected) return { ok: false, errors: {} } as OAuthCustomerProfileMutationResult;
    const result = updateOAuthCustomerProfile(selected, draft, profilesRef.current);
    if (!result.ok) return result;
    setBusy(true);
    try {
      await enqueue(() => storage.saveProfile(result.profile));
      setProfiles(profilesRef.current.map((profile) =>
        profile.id === result.profile.id ? result.profile : profile,
      ).sort(compareProfiles));
      return result;
    } catch {
      if (mountedRef.current) setWarning(WRITE_WARNING);
      return { ok: false, errors: {} } as OAuthCustomerProfileMutationResult;
    } finally {
      if (mountedRef.current) setBusy(false);
    }
  }, [enqueue, setProfiles, storage]);

  const deleteSelectedProfile = useCallback(async () => {
    const profileId = selectedProfileIdRef.current;
    if (!profileId) return false;
    setBusy(true);
    try {
      await enqueue(() => storage.deleteProfile(profileId));
      setProfiles(profilesRef.current.filter((profile) => profile.id !== profileId));
      setSelectedProfileId(undefined);
      return true;
    } catch {
      if (mountedRef.current) setWarning(WRITE_WARNING);
      return false;
    } finally {
      if (mountedRef.current) setBusy(false);
    }
  }, [enqueue, setProfiles, setSelectedProfileId, storage]);

  const selectedProfile = useMemo(
    () => profiles.find((profile) => profile.id === selectedProfileId),
    [profiles, selectedProfileId],
  );
  return {
    profiles, selectedProfile, selectedProfileId, ready, available, busy, warning,
    selectProfile, createProfile, updateProfile, deleteSelectedProfile,
    clearWarning: () => setWarning(null),
  };
}

function compareProfiles(left: OAuthCustomerProfile, right: OAuthCustomerProfile): number {
  return left.customerName.localeCompare(right.customerName);
}
```

Set exact warning copy:

```ts
const UNAVAILABLE_WARNING =
  "Saved customers are unavailable in this browser. You can still enter OAuth details manually.";
const CORRUPT_WARNING =
  "One or more saved customer profiles could not be read.";
const WRITE_WARNING =
  "Customer profile changes could not be saved. Try again.";
```

- [ ] **Step 4: Run hook and domain suites**

Run: `pnpm test src/hooks/useOAuthCustomerProfiles.test.tsx src/domain/oauthCustomerProfiles.test.ts`

Expected: PASS with no React `act` warnings.

- [ ] **Step 5: Commit the hook**

```bash
git add src/hooks/useOAuthCustomerProfiles.ts src/hooks/useOAuthCustomerProfiles.test.tsx
git commit -m "feat: manage OAuth customer profile state"
```

### Task 5: Expose the Server-Controlled OAuth Redirect URL

**Files:**
- Modify: `src/server/oauthPkceApi.ts:31-165,552-614`
- Modify: `src/server/oauthPkceApi.test.ts:1-460`
- Create: `src/app/api/oauth/pkce/config/route.ts`

- [ ] **Step 1: Write failing public-configuration tests**

Add the config route import and tests to `src/server/oauthPkceApi.test.ts`:

```ts
import { GET as handleOAuthPkceConfigRouteGet } from "../app/api/oauth/pkce/config/route";
import { handleOAuthPkcePublicConfigRequest } from "./oauthPkceApi";

it("returns the request-origin callback used by OAuth start", async () => {
  const result = handleOAuthPkcePublicConfigRequest({ origin });
  await expect(result.response.json()).resolves.toEqual({
    ok: true,
    redirectUri: `${origin}/api/oauth/pkce/callback`,
  });
  expect(result.response.headers.get("Cache-Control")).toBe("no-store, private");
  expect(result.response.headers.get("Referrer-Policy")).toBe("no-referrer");
});

it("returns the configured redirect URI exactly as OAuth start uses it", async () => {
  const result = handleOAuthPkcePublicConfigRequest({
    origin: redirectmetoOrigin,
    redirectUri: redirectmetoCallbackUri,
  });
  await expect(result.response.json()).resolves.toEqual({
    ok: true,
    redirectUri: redirectmetoCallbackUri,
  });
});

it("rejects unsafe redirect configuration", async () => {
  const result = handleOAuthPkcePublicConfigRequest({
    origin,
    redirectUri: "https://evil.example/api/oauth/pkce/callback",
  });
  expect(result.response.status).toBe(400);
  await expect(result.response.json()).resolves.toEqual({
    ok: false,
    error: "OAuth redirect URL is not configured safely.",
  });
});

it("preserves public config through the Next route", async () => {
  const response = await handleOAuthPkceConfigRouteGet(
    new NextRequest(`${origin}/api/oauth/pkce/config`),
  );
  await expect(response.json()).resolves.toEqual({
    ok: true,
    redirectUri: `${origin}/api/oauth/pkce/callback`,
  });
});
```

- [ ] **Step 2: Run the server test and confirm missing exports**

Run: `pnpm test src/server/oauthPkceApi.test.ts`

Expected: FAIL because the config route and `handleOAuthPkcePublicConfigRequest` do not exist.

- [ ] **Step 3: Add the shared public-config result**

In `src/server/oauthPkceApi.ts`, export:

```ts
export type OAuthPkcePublicConfigResponseBody =
  | { ok: true; redirectUri: string }
  | { ok: false; error: string };

export function handleOAuthPkcePublicConfigRequest(
  dependencies: Pick<OAuthPkceDependencies, "origin" | "publicOrigin" | "redirectUri">,
): OAuthPkceRouteResult {
  const target = resolveOAuthRedirectTarget(
    dependencies.redirectUri,
    dependencies.publicOrigin,
    dependencies.origin ?? "http://127.0.0.1:3000",
  );
  if (!target) {
    return {
      response: jsonResponse(
        { ok: false, error: "OAuth redirect URL is not configured safely." },
        400,
      ),
    };
  }
  return {
    response: jsonResponse({ ok: true, redirectUri: target.redirectUri }, 200),
  };
}
```

This function must call the same private `resolveOAuthRedirectTarget` as `handleOAuthPkceStartRequest`; do not duplicate redirect parsing.

Create `src/app/api/oauth/pkce/config/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { handleOAuthPkcePublicConfigRequest } from "../../../../../server/oauthPkceApi";

export const runtime = "nodejs";

export async function GET(request: NextRequest): Promise<NextResponse> {
  const result = handleOAuthPkcePublicConfigRequest({
    origin: new URL(request.url).origin,
    publicOrigin:
      process.env.STACK_API_UTILITIES_PUBLIC_ORIGIN ??
      process.env.NEXT_PUBLIC_STACK_API_UTILITIES_PUBLIC_ORIGIN,
    redirectUri: process.env.STACK_API_UTILITIES_OAUTH_REDIRECT_URI,
  });
  return NextResponse.json(await result.response.json(), {
    status: result.response.status,
    headers: result.response.headers,
  });
}
```

- [ ] **Step 4: Run server and PKCE tests**

Run: `pnpm test src/server/oauthPkceApi.test.ts src/auth/oauthPkce.test.ts`

Expected: PASS, including existing public-origin and redirectmeto security cases.

- [ ] **Step 5: Commit the public configuration endpoint**

```bash
git add src/server/oauthPkceApi.ts src/server/oauthPkceApi.test.ts src/app/api/oauth/pkce/config/route.ts
git commit -m "feat: expose OAuth redirect configuration"
```

### Task 6: Build the Explicit Profile Manager UI

**Files:**
- Create: `src/components/OAuthCustomerProfileManager.tsx`
- Create: `src/components/OAuthCustomerProfileManager.test.tsx`
- Modify: `src/styles/app.css:791-828`

- [ ] **Step 1: Write failing interaction tests**

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { OAuthCustomerProfile } from "../domain/oauthCustomerProfiles";
import {
  OAuthCustomerProfileManager,
  type OAuthCustomerProfileManagerProps,
} from "./OAuthCustomerProfileManager";

function createProfile(): OAuthCustomerProfile {
  return {
    schemaVersion: 1,
    id: "profile-1",
    customerName: "Demo Customer",
    baseUrl: "https://demo.stackenterprise.co",
    oauthClientId: "client-123",
    includeNoExpiry: false,
    createdAt: "2026-08-19T12:00:00.000Z",
    updatedAt: "2026-08-19T12:00:00.000Z",
  };
}

function renderManager(overrides: Partial<OAuthCustomerProfileManagerProps> = {}) {
  return render(
    <OAuthCustomerProfileManager
      profiles={[]}
      customerName=""
      dirty={false}
      ready
      available
      busy={false}
      errors={{}}
      warning={null}
      onCustomerNameChange={vi.fn()}
      onSelect={vi.fn()}
      onSave={vi.fn()}
      onUpdate={vi.fn()}
      onDelete={vi.fn()}
      {...overrides}
    />,
  );
}

it("selects a saved customer and exposes explicit profile actions", async () => {
  const user = userEvent.setup();
  const onSelect = vi.fn();
  renderManager({ profiles: [createProfile()], onSelect });
  await user.selectOptions(screen.getByLabelText("Saved customer"), "profile-1");
  expect(onSelect).toHaveBeenCalledWith("profile-1");
  expect(screen.getByRole("button", { name: "Update customer" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Delete customer" })).toBeInTheDocument();
});

it("requires confirmation before discarding dirty edits", async () => {
  const user = userEvent.setup();
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
  const onSelect = vi.fn();
  renderManager({ profiles: [createProfile()], selectedProfileId: "profile-1", dirty: true, onSelect });
  await user.click(screen.getByRole("button", { name: "New customer" }));
  expect(confirm).toHaveBeenCalledWith("Discard unsaved customer profile changes?");
  expect(onSelect).not.toHaveBeenCalled();
});

it("requires confirmation before delete", async () => {
  const user = userEvent.setup();
  vi.spyOn(window, "confirm").mockReturnValue(true);
  const onDelete = vi.fn();
  renderManager({ profiles: [createProfile()], selectedProfileId: "profile-1", onDelete });
  await user.click(screen.getByRole("button", { name: "Delete customer" }));
  expect(onDelete).toHaveBeenCalledTimes(1);
});

it("renders field errors and persistence warnings accessibly", () => {
  renderManager({
    errors: { customerName: "Use a unique customer name." },
    warning: "Customer profile changes could not be saved. Try again.",
  });
  expect(screen.getByText("Use a unique customer name.")).toHaveAttribute("role", "alert");
  expect(screen.getByText(/could not be saved/i)).toHaveAttribute("role", "status");
});
```

- [ ] **Step 2: Run the component test and confirm the missing-module failure**

Run: `pnpm test src/components/OAuthCustomerProfileManager.test.tsx`

Expected: FAIL because the profile manager component does not exist.

- [ ] **Step 3: Implement the controlled profile manager**

The component accepts only non-sensitive values and callbacks:

```ts
export interface OAuthCustomerProfileManagerProps {
  profiles: readonly OAuthCustomerProfile[];
  selectedProfileId?: string;
  customerName: string;
  dirty: boolean;
  ready: boolean;
  available: boolean;
  busy: boolean;
  errors: OAuthCustomerProfileErrors;
  warning: string | null;
  onCustomerNameChange: (value: string) => void;
  onSelect: (profileId?: string) => void;
  onSave: () => void;
  onUpdate: () => void;
  onDelete: () => void;
}
```

Implement the controlled component as follows:

```tsx
import type {
  OAuthCustomerProfile,
  OAuthCustomerProfileErrors,
} from "../domain/oauthCustomerProfiles";

export function OAuthCustomerProfileManager({
  profiles,
  selectedProfileId,
  customerName,
  dirty,
  ready,
  available,
  busy,
  errors,
  warning,
  onCustomerNameChange,
  onSelect,
  onSave,
  onUpdate,
  onDelete,
}: OAuthCustomerProfileManagerProps) {
  function requestSelection(profileId?: string) {
    if (profileId === selectedProfileId) return;
    if (dirty && !window.confirm("Discard unsaved customer profile changes?")) return;
    onSelect(profileId);
  }

  function requestDelete() {
    if (window.confirm(
      "Delete this saved customer profile? Active session credentials will not be removed.",
    )) onDelete();
  }

  return (
    <section className="oauth-profile-manager" aria-labelledby="saved-customer-heading">
      <div>
        <p className="scope-label">Browser-local OAuth setup</p>
        <h3 className="fs-body2 mb8" id="saved-customer-heading">Saved customer</h3>
        <p className="oauth-status">Only non-sensitive setup is stored in this browser.</p>
      </div>
      <div className="oauth-profile-grid">
        <label className="d-block">
          <span className="d-block fs-caption tt-uppercase fc-light mb4">Saved customer</span>
          <select
            className="s-select"
            aria-label="Saved customer"
            value={selectedProfileId ?? ""}
            disabled={!ready || busy}
            onChange={(event) => requestSelection(event.currentTarget.value || undefined)}
          >
            <option value="">New customer</option>
            {profiles.map((profile) => (
              <option key={profile.id} value={profile.id}>{profile.customerName}</option>
            ))}
          </select>
        </label>
        <label className="d-block">
          <span className="d-block fs-caption tt-uppercase fc-light mb4">Customer name</span>
          <input
            className="s-input"
            aria-label="Customer name"
            aria-describedby={errors.customerName ? "oauth-customer-name-error" : undefined}
            value={customerName}
            disabled={busy}
            onChange={(event) => onCustomerNameChange(event.currentTarget.value)}
          />
        </label>
      </div>
      {errors.customerName && (
        <p className="oauth-profile-error" id="oauth-customer-name-error" role="alert">
          {errors.customerName}
        </p>
      )}
      {dirty && <p className="oauth-profile-dirty">Unsaved customer profile changes.</p>}
      <div className="oauth-profile-actions">
        <button className="s-btn" type="button" disabled={busy} onClick={() => requestSelection(undefined)}>
          New customer
        </button>
        {selectedProfileId ? (
          <>
            <button className="s-btn s-btn__primary" type="button" disabled={!available || busy || !dirty} onClick={onUpdate}>
              Update customer
            </button>
            <button className="s-btn s-btn__danger" type="button" disabled={!available || busy} onClick={requestDelete}>
              Delete customer
            </button>
          </>
        ) : (
          <button className="s-btn s-btn__primary" type="button" disabled={!available || busy} onClick={onSave}>
            Save customer
          </button>
        )}
      </div>
      {warning && <p className="oauth-status" role="status">{warning}</p>}
    </section>
  );
}
```

Add these styles:

```css
.oauth-profile-manager {
  display: grid;
  gap: 12px;
  padding: 14px;
  border: 1px solid var(--so-border);
  border-radius: 8px;
  background: var(--so-surface-raised);
}

.oauth-profile-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 12px;
}

.oauth-profile-actions,
.oauth-redirect-row {
  display: flex;
  flex-wrap: wrap;
  align-items: end;
  gap: 8px;
}

.oauth-redirect-row > label { flex: 1 1 420px; }
.oauth-profile-dirty { margin: 0; color: var(--so-text-muted); font-size: 13px; }
.oauth-profile-error { margin: 0; color: var(--so-red); font-size: 13px; }
```

- [ ] **Step 4: Run profile manager tests**

Run: `pnpm test src/components/OAuthCustomerProfileManager.test.tsx`

Expected: PASS for selection, explicit actions, both confirmations, field errors, warning semantics, and disabled mutation controls.

- [ ] **Step 5: Commit the profile manager**

```bash
git add src/components/OAuthCustomerProfileManager.tsx src/components/OAuthCustomerProfileManager.test.tsx src/styles/app.css
git commit -m "feat: add OAuth customer profile controls"
```

### Task 7: Integrate Profiles and Redirect Copy into Credentials

**Files:**
- Modify: `src/components/CredentialsPanel.tsx:1-520`
- Modify: `src/components/CredentialsPanel.test.tsx:1-735`

- [ ] **Step 1: Update the fetch test helper and write failing integration tests**

Replace the existing Vitest import with the first line below, then add the type imports, storage mocks, and fetch helper:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OAuthCustomerProfile } from "../domain/oauthCustomerProfiles";
import type { OAuthCustomerProfileStoreSnapshot } from "../utils/browserOAuthProfileStorage";

const profileStorageMocks = vi.hoisted(() => ({
  load: vi.fn(),
  saveProfile: vi.fn(),
  saveLastSelectedProfileId: vi.fn(),
  deleteProfile: vi.fn(),
}));

vi.mock("../utils/browserOAuthProfileStorage", () => ({
  loadOAuthCustomerProfileStore: profileStorageMocks.load,
  saveOAuthCustomerProfile: profileStorageMocks.saveProfile,
  saveLastSelectedOAuthCustomerProfileId: profileStorageMocks.saveLastSelectedProfileId,
  deleteOAuthCustomerProfile: profileStorageMocks.deleteProfile,
}));

beforeEach(() => {
  profileStorageMocks.load.mockReset().mockResolvedValue({
    available: true,
    profiles: [],
    preferences: { schemaVersion: 1 },
    malformedProfileCount: 0,
  });
  profileStorageMocks.saveProfile.mockReset().mockResolvedValue(undefined);
  profileStorageMocks.saveLastSelectedProfileId.mockReset().mockResolvedValue(undefined);
  profileStorageMocks.deleteProfile.mockReset().mockResolvedValue(undefined);
});

function mockOAuthEndpoints(authorizationUrl = "https://demo.stackenterprise.co/oauth?state=abc") {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    if (String(input) === "/api/oauth/pkce/config") {
      return jsonResponse({
        ok: true,
        redirectUri: "https://utilities.example.com/api/oauth/pkce/callback",
      });
    }
    if (String(input) === "/api/oauth/pkce/start" && init?.method === "POST") {
      return jsonResponse({ ok: true, authorizationUrl });
    }
    throw new Error(`Unexpected fetch: ${String(input)}`);
  });
}

function enterpriseProfile(): OAuthCustomerProfile {
  return {
    schemaVersion: 1,
    id: "profile-1",
    customerName: "Demo Customer",
    baseUrl: "https://demo.stackenterprise.co",
    oauthClientId: "client-123",
    includeNoExpiry: false,
    createdAt: "2026-08-19T12:00:00.000Z",
    updatedAt: "2026-08-19T12:00:00.000Z",
  };
}

function installProfileStorage(options: {
  profiles?: OAuthCustomerProfile[];
  lastSelectedProfileId?: string;
  available?: boolean;
  malformedProfileCount?: number;
} = {}) {
  const savedProfiles: OAuthCustomerProfile[] = [];
  profileStorageMocks.load.mockResolvedValue({
    available: options.available ?? true,
    profiles: options.profiles ?? [],
    preferences: {
      schemaVersion: 1,
      ...(options.lastSelectedProfileId
        ? { lastSelectedProfileId: options.lastSelectedProfileId }
        : {}),
    },
    malformedProfileCount: options.malformedProfileCount ?? 0,
  });
  profileStorageMocks.saveProfile.mockImplementation(async (profile: OAuthCustomerProfile) => {
    savedProfiles.push(profile);
  });
  return { savedProfiles };
}

function installDeferredProfileStorage() {
  let resolve!: (snapshot: OAuthCustomerProfileStoreSnapshot) => void;
  profileStorageMocks.load.mockReturnValue(new Promise((resolvePromise) => {
    resolve = resolvePromise;
  }));
  return {
    resolve: ({ profiles, lastSelectedProfileId }: {
      profiles: OAuthCustomerProfile[];
      lastSelectedProfileId?: string;
    }) => resolve({
      available: true,
      profiles,
      preferences: { schemaVersion: 1, ...(lastSelectedProfileId ? { lastSelectedProfileId } : {}) },
      malformedProfileCount: 0,
    }),
  };
}
```

Replace existing OAuth-start mocks with this helper and find the POST call by URL rather than assuming `mock.calls[0]`.

Write these integration cases:

```tsx
it("restores the last selected customer into a pristine Enterprise draft", async () => {
  installProfileStorage({ profiles: [enterpriseProfile()], lastSelectedProfileId: "profile-1" });
  renderCredentialsPanel();
  await userEvent.setup().selectOptions(screen.getByLabelText("Instance type"), "enterprise");
  expect(await screen.findByLabelText("Saved customer")).toHaveValue("profile-1");
  expect(screen.getByLabelText("Customer name")).toHaveValue("Demo Customer");
  expect(screen.getByLabelText("Instance URL")).toHaveValue("https://demo.stackenterprise.co");
  expect(screen.getByLabelText("OAuth Client ID")).toHaveValue("client-123");
  expect(screen.getByLabelText("Request non-expiring token")).not.toBeChecked();
});

it("does not let late profile hydration overwrite user edits", async () => {
  const storage = installDeferredProfileStorage();
  renderCredentialsPanel();
  const user = userEvent.setup();
  await user.selectOptions(screen.getByLabelText("Instance type"), "enterprise");
  await user.type(screen.getByLabelText("Instance URL"), "https://manual.stackenterprise.co");
  storage.resolve({ profiles: [enterpriseProfile()], lastSelectedProfileId: "profile-1" });
  await waitFor(() => expect(screen.getByLabelText("Saved customer")).toBeInTheDocument());
  expect(screen.getByLabelText("Instance URL")).toHaveValue("https://manual.stackenterprise.co");
});

it("saves only non-sensitive profile fields", async () => {
  const storage = installProfileStorage();
  renderCredentialsPanel({ credentials: enterpriseOAuthCredentials() });
  const user = userEvent.setup();
  await user.type(screen.getByLabelText("Customer name"), "Demo Customer");
  await user.click(screen.getByRole("button", { name: "Save customer" }));
  await waitFor(() => expect(storage.savedProfiles).toHaveLength(1));
  expect(storage.savedProfiles[0]).toMatchObject({
    customerName: "Demo Customer",
    baseUrl: "https://demo.stackenterprise.co",
    oauthClientId: "client-123",
  });
  expect(JSON.stringify(storage.savedProfiles)).not.toMatch(/accessToken|apiKey|pat|oauthScopes|authSource/);
});

it("starts OAuth from a selected profile without persisting workflow scopes", async () => {
  const fetchMock = mockOAuthEndpoints();
  installProfileStorage({ profiles: [enterpriseProfile()], lastSelectedProfileId: "profile-1" });
  renderCredentialsPanel({ workflow: { kind: "write-tool", writeToolId: "user-group-sync" } });
  const user = userEvent.setup();
  await user.selectOptions(screen.getByLabelText("Instance type"), "enterprise");
  await user.click(screen.getByRole("button", { name: "Connect with Enterprise OAuth" }));
  const startCall = fetchMock.mock.calls.find(([url]) => String(url) === "/api/oauth/pkce/start");
  expect(JSON.parse(String(startCall?.[1]?.body))).toEqual({
    baseUrl: "https://demo.stackenterprise.co",
    clientId: "client-123",
    scopes: ["write_access"],
    includeNoExpiry: false,
  });
});

it("shows and copies the server-controlled redirect URL", async () => {
  mockOAuthEndpoints();
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.assign(navigator, { clipboard: { writeText } });
  renderCredentialsPanel();
  await userEvent.setup().selectOptions(screen.getByLabelText("Instance type"), "enterprise");
  expect(await screen.findByLabelText("OAuth redirect URL")).toHaveValue(
    "https://utilities.example.com/api/oauth/pkce/callback",
  );
  await userEvent.setup().click(screen.getByRole("button", { name: "Copy redirect URL" }));
  expect(writeText).toHaveBeenCalledWith("https://utilities.example.com/api/oauth/pkce/callback");
});
```

Append these failure and lifecycle cases:

```tsx
it("updates and deletes the selected profile without touching session credentials", async () => {
  installProfileStorage({ profiles: [enterpriseProfile()], lastSelectedProfileId: "profile-1" });
  const onSave = vi.fn();
  renderCredentialsPanel({ onSave });
  const user = userEvent.setup();
  await user.selectOptions(screen.getByLabelText("Instance type"), "enterprise");
  await screen.findByDisplayValue("Demo Customer");
  await user.clear(screen.getByLabelText("Customer name"));
  await user.type(screen.getByLabelText("Customer name"), "Renamed Customer");
  await user.click(screen.getByRole("button", { name: "Update customer" }));
  await waitFor(() => expect(profileStorageMocks.saveProfile).toHaveBeenCalledWith(
    expect.objectContaining({ id: "profile-1", customerName: "Renamed Customer" }),
  ));
  vi.spyOn(window, "confirm").mockReturnValue(true);
  await user.click(screen.getByRole("button", { name: "Delete customer" }));
  await waitFor(() => expect(profileStorageMocks.deleteProfile).toHaveBeenCalledWith("profile-1"));
  expect(screen.getByLabelText("Saved customer")).toHaveValue("");
  expect(onSave).not.toHaveBeenCalled();
});

it("keeps OAuth usable when saved-customer storage is unavailable", async () => {
  installProfileStorage({ available: false });
  const fetchMock = mockOAuthEndpoints();
  vi.spyOn(window, "open").mockReturnValue(createPopup() as unknown as Window);
  renderCredentialsPanel();
  const user = userEvent.setup();
  await user.selectOptions(screen.getByLabelText("Instance type"), "enterprise");
  await user.type(screen.getByLabelText("Instance URL"), "https://demo.stackenterprise.co");
  await user.type(screen.getByLabelText("OAuth Client ID"), "client-123");
  expect(await screen.findByText(/enter OAuth details manually/i)).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Connect with Enterprise OAuth" }));
  expect(fetchMock.mock.calls.some(([url]) => String(url) === "/api/oauth/pkce/start")).toBe(true);
});

it("reports malformed saved profiles without hiding valid ones", async () => {
  installProfileStorage({
    profiles: [enterpriseProfile()],
    lastSelectedProfileId: "profile-1",
    malformedProfileCount: 1,
  });
  renderCredentialsPanel();
  await userEvent.setup().selectOptions(screen.getByLabelText("Instance type"), "enterprise");
  expect(await screen.findByText(/could not be read/i)).toBeInTheDocument();
  expect(screen.getByLabelText("Saved customer")).toHaveValue("profile-1");
});

it("keeps an edited draft when profile switching is cancelled", async () => {
  const second = { ...enterpriseProfile(), id: "profile-2", customerName: "Other Customer" };
  installProfileStorage({
    profiles: [enterpriseProfile(), second],
    lastSelectedProfileId: "profile-1",
  });
  vi.spyOn(window, "confirm").mockReturnValue(false);
  renderCredentialsPanel();
  const user = userEvent.setup();
  await user.selectOptions(screen.getByLabelText("Instance type"), "enterprise");
  await screen.findByDisplayValue("Demo Customer");
  await user.type(screen.getByLabelText("Customer name"), " edited");
  await user.selectOptions(screen.getByLabelText("Saved customer"), "profile-2");
  expect(screen.getByLabelText("Saved customer")).toHaveValue("profile-1");
  expect(screen.getByLabelText("Customer name")).toHaveValue("Demo Customer edited");
});

it("reports redirect configuration and copy failures without blocking OAuth", async () => {
  const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    if (String(input) === "/api/oauth/pkce/config") throw new Error("config failed");
    return jsonResponse({
      ok: true,
      authorizationUrl: "https://demo.stackenterprise.co/oauth?state=abc",
    });
  });
  vi.spyOn(window, "open").mockReturnValue(createPopup() as unknown as Window);
  renderCredentialsPanel();
  const user = userEvent.setup();
  await user.selectOptions(screen.getByLabelText("Instance type"), "enterprise");
  expect(await screen.findByText(/redirect URL could not be loaded/i)).toBeInTheDocument();
  await user.type(screen.getByLabelText("Instance URL"), "https://demo.stackenterprise.co");
  await user.type(screen.getByLabelText("OAuth Client ID"), "client-123");
  await user.click(screen.getByRole("button", { name: "Connect with Enterprise OAuth" }));
  expect(fetchMock.mock.calls.some(([url]) => String(url) === "/api/oauth/pkce/start")).toBe(true);
});

it("leaves the redirect URL visible when clipboard writing fails", async () => {
  mockOAuthEndpoints();
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: vi.fn().mockRejectedValue(new Error("copy failed")) },
  });
  renderCredentialsPanel();
  const user = userEvent.setup();
  await user.selectOptions(screen.getByLabelText("Instance type"), "enterprise");
  const redirectField = await screen.findByLabelText("OAuth redirect URL");
  await user.click(screen.getByRole("button", { name: "Copy redirect URL" }));
  expect(await screen.findByText(/Copy it manually/i)).toBeInTheDocument();
  expect(redirectField).toHaveValue("https://utilities.example.com/api/oauth/pkce/callback");
});
```

- [ ] **Step 2: Run credentials tests and confirm missing profile/config UI**

Run: `pnpm test src/components/CredentialsPanel.test.tsx`

Expected: FAIL because saved-customer controls, profile hydration, and redirect display are not integrated.

- [ ] **Step 3: Integrate the profile hook and manager without expanding persisted data**

In `CredentialsPanel.tsx`:

1. Add `customerName` to `CredentialsDraft`.
2. Call `useOAuthCustomerProfiles()` and derive `selectedProfile`, `profileDraft`, and `profileDirty` with the Task 2 helpers.
3. Track `profileBackedDraftEditedRef`; set it only when customer name, base URL, OAuth client ID, or `includeNoExpiry` changes through user input.
4. After hook hydration, apply the selected profile exactly once only if no profile-backed field was edited and there is no conflicting Enterprise session credential. When Enterprise session credentials exist, prefer a saved profile matching canonical base URL and client ID; otherwise retain the session values as a new unsaved draft.
5. Selecting a saved profile calls the hook preference mutation, fills only `customerName`, `baseUrl`, `oauthClientId`, and `includeNoExpiry`, and leaves `apiKey`, `accessToken`, and `pat` untouched.
6. New and successful delete clear only the four profile-backed fields. They do not call `onSave` and do not mutate session credentials.
7. Save and Update pass only `OAuthCustomerProfileDraft` into the hook and display returned field errors.
8. Keep the current OAuth request body unchanged so scopes remain workflow-derived.

Add these imports and state derivations:

```tsx
import {
  isOAuthCustomerProfileDraftDirty,
  toOAuthCustomerProfileDraft,
  type OAuthCustomerProfile,
  type OAuthCustomerProfileErrors,
  type OAuthCustomerProfileDraft,
} from "../domain/oauthCustomerProfiles";
import { useOAuthCustomerProfiles } from "../hooks/useOAuthCustomerProfiles";
import { OAuthCustomerProfileManager } from "./OAuthCustomerProfileManager";

// Add customerName: "" to the CredentialsDraft initializer.
const customerProfiles = useOAuthCustomerProfiles();
const [profileErrors, setProfileErrors] = useState<OAuthCustomerProfileErrors>({});
const [redirectUri, setRedirectUri] = useState("");
const [redirectStatus, setRedirectStatus] = useState<string | null>(null);
const profileBackedDraftEditedRef = useRef(false);
const restoredProfileAppliedRef = useRef(false);
const configRequestedRef = useRef(false);

const profileDraft: OAuthCustomerProfileDraft = {
  customerName: draft.customerName,
  baseUrl: draft.baseUrl,
  oauthClientId: draft.oauthClientId,
  includeNoExpiry: draft.includeNoExpiry,
};
const profileDirty = customerProfiles.selectedProfile
  ? isOAuthCustomerProfileDraftDirty(customerProfiles.selectedProfile, profileDraft)
  : Boolean(
      draft.customerName.trim() ||
      draft.baseUrl.trim() ||
      draft.oauthClientId.trim() ||
      draft.includeNoExpiry
    );
```

Extend `updateDraft` with a third parameter, defaulting to user input, and use it for all profile-backed inputs:

```ts
function updateDraft<Field extends keyof CredentialsDraft>(
  field: Field,
  value: CredentialsDraft[Field],
  markProfileEdited = true,
) {
  const isProfileField =
    field === "customerName" ||
    field === "baseUrl" ||
    field === "oauthClientId" ||
    field === "includeNoExpiry";
  if (markProfileEdited && isProfileField) profileBackedDraftEditedRef.current = true;
  setSaved(false);
  setOauthError(null);
  if (isProfileField) {
    setProfileErrors((current) => ({
      ...current,
      [field as keyof OAuthCustomerProfileDraft]: undefined,
    }));
  }
  setDraft((current) => ({ ...current, [field]: value }));
}

function applyProfile(profile: OAuthCustomerProfile) {
  const values = toOAuthCustomerProfileDraft(profile);
  setDraft((current) => ({ ...current, instanceType: "enterprise", ...values }));
  profileBackedDraftEditedRef.current = false;
  setProfileErrors({});
}

function clearProfileDraft() {
  setDraft((current) => ({
    ...current,
    customerName: "",
    baseUrl: "",
    oauthClientId: "",
    includeNoExpiry: false,
  }));
  profileBackedDraftEditedRef.current = false;
  setProfileErrors({});
}
```

Apply hydration once with active Enterprise credentials taking precedence over the stored last selection:

```tsx
useEffect(() => {
  if (!customerProfiles.ready || restoredProfileAppliedRef.current) return;
  restoredProfileAppliedRef.current = true;
  if (profileBackedDraftEditedRef.current) return;

  const matchingSessionProfile = credentials?.instanceType === "enterprise"
    ? customerProfiles.profiles.find((profile) =>
        canonicalizeEnterpriseBaseUrl(profile.baseUrl) ===
          canonicalizeEnterpriseBaseUrl(credentials.baseUrl) &&
        profile.oauthClientId === (credentials.oauthClientId ?? ""),
      )
    : undefined;
  if (matchingSessionProfile) {
    applyProfile(matchingSessionProfile);
    if (matchingSessionProfile.id !== customerProfiles.selectedProfileId) {
      void customerProfiles.selectProfile(matchingSessionProfile.id);
    }
    return;
  }
  if (credentials === null && customerProfiles.selectedProfile) {
    applyProfile(customerProfiles.selectedProfile);
  }
}, [customerProfiles.ready]);
```

Replace the instance-type `onChange` with a handler that applies the restored selection when the user deliberately switches from an active Basic/Business session to Enterprise:

```ts
function handleInstanceTypeChange(instanceType: InstanceType) {
  updateDraft("instanceType", instanceType, false);
  if (
    instanceType === "enterprise" &&
    customerProfiles.selectedProfile &&
    !profileBackedDraftEditedRef.current
  ) applyProfile(customerProfiles.selectedProfile);
}
```

Implement explicit profile actions:

```tsx
async function handleProfileSelection(profileId?: string) {
  await customerProfiles.selectProfile(profileId);
  const profile = customerProfiles.profiles.find((candidate) => candidate.id === profileId);
  if (profile) applyProfile(profile);
  else clearProfileDraft();
}

async function handleProfileSave() {
  const result = await customerProfiles.createProfile(profileDraft);
  if (!result.ok) setProfileErrors(result.errors);
  else applyProfile(result.profile);
}

async function handleProfileUpdate() {
  const result = await customerProfiles.updateProfile(profileDraft);
  if (!result.ok) setProfileErrors(result.errors);
  else applyProfile(result.profile);
}

async function handleProfileDelete() {
  if (await customerProfiles.deleteSelectedProfile()) clearProfileDraft();
}
```

Call `updateDraft("customerName", value)` from the manager. Render `profileErrors.baseUrl` directly below Instance URL and `profileErrors.oauthClientId` directly below OAuth Client ID with `role="alert"` and matching `aria-describedby` IDs.

Render `OAuthCustomerProfileManager` only inside the Enterprise lane and before API key/access-token fields.

```tsx
<OAuthCustomerProfileManager
  profiles={customerProfiles.profiles}
  selectedProfileId={customerProfiles.selectedProfileId}
  customerName={draft.customerName}
  dirty={profileDirty}
  ready={customerProfiles.ready}
  available={customerProfiles.available}
  busy={customerProfiles.busy}
  errors={profileErrors}
  warning={customerProfiles.warning}
  onCustomerNameChange={(value) => updateDraft("customerName", value)}
  onSelect={(profileId) => void handleProfileSelection(profileId)}
  onSave={() => void handleProfileSave()}
  onUpdate={() => void handleProfileUpdate()}
  onDelete={() => void handleProfileDelete()}
/>
```

Add a typed config response:

```ts
type OAuthPublicConfigResponse =
  | { ok: true; redirectUri: string }
  | { ok: false; error: string };
```

When Enterprise becomes active, fetch `/api/oauth/pkce/config` once per component mount. Validate the response shape before setting `redirectUri`. Render:

```tsx
useEffect(() => {
  if (!isEnterprise || configRequestedRef.current) return;
  configRequestedRef.current = true;
  let active = true;
  fetch("/api/oauth/pkce/config")
    .then((response) => response.json())
    .then((value: unknown) => {
      if (!active || !isOAuthPublicConfigResponse(value)) return;
      if (value.ok) setRedirectUri(value.redirectUri);
      else setRedirectStatus("OAuth redirect URL could not be loaded. Check the server OAuth configuration.");
    })
    .catch(() => {
      if (active) setRedirectStatus("OAuth redirect URL could not be loaded. Check the server OAuth configuration.");
    });
  return () => { active = false; };
}, [isEnterprise]);

async function handleCopyRedirectUri() {
  try {
    await navigator.clipboard.writeText(redirectUri);
    setRedirectStatus("Redirect URL copied.");
  } catch {
    setRedirectStatus("Redirect URL was not copied. Copy it manually from the field.");
  }
}

function isOAuthPublicConfigResponse(value: unknown): value is OAuthPublicConfigResponse {
  if (typeof value !== "object" || value === null) return false;
  const response = value as { ok?: unknown; redirectUri?: unknown; error?: unknown };
  return response.ok === true
    ? typeof response.redirectUri === "string" && response.redirectUri.length > 0
    : response.ok === false && typeof response.error === "string";
}
```

Move `const isEnterprise = draft.instanceType === "enterprise"` above the configuration effect so the hook order is stable and the effect can depend on it.

Render:

```tsx
<div className="oauth-redirect-row">
  <label className="d-block">
    <span className="d-block fs-caption tt-uppercase fc-light mb4">OAuth redirect URL</span>
    <input className="s-input" aria-label="OAuth redirect URL" value={redirectUri} readOnly />
  </label>
  <button className="s-btn" type="button" onClick={handleCopyRedirectUri} disabled={!redirectUri}>
    Copy redirect URL
  </button>
</div>
```

On config failure show `OAuth redirect URL could not be loaded. Check the server OAuth configuration.` On clipboard rejection show `Redirect URL was not copied. Copy it manually from the field.` Neither error may populate `oauthError` or block a later OAuth start request.

- [ ] **Step 4: Run component, hook, storage, and OAuth suites**

Run: `pnpm test src/components/CredentialsPanel.test.tsx src/components/OAuthCustomerProfileManager.test.tsx src/hooks/useOAuthCustomerProfiles.test.tsx src/utils/browserOAuthProfileStorage.test.ts src/server/oauthPkceApi.test.ts`

Expected: PASS; existing popup, callback binding, cancellation, manual token, scope, and expired-token tests remain green alongside profile tests.

- [ ] **Step 5: Commit credentials integration**

```bash
git add src/components/CredentialsPanel.tsx src/components/CredentialsPanel.test.tsx
git commit -m "feat: use saved customers for Enterprise OAuth"
```

### Task 8: Update Product Guidance and Run Full Verification

**Files:**
- Modify: `README.md:25-50`
- Verify: all files changed in Tasks 1-7

- [ ] **Step 1: Write the documentation assertion before editing README**

Run:

```bash
rg -n "OAuth client IDs|customer profile|memory-only|browser-local" README.md
```

Expected: the current Credentials section says OAuth client IDs and metadata are not persisted and contains no customer-profile exception.

- [ ] **Step 2: Update the credential and data-lifecycle copy**

Replace the opening Credentials paragraphs with:

```md
The app keeps access tokens, API keys, and PATs session-only and in memory. OAuth
authorization codes and client secrets are not persisted. The server-mediated
PKCE flow temporarily stores OAuth state, the verifier, and pending transaction
details in a protected cookie for at most 10 minutes. That cookie is `HttpOnly`,
`SameSite=Lax`, `Secure` when applicable, scoped to `/api/oauth/pkce`, and cleared
after the callback succeeds or fails. None of these sensitive values enter the
customer-profile IndexedDB database.

For Stack Enterprise OAuth, users may explicitly save browser-local customer
profiles containing only a customer name, Enterprise instance URL, OAuth client
ID, and the non-expiring-token preference. The server-controlled OAuth redirect
URL is displayed read-only and is never overridden by a saved profile. Saved
customer profiles survive refreshes and browser restarts until the user deletes
them or clears browser site data. Dataset flushing and session reset do not remove
customer profiles.
```

Keep the existing dataset persistence and OAuth lane guidance after these paragraphs.

- [ ] **Step 3: Verify the documentation no longer contradicts the feature**

Run: `rg -n "OAuth client IDs|customer profile|memory-only|browser-local" README.md PRODUCT.md docs/superpowers/specs/2026-08-19-browser-oauth-customer-profiles-design.md`

Expected: README and the approved spec consistently separate session-only credentials, the short-lived protected PKCE transaction cookie, and browser-local non-sensitive customer profiles; `PRODUCT.md` still correctly describes credentials as sensitive session state.

- [ ] **Step 4: Run all unit and type checks**

Run: `pnpm test`

Expected: all Vitest suites pass with no unhandled errors or React warnings.

Run: `pnpm lint`

Expected: both TypeScript projects complete with exit code 0.

- [ ] **Step 5: Run the production build**

Run: `pnpm build`

Expected: Next.js production build completes successfully and includes `/api/oauth/pkce/config`.

- [ ] **Step 6: Inspect the final diff for security-boundary regressions**

Run:

```bash
git diff --check
git diff --stat
rg -n "accessToken|apiKey|pat|codeVerifier|oauthScopes|authSource" src/domain/oauthCustomerProfiles.ts src/utils/browserOAuthProfileStorage.ts src/hooks/useOAuthCustomerProfiles.ts src/components/OAuthCustomerProfileManager.tsx
```

Expected: `git diff --check` reports no whitespace errors. Sensitive names appear only in explicit exclusion assertions or do not appear at all; none are properties of the persisted profile or preference types and none are passed into the profile manager.

- [ ] **Step 7: Commit documentation and final adjustments**

```bash
git add README.md
git commit -m "docs: explain browser OAuth customer profiles"
```
