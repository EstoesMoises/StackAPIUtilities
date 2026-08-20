# Browser Customer API Key Persistence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist an optional Stack API v2.3 API key with each explicitly saved Stack Enterprise customer profile and restore it when that customer is selected.

**Architecture:** Extend the exact-allowlist customer-profile domain schema from version 1 to version 2, while accepting version-1 profiles and preferences as read-only legacy input. Reuse the existing IndexedDB stores and React profile hook; add the API key to the credentials panel's profile-backed draft so the existing explicit Save, Update, Select, New, and Delete lifecycle owns it.

**Tech Stack:** TypeScript, React 18, Next.js 14, IndexedDB, Vitest, Testing Library, Playwright, pnpm.

---

## File Map

- Modify `src/domain/oauthCustomerProfiles.ts` to define schema version 2, normalize optional API keys, migrate version-1 records, and include keys in draft conversion and dirty checks.
- Modify `src/domain/oauthCustomerProfiles.test.ts` to specify current-schema API-key behavior, legacy migration, allowlisting, and malformed-key rejection.
- Modify `src/utils/browserOAuthProfileStorage.test.ts` to prove IndexedDB round trips API keys, keeps its object-store version, and loads version-1 records without losing selection.
- Modify `src/hooks/useOAuthCustomerProfiles.test.tsx` to update current-schema fixtures and prove create/update operations carry the per-customer key through the existing storage interface.
- Modify `src/components/CredentialsPanel.tsx` to treat the API key as profile-backed, clear/restore it with profile actions, lock it during mutations, and password-mask the input.
- Modify `src/components/CredentialsPanel.test.tsx` to cover profile save, restore, switching, dirty state, clearing, deletion, OAuth payload exclusion, and masking.
- Modify `src/components/OAuthCustomerProfileManager.tsx` and `src/components/OAuthCustomerProfileManager.test.tsx` to accurately describe browser-local API-key storage.
- Modify `e2e/oauth-customer-profiles.spec.ts` to prove the saved key survives reload and disappears after profile deletion.
- Modify `README.md` to document the new persistence boundary.

## Task 1: Profile Schema, Legacy Migration, Storage, and Hook Contract

**Files:**
- Modify: `src/domain/oauthCustomerProfiles.test.ts`
- Modify: `src/utils/browserOAuthProfileStorage.test.ts`
- Modify: `src/hooks/useOAuthCustomerProfiles.test.tsx`
- Modify: `src/domain/oauthCustomerProfiles.ts`

- [ ] **Step 1: Write failing domain tests for current and legacy profile records**

Update the shared draft and profile fixtures in `src/domain/oauthCustomerProfiles.test.ts` so current profiles use schema 2 and drafts include an API-key string:

```ts
const draft = {
  customerName: "Acme",
  baseUrl: "https://acme.stackenterprise.co",
  oauthClientId: "acme-client",
  includeNoExpiry: false,
  apiKey: "api-key",
};

const profile: OAuthCustomerProfile = {
  schemaVersion: OAUTH_CUSTOMER_PROFILE_SCHEMA_VERSION,
  id: "profile-1",
  createdAt: "2026-08-19T10:00:00.000Z",
  updatedAt: "2026-08-19T10:00:00.000Z",
  ...draft,
};
```

Change the normalized-create expectation to include `schemaVersion: 2` and `apiKey: "key-123"`, then add these focused cases:

