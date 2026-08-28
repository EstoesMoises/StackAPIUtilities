import { readFile } from "node:fs/promises";
import { expect, test, type Locator, type Page, type Route } from "@playwright/test";
import { analyzeSmeCoverage } from "../src/utilities/smeCoverage/analyzer";
import {
  buildSmeCoverageAssessmentBrief,
  formatSmeCoverageAssessmentMarkdown,
} from "../src/utilities/smeCoverage/assessmentBrief";
import { buildSmeCoverageDecisionPack } from "../src/utilities/smeCoverage/decisionPack";
import type { SmeCoverageDecisionPack } from "../src/utilities/smeCoverage/model";
import { parseSmeCoverageDecisionPack } from "../src/utilities/smeCoverage/persistence";
import type { SmeCoverageRunResult } from "../src/utilities/smeCoverage/runner";
import { normalizeTagDemand } from "../src/utilities/smeCoverage/tagDemand";
import { normalizeTagSmeCounts } from "../src/utilities/smeCoverage/tagSmeCounts";

const fixedPagination = { pageCount: 1, reachedMaxPages: false, hasMore: false } as const;
const largePagination = { pageCount: 2, reachedMaxPages: false, hasMore: false } as const;
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
  datasets: mockedDatasets,
  messages: [
    "Collected tags (7 records) for SME Coverage Analyzer.",
    "Collected questions (20 records) for SME Coverage Analyzer.",
    "Collected tagSmeCounts (7 records) for SME Coverage Analyzer.",
  ],
  warnings: canonicalDecisionPack.warnings,
  decisionPack: canonicalDecisionPack,
};
const largeSmeCoverageRunResult = createLargeSmeCoverageRunResult();

