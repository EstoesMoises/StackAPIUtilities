# Reporting MVP Redesign Design

Date: 2026-07-03

## Goal

Redesign the reporting MVP so it feels like a Stack Overflow product tool with current brand cues, while keeping the app immediately usable for browser-only report workflows.

The UI should answer three questions without explanation text:

- Which report can I run or inspect?
- What credentials or uploaded data do I have in this session?
- Where is the dashboard or raw data for the selected report?

## References

- Stack Internal question 37 confirms Stacks is Stack Overflow's official design system and that `@stackoverflow/stacks` is the supported package for new products.
- Stack Internal article 26056 reinforces accessibility, self-service UI recommendations, focus styles, atomic spacing, and legacy color cleanup as active Stacks concerns.
- Public Stack Overflow Design System brand color guidance establishes Stack Orange `#FF5E00`, Off-Black `#201C1D`, Off-White `#F0EFEE`, and supporting brand colors.
- Public product color fundamentals emphasize neutral UI dominance, sparse saturated color usage, semantic color roles, and background layers.
- Public brand typography guidance establishes Stack Sans, careful use of notched headline styling only at large headline sizes, left alignment for functional contexts, and highlighted headline effects for headline-only moments.
- Public stack system guidance supports simple 2D stack motifs for B2B clarity and reserves 3D/expressive treatments for high-level brand moments.

## Considered Approaches

### Dense Internal Tool

This approach would use mostly Stacks product defaults: white panels, gray borders, small headings, and minimal brand expression. It is very efficient, but it does not address the user's request for newer Stack Overflow color and typography effects.

### Expressive Brand Surface

This approach would use a large brand-forward hero, strong orange/off-black/off-white fields, and bolder headline effects. It would feel more like a campaign or launch surface, but it would bury the actual report workflow and conflict with the app's operational purpose.

### Chosen: Hybrid Product Workspace

The app will remain a dense reports workspace, but with a more recognizable Stack Overflow system layer. The top area will use an off-black brand strip with Stack Orange accents and a compact highlighted heading. The main report area will use neutral product surfaces with clearer hierarchy, sharper run/upload/credential affordances, and charts accented with orange, blue, green, purple, and yellow only where those colors carry meaning or aid comparison.

## Layout

The first viewport will be a real workspace, not a landing page.

- A compact branded topbar identifies the product and exposes the three primary panels: Reports, Credentials, Uploads.
- A left report rail shows the report catalog with selected state, source repository, and a small status hint for browser readiness.
- The main workspace opens with the selected report header, report description, credential/run controls, and dashboard/table tabs.
- Session overview and run status become slim workspace strips so they feel like current state, not separate content blocks.
- On smaller screens, the report rail stacks above the workspace and panel navigation remains reachable at the top.

## Visual System

The redesign will keep `@stackoverflow/stacks` as the base and add app-specific CSS tokens for the newer brand palette.

- Use Off-White as the page background and Off-Black for the topbar and key text.
- Use Stack Orange for primary identity, selected states, active tabs, and primary action focus.
- Use supporting colors sparingly in metric/chart accents: blue for information, green for success/positive values, yellow for caution or pending state, purple for discovery/new report affordances.
- Keep border radii at 8px or below.
- Avoid decorative cards nested inside cards. Repeated report items, metrics, upload/credential panels, and tables may use framed surfaces; page sections should stay full-width or lightly bounded.
- Add a small 2D stack-inspired motif using CSS rectangles in the topbar/report header. It must be structural and subtle, not a standalone illustration.

## Typography

- Use the Stacks/system font stack for all functional UI.
- Use larger, bolder headline treatment only in the topbar brand title and selected report heading.
- Keep labels compact, uppercase, and scannable for metadata.
- Keep line-height and spacing stable so report titles, source repositories, and button labels do not overflow on mobile.
- Do not apply notched typography effects at small sizes. If a headline highlight effect is used, it should be simulated with a simple orange/off-white backing treatment on large text only.

## Component Changes

### App Shell

The shell becomes a product workspace:

- Brand block: "Stack API Utilities" with a short "SO4T reports" descriptor.
- Top nav: Stacks-style segmented panel buttons with active orange underline/fill.
- Session badges: optional small indicators for loaded datasets and session credentials.
- Body grid: fixed-width report rail plus flexible workspace.

### Report Catalog

Report choices should look like a navigation rail, not isolated cards.

- Each report item shows title, repo/source, and a browser-ready/read-only label.
- Selected state uses orange left border and off-white/orange-tinted background.
- Hover and focus states must be visible and accessible.

### Report Workspace

The selected report view becomes the user's main control center.

- Report header includes source repo, report title, description, and a compact readiness/status row.
- Credential notice becomes more direct: show whether credentials are missing, saved, or not enough for this report.
- Run controls use one clear primary button and one secondary disabled batch button with plainer copy.
- Dashboard and raw data tabs remain, but selected state should be stronger.

### Credentials

Credentials remain session-only.

- Put credential persistence copy near the heading, not buried below the form.
- Keep shared credential fields in one form.
- Keep report-specific scope notes in a distinct note area with placeholders for future guidance.
- Use clearer labels for API key, access token, PAT, instance type, and instance URL.

### Uploads

Uploads should feel like the current reliable path for report data.

- Make the file picker area look intentional and action-oriented.
- Keep local/session-only language visible.
- Keep success and error notices prominent.

### Dashboards

Dashboards should be more compact and more visual.

- Metric cards get strong numeric hierarchy, tabular numbers, and small label text.
- Bar charts use the brand/product color palette without overwhelming the neutral UI.
- Tables keep sticky-ish scannability through borders, spacing, and constrained overflow.

## Data Flow

The redesign does not change application state or report execution behavior.

- Session credentials remain in React memory only.
- Uploaded CSV/JSON files are parsed locally and stored in session state.
- Dashboard components continue to receive parsed records by report ID.
- Live API execution remains out of scope for this redesign and will be wired after the visual and workflow foundation is stable.

## Error Handling

Existing success/error notices remain, but presentation should be clearer.

- Missing credentials sends users to the Credentials panel with an explicit run status message.
- Invalid credentials show report-specific validation messages.
- Upload parse errors use danger styling and preserve the user's place.
- Empty dashboards explain that the user can upload an existing output or run the report after API execution exists.

## Accessibility

- Keep semantic `header`, `nav`, `aside`, `main`, `section`, and `button` structure.
- Preserve `aria-label`, `aria-pressed`, `role="tab"`, and `aria-selected` semantics.
- Use visible focus states for report rail items, nav buttons, upload input, and run buttons.
- Do not rely on orange/yellow text alone for contrast. Use saturated colors as fills, borders, or accents with readable neutral text.
- Ensure mobile layout has no overlapping text or clipped buttons.

## Testing

- Update component tests only if accessible names or core structure changes.
- Keep existing report import, dashboard, and credential validation tests passing.
- Run `pnpm test`, `pnpm build`, and `pnpm e2e`.
- Use the in-app browser to visually inspect the local app after changes, including desktop and narrow/mobile-ish viewport states if the tool path supports it.

## Out of Scope

- Live API execution wiring.
- Credential persistence beyond the current browser session.
- New report collectors.
- Full dark mode.
- A marketing landing page.
