import { getExecutableReports } from "../domain/reportRegistry";
import type { ReportId } from "../domain/types";

interface ReportCatalogProps {
  selectedReportId: ReportId;
  onSelect: (reportId: ReportId) => void;
}

export function ReportCatalog({ selectedReportId, onSelect }: ReportCatalogProps) {
  const reports = getExecutableReports();

  return (
    <section className="report-catalog" aria-labelledby="report-catalog-heading">
      <h2 className="fs-title mb12" id="report-catalog-heading">
        Report Catalog
      </h2>
      <div className="report-list">
        {reports.map((report) => (
          <button
            className={`report-list-button${selectedReportId === report.id ? " is-selected" : ""}`}
            type="button"
            aria-pressed={selectedReportId === report.id}
            aria-label={report.title}
            onClick={() => onSelect(report.id)}
            key={report.id}
          >
            <span className="report-list-title">{report.title}</span>
            <span className="report-list-source">{report.sourceRepo}</span>
            <span className="report-list-meta">Browser-ready read-only report</span>
          </button>
        ))}
      </div>
    </section>
  );
}
