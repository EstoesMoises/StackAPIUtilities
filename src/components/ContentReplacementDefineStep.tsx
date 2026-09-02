import { useMemo, useRef, useState, type Ref } from "react";
import { downloadTextFile } from "../utils/downloads";
import { createExactTargetSelection } from "../writeTools/contentReplacement/discovery";
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
  ReplacementItemRef,
  ReplacementOptions,
  ReplacementRule,
} from "../writeTools/contentReplacement/types";
import {
  ContentReplacementJobManager,
  type ContentReplacementJobManagerStorage,
} from "./ContentReplacementJobManager";
import {
  ContentReplacementDiscoveryFields,
  createInitialContentReplacementDiscoveryFieldsValue,
  validateContentReplacementDiscoveryFields,
  type ContentReplacementDiscoveryFieldsHandle,
  type ContentReplacementDiscoveryFieldsValue,
} from "./ContentReplacementDiscoveryFields";

export interface ContentReplacementDefineStepProps {
  onStartScan(configuration: ReplacementConfiguration, exactTargets?: ReplacementItemRef[]): Promise<void> | void;
  expectedOrigin?: string;
  disabled?: boolean;
  scanReadiness?: { ready: boolean; message: string };
  setupError?: string | null;
  storageError?: string | null;
  onReconnect?: () => void;
  onOpenLocalJob?: (jobId: string) => void;
  onDeleteLocalJob?: (jobId: string) => void;
  contentReplacementStorage?: ContentReplacementJobManagerStorage;
}

