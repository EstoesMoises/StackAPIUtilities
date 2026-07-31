import { useEffect, useId, useState } from "react";
import {
  REPORT_RUN_PRESETS,
  getMaxRecordsForSettings,
  getPrimaryGroupRecordSummary,
  getReportRunPreset,
  getReportRunPresetForSettings,
  getReportRunPresetRecordSummary,
} from "../domain/reportRunPresets";
import type { ApiVolumeSettingsValue, ReportRunPresetId } from "../domain/types";

interface ApiVolumeSettingsProps {
  value: ApiVolumeSettingsValue;
  radioName: string;
  helpText: string;
  recordDetail: string;
  getDisclosure: (presetId: ReportRunPresetId) => string;
  onChange: (value: ApiVolumeSettingsValue) => void;
}

export function ApiVolumeSettings({
  value,
  radioName,
  helpText,
  recordDetail,
  getDisclosure,
  onChange,
}: ApiVolumeSettingsProps) {
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const presetIdPrefix = useId();
  const selectedPreset = getReportRunPresetForSettings(value.pageSize, value.maxPagesPerDataset);
  const selectedVolumeSummary = selectedPreset
    ? getReportRunPresetRecordSummary(selectedPreset.id)
    : getCustomVolumeSummary(value, recordDetail);

  function updatePreset(presetId: ReportRunPresetId) {
    const preset = getReportRunPreset(presetId);
    onChange({
      ...value,
      pageSize: preset.pageSize,
      maxPagesPerDataset: preset.maxPagesPerDataset,
      runPreset: preset.id,
    });
  }

  function updateNumber(field: "pageSize" | "maxPagesPerDataset", inputValue: string) {
    const nextValue = {
      ...value,
      [field]: Number.parseInt(inputValue, 10),
    };
    const matchingPreset = getReportRunPresetForSettings(
      nextValue.pageSize,
      nextValue.maxPagesPerDataset,
    );

    onChange({
      ...nextValue,
      runPreset: matchingPreset?.id,
    });
  }

  const volumeControls = (
    <>
      <ApiVolumeNumberField
        field="pageSize"
        label="Page size"
        max={100}
        min={1}
        value={value.pageSize}
        onChange={updateNumber}
      />
      <ApiVolumeNumberField
        field="maxPagesPerDataset"
        label="Max pages per dataset"
        min={1}
        value={value.maxPagesPerDataset}
        onChange={updateNumber}
      />
    </>
  );

  return (
    <div className="api-volume-settings">
      <fieldset className="preset-group" aria-label="Record coverage">
        <legend>Record coverage</legend>
        <p className="preset-group-help">{helpText}</p>
        <div className="preset-options">
          {REPORT_RUN_PRESETS.map((preset) => {
            const labelId = `${presetIdPrefix}-${preset.id}-label`;
            const recordsId = `${presetIdPrefix}-${preset.id}-records`;
            const recordsDetailId = `${presetIdPrefix}-${preset.id}-records-detail`;
            const copyId = `${presetIdPrefix}-${preset.id}-copy`;
            const disclosureId = `${presetIdPrefix}-${preset.id}-disclosure`;

            return (
              <label className="preset-option" key={preset.id}>
                <input
                  type="radio"
                  name={radioName}
                  checked={selectedPreset?.id === preset.id}
                  aria-labelledby={labelId}
                  aria-describedby={`${recordsId} ${recordsDetailId} ${copyId} ${disclosureId}`}
                  onChange={() => updatePreset(preset.id)}
                />
                <span className="preset-option-main">
                  <span className="preset-option-label" id={labelId}>
                    {preset.label}
                  </span>
                  <span className="preset-option-records" id={recordsId}>
                    {getReportRunPresetRecordSummary(preset.id)}
                  </span>
                  <span className="preset-option-records-detail" id={recordsDetailId}>
                    {recordDetail}
                  </span>
                  <span className="preset-option-copy" id={copyId}>
                    {preset.shortDescription}
                  </span>
                  <span className="preset-option-disclosure" id={disclosureId}>
                    {getDisclosure(preset.id)}
                  </span>
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>
      <details
        className="scope-advanced"
        onToggle={(event) => setAdvancedOpen(event.currentTarget.open)}
      >
        <summary aria-expanded={advancedOpen} role="button">
          Advanced API volume settings
        </summary>
        <p className="scope-help">
          {selectedVolumeSummary}. These collection caps affect runtime and completeness. Increase them when
          avoiding capped results matters more than speed.
        </p>
        <div className="scope-grid">{volumeControls}</div>
      </details>
    </div>
  );
}

function getCustomVolumeSummary(value: ApiVolumeSettingsValue, recordDetail: string): string {
  if (!Number.isFinite(value.pageSize) || !Number.isFinite(value.maxPagesPerDataset)) {
    return "Custom record coverage is incomplete";
  }

  const maxRecords = getMaxRecordsForSettings(value.pageSize, value.maxPagesPerDataset);
  return `Custom record coverage: ${getPrimaryGroupRecordSummary(maxRecords)} for ${recordDetail.toLowerCase()}`;
}

interface ApiVolumeNumberFieldProps {
  field: "pageSize" | "maxPagesPerDataset";
  label: string;
  min: number;
  max?: number;
  value: number;
  onChange: (field: "pageSize" | "maxPagesPerDataset", value: string) => void;
}

function ApiVolumeNumberField({
  field,
  label,
  min,
  max,
  value,
  onChange,
}: ApiVolumeNumberFieldProps) {
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
