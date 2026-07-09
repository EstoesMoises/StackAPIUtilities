import { describe, expect, it, vi } from "vitest";
import type { ReportId } from "../domain/types";
import { collectDataset, UnsupportedLiveDatasetError } from "./liveCollectors";
import { planDatasetsForReports } from "./datasetPlanner";

describe("planDatasetsForReports", () => {
  it("deduplicates shared datasets across selected reports", () => {
    expect(planDatasetsForReports(["tag-report", "api-user-report"])).toEqual([
      "tags",
      "users",
      "questions",
      "articles",
      "tagSmes",
      "reputationHistory",
      "communities",
    ]);
  });

  it("ignores later-phase reports", () => {
    expect(planDatasetsForReports(["webhook-report"])).toEqual([]);
  });

  it("accepts readonly report selections", () => {
    const selectedReports: readonly ReportId[] = ["inactive-users"];
    expect(planDatasetsForReports(selectedReports)).toEqual(["users"]);
  });

  it("plans concrete export datasets for Data Export live runs", () => {
    expect(planDatasetsForReports(["data-export"])).toEqual([
      "users",
      "userGroups",
      "tags",
      "articles",
      "questions",
      "answers",
      "comments",
    ]);
  });

  it("plans concrete content datasets for Interactions live runs", () => {
    expect(planDatasetsForReports(["interactions"])).toEqual([
      "users",
      "questions",
      "answers",
      "comments",
    ]);
  });
});

describe("collectDataset", () => {
  it("collects v2 datasets with the expected endpoint and pagesize", async () => {
    const clients = createMockClients();
    await expect(collectDataset("users", clients)).resolves.toEqual({
      records: [{ id: 1 }],
      pagination: { pageCount: 1, reachedMaxPages: false, hasMore: false },
    });
    expect(clients.v2.getPagedResult).toHaveBeenCalledWith("/users", { pagesize: "100" });
  });

  it("collects v3 datasets with the expected endpoint and pagesize", async () => {
    const clients = createMockClients();
    await expect(collectDataset("communities", clients)).resolves.toEqual({
      records: [{ id: "community" }],
      pagination: { pageCount: 1, reachedMaxPages: false, hasMore: false },
    });
    expect(clients.v3.getPagedResult).toHaveBeenCalledWith("/communities", { pagesize: "100" });
  });

  it("collects answer and comment export datasets through v2 endpoints", async () => {
    const clients = createMockClients();

    await expect(collectDataset("answers", clients)).resolves.toEqual({
      records: [{ id: 1 }],
      pagination: { pageCount: 1, reachedMaxPages: false, hasMore: false },
    });
    await expect(collectDataset("comments", clients)).resolves.toEqual({
      records: [{ id: 1 }],
      pagination: { pageCount: 1, reachedMaxPages: false, hasMore: false },
    });

    expect(clients.v2.getPagedResult).toHaveBeenCalledWith("/answers", { pagesize: "100" });
    expect(clients.v2.getPagedResult).toHaveBeenCalledWith("/comments", { pagesize: "100" });
  });

  it("collects tag SME records from previously collected tags", async () => {
    const clients = createMockClients();

    await expect(
      collectDataset("tagSmes", clients, {
        collectedDatasets: {
          tags: [{ name: "python" }, { tagName: "c#" }],
        },
      }),
    ).resolves.toEqual({
      records: [
        { tagName: "python", id: 1 },
        { tagName: "c#", id: 1 },
      ],
      pagination: { pageCount: 2, reachedMaxPages: false, hasMore: false },
    });

    expect(clients.v2.getPagedResult).toHaveBeenCalledWith("/tags/python/top-answerers/all_time", {
      pagesize: "100",
    });
    expect(clients.v2.getPagedResult).toHaveBeenCalledWith("/tags/c%23/top-answerers/all_time", {
      pagesize: "100",
    });
  });

  it("collects reputation history from previously collected users", async () => {
    const clients = createMockClients();

    await expect(
      collectDataset("reputationHistory", clients, {
        collectedDatasets: {
          users: [{ user_id: 1 }, { userId: 2 }],
        },
      }),
    ).resolves.toEqual({
      records: [{ id: 1 }],
      pagination: { pageCount: 1, reachedMaxPages: false, hasMore: false },
    });

    expect(clients.v2.getPagedResult).toHaveBeenCalledWith("/users/1;2/reputation-history", {
      pagesize: "100",
    });
  });

  it("throws an explicit error for unsupported live datasets", async () => {
    await expect(collectDataset("dataExport", createMockClients())).rejects.toThrow(UnsupportedLiveDatasetError);
    await expect(collectDataset("dataExport", createMockClients())).rejects.toThrow(
      "Dataset dataExport is not mapped for live API collection yet.",
    );
  });
});

function createMockClients() {
  return {
    v2: {
      getPagedResult: vi.fn().mockResolvedValue({
        items: [{ id: 1 }],
        pageCount: 1,
        reachedMaxPages: false,
        hasMore: false,
      }),
      getPagedItems: vi.fn().mockResolvedValue([{ id: 1 }]),
    },
    v3: {
      getPagedResult: vi.fn().mockResolvedValue({
        items: [{ id: "community" }],
        pageCount: 1,
        reachedMaxPages: false,
        hasMore: false,
      }),
      getPagedItems: vi.fn().mockResolvedValue([{ id: "community" }]),
    },
  };
}
