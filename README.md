# Stack API Utilities

Static browser app for Stack Overflow for Teams reporting utilities.

## MVP Scope

The reporting MVP focuses on browser-ready read-only reports:

- Tag Report
- API User Report
- Inactive Users
- Interactions
- Community Members
- Data Export

Uploaded report outputs are parsed locally in the browser session and rendered as dashboards plus raw tables. Credentials and generated report data are session-only; the app does not persist credentials or report data in browser storage.

Live API clients, credential validation, and dataset planning scaffolding are present, but live API execution is not connected from the UI yet.

## Credentials

The shared credentials screen captures:

- Instance URL
- API key
- Access token
- Personal access token

Credential guidance placeholder: add customer-facing instructions for obtaining each credential here.

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

## Static Build

Create the static build:

```bash
pnpm build
```

The deployable static files are written to `dist/`.
