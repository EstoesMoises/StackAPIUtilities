import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { ContentReplacementJobSummary } from "../utils/browserContentReplacementStorage";
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
    expect(onOpenJob).toHaveBeenCalledWith("job-1");
  });

  it("keeps a migrated paused job visible as requiring a new scan", async () => {
    const migrated = {
      ...replacementJob("legacy-job", "scan", "paused"),
      scanCompatibility: "legacy-restart-required" as const,
    };

    render(<ContentReplacementJobManager storage={managerStorage([migrated])} onOpenJob={vi.fn()} />);

    expect(await screen.findByText("New scan required")).toBeVisible();
    expect(screen.getByRole("button", { name: "Resume content replacement job legacy-job" })).toBeVisible();
  });

  it("labels migrated results with unfinished stale rescan work as requiring a new scan", async () => {
    const migrated = {
      ...replacementJob("legacy-stale-rescan", "results", "paused"),
      scanCompatibility: "legacy-restart-required" as const,
      activeOperationKind: "stale-rescan" as const,
    };

    render(<ContentReplacementJobManager storage={managerStorage([migrated])} onOpenJob={vi.fn()} />);

    expect(await screen.findByText("New scan required")).toBeVisible();
    expect(screen.queryByText("Apply results")).not.toBeInTheDocument();
  });

  it("keeps completed migrated results without stale work recovery-visible", async () => {
    const migrated = {
      ...replacementJob("legacy-results", "results", "completed", true),
      scanCompatibility: "legacy-restart-required" as const,
    };

    render(<ContentReplacementJobManager storage={managerStorage([migrated])} onOpenJob={vi.fn()} />);

    expect(await screen.findByText("Apply results")).toBeVisible();
    expect(screen.queryByText("New scan required")).not.toBeInTheDocument();
  });

  it("labels every proofless Exact checkpoint as requiring a new scan", async () => {
    const fenced = {
      ...replacementJob("proofless-exact", "results", "completed", true),
      scanCompatibility: "exact-proof-restart-required" as const,
    };

    render(<ContentReplacementJobManager storage={managerStorage([fenced])} onOpenJob={vi.fn()} />);

    expect(await screen.findByText("New scan required")).toBeVisible();
    expect(screen.queryByText("Apply results")).not.toBeInTheDocument();
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
    const storage = managerStorage(jobs);
    render(<ContentReplacementJobManager storage={storage} onOpenJob={vi.fn()} />);

    await screen.findByText("61 browser-local jobs");
    expect(screen.getAllByRole("button", { name: /Resume content replacement job/ })).toHaveLength(25);
    const pagination = screen.getByRole("navigation", { name: "Replacement job pagination" });
    expect(within(pagination).getByText("Page 1 of 3")).toBeVisible();
    await user.click(within(pagination).getByRole("button", { name: "Next jobs page" }));
    expect(screen.getByRole("button", { name: "Resume content replacement job job-26" })).toBeVisible();
    expect(storage.list).toHaveBeenLastCalledWith({ offset: 25, limit: 25 });
  });

  it("reloads the preceding bounded page when deleting the last item on a page", async () => {
    const user = userEvent.setup();
    const jobs = Array.from({ length: 26 }, (_, index) =>
      replacementJob(`job-${String(index + 1).padStart(2, "0")}`, "scan", "paused"),
    );
    const storage = managerStorage(jobs);
    storage.delete.mockImplementation(async (id: string) => {
      const index = jobs.findIndex((job) => job.id === id);
      if (index >= 0) jobs.splice(index, 1);
    });
    render(<ContentReplacementJobManager storage={storage} onOpenJob={vi.fn()} />);

    await screen.findByText("26 browser-local jobs");
    await user.click(screen.getByRole("button", { name: "Next jobs page" }));
    await user.click(screen.getByRole("button", { name: "Delete content replacement job job-26" }));
    await user.click(screen.getByRole("button", { name: "Confirm delete job-26" }));

    expect(await screen.findByRole("button", { name: "Resume content replacement job job-01" })).toBeVisible();
    expect(screen.queryByRole("navigation", { name: "Replacement job pagination" })).not.toBeInTheDocument();
    expect(storage.list).toHaveBeenLastCalledWith({ offset: 0, limit: 25 });
  });

  it("reloads the same bounded page after deletion so an offset shift cannot hide a job", async () => {
    const user = userEvent.setup();
    const jobs = Array.from({ length: 51 }, (_, index) =>
      replacementJob(`job-${String(index + 1).padStart(2, "0")}`, "scan", "paused"),
    );
    const storage = managerStorage(jobs);
    storage.delete.mockImplementation(async (id: string) => {
      const index = jobs.findIndex((job) => job.id === id);
      if (index >= 0) jobs.splice(index, 1);
    });
    render(<ContentReplacementJobManager storage={storage} onOpenJob={vi.fn()} />);

    await screen.findByText("51 browser-local jobs");
    await user.click(screen.getByRole("button", { name: "Delete content replacement job job-01" }));
    await user.click(screen.getByRole("button", { name: "Confirm delete job-01" }));

    expect(await screen.findByRole("button", { name: "Resume content replacement job job-26" })).toBeVisible();
    expect(storage.list).toHaveBeenLastCalledWith({ offset: 0, limit: 25 });
    await user.click(screen.getByRole("button", { name: "Next jobs page" }));
    expect(await screen.findByRole("button", { name: "Resume content replacement job job-27" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Resume content replacement job job-26" })).not.toBeInTheDocument();
  });

  it("ignores a stale same-page reload when navigation wins after deletion", async () => {
    const user = userEvent.setup();
    const jobs = Array.from({ length: 51 }, (_, index) =>
      replacementJob(`job-${String(index + 1).padStart(2, "0")}`, "scan", "paused"),
    );
    const delayedReload = deferred<Awaited<ReturnType<ContentReplacementJobManagerStorage["list"]>>>();
    const storage = managerStorage(jobs);
    storage.list.mockImplementation(({ offset, limit }: { offset: number; limit: number }) => {
      if (storage.list.mock.calls.length === 2) return delayedReload.promise;
      return Promise.resolve({ jobs: jobs.slice(offset, offset + limit), totalCount: jobs.length });
    });
    render(<ContentReplacementJobManager storage={storage} onOpenJob={vi.fn()} />);

    await screen.findByText("51 browser-local jobs");
    await user.click(screen.getByRole("button", { name: "Delete content replacement job job-01" }));
    await user.click(screen.getByRole("button", { name: "Confirm delete job-01" }));
    await waitFor(() => expect(storage.list).toHaveBeenCalledTimes(2));
    await user.click(screen.getByRole("button", { name: "Next jobs page" }));
    expect(await screen.findByRole("button", { name: "Resume content replacement job job-27" })).toBeVisible();

    delayedReload.resolve({ jobs: jobs.slice(0, 25), totalCount: jobs.length });
    await waitFor(() => expect(storage.list).toHaveBeenCalledTimes(3));
    expect(screen.getByText("Page 2 of 2")).toBeVisible();
    expect(screen.getByRole("button", { name: "Resume content replacement job job-27" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Resume content replacement job job-02" })).not.toBeInTheDocument();
  });

  it("fences a stale page read when deletion contracts from a page the user already left", async () => {
    const user = userEvent.setup();
    const jobs = Array.from({ length: 26 }, (_, index) =>
      replacementJob(`job-${String(index + 1).padStart(2, "0")}`, "scan", "paused"),
    );
    const deleteGate = deferred<void>();
    const stalePageOne = deferred<Awaited<ReturnType<ContentReplacementJobManagerStorage["list"]>>>();
    const staleSnapshot = { jobs: jobs.slice(0, 25), totalCount: 26 };
    const storage = managerStorage(jobs);
    storage.list.mockImplementation(({ offset, limit }: { offset: number; limit: number }) => {
      if (storage.list.mock.calls.length === 3) return stalePageOne.promise;
      return Promise.resolve({ jobs: jobs.slice(offset, offset + limit), totalCount: jobs.length });
    });
    storage.delete.mockImplementation(async (id: string) => {
      await deleteGate.promise;
      const index = jobs.findIndex((job) => job.id === id);
      if (index >= 0) jobs.splice(index, 1);
    });
    render(<ContentReplacementJobManager storage={storage} onOpenJob={vi.fn()} />);

    await screen.findByText("26 browser-local jobs");
    await user.click(screen.getByRole("button", { name: "Next jobs page" }));
    await screen.findByRole("button", { name: "Resume content replacement job job-26" });
    await user.click(screen.getByRole("button", { name: "Delete content replacement job job-26" }));
    await user.click(screen.getByRole("button", { name: "Confirm delete job-26" }));
    await waitFor(() => expect(storage.delete).toHaveBeenCalledWith("job-26"));

    await user.click(screen.getByRole("button", { name: "Previous jobs page" }));
    await waitFor(() => expect(storage.list).toHaveBeenCalledTimes(3));
    deleteGate.resolve();

    await waitFor(() => expect(storage.list).toHaveBeenCalledTimes(4));
    expect(storage.list).toHaveBeenLastCalledWith({ offset: 0, limit: 25 });
    expect(await screen.findByText("25 browser-local jobs")).toBeVisible();
    stalePageOne.resolve(staleSnapshot);
    await stalePageOne.promise;
    await waitFor(() => expect(screen.queryByText("26 browser-local jobs")).not.toBeInTheDocument());
    expect(screen.queryByRole("navigation", { name: "Replacement job pagination" })).not.toBeInTheDocument();
    expect(storage.list).toHaveBeenCalledTimes(4);
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

function managerStorage(jobs: ContentReplacementJobSummary[]): ContentReplacementJobManagerStorage & {
  list: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
} {
  return {
    list: vi.fn(async ({ offset, limit }: { offset: number; limit: number }) => ({
      jobs: jobs.slice(offset, offset + limit),
      totalCount: jobs.length,
    })),
    delete: vi.fn(async (id: string) => {
      const index = jobs.findIndex((job) => job.id === id);
      if (index >= 0) jobs.splice(index, 1);
    }),
  };
}

function replacementJob(
  id: string,
  stage: ContentReplacementJobSummary["stage"],
  status: ContentReplacementJobSummary["status"],
  withRecovery = false,
): ContentReplacementJobSummary {
  return {
    id,
    baseUrl: "https://example.stackenterprise.co",
    stage,
    status,
    mappingCount: 1,
    proposedPostCount: 1,
    recoverySnapshotStatus: withRecovery ? "ready" : "none",
    scanCompatibility: "current",
    activeOperationKind: "none",
    updatedAt: "2026-09-02T12:00:00.000Z",
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => { resolve = next; });
  return { promise, resolve };
}
