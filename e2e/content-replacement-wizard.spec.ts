import { expect, test, type Page, type Route } from "@playwright/test";
import { buildReplacementProposal, toReplacementWireRequestModel } from "../src/writeTools/contentReplacement/proposals";
import type {
  InventoryCursor,
  ReplacementConfiguration,
  ReplacementItemRef,
  ReplacementProposal,
  ReplacementRequestModel,
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

test("reviews and safely applies a complete mocked content replacement job", async ({ page }) => {
  test.setTimeout(60_000);
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
  expect(fixture.scanRequests.filter((request) => request.action === "inventory")).toHaveLength(5);
  expect(fixture.inventoryKinds).toEqual(["questions:1", "articles:1", "questions:2", "answers:101:1", "articles:2"]);
  expect(fixture.scanRequests.filter((request) => request.action === "details")).toHaveLength(1);
  await expect(page.getByRole("status", { name: "Review results count" })).toHaveText("3 matching proposals");
  await expect(page.getByText("3 posts selected")).toBeVisible();
  await expect(page.getByRole("button", { name: "Continue with 3 posts and 5 changed occurrences" })).toBeVisible();

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

  await page.getByRole("button", { name: "Preview recovery for 1 post" }).click();
  const recoveryPreview = page.getByRole("region", { name: "Recovery preview", exact: true });
  await expect(recoveryPreview).toContainText("Question 101 recovery preview · Ready to recover");
  await expect(recoveryPreview).toContainText("Prior full request model to restore");
  await page.getByLabel(/I understand recovery writes the prior full request model/).check();
  await page.getByLabel("Type RECOVER to confirm").fill("RECOVER");
  await page.getByRole("button", { name: "Recover 1 post" }).click();

  await expect(resultSummary.getByText("Recovered").locator("..")).toContainText("1");
  await expect(results).toContainText("Recovered");

  const reviewedJobFingerprints = [...new Set(fixture.scanRequests.map((request) => request.jobFingerprint))];
  expect(reviewedJobFingerprints).toHaveLength(1);
  const reviewedJobFingerprint = reviewedJobFingerprints[0];
  expect(reviewedJobFingerprint).toMatch(/^[a-f0-9]{64}$/);
  expect(fixture.applyRequests).toHaveLength(2);
  expect(fixture.applyRequests.map((request) => request.itemRef)).toEqual([QUESTION_REF, ANSWER_REF]);
  for (const request of fixture.applyRequests) {
    const proposal = request.itemRef.kind === "question" ? fixture.question : fixture.answer;
    expect(Object.keys(request).sort()).toEqual([
      "configuration", "credentials", "expectedProposalFingerprint", "expectedProposedRequestChecksum",
      "expectedScannedRequestChecksum", "itemRef", "jobFingerprint",
    ]);
    expect(request).toMatchObject({
      configuration: EXPECTED_CONFIGURATION,
      jobFingerprint: reviewedJobFingerprint,
      itemRef: proposal.before.ref,
      expectedScannedRequestChecksum: proposal.scannedRequestChecksum,
      expectedProposedRequestChecksum: proposal.proposedRequestChecksum,
      expectedProposalFingerprint: proposal.proposalFingerprint,
    });
    expect(request).not.toHaveProperty("body");
    expect(request).not.toHaveProperty("request");
    expect(request).not.toHaveProperty("after");
    expect(request).not.toHaveProperty("proposedRequestModel");
  }

  expect(fixture.recoveryRequests).toHaveLength(2);
  expect(fixture.recoveryRequests.map((request) => request.action)).toEqual(["preview", "apply"]);
  for (const request of fixture.recoveryRequests) {
    expect(Object.keys(request).sort()).toEqual([
      "action", "credentials", "expectedPostApplyChecksum", "expectedPriorRequestChecksum",
      "itemRef", "jobFingerprint", "priorRequestModel",
    ]);
    expect(request).toMatchObject({
      jobFingerprint: reviewedJobFingerprint,
      itemRef: QUESTION_REF,
      priorRequestModel: toReplacementWireRequestModel(fixture.question.before),
      expectedPriorRequestChecksum: fixture.question.scannedRequestChecksum,
      expectedPostApplyChecksum: fixture.question.proposedRequestChecksum,
    });
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
    fixture.scanRequests.push(request);
    expect(request.configuration).toEqual(EXPECTED_CONFIGURATION);
    if (request.action === "inventory") {
      const cursor = request.cursor as InventoryCursor;
      fixture.inventoryKinds.push(cursorKey(cursor));
      if (cursor.kind === "questions" && cursor.page === 1) await initialInventoryGate;
      await fulfillJson(route, { ok: true, result: inventoryResult(cursor), throttleNotices: [] });
      return;
    }
    const refs = request.refs as ReplacementItemRef[];
    expect(refs).toEqual([QUESTION_REF, ARTICLE_REF, ANSWER_REF]);
    await fulfillJson(route, {
      ok: true,
      result: {
        proposals: refs.map((ref) => byKey.get(refKey(ref))),
        inspectedCount: refs.length,
        protectedOccurrenceCount: 2,
      },
      throttleNotices: [],
    });
  });

  await page.route("**/api/write-tools/content-replacement/apply", async (route) => {
    const request = route.request().postDataJSON() as Record<string, any>;
    fixture.applyRequests.push(request);
    const proposal = byKey.get(refKey(request.itemRef));
    if (!proposal) throw new Error("Apply requested an item outside the reviewed fixture.");
    const updated = request.itemRef.kind === "question";
    await fulfillJson(route, {
      ok: true,
      result: {
        status: updated ? "updated" : "stale",
        observedRequestChecksum: updated ? proposal.proposedRequestChecksum : "f".repeat(64),
      },
      throttleNotices: [],
    });
  });

  await page.route("**/api/write-tools/content-replacement/recover", async (route) => {
    const request = route.request().postDataJSON() as Record<string, any>;
    fixture.recoveryRequests.push(request);
    if (request.action === "preview") {
      await fulfillJson(route, {
        ok: true,
        result: {
          status: "recoverable",
          currentRequestModel: toReplacementWireRequestModel(question.after),
          priorRequestModel: toReplacementWireRequestModel(question.before),
          observedRequestChecksum: question.proposedRequestChecksum,
        },
        throttleNotices: [],
      });
      return;
    }
    await fulfillJson(route, {
      ok: true,
      result: { status: "recovered", observedRequestChecksum: question.scannedRequestChecksum },
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
    return { candidates: [], answerCursors: [], nextCursor: null, inspectedCount: 0, pageKind: "questions" };
  }
  if (cursor.kind === "answers") {
    return { candidates: [ANSWER_REF], answerCursors: [], nextCursor: null, inspectedCount: 1, pageKind: "answers" };
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
  await page.getByLabel("OAuth Client ID").fill("content-replacement-e2e");
  const popupPromise = page.waitForEvent("popup");
  await page.getByRole("button", { name: "Connect with Enterprise OAuth" }).click();
  const popup = await popupPromise;
  await popup.waitForEvent("close");
  await expect(page.getByText("Credentials saved for this browser session.")).toBeVisible();
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
