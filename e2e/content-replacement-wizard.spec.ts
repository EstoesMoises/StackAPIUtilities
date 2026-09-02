import { readFile } from "node:fs/promises";
import { expect, test, type Page, type Route } from "@playwright/test";
import {
  buildReplacementProposal,
  createJobFingerprint,
  stableSerialize,
} from "../src/writeTools/contentReplacement/proposals";
import { createReplacementJob, replacementItemKey } from "../src/writeTools/contentReplacement/jobState";
import { createExactTargetSelection } from "../src/writeTools/contentReplacement/discovery";
import type {
  InventoryCursor,
  PersistedContentReplacementJob,
  ReplacementConfiguration,
  ReplacementItemRef,
  ReplacementProposal,
  ReplacementRequestModel,
  ReplacementWireRequestModel,
} from "../src/writeTools/contentReplacement/types";

const ENTERPRISE_URL = "https://example.stackenterprise.co";
const EXPECTED_CONFIGURATION: ReplacementConfiguration = {
  target: { kind: "enterprise-main" },
  contentTypes: { questions: true, answers: true, articles: true },
  discovery: { mode: "full" },
  rules: [
    { id: "manual-1", find: "LOCALONE", replace: "LOCALTWO" },
    { id: "csv-1-2", find: "LOCALTHREE", replace: "LOCALFOUR", sourceRow: 2 },
  ],
  options: { caseSensitive: true, wholeTerm: true, replaceInCode: false },
};
const QUESTION_REF = { kind: "question", questionId: 101 } as const;
const ANSWER_REF = { kind: "answer", questionId: 101, answerId: 201 } as const;
const ARTICLE_REF = { kind: "article", articleId: 301 } as const;
const SECOND_QUESTION_REF = { kind: "question", questionId: 102 } as const;
const EXPECTED_CREDENTIALS = {
  instanceType: "enterprise",
  baseUrl: ENTERPRISE_URL,
  apiKey: "mock-api-key",
  accessToken: "mock-write-token",
  authSource: "oauth-pkce",
  oauthClientId: "content-replacement-e2e",
  oauthScopes: ["write_access", "no_expiry"],
};
const QUESTION_PRIOR_REQUEST_MODEL: ReplacementWireRequestModel = {
  kind: "question",
  ref: QUESTION_REF,
  request: {
    title: "LOCALONE migration",
    body: "Replace LOCALONE here. Keep `LOCALONE`.",
    tags: ["benefits", "migration"],
  },
};
const QUESTION_PRIOR_DISPLAY_MODEL: ReplacementRequestModel = {
  ...QUESTION_PRIOR_REQUEST_MODEL,
  metadata: {
    webUrl: `${ENTERPRISE_URL}/questions/101/local-one-migration`,
    owner: { id: 11, name: "Question Owner" },
    lastEditor: { id: 12, name: "Question Editor" },
    lastActivityDate: "2026-09-01T15:00:00.000Z",
  },
};
const QUESTION_CURRENT_REQUEST_MODEL: ReplacementWireRequestModel = {
  kind: "question",
  ref: QUESTION_REF,
  request: {
    title: "LOCALTWO migration",
    body: "Replace LOCALTWO here. Keep `LOCALONE`.",
    tags: ["benefits", "migration"],
  },
};
const EXPECTED_INVENTORY_CURSORS: InventoryCursor[] = [
  { kind: "questions", page: 1 },
  { kind: "articles", page: 1 },
  { kind: "questions", page: 2 },
  { kind: "answers", questionId: 101, page: 1 },
  { kind: "articles", page: 2 },
  { kind: "answers", questionId: 102, page: 1 },
  { kind: "answers", questionId: 101, page: 2 },
];
const EXPECTED_DETAIL_REFS: ReplacementItemRef[] = [QUESTION_REF, ARTICLE_REF, SECOND_QUESTION_REF, ANSWER_REF];
const RESULT_HEADERS = [
  "contentType", "itemId", "questionId", "title", "webUrl", "discoveryMode", "coverage", "suppliedTargetCount", "status", "outcome", "attemptCount",
  "changedOccurrences", "protectedOccurrences", "completedAt", "observedRequestChecksum",
] as const;

