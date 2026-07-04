import { createHash, randomBytes } from "node:crypto";

export const OAUTH_SCOPE_WRITE_ACCESS = "write_access";
export const OAUTH_SCOPE_NO_EXPIRY = "no_expiry";

const PKCE_VERIFIER_BYTES = 64;
const OAUTH_STATE_BYTES = 32;

export interface EnterpriseAuthorizationUrlInput {
  baseUrl: string;
  clientId: string;
  redirectUri: string;
  scopes: string[];
  state: string;
  codeChallenge: string;
}

export function createCodeVerifier(): string {
  return toBase64Url(randomBytes(PKCE_VERIFIER_BYTES));
}

export function createOAuthState(): string {
  return toBase64Url(randomBytes(OAUTH_STATE_BYTES));
}

export function createCodeChallenge(codeVerifier: string): string {
  return createHash("sha256").update(codeVerifier).digest("base64url");
}

export function normalizeOAuthScopes(scopes: readonly string[], includeNoExpiry: boolean): string[] {
  const normalized = scopes.map((scope) => scope.trim()).filter((scope) => scope.length > 0);
  const uniqueScopes = [...new Set(normalized)];

  if (includeNoExpiry && !uniqueScopes.includes(OAUTH_SCOPE_NO_EXPIRY)) {
    uniqueScopes.push(OAUTH_SCOPE_NO_EXPIRY);
  }

  if (!includeNoExpiry) {
    return uniqueScopes.filter((scope) => scope !== OAUTH_SCOPE_NO_EXPIRY);
  }

  return uniqueScopes;
}

export function buildEnterpriseAuthorizationUrl(input: EnterpriseAuthorizationUrlInput): URL {
  const url = new URL("/oauth", normalizeBaseUrl(input.baseUrl));
  url.searchParams.set("client_id", input.clientId);
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("scope", input.scopes.join(","));
  url.searchParams.set("state", input.state);
  url.searchParams.set("code_challenge", input.codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  return url;
}

export function buildEnterpriseTokenEndpointUrl(baseUrl: string): URL {
  return new URL("/oauth/access_token/json", normalizeBaseUrl(baseUrl));
}

export function isSupportedEnterpriseOAuthTarget(baseUrl: string): boolean {
  try {
    const url = new URL(baseUrl);
    const hostname = url.hostname.toLowerCase();

    return (
      url.protocol === "https:" &&
      (hostname === "stackenterprise.co" || hostname.endsWith(".stackenterprise.co"))
    );
  } catch {
    return false;
  }
}

function normalizeBaseUrl(baseUrl: string): string {
  const url = new URL(baseUrl);
  return `${url.protocol}//${url.host}`;
}

function toBase64Url(bytes: Buffer): string {
  return bytes.toString("base64url");
}
