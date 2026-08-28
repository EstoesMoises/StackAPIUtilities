---
name: Stack API Utilities
description: A trusted, practical Stack-native operations workbench for browser-local reports and utilities.
colors:
  primary-orange: "oklch(0.72 0.18 48)"
  primary-orange-strong: "oklch(0.62 0.19 43)"
  primary-orange-deep: "oklch(0.47 0.16 39)"
  primary-orange-soft: "oklch(0.95 0.04 56)"
  information-blue: "oklch(0.48 0.13 252)"
  information-blue-soft: "oklch(0.95 0.025 252)"
  success-green: "oklch(0.52 0.13 147)"
  success-green-text: "oklch(0.42 0.12 147)"
  success-green-soft: "oklch(0.94 0.04 147)"
  danger-red: "oklch(0.54 0.18 28)"
  danger-red-soft: "oklch(0.95 0.04 28)"
  warning-yellow: "oklch(0.86 0.15 88)"
  warning-yellow-soft: "oklch(0.96 0.05 88)"
  neutral-canvas: "oklch(0.96 0.006 255)"
  neutral-canvas-deep: "oklch(0.93 0.012 255)"
  neutral-surface: "oklch(1 0 0)"
  neutral-surface-raised: "oklch(0.985 0.004 255)"
  neutral-surface-hover: "oklch(0.965 0.009 255)"
  neutral-ink: "oklch(0.2 0.035 255)"
  neutral-text: "oklch(0.29 0.028 255)"
  neutral-text-muted: "oklch(0.43 0.027 255)"
  neutral-text-subtle: "oklch(0.51 0.025 255)"
  neutral-border: "oklch(0.84 0.018 255)"
  neutral-border-strong: "oklch(0.7 0.03 255)"
typography:
  display:
    fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Helvetica Neue, Arial, Noto Sans, sans-serif"
    fontSize: "34px"
    fontWeight: 850
    lineHeight: 1.05
    letterSpacing: "0"
  headline:
    fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Helvetica Neue, Arial, Noto Sans, sans-serif"
    fontSize: "24px"
    fontWeight: 850
    lineHeight: 1.2
    letterSpacing: "0"
  title:
    fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Helvetica Neue, Arial, Noto Sans, sans-serif"
    fontSize: "18px"
    fontWeight: 850
    lineHeight: 1.25
    letterSpacing: "0"
  body:
    fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Helvetica Neue, Arial, Noto Sans, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.55
    letterSpacing: "0"
  label:
    fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Helvetica Neue, Arial, Noto Sans, sans-serif"
    fontSize: "12px"
    fontWeight: 800
    lineHeight: 1.3
    letterSpacing: "0"
rounded:
  control-tight: "5px"
  control: "7px"
  panel: "8px"
  pill: "999px"
spacing:
  compact: "4px"
  control: "8px"
  field: "12px"
  section: "16px"
  panel: "22px"
  workspace: "28px"
components:
  button-primary:
    backgroundColor: "{colors.primary-orange}"
    textColor: "{colors.neutral-ink}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    padding: "7px 13px"
    height: "36px"
  button-outlined:
    backgroundColor: "{colors.neutral-surface}"
    textColor: "{colors.neutral-ink}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    padding: "7px 13px"
    height: "36px"
  input:
    backgroundColor: "{colors.neutral-surface}"
    textColor: "{colors.neutral-ink}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    height: "38px"
    width: "100%"
  tab-selected:
    backgroundColor: "{colors.primary-orange-soft}"
    textColor: "{colors.neutral-ink}"
    typography: "{typography.label}"
    rounded: "{rounded.control-tight}"
    padding: "7px 12px"
    height: "36px"
  card:
    backgroundColor: "{colors.neutral-surface}"
    textColor: "{colors.neutral-text}"
    rounded: "{rounded.panel}"
    padding: "22px"
  status-pill:
    backgroundColor: "{colors.neutral-surface-raised}"
    textColor: "{colors.neutral-text}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "5px 9px"
    height: "28px"
---

# Design System: Stack API Utilities

## Overview

**Creative North Star: "The Stack-Native Operations Workbench"**

Stack API Utilities is a light, exacting console for people doing consequential operational work with local data. Its visual authority comes from clean white work surfaces, cool neutral canvas layers, dark ink, compact controls, and restrained Stack Overflow orange—not from ornamental dashboard furniture. The result should feel trusted, practical, sharp, and warmer than a generic administration tool.

The system supports dense evidence without making every surface equally loud. Clear headings, bordered regions, native controls, labeled status, and bounded tables make a task's current state legible. High-value results may use a deliverable-first command center: stable identity and direct exports lead into sectioned findings, evidence, and methodology while preserving the same incumbent console world.

**Key Characteristics:**

