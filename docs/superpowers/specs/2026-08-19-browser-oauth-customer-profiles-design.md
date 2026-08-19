# Browser OAuth Customer Profiles Design

Date: 2026-08-19
Status: Design approved in discussion; written spec pending user review

## Summary

Add browser-local customer profiles for the non-sensitive configuration needed to start Stack Enterprise OAuth. A user can select a saved customer, review the server-controlled redirect URL, and start OAuth without re-entering the Enterprise URL or client ID. Tokens and every other credential remain memory-only.

## Goals

- Persist reusable, non-sensitive Enterprise OAuth setup per customer in the current browser profile.
- Restore the last-selected customer after a refresh or browser restart.
- Keep profile creation, updates, and deletion explicit.
- Make the OAuth redirect URL visible and easy to copy without letting browser data override it.
- Preserve the existing OAuth Authorization Code with PKCE security model.
- Keep customer profiles independent from datasets and session credentials.

## Non-Goals

- Do not persist access tokens, API keys, personal access tokens, authorization codes, PKCE verifiers, OAuth state, pending transactions, or client secrets.
- Do not automatically start OAuth when a customer is selected.
- Do not add account sync, server-side profile storage, import/export, or live cross-tab synchronization.
- Do not let a customer profile override the server-controlled OAuth redirect URL.
- Do not change workflow-derived OAuth scopes.
- Do not revoke or erase an active token when a non-sensitive profile is deleted.
- Do not add profiles for Basic/Business PAT authentication; this feature covers Stack Enterprise OAuth only.

## Recommended Approach

Use a dedicated IndexedDB database for customer OAuth profiles. Keep it separate from the existing dataset database so dataset removal, dataset migrations, and session reset cannot affect the profiles. Store the last-selected profile ID as a preference in the same dedicated database.

This is preferable to `localStorage`, which is synchronous and easier for unrelated application code to overwrite. It is also preferable to embedding profiles in the dataset snapshot, which would couple unrelated data lifecycles and persistence errors.

## Security and Persistence Boundary

Persisted profile records use an exact allowlist. Unknown properties are discarded during parsing and before writing.

```ts
interface OAuthCustomerProfile {
  schemaVersion: 1;
  id: string;
  customerName: string;
  baseUrl: string;
  oauthClientId: string;
  includeNoExpiry: boolean;
  createdAt: string;
  updatedAt: string;
}
```

The persisted preference contains only the last-selected profile ID:

```ts
interface OAuthCustomerProfilePreferences {
  schemaVersion: 1;
  lastSelectedProfileId?: string;
}
```

The profile schema intentionally excludes:

- `apiKey`
- `pat`
- `accessToken`
- `accessTokenExpiresAt`
- `authSource`
- `oauthScopes`
- OAuth authorization codes
- PKCE verifier, challenge, and state values
- Pending OAuth transaction data
- Client secrets

OAuth scopes remain derived from the selected report, utility, or write tool. The `includeNoExpiry` preference is persisted because it is a non-sensitive, explicit customer preference; the resulting `no_expiry` scope is still constructed by the existing OAuth start flow.

The redirect URL is not part of a profile. It remains derived on the server from the request origin and the existing `STACK_API_UTILITIES_PUBLIC_ORIGIN`, `NEXT_PUBLIC_STACK_API_UTILITIES_PUBLIC_ORIGIN`, or `STACK_API_UTILITIES_OAUTH_REDIRECT_URI` configuration.

## Profile Validation and Normalization

- `customerName` is trimmed and must be non-empty.
- Customer names are unique case-insensitively after trimming. An existing profile may retain its own name during an update.
- `baseUrl` must pass the existing Stack Enterprise HTTPS OAuth target rules and is normalized to its URL origin.
- `oauthClientId` is trimmed and must be non-empty.
- `includeNoExpiry` must be a boolean.
- `id` is generated with `crypto.randomUUID()` when a profile is created.
- `createdAt` and `updatedAt` must be valid ISO timestamps. Updating a profile preserves `createdAt` and replaces `updatedAt`.
- Malformed stored profiles are ignored rather than hydrated into the UI.

## User Experience

The saved-customer controls appear only in the Enterprise credentials lane, above the Enterprise OAuth fields.

### Returning User

