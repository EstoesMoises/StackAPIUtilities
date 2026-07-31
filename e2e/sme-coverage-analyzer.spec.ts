import { readFile } from "node:fs/promises";
import { expect, test, type Page, type Route } from "@playwright/test";
import type { SmeCoverageDecisionPack, SmeCoverageEvidenceRow } from "../src/utilities/smeCoverage/model";
import { parseSmeCoverageDecisionPack } from "../src/utilities/smeCoverage/persistence";
import type { SmeCoverageRunResult } from "../src/utilities/smeCoverage/runner";

const fixedPagination = { pageCount: 1, reachedMaxPages: false, hasMore: false } as const;

const immediateGap = evidenceRow({
  tagName: "zeta-runtime",
  pageViews: 1_200,
  questionCount: 4,
  smeCount: 0,
  coverageTier: "Immediate gap",
  reason: "Active tag has no assigned SMEs.",
  recommendedAction: "Assign or confirm at least one SME.",
});

const criticalGap = evidenceRow({
  tagName: "echo",
  pageViews: 1_000,
  questionCount: 5,
  smeCount: 1,
  pageViewsPerSme: 1_000,
  coveragePercentile: 100,
  coverageTier: "Critical under-coverage",
  reason: "Demand meets the active-tag median and the ratio meets or exceeds P90.",
  recommendedAction: "Expand and validate SME ownership.",
});

const lightGap = evidenceRow({
  tagName: "delta",
  pageViews: 800,
  questionCount: 4,
  smeCount: 2,
  pageViewsPerSme: 400,
  coveragePercentile: 80,
  coverageTier: "Light coverage",
  reason: "Demand meets the active-tag median and the ratio is between P75 and P90.",
  recommendedAction: "Review whether additional SMEs would improve resilience.",
});

const unknownCoverage = evidenceRow({
  tagName: "unknown-source",
  pageViews: 50,
  questionCount: 1,
  smeCount: null,
  pageViewsPerSme: null,
  coveragePercentile: null,
  coverageTier: "Unknown",
  reason: "Assigned-SME coverage is unavailable.",
  recommendedAction: "Rerun or inspect the v3 tag source.",
  smeQuality: "Unknown",
});

const completeSmeCoverageRunResult: SmeCoverageRunResult = {
  utilityId: "sme-coverage-analyzer",
  utilityTitle: "SME Coverage Analyzer",
  pageSize: 100,
  maxPagesPerDataset: 20,
  runPreset: "deep-audit",
  datasets: [
    {
      datasetName: "tags",
      records: [
        { name: "zeta-runtime", count: 4 },
        { name: "echo", count: 5 },
        { name: "delta", count: 4 },
        { name: "unknown-source", count: 1 },
        { name: "charlie", count: 3 },
        { name: "bravo", count: 2 },
        { name: "alpha", count: 1 },
      ],
      pagination: fixedPagination,
    },
    {
      datasetName: "questions",
      records: [
        { question_id: 1, tags: ["zeta-runtime"], view_count: 1_200 },
        { question_id: 2, tags: ["echo"], view_count: 1_000 },
        { question_id: 3, tags: ["delta"], view_count: 800 },
        { question_id: 4, tags: ["unknown-source"], view_count: 50 },
        { question_id: 5, tags: ["charlie"], view_count: 300 },
        { question_id: 6, tags: ["bravo"], view_count: 200 },
        { question_id: 7, tags: ["alpha"], view_count: 100 },
      ],
      pagination: fixedPagination,
    },
    {
      datasetName: "tagSmeCounts",
      records: [
        { name: "zeta-runtime", subjectMatterExpertCount: 0 },
        { name: "echo", subjectMatterExpertCount: 1 },
        { name: "delta", subjectMatterExpertCount: 2 },
        { name: "charlie", subjectMatterExpertCount: 3 },
        { name: "bravo", subjectMatterExpertCount: 4 },
        { name: "alpha", subjectMatterExpertCount: 4 },
      ],
      pagination: fixedPagination,
    },
  ],
  messages: ["Collected all-time demand and current assigned-SME coverage."],
  warnings: [
    {
      utilityId: "sme-coverage-analyzer",
      code: "sme-coverage.unknown-sme-coverage",
      message: "Assigned-SME coverage is unavailable for 1 tag: `unknown-source`.",
    },
  ],
  decisionPack: {
    snapshot: {
      instanceHost: "example.stackenterprise.co",
      generatedAt: "2026-07-30T12:00:00.000Z",
      scopeLabel: "All-time demand · Current SME coverage",
      completeness: "Partial",
      pageSize: 100,
      maxPagesPerDataset: 20,
      runPreset: "deep-audit",
    },
    warnings: [
      {
        utilityId: "sme-coverage-analyzer",
        code: "sme-coverage.unknown-sme-coverage",
        message: "Assigned-SME coverage is unavailable for 1 tag: `unknown-source`.",
      },
    ],
    summary: {
      tagsAnalyzed: 7,
      tagsWithSmes: 5,
      immediateGaps: 1,
      criticalUnderCoverage: 1,
      lightCoverage: 1,
      unknownRows: 1,
    },
    overview:
      "Current evidence identifies one immediate gap, one critical under-coverage gap, and one light-coverage tag.",
    assessment:
      "Prioritize `echo` for critical under-coverage and assign an SME to `zeta-runtime`.\n\nReview `delta` for additional coverage, and validate current assigned-SME coverage for `unknown-source` before drawing a conclusion.",
    findings: {
      immediateGaps: [immediateGap],
      criticalUnderCoverage: [criticalGap],
      lightCoverage: [lightGap],
    },
    methodology: {
      activityQuestionMinimum: 1,
      activityPageViewThresholdExclusive: 25,
      activeTagMedianPageViews: 300,
      coveredActiveSampleSize: 5,
      p75PageViewsPerSme: 400,
      p90PageViewsPerSme: 1_000,
      percentileSampleSufficient: true,
      ratioFormula: "pageViews / smeCount",
      roundingRule: "Nearest whole page view for display; unrounded for calculation",
    },
    evidence: [
      immediateGap,
      criticalGap,
      lightGap,
      unknownCoverage,
      evidenceRow({
        tagName: "charlie",
        pageViews: 300,
        questionCount: 3,
        smeCount: 3,
        pageViewsPerSme: 100,
        coveragePercentile: 60,
      }),
      evidenceRow({
        tagName: "bravo",
        pageViews: 200,
        questionCount: 2,
        smeCount: 4,
        pageViewsPerSme: 50,
        coveragePercentile: 40,
      }),
      evidenceRow({
        tagName: "alpha",
        pageViews: 100,
        questionCount: 1,
        smeCount: 4,
        pageViewsPerSme: 25,
        coveragePercentile: 20,
      }),
    ],
  },
};

