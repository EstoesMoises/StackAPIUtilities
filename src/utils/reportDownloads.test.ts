import { describe, expect, it, vi } from "vitest";
import { buildReportCsvDownload, downloadReportCsv } from "./reportDownloads";
import { downloadTextFile } from "./downloads";

vi.mock("./downloads", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./downloads")>();

  return {
    ...actual,
    downloadTextFile: vi.fn(),
  };
});

describe("reportDownloads", () => {
  it("builds a Tag Health CSV download for Tag Report outputs", () => {
    const download = buildReportCsvDownload({
      reportId: "tag-report",
      datasetName: "tags",
      loadedAt: "2026-07-08T14:30:00.000Z",
      source: "live-api",
      periodRole: "current",
      records: [
        {
          tagName: "python",
          totalPageViews: 500,
          tagWatchers: 20,
          totalSmes: 0,
          questionCount: 8,
          answerCount: 11,
          questionsNoAnswers: 1,
          medianFirstAnswerHours: 12,
        },
      ],
    });

    expect(download.fileName).toBe("tag-report-tag-health-current-2026-07-08.csv");
    expect(download.mimeType).toBe("text/csv;charset=utf-8");
    expect(download.contents).toBe(
      [
        "tag_name,health_status,page_views,question_count,answer_count,sme_count,watcher_count,unanswered_questions,median_first_answer_hours,recommended_action",
        "python,Needs SME coverage,500,8,11,0,20,1,12,Assign or confirm SMEs for this tag.",
      ].join("\n"),
    );
  });

  it("uses comparison in the filename for comparison report output", () => {
    const download = buildReportCsvDownload({
      reportId: "tag-report",
      datasetName: "tags",
      loadedAt: "2026-07-08T14:30:00.000Z",
      source: "upload",
      periodRole: "comparison",
      records: [],
    });

    expect(download.fileName).toBe("tag-report-tag-health-comparison-2026-07-08.csv");
  });

  it("downloads report CSVs through the shared text download helper", () => {
    downloadReportCsv({
      reportId: "tag-report",
      datasetName: "tags",
      loadedAt: "2026-07-08T14:30:00.000Z",
      source: "live-api",
      periodRole: "current",
      records: [{ tagName: "python", totalPageViews: 10 }],
    });

    expect(downloadTextFile).toHaveBeenCalledWith(
      "tag-report-tag-health-current-2026-07-08.csv",
      expect.stringContaining("tag_name,health_status,page_views"),
      "text/csv;charset=utf-8",
    );
  });
});