- Light neutral canvas with white and softly tinted operational surfaces.
- Ink-first typography with a compact, high-weight hierarchy.
- Orange reserved for primary action, selection, focus, and the approved report-shell top rule.
- Border-led structure, shallow depth, and familiar native control behavior.
- Dense data remains bounded, searchable, and keyboard reachable.

## Colors

The palette is neutral-led and role-driven: orange carries functional emphasis, blue carries information and the paired CSV action, and green, yellow, and red communicate labeled operational states.

### Primary

- **Stack Action Orange:** Primary action fill, selected-control accent, checkbox accent, and report command-center top rule.
- **Deep Focus Orange:** Visible focus outline and strongest orange edge; use for keyboard focus and active emphasis, not general decoration.
- **Soft Selection Orange:** Quiet selected-state field behind ink text in navigation, tabs, and choice cards.

### Secondary

- **Evidence Blue:** Informational emphasis and the direct evidence-CSV action.
- **Soft Evidence Blue:** Low-intensity information surfaces and evidence-action backgrounds.

### Tertiary

- **Success Green:** Complete, ready, and success states, always paired with visible language.
- **Warning Yellow:** Limitations and partial-result notices, always paired with an explicit label or message.
- **Danger Red:** Failed, unavailable, and highest-risk states, always paired with visible text.

### Neutral

- **Cool Canvas:** Application background and table-heading field.
- **Raised Canvas:** Sidebar and low-contrast companion surfaces.
- **Paper Surface:** Dominant panel, control, table, and popover surface.
- **Operational Ink:** Headings, high-emphasis labels, and primary control text.
- **Working Text:** Default body and data text.
- **Muted Text:** Metadata, supporting labels, and page summaries.
- **Quiet and Strong Borders:** Separators and control boundaries establish hierarchy before shadow does.

### Named Rules

**The Functional Orange Rule.** Orange marks primary action, selection, focus, or the command center's approved top edge; it does not become ambient decoration.

**The Two-Channel Status Rule.** Status color always travels with a label, message, icon-free structure, or state name so meaning never depends on hue alone.

## Typography

**Display Font:** Inter with the system UI sans-serif stack
**Body Font:** Inter with the system UI sans-serif stack

**Character:** One compact sans-serif family keeps technical content familiar and highly scannable. Weight and size, rather than a decorative font pairing, separate workspace identity, report hierarchy, controls, and dense evidence.

### Hierarchy

- **Display** (850, 34px, 1.05): Top-level workspace headings; reduce to the shipped 28px treatment on narrow layouts.
- **Headline** (850, 24px, 1.2): Generated report identity and major result titles.
- **Title** (850, 18px, 1.25): Section titles for summaries, findings, warnings, deliverables, and methodology.
- **Body** (400, 14px, 1.55): Explanations, findings context, and methodology, generally constrained to about 75 characters per line for reading blocks.
- **Data and control text** (750–800, 13px, 1.2–1.4): Buttons, tabs, table cells, filters, and compact operational labels.
- **Label** (750–800, 12px, 1.3): Metadata, field labels, table headings, definitions, and status pills.

### Named Rules

**The Dense, Not Tiny Rule.** Operational density uses 12px labels and 13–14px controls or table text; 11px is reserved for short metadata chips, never body copy.

**The Weight Carries Hierarchy Rule.** Keep letter spacing neutral and use the established 750–850 weights to clarify scan order.

## Layout

The application shell combines a sticky top bar, a 260–316px navigation rail, and a min-width-zero workspace. Main panels and report command centers are bounded at 1180px, use 22–28px desktop padding, and organize content on a recurring 8/12/16/22px rhythm. The desktop report overview uses a 1.65fr executive column with a narrower 0.75fr deliverable companion; dense metrics may form a five-column strip.

At 780px the shell becomes one column, the top bar stops sticking, workspace padding tightens to 16px, and large headings reduce. At 860px report identity, actions, and the overview companion stack. At 640px report padding becomes 18px, direct actions fill the width, tabs wrap without truncation, metrics stack, filters become full width, definition lists become one column, and pagination becomes vertical. Horizontal overflow belongs only to a labeled, focusable table region.

**The Bounded Workspace Rule.** Keep the page frame stable; let wide evidence scroll inside its named region and paginate long datasets instead of extending the document indefinitely.

**The Actions Survive Wrap Rule.** Primary actions wrap or stack before their labels truncate, and direct deliverable actions remain visible at narrow widths.

## Elevation & Depth

The system is flat by default. Canvas tint, white surfaces, 1px borders, and section dividers create most depth. A shallow hairline shadow supports high-level workspace and command-center shells, while the stronger popover shadow is reserved for detached menus such as column selection. Hover lift is only 1px and returns to rest on active press.

### Shadow Vocabulary