test("SME Coverage Analyzer runs self-contained and exports its canonical decision pack", async ({
  context,
  page,
}) => {
  test.setTimeout(120_000);
  let reportRouteCalls = 0;
  let utilityRequestPayload: unknown;
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
    utilityRequestPayload = route.request().postDataJSON();
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

  await expect(page.getByRole("radio")).toHaveCount(0);
  await expect(page.getByRole("spinbutton")).toHaveCount(0);
  await expect(page.getByText(/collects all available evidence automatically/i)).toBeVisible();
  await expect(
    workspace.getByText("All-time demand · Current SME coverage", { exact: true }),
  ).toBeVisible();
  await expect(page.locator('input[type="date"]')).toHaveCount(0);
  await expect(page.getByLabel(/start date|end date/i)).toHaveCount(0);

  await page.getByRole("button", { name: "Run SME coverage analysis" }).click();
  await expect(page.getByRole("progressbar")).toBeVisible();
  await expect(page.getByText("Collect all-time tag demand", { exact: true })).toBeVisible();
  releaseUtilityResponse();

  const report = page.getByRole("region", { name: "Generated report" });
  await expect(report).toBeVisible();
  await expect(report.getByRole("heading", { name: "SME coverage report" })).toBeVisible();
  const pdfButton = report.getByRole("button", { name: "Export polished PDF" });
  const csvButton = report.getByRole("button", { name: "Export evidence CSV" });
  await expect(pdfButton).toBeVisible();
  await expect(csvButton).toBeVisible();

  const overviewTab = report.getByRole("tab", { name: "Overview", exact: true });
  await expect(overviewTab).toHaveAttribute("aria-selected", "true");
  const overviewPanel = report.getByRole("tabpanel", { name: "Overview", exact: true });
  await expect(
    overviewPanel
      .getByLabel("Analysis snapshot")
      .getByText("All-time demand · Current SME coverage", { exact: true }),
  ).toBeVisible();
  await expect(
    overviewPanel.getByLabel("Analysis snapshot").getByText("stackoverflowteams.com", { exact: true }),
  ).toBeVisible();
  await expect(
    overviewPanel.getByLabel("Analysis snapshot").getByText("Collection", { exact: true }),
  ).toBeVisible();
  await expect(
    overviewPanel.getByLabel("Analysis snapshot").getByText("All available data collected", { exact: true }),
  ).toBeVisible();
  await expect(report.getByText("Analysis quality: Partial", { exact: true })).toBeVisible();
  expect(Object.keys(utilityRequestPayload as Record<string, unknown>)).toEqual(["credentials"]);

  await report.getByRole("tab", { name: "Priority findings · 3", exact: true }).click();
  const findingsPanel = report.getByRole("tabpanel", { name: "Priority findings · 3", exact: true });
  const priorityFindingRegion = findingsPanel.getByRole("region", {
    name: "Priority findings table",
    exact: true,
  });
  await expect(priorityFindingRegion.getByRole("table")).toHaveCount(1);
  const priorityRows = priorityFindingRegion.getByRole("row");
  await expect(priorityRows).toHaveCount(4);
  await expect(priorityRows.nth(1)).toContainText("Immediate gap");
  await expect(priorityRows.nth(1)).toContainText("zeta-runtime");
  await expect(priorityRows.nth(2)).toContainText("Critical under-coverage");
  await expect(priorityRows.nth(2)).toContainText("echo");
  await expect(priorityRows.nth(3)).toContainText("Light coverage");
  await expect(priorityRows.nth(3)).toContainText("delta");

  await findingsPanel.getByLabel("Priority tier").selectOption("Light coverage");
  await expect(priorityRows).toHaveCount(2);
  await expect(
    priorityFindingRegion.getByRole("cell", { name: "delta", exact: true }),
  ).toBeVisible();
  await expect(
    priorityFindingRegion.getByRole("cell", { name: "zeta-runtime", exact: true }),
  ).toHaveCount(0);
  await expect(
    priorityFindingRegion.getByRole("cell", { name: "echo", exact: true }),
  ).toHaveCount(0);
  await report.getByRole("tab", { name: "Evidence · 7", exact: true }).click();
  const evidencePanel = report.getByRole("tabpanel", { name: "Evidence · 7", exact: true });
  await expect(evidencePanel.getByRole("searchbox", { name: "Search evidence" })).toBeVisible();
  await expect(
    evidencePanel.getByRole("combobox", { name: "Coverage tier", exact: true }),
  ).toHaveValue("");
  await expect(
    evidencePanel.getByRole("combobox", { name: "Evidence quality", exact: true }),
  ).toHaveValue("");
  await expect(evidencePanel.getByText("Rows 1–7 of 7", { exact: true })).toBeVisible();
  const evidenceRegion = evidencePanel.getByRole("region", {
    name: "SME coverage evidence table",
    exact: true,
  });
  await expect(evidenceRegion.getByRole("table")).toBeVisible();
  await expect(
    evidenceRegion.getByRole("cell", { name: "unknown-source", exact: true }),
  ).toBeVisible();

  await report.getByRole("tab", { name: "Methodology", exact: true }).click();
  const methodologyPanel = report.getByRole("tabpanel", { name: "Methodology", exact: true });
  await expect(
    methodologyPanel.getByRole("heading", { name: "Methodology and evidence quality" }),
  ).toBeVisible();
  await expect(methodologyPanel.getByText("pageViews / smeCount", { exact: true })).toBeVisible();
  await expect(methodologyPanel.getByText("Active-tag rule", { exact: true })).toBeVisible();

  await overviewTab.click();
  await expect(overviewTab).toHaveAttribute("aria-selected", "true");

  await report
    .getByRole("tabpanel", { name: "Overview", exact: true })
    .getByRole("button", { name: "Copy assessment" })
    .click();
  await expect(
    report.getByRole("status").filter({ hasText: "Assessment copied to the clipboard." }),
  ).toBeVisible();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(
    formatSmeCoverageAssessmentMarkdown(
      buildSmeCoverageAssessmentBrief(completeSmeCoverageRunResult.decisionPack),
    ),
  );

  const pdfDownloadPromise = page.waitForEvent("download", { timeout: 60_000 });
  await pdfButton.click();
  const pdfDownload = await pdfDownloadPromise;
  expect(pdfDownload.suggestedFilename()).toBe(
    "sme-coverage-decision-pack-stackoverflowteams-com-2026-07-30.pdf",
  );
  const pdfPath = await pdfDownload.path();
  expect(pdfPath).not.toBeNull();
  if (pdfPath === null) throw new Error("Playwright did not provide a local PDF download path.");
  expect((await readFile(pdfPath)).subarray(0, 5).toString("ascii")).toBe("%PDF-");

  const csvDownloadPromise = page.waitForEvent("download");
  await csvButton.click();
  const csvDownload = await csvDownloadPromise;
  expect(csvDownload.suggestedFilename()).toBe(
    "sme-coverage-evidence-stackoverflowteams-com-2026-07-30.csv",
  );
  const csvLines = (await readDownload(csvDownload)).trimEnd().split("\n");
  expect(csvLines[0]).toBe(
    "tag_name,page_views,question_count,question_count_basis,sme_count,page_views_per_sme,coverage_percentile,coverage_tier,reason,recommended_action,demand_quality,sme_quality,collection_status,analysis_quality,evidence_notes",
  );
  expect(csvLines[1]).toBe(
    "zeta-runtime,1200,4,Complete question enumeration,0,,,Immediate gap,Active tag has no assigned SMEs.,Assign or confirm at least one SME.,Complete,Complete,All available data collected,Partial,sme-coverage.unknown-sme-coverage: Assigned-SME coverage is unavailable for 1 tag: `unknown-source`.",
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
    "All available data collected",
    "Partial",
    "sme-coverage.unknown-sme-coverage: Assigned-SME coverage is unavailable for 1 tag: `unknown-source`.",
  ]);
  expect(csvLines[0]).not.toMatch(/result_completeness|completeness_warnings/);

  await report.getByRole("button", { name: "More formats" }).click();
  const markdownDownloadPromise = page.waitForEvent("download");
  await report.getByRole("button", { name: "Download Markdown brief" }).click();
  const markdownDownload = await markdownDownloadPromise;
  expect(markdownDownload.suggestedFilename()).toBe(
    "sme-coverage-decision-pack-stackoverflowteams-com-2026-07-30.md",
  );
  const markdown = await readDownload(markdownDownload);
  expectInOrder(markdown, [
    "# SME Coverage Decision Pack",
    "## Snapshot",
    "## Evidence notes",
    "## Executive summary",
    "## Copy-ready assessment",
    "## Immediate no-SME risks",
    "## Highest-demand critical gaps",
    "## Light SME coverage",
    "## Methodology",
  ]);
  expect(markdown).toContain("- Collection: All available data collected");
  expect(markdown).toContain("- Analysis quality: Partial");
  expect(markdown).not.toContain("## Completeness warnings");
  expect(reportRouteCalls).toBe(0);
});

