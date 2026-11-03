import { expect, test, type Page, type Route } from "@playwright/test";
import { readFile } from "node:fs/promises";
import Papa from "papaparse";

test("reporting MVP shell supports catalog, scoped runs, credentials, uploads, and datasets", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Stack API Utilities" })).toBeVisible();
  await expect(page.locator(".app-topbar")).toHaveCSS("background-color", "oklch(1 0 0)");
  await expect(page.getByRole("button", { exact: true, name: "Tag Report" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Run current period" })).toBeVisible();
  await page.getByLabel("Enable comparison period").click();
  await expect(page.getByRole("button", { name: "Run comparison period" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Run both periods" })).toBeVisible();

  await page.getByRole("button", { name: "Credentials" }).click();
  await expect(page.getByRole("heading", { name: "Connect your Stack environment" })).toBeVisible();
  await expect(page.getByLabel("Instance URL")).toBeVisible();

  await page.getByRole("button", { name: "Uploads" }).click();
  await expect(page.getByRole("heading", { name: "Uploads" })).toBeVisible();
  await expect(page.getByLabel("Upload report outputs")).toBeVisible();

  await page.getByRole("button", { name: "Datasets" }).click();
  await expect(page.getByRole("heading", { name: "Datasets" })).toBeVisible();
  await expect(page.getByText("No datasets loaded or stored in this browser.")).toBeVisible();
});

test("Tag Report collects every available page for the selected date scope", async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-08-20T12:00:00.000Z"));
  const requestPayloads: ReadPayload[] = [];
  await page.route("**/api/reports/read", async (route) => {
    requestPayloads.push(route.request().postDataJSON());
    await fulfillTwoPageTagReport(route);
  });
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Tag Report" })).toBeVisible();
  await expect(page.getByLabel("Current start date")).toBeVisible();
  await expect(page.getByLabel("Current end date")).toBeVisible();
  await expect(page.getByRole("radio")).toHaveCount(0);
  await expect(page.getByText(/collects all available data for the selected dates/i)).toBeVisible();

  await page.getByLabel("Current start date").fill("2026-07-01");
  await page.getByLabel("Current end date").fill("2026-07-31");
  await saveBasicBusinessCredentials(page);
  await page.getByRole("button", { name: "Scripts", exact: true }).click();
  await page.getByRole("button", { name: "Run current period" }).click();

  const collectionStatus = page.getByRole("status", { name: "Collection status" });
  await expect(collectionStatus).toContainText("All available data collected");
  await expect(collectionStatus).toContainText("2026-07-01 to 2026-07-31");
  const topTagMetric = page.getByLabel("Rank top tags by");
  await expect(page.getByRole("heading", { name: "Top tags by page views" })).toBeVisible();
  await topTagMetric.selectOption("question_count");
  await expect(page.getByRole("heading", { name: "Top tags by questions" })).toBeVisible();
  await topTagMetric.selectOption("article_count");
  await expect(page.getByRole("heading", { name: "Top tags by articles" })).toBeVisible();
  await topTagMetric.selectOption("unique_contributors");
  await expect(page.getByRole("heading", { name: "Top tags by unique contributors" })).toBeVisible();
  const csvDownloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export report CSV" }).click();
  const csvDownload = await csvDownloadPromise;
  expect(csvDownload.suggestedFilename()).toBe(
    "tag-report-tag-health-current-2026-08-20.csv",
  );
  const downloadedPath = await csvDownload.path();
  expect(downloadedPath).not.toBeNull();
  const exported = Papa.parse<Record<string, string>>(await readFile(downloadedPath!, "utf8"), { header: true });
  expect(exported.meta.fields).toHaveLength(31);
  expect(exported.meta.fields).toEqual(expect.arrayContaining([
    "webhooks", "communities", "median_first_response_hours", "unique_askers", "unique_answerers",
    "unique_commenters", "unique_article_contributors", "question_score", "question_comments",
    "questions_accepted_answer", "questions_self_answered", "sme_answers", "answer_score", "answer_comments",
    "article_score", "article_comments",
  ]));
  expect(exported.data[0]).toMatchObject({ tag_creation_date: "2025-01-01 00:00:00", watcher_count: "42" });
  await expect(page.getByRole("status").filter({ hasText: "CSV download started" })).toContainText(
    "2 rows",
  );

  await page.getByRole("tab", { name: "Evidence · 2" }).click();
  await expect(page.getByRole("cell", { name: "page-one-tag", exact: true })).toBeVisible();
  await expect(page.getByRole("cell", { name: "page-two-tag", exact: true })).toBeVisible();

  const scopedReads = requestPayloads.filter(({ request }) => request.query.fromdate !== undefined);
  expect(scopedReads.length).toBeGreaterThanOrEqual(6);
  for (const payload of scopedReads) {
    expect(payload).toMatchObject({
      reportId: "tag-report",
      request: { api: "v2", query: { fromdate: "1782864000", todate: "1785456000" } },
    });
    expect(Object.keys(payload).sort()).toEqual(["credentials", "reportId", "request"]);
  }
  expect(requestPayloads.filter(({ request }) => request.api === "v2" && request.path === "/tags")
    .map(({ request }) => request.query.page)).toEqual(["1", "2"]);
});

test("Tag Report keeps large evidence bounded, searchable, and configurable", async ({ page }) => {
  await page.route("**/api/reports/read", async (route) => {
    await fulfillTagReport(route, {
      scope: {},
      records: buildLargeTagRecords(),
      pagination: { pageCount: 2, reachedMaxPages: false, hasMore: false },
    });
  });
  await page.goto("/");
  await saveBasicBusinessCredentials(page);
  await page.getByRole("button", { name: "Scripts", exact: true }).click();
  await page.getByRole("button", { name: "Run current period" }).click();

  await page.getByRole("tab", { name: "Evidence · 120" }).click();
  await expect(page.getByText("Rows 1–50 of 120", { exact: true })).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  const topbar = page.locator(".app-topbar");
  await expect(topbar).toHaveCSS("position", "sticky");
  await expect(topbar).toHaveCSS("background-color", "oklch(1 0 0)");
  expect((await topbar.boundingBox())?.y).toBe(0);
  await page.getByRole("button", { name: "Next page" }).click();
  await expect(page.getByText("Rows 51–100 of 120", { exact: true })).toBeVisible();

  await page.getByLabel("Search evidence").fill("tag-120");
  await expect(page.getByText("Rows 1–1 of 1", { exact: true })).toBeVisible();
  await expect(page.getByRole("cell", { name: "tag-120", exact: true })).toBeVisible();

  await page.getByText("Columns", { exact: true }).click();
  await page.getByLabel("sme_count").check();
  const smeColumn = page.getByRole("columnheader", { name: "sme_count", exact: true });
  await expect(smeColumn).toBeVisible();
  const smeColumnId = await smeColumn.getAttribute("data-column-id");
  await expect(page.locator(`td[data-column-id="${smeColumnId}"]`)).toHaveText("0");
});

test("Tag Report command center stays contained at a 375px viewport", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.route("**/api/reports/read", async (route) => {
    await fulfillTagReport(route, {
      scope: {},
      records: buildLargeTagRecords(),
      pagination: { pageCount: 2, reachedMaxPages: false, hasMore: false },
    });
  });
  await page.goto("/");
  await saveBasicBusinessCredentials(page);
  await page.getByRole("button", { name: "Scripts", exact: true }).click();
  await page.getByRole("button", { name: "Run current period" }).click();

  const setupPanel = page.locator(".workspace-panel");
  const commandCenter = page.locator(".report-command-center");
  await expect(commandCenter).toBeVisible();
  expect(
    await setupPanel.evaluate((setup, result) =>
      Boolean(setup.compareDocumentPosition(result) & Node.DOCUMENT_POSITION_FOLLOWING),
    await commandCenter.elementHandle()),
  ).toBe(true);

  const csvButton = page.getByRole("button", { name: "Export report CSV" });
  await expect(csvButton).toBeVisible();
  const [buttonBox, actionsBox] = await Promise.all([
    csvButton.boundingBox(),
    page.locator(".report-export-actions").boundingBox(),
  ]);
  expect(buttonBox).not.toBeNull();
  expect(actionsBox).not.toBeNull();
  expect(Math.abs(buttonBox!.width - actionsBox!.width)).toBeLessThanOrEqual(1);

  const tabs = page.getByRole("tablist", { name: "Report sections" });
  await expect(tabs).toHaveCSS("flex-wrap", "wrap");
  for (const tab of await page.getByRole("tab").all()) {
    expect(await tab.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  }

  const overviewTab = page.getByRole("tab", { name: "Overview" });
  const evidenceTab = page.getByRole("tab", { name: "Evidence · 120" });
  await overviewTab.focus();
  await overviewTab.press("ArrowRight");
  await expect(evidenceTab).toHaveAttribute("aria-selected", "true");
  expect(
    await evidenceTab.evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        color: style.outlineColor,
        width: style.outlineWidth,
      };
    }),
  ).toEqual({ color: "oklch(0.47 0.16 39)", width: "3px" });

  const evidenceRegion = page.getByRole("region", { name: "Report evidence table" });
  await expect(evidenceRegion).toBeVisible();
  expect(await evidenceRegion.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(
    true,
  );
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBe(true);
});

test("Tag Report rejects nonterminal pagination without publishing or persisting a result", async ({ page }) => {
  await page.route("**/api/reports/read", async (route) => {
    await fulfillTagReport(route, {
      scope: {},
      records: [{ name: "must-not-be-published", count: 1 }],
      pagination: { pageCount: 1, reachedMaxPages: false, hasMore: true },
    });
  });
  await page.goto("/");
  await saveBasicBusinessCredentials(page);
  await page.getByRole("button", { name: "Scripts", exact: true }).click();
  await page.getByRole("button", { name: "Run current period" }).click();

  const runStatus = page.getByRole("region", { name: "Report collection" });
  await expect(runStatus).toContainText("Needs attention");
  await expect(runStatus.getByRole("alert")).toContainText(/invalid|pagination/i);
  await expect(
    page.getByRole("status", { name: "Collection status" }).filter({
      hasText: "All available data collected",
    }),
  ).toHaveCount(0);
  await expect(page.getByText("must-not-be-published", { exact: true })).toHaveCount(0);

  await page.getByRole("button", { name: "Datasets", exact: true }).click();
  await expect(page.getByText("No datasets loaded or stored in this browser.")).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "Datasets", exact: true }).click();
  await expect(page.getByText("No datasets loaded or stored in this browser.")).toBeVisible();
});

