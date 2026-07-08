import { useState } from "react";
import { reportRegistry } from "../domain/reportRegistry";
import type { PeriodScope, ReportId, ReportRunScope, RunPeriodRole } from "../domain/types";
import { DataTable } from "./DataTable";
import { ReportDashboard } from "./ReportDashboard";
import { ReportScopePanel } from "./ReportScopePanel";
import { StackOverflowLogo } from "./StackOverflowLogo";
import { downloadReportCsv } from "../utils/reportDownloads";

export interface ReportWorkspaceProps {
  reportId: ReportId;
  records: Record<string, unknown>[];
  comparisonRecords?: Record<string, unknown>[];
  loadedAt?: string;
  currentScope?: PeriodScope;
  comparisonScope?: PeriodScope;
  outputSource?: "live-api" | "upload";
  scope: ReportRunScope;
  onScopeChange: (scope: ReportRunScope) => void;
  onRun: (periodRole: RunPeriodRole) => void;
  onRunBoth: () => void;
}

export function ReportWorkspace({
  reportId,
  records,
  comparisonRecords,
  loadedAt,
  currentScope,
  comparisonScope,
  outputSource,
  scope,
  onScopeChange,
  onRun,
  onRunBoth,
}: ReportWorkspaceProps) {
  const [tab, setTab] = useState<"dashboard" | "table">("dashboard");
  const report = reportRegistry.find((candidate) => candidate.id === reportId)!;
  const comparisonEnabled = scope.comparison !== undefined;
  const canDownloadTagHealth = reportId === "tag-report" && records.length > 0;

  function downloadTagHealthCsv() {
    downloadReportCsv({
      reportId,
      datasetName: "tags",
      records,
      loadedAt: loadedAt ?? new Date().toISOString(),
      source: outputSource ?? "upload",
      periodRole: "current",
      currentScope,
      comparisonScope,
    });
  }

  return (
    <section className="workspace-panel" aria-labelledby="selected-report-heading">
      <div className="workspace-header">
        <div>
          <p className="workspace-kicker">{report.sourceRepo}</p>
          <h2 className="workspace-heading" id="selected-report-heading">
            {report.title}
          </h2>
        </div>
        <StackOverflowLogo className="workspace-stack-mark" variant="glyph" />
      </div>
      {canDownloadTagHealth && (
        <div className="workspace-actions">
          <button className="s-btn s-btn__outlined report-download-button" type="button" onClick={downloadTagHealthCsv}>
            Download Tag Health CSV
          </button>
        </div>
      )}
      <p className="workspace-copy">{report.description}</p>
      <div className="workspace-readiness" role="note">
        <span className="readiness-dot" aria-hidden="true" />
        <p className="m0">
          Ready for session credentials. Live API runs collect mapped datasets; uploads
          render full script outputs.
        </p>
      </div>
      <ReportScopePanel reportId={reportId} scope={scope} onChange={onScopeChange} />
      <div className="run-controls">
        <button
          className="s-btn s-btn__filled report-run-primary"
          type="button"
          onClick={() => onRun("current")}
        >
          Run current period
        </button>
        {comparisonEnabled && (
          <>
            <button
              className="s-btn s-btn__outlined report-run-secondary"
              type="button"
              onClick={() => onRun("comparison")}
            >
              Run comparison period
            </button>
            <button
              className="s-btn s-btn__outlined report-run-secondary"
              type="button"
              onClick={onRunBoth}
            >
              Run both periods
            </button>
          </>
        )}
      </div>
      <div className="s-navigation s-navigation__muted report-tabs" role="tablist">
        <button
          className="s-navigation--item"
          type="button"
          role="tab"
          aria-selected={tab === "dashboard"}
          onClick={() => setTab("dashboard")}
        >
          Dashboard
        </button>
        <button
          className="s-navigation--item"
          type="button"
          role="tab"
          aria-selected={tab === "table"}
          onClick={() => setTab("table")}
        >
          Raw Table
        </button>
      </div>
      {tab === "dashboard" ? (
        <ReportDashboard
          reportId={reportId}
          records={records}
          comparisonRecords={comparisonRecords}
          currentScope={currentScope}
          comparisonScope={comparisonScope}
          outputSource={outputSource}
        />
      ) : (
        <div className="raw-table-panel">
          <DataTable records={records} />
        </div>
      )}
    </section>
  );
}
