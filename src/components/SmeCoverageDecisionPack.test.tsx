import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  completeSmeCoverageDecisionPack,
  emptySmeCoverageDecisionPack,
  insufficientSampleSmeCoverageDecisionPack,
  partialSmeCoverageDecisionPack,
} from "../test/fixtures/smeCoverageFixtures";
import {
  downloadSmeCoverageEvidenceCsv,
  downloadSmeCoverageMarkdown,
} from "../utils/smeCoverageDownloads";
import { SmeCoverageDecisionPack } from "./SmeCoverageDecisionPack";

vi.mock("../utils/smeCoverageDownloads", () => ({
  downloadSmeCoverageEvidenceCsv: vi.fn(),
  downloadSmeCoverageMarkdown: vi.fn(),
}));

afterEach(() => {
  vi.clearAllMocks();
});

describe("SmeCoverageDecisionPack", () => {
  it("renders warnings before every conclusion and composes the full prepared result", () => {
    const pack = partialSmeCoverageDecisionPack();
    render(<SmeCoverageDecisionPack pack={pack} onRunAgain={vi.fn()} />);

    const warningStack = screen.getByRole("region", { name: "Evidence notes" });
    const summary = screen.getByRole("heading", { name: "Executive summary" });
    expect(
      warningStack.compareDocumentPosition(summary) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(within(warningStack).getAllByRole("alert")).toHaveLength(pack.warnings.length);
    expect(
      within(warningStack).getByText(/demand metrics are unavailable or invalid/i),
    ).toBeInTheDocument();

    expect(screen.getByText("example.stackenterprise.co")).toBeInTheDocument();
    expect(screen.getByText("2026-07-30T12:00:00.000Z")).toBeInTheDocument();
    expect(screen.getByText("All-time demand · Current SME coverage")).toBeInTheDocument();
    expect(screen.getByText("All available data collected")).toBeInTheDocument();
    expect(
      screen.getByText("Analysis quality: Partial", { selector: ".sme-completeness-badge" }),
    ).toBeInTheDocument();
    const resultHeader = screen
      .getByRole("heading", { name: "SME coverage result" })
      .closest<HTMLElement>(".sme-result-header");
    expect(resultHeader).not.toBeNull();
    expect(within(resultHeader!).getByText("Analysis quality: Partial")).toBeInTheDocument();
    expect(screen.queryByText("Page size")).not.toBeInTheDocument();
    expect(screen.queryByText("Max pages per dataset")).not.toBeInTheDocument();

    for (const [label, value] of [
      ["Tags analyzed", "6"],
      ["Tags with SMEs", "4"],
      ["Immediate gaps", "1"],
      ["Critical under-coverage", "1"],
      ["Light-coverage tags", "1"],
    ]) {
      const metric = screen.getByText(label, { selector: "dt" }).closest("div");
      expect(metric).not.toBeNull();
      expect(metric).toHaveTextContent(value);
    }

    expect(screen.getByText(pack.overview)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Immediate no-SME risks" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Highest-demand critical gaps" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Light SME coverage" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Copy-ready assessment" })).toBeInTheDocument();
    expect(screen.getByText("Methodology and evidence quality")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Evidence" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy assessment" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Download Markdown" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Download CSV" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Run again" })).toBeInTheDocument();
  });

  it("states complete, partial, empty, and insufficient-sample result conditions", () => {
    const { rerender } = render(
      <SmeCoverageDecisionPack pack={completeSmeCoverageDecisionPack()} onRunAgain={vi.fn()} />,
    );
    expect(screen.getByText("Analysis quality: Complete", { selector: ".sme-completeness-badge" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Evidence notes" })).not.toBeInTheDocument();

    rerender(<SmeCoverageDecisionPack pack={partialSmeCoverageDecisionPack()} onRunAgain={vi.fn()} />);
    expect(screen.getByText("Analysis quality: Partial", { selector: ".sme-completeness-badge" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Evidence notes" })).toBeInTheDocument();

    rerender(<SmeCoverageDecisionPack pack={emptySmeCoverageDecisionPack()} onRunAgain={vi.fn()} />);
    expect(screen.getByText("Analysis quality: Empty", { selector: ".sme-completeness-badge" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Evidence notes" })).toHaveTextContent(
      /only 0 eligible covered active tags/i,
    );
    expect(
      screen.getByText("No evidence rows were available, so no coverage conclusion was produced."),
    ).toBeInTheDocument();

    rerender(
      <SmeCoverageDecisionPack
        pack={insufficientSampleSmeCoverageDecisionPack()}
        onRunAgain={vi.fn()}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent(/only 1 eligible covered active tag/i);
  });

  it("shows every prepared finding field, explicit unavailable values, and tier-specific empty states", async () => {
    const user = userEvent.setup();
    const writeText = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue(undefined);
    const { rerender } = render(
      <SmeCoverageDecisionPack pack={completeSmeCoverageDecisionPack()} onRunAgain={vi.fn()} />,
    );

    const immediate = screen.getByRole("region", { name: "Immediate no-SME risks" });
    expect(within(immediate).getByRole("columnheader", { name: "Tag" })).toBeInTheDocument();
    for (const header of [
      "Page views",
      "SMEs",
      "Questions",
      "Question-count basis",
      "Page views per SME",
      "Tier reason",
      "Recommended next action",
    ]) {
      expect(within(immediate).getByRole("columnheader", { name: header })).toBeInTheDocument();
    }
    expect(within(immediate).getByText("No SME")).toBeInTheDocument();

    const critical = screen.getByRole("region", { name: "Highest-demand critical gaps" });
    expect(within(critical).getByText("3,000.49")).toBeInTheDocument();
    expect(within(critical).getByText("3,000")).toBeInTheDocument();
    expect(within(critical).getByText("Complete question enumeration")).toBeInTheDocument();

    const assessment = completeSmeCoverageDecisionPack().assessment;
    await user.click(screen.getByRole("button", { name: "Copy assessment" }));
    expect(writeText).toHaveBeenCalledWith(assessment);

    const methodologySummary = screen.getByText("Methodology and evidence quality");
    await user.click(methodologySummary);
    const methodology = methodologySummary.closest("details")!;
    expect(within(methodology).getByText("At least 1 question or more than 25 page views")).toBeInTheDocument();
    expect(within(methodology).getByText("pageViews / smeCount")).toBeInTheDocument();
    expect(within(methodology).getByText("2,500.8")).toBeInTheDocument();
    expect(within(methodology).getByText("4")).toBeInTheDocument();
    expect(within(methodology).getByText("1,250")).toBeInTheDocument();
    expect(within(methodology).getByText("3,000")).toBeInTheDocument();
    expect(within(methodology).queryByText("1,250.4")).not.toBeInTheDocument();
    expect(within(methodology).queryByText("3,000.49")).not.toBeInTheDocument();
    expect(within(methodology).getByText(/nearest-rank/i)).toBeInTheDocument();
    expect(within(methodology).getByText(/empirical-percentile/i)).toBeInTheDocument();
    expect(within(methodology).getByText(/nearest whole page view for display; unrounded for calculation/i)).toBeInTheDocument();
    expect(within(methodology).getByText(/question-count precedence/i)).toBeInTheDocument();
    expect(within(methodology).getByText(/complete question enumeration.*all-time tag total.*partial question sample.*unavailable/i)).toBeInTheDocument();
    expect(within(methodology).getByText("Analysis quality").closest("div")).toHaveTextContent(
      "Complete",
    );
    expect(
      within(methodology).getByText(/complete, partial, and empty are analysis-quality states/i),
    ).toHaveTextContent(/independent of collection status/i);
    expect(within(methodology).getByText(/review the evidence notes/i)).toBeInTheDocument();
    expect(within(methodology).queryByText(/result completeness|warnings above/i)).not.toBeInTheDocument();

    rerender(<SmeCoverageDecisionPack pack={emptySmeCoverageDecisionPack()} onRunAgain={vi.fn()} />);
    expect(screen.getByText("No immediate no-SME risks are listed in this decision pack.")).toBeInTheDocument();
    expect(screen.getByText("No highest-demand critical gaps are listed in this decision pack.")).toBeInTheDocument();
    expect(screen.getByText("No light SME coverage risks are listed in this decision pack.")).toBeInTheDocument();

    rerender(
      <SmeCoverageDecisionPack
        pack={insufficientSampleSmeCoverageDecisionPack()}
        onRunAgain={vi.fn()}
      />,
    );
    const methodologySummaries = screen.getAllByText("Methodology and evidence quality");
    const smallSampleSummary = methodologySummaries[methodologySummaries.length - 1]!;
    await user.click(smallSampleSummary);
    expect(within(smallSampleSummary.closest("details")!).getAllByText("600")).toHaveLength(3);
  });

  it.each([
    ["Download Markdown", downloadSmeCoverageMarkdown, "Markdown download started."],
    ["Download CSV", downloadSmeCoverageEvidenceCsv, "CSV download started."],
  ] as const)("announces successful %s actions with the untouched pack", async (name, download, message) => {
    const user = userEvent.setup();
    const pack = completeSmeCoverageDecisionPack();
    render(<SmeCoverageDecisionPack pack={pack} onRunAgain={vi.fn()} />);

    await user.click(screen.getByRole("button", { name }));

    expect(download).toHaveBeenCalledWith(pack);
    expect(screen.getByRole("status")).toHaveTextContent(message);
  });

  it.each([
    ["Download Markdown", downloadSmeCoverageMarkdown, "Markdown"],
    ["Download CSV", downloadSmeCoverageEvidenceCsv, "CSV"],
  ] as const)("exposes an actionable alert when %s throws", async (name, download, format) => {
    const user = userEvent.setup();
    vi.mocked(download).mockImplementationOnce(() => {
      throw new Error("blocked");
    });
    render(
      <SmeCoverageDecisionPack pack={completeSmeCoverageDecisionPack()} onRunAgain={vi.fn()} />,
    );

    await user.click(screen.getByRole("button", { name }));

    expect(screen.getByRole("alert")).toHaveTextContent(
      `The ${format} download could not start. Check browser download permissions and try again.`,
    );
  });
});