test("Tag Report sends an empty scope for blank dates and labels all history", async ({ page }) => {
  const requestPayloads: ReadPayload[] = [];
  await page.route("**/api/reports/read", async (route) => {
    requestPayloads.push(route.request().postDataJSON());
    await fulfillTagReport(route, {
      scope: {},
      records: [{ name: "all-history-tag", count: 1 }],
      pagination: { pageCount: 1, reachedMaxPages: false, hasMore: false },
    });
  });
  await page.goto("/");

  await expect(page.getByLabel("Current start date")).toHaveValue("");
  await expect(page.getByLabel("Current end date")).toHaveValue("");
  await saveBasicBusinessCredentials(page);
  await page.getByRole("button", { name: "Scripts", exact: true }).click();
  await page.getByRole("button", { name: "Run current period" }).click();

  await expect(page.getByRole("status", { name: "Collection status" })).toContainText(
    "All available data collected · All available history",
  );
  expect(requestPayloads.length).toBeGreaterThan(0);
  for (const { request } of requestPayloads) {
    expect(request.query).not.toHaveProperty("fromdate");
    expect(request.query).not.toHaveProperty("todate");
  }
});

test("Tag Report keeps current and comparison date scopes distinct", async ({ page }) => {
  const requestPayloads: ReadPayload[] = [];
  await page.route("**/api/reports/read", async (route) => {
    const payload = route.request().postDataJSON() as ReadPayload;
    requestPayloads.push(payload);
    const current = payload.request.query.fromdate === "1782864000";
    await fulfillTagReport(route, {
      scope: {},
      records: payload.request.api === "v3"
        ? [{ name: "current-period-tag", count: 1 }, { name: "comparison-period-tag", count: 1 }]
        : [{ name: current ? "current-period-tag" : "comparison-period-tag", count: 1 }],
      pagination: { pageCount: 1, reachedMaxPages: false, hasMore: false },
    });
  });
  await page.goto("/");

  await page.getByLabel("Current start date").fill("2026-07-01");
  await page.getByLabel("Current end date").fill("2026-07-31");
  await page.getByLabel("Enable comparison period").check();
  await page.getByLabel("Comparison start date").fill("2025-07-01");
  await page.getByLabel("Comparison end date").fill("2025-07-31");
  await saveBasicBusinessCredentials(page);
  await page.getByRole("button", { name: "Scripts", exact: true }).click();
  await page.getByRole("button", { name: "Run both periods" }).click();

  const collectionStatus = page.getByRole("status", { name: "Collection status" });
  await expect(collectionStatus).toContainText("All available data collected");
  await expect(collectionStatus).toContainText("2026-07-01 to 2026-07-31");
  await expect(collectionStatus).toContainText("Compared with 2025-07-01 to 2025-07-31");
  await expect(page.getByText("Period comparison", { exact: true })).toBeVisible();
  const scopedQueries = requestPayloads.filter(({ request }) => request.path === "/questions" && request.query.fromdate)
    .map(({ request }) => ({ fromdate: request.query.fromdate, todate: request.query.todate }));
  expect(scopedQueries).toEqual([
    { fromdate: "1782864000", todate: "1785456000" },
    { fromdate: "1751328000", todate: "1753920000" },
  ]);
});

