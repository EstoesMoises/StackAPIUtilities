import {
  isSupportedEnterpriseOAuthTarget,
  normalizeOAuthBaseUrl,
} from "../auth/enterpriseOAuthTarget";

const LEGACY_OAUTH_CUSTOMER_PROFILE_SCHEMA_VERSION = 1 as const;
export const OAUTH_CUSTOMER_PROFILE_SCHEMA_VERSION = 2 as const;

export interface OAuthCustomerProfileDraft {
  customerName: string;
  baseUrl: string;
  oauthClientId: string;
  apiKey: string;
  includeNoExpiry: boolean;
}

export interface OAuthCustomerProfile extends Omit<OAuthCustomerProfileDraft, "apiKey"> {
  schemaVersion: typeof OAUTH_CUSTOMER_PROFILE_SCHEMA_VERSION;
  id: string;
  apiKey?: string;
  createdAt: string;
  updatedAt: string;
}

export interface OAuthCustomerProfilePreferences {
  schemaVersion: typeof OAUTH_CUSTOMER_PROFILE_SCHEMA_VERSION;
  lastSelectedProfileId?: string;
}

export type OAuthCustomerProfileField = keyof OAuthCustomerProfileDraft;

export type OAuthCustomerProfileErrors = Partial<
  Record<OAuthCustomerProfileField, string>
>;

export type OAuthCustomerProfileMutationResult =
  | { ok: true; profile: OAuthCustomerProfile }
  | { ok: false; errors: OAuthCustomerProfileErrors };

export interface OAuthCustomerProfileDependencies {
  createId?: () => string;
  now?: () => Date;
}

const customerNameCollator = new Intl.Collator("en-US", {
  usage: "search",
  sensitivity: "accent",
});

function normalizeDraftString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeDraft(draft: OAuthCustomerProfileDraft): OAuthCustomerProfileDraft {
  const baseUrl = normalizeDraftString(draft.baseUrl);

  return {
    customerName: normalizeDraftString(draft.customerName),
    baseUrl: isSupportedEnterpriseOAuthTarget(baseUrl) ? normalizeOAuthBaseUrl(baseUrl) : baseUrl,
    oauthClientId: normalizeDraftString(draft.oauthClientId),
    apiKey: normalizeDraftString(draft.apiKey),
    includeNoExpiry: draft.includeNoExpiry,
  };
}

function normalizedDraftToProfileFields(
  draft: OAuthCustomerProfileDraft,
): Omit<OAuthCustomerProfile, "schemaVersion" | "id" | "createdAt" | "updatedAt"> {
  const fields = {
    customerName: draft.customerName,
    baseUrl: draft.baseUrl,
    oauthClientId: draft.oauthClientId,
    includeNoExpiry: draft.includeNoExpiry,
  };

  return draft.apiKey ? { ...fields, apiKey: draft.apiKey } : fields;
}

function customerNamesMatch(left: string, right: string): boolean {
  return customerNameCollator.compare(left.normalize("NFC"), right.normalize("NFC")) === 0;
}

function validateDraft(
  draft: OAuthCustomerProfileDraft,
  existingProfiles: readonly OAuthCustomerProfile[],
  profileIdToExclude?: string,
): OAuthCustomerProfileErrors {
  const errors: OAuthCustomerProfileErrors = {};

  if (!draft.customerName) {
    errors.customerName = "Enter a customer name.";
  } else if (
    existingProfiles.some(
      (profile) =>
        profile.id !== profileIdToExclude &&
        customerNamesMatch(profile.customerName.trim(), draft.customerName),
    )
  ) {
    errors.customerName = "Use a unique customer name.";
  }

  if (!isSupportedEnterpriseOAuthTarget(draft.baseUrl)) {
    errors.baseUrl = "Enter a Stack Enterprise HTTPS instance URL.";
  }

  if (!draft.oauthClientId) {
    errors.oauthClientId = "Enter an OAuth client ID.";
  }

  if (typeof draft.includeNoExpiry !== "boolean") {
    errors.includeNoExpiry = "Choose whether to include users without an expiry date.";
  }

  return errors;
}

function hasErrors(errors: OAuthCustomerProfileErrors): boolean {
  return Object.keys(errors).length > 0;
}

function toIsoTimestamp(now: () => Date): string {
  return now().toISOString();
}

export function createOAuthCustomerProfile(
  draft: OAuthCustomerProfileDraft,
  existingProfiles: readonly OAuthCustomerProfile[],
  dependencies: OAuthCustomerProfileDependencies = {},
): OAuthCustomerProfileMutationResult {
  const normalizedDraft = normalizeDraft(draft);
  const errors = validateDraft(normalizedDraft, existingProfiles);

  if (hasErrors(errors)) {
    return { ok: false, errors };
  }

  const timestamp = toIsoTimestamp(dependencies.now ?? (() => new Date()));
  return {
    ok: true,
    profile: {
      schemaVersion: OAUTH_CUSTOMER_PROFILE_SCHEMA_VERSION,
      id: dependencies.createId ? dependencies.createId() : crypto.randomUUID(),
      ...normalizedDraftToProfileFields(normalizedDraft),
      createdAt: timestamp,
      updatedAt: timestamp,
    },
  };
}

