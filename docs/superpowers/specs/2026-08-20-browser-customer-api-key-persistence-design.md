# Browser Customer API Key Persistence Design

Date: 2026-08-20
Status: Approved

## Summary

Extend the existing browser-local Stack Enterprise customer profiles so each customer may store its own Stack API v2.3 API key. Selecting a saved customer restores that key with the existing Enterprise URL and OAuth settings. Access tokens, PATs, OAuth transaction data, and client secrets remain excluded from browser profile storage.

## Goals

- Save an optional API key with each explicitly saved customer profile.
- Restore the corresponding key when a customer profile is selected or restored after a browser restart.
- Preserve all existing version-1 profiles and the last-selected customer preference.
- Keep profile creation and updates explicit; editing a key must not auto-save it.
- Continue using the existing dedicated IndexedDB customer-profile database.

## Non-Goals

- Do not persist OAuth access tokens, PATs, client secrets, authorization codes, PKCE verifiers, OAuth state, scopes, or pending OAuth transaction data.
- Do not add server-side key storage, account sync, import/export, cross-tab synchronization, a passphrase flow, or browser-local encryption.
- Do not send the API key to OAuth start or callback routes.
- Do not change report credential requirements or API request authentication behavior.
- Do not rename the existing profile modules as part of this focused change.

## Persistence and Security Boundary

The API key is stored directly in the existing customer-profile IndexedDB database. This makes the key available after refreshes and browser restarts, as requested, but it is not a secure secret vault: scripts running under the application origin can read the database. Clearing site data or deleting the customer profile removes the persisted copy.

Encryption with a key stored beside the ciphertext would not protect against same-origin script access. Passphrase-backed encryption would provide a stronger at-rest boundary but is outside this change because it introduces an unlock workflow and prevents automatic restoration.

Version-2 profile records use an exact allowlist:

```ts
interface OAuthCustomerProfile {
  schemaVersion: 2;
  id: string;
  customerName: string;
  baseUrl: string;
  oauthClientId: string;
  includeNoExpiry: boolean;
  apiKey?: string;
  createdAt: string;
  updatedAt: string;
}
```

`apiKey` is omitted when blank. When present, it must be a nonblank, trimmed string. Unknown fields are discarded during parsing and before writing. The key must not appear in logs, status text, report exports, dataset persistence, or OAuth request bodies.

## Compatibility and Migration

The record schema advances from version 1 to version 2 without changing the IndexedDB object-store layout. The domain parser accepts valid version-1 profiles and converts them in memory to version-2 profiles with no `apiKey`. The version-1 last-selected preference is also accepted and converted without losing the selection.

New and updated records are written as version 2. A migrated profile is therefore persisted as version 2 the next time the user explicitly updates it; loading alone does not create an unexpected write. Invalid legacy records continue to be ignored and counted as malformed.

## User Experience and Data Flow

- The Enterprise API-key input is password-masked.
- Creating a customer saves the trimmed key with the other profile fields.
- Updating a customer replaces or removes its saved key based on the current input.
- Selecting or restoring a customer fills the API key from that profile. A profile with no saved key fills a blank value.
- Choosing **New customer** clears the API-key draft with the other customer fields.
- Deleting the selected profile removes its saved key and clears the draft. It does not change credentials already held in the in-memory session store until the user saves session credentials again.
- Changing the API key marks the selected profile as having unsaved changes and participates in the existing discard confirmation behavior.
- Starting OAuth never implicitly creates or updates a customer profile. The current API-key draft continues to be combined with a successful OAuth credential only in the in-memory session credentials.

The existing profile hook and IndexedDB storage operations remain responsible for serialization and error handling. The credentials panel adds `apiKey` to the profile-backed draft and applies or clears it through the existing profile selection lifecycle.

## Error Handling

- An unavailable or failed IndexedDB store continues to leave manual API-key and OAuth entry usable.
- A failed create or update does not discard the entered key or report success.
- A malformed stored key causes that profile record to be rejected under the existing malformed-profile behavior.
- Existing profiles without a key remain valid and selectable.
- The key is trimmed only at the profile domain boundary and when session credentials are saved, matching existing credential behavior.

## Testing

### Domain

- Create and update profiles with a trimmed API key.
- Omit blank keys and detect API-key changes in dirty-state checks.
- Parse valid version-2 profiles while discarding unknown credential fields.
- Convert valid version-1 profiles and preferences without losing their existing data or selection.
- Reject malformed version-2 API keys.

### Storage and Hook

- Save, update, load, select, and delete profiles containing API keys.
- Preserve migrated version-1 profiles and their last-selected preference.
- Prove access tokens, PATs, OAuth transaction fields, and other unknown properties are not persisted.
- Preserve existing unavailable, malformed, and failed-write behavior.

### Component and Integration

- Save and update a per-customer key through the Enterprise credentials UI.
- Restore the selected customer's key after hydration and switch keys when selecting another customer.
- Clear the key for **New customer** and after profile deletion.
- Treat key edits as unsaved profile changes.
- Keep OAuth start payloads free of API keys and retain the key only in the resulting in-memory session credentials.
- Render the Enterprise API-key input as a password field.

## Documentation

Update the README credentials section and customer-profile UI copy to state that explicitly saved customer profiles contain an API key in browser-local storage. Continue stating that access tokens and PATs are memory-only and that clearing browser site data removes saved customer profiles.
