import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import {
  ReportCommandCenter,
  requireReportCommandCenterSections,
  type ReportCommandCenterSection,
  type ReportCommandCenterSections,
} from "./ReportCommandCenter";

const sections: ReportCommandCenterSections = [
  { id: "overview", label: "Summary", content: <p>Summary content</p> },
  { id: "findings", label: "Findings", content: <p>Findings content</p> },
  { id: "evidence", label: "Evidence", content: <p>Evidence content</p> },
];

describe("ReportCommandCenter", () => {
  it("associates tabs and panels while exposing only the selected section", async () => {
    const user = userEvent.setup();
    renderCommandCenter();

    const commandCenter = screen.getByRole("region", { name: "Generated report" });
    const tablist = within(commandCenter).getByRole("tablist", { name: "Report sections" });
    const summaryTab = within(tablist).getByRole("tab", { name: "Summary" });
    const findingsTab = within(tablist).getByRole("tab", { name: "Findings" });
    const summaryPanel = within(commandCenter).getByRole("tabpanel", { name: "Summary" });

    expect(summaryTab).toHaveAttribute("aria-selected", "true");
    expect(summaryTab).toHaveAttribute("aria-controls", summaryPanel.id);
    expect(summaryPanel).toHaveAttribute("aria-labelledby", summaryTab.id);
    expect(summaryPanel).toHaveTextContent("Summary content");
    expect(within(commandCenter).queryByRole("tabpanel", { name: "Findings" })).not.toBeInTheDocument();
    expect(screen.queryByText("Findings content")).not.toBeInTheDocument();

    await user.click(findingsTab);

    const findingsPanel = within(commandCenter).getByRole("tabpanel", { name: "Findings" });
    expect(findingsTab).toHaveAttribute("aria-selected", "true");
    expect(findingsTab).toHaveAttribute("tabindex", "0");
    expect(summaryTab).toHaveAttribute("tabindex", "-1");
    expect(findingsPanel).toHaveTextContent("Findings content");
    expect(findingsPanel).toHaveAttribute("aria-labelledby", findingsTab.id);
    expect(screen.queryByText("Summary content")).not.toBeInTheDocument();
  });

  it("moves focus and selection with wrapping arrow-key navigation", async () => {
    const user = userEvent.setup();
    renderCommandCenter();

    const summaryTab = screen.getByRole("tab", { name: "Summary" });
    const findingsTab = screen.getByRole("tab", { name: "Findings" });
    const evidenceTab = screen.getByRole("tab", { name: "Evidence" });

    summaryTab.focus();
    await user.keyboard("{ArrowLeft}");
    expect(evidenceTab).toHaveFocus();
    expect(evidenceTab).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tabpanel", { name: "Evidence" })).toHaveTextContent("Evidence content");

    await user.keyboard("{ArrowRight}");
    expect(summaryTab).toHaveFocus();
    expect(summaryTab).toHaveAttribute("aria-selected", "true");

    await user.keyboard("{ArrowRight}");
    expect(findingsTab).toHaveFocus();
    expect(findingsTab).toHaveAttribute("aria-selected", "true");
  });

  it("resets the selected section when the report key changes", async () => {
    const user = userEvent.setup();
    const { rerender } = renderCommandCenter();

    await user.click(screen.getByRole("tab", { name: "Evidence" }));
    expect(screen.getByRole("tab", { name: "Evidence" })).toHaveAttribute("aria-selected", "true");

    rerender(
      <ReportCommandCenter reportKey="report-2" header={<h2>Second report</h2>} sections={sections} />,
    );

    expect(screen.getByRole("tab", { name: "Summary" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tabpanel", { name: "Summary" })).toHaveTextContent("Summary content");
  });

  it("never renders the previously selected section for a new report key", async () => {
    const user = userEvent.setup();
    const onRender = vi.fn();
    const { rerender } = renderCommandCenter();

    await user.click(screen.getByRole("tab", { name: "Evidence" }));
    rerender(
      <ReportCommandCenter
        reportKey="report-2"
        header={<h2>Second report</h2>}
        sections={requireReportCommandCenterSections(
          sections.map((section) => ({
            ...section,
            content: <RenderProbe label={`new-${section.id}`} onRender={onRender} />,
          })),
        )}
      />,
    );

    expect(onRender).toHaveBeenCalledWith("new-overview");
    expect(onRender).not.toHaveBeenCalledWith("new-evidence");
  });

  it("accepts mapped readonly section arrays", () => {
    const mappedSections: readonly ReportCommandCenterSection[] = sections.map((section) => ({
      ...section,
      label: `Mapped ${section.label}`,
    }));
    const validatedSections = requireReportCommandCenterSections(mappedSections);

    render(
      <ReportCommandCenter
        reportKey="mapped-report"
        header={<h2>Mapped report</h2>}
        sections={validatedSections}
      />,
    );

    expect(validatedSections).toBe(mappedSections);
    expect(screen.getByRole("tab", { name: "Mapped Summary" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("rejects empty dynamic section arrays with a developer-facing error", () => {
    expect(() => requireReportCommandCenterSections([])).toThrowError(
      "ReportCommandCenter requires at least one section.",
    );
  });

  it("selects the first available section when the active section disappears", async () => {
    const user = userEvent.setup();
    const { rerender } = renderCommandCenter();
    await user.click(screen.getByRole("tab", { name: "Evidence" }));

    const replacementSections: ReportCommandCenterSections = [
      { id: "findings", label: "Findings", content: <p>Updated findings</p> },
      { id: "methodology", label: "Method", content: <p>Method content</p> },
    ];
    rerender(
      <ReportCommandCenter
        reportKey="report-1"
        header={<h2>Generated analysis</h2>}
        sections={replacementSections}
      />,
    );

    expect(screen.getByRole("tab", { name: "Findings" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tabpanel", { name: "Findings" })).toHaveTextContent("Updated findings");

    rerender(
      <ReportCommandCenter
        reportKey="report-1"
        header={<h2>Generated analysis</h2>}
        sections={[
          replacementSections[0],
          { id: "evidence", label: "Evidence", content: <p>Returned evidence</p> },
        ]}
      />,
    );

    expect(screen.getByRole("tab", { name: "Findings" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tabpanel", { name: "Findings" })).toHaveTextContent("Updated findings");
  });
});

function renderCommandCenter() {
  return render(
    <ReportCommandCenter
      reportKey="report-1"
      header={<h2>Generated analysis</h2>}
      sections={sections}
    />,
  );
}

function RenderProbe({ label, onRender }: { label: string; onRender: (label: string) => void }) {
  onRender(label);
  return <p>{label}</p>;
}
