import {
  forwardRef,
  useImperativeHandle,
  useMemo,
  useRef,
  type ChangeEvent,
} from "react";
import { downloadTextFile } from "../utils/downloads";
import {
  MAX_EXACT_REPLACEMENT_TARGETS,
  createExactTargetCsvTemplate,
  normalizeExactTargets,
  parseExactTargetCsv,
  parseExactTargetLines,
  type ExactTargetParseError,
  type ExactTargetParseErrorCode,
} from "../writeTools/contentReplacement/discovery";
import type {
  ReplacementConfiguration,
  ReplacementContentKind,
  ReplacementDiscoveryMode,
  ReplacementItemRef,
} from "../writeTools/contentReplacement/types";

export interface ExactTargetDraftRow {
  id: string;
  kind: ReplacementContentKind;
  value: string;
  parentQuestionId: string;
}

export interface ContentReplacementDiscoveryFieldsValue {
  mode: ReplacementDiscoveryMode;
  exactRows: ExactTargetDraftRow[];
  pastedUrls: string;
  pastedTargets: ReplacementItemRef[];
  pastedErrors: ExactTargetParseError[];
  pastedDuplicateCount: number;
  importedTargets: ReplacementItemRef[];
  importedErrors: ExactTargetParseError[];
  importedDuplicateCount: number;
  targetCsvError: string | null;
  targetCsvStatus: string | null;
  targetCsvReading: boolean;
}

export interface ContentReplacementDiscoveryValidation {
  targets: ReplacementItemRef[];
  errors: ContentReplacementDiscoveryError[];
  duplicateCount: number;
}

export interface ContentReplacementDiscoveryError {
  target: "rows" | "paste" | "csv" | "mode";
  rowId?: string;
  field?: "kind" | "value" | "parentQuestionId";
  contentType?: keyof ReplacementConfiguration["contentTypes"];
  code?: ExactTargetParseErrorCode;
  message: string;
}

export interface ContentReplacementDiscoveryFieldsHandle {
  focusFirstError(): void;
}

export interface ContentReplacementDiscoveryFieldsProps {
  value: ContentReplacementDiscoveryFieldsValue;
  onChange(value: ContentReplacementDiscoveryFieldsValue): void;
  expectedOrigin?: string;
  contentTypes: ReplacementConfiguration["contentTypes"];
  showValidation?: boolean;
  disabled?: boolean;
}

const DISCOVERY_OPTIONS: ReadonlyArray<{
  mode: ReplacementDiscoveryMode;
  label: string;
  coverage: string;
  requests: string;
}> = [
  {
    mode: "targeted",
    label: "Targeted scan",
    coverage: "Search-assisted · may miss matches",
    requests: "Uses configured source terms to find likely matches before canonical reads.",
  },
  {
    mode: "exact",
    label: "Exact IDs or URLs",
    coverage: "Complete for the supplied posts",
    requests: "Reads only the normalized posts you provide, then checks each canonical record.",
  },
  {
    mode: "full",
    label: "Full audit",
    coverage: "Exhaustive · all accessible selected content",
    requests: "Indexes every selected content type, then reads the canonical candidates.",
  },
];

export function createInitialContentReplacementDiscoveryFieldsValue(): ContentReplacementDiscoveryFieldsValue {
  return {
    mode: "targeted",
    exactRows: [{ id: "exact-1", kind: "question", value: "", parentQuestionId: "" }],
    pastedUrls: "",
    pastedTargets: [],
    pastedErrors: [],
    pastedDuplicateCount: 0,
    importedTargets: [],
    importedErrors: [],
    importedDuplicateCount: 0,
    targetCsvError: null,
    targetCsvStatus: null,
    targetCsvReading: false,
  };
}