test("SME Coverage Analyzer runs self-contained and exports its canonical decision pack", async ({
  context,
  page,
}) => {
  let reportRouteCalls = 0;
  let releaseUtilityResponse: () => void = () => undefined;
  const utilityResponseGate = new Promise<void>((resolve) => {
    releaseUtilityResponse = resolve;
  });

  expect(parseSmeCoverageDecisionPack(completeSmeCoverageRunResult.decisionPack)).not.toBeNull();
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await routeUtilityRun(page, async (route) => {
    await utilityResponseGate;
    await fulfillUtilityRun(route);
  });
  await page.route("**/api/reports/run", async (route) => {
    reportRouteCalls += 1;
    await route.abort("failed");
  });

  await page.goto("/");
  await saveBasicBusinessCredentials(page);
  await page.getByRole("button", { name: "Utilities", exact: true }).click();
  await page.getByRole("button", { name: "SME Coverage Analyzer", exact: true }).click();
  const workspace = page.getByRole("main", { name: "Workspace" });

  await expect(page.getByRole("radio", { name: "Deep audit" })).toBeChecked();
  await expect(
    workspace.getByText("All-time demand · Current SME coverage", { exact: true }),
  ).toBeVisible();
  await expect(page.locator('input[type="date"]')).toHaveCount(0);
  await expect(page.getByLabel(/start date|end date/i)).toHaveCount(0);

  await page.getByRole("button", { name: "Run SME coverage analysis" }).click();
  await expect(page.getByRole("progressbar")).toBeVisible();
  await expect(page.getByText("Collect all-time tag demand", { exact: true })).toBeVisible();
  releaseUtilityResponse();

  await expect(page.getByRole("heading", { name: "SME coverage result" })).toBeVisible();
  await expect(
    page
      .getByLabel("Analysis snapshot")
      .getByText("All-time demand · Current SME coverage", { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "Immediate no-SME risks" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Highest-demand critical gaps" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Light SME coverage" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "zeta-runtime", exact: true }).first()).toBeVisible();
  await expect(page.getByRole("cell", { name: "echo", exact: true }).first()).toBeVisible();
  await expect(page.getByRole("cell", { name: "delta", exact: true }).first()).toBeVisible();
  await expect(page.getByRole("cell", { name: "unknown-source", exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Copy assessment" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Assessment copied to the clipboard." }),
  ).toBeVisible();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(
    completeSmeCoverageRunResult.decisionPack.assessment,
  );

  const markdownDownloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download Markdown" }).click();
  const markdownDownload = await markdownDownloadPromise;
  expect(markdownDownload.suggestedFilename()).toBe(
    "sme-coverage-decision-pack-example-stackenterprise-co-2026-07-30.md",
  );
  const markdown = await readDownload(markdownDownload);
  expectInOrder(markdown, [
    "# SME Coverage Decision Pack",
    "## Snapshot",
    "## Completeness warnings",
    "## Executive summary",
    "## Copy-ready assessment",
    "## Immediate no-SME risks",
    "## Highest-demand critical gaps",
    "## Light SME coverage",
    "## Methodology",
  ]);

  const csvDownloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download CSV" }).click();
  const csvDownload = await csvDownloadPromise;
  expect(csvDownload.suggestedFilename()).toBe(
    "sme-coverage-evidence-example-stackenterprise-co-2026-07-30.csv",
  );
  const csvLines = (await readDownload(csvDownload)).trimEnd().split("\n");
  expect(csvLines[0]).toBe(
    "tag_name,page_views,question_count,question_count_basis,sme_count,page_views_per_sme,coverage_percentile,coverage_tier,reason,recommended_action,demand_quality,sme_quality",
  );
  expect(csvLines[1]).toBe(
    "zeta-runtime,1200,4,Complete question enumeration,0,,,Immediate gap,Active tag has no assigned SMEs.,Assign or confirm at least one SME.,Complete,Complete",
  );
  const unknownCells = csvLines.find((line) => line.startsWith("unknown-source,"))?.split(",");
  expect(unknownCells).toEqual([
    "unknown-source",
    "50",
    "1",
    "Complete question enumeration",
    "",
    "",
    "",
    "Unknown",
    "Assigned-SME coverage is unavailable.",
    "Rerun or inspect the v3 tag source.",
    "Complete",
    "Unknown",
  ]);
  expect(reportRouteCalls).toBe(0);
});

