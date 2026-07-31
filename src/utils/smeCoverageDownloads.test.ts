import { describe, expect, it, vi } from "vitest";
import type { SmeCoverageDecisionPack } from "../utilities/smeCoverage/model";
import {
  buildSmeCoverageCsvDownload,
  buildSmeCoverageMarkdownDownload,
  downloadSmeCoverageEvidenceCsv,
  downloadSmeCoverageMarkdown,
} from "./smeCoverageDownloads";
import { downloadTextFile } from "./downloads";

vi.mock("./downloads", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./downloads")>();

  return { ...actual, downloadTextFile: vi.fn() };
});

describe("SME coverage downloads", () => {
  it("builds stable Markdown and CSV download descriptors", () => {
    const pack = downloadPack();

    expect(buildSmeCoverageMarkdownDownload(pack)).toMatchObject({
      fileName: "sme-coverage-decision-pack-example-stackenterprise-co-2026-07-30.md",
      mimeType: "text/markdown;charset=utf-8",
    });
    expect(buildSmeCoverageCsvDownload(pack)).toMatchObject({
      fileName: "sme-coverage-evidence-example-stackenterprise-co-2026-07-30.csv",
      mimeType: "text/csv;charset=utf-8",
    });
  });

  it("downloads the exact descriptors through the shared text-file seam", () => {
    const pack = downloadPack();
    const markdown = buildSmeCoverageMarkdownDownload(pack);
    const csv = buildSmeCoverageCsvDownload(pack);

    downloadSmeCoverageMarkdown(pack);
    downloadSmeCoverageEvidenceCsv(pack);

    expect(downloadTextFile).toHaveBeenNthCalledWith(1, markdown.fileName, markdown.contents, markdown.mimeType);
    expect(downloadTextFile).toHaveBeenNthCalledWith(2, csv.fileName, csv.contents, csv.mimeType);
  });
});

function downloadPack(): SmeCoverageDecisionPack {
  return {
    snapshot: {
      instanceHost: "example.stackenterprise.co",
      generatedAt: "2026-07-30T12:00:00.000Z",
      scopeLabel: "All-time demand · Current SME coverage",
      completeness: "Complete",
      pageSize: 100,
      maxPagesPerDataset: 20,
    },
    warnings: [],
    summary: {
      tagsAnalyzed: 0,
      tagsWithSmes: 0,
      immediateGaps: 0,
      criticalUnderCoverage: 0,
      lightCoverage: 0,
      unknownRows: 0,
    },
    overview: "No priority coverage gaps were found in the analyzed evidence.",
    assessment: "No priority coverage gaps were found in the analyzed evidence.",
    findings: { immediateGaps: [], criticalUnderCoverage: [], lightCoverage: [] },
    methodology: {
      activityQuestionMinimum: 1,
      activityPageViewThresholdExclusive: 25,
      activeTagMedianPageViews: null,
      coveredActiveSampleSize: 0,
      p75PageViewsPerSme: null,
      p90PageViewsPerSme: null,
      percentileSampleSufficient: false,
      ratioFormula: "pageViews / smeCount",
      roundingRule: "Nearest whole page view for display; unrounded for calculation",
    },
    evidence: [],
  };
}