export function updateOAuthCustomerProfile(
  profile: OAuthCustomerProfile,
  draft: OAuthCustomerProfileDraft,
  existingProfiles: readonly OAuthCustomerProfile[],
  dependencies: OAuthCustomerProfileDependencies = {},
): OAuthCustomerProfileMutationResult {
  const normalizedDraft = normalizeDraft(draft);
  const errors = validateDraft(normalizedDraft, existingProfiles, profile.id);

  if (hasErrors(errors)) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    profile: {
      schemaVersion: OAUTH_CUSTOMER_PROFILE_SCHEMA_VERSION,
      id: profile.id,
      ...normalizedDraftToProfileFields(normalizedDraft),
      createdAt: profile.createdAt,
      updatedAt: toIsoTimestamp(dependencies.now ?? (() => new Date())),
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonblankTrimmedString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.trim() === value;
}

function isExactIsoTimestamp(value: unknown): value is string {
  if (typeof value !== "string") {
    return false;
  }

  const date = new Date(value);
  return !Number.isNaN(date.getTime()) && date.toISOString() === value;
}

export function parseOAuthCustomerProfile(value: unknown): OAuthCustomerProfile | null {
  if (
    !isRecord(value) ||
    (value.schemaVersion !== LEGACY_OAUTH_CUSTOMER_PROFILE_SCHEMA_VERSION &&
      value.schemaVersion !== OAUTH_CUSTOMER_PROFILE_SCHEMA_VERSION)
  ) {
    return null;
  }

  if (
    !isNonblankTrimmedString(value.id) ||
    !isNonblankTrimmedString(value.customerName) ||
    !isNonblankTrimmedString(value.baseUrl) ||
    !isNonblankTrimmedString(value.oauthClientId) ||
    typeof value.includeNoExpiry !== "boolean" ||
    !isExactIsoTimestamp(value.createdAt) ||
    !isExactIsoTimestamp(value.updatedAt) ||
    !isSupportedEnterpriseOAuthTarget(value.baseUrl) ||
    normalizeOAuthBaseUrl(value.baseUrl) !== value.baseUrl
  ) {
    return null;
  }

  const profile: OAuthCustomerProfile = {
    schemaVersion: OAUTH_CUSTOMER_PROFILE_SCHEMA_VERSION,
    id: value.id,
    customerName: value.customerName,
    baseUrl: value.baseUrl,
    oauthClientId: value.oauthClientId,
    includeNoExpiry: value.includeNoExpiry,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  };

  if (value.schemaVersion === LEGACY_OAUTH_CUSTOMER_PROFILE_SCHEMA_VERSION) {
    return profile;
  }

  if (
    !Object.prototype.hasOwnProperty.call(value, "apiKey") ||
    value.apiKey === undefined
  ) {
    return profile;
  }

  if (!isNonblankTrimmedString(value.apiKey)) {
    return null;
  }

  return { ...profile, apiKey: value.apiKey };
}

export function parseOAuthCustomerProfilePreferences(
  value: unknown,
): OAuthCustomerProfilePreferences | null {
  if (
    !isRecord(value) ||
    (value.schemaVersion !== LEGACY_OAUTH_CUSTOMER_PROFILE_SCHEMA_VERSION &&
      value.schemaVersion !== OAUTH_CUSTOMER_PROFILE_SCHEMA_VERSION)
  ) {
    return null;
  }

  if (
    value.lastSelectedProfileId !== undefined &&
    !isNonblankTrimmedString(value.lastSelectedProfileId)
  ) {
    return null;
  }

  return value.lastSelectedProfileId === undefined
    ? { schemaVersion: OAUTH_CUSTOMER_PROFILE_SCHEMA_VERSION }
    : {
        schemaVersion: OAUTH_CUSTOMER_PROFILE_SCHEMA_VERSION,
        lastSelectedProfileId: value.lastSelectedProfileId,
      };
}

export function toOAuthCustomerProfileDraft(
  profile: OAuthCustomerProfile,
): OAuthCustomerProfileDraft {
  return {
    customerName: profile.customerName,
    baseUrl: profile.baseUrl,
    oauthClientId: profile.oauthClientId,
    apiKey: profile.apiKey ?? "",
    includeNoExpiry: profile.includeNoExpiry,
  };
}

export function isOAuthCustomerProfileDraftDirty(
  profile: OAuthCustomerProfile,
  draft: OAuthCustomerProfileDraft,
): boolean {
  const normalizedDraft = normalizeDraft(draft);
  return (
    normalizedDraft.customerName !== profile.customerName ||
    normalizedDraft.baseUrl !== profile.baseUrl ||
    normalizedDraft.oauthClientId !== profile.oauthClientId ||
    normalizedDraft.apiKey !== (profile.apiKey ?? "") ||
    normalizedDraft.includeNoExpiry !== profile.includeNoExpiry
  );
}
