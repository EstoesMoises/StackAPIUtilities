import { useId } from "react";
import type {
  OAuthCustomerProfile,
  OAuthCustomerProfileErrors,
} from "../domain/oauthCustomerProfiles";

export interface OAuthCustomerProfileManagerProps {
  profiles: readonly OAuthCustomerProfile[];
  selectedProfileId?: string;
  customerName: string;
  dirty: boolean;
  ready: boolean;
  available: boolean;
  busy: boolean;
  errors: OAuthCustomerProfileErrors;
  warning: string | null;
  onCustomerNameChange(value: string): void;
  onSelect(profileId?: string): void;
  onSave(): void;
  onUpdate(): void;
  onDelete(): void;
}

const DISCARD_CONFIRMATION = "Discard unsaved customer profile changes?";
const DELETE_CONFIRMATION =
  "Delete this saved customer profile? Active session credentials will not be removed.";

export function OAuthCustomerProfileManager({
  profiles,
  selectedProfileId,
  customerName,
  dirty,
  ready,
  available,
  busy,
  errors,
  warning,
  onCustomerNameChange,
  onSelect,
  onSave,
  onUpdate,
  onDelete,
}: OAuthCustomerProfileManagerProps) {
  const customerNameErrorId = useId();
  const profileControlsDisabled = !ready || !available || busy;
  const statusMessage = warning ?? (
    !ready
      ? "Loading saved customers…"
      : !available
        ? "Saved customers are unavailable in this browser. Enter OAuth details manually."
        : null
  );

  function requestSelection(profileId?: string, allowCurrentSelection = false) {
    if (!allowCurrentSelection && profileId === selectedProfileId) {
      return;
    }

    if (dirty && !window.confirm(DISCARD_CONFIRMATION)) {
      return;
    }

    onSelect(profileId);
  }

  function requestDelete() {
    if (window.confirm(DELETE_CONFIRMATION)) {
      onDelete();
    }
  }

  return (
    <fieldset className="oauth-profile-manager" aria-busy={busy || undefined}>
      <legend>Saved customer profiles</legend>
      <p className="oauth-status">
        Customer profiles store only non-sensitive OAuth settings in this browser.
      </p>

      <div className="oauth-profile-grid">
        <label className="d-block">
          <span className="d-block fs-caption tt-uppercase fc-light mb4">Saved customer</span>
          <select
            className="s-select"
            aria-label="Saved customer"
            value={selectedProfileId ?? ""}
            disabled={profileControlsDisabled}
            onChange={(event) => requestSelection(event.currentTarget.value || undefined)}
          >
            <option value="">New customer</option>
            {profiles.map((profile) => (
              <option key={profile.id} value={profile.id}>
                {profile.customerName}
              </option>
            ))}
          </select>
        </label>

        <label className="d-block">
          <span className="d-block fs-caption tt-uppercase fc-light mb4">Customer name</span>
          <input
            className="s-input"
            aria-label="Customer name"
            aria-describedby={errors.customerName ? customerNameErrorId : undefined}
            aria-invalid={errors.customerName ? true : undefined}
            value={customerName}
            disabled={busy}
            onChange={(event) => onCustomerNameChange(event.currentTarget.value)}
          />
        </label>
      </div>

      {errors.customerName && (
        <p className="oauth-profile-error" id={customerNameErrorId} role="alert">
          {errors.customerName}
        </p>
      )}

      {dirty && <p className="oauth-profile-dirty">Unsaved customer profile changes.</p>}

      <div className="oauth-profile-actions">
        <button
          className="s-btn"
          type="button"
          disabled={profileControlsDisabled}
          onClick={() => requestSelection(undefined, true)}
        >
          New customer
        </button>
        {selectedProfileId ? (
          <>
            <button
              className="s-btn s-btn__primary"
              type="button"
              disabled={profileControlsDisabled || !dirty}
              onClick={onUpdate}
            >
              Update customer
            </button>
            <button
              className="s-btn s-btn__danger"
              type="button"
              disabled={profileControlsDisabled}
              onClick={requestDelete}
            >
              Delete customer
            </button>
          </>
        ) : (
          <button
            className="s-btn s-btn__primary"
            type="button"
            disabled={profileControlsDisabled}
            onClick={onSave}
          >
            Save customer
          </button>
        )}
      </div>

      {statusMessage && (
        <p className="oauth-status" role="status">
          {statusMessage}
        </p>
      )}
    </fieldset>
  );
}