```ts
it("trims a saved API key and omits a blank key", () => {
  const saved = createOAuthCustomerProfile(
    { ...draft, apiKey: "  key-123  " },
    [],
    { createId: () => "new-profile", now: () => new Date("2026-08-20T12:00:00.000Z") },
  );
  expect(saved).toMatchObject({ ok: true, profile: { apiKey: "key-123" } });

  const blank = createOAuthCustomerProfile(
    { ...draft, apiKey: "   " },
    [],
    { createId: () => "blank-profile", now: () => new Date("2026-08-20T12:00:00.000Z") },
  );
  expect(blank).toEqual({
    ok: true,
    profile: {
      schemaVersion: 2,
      id: "blank-profile",
      customerName: "Acme",
      baseUrl: "https://acme.stackenterprise.co",
      oauthClientId: "acme-client",
      includeNoExpiry: false,
      createdAt: "2026-08-20T12:00:00.000Z",
      updatedAt: "2026-08-20T12:00:00.000Z",
    },
  });
});

it("migrates an exact version-1 profile without accepting a legacy API key", () => {
  expect(parseOAuthCustomerProfile({
    schemaVersion: 1,
    id: "legacy-profile",
    customerName: "Legacy Customer",
    baseUrl: "https://legacy.stackenterprise.co",
    oauthClientId: "legacy-client",
    includeNoExpiry: true,
    apiKey: "untrusted-legacy-key",
    createdAt: "2026-08-19T10:00:00.000Z",
    updatedAt: "2026-08-19T10:00:00.000Z",
  })).toEqual({
    schemaVersion: 2,
    id: "legacy-profile",
    customerName: "Legacy Customer",
    baseUrl: "https://legacy.stackenterprise.co",
    oauthClientId: "legacy-client",
    includeNoExpiry: true,
    createdAt: "2026-08-19T10:00:00.000Z",
    updatedAt: "2026-08-19T10:00:00.000Z",
  });
});

it.each([
  ["blank", ""],
  ["padded", " api-key "],
  ["non-string", 42],
])("rejects a version-2 profile with a %s API key", (_description, apiKey) => {
  expect(parseOAuthCustomerProfile({ ...profile, apiKey })).toBeNull();
});

it("migrates version-1 preferences while preserving selection", () => {
  expect(parseOAuthCustomerProfilePreferences({
    schemaVersion: 1,
    lastSelectedProfileId: "profile-1",
  })).toEqual({ schemaVersion: 2, lastSelectedProfileId: "profile-1" });
});
```

Update the allowlist test so the expected version-2 `apiKey` remains, while `accessToken`, `pat`, `oauthScopes`, `authSource`, `codeVerifier`, and `clientSecret` are absent. Extend the draft conversion test with:

```ts
expect(toOAuthCustomerProfileDraft(profile)).toEqual(draft);
expect(isOAuthCustomerProfileDraftDirty(profile, { ...draft, apiKey: "other-key" })).toBe(true);
expect(isOAuthCustomerProfileDraftDirty(
  { ...profile, apiKey: undefined },
  { ...draft, apiKey: "   " },
)).toBe(false);
```

- [ ] **Step 2: Write failing storage and hook tests before changing production code**

In `src/utils/browserOAuthProfileStorage.test.ts`, make `createProfile()` return a schema-2 profile with `apiKey: "api-secret"`. Update the round-trip assertion so `apiKey` is present and only the remaining credential fields are excluded:

```ts
expect(fake.store("profiles").get(profile.id)).toEqual(createProfile());
expect(JSON.stringify(fake.store("profiles").get(profile.id))).not.toMatch(
  /accessToken|pat|codeVerifier|oauthScopes|authSource|clientSecret/,
);
```

Keep the IndexedDB open expectation at database version 1, then add a migration test using raw legacy records:

```ts
it("loads version-1 profiles and preferences as version 2 without rewriting IndexedDB", async () => {
  const fake = installFakeIndexedDB({ existingStores: ["profiles", "preferences"] });
  fake.store("profiles").set("legacy", {
    schemaVersion: 1,
    id: "legacy",
    customerName: "Legacy Customer",
    baseUrl: "https://legacy.stackenterprise.co",
    oauthClientId: "legacy-client",
    includeNoExpiry: false,
    createdAt: "2026-08-19T10:00:00.000Z",
    updatedAt: "2026-08-19T10:00:00.000Z",
  });
  fake.store("preferences").set("current", {
    schemaVersion: 1,
    lastSelectedProfileId: "legacy",
  });

  await expect(loadOAuthCustomerProfileStore()).resolves.toMatchObject({
    profiles: [{ schemaVersion: 2, id: "legacy" }],
    preferences: { schemaVersion: 2, lastSelectedProfileId: "legacy" },
    malformedProfileCount: 0,
  });
  expect(fake.putCalls).toEqual([]);
  expect(fake.openCalls).toEqual([
    { name: "stack-api-utilities-oauth-profiles", version: 1 },
  ]);
});
```

Change the malformed-schema fixture from version 2 to version 3. Update all current preference expectations to schema 2.

In `src/hooks/useOAuthCustomerProfiles.test.tsx`, add `apiKey` to `createProfile()`, update preference fixtures to schema 2, and replace the draft helper with:

