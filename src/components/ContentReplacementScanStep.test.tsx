import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { SessionCredentials } from "../domain/types";
import type { ContentReplacementJobController } from "../hooks/useContentReplacementJob";
import type { PersistedContentReplacementJob } from "../writeTools/contentReplacement/types";
import { ContentReplacementScanStep } from "./ContentReplacementScanStep";

const validCredentials: SessionCredentials = {
  instanceType: "enterprise",
  baseUrl: "https://example.stackenterprise.co",
  accessToken: "oauth-token",
  authSource: "oauth-pkce",
  oauthScopes: ["write_access"],
  accessTokenExpiresAt: "2099-01-01T00:00:00.000Z",
};

describe("ContentReplacementScanStep", () => {
  it("shows real scan counters and active controls in a live status region", () => {
    const controller = createController(createJob());
    render(<ContentReplacementScanStep controller={controller} credentials={validCredentials} />);

    expect(screen.getByRole("status")).toHaveAttribute("aria-live", "polite");
    expect(screen.getByRole("status")).toHaveTextContent("Scan running");
    expect(screen.getByText("Question pages").nextElementSibling).toHaveTextContent("3");
    expect(screen.getByText("Answer collections").nextElementSibling).toHaveTextContent("8");
    expect(screen.getByText("Article pages").nextElementSibling).toHaveTextContent("2");
    expect(screen.getByText("Candidate details inspected").nextElementSibling).toHaveTextContent("31");
    expect(screen.getByText("Proposed posts").nextElementSibling).toHaveTextContent("12");
    expect(screen.getByText("Protected occurrences").nextElementSibling).toHaveTextContent("5");
    expect(screen.getByRole("button", { name: "Pause scan" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Cancel scan" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: /Review/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/exhaustive inventory.*finished/i)).not.toBeInTheDocument();
  });

  it("uses inline confirmation before cancelling active work", async () => {
    const user = userEvent.setup();
    const controller = createController(createJob());
    render(<ContentReplacementScanStep controller={controller} credentials={validCredentials} />);

    await user.click(screen.getByRole("button", { name: "Cancel scan" }));
    expect(screen.getByRole("group", { name: "Confirm scan cancellation" })).toBeVisible();
    expect(controller.cancel).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Keep scanning" }));
    expect(screen.queryByRole("group", { name: "Confirm scan cancellation" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Cancel scan" }));
    await user.click(screen.getByRole("button", { name: "Confirm cancel scan" }));
    expect(controller.pause).toHaveBeenCalledOnce();
    expect(controller.cancel).toHaveBeenCalledOnce();
  });

  it("shows Resume only when matching write credentials are valid", () => {
    const paused = createJob({ status: "paused" });
    const validController = createController(paused);
    const { rerender } = render(
      <ContentReplacementScanStep controller={validController} credentials={validCredentials} />,
    );
    expect(screen.getByRole("button", { name: "Resume scan" })).toBeEnabled();

    const expired = { ...validCredentials, accessTokenExpiresAt: "2020-01-01T00:00:00.000Z" };
    const onReconnect = vi.fn();
    rerender(
      <ContentReplacementScanStep controller={validController} credentials={expired} onReconnect={onReconnect} />,
    );
    expect(screen.queryByRole("button", { name: "Resume scan" })).not.toBeInTheDocument();
    expect(screen.getByText(/Credential reconnection required/i)).toBeVisible();
    expect(screen.getByText(/OAuth token has expired/i)).toBeVisible();
    expect(screen.getByRole("button", { name: "Reconnect credentials" })).toBeEnabled();
  });

  it("does not treat the same rejected credential as reconnected", () => {
    const paused = createJob({
      status: "paused",
      operationError: {
        category: "authorization",
        retryable: true,
        message: "Stack Enterprise credentials were rejected.",
        occurredAt: "2026-09-02T12:00:00.000Z",
      },
    });
    const controller = createController(paused);
    controller.credentialReadiness = {
      valid: false,
      refreshRequired: true,
      message: "Reconnect with a different valid credential; the current credential was rejected.",
    };
    const { rerender } = render(
      <ContentReplacementScanStep controller={controller} credentials={validCredentials} />,
    );
    expect(screen.getByRole("status")).toHaveTextContent("Credential reconnection required");
    expect(screen.queryByRole("button", { name: "Resume scan" })).not.toBeInTheDocument();

    controller.credentialReadiness = { valid: true, refreshRequired: false, message: "" };
    rerender(
      <ContentReplacementScanStep
        controller={controller}
        credentials={{ ...validCredentials, accessToken: "fresh-token" }}
      />,
    );
    expect(screen.getByRole("button", { name: "Resume scan" })).toBeEnabled();
  });

  it("reports rate-limit backoff with a localized absolute retry time", () => {
    const nextRetryAt = "2026-09-02T15:30:00.000Z";
    const controller = createController(createJob({ nextRetryAt }));
    render(<ContentReplacementScanStep controller={controller} credentials={validCredentials} />);

    expect(screen.getByRole("status")).toHaveTextContent("Rate-limit backoff");
    expect(screen.getByRole("status")).toHaveTextContent(
      new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "long" }).format(new Date(nextRetryAt)),
    );
  });

  it("makes storage and inventory failures explicit blockers", () => {
    const controller = createController(createJob());
    controller.storageError = "Content replacement progress could not be saved.";
    const { rerender } = render(
      <ContentReplacementScanStep controller={controller} credentials={validCredentials} />,
    );
    expect(screen.getByRole("status")).toHaveTextContent("Storage failure");
    expect(screen.getByText(/Review is blocked until progress can be saved/i)).toBeVisible();
    expect(screen.queryByRole("button", { name: /Review/i })).not.toBeInTheDocument();

    const failedJob = createJob({
      status: "failed",
      failure: {
        category: "server",
        message: "Question inventory failed.",
        retryable: true,
        occurredAt: "2026-09-02T12:00:00.000Z",
      },
    });
    rerender(
      <ContentReplacementScanStep controller={createController(failedJob)} credentials={validCredentials} />,
    );
    expect(screen.getByRole("status")).toHaveTextContent("Scan interrupted");
    expect(screen.getByText(/Review remains blocked until the scan finishes/i)).toBeVisible();
    expect(screen.queryByText(/Scan complete/i)).not.toBeInTheDocument();
  });

  it("announces completion only for a completed review-stage job", () => {
    const completed = createJob({
      stage: "review",
      status: "completed",
      inventoryQueue: [],
      detailQueue: [],
    });
    render(<ContentReplacementScanStep controller={createController(completed)} credentials={validCredentials} />);

    expect(screen.getByRole("status")).toHaveTextContent("Scan complete");
    expect(screen.getByText(/Exhaustive inventory and candidate inspection finished/i)).toBeVisible();
  });

  it("offers retry only for retryable failures and never exposes Review", async () => {
    const user = userEvent.setup();
    const retryable = createController(createJob({
      status: "failed",
      failure: {
        category: "network",
        message: "The scan request lost its connection.",
        retryable: true,
        occurredAt: "2026-09-02T12:00:00.000Z",
      },
    }));
    const { rerender } = render(
      <ContentReplacementScanStep controller={retryable} credentials={validCredentials} />,
    );
    expect(screen.getByRole("button", { name: "Retry scan" })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "Retry scan" }));
    expect(retryable.resume).toHaveBeenCalledOnce();
    expect(screen.queryByRole("button", { name: /Review/i })).not.toBeInTheDocument();

    const blocking = createController(createJob({
      status: "failed",
      failure: {
        category: "validation",
        message: "The inventory response was invalid.",
        retryable: false,
        occurredAt: "2026-09-02T12:00:00.000Z",
      },
    }));
    rerender(<ContentReplacementScanStep controller={blocking} credentials={validCredentials} />);
    expect(screen.queryByRole("button", { name: "Retry scan" })).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Inventory scan failed");
  });

  it("prioritizes authorization recovery and enables resume only after reconnection", () => {
    const authorization = createController(createJob({
      status: "failed",
      failure: {
        category: "authorization",
        message: "Stack Enterprise rejected the token.",
        retryable: true,
        occurredAt: "2026-09-02T12:00:00.000Z",
      },
    }));
    const expired = { ...validCredentials, accessTokenExpiresAt: "2020-01-01T00:00:00.000Z" };
    const { rerender } = render(
      <ContentReplacementScanStep controller={authorization} credentials={expired} onReconnect={vi.fn()} />,
    );
    expect(screen.getByRole("status")).toHaveTextContent("Credential reconnection required");
    expect(screen.queryByRole("button", { name: /Resume|Retry/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reconnect credentials" })).toBeEnabled();

    rerender(
      <ContentReplacementScanStep controller={authorization} credentials={validCredentials} onReconnect={vi.fn()} />,
    );
    expect(screen.getByRole("status")).toHaveTextContent("Credentials reconnected");
    expect(screen.getByRole("button", { name: "Resume scan" })).toBeEnabled();
  });

  it("shows the persisted configuration and labels unsafe matching modes", () => {
    const unsafe = createJob({
      configuration: {
        target: { kind: "enterprise-main" },
        contentTypes: { questions: true, answers: false, articles: true },
        discovery: { mode: "full" },
        rules: [
          { id: "one", find: "MyPVM", replace: "MyPBM" },
          { id: "two", find: "CPR", replace: "Benefits" },
        ],
        options: { caseSensitive: false, wholeTerm: false, replaceInCode: true },
      },
    });
    render(<ContentReplacementScanStep controller={createController(unsafe)} credentials={validCredentials} />);

    const summary = screen.getByRole("group", { name: "Scan configuration" });
    expect(summary).toHaveTextContent("Questions, Articles");
    expect(summary).toHaveTextContent("2 mappings");
    expect(summary).toHaveTextContent("MyPVM → MyPBM");
    expect(summary).toHaveTextContent("CPR → Benefits");
    expect(summary).toHaveTextContent(/Case-insensitive matching/i);
    expect(summary).toHaveTextContent(/Partial matching/i);
    expect(summary).toHaveTextContent(/Code included/i);
    expect(summary).toHaveTextContent(/destinations and raw HTML attributes remain protected/i);
    expect(screen.getByText(/Unsafe matching options are active/i)).toBeVisible();
  });
});

function createController(job: PersistedContentReplacementJob): ContentReplacementJobController {
  return {
    job,
    busy: false,
    rehydrating: false,
    storageError: null,
    operationError: null,
    credentialReadiness: { valid: true, refreshRequired: false, message: "" },
    createJob: vi.fn(),
    startScan: vi.fn(),
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

function createJob(
  overrides: Partial<PersistedContentReplacementJob> = {},
): PersistedContentReplacementJob {
  return {
    schemaVersion: 2,
    scanCompatibility: "current",
    revision: 0,
    id: "job-1",
    fingerprint: "f".repeat(64),
    baseUrl: "https://example.stackenterprise.co",
    target: { kind: "enterprise-main" },
    configuration: {
      target: { kind: "enterprise-main" },
      contentTypes: { questions: true, answers: true, articles: true },
      discovery: { mode: "full" },
      rules: [{ id: "rule-1", find: "MyPVM", replace: "MyPBM" }],
      options: { caseSensitive: true, wholeTerm: true, replaceInCode: false },
    },
    stage: "scan",
    status: "running",
    inventoryQueue: [{ kind: "questions", page: 4 }],
    detailQueue: [{ kind: "question", questionId: 1 }],
    progress: {
      apiRequestsCompleted: 0,
      questionPages: 3,
      answerPages: 8,
      articlePages: 2,
      searchPages: 0,
      searchTermsCompleted: 0,
      indexedReferences: 0,
      answerBearingQuestionsQueued: 0,
      zeroAnswerQuestionsSkipped: 0,
      inventoryItems: 200,
      detailsInspected: 31,
      proposalsFound: 12,
      protectedOccurrences: 5,
      applyCompleted: 0,
      recoveryCompleted: 0,
    },
    proposals: {},
    recoverySnapshotStatus: "none",
    createdAt: "2026-09-02T12:00:00.000Z",
    updatedAt: "2026-09-02T12:01:00.000Z",
    ...overrides,
  };
}
