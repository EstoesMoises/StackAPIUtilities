import { expect, test, type Page } from "@playwright/test";

interface ReadRequest { api: "v2" | "v3"; path: string; query: Record<string, string> }

const savedReadKey = (request: ReadRequest) => JSON.stringify([request.api, request.path,
  Object.entries(request.query).sort(([left], [right]) => left.localeCompare(right))]);

test("Tag Report pauses within answer pagination and resumes after reconnecting without repeating saved pages", async ({ page }, testInfo) => {
  const reads: ReadRequest[] = [];
  let secondPageAttempts = 0;
  let releasePausedRequest: (() => void) | undefined;
  const pauseGate = new Promise<void>((resolve) => { releasePausedRequest = resolve; });
  await page.route("**/api/reports/read", async (route) => {
    const { request } = route.request().postDataJSON() as { request: ReadRequest };
    reads.push(request);
    if (request.path === "/questions/101/answers" && request.query.page === "2") {
      secondPageAttempts += 1;
      if (secondPageAttempts === 1) {
        await pauseGate;
        await route.abort("aborted");
        return;
      }
    }
    const body = fixtureBody(request);
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
      ok: true, response: { status: 200, headers: {}, body },
    }) });
  });
  await page.goto("/");
  await connect(page);
  await page.getByRole("button", { name: "Scripts", exact: true }).click();
  await page.getByRole("button", { name: "Run current period" }).click();
  await expect.poll(() => secondPageAttempts).toBe(1);

  const collection = page.getByRole("region", { name: "Report collection" });
  await expect(collection).toContainText("requests saved");
  await expect(page.getByRole("button", { name: "Export report CSV" })).toHaveCount(0);
  await page.mouse.move(0, 0);
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  await page.screenshot({ path: testInfo.outputPath("report-collecting-desktop.png"), fullPage: true, animations: "disabled" });
  await page.getByRole("button", { name: "Pause collection", exact: true }).click();
  await expect(collection).toContainText("Paused");
  releasePausedRequest!();
  await expect(collection).toContainText("Progress saved in this browser.");
  const resumeButton = page.getByRole("button", { name: "Resume collection", exact: true });
  await expect(resumeButton).toBeEnabled();
  await resumeButton.hover();
  await expect(resumeButton).toHaveCSS("background-color", "oklch(0.76 0.16 55)");
  await expect(resumeButton).toHaveCSS("color", "oklch(0.2 0.035 255)");
  await page.mouse.move(0, 0);
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  await expect(resumeButton).toHaveCSS("background-color", "oklch(0.72 0.18 48)");
  await expect(resumeButton).toHaveCSS("color", "oklch(0.2 0.035 255)");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("report-paused-desktop.png"), fullPage: true, animations: "disabled" });
  const desktopViewport = page.viewportSize()!;
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(collection).toBeVisible();
  await expect(resumeButton).toBeEnabled();
  await page.mouse.move(0, 0);
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  await expect(resumeButton).toHaveCSS("background-color", "oklch(0.72 0.18 48)");
  await expect(resumeButton).toHaveCSS("color", "oklch(0.2 0.035 255)");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("report-paused-mobile.png"), fullPage: true, animations: "disabled" });
  await page.setViewportSize(desktopViewport);

  const snapshot = await savedProgress(page);
  expect(snapshot.jobs).toHaveLength(1);
  expect(snapshot.jobs[0]).toMatchObject({ status: "paused", reportId: "tag-report" });
  expect(snapshot.jobs[0].completedRequests).toBeGreaterThanOrEqual(8);
  expect(snapshot.responses.length).toBe(snapshot.jobs[0].completedRequests);
  expect(JSON.stringify(snapshot)).not.toContain("resume-secret-pat");
  expect(snapshot.jobs[0].credentialFingerprint).toMatch(/^[a-f0-9]{64}$/);
  const savedKeys = snapshot.responses.map(({ key }) => key);
  expect(savedKeys.some((key) => key.includes("/questions/101/answers") && key.includes('["page","1"]'))).toBe(true);
  const readsBeforeReload = reads.length;

  await page.reload();
  await expect(collection).toContainText("Paused");
  await expect(page.getByRole("button", { name: "Reconnect to resume" })).toBeVisible();
  expect(reads.length).toBe(readsBeforeReload);
  await expect(page.getByRole("button", { name: "Export report CSV" })).toHaveCount(0);
  await page.getByRole("button", { name: "Reconnect to resume" }).click();
  await connect(page, false);
  await page.getByRole("button", { name: "Scripts", exact: true }).click();
  await page.getByRole("button", { name: "Resume collection", exact: true }).click();

  await expect(page.getByRole("status", { name: "Collection status" })).toContainText("All available data collected");
  await expect(collection).toContainText("All required data collected.");
  await expect(page.getByRole("button", { name: "Export report CSV" })).toBeVisible();
  expect(secondPageAttempts).toBe(2);
  const newReads = reads.slice(readsBeforeReload);
  expect(newReads.map(({ path, query }) => [path, query.page])).toEqual([["/questions/101/answers", "2"]]);
  for (const completedKey of savedKeys) {
    expect(reads.filter((request) => savedReadKey(request) === completedKey)).toHaveLength(1);
  }
  const completed = await savedProgress(page);
  expect(completed.jobs[0].status).toBe("complete");
  expect(completed.jobs[0].completedRequests).toBe(snapshot.jobs[0].completedRequests + 1);
  await page.getByRole("tab", { name: "Evidence · 1" }).click();
  await expect(page.getByRole("cell", { name: "resumable", exact: true })).toBeVisible();
});

