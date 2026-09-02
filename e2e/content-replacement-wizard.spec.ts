import { readFile } from "node:fs/promises";
import { expect, test, type Page, type Route } from "@playwright/test";
import { buildReplacementProposal } from "../src/writeTools/contentReplacement/proposals";
import type {
  InventoryCursor,
  ReplacementConfiguration,
  ReplacementItemRef,
  ReplacementProposal,
  ReplacementRequestModel,
  ReplacementWireRequestModel,
} from "../src/writeTools/contentReplacement/types";

const ENTERPRISE_URL = "https://demo.stackenterprise.co";
const EXPECTED_CONFIGURATION: ReplacementConfiguration = {
  target: { kind: "enterprise-main" },
  contentTypes: { questions: true, answers: true, articles: true },
  rules: [
    { id: "manual-1", find: "MyPVM", replace: "MyPBM" },
    { id: "csv-1-2", find: "CPR", replace: "myBenefitPlans", sourceRow: 2 },
  ],
  options: { caseSensitive: true, wholeTerm: true, replaceInCode: false },
};
const QUESTION_REF = { kind: "question", questionId: 101 } as const;
const ANSWER_REF = { kind: "answer", questionId: 101, answerId: 201 } as const;
const ARTICLE_REF = { kind: "article", articleId: 301 } as const;
const SECOND_QUESTION_REF = { kind: "question", questionId: 102 } as const;
const EXPECTED_JOB_FINGERPRINT = "34b20a8de5a338a5de736a65e37032d6ba338bb59df46855a1001121d5c12078";
const EXPECTED_CREDENTIALS = {
  instanceType: "enterprise",
  baseUrl: ENTERPRISE_URL,
  apiKey: "mock-api-key",
  accessToken: "mock-write-token",
  authSource: "oauth-pkce",
  oauthClientId: "content-replacement-e2e",
  oauthScopes: ["write_access", "no_expiry"],
};
const EXPECTED_PROPOSAL_EVIDENCE = {
  question: {
    scannedRequestChecksum: "fffc83bfe44b955edee902857ca478643472c5f2fb094cb8762d715f8b47ee23",
    proposedRequestChecksum: "6169dd257ea7d78fcc595fbd4066353c4a9a86b194926a8d47c1c06254d6e89a",
    proposalFingerprint: "d7c2f449db4a3443621951f9bba205b709a2f73bd0f33034b9cdab3c9096ea3f",
  },
  answer: {
    scannedRequestChecksum: "d219bfb024f4ee355f417cd664a58b3d9104ea30aa728139c2d454306a6f6f87",
    proposedRequestChecksum: "f8dff9143bddeb38dad29defabc70c8746c928289c60025294e650f8eb5f619f",
    proposalFingerprint: "be158ffd6a6a9069b680eabb3313b7a678d28fb4e51c947945d06ea5c8a9cc49",
  },
  article: {
    scannedRequestChecksum: "0701ffb2bf4dbf0ddaf2ccce7dc1c145cd11c5074a1a796362379b0977c523b0",
    proposedRequestChecksum: "30bedec8ecf548920366f252eab0d5abbe9b3f0883beb04ebbf67ff80a3b9ee0",
    proposalFingerprint: "1596335b38bd50e6130e714e4d1ae4afd5b1e95d7a445cd59a3c70102f79aecd",
  },
} as const;
const QUESTION_PRIOR_REQUEST_MODEL: ReplacementWireRequestModel = {
  kind: "question",
  ref: QUESTION_REF,
  request: {
    title: "MyPVM migration",
    body: "Replace MyPVM here. Keep `MyPVM`.",
    tags: ["benefits", "migration"],
  },
};
const QUESTION_PRIOR_DISPLAY_MODEL: ReplacementRequestModel = {
  ...QUESTION_PRIOR_REQUEST_MODEL,
  metadata: {
    webUrl: `${ENTERPRISE_URL}/questions/101/my-pvm-migration`,
    owner: { id: 11, name: "Question Owner" },
    lastEditor: { id: 12, name: "Question Editor" },
    lastActivityDate: "2026-09-01T15:00:00.000Z",
  },
};
const QUESTION_CURRENT_REQUEST_MODEL: ReplacementWireRequestModel = {
  kind: "question",
  ref: QUESTION_REF,
  request: {
    title: "MyPBM migration",
    body: "Replace MyPBM here. Keep `MyPVM`.",
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
  "contentType", "itemId", "questionId", "title", "webUrl", "status", "outcome", "attemptCount",
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

  await page.getByLabel("Find term 1").fill("MyPVM");
  await page.getByLabel("Replace term 1 with").fill("MyPBM");
  await page.getByLabel("Import replacement CSV").setInputFiles({
    name: "additional-rule.csv",
    mimeType: "text/csv",
    buffer: Buffer.from("find,replace\nCPR,myBenefitPlans\n"),
  });
  await page.getByRole("button", { name: "Append imported rows" }).click();
  await expect(page.getByLabel("Find term 2")).toHaveValue("CPR");
  await expect(page.getByLabel("Replace term 2 with")).toHaveValue("myBenefitPlans");

  await page.getByRole("button", { name: "Review rules" }).click();
  const checkpoint = page.locator('[aria-label="Reviewed rule summary"]');
  await expect(checkpoint).toContainText("MyPVM → MyPBM");
  await expect(checkpoint).toContainText("CPR → myBenefitPlans");
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
  await expect(questionDetail.getByTestId("question-101-title-before")).toHaveText("MyPVM migration");
  await expect(questionDetail.getByTestId("question-101-title-after")).toHaveText("MyPBM migration");
  await expect(questionDetail.getByTestId("question-101-body-before")).toHaveText("Replace MyPVM here. Keep `MyPVM`.");
  await expect(questionDetail.getByTestId("question-101-body-after")).toHaveText("Replace MyPBM here. Keep `MyPVM`.");
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
      contentType: "question", itemId: "101", questionId: "", title: "MyPVM migration",
      webUrl: `${ENTERPRISE_URL}/questions/101/my-pvm-migration`, status: "applied", outcome: "applied",
      attemptCount: "1", changedOccurrences: "2", protectedOccurrences: "1",
      observedRequestChecksum: EXPECTED_PROPOSAL_EVIDENCE.question.proposedRequestChecksum,
    },
    {
      contentType: "answer", itemId: "201", questionId: "101", title: "MyPVM migration", webUrl: "",
      status: "stale", outcome: "stale",
      attemptCount: "1", changedOccurrences: "1", protectedOccurrences: "0", observedRequestChecksum: "",
    },
    {
      contentType: "article", itemId: "301", questionId: "", title: "CPR guide", webUrl: "",
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
    EXPECTED_PROPOSAL_EVIDENCE.question.proposedRequestChecksum,
  );
  await expect(recoveryPreview.locator("dt", { hasText: "Expected successful apply checksum" }).locator("+ dd code")).toHaveText(
    EXPECTED_PROPOSAL_EVIDENCE.question.proposedRequestChecksum,
  );
  await page.getByLabel(/I understand recovery writes the prior full request model/).check();
  await page.getByLabel("Type RECOVER to confirm").fill("RECOVER");
  await page.getByRole("button", { name: "Recover 1 post" }).click();

  await expect(resultSummary.getByText("Recovered").locator("..")).toContainText("1");
  await expect(results).toContainText("Recovered");

  expect([...new Set(fixture.scanRequests.map((request) => request.jobFingerprint))]).toEqual([
    EXPECTED_JOB_FINGERPRINT,
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

interface RouteFixture {
  question: ReplacementProposal;
  answer: ReplacementProposal;
  article: ReplacementProposal;
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
  expect(proposalEvidence(question)).toEqual(EXPECTED_PROPOSAL_EVIDENCE.question);
  expect(proposalEvidence(answer)).toEqual(EXPECTED_PROPOSAL_EVIDENCE.answer);
  expect(proposalEvidence(article)).toEqual(EXPECTED_PROPOSAL_EVIDENCE.article);
  const byKey = new Map([
    [refKey(QUESTION_REF), question],
    [refKey(ANSWER_REF), answer],
    [refKey(ARTICLE_REF), article],
  ]);
  let releaseInitialInventory!: () => void;
  const initialInventoryGate = new Promise<void>((resolve) => { releaseInitialInventory = resolve; });
  const fixture: RouteFixture = {
    question, answer, article, scanRequests: [], inventoryKinds: [], applyRequests: [], recoveryRequests: [],
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
        jobFingerprint: EXPECTED_JOB_FINGERPRINT,
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
      jobFingerprint: EXPECTED_JOB_FINGERPRINT,
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
    const evidence = itemRef?.kind === "question"
      ? EXPECTED_PROPOSAL_EVIDENCE.question
      : EXPECTED_PROPOSAL_EVIDENCE.answer;
    expect(request).toEqual({
      credentials: EXPECTED_CREDENTIALS,
      configuration: EXPECTED_CONFIGURATION,
      jobFingerprint: EXPECTED_JOB_FINGERPRINT,
      itemRef,
      expectedScannedRequestChecksum: evidence.scannedRequestChecksum,
      expectedProposedRequestChecksum: evidence.proposedRequestChecksum,
      expectedProposalFingerprint: evidence.proposalFingerprint,
    });
    fixture.applyRequests.push(request);
    const updated = itemRef?.kind === "question";
    await fulfillJson(route, {
      ok: true,
      result: {
        status: updated ? "updated" : "stale",
        observedRequestChecksum: updated ? EXPECTED_PROPOSAL_EVIDENCE.question.proposedRequestChecksum : "f".repeat(64),
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
      jobFingerprint: EXPECTED_JOB_FINGERPRINT,
      itemRef: QUESTION_REF,
      priorRequestModel: QUESTION_PRIOR_REQUEST_MODEL,
      expectedPriorRequestChecksum: EXPECTED_PROPOSAL_EVIDENCE.question.scannedRequestChecksum,
      expectedPostApplyChecksum: EXPECTED_PROPOSAL_EVIDENCE.question.proposedRequestChecksum,
    });
    fixture.recoveryRequests.push(request);
    if (request.action === "preview") {
      await fulfillJson(route, {
        ok: true,
        result: {
          status: "recoverable",
          currentRequestModel: QUESTION_CURRENT_REQUEST_MODEL,
          priorRequestModel: QUESTION_PRIOR_REQUEST_MODEL,
          observedRequestChecksum: EXPECTED_PROPOSAL_EVIDENCE.question.proposedRequestChecksum,
        },
        throttleNotices: [],
      });
      return;
    }
    await fulfillJson(route, {
      ok: true,
      result: { status: "recovered", observedRequestChecksum: EXPECTED_PROPOSAL_EVIDENCE.question.scannedRequestChecksum },
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
      request: { title: "MyPVM migration", body: "Replace MyPVM here. Keep `MyPVM`.", tags: ["benefits", "migration"] },
      metadata: {
        owner: { id: 11, name: "Question Owner" },
        lastEditor: { id: 12, name: "Question Editor" },
        lastActivityDate: "2026-09-01T15:00:00.000Z",
        webUrl: `${ENTERPRISE_URL}/questions/101/my-pvm-migration`,
      },
    },
    {
      kind: "answer", ref: ANSWER_REF, request: { body: "MyPVM answer." },
      metadata: { titleContext: "MyPVM migration", owner: { id: 21, name: "Answer Owner" } },
    },
    {
      kind: "article",
      ref: ARTICLE_REF,
      request: {
        title: "CPR guide", body: "CPR details. Keep `CPR`.", tags: ["benefits"],
        type: "knowledgeArticle", expirationDate: null,
        permissions: { editableBy: "specificEditors", editorUserIds: [31], editorUserGroupIds: [41] },
      },
      metadata: { owner: { id: 31, name: "Article Owner" } },
    },
  ];
}

function inventoryResult(cursor: InventoryCursor) {
  if (cursor.kind === "questions" && cursor.page === 1) {
    return {
      candidates: [QUESTION_REF], answerCursors: [{ kind: "answers", questionId: 101, page: 1 }],
      nextCursor: { kind: "questions", page: 2 }, inspectedCount: 1, pageKind: "questions",
    };
  }
  if (cursor.kind === "questions") {
    return {
      candidates: [SECOND_QUESTION_REF],
      answerCursors: [{ kind: "answers", questionId: 102, page: 1 }],
      nextCursor: null,
      inspectedCount: 1,
      pageKind: "questions",
    };
  }
  if (cursor.kind === "answers") {
    if (cursor.questionId === 101 && cursor.page === 1) {
      return {
        candidates: [ANSWER_REF], answerCursors: [],
        nextCursor: { kind: "answers", questionId: 101, page: 2 },
        inspectedCount: 1, pageKind: "answers",
      };
    }
    return { candidates: [], answerCursors: [], nextCursor: null, inspectedCount: 0, pageKind: "answers" };
  }
  if (cursor.page === 1) {
    return {
      candidates: [ARTICLE_REF], answerCursors: [], nextCursor: { kind: "articles", page: 2 },
      inspectedCount: 1, pageKind: "articles",
    };
  }
  return { candidates: [], answerCursors: [], nextCursor: null, inspectedCount: 0, pageKind: "articles" };
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

async function inspectIndexedDbStructuredClone(page: Page) {
  return page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("stack-api-content-replacement", 2);
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
