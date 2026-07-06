import { type FormEvent, useEffect, useRef, useState } from "react";
import { reportRegistry } from "../domain/reportRegistry";
import type { InstanceType, ReportId, SessionCredentials } from "../domain/types";

interface CredentialsPanelProps {
  selectedReportId: ReportId;
  credentials: SessionCredentials | null;
  onSave: (credentials: SessionCredentials) => void;
}

interface CredentialsDraft {
  instanceType: InstanceType;
  baseUrl: string;
  apiKey: string;
  accessToken: string;
  oauthClientId: string;
  includeNoExpiry: boolean;
  pat: string;
}

type OAuthMessage =
  | { type: "stack-api-oauth-pkce-result"; ok: true; credential: SessionCredentials }
  | { type: "stack-api-oauth-pkce-result"; ok: false; error: string };

type OAuthStartResponse =
  | { ok: true; authorizationUrl: string }
  | { ok: false; error: string };

type ValidOAuthCredential = SessionCredentials & {
  instanceType: "enterprise";
  baseUrl: string;
  accessToken: string;
  authSource: "oauth-pkce";
};

interface PendingOAuthFlow {
  id: number;
  baseUrl: string;
  oauthClientId: string;
  popup: Window;
}

const OAUTH_SCOPES = ["write_access"];
const OAUTH_CREDENTIAL_ERROR = "Unable to save Enterprise OAuth credentials. Try again.";
const OAUTH_START_ERROR = "Unable to start Enterprise OAuth. Try again.";

const credentialLabels: Record<string, string> = {
  "api-key": "API key",
  "access-token": "Access token",
  pat: "Personal access token",
  "community-access": "Community access",
  "enterprise-admin": "Enterprise admin access",
};

