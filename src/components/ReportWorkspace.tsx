import { useId, useMemo, useState } from "react";
import { isLegacyCollectionWarning } from "../domain/collectionWarnings";
import { formatPeriodLabel } from "../domain/reportScope";
import { reportRegistry } from "../domain/reportRegistry";
import type {
  DatasetName,
  PeriodScope,
  ReportId,
  ReportRunScope,
  ReportWarning,
  RunPeriodRole,
} from "../domain/types";
import { createScriptReportPresentation } from "../reports/scriptReportPresentation";
import { downloadReportCsv } from "../utils/reportDownloads";
import { DataTable } from "./DataTable";
import {
  ReportCommandCenter,
  requireReportCommandCenterSections,
  type ReportCommandCenterSection,
} from "./ReportCommandCenter";
import { ReportDashboard } from "./ReportDashboard";
import { ReportExportBar, type ReportExportFeedback } from "./ReportExportBar";
import { ReportScopePanel } from "./ReportScopePanel";
import { StackOverflowLogo } from "./StackOverflowLogo";

export interface ReportWorkspaceProps {
  reportId: ReportId;
  records: Record<string, unknown>[];
  comparisonRecords?: Record<string, unknown>[];
  datasetName?: DatasetName;
  currentSnapshotId?: string;
  comparisonSnapshotId?: string;
  loadedAt?: string;
  currentScope?: PeriodScope;
  comparisonScope?: PeriodScope;
  outputSource?: "live-api" | "upload";
  warnings?: ReportWarning[];
  scope: ReportRunScope;
  onScopeChange: (scope: ReportRunScope) => void;
  onRun: (periodRole: RunPeriodRole) => void;
  onRunBoth: () => void;
}

type ScriptReportPresentation = ReturnType<typeof createScriptReportPresentation>;

interface ScriptResultProps {
  presentation: ScriptReportPresentation;
  reportId: ReportId;
  records: Record<string, unknown>[];
  comparisonRecords?: Record<string, unknown>[];
  datasetName?: DatasetName;
  loadedAt: string;
  currentScope?: PeriodScope;
  comparisonScope?: PeriodScope;
  outputSource: "live-api" | "upload";
  warnings?: ReportWarning[];
  onRunAgain: () => void;
}

export function ReportWorkspace({
  reportId,
  records,
  comparisonRecords,
  datasetName,
  currentSnapshotId,
  comparisonSnapshotId,
  loadedAt,
  currentScope,
  comparisonScope,
  outputSource,
  warnings,
  scope,
  onScopeChange,
  onRun,
  onRunBoth,
}: ReportWorkspaceProps) {
  const report = reportRegistry.find((candidate) => candidate.id === reportId)!;
  const comparisonEnabled = scope.comparison !== undefined;
  const legacyCollection =
    warnings?.some((warning) => isLegacyCollectionWarning(warning, reportId)) ?? false;
  const presentation = useMemo(
    () =>
      loadedAt && outputSource
        ? createScriptReportPresentation({
            reportId,
            records,
            comparisonRecords,
            datasetName,
            currentSnapshotId,
            comparisonSnapshotId,
            loadedAt,
            outputSource,
            currentScope,
            comparisonScope,
            warnings: warnings ?? [],
          })
        : undefined,
    [
      comparisonRecords,
      comparisonScope,
      comparisonSnapshotId,
      currentScope,
      currentSnapshotId,
      datasetName,
      loadedAt,
      outputSource,
      records,
      reportId,
      warnings,
    ],
  );

  return (
    <div className="workspace-stack">
      <section className="workspace-panel" aria-labelledby="selected-report-heading">
        <div className="workspace-header">
          <div>
            <p className="workspace-kicker">{report.sourceRepo}</p>
            <h2 className="workspace-heading" id="selected-report-heading">
              Configure {report.title}
            </h2>
          </div>
          <StackOverflowLogo className="workspace-stack-mark" variant="glyph" />
        </div>
        <p className="workspace-copy">{report.description}</p>
        <div className="workspace-readiness" role="note">
          <span className="readiness-dot" aria-hidden="true" />
          <p className="m0">
            Ready for session credentials. Live API runs collect mapped datasets; uploads
            render full script outputs. Loaded datasets stay in this browser until removed.
          </p>
        </div>
        <ReportScopePanel scope={scope} onChange={onScopeChange} />
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
        {outputSource === "live-api" && (
          <div
            className={`collection-status s-notice ${
              legacyCollection ? "s-notice__warning" : "s-notice__success"
            } mt16`}
            role="status"
            aria-label="Collection status"
          >
            <strong>
              {legacyCollection
                ? "Legacy run — completeness not verified under current collection rules."
                : "All available data collected"}
            </strong>
            {currentScope ? (
              <>
                <span> · {formatPeriodLabel(currentScope)}</span>
                {comparisonScope && (
                  <span> · Compared with {formatPeriodLabel(comparisonScope)}</span>
                )}
              </>
            ) : comparisonScope ? (
              <span> · Comparison: {formatPeriodLabel(comparisonScope)}</span>
            ) : null}
          </div>
        )}
      </section>
      {presentation && loadedAt && outputSource && (
        <ScriptResult
          key={presentation.reportKey}
          presentation={presentation}
          reportId={reportId}
          records={records}
          comparisonRecords={comparisonRecords}
          datasetName={datasetName}
          loadedAt={loadedAt}
          currentScope={currentScope}
          comparisonScope={comparisonScope}
          outputSource={outputSource}
          warnings={warnings}
          onRunAgain={() => onRun("current")}
        />
      )}
    </div>
  );
}

