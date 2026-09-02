import type { SessionCredentials } from "../domain/types";

export interface ValidationResult {
  valid: boolean;
  messages: string[];
}

export interface EnterpriseOAuthValidationOptions {
  requiredScopes?: string[];
  now?: Date;
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
