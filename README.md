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

Uploaded report outputs are parsed locally in the browser session and rendered as dashboards plus raw tables. Credentials and generated report data are session-only; the app does not persist credentials or report data in browser storage.

Live API execution runs through the same-origin Next.js route at `/api/reports/run`, which lets the server call Stack Enterprise or Teams APIs without browser CORS blocking credential headers. Reports that still need unsupported live datasets stop before fetching and direct users to upload existing CSV or JSON outputs.

## Credentials

Credentials and generated report data are session-only; the app does not persist them in browser storage.

The shared credentials screen supports three authentication lanes:

- Stack Overflow Basic/Business: instance URL plus personal access token.
- Stack Overflow Enterprise API v3: OAuth Authorization Code with PKCE, using the Enterprise instance URL and OAuth Client ID.
- Stack Overflow Enterprise API v2.3: API key remains available for workflows that still call v2.3 endpoints.

Enterprise OAuth requests the minimum workflow scope by default. User Group Sync requests `write_access`. `no_expiry` is off by default and is included only when explicitly selected.

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
