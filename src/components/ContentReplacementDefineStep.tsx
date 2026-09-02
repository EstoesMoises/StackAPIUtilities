import { useMemo, useRef, useState } from "react";
import { downloadTextFile } from "../utils/downloads";
import {
  MAX_FIND_LENGTH,
  MAX_REPLACEMENT_LENGTH,
  MAX_REPLACEMENT_RULES,
  createDefaultReplacementConfiguration,
  createReplacementCsvTemplate,
  parseReplacementCsv,
  validateReplacementRules,
  type ReplacementRuleError,
} from "../writeTools/contentReplacement/rules";
import type {
  ReplacementConfiguration,
  ReplacementOptions,
  ReplacementRule,
} from "../writeTools/contentReplacement/types";

export interface ContentReplacementDefineStepProps {
  onStartScan(configuration: ReplacementConfiguration): Promise<void> | void;
  disabled?: boolean;
}

interface ReviewedCheckpoint {
  key: string;
  configuration: ReplacementConfiguration;
}

interface PendingImport {
  rows: ReplacementRule[];
  fileName: string;
  requestId: number;
}

const RULE_ERROR_MESSAGES: Record<ReplacementRuleError["code"], string> = {
  "blank-source": "enter a find term",
  "blank-replacement": "enter a replacement term",
  "no-op": "find and replacement terms must differ",
  "duplicate-source": "this find term maps to more than one replacement",
  "replacement-is-source": "a replacement cannot also be another find term",
  "overlapping-sources": "find terms cannot overlap",
};

