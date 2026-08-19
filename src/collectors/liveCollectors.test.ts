import { describe, expect, it, vi } from "vitest";
import type { SessionCredentials } from "../domain/types";
import { createLiveCollectorClients } from "./liveCollectorClients";
import { collectDataset, getLiveDatasetClient } from "./liveCollectors";

const basicCredentials: SessionCredentials = {
  instanceType: "basic-business",
  baseUrl: "https://stackoverflowteams.com/c/example-team",
  pat: "pat",
};

describe("live collectors", () => {
  it("collects assigned-SME counts from the Basic/Business v3 tags endpoint with pageSize", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({
        items: [{ name: "piper", subjectMatterExpertCount: 1 }],
        totalPages: 1,
      }), { status: 200 }),
    );
    const clients = createLiveCollectorClients(basicCredentials, { fetchFn: fetchMock });

    await expect(collectDataset("tagSmeCounts", clients, { pageSize: 50 })).resolves.toEqual({
      records: [{ name: "piper", subjectMatterExpertCount: 1 }],
      pagination: { pageCount: 1, reachedMaxPages: false, hasMore: false },
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0].toString()).toBe(
      "https://api.stackoverflowteams.com/v3/teams/example-team/tags?pageSize=50&page=1",
    );
  });

  it("maps tags to v2 and assigned-SME counts to v3", async () => {
    expect(getLiveDatasetClient("tags")).toBe("v2");
    expect(getLiveDatasetClient("tagSmeCounts")).toBe("v3");
    expect(getLiveDatasetClient("tagLastUsed")).toBe("v2");
  });
});
