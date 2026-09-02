import { expect, test } from "@playwright/test";

async function openContentReplacement(page: import("@playwright/test").Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Write Tools" }).click();
  await page.getByRole("button", { name: "Content Replacement" }).click();
  await expect(page.getByRole("heading", { name: "Content Replacement", level: 1 })).toBeVisible();
}

test("keeps sticky ancestry and button motion stable through interaction states", async ({ page }) => {
  await openContentReplacement(page);
  const wizard = page.locator(".content-replacement-wizard");
  const button = wizard.locator(".s-btn").first();

  await expect(wizard).toHaveCSS("overflow", "visible");
  await expect(button).toHaveCSS("transition", "none");
  await button.hover();
  await expect(button).toHaveCSS("transform", "none");
  await expect(button).toHaveCSS("transition", "none");
  await button.focus();
  await expect(button).toHaveCSS("transform", "none");
  await expect(button).toHaveCSS("transition", "none");

  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(button).toHaveCSS("transform", "none");
  await expect(button).toHaveCSS("transition-property", "none");
  await expect(button).toHaveCSS("transition-duration", "0.001s");
});

test("has no page-horizontal overflow at desktop or narrow mobile widths", async ({ page }) => {
  for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    await openContentReplacement(page);
    const dimensions = await page.evaluate(() => ({
      viewportWidth: document.documentElement.clientWidth,
      pageWidth: document.documentElement.scrollWidth,
    }));
    expect(dimensions.pageWidth).toBeLessThanOrEqual(dimensions.viewportWidth);
  }
});
