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
  await route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      ok: true,
      result: {
        reportId: "tag-report",
        reportTitle: "Tag Report",
        periodRole: "current",
        scope: { startDate: "2026-07-01", endDate: "2026-07-31" },
        datasets: [
          {
            datasetName: "tags",
            records: [
              { name: "page-one-tag", count: 2 },
              { name: "page-two-tag", count: 3 },
            ],
            pagination: { pageCount: 2, reachedMaxPages: false, hasMore: false },
          },
        ],
        messages: ["Collected tags (2 records) for Tag Report."],
        warnings: [],
      },
    }),
  });
}