export function CredentialsPanel({ selectedReportId, credentials, onSave }: CredentialsPanelProps) {
  const report = reportRegistry.find((candidate) => candidate.id === selectedReportId)!;
  const [draft, setDraft] = useState<CredentialsDraft>({
    instanceType: credentials?.instanceType ?? "basic-business",
    baseUrl: credentials?.baseUrl ?? "",
    apiKey: credentials?.apiKey ?? "",
    accessToken:
      credentials?.authSource === "manual-enterprise-token" ? credentials.accessToken ?? "" : "",
    oauthClientId: credentials?.oauthClientId ?? "",
    includeNoExpiry: credentials?.oauthScopes?.includes("no_expiry") ?? false,
    pat: credentials?.pat ?? "",
  });
  const [saved, setSaved] = useState(false);
  const [oauthError, setOauthError] = useState<string | null>(null);
  const [oauthPending, setOauthPending] = useState(false);
  const pendingOAuthFlowRef = useRef<PendingOAuthFlow | null>(null);
  const oauthPendingRef = useRef(false);
  const nextOAuthFlowIdRef = useRef(0);

  useEffect(() => {
    function handleOAuthMessage(event: MessageEvent) {
      if (event.origin !== window.location.origin || !isOAuthMessage(event.data)) {
        return;
      }

      const pendingFlow = pendingOAuthFlowRef.current;
      if (pendingFlow === null) {
        return;
      }

      if (event.source !== pendingFlow.popup) {
        return;
      }

      if (!event.data.ok) {
        clearPendingOAuthFlow(pendingFlow.id);
        setSaved(false);
        setOauthError(event.data.error);
        return;
      }

      if (!isOAuthCredentialForPendingFlow(event.data.credential, pendingFlow)) {
        clearPendingOAuthFlow(pendingFlow.id);
        setSaved(false);
        setOauthError(OAUTH_CREDENTIAL_ERROR);
        return;
      }

      const trimmedApiKey = draft.apiKey.trim();

      onSave({
        instanceType: "enterprise",
        baseUrl: event.data.credential.baseUrl.trim(),
        apiKey: trimmedApiKey || undefined,
        accessToken: event.data.credential.accessToken,
        authSource: event.data.credential.authSource,
        oauthClientId: pendingFlow.oauthClientId,
        oauthScopes: event.data.credential.oauthScopes,
        accessTokenExpiresAt: event.data.credential.accessTokenExpiresAt,
      });
      clearPendingOAuthFlow(pendingFlow.id);
      setOauthError(null);
      setSaved(true);
    }

    window.addEventListener("message", handleOAuthMessage);

    return () => {
      window.removeEventListener("message", handleOAuthMessage);
    };
  }, [draft, onSave]);

  function clearPendingOAuthFlow(flowId?: number) {
    if (flowId !== undefined && pendingOAuthFlowRef.current?.id !== flowId) {
      return;
    }

    pendingOAuthFlowRef.current = null;
    oauthPendingRef.current = false;
    setOauthPending(false);
  }

  function updateDraft<Field extends keyof CredentialsDraft>(
    field: Field,
    value: CredentialsDraft[Field],
  ) {
    setSaved(false);
    setOauthError(null);
    setDraft((current) => ({ ...current, [field]: value }));
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedBaseUrl = draft.baseUrl.trim();
    const trimmedPat = draft.pat.trim();

    if (draft.instanceType === "basic-business") {
      onSave({
        instanceType: "basic-business",
        baseUrl: trimmedBaseUrl,
        pat: trimmedPat || undefined,
        authSource: trimmedPat ? "manual-pat" : undefined,
      });
      setSaved(true);
      return;
    }

    const trimmedOAuthClientId = draft.oauthClientId.trim();
    const trimmedAccessToken = draft.accessToken.trim();
    const existingOAuthCredentials =
      credentials?.authSource === "oauth-pkce" &&
      canonicalizeEnterpriseBaseUrl(credentials.baseUrl) ===
        canonicalizeEnterpriseBaseUrl(trimmedBaseUrl) &&
      (credentials.oauthClientId ?? "") === trimmedOAuthClientId
        ? credentials
        : null;
    const savedCredentials: SessionCredentials = {
      instanceType: "enterprise",
      baseUrl: trimmedBaseUrl,
      apiKey: draft.apiKey.trim() || undefined,
      oauthClientId: trimmedOAuthClientId || undefined,
    };

    if (trimmedAccessToken) {
      savedCredentials.accessToken = trimmedAccessToken;
      savedCredentials.authSource = "manual-enterprise-token";
    } else if (existingOAuthCredentials !== null) {
      savedCredentials.accessToken = existingOAuthCredentials.accessToken;
      savedCredentials.authSource = existingOAuthCredentials.authSource;
      savedCredentials.oauthScopes = existingOAuthCredentials.oauthScopes;
      savedCredentials.accessTokenExpiresAt = existingOAuthCredentials.accessTokenExpiresAt;
    }

    onSave(savedCredentials);
    setSaved(true);
  }

  async function handleOAuthConnect() {
    if (oauthPendingRef.current) {
      return;
    }

    setSaved(false);
    setOauthError(null);

    const popup = window.open("", "stack-api-enterprise-oauth", "popup,width=720,height=800");
    if (popup === null) {
      setOauthError("Enable pop-ups to connect with Enterprise OAuth.");
      return;
    }

    const pendingFlow: PendingOAuthFlow = {
      id: nextOAuthFlowIdRef.current + 1,
      baseUrl: canonicalizeEnterpriseBaseUrl(draft.baseUrl.trim()),
      oauthClientId: draft.oauthClientId.trim(),
      popup,
    };
    const startBaseUrl = draft.baseUrl.trim();
    nextOAuthFlowIdRef.current = pendingFlow.id;
    pendingOAuthFlowRef.current = pendingFlow;
    oauthPendingRef.current = true;
    setOauthPending(true);

    try {
      const response = await fetch("/api/oauth/pkce/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          baseUrl: startBaseUrl,
          clientId: pendingFlow.oauthClientId,
          scopes: OAUTH_SCOPES,
          includeNoExpiry: draft.includeNoExpiry,
        }),
      });
      const body: unknown = await response.json();

      if (pendingOAuthFlowRef.current?.id !== pendingFlow.id) {
        return;
      }

      if (!isOAuthStartResponse(body)) {
        popup.close();
        clearPendingOAuthFlow(pendingFlow.id);
        setOauthError(OAUTH_START_ERROR);
        return;
      }

      if (!body.ok) {
        popup.close();
        clearPendingOAuthFlow(pendingFlow.id);
        setOauthError(body.error);
        return;
      }

      popup.location.href = body.authorizationUrl;
    } catch {
      if (pendingOAuthFlowRef.current?.id !== pendingFlow.id) {
        return;
      }

      popup.close();
      clearPendingOAuthFlow(pendingFlow.id);
      setOauthError(OAUTH_START_ERROR);
    }
  }

  function handleOAuthCancel() {
    pendingOAuthFlowRef.current?.popup.close();
    clearPendingOAuthFlow();
    setOauthError(null);
  }

  const isEnterprise = draft.instanceType === "enterprise";

  return (
    <section className="workspace-panel" aria-labelledby="credentials-heading">
      <div className="workspace-header">
        <div>
          <p className="workspace-kicker">Browser session</p>
          <h2 className="workspace-heading" id="credentials-heading">
            Session Credentials
          </h2>
        </div>
      </div>
      <p className="workspace-copy credential-session-copy">
        Credentials are kept in memory for this browser session only.
      </p>
      <div className="credential-notes" role="note">
        <p className="scope-label">Scope notes for selected report</p>
        <h3 className="fs-body2 mb8">{report.title} credential notes</h3>
        <ul className="m0">
          <li>Basic/Business: provide your team URL and Personal access token.</li>
          <li>
            Enterprise: provide your site URL
            {report.credentialRequirements.includes("api-key") ? ", API key," : ""} and connect
            with Enterprise OAuth or paste an access token.
          </li>
          <li>
            Required scope notes:{" "}
            {report.credentialRequirements
              .map((requirement) => credentialLabels[requirement] ?? requirement)
              .join(", ")}
            .
          </li>
          <li>Credential acquisition guidance placeholder: add internal steps here.</li>
        </ul>
      </div>
      <form className="credentials-form" onSubmit={handleSubmit}>
        <label className="d-block">
          <span className="d-block fs-caption tt-uppercase fc-light mb4">Instance type</span>
          <select
            className="s-select"
            value={draft.instanceType}
            onChange={(event) =>
              updateDraft("instanceType", event.currentTarget.value as InstanceType)
            }
          >
            <option value="basic-business">Basic / Business</option>
            <option value="enterprise">Enterprise</option>
          </select>
        </label>
        <label className="d-block">
          <span className="d-block fs-caption tt-uppercase fc-light mb4">Instance URL</span>
          <input
            className="s-input"
            value={draft.baseUrl}
            onChange={(event) => updateDraft("baseUrl", event.currentTarget.value)}
            placeholder="https://stackoverflowteams.com/c/team-name"
            required
          />
        </label>
        {isEnterprise ? (
          <>
            <label className="d-block">
              <span className="d-block fs-caption tt-uppercase fc-light mb4">API key</span>
              <input
                className="s-input"
                value={draft.apiKey}
                onChange={(event) => updateDraft("apiKey", event.currentTarget.value)}
              />
            </label>
            <label className="d-block">
              <span className="d-block fs-caption tt-uppercase fc-light mb4">Access token</span>
              <input
                className="s-input"
                type="password"
                value={draft.accessToken}
                onChange={(event) => updateDraft("accessToken", event.currentTarget.value)}
              />
            </label>
            <label className="d-block">
              <span className="d-block fs-caption tt-uppercase fc-light mb4">OAuth Client ID</span>
              <input
                className="s-input"
                value={draft.oauthClientId}
                onChange={(event) => updateDraft("oauthClientId", event.currentTarget.value)}
              />
            </label>
            <div className="oauth-connect-panel">
              <label className="d-flex ai-center g8">
                <input
                  type="checkbox"
                  checked={draft.includeNoExpiry}
                  onChange={(event) => updateDraft("includeNoExpiry", event.currentTarget.checked)}
                />
                <span>Request non-expiring token</span>
              </label>
              <button
                className="s-btn"
                type="button"
                onClick={handleOAuthConnect}
                disabled={oauthPending}
              >
                Connect with Enterprise OAuth
              </button>
              {oauthPending && (
                <button className="s-btn" type="button" onClick={handleOAuthCancel}>
                  Cancel Enterprise OAuth
                </button>
              )}
              <p className="oauth-status">
                Enterprise OAuth credentials are saved after the authorization callback completes.
              </p>
            </div>
          </>
        ) : (
          <label className="d-block">
            <span className="d-block fs-caption tt-uppercase fc-light mb4">
              Personal access token
            </span>
            <input
              className="s-input"
              type="password"
              value={draft.pat}
              onChange={(event) => updateDraft("pat", event.currentTarget.value)}
            />
          </label>
        )}
        <button className="s-btn s-btn__primary" type="submit">
          Save session credentials
        </button>
      </form>
      {oauthError && (
        <div className="s-notice s-notice__danger mt16" role="alert">
          {oauthError}
        </div>
      )}
      {saved && (
        <div className="s-notice s-notice__success mt16" role="status">
          Credentials saved for this browser session.
        </div>
      )}
    </section>
  );
}

