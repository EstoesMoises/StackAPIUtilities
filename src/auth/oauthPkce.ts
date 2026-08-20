import { createHash, randomBytes } from "node:crypto";
import { normalizeOAuthBaseUrl } from "./enterpriseOAuthTarget";

export {
  isSupportedEnterpriseOAuthTarget,
  normalizeOAuthBaseUrl,
} from "./enterpriseOAuthTarget";

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
  const url = new URL("/oauth", normalizeOAuthBaseUrl(input.baseUrl));
  url.searchParams.set("client_id", input.clientId);
  url.searchParams.set("redirect_uri", input.redirectUri);
  if (input.scopes.length > 0) {
    url.searchParams.set("scope", input.scopes.join(","));
  }
  url.searchParams.set("state", input.state);
  url.searchParams.set("code_challenge", input.codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  return url;
}

export function buildEnterpriseTokenEndpointUrl(baseUrl: string): URL {
  return new URL("/oauth/access_token/json", normalizeOAuthBaseUrl(baseUrl));
}

function toBase64Url(bytes: Buffer): string {
  return bytes.toString("base64url");
}