test("reviews and safely applies a complete mocked content replacement job", async ({ page }) => {
  test.setTimeout(90_000);
  const fixture = await installContentReplacementRoutes(page);
  await connectEnterpriseWriteCredentials(page);

  await page.getByRole("button", { name: "Write Tools", exact: true }).click();
  await page.getByRole("button", { name: "Content Replacement", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Content Replacement", level: 1 })).toBeVisible();

  await expect(page.getByLabel("Questions")).toBeChecked();
  await expect(page.getByLabel("Answers")).toBeChecked();
  await expect(page.getByLabel("Articles")).toBeChecked();
  await page.getByText("Advanced", { exact: true }).click();
  await expect(page.getByLabel("Case-sensitive matching")).toBeChecked();
  await expect(page.getByLabel("Whole-term matching")).toBeChecked();
  await expect(page.getByLabel("Replace inside code")).not.toBeChecked();
  await page.getByLabel("Full audit").check();

  await page.getByLabel("Find term 1").fill("LOCALONE");
  await page.getByLabel("Replace term 1 with").fill("LOCALTWO");
  await page.getByLabel("Import replacement CSV").setInputFiles({
    name: "additional-rule.csv",
    mimeType: "text/csv",
    buffer: Buffer.from("find,replace\nLOCALTHREE,LOCALFOUR\n"),
  });
  await page.getByRole("button", { name: "Append imported rows" }).click();
  await expect(page.getByLabel("Find term 2")).toHaveValue("LOCALTHREE");
  await expect(page.getByLabel("Replace term 2 with")).toHaveValue("LOCALFOUR");

  await page.getByRole("button", { name: "Review rules" }).click();
  const checkpoint = page.locator('[aria-label="Reviewed rule summary"]');
  await expect(checkpoint).toContainText("LOCALONE → LOCALTWO");
  await expect(checkpoint).toContainText("LOCALTHREE → LOCALFOUR");
  await expect(checkpoint).toContainText("Case-sensitive; Whole term; Code protected");
  await page.getByRole("button", { name: "Start scan" }).click();

  await expect(page.getByRole("button", { name: "Pause scan" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Cancel scan" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Apply changes to/ })).toHaveCount(0);
  fixture.releaseInitialInventory();

  await expect(page.getByRole("heading", { name: "Review proposed changes" })).toBeVisible();
  expect(fixture.scanRequests.filter((request) => request.action === "inventory")).toHaveLength(7);
  expect(fixture.inventoryKinds).toEqual([
    "questions:1", "articles:1", "questions:2", "answers:101:1", "articles:2",
    "answers:102:1", "answers:101:2",
  ]);
  expect(fixture.scanRequests.filter((request) => request.action === "details")).toHaveLength(1);
  await expect(page.getByRole("status", { name: "Review results count" })).toHaveText("3 matching proposals");
  await expect(page.getByText("3 posts selected")).toBeVisible();
  await expect(page.getByRole("button", { name: "Continue with 3 posts and 5 changed occurrences" })).toBeVisible();

  const indexedDbBoundary = await inspectIndexedDbStructuredClone(page);
  expect(indexedDbBoundary).toEqual({
    wrapperKeys: ["id", "job", "summary"],
    sameReference: false,
    mutationLeaked: false,
    durableStage: "review",
    durableStatus: "completed",
    proposalCount: 3,
  });

  await page.reload();
  await connectEnterpriseWriteCredentials(page);
  await page.getByRole("button", { name: "Write Tools", exact: true }).click();
  await page.getByRole("button", { name: "Content Replacement", exact: true }).click();
  const resumeStoredJob = page.getByRole("button", { name: /Resume content replacement job/ }).first();
  await expect(resumeStoredJob).toBeVisible();
  await resumeStoredJob.click();
  await expect(page.getByRole("heading", { name: "Review proposed changes" })).toBeVisible();
  await expect(page.getByRole("status", { name: "Review results count" })).toHaveText("3 matching proposals");

  await page.getByRole("button", { name: "View details for question 101" }).click();
  const questionDetail = page.getByRole("region", { name: "Question 101 proposed changes" });
  await expect(questionDetail.getByTestId("question-101-title-before")).toHaveText("LOCALONE migration");
  await expect(questionDetail.getByTestId("question-101-title-after")).toHaveText("LOCALTWO migration");
  await expect(questionDetail.getByTestId("question-101-body-before")).toHaveText("Replace LOCALONE here. Keep `LOCALONE`.");
  await expect(questionDetail.getByTestId("question-101-body-after")).toHaveText("Replace LOCALTWO here. Keep `LOCALONE`.");
  await expect(questionDetail).toContainText("Code — unchanged");
  await expect(questionDetail.getByRole("heading", { name: "Normalized API request after replacement" })).toBeVisible();
  await expect(questionDetail.locator(".content-replacement-review-request pre")).toHaveText(
    JSON.stringify(fixture.question.after.request, null, 2),
  );
  await expect(page.getByRole("region", { name: "Replacement proposal review table" })).toHaveAttribute("tabindex", "0");
  const detailOverflow = await questionDetail.locator("pre").first().evaluate((element) => ({
    maxHeight: getComputedStyle(element).maxHeight,
    overflow: getComputedStyle(element).overflow,
  }));
  expect(detailOverflow.overflow).toBe("auto");
  expect(Number.parseFloat(detailOverflow.maxHeight)).toBeGreaterThan(0);
  expect(Number.parseFloat(detailOverflow.maxHeight)).toBeLessThanOrEqual(416);

  await page.getByLabel("Include article 301").uncheck();
  await expect(page.getByText("2 posts selected")).toBeVisible();
  const continueButton = page.getByRole("button", { name: "Continue with 2 posts and 3 changed occurrences" });
  await expect(continueButton).toBeEnabled();
  await continueButton.click();

  const applyScope = page.getByRole("region", { name: "Confirmed apply scope" });
  await expect(applyScope).toContainText("1 questions, 1 answers, 0 articles");
  await expect(applyScope).toContainText("2 posts selected · 3 changed occurrences · 1 protected occurrence");
  await page.getByLabel(/I understand these edits use the live Enterprise API/).check();
  await page.getByLabel("Type APPLY to confirm").fill("APPLY");
  await page.getByRole("button", { name: "Apply changes to 2 posts" }).click();

  await expect(page.getByRole("heading", { name: "Apply results" })).toBeVisible();
  const resultSummary = page.getByRole("region", { name: "Apply result summary" });
  await expect(resultSummary.getByText("Updated").locator("..")).toContainText("1");
  await expect(resultSummary.getByText("Stale").locator("..")).toContainText("1");
  await expect(resultSummary.getByText("Excluded").locator("..")).toContainText("1");
  await expect(resultSummary.getByText("Protected occurrences").locator("..")).toContainText("2");
  const results = page.getByRole("table", { name: "Content replacement results" });
  await expect(results).toContainText("Updated");
  await expect(results).toContainText("Stale — skipped before writing");
  await expect(results).toContainText("Excluded");

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download results CSV" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("content-replacement-results.csv");
  const downloadPath = await download.path();
  if (!downloadPath) throw new Error("Expected the one-shot results CSV to have a local download path.");
  const csv = await readFile(downloadPath, "utf8");
  const [header, ...rows] = csv.trimEnd().split(/\r?\n/);
  expect(header).toBe(RESULT_HEADERS.join(","));
  expect(rows).toHaveLength(3);
  const parsedRows = rows.map((row) => Object.fromEntries(
    RESULT_HEADERS.map((column, index) => [column, row.split(",")[index] ?? ""]),
  ));
  expect(parsedRows.map((row) => ({
    contentType: row.contentType,
    itemId: row.itemId,
    questionId: row.questionId,
    title: row.title,
    webUrl: row.webUrl,
    status: row.status,
    outcome: row.outcome,
    attemptCount: row.attemptCount,
    changedOccurrences: row.changedOccurrences,
    protectedOccurrences: row.protectedOccurrences,
    observedRequestChecksum: row.observedRequestChecksum,
  }))).toEqual([
    {
      contentType: "question", itemId: "101", questionId: "", title: "LOCALONE migration",
      webUrl: `${ENTERPRISE_URL}/questions/101/local-one-migration`, status: "applied", outcome: "applied",
      attemptCount: "1", changedOccurrences: "2", protectedOccurrences: "1",
      observedRequestChecksum: fixture.evidence.question.proposedRequestChecksum,
    },
    {
      contentType: "answer", itemId: "201", questionId: "101", title: "LOCALONE migration", webUrl: "",
      status: "stale", outcome: "stale",
      attemptCount: "1", changedOccurrences: "1", protectedOccurrences: "0", observedRequestChecksum: "",
    },
    {
      contentType: "article", itemId: "301", questionId: "", title: "LOCALTHREE guide", webUrl: "",
      status: "excluded", outcome: "excluded",
      attemptCount: "0", changedOccurrences: "2", protectedOccurrences: "1", observedRequestChecksum: "",
    },
  ]);
  for (const row of parsedRows) expect(Number.isFinite(Date.parse(row.completedAt))).toBe(true);
  expect(csv).not.toMatch(/mock-write-token|mock-api-key|accessToken|apiKey|authorization|credentials/i);

  await page.getByRole("button", { name: "Preview recovery for 1 post" }).click();
  const recoveryPreview = page.getByRole("region", { name: "Recovery preview", exact: true });
  await expect(recoveryPreview).toContainText("Question 101 recovery preview · Ready to recover");
  await expect(recoveryPreview.getByRole("heading", { name: "Current replacement state" }).locator("+ pre")).toHaveText(
    JSON.stringify(QUESTION_CURRENT_REQUEST_MODEL, null, 2),
  );
  await expect(recoveryPreview.getByRole("heading", { name: "Prior full request model to restore" }).locator("+ pre")).toHaveText(
    JSON.stringify(QUESTION_PRIOR_DISPLAY_MODEL, null, 2),
  );
  await expect(recoveryPreview.locator("dt", { hasText: "Observed current checksum" }).locator("+ dd code")).toHaveText(
    fixture.evidence.question.proposedRequestChecksum,
  );
  await expect(recoveryPreview.locator("dt", { hasText: "Expected successful apply checksum" }).locator("+ dd code")).toHaveText(
    fixture.evidence.question.proposedRequestChecksum,
  );
  await page.getByLabel(/I understand recovery writes the prior full request model/).check();
  await page.getByLabel("Type RECOVER to confirm").fill("RECOVER");
  await page.getByRole("button", { name: "Recover 1 post" }).click();

  await expect(resultSummary.getByText("Recovered").locator("..")).toContainText("1");
  await expect(results).toContainText("Recovered");

  expect([...new Set(fixture.scanRequests.map((request) => request.jobFingerprint))]).toEqual([
    fixture.jobFingerprint,
  ]);
  expect(fixture.applyRequests).toHaveLength(2);
  expect(fixture.applyRequests.map((request) => request.itemRef)).toEqual([QUESTION_REF, ANSWER_REF]);
  for (const request of fixture.applyRequests) {
    expect(request).not.toHaveProperty("body");
    expect(request).not.toHaveProperty("request");
    expect(request).not.toHaveProperty("after");
    expect(request).not.toHaveProperty("proposedRequestModel");
  }

  expect(fixture.recoveryRequests).toHaveLength(2);
  expect(fixture.recoveryRequests.map((request) => request.action)).toEqual(["preview", "apply"]);
  for (const request of fixture.recoveryRequests) {
    expect(request.priorRequestModel).not.toHaveProperty("metadata");
  }
});

test("runs a targeted scan for two rules before any live-write confirmation", async ({ page }) => {
  const fixture = await installTargetedRoutes(page);
  await connectEnterpriseWriteCredentials(page);
  await openContentReplacement(page);

  await expect(page.getByRole("radio", { name: /Targeted scan/ })).toBeChecked();
  await page.getByLabel("Find term 1").fill("LOCALALPHA");
  await page.getByLabel("Replace term 1 with").fill("LOCALBETA");
  await page.getByRole("button", { name: "Add mapping" }).click();
  await page.getByLabel("Find term 2").fill("LOCALGAMMA");
  await page.getByLabel("Replace term 2 with").fill("LOCALDELTA");
  await page.getByRole("button", { name: "Review rules" }).click();
  await page.getByRole("button", { name: "Start scan" }).click();

  await expect(page.getByRole("note", { name: "Discovery coverage" }))
    .toContainText("Search-assisted · may miss matches");
  await expect(page.getByRole("heading", { name: "Review proposed changes" })).toBeVisible();
  expect(fixture.inventoryKinds).toEqual([
    "search:manual-1:1",
    "search:manual-1:2",
    "search:manual-2:1",
    "search:manual-2:2",
  ]);
  expect(fixture.detailRequests).toEqual([fixture.detailRefs]);
  expect(fixture.inventoryRequests).toHaveLength(4);

  await page.getByRole("button", { name: /Continue with 4 posts/ }).click();
  const apply = page.getByRole("button", { name: "Apply changes to 4 posts" });
  await expect(apply).toBeDisabled();
  await page.getByLabel(/I understand these edits use the live Enterprise API/).check();
  await page.getByLabel("Type APPLY to confirm").fill("APPLY");
  await expect(apply).toBeDisabled();
  await page.getByLabel("I understand search-assisted discovery may have missed matches.").check();
  await expect(apply).toBeEnabled();
  expect(fixture.noWriteRequests.apply).toHaveLength(0);
  expect(fixture.noWriteRequests.recover).toHaveLength(0);
});

test("imports exact targets without inventory requests and limits coverage to those posts", async ({ page }) => {
  const fixture = await installExactTargetRoutes(page);
  await connectEnterpriseWriteCredentials(page);
  await openContentReplacement(page);

  await page.getByRole("radio", { name: /Exact IDs or URLs/ }).check();
  await page.getByLabel("Find term 1").fill("LOCALEPSILON");
  await page.getByLabel("Replace term 1 with").fill("LOCALZETA");
  await page.getByLabel("Import target CSV").setInputFiles({
    name: "local-targets.csv",
    mimeType: "text/csv",
    buffer: Buffer.from("type,id,parent_question_id\nquestion,701,\nanswer,702,701\narticle,703,\n"),
  });
  await expect(page.getByText("Loaded 3 targets from local-targets.csv.")).toBeVisible();
  await page.getByRole("button", { name: "Review rules" }).click();
  await page.getByRole("button", { name: "Start scan" }).click();

  await expect(page.getByRole("heading", { name: "Review proposed changes" })).toBeVisible();
  await expect(page.getByRole("note", { name: "Discovery coverage" }))
    .toContainText("Exact target list · complete for 3 supplied posts");
  expect(fixture.inventoryRequests).toEqual([]);
  expect(fixture.detailRequests).toEqual([fixture.detailRefs]);
  expect(fixture.noWriteRequests.apply).toHaveLength(0);
  expect(fixture.noWriteRequests.recover).toHaveLength(0);
});

test("resumes a Full audit at the persisted cursor and skips only zero-answer collections", async ({ page }) => {
  const fixture = await installFullAuditRoutes(page);
  await connectEnterpriseWriteCredentials(page);
  await openContentReplacement(page);

  await page.getByRole("radio", { name: /Full audit/ }).check();
  await page.getByLabel("Articles").uncheck();
  await page.getByLabel("Find term 1").fill("LOCALTHETA");
  await page.getByLabel("Replace term 1 with").fill("LOCALOMEGA");
  await page.getByRole("button", { name: "Review rules" }).click();
  await page.getByRole("button", { name: "Start scan" }).click();

  await fixture.waitForBlockedCursor();
  await page.getByRole("button", { name: "Pause scan" }).click();
  await expect(page.getByRole("status")).toContainText("Scan paused");
  fixture.releaseBlockedCursor();

  await page.reload();
  await connectEnterpriseWriteCredentials(page);
  await openContentReplacement(page);
  const openSavedJob = page.getByRole("button", { name: /Resume content replacement job/ }).first();
  await expect(openSavedJob).toBeVisible();
  await openSavedJob.click();
  await expect(page.getByRole("button", { name: "Resume scan" })).toBeVisible();
  await page.getByRole("button", { name: "Resume scan" }).click();

  await expect(page.getByRole("heading", { name: "Review proposed changes" })).toBeVisible();
  await expect(page.getByRole("note", { name: "Discovery coverage" }))
    .toContainText("Exhaustive · all accessible selected content");
  expect(fixture.blockedCursor).toEqual({ kind: "questions", page: 2 });
  expect(fixture.resumedCursor).toEqual({ kind: "questions", page: 2 });
  expect(fixture.answerCollectionKinds).toEqual(["answers:802:1", "answers:803:1"]);
  expect(fixture.inventoryKinds).toEqual([
    "questions:1",
    "questions:2",
    "questions:2",
    "answers:802:1",
    "answers:803:1",
  ]);
  expect(fixture.noWriteRequests.apply).toHaveLength(0);
  expect(fixture.noWriteRequests.recover).toHaveLength(0);
});

test("keeps paused schema-v1 jobs restart-only while completed schema-v1 jobs retain guarded recovery", async ({ page }) => {
  await seedLegacyJobs(page);
  await connectEnterpriseWriteCredentials(page);
  await openContentReplacement(page);

  await expect(page.getByText("New scan required", { exact: true })).toBeVisible();
  const completedJob = page.getByRole("button", { name: "Resume content replacement job completed-v1" });
  await expect(completedJob).toBeVisible();
  await completedJob.click();

  await expect(page.getByRole("heading", { name: "Apply results" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Guarded recovery" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Preview recovery for 1 post" })).toBeEnabled();
});

interface RouteFixture {
  question: ReplacementProposal;
  answer: ReplacementProposal;
  article: ReplacementProposal;
  evidence: Record<"question" | "answer" | "article", ReturnType<typeof proposalEvidence>>;
  jobFingerprint: string;
  scanRequests: Array<Record<string, any>>;
  inventoryKinds: string[];
  applyRequests: Array<Record<string, any>>;
  recoveryRequests: Array<Record<string, any>>;
  releaseInitialInventory(): void;
}

async function installContentReplacementRoutes(page: Page): Promise<RouteFixture> {
  const proposals = await Promise.all(replacementModels().map((model) => buildReplacementProposal(model, EXPECTED_CONFIGURATION)));
  if (proposals.some((proposal) => proposal === null)) throw new Error("Expected every e2e model to produce a proposal.");
  const [question, answer, article] = proposals as ReplacementProposal[];
  const evidence = {
    question: proposalEvidence(question),
    answer: proposalEvidence(answer),
    article: proposalEvidence(article),
  };
  const jobFingerprint = await createJobFingerprint({
    baseUrl: ENTERPRISE_URL,
    configuration: EXPECTED_CONFIGURATION,
    scanCompatibility: "current",
  });
  const byKey = new Map([
    [refKey(QUESTION_REF), question],
    [refKey(ANSWER_REF), answer],
    [refKey(ARTICLE_REF), article],
  ]);
  let releaseInitialInventory!: () => void;
  const initialInventoryGate = new Promise<void>((resolve) => { releaseInitialInventory = resolve; });
  const fixture: RouteFixture = {
    question, answer, article, evidence, jobFingerprint,
    scanRequests: [], inventoryKinds: [], applyRequests: [], recoveryRequests: [],
    releaseInitialInventory,
  };

  await page.route("**/api/write-tools/content-replacement/scan", async (route) => {
    const request = route.request().postDataJSON() as Record<string, any>;
    if (request.action === "inventory") {
      const cursor = EXPECTED_INVENTORY_CURSORS[fixture.inventoryKinds.length];
      expect(request).toEqual({
        action: "inventory",
        credentials: EXPECTED_CREDENTIALS,
        configuration: EXPECTED_CONFIGURATION,
        scanCompatibility: "current",
        jobFingerprint,
        cursor,
      });
      fixture.scanRequests.push(request);
      fixture.inventoryKinds.push(cursorKey(cursor));
      if (cursor.kind === "questions" && cursor.page === 1) await initialInventoryGate;
      await fulfillJson(route, { ok: true, result: inventoryResult(cursor), throttleNotices: [] });
      return;
    }
    expect(request).toEqual({
      action: "details",
      credentials: EXPECTED_CREDENTIALS,
      configuration: EXPECTED_CONFIGURATION,
      scanCompatibility: "current",
      jobFingerprint,
      refs: EXPECTED_DETAIL_REFS,
    });
    fixture.scanRequests.push(request);
    await fulfillJson(route, {
      ok: true,
      result: {
        proposals: EXPECTED_DETAIL_REFS.flatMap((ref) => {
          const proposal = byKey.get(refKey(ref));
          return proposal ? [proposal] : [];
        }),
        inspectedCount: EXPECTED_DETAIL_REFS.length,
        protectedOccurrenceCount: 2,
      },
      throttleNotices: [],
    });
  });

  await page.route("**/api/write-tools/content-replacement/apply", async (route) => {
    const request = route.request().postDataJSON() as Record<string, any>;
    const itemRef = [QUESTION_REF, ANSWER_REF][fixture.applyRequests.length];
    const itemEvidence = itemRef?.kind === "question" ? evidence.question : evidence.answer;
    expect(request).toEqual({
      credentials: EXPECTED_CREDENTIALS,
      configuration: EXPECTED_CONFIGURATION,
      scanCompatibility: "current",
      jobFingerprint,
      itemRef,
      expectedScannedRequestChecksum: itemEvidence.scannedRequestChecksum,
      expectedProposedRequestChecksum: itemEvidence.proposedRequestChecksum,
      expectedProposalFingerprint: itemEvidence.proposalFingerprint,
    });
    fixture.applyRequests.push(request);
    const updated = itemRef?.kind === "question";
    await fulfillJson(route, {
      ok: true,
      result: {
        status: updated ? "updated" : "stale",
        observedRequestChecksum: updated ? evidence.question.proposedRequestChecksum : "f".repeat(64),
      },
      throttleNotices: [],
    });
  });

  await page.route("**/api/write-tools/content-replacement/recover", async (route) => {
    const request = route.request().postDataJSON() as Record<string, any>;
    const action = ["preview", "apply"][fixture.recoveryRequests.length];
    expect(request).toEqual({
      action,
      credentials: EXPECTED_CREDENTIALS,
      configuration: EXPECTED_CONFIGURATION,
      scanCompatibility: "current",
      jobFingerprint,
      itemRef: QUESTION_REF,
      priorRequestModel: QUESTION_PRIOR_REQUEST_MODEL,
      expectedPriorRequestChecksum: evidence.question.scannedRequestChecksum,
      expectedPostApplyChecksum: evidence.question.proposedRequestChecksum,
      reviewedProposedRequestChecksum: evidence.question.proposedRequestChecksum,
      reviewedProposalFingerprint: evidence.question.proposalFingerprint,
    });
    fixture.recoveryRequests.push(request);
    if (request.action === "preview") {
      await fulfillJson(route, {
        ok: true,
        result: {
          status: "recoverable",
          currentRequestModel: QUESTION_CURRENT_REQUEST_MODEL,
          priorRequestModel: QUESTION_PRIOR_REQUEST_MODEL,
          observedRequestChecksum: evidence.question.proposedRequestChecksum,
        },
        throttleNotices: [],
      });
      return;
    }
    await fulfillJson(route, {
      ok: true,
      result: { status: "recovered", observedRequestChecksum: evidence.question.scannedRequestChecksum },
      throttleNotices: [],
    });
  });

  return fixture;
}

function replacementModels(): ReplacementRequestModel[] {
  return [
    {
      kind: "question",
      ref: QUESTION_REF,
      request: { title: "LOCALONE migration", body: "Replace LOCALONE here. Keep `LOCALONE`.", tags: ["benefits", "migration"] },
      metadata: {
        owner: { id: 11, name: "Question Owner" },
        lastEditor: { id: 12, name: "Question Editor" },
        lastActivityDate: "2026-09-01T15:00:00.000Z",
        webUrl: `${ENTERPRISE_URL}/questions/101/local-one-migration`,
      },
    },
    {
      kind: "answer", ref: ANSWER_REF, request: { body: "LOCALONE answer." },
      metadata: { titleContext: "LOCALONE migration", owner: { id: 21, name: "Answer Owner" } },
    },
    {
      kind: "article",
      ref: ARTICLE_REF,
      request: {
        title: "LOCALTHREE guide", body: "LOCALTHREE details. Keep `LOCALTHREE`.", tags: ["benefits"],
        type: "knowledgeArticle", expirationDate: null,
        permissions: { editableBy: "specificEditors", editorUserIds: [31], editorUserGroupIds: [41] },
      },
      metadata: { owner: { id: 31, name: "Article Owner" } },
    },
  ];
}

function inventoryResult(cursor: InventoryCursor) {
  const progress = (answerBearingQuestionsQueued = 0, zeroAnswerQuestionsSkipped = 0) => ({
    apiRequestsCompleted: 1,
    searchPages: 0,
    searchTermsCompleted: 0,
    answerBearingQuestionsQueued,
    zeroAnswerQuestionsSkipped,
  });
  if (cursor.kind === "questions" && cursor.page === 1) {
    return {
      candidates: [QUESTION_REF], answerCursors: [{ kind: "answers", questionId: 101, page: 1 }],
      nextCursor: { kind: "questions", page: 2 }, inspectedCount: 1, pageKind: "questions", progress: progress(1),
    };
  }
  if (cursor.kind === "questions") {
    return {
      candidates: [SECOND_QUESTION_REF],
      answerCursors: [{ kind: "answers", questionId: 102, page: 1 }],
      nextCursor: null,
      inspectedCount: 1,
      pageKind: "questions", progress: progress(1),
    };
  }
  if (cursor.kind === "answers") {
    if (cursor.questionId === 101 && cursor.page === 1) {
      return {
        candidates: [ANSWER_REF], answerCursors: [],
        nextCursor: { kind: "answers", questionId: 101, page: 2 },
        inspectedCount: 1, pageKind: "answers", progress: progress(),
      };
    }
    return { candidates: [], answerCursors: [], nextCursor: null, inspectedCount: 0, pageKind: "answers", progress: progress() };
  }
  if (cursor.page === 1) {
    return {
      candidates: [ARTICLE_REF], answerCursors: [], nextCursor: { kind: "articles", page: 2 },
      inspectedCount: 1, pageKind: "articles", progress: progress(),
    };
  }
  return { candidates: [], answerCursors: [], nextCursor: null, inspectedCount: 0, pageKind: "articles", progress: progress() };
}

interface TargetedRouteFixture {
  inventoryKinds: string[];
  inventoryRequests: Array<Record<string, unknown>>;
  detailRequests: ReplacementItemRef[][];
  detailRefs: ReplacementItemRef[];
  noWriteRequests: NoWriteRequests;
}

interface NoWriteRequests {
  apply: Array<Record<string, unknown>>;
  recover: Array<Record<string, unknown>>;
}

async function installNoWriteGuards(page: Page): Promise<NoWriteRequests> {
  const requests: NoWriteRequests = { apply: [], recover: [] };
  await page.route("**/api/write-tools/content-replacement/apply", async (route) => {
    requests.apply.push(route.request().postDataJSON() as Record<string, unknown>);
    await route.abort("failed");
    throw new Error("A no-write discovery workflow unexpectedly called the apply route.");
  });
  await page.route("**/api/write-tools/content-replacement/recover", async (route) => {
    requests.recover.push(route.request().postDataJSON() as Record<string, unknown>);
    await route.abort("failed");
    throw new Error("A no-write discovery workflow unexpectedly called the recovery route.");
  });
  return requests;
}

async function installTargetedRoutes(page: Page): Promise<TargetedRouteFixture> {
  const configuration: ReplacementConfiguration = {
    target: { kind: "enterprise-main" },
    contentTypes: { questions: true, answers: true, articles: true },
    discovery: { mode: "targeted" },
    rules: [
      { id: "manual-1", find: "LOCALALPHA", replace: "LOCALBETA" },
      { id: "manual-2", find: "LOCALGAMMA", replace: "LOCALDELTA" },
    ],
    options: { caseSensitive: true, wholeTerm: true, replaceInCode: false },
  };
  const firstQuestion = { kind: "question", questionId: 601 } as const;
  const sharedQuestion = { kind: "question", questionId: 602 } as const;
  const article = { kind: "article", articleId: 603 } as const;
  const answer = { kind: "answer", questionId: 602, answerId: 604 } as const;
  const detailRefs: ReplacementItemRef[] = [firstQuestion, sharedQuestion, article, answer];
  const proposals = await Promise.all([
    buildReplacementProposal({
      kind: "question", ref: firstQuestion,
      request: { title: "LOCALALPHA first", body: "Ordinary local body.", tags: ["local"] },
    }, configuration),
    buildReplacementProposal({
      kind: "question", ref: sharedQuestion,
      request: { title: "Shared local record", body: "LOCALGAMMA shared", tags: ["local"] },
    }, configuration),
    buildReplacementProposal({
      kind: "article", ref: article,
      request: {
        title: "LOCALALPHA article", body: "Ordinary local article.", tags: ["local"], type: "knowledgeArticle",
        expirationDate: null,
        permissions: { editableBy: "specificEditors", editorUserIds: [1], editorUserGroupIds: [] },
      },
    }, configuration),
    buildReplacementProposal({
      kind: "answer", ref: answer, request: { body: "LOCALGAMMA answer" },
    }, configuration),
  ]);
  if (proposals.some((proposal) => proposal === null)) throw new Error("Expected targeted fixture proposals.");
  const proposalByKey = new Map((proposals as ReplacementProposal[]).map((proposal) => [
    replacementItemKey(proposal.before.ref), proposal,
  ]));
  const fingerprint = await createJobFingerprint({ baseUrl: ENTERPRISE_URL, configuration, scanCompatibility: "current" });
  const cursors = [
    { kind: "search" as const, ruleId: "manual-1", page: 1 },
    { kind: "search" as const, ruleId: "manual-1", page: 2 },
    { kind: "search" as const, ruleId: "manual-2", page: 1 },
    { kind: "search" as const, ruleId: "manual-2", page: 2 },
  ];
  const fixture: TargetedRouteFixture = {
    inventoryKinds: [], inventoryRequests: [], detailRequests: [], detailRefs,
    noWriteRequests: await installNoWriteGuards(page),
  };

  await page.route("**/api/write-tools/content-replacement/scan", async (route) => {
    const request = route.request().postDataJSON() as Record<string, unknown>;
    if (request.action === "inventory") {
      const cursor = cursors[fixture.inventoryRequests.length];
      expect(request).toEqual({
        action: "inventory",
        credentials: EXPECTED_CREDENTIALS,
        configuration,
        scanCompatibility: "current",
        jobFingerprint: fingerprint,
        cursor,
      });
      fixture.inventoryRequests.push(request);
      fixture.inventoryKinds.push(searchCursorKey(cursor));
      const candidates = cursor.ruleId === "manual-1" && cursor.page === 1
        ? [firstQuestion, sharedQuestion]
        : cursor.ruleId === "manual-1"
          ? [article]
          : cursor.page === 1 ? [sharedQuestion, answer] : [];
      await fulfillJson(route, {
        ok: true,
        result: {
          candidates,
          answerCursors: [],
          nextCursor: cursor.page === 1 ? { ...cursor, page: 2 } : null,
          inspectedCount: candidates.length,
          pageKind: "search",
          progress: {
            apiRequestsCompleted: 1,
            searchPages: 1,
            searchTermsCompleted: cursor.page === 2 ? 1 : 0,
            answerBearingQuestionsQueued: 0,
            zeroAnswerQuestionsSkipped: 0,
          },
        },
        throttleNotices: [],
      });
      return;
    }
    expect(request).toEqual({
      action: "details",
      credentials: EXPECTED_CREDENTIALS,
      configuration,
      scanCompatibility: "current",
      jobFingerprint: fingerprint,
      refs: detailRefs,
    });
    fixture.detailRequests.push(request.refs as ReplacementItemRef[]);
    await fulfillJson(route, {
      ok: true,
      result: {
        proposals: detailRefs.map((ref) => proposalByKey.get(replacementItemKey(ref))),
        inspectedCount: detailRefs.length,
        protectedOccurrenceCount: 0,
      },
      throttleNotices: [],
    });
  });
  return fixture;
}

interface ExactTargetRouteFixture {
  inventoryRequests: Array<Record<string, unknown>>;
  detailRequests: ReplacementItemRef[][];
  detailRefs: ReplacementItemRef[];
  noWriteRequests: NoWriteRequests;
}

async function installExactTargetRoutes(page: Page): Promise<ExactTargetRouteFixture> {
  const importedRefs: ReplacementItemRef[] = [
    { kind: "question", questionId: 701 },
    { kind: "answer", questionId: 701, answerId: 702 },
    { kind: "article", articleId: 703 },
  ];
  const selection = await createExactTargetSelection(importedRefs);
  const detailRefs = selection.targets;
  const configuration: ReplacementConfiguration = {
    target: { kind: "enterprise-main" },
    contentTypes: { questions: true, answers: true, articles: true },
    discovery: selection.discovery,
    rules: [{ id: "manual-1", find: "LOCALEPSILON", replace: "LOCALZETA" }],
    options: { caseSensitive: true, wholeTerm: true, replaceInCode: false },
  };
  const models: ReplacementRequestModel[] = [
    {
      kind: "question", ref: importedRefs[0] as Extract<ReplacementItemRef, { kind: "question" }>,
      request: { title: "LOCALEPSILON question", body: "Local question body.", tags: ["local"] },
    },
    {
      kind: "answer", ref: importedRefs[1] as Extract<ReplacementItemRef, { kind: "answer" }>,
      request: { body: "LOCALEPSILON answer" },
    },
    {
      kind: "article", ref: importedRefs[2] as Extract<ReplacementItemRef, { kind: "article" }>,
      request: {
        title: "Local article", body: "LOCALEPSILON article", tags: ["local"], type: "knowledgeArticle",
        expirationDate: null,
        permissions: { editableBy: "specificEditors", editorUserIds: [2], editorUserGroupIds: [] },
      },
    },
  ];
  const modelByKey = new Map(models.map((model) => [replacementItemKey(model.ref), model]));
  const proposals = await Promise.all(detailRefs.map((ref, index) => buildReplacementProposal(
    modelByKey.get(replacementItemKey(ref))!,
    configuration,
    selection.proofs[index],
  )));
  if (proposals.some((proposal) => proposal === null)) throw new Error("Expected exact-target fixture proposals.");
  const fingerprint = await createJobFingerprint({ baseUrl: ENTERPRISE_URL, configuration, scanCompatibility: "current" });
  const fixture: ExactTargetRouteFixture = {
    inventoryRequests: [], detailRequests: [], detailRefs,
    noWriteRequests: await installNoWriteGuards(page),
  };

  await page.route("**/api/write-tools/content-replacement/scan", async (route) => {
    const request = route.request().postDataJSON() as Record<string, unknown>;
    if (request.action === "inventory") {
      fixture.inventoryRequests.push(request);
      throw new Error("Exact target discovery must not send inventory or search requests.");
    }
    expect(request).toEqual({
      action: "details",
      credentials: EXPECTED_CREDENTIALS,
      configuration,
      scanCompatibility: "current",
      jobFingerprint: fingerprint,
      refs: detailRefs,
      exactProofs: selection.proofs,
    });
    expect(request).not.toHaveProperty("exactTargets");
    fixture.detailRequests.push(request.refs as ReplacementItemRef[]);
    await fulfillJson(route, {
      ok: true,
      result: { proposals, inspectedCount: detailRefs.length, protectedOccurrenceCount: 0 },
      throttleNotices: [],
    });
  });
  return fixture;
}

interface FullAuditRouteFixture {
  inventoryKinds: string[];
  answerCollectionKinds: string[];
  blockedCursor: InventoryCursor | null;
  resumedCursor: InventoryCursor | null;
  noWriteRequests: NoWriteRequests;
  waitForBlockedCursor(): Promise<void>;
  releaseBlockedCursor(): void;
}

async function installFullAuditRoutes(page: Page): Promise<FullAuditRouteFixture> {
  const configuration: ReplacementConfiguration = {
    target: { kind: "enterprise-main" },
    contentTypes: { questions: true, answers: true, articles: false },
    discovery: { mode: "full" },
    rules: [{ id: "manual-1", find: "LOCALTHETA", replace: "LOCALOMEGA" }],
    options: { caseSensitive: true, wholeTerm: true, replaceInCode: false },
  };
  const fingerprint = await createJobFingerprint({ baseUrl: ENTERPRISE_URL, configuration, scanCompatibility: "current" });
  let releaseBlockedCursor!: () => void;
  let signalBlockedCursor!: () => void;
  const blockedCursorGate = new Promise<void>((resolve) => { releaseBlockedCursor = resolve; });
  const blockedCursorStarted = new Promise<void>((resolve) => { signalBlockedCursor = resolve; });
  let blockedOnce = false;
  const fixture: FullAuditRouteFixture = {
    inventoryKinds: [],
    answerCollectionKinds: [],
    blockedCursor: null,
    resumedCursor: null,
    noWriteRequests: await installNoWriteGuards(page),
    waitForBlockedCursor: () => blockedCursorStarted,
    releaseBlockedCursor,
  };
  const emptyProgress = {
    apiRequestsCompleted: 1,
    searchPages: 0,
    searchTermsCompleted: 0,
    answerBearingQuestionsQueued: 0,
    zeroAnswerQuestionsSkipped: 0,
  };
  const questionSummaries: Array<{ questionId: number; answerCount?: number }> = [
    { questionId: 801, answerCount: 0 },
    { questionId: 802, answerCount: 2 },
    { questionId: 803 },
  ];

  await page.route("**/api/write-tools/content-replacement/scan", async (route) => {
    const request = route.request().postDataJSON() as Record<string, unknown>;
    if (request.action !== "inventory") throw new Error("The Full-audit fixture should not request details.");
    const cursor = request.cursor as InventoryCursor;
    expect(request).toEqual({
      action: "inventory",
      credentials: EXPECTED_CREDENTIALS,
      configuration,
      scanCompatibility: "current",
      jobFingerprint: fingerprint,
      cursor,
    });
    fixture.inventoryKinds.push(cursorKey(cursor));
    if (cursor.kind === "questions" && cursor.page === 1) {
      await fulfillJson(route, {
        ok: true,
        result: {
          candidates: [],
          answerCursors: questionSummaries
            .filter((question) => question.answerCount !== 0)
            .map((question) => ({ kind: "answers" as const, questionId: question.questionId, page: 1 })),
          nextCursor: { kind: "questions", page: 2 },
          inspectedCount: 3,
          pageKind: "questions",
          progress: { ...emptyProgress, answerBearingQuestionsQueued: 2, zeroAnswerQuestionsSkipped: 1 },
        },
        throttleNotices: [],
      });
      return;
    }
    if (cursor.kind === "questions" && cursor.page === 2 && !blockedOnce) {
      blockedOnce = true;
      fixture.blockedCursor = cursor;
      signalBlockedCursor();
      await blockedCursorGate;
      await route.abort("failed").catch(() => undefined);
      return;
    }
    if (cursor.kind === "questions" && cursor.page === 2) fixture.resumedCursor = cursor;
    if (cursor.kind === "answers") fixture.answerCollectionKinds.push(cursorKey(cursor));
    await fulfillJson(route, {
      ok: true,
      result: {
        candidates: [], answerCursors: [], nextCursor: null, inspectedCount: 0,
        pageKind: cursor.kind, progress: emptyProgress,
      },
      throttleNotices: [],
    });
  });
  return fixture;
}

async function seedLegacyJobs(page: Page): Promise<void> {
  const paused = await createLegacyV1Job("paused-v1", false);
  const completed = await createLegacyV1Job("completed-v1", true);
  await page.goto("/");
  await openContentReplacement(page);
  await expect(page.getByText("No replacement jobs are stored in this browser.")).toBeVisible();
  await page.evaluate(async (records) => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("stack-api-content-replacement", 4);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
    try {
      const transaction = database.transaction("jobs", "readwrite");
      const store = transaction.objectStore("jobs");
      records.forEach((record) => store.put(record));
      await new Promise<void>((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error);
      });
    } finally {
      database.close();
    }
  }, [legacyRecord(paused), legacyRecord(completed)]);
}

async function createLegacyV1Job(id: string, completed: boolean): Promise<Record<string, any>> {
  const configuration: ReplacementConfiguration = {
    target: { kind: "enterprise-main" },
    contentTypes: { questions: true, answers: true, articles: true },
    discovery: { mode: "full" },
    rules: [{ id: "legacy-rule", find: "LOCALOLD", replace: "LOCALNEW" }],
    options: { caseSensitive: true, wholeTerm: true, replaceInCode: false },
  };
  const createdAt = "2026-09-01T12:00:00.000Z";
  const job = createReplacementJob({
    id,
    baseUrl: ENTERPRISE_URL,
    configuration,
    fingerprint: await createJobFingerprint({ baseUrl: ENTERPRISE_URL, configuration, scanCompatibility: "current" }),
    createdAt,
  });
  if (completed) {
    const proposal = await buildReplacementProposal({
      kind: "question",
      ref: { kind: "question", questionId: 901 },
      request: { title: "LOCALOLD legacy", body: "Local recovery fixture.", tags: ["local"] },
    }, configuration);
    if (!proposal) throw new Error("Expected a legacy recovery proposal.");
    const completedAt = "2026-09-01T12:02:00.000Z";
    job.stage = "results";
    job.status = "completed";
    job.inventoryQueue = [];
    job.detailQueue = [];
    job.proposals[replacementItemKey(proposal.before.ref)] = {
      proposal,
      included: true,
      attemptCount: 1,
      status: "applied",
      result: {
        kind: "applied",
        observedRequestChecksum: proposal.proposedRequestChecksum,
        completedAt,
      },
      recovery: {
        priorRequestModel: structuredClone(proposal.before),
        scannedRequestChecksum: proposal.scannedRequestChecksum,
        proposedRequestChecksum: proposal.proposedRequestChecksum,
        observedPostApplyChecksum: proposal.proposedRequestChecksum,
        status: "ready",
      },
    };
    job.recoverySnapshotStatus = "ready";
    job.progress.questionPages = 1;
    job.progress.inventoryItems = 1;
    job.progress.detailsInspected = 1;
    job.progress.proposalsFound = 1;
    job.progress.applyCompleted = 1;
    job.updatedAt = "2026-09-01T12:04:00.000Z";
  }
  return toLegacyV1(job);
}

async function toLegacyV1(job: PersistedContentReplacementJob): Promise<Record<string, any>> {
  const legacy = structuredClone(job) as Record<string, any>;
  legacy.schemaVersion = 1;
  delete legacy.scanCompatibility;
  delete legacy.configuration.discovery;
  for (const key of [
    "apiRequestsCompleted", "searchPages", "searchTermsCompleted", "indexedReferences",
    "answerBearingQuestionsQueued", "zeroAnswerQuestionsSkipped",
  ]) delete legacy.progress[key];
  legacy.fingerprint = await legacyDigest({
    baseUrl: legacy.baseUrl,
    configuration: legacySemanticConfiguration(legacy.configuration),
  });
  for (const item of Object.values(legacy.proposals) as Array<{ proposal: ReplacementProposal }>) {
    item.proposal.proposalFingerprint = await legacyDigest({
      ref: item.proposal.before.ref,
      configuration: legacySemanticConfiguration(legacy.configuration),
      scannedRequestChecksum: item.proposal.scannedRequestChecksum,
      proposedRequestChecksum: item.proposal.proposedRequestChecksum,
    });
  }
  return legacy;
}

function legacyRecord(job: Record<string, any>) {
  return {
    id: job.id,
    job,
    summary: {
      id: job.id,
      sortKey: `${String(8_640_000_000_000_000 - Date.parse(job.updatedAt)).padStart(16, "0")}:${job.id}`,
      baseUrl: job.baseUrl,
      stage: job.stage,
      status: job.status,
      mappingCount: job.configuration.rules.length,
      proposedPostCount: job.progress.proposalsFound,
      recoverySnapshotStatus: job.recoverySnapshotStatus,
      scanCompatibility: "legacy-restart-required",
      activeOperationKind: "none",
      updatedAt: job.updatedAt,
    },
  };
}

function legacySemanticConfiguration(configuration: Record<string, any>) {
  return {
    target: configuration.target,
    contentTypes: configuration.contentTypes,
    options: configuration.options,
    rules: configuration.rules
      .map(({ find, replace }: { find: string; replace: string }) => ({ find, replace }))
      .sort((left: { find: string; replace: string }, right: { find: string; replace: string }) =>
        left.find.localeCompare(right.find) || left.replace.localeCompare(right.replace)),
  };
}

async function legacyDigest(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(stableSerialize(value));
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function searchCursorKey(cursor: Extract<InventoryCursor, { kind: "search" }>) {
  return `search:${cursor.ruleId}:${cursor.page}`;
}

async function connectEnterpriseWriteCredentials(page: Page) {
  await page.route("**/api/oauth/pkce/config", (route) => fulfillJson(route, {
    ok: true, redirectUri: `${new URL(route.request().url()).origin}/api/oauth/pkce/callback`,
  }));
  await page.route("**/api/oauth/pkce/start", (route) => fulfillJson(route, {
    ok: true, authorizationUrl: `${new URL(route.request().url()).origin}/mock-oauth-complete`,
  }));
  await page.context().route("**/mock-oauth-complete", (route) => route.fulfill({
    status: 200,
    contentType: "text/html",
    body: `<script>window.opener.postMessage(${JSON.stringify({
      type: "stack-api-oauth-pkce-result",
      ok: true,
      credential: {
        instanceType: "enterprise", baseUrl: ENTERPRISE_URL, accessToken: "mock-write-token",
        authSource: "oauth-pkce", oauthClientId: "content-replacement-e2e", oauthScopes: ["write_access", "no_expiry"],
      },
    })}, window.location.origin); window.close();</script>`,
  }));

  await page.goto("/");
  await page.getByRole("button", { name: "Write Tools", exact: true }).click();
  await page.getByRole("button", { name: "Content Replacement", exact: true }).click();
  await page.getByRole("button", { name: "Credentials", exact: true }).click();
  await expect(page.getByLabel("Instance type")).toHaveValue("enterprise");
  await page.getByLabel("Instance URL").fill(ENTERPRISE_URL);
  await page.getByRole("textbox", { name: "API key" }).fill("mock-api-key");
  await page.getByLabel("OAuth Client ID").fill("content-replacement-e2e");
  const popupPromise = page.waitForEvent("popup");
  await page.getByRole("button", { name: "Connect with Enterprise OAuth" }).click();
  const popup = await popupPromise;
  await popup.waitForEvent("close");
  await expect(page.getByText("Credentials saved for this browser session.")).toBeVisible();
}

async function openContentReplacement(page: Page) {
  await page.getByRole("button", { name: "Write Tools", exact: true }).click();
  await page.getByRole("button", { name: "Content Replacement", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Content Replacement", level: 1 })).toBeVisible();
}

async function inspectIndexedDbStructuredClone(page: Page) {
  return page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("stack-api-content-replacement", 4);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
    const readAll = () => new Promise<any[]>((resolve, reject) => {
      const transaction = database.transaction("jobs", "readonly");
      const request = transaction.objectStore("jobs").getAll();
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
    try {
      const firstRecords = await readAll();
      if (firstRecords.length !== 1) throw new Error(`Expected one stored job, found ${firstRecords.length}.`);
      const first = firstRecords[0];
      first.job.status = "cancelled";
      const secondRecords = await readAll();
      const second = secondRecords[0];
      return {
        wrapperKeys: Object.keys(second).sort(),
        sameReference: first === second || first.job === second.job,
        mutationLeaked: second.job.status === "cancelled",
        durableStage: second.job.stage,
        durableStatus: second.job.status,
        proposalCount: Object.keys(second.job.proposals).length,
      };
    } finally {
      database.close();
    }
  });
}

function proposalEvidence(proposal: ReplacementProposal) {
  return {
    scannedRequestChecksum: proposal.scannedRequestChecksum,
    proposedRequestChecksum: proposal.proposedRequestChecksum,
    proposalFingerprint: proposal.proposalFingerprint,
  };
}

function cursorKey(cursor: InventoryCursor) {
  return cursor.kind === "answers" ? `answers:${cursor.questionId}:${cursor.page}` : `${cursor.kind}:${cursor.page}`;
}

function refKey(ref: ReplacementItemRef) {
  if (ref.kind === "question") return `question:${ref.questionId}`;
  if (ref.kind === "answer") return `answer:${ref.questionId}:${ref.answerId}`;
  return `article:${ref.articleId}`;
}

async function fulfillJson(route: Route, body: unknown) {
  await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
}
