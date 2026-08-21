import { useId, useRef, useState } from "react";

export type ReportExportFeedback =
  | { state: "idle" }
  | { state: "success"; message: string }
  | { state: "failed"; message: string };

export interface ReportExportBarProps {
  feedback: ReportExportFeedback;
  onRunAgain: () => void;
  onExportPdf?: () => void;
  onExportCsv?: () => void;
  onExportMarkdown?: () => void;
  pdfPending?: boolean;
  runPending?: boolean;
}

export function ReportExportBar({
  feedback,
  onRunAgain,
  onExportPdf,
  onExportCsv,
  onExportMarkdown,
  pdfPending = false,
  runPending = false,
}: ReportExportBarProps) {
  const menuId = useId();
  const moreFormatsButtonRef = useRef<HTMLButtonElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className="report-export-bar">
      <div className="report-export-actions" role="group" aria-label="Report actions">
        {onExportPdf && (
          <button
            className="s-btn s-btn__filled report-export-primary"
            type="button"
            disabled={pdfPending}
            aria-busy={pdfPending}
            onClick={onExportPdf}
          >
            {pdfPending ? "Preparing PDF…" : "Export polished PDF"}
          </button>
        )}
        {onExportCsv && (
          <button
            className="s-btn s-btn__outlined report-export-csv"
            type="button"
            onClick={onExportCsv}
          >
            Export evidence CSV
          </button>
        )}
        {onExportMarkdown && (
          <div className="report-export-format">
            <button
              className="s-btn s-btn__outlined report-export-more"
              ref={moreFormatsButtonRef}
              type="button"
              aria-controls={menuId}
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((open) => !open)}
            >
              More formats
            </button>
            <div
              className="report-export-disclosure"
              id={menuId}
              hidden={!menuOpen}
            >
              <button
                className="s-btn report-export-menu-item"
                type="button"
                onClick={() => {
                  onExportMarkdown();
                  setMenuOpen(false);
                  moreFormatsButtonRef.current?.focus();
                }}
              >
                Download Markdown brief
              </button>
            </div>
          </div>
        )}
        <button
          className="s-btn s-btn__outlined report-export-run"
          type="button"
          disabled={runPending}
          onClick={onRunAgain}
        >
          {runPending ? "Running again…" : "Run again"}
        </button>
      </div>
      {feedback.state === "success" && (
        <p className="report-export-feedback report-export-feedback__success" role="status">
          {feedback.message}
        </p>
      )}
      {feedback.state === "failed" && (
        <p className="report-export-feedback report-export-feedback__error" role="alert">
          {feedback.message}
        </p>
      )}
    </div>
  );
}