```ts
function draft(
  customerName = "New Customer",
  baseUrl = "https://new.stackenterprise.co",
  apiKey = "new-customer-key",
): OAuthCustomerProfileDraft {
  return {
    customerName,
    baseUrl,
    oauthClientId: `client-${customerName.toLowerCase().replace(/ /g, "-")}`,
    includeNoExpiry: true,
    apiKey,
  };
}
```

Extend the existing successful create expectation, and invoke the existing successful update with `draft("Updated Customer", selected.baseUrl, "updated-key")` before checking its storage call:

```ts
expect(storage.saveProfileAndSelect).toHaveBeenCalledWith(
  expect.objectContaining({ apiKey: "new-customer-key" }),
);

expect(storage.saveProfile).toHaveBeenCalledWith(
  expect.objectContaining({ id: selected.id, apiKey: "updated-key" }),
);
```

- [ ] **Step 3: Run the focused tests and verify the new behavior fails**

Run:

```bash
pnpm test src/domain/oauthCustomerProfiles.test.ts src/utils/browserOAuthProfileStorage.test.ts src/hooks/useOAuthCustomerProfiles.test.tsx
```

Expected: FAIL because the current schema is version 1, `apiKey` is discarded, and version-2 records/preferences are rejected.

- [ ] **Step 4: Implement schema version 2 and optional-key normalization**

In `src/domain/oauthCustomerProfiles.ts`, replace the schema declaration and extend the draft/profile types:

```ts
const LEGACY_OAUTH_CUSTOMER_PROFILE_SCHEMA_VERSION = 1 as const;
export const OAUTH_CUSTOMER_PROFILE_SCHEMA_VERSION = 2 as const;

export interface OAuthCustomerProfileDraft {
  customerName: string;
  baseUrl: string;
  oauthClientId: string;
  includeNoExpiry: boolean;
  apiKey: string;
}

export interface OAuthCustomerProfile
  extends Omit<OAuthCustomerProfileDraft, "apiKey"> {
  schemaVersion: typeof OAUTH_CUSTOMER_PROFILE_SCHEMA_VERSION;
  id: string;
  apiKey?: string;
  createdAt: string;
  updatedAt: string;
}
```

Include `apiKey` in `normalizeDraft`:

```ts
return {
  customerName: normalizeDraftString(draft.customerName),
  baseUrl: isSupportedEnterpriseOAuthTarget(baseUrl) ? normalizeOAuthBaseUrl(baseUrl) : baseUrl,
  oauthClientId: normalizeDraftString(draft.oauthClientId),
  includeNoExpiry: draft.includeNoExpiry,
  apiKey: normalizeDraftString(draft.apiKey),
};
```

Add a helper that omits blank keys and use it in both create and update:

```ts
function toProfileFields(
  draft: OAuthCustomerProfileDraft,
): Omit<OAuthCustomerProfile, "schemaVersion" | "id" | "createdAt" | "updatedAt"> {
  const { apiKey, ...fields } = draft;
  return apiKey ? { ...fields, apiKey } : fields;
}
```

For creation, spread `...toProfileFields(normalizedDraft)` instead of `...normalizedDraft`. For updates, do the same so clearing the input removes an existing key.

- [ ] **Step 5: Implement exact parsing and in-memory legacy migration**

Replace the schema-only guard in `parseOAuthCustomerProfile` with a current-or-legacy guard, retain all existing shared field validation, and handle the key only for current records:

```ts
if (
  !isRecord(value) ||
  (value.schemaVersion !== OAUTH_CUSTOMER_PROFILE_SCHEMA_VERSION &&
    value.schemaVersion !== LEGACY_OAUTH_CUSTOMER_PROFILE_SCHEMA_VERSION)
) {
  return null;
}

if (
  !isNonblankTrimmedString(value.id) ||
  !isNonblankTrimmedString(value.customerName) ||
  !isNonblankTrimmedString(value.baseUrl) ||
  !isNonblankTrimmedString(value.oauthClientId) ||
  typeof value.includeNoExpiry !== "boolean" ||
  !isExactIsoTimestamp(value.createdAt) ||
  !isExactIsoTimestamp(value.updatedAt) ||
  !isSupportedEnterpriseOAuthTarget(value.baseUrl) ||
  normalizeOAuthBaseUrl(value.baseUrl) !== value.baseUrl
) {
  return null;
}

const apiKey = value.schemaVersion === OAUTH_CUSTOMER_PROFILE_SCHEMA_VERSION
  ? value.apiKey
  : undefined;
if (apiKey !== undefined && !isNonblankTrimmedString(apiKey)) {
  return null;
}

return {
  schemaVersion: OAUTH_CUSTOMER_PROFILE_SCHEMA_VERSION,
  id: value.id,
  customerName: value.customerName,
  baseUrl: value.baseUrl,
  oauthClientId: value.oauthClientId,
  includeNoExpiry: value.includeNoExpiry,
  ...(apiKey ? { apiKey } : {}),
  createdAt: value.createdAt,
  updatedAt: value.updatedAt,
};
```

