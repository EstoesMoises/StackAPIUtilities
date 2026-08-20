import { validateReportRunScope } from "../domain/reportScope";
import type { ReportRunScope } from "../domain/types";

interface ReportScopePanelProps {
  scope: ReportRunScope;
  onChange: (scope: ReportRunScope) => void;
}

export function ReportScopePanel({ scope, onChange }: ReportScopePanelProps) {
  const validation = validateReportRunScope(scope);
  const comparisonEnabled = scope.comparison !== undefined;

  function updateCurrent(field: "startDate" | "endDate", value: string) {
    onChange({
      ...scope,
      current: { ...scope.current, [field]: normalizeOptionalValue(value) },
    });
  }

  function updateComparison(field: "startDate" | "endDate", value: string) {
    onChange({
      ...scope,
      comparison: { ...(scope.comparison ?? {}), [field]: normalizeOptionalValue(value) },
    });
  }

  function toggleComparison(enabled: boolean) {
    onChange({
      ...scope,
      comparison: enabled ? scope.comparison ?? {} : undefined,
    });
  }

  return (
    <section className="report-scope-panel" aria-labelledby="report-scope-heading">
      <div className="workspace-header">
        <div>
          <p className="fs-caption fc-light mb4">Run scope</p>
          <h3 className="fs-title m0" id="report-scope-heading">
            Scope
          </h3>
        </div>
      </div>
      <p className="scope-help">
        Each run collects all available data for the selected dates. Large instances can take longer while the API
        pages and rate limits are handled automatically. Leave both dates blank to collect all available history.
      </p>
      <div className="scope-grid">
        <label className="scope-field">
          <span>Current start date</span>
          <input
            className="s-input"
            type="date"
            aria-label="Current start date"
            value={scope.current.startDate ?? ""}
            onChange={(event) => updateCurrent("startDate", event.currentTarget.value)}
          />
        </label>
        <label className="scope-field">
          <span>Current end date</span>
          <input
            className="s-input"
            type="date"
            aria-label="Current end date"
            value={scope.current.endDate ?? ""}
            onChange={(event) => updateCurrent("endDate", event.currentTarget.value)}
          />
        </label>
      </div>
      <label className="scope-comparison-toggle">
        <input
          type="checkbox"
          aria-label="Enable comparison period"
          checked={comparisonEnabled}
          onChange={(event) => toggleComparison(event.currentTarget.checked)}
        />
        <span>Enable comparison period</span>
      </label>
      {comparisonEnabled && (
        <div className="scope-grid">
          <label className="scope-field">
            <span>Comparison start date</span>
            <input
              className="s-input"
              type="date"
              aria-label="Comparison start date"
              value={scope.comparison?.startDate ?? ""}
              onChange={(event) => updateComparison("startDate", event.currentTarget.value)}
            />
          </label>
          <label className="scope-field">
            <span>Comparison end date</span>
            <input
              className="s-input"
              type="date"
              aria-label="Comparison end date"
              value={scope.comparison?.endDate ?? ""}
              onChange={(event) => updateComparison("endDate", event.currentTarget.value)}
            />
          </label>
        </div>
      )}
      {!validation.valid && (
        <div className="s-notice s-notice__danger mt12" role="alert">
          {validation.messages.join(" ")}
        </div>
      )}
    </section>
  );
}

function normalizeOptionalValue(value: string): string | undefined {
  return value.trim() === "" ? undefined : value;
}