1. The customer-profile store loads when the Enterprise credentials UI is opened.
2. If the last-selected profile still exists, it is selected automatically.
3. Its customer name, Enterprise instance URL, OAuth client ID, and `no_expiry` preference populate the draft.
4. OAuth does not start automatically.
5. The user clicks **Connect with Enterprise OAuth** when a usable token is absent or needs replacement.

### Selecting a Customer

Selecting a customer immediately fills the non-sensitive OAuth draft and persists only that profile ID as the last-selected preference. It does not copy, clear, or persist the current in-memory credential. The Connect action uses the newly selected draft and replaces session credentials only after a valid OAuth callback succeeds.

If the current draft has unsaved profile edits, selecting another profile or choosing **New customer** requires confirmation before those edits are discarded.

### Creating and Updating

- **New customer** changes the profile manager to an unsaved draft and clears the customer name, Enterprise URL, client ID, and `no_expiry` preference.
- **Save customer** validates and creates a new profile. It becomes selected and last-used after the write succeeds.
- **Update customer** is available for a selected profile and explicitly persists validated changes.
- Edits never auto-save. The UI identifies when the selected profile has unsaved changes.
- The user may start OAuth from an unsaved draft. Starting OAuth does not implicitly save or update a profile.

### Deleting

**Delete** requires confirmation. A successful deletion removes the selected profile and clears the last-selected preference when it points to that profile. The form becomes a new, blank profile draft. Deletion does not revoke or erase current in-memory credentials.

### Redirect URL

The OAuth setup displays the server-resolved redirect URL in a read-only field with a **Copy** action. This gives users the exact value to register with the customer's OAuth application while preserving server control. The browser does not submit a redirect override during OAuth start.

## Architecture

### Profile Domain Module

A focused domain module owns:

- `OAuthCustomerProfile` and preferences types.
- Profile construction and update functions.
- Exact-allowlist parsing of unknown browser data.
- Normalization and validation.
- Case-insensitive customer-name uniqueness checks.
- Dirty-state comparison between a selected profile and the current draft.

This module has no React or IndexedDB dependencies.

### Browser Profile Storage

A dedicated storage module owns:

- Opening and upgrading the customer-profile IndexedDB database.
- A profile object store keyed by profile ID.
- A preferences object store containing the last-selected profile ID.
- Loading valid profiles and preferences.
- Creating or updating one allowlisted profile.
- Deleting one profile and clearing a matching last-selected preference atomically.
- Treating an unavailable IndexedDB implementation as unavailable profile persistence rather than an OAuth failure.

Profile mutations are serialized so a slower earlier write cannot overwrite a later user action.

### React Profile State

A focused React hook owns asynchronous hydration, in-memory profile state, the selected profile ID, serialized mutations, and storage warnings. It exposes operations for selecting, creating, updating, and deleting profiles.

The hook keeps persistence mechanics out of `App` and `CredentialsPanel`. The credentials component remains responsible for the current OAuth draft and the existing popup/callback flow.

### Profile Manager Component

A focused profile manager component renders:

- Saved-customer selection.
- Customer name input.
- New, Save, Update, and Delete controls.
- Unsaved-change status.
- Loading, validation, confirmation, and persistence error states.

It communicates profile selection and profile-draft changes through typed props. It never receives tokens, API keys, PATs, or a complete `SessionCredentials` object.

### OAuth Public Configuration

Add a same-origin, read-only OAuth configuration endpoint that returns the redirect URL resolved with the same rules used by OAuth start. Resolution stays in a shared server function so the displayed and submitted redirect URLs cannot drift.

The response uses the existing OAuth JSON security headers, including `Cache-Control: no-store, private`, `Pragma: no-cache`, `Referrer-Policy: no-referrer`, and `X-Content-Type-Options: nosniff`.

## Data Flow

1. The Enterprise credentials lane loads the profile hook.
2. The hook reads and parses profiles and preferences from the dedicated IndexedDB database.
3. A valid last-selected profile populates the non-sensitive OAuth draft unless the user has already edited that draft during hydration.
4. Selecting a profile populates the draft and writes its ID as the last-selected preference.
5. Save, Update, and Delete validate first and mutate browser storage before showing success.
6. The OAuth configuration endpoint supplies the redirect URL for read-only display.
7. Connect sends the current Enterprise URL, client ID, workflow-derived scopes, and `includeNoExpiry` to the existing OAuth start route.
8. The existing server-mediated PKCE flow creates a short-lived HTTP-only pending cookie and performs the token exchange.
9. A successful callback stores the access token only in the existing in-memory session state.