test("large SME evidence stays bounded, canonical, and resets pagination when filtered", async ({
  page,
}) => {
  expect(parseSmeCoverageDecisionPack(largeSmeCoverageRunResult.decisionPack)).not.toBeNull();
  await routeUtilityRun(page, (route) => fulfillUtilityRun(route, largeSmeCoverageRunResult));
  await page.route("**/api/reports/run", (route) => route.abort("failed"));
  await page.goto("/");
  await saveBasicBusinessCredentials(page);
  await page.getByRole("button", { name: "Utilities", exact: true }).click();
  await page.getByRole("button", { name: "SME Coverage Analyzer", exact: true }).click();
  await page.getByRole("button", { name: "Run SME coverage analysis" }).click();

  const report = page.getByRole("region", { name: "Generated report" });
  await expect(report.getByRole("heading", { name: "SME coverage report" })).toBeVisible();
  await report.getByRole("tab", { name: "Evidence · 120", exact: true }).click();
  const evidencePanel = report.getByRole("tabpanel", { name: "Evidence · 120", exact: true });
  const evidenceRegion = evidencePanel.getByRole("region", {
    name: "SME coverage evidence table",
    exact: true,
  });
  const canonicalTags = largeSmeCoverageRunResult.decisionPack.evidence.map((row) => row.tagName);

  await expect(evidencePanel.getByText("Rows 1–50 of 120", { exact: true })).toBeVisible();
  await expect(evidenceRegion.getByRole("row")).toHaveCount(51);
  await expect(firstCell(evidenceRegion, 1)).toHaveText(canonicalTags[0]!);
  await expect(firstCell(evidenceRegion, 50)).toHaveText(canonicalTags[49]!);

  await evidencePanel.getByRole("button", { name: "Next page" }).click();
  await expect(evidencePanel.getByText("Rows 51–100 of 120", { exact: true })).toBeVisible();
  await expect(firstCell(evidenceRegion, 1)).toHaveText(canonicalTags[50]!);
  await expect(firstCell(evidenceRegion, 50)).toHaveText(canonicalTags[99]!);
  await expect(evidencePanel.getByRole("button", { name: "Previous page" })).toBeEnabled();

  const immediateGapTags = largeSmeCoverageRunResult.decisionPack.evidence
    .filter((row) => row.coverageTier === "Immediate gap")
    .map((row) => row.tagName);
  expect(immediateGapTags).toHaveLength(60);
  await evidencePanel
    .getByRole("combobox", { name: "Coverage tier", exact: true })
    .selectOption("Immediate gap");
  await expect(evidencePanel.getByText("Rows 1–50 of 60", { exact: true })).toBeVisible();
  await expect(firstCell(evidenceRegion, 1)).toHaveText(immediateGapTags[0]!);
  await expect(firstCell(evidenceRegion, 50)).toHaveText(immediateGapTags[49]!);
  await evidencePanel.getByRole("button", { name: "Next page" }).click();
  await expect(evidencePanel.getByText("Rows 51–60 of 60", { exact: true })).toBeVisible();
  await expect(evidenceRegion.getByRole("row")).toHaveCount(11);
  await expect(firstCell(evidenceRegion, 10)).toHaveText(immediateGapTags[59]!);
});