Apply the same current-or-legacy version guard to `parseOAuthCustomerProfilePreferences`, but always return `schemaVersion: OAUTH_CUSTOMER_PROFILE_SCHEMA_VERSION`. Keep the existing strict selected-ID validation.

Update draft conversion and dirty detection:

```ts
export function toOAuthCustomerProfileDraft(
  profile: OAuthCustomerProfile,
): OAuthCustomerProfileDraft {
  return {
    customerName: profile.customerName,
    baseUrl: profile.baseUrl,
    oauthClientId: profile.oauthClientId,
    includeNoExpiry: profile.includeNoExpiry,
    apiKey: profile.apiKey ?? "",
  };
}

export function isOAuthCustomerProfileDraftDirty(
  profile: OAuthCustomerProfile,
  draft: OAuthCustomerProfileDraft,
): boolean {
  const normalizedDraft = normalizeDraft(draft);
  return (
    normalizedDraft.customerName !== profile.customerName ||
    normalizedDraft.baseUrl !== profile.baseUrl ||
    normalizedDraft.oauthClientId !== profile.oauthClientId ||
    normalizedDraft.includeNoExpiry !== profile.includeNoExpiry ||
    normalizedDraft.apiKey !== (profile.apiKey ?? "")
  );
}
```

- [ ] **Step 6: Run the focused schema, storage, and hook tests**

Run:

```bash
pnpm test src/domain/oauthCustomerProfiles.test.ts src/utils/browserOAuthProfileStorage.test.ts src/hooks/useOAuthCustomerProfiles.test.tsx
```

Expected: the three focused suites PASS. Repository-wide type checking is intentionally deferred until Task 2 updates the component fixtures to the new literal schema version.

- [ ] **Step 7: Commit the schema and persistence contract**

```bash
git add src/domain/oauthCustomerProfiles.ts src/domain/oauthCustomerProfiles.test.ts src/utils/browserOAuthProfileStorage.test.ts src/hooks/useOAuthCustomerProfiles.test.tsx
git commit -m "feat: add API keys to customer profile schema"
```

## Task 2: Credentials UI Profile Lifecycle

**Files:**
- Modify: `src/components/CredentialsPanel.test.tsx`
- Modify: `src/components/OAuthCustomerProfileManager.test.tsx`
- Modify: `src/components/CredentialsPanel.tsx`
- Modify: `src/components/OAuthCustomerProfileManager.tsx`

- [ ] **Step 1: Write failing component tests for save, restore, switch, clear, and masking**

In `src/components/CredentialsPanel.test.tsx`, update `enterpriseProfile()` so it uses schema 2 and defaults to `apiKey: "profile-api-key"`. Update profile preference fixtures to schema 2.

Rename the existing strict-profile test to `saves the API key but excludes all other credentials from the customer profile`, then assert:

```ts
expect(savedProfile).toMatchObject({
  customerName: "Demo Customer",
  baseUrl: "https://demo.stackenterprise.co",
  oauthClientId: "client-123",
  includeNoExpiry: true,
  apiKey: "secret-api-key",
});
expect(Object.keys(savedProfile).sort()).toEqual([
  "apiKey",
  "baseUrl",
  "createdAt",
  "customerName",
  "id",
  "includeNoExpiry",
  "oauthClientId",
  "schemaVersion",
  "updatedAt",
]);
expect(JSON.stringify(savedProfile)).not.toMatch(
  /accessToken|pat|oauthScopes|authSource|authorizationCode|verifier|state/i,
);
```

Extend the restore test with:

```ts
expect(screen.getByLabelText("API key")).toHaveValue("profile-api-key");
```