export function ContentReplacementDefineStep({
  onStartScan,
  disabled = false,
}: ContentReplacementDefineStepProps) {
  const defaults = useMemo(createDefaultReplacementConfiguration, []);
  const nextRowId = useRef(2);
  const fileReadRequestId = useRef(0);
  const startPending = useRef(false);
  const [rules, setRules] = useState<ReplacementRule[]>([
    { id: "manual-1", find: "", replace: "" },
  ]);
  const [contentTypes, setContentTypes] = useState(defaults.contentTypes);
  const [options, setOptions] = useState(defaults.options);
  const [reviewed, setReviewed] = useState<ReviewedCheckpoint | null>(null);
  const [showValidation, setShowValidation] = useState(false);
  const [fileErrors, setFileErrors] = useState<string[]>([]);
  const [fileStatus, setFileStatus] = useState<string | null>(null);
  const [pendingImport, setPendingImport] = useState<PendingImport | null>(null);
  const [starting, setStarting] = useState(false);

  const validation = validateReplacementRules(rules, options);
  const structuralErrors = getStructuralErrors(rules, contentTypes);
  const configuration = createConfiguration(contentTypes, validation.rules, options);
  const currentKey = configurationSnapshotKey(rules, contentTypes, options);
  const checkpointCurrent = reviewed?.key === currentKey;
  const canStart = checkpointCurrent && !disabled && !starting;

  function invalidateCheckpoint() {
    setReviewed(null);
  }

  function updateRule(id: string, field: "find" | "replace", value: string) {
    setRules((current) => current.map((rule) => rule.id === id ? { ...rule, [field]: value } : rule));
    invalidateCheckpoint();
  }

  function addRule() {
    if (rules.length >= MAX_REPLACEMENT_RULES) return;
    const id = `manual-${nextRowId.current}`;
    nextRowId.current += 1;
    setRules((current) => [...current, { id, find: "", replace: "" }]);
    invalidateCheckpoint();
  }

  function removeRule(id: string) {
    if (rules.length === 1) return;
    setRules((current) => current.filter((rule) => rule.id !== id));
    invalidateCheckpoint();
  }

  function moveRule(index: number, offset: -1 | 1) {
    const destination = index + offset;
    if (destination < 0 || destination >= rules.length) return;
    setRules((current) => {
      const next = [...current];
      [next[index], next[destination]] = [next[destination], next[index]];
      return next;
    });
    invalidateCheckpoint();
  }

  function updateContentType(kind: keyof ReplacementConfiguration["contentTypes"], checked: boolean) {
    setContentTypes((current) => ({ ...current, [kind]: checked }));
    invalidateCheckpoint();
  }

  function updateOption(kind: keyof ReplacementOptions, checked: boolean) {
    setOptions((current) => ({ ...current, [kind]: checked }));
    invalidateCheckpoint();
  }

  async function handleFile(file: File | undefined) {
    const requestId = fileReadRequestId.current + 1;
    fileReadRequestId.current = requestId;
    setPendingImport(null);
    setFileErrors([]);
    setFileStatus(file ? `Reading ${file.name}…` : null);
    if (!file) return;

    try {
      const csv = await readFileText(file);
      if (fileReadRequestId.current !== requestId) return;
      const parsed = parseReplacementCsv(csv);
      setFileErrors(parsed.fileErrors);
      if (parsed.rows.length === 0) {
        setFileStatus(parsed.fileErrors.length === 0 ? `${file.name} contains no mappings.` : null);
        return;
      }
      const importedRows = parsed.rows.map((row) => ({
        ...row,
        id: `csv-${requestId}-${row.sourceRow ?? nextRowId.current++}`,
      }));
      if (hasNonblankRule(rules)) {
        setPendingImport({ rows: importedRows, fileName: file.name, requestId });
        setFileStatus(`${file.name} is ready. Choose how to apply its rows.`);
      } else {
        applyImport(importedRows, "replace", file.name, requestId);
      }
    } catch (error) {
      if (fileReadRequestId.current !== requestId) return;
      setFileStatus(null);
      setFileErrors([error instanceof Error ? error.message : `Unable to read ${file.name}.`]);
    }
  }

  function applyImport(
    importedRows: ReplacementRule[],
    mode: "append" | "replace",
    fileName: string,
    requestId: number,
  ) {
    if (fileReadRequestId.current !== requestId) return;
    setRules((current) => mode === "append" ? [...current, ...importedRows] : importedRows);
    setPendingImport(null);
    setShowValidation(true);
    setFileStatus(`Loaded ${importedRows.length} ${importedRows.length === 1 ? "mapping" : "mappings"} from ${fileName}.`);
    invalidateCheckpoint();
  }

  function reviewRules() {
    setShowValidation(true);
    if (validation.errors.length > 0 || structuralErrors.length > 0) {
      setReviewed(null);
      return;
    }
    setReviewed({ key: currentKey, configuration });
  }

  async function startScan() {
    if (!canStart || !reviewed || startPending.current) return;
    startPending.current = true;
    setStarting(true);
    try {
      await onStartScan(reviewed.configuration);
    } finally {
      startPending.current = false;
      setStarting(false);
    }
  }

  return (
    <section className="content-replacement-define" aria-labelledby="content-replacement-define-heading">
      <header className="content-replacement-step-header">
        <h2 id="content-replacement-define-heading">Define replacements</h2>
        <p>Map each exact term to its replacement, then review the rules before scanning.</p>
      </header>

      <section className="content-replacement-section" aria-labelledby="content-replacement-target-heading">
        <h3 id="content-replacement-target-heading">Target</h3>
        <dl className="content-replacement-target">
          <div><dt>Content space</dt><dd>Enterprise main site</dd></div>
        </dl>
      </section>

      <section className="content-replacement-section" aria-labelledby="content-replacement-mappings-heading">
        <div className="content-replacement-section-heading">
          <div>
            <h3 id="content-replacement-mappings-heading">Replacement mappings</h3>
            <p>Rules run simultaneously; replacement text is never processed by another rule.</p>
          </div>
          <button className="s-btn s-btn__outlined" type="button" onClick={addRule} disabled={rules.length >= MAX_REPLACEMENT_RULES}>
            Add mapping
          </button>
        </div>
        <div className="datasets-table-wrap content-replacement-table-region" role="region" aria-label="Replacement mappings" tabIndex={0}>
          <table className="s-table write-tool-table content-replacement-mapping-table">
            <thead><tr><th scope="col">Find</th><th scope="col">Replace with</th><th scope="col">Order and removal</th></tr></thead>
            <tbody>
              {rules.map((rule, index) => {
                const errors = validation.errors.filter((error) => error.ruleId === rule.id);
                const findErrors = errors.filter((error) => error.code !== "blank-replacement");
                const replaceErrors = errors.filter((error) => error.code === "blank-replacement");
                return (
                  <tr key={rule.id}>
                    <td>
                      <label htmlFor={`${rule.id}-find`}>Find term {index + 1}</label>
                      <input
                        className="s-input"
                        id={`${rule.id}-find`}
                        value={rule.find}
                        maxLength={MAX_FIND_LENGTH}
                        aria-invalid={showValidation && findErrors.length > 0 ? "true" : undefined}
                        aria-describedby={showValidation && findErrors.length > 0 ? `${rule.id}-find-error` : undefined}
                        onChange={(event) => updateRule(rule.id, "find", event.currentTarget.value)}
                      />
                      {showValidation && findErrors.length > 0 && (
                        <span className="content-replacement-field-error" id={`${rule.id}-find-error`}>
                          {formatRuleError(rule, index, findErrors[0], "find")}
                        </span>
                      )}
                    </td>
                    <td>
                      <label htmlFor={`${rule.id}-replace`}>Replace term {index + 1} with</label>
                      <input
                        className="s-input"
                        id={`${rule.id}-replace`}
                        value={rule.replace}
                        maxLength={MAX_REPLACEMENT_LENGTH}
                        aria-invalid={showValidation && replaceErrors.length > 0 ? "true" : undefined}
                        aria-describedby={showValidation && replaceErrors.length > 0 ? `${rule.id}-replace-error` : undefined}
                        onChange={(event) => updateRule(rule.id, "replace", event.currentTarget.value)}
                      />
                      {showValidation && replaceErrors.length > 0 && (
                        <span className="content-replacement-field-error" id={`${rule.id}-replace-error`}>
                          {formatRuleError(rule, index, replaceErrors[0], "replace")}
                        </span>
                      )}
                    </td>
                    <td>
                      <div className="dataset-actions content-replacement-row-actions">
                        <button className="s-btn s-btn__outlined s-btn__xs" type="button" aria-label={`Move mapping ${index + 1} up`} disabled={index === 0} onClick={() => moveRule(index, -1)}>Up</button>
                        <button className="s-btn s-btn__outlined s-btn__xs" type="button" aria-label={`Move mapping ${index + 1} down`} disabled={index === rules.length - 1} onClick={() => moveRule(index, 1)}>Down</button>
                        <button className="s-btn s-btn__outlined s-btn__xs" type="button" aria-label={`Remove mapping ${index + 1}`} disabled={rules.length === 1} onClick={() => removeRule(rule.id)}>Remove</button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {showValidation && structuralErrors.map((message) => <div className="s-notice s-notice__danger" role="alert" key={message}>{message}</div>)}
        {showValidation && validation.notices.map((notice) => <div className="s-notice s-notice__info" role="status" key={notice}>{notice}</div>)}
      </section>

      <section className="content-replacement-section" aria-labelledby="content-replacement-import-heading">
        <div className="content-replacement-section-heading">
          <div>
            <h3 id="content-replacement-import-heading">Import CSV</h3>
            <p>CSV parsing stays in this browser. Required headers are <code>find,replace</code>.</p>
          </div>
          <button className="s-btn s-btn__outlined" type="button" onClick={() => downloadTextFile("content-replacement-template.csv", createReplacementCsvTemplate(), "text/csv;charset=utf-8")}>Download CSV template</button>
        </div>
        <label className="content-replacement-dropzone" onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); void handleFile(event.dataTransfer.files[0]); }}>
          <span>Choose or drop a replacement CSV</span>
          <input type="file" accept=".csv,text/csv" aria-label="Import replacement CSV" onChange={(event) => void handleFile(event.currentTarget.files?.[0])} />
        </label>
        {fileStatus && <p role="status">{fileStatus}</p>}
        {fileErrors.length > 0 && <div className="s-notice s-notice__danger" role="alert"><ul>{fileErrors.map((error) => <li key={error}>{error}</li>)}</ul></div>}
        {pendingImport && (
          <div className="content-replacement-import-choice s-notice s-notice__info" role="group" aria-label="Apply imported mappings">
            <p>{pendingImport.fileName} has {pendingImport.rows.length} imported {pendingImport.rows.length === 1 ? "row" : "rows"}. Append them or replace the current list?</p>
            <div className="write-tool-actions content-replacement-actions">
              <button className="s-btn s-btn__outlined" type="button" onClick={() => applyImport(pendingImport.rows, "append", pendingImport.fileName, pendingImport.requestId)}>Append imported rows</button>
              <button className="s-btn s-btn__outlined" type="button" onClick={() => applyImport(pendingImport.rows, "replace", pendingImport.fileName, pendingImport.requestId)}>Replace current rows</button>
            </div>
          </div>
        )}
      </section>

      <fieldset className="content-replacement-section">
        <legend>Content types</legend>
        <div className="content-replacement-checkboxes">
          <Checkbox label="Questions" checked={contentTypes.questions} onChange={(checked) => updateContentType("questions", checked)} />
          <Checkbox label="Answers" checked={contentTypes.answers} onChange={(checked) => updateContentType("answers", checked)} />
          <Checkbox label="Articles" checked={contentTypes.articles} onChange={(checked) => updateContentType("articles", checked)} />
        </div>
      </fieldset>

      <details className="content-replacement-section content-replacement-advanced">
        <summary>Advanced</summary>
        <div className="content-replacement-checkboxes">
          <Checkbox label="Case-sensitive matching" checked={options.caseSensitive} onChange={(checked) => updateOption("caseSensitive", checked)} />
          <Checkbox label="Whole-term matching" checked={options.wholeTerm} onChange={(checked) => updateOption("wholeTerm", checked)} />
          <Checkbox label="Replace inside code" checked={options.replaceInCode} onChange={(checked) => updateOption("replaceInCode", checked)} />
        </div>
        <p>Link, image, and autolink destinations and raw HTML attributes remain protected always. Code is protected unless “Replace inside code” is enabled.</p>
        <div className="content-replacement-warning-stack" aria-live="polite">
          {!options.caseSensitive && <p className="s-notice s-notice__warning">Case sensitivity is off. Differently cased terms can be changed.</p>}
          {!options.wholeTerm && <p className="s-notice s-notice__warning">Partial matching is on. Matches inside longer words can be changed.</p>}
          {options.replaceInCode && <p className="s-notice s-notice__warning">Code replacement is on. Matching text inside fenced, indented, and inline code can be changed.</p>}
        </div>
      </details>

      <section className="content-replacement-checkpoint" aria-labelledby="content-replacement-checkpoint-heading">
        <h3 id="content-replacement-checkpoint-heading">Rule checkpoint</h3>
        {reviewed && checkpointCurrent ? <RuleSummary configuration={reviewed.configuration} /> : <p>Review the current configuration to unlock scanning.</p>}
        <p>Starting the scan performs reads only. No content is written during this stage.</p>
        <div className="write-tool-actions content-replacement-actions">
          <button className="s-btn s-btn__outlined" type="button" onClick={reviewRules} disabled={disabled || starting}>Review rules</button>
          <button className="s-btn s-btn__primary" type="button" onClick={() => void startScan()} disabled={!canStart}>{starting ? "Starting scan…" : "Start scan"}</button>
        </div>
      </section>
    </section>
  );
}

function Checkbox({ label, checked, onChange }: { label: string; checked: boolean; onChange(checked: boolean): void }) {
  return <label className="write-tool-checkbox"><input type="checkbox" checked={checked} onChange={(event) => onChange(event.currentTarget.checked)} /> <span>{label}</span></label>;
}

function RuleSummary({ configuration }: { configuration: ReplacementConfiguration }) {
  const contentTypes = [
    configuration.contentTypes.questions && "Questions",
    configuration.contentTypes.answers && "Answers",
    configuration.contentTypes.articles && "Articles",
  ].filter(Boolean).join(", ");
  const optionSummary = [
    configuration.options.caseSensitive ? "Case-sensitive" : "Case-insensitive",
    configuration.options.wholeTerm ? "Whole term" : "Partial matching",
    configuration.options.replaceInCode ? "Code included" : "Code protected",
  ].join("; ");
  return (
    <div className="content-replacement-rule-summary" aria-label="Reviewed rule summary">
      <ol>{configuration.rules.map((rule) => <li key={rule.id}>{rule.find} → {rule.replace}</li>)}</ol>
      <dl>
        <div><dt>Content types</dt><dd>{contentTypes}</dd></div>
        <div><dt>Matching</dt><dd>{optionSummary}</dd></div>
        <div><dt>Protected</dt><dd>Link, image, and autolink destinations; raw HTML attributes{configuration.options.replaceInCode ? "" : "; code"}</dd></div>
      </dl>
    </div>
  );
}

function createConfiguration(
  contentTypes: ReplacementConfiguration["contentTypes"],
  rules: ReplacementRule[],
  options: ReplacementOptions,
): ReplacementConfiguration {
  return { target: { kind: "enterprise-main" }, contentTypes: { ...contentTypes }, rules: rules.map((rule) => ({ ...rule })), options: { ...options } };
}

function configurationSnapshotKey(
  rules: ReplacementRule[],
  contentTypes: ReplacementConfiguration["contentTypes"],
  options: ReplacementOptions,
) {
  return JSON.stringify({ rules, contentTypes, options });
}

function getStructuralErrors(
  rules: ReplacementRule[],
  contentTypes: ReplacementConfiguration["contentTypes"],
): string[] {
  const errors: string[] = [];
  if (rules.length < 1) errors.push("Add at least one replacement mapping.");
  if (rules.length > MAX_REPLACEMENT_RULES) errors.push(`Use no more than ${MAX_REPLACEMENT_RULES} replacement mappings.`);
  if (!contentTypes.questions && !contentTypes.answers && !contentTypes.articles) errors.push("Select at least one content type.");
  return errors;
}

function formatRuleError(
  rule: ReplacementRule,
  index: number,
  error: ReplacementRuleError,
  field: "find" | "replace",
): string {
  const location = rule.sourceRow === undefined ? `Mapping ${index + 1}` : `CSV row ${rule.sourceRow}, ${field}`;
  return `${location}: ${RULE_ERROR_MESSAGES[error.code]}.`;
}

function hasNonblankRule(rules: ReplacementRule[]) {
  return rules.some((rule) => rule.find.trim() !== "" || rule.replace.trim() !== "");
}

async function readFileText(file: File): Promise<string> {
  if (typeof file.text === "function") return file.text();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(String(reader.result ?? "")));
    reader.addEventListener("error", () => reject(reader.error ?? new Error(`Unable to read ${file.name}.`)));
    reader.readAsText(file);
  });
}
