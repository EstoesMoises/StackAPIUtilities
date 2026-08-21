import { readFileSync } from "node:fs";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ReportExportBar } from "./ReportExportBar";

describe("ReportExportBar", () => {
  it("keeps export hierarchy overrides after the shared button rules", () => {
    const appStyles = readFileSync(`${process.cwd()}/src/styles/app.css`, "utf8");
    const sharedOutlinedButtonRule = appStyles.indexOf(".app-shell .s-btn__outlined");

    expect(sharedOutlinedButtonRule).toBeGreaterThan(-1);
    for (const selector of [
      ".app-shell .report-export-actions .report-export-csv {",
      ".app-shell .report-export-disclosure .report-export-menu-item {",
      ".app-shell .report-export-actions .report-export-run:not(:disabled) {",
    ]) {
      expect(appStyles.indexOf(selector)).toBeGreaterThan(sharedOutlinedButtonRule);
    }
  });

  it("exposes its controls as a labelled action group", () => {
    render(<ReportExportBar feedback={{ state: "idle" }} onRunAgain={vi.fn()} />);

    expect(screen.getByRole("group", { name: "Report actions" })).toContainElement(
      screen.getByRole("button", { name: "Run again" }),
    );
  });

  it("keeps PDF and CSV direct while putting Markdown under More formats", async () => {
    const user = userEvent.setup();
    const onExportPdf = vi.fn();
    const onExportCsv = vi.fn();
    const onExportMarkdown = vi.fn();
    const onRunAgain = vi.fn();
    render(
      <ReportExportBar
        feedback={{ state: "idle" }}
        onExportPdf={onExportPdf}
        onExportCsv={onExportCsv}
        onExportMarkdown={onExportMarkdown}
        onRunAgain={onRunAgain}
      />,
    );

    const pdf = screen.getByRole("button", { name: "Export polished PDF" });
    const csv = screen.getByRole("button", { name: "Export evidence CSV" });
    const moreFormats = screen.getByRole("button", { name: "More formats" });
    const runAgain = screen.getByRole("button", { name: "Run again" });

    expect(pdf).toHaveClass("s-btn__filled", "report-export-primary");
    expect(csv).toHaveClass("report-export-csv");
    expect(runAgain).toHaveClass("report-export-run");
    expect(screen.queryByRole("button", { name: "Download Markdown brief" })).not.toBeInTheDocument();
    expect(moreFormats).toHaveAttribute("aria-expanded", "false");

    await user.click(pdf);
    await user.click(csv);
    await user.click(runAgain);
    expect(onExportPdf).toHaveBeenCalledOnce();
    expect(onExportCsv).toHaveBeenCalledOnce();
    expect(onRunAgain).toHaveBeenCalledOnce();

    await user.click(moreFormats);
    expect(moreFormats).toHaveAttribute("aria-expanded", "true");
    await user.click(screen.getByRole("button", { name: "Download Markdown brief" }));
    expect(onExportMarkdown).toHaveBeenCalledOnce();
    expect(screen.queryByRole("button", { name: "Download Markdown brief" })).not.toBeInTheDocument();
    expect(moreFormats).toHaveFocus();
  });

  it("omits optional formats and their disclosure when callbacks are absent", () => {
    render(<ReportExportBar feedback={{ state: "idle" }} onRunAgain={vi.fn()} />);

    expect(screen.queryByRole("button", { name: "Export polished PDF" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Export evidence CSV" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "More formats" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Run again" })).toBeInTheDocument();
  });

  it("disables pending actions, exposes PDF busy state, and changes pending copy", async () => {
    const user = userEvent.setup();
    const onExportPdf = vi.fn();
    const onRunAgain = vi.fn();
    render(
      <ReportExportBar
        feedback={{ state: "idle" }}
        onExportPdf={onExportPdf}
        onRunAgain={onRunAgain}
        pdfPending
        runPending
      />,
    );

    const pdf = screen.getByRole("button", { name: "Preparing PDF…" });
    const runAgain = screen.getByRole("button", { name: "Running again…" });
    expect(pdf).toBeDisabled();
    expect(pdf).toHaveAttribute("aria-busy", "true");
    expect(runAgain).toBeDisabled();

    await user.click(pdf);
    await user.click(runAgain);
    expect(onExportPdf).not.toHaveBeenCalled();
    expect(onRunAgain).not.toHaveBeenCalled();
  });

  it("announces successful exports as status feedback", () => {
    render(
      <ReportExportBar
        feedback={{ state: "success", message: "PDF download started." }}
        onRunAgain={vi.fn()}
      />,
    );

    expect(screen.getByRole("status")).toHaveTextContent("PDF download started.");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("announces failed exports as alert feedback", () => {
    render(
      <ReportExportBar
        feedback={{ state: "failed", message: "PDF export failed." }}
        onRunAgain={vi.fn()}
      />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent("PDF export failed.");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});