export function validateContentReplacementDiscoveryFields(
  value: ContentReplacementDiscoveryFieldsValue,
  contentTypes: ReplacementConfiguration["contentTypes"],
  expectedOrigin?: string,
): ContentReplacementDiscoveryValidation {
  if (value.mode !== "exact") return { targets: [], errors: [], duplicateCount: 0 };

  const errors: ContentReplacementDiscoveryError[] = [];
  const rowTargets: ReplacementItemRef[] = [];
  for (const row of value.exactRows) {
    const parsed = parseExactTargetRow(row, expectedOrigin);
    if ("empty" in parsed) continue;
    if ("error" in parsed) {
      errors.push({ target: "rows", rowId: row.id, field: parsed.field, message: parsed.error });
      continue;
    }
    rowTargets.push(parsed.target);
  }

  errors.push(...formatParserErrors(value.pastedErrors, "paste"));
  errors.push(...formatParserErrors(value.importedErrors, "csv"));
  if (value.targetCsvError) {
    errors.push({ target: "csv", message: value.targetCsvError });
  }
  if (value.targetCsvReading) {
    errors.push({ target: "csv", message: "Wait for the target CSV file read to finish." });
  }

  const suppliedTargets = [...rowTargets, ...value.pastedTargets, ...value.importedTargets];
  let targets: ReplacementItemRef[] = [];
  if (errors.length === 0) {
    try {
      targets = normalizeExactTargets(suppliedTargets);
    } catch (error) {
      errors.push({
        target: "mode",
        message: error instanceof Error ? error.message : "Exact targets could not be normalized.",
      });
    }
  }

  if (suppliedTargets.length === 0 && errors.length === 0) {
    errors.push({ target: "mode", message: "Add at least one exact target." });
  }
  for (const target of targets) {
    if (target.kind === "question" && !contentTypes.questions) {
      errors.push({
        target: "mode",
        contentType: "questions",
        message: "Question targets require Questions to be selected.",
      });
    } else if (target.kind === "answer" && !contentTypes.answers) {
      errors.push({
        target: "mode",
        contentType: "answers",
        message: "Answer targets require Answers to be selected.",
      });
    } else if (target.kind === "article" && !contentTypes.articles) {
      errors.push({
        target: "mode",
        contentType: "articles",
        message: "Article targets require Articles to be selected.",
      });
    }
  }

  return {
    targets,
    errors,
    duplicateCount: suppliedTargets.length - targets.length + value.pastedDuplicateCount + value.importedDuplicateCount,
  };
}

export const ContentReplacementDiscoveryFields = forwardRef<
  ContentReplacementDiscoveryFieldsHandle,
  ContentReplacementDiscoveryFieldsProps
