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
});

describe("collectDataset", () => {
  it("collects v2 datasets with the expected endpoint and pagesize", async () => {
    const clients = createMockClients();
    await expect(collectDataset("users", clients)).resolves.toEqual([{ id: 1 }]);
    expect(clients.v2.getPagedItems).toHaveBeenCalledWith("/users", { pagesize: "100" });
  });

  it("collects v3 datasets with the expected endpoint and pagesize", async () => {
    const clients = createMockClients();
    await expect(collectDataset("communities", clients)).resolves.toEqual([{ id: "community" }]);
    expect(clients.v3.getPagedItems).toHaveBeenCalledWith("/communities", { pagesize: "100" });
  });

  it("throws an explicit error for unsupported live datasets", async () => {
    await expect(collectDataset("tagSmes", createMockClients())).rejects.toThrow(UnsupportedLiveDatasetError);
    await expect(collectDataset("tagSmes", createMockClients())).rejects.toThrow(
      "Dataset tagSmes is not mapped for live API collection yet.",
    );
  });
});

function createMockClients() {
  return {
    v2: {
      getPagedItems: vi.fn().mockResolvedValue([{ id: 1 }]),
    },
    v3: {
      getPagedItems: vi.fn().mockResolvedValue([{ id: "community" }]),
    },
  };
}
