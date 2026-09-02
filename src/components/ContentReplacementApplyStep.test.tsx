import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ContentReplacementJobController } from "../hooks/useContentReplacementJob";
import type {
  PersistedContentReplacementFailure,
  PersistedContentReplacementItem,
  PersistedContentReplacementItemStatus,
  PersistedContentReplacementJob,
  ReplacementContentKind,
  ReplacementRequestModel,
  ReplacementWireRequestModel,
} from "../writeTools/contentReplacement/types";
import { ContentReplacementApplyStep } from "./ContentReplacementApplyStep";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ContentReplacementApplyStep", () => {
  it("requires persisted recovery readiness, acknowledgement, and exact uppercase APPLY before writes", async () => {
    const user = userEvent.setup();
    const readyController = controller(applyJob());
    const { rerender } = render(<ContentReplacementApplyStep controller={readyController} />);

    expect(screen.getByText("example.stackenterprise.co")).toBeVisible();
    expect(screen.getByText("Questions, Answers, Articles")).toBeVisible();
    expect(screen.getByText("MyPVM → MyPBM")).toBeVisible();
    expect(screen.getByText("3 posts selected · 4 changed occurrences · 2 protected occurrences")).toBeVisible();
    expect(screen.getByText(/small race remains between the final checksum read and PUT/i)).toBeVisible();
    expect(screen.getByText(/Complete recovery snapshots are saved for all 3 selected posts/i)).toBeVisible();

    const apply = screen.getByRole("button", { name: "Apply changes to 3 posts" });
    expect(apply).toBeDisabled();
    await user.click(screen.getByLabelText(/I understand these edits use the live Enterprise API/i));
    await user.type(screen.getByLabelText("Type APPLY to confirm"), "apply");
    expect(apply).toBeDisabled();
    await user.clear(screen.getByLabelText("Type APPLY to confirm"));
    await user.type(screen.getByLabelText("Type APPLY to confirm"), "APPLY");
    expect(apply).toBeEnabled();
    await user.click(apply);
    expect(readyController.startApply).toHaveBeenCalledOnce();

    const unreadyController = controller(applyJob({ recoverySnapshotStatus: "failed" }));
    rerender(<ContentReplacementApplyStep controller={unreadyController} />);
    expect(screen.getByText(/Recovery snapshots are not ready/i)).toBeVisible();
    expect(screen.getByRole("button", { name: "Apply changes to 3 posts" })).toBeDisabled();
  });

  it("clears apply confirmation when the persisted selection or configuration changes", async () => {
    const user = userEvent.setup();
    const initial = applyJob();
    const { rerender } = render(<ContentReplacementApplyStep controller={controller(initial)} />);
    await user.click(screen.getByLabelText(/I understand these edits use the live Enterprise API/i));
    await user.type(screen.getByLabelText("Type APPLY to confirm"), "APPLY");
    expect(screen.getByRole("button", { name: "Apply changes to 3 posts" })).toBeEnabled();

    const changed = applyJob({
      fingerprint: "d".repeat(64),
      proposals: { ...initial.proposals, "article:7": { ...initial.proposals["article:7"], included: false } },
    });
    rerender(<ContentReplacementApplyStep controller={controller(changed)} />);

    expect(screen.getByLabelText("Type APPLY to confirm")).toHaveValue("");
    expect(screen.getByLabelText(/I understand these edits use the live Enterprise API/i)).not.toBeChecked();
    expect(screen.getByRole("button", { name: "Apply changes to 2 posts" })).toBeDisabled();
  });

  it("shows live bounded progress and offers a safe pause without claiming rollback", async () => {
    const user = userEvent.setup();
    const running = applyJob({
      status: "running",
      progress: { ...applyJob().progress, applyCompleted: 1 },
      proposals: {
        "question:42": item("question", 42, "applied", { resultKind: "applied" }),
        "answer:42:84": item("answer", 84, "applying", { questionId: 42 }),
        "article:7": item("article", 7, "ready-to-apply"),
      },
    });
    const runningController = controller(running);
    render(<ContentReplacementApplyStep controller={runningController} />);

    expect(screen.getByRole("heading", { name: "Applying reviewed changes" })).toBeVisible();
    expect(screen.getByRole("progressbar", { name: "Apply progress" })).toHaveAttribute("aria-valuenow", "1");
    expect(screen.getByText("1 completed · 2 remaining")).toBeVisible();
    expect(screen.getByText("Current item: Answer 84")).toBeVisible();
    const liveCounts = screen.getByRole("region", { name: "Live apply counts" });
    expect(within(liveCounts).getByText("Stale").parentElement).toHaveTextContent("0");
    expect(within(liveCounts).getByText("Failed").parentElement).toHaveTextContent("0");
    expect(within(liveCounts).getByText("Rate-limited").parentElement).toHaveTextContent("0");
    expect(screen.getByText(/Pausing preserves completed writes and does not roll back failed or stale posts/i)).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Pause after the current request" }));
    expect(runningController.pause).toHaveBeenCalledOnce();
  });

  it("separates result categories, filters rows, and scopes retry and stale rescan actions", async () => {
    const user = userEvent.setup();
    const results = resultJob();
    const resultsController = controller(results);
    render(<ContentReplacementApplyStep controller={resultsController} />);

    const summary = screen.getByRole("region", { name: "Apply result summary" });
    expect(within(summary).getByText("Updated").parentElement).toHaveTextContent("1");
    expect(within(summary).getByText("Already applied").parentElement).toHaveTextContent("1");
    expect(within(summary).getByText("Excluded").parentElement).toHaveTextContent("1");
    expect(within(summary).getByText("Stale").parentElement).toHaveTextContent("1");
    expect(within(summary).getByText("Permission failures").parentElement).toHaveTextContent("1");
    expect(within(summary).getByText("Validation failures").parentElement).toHaveTextContent("1");
    expect(within(summary).getByText("Network/API failures").parentElement).toHaveTextContent("2");
    expect(within(summary).getByText("Protected occurrences").parentElement).toHaveTextContent("8");

    await user.selectOptions(screen.getByLabelText("Result status"), "stale");
    const table = screen.getByRole("table", { name: "Content replacement results" });
    expect(within(table).getByText("Question 4")).toBeVisible();
    expect(within(table).queryByText("Question 1")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Rescan stale posts (1)" }));
    expect(resultsController.rescanStaleItems).toHaveBeenCalledWith(["question:4"]);
    await user.click(screen.getByRole("button", { name: "Retry eligible failures (1)" }));
    expect(resultsController.retryEligibleFailures).toHaveBeenCalledOnce();
  });

  it("downloads one-shot result and exception exports", async () => {
    const user = userEvent.setup();
    render(<ContentReplacementApplyStep controller={controller(resultJob())} />);
    const click = vi.fn();
    const remove = vi.fn();
    const anchor = { click, remove, download: "", href: "" };
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: vi.fn(() => "blob:export") });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
    vi.spyOn(document, "createElement").mockReturnValue(anchor as unknown as HTMLAnchorElement);

    await user.click(screen.getByRole("button", { name: "Download results CSV" }));
    expect(anchor.download).toBe("content-replacement-results.csv");
    expect(click).toHaveBeenCalledOnce();
    expect(remove).toHaveBeenCalledOnce();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:export");
    expect(screen.getByText(/one-shot exports.*not retained by the app/i)).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Download exceptions CSV" }));
    expect(anchor.download).toBe("content-replacement-exceptions.csv");
    expect(click).toHaveBeenCalledTimes(2);
  });

  it("offers recovery only for checksum-observed successes and requires a complete preview plus RECOVER", async () => {
    const user = userEvent.setup();
    const base = resultJob();
    const resultController = controller(base);
    const { rerender } = render(<ContentReplacementApplyStep controller={resultController} />);

    expect(screen.getByLabelText("Select Question 1 for recovery")).toBeChecked();
    expect(screen.getByLabelText("Select Question 2 for recovery")).toBeChecked();
    expect(screen.queryByLabelText("Select Question 4 for recovery")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Preview recovery for 2 posts" }));
    expect(resultController.prepareRecovery).toHaveBeenCalledWith(["question:1", "question:2"]);

    const recovery = recoveryJob();
    const recoveryController = controller(recovery);
    rerender(<ContentReplacementApplyStep controller={recoveryController} />);
    const preview = screen.getByRole("region", { name: "Recovery preview" });
    const questionPreview = within(preview).getByRole("heading", { name: "Question 1 recovery preview" }).parentElement!;
    expect(within(questionPreview).getByText(/Current replacement state/i).nextElementSibling).toHaveTextContent("Use MyPBM");
    expect(within(questionPreview).getByText(/Prior full request model to restore/i).nextElementSibling).toHaveTextContent("Use MyPVM");
    expect(within(preview).getByText(/Question 2 changed after apply and will not be overwritten/i)).toBeVisible();

    const recover = screen.getByRole("button", { name: "Recover 1 post" });
    await user.click(screen.getByLabelText(/I understand recovery writes the prior full request model/i));
    await user.type(screen.getByLabelText("Type RECOVER to confirm"), "recover");
    expect(recover).toBeDisabled();
    await user.clear(screen.getByLabelText("Type RECOVER to confirm"));
    await user.type(screen.getByLabelText("Type RECOVER to confirm"), "RECOVER");
    expect(recover).toBeEnabled();
    await user.click(recover);
    expect(recoveryController.startRecovery).toHaveBeenCalledWith(["question:1"]);
  });

  it("uses separate inline confirmations for deleting recovery snapshots and the whole local job", async () => {
    const user = userEvent.setup();
    const currentController = controller(resultJob());
    render(<ContentReplacementApplyStep controller={currentController} />);

    expect(screen.getByText(/Sensitive browser-local content/i)).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Delete recovery snapshots" }));
    const snapshotConfirmation = screen.getByRole("group", { name: "Confirm recovery snapshot deletion" });
    await user.click(within(snapshotConfirmation).getByRole("button", { name: "Confirm delete recovery snapshots" }));
    expect(currentController.deleteRecoverySnapshots).toHaveBeenCalledOnce();
    expect(currentController.deleteJob).not.toHaveBeenCalled();
    expect(screen.getByRole("heading", { name: "Apply results" })).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Delete entire local job" }));
    const jobConfirmation = screen.getByRole("group", { name: "Confirm local job deletion" });
    await user.click(within(jobConfirmation).getByRole("button", { name: "Confirm delete entire local job" }));
    expect(currentController.deleteJob).toHaveBeenCalledOnce();
    expect(screen.getByRole("heading", { name: "Apply results" })).toBeVisible();
  });

  it("paginates large recovery selections instead of rendering every sensitive request model", async () => {
    const user = userEvent.setup();
    const proposals = Object.fromEntries(
      Array.from({ length: 30 }, (_, index) => [`question:${index + 1}`, item("question", index + 1, "applied", { resultKind: "applied" })]),
    );
    render(<ContentReplacementApplyStep controller={controller(job({
      stage: "results",
      status: "completed",
      proposals,
      progress: { ...job().progress, proposalsFound: 30, applyCompleted: 30 },
    }))} />);

    expect(screen.getAllByRole("checkbox", { name: /for recovery$/i })).toHaveLength(25);
    await user.click(screen.getByRole("button", { name: "Next recovery selection page" }));
    expect(screen.getAllByRole("checkbox", { name: /for recovery$/i })).toHaveLength(5);
  });

  it("disables apply-result mutations while a recovery operation owns the job", () => {
    const recovering = recoveryJob();
    recovering.status = "running";
    recovering.activeOperation = {
      kind: "recovery-preview",
      requestedItemKeys: ["question:1"],
      remainingItemKeys: ["question:1"],
      completedItemKeys: [],
      generation: "2026-09-02T12:03:00.000Z",
    };
    render(<ContentReplacementApplyStep controller={controller(recovering)} />);

    expect(screen.getByRole("button", { name: "Retry eligible failures (1)" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Rescan stale posts (1)" })).toBeDisabled();
  });
});

function controller(job: PersistedContentReplacementJob): ContentReplacementJobController {
  return {
    job,
    busy: false,
    storageError: null,
    operationError: null,
    credentialReadiness: { valid: true, refreshRequired: false, message: "" },
    createJob: vi.fn().mockResolvedValue(true),
    startScan: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    cancel: vi.fn(),
    deleteJob: vi.fn(),
    deleteRecoverySnapshots: vi.fn(),
    setItemIncluded: vi.fn().mockResolvedValue(true),
    setItemsIncluded: vi.fn().mockResolvedValue(true),
    prepareApply: vi.fn().mockResolvedValue(true),
    startApply: vi.fn(),
    retryEligibleFailures: vi.fn(),
    rescanStaleItems: vi.fn(),
    prepareRecovery: vi.fn(),
    startRecovery: vi.fn(),
  };
}

function applyJob(overrides: Partial<PersistedContentReplacementJob> = {}): PersistedContentReplacementJob {
  return job({
    stage: "apply",
    status: "paused",
    recoverySnapshotStatus: "ready",
    proposals: {
      "question:42": item("question", 42, "ready-to-apply", { changed: 2, protected: 1 }),
      "answer:42:84": item("answer", 84, "ready-to-apply", { questionId: 42 }),
      "article:7": item("article", 7, "ready-to-apply", { protected: 1 }),
    },
    ...overrides,
  });
}

function resultJob(): PersistedContentReplacementJob {
  const retryable = failure("network", true, "Temporary network failure");
  return job({
    stage: "results",
    status: "completed",
    recoverySnapshotStatus: "ready",
    progress: { ...job().progress, applyCompleted: 7, protectedOccurrences: 8 },
    proposals: {
      "question:1": item("question", 1, "applied", { resultKind: "applied" }),
      "question:2": item("question", 2, "applied", { resultKind: "unchanged" }),
      "question:3": { ...item("question", 3, "excluded"), included: false },
      "question:4": item("question", 4, "stale", { resultKind: "stale" }),
      "question:5": { ...item("question", 5, "failed"), failure: failure("authorization", false, "Forbidden") },
      "question:6": { ...item("question", 6, "failed"), failure: failure("validation", false, "Invalid") },
      "question:7": { ...item("question", 7, "failed"), failure: retryable },
      "question:8": { ...item("question", 8, "failed"), failure: failure("server", false, "API failed") },
    },
  });
}

function recoveryJob(): PersistedContentReplacementJob {
  const base = resultJob();
  const first = base.proposals["question:1"];
  const second = base.proposals["question:2"];
  return {
    ...base,
    stage: "recovery",
    status: "paused",
    activeOperation: undefined,
    proposals: {
      ...base.proposals,
      "question:1": {
        ...first,
        status: "ready-to-recover",
        recovery: {
          ...first.recovery!,
          preview: {
            status: "recoverable",
            currentRequestModel: toWireModel(first.proposal.after),
            observedCurrentChecksum: "b".repeat(64),
            expectedPostApplyChecksum: "b".repeat(64),
            sourceAttemptCount: 1,
            sourceApplyCompletedAt: "2026-09-02T12:01:00.000Z",
            previewedAt: "2026-09-02T12:02:00.000Z",
          },
        },
      },
      "question:2": {
        ...second,
        status: "ready-to-recover",
        recovery: {
          ...second.recovery!,
          preview: {
            status: "conflict",
            currentRequestModel: questionWireWithTitle(second.proposal.after, "Manually edited"),
            observedCurrentChecksum: "e".repeat(64),
            expectedPostApplyChecksum: "b".repeat(64),
            sourceAttemptCount: 1,
            sourceApplyCompletedAt: "2026-09-02T12:01:00.000Z",
            previewedAt: "2026-09-02T12:02:00.000Z",
          },
        },
      },
    },
  };
}

function job(overrides: Partial<PersistedContentReplacementJob> = {}): PersistedContentReplacementJob {
  return {
    schemaVersion: 1,
    revision: 1,
    id: "job-1",
    fingerprint: "f".repeat(64),
    baseUrl: "https://example.stackenterprise.co",
    target: { kind: "enterprise-main" },
    configuration: {
      target: { kind: "enterprise-main" },
      contentTypes: { questions: true, answers: true, articles: true },
      rules: [{ id: "one", find: "MyPVM", replace: "MyPBM" }],
      options: { caseSensitive: true, wholeTerm: true, replaceInCode: false },
    },
    stage: "results",
    status: "completed",
    inventoryQueue: [],
    detailQueue: [],
    progress: {
      questionPages: 1,
      answerPages: 1,
      articlePages: 1,
      inventoryItems: 8,
      detailsInspected: 8,
      proposalsFound: 0,
      protectedOccurrences: 0,
      applyCompleted: 0,
      recoveryCompleted: 0,
    },
    proposals: {},
    recoverySnapshotStatus: "ready",
    createdAt: "2026-09-02T12:00:00.000Z",
    updatedAt: "2026-09-02T12:03:00.000Z",
    ...overrides,
  };
}

function item(
  kind: ReplacementContentKind,
  id: number,
  status: PersistedContentReplacementItemStatus,
  options: {
    questionId?: number;
    changed?: number;
    protected?: number;
    resultKind?: "applied" | "unchanged" | "stale";
  } = {},
): PersistedContentReplacementItem {
  const ref = kind === "question" ? { kind, questionId: id } as const
    : kind === "answer" ? { kind, questionId: options.questionId ?? 1, answerId: id } as const
      : { kind, articleId: id } as const;
  let before: ReplacementRequestModel;
  let after: ReplacementRequestModel;
  if (kind === "question" && ref.kind === "question") {
    before = { kind, ref, request: { title: "Use MyPVM", body: "Use MyPVM.", tags: ["test"] } };
    after = { kind, ref, request: { title: "Use MyPBM", body: "Use MyPBM.", tags: ["test"] } };
  } else if (kind === "answer" && ref.kind === "answer") {
    before = { kind, ref, request: { body: "Use MyPVM." } };
    after = { kind, ref, request: { body: "Use MyPBM." } };
  } else if (kind === "article" && ref.kind === "article") {
    const permissions = { editorUserIds: [], editorUserGroupIds: [] };
    before = { kind, ref, request: { title: "Use MyPVM", body: "Use MyPVM.", tags: ["test"], type: "knowledgeArticle", permissions } };
    after = { kind, ref, request: { title: "Use MyPBM", body: "Use MyPBM.", tags: ["test"], type: "knowledgeArticle", permissions } };
  } else {
    throw new Error("Mismatched test item kind");
  }
  const changed = Array.from({ length: options.changed ?? 1 }, (_, index) => ({
    field: (index === 0 && kind !== "answer" ? "title" : "body") as "title" | "body",
    ruleId: "one",
    start: index === 0 ? 4 : 0,
    end: index === 0 ? 9 : 5,
    before: "MyPVM",
    after: "MyPBM",
  }));
  const protectedOccurrences = Array.from({ length: options.protected ?? 0 }, () => ({
    field: "body" as const,
    ruleId: "one",
    start: 1,
    end: 6,
    before: "MyPVM",
    reason: "code" as const,
  }));
  const successful = options.resultKind === "applied" || options.resultKind === "unchanged";
  return {
    included: true,
    attemptCount: successful ? 1 : 0,
    status,
    proposal: {
      before,
      after,
      fields: {
        ...(kind === "answer" ? {} : { title: { beforeMarkdown: "Use MyPVM", afterMarkdown: "Use MyPBM" } }),
        body: { beforeMarkdown: "Use MyPVM.", afterMarkdown: "Use MyPBM." },
      },
      changedOccurrences: changed,
      protectedOccurrences,
      appliedRuleIds: ["one"],
      scannedRequestChecksum: "a".repeat(64),
      proposedRequestChecksum: "b".repeat(64),
      proposalFingerprint: "c".repeat(64),
    },
    ...(options.resultKind === "applied" ? {
      result: { kind: "applied" as const, observedRequestChecksum: "b".repeat(64), completedAt: "2026-09-02T12:01:00.000Z" },
    } : options.resultKind === "unchanged" ? {
      result: { kind: "unchanged" as const, observedRequestChecksum: "b".repeat(64), completedAt: "2026-09-02T12:01:00.000Z" },
    } : options.resultKind === "stale" ? {
      result: { kind: "stale" as const, completedAt: "2026-09-02T12:01:00.000Z" },
    } : {}),
    recovery: {
      priorRequestModel: before,
      scannedRequestChecksum: "a".repeat(64),
      proposedRequestChecksum: "b".repeat(64),
      ...(successful ? { observedPostApplyChecksum: "b".repeat(64) } : {}),
      status: "ready",
    },
  };
}

function toWireModel(model: ReplacementRequestModel): ReplacementWireRequestModel {
  if (model.kind === "question") return { kind: model.kind, ref: model.ref, request: model.request };
  if (model.kind === "answer") return { kind: model.kind, ref: model.ref, request: model.request };
  return { kind: model.kind, ref: model.ref, request: model.request };
}

function questionWireWithTitle(model: ReplacementRequestModel, title: string): ReplacementWireRequestModel {
  if (model.kind !== "question") throw new Error("Expected a question fixture");
  return { kind: model.kind, ref: model.ref, request: { ...model.request, title } };
}

function failure(
  category: PersistedContentReplacementFailure["category"],
  retryable: boolean,
  message: string,
): PersistedContentReplacementFailure {
  return { category, retryable, message, occurredAt: "2026-09-02T12:01:00.000Z" };
}