>(function ContentReplacementDiscoveryFields({
  value,
  onChange,
  expectedOrigin,
  contentTypes,
  showValidation = false,
  disabled = false,
}, ref) {
  const validation = useMemo(
    () => validateContentReplacementDiscoveryFields(value, contentTypes, expectedOrigin),
    [contentTypes, expectedOrigin, value],
  );
  const rowRefs = useRef(new Map<string, HTMLInputElement | HTMLSelectElement>());
  const pasteRef = useRef<HTMLTextAreaElement>(null);
  const csvRef = useRef<HTMLInputElement>(null);
  const fileReadRequestId = useRef(0);
  const currentValueRef = useRef(value);
  currentValueRef.current = value;

  useImperativeHandle(ref, () => ({
    focusFirstError() {
      const first = validation.errors[0];
      if (!first) return;
      if (first.code === "too-many-targets" || first.target === "mode") {
        const firstTarget = currentValueRef.current.exactRows[0];
        if (firstTarget) rowRefs.current.get(`${firstTarget.id}:value`)?.focus();
      } else if (first.target === "rows" && first.rowId && first.field) {
        rowRefs.current.get(`${first.rowId}:${first.field}`)?.focus();
      } else if (first.target === "paste") {
        pasteRef.current?.focus();
      } else if (first.target === "csv") {
        csvRef.current?.focus();
      }
    },
  }), [validation.errors]);

  function update(
    next: Partial<ContentReplacementDiscoveryFieldsValue> | ((current: ContentReplacementDiscoveryFieldsValue) => Partial<ContentReplacementDiscoveryFieldsValue>),
  ) {
    const current = currentValueRef.current;
    onChange({ ...current, ...(typeof next === "function" ? next(current) : next) });
  }

  function changeMode(mode: ReplacementDiscoveryMode) {
    update({ mode });
  }

  function changeRow(rowId: string, field: keyof ExactTargetDraftRow, nextValue: string) {
    update((current) => ({
      exactRows: current.exactRows.map((row) => row.id === rowId ? { ...row, [field]: nextValue } : row),
    }));
  }

  function addRow() {
    update((current) => {
      if (current.exactRows.length >= MAX_EXACT_REPLACEMENT_TARGETS) return {};
      return {
        exactRows: [
          ...current.exactRows,
          {
            id: `exact-${current.exactRows.length + 1}-${Date.now()}`,
            kind: "question",
            value: "",
            parentQuestionId: "",
          },
        ],
      };
    });
  }

  function removeRow(rowId: string) {
    update((current) => {
      if (current.exactRows.length === 1) return {};
      return { exactRows: current.exactRows.filter((row) => row.id !== rowId) };
    });
  }

  function addPastedTargets() {
    const current = currentValueRef.current;
    const parsed = parseExactTargetLines(current.pastedUrls, expectedOrigin ?? "");
    update({
      pastedTargets: [...current.pastedTargets, ...parsed.targets],
      pastedErrors: parsed.errors,
      pastedDuplicateCount: current.pastedDuplicateCount + parsed.duplicateCount,
      pastedUrls: parsed.errors.length === 0 ? "" : current.pastedUrls,
    });
  }

  async function handleTargetCsv(file: File | undefined) {
    const requestId = fileReadRequestId.current + 1;
    fileReadRequestId.current = requestId;
    update({
      importedErrors: [],
      targetCsvError: null,
      targetCsvStatus: file ? `Reading ${file.name}…` : null,
      targetCsvReading: !!file,
    });
    if (!file) return;

    try {
      const csv = await readFileText(file);
      if (fileReadRequestId.current !== requestId) return;
      const parsed = parseExactTargetCsv(csv, expectedOrigin ?? "");
      const current = currentValueRef.current;
      onChange({
        ...current,
        importedTargets: [...current.importedTargets, ...parsed.targets],
        importedErrors: parsed.errors,
        importedDuplicateCount: current.importedDuplicateCount + parsed.duplicateCount,
        targetCsvError: null,
        targetCsvStatus: parsed.errors.length === 0
          ? `Loaded ${parsed.targets.length} ${parsed.targets.length === 1 ? "target" : "targets"} from ${file.name}.`
          : null,
        targetCsvReading: false,
      });
    } catch (error) {
      if (fileReadRequestId.current !== requestId) return;
      const current = currentValueRef.current;
      onChange({
        ...current,
        importedErrors: [],
        targetCsvError: error instanceof Error ? error.message : `Unable to read ${file.name}.`,
        targetCsvStatus: null,
        targetCsvReading: false,
      });
    }
  }

  const visibleErrors = showValidation ? validation.errors : [];
  const csvErrors = (showValidation || value.importedErrors.length > 0 || value.targetCsvError)
    ? validation.errors.filter((error) => error.target === "csv")
    : [];
  const exactActive = value.mode === "exact";
  return (
    <fieldset className="content-replacement-section content-replacement-discovery" disabled={disabled}>
      <legend>Discovery scope</legend>
      <p className="content-replacement-discovery-intro">Choose how the scan finds canonical content. The mode remains part of the reviewed configuration.</p>
      <div className="content-replacement-discovery-choices">
        {DISCOVERY_OPTIONS.map((option) => (
          <label
            key={option.mode}
            className={`content-replacement-discovery-choice${value.mode === option.mode ? " is-selected" : ""}`}
          >
            <input
              type="radio"
              name="content-replacement-discovery-mode"
              value={option.mode}
              checked={value.mode === option.mode}
              onChange={() => changeMode(option.mode)}
            />
            <span className="content-replacement-discovery-choice-copy">
              <span className="content-replacement-discovery-choice-title">{option.label}</span>
              <span className="content-replacement-discovery-choice-coverage">{option.coverage}</span>
              <span>{option.requests}</span>
            </span>
          </label>
        ))}
      </div>

      {exactActive && (
        <div className="content-replacement-exact-targets">
          <div className="content-replacement-section-heading">
            <div>
              <h3>Exact targets</h3>
              <p>Enter a numeric ID or a canonical URL from the connected Enterprise origin. Answer IDs require their parent question ID.</p>
            </div>
            <button className="s-btn s-btn__outlined" type="button" onClick={addRow} disabled={value.exactRows.length >= MAX_EXACT_REPLACEMENT_TARGETS}>Add target</button>
          </div>
          <div className="content-replacement-exact-target-rows">
            {value.exactRows.map((row, index) => {
              const rowErrors = visibleErrors.filter((error) => error.target === "rows" && error.rowId === row.id);
              const rowFieldErrors = (field: ContentReplacementDiscoveryError["field"]) => rowErrors.filter((error) => error.field === field);
              const typeErrors = rowFieldErrors("kind");
              const valueErrors = rowFieldErrors("value");
              const parentErrors = rowFieldErrors("parentQuestionId");
              const typeErrorId = targetRowErrorId(row.id, "kind");
              const valueErrorId = targetRowErrorId(row.id, "value");
              const parentErrorId = targetRowErrorId(row.id, "parentQuestionId");
              return (
                <div className="content-replacement-exact-target-row" key={row.id}>
                  <label>
                    Target type {index + 1}
                    <select
                      className="s-select"
                      aria-label={`Target type ${index + 1}`}
                      aria-invalid={typeErrors.length > 0 ? "true" : undefined}
                      aria-describedby={typeErrors.length > 0 ? typeErrorId : undefined}
                      ref={(node) => setFieldRef(rowRefs.current, row.id, "kind", node)}
                      value={row.kind}
                      onChange={(event) => changeRow(row.id, "kind", event.currentTarget.value)}
                    >
                      <option value="question">Question</option>
                      <option value="answer">Answer</option>
                      <option value="article">Article</option>
                    </select>
                    <FieldErrors id={typeErrorId} errors={typeErrors} />
                  </label>
                  <label>
                    Target ID or URL {index + 1}
                    <input
                      className="s-input"
                      aria-label={`Target ID or URL ${index + 1}`}
                      aria-invalid={valueErrors.length > 0 ? "true" : undefined}
                      aria-describedby={valueErrors.length > 0 ? valueErrorId : undefined}
                      ref={(node) => setFieldRef(rowRefs.current, row.id, "value", node)}
                      value={row.value}
                      onChange={(event) => changeRow(row.id, "value", event.currentTarget.value)}
                    />
                    <FieldErrors id={valueErrorId} errors={valueErrors} />
                  </label>
                  {row.kind === "answer" && (
                    <label>
                      Parent question ID {index + 1}
                      <input
                        className="s-input"
                        aria-label={`Parent question ID ${index + 1}`}
                        inputMode="numeric"
                        aria-invalid={parentErrors.length > 0 ? "true" : undefined}
                        aria-describedby={parentErrors.length > 0 ? parentErrorId : undefined}
                        ref={(node) => setFieldRef(rowRefs.current, row.id, "parentQuestionId", node)}
                        value={row.parentQuestionId}
                        onChange={(event) => changeRow(row.id, "parentQuestionId", event.currentTarget.value)}
                      />
                      <FieldErrors id={parentErrorId} errors={parentErrors} />
                    </label>
                  )}
                  <button
                    className="s-btn s-btn__outlined s-btn__xs"
                    type="button"
                    aria-label={`Remove target ${index + 1}`}
                    disabled={value.exactRows.length === 1}
                    onClick={() => removeRow(row.id)}
                  >
                    Remove
                  </button>
                </div>
              );
            })}
          </div>

          <div className="content-replacement-exact-target-paste">
            <label htmlFor="content-replacement-target-paste">Paste target URLs</label>
            <textarea
              id="content-replacement-target-paste"
              className="s-input"
              ref={pasteRef}
              value={value.pastedUrls}
              aria-invalid={visibleErrors.some((error) => error.target === "paste") ? "true" : undefined}
              aria-describedby={visibleErrors.some((error) => error.target === "paste") ? "content-replacement-target-paste-errors" : undefined}
              placeholder="https://instance.stackenterprise.co/questions/42"
              onChange={(event) => update({ pastedUrls: event.currentTarget.value, pastedErrors: [] })}
            />
            <button className="s-btn s-btn__outlined" type="button" onClick={addPastedTargets}>Add pasted targets</button>
            <FieldErrors id="content-replacement-target-paste-errors" errors={visibleErrors.filter((error) => error.target === "paste")} />
          </div>

          <div className="content-replacement-exact-target-csv">
            <div>
              <h4>Target CSV</h4>
              <p>CSV parsing stays in this browser. Required headers are <code>type,id,parent_question_id</code>.</p>
            </div>
            <div className="write-tool-actions">
              <button className="s-btn s-btn__outlined" type="button" onClick={() => downloadTextFile("content-replacement-targets-template.csv", createExactTargetCsvTemplate(), "text/csv;charset=utf-8")}>Download target CSV template</button>
              <label className="content-replacement-target-file-control">
                <span>Import target CSV</span>
                <input
                  ref={csvRef}
                  type="file"
                  accept=".csv,text/csv"
                  aria-label="Import target CSV"
                  aria-invalid={csvErrors.length > 0 ? "true" : undefined}
                  aria-describedby={csvErrors.length > 0 ? "content-replacement-target-csv-error" : undefined}
                  onChange={(event: ChangeEvent<HTMLInputElement>) => void handleTargetCsv(event.currentTarget.files?.[0])}
                />
              </label>
            </div>
            {value.targetCsvStatus && <p role="status">{value.targetCsvStatus}</p>}
            <FieldErrors id="content-replacement-target-csv-error" errors={csvErrors} />
            {value.targetCsvError && <button className="s-btn s-btn__outlined s-btn__xs" type="button" onClick={() => update({ targetCsvError: null })}>Clear target CSV error</button>}
          </div>

          <div className="content-replacement-exact-target-summary" aria-live="polite">
            <strong>{formatTargetCount(validation.targets.length)}</strong>
            {validation.duplicateCount > 0 && <span>{formatDuplicateCount(validation.duplicateCount)}</span>}
            <FieldErrors errors={visibleErrors.filter((error) => error.target === "mode")} />
          </div>
        </div>
      )}

      {value.mode === "full" && (
        <div className="s-notice s-notice__warning content-replacement-full-audit-notice" role="note">
          <strong>Full audit can be large.</strong> It may require thousands of API requests for a large Enterprise instance.
        </div>
      )}
    </fieldset>
  );
});