test("a failed comparison enrichment never publishes the completed current period", async ({ page }) => {
  const enriched: string[] = [];
  await page.route("**/api/reports/read", async (route) => {
    const { request } = route.request().postDataJSON() as { request: ReadRequest };
    let body: unknown;
    let status = 200;
    if (request.api === "v2" && request.path === "/questions") {
      const comparison = request.query.fromdate === "1751328000";
      body = { items: [{ question_id: comparison ? 102 : 101, tags: ["resumable"], answer_count: 0,
        comment_count: 1, creation_date: comparison ? 1_751_328_000 : 1_782_864_000 }], has_more: false };
    } else if (request.api === "v3" && request.path.endsWith("/comments")) {
      enriched.push(request.path);
      status = request.path === "/questions/102/comments" ? 403 : 200;
      body = status === 200 ? [] : { error_message: "Comparison access denied" };
    } else body = fixtureBody(request);
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
      ok: true, response: { status, headers: {}, body },
    }) });
  });
  await page.goto("/");
  await page.getByLabel("Current start date").fill("2026-07-01");
  await page.getByLabel("Current end date").fill("2026-07-31");
  await page.getByLabel("Enable comparison period").check();
  await page.getByLabel("Comparison start date").fill("2025-07-01");
  await page.getByLabel("Comparison end date").fill("2025-07-31");
  await connect(page);
  await page.getByRole("button", { name: "Scripts", exact: true }).click();
  await page.getByRole("button", { name: "Run both periods" }).click();
  const collection = page.getByRole("region", { name: "Report collection" });
  await expect(collection).toContainText("Needs attention");
  await expect(collection.getByRole("alert")).toContainText("403");
  expect(enriched).toEqual(["/questions/101/comments", "/questions/102/comments"]);
  await expect(page.getByRole("button", { name: "Export report CSV" })).toHaveCount(0);
  await expect(page.getByRole("status", { name: "Collection status" })).toHaveCount(0);
  await page.getByRole("button", { name: "Datasets", exact: true }).click();
  await expect(page.getByText("No datasets loaded or stored in this browser.")).toBeVisible();
  expect((await savedProgress(page)).jobs[0].status).toBe("failed");
});

async function connect(page: Page, navigate = true) {
  if (navigate) await page.getByRole("button", { name: "Credentials", exact: true }).click();
  await page.getByLabel("Instance URL").fill("https://stackoverflowteams.com/c/example-team");
  await page.getByLabel("Personal access token", { exact: true }).fill("resume-secret-pat");
  await page.getByRole("button", { name: "Save session credentials" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Credentials saved for this browser session." })).toBeVisible();
}

function fixtureBody(request: ReadRequest): unknown {
  if (request.api === "v2") {
    const records: Record<string, unknown[]> = {
      "/tags": [{ name: "resumable", count: 1 }],
      "/users": [{ user_id: 1 }, { user_id: 2 }],
      "/questions": [{ question_id: 101, tags: ["resumable"], answer_count: 2, comment_count: 0,
        creation_date: 1_735_689_600, owner: { user_id: 1 } }],
      "/articles": [], "/answers": [], "/comments": [],
    };
    expect(records).toHaveProperty(request.path);
    return { items: records[request.path], has_more: false };
  }
  if (request.path === "/tags") return { items: [{ id: 1, name: "resumable", subjectMatterExpertCount: 0 }], totalPages: 1 };
  expect(request.path).toBe("/questions/101/answers");
  return { items: [{ id: request.query.page === "1" ? 201 : 202, questionId: 101,
    commentCount: 0, ownerUserId: 2, creationDate: "2025-01-02T00:00:00Z", score: 3 }], totalPages: 2 };
}

async function savedProgress(page: Page): Promise<{
  jobs: Array<{ status: string; reportId: string; completedRequests: number; credentialFingerprint: string }>;
  responses: Array<{ key: string }>;
}> {
  return page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const open = indexedDB.open("stack-api-utilities-report-jobs");
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error);
    });
    try {
      const transaction = database.transaction(["jobs", "responses"], "readonly");
      const read = (store: string) => new Promise<unknown[]>((resolve, reject) => {
        const request = transaction.objectStore(store).getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const [jobs, responses] = await Promise.all([read("jobs"), read("responses")]);
      return { jobs, responses } as Awaited<ReturnType<typeof savedProgress>>;
    } finally { database.close(); }
  });
}
