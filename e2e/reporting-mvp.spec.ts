import { expect, test } from "@playwright/test";

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
  await expect(page.getByText("No datasets loaded in this browser session.")).toBeVisible();
});

test("Tag Report exposes guided preset details", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Tag Report" })).toBeVisible();
  await expect(page.getByRole("group", { name: "Run depth" })).toBeVisible();
  await expect(page.getByText("Requests up to 500 records per dataset")).toBeVisible();

  await page.getByRole("radio", { name: "Deep audit" }).check();
  await expect(page.getByText("Requests up to 2,000 records per dataset")).toBeVisible();
});
