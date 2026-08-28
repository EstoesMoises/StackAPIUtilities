# SME Coverage Executive Brief Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a normally two-page SME Coverage Executive Brief and a structured assessment that copies cleanly into email, Slack, and AI tools.

**Architecture:** Add one shared assessment-brief formatter derived from the decision pack, then consume it in both the React UI and the React-PDF model. Replace the cover-and-appendix PDF with two semantic page sections and a bounded priority register that may flow to one additional page only in unusually large cases.

**Tech Stack:** TypeScript, React 19, `@react-pdf/renderer`, Vitest, Testing Library, Next.js

**Spec:** `docs/superpowers/specs/2026-08-27-sme-executive-brief-design.md`

## Global Constraints

- Normal complete and partial reports render in exactly two A4 pages.
- Stress reports render in no more than three pages.
- The evidence appendix is removed from the PDF; the canonical CSV remains the complete dataset.
- Source warning order and canonical finding order are preserved.
- The clipboard output is structured Markdown suitable for email, Slack, documents, and AI tools.
- PDF text uses Helvetica, 36-point horizontal margins, visible page numbers, and safe ASCII normalization.
- UI and PDF visuals follow `DESIGN.md`.

---

### Task 1: Shared assessment brief model

**Files:**
- Create: `src/utilities/smeCoverage/assessmentBrief.ts`
- Create: `src/utilities/smeCoverage/assessmentBrief.test.ts`

**Interfaces:**
- Consumes: `SmeCoverageDecisionPack` and `SmeCoverageEvidenceRow` from `src/utilities/smeCoverage/model.ts`.
- Produces: `buildSmeCoverageAssessmentBrief(pack): SmeCoverageAssessmentBrief` and `formatSmeCoverageAssessmentMarkdown(brief): string`.

- [ ] **Step 1: Write failing formatter tests**

```ts
it("preserves tier and source order in a structured brief", () => {
  const pack = completeSmeCoverageDecisionPack();
  const brief = buildSmeCoverageAssessmentBrief(pack);
  expect(brief.sections.map((section) => section.heading)).toEqual([
    "Immediate priorities",
    "Critical under-coverage",
    "Light coverage",
  ]);
  expect(brief.sections.flatMap((section) => section.items.map((item) => item.tagName)))
    .toEqual([
      ...pack.findings.immediateGaps,
      ...pack.findings.criticalUnderCoverage,
      ...pack.findings.lightCoverage,
    ].map((row) => row.tagName));
});

it("formats a readable Markdown assessment", () => {
  const markdown = formatSmeCoverageAssessmentMarkdown(
    buildSmeCoverageAssessmentBrief(completeSmeCoverageDecisionPack()),
  );
  expect(markdown).toContain("SME COVERAGE ASSESSMENT\n\nBottom line");
  expect(markdown).toContain("\n\nRecommended next step\n");
  expect(markdown).toContain("Full evidence: See the accompanying CSV.");
});
```

- [ ] **Step 2: Run the focused test and verify failure**

Run: `npm test -- src/utilities/smeCoverage/assessmentBrief.test.ts`

Expected: FAIL because `assessmentBrief.ts` and its exports do not exist.

- [ ] **Step 3: Implement the shared structured model**

```ts
export interface SmeCoverageAssessmentBrief {
  readonly title: "SME COVERAGE ASSESSMENT";
  readonly bottomLine: string;
  readonly sections: readonly SmeCoverageAssessmentSection[];
  readonly recommendedNextStep: string;
  readonly evidenceQuality: string;
  readonly fullEvidenceNote: string;
}

export function buildSmeCoverageAssessmentBrief(
  pack: SmeCoverageDecisionPack,
): SmeCoverageAssessmentBrief {
  return {
    title: "SME COVERAGE ASSESSMENT",
    bottomLine: pack.overview,
    sections: buildAvailableTierSections(pack),
    recommendedNextStep: buildRecommendedNextStep(pack),
    evidenceQuality: pack.snapshot.completeness,
    fullEvidenceNote: pack.evidence.length > 0
      ? "See the accompanying CSV."
      : "No evidence CSV is available for this empty report.",
  };
}
```

- [ ] **Step 4: Run the focused test and verify success**

