# Enterprise OAuth PKCE Design

Date: 2026-07-04
Status: Design approved in discussion; written spec pending user review

## Summary

Add OAuth Authorization Code flow with PKCE for Stack Overflow Internal Enterprise API v3 authentication. The flow follows the Stack Enterprise support article "Secure API Token Generation with OAuth and PKCE" and replaces manual Enterprise access-token entry for v3-only workflows.

The first implementation targets Enterprise v3-only workflows, starting with Enterprise User Group Sync. Existing API key support remains for Enterprise workflows that still call Stack API v2.3. Stack Overflow Basic/Business workflows keep personal access token authentication because OAuth is not available for those tiers.

## Goals

- Provide a first-party OAuth PKCE connection flow for Enterprise API v3.
- Use PKCE with S256, a random state value, and no client secret.
- Store OAuth access tokens in browser session memory only, consistent with the current credential model.
- Request minimum scopes by default.
- Request `write_access` for User Group Sync.
- Include `no_expiry` only when the user explicitly opts in.
- Keep API key support for Enterprise v2.3 and mixed v2.3/v3 workflows.
- Keep PAT support for Stack Overflow Basic/Business workflows.
- Remove or hide direct manual Enterprise access-token entry from the normal credentials form.

## Non-Goals

- No OAuth support for Stack Overflow Basic/Business.
- No refresh-token handling; the documented Enterprise response provides an access token and optional expiry.
- No persisted credentials in local storage, indexed DB, cookies, or server-side storage.
- No replacement for Enterprise API key authentication where v2.3 endpoints are still required.
- No broad rewrite of report collection from v2.3 to v3.
- No support for non-PKCE client-secret token exchange.

## Source Documentation

The design is based on Stack Overflow's Enterprise PKCE documentation:

- https://support.stackenterprise.co/support/solutions/articles/22000294542-secure-api-token-generation-with-oauth-and-pkce

Key requirements from that document:

- Enterprise authorization starts at `https://[your_site].stackenterprise.co/oauth`.
- PKCE uses a generated `code_verifier`, derived `code_challenge`, and `code_challenge_method=S256`.
- PKCE token exchange does not require `client_secret`.
- Token exchange uses `https://[your_site].stackenterprise.co/oauth/access_token/json`.
- The access token response includes `access_token` and may include `expires`.
- Tokens expire after 24 hours unless the request includes `no_expiry`.
- `no_expiry` is discouraged unless the app actually requires it.

## Recommended Approach

Use a server-mediated PKCE callback.

The browser collects Enterprise instance URL, OAuth client ID, scope choices, and the explicit `no_expiry` preference. The app starts OAuth by generating PKCE state and verifier data, then redirecting to the Enterprise authorization URL. After approval, Enterprise redirects back to the app. A Next.js callback route validates state, exchanges the authorization code with the Enterprise token endpoint, and gives the browser the resulting session credential.

This approach fits the app's current same-origin Next API route pattern and avoids depending on Enterprise token endpoint CORS behavior in the browser.

## User Flow

1. User opens the Credentials panel.
2. User selects `Enterprise` as the instance type.
3. User enters the Enterprise instance URL.
4. User enters the OAuth Client ID from their Enterprise API application.
5. User chooses the workflow or scope level.
6. User leaves `no_expiry` unchecked unless they explicitly need a non-expiring token.
7. User clicks `Connect with Enterprise OAuth`.
8. App redirects to `https://[site].stackenterprise.co/oauth` with:
   - `client_id`
   - `redirect_uri`
   - `scope`
   - `code_challenge`
   - `code_challenge_method=S256`
   - `state`
9. Enterprise prompts login and authorization.
10. Enterprise redirects back to the app callback route with `code` and `state`.
11. The callback route validates state and exchanges the code at `https://[site].stackenterprise.co/oauth/access_token/json`.
12. The app stores the returned token in session state as the Enterprise v3 credential.
13. User returns to the v3-only workflow and can run it without pasting an access token.

If authorization fails, is denied, or is cancelled, the app returns to Credentials with a clear status message and leaves existing credentials unchanged.