interface ReviewedCheckpoint {
  key: string;
  draftKey: string;
  configuration: ReplacementConfiguration;
  exactTargets?: ReplacementItemRef[];
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
  expectedOrigin,
  disabled = false,
  scanReadiness = { ready: true, message: "" },
  setupError = null,
  storageError = null,
  onReconnect,
  onOpenLocalJob,
  onDeleteLocalJob,
  contentReplacementStorage,
}: ContentReplacementDefineStepProps) {
  const defaults = useMemo(createDefaultReplacementConfiguration, []);
  const nextRowId = useRef(2);
  const fileReadRequestId = useRef(0);
  const startPending = useRef(false);
  const fieldRefs = useRef(new Map<string, HTMLInputElement>());
  const firstContentTypeRef = useRef<HTMLInputElement>(null);
  const discardImportErrorsRef = useRef<HTMLButtonElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const firstImportChoiceRef = useRef<HTMLButtonElement>(null);
  const discoveryFieldsRef = useRef<ContentReplacementDiscoveryFieldsHandle>(null);
  const [rules, setRules] = useState<ReplacementRule[]>([
    { id: "manual-1", find: "", replace: "" },
  ]);
  const [contentTypes, setContentTypes] = useState(defaults.contentTypes);
  const [options, setOptions] = useState(defaults.options);
  const [discoveryFields, setDiscoveryFields] = useState<ContentReplacementDiscoveryFieldsValue>(
    createInitialContentReplacementDiscoveryFieldsValue,
  );
  const [reviewed, setReviewed] = useState<ReviewedCheckpoint | null>(null);
  const [showValidation, setShowValidation] = useState(false);
  const [fileErrors, setFileErrors] = useState<string[]>([]);
  const [fileStatus, setFileStatus] = useState<string | null>(null);
  const [pendingImport, setPendingImport] = useState<PendingImport | null>(null);
  const [fileReading, setFileReading] = useState(false);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const rulesRef = useRef(rules);
  rulesRef.current = rules;

  const validation = validateReplacementRules(rules, options);
  const fieldErrors = getFieldErrors(rules, validation.errors);
  const discoveryValidation = useMemo(
    () => validateContentReplacementDiscoveryFields(discoveryFields, contentTypes, expectedOrigin),
    [contentTypes, discoveryFields, expectedOrigin],
  );
  const structuralErrors = getStructuralErrors(rules, contentTypes, fileReading, pendingImport !== null);
  const errorCount = fieldErrors.length + structuralErrors.length + fileErrors.length + discoveryValidation.errors.length;
  const currentDraftKey = configurationDraftSnapshotKey(rules, contentTypes, options, discoveryFields.mode, discoveryValidation.targets);
  const checkpointCurrent = reviewed?.draftKey === currentDraftKey;
  const canStart = checkpointCurrent && errorCount === 0 && scanReadiness.ready && !disabled && !starting;

  function invalidateCheckpoint() {
    setReviewed(null);
    setStartError(null);
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
    setFileReading(!!file);
    setFileStatus(file ? `Reading ${file.name}…` : null);
    invalidateCheckpoint();
    if (!file) return;

    try {
      const csv = await readFileText(file);
      if (fileReadRequestId.current !== requestId) return;
      const parsed = parseReplacementCsv(csv);
      setFileErrors(parsed.fileErrors);
      setFileReading(false);
      if (parsed.rows.length === 0) {
        setFileStatus(parsed.fileErrors.length === 0 ? `${file.name} contains no mappings.` : null);
        return;
      }
      const importedRows = parsed.rows.map((row) => ({
        ...row,
        id: `csv-${requestId}-${row.sourceRow ?? nextRowId.current++}`,
      }));
      if (hasNonblankRule(rulesRef.current)) {
        setPendingImport({ rows: importedRows, fileName: file.name, requestId });
        setFileStatus(`${file.name} is ready. Choose how to apply its rows.`);
      } else {
        applyImport(importedRows, "replace", file.name, requestId);
      }
    } catch (error) {
      if (fileReadRequestId.current !== requestId) return;
      setFileReading(false);
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

  async function reviewRules() {
    setShowValidation(true);
    if (errorCount > 0) {
      setReviewed(null);
      const firstInvalid = rules.flatMap((rule) => fieldErrors.filter((error) => error.ruleId === rule.id))[0];
      queueMicrotask(() => {
        if (firstInvalid) fieldRefs.current.get(`${firstInvalid.ruleId}:${firstInvalid.field}`)?.focus();
        else if (!contentTypes.questions && !contentTypes.answers && !contentTypes.articles) firstContentTypeRef.current?.focus();
        else if (fileErrors.length > 0) discardImportErrorsRef.current?.focus();
        else if (pendingImport) firstImportChoiceRef.current?.focus();
        else if (fileReading) fileInputRef.current?.focus();
        else discoveryFieldsRef.current?.focusFirstError();
      });
      return;
    }
    let discovery: ReplacementConfiguration["discovery"];
    let exactTargets: ReplacementItemRef[] | undefined;
    if (discoveryFields.mode === "exact") {
      try {
        const exactSelection = await createExactTargetSelection(discoveryValidation.targets);
        discovery = exactSelection.discovery;
        exactTargets = freezeExactTargets(exactSelection.targets);
      } catch (error) {
        setReviewed(null);
        setStartError(error instanceof Error ? error.message : "Exact targets could not be prepared.");
        queueMicrotask(() => discoveryFieldsRef.current?.focusFirstError());
        return;
      }
    } else {
      discovery = discoveryFields.mode === "full" ? { mode: "full" } : { mode: "targeted" };
    }
    const configuration = createConfiguration(contentTypes, validation.rules, options, discovery);
    setReviewed({
      key: configurationSnapshotKey(rules, contentTypes, options, discovery),
      draftKey: currentDraftKey,
      configuration,
      exactTargets,
    });
  }

  async function startScan() {
    if (!canStart || !reviewed || startPending.current) return;
    startPending.current = true;
    setStarting(true);
    try {
      if (reviewed.exactTargets) await onStartScan(reviewed.configuration, reviewed.exactTargets);
      else await onStartScan(reviewed.configuration);
      setStartError(null);
    } catch (error) {
      setStartError(error instanceof Error ? error.message : "The content replacement scan could not be started.");
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

      {onOpenLocalJob && (
        <ContentReplacementJobManager
          onOpenJob={onOpenLocalJob}
          onDeleteJob={onDeleteLocalJob}
          storage={contentReplacementStorage}
        />
      )}

      <section className="content-replacement-section" aria-labelledby="content-replacement-target-heading">
        <h3 id="content-replacement-target-heading">Target</h3>
        <dl className="content-replacement-target">
          <div><dt>Content space</dt><dd>Enterprise main site</dd></div>
        </dl>
      </section>

      <ContentReplacementDiscoveryFields
        ref={discoveryFieldsRef}
        value={discoveryFields}
        onChange={(next) => {
          setDiscoveryFields(next);
          invalidateCheckpoint();
        }}
        expectedOrigin={expectedOrigin}
        contentTypes={contentTypes}
        showValidation={showValidation}
        disabled={disabled || starting}
      />

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
                const findErrors = fieldErrors.filter((error) => error.ruleId === rule.id && error.field === "find");
                const replaceErrors = fieldErrors.filter((error) => error.ruleId === rule.id && error.field === "replace");
                return (
                  <tr key={rule.id}>
                    <td>
                      <label htmlFor={`${rule.id}-find`}>Find term {index + 1}</label>
                      <input
                        className="s-input"
                        id={`${rule.id}-find`}
                        ref={(node) => setFieldRef(fieldRefs.current, rule.id, "find", node)}
                        value={rule.find}
                        maxLength={MAX_FIND_LENGTH}
                        aria-invalid={showValidation && findErrors.length > 0 ? "true" : undefined}
                        aria-describedby={showValidation && findErrors.length > 0 ? `${rule.id}-find-error` : undefined}
                        onChange={(event) => updateRule(rule.id, "find", event.currentTarget.value)}
                      />
                      {showValidation && findErrors.length > 0 && (
                        <span className="content-replacement-field-error" id={`${rule.id}-find-error`}>
                          {findErrors.map((error) => error.message).join(" ")}
                        </span>
                      )}
                    </td>
                    <td>
                      <label htmlFor={`${rule.id}-replace`}>Replace term {index + 1} with</label>
                      <input
                        className="s-input"
                        id={`${rule.id}-replace`}
                        ref={(node) => setFieldRef(fieldRefs.current, rule.id, "replace", node)}
                        value={rule.replace}
                        maxLength={MAX_REPLACEMENT_LENGTH}
                        aria-invalid={showValidation && replaceErrors.length > 0 ? "true" : undefined}
                        aria-describedby={showValidation && replaceErrors.length > 0 ? `${rule.id}-replace-error` : undefined}
                        onChange={(event) => updateRule(rule.id, "replace", event.currentTarget.value)}
                      />
                      {showValidation && replaceErrors.length > 0 && (
                        <span className="content-replacement-field-error" id={`${rule.id}-replace-error`}>
                          {replaceErrors.map((error) => error.message).join(" ")}
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
        {showValidation && structuralErrors.map((message) => <div className="s-notice s-notice__danger" key={message}>{message}</div>)}
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
          <input ref={fileInputRef} type="file" accept=".csv,text/csv" aria-label="Import replacement CSV" onChange={(event) => void handleFile(event.currentTarget.files?.[0])} />
        </label>
        {fileStatus && <p role="status">{fileStatus}</p>}
        {fileErrors.length > 0 && <div className="s-notice s-notice__danger" role="alert" aria-label="CSV import errors">
          <ul>{fileErrors.map((error) => <li key={error}>{error}</li>)}</ul>
          <button ref={discardImportErrorsRef} className="s-btn s-btn__outlined" type="button" onClick={() => { setFileErrors([]); invalidateCheckpoint(); }}>Discard import errors</button>
        </div>}
        {pendingImport && (
          <div className="content-replacement-import-choice s-notice s-notice__info" role="group" aria-label="Apply imported mappings">
            <p>{pendingImport.fileName} has {pendingImport.rows.length} imported {pendingImport.rows.length === 1 ? "row" : "rows"}. Append them or replace the current list?</p>
            <div className="write-tool-actions content-replacement-actions">
              <button ref={firstImportChoiceRef} className="s-btn s-btn__outlined" type="button" onClick={() => applyImport(pendingImport.rows, "append", pendingImport.fileName, pendingImport.requestId)}>Append imported rows</button>
              <button className="s-btn s-btn__outlined" type="button" onClick={() => applyImport(pendingImport.rows, "replace", pendingImport.fileName, pendingImport.requestId)}>Replace current rows</button>
            </div>
          </div>
        )}
      </section>

      <fieldset
        className="content-replacement-section"
        aria-invalid={showValidation && !contentTypes.questions && !contentTypes.answers && !contentTypes.articles ? "true" : undefined}
        aria-describedby={showValidation && !contentTypes.questions && !contentTypes.answers && !contentTypes.articles ? "content-replacement-content-types-error" : undefined}
      >
        <legend>Content types</legend>
        <div className="content-replacement-checkboxes">
          <Checkbox inputRef={firstContentTypeRef} label="Questions" checked={contentTypes.questions} onChange={(checked) => updateContentType("questions", checked)} />
          <Checkbox label="Answers" checked={contentTypes.answers} onChange={(checked) => updateContentType("answers", checked)} />
          <Checkbox label="Articles" checked={contentTypes.articles} onChange={(checked) => updateContentType("articles", checked)} />
        </div>
        {showValidation && !contentTypes.questions && !contentTypes.answers && !contentTypes.articles && (
          <p className="content-replacement-field-error" id="content-replacement-content-types-error">Select at least one content type.</p>
        )}
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
        {showValidation && errorCount > 0 && (
          <div className="s-notice s-notice__danger" role="alert" aria-label="Rule validation summary">
            {validationSummary(errorCount, fieldErrors.length, contentTypes, fileErrors.length, fileReading, pendingImport !== null)}
          </div>
        )}
        {reviewed && checkpointCurrent ? <RuleSummary configuration={reviewed.configuration} /> : <p>Review the current configuration to unlock scanning.</p>}
        <p>Starting the scan performs reads only. No content is written during this stage.</p>
        {!scanReadiness.ready && <div className="s-notice s-notice__warning">
          <p>Scanning requires valid Enterprise write credentials. {scanReadiness.message}</p>
          {onReconnect && <button className="s-btn s-btn__outlined" type="button" onClick={onReconnect}>Reconnect credentials</button>}
        </div>}
        {(setupError || startError) && <div className="s-notice s-notice__danger" role="alert" aria-label="Scan setup error">{startError ?? setupError}</div>}
        <div className="write-tool-actions content-replacement-actions">
          <button className="s-btn s-btn__outlined" type="button" onClick={reviewRules} disabled={disabled || starting}>Review rules</button>
          <button className="s-btn s-btn__primary" type="button" onClick={() => void startScan()} disabled={!canStart}>{starting ? "Starting scan…" : storageError ? "Save job and start scan" : "Start scan"}</button>
        </div>
      </section>
    </section>
  );
}

function Checkbox({ label, checked, onChange, inputRef }: { label: string; checked: boolean; onChange(checked: boolean): void; inputRef?: Ref<HTMLInputElement> }) {
  return <label className="write-tool-checkbox"><input ref={inputRef} type="checkbox" checked={checked} onChange={(event) => onChange(event.currentTarget.checked)} /> <span>{label}</span></label>;
}

function validationSummary(
  errorCount: number,
  fieldErrorCount: number,
  contentTypes: ReplacementConfiguration["contentTypes"],
  importErrorCount: number,
  fileReading: boolean,
  pendingImport: boolean,
) {
  const prefix = `${errorCount} ${errorCount === 1 ? "error prevents" : "errors prevent"} scanning.`;
  if (fieldErrorCount > 0) return `${prefix} Correct the highlighted ${fieldErrorCount === 1 ? "field" : "fields"}.`;
  if (!contentTypes.questions && !contentTypes.answers && !contentTypes.articles) return `${prefix} Select at least one content type.`;
  if (importErrorCount > 0) return `${prefix} Resolve the CSV import ${importErrorCount === 1 ? "error" : "errors"} or discard them.`;
  if (pendingImport) return `${prefix} Choose how to apply the imported mappings.`;
  if (fileReading) return `${prefix} Wait for the CSV file read to finish.`;
  return `${prefix} Resolve the listed issue.`;
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
  discovery: ReplacementConfiguration["discovery"],
): ReplacementConfiguration {
  return {
    target: { kind: "enterprise-main" },
    contentTypes: { ...contentTypes },
    discovery,
    rules: rules.map((rule) => ({ ...rule })),
    options: { ...options },
  };
}

function configurationSnapshotKey(
  rules: ReplacementRule[],
  contentTypes: ReplacementConfiguration["contentTypes"],
  options: ReplacementOptions,
  discovery: ReplacementConfiguration["discovery"],
) {
  return JSON.stringify({ rules, contentTypes, options, discovery });
}

function configurationDraftSnapshotKey(
  rules: ReplacementRule[],
  contentTypes: ReplacementConfiguration["contentTypes"],
  options: ReplacementOptions,
  mode: ContentReplacementDiscoveryFieldsValue["mode"],
  exactTargets: ReplacementItemRef[],
) {
  return JSON.stringify({ rules, contentTypes, options, discovery: { mode, exactTargets } });
}

function freezeExactTargets(targets: ReplacementItemRef[]): ReplacementItemRef[] {
  return Object.freeze(targets.map((target) => Object.freeze({ ...target }))) as unknown as ReplacementItemRef[];
}

function getStructuralErrors(
  rules: ReplacementRule[],
  contentTypes: ReplacementConfiguration["contentTypes"],
  fileReading: boolean,
  hasPendingImport: boolean,
): string[] {
  const errors: string[] = [];
  if (rules.length < 1) errors.push("Add at least one replacement mapping.");
  if (rules.length > MAX_REPLACEMENT_RULES) errors.push(`Use no more than ${MAX_REPLACEMENT_RULES} replacement mappings.`);
  if (!contentTypes.questions && !contentTypes.answers && !contentTypes.articles) errors.push("Select at least one content type.");
  if (fileReading) errors.push("Wait for the CSV file read to finish.");
  if (hasPendingImport) errors.push("Choose whether to append or replace the imported mappings.");
  return errors;
}

interface RuleFieldError {
  ruleId: string;
  field: "find" | "replace";
  message: string;
}

function getFieldErrors(rules: ReplacementRule[], errors: ReplacementRuleError[]): RuleFieldError[] {
  const output: RuleFieldError[] = [];
  rules.forEach((rule, index) => {
    for (const error of errors.filter((candidate) => candidate.ruleId === rule.id)) {
      const field = error.code === "blank-replacement" ? "replace" : "find";
      output.push({ ruleId: rule.id, field, message: formatFieldError(rule, index, field, RULE_ERROR_MESSAGES[error.code]) });
    }
    if (rule.find.length > MAX_FIND_LENGTH) {
      output.push({ ruleId: rule.id, field: "find", message: formatFieldError(rule, index, "find", `use ${MAX_FIND_LENGTH} characters or fewer`) });
    }
    if (rule.replace.length > MAX_REPLACEMENT_LENGTH) {
      output.push({ ruleId: rule.id, field: "replace", message: formatFieldError(rule, index, "replace", `use ${MAX_REPLACEMENT_LENGTH} characters or fewer`) });
    }
  });
  return output;
}

function formatFieldError(rule: ReplacementRule, index: number, field: "find" | "replace", message: string) {
  const location = rule.sourceRow === undefined ? `Mapping ${index + 1}` : `CSV row ${rule.sourceRow}, ${field}`;
  return `${location}: ${message}.`;
}

function setFieldRef(
  refs: Map<string, HTMLInputElement>,
  ruleId: string,
  field: "find" | "replace",
  node: HTMLInputElement | null,
) {
  const key = `${ruleId}:${field}`;
  if (node) refs.set(key, node);
  else refs.delete(key);
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
