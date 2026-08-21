import { useEffect, useMemo, useRef, useState } from "react";
import type { ReportSectionId } from "../reports/reportPresentation";
import type { SmeCoverageDecisionPack as DecisionPack } from "../utilities/smeCoverage/model";
import {
  createSmeCoveragePresentation,
  type SmeCoveragePresentation,
} from "../utilities/smeCoverage/presentation";
import {
  downloadSmeCoverageEvidenceCsv,
  downloadSmeCoverageMarkdown,
} from "../utils/smeCoverageDownloads";
import { downloadSmeCoveragePdf } from "../utils/smeCoveragePdfDownload";
import {
  ReportCommandCenter,
  requireReportCommandCenterSections,
  type ReportCommandCenterSection,
} from "./ReportCommandCenter";
import { ReportExportBar, type ReportExportFeedback } from "./ReportExportBar";
import { SmeCoverageAssessment } from "./SmeCoverageAssessment";
import { SmeCoverageEvidenceTable } from "./SmeCoverageEvidenceTable";
import { SmeCoverageFindings } from "./SmeCoverageFindings";
import { SmeCoverageMethodology } from "./SmeCoverageMethodology";

interface SmeCoverageDecisionPackProps {
  pack: DecisionPack;
  onRunAgain: () => void;
  runPending?: boolean;
}

interface SmeCoverageCommandCenterProps extends SmeCoverageDecisionPackProps {
  presentation: SmeCoveragePresentation;
}

export function SmeCoverageDecisionPack({
  pack,
  onRunAgain,
  runPending = false,
}: SmeCoverageDecisionPackProps) {
  const presentation = useMemo(() => createSmeCoveragePresentation(pack), [pack]);

  return (
    <SmeCoverageCommandCenter
      key={presentation.reportKey}
      pack={pack}
      presentation={presentation}
      onRunAgain={onRunAgain}
      runPending={runPending}
    />
  );
}

function SmeCoverageCommandCenter({
  pack,
  presentation,
  onRunAgain,
  runPending = false,
}: SmeCoverageCommandCenterProps) {
  const [pdfPending, setPdfPending] = useState(false);
  const [downloadFeedback, setDownloadFeedback] = useState<ReportExportFeedback>({ state: "idle" });
  const mountedRef = useRef(true);
  const pdfRequestRef = useRef(0);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      pdfRequestRef.current += 1;
    };
  }, []);

  async function startPdfDownload() {
    const requestId = ++pdfRequestRef.current;
    setPdfPending(true);
    setDownloadFeedback({ state: "idle" });

    try {
      await downloadSmeCoveragePdf(pack);
      if (!isCurrentPdfRequest(requestId)) return;
      setDownloadFeedback({ state: "success", message: "PDF download started." });
    } catch {
      if (!isCurrentPdfRequest(requestId)) return;
      setDownloadFeedback({
        state: "failed",
        message: "The PDF download could not be prepared. Check browser download permissions and try again.",
      });
    } finally {
      if (isCurrentPdfRequest(requestId)) setPdfPending(false);
    }
  }

  function isCurrentPdfRequest(requestId: number): boolean {
    return mountedRef.current && pdfRequestRef.current === requestId;
  }

  function startTextDownload(format: "Markdown" | "CSV") {
    try {
      if (format === "Markdown") downloadSmeCoverageMarkdown(pack);
      else downloadSmeCoverageEvidenceCsv(pack);
      setDownloadFeedback({ state: "success", message: `${format} download started.` });
    } catch {
      setDownloadFeedback({
        state: "failed",
        message: `The ${format} download could not start. Check browser download permissions and try again.`,
      });
    }
  }

  const sections = requireReportCommandCenterSections(
    presentation.availableSections.map<ReportCommandCenterSection>((id) => ({
      id,
      label: sectionLabel(id, presentation),
      content: sectionContent(id, pack, presentation),
    })),
  );

  const header = (
    <div className="report-command-header">
      <div className="report-command-identity">
        <div className="sme-result-title-row">
          <h2 id="sme-decision-pack-heading">{presentation.title}</h2>
          <span
            className={`sme-completeness-badge sme-completeness-badge__${pack.snapshot.completeness.toLowerCase()}`}
          >
            {presentation.qualityLabel}
          </span>
        </div>
        <p className="report-command-meta">
          <span className="report-command-kind">{presentation.kindLabel}</span>
          <span>{presentation.sourceLabel}</span>
          <span>{presentation.generatedAt}</span>
          <span>{presentation.rowCount.toLocaleString("en-US")} evidence rows</span>
        </p>
      </div>
      <ReportExportBar
        feedback={downloadFeedback}
        onExportPdf={presentation.exports.pdf ? startPdfDownload : undefined}
        onExportCsv={presentation.exports.csv ? () => startTextDownload("CSV") : undefined}
        onExportMarkdown={presentation.exports.markdown ? () => startTextDownload("Markdown") : undefined}
        onRunAgain={onRunAgain}
        pdfPending={pdfPending}
        runPending={runPending}
      />
    </div>
  );

  return (
    <ReportCommandCenter
      reportKey={presentation.reportKey}
      header={header}
      sections={sections}
    />
  );
}