## Credential Lanes

The app will make the authentication lane explicit by instance type and workflow.

### Stack Overflow Basic/Business

Basic/Business workflows continue to use PAT authentication. The credentials form shows the PAT field for Basic/Business and does not offer Enterprise OAuth.

Validation requires a PAT for live API calls against Basic/Business.

### Stack Overflow Enterprise v3-only

Enterprise v3-only workflows use OAuth PKCE. User Group Sync is the first target workflow.

The credentials form shows:

- Instance URL.
- OAuth Client ID.
- OAuth connect button.
- Scope controls, including an explicit `no_expiry` opt-in.

The form does not ask the user to paste an Enterprise access token directly. The access token is produced by OAuth PKCE and stored in memory.

Validation requires a non-expired OAuth PKCE token.

### Stack Overflow Enterprise v2.3 Or Mixed v2.3/v3

Enterprise workflows that still call v2.3 keep API key support. If a mixed workflow also needs v3, it should use OAuth PKCE for the v3 token and API key for v2.3.

Validation requires:

- API key when the workflow calls v2.3 Enterprise endpoints.
- Non-expired OAuth PKCE token when the workflow calls v3 Enterprise endpoints.

## Data Model

Extend `SessionCredentials` without removing current manual credential fields needed by existing workflows.

```ts
interface SessionCredentials {
  instanceType: InstanceType;
  baseUrl: string;
  apiKey?: string;
  pat?: string;
  accessToken?: string;
  authSource?: "manual-pat" | "oauth-pkce";
  oauthClientId?: string;
  oauthScopes?: string[];
  accessTokenExpiresAt?: string;
}
```

`accessToken` remains in the model as the internal bearer token used by API v3 clients, but it is no longer a normal user-entered field for Enterprise.

`accessTokenExpiresAt` is derived from the Enterprise token response's `expires` value when present. If the user opts into `no_expiry`, the response may omit `expires`; in that case the session credential has no expiration timestamp.

## Scope Rules

The app builds scopes from workflow requirements.

- Read-only v3 workflows request the minimum read scope required by that workflow.
- User Group Sync requests `write_access`.
- `team_access` is reserved for future private-team-specific workflows.
- `private_info` is not requested by default.
- `read_inbox` is not requested by default.
- `no_expiry` is included only when the user checks an explicit opt-in control.

Multiple scopes are sent as comma-delimited values with no spaces, matching the Enterprise documentation.

## New Architecture Units

### `src/auth/oauthPkce.ts`

Responsibilities:

- Generate PKCE code verifier.
- Derive S256 code challenge from verifier.
- Generate random state values.
- Build Enterprise authorization URLs.
- Build Enterprise token endpoint URLs.
- Normalize and validate OAuth scope arrays.

### `src/server/oauthPkceApi.ts`

Responsibilities:

- Handle OAuth start requests in pure, testable functions.
- Validate Enterprise instance URL and client ID.
- Reject non-Enterprise OAuth targets.
- Create pending OAuth transaction payloads.
- Handle callback requests in pure, testable functions.
- Validate callback state.
- Exchange authorization code for JSON token response.
- Redact sensitive OAuth material from errors.

### `src/app/api/oauth/pkce/start/route.ts`

Responsibilities:

- Accept same-origin OAuth start requests from the browser.
- Delegate to `src/server/oauthPkceApi.ts`.
- Set a short-lived HTTP-only pending OAuth cookie.
- Return the Enterprise authorization URL.

### `src/app/api/oauth/pkce/callback/route.ts`

Responsibilities:

- Receive Enterprise redirect requests with `code`, `state`, or OAuth error query parameters.
- Delegate to `src/server/oauthPkceApi.ts`.
- Return a small callback page that forwards the outcome to the opener or redirects back to the app credentials panel.

### `src/components/CredentialsPanel.tsx`

Responsibilities:

- Present PAT entry for Basic/Business.
- Present Enterprise OAuth PKCE controls for Enterprise.
- Keep API key entry available for Enterprise workflows that need v2.3.
- Hide direct manual Enterprise access-token entry from the normal flow.
- Show OAuth connection state, token expiry, and reconnect actions.

