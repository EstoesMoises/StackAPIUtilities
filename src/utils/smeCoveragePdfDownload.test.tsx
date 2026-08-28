import { isValidElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildSmeCoverageMarkdown } from "../utilities/smeCoverage/exports";
import {
  completeSmeCoverageDecisionPack,
  emptySmeCoverageDecisionPack,
} from "../test/fixtures/smeCoverageFixtures";
import { buildSmeCoverageMarkdownDownload } from "./smeCoverageDownloads";
import { downloadBlobFile } from "./downloads";
import { pdf } from "@react-pdf/renderer";
import {
  buildPdfFileName,
  downloadSmeCoveragePdf,
} from "./smeCoveragePdfDownload";

vi.mock("@react-pdf/renderer", () => ({ pdf: vi.fn() }));
vi.mock("../utilities/smeCoverage/exports", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../utilities/smeCoverage/exports")>();
  return { ...actual, buildSmeCoverageMarkdown: vi.fn(actual.buildSmeCoverageMarkdown) };
});
vi.mock("../utilities/smeCoverage/SmeCoveragePdfDocument", () => ({
  SmeCoveragePdfDocument: vi.fn(() => null),
}));
vi.mock("./downloads", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./downloads")>();
  return { ...actual, downloadBlobFile: vi.fn() };
});

describe("SME coverage PDF download", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("awaits renderer completion before downloading the exact Blob and paired filename", async () => {
    const pack = completeSmeCoverageDecisionPack();
    const blob = new Blob(["%PDF-test"], { type: "application/pdf" });
    let resolveBlob!: (value: Blob) => void;
    const toBlob = vi.fn(() => new Promise<Blob>((resolve) => {
      resolveBlob = resolve;
    }));
    vi.mocked(pdf).mockReturnValue({ toBlob } as unknown as ReturnType<typeof pdf>);

    const pending = downloadSmeCoveragePdf(pack);
    await vi.waitFor(() => expect(toBlob).toHaveBeenCalledOnce());
    expect(downloadBlobFile).not.toHaveBeenCalled();

    resolveBlob(blob);
    await pending;

    expect(pdf).toHaveBeenCalledWith(expect.objectContaining({
      props: expect.objectContaining({
        model: expect.objectContaining({ title: "SME Coverage Executive Brief" }),
      }),
    }));
    expect(downloadBlobFile).toHaveBeenCalledWith(buildPdfFileName(pack), blob);
  });

  it("propagates renderer failures without attempting a download", async () => {
    const failure = new Error("PDF renderer failed");
    vi.mocked(pdf).mockReturnValue({
      toBlob: vi.fn().mockRejectedValue(failure),
    } as unknown as ReturnType<typeof pdf>);

    await expect(downloadSmeCoveragePdf(emptySmeCoverageDecisionPack())).rejects.toBe(failure);
    expect(downloadBlobFile).not.toHaveBeenCalled();
  });

  it.each([
    ["example_stack.enterprise_co", "example-stack-enterprise-co"],
    ["  ***  ", "report"],
    ["North America / Support", "North-America-Support"],
  ])("matches the Markdown stem for host %s", (instanceHost, expectedHost) => {
    const source = completeSmeCoverageDecisionPack();
    const pack = {
      ...source,
      snapshot: { ...source.snapshot, instanceHost },
    };
    const markdownName = buildSmeCoverageMarkdownDownload(pack).fileName;

    expect(buildPdfFileName(pack)).toBe(markdownName.replace(/\.md$/, ".pdf"));
    expect(buildPdfFileName(pack)).toBe(
      `sme-coverage-decision-pack-${expectedHost}-2026-07-30.pdf`,
    );
  });

  it("builds the PDF filename without serializing Markdown contents", () => {
    buildPdfFileName(completeSmeCoverageDecisionPack());

    expect(buildSmeCoverageMarkdown).not.toHaveBeenCalled();
  });

  it("passes a React document element to the renderer", async () => {
    const blob = new Blob(["pdf"]);
    vi.mocked(pdf).mockReturnValue({
      toBlob: vi.fn().mockResolvedValue(blob),
    } as unknown as ReturnType<typeof pdf>);

    await downloadSmeCoveragePdf(completeSmeCoverageDecisionPack());

    expect(isValidElement(vi.mocked(pdf).mock.calls[0][0])).toBe(true);
  });
});
