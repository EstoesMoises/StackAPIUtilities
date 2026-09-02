import type { SessionCredentials } from "../domain/types";

export interface ValidationResult {
  valid: boolean;
  messages: string[];
}

export interface EnterpriseOAuthValidationOptions {
  requiredScopes?: string[];
  now?: Date;
}

export type EnterpriseWriteCredentialFailureCode =
  | "invalid_instance_url"
  | "enterprise_credentials_required"
  | "unsupported_enterprise_instance"
  | "invalid_enterprise_credentials"
  | "origin_mismatch";

export type EnterpriseWriteCredentialReadiness =
  | { valid: true; message: ""; origin: string; credentials: SessionCredentials; refreshRequired?: false }
  | { valid: false; message: string; code: EnterpriseWriteCredentialFailureCode; refreshRequired?: boolean };

export interface EnterpriseWriteCredentialReadinessOptions {
  now?: Date;
  expectedOrigin?: string;
}

export function validateEnterpriseV3OAuthCredentials(
  credentials: SessionCredentials | null,
  options: EnterpriseOAuthValidationOptions = {},
): ValidationResult {
  const messages: string[] = [];
  if (!credentials || credentials.instanceType !== "enterprise" || !credentials.accessToken?.trim()) {
    return { valid: false, messages: ["Enterprise access token is required for Stack API v3 calls."] };
  }
  if (credentials.authSource === "manual-enterprise-token") return { valid: true, messages };
  if (credentials.authSource !== "oauth-pkce") {
    return { valid: false, messages: ["Enterprise access token is required for Stack API v3 calls."] };
  }

  const scopes = new Set(Array.isArray(credentials.oauthScopes) ? credentials.oauthScopes : []);
  if (credentials.accessTokenExpiresAt !== undefined) {
    const expiresAt = new Date(credentials.accessTokenExpiresAt);
    const now = options.now ?? new Date();
    if (Number.isNaN(expiresAt.getTime()) || expiresAt.getTime() <= now.getTime()) {
      messages.push("Enterprise OAuth token has expired. Reconnect with Enterprise OAuth.");
    }
  } else if (!scopes.has("no_expiry")) {
    messages.push("Enterprise OAuth token has expired. Reconnect with Enterprise OAuth.");
  }
  for (const requiredScope of options.requiredScopes ?? []) {
    if (!scopes.has(requiredScope)) {
      messages.push(`Enterprise OAuth token is missing required scope: ${requiredScope}.`);
    }
  }
  return { valid: messages.length === 0, messages };
}

/** The single browser/server-safe admission predicate for Enterprise write operations. */
export function getEnterpriseWriteCredentialReadiness(
  credentials: SessionCredentials | null,
  options: EnterpriseWriteCredentialReadinessOptions = {},
): EnterpriseWriteCredentialReadiness {
  if (!credentials || credentials.instanceType !== "enterprise") {
    return failure("enterprise_credentials_required", "Enterprise write operations require Enterprise session credentials.");
  }

  const target = parseSupportedWriteOrigin(credentials.baseUrl);
  if (!target) {
    let parsed: URL;
    try {
      parsed = new URL(credentials.baseUrl);
    } catch {
      return failure("invalid_instance_url", "Reconnect with a valid Stack Enterprise instance URL.");
    }
    if (parsed.hostname.toLowerCase() === "stackoverflowteams.com") {
      return failure("enterprise_credentials_required", "Enterprise write operations require Enterprise session credentials.");
    }
    return failure("unsupported_enterprise_instance", "Reconnect with an HTTPS Stack Enterprise origin without a path, query, or sign-in information.");
  }

  const validation = validateEnterpriseV3OAuthCredentials(credentials, {
    requiredScopes: ["write_access"],
    now: options.now,
  });
  if (!validation.valid) {
    return failure("invalid_enterprise_credentials", validation.messages.join(" ") || "Reconnect valid Stack Enterprise credentials.");
  }

  if (options.expectedOrigin !== undefined) {
    const expected = parseSupportedWriteOrigin(options.expectedOrigin);
    if (!expected || expected !== target) {
      return failure("origin_mismatch", "The connected Stack Enterprise origin does not match this job.");
    }
  }

  return {
    valid: true,
    message: "",
    origin: target,
    credentials: {
      ...credentials,
      baseUrl: target,
      accessToken: credentials.accessToken!.trim(),
    },
  };
}

function parseSupportedWriteOrigin(value: string): string | null {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return null;
  }
  const hostname = url.hostname.toLowerCase();
  if (
    url.protocol !== "https:" ||
    (hostname !== "stackenterprise.co" && !hostname.endsWith(".stackenterprise.co")) ||
    url.pathname !== "/" ||
    url.search !== "" ||
    url.hash !== "" ||
    url.username !== "" ||
    url.password !== "" ||
    url.port !== ""
  ) return null;
  return url.origin;
}

function failure(code: EnterpriseWriteCredentialFailureCode, message: string): EnterpriseWriteCredentialReadiness {
  return { valid: false, code, message };
}