function ScriptResult({
  presentation,
  reportId,
  records,
  comparisonRecords,
  datasetName,
  loadedAt,
  currentScope,
  comparisonScope,
  outputSource,
  warnings,
  onRunAgain,
}: ScriptResultProps) {
  const resultHeadingId = useId();
  const [exportFeedback, setExportFeedback] = useState<ReportExportFeedback>({ state: "idle" });
  const exportRecords = records.length > 0 ? records : (comparisonRecords ?? []);
  const exportPeriodRole = records.length > 0 ? "current" : "comparison";
  const sections = requireReportCommandCenterSections([
    {
      id: "overview",
      label: "Overview",
      content: (
        <ReportDashboard
          reportId={reportId}
          records={records}
          comparisonRecords={comparisonRecords}
          currentScope={currentScope}
          comparisonScope={comparisonScope}
          outputSource={outputSource}
          warnings={warnings}
        />
      ),
    },
    ...(presentation.evidence.length > 0
      ? ([
          {
            id: "evidence",
            label: `Evidence · ${presentation.rowCount.toLocaleString("en-US")}`,
            content: <DataTable records={presentation.evidence} />,
          },
        ] satisfies ReportCommandCenterSection[])
      : []),
  ] satisfies ReportCommandCenterSection[]);

  function exportCsv() {
    if (!datasetName) return;

    setExportFeedback({ state: "idle" });
    try {
      downloadReportCsv({
        reportId,
        datasetName,
        records: [...exportRecords],
        loadedAt,
        source: outputSource,
        periodRole: exportPeriodRole,
        currentScope,
        comparisonScope,
      });
      setExportFeedback({
        state: "success",
        message: `CSV download started for ${exportRecords.length.toLocaleString("en-US")} rows.`,
      });
    } catch {
      setExportFeedback({
        state: "failed",
        message: `The CSV download could not start for ${exportRecords.length.toLocaleString("en-US")} rows. Check browser download permissions and try again.`,
      });
    }
  }

  const header = (
    <div className="report-command-header">
      <div className="report-command-identity">
        <div className="script-report-title-row">
          <h2 id={resultHeadingId}>{presentation.title} result</h2>
          <span className={`script-report-quality script-report-quality__${presentation.qualityTone}`}>
            {presentation.qualityLabel}
          </span>
        </div>
        <p className="report-command-meta">
          <span className="report-command-kind">{presentation.kindLabel}</span>
          <span>{presentation.sourceLabel}</span>
          <span>
            <time dateTime={presentation.generatedAt}>{presentation.generatedAt}</time>
          </span>
          <span>{presentation.scopeLabel}</span>
          <span>{presentation.rowCount.toLocaleString("en-US")} evidence rows</span>
        </p>
      </div>
      <div className="script-report-actions">
        <ReportExportBar
          feedback={exportFeedback}
          onExportCsv={presentation.exports.csv && datasetName ? exportCsv : undefined}
          onRunAgain={onRunAgain}
          csvLabel="Export report CSV"
        />
        {presentation.exports.csv && !datasetName && (
          <p className="script-report-export-unavailable" role="note">
            CSV export unavailable because this result has no canonical dataset identity.
          </p>
        )}
      </div>
    </div>
  );

  return (
    <ReportCommandCenter
      reportKey={presentation.reportKey}
      ariaLabelledBy={resultHeadingId}
      header={header}
      sections={sections}
    />
  );
}