function sectionLabel(id: ReportSectionId, presentation: SmeCoveragePresentation): string {
  switch (id) {
    case "overview":
      return "Overview";
    case "findings":
      return `Priority findings · ${presentation.findings.length.toLocaleString("en-US")}`;
    case "evidence":
      return `Evidence · ${presentation.rowCount.toLocaleString("en-US")}`;
    case "methodology":
      return "Methodology";
  }
}

function sectionContent(
  id: ReportSectionId,
  pack: DecisionPack,
  presentation: SmeCoveragePresentation,
) {
  switch (id) {
    case "overview":
      return <SmeOverview pack={pack} presentation={presentation} />;
    case "findings":
      return <SmeCoverageFindings findings={presentation.findings} />;
    case "evidence":
      return <SmeCoverageEvidenceTable evidence={presentation.evidence} />;
    case "methodology":
      return (
        <SmeCoverageMethodology
          methodology={pack.methodology}
          completeness={pack.snapshot.completeness}
          standalone
        />
      );
  }
}

function SmeOverview({
  pack,
  presentation,
}: {
  pack: DecisionPack;
  presentation: SmeCoveragePresentation;
}) {
  const prioritySnapshot = presentation.findings.slice(0, 3);

  return (
    <div className="sme-overview-layout">
      <div className="sme-overview-main">
        {pack.warnings.length > 0 && (
          <section className="sme-warning-stack" aria-labelledby="sme-warnings-heading">
            <h3 id="sme-warnings-heading">Evidence notes</h3>
            {pack.warnings.map((warning) => (
              <p className="s-notice s-notice__warning" role="alert" key={`${warning.code}-${warning.message}`}>
                {warning.message}
              </p>
            ))}
          </section>
        )}

        <dl className="sme-snapshot" aria-label="Analysis snapshot">
          <SnapshotItem label="Instance" value={pack.snapshot.instanceHost} />
          <SnapshotItem label="Generated" value={pack.snapshot.generatedAt} />
          <SnapshotItem label="Scope" value={pack.snapshot.scopeLabel} />
          <SnapshotItem label="Collection" value={pack.snapshot.collectionLabel} />
        </dl>

        <section className="sme-summary" aria-labelledby="sme-summary-heading">
          <h3 id="sme-summary-heading">Executive summary</h3>
          <dl className="sme-kpi-strip">
            {presentation.metrics.map((metric) => (
              <div className="sme-kpi" key={metric.label}>
                <dt>{metric.label}</dt>
                <dd>
                  {typeof metric.value === "number"
                    ? metric.value.toLocaleString("en-US")
                    : metric.value}
                </dd>
              </div>
            ))}
          </dl>
          <p className="sme-overview">{presentation.overview}</p>
        </section>

        <SmeCoverageAssessment assessment={pack.assessment} />

        <section className="sme-priority-snapshot" aria-labelledby="sme-priority-snapshot-heading">
          <h3 id="sme-priority-snapshot-heading">Priority snapshot</h3>
          {prioritySnapshot.length > 0 ? (
            <ul aria-label="Top priority findings">
              {prioritySnapshot.map(({ tier, evidence }, index) => (
                <li key={`${tier}:${evidence.tagName}:${index}`}>
                  <div className="sme-priority-snapshot-heading">
                    <span className={`sme-tier-badge sme-tier-badge__${tierClass(tier)}`}>{tier}</span>
                    <strong>{evidence.tagName}</strong>
                  </div>
                  <p>{evidence.recommendedAction}</p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="sme-empty-state">No prepared priority findings are available for this report.</p>
          )}
        </section>
      </div>

      <aside className="sme-deliverable-panel" aria-labelledby="sme-deliverable-heading">
        <h3 id="sme-deliverable-heading">Deliverable</h3>
        <strong>Ready to share</strong>
        <p>The PDF includes the executive brief, priority findings, methodology, and supporting evidence.</p>
        <p>
          {presentation.exports.csv
            ? "The evidence CSV contains every canonical row in decision-pack order."
            : "No evidence CSV is available because this report contains no canonical evidence rows."}
        </p>
      </aside>
    </div>
  );
}

function SnapshotItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function tierClass(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-");
}