### `src/credentials/credentialRules.ts`

Responsibilities:

- Validate Business/Basic PAT requirements.
- Validate Enterprise v3 OAuth token requirements.
- Validate Enterprise v2.3 API key requirements.
- Reject expired OAuth credentials with an actionable reconnect message.

## Pending OAuth State

Pending OAuth data should be stored in a short-lived HTTP-only cookie created by the OAuth start route and cleared by the callback route. This keeps the verifier available to the server-mediated callback without adding persisted server storage.

The pending cookie stores only OAuth transaction data, not long-lived credentials:

- Enterprise base URL.
- OAuth client ID.
- Requested scopes.
- Redirect URI.
- State.
- Code verifier.
- Created-at timestamp or expiration timestamp.

The cookie must preserve these properties:

- State is random and non-guessable.
- State is validated before token exchange.
- Code verifier is never logged.
- Code verifier is cleared after success or failure.
- Pending OAuth transactions expire quickly, with a target max age of 10 minutes.
- Cookie attributes are `HttpOnly`, `SameSite=Lax`, and `Secure` when served over HTTPS.
- Pending OAuth transaction data is not reused after a callback succeeds or fails.

## Error Handling

- Invalid Enterprise URL: reject before OAuth start.
- Non-Stack Enterprise host for OAuth: reject before redirect.
- Missing client ID: block OAuth start with a clear message.
- Missing or mismatched state: reject callback and do not save credentials.
- Missing pending code verifier: reject callback and do not save credentials.
- OAuth denial or cancellation: return to Credentials with a clear failure status.
- Token exchange failure: surface a safe error message with `code`, `code_verifier`, and tokens redacted.
- Missing `access_token` in token response: reject as an invalid OAuth response.
- Expired OAuth token: block v3-only workflows and prompt reconnect.
- Network failure during exchange: return a retryable OAuth failure message.

## Testing

Unit tests:

- PKCE verifier generation produces URL-safe values with sufficient entropy.
- PKCE challenge generation uses SHA-256 and base64url encoding.
- Enterprise authorization URL includes client ID, redirect URI, scopes, state, challenge, and `code_challenge_method=S256`.
- Enterprise token endpoint URL targets `/oauth/access_token/json`.
- Scope normalization omits `no_expiry` unless explicitly requested.
- OAuth start rejects malformed URLs, non-Enterprise hosts, and missing client IDs.
- OAuth callback rejects missing code, mismatched state, and missing verifier.
- OAuth callback returns a session credential on successful token exchange.
- OAuth callback redacts sensitive values from exchange errors.
- Credential validation requires PAT for Basic/Business live calls.
- Credential validation requires non-expired OAuth PKCE token for Enterprise v3-only workflows.
- Credential validation still requires API key for Enterprise v2.3 workflows.
- Credential validation rejects expired OAuth tokens.

UI tests:

- Basic/Business credentials show PAT and hide Enterprise OAuth controls.
- Enterprise credentials show OAuth controls and API key support.
- Direct Enterprise access-token entry is not shown in the normal credentials form.
- User Group Sync accepts OAuth-produced access tokens.
- User Group Sync blocks missing or expired OAuth credentials.
- `no_expiry` is unchecked by default and only appears in requested scopes after explicit opt-in.

## Security Notes

- Do not log access tokens, authorization codes, code verifiers, or raw token exchange URLs.
- Redact sensitive OAuth values from server and browser-visible errors.
- Keep credentials in memory only.
- Do not introduce a client secret path for PKCE.
- Require HTTPS Stack Enterprise instance URLs for OAuth.
- Keep the existing non-Enterprise host rejection posture for guarded write workflows.

## Rollout

The first implementation should wire OAuth PKCE into the Credentials panel and User Group Sync. Mixed v2.3/v3 reporting workflows keep API key entry for v2.3 and can consume OAuth-produced v3 tokens when available. Their report-specific UX can be refined after the first User Group Sync path proves the OAuth flow.

Future v3-only workflows can reuse the OAuth helper functions and credential validation rules.