function parseExactTargetRow(
  row: ExactTargetDraftRow,
  expectedOrigin: string | undefined,
): { empty: true } | { target: ReplacementItemRef } | { error: string; field: ContentReplacementDiscoveryError["field"] } {
  const value = row.value.trim();
  const parent = row.parentQuestionId.trim();
  if (value === "" && parent === "") return { empty: true };
  if (/^https?:\/\//iu.test(value)) {
    const parsed = parseExactTargetLines(value, expectedOrigin ?? "");
    if (parsed.errors[0]) {
      return { error: formatParseError(parsed.errors[0]), field: "value" };
    }
    const target = parsed.targets[0];
    if (!target) return { error: "enter a canonical target URL", field: "value" };
    if (target.kind !== row.kind) {
      return { error: `target type ${capitalize(target.kind)} does not match the selected ${capitalize(row.kind)} type`, field: "kind" };
    }
    return { target };
  }

  const id = parsePositiveSafeInteger(value);
  if (!id) return { error: "enter a positive numeric ID or canonical URL", field: "value" };
  if (row.kind === "question") return { target: { kind: "question", questionId: id } };
  if (row.kind === "article") return { target: { kind: "article", articleId: id } };
  const questionId = parsePositiveSafeInteger(parent);
  if (!questionId) return { error: "answer target needs its parent question ID", field: "parentQuestionId" };
  return { target: { kind: "answer", questionId, answerId: id } };
}

