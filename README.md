# Stack API Utilities

Next.js app for Stack Overflow for Teams and Stack Enterprise API workflows.

## Product Areas

Scripts produce reusable datasets and report outputs. The current browser-ready,
read-only Scripts are:

- Tag Report
- API User Report
- Inactive Users
- Interactions
- Community Members
- Data Export

Tag Report includes the stable Enterprise API v3 tag ID and tag creation date.
Its `last_used` value is the latest UTC `creation_date` among questions or
articles that currently carry the tag, not tag assignment, edit, or general
activity time. Last-used collection scans all fetched history even when health
metrics are date-scoped; API cap warnings mean the result may be incomplete.

Utilities answer defined operational questions directly from API data. The SME
Coverage Analyzer produces an evidence-first decision pack for the question:
where is all-time knowledge demand not matched by current assigned-SME coverage?
It is self-contained and read-only; it does not require a prior Script run or an
uploaded report.

The analyzer's three-source pipeline collects all-time v2 tags and questions plus
v3 tags. Only the v3 `subjectMatterExpertCount` field represents assigned-SME
coverage. V2 top answerers are never used as the assigned-SME denominator. Deep
audit is the default collection setting; Quick, Standard, and custom capped runs
are partial samples and label their conclusions accordingly.

Uploaded Script outputs are parsed locally in the browser and rendered as
dashboards plus raw tables. Script datasets, Utility decision packs, and Utility
supporting datasets are stored browser-locally by default so they can survive
refreshes, tab closes, and browser restarts until the user removes individual
datasets or flushes all stored datasets from the Datasets panel. Credentials
remain in memory only and are never included in persisted or exported results.

Live Script execution uses the same-origin Next.js route at `/api/reports/run`.
SME Coverage Analyzer execution uses the same-origin route at
`/api/utilities/sme-coverage/run`. These routes let the server call Stack
Enterprise or Teams APIs without browser CORS blocking credential headers.
Scripts that still need unsupported live datasets stop before fetching and
direct users to upload existing CSV or JSON outputs.

## Credentials

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

Loaded Script datasets and Utility supporting datasets and decision packs are
stored locally in this browser by default. Use the Datasets panel to remove
individual datasets or flush all stored datasets.

The shared credentials screen supports three authentication lanes:

- Stack Overflow Basic/Business: instance URL plus personal access token.
- Stack Overflow Enterprise API v3: OAuth Authorization Code with PKCE, using the Enterprise instance URL and OAuth Client ID.
- Stack Overflow Enterprise API v2.3: API key remains available for workflows that still call v2.3 endpoints.

Enterprise OAuth requests the minimum workflow scope by default. User Group Sync requests `write_access`. `no_expiry` is off by default and is included only when explicitly selected.

In production, Enterprise OAuth uses the app's HTTPS request origin as the callback origin by default. If the app is behind a proxy or needs a fixed callback URL, set one of these server environment variables:

- `STACK_API_UTILITIES_PUBLIC_ORIGIN=https://your-app.example.com`
- `STACK_API_UTILITIES_OAUTH_REDIRECT_URI=https://your-app.example.com/api/oauth/pkce/callback`

### Local Enterprise OAuth Test

For Enterprise OAuth clients that require a non-localhost redirect URI, run the app through `redirectmeto` while keeping the local PKCE callback:

```bash
STACK_API_UTILITIES_OAUTH_REDIRECT_URI=http://redirectmeto.com/http://127.0.0.1:3002/api/oauth/pkce/callback pnpm exec next dev -H 127.0.0.1 -p 3002
```

Register this exact redirect URI with the Enterprise OAuth client:

```text
http://redirectmeto.com/http://127.0.0.1:3002/api/oauth/pkce/callback
```

## Development

Install dependencies:

```bash
pnpm install
```

Start the dev server:

```bash
pnpm dev
```

Run verification:

```bash
pnpm test
pnpm build
pnpm e2e
```

## Production Build

Create the production build:

```bash
pnpm build
```

Run the production server:

```bash
pnpm preview
```
