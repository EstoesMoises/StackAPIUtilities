import Papa from "papaparse";

import type {
  ReplacementConfiguration,
  ReplacementOptions,
  ReplacementRule,
  ReplacementRuleErrorCode,
} from "./types";

export const MAX_REPLACEMENT_RULES = 500;
export const MAX_FIND_LENGTH = 200;
export const MAX_REPLACEMENT_LENGTH = 500;

export interface ReplacementRuleError {
  code: ReplacementRuleErrorCode;
  ruleId: string;
  sourceRow?: number;
}

export interface ReplacementRuleValidationResult {
  rules: ReplacementRule[];
  errors: ReplacementRuleError[];
  notices: string[];
}

export interface ReplacementCsvParseResult {
  rows: ReplacementRule[];
  fileErrors: string[];
}

export function createDefaultReplacementConfiguration(): ReplacementConfiguration {
  return {
    target: { kind: "enterprise-main" },
    contentTypes: { questions: true, answers: true, articles: true },
    rules: [],
    options: {
      caseSensitive: true,
      wholeTerm: true,
      replaceInCode: false,
    },
  };
}

export function parseReplacementCsv(csvText: string): ReplacementCsvParseResult {
  const parsed = Papa.parse<string[]>(csvText, {
    delimiter: ",",
    header: false,
    dynamicTyping: false,
    skipEmptyLines: false,
  });
  const fileErrors = parsed.errors.map((error) => error.message);
  const header = parsed.data[0] ?? [];

  if (!hasCanonicalHeaders(header)) {
    fileErrors.unshift('CSV must have exactly these headers: find,replace.');
    return { rows: [], fileErrors };
  }

  const rows = parsed.data.slice(1).flatMap((record, index) => {
    const find = record[0] ?? "";
    const replace = record[1] ?? "";

    if (record.every((value) => value.trim() === "")) {
      return [];
    }

    return [{ id: `csv-${index + 2}`, sourceRow: index + 2, find, replace }];
  });

  return { rows, fileErrors };
}

export function validateReplacementRules(
  inputRules: ReplacementRule[],
  options: ReplacementOptions,
): ReplacementRuleValidationResult {
  const errors: ReplacementRuleError[] = [];
  const notices: string[] = [];
  const validRules: ReplacementRule[] = [];

  for (const rule of inputRules) {
    const errorCode = basicRuleError(rule, options);
    if (errorCode) {
      errors.push(toError(rule, errorCode));
      continue;
    }
    validRules.push(rule);
  }

  const rules: ReplacementRule[] = [];
  const seenExactRules = new Set<string>();
  for (const rule of validRules) {
    const key = `${normalize(rule.find, options)}\u0000${normalize(rule.replace, options)}`;
    if (seenExactRules.has(key)) {
      notices.push(`Removed duplicate rule "${rule.find}" → "${rule.replace}".`);
      continue;
    }
    seenExactRules.add(key);
    rules.push(rule);
  }

  const sourceOwners = new Map<string, ReplacementRule>();
  for (const rule of rules) {
    const source = normalize(rule.find, options);
    const owner = sourceOwners.get(source);
    if (owner && normalize(owner.replace, options) !== normalize(rule.replace, options)) {
      errors.push(toError(rule, "duplicate-source"));
      continue;
    }
    sourceOwners.set(source, rule);
  }

  for (const rule of rules) {
    const replacement = normalize(rule.replace, options);
    if ([...sourceOwners.keys()].some((source) => source !== normalize(rule.find, options) && source === replacement)) {
      errors.push(toError(rule, "replacement-is-source"));
    }
  }

  for (let leftIndex = 0; leftIndex < rules.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < rules.length; rightIndex += 1) {
      const left = normalize(rules[leftIndex].find, options);
      const right = normalize(rules[rightIndex].find, options);
      if (left !== right && (left.includes(right) || right.includes(left))) {
        errors.push(toError(rules[rightIndex], "overlapping-sources"));
      }
    }
  }

  return { rules, errors, notices };
}

export function createReplacementCsvTemplate(): string {
  return "find,replace\n";
}

function hasCanonicalHeaders(header: string[]): boolean {
  return (
    header.length === 2 &&
    normalizeHeader(header[0], true) === "find" &&
    normalizeHeader(header[1], false) === "replace"
  );
}

function normalizeHeader(value: string | undefined, isFirstHeader: boolean): string {
  const withoutBom = isFirstHeader ? (value ?? "").replace(/^\uFEFF/, "") : (value ?? "");
  return withoutBom.trim();
}

function basicRuleError(rule: ReplacementRule, options: ReplacementOptions): ReplacementRuleErrorCode | null {
  if (rule.find.trim() === "") return "blank-source";
  if (rule.replace.trim() === "") return "blank-replacement";
  if (normalize(rule.find, options) === normalize(rule.replace, options)) return "no-op";
  return null;
}

function normalize(value: string, options: ReplacementOptions): string {
  return options.caseSensitive ? value : value.toLocaleLowerCase("en-US");
}

function toError(rule: ReplacementRule, code: ReplacementRuleErrorCode): ReplacementRuleError {
  return rule.sourceRow === undefined ? { code, ruleId: rule.id } : { code, ruleId: rule.id, sourceRow: rule.sourceRow };
}