function formatParserErrors(
  errors: ExactTargetParseError[],
  target: "paste" | "csv",
): ContentReplacementDiscoveryError[] {
  return errors.map((error) => ({
    target,
    code: error.code,
    message: `${target === "csv" ? "Target CSV" : "Pasted target"} line ${error.sourceLine}: ${formatParseError(error)}.`,
  }));
}

function formatParseError(error: ExactTargetParseError): string {
  const message: Record<ExactTargetParseErrorCode, string> = {
    "invalid-url": "enter a valid canonical URL",
    "wrong-origin": "targets must use the connected Stack Enterprise origin",
    "credentials-not-allowed": "URLs cannot include sign-in information",
    "query-not-allowed": "URLs cannot include query parameters",
    "malformed-fragment": "URL answer fragments must match the answer ID",
    "unsupported-path": "URL path does not identify a supported target",
    "invalid-id": "enter a positive whole-number ID",
    "invalid-type": "type must be question, answer, or article",
    "missing-parent-question": "answer targets need a parent question ID",
    "unexpected-parent-question": "only answer targets use a parent question ID",
    "invalid-headers": "use the exact headers type,id,parent_question_id",
    "extra-columns": "contains unexpected extra columns",
    "invalid-columns": "must contain exactly three columns",
    "malformed-csv": "could not be parsed as CSV",
    "too-many-targets": "use no more than 100,000 unique targets",
  };
  return message[error.code];
}