Profile hydration must not overwrite user edits made before the IndexedDB read completes. The credentials draft tracks whether the user has changed any profile-backed field and applies the restored selection only while the draft is still pristine.

## Error Handling

- If IndexedDB is missing, blocked, or fails to open, manual OAuth entry and connection remain usable. The UI reports that saved customers cannot be loaded or saved in this browser.
- A failed create, update, delete, or preference write does not show success and does not discard the user's current draft.
- Valid profiles still load when another stored record is malformed. The UI reports that one or more saved profiles could not be read.
- If the last-selected ID is missing, malformed, or points to a deleted profile, the UI falls back to **New customer** and clears that stale preference when storage is writable.
- Duplicate customer names and invalid profile fields produce inline validation messages without writing.
- If the redirect URL cannot be resolved, the read-only field shows an actionable configuration error. OAuth start applies the same validation and remains the authority on whether the connection can proceed.
- Copy failure leaves the URL visible for manual copying and reports that it was not copied.
- Existing OAuth start, popup, callback, cancellation, expiry, and redaction behavior remains unchanged.

## Data Lifecycle

- Closing a tab, refreshing, restarting the browser, signing out of Stack Enterprise, resetting the app session, and flushing datasets do not remove customer profiles.
- An individual profile is removed only with its confirmed Delete action.
- Clearing browser site data removes all profiles and the last-selected preference.
- A profile deletion does not revoke an OAuth grant on Stack Enterprise and does not erase the current in-memory access token.
- Access tokens remain memory-only and disappear on refresh or browser restart as they do today.

## Testing

### Domain Tests

- Accept and normalize a valid profile.
- Reject blank customer names, invalid Enterprise URLs, blank client IDs, invalid booleans, and invalid timestamps.
- Enforce case-insensitive unique customer names while allowing an update to retain its own name.
- Preserve `createdAt` and replace `updatedAt` on update.
- Parse only allowlisted fields and prove sensitive or unknown properties are absent from the result.
- Detect clean and dirty profile drafts.

### Storage Tests

- Open the dedicated database and create both object stores.
- Save, load, update, and delete profiles by ID.
- Save, restore, replace, and clear the last-selected ID.
- Delete a selected profile and its matching preference in one transaction.
- Ignore malformed records while retaining valid records.
- Prove serialized browser records contain none of the prohibited sensitive fields.
- Handle unavailable IndexedDB, open failures, request failures, and aborted transactions.

### Component and Hook Tests

- Restore the last-selected profile into a pristine Enterprise draft.
- Do not overwrite fields edited before hydration finishes.
- Select a profile and populate only non-sensitive fields.
- Show New, Save, Update, confirmed Delete, and unsaved-change behavior.
- Reject duplicate names and invalid values inline.
- Keep an unsaved draft after a failed write.
- Start OAuth from saved and unsaved drafts with the expected request body.
- Preserve the workflow-derived scope behavior.
- Prove selecting, saving, updating, and deleting profiles never write session credential fields.
- Keep Basic/Business credentials free of saved Enterprise customer controls.
- Keep OAuth usable when profile persistence is unavailable.

### Server and Integration Tests

- Return the default request-origin callback URL from the public configuration endpoint.
- Return configured public-origin and redirect-URI values exactly as OAuth start uses them.
- Preserve redirectmeto validation and reject unsafe redirect configuration.
- Apply no-store and hardening headers to the public configuration response.
- Display and copy the resolved redirect URL.
- Preserve all existing PKCE start, callback, state, expiry, redaction, credential validation, and application tests.

## Acceptance Criteria

- A user can explicitly save more than one Enterprise customer profile and select any saved customer after a browser restart.
- The last-selected valid customer is restored without starting OAuth.
- Selecting a profile fills the Enterprise URL, OAuth client ID, and `no_expiry` preference.
- The exact server-controlled redirect URL is visible and copyable.
- OAuth can start from either a saved profile or an unsaved draft.
- Create, Update, and Delete are explicit and report failures without losing the draft.
- Dataset flushing and session reset leave customer profiles intact.
- No sensitive credential or OAuth transaction value is written to the profile database.
- Access tokens remain memory-only and existing OAuth PKCE behavior remains intact.
