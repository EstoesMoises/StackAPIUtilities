import { useState } from "react";
import { reportRegistry } from "../domain/reportRegistry";
import type { ReportId } from "../domain/types";
import { DataTable } from "./DataTable";
import { ReportDashboard } from "./ReportDashboard";
import { RunControls } from "./RunControls";

interface ReportWorkspaceProps {
  reportId: ReportId;
  records: Record<string, unknown>[];
  outputSource?: "live-api" | "upload";
  onRun: () => void;
}

export function ReportWorkspace({ reportId, records, outputSource, onRun }: ReportWorkspaceProps) {
  const [tab, setTab] = useState<"dashboard" | "table">("dashboard");
  const report = reportRegistry.find((candidate) => candidate.id === reportId)!;

  return (
    <section className="workspace-panel" aria-labelledby="selected-report-heading">
      <div className="workspace-header">
        <div>
          <p className="workspace-kicker">{report.sourceRepo}</p>
          <h2 className="workspace-heading" id="selected-report-heading">
            {report.title}
          </h2>
        </div>
        <div className="workspace-stack-mark" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
      </div>
      <p className="workspace-copy">{report.description}</p>
      <div className="workspace-readiness" role="note">
        <span className="readiness-dot" aria-hidden="true" />
        <p className="m0">
          Ready for session credentials. Live API runs collect mapped datasets; uploads
          render full script outputs.
        </p>
      </div>
      <RunControls reportId={reportId} onRun={onRun} />
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
        <ReportDashboard reportId={reportId} records={records} outputSource={outputSource} />
      ) : (
        <div className="raw-table-panel">
          <DataTable records={records} />
        </div>
      )}
    </section>
  );
}
