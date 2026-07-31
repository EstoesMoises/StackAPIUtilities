import { readFile } from "node:fs/promises";
import { expect, test, type Page, type Route } from "@playwright/test";
import { analyzeSmeCoverage } from "../src/utilities/smeCoverage/analyzer";
import { buildSmeCoverageDecisionPack } from "../src/utilities/smeCoverage/decisionPack";
import type { SmeCoverageDecisionPack } from "../src/utilities/smeCoverage/model";
import { parseSmeCoverageDecisionPack } from "../src/utilities/smeCoverage/persistence";
import type { SmeCoverageRunResult } from "../src/utilities/smeCoverage/runner";
import { normalizeTagDemand } from "../src/utilities/smeCoverage/tagDemand";
import { normalizeTagSmeCounts } from "../src/utilities/smeCoverage/tagSmeCounts";

const fixedPagination = { pageCount: 1, reachedMaxPages: false, hasMore: false } as const;
const mockedDatasets: SmeCoverageRunResult["datasets"] = [
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
      { question_id: 1, tags: ["zeta-runtime"], view_count: 300 },
      { question_id: 2, tags: ["zeta-runtime"], view_count: 300 },
      { question_id: 3, tags: ["zeta-runtime"], view_count: 300 },
      { question_id: 4, tags: ["zeta-runtime"], view_count: 300 },
      { question_id: 5, tags: ["echo"], view_count: 200 },
      { question_id: 6, tags: ["echo"], view_count: 200 },
      { question_id: 7, tags: ["echo"], view_count: 200 },
      { question_id: 8, tags: ["echo"], view_count: 200 },
      { question_id: 9, tags: ["echo"], view_count: 200 },
      { question_id: 10, tags: ["delta"], view_count: 200 },
      { question_id: 11, tags: ["delta"], view_count: 200 },
      { question_id: 12, tags: ["delta"], view_count: 200 },
      { question_id: 13, tags: ["delta"], view_count: 200 },
      { question_id: 14, tags: ["unknown-source"], view_count: 50 },
      { question_id: 15, tags: ["charlie"], view_count: 100 },
      { question_id: 16, tags: ["charlie"], view_count: 100 },
      { question_id: 17, tags: ["charlie"], view_count: 100 },
      { question_id: 18, tags: ["bravo"], view_count: 100 },
      { question_id: 19, tags: ["bravo"], view_count: 100 },
      { question_id: 20, tags: ["alpha"], view_count: 100 },
    ],
    pagination: fixedPagination,
  },
  {
    datasetName: "tagSmeCounts",
    records: [
      { name: "zeta-runtime", subjectMatterExpertCount: 0 },
      { name: "echo", subjectMatterExpertCount: 1 },
      { name: "delta", subjectMatterExpertCount: 2 },
      { name: "unknown-source", subjectMatterExpertCount: null },
      { name: "charlie", subjectMatterExpertCount: 3 },
      { name: "bravo", subjectMatterExpertCount: 4 },
      { name: "alpha", subjectMatterExpertCount: 4 },
    ],
    pagination: fixedPagination,
  },
];
const canonicalDecisionPack = deriveDecisionPack(mockedDatasets);

