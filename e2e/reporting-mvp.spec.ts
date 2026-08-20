import { expect, test, type Page, type Route } from "@playwright/test";

test("reporting MVP shell supports catalog, scoped runs, credentials, uploads, and datasets", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Stack API Utilities" })).toBeVisible();
  await expect(page.getByRole("button", { exact: true, name: "Tag Report" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Run current period" })).toBeVisible();
  await page.getByLabel("Enable comparison period").click();
  await expect(page.getByRole("button", { name: "Run comparison period" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Run both periods" })).toBeVisible();

  await page.getByRole("button", { name: "Credentials" }).click();
  await expect(page.getByRole("heading", { name: "Session Credentials" })).toBeVisible();
  await expect(page.getByLabel("Instance URL")).toBeVisible();

  await page.getByRole("button", { name: "Uploads" }).click();
  await expect(page.getByRole("heading", { name: "Uploads" })).toBeVisible();
  await expect(page.getByLabel("Upload report outputs")).toBeVisible();

  await page.getByRole("button", { name: "Datasets" }).click();
  await expect(page.getByRole("heading", { name: "Datasets" })).toBeVisible();
  await expect(page.getByText("No datasets loaded or stored in this browser.")).toBeVisible();
});

test("Tag Report collects every available page for the selected date scope", async ({ page }) => {
  let requestPayload: unknown;
  await page.route("**/api/reports/run", async (route) => {
    requestPayload = route.request().postDataJSON();
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
  await page.getByRole("tab", { name: "Raw Table" }).click();
  await expect(page.getByRole("cell", { name: "page-one-tag", exact: true })).toBeVisible();
  await expect(page.getByRole("cell", { name: "page-two-tag", exact: true })).toBeVisible();

  expect(requestPayload).toMatchObject({
    reportId: "tag-report",
    periodRole: "current",
    scope: { startDate: "2026-07-01", endDate: "2026-07-31" },
  });
  expect(Object.keys(requestPayload as Record<string, unknown>).sort()).toEqual([
    "credentials",
    "periodRole",
    "reportId",
    "scope",
  ]);
});

test("Tag Report rejects nonterminal pagination without publishing or persisting a result", async ({ page }) => {
  await page.route("**/api/reports/run", async (route) => {
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

  const runStatus = page.getByRole("region", { name: "Run status" });
  await expect(runStatus.getByRole("heading", { name: "Tag Report run failed" })).toBeVisible();
  await expect(runStatus).toContainText("No complete result was produced.");
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
  let requestPayload: unknown;
  await page.route("**/api/reports/run", async (route) => {
    requestPayload = route.request().postDataJSON();
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
  expect(requestPayload).toMatchObject({ periodRole: "current", scope: {} });
  expect((requestPayload as { scope: Record<string, unknown> }).scope).toEqual({});
});

test("Tag Report keeps current and comparison date scopes distinct", async ({ page }) => {
  const requestPayloads: Array<Record<string, unknown>> = [];
  await page.route("**/api/reports/run", async (route) => {
    const payload = route.request().postDataJSON() as {
      periodRole: "current" | "comparison";
      scope: { startDate: string; endDate: string };
    };
    requestPayloads.push(payload);
    await fulfillTagReport(route, {
      periodRole: payload.periodRole,
      scope: payload.scope,
      records: [{ name: `${payload.periodRole}-period-tag`, count: 1 }],
      pagination: { pageCount: 2, reachedMaxPages: false, hasMore: false },
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
  expect(requestPayloads).toHaveLength(2);
  expect(requestPayloads[0]).toMatchObject({
    periodRole: "current",
    scope: { startDate: "2026-07-01", endDate: "2026-07-31" },
  });
  expect(requestPayloads[1]).toMatchObject({
    periodRole: "comparison",
    scope: { startDate: "2025-07-01", endDate: "2025-07-31" },
  });
});

async function saveBasicBusinessCredentials(page: Page) {
  await page.getByRole("button", { name: "Credentials", exact: true }).click();
  await page.getByLabel("Instance URL").fill("https://stackoverflowteams.com/c/example-team");
  await page.getByLabel("Personal access token").fill("pat-token");
  await page.getByRole("button", { name: "Save session credentials" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Credentials saved for this browser session." }),
  ).toBeVisible();
}

async function fulfillTwoPageTagReport(route: Route) {
  await fulfillTagReport(route, {
    scope: { startDate: "2026-07-01", endDate: "2026-07-31" },
    records: [
      { name: "page-one-tag", count: 2 },
      { name: "page-two-tag", count: 3 },
    ],
    pagination: { pageCount: 2, reachedMaxPages: false, hasMore: false },
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
  await route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      ok: true,
      result: {
        reportId: "tag-report",
        reportTitle: "Tag Report",
        periodRole: options.periodRole ?? "current",
        scope: options.scope,
        datasets: [
          {
            datasetName: "tags",
            records: options.records,
            pagination: options.pagination,
          },
          {
            datasetName: "users",
            records: [],
            pagination: { pageCount: 0, reachedMaxPages: false, hasMore: false },
          },
          {
            datasetName: "questions",
            records: [],
            pagination: { pageCount: 0, reachedMaxPages: false, hasMore: false },
          },
          {
            datasetName: "articles",
            records: [],
            pagination: { pageCount: 0, reachedMaxPages: false, hasMore: false },
          },
          {
            datasetName: "tagSmes",
            records: [],
            pagination: { pageCount: 0, reachedMaxPages: false, hasMore: false },
          },
          {
            datasetName: "tagSmeCounts",
            records: [],
            pagination: { pageCount: 0, reachedMaxPages: false, hasMore: false },
          },
          {
            datasetName: "tagLastUsed",
            records: [],
            pagination: { pageCount: 0, reachedMaxPages: false, hasMore: false },
          },
        ],
        messages: [`Collected tags (${options.records.length} records) for Tag Report.`],
        warnings: [],
      },
    }),
  });
}
