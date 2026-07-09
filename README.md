# Stack API Utilities

Next.js app for Stack Overflow for Teams reporting utilities.

## MVP Scope

The reporting MVP focuses on browser-ready read-only reports:

- Tag Report
- API User Report
- Inactive Users
- Interactions
- Community Members
- Data Export

Uploaded report outputs are parsed locally in the browser and rendered as dashboards plus raw tables. Credentials are session-only and are not persisted in browser storage. Loaded datasets are stored locally in this browser by default so report runs and uploads can survive refreshes, tab closes, and browser restarts until the user removes individual datasets or flushes all stored datasets from the Datasets panel.

Live API execution runs through the same-origin Next.js route at `/api/reports/run`, which lets the server call Stack Enterprise or Teams APIs without browser CORS blocking credential headers. Reports that still need unsupported live datasets stop before fetching and direct users to upload existing CSV or JSON outputs.

## Credentials

Credentials are session-only; the app does not persist access tokens, API keys, PATs, OAuth client IDs, or OAuth state in browser storage.

Loaded report datasets are stored locally in this browser by default. Use the Datasets panel to remove individual datasets or flush all stored datasets.

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