Give the rapid-selection profiles `apiKey: "second-key"` and `apiKey: "third-key"`, then assert the API-key input changes after each selection. Change the New/Delete expectations from retaining `secret-api-key` to an empty value. Add:

```ts
it("marks an API-key edit as an unsaved profile change", async () => {
  mockOAuthEndpoints();
  installProfileStorage({
    profiles: [enterpriseProfile()],
    lastSelectedProfileId: "profile-1",
  });
  renderCredentialsPanel();
  const user = userEvent.setup();

  await user.selectOptions(screen.getByLabelText("Instance type"), "enterprise");
  await waitFor(() => expect(screen.getByLabelText("API key")).toHaveValue("profile-api-key"));
  await user.type(screen.getByLabelText("API key"), "-edited");

  expect(screen.getByText("Unsaved customer profile changes.")).toBeInTheDocument();
});

it("password-masks the saved API-key input", async () => {
  mockOAuthEndpoints();
  renderCredentialsPanel();
  await userEvent.setup().selectOptions(screen.getByLabelText("Instance type"), "enterprise");
  expect(screen.getByLabelText("API key")).toHaveAttribute("type", "password");
});
```

Update the profile-mutation locking tests so the API-key input is expected to be disabled while the save/update is pending and re-enabled afterward. Continue expecting the manual access-token field and OAuth Connect button to remain enabled.

In the OAuth-start test, give the selected profile an API key and extend the negative payload assertion:

```ts
expect(String(startCall?.[1]?.body)).not.toMatch(/redirect|customerName|apiKey/i);
```

In `src/components/OAuthCustomerProfileManager.test.tsx`, replace the old non-sensitive-copy expectation with:

```ts
expect(screen.getByText(
  "Customer profiles store OAuth settings and an optional API key in this browser.",
)).toBeInTheDocument();
```

- [ ] **Step 2: Run component tests and verify failures**

Run:

```bash
pnpm test src/components/CredentialsPanel.test.tsx src/components/OAuthCustomerProfileManager.test.tsx
```

Expected: FAIL because `CredentialsPanel` does not yet put the key in `profileDraft`, restore or clear it with profile actions, include it in dirty state, mask it, or lock it during profile writes; the manager still claims profiles contain only non-sensitive settings.

- [ ] **Step 3: Make the API key profile-backed in CredentialsPanel**

Add the key to `profileDraft`:

```ts
const profileDraft: OAuthCustomerProfileDraft = {
  customerName: draft.customerName,
  baseUrl: draft.baseUrl,
  oauthClientId: draft.oauthClientId,
  includeNoExpiry: draft.includeNoExpiry,
  apiKey: draft.apiKey,
};
```

Include `draft.apiKey.trim()` in the new-profile dirty expression. Add `field === "apiKey"` to the `isProfileField` expression in `updateDraft`. Keep the existing profile-error cleanup; clearing a nonexistent optional `apiKey` error is harmless and preserves the generic field update:

```ts
if (isProfileField) {
  setProfileErrors((current) => ({
    ...current,
    [field as keyof OAuthCustomerProfileDraft]: undefined,
  }));
}
```

`applyProfile` already spreads `toOAuthCustomerProfileDraft(profile)`, so the expanded domain draft restores the key. Add `apiKey: ""` to `clearProfileDraft` so New and successful Delete clear it while leaving `accessToken` unchanged.

- [ ] **Step 4: Mask and lock the profile-backed API-key input**

Replace the API-key input with:

```tsx
<input
  className="s-input"
  type="password"
  autoComplete="off"
  value={draft.apiKey}
  disabled={profileTargetBusy}
  onChange={(event) => updateDraft("apiKey", event.currentTarget.value)}
/>
```

Update the manager copy in `src/components/OAuthCustomerProfileManager.tsx`:

```tsx
<p className="oauth-status">
  Customer profiles store OAuth settings and an optional API key in this browser.
</p>
```

- [ ] **Step 5: Run component and regression suites**

Run:

```bash
pnpm test src/components/CredentialsPanel.test.tsx src/components/OAuthCustomerProfileManager.test.tsx src/components/AppShell.test.tsx
pnpm lint
```

Expected: all named suites PASS and both TypeScript projects report no errors.

- [ ] **Step 6: Commit the UI behavior**

