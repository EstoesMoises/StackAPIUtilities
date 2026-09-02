import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { SessionCredentials } from "../domain/types";
import type { ContentReplacementJobController } from "../hooks/useContentReplacementJob";
import type {
  PersistedContentReplacementItem,
  PersistedContentReplacementJob,
} from "../writeTools/contentReplacement/types";
import { ContentReplacementWizard } from "./ContentReplacementWizard";

const credentials: SessionCredentials = {
  instanceType: "enterprise",
  baseUrl: "https://example.stackenterprise.co",
  accessToken: "token",
  authSource: "oauth-pkce",
  oauthScopes: ["write_access"],
  accessTokenExpiresAt: "2099-01-01T00:00:00.000Z",
};

describe("ContentReplacementWizard", () => {
  it("renders a persistent ordered, non-bypassable step indicator", () => {
    render(<ContentReplacementWizard credentials={credentials} controller={controller(null)} />);

    const steps = screen.getByRole("list", { name: "Content replacement progress" });
    expect(steps).toHaveTextContent("Define");
    expect(steps).toHaveTextContent("Scan");
    expect(steps).toHaveTextContent("Review");
    expect(steps).toHaveTextContent("Apply");
    expect(screen.getByText("Define", { selector: "[aria-current='step']" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Scan" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Review" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Apply" })).not.toBeInTheDocument();
  });

  it("marks completed steps with text and does not expose Review prematurely", () => {
    const scanJob = job({ stage: "scan", status: "paused" });
    render(<ContentReplacementWizard credentials={credentials} controller={controller(scanJob)} />);

    expect(screen.getByText("Define").parentElement).toHaveTextContent("Complete");
    expect(screen.getByText("Scan", { selector: "[aria-current='step']" })).toBeVisible();
    expect(screen.queryByRole("heading", { name: "Review proposed changes" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Review/i })).not.toBeInTheDocument();
  });

  it("wires the reviewed Define configuration to one controller create-and-start sequence", async () => {
    const user = userEvent.setup();
    const jobController = controller(null);
    render(<ContentReplacementWizard credentials={credentials} controller={jobController} />);

    await user.type(screen.getByLabelText("Find term 1"), "MyPVM");
    await user.type(screen.getByLabelText("Replace term 1 with"), "MyPBM");
    await user.click(screen.getByRole("button", { name: "Review rules" }));
    await user.click(screen.getByRole("button", { name: "Start scan" }));

    expect(jobController.createJob).toHaveBeenCalledOnce();
    expect(jobController.startScan).toHaveBeenCalledOnce();
    expect(jobController.createJob).toHaveBeenCalledWith(expect.objectContaining({
      rules: [expect.objectContaining({ find: "MyPVM", replace: "MyPBM" })],
    }));
  });

  it("routes persisted Review and Apply stages to their complete screens", () => {
    const reviewController = controller(job({
      stage: "review",
      status: "completed",
      proposals: { "question:42": reviewItem() },
    }));
    const { rerender } = render(
      <ContentReplacementWizard credentials={credentials} controller={reviewController} />,
    );
    expect(screen.getByText("Review", { selector: "[aria-current='step']" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "Review proposed changes" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Download complete preview CSV" })).toBeVisible();
    expect(screen.queryByText(/Review controls are added in the next implementation stage/i)).not.toBeInTheDocument();

    rerender(
      <ContentReplacementWizard credentials={credentials} controller={controller(job({
        stage: "apply",
        status: "paused",
        recoverySnapshotStatus: "ready",
        proposals: { "question:42": applyItem() },
      }))} />,
    );
    expect(screen.getByText("Apply", { selector: "[aria-current='step']" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "Confirm reviewed changes" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Apply changes to 1 post" })).toBeDisabled();
    expect(screen.queryByText(/Apply controls are added in the next implementation stage/i)).not.toBeInTheDocument();
  });

  it("warns before leaving Review and creates a separate job for edited configuration", async () => {
    const user = userEvent.setup();
    const reviewController = controller(job({
      stage: "review",
      status: "completed",
      proposals: { "question:42": reviewItem() },
    }));
    render(<ContentReplacementWizard credentials={credentials} controller={reviewController} />);

    await user.click(screen.getByRole("button", { name: "Edit configuration" }));
    const warning = screen.getByRole("group", { name: "Confirm configuration edit" });
    expect(warning).toHaveTextContent(/invalidates this completed scan/i);
    expect(screen.getByRole("heading", { name: "Review proposed changes" })).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Keep reviewed proposals" }));
    await user.click(screen.getByRole("button", { name: "Edit configuration" }));
    await user.click(screen.getByRole("button", { name: "Create a new job" }));

    expect(reviewController.deleteJob).not.toHaveBeenCalled();
    expect(screen.getByRole("heading", { name: "Define replacements" })).toBeVisible();
    expect(screen.getByText("Define", { selector: "[aria-current='step']" })).toBeVisible();

    await user.type(screen.getByLabelText("Find term 1"), "New term");
    await user.type(screen.getByLabelText("Replace term 1 with"), "New value");
    await user.click(screen.getByRole("button", { name: "Review rules" }));
    await user.click(screen.getByRole("button", { name: "Start scan" }));
    expect(reviewController.createJob).toHaveBeenCalledWith(expect.objectContaining({
      rules: [expect.objectContaining({ find: "New term", replace: "New value" })],
    }));
  });

  it("continues from Review through the controller after an included proposal is present", async () => {
    const user = userEvent.setup();
    const jobController = controller(job({
      stage: "review",
      status: "completed",
      proposals: { "question:42": reviewItem() },
    }));
    render(<ContentReplacementWizard credentials={credentials} controller={jobController} />);

    await user.click(screen.getByRole("button", { name: "Continue with 1 post and 1 changed occurrence" }));

    expect(jobController.prepareApply).toHaveBeenCalledOnce();
  });

  it("uses the controller credential predicate to block scan creation", async () => {
    const user = userEvent.setup();
    const jobController = controller(null);
    const onReconnect = vi.fn();
    const expired = { ...credentials, accessTokenExpiresAt: "2020-01-01T00:00:00.000Z" };
    render(
      <ContentReplacementWizard
        credentials={expired}
        controller={jobController}
        now={new Date("2026-09-02T12:00:00.000Z")}
        onReconnect={onReconnect}
      />,
    );
    await user.type(screen.getByLabelText("Find term 1"), "MyPVM");
    await user.type(screen.getByLabelText("Replace term 1 with"), "MyPBM");
    await user.click(screen.getByRole("button", { name: "Review rules" }));

    expect(screen.getByText(/OAuth token has expired/i)).toBeVisible();
    expect(screen.getByRole("button", { name: "Start scan" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Reconnect credentials" }));
    expect(onReconnect).toHaveBeenCalledOnce();
    expect(jobController.createJob).not.toHaveBeenCalled();
    expect(jobController.startScan).not.toHaveBeenCalled();
  });

  it("surfaces controller failures in Define instead of silently no-oping", () => {
    const failedController = controller(null);
    failedController.operationError = "The content replacement job could not be created.";
    render(<ContentReplacementWizard credentials={credentials} controller={failedController} />);

    expect(screen.getByRole("alert", { name: "Scan setup error" })).toHaveTextContent(
      "The content replacement job could not be created.",
    );
  });

  it("allows a failed local save to be retried without starting the scan twice", async () => {
    const user = userEvent.setup();
    const failedController = controller(null);
    failedController.storageError = "Content replacement progress could not be saved.";
    vi.mocked(failedController.createJob).mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    render(<ContentReplacementWizard credentials={credentials} controller={failedController} />);
    await user.type(screen.getByLabelText("Find term 1"), "MyPVM");
    await user.type(screen.getByLabelText("Replace term 1 with"), "MyPBM");
    await user.click(screen.getByRole("button", { name: "Review rules" }));

    const retry = screen.getByRole("button", { name: "Save job and start scan" });
    expect(retry).toBeEnabled();
    await user.click(retry);
    expect(failedController.startScan).not.toHaveBeenCalled();
    await user.click(retry);
    expect(failedController.createJob).toHaveBeenCalledTimes(2);
    expect(failedController.startScan).toHaveBeenCalledOnce();
  });
});

function controller(currentJob: PersistedContentReplacementJob | null): ContentReplacementJobController {
  return {
    job: currentJob,
    busy: false,
    storageError: null,
    operationError: null,
    credentialReadiness: { valid: true, refreshRequired: false, message: "" },
    createJob: vi.fn().mockResolvedValue(true),
    startScan: vi.fn().mockResolvedValue(undefined),
    pause: vi.fn(),
    resume: vi.fn(),
    cancel: vi.fn(),
    deleteJob: vi.fn(),
    deleteRecoverySnapshots: vi.fn(),
    setItemIncluded: vi.fn().mockResolvedValue(true),
    setItemsIncluded: vi.fn().mockResolvedValue(true),
    prepareApply: vi.fn(),
    startApply: vi.fn(),
    retryEligibleFailures: vi.fn(),
    rescanStaleItems: vi.fn(),
    prepareRecovery: vi.fn(),
    startRecovery: vi.fn(),
  };
}

function job(overrides: Partial<PersistedContentReplacementJob>): PersistedContentReplacementJob {
  return {
    schemaVersion: 1,
    revision: 0,
    id: "job-1",
    fingerprint: "f".repeat(64),
    baseUrl: credentials.baseUrl,
    target: { kind: "enterprise-main" },
    configuration: {
      target: { kind: "enterprise-main" },
      contentTypes: { questions: true, answers: true, articles: true },
      rules: [{ id: "one", find: "MyPVM", replace: "MyPBM" }],
      options: { caseSensitive: true, wholeTerm: true, replaceInCode: false },
    },
    stage: "scan",
    status: "paused",
    inventoryQueue: [{ kind: "questions", page: 1 }],
    detailQueue: [],
    progress: {
      questionPages: 0,
      answerPages: 0,
      articlePages: 0,
      inventoryItems: 0,
      detailsInspected: 0,
      proposalsFound: 0,
      protectedOccurrences: 0,
      applyCompleted: 0,
      recoveryCompleted: 0,
    },
    proposals: {},
    recoverySnapshotStatus: "none",
    createdAt: "2026-09-02T12:00:00.000Z",
    updatedAt: "2026-09-02T12:00:00.000Z",
    ...overrides,
  };
}

function reviewItem(): PersistedContentReplacementItem {
  const ref = { kind: "question" as const, questionId: 42 };
  const beforeRequest = { title: "Use MyPVM", body: "Use MyPVM.", tags: ["test"] };
  const afterRequest = { ...beforeRequest, title: "Use MyPBM", body: "Use MyPBM." };
  return {
    included: true,
    attemptCount: 0,
    status: "pending",
    proposal: {
      before: { kind: "question", ref, request: beforeRequest },
      after: { kind: "question", ref, request: afterRequest },
      fields: {
        title: { beforeMarkdown: beforeRequest.title, afterMarkdown: afterRequest.title },
        body: { beforeMarkdown: beforeRequest.body, afterMarkdown: afterRequest.body },
      },
      changedOccurrences: [{
        field: "title", ruleId: "one", start: 4, end: 9, before: "MyPVM", after: "MyPBM",
      }],
      protectedOccurrences: [],
      appliedRuleIds: ["one"],
      scannedRequestChecksum: "a".repeat(64),
      proposedRequestChecksum: "b".repeat(64),
      proposalFingerprint: "c".repeat(64),
    },
  };
}

function applyItem(): PersistedContentReplacementItem {
  const item = reviewItem();
  return {
    ...item,
    status: "ready-to-apply",
    recovery: {
      priorRequestModel: item.proposal.before,
      scannedRequestChecksum: item.proposal.scannedRequestChecksum,
      proposedRequestChecksum: item.proposal.proposedRequestChecksum,
      status: "ready",
    },
  };
}
