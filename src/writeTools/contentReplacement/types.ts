export type ReplacementContentKind = "question" | "answer" | "article";

export type ReplacementItemRef =
  | { kind: "question"; questionId: number }
  | { kind: "answer"; questionId: number; answerId: number }
  | { kind: "article"; articleId: number };

export interface ReplacementRule {
  id: string;
  find: string;
  replace: string;
  sourceRow?: number;
}

export interface ReplacementOptions {
  caseSensitive: boolean;
  wholeTerm: boolean;
  replaceInCode: boolean;
}

export interface ReplacementConfiguration {
  target: { kind: "enterprise-main" };
  contentTypes: { questions: boolean; answers: boolean; articles: boolean };
  rules: ReplacementRule[];
  options: ReplacementOptions;
}

export type ReplacementRuleErrorCode =
  | "blank-source"
  | "blank-replacement"
  | "no-op"
  | "duplicate-source"
  | "replacement-is-source"
  | "overlapping-sources";
