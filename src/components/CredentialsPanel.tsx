import { type FormEvent, useEffect, useRef, useState } from "react";
import {
  isOAuthCustomerProfileDraftDirty,
  toOAuthCustomerProfileDraft,
  type OAuthCustomerProfile,
  type OAuthCustomerProfileDraft,
  type OAuthCustomerProfileErrors,
} from "../domain/oauthCustomerProfiles";
import { reportRegistry } from "../domain/reportRegistry";
import { utilityRegistry } from "../domain/utilityRegistry";
import type { InstanceType, ReportId, SessionCredentials, UtilityId } from "../domain/types";
import { useOAuthCustomerProfiles } from "../hooks/useOAuthCustomerProfiles";
import { OAuthCustomerProfileManager } from "./OAuthCustomerProfileManager";
import { writeTools, type WriteToolId } from "./WriteToolsCatalog";

export type CredentialWorkflow =
  | { kind: "report"; reportId: ReportId }
  | { kind: "utility"; utilityId: UtilityId }
  | { kind: "write-tool"; writeToolId: WriteToolId };

interface CredentialsPanelProps {
  workflow: CredentialWorkflow;
  credentials: SessionCredentials | null;
  onSave: (credentials: SessionCredentials) => void;
}

interface CredentialsDraft {
  instanceType: InstanceType;
  customerName: string;
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

type OAuthPublicConfigResponse =
  | { ok: true; redirectUri: string }
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

const OAUTH_CREDENTIAL_ERROR = "Unable to save Enterprise OAuth credentials. Try again.";
const OAUTH_START_ERROR = "Unable to start Enterprise OAuth. Try again.";
const OAUTH_CONFIG_ERROR =
  "OAuth redirect URL could not be loaded. Check the server OAuth configuration.";
const OAUTH_COPY_ERROR = "Redirect URL was not copied. Copy it manually from the field.";
const PROFILE_BASE_URL_ERROR_ID = "oauth-profile-base-url-error";
const PROFILE_CLIENT_ID_ERROR_ID = "oauth-profile-client-id-error";

const credentialLabels: Record<string, string> = {
  "api-key": "API key",
  "access-token": "Access token",
  pat: "Personal access token",
  "community-access": "Community access",
  "enterprise-admin": "Enterprise admin access",
};

export function CredentialsPanel({ workflow, credentials, onSave }: CredentialsPanelProps) {
  const writeTool = workflow.kind === "write-tool"
    ? writeTools.find((candidate) => candidate.id === workflow.writeToolId)!
    : null;
  const metadata = workflow.kind === "utility"
    ? utilityRegistry.find((candidate) => candidate.id === workflow.utilityId)!
    : workflow.kind === "write-tool"
      ? writeTool!
      : reportRegistry.find((candidate) => candidate.id === workflow.reportId)!;
  const oauthScopes = workflow.kind === "utility"
    ? []
    : workflow.kind === "write-tool"
      ? [...writeTool!.oauthScopes]
      : ["write_access"];
  const customerProfiles = useOAuthCustomerProfiles();
  const [draft, setDraft] = useState<CredentialsDraft>({
    instanceType: credentials?.instanceType ?? "basic-business",
    customerName: "",
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
  const [profileErrors, setProfileErrors] = useState<OAuthCustomerProfileErrors>({});
  const [redirectUri, setRedirectUri] = useState("");
  const [redirectStatus, setRedirectStatus] = useState<string | null>(null);
  const pendingOAuthFlowRef = useRef<PendingOAuthFlow | null>(null);
  const oauthPendingRef = useRef(false);
  const nextOAuthFlowIdRef = useRef(0);
  const profileBackedDraftEditedRef = useRef(false);
  const instanceTypeEditedRef = useRef(false);
  const restoredProfileAppliedRef = useRef(false);
  const configRequestedRef = useRef(false);
  const mountedRef = useRef(false);
  const isEnterprise = draft.instanceType === "enterprise";
  const profileTargetBusy = customerProfiles.busy || oauthPending;
  const profileDraft: OAuthCustomerProfileDraft = {
    customerName: draft.customerName,
    baseUrl: draft.baseUrl,
    oauthClientId: draft.oauthClientId,
    includeNoExpiry: draft.includeNoExpiry,
  };
  const profileDirty = customerProfiles.selectedProfile
    ? isOAuthCustomerProfileDraftDirty(customerProfiles.selectedProfile, profileDraft)
    : Boolean(
        draft.customerName.trim() ||
        draft.baseUrl.trim() ||
        draft.oauthClientId.trim() ||
        draft.includeNoExpiry
      );

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!isEnterprise || configRequestedRef.current) {
      return;
    }

    configRequestedRef.current = true;
    void fetch("/api/oauth/pkce/config")
      .then((response) => response.json())
      .then((value: unknown) => {
        if (!mountedRef.current) {
          return;
        }
        if (!isOAuthPublicConfigResponse(value)) {
          setRedirectStatus(OAUTH_CONFIG_ERROR);
          return;
        }
        if (value.ok) {
          setRedirectUri(value.redirectUri);
          return;
        }
        setRedirectStatus(OAUTH_CONFIG_ERROR);
      })
      .catch(() => {
        if (mountedRef.current) {
          setRedirectStatus(OAUTH_CONFIG_ERROR);
        }
      });
  }, [isEnterprise]);