Run: `npm test -- src/utilities/smeCoverage/assessmentBrief.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit the formatter**

```bash
git add src/utilities/smeCoverage/assessmentBrief.ts src/utilities/smeCoverage/assessmentBrief.test.ts
git commit -m "feat: structure SME assessment brief"
```

### Task 2: Structured on-screen and clipboard assessment

**Files:**
- Modify: `src/components/SmeCoverageAssessment.tsx`
- Modify: `src/components/SmeCoverageAssessment.test.tsx`
- Modify: `src/components/SmeCoverageDecisionPack.tsx`
- Modify: `src/styles/app.css`

**Interfaces:**
- Consumes: `SmeCoverageAssessmentBrief` and `formatSmeCoverageAssessmentMarkdown()` from Task 1.
- Produces: `SmeCoverageAssessment({ brief })`, with semantic sections and Markdown clipboard output.

- [ ] **Step 1: Rewrite component tests around the approved structure**

```tsx
render(<SmeCoverageAssessment brief={brief} />);
expect(screen.getByRole("heading", { name: "Bottom line" })).toBeVisible();
expect(screen.getByRole("heading", { name: "Immediate priorities" })).toBeVisible();
await user.click(screen.getByRole("button", { name: "Copy assessment" }));
expect(writeText).toHaveBeenCalledWith(formatSmeCoverageAssessmentMarkdown(brief));
```

- [ ] **Step 2: Run the component test and verify failure**

Run: `npm test -- src/components/SmeCoverageAssessment.test.tsx`

Expected: FAIL because the component still accepts the unstructured `assessment` string.

- [ ] **Step 3: Implement semantic rendering and Markdown copy**

```tsx
export function SmeCoverageAssessment({ brief }: { brief: SmeCoverageAssessmentBrief }) {
  async function copyAssessment() {
    await navigator.clipboard.writeText(formatSmeCoverageAssessmentMarkdown(brief));
  }

  return (
    <section className="sme-assessment" aria-labelledby="sme-assessment-heading">
      <div className="sme-section-header">
        <h3 id="sme-assessment-heading">Copy-ready assessment</h3>
        <button className="s-btn s-btn__outlined" type="button" onClick={copyAssessment}>
          Copy assessment
        </button>
      </div>
      <div className="sme-assessment-content" data-testid="assessment-content">
        <section><h4>Bottom line</h4><p>{brief.bottomLine}</p></section>
        {brief.sections.map((section) => (
          <section key={section.heading}><h4>{section.heading}</h4><ul>{section.items.map(renderItem)}</ul></section>
        ))}
      </div>
    </section>
  );
}
```

- [ ] **Step 4: Pass the shared brief from the decision pack and style it using existing tokens**

```tsx
const assessmentBrief = useMemo(() => buildSmeCoverageAssessmentBrief(pack), [pack]);
<SmeCoverageAssessment brief={assessmentBrief} />
```

Use a border-led definition layout, 14px body copy, 12px labels, and existing `--so-*` colors and radius tokens. Preserve visible focus and copy feedback.

- [ ] **Step 5: Run focused UI tests**

Run: `npm test -- src/components/SmeCoverageAssessment.test.tsx src/components/SmeCoverageDecisionPack.test.tsx`

Expected: PASS.

- [ ] **Step 6: Commit the UI change**

```bash
git add src/components/SmeCoverageAssessment.tsx src/components/SmeCoverageAssessment.test.tsx src/components/SmeCoverageDecisionPack.tsx src/styles/app.css
git commit -m "feat: format copy-ready SME assessment"
```

### Task 3: Two-page Executive Brief PDF

**Files:**
- Modify: `src/utilities/smeCoverage/pdfModel.ts`
- Modify: `src/utilities/smeCoverage/pdfModel.test.ts`
- Modify: `src/utilities/smeCoverage/SmeCoveragePdfDocument.tsx`
- Modify: `src/utilities/smeCoverage/SmeCoveragePdfDocument.test.tsx`
- Modify: `src/components/SmeCoverageDecisionPack.tsx`

**Interfaces:**
- Consumes: `buildSmeCoverageAssessmentBrief()` from Task 1.
- Produces: `buildSmeCoveragePdfModel(pack): SmeCoveragePdfModel` with `assessmentBrief`, bounded `priorityRows`, `omittedPriorityCount`, `methodologySummary`, and `completeEvidenceNote`.

- [ ] **Step 1: Write failing model tests for the bounded brief**

```ts
expect(model.assessmentBrief.bottomLine).toBe(pack.overview);
expect(model.priorityRows.length).toBeLessThanOrEqual(12);
expect(model.omittedPriorityCount).toBe(totalFindingRows - model.priorityRows.length);
expect(model).not.toHaveProperty("appendixRows");
```

- [ ] **Step 2: Write failing PDF structure and page-count tests**

```ts
expect(textOf(firstPage)).toContain("Decision summary");
expect(textOf(secondPage)).toContain("Priority action register");
expect(textOf(document)).not.toContain("Supporting evidence appendix");
expect(normalRenderedPageCount).toBe(2);
expect(stressRenderedPageCount).toBeLessThanOrEqual(3);
```

- [ ] **Step 3: Run focused PDF tests and verify failure**

Run: `npm test -- src/utilities/smeCoverage/pdfModel.test.ts src/utilities/smeCoverage/SmeCoveragePdfDocument.test.tsx`

Expected: FAIL because the current model still exposes appendix rows and the PDF still has a cover and appendix.

- [ ] **Step 4: Replace appendix data with bounded priorities**

```ts
const allPriorityRows = findingGroups.flatMap((group) => group.rows);
const priorityRows = allPriorityRows.slice(0, 12);

