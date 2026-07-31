import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  completeSmeCoverageDecisionPack,
  emptySmeCoverageDecisionPack,
  insufficientSampleSmeCoverageDecisionPack,
  partialSmeCoverageDecisionPack,
  warninglessPartialSmeCoverageDecisionPack,
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

    const warningStack = screen.getByRole("region", { name: "Completeness warnings" });
    const summary = screen.getByRole("heading", { name: "Executive summary" });
    expect(
      warningStack.compareDocumentPosition(summary) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(within(warningStack).getAllByRole("alert")).toHaveLength(pack.warnings.length);

    expect(screen.getByText("example.stackenterprise.co")).toBeInTheDocument();
    expect(screen.getByText("2026-07-30T12:00:00.000Z")).toBeInTheDocument();
    expect(screen.getByText("All-time demand · Current SME coverage")).toBeInTheDocument();
    expect(screen.getByText("Partial", { selector: ".sme-completeness-badge" })).toBeInTheDocument();

    for (const [label, value] of [
      ["Tags analyzed", "4"],
      ["Tags with SMEs", "2"],
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
    expect(screen.getByText("Methodology and completeness notes")).toBeInTheDocument();
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
    expect(screen.getByText("Complete", { selector: ".sme-completeness-badge" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Completeness warnings" })).not.toBeInTheDocument();

    rerender(<SmeCoverageDecisionPack pack={partialSmeCoverageDecisionPack()} onRunAgain={vi.fn()} />);
    expect(screen.getByText("Partial", { selector: ".sme-completeness-badge" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Completeness warnings" })).toBeInTheDocument();

    rerender(<SmeCoverageDecisionPack pack={emptySmeCoverageDecisionPack()} onRunAgain={vi.fn()} />);
    expect(screen.getByText("Empty", { selector: ".sme-completeness-badge" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Completeness warnings" })).not.toBeInTheDocument();
    expect(screen.getByText(/no evidence rows were available/i)).toBeInTheDocument();

    rerender(
      <SmeCoverageDecisionPack
        pack={insufficientSampleSmeCoverageDecisionPack()}
        onRunAgain={vi.fn()}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent(/only one eligible covered active tag/i);
  });

  it("qualifies a prepared partial sample without source warnings before the executive summary", () => {
    const pack = warninglessPartialSmeCoverageDecisionPack();
    render(<SmeCoverageDecisionPack pack={pack} onRunAgain={vi.fn()} />);

    const qualification = screen.getByRole("alert");
    const summary = screen.getByRole("heading", { name: "Executive summary" });
    expect(qualification).toHaveTextContent("partial sample");
    expect(qualification).toHaveTextContent(/conclusions/i);
    expect(
      qualification.compareDocumentPosition(summary) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(pack.warnings).toEqual([]);
    expect(screen.getByText(pack.overview)).toBeInTheDocument();
    expect(screen.getByText(pack.assessment)).toBeInTheDocument();
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
    expect(within(critical).getAllByText("3,000")).toHaveLength(2);
    expect(within(critical).getByText("All-time tag total")).toBeInTheDocument();

    const assessment = completeSmeCoverageDecisionPack().assessment;
    await user.click(screen.getByRole("button", { name: "Copy assessment" }));
    expect(writeText).toHaveBeenCalledWith(assessment);

    const methodologySummary = screen.getByText("Methodology and completeness notes");
    await user.click(methodologySummary);
    const methodology = methodologySummary.closest("details")!;
    expect(within(methodology).getByText("At least 1 question or more than 25 page views")).toBeInTheDocument();
    expect(within(methodology).getByText("pageViews / smeCount")).toBeInTheDocument();
    expect(within(methodology).getByText("2,750")).toBeInTheDocument();
    expect(within(methodology).getByText("12")).toBeInTheDocument();
    expect(within(methodology).getByText("1,250.4")).toBeInTheDocument();
    expect(within(methodology).getByText("3,000.49")).toBeInTheDocument();
    expect(within(methodology).getByText(/nearest-rank/i)).toBeInTheDocument();
    expect(within(methodology).getByText(/empirical-percentile/i)).toBeInTheDocument();
    expect(within(methodology).getByText(/nearest whole page view for display; unrounded for calculation/i)).toBeInTheDocument();
    expect(within(methodology).getByText(/question-count precedence/i)).toBeInTheDocument();
    expect(within(methodology).getByText(/complete question enumeration.*all-time tag total.*partial question sample.*unavailable/i)).toBeInTheDocument();
    expect(within(methodology).getByText(/complete, partial, and empty/i)).toBeInTheDocument();

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
    const methodologySummaries = screen.getAllByText("Methodology and completeness notes");
    const smallSampleSummary = methodologySummaries[methodologySummaries.length - 1]!;
    await user.click(smallSampleSummary);
    expect(within(smallSampleSummary.closest("details")!).getAllByText("Not calculated")).toHaveLength(2);
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
