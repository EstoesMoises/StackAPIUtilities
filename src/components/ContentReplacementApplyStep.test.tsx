import { fireEvent, render, screen, within } from "@testing-library/react";
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
import {
  ContentReplacementApplyStep,
  visibleDeletionConfirmation,
} from "./ContentReplacementApplyStep";

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

  it("binds APPLY authorization to the exact job even when fingerprints and proposals match", async () => {
    const user = userEvent.setup();
    const first = applyJob();
    const { rerender } = render(<ContentReplacementApplyStep controller={controller(first)} />);
    await user.click(screen.getByLabelText(/I understand these edits use the live Enterprise API/i));
    await user.type(screen.getByLabelText("Type APPLY to confirm"), "APPLY");
    expect(screen.getByRole("button", { name: "Apply changes to 3 posts" })).toBeEnabled();

    rerender(<ContentReplacementApplyStep controller={controller({ ...first, id: "job-2" })} />);

    expect(screen.getByLabelText("Type APPLY to confirm")).toHaveValue("");
    expect(screen.getByLabelText(/I understand these edits use the live Enterprise API/i)).not.toBeChecked();
    expect(screen.getByRole("button", { name: "Apply changes to 3 posts" })).toBeDisabled();
  });

  it("binds APPLY authorization to complete proposal evidence, not a persisted fingerprint alone", async () => {
    const user = userEvent.setup();
    const first = applyJob();
    const { rerender } = render(<ContentReplacementApplyStep controller={controller(first)} />);
    await user.click(screen.getByLabelText(/I understand these edits use the live Enterprise API/i));
    await user.type(screen.getByLabelText("Type APPLY to confirm"), "APPLY");

    const question = first.proposals["question:42"];
    const changed = {
      ...first,
      proposals: {
        ...first.proposals,
        "question:42": {
          ...question,
          proposal: {
            ...question.proposal,
            before: questionWireWithTitle(question.proposal.before, "Unexpected persisted title") as ReplacementRequestModel,
          },
        },
      },
    };
    rerender(<ContentReplacementApplyStep controller={controller(changed)} />);

    expect(screen.getByRole("button", { name: "Apply changes to 3 posts" })).toBeDisabled();
  });

  it.each([
    ["missing", "Enter an API key to continue."],
    ["expired", "The API key expired. Refresh it to continue."],
    ["wrong", "This API key belongs to a different site."],
    ["rejected", "The Enterprise API rejected this credential."],
  ])("blocks apply for %s credential readiness", async (_state, message) => {
    const user = userEvent.setup();
    render(<ContentReplacementApplyStep controller={controller(applyJob(), {
      credentialReadiness: { valid: false, refreshRequired: true, message },
    })} />);
    await user.click(screen.getByLabelText(/I understand these edits use the live Enterprise API/i));
    await user.type(screen.getByLabelText("Type APPLY to confirm"), "APPLY");

    expect(screen.getByText(message)).toBeVisible();
    expect(screen.getByRole("button", { name: "Apply changes to 3 posts" })).toBeDisabled();
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

  it.each([
    ["expired", "The API key expired during apply. Refresh it before resuming."],
    ["rejected", "The Enterprise API rejected this credential during apply."],
  ])("surfaces %s credential readiness after a partial apply is paused", (_state, message) => {
    const partial = applyJob({
      status: "paused",
      proposals: {
        "question:42": item("question", 42, "applied", { resultKind: "applied" }),
        "answer:42:84": item("answer", 84, "ready-to-apply", { questionId: 42 }),
        "article:7": item("article", 7, "ready-to-apply"),
      },
      progress: { ...applyJob().progress, applyCompleted: 1 },
    });
    render(<ContentReplacementApplyStep controller={controller(partial, {
      credentialReadiness: { valid: false, refreshRequired: true, message },
    })} />);

    expect(screen.getByText(message)).toBeVisible();
    expect(screen.getByRole("button", { name: "Resume apply" })).toBeDisabled();
  });

  it("does not traverse full request bodies during incremental large apply progress", () => {
    const apply = trackedBodyJob(2_000, false);
    const applyView = render(<ContentReplacementApplyStep controller={controller(apply.current)} />);
    for (let revision = 2; revision <= 4; revision += 1) {
      applyView.rerender(<ContentReplacementApplyStep controller={controller({
        ...apply.current,
        revision,
        progress: { ...apply.current.progress, applyCompleted: revision },
      })} />);
    }

    expect(apply.bodyReads()).toBe(0);
  });

  it("defers accumulated full recovery models until preview progress is complete", async () => {
    const user = userEvent.setup();
    const recovery = trackedRecoveryPreviewJob(30);
    const recoveryView = render(
      <ContentReplacementApplyStep controller={controller(recovery.jobAt(5, true))} />,
    );
    recoveryView.rerender(
      <ContentReplacementApplyStep controller={controller(recovery.jobAt(15, true))} />,
    );
    recoveryView.rerender(
      <ContentReplacementApplyStep controller={controller(recovery.jobAt(25, true))} />,
    );

    expect(screen.getByText("Recovery preview: 25 of 30 checked. No recovery writes have started.")).toBeVisible();
    expect({
      current: recovery.currentBodyReads(),
      prior: recovery.priorBodyReads(),
    }).toEqual({ current: 0, prior: 0 });
    expect(screen.queryByRole("region", { name: "Recovery preview" })).not.toBeInTheDocument();

    recovery.resetReads();
    recoveryView.rerender(
      <ContentReplacementApplyStep controller={controller(recovery.jobAt(30, false))} />,
    );

    const preview = screen.getByRole("region", { name: "Recovery preview" });
    expect(within(preview).getAllByRole("heading", { level: 5 })).toHaveLength(25);
    expect(recovery.currentBodyReads()).toBeGreaterThan(0);
    expect(recovery.priorBodyReads()).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Recover 30 posts" })).toBeDisabled();

    recovery.resetReads();
    await user.click(screen.getByRole("button", { name: "Next recovery preview page" }));
    expect(within(preview).getAllByRole("heading", { level: 5 })).toHaveLength(5);
    expect({
      current: recovery.currentBodyReads(),
      prior: recovery.priorBodyReads(),
    }).toEqual({ current: 5, prior: 5 });
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

  it("projects terminal recovery outcomes instead of also counting their original apply results", async () => {
    const user = userEvent.setup();
    const recovered = withRecoveryResult(item("question", 1, "applied", { resultKind: "applied" }), "recovered");
    const conflict = withRecoveryResult(item("question", 2, "applied", { resultKind: "applied" }), "conflict");
    const failed = withRecoveryResult(item("question", 3, "applied", { resultKind: "applied" }), "verification-failed");
    render(<ContentReplacementApplyStep controller={controller(job({
      stage: "results",
      status: "completed",
      proposals: { "question:1": recovered, "question:2": conflict, "question:3": failed },
    }))} />);

    const summary = screen.getByRole("region", { name: "Apply result summary" });
    expect(within(summary).getByText("Updated").parentElement).toHaveTextContent("0");
    expect(within(summary).getByText("Recovered").parentElement).toHaveTextContent("1");
    expect(within(summary).getByText("Recovery conflicts").parentElement).toHaveTextContent("1");
    expect(within(summary).getByText("Recovery failures").parentElement).toHaveTextContent("1");

    await user.selectOptions(screen.getByLabelText("Result status"), "updated");
    expect(screen.getByText("No item results match the current filters.")).toBeVisible();
    await user.selectOptions(screen.getByLabelText("Result status"), "recovered");
    const table = screen.getByRole("table", { name: "Content replacement results" });
    expect(within(table).getByText("Question 1")).toBeVisible();
    expect(within(table).getByText("Recovered")).toBeVisible();
  });

  it("searches persisted question and article request titles when metadata is absent", async () => {
    const user = userEvent.setup();
    const question = item("question", 1, "applied", { resultKind: "applied" });
    const article = item("article", 2, "applied", { resultKind: "applied" });
    question.proposal.before = questionWireWithTitle(question.proposal.before, "Canonical launch question") as ReplacementRequestModel;
    article.proposal.before = articleWireWithTitle(article.proposal.before, "Canonical launch article") as ReplacementRequestModel;
    render(<ContentReplacementApplyStep controller={controller(job({
      stage: "results",
      status: "completed",
      proposals: { "question:1": question, "article:2": article },
    }))} />);

    await user.type(screen.getByLabelText("Search result title or ID"), "Canonical launch");
    const table = screen.getByRole("table", { name: "Content replacement results" });
    expect(within(table).getByText("Question 1")).toBeVisible();
    expect(within(table).getByText("Article 2")).toBeVisible();
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

  it("binds RECOVER authorization to exact preview request-model and source completion evidence", async () => {
    const user = userEvent.setup();
    const initial = recoveryJob();
    const { rerender } = render(<ContentReplacementApplyStep controller={controller(initial)} />);
    await user.click(screen.getByLabelText(/I understand recovery writes the prior full request model/i));
    await user.type(screen.getByLabelText("Type RECOVER to confirm"), "RECOVER");
    expect(screen.getByRole("button", { name: "Recover 1 post" })).toBeEnabled();

    const first = initial.proposals["question:1"];
    const changedPreview = {
      ...initial,
      proposals: {
        ...initial.proposals,
        "question:1": {
          ...first,
          recovery: {
            ...first.recovery!,
            preview: {
              ...first.recovery!.preview!,
              currentRequestModel: questionWireWithTitle(first.proposal.after, "Changed after authorization"),
              sourceAttemptCount: 2,
              sourceApplyCompletedAt: "2026-09-02T12:04:00.000Z",
            },
          },
        },
      },
    };
    rerender(<ContentReplacementApplyStep controller={controller(changedPreview)} />);

    expect(screen.getByRole("button", { name: "Recover 1 post" })).toBeDisabled();
  });

  it("binds RECOVER authorization to the exact job even when recovery evidence matches", async () => {
    const user = userEvent.setup();
    const initial = recoveryJob();
    const { rerender } = render(<ContentReplacementApplyStep controller={controller(initial)} />);
    await user.click(screen.getByLabelText(/I understand recovery writes the prior full request model/i));
    await user.type(screen.getByLabelText("Type RECOVER to confirm"), "RECOVER");
    expect(screen.getByRole("button", { name: "Recover 1 post" })).toBeEnabled();

    rerender(<ContentReplacementApplyStep controller={controller({ ...initial, id: "job-2" })} />);

    expect(screen.getByLabelText(/I understand recovery writes the prior full request model/i)).not.toBeChecked();
    expect(screen.getByLabelText("Type RECOVER to confirm")).toHaveValue("");
    expect(screen.getByRole("button", { name: "Recover 1 post" })).toBeDisabled();
  });

  it.each(["base URL", "configuration"] as const)(
    "binds RECOVER authorization to actual %s when a persisted fingerprint is unchanged",
    async (scope) => {
      const user = userEvent.setup();
      const initial = recoveryJob();
      const { rerender } = render(<ContentReplacementApplyStep controller={controller(initial)} />);
      await user.click(screen.getByLabelText(/I understand recovery writes the prior full request model/i));
      await user.type(screen.getByLabelText("Type RECOVER to confirm"), "RECOVER");

      const changed = scope === "base URL"
        ? { ...initial, baseUrl: "https://other.stackenterprise.co" }
        : {
            ...initial,
            configuration: {
              ...initial.configuration,
              rules: [{ ...initial.configuration.rules[0], replace: "Mutated while fingerprint stayed fixed" }],
            },
          };
      rerender(<ContentReplacementApplyStep controller={controller(changed)} />);

      expect(screen.getByLabelText(/I understand recovery writes the prior full request model/i)).not.toBeChecked();
      expect(screen.getByLabelText("Type RECOVER to confirm")).toHaveValue("");
      expect(screen.getByRole("button", { name: "Recover 1 post" })).toBeDisabled();
    },
  );

  it("recomputes default-selected recovery items from current state before dispatch", async () => {
    const user = userEvent.setup();
    const currentJob = recoveryJob();
    const currentController = controller(currentJob);
    render(<ContentReplacementApplyStep controller={currentController} />);
    await user.click(screen.getByLabelText(/I understand recovery writes the prior full request model/i));
    await user.type(screen.getByLabelText("Type RECOVER to confirm"), "RECOVER");

    const added = item("question", 9, "ready-to-recover", { resultKind: "applied" });
    added.recovery = {
      ...added.recovery!,
      preview: {
        status: "recoverable",
        currentRequestModel: toWireModel(added.proposal.after),
        observedCurrentChecksum: "b".repeat(64),
        expectedPostApplyChecksum: "b".repeat(64),
        sourceAttemptCount: 1,
        sourceApplyCompletedAt: "2026-09-02T12:01:00.000Z",
        previewedAt: "2026-09-02T12:08:00.000Z",
      },
    };
    currentJob.proposals["question:9"] = added;
    await user.click(screen.getByRole("button", { name: "Recover 1 post" }));

    expect(currentController.startRecovery).not.toHaveBeenCalled();
  });

  it("blocks recovery preview and confirmation when credentials are not ready", async () => {
    const user = userEvent.setup();
    const message = "Refresh the Enterprise API credential before recovery.";
    const invalidResults = controller(resultJob(), {
      credentialReadiness: { valid: false, refreshRequired: true, message },
    });
    const { rerender } = render(<ContentReplacementApplyStep controller={invalidResults} />);

    expect(screen.getByText(message)).toBeVisible();
    expect(screen.getByLabelText("Select Question 1 for recovery")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Preview recovery for 2 posts" })).toBeDisabled();

    rerender(<ContentReplacementApplyStep controller={controller(recoveryJob(), {
      credentialReadiness: { valid: false, refreshRequired: true, message },
    })} />);
    await user.click(screen.getByLabelText(/I understand recovery writes the prior full request model/i));
    await user.type(screen.getByLabelText("Type RECOVER to confirm"), "RECOVER");
    expect(screen.getByRole("button", { name: "Recover 1 post" })).toBeDisabled();
  });

  it("locks all recovery controls during a paused stale-rescan operation", () => {
    const staleRescan = resultJob();
    staleRescan.status = "paused";
    staleRescan.activeOperation = {
      kind: "stale-rescan",
      requestedItemKeys: ["question:4"],
      remainingItemKeys: ["question:4"],
      completedItemKeys: [],
      generation: "2026-09-02T12:05:00.000Z",
      proposals: {},
      inspectedCount: 0,
      protectedOccurrenceCount: 0,
    };
    render(<ContentReplacementApplyStep controller={controller(staleRescan)} />);

    expect(screen.getByLabelText("Select Question 1 for recovery")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Preview recovery for 2 posts" })).toBeDisabled();
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

  it.each([
    ["recovery snapshots", "Delete recovery snapshots", "Confirm recovery snapshot deletion"],
    ["whole job", "Delete entire local job", "Confirm local job deletion"],
  ])("does not carry a pending %s deletion to another job", async (_kind, requestName, groupName) => {
    const user = userEvent.setup();
    const first = resultJob();
    const { rerender } = render(<ContentReplacementApplyStep controller={controller(first)} />);
    await user.click(screen.getByRole("button", { name: requestName }));
    expect(screen.getByRole("group", { name: groupName })).toBeVisible();

    const secondController = controller({ ...first, id: "job-2" });
    rerender(<ContentReplacementApplyStep controller={secondController} />);

    expect(screen.queryByRole("group", { name: groupName })).not.toBeInTheDocument();
    expect(secondController.deleteRecoverySnapshots).not.toHaveBeenCalled();
    expect(secondController.deleteJob).not.toHaveBeenCalled();
  });

  it("derives deletion confirmation visibility synchronously from the current job and lock", () => {
    const pending = { jobId: "job-1", kind: "snapshots" as const };

    expect(visibleDeletionConfirmation(pending, "job-2", false)).toBeNull();
    expect(visibleDeletionConfirmation(pending, "job-1", true)).toBeNull();
    expect(visibleDeletionConfirmation(pending, "job-1", false)).toEqual(pending);
  });

  it("rechecks the operation lock when a delete confirmation races with an operation start", async () => {
    const user = userEvent.setup();
    const currentJob = resultJob();
    const currentController = controller(currentJob);
    render(<ContentReplacementApplyStep controller={currentController} />);
    await user.click(screen.getByRole("button", { name: "Delete recovery snapshots" }));
    const confirm = screen.getByRole("button", { name: "Confirm delete recovery snapshots" });

    currentJob.status = "running";
    currentJob.activeOperation = {
      kind: "stale-rescan",
      requestedItemKeys: ["question:4"],
      remainingItemKeys: ["question:4"],
      completedItemKeys: [],
      generation: "2026-09-02T12:05:00.000Z",
      proposals: {},
      inspectedCount: 0,
      protectedOccurrenceCount: 0,
    };
    fireEvent.click(confirm);

    expect(currentController.deleteRecoverySnapshots).not.toHaveBeenCalled();
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

function controller(
  currentJob: PersistedContentReplacementJob,
  overrides: Partial<ContentReplacementJobController> = {},
): ContentReplacementJobController {
  return {
    job: currentJob,
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
    ...overrides,
    rehydrating: overrides.rehydrating ?? false,
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
      discovery: { mode: "full" },
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

function articleWireWithTitle(model: ReplacementRequestModel, title: string): ReplacementWireRequestModel {
  if (model.kind !== "article") throw new Error("Expected an article fixture");
  return { kind: model.kind, ref: model.ref, request: { ...model.request, title } };
}

function withRecoveryResult(
  currentItem: PersistedContentReplacementItem,
  kind: "recovered" | "conflict" | "verification-failed",
): PersistedContentReplacementItem {
  return {
    ...currentItem,
    status: kind === "recovered" ? "recovered" : kind === "conflict" ? "recovery-conflict" : "recovery-failed",
    recovery: {
      ...currentItem.recovery!,
      status: kind === "recovered" ? "applied" : kind === "conflict" ? "conflict" : "failed",
      result: {
        kind,
        observedRequestChecksum: kind === "recovered" ? "a".repeat(64) : "e".repeat(64),
        ...(kind === "verification-failed" ? { expectedRequestChecksum: "a".repeat(64) } : {}),
        sourceAttemptCount: 1,
        sourceApplyCompletedAt: "2026-09-02T12:01:00.000Z",
        completedAt: "2026-09-02T12:06:00.000Z",
      },
    },
  };
}

function trackedBodyJob(count: number, successful: boolean): {
  current: PersistedContentReplacementJob;
  bodyReads(): number;
} {
  let reads = 0;
  const proposals = Object.fromEntries(Array.from({ length: count }, (_, index) => {
    const currentItem = item(
      "question",
      index + 1,
      successful ? "applied" : "ready-to-apply",
      successful ? { resultKind: "applied" } : {},
    );
    const request = currentItem.proposal.before.request;
    const body = request.body;
    Object.defineProperty(request, "body", {
      enumerable: true,
      configurable: true,
      get() {
        reads += 1;
        return body;
      },
    });
    return [`question:${index + 1}`, currentItem];
  }));
  return {
    current: job({
      stage: successful ? "results" : "apply",
      status: successful ? "completed" : "running",
      revision: 1,
      proposals,
      progress: { ...job().progress, proposalsFound: count },
    }),
    bodyReads: () => reads,
  };
}

function trackedRecoveryPreviewJob(count: number): {
  jobAt(previewedCount: number, active: boolean): PersistedContentReplacementJob;
  currentBodyReads(): number;
  priorBodyReads(): number;
  resetReads(): void;
} {
  let currentReads = 0;
  let priorReads = 0;
  const tracked = Array.from({ length: count }, (_, index) => {
    const currentItem = item("question", index + 1, "applied", { resultKind: "applied" });
    const priorRequestModel = structuredClone(currentItem.proposal.before);
    const currentRequestModel = toWireModel(currentItem.proposal.after);
    const priorBody = priorRequestModel.request.body;
    const currentBody = currentRequestModel.request.body;
    Object.defineProperty(priorRequestModel.request, "body", {
      enumerable: true,
      configurable: true,
      get() {
        priorReads += 1;
        return priorBody;
      },
    });
    Object.defineProperty(currentRequestModel.request, "body", {
      enumerable: true,
      configurable: true,
      get() {
        currentReads += 1;
        return currentBody;
      },
    });
    return {
      key: `question:${index + 1}`,
      item: currentItem,
      priorRequestModel,
      preview: {
        status: "recoverable" as const,
        currentRequestModel,
        observedCurrentChecksum: "b".repeat(64),
        expectedPostApplyChecksum: "b".repeat(64),
        sourceAttemptCount: 1,
        sourceApplyCompletedAt: "2026-09-02T12:01:00.000Z",
        previewedAt: "2026-09-02T12:08:00.000Z",
      },
    };
  });
  const keys = tracked.map(({ key }) => key);
  return {
    jobAt(previewedCount, active) {
      const proposals = Object.fromEntries(tracked.map(({ key, item: currentItem, priorRequestModel, preview }, index) => [
        key,
        index < previewedCount ? {
          ...currentItem,
          status: "ready-to-recover" as const,
          recovery: { ...currentItem.recovery!, priorRequestModel, preview },
        } : {
          ...currentItem,
          recovery: { ...currentItem.recovery!, priorRequestModel },
        },
      ]));
      return job({
        revision: previewedCount,
        stage: "recovery",
        status: active ? "running" : "paused",
        proposals,
        activeOperation: active ? {
          kind: "recovery-preview",
          requestedItemKeys: keys,
          remainingItemKeys: keys.slice(previewedCount),
          completedItemKeys: keys.slice(0, previewedCount),
          generation: "2026-09-02T12:07:00.000Z",
        } : undefined,
      });
    },
    currentBodyReads: () => currentReads,
    priorBodyReads: () => priorReads,
    resetReads() {
      currentReads = 0;
      priorReads = 0;
    },
  };
}

function failure(
  category: PersistedContentReplacementFailure["category"],
  retryable: boolean,
  message: string,
): PersistedContentReplacementFailure {
  return { category, retryable, message, occurredAt: "2026-09-02T12:01:00.000Z" };
}