test("375px navigation and complete evidence remain keyboard reachable", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await routeUtilityRun(page, (route) => fulfillUtilityRun(route));
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
  const report = page.getByRole("region", { name: "Generated report" });
  await expect(report.getByRole("heading", { name: "SME coverage report" })).toBeVisible();
  await expect(report.getByRole("button", { name: "Export polished PDF" })).toBeVisible();
  await expect(report.getByRole("button", { name: "Export evidence CSV" })).toBeVisible();
  await expectDocumentFitsViewport(page);

  const overviewTab = report.getByRole("tab", { name: "Overview", exact: true });
  const findingsTab = report.getByRole("tab", { name: "Priority findings · 3", exact: true });
  const evidenceTab = report.getByRole("tab", { name: "Evidence · 7", exact: true });
  const methodologyTab = report.getByRole("tab", { name: "Methodology", exact: true });
  await overviewTab.focus();
  await page.keyboard.press("ArrowRight");
  await expect(findingsTab).toBeFocused();
  await expect(findingsTab).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("ArrowRight");
  await expect(evidenceTab).toBeFocused();
  await expect(evidenceTab).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("ArrowRight");
  await expect(methodologyTab).toBeFocused();
  await expect(methodologyTab).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("ArrowRight");
  await expect(overviewTab).toBeFocused();
  await expect(overviewTab).toHaveAttribute("aria-selected", "true");

  await evidenceTab.click();
  const evidencePanel = report.getByRole("tabpanel", { name: "Evidence · 7", exact: true });
  const evidenceRegion = evidencePanel.getByRole("region", {
    name: "SME coverage evidence table",
    exact: true,
  });
  await evidenceRegion.scrollIntoViewIfNeeded();
  await evidenceRegion.focus();
  await expect(evidenceRegion).toBeFocused();
  await expect(evidenceRegion.getByRole("table")).toBeVisible();
  await expect(evidenceRegion.getByRole("columnheader")).toHaveCount(7);
  for (const header of [
    "Tag",
    "Page views",
    "SMEs",
    "Page views per SME",
    "Coverage tier",
    "Evidence quality",
    "Recommended action",
  ]) {
    await expect(
      evidenceRegion.getByRole("columnheader", { name: header, exact: true }),
    ).toBeVisible();
  }

  await evidencePanel.getByText("Columns", { exact: true }).click();
  await evidencePanel
    .getByRole("checkbox", { name: "Question-count basis", exact: true })
    .check();
  await expect(evidenceRegion.getByRole("columnheader")).toHaveCount(8);
  await expect(
    evidenceRegion.getByRole("columnheader", { name: "Question-count basis", exact: true }),
  ).toBeVisible();
  expect(
    await evidenceRegion.evaluate((element) => element.scrollWidth > element.clientWidth),
  ).toBe(true);
  await expectDocumentFitsViewport(page);
});

async function routeUtilityRun(page: Page, handler: (route: Route) => Promise<void>) {
  await page.route("**/api/utilities/sme-coverage/run", handler);
}

async function fulfillUtilityRun(
  route: Route,
  result: SmeCoverageRunResult = completeSmeCoverageRunResult,
) {
  await route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ ok: true, result }),
  });
}

function firstCell(region: Locator, bodyRowNumber: number): Locator {
  return region.getByRole("row").nth(bodyRowNumber).getByRole("cell").first();
}

async function expectDocumentFitsViewport(page: Page) {
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
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

function createLargeSmeCoverageRunResult(): SmeCoverageRunResult {
  const tagNames = Array.from(
    { length: 120 },
    (_, index) => `evidence-row-${String(index + 1).padStart(3, "0")}`,
  );
  const datasets: SmeCoverageRunResult["datasets"] = [
    {
      datasetName: "tags",
      records: tagNames.map((name) => ({ name, count: 1 })),
      pagination: largePagination,
    },
    {
      datasetName: "questions",
      records: tagNames.map((name, index) => ({
        question_id: index + 1,
        tags: [name],
        view_count: 2_000 - index,
      })),
      pagination: largePagination,
    },
    {
      datasetName: "tagSmeCounts",
      records: tagNames.map((name, index) => ({
        name,
        subjectMatterExpertCount: index < 60 ? 0 : 1,
      })),
      pagination: largePagination,
    },
  ];
  const decisionPack = deriveDecisionPack(datasets);

  return {
    utilityId: "sme-coverage-analyzer",
    utilityTitle: "SME Coverage Analyzer",
    datasets,
    messages: [
      "Collected tags (120 records) for SME Coverage Analyzer.",
      "Collected questions (120 records) for SME Coverage Analyzer.",
      "Collected tagSmeCounts (120 records) for SME Coverage Analyzer.",
    ],
    warnings: decisionPack.warnings,
    decisionPack,
  };
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
  });
  return buildSmeCoverageDecisionPack({
    analysis,
    snapshot: {
      instanceHost: "stackoverflowteams.com",
      generatedAt: "2026-07-30T12:00:00.000Z",
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