test("375px navigation and complete evidence remain keyboard reachable", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await routeUtilityRun(page, fulfillUtilityRun);
  await page.route("**/api/reports/run", (route) => route.abort("failed"));
  await page.goto("/");

  const navigation = page.getByRole("navigation", { name: "Application panels" });
  const navigationButtons = navigation.getByRole("button");
  await expect(navigationButtons).toHaveCount(6);
  for (const name of ["Scripts", "Utilities", "Credentials", "Uploads", "Datasets", "Write Tools"]) {
    const control = navigation.getByRole("button", { name, exact: true });
    await expect(control).toBeVisible();
    await expect(control).toBeEnabled();
    await control.click();
    await expect(control).toHaveAttribute("aria-pressed", "true");
  }

  await saveBasicBusinessCredentials(page);
  await navigation.getByRole("button", { name: "Utilities", exact: true }).click();
  await page.getByRole("button", { name: "SME Coverage Analyzer", exact: true }).click();
  await page.getByRole("button", { name: "Run SME coverage analysis" }).click();
  await expect(page.getByRole("heading", { name: "SME coverage result" })).toBeVisible();

  const evidenceRegion = page.getByRole("region", { name: "SME coverage evidence table" });
  await evidenceRegion.scrollIntoViewIfNeeded();
  await evidenceRegion.focus();
  await expect(evidenceRegion).toBeFocused();
  await expect(evidenceRegion.getByRole("table")).toBeVisible();
  await expect(evidenceRegion.getByRole("columnheader")).toHaveCount(12);
  expect(
    await evidenceRegion.evaluate((element) => element.scrollWidth > element.clientWidth),
  ).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
});

function evidenceRow(
  overrides: Partial<SmeCoverageEvidenceRow> & Pick<SmeCoverageEvidenceRow, "tagName" | "pageViews" | "questionCount" | "smeCount">,
): SmeCoverageEvidenceRow {
  return {
    tagName: overrides.tagName,
    pageViews: overrides.pageViews,
    questionCount: overrides.questionCount,
    questionCountBasis: "Complete question enumeration",
    smeCount: overrides.smeCount,
    pageViewsPerSme: overrides.pageViewsPerSme ?? null,
    coveragePercentile: overrides.coveragePercentile ?? null,
    coverageTier: "Adequate coverage",
    reason: "The tag does not meet an under-coverage rule.",
    recommendedAction: "Maintain current coverage.",
    demandQuality: "Complete",
    smeQuality: "Complete",
    ...overrides,
  };
}

async function routeUtilityRun(page: Page, handler: (route: Route) => Promise<void>) {
  await page.route("**/api/utilities/sme-coverage/run", handler);
}

async function fulfillUtilityRun(route: Route) {
  await route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ ok: true, result: completeSmeCoverageRunResult }),
  });
}

async function saveBasicBusinessCredentials(page: Page) {
  await page.getByRole("button", { name: "Credentials", exact: true }).click();
  await expect(page.getByLabel("Instance type")).toHaveValue("basic-business");
  await page.getByLabel("Instance URL").fill("https://stackoverflowteams.com/c/example-team");
  await page.getByLabel("Personal access token").fill("pat-token");
  await page.getByRole("button", { name: "Save session credentials" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Credentials saved for this browser session." }),
  ).toBeVisible();
}

async function readDownload(download: { path(): Promise<string | null> }): Promise<string> {
  const path = await download.path();
  if (path === null) throw new Error("Playwright did not provide a local download path.");
  return readFile(path, "utf8");
}

function expectInOrder(contents: string, headings: readonly string[]) {
  let previousIndex = -1;
  for (const heading of headings) {
    const index = contents.indexOf(heading);
    expect(index, `${heading} should follow the prior section`).toBeGreaterThan(previousIndex);
    previousIndex = index;
  }
}
