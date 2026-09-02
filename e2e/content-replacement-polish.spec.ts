import { expect, test } from "@playwright/test";
import { createReplacementJob } from "../src/writeTools/contentReplacement/jobState";
import { createJobFingerprint } from "../src/writeTools/contentReplacement/proposals";
import type { ReplacementConfiguration } from "../src/writeTools/contentReplacement/types";

async function openContentReplacementPolishSurface(page: import("@playwright/test").Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Write Tools" }).click();
  await page.getByRole("button", { name: "Content Replacement" }).click();
  await expect(page.getByRole("heading", { name: "Content Replacement", level: 1 })).toBeVisible();
}

test("keeps sticky ancestry and button motion stable through interaction states", async ({ page }) => {
  await openContentReplacementPolishSurface(page);
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
    await openContentReplacementPolishSurface(page);
    await expect(page.getByRole("radio", { name: /Targeted scan/ })).toBeChecked();
    await expect(page.getByRole("radio", { name: /Exact IDs or URLs/ })).not.toBeChecked();
    await expect(page.getByRole("radio", { name: /Full audit/ })).not.toBeChecked();
    const dimensions = await page.evaluate(() => ({
      viewportWidth: document.documentElement.clientWidth,
      pageWidth: document.documentElement.scrollWidth,
    }));
    expect(dimensions.pageWidth).toBeLessThanOrEqual(dimensions.viewportWidth);
  }
});

test("keeps every narrow job metadata group usable without vertically wrapping its ID", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await seedNarrowLocalJob(page);

  const layout = await page.locator(".content-replacement-job-summary dl").evaluate((definitionList) => {
    const metadataGroups = Array.from(definitionList.children) as HTMLElement[];
    const jobValue = metadataGroups[0]?.querySelector("dd") as HTMLElement | null;
    if (!jobValue) throw new Error("Expected the seeded job metadata value.");
    const jobValueStyle = getComputedStyle(jobValue);
    return {
      documentScrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
      definitionListWidth: definitionList.getBoundingClientRect().width,
      metadataGroupWidths: metadataGroups.map((group) => group.getBoundingClientRect().width),
      jobValueWidth: jobValue.getBoundingClientRect().width,
      jobValueHeight: jobValue.getBoundingClientRect().height,
      jobValueLineHeight: Number.parseFloat(jobValueStyle.lineHeight),
    };
  });

  expect(layout.documentScrollWidth).toBe(layout.innerWidth);
  for (const width of layout.metadataGroupWidths) {
    expect(width).toBeGreaterThanOrEqual(layout.definitionListWidth - 1);
  }
  expect(layout.jobValueWidth).toBeGreaterThan(120);
  expect(layout.jobValueHeight).toBeLessThanOrEqual(layout.jobValueLineHeight * 3);
});

async function seedNarrowLocalJob(page: import("@playwright/test").Page) {
  const baseUrl = "https://example.stackenterprise.co";
  const createdAt = "2026-09-02T16:00:00.000Z";
  const configuration: ReplacementConfiguration = {
    target: { kind: "enterprise-main" },
    contentTypes: { questions: true, answers: false, articles: false },
    discovery: { mode: "targeted" },
    rules: [{ id: "manual-1", find: "LOCALALPHA", replace: "LOCALBETA" }],
    options: { caseSensitive: true, wholeTerm: true, replaceInCode: false },
  };
  const job = createReplacementJob({
    id: "3b5f6d60-9812-4f77-a3c1-123456789abc",
    fingerprint: await createJobFingerprint({ baseUrl, configuration, scanCompatibility: "current" }),
    baseUrl,
    configuration,
    createdAt,
  });

  await openContentReplacementPolishSurface(page);
  await expect(page.getByText("No replacement jobs are stored in this browser.")).toBeVisible();
  await page.evaluate(async (storedJob) => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("stack-api-content-replacement", 6);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
    try {
      const transaction = database.transaction("jobs", "readwrite");
      transaction.objectStore("jobs").put({
        id: storedJob.id,
        job: storedJob,
        summary: {
          id: storedJob.id,
          sortKey: `${String(8_640_000_000_000_000 - Date.parse(storedJob.updatedAt)).padStart(16, "0")}:${storedJob.id}`,
          baseUrl: storedJob.baseUrl,
          stage: storedJob.stage,
          status: storedJob.status,
          mappingCount: storedJob.configuration.rules.length,
          proposedPostCount: storedJob.progress.proposalsFound,
          recoverySnapshotStatus: storedJob.recoverySnapshotStatus,
          scanCompatibility: storedJob.scanCompatibility,
          activeOperationKind: "none",
          updatedAt: storedJob.updatedAt,
        },
      });
      await new Promise<void>((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error);
      });
    } finally {
      database.close();
    }
  }, job);
  await page.reload();
  await openContentReplacementPolishSurface(page);
  await expect(page.getByRole("button", { name: `Resume content replacement job ${job.id}` })).toBeVisible();
}