const completeSmeCoverageRunResult: SmeCoverageRunResult = {
  utilityId: "sme-coverage-analyzer",
  utilityTitle: "SME Coverage Analyzer",
  pageSize: 100,
  maxPagesPerDataset: 20,
  runPreset: "deep-audit",
  datasets: mockedDatasets,
  messages: [
    "Collected tags (7 records) for SME Coverage Analyzer.",
    "Collected questions (20 records) for SME Coverage Analyzer.",
    "Collected tagSmeCounts (7 records) for SME Coverage Analyzer.",
  ],
  warnings: canonicalDecisionPack.warnings,
  decisionPack: canonicalDecisionPack,
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

  expect(completeSmeCoverageRunResult.decisionPack).toEqual(
    deriveDecisionPack(completeSmeCoverageRunResult.datasets),
  );
  expect(completeSmeCoverageRunResult.messages).toEqual([
    "Collected tags (7 records) for SME Coverage Analyzer.",
    "Collected questions (20 records) for SME Coverage Analyzer.",
    "Collected tagSmeCounts (7 records) for SME Coverage Analyzer.",
  ]);
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
  await expect(
    page.getByLabel("Analysis snapshot").getByText("stackoverflowteams.com", { exact: true }),
  ).toBeVisible();
  const immediateFindingRegion = page.getByRole("region", {
    name: "Immediate no-SME risks",
    exact: true,
  });
  const criticalFindingRegion = page.getByRole("region", {
    name: "Highest-demand critical gaps",
    exact: true,
  });
  const lightFindingRegion = page.getByRole("region", {
    name: "Light SME coverage",
    exact: true,
  });
  await expect(
    immediateFindingRegion.getByRole("cell", { name: "zeta-runtime", exact: true }),
  ).toBeVisible();
  await expect(
    criticalFindingRegion.getByRole("cell", { name: "echo", exact: true }),
  ).toBeVisible();
  await expect(
    lightFindingRegion.getByRole("cell", { name: "delta", exact: true }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("region", { name: "SME coverage evidence table" })
      .getByRole("cell", { name: "unknown-source", exact: true }),
  ).toBeVisible();

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
    "sme-coverage-decision-pack-stackoverflowteams-com-2026-07-30.md",
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
    "sme-coverage-evidence-stackoverflowteams-com-2026-07-30.csv",
  );
  const csvLines = (await readDownload(csvDownload)).trimEnd().split("\n");
  expect(csvLines[0]).toBe(
    "tag_name,page_views,question_count,question_count_basis,sme_count,page_views_per_sme,coverage_percentile,coverage_tier,reason,recommended_action,demand_quality,sme_quality,result_completeness,completeness_warnings",
  );
  expect(csvLines[1]).toBe(
    "zeta-runtime,1200,4,Complete question enumeration,0,,,Immediate gap,Active tag has no assigned SMEs.,Assign or confirm at least one SME.,Complete,Complete,Partial,sme-coverage.unknown-sme-coverage: Assigned-SME coverage is unavailable for 1 tag: `unknown-source`.",
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
    "Partial",
    "sme-coverage.unknown-sme-coverage: Assigned-SME coverage is unavailable for 1 tag: `unknown-source`.",
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

function deriveDecisionPack(datasets: SmeCoverageRunResult["datasets"]): SmeCoverageDecisionPack {
  const tags = getDataset(datasets, "tags");
  const questions = getDataset(datasets, "questions");
  const tagSmeCounts = getDataset(datasets, "tagSmeCounts");
  const demand = normalizeTagDemand({ tags, questions });
  const smeCounts = normalizeTagSmeCounts(tagSmeCounts);
  const sourceStatus = {
    tags: tags.pagination,
    questions: questions.pagination,
    tagSmeCounts: tagSmeCounts.pagination,
  };
  const analysis = analyzeSmeCoverage({
    demand,
    smeCounts,
    sourceStatus,
    settings: {
      pageSize: 100,
      maxPagesPerDataset: 20,
      runPreset: "deep-audit",
    },
  });
  return buildSmeCoverageDecisionPack({
    analysis,
    snapshot: {
      instanceHost: "stackoverflowteams.com",
      generatedAt: "2026-07-30T12:00:00.000Z",
      pageSize: 100,
      maxPagesPerDataset: 20,
      runPreset: "deep-audit",
    },
    sourceWarnings: [...demand.warnings, ...smeCounts.warnings],
  });
}

function getDataset(
  datasets: SmeCoverageRunResult["datasets"],
  datasetName: SmeCoverageRunResult["datasets"][number]["datasetName"],
) {
  const dataset = datasets.find((candidate) => candidate.datasetName === datasetName);
  if (!dataset) throw new Error(`Missing mocked ${datasetName} dataset.`);
  return dataset;
}
