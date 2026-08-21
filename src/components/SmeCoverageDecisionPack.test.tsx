import { readFileSync } from "node:fs";
import { StrictMode } from "react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  completeSmeCoverageDecisionPack,
  emptySmeCoverageDecisionPack,
  partialSmeCoverageDecisionPack,
} from "../test/fixtures/smeCoverageFixtures";
import {
  downloadSmeCoverageEvidenceCsv,
  downloadSmeCoverageMarkdown,
} from "../utils/smeCoverageDownloads";
import { downloadSmeCoveragePdf } from "../utils/smeCoveragePdfDownload";
import { SmeCoverageDecisionPack } from "./SmeCoverageDecisionPack";
import { SmeCoverageMethodology } from "./SmeCoverageMethodology";

vi.mock("../utils/smeCoverageDownloads", () => ({
  downloadSmeCoverageEvidenceCsv: vi.fn(),
  downloadSmeCoverageMarkdown: vi.fn(),
}));

vi.mock("../utils/smeCoveragePdfDownload", () => ({
  downloadSmeCoveragePdf: vi.fn(),
}));

afterEach(() => {
  vi.clearAllMocks();
});

describe("SmeCoverageDecisionPack", () => {
  it("keeps the command header sticky only above the fixed-chrome breakpoint and stacks exports on mobile", () => {
    const appStyles = readFileSync(`${process.cwd()}/src/styles/app.css`, "utf8");

    expect(appStyles).toContain("@media (min-width: 1221px)");
    expect(appStyles).toMatch(/@media \(min-width: 1221px\)[\s\S]*?\.report-command-center-header\s*\{[\s\S]*?position: sticky;[\s\S]*?top: 78px;/);
    expect(appStyles).toMatch(/@media \(max-width: 640px\)[\s\S]*?\.report-command-center-header\s*\{[\s\S]*?position: static;/);
    expect(appStyles).toMatch(/@media \(max-width: 640px\)[\s\S]*?\.report-export-actions\s*\{[\s\S]*?grid-template-columns: 1fr;/);
    expect(appStyles).not.toContain(".sme-result-actions");
  });

  it("opens as an export-first generated report with direct PDF and CSV actions", async () => {
    const user = userEvent.setup();
    const pack = completeSmeCoverageDecisionPack();
    render(<SmeCoverageDecisionPack pack={pack} onRunAgain={vi.fn()} />);

    const report = screen.getByRole("region", { name: "Generated report" });
    expect(within(report).getByRole("heading", { name: "SME coverage report" })).toBeVisible();
    expect(within(report).getByText("Decision pack")).toBeVisible();
    expect(within(report).getAllByText(pack.snapshot.instanceHost).length).toBeGreaterThan(0);
    expect(within(report).getAllByText(pack.snapshot.generatedAt).length).toBeGreaterThan(0);
    expect(within(report).getByText(`${pack.evidence.length} evidence rows`)).toBeVisible();
    expect(within(report).getByText("Analysis quality: Complete")).toBeVisible();
    expect(within(report).getByRole("button", { name: "Export polished PDF" })).toBeVisible();
    expect(within(report).getByRole("button", { name: "Export evidence CSV" })).toBeVisible();
    expect(within(report).queryByRole("button", { name: "Download Markdown brief" })).not.toBeInTheDocument();
    expect(within(report).queryByText("SME coverage result")).not.toBeInTheDocument();

    await user.click(within(report).getByRole("button", { name: "More formats" }));
    expect(within(report).getByRole("button", { name: "Download Markdown brief" })).toBeVisible();
  });

  it("renders presentation-ordered tabs and exposes only the active section", async () => {
    const user = userEvent.setup();
    const pack = completeSmeCoverageDecisionPack();
    render(<SmeCoverageDecisionPack pack={pack} onRunAgain={vi.fn()} />);

    const overviewTab = screen.getByRole("tab", { name: "Overview" });
    const findingsTab = screen.getByRole("tab", { name: `Priority findings · ${pack.findings.immediateGaps.length + pack.findings.criticalUnderCoverage.length + pack.findings.lightCoverage.length}` });
    const evidenceTab = screen.getByRole("tab", { name: `Evidence · ${pack.evidence.length}` });
    const methodologyTab = screen.getByRole("tab", { name: "Methodology" });
    expect(screen.getAllByRole("tab")).toEqual([
      overviewTab,
      findingsTab,
      evidenceTab,
      methodologyTab,
    ]);
    expect(overviewTab).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("heading", { name: "Executive summary" })).toBeVisible();
    expect(screen.queryByRole("region", { name: "Priority findings table" })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "SME coverage evidence table" })).not.toBeInTheDocument();
    expect(screen.queryByText("Active-tag rule")).not.toBeInTheDocument();

    await user.click(findingsTab);
    expect(screen.getByRole("region", { name: "Priority findings table" })).toBeVisible();
    expect(screen.queryByRole("heading", { name: "Executive summary" })).not.toBeInTheDocument();

    await user.click(evidenceTab);
    expect(screen.getByRole("region", { name: "SME coverage evidence table" })).toBeVisible();
    expect(screen.queryByRole("region", { name: "Priority findings table" })).not.toBeInTheDocument();

    await user.click(methodologyTab);
    expect(screen.getByRole("heading", { name: "Methodology and evidence quality" })).toBeVisible();
    expect(screen.getByText("Active-tag rule")).toBeVisible();
    expect(screen.queryByRole("region", { name: "SME coverage evidence table" })).not.toBeInTheDocument();
  });

  it("uses the flattened presentation findings in canonical order without mutating the pack", async () => {
    const user = userEvent.setup();
    const pack = completeSmeCoverageDecisionPack();
    const before = JSON.stringify(pack.findings);
    render(<SmeCoverageDecisionPack pack={pack} onRunAgain={vi.fn()} />);

    await user.click(screen.getByRole("tab", { name: /Priority findings/ }));
    expect(priorityRowTags()).toEqual(["zeta-runtime", "Alpha-platform", "beta-data"]);
    expect(screen.getByText("3 prepared priorities")).toBeVisible();

    await user.selectOptions(screen.getByRole("combobox", { name: "Priority tier" }), "Light coverage");
    expect(priorityRowTags()).toEqual(["beta-data"]);
    expect(JSON.stringify(pack.findings)).toBe(before);
  });

  it("preserves visited findings and evidence controls until a new report key resets them", async () => {
    const user = userEvent.setup();
    const source = completeSmeCoverageDecisionPack();
    const evidence = Array.from({ length: 55 }, (_, index) => ({
      ...source.evidence[index % source.evidence.length]!,
      tagName: `stateful-tag-${String(index + 1).padStart(2, "0")}`,
    }));
    const firstPack = { ...source, evidence };
    const secondPack = {
      ...firstPack,
      snapshot: { ...firstPack.snapshot, generatedAt: "2026-07-30T13:00:00.000Z" },
    };
    const { rerender } = render(
      <SmeCoverageDecisionPack pack={firstPack} onRunAgain={vi.fn()} />,
    );

    await user.click(screen.getByRole("tab", { name: /Priority findings/ }));
    await user.selectOptions(screen.getByRole("combobox", { name: "Priority tier" }), "Light coverage");
    await user.click(screen.getByRole("tab", { name: /Evidence/ }));
    await user.click(screen.getByText("Columns", { selector: "summary" }));
    await user.click(screen.getByRole("checkbox", { name: "Questions" }));
    await user.click(screen.getByRole("button", { name: "Next page" }));
    expect(screen.getByText("Rows 51–55 of 55")).toBeVisible();
    expect(screen.getByRole("columnheader", { name: "Questions" })).toBeVisible();

    await user.click(screen.getByRole("tab", { name: "Overview" }));
    await user.click(screen.getByRole("tab", { name: /Evidence/ }));
    expect(screen.getByText("Rows 51–55 of 55")).toBeVisible();
    expect(screen.getByRole("columnheader", { name: "Questions" })).toBeVisible();
    await user.click(screen.getByRole("tab", { name: /Priority findings/ }));
    expect(screen.getByRole("combobox", { name: "Priority tier" })).toHaveValue("Light coverage");

    rerender(<SmeCoverageDecisionPack pack={secondPack} onRunAgain={vi.fn()} />);
    expect(screen.getByRole("tab", { name: "Overview" })).toHaveAttribute("aria-selected", "true");
    await user.click(screen.getByRole("tab", { name: /Evidence/ }));
    expect(screen.getByText("Rows 1–50 of 55")).toBeVisible();
    expect(screen.queryByRole("columnheader", { name: "Questions" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: /Priority findings/ }));
    expect(screen.getByRole("combobox", { name: "Priority tier" })).toHaveValue("All priorities");
  });

  it("keeps warnings before conclusions and composes the complete overview", () => {
    const pack = partialSmeCoverageDecisionPack();
    render(<SmeCoverageDecisionPack pack={pack} onRunAgain={vi.fn()} />);

    const overviewPanel = screen.getByRole("tabpanel", { name: "Overview" });
    const warnings = within(overviewPanel).getByRole("region", { name: "Evidence notes" });
    const summary = within(overviewPanel).getByRole("heading", { name: "Executive summary" });
    expect(warnings.compareDocumentPosition(summary) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(warnings).getAllByRole("alert")).toHaveLength(pack.warnings.length);
    expect(within(overviewPanel).getByLabelText("Analysis snapshot")).toBeVisible();
    expect(within(overviewPanel).getByText(pack.snapshot.scopeLabel)).toBeVisible();
    expect(within(overviewPanel).getByText(pack.snapshot.collectionLabel)).toBeVisible();

    for (const [label, value] of [
      ["Tags analyzed", "6"],
      ["Tags with SMEs", "4"],
      ["Immediate gaps", "1"],
      ["Critical under-coverage", "1"],
      ["Light-coverage tags", "1"],
    ]) {
      expect(within(overviewPanel).getByText(label, { selector: "dt" }).closest("div")).toHaveTextContent(value);
    }

    expect(within(overviewPanel).getByText(pack.overview)).toBeVisible();
    expect(within(overviewPanel).getByRole("heading", { name: "Copy-ready assessment" })).toBeVisible();
    expect(within(overviewPanel).getByRole("button", { name: "Copy assessment" })).toBeVisible();
    expect(within(overviewPanel).getByRole("heading", { name: "Priority snapshot" })).toBeVisible();
    const priorities = within(overviewPanel).getByRole("list", { name: "Top priority findings" });
    expect(within(priorities).getAllByRole("listitem")).toHaveLength(3);
    expect(within(priorities).getAllByRole("listitem")[0]).toHaveTextContent("zeta-runtime");
    expect(within(priorities).getAllByRole("listitem")[1]).toHaveTextContent("Alpha-platform");
    expect(within(priorities).getAllByRole("listitem")[2]).toHaveTextContent("beta-data");
    expect(within(priorities).getByText("Immediate gap")).toBeVisible();
    expect(within(priorities).getByText(pack.evidence[0]!.recommendedAction)).toBeVisible();

    const deliverable = within(overviewPanel).getByRole("complementary", { name: "Deliverable" });
    expect(deliverable).toHaveTextContent("The PDF includes the executive brief, priority findings, methodology, and supporting evidence.");
    expect(deliverable).toHaveTextContent("The evidence CSV contains every canonical row in decision-pack order.");
  });

  it("shows exactly Overview and Methodology for an empty pack and omits CSV", async () => {
    const user = userEvent.setup();
    render(<SmeCoverageDecisionPack pack={emptySmeCoverageDecisionPack()} onRunAgain={vi.fn()} />);

    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual(["Overview", "Methodology"]);
    expect(screen.getByRole("button", { name: "Export polished PDF" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Export evidence CSV" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "More formats" })).toBeVisible();
    expect(screen.getByText("No prepared priority findings are available for this report.")).toBeVisible();
    expect(screen.getByRole("complementary", { name: "Deliverable" })).toHaveTextContent(
      "No evidence CSV is available because this report contains no canonical evidence rows.",
    );
    expect(screen.getByRole("complementary", { name: "Deliverable" })).not.toHaveTextContent(
      "The evidence CSV contains every canonical row in decision-pack order.",
    );

    await user.click(screen.getByRole("tab", { name: "Methodology" }));
    expect(screen.getByText("Active-tag rule")).toBeVisible();
  });

  it("resets a new report from Evidence to Overview without mounting its stale panel", async () => {
    const user = userEvent.setup();
    const firstPack = completeSmeCoverageDecisionPack();
    const secondPack = {
      ...completeSmeCoverageDecisionPack(),
      snapshot: {
        ...completeSmeCoverageDecisionPack().snapshot,
        generatedAt: "2026-07-30T13:00:00.000Z",
      },
      evidence: completeSmeCoverageDecisionPack().evidence.map((row) => ({
        ...row,
        tagName: `new-${row.tagName}`,
      })),
      overview: "A newly prepared overview.",
    };
    const { rerender } = render(<SmeCoverageDecisionPack pack={firstPack} onRunAgain={vi.fn()} />);
    await user.click(screen.getByRole("tab", { name: /Evidence/ }));

    rerender(<SmeCoverageDecisionPack pack={secondPack} onRunAgain={vi.fn()} />);

    expect(screen.getByRole("tab", { name: "Overview" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("A newly prepared overview.")).toBeVisible();
    expect(screen.queryByRole("region", { name: "SME coverage evidence table" })).not.toBeInTheDocument();
    expect(screen.queryByText("new-zeta-runtime")).not.toBeInTheDocument();
  });

  it("announces PDF pending and resolved success with the untouched pack", async () => {
    const user = userEvent.setup();
    const pending = deferred<void>();
    vi.mocked(downloadSmeCoveragePdf).mockReturnValueOnce(pending.promise);
    const pack = completeSmeCoverageDecisionPack();
    render(<SmeCoverageDecisionPack pack={pack} onRunAgain={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "Export polished PDF" }));
    expect(downloadSmeCoveragePdf).toHaveBeenCalledWith(pack);
    expect(screen.getByRole("button", { name: "Preparing PDF…" })).toBeDisabled();

    pending.resolve();
    expect(await screen.findByRole("status")).toHaveTextContent("PDF download started.");
    expect(screen.getByRole("button", { name: "Export polished PDF" })).toBeEnabled();
  });

  it("keeps the PDF request guard live through StrictMode effect replay", async () => {
    const user = userEvent.setup();
    const pack = completeSmeCoverageDecisionPack();
    vi.mocked(downloadSmeCoveragePdf).mockResolvedValueOnce();
    render(
      <StrictMode>
        <SmeCoverageDecisionPack pack={pack} onRunAgain={vi.fn()} />
      </StrictMode>,
    );

    await user.click(screen.getByRole("button", { name: "Export polished PDF" }));

    expect(await screen.findByRole("status")).toHaveTextContent("PDF download started.");
    expect(screen.getByRole("button", { name: "Export polished PDF" })).toBeEnabled();
  });

  it("announces an actionable PDF failure and clears pending", async () => {
    const user = userEvent.setup();
    vi.mocked(downloadSmeCoveragePdf).mockRejectedValueOnce(new Error("blocked"));
    render(<SmeCoverageDecisionPack pack={completeSmeCoverageDecisionPack()} onRunAgain={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "Export polished PDF" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("The PDF download could not be prepared. Check browser download permissions and try again.");
    expect(screen.getByRole("button", { name: "Export polished PDF" })).toBeEnabled();
  });

  it("ignores a stale PDF result after a new report replaces the pack", async () => {
    const user = userEvent.setup();
    const stale = deferred<void>();
    vi.mocked(downloadSmeCoveragePdf).mockReturnValueOnce(stale.promise);
    const firstPack = completeSmeCoverageDecisionPack();
    const secondPack = {
      ...completeSmeCoverageDecisionPack(),
      snapshot: {
        ...completeSmeCoverageDecisionPack().snapshot,
        generatedAt: "2026-07-30T13:00:00.000Z",
      },
    };
    const { rerender } = render(<SmeCoverageDecisionPack pack={firstPack} onRunAgain={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "Export polished PDF" }));

    rerender(<SmeCoverageDecisionPack pack={secondPack} onRunAgain={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Export polished PDF" })).toBeEnabled();
    expect(screen.queryByText("PDF download started.")).not.toBeInTheDocument();

    stale.resolve();
    await Promise.resolve();
    expect(screen.queryByText("PDF download started.")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Export polished PDF" })).toBeEnabled();
  });

  it.each([
    ["CSV", "Export evidence CSV", downloadSmeCoverageEvidenceCsv, "CSV download started."],
    ["Markdown", "Download Markdown brief", downloadSmeCoverageMarkdown, "Markdown download started."],
  ] as const)("announces successful %s exports with the untouched pack", async (format, name, download, message) => {
    const user = userEvent.setup();
    const pack = completeSmeCoverageDecisionPack();
    render(<SmeCoverageDecisionPack pack={pack} onRunAgain={vi.fn()} />);
    if (format === "Markdown") await user.click(screen.getByRole("button", { name: "More formats" }));

    await user.click(screen.getByRole("button", { name }));

    expect(download).toHaveBeenCalledWith(pack);
    expect(screen.getByRole("status")).toHaveTextContent(message);
  });

  it.each([
    ["CSV", "Export evidence CSV", downloadSmeCoverageEvidenceCsv],
    ["Markdown", "Download Markdown brief", downloadSmeCoverageMarkdown],
  ] as const)("announces actionable %s export failures", async (format, name, download) => {
    const user = userEvent.setup();
    vi.mocked(download).mockImplementationOnce(() => {
      throw new Error("blocked");
    });
    render(<SmeCoverageDecisionPack pack={completeSmeCoverageDecisionPack()} onRunAgain={vi.fn()} />);
    if (format === "Markdown") await user.click(screen.getByRole("button", { name: "More formats" }));

    await user.click(screen.getByRole("button", { name }));

    expect(screen.getByRole("alert")).toHaveTextContent(`The ${format} download could not start. Check browser download permissions and try again.`);
  });

  it("preserves Run again callbacks and pending copy", async () => {
    const user = userEvent.setup();
    const onRunAgain = vi.fn();
    const { rerender } = render(
      <SmeCoverageDecisionPack pack={completeSmeCoverageDecisionPack()} onRunAgain={onRunAgain} />,
    );
    await user.click(screen.getByRole("button", { name: "Run again" }));
    expect(onRunAgain).toHaveBeenCalledOnce();

    rerender(
      <SmeCoverageDecisionPack pack={completeSmeCoverageDecisionPack()} onRunAgain={onRunAgain} runPending />,
    );
    expect(screen.getByRole("button", { name: "Running again…" })).toBeDisabled();
  });
});

describe("SmeCoverageMethodology", () => {
  it("renders a visible standalone heading without a nested disclosure", () => {
    const pack = completeSmeCoverageDecisionPack();
    const { container } = render(
      <SmeCoverageMethodology methodology={pack.methodology} completeness={pack.snapshot.completeness} standalone />,
    );

    expect(screen.getByRole("heading", { name: "Methodology and evidence quality", level: 3 })).toBeVisible();
    expect(screen.getByText("Active-tag rule")).toBeVisible();
    expect(screen.getByText("pageViews / smeCount")).toBeVisible();
    expect(screen.getByText(/nearest-rank/i)).toBeVisible();
    expect(screen.getByText(/question-count precedence/i)).toBeVisible();
    expect(screen.getByText(/independent of collection status/i)).toBeVisible();
    expect(container.querySelector("details")).not.toBeInTheDocument();
  });

  it("preserves the disclosure mode for existing callers", async () => {
    const user = userEvent.setup();
    const pack = completeSmeCoverageDecisionPack();
    const { container } = render(
      <SmeCoverageMethodology methodology={pack.methodology} completeness={pack.snapshot.completeness} />,
    );

    const summary = screen.getByText("Methodology and evidence quality", { selector: "summary" });
    expect(container.querySelector("details")).toContainElement(summary);
    await user.click(summary);
    expect(screen.getByText("Active-tag rule")).toBeVisible();
  });
});

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function priorityRowTags(): string[] {
  return within(screen.getByRole("region", { name: "Priority findings table" }))
    .getAllByRole("row")
    .slice(1)
    .filter((row) => within(row).queryAllByRole("cell").length > 1)
    .map((row) => within(row).getAllByRole("cell")[1]!.textContent ?? "");
}
