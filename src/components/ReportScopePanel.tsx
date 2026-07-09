import { useEffect, useId, useState } from "react";
import {
  REPORT_RUN_PRESETS,
  applyReportRunPreset,
  getEstimatedTotalRecordsForSettings,
  getMaxRecordsForSettings,
  getReportRunPresetDisclosure,
  getReportRunPresetForSettings,
  getReportRunPresetRecordSummary,
} from "../domain/reportRunPresets";
import { validateReportRunScope } from "../domain/reportScope";
import type { ReportId, ReportRunPresetId, ReportRunScope } from "../domain/types";

interface ReportScopePanelProps {
  reportId: ReportId;
  scope: ReportRunScope;
  onChange: (scope: ReportRunScope) => void;
}

export function ReportScopePanel({ reportId, scope, onChange }: ReportScopePanelProps) {
  const validation = validateReportRunScope(scope);
  const comparisonEnabled = scope.comparison !== undefined;
  const isTagReport = reportId === "tag-report";
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const presetIdPrefix = useId();
  const selectedPreset = getReportRunPresetForSettings(scope.pageSize, scope.maxPagesPerDataset);
  const selectedVolumeSummary = selectedPreset
    ? getReportRunPresetRecordSummary(selectedPreset.id)
    : getCustomVolumeSummary(scope);

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

  function updatePreset(presetId: ReportRunPresetId) {
    onChange(applyReportRunPreset(scope, presetId));
  }

  function updateNumber(field: "pageSize" | "maxPagesPerDataset", value: string) {
    const parsedValue = Number.parseInt(value, 10);
    const nextScope = {
      ...scope,
      [field]: parsedValue,
    };
    const matchingPreset = getReportRunPresetForSettings(nextScope.pageSize, nextScope.maxPagesPerDataset);

    onChange({
      ...nextScope,
      runPreset: matchingPreset?.id,
    });
  }

  function toggleComparison(enabled: boolean) {
    onChange({
      ...scope,
      comparison: enabled ? scope.comparison ?? {} : undefined,
    });
  }

  const volumeControls = (
    <>
      <ScopeNumberField
        field="pageSize"
        label="Page size"
        max={100}
        min={1}
        value={scope.pageSize}
        onChange={updateNumber}
      />
      <ScopeNumberField
        field="maxPagesPerDataset"
        label="Max pages per dataset"
        min={1}
        value={scope.maxPagesPerDataset}
        onChange={updateNumber}
      />
    </>
  );

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
        {!isTagReport && volumeControls}
      </div>
      {isTagReport && (
        <>
          <fieldset className="preset-group" aria-label="Record coverage">
            <legend>Record coverage</legend>
            <p className="preset-group-help">
              Choose the amount of Tag Report data to collect. Higher record limits reduce the chance of
              partial results, but can take longer to run.
            </p>
            <div className="preset-options">
              {REPORT_RUN_PRESETS.map((preset) => {
                const labelId = `${presetIdPrefix}-${preset.id}-label`;
                const recordsId = `${presetIdPrefix}-${preset.id}-records`;
                const copyId = `${presetIdPrefix}-${preset.id}-copy`;
                const disclosureId = `${presetIdPrefix}-${preset.id}-disclosure`;

                return (
                  <label className="preset-option" key={preset.id}>
                    <input
                      type="radio"
                      name="tag-report-run-preset"
                      checked={selectedPreset?.id === preset.id}
                      aria-labelledby={labelId}
                      aria-describedby={`${recordsId} ${copyId} ${disclosureId}`}
                      onChange={() => updatePreset(preset.id)}
                    />
                    <span className="preset-option-main">
                      <span className="preset-option-label" id={labelId}>
                        {preset.label}
                      </span>
                      <span className="preset-option-records" id={recordsId}>
                        {getReportRunPresetRecordSummary(preset.id)}
                      </span>
                      <span className="preset-option-copy" id={copyId}>
                        {preset.shortDescription}
                      </span>
                      <span className="preset-option-disclosure" id={disclosureId}>
                        {getReportRunPresetDisclosure(preset.id)}
                      </span>
                    </span>
                  </label>
                );
              })}
            </div>
          </fieldset>
          {!selectedPreset && (
            <p className="preset-custom-note" role="status">
              {selectedVolumeSummary}. Technical settings: pageSize{" "}
              {Number.isNaN(scope.pageSize) ? "unset" : scope.pageSize} and maxPagesPerDataset{" "}
              {Number.isNaN(scope.maxPagesPerDataset) ? "unset" : scope.maxPagesPerDataset}. Select a
              preset above to restore its defaults.
            </p>
          )}
          <details
            className="scope-advanced"
            onToggle={(event) => setAdvancedOpen(event.currentTarget.open)}
          >
            <summary aria-expanded={advancedOpen} role="button">
              Advanced API volume settings
            </summary>
            <p className="scope-help">
              {selectedVolumeSummary}. These collection caps affect runtime and completeness. Increase them
              when avoiding capped results matters more than speed.
            </p>
            <div className="scope-grid">{volumeControls}</div>
          </details>
        </>
      )}
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

function getCustomVolumeSummary(scope: ReportRunScope): string {
  if (!Number.isFinite(scope.pageSize) || !Number.isFinite(scope.maxPagesPerDataset)) {
    return "Custom record coverage is incomplete";
  }

  const totalRecords = getEstimatedTotalRecordsForSettings(scope.pageSize, scope.maxPagesPerDataset);
  const recordsPerDataGroup = getMaxRecordsForSettings(scope.pageSize, scope.maxPagesPerDataset);

  return `Custom record coverage: up to ${totalRecords.toLocaleString(
    "en-US",
  )} estimated records across 5 Tag Report data groups (${recordsPerDataGroup.toLocaleString(
    "en-US",
  )} per data group)`;
}

interface ScopeNumberFieldProps {
  field: "pageSize" | "maxPagesPerDataset";
  label: string;
  min: number;
  max?: number;
  value: number;
  onChange: (field: "pageSize" | "maxPagesPerDataset", value: string) => void;
}

function ScopeNumberField({ field, label, min, max, value, onChange }: ScopeNumberFieldProps) {
  const [draft, setDraft] = useState(formatNumberInputValue(value));

  useEffect(() => {
    setDraft(formatNumberInputValue(value));
  }, [value]);

  return (
    <label className="scope-field">
      <span>{label}</span>
      <input
        className="s-input"
        type="number"
        min={min}
        max={max}
        aria-label={label}
        value={draft}
        onChange={(event) => {
          const nextValue = event.currentTarget.value;
          setDraft(nextValue);
          onChange(field, nextValue);
        }}
      />
    </label>
  );
}

function formatNumberInputValue(value: number): string {
  return Number.isNaN(value) ? "" : String(value);
}