function isOAuthMessage(value: unknown): value is OAuthMessage {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const message = value as {
    type?: unknown;
    ok?: unknown;
    credential?: unknown;
    error?: unknown;
  };

  if (message.type !== "stack-api-oauth-pkce-result" || typeof message.ok !== "boolean") {
    return false;
  }

  if (message.ok) {
    return typeof message.credential === "object" && message.credential !== null;
  }

  return typeof message.error === "string";
}

function isOAuthStartResponse(value: unknown): value is OAuthStartResponse {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const response = value as {
    ok?: unknown;
    authorizationUrl?: unknown;
    error?: unknown;
  };

  if (response.ok === true) {
    return typeof response.authorizationUrl === "string";
  }

  if (response.ok === false) {
    return typeof response.error === "string";
  }

  return false;
}

function isOAuthCredentialForPendingFlow(
  credential: SessionCredentials,
  pendingFlow: PendingOAuthFlow,
): credential is ValidOAuthCredential {
  const returnedOAuthClientId = credential.oauthClientId;

  return (
    credential.instanceType === "enterprise" &&
    credential.authSource === "oauth-pkce" &&
    isNonBlankString(credential.baseUrl) &&
    canonicalizeEnterpriseBaseUrl(credential.baseUrl) === pendingFlow.baseUrl &&
    isNonBlankString(credential.accessToken) &&
    (returnedOAuthClientId === undefined || returnedOAuthClientId === pendingFlow.oauthClientId) &&
    (credential.oauthScopes === undefined || isStringArray(credential.oauthScopes)) &&
    (credential.accessTokenExpiresAt === undefined ||
      typeof credential.accessTokenExpiresAt === "string")
  );
}

function isNonBlankString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function canonicalizeEnterpriseBaseUrl(value: string): string {
  const trimmedValue = value.trim();

  try {
    return new URL(trimmedValue).origin;
  } catch {
    return trimmedValue;
  }
}
