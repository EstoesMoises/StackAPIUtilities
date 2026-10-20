import { describe, expect, it, vi } from "vitest";
import type { SessionDataset } from "../domain/types";
import { buildDatasetDownload, downloadSessionDataset } from "./datasetDownloads";
import { downloadTextFile } from "./downloads";

vi.mock("./downloads", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./downloads")>();

  return {
    ...actual,
    downloadTextFile: vi.fn(),
  };
});

describe("datasetDownloads", () => {
  it("exports API dates as UTC datetimes without converting IDs or changing raw JSON", () => {
    const dataset = liveDataset();
    dataset.records = [{
      user_id: 1_735_689_600,
      creation_date: 1_735_689_600,
      last_access_date: "1735734896000",
      last_modified_date: "2025-01-01T13:54:56.1234567+01:00",
      creationDate: "2025-01-01T12:54:56",
      invalid_date: "2025-02-30",
      missing_date: null,
      score: 1_735_689_600,
    }];
    expect(buildDatasetDownload(dataset, "csv").contents).toBe([
      "user_id,creation_date,last_access_date,last_modified_date,creationDate,invalid_date,missing_date,score",
      "1735689600,2025-01-01 00:00:00,2025-01-01 12:34:56,2025-01-01 12:54:56.123,2025-01-01 12:54:56,2025-02-30,,1735689600",
    ].join("\n"));
    expect(JSON.parse(buildDatasetDownload(dataset, "json").contents)).toEqual(dataset.records);
    expect(dataset.records[0]).toMatchObject({ creation_date: 1_735_689_600 });
  });
  it("builds a CSV download from raw live API records", () => {
    const download = buildDatasetDownload(liveDataset(), "csv");

    expect(download).toEqual({
      fileName: "inactive-users-users-current-2026-07-03.csv",
      contents: "user_id,display_name\n1,Ada\n2,Grace",
      mimeType: "text/csv;charset=utf-8",
    });
  });

  it("builds a JSON download from raw live API records", () => {
    const download = buildDatasetDownload(liveDataset(), "json");

    expect(download.fileName).toBe("inactive-users-users-current-2026-07-03.json");
    expect(download.mimeType).toBe("application/json;charset=utf-8");
    expect(download.contents).toBe(
      '[\n  {\n    "user_id": 1,\n    "display_name": "Ada"\n  },\n  {\n    "user_id": 2,\n    "display_name": "Grace"\n  }\n]',
    );
  });

  it("downloads a session dataset through the shared text download helper", () => {
    downloadSessionDataset(liveDataset(), "csv");

    expect(downloadTextFile).toHaveBeenCalledWith(
      "inactive-users-users-current-2026-07-03.csv",
      "user_id,display_name\n1,Ada\n2,Grace",
      "text/csv;charset=utf-8",
    );
  });
});

function liveDataset(): SessionDataset {
  return {
    id: "dataset-1",
    snapshotId: "snapshot-1",
    reportId: "inactive-users",
    name: "users",
    records: [
      { user_id: 1, display_name: "Ada" },
      { user_id: 2, display_name: "Grace" },
    ],
    loadedAt: "2026-07-03T12:00:00.000Z",
    source: "live-api",
    periodRole: "current",
    scope: { startDate: "2026-06-01", endDate: "2026-06-30" },
  };
}
