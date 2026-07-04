import { type FormEvent, useState } from "react";
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
  pat: string;
}

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
    accessToken: credentials?.accessToken ?? "",
    pat: credentials?.pat ?? "",
  });
  const [saved, setSaved] = useState(false);

  function updateDraft<Field extends keyof CredentialsDraft>(
    field: Field,
    value: CredentialsDraft[Field],
  ) {
    setSaved(false);
    setDraft((current) => ({ ...current, [field]: value }));
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onSave({
      instanceType: draft.instanceType,
      baseUrl: draft.baseUrl.trim(),
      apiKey: draft.apiKey.trim() || undefined,
      accessToken: draft.accessToken.trim() || undefined,
      pat: draft.pat.trim() || undefined,
    });
    setSaved(true);
  }

  return (
    <section className="workspace-panel" aria-labelledby="credentials-heading">
      <div className="workspace-header">
        <p className="fs-caption fc-light mb4">Browser session</p>
        <h2 className="fs-headline2 m0" id="credentials-heading">
          Session Credentials
        </h2>
      </div>
      <p className="workspace-copy credential-session-copy">
        Credentials are kept in memory for this browser session only.
      </p>
      <div className="credential-notes" role="note">
        <p className="scope-label">Scope notes for selected report</p>
        <h3 className="fs-body2 mb8">{report.title} credential notes</h3>
        <ul className="m0">
          <li>Basic/Business: provide your team URL and either an access token or PAT.</li>
          <li>
            Enterprise: provide your site URL
            {report.credentialRequirements.includes("api-key") ? ", API key," : ""} and access
            token.
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
          <span className="d-block fs-caption tt-uppercase fc-light mb4">Personal access token</span>
          <input
            className="s-input"
            type="password"
            value={draft.pat}
            onChange={(event) => updateDraft("pat", event.currentTarget.value)}
          />
        </label>
        <button className="s-btn s-btn__primary" type="submit">
          Save session credentials
        </button>
      </form>
      {saved && (
        <div className="s-notice s-notice__success mt16" role="status">
          Credentials saved for this browser session.
        </div>
      )}
    </section>
  );
}