```bash
git add src/components/CredentialsPanel.tsx src/components/CredentialsPanel.test.tsx src/components/OAuthCustomerProfileManager.tsx src/components/OAuthCustomerProfileManager.test.tsx
git commit -m "feat: restore customer API keys in credentials UI"
```

## Task 3: Browser Reload Acceptance and Documentation

**Files:**
- Modify: `e2e/oauth-customer-profiles.spec.ts`
- Modify: `README.md`

- [ ] **Step 1: Extend the end-to-end customer-profile scenario**

Add a key near the existing profile constants:

```ts
const apiKey = "acme-api-key";
```

Fill it before saving:

```ts
await page.getByLabel("API key").fill(apiKey);
```

After the first reload, assert:

```ts
await expect(page.getByLabel("API key")).toHaveValue(apiKey);
await expect(page.getByLabel("API key")).toHaveAttribute("type", "password");
```

After deletion and after the final reload, assert:

```ts
await expect(page.getByLabel("API key")).toHaveValue("");
```

- [ ] **Step 2: Update the README security and lifecycle text**

Replace the opening credentials paragraphs with text that makes the exception explicit:

```md
The app keeps OAuth access tokens and PATs session-only and in memory. API keys
are also memory-only unless a user explicitly saves one in a browser-local Stack
Enterprise customer profile. OAuth authorization codes and client secrets are
not persisted. The server-mediated PKCE flow temporarily stores OAuth state, the
verifier, and pending transaction details in a protected cookie for at most 10
minutes. That cookie is `HttpOnly`, `SameSite=Lax`, `Secure` when applicable,
scoped to `/api/oauth/pkce`, and cleared after the callback succeeds or fails.
None of those OAuth secrets enter the customer-profile IndexedDB database.

For Stack Enterprise OAuth, users may explicitly save browser-local customer
profiles containing a customer name, Enterprise instance URL, OAuth client ID,
the non-expiring-token preference, and an optional API key. The API key is stored
directly in this browser's IndexedDB and is readable by scripts running under the
application origin; this storage is not a secret vault. The server-controlled
OAuth redirect URL is displayed read-only and is never overridden by a saved
profile. Saved customer profiles survive refreshes and browser restarts until the
user deletes them or clears browser site data. Dataset flushing and session reset
do not remove customer profiles.
```

- [ ] **Step 3: Run the focused end-to-end scenario**

Run:

```bash
pnpm exec playwright test e2e/oauth-customer-profiles.spec.ts
```

Expected: PASS; the key survives reload with its profile and is blank after deletion and the final reload.

- [ ] **Step 4: Commit acceptance coverage and documentation**

```bash
git add e2e/oauth-customer-profiles.spec.ts README.md
git commit -m "docs: explain saved customer API keys"
```

## Task 4: Final Verification

**Files:**
- Verify all modified files; make no unrelated changes.

- [ ] **Step 1: Run credential-profile regression suites**

Run:

```bash
pnpm test src/domain/oauthCustomerProfiles.test.ts src/utils/browserOAuthProfileStorage.test.ts src/hooks/useOAuthCustomerProfiles.test.tsx src/components/OAuthCustomerProfileManager.test.tsx src/components/CredentialsPanel.test.tsx src/components/AppShell.test.tsx
```

Expected: all tests PASS with no unhandled errors or warnings.

- [ ] **Step 2: Run the complete unit suite and type checking**

Run:

```bash
pnpm test
pnpm lint
```

Expected: the full Vitest suite passes and both TypeScript projects report no errors.

- [ ] **Step 3: Run the production build**

Run:

```bash
pnpm build
```

Expected: Next.js completes a production build and emits the existing application and API routes without compilation errors.

- [ ] **Step 4: Audit the persistence boundary and working tree**

Run:

```bash
rg -n "accessToken|pat|codeVerifier|oauthScopes|authSource|clientSecret" src/domain/oauthCustomerProfiles.ts src/utils/browserOAuthProfileStorage.ts src/hooks/useOAuthCustomerProfiles.ts
rg -n "apiKey" src/app/api/oauth src/server/oauthPkceApi.ts
git status --short
git log -5 --oneline
```

Expected: the first search shows no newly persisted excluded fields, the OAuth-path search shows no API-key payload handling, the working tree is clean, and the three implementation commits appear after the design and plan commits.
