import type { ApiVolumeSettingsValue, PeriodScope, ReportRunScope } from "./types";

export const DEFAULT_REPORT_RUN_SCOPE: ReportRunScope = {
  current: {},
};

interface ValidationResult {
  valid: boolean;
  messages: string[];
}

export function validateReportRunScope(scope: ReportRunScope): ValidationResult {
  const messages: string[] = [];

  validatePeriod("Current period", scope.current, messages);
  if (scope.comparison) validatePeriod("Comparison period", scope.comparison, messages);

  return { valid: messages.length === 0, messages };
}

export function validateApiVolumeSettings(
  settings: Pick<ApiVolumeSettingsValue, "pageSize" | "maxPagesPerDataset">,
): ValidationResult {
  const messages: string[] = [];
  if (!Number.isInteger(settings.pageSize) || settings.pageSize < 1 || settings.pageSize > 100) {
    messages.push("Page size must be between 1 and 100.");
  }
  if (!Number.isInteger(settings.maxPagesPerDataset) || settings.maxPagesPerDataset < 1) {
    messages.push("Max pages per dataset must be at least 1.");
  }
  return { valid: messages.length === 0, messages };
}

export function dateToUnixSeconds(date: string): number {
  return Math.floor(new Date(`${date}T00:00:00.000Z`).getTime() / 1000);
}

export function formatPeriodLabel(scope: PeriodScope): string {
  if (scope.startDate && scope.endDate) return `${scope.startDate} to ${scope.endDate}`;
  if (scope.startDate) return `From ${scope.startDate}`;
  if (scope.endDate) return `Through ${scope.endDate}`;
  return "All available history";
}

function validatePeriod(label: string, scope: PeriodScope, messages: string[]) {
  if (scope.startDate && !isValidDate(scope.startDate)) messages.push(`${label} start date must use YYYY-MM-DD.`);
  if (scope.endDate && !isValidDate(scope.endDate)) messages.push(`${label} end date must use YYYY-MM-DD.`);
  if (
    scope.startDate &&
    scope.endDate &&
    isValidDate(scope.startDate) &&
    isValidDate(scope.endDate) &&
    scope.endDate < scope.startDate
  ) {
    messages.push(`${label} end date must be on or after its start date.`);
  }
}

function isValidDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(new Date(`${value}T00:00:00.000Z`).getTime());
}