return {
  title: "SME Coverage Executive Brief",
  assessmentBrief: buildSmeCoverageAssessmentBrief(pack),
  priorityRows,
  omittedPriorityCount: allPriorityRows.length - priorityRows.length,
  completeEvidenceNote: pack.evidence.length > 0
    ? "Complete canonical evidence is provided in the accompanying CSV for filtering, audit, and AI-assisted analysis."
    : "No evidence CSV is available because this report contains no canonical evidence rows.",
};
```

- [ ] **Step 5: Replace the cover-and-appendix document with two page sections**

```tsx
<Document title={model.title} author="Stack API Utilities">
  <Page size="A4" style={styles.page} wrap>
    <PdfPageBrand title={model.title} />
    <PdfDecisionSummary model={model} />
    <PdfFooter />
  </Page>
  <Page size="A4" style={styles.page} wrap>
    <PdfPageBrand title={model.title} />
    <PdfPriorityRegister model={model} />
    <PdfEvidenceHandoff note={model.completeEvidenceNote} />
    <PdfMethodologySummary text={model.methodologySummary} />
    <PdfFooter />
  </Page>
</Document>
```

Keep priority rows non-splitting. Repeat the register header on automatic overflow pages. Remove cover, finding cards, methodology grid, appendix table, and their unused styles.

- [ ] **Step 6: Update on-screen deliverable language**

Change the overview companion to state that the PDF includes the executive summary and bounded priority action register, while the CSV contains complete canonical evidence.

- [ ] **Step 7: Run focused PDF and report tests**

Run: `npm test -- src/utilities/smeCoverage/assessmentBrief.test.ts src/utilities/smeCoverage/pdfModel.test.ts src/utilities/smeCoverage/SmeCoveragePdfDocument.test.tsx src/components/SmeCoverageAssessment.test.tsx src/components/SmeCoverageDecisionPack.test.tsx src/utils/smeCoveragePdfDownload.test.ts`

Expected: PASS.

- [ ] **Step 8: Render representative PDFs and inspect page images**

Run the repository PDF smoke test to generate complete, partial, and stress buffers, then use Poppler `pdftoppm -png -r 150` to render every page. Inspect the resulting images for clipping, orphan headings, unreadably dense text, missing footers, and unexpected fourth pages.

Expected: complete and partial reports have two legible pages; stress has at most three.

- [ ] **Step 9: Commit the PDF revision**

```bash
git add src/utilities/smeCoverage/pdfModel.ts src/utilities/smeCoverage/pdfModel.test.ts src/utilities/smeCoverage/SmeCoveragePdfDocument.tsx src/utilities/smeCoverage/SmeCoveragePdfDocument.test.tsx src/components/SmeCoverageDecisionPack.tsx
git commit -m "feat: compact SME PDF into executive brief"
```

### Task 4: Full verification and PR update

**Files:**
- Verify without additional planned edits: files listed in Tasks 1-3
- Verify: `docs/superpowers/specs/2026-08-27-sme-executive-brief-design.md`
- Verify: `docs/superpowers/plans/2026-08-27-sme-executive-brief.md`

**Interfaces:**
- Consumes: all implementation outputs from Tasks 1-3.
- Produces: a verified pushed branch updating PR #14.

- [ ] **Step 1: Run the full unit suite**

Run: `npm test`

Expected: all tests pass.

- [ ] **Step 2: Run type checks and production build**

Run: `npm run lint`

Expected: both TypeScript projects pass with no diagnostics.

Run: `npm run build`

Expected: Next.js production build completes successfully.

- [ ] **Step 3: Run the SME end-to-end test**

Run: `npx playwright test e2e/sme-coverage-analyzer.spec.ts`

Expected: all SME analyzer scenarios pass, including direct PDF and highlighted CSV exports.

- [ ] **Step 4: Review the diff and push**

Run: `git diff --check && git status --short && git diff --stat origin/codex/report-command-center-redesign...HEAD`

Expected: no whitespace errors and only the Executive Brief follow-up is present.

Run: `git push`

Expected: PR #14 updates with the verified commits.
