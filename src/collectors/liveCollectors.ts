import type { DatasetName } from "../domain/types";

export interface LiveCollectorClients {
  v2: DatasetClient;
  v3: DatasetClient;
}

export interface DatasetClient {
  getPagedItems(path: string, query?: Record<string, string>): Promise<unknown[]>;
}

interface LiveDatasetEndpoint {
  client: keyof LiveCollectorClients;
  path: string;
}

const liveDatasetEndpoints: Partial<Record<DatasetName, LiveDatasetEndpoint>> = {
  users: { client: "v2", path: "/users" },
  tags: { client: "v2", path: "/tags" },
  questions: { client: "v2", path: "/questions" },
  articles: { client: "v2", path: "/articles" },
  communities: { client: "v3", path: "/communities" },
  userGroups: { client: "v3", path: "/user-groups" },
};

export class UnsupportedLiveDatasetError extends Error {
  constructor(public readonly dataset: DatasetName) {
    super(`Dataset ${dataset} is not mapped for live API collection yet.`);
  }
}

export function isLiveDatasetCollectable(dataset: DatasetName): boolean {
  return dataset in liveDatasetEndpoints;
}

export function getUnsupportedLiveDatasets(datasets: readonly DatasetName[]): DatasetName[] {
  return datasets.filter((dataset) => !isLiveDatasetCollectable(dataset));
}

export async function collectDataset(dataset: DatasetName, clients: LiveCollectorClients): Promise<unknown[]> {
  const endpoint = liveDatasetEndpoints[dataset];

  if (!endpoint) {
    throw new UnsupportedLiveDatasetError(dataset);
  }

  return clients[endpoint.client].getPagedItems(endpoint.path, { pagesize: "100" });
}
