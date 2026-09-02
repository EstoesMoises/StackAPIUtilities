import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SessionDataset } from "../domain/types";
import { downloadSessionDataset } from "../utils/datasetDownloads";
import type { PersistedContentReplacementJob } from "../writeTools/contentReplacement/types";
import type { ContentReplacementJobSummary } from "../utils/browserContentReplacementStorage";
import type { ContentReplacementJobManagerStorage } from "./ContentReplacementJobManager";
import { DatasetsPanel } from "./DatasetsPanel";

vi.mock("../utils/datasetDownloads", () => ({
  downloadSessionDataset: vi.fn(),
}));

afterEach(() => {
  vi.clearAllMocks();
});

describe("DatasetsPanel", () => {
  it("shows an empty state before datasets are loaded", () => {
    render(
      <DatasetsPanel
        datasets={[]}
        onRemoveDataset={() => undefined}
        onFlushDatasets={() => undefined}
      />,
    );

    expect(screen.getByRole("heading", { name: "Datasets" })).toBeInTheDocument();
    expect(screen.getByText("No datasets loaded or stored in this browser.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Flush stored datasets" })).not.toBeInTheDocument();
  });

  it("lists scoped live datasets and removes a dataset by id", async () => {
    const user = userEvent.setup();
    const onRemoveDataset = vi.fn();

    render(
      <DatasetsPanel
        datasets={[liveDataset()]}
        onRemoveDataset={onRemoveDataset}
        onFlushDatasets={() => undefined}
      />,
    );

    expect(screen.getByText("users")).toBeInTheDocument();
    expect(screen.getByText("Inactive Users")).toBeInTheDocument();
    expect(screen.getByText("Current")).toBeInTheDocument();
    expect(screen.getByText("2026-06-01 to 2026-06-30")).toBeInTheDocument();
    expect(screen.getByText("2 records")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Remove users current dataset" }));

    expect(onRemoveDataset).toHaveBeenCalledWith("dataset-1");
  });

  it("downloads scoped live datasets as CSV and JSON", async () => {
    const user = userEvent.setup();
    const dataset = liveDataset();

    render(
      <DatasetsPanel
        datasets={[dataset]}
        onRemoveDataset={() => undefined}
        onFlushDatasets={() => undefined}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Download users current dataset as CSV" }));
    await user.click(screen.getByRole("button", { name: "Download users current dataset as JSON" }));

    expect(downloadSessionDataset).toHaveBeenNthCalledWith(1, dataset, "csv");
    expect(downloadSessionDataset).toHaveBeenNthCalledWith(2, dataset, "json");
  });

  it("shows utility workflow provenance and source-labeled accessible actions", async () => {
    const user = userEvent.setup();
    const dataset = utilityDataset();
    const onRemoveDataset = vi.fn();

    render(
      <DatasetsPanel
        datasets={[dataset]}
        onRemoveDataset={onRemoveDataset}
        onFlushDatasets={() => undefined}
      />,
    );

    expect(screen.getByRole("columnheader", { name: "Workflow" })).toBeInTheDocument();
    expect(screen.getByText("SME Coverage Analyzer")).toBeInTheDocument();
    expect(screen.getByText("Snapshot")).toBeInTheDocument();
    expect(screen.getByText("All-time demand · Current SME coverage")).toBeInTheDocument();
    expect(screen.getByText("Live API")).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: "Download SME Coverage Analyzer tags snapshot dataset as CSV" }),
    );
    await user.click(
      screen.getByRole("button", { name: "Download SME Coverage Analyzer tags snapshot dataset as JSON" }),
    );
    await user.click(
      screen.getByRole("button", { name: "Remove SME Coverage Analyzer tags snapshot dataset" }),
    );

    expect(downloadSessionDataset).toHaveBeenNthCalledWith(1, dataset, "csv");
    expect(downloadSessionDataset).toHaveBeenNthCalledWith(2, dataset, "json");
    expect(onRemoveDataset).toHaveBeenCalledWith("utility-dataset-1");
  });

  it("shows a bulk flush action only when datasets exist", async () => {
    const user = userEvent.setup();
    const onFlushDatasets = vi.fn();

    render(
      <DatasetsPanel
        datasets={[liveDataset()]}
        onRemoveDataset={() => undefined}
        onFlushDatasets={onFlushDatasets}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Flush stored datasets" }));

    expect(onFlushDatasets).toHaveBeenCalledOnce();
  });

  it("hides the bulk flush action when no flush callback is available", () => {
    render(<DatasetsPanel datasets={[liveDataset()]} onRemoveDataset={() => undefined} />);

    expect(screen.queryByRole("button", { name: "Flush stored datasets" })).not.toBeInTheDocument();
  });

  it("opens browser-local replacement jobs without treating their post content as a dataset", async () => {
    const user = userEvent.setup();
    const job = replacementJob();
    const storage = replacementStorage([job]);
    const onOpenContentReplacementJob = vi.fn();
    render(
      <DatasetsPanel
        datasets={[]}
        onRemoveDataset={vi.fn()}
        contentReplacementStorage={storage}
        onOpenContentReplacementJob={onOpenContentReplacementJob}
      />,
    );

    expect(await screen.findByRole("heading", { name: "Browser-local replacement jobs" })).toBeVisible();
    expect(screen.getByText(/sensitive local data/i)).toBeVisible();
    expect(screen.getByText("No datasets loaded or stored in this browser.")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Resume content replacement job resume-me" }));
    expect(onOpenContentReplacementJob).toHaveBeenCalledWith(job.id);
    expect(screen.queryByText(job.configuration.rules[0].find, { selector: "td" })).not.toBeInTheDocument();
  });

  it("removes a confirmed replacement job and its recovery record from the Datasets area", async () => {
    const user = userEvent.setup();
    const storage = replacementStorage([replacementJob()]);
    const onContentReplacementJobDeleted = vi.fn();
    render(
      <DatasetsPanel
        datasets={[]}
        onRemoveDataset={vi.fn()}
        contentReplacementStorage={storage}
        onOpenContentReplacementJob={vi.fn()}
        onContentReplacementJobDeleted={onContentReplacementJobDeleted}
      />,
    );

    await screen.findByText("Review complete");
    await user.click(screen.getByRole("button", { name: "Delete content replacement job resume-me" }));
    expect(storage.delete).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Confirm delete resume-me" }));

    expect(await screen.findByRole("status")).toHaveTextContent(/recovery snapshots.*deleted/i);
    expect(onContentReplacementJobDeleted).toHaveBeenCalledWith("resume-me");
    expect(screen.queryByText("Review complete")).not.toBeInTheDocument();
  });
});