function FieldErrors({ errors, id }: { errors: ContentReplacementDiscoveryError[]; id?: string }) {
  if (errors.length === 0) return null;
  return <span className="content-replacement-field-error" id={id}>{errors.map((error) => error.message).join(" ")}</span>;
}

function targetRowErrorId(
  rowId: string,
  field: NonNullable<ContentReplacementDiscoveryError["field"]>,
) {
  const suffix: Record<NonNullable<ContentReplacementDiscoveryError["field"]>, string> = {
    kind: "target-type",
    value: "target-id-or-url",
    parentQuestionId: "parent-question-id",
  };
  return `content-replacement-${rowId}-${suffix[field]}-error`;
}

function formatTargetCount(count: number) {
  return `${count.toLocaleString()} valid ${count === 1 ? "target" : "targets"}`;
}

function formatDuplicateCount(count: number) {
  return `${count.toLocaleString()} ${count === 1 ? "duplicate removed" : "duplicates removed"}`;
}

function parsePositiveSafeInteger(value: string): number | null {
  if (!/^[1-9]\d*$/u.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function capitalize(value: string) {
  return `${value.slice(0, 1).toUpperCase()}${value.slice(1)}`;
}

function setFieldRef(
  refs: Map<string, HTMLInputElement | HTMLSelectElement>,
  rowId: string,
  field: string,
  node: HTMLInputElement | HTMLSelectElement | null,
) {
  const key = `${rowId}:${field}`;
  if (node) refs.set(key, node);
  else refs.delete(key);
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
