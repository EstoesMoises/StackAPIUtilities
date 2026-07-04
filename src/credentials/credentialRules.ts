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

export function validateCredentialsForReport(reportId: ReportId, credentials: SessionCredentials): ValidationResult {
  const report = reportRegistry.find((candidate) => candidate.id === reportId);
  const messages: string[] = [];

  if (!report) {
    return { valid: false, messages: [`Unknown report: ${reportId}`] };
  }

  if (!report.supportedInstances.includes(credentials.instanceType)) {
    messages.push(`${report.title} is not available for the selected instance type.`);
  }

  if (credentials.instanceType === "basic-business") {
    if (!credentials.accessToken && !credentials.pat) {
      messages.push("Access token or PAT is required for Basic/Business API calls.");
    }
  }

  if (credentials.instanceType === "enterprise") {
    if (report.credentialRequirements.includes("api-key") && !credentials.apiKey) {
      messages.push("API key is required for Stack API v2.3 Enterprise calls.");
    }
    if (report.credentialRequirements.includes("access-token") && !credentials.accessToken) {
      messages.push("Access token is required for Stack API v3 calls.");
    }
  }

  return { valid: messages.length === 0, messages };
}