  useEffect(() => {
    if (!customerProfiles.ready || restoredProfileAppliedRef.current) {
      return;
    }
    restoredProfileAppliedRef.current = true;
    const keepExplicitBasicLane =
      instanceTypeEditedRef.current && draft.instanceType === "basic-business";

    if (credentials?.instanceType === "enterprise") {
      const matchingSessionProfile = customerProfiles.profiles.find(
        (profile) =>
          canonicalizeEnterpriseBaseUrl(profile.baseUrl) ===
            canonicalizeEnterpriseBaseUrl(credentials.baseUrl) &&
          profile.oauthClientId === (credentials.oauthClientId ?? ""),
      );

      if (matchingSessionProfile) {
        if (matchingSessionProfile.id !== customerProfiles.selectedProfileId) {
          void customerProfiles.selectProfile(matchingSessionProfile.id);
        }
        if (!profileBackedDraftEditedRef.current && !keepExplicitBasicLane) {
          applyProfile(matchingSessionProfile);
        }
      } else if (customerProfiles.selectedProfileId !== undefined) {
        void customerProfiles.selectProfile(undefined);
      }
      return;
    }

    if (
      profileBackedDraftEditedRef.current ||
      keepExplicitBasicLane ||
      !customerProfiles.selectedProfile
    ) {
      return;
    }

    if (credentials === null || draft.instanceType === "enterprise") {
      applyProfile(customerProfiles.selectedProfile);
    }
  }, [customerProfiles.ready]);

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
    markProfileEdited = true,
  ) {
    const isProfileField =
      field === "customerName" ||
      field === "baseUrl" ||
      field === "oauthClientId" ||
      field === "includeNoExpiry";
    if (markProfileEdited && isProfileField) {
      profileBackedDraftEditedRef.current = true;
    }
    setSaved(false);
    setOauthError(null);
    if (isProfileField) {
      setProfileErrors((current) => ({
        ...current,
        [field as keyof OAuthCustomerProfileDraft]: undefined,
      }));
    }
    setDraft((current) => ({ ...current, [field]: value }));
  }

  function applyProfile(profile: OAuthCustomerProfile) {
    const values = toOAuthCustomerProfileDraft(profile);
    setDraft((current) => ({ ...current, instanceType: "enterprise", ...values }));
    profileBackedDraftEditedRef.current = false;
    setSaved(false);
    setOauthError(null);
    setProfileErrors({});
  }

  function clearProfileDraft() {
    setDraft((current) => ({
      ...current,
      customerName: "",
      baseUrl: "",
      oauthClientId: "",
      includeNoExpiry: false,
    }));
    profileBackedDraftEditedRef.current = false;
    setSaved(false);
    setOauthError(null);
    setProfileErrors({});
  }

  function handleInstanceTypeChange(instanceType: InstanceType) {
    instanceTypeEditedRef.current = true;
    updateDraft("instanceType", instanceType, false);
    if (instanceType !== "enterprise") {
      setProfileErrors({});
      return;
    }
    if (
      customerProfiles.selectedProfile &&
      !profileBackedDraftEditedRef.current
    ) {
      applyProfile(customerProfiles.selectedProfile);
    }
  }

  function handleProfileSelection(profileId?: string) {
    const preferenceWrite = customerProfiles.selectProfile(profileId);
    const profile = customerProfiles.profiles.find((candidate) => candidate.id === profileId);
    if (profile) {
      applyProfile(profile);
    } else {
      clearProfileDraft();
    }
    void preferenceWrite;
  }

  async function handleProfileSave() {
    const result = await customerProfiles.createProfile(profileDraft);
    if (!result.ok) {
      setProfileErrors(result.errors);
      return;
    }
    applyProfile(result.profile);
  }

  async function handleProfileUpdate() {
    const result = await customerProfiles.updateProfile(profileDraft);
    if (!result.ok) {
      setProfileErrors(result.errors);
      return;
    }
    applyProfile(result.profile);
  }

  async function handleProfileDelete() {
    if (await customerProfiles.deleteSelectedProfile()) {
      clearProfileDraft();
    }
  }

  async function handleCopyRedirectUri() {
    try {
      await navigator.clipboard.writeText(redirectUri);
      if (mountedRef.current) {
        setRedirectStatus("Redirect URL copied.");
      }
    } catch {
      if (mountedRef.current) {
        setRedirectStatus(OAUTH_COPY_ERROR);
      }
    }
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
          scopes: oauthScopes,
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
        <p className="scope-label">
          Scope notes for selected {workflow.kind === "utility" ? "utility" : workflow.kind === "write-tool" ? "write tool" : "report"}
        </p>
        <h3 className="fs-body2 mb8">{metadata.title} credential notes</h3>
        <ul className="m0">
          <li>Basic/Business: provide your team URL and Personal access token.</li>
          <li>
            Enterprise: provide your site URL
            {metadata.credentialRequirements.includes("api-key") ? ", API key," : ""} and either
            connect with Enterprise OAuth or paste an optional access token.
          </li>
          <li>
            Required scope notes:{" "}
            {metadata.credentialRequirements
              .map((requirement) => credentialLabels[requirement] ?? requirement)
              .join(", ")}
            .
          </li>
          {workflow.kind === "utility" && (
            <li>Read-only workflow: both API lanes are used without requesting write access.</li>
          )}
          <li>Credential acquisition guidance placeholder: add internal steps here.</li>
        </ul>
      </div>
      <form className="credentials-form" onSubmit={handleSubmit}>
        <label className="d-block">
          <span className="d-block fs-caption tt-uppercase fc-light mb4">Instance type</span>
          <select
            className="s-select"
            value={draft.instanceType}
            disabled={profileTargetBusy}
            onChange={(event) => handleInstanceTypeChange(event.currentTarget.value as InstanceType)}
          >
            <option value="basic-business">Basic / Business</option>
            <option value="enterprise">Enterprise</option>
          </select>
        </label>
        <label className="d-block">
          <span className="d-block fs-caption tt-uppercase fc-light mb4">Instance URL</span>
          <input
            className="s-input"
            aria-describedby={
              isEnterprise && profileErrors.baseUrl ? PROFILE_BASE_URL_ERROR_ID : undefined
            }
            aria-invalid={isEnterprise && profileErrors.baseUrl ? true : undefined}
            value={draft.baseUrl}
            disabled={profileTargetBusy}
            onChange={(event) => updateDraft("baseUrl", event.currentTarget.value)}
            placeholder="https://stackoverflowteams.com/c/team-name"
            required
          />
        </label>
        {isEnterprise && profileErrors.baseUrl && (
          <p className="oauth-profile-error" id={PROFILE_BASE_URL_ERROR_ID} role="alert">
            {profileErrors.baseUrl}
          </p>
        )}
        {isEnterprise ? (
          <>
            <OAuthCustomerProfileManager
              profiles={customerProfiles.profiles}
              selectedProfileId={customerProfiles.selectedProfileId}
              customerName={draft.customerName}
              dirty={profileDirty}
              ready={customerProfiles.ready}
              available={customerProfiles.available}
              busy={profileTargetBusy}
              errors={profileErrors}
              warning={customerProfiles.warning}
              onCustomerNameChange={(value) => updateDraft("customerName", value)}
              onSelect={handleProfileSelection}
              onSave={() => void handleProfileSave()}
              onUpdate={() => void handleProfileUpdate()}
              onDelete={() => void handleProfileDelete()}
            />
            <label className="d-block">
              <span className="d-block fs-caption tt-uppercase fc-light mb4">API key</span>
              <input
                className="s-input"
                value={draft.apiKey}
                onChange={(event) => updateDraft("apiKey", event.currentTarget.value)}
              />
            </label>
            <label className="d-block">
              <span className="d-block fs-caption tt-uppercase fc-light mb4">
                Access token (optional)
              </span>
              <input
                className="s-input"
                type="password"
                aria-describedby="enterprise-access-token-help"
                value={draft.accessToken}
                onChange={(event) => updateDraft("accessToken", event.currentTarget.value)}
              />
            </label>
            <p className="oauth-status" id="enterprise-access-token-help">
              Optional if you connect with Enterprise OAuth.
            </p>
            <label className="d-block">
              <span className="d-block fs-caption tt-uppercase fc-light mb4">OAuth Client ID</span>
              <input
                className="s-input"
                aria-describedby={
                  profileErrors.oauthClientId ? PROFILE_CLIENT_ID_ERROR_ID : undefined
                }
                aria-invalid={profileErrors.oauthClientId ? true : undefined}
                value={draft.oauthClientId}
                disabled={profileTargetBusy}
                onChange={(event) => updateDraft("oauthClientId", event.currentTarget.value)}
              />
            </label>
            {profileErrors.oauthClientId && (
              <p className="oauth-profile-error" id={PROFILE_CLIENT_ID_ERROR_ID} role="alert">
                {profileErrors.oauthClientId}
              </p>
            )}
            <div className="oauth-redirect-row">
              <label className="d-block">
                <span className="d-block fs-caption tt-uppercase fc-light mb4">
                  OAuth redirect URL
                </span>
                <input
                  className="s-input"
                  aria-label="OAuth redirect URL"
                  value={redirectUri}
                  readOnly
                />
              </label>
              <button
                className="s-btn"
                type="button"
                onClick={() => void handleCopyRedirectUri()}
                disabled={!redirectUri}
              >
                Copy redirect URL
              </button>
            </div>
            {redirectStatus && (
              <p className="oauth-status" role="status">
                {redirectStatus}
              </p>
            )}
            <div className="oauth-connect-panel">
              <label className="d-flex ai-center g8">
                <input
                  type="checkbox"
                  checked={draft.includeNoExpiry}
                  disabled={profileTargetBusy}
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

function isOAuthPublicConfigResponse(value: unknown): value is OAuthPublicConfigResponse {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const response = value as {
    ok?: unknown;
    redirectUri?: unknown;
    error?: unknown;
  };

  if (response.ok === true) {
    return typeof response.redirectUri === "string" && response.redirectUri.length > 0;
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
