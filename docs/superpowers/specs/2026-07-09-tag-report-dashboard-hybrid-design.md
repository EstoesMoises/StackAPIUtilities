# Tag Report Dashboard Hybrid Design

## Summary

Redesign the Tag Report dashboard as an operational health overview with integrated period comparison. The approved direction combines the visual usefulness of an operations dashboard with the comparison clarity of a before/after analytics console.

The dashboard should answer two questions quickly:

- What is the current health of the tag ecosystem?
- What changed compared with the comparison period, when comparison data exists?

## Context

The current Tag Report dashboard already builds curated Tag Health rows and renders summary cards plus bar lists. That is useful, but the surface is too uniform: most panels use the same chart shape, and comparison is separated from the core health story. The new design keeps the existing Stack Overflow-native operations-console feel while adding more diverse dashboard primitives inspired by GCP-style monitoring dashboards and common analytics consoles.

## Goals

- Make the Tag Report dashboard more diverse and useful without making it decorative.
- Keep the default view operational: status mix, top activity, SME gaps, and response attention.
- Add comparison-aware metrics when comparison records are present.
- Use the same Tag Health rows that power the CSV so dashboard and export stay aligned.
- Surface partial-data warnings before users interpret charts or export results.
- Preserve dense, accessible, Stack Overflow-native product UI.

## Non-Goals

- Do not redesign all reports in this slice.
- Do not add a third-party charting library.
- Do not add persistent dashboard history.
- Do not infer exact trends when comparison data is missing.
- Do not add remediation/write actions from dashboard rows.

## Approved Dashboard Shape

The dashboard uses an A+B hybrid:

- `Operations Overview` is the default dashboard structure.
- `Comparison Console` appears inside that overview when comparison data exists.

Without comparison data, the dashboard shows:

- KPI strip for tags covered, healthy tags, SME gaps, response attention, and questions.
- Health status distribution panel.
- Top tags by page views.
- SME coverage queue.
- Response attention queue.
- Partial-data warnings when applicable.

With comparison data, the dashboard additionally shows:

- KPI deltas against the comparison period.
- Current and comparison period labels near the top.
- Health status comparison table.
- Fastest-change panel for meaningful shifts between periods.

## Dashboard Components

### KPI Strip

KPI cards should remain compact, but they should become more informative:

- `Tags covered`
- `Healthy tags`
- `SME gaps`
- `Response attention`
- `Questions`

When comparison data exists, each card can include a short delta line such as `+12 vs prior` or `-5 vs prior`. Deltas must be derived from normalized Tag Health rows and hidden when comparison data is unavailable.

### Health Status Distribution

Render a status distribution panel with:

- A compact visual distribution using the four Tag Health statuses.
- A legend/list that includes count and comparison delta when available.
- Status colors that use the existing product palette: green for healthy, orange for SME coverage, red for response attention, and a secondary accent for low activity.

The visual must not be the only source of information; counts and labels must remain visible as text.

### Period Comparison

When comparison records exist, render a comparison panel inside the Tag Report dashboard rather than relying only on the generic comparison section. The table should compare health-status counts:

- Health status
- Current count
- Comparison count
- Delta

The panel should include current and comparison period labels using the existing period formatting helper.

### Top Tags By Page Views

Keep a ranked bar list for top tags by page views. This remains a direct answer to "which tags are most active or visible?"

### Fastest Changes

When comparison data exists, render a fastest-change panel that highlights the largest meaningful movements. The first version should stay conservative and use data already available in Tag Health rows:

- New or increased response-attention tags.
- Improved or worsened SME coverage counts.
- Large page-view or question-count movement where the same tag exists in both periods.

Rows should be sorted by absolute impact and should avoid presenting unsupported precision.

### Action Queues

Replace same-shaped alert bar lists with queue-style panels:

- `SME coverage queue`: tags with no SME coverage, sorted by question count, page views, then tag name.
- `Response attention queue`: tags with unanswered questions or slow first-answer time, sorted by unanswered count, median first-answer hours, page views, then tag name.

Each row should show the tag name and the relevant supporting numbers. These queues should align with the CSV `recommended_action` field, but they should not imply the app performed any write action.

## Data Model And Transform Changes

Keep Tag Report derivation in `src/reports/tagReport.ts`, not React components.

Extend the Tag Health summary model with dashboard-ready values such as:

- Total questions.
- Status distribution rows.
- Action queue row metadata.
- Optional comparison summary derived from current and comparison Tag Health rows.
- Optional fastest-change rows.

React components should receive prepared summary data and focus on rendering.

## UI Implementation Notes

- Use existing CSS variables and the current light product surface.
- Use restrained color as semantic signal, not decoration.
- Keep panel radius at the existing 8px vocabulary.
- Avoid nested cards; use dashboard panels as sections and cards only for the KPI strip.
- Ensure the dashboard collapses cleanly on narrower widths.
- Do not use fluid type sizing; use the existing product type scale.

## Error Handling And Warnings

Warnings already attached to report output should remain above dashboard content. Partial-data warnings must be visible before KPI, comparison, and export interpretation.

If comparison records are present but cannot be normalized into Tag Health rows, the dashboard should render the current-period overview and omit comparison-specific panels rather than showing misleading deltas.

## Accessibility

- All charts need visible text labels and numeric values.
- Color must not be the only status signal.
- Comparison deltas should include signs and labels.
- Tables need semantic headers.
- Empty queues should show plain-language empty states.
- Existing focus, contrast, and reduced-motion expectations still apply.

## Testing Strategy

Add or update tests for:

- Tag Health summary includes total questions and status distribution.
- Dashboard renders the operations overview without comparison data.
- Dashboard renders KPI deltas, status comparison, and fastest changes with comparison data.
- Dashboard omits comparison panels when comparison records are unavailable.
- SME coverage and response queues sort rows correctly.
- Partial-data warnings still render before dashboard sections.
- Imported Tag Metric rows and live API records still normalize into the same dashboard model.

## Acceptance Criteria

- Tag Report dashboard feels more diverse than repeated cards and bar lists.
- Current health is understandable at a glance.
- Comparison insights appear when comparison data exists.
- Dashboard metrics remain aligned with Tag Health CSV rows.
- Partial-data warnings stay visible.
- Existing raw dataset and report output flows continue to work.
- Tests cover transform behavior and rendered dashboard states.
