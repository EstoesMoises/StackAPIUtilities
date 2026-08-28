# SME Coverage Executive Brief Design

## Outcome

Replace the long SME Coverage Decision Pack PDF with a share-ready Executive Brief that is two pages for normal reports and may flow to a third page only when warnings or prioritized findings are unusually large. Improve the on-screen copy-ready assessment so it pastes cleanly into email, Slack, documents, and AI tools.

## Approved direction

The approved direction is **Executive brief**.

- The PDF is a decision aid, not the complete evidence archive.
- The canonical evidence CSV remains the complete dataset and is explicitly referenced in the PDF.
- The PDF has no standalone cover and no supporting-evidence appendix.
- Normal complete and partial reports render in two pages.
- An unusually large report may render a third page, but the PDF must remain bounded.

## PDF information architecture

### Page 1: Decision summary

1. Product and report identity with page number.
2. Report title, instance, generated timestamp, scope, collection state, and analysis quality.
3. Evidence limitations when present, before conclusions.
4. Six compact summary metrics.
5. A one-paragraph bottom line.
6. A structured assessment with labeled priority groups and a recommended next step.

### Page 2: Priority action register

1. Ranked priority findings in canonical decision-pack order.
2. Compact columns for tag, demand and SME count, tier, and recommended action.
3. A strict bounded row count suitable for two pages in normal reports.
4. A note when additional findings were omitted from the PDF.
5. A prominent handoff to the evidence CSV for complete filtering, audit, and AI-assisted analysis.
6. A compact methodology note rather than the current methodology grid.

### Third-page behavior

React-PDF may flow the second page to a third page when warnings, long labels, or the bounded priority register cannot fit. The model must cap included priority rows so no fourth page is created in the tested stress case.

## Copy-ready assessment

The assessment becomes a shared structured presentation model used by the app and PDF. It contains:

- `Bottom line`
- one section for each available tier: `Immediate priorities`, `Critical under-coverage`, and `Light coverage`
- compact evidence items with tag, page views, SME count, and recommended action
- `Recommended next step`
- `Evidence quality`
- `Full evidence: See the accompanying CSV` when evidence exists

The on-screen version uses semantic headings and lists. The copy action writes plain Markdown with the same hierarchy, so the result remains readable in email and Slack and easy for AI tools to parse. Copy success and failure feedback remains accessible and outside the reading content.

## Content rules

- Preserve canonical finding order: immediate gaps, critical under-coverage, then light coverage.
- Preserve source warning order and place warnings before conclusions.
- Use prepared numeric values and nearest-whole ratio display rules already established by the analyzer.
- Never imply complete evidence is embedded in the PDF.
- Empty reports remain explicit and useful.
- Risky presentation Unicode remains normalized for built-in PDF fonts.

## Visual rules

- Follow `DESIGN.md`: border-led white paper, cool neutral support surfaces, operational ink, and restrained orange.
- Orange is limited to the approved report rule and functional emphasis.
- Use Helvetica in the PDF for portability.
- Use at least 36-point horizontal PDF margins and visible fixed page numbers.
- Avoid decorative cover space, repeated cards, side stripes, gradients, and dense appendix tables.

## Acceptance criteria

- Complete and partial fixtures render as valid A4 PDFs with exactly two pages.
- A stress fixture with bounded long findings renders no more than three pages.
- The PDF contains no `Supporting evidence appendix` heading.
- The PDF explicitly directs users to the complete evidence CSV.
- The UI renders labeled assessment sections and copies structured Markdown rather than the original paragraph blob.
- PDF, assessment, model, export, lint, and build tests pass.