- **Hairline surface** (`0 1px 2px oklch(0.2 0.035 255 / 0.08)`): Top bars, main panels, command centers, and compact export disclosures.
- **Detached popover** (`0 8px 22px oklch(0.2 0.035 255 / 0.16)`): Floating menus that must read above dense table content.

### Named Rules

**The Border-Before-Shadow Rule.** Use tonal layers and borders for routine grouping; introduce a shadow only when a surface is structurally elevated or detached.

## Shapes

Geometry is practical and gently rounded. Primary panels and notices use 8px corners; controls use 7px; compact interactive rows may tighten to 5–6px. Fully rounded pills are reserved for terse status, completeness, tier, or session labels. One-pixel neutral borders are the dominant silhouette, with stronger borders on controls and active emphasis.

**The Quiet Radius Rule.** Use the 7–8px control and panel family by default; pill geometry signals compact state rather than general decoration.

## Components

Components feel direct and familiar: dark readable labels, explicit borders, brief movement, and strong keyboard focus.

### Buttons

- **Shape:** Gently rounded control corners (7px), a 36px minimum height, and compact 7px by 13px padding.
- **Primary:** Stack Action Orange behind Operational Ink, with a Strong Orange edge. The hover becomes slightly lighter while the edge deepens.
- **Secondary / outlined:** Paper Surface with a strong neutral border; hover shifts to the neutral hover surface.
- **Evidence export:** Evidence Blue border and text on Soft Evidence Blue, kept directly beside the primary PDF action where both exports exist.
- **Hover / focus:** Hover lifts 1px; active returns to rest. Keyboard focus is a 3px Deep Focus Orange outline with a 2px offset.
- **Disabled:** Quiet border and text on Cool Canvas, with no hidden opacity reduction.

### Chips

- **Style:** Fully rounded, compact, and label-led. Neutral session pills use raised paper; quality and tier pills use their semantic soft surface, semantic border, and readable dark text.
- **State:** Color reinforces visible language such as Complete, Partial, Immediate gap, or Light coverage.

### Cards / Containers

- **Corner Style:** Quietly rounded panels (8px).
- **Background:** Paper Surface for primary work; Raised Canvas for companion, summary, and methodology surfaces.
- **Shadow Strategy:** Border-led; only high-level shells receive the hairline surface shadow.
- **Border:** One-pixel Quiet Border, strengthening only for active controls or detached surfaces.
- **Internal Padding:** 16px for compact companions, 22–24px for primary panels, 12–14px for dense list rows.

### Inputs / Fields

- **Style:** White field, strong neutral border, 7px corners, dark ink value, and a minimum 38px height in dense report controls.
- **Focus:** A 3px Deep Focus Orange outline with a 2px offset.
- **Error / Disabled:** State remains explicit in copy; disabled fields use Cool Canvas and Quiet Text.

### Navigation

Application navigation sits in a bordered Cool Canvas rail of compact buttons. Default items are transparent, hover resolves to Paper Surface, and selection uses Soft Selection Orange with an orange-leaning border. Report section tabs use the same state grammar, wrap on small screens, and preserve semantic tab and keyboard-arrow behavior.

### Tables and Evidence Regions

Tables use 12px high-weight headings on Cool Canvas and 13px cells separated by quiet horizontal rules. Large evidence views pair labeled search and filter controls with sticky headers, column visibility, sorting, and pagination. Overflow is contained by the focusable table wrapper rather than the page.

### Report Command Center

Use this pattern for generated results that genuinely combine deliverable actions with multiple useful report sections. The shell keeps report identity and direct exports together, uses the approved 3px orange top rule, places content-aware tabs immediately below, and gives each section a bounded job-specific layout. It is a reusable result pattern, not a requirement for simple utilities or single-purpose forms.

**The Deliverables Stay Direct Rule.** When a report supports both polished PDF and canonical CSV, expose both as direct named actions; secondary formats may use a disclosure.

## Do's and Don'ts

### Do:

- **Do** lead with white and cool-neutral work surfaces, dark ink, and visible boundaries.
- **Do** reserve orange for primary action, selection, focus, and the report command center's approved top rule.
- **Do** keep statuses readable in text and use soft semantic fills as reinforcement.
- **Do** contain wide tables in labeled focusable regions and paginate large evidence sets.
- **Do** preserve visible 3px focus outlines and reduced-motion-safe transitions.
- **Do** use the command center only when result identity, deliverables, and multiple report sections need to stay in context together.

### Don't:

- **Don't** turn every panel into a competing call to action or scatter orange across passive decoration.
- **Don't** rely on low-contrast dark surfaces, nearly invisible controls, or color alone to convey state.
- **Don't** use generic analytics-card grids when a concise brief, bounded table, or task-specific panel is clearer.
- **Don't** let data tables force page-level horizontal overflow or allow large datasets to create an unbounded report page.
- **Don't** hide supported primary PDF or canonical CSV deliverables inside a catch-all menu.
