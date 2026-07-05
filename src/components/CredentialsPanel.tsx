import { type FormEvent, useEffect, useState } from "react";
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

const OAUTH_SCOPES = ["write_access"];

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
    oauthClientId: credentials?.oauthClientId ?? "",
    includeNoExpiry: false,
    pat: credentials?.pat ?? "",
  });
  const [saved, setSaved] = useState(false);
  const [oauthError, setOauthError] = useState<string | null>(null);

  useEffect(() => {
    function handleOAuthMessage(event: MessageEvent) {
      if (event.origin !== window.location.origin || !isOAuthMessage(event.data)) {
        return;
      }

      if (!event.data.ok) {
        setSaved(false);
        setOauthError(event.data.error);
        return;
      }

      const trimmedApiKey = draft.apiKey.trim();
      const trimmedOAuthClientId = draft.oauthClientId.trim();

      onSave({
        ...event.data.credential,
        baseUrl: draft.baseUrl.trim(),
        apiKey: trimmedApiKey || undefined,
        oauthClientId: trimmedOAuthClientId || event.data.credential.oauthClientId,
      });
      setOauthError(null);
      setSaved(true);
    }

    window.addEventListener("message", handleOAuthMessage);

    return () => {
      window.removeEventListener("message", handleOAuthMessage);
    };
  }, [draft, onSave]);

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

    const existingOAuthCredentials = credentials?.authSource === "oauth-pkce" ? credentials : null;

    onSave({
      instanceType: "enterprise",
      baseUrl: trimmedBaseUrl,
      apiKey: draft.apiKey.trim() || undefined,
      oauthClientId: draft.oauthClientId.trim() || undefined,
      accessToken: existingOAuthCredentials?.accessToken,
      authSource: existingOAuthCredentials?.authSource,
      oauthScopes: existingOAuthCredentials?.oauthScopes,
      accessTokenExpiresAt: existingOAuthCredentials?.accessTokenExpiresAt,
    });
    setSaved(true);
  }

  async function handleOAuthConnect() {
    setSaved(false);
    setOauthError(null);

    const popup = window.open("", "stack-api-enterprise-oauth", "popup,width=720,height=800");

    try {
      const response = await fetch("/api/oauth/pkce/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          baseUrl: draft.baseUrl.trim(),
          clientId: draft.oauthClientId.trim(),
          scopes: OAUTH_SCOPES,
          includeNoExpiry: draft.includeNoExpiry,
        }),
      });
      const body: unknown = await response.json();

      if (!isOAuthStartResponse(body)) {
        popup?.close();
        setOauthError("Unable to start Enterprise OAuth. Try again.");
        return;
      }

      if (!body.ok) {
        popup?.close();
        setOauthError(body.error);
        return;
      }

      if (popup === null) {
        setOauthError("Enable pop-ups to connect with Enterprise OAuth.");
        return;
      }

      popup.location.href = body.authorizationUrl;
    } catch {
      popup?.close();
      setOauthError("Unable to start Enterprise OAuth. Try again.");
    }
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
            with Enterprise OAuth.
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
              <button className="s-btn" type="button" onClick={handleOAuthConnect}>
                Connect with Enterprise OAuth
              </button>
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
