import type { DatasetName } from "../domain/types";

export interface LiveCollectorClients {
  v2: DatasetClient;
  v3: DatasetClient;
}

export interface DatasetClient {
  getPagedItems(path: string, query?: Record<string, string>): Promise<unknown[]>;
}

export class UnsupportedLiveDatasetError extends Error {
  constructor(public readonly dataset: DatasetName) {
    super(`Dataset ${dataset} is not available through live browser API collection yet.`);
  }
}

export async function collectDataset(dataset: DatasetName, clients: LiveCollectorClients): Promise<unknown[]> {
  switch (dataset) {
    case "users":
      return clients.v2.getPagedItems("/users", { pagesize: "100" });
    case "tags":
      return clients.v2.getPagedItems("/tags", { pagesize: "100" });
    case "questions":
      return clients.v2.getPagedItems("/questions", { pagesize: "100" });
    case "articles":
      return clients.v2.getPagedItems("/articles", { pagesize: "100" });
    case "communities":
      return clients.v3.getPagedItems("/communities", { pagesize: "100" });
    case "userGroups":
      return clients.v3.getPagedItems("/user-groups", { pagesize: "100" });
    case "tagSmes":
    case "reputationHistory":
    case "interactions":
    case "dataExport":
      throw new UnsupportedLiveDatasetError(dataset);
    default:
      throw new UnsupportedLiveDatasetError(dataset);
  }
}
