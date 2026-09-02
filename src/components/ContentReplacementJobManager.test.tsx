import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { PersistedContentReplacementJob } from "../writeTools/contentReplacement/types";
import {
  ContentReplacementJobManager,
  type ContentReplacementJobManagerStorage,
} from "./ContentReplacementJobManager";

describe("ContentReplacementJobManager", () => {
  it("labels browser-local post content as sensitive and opens a resumable job", async () => {
    const user = userEvent.setup();
    const jobs = [replacementJob("job-1", "scan", "paused")];
    const storage = managerStorage(jobs);
    const onOpenJob = vi.fn();

    render(<ContentReplacementJobManager storage={storage} onOpenJob={onOpenJob} />);

    expect(await screen.findByRole("heading", { name: "Browser-local replacement jobs" })).toBeVisible();
    expect(screen.getByText(/sensitive local data.*post bodies.*request models/i)).toBeVisible();
    expect(screen.getByText("Scan paused")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Resume content replacement job job-1" }));
    expect(onOpenJob).toHaveBeenCalledWith(jobs[0]);
  });

  it("requires inline confirmation before deleting the job and all recovery data", async () => {
    const user = userEvent.setup();
    const storage = managerStorage([replacementJob("job-with-recovery", "results", "completed", true)]);
    const onDeleteJob = vi.fn();
    render(<ContentReplacementJobManager storage={storage} onOpenJob={vi.fn()} onDeleteJob={onDeleteJob} />);

    await screen.findByText("Apply results");
    await user.click(screen.getByRole("button", { name: "Delete content replacement job job-with-recovery" }));
    expect(storage.delete).not.toHaveBeenCalled();
    const confirmation = screen.getByRole("group", { name: "Confirm deletion of content replacement job job-with-recovery" });
    expect(confirmation).toHaveTextContent(/including its post content and recovery snapshots/i);

    await user.click(within(confirmation).getByRole("button", { name: "Confirm delete job-with-recovery" }));

    await waitFor(() => expect(storage.delete).toHaveBeenCalledWith("job-with-recovery"));
    expect(onDeleteJob).toHaveBeenCalledWith("job-with-recovery");
    expect(screen.queryByText("Apply results")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(/job-with-recovery.*recovery snapshots.*deleted/i);
  });

  it("bounds a large local-job list and keeps pagination keyboard-operable", async () => {
    const user = userEvent.setup();
    const jobs = Array.from({ length: 61 }, (_, index) =>
      replacementJob(`job-${String(index + 1).padStart(2, "0")}`, "scan", "paused"),
    );
    render(<ContentReplacementJobManager storage={managerStorage(jobs)} onOpenJob={vi.fn()} />);

    await screen.findByText("61 browser-local jobs");
    expect(screen.getAllByRole("button", { name: /Resume content replacement job/ })).toHaveLength(25);
    const pagination = screen.getByRole("navigation", { name: "Replacement job pagination" });
    expect(within(pagination).getByText("Page 1 of 3")).toBeVisible();
    await user.click(within(pagination).getByRole("button", { name: "Next jobs page" }));
    expect(screen.getByRole("button", { name: "Resume content replacement job job-26" })).toBeVisible();
  });

  it("announces a storage failure without exposing stale controls", async () => {
    const storage = managerStorage([]);
    storage.list.mockRejectedValueOnce(new Error("private database detail"));
    render(<ContentReplacementJobManager storage={storage} onOpenJob={vi.fn()} />);

    expect(await screen.findByRole("alert")).toHaveTextContent(/replacement jobs could not be loaded/i);
    expect(screen.queryByRole("button", { name: /Resume content replacement job/ })).not.toBeInTheDocument();
    expect(screen.queryByText("private database detail")).not.toBeInTheDocument();
  });
});

function managerStorage(jobs: PersistedContentReplacementJob[]): ContentReplacementJobManagerStorage & {
  list: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
} {
  return {
    list: vi.fn().mockResolvedValue(jobs),
    delete: vi.fn().mockResolvedValue(undefined),
  };
}

function replacementJob(
  id: string,
  stage: PersistedContentReplacementJob["stage"],
  status: PersistedContentReplacementJob["status"],
  withRecovery = false,
): PersistedContentReplacementJob {
  return {
    schemaVersion: 1,
    revision: 0,
    id,
    fingerprint: "f".repeat(64),
    baseUrl: "https://example.stackenterprise.co",
    target: { kind: "enterprise-main" },
    configuration: {
      target: { kind: "enterprise-main" },
      contentTypes: { questions: true, answers: true, articles: true },
      rules: [{ id: "rule-1", find: "Old", replace: "New" }],
      options: { caseSensitive: true, wholeTerm: true, replaceInCode: false },
    },
    stage,
    status,
    inventoryQueue: [],
    detailQueue: [],
    progress: {
      questionPages: 1,
      answerPages: 2,
      articlePages: 1,
      inventoryItems: 3,
      detailsInspected: 2,
      proposalsFound: 1,
      protectedOccurrences: 0,
      applyCompleted: 0,
      recoveryCompleted: 0,
    },
    proposals: withRecovery ? { "question:1": {} as never } : {},
    recoverySnapshotStatus: withRecovery ? "ready" : "none",
    createdAt: "2026-09-01T12:00:00.000Z",
    updatedAt: "2026-09-02T12:00:00.000Z",
  };
}
