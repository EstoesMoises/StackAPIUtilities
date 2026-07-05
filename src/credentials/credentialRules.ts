import { reportRegistry } from "../domain/reportRegistry";
import type { InstanceType, ReportId, SessionCredentials } from "../domain/types";

export interface NormalizedInstance {
  instanceType: InstanceType;
  baseUrl: string;
  teamSlug: string | null;
  apiV2Url: string;
  apiV3Url: string;
}

export interface ValidationResult {
  valid: boolean;
  messages: string[];
}

export interface EnterpriseOAuthValidationOptions {
  requiredScopes?: string[];
  now?: Date;
}

export function normalizeInstanceUrl(input: string): NormalizedInstance {
  const url = new URL(input);
  const baseUrl = `${url.protocol}//${url.host}${url.pathname}`.replace(/\/$/, "");

  if (url.host === "stackoverflowteams.com" && url.pathname.startsWith("/c/")) {
    const teamSlug = url.pathname.split("/").filter(Boolean)[1];
    if (!teamSlug) {
      throw new Error("Basic/Business team URL must include a team slug.");
    }

    return {
      instanceType: "basic-business",
      baseUrl: `https://stackoverflowteams.com/c/${teamSlug}`,
      teamSlug,
      apiV2Url: "https://api.stackoverflowteams.com/2.3",
      apiV3Url: `https://api.stackoverflowteams.com/v3/teams/${teamSlug}`,
    };
  }

  return {
    instanceType: "enterprise",
    baseUrl,
    teamSlug: null,
    apiV2Url: `${baseUrl}/api/2.3`,
    apiV3Url: `${baseUrl}/api/v3`,
  };
}

export function validateEnterpriseV3OAuthCredentials(
  credentials: SessionCredentials | null,
  options: EnterpriseOAuthValidationOptions = {},
): ValidationResult {
  const messages: string[] = [];

  if (
    !credentials ||
    credentials.instanceType !== "enterprise" ||
    credentials.authSource !== "oauth-pkce" ||
    !credentials.accessToken?.trim()
  ) {
    return {
      valid: false,
      messages: ["Enterprise OAuth connection is required for Stack API v3 calls."],
    };
  }

  if (credentials.accessTokenExpiresAt) {
    const expiresAt = new Date(credentials.accessTokenExpiresAt);
    const now = options.now ?? new Date();

    if (Number.isNaN(expiresAt.getTime()) || expiresAt.getTime() <= now.getTime()) {
      messages.push("Enterprise OAuth token has expired. Reconnect with Enterprise OAuth.");
    }
  }

  const scopes = new Set(credentials.oauthScopes ?? []);

  for (const requiredScope of options.requiredScopes ?? []) {
    if (!scopes.has(requiredScope)) {
      messages.push(`Enterprise OAuth token is missing required scope: ${requiredScope}.`);
    }
  }

  return { valid: messages.length === 0, messages };
}

export function validateCredentialsForReport(
  reportId: ReportId,
  credentials: SessionCredentials,
  now: Date = new Date(),
): ValidationResult {
  const report = reportRegistry.find((candidate) => candidate.id === reportId);
  const messages: string[] = [];

  if (!report) {
    return { valid: false, messages: [`Unknown report: ${reportId}`] };
  }

  if (!report.supportedInstances.includes(credentials.instanceType)) {
    messages.push(`${report.title} is not available for the selected instance type.`);
  }

  if (credentials.instanceType === "basic-business") {
    if (report.credentialRequirements.includes("access-token") && !credentials.pat?.trim()) {
      messages.push("Personal access token is required for Basic/Business API calls.");
    }
  }

  if (credentials.instanceType === "enterprise") {
    if (report.credentialRequirements.includes("api-key") && !credentials.apiKey) {
      messages.push("API key is required for Stack API v2.3 Enterprise calls.");
    }
    if (report.credentialRequirements.includes("access-token")) {
      messages.push(...validateEnterpriseV3OAuthCredentials(credentials, { now }).messages);
    }
  }

  return { valid: messages.length === 0, messages };
}