function replacementStorage(jobs: PersistedContentReplacementJob[]): ContentReplacementJobManagerStorage & {
  list: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
} {
  const summaries: ContentReplacementJobSummary[] = jobs.map((job) => ({
    id: job.id,
    baseUrl: job.baseUrl,
    stage: job.stage,
    status: job.status,
    mappingCount: job.configuration.rules.length,
    proposedPostCount: job.progress.proposalsFound,
    recoverySnapshotStatus: job.recoverySnapshotStatus,
    updatedAt: job.updatedAt,
  }));
  return {
    list: vi.fn(async ({ offset, limit }: { offset: number; limit: number }) => ({
      jobs: summaries.slice(offset, offset + limit),
      totalCount: summaries.length,
    })),
    delete: vi.fn(async (id: string) => {
      const index = summaries.findIndex((summary) => summary.id === id);
      if (index >= 0) summaries.splice(index, 1);
    }),
  };
}

function replacementJob(): PersistedContentReplacementJob {
  return {
    schemaVersion: 1,
    revision: 2,
    id: "resume-me",
    fingerprint: "f".repeat(64),
    baseUrl: "https://example.stackenterprise.co",
    target: { kind: "enterprise-main" },
    configuration: {
      target: { kind: "enterprise-main" },
      contentTypes: { questions: true, answers: true, articles: true },
      discovery: { mode: "full" },
      rules: [{ id: "rule-1", find: "Private old post body", replace: "New" }],
      options: { caseSensitive: true, wholeTerm: true, replaceInCode: false },
    },
    stage: "review",
    status: "completed",
    inventoryQueue: [],
    detailQueue: [],
    progress: {
      questionPages: 1, answerPages: 1, articlePages: 1, inventoryItems: 1,
      detailsInspected: 1, proposalsFound: 1, protectedOccurrences: 0,
      applyCompleted: 0, recoveryCompleted: 0,
    },
    proposals: { "question:1": {} as never },
    recoverySnapshotStatus: "ready",
    createdAt: "2026-09-01T12:00:00.000Z",
    updatedAt: "2026-09-02T12:00:00.000Z",
  };
}

function liveDataset(): SessionDataset {
  return {
    id: "dataset-1",
    snapshotId: "snapshot-1",
    reportId: "inactive-users",
    name: "users",
    records: [{ user_id: 1 }, { user_id: 2 }],
    loadedAt: "2026-07-03T12:00:00.000Z",
    source: "live-api",
    periodRole: "current",
    scope: { startDate: "2026-06-01", endDate: "2026-06-30" },
  };
}

function utilityDataset(): SessionDataset {
  return {
    id: "utility-dataset-1",
    snapshotId: "utility-snapshot-1",
    utilityId: "sme-coverage-analyzer",
    name: "tags",
    records: [{ name: "python" }],
    loadedAt: "2026-07-30T12:00:00.000Z",
    source: "live-api",
  };
}