async function saveBasicBusinessCredentials(page: Page) {
  await page.getByRole("button", { name: "Credentials", exact: true }).click();
  await page.getByLabel("Instance URL").fill("https://stackoverflowteams.com/c/example-team");
  await page.getByLabel("Personal access token", { exact: true }).fill("pat-token");
  await page.getByRole("button", { name: "Save session credentials" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Credentials saved for this browser session." }),
  ).toBeVisible();
}

async function fulfillTwoPageTagReport(route: Route) {
  await fulfillTagReport(route, {
    scope: { startDate: "2026-07-01", endDate: "2026-07-31" },
    records: [
      { name: "page-one-tag", count: 2, creation_date: 1_735_689_600, watcherCount: 42 },
      { name: "page-two-tag", count: 3 },
    ],
    pagination: { pageCount: 2, reachedMaxPages: false, hasMore: false },
  });
}

function buildLargeTagRecords() {
  return Array.from({ length: 120 }, (_, index) => {
    const row = index + 1;
    return {
      name: `tag-${String(row).padStart(3, "0")}`,
      count: row,
      questionCount: row + 10,
      answerCount: row + 20,
      score: row + 30,
      subscribers: row + 40,
      synonyms: row + 50,
      lastActivity: `2026-08-${String(((row - 1) % 20) + 1).padStart(2, "0")}`,
      ninthField: `detail-${row}`,
    };
  });
}

async function fulfillTagReport(
  route: Route,
  options: {
    periodRole?: "current" | "comparison";
    scope: { startDate?: string; endDate?: string };
    records: Array<Record<string, unknown>>;
    pagination: { pageCount: number; reachedMaxPages: boolean; hasMore: boolean };
  },
) {
  const { request } = route.request().postDataJSON() as ReadPayload;
  const pageNumber = Number(request.query.page ?? 1);
  let body: unknown;
  if (request.api === "v2" && request.path === "/tags") {
    const pageCount = options.pagination.pageCount;
    const perPage = Math.max(1, Math.ceil(options.records.length / pageCount));
    body = {
      items: options.records.slice((pageNumber - 1) * perPage, pageNumber * perPage),
      has_more: options.pagination.hasMore && pageNumber > pageCount ? "invalid"
        : pageNumber < pageCount || options.pagination.hasMore,
    };
  } else if (request.api === "v3" && request.path === "/tags") {
    const tags = options.records.map((record, index) => ({ id: index + 1, ...record, subjectMatterExpertCount: 0 }));
    body = { items: tags.slice((pageNumber - 1) * 100, pageNumber * 100), totalPages: Math.max(1, Math.ceil(tags.length / 100)) };
  } else {
    expect(request.api).toBe("v2");
    expect(["/users", "/questions", "/articles", "/answers", "/comments"]).toContain(request.path);
    body = { items: [], has_more: false };
  }
  await route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ ok: true, response: { status: 200, headers: {}, body } }),
  });
}

interface ReadPayload {
  reportId: string;
  credentials: Record<string, unknown>;
  request: { api: "v2" | "v3"; path: string; query: Record<string, string> };
}
