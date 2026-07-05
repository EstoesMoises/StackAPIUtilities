import { StackApiV3Client } from "../api/stackApiV3";
import {
  normalizeInstanceUrl,
  validateEnterpriseV3OAuthCredentials,
  type NormalizedInstance,
} from "../credentials/credentialRules";
import type { SessionCredentials } from "../domain/types";
import {
  applyUserGroupSyncPlan,
  previewUserGroupSync,
  UserGroupSyncInputError,
  type UserGroupSyncApplyResult,
  type UserGroupSyncClient,
} from "../writeTools/userGroupSyncRunner";
import type { UserGroupSyncMode, UserGroupSyncPlan } from "../writeTools/userGroupSync";

export interface UserGroupSyncRequestPayload {
  action: "preview" | "apply";
  credentials: SessionCredentials;
  csvText: string;
  groupNameTemplate: string;
  syncMode: UserGroupSyncMode;
  expectedPreview?: UserGroupSyncPlan;
}

interface UserGroupSyncApiDependencies {
  createClient?: (credentials: SessionCredentials) => UserGroupSyncClient;
}

export type UserGroupSyncResponseBody =
  | { ok: true; result: UserGroupSyncPlan | UserGroupSyncApplyResult }
  | { ok: false; error: string };

const REDACTED_CREDENTIAL = "[redacted]";

interface CanonicalUserGroupSyncPlan {
  syncMode: UserGroupSyncMode;
  groupNameTemplate: string;
  blockingErrors: string[];
  skippedRows: CanonicalUserGroupSyncSkippedRow[];
  groups: CanonicalUserGroupSyncGroup[];
}

interface CanonicalUserGroupSyncSkippedRow {
  rowNumber: number;
  email: string;
  seniorManager: string;
  reason: string;
}

interface CanonicalUserGroupSyncGroup {
  manager: string;
  groupName: string;
  existingGroupId: number | null;
  createGroup: boolean;
  desiredUserIds: number[];
  addUserIds: number[];
  removeUserIds: number[];
}

export async function handleUserGroupSyncRequest(
  payload: unknown,
  dependencies: UserGroupSyncApiDependencies = {},
): Promise<Response> {
  if (!isUserGroupSyncRequestPayload(payload)) {
    return jsonResponse({ ok: false, error: "User group sync request is invalid." }, 400);
  }

  const normalizedCredentials = normalizeWriteCredentials(payload.credentials);
  const redactCredentialSecrets = createCredentialRedactor(payload.credentials, normalizedCredentials);
  const browserJsonResponse = (body: UserGroupSyncResponseBody, status: number) =>
    redactedJsonResponse(body, status, redactCredentialSecrets);
  const normalizedInstance = normalizeRequestInstance(normalizedCredentials.baseUrl);
  if (normalizedInstance === null) {
    return browserJsonResponse(
      { ok: false, error: "Enterprise user group sync requires a valid instance URL." },
      400,
    );
  }

  if (
    normalizedCredentials.instanceType !== "enterprise" ||
    normalizedInstance.instanceType !== "enterprise"
  ) {
    return browserJsonResponse(
      { ok: false, error: "Enterprise user group sync requires Enterprise session credentials." },
      400,
    );
  }

  if (!isSupportedEnterpriseWriteTarget(normalizedInstance)) {
    return browserJsonResponse(
      { ok: false, error: "Enterprise user group sync requires a Stack Enterprise instance URL." },
      400,
    );
  }

  const oauthValidation = validateEnterpriseV3OAuthCredentials(normalizedCredentials, {
    requiredScopes: ["write_access"],
  });
  if (!oauthValidation.valid) {
    return browserJsonResponse({ ok: false, error: oauthValidation.messages.join(" ") }, 400);
  }

  const expectedPreview =
    payload.action === "apply" && isUserGroupSyncPlan(payload.expectedPreview)
      ? payload.expectedPreview
      : null;

  if (payload.action === "apply" && expectedPreview === null) {
    return browserJsonResponse(
      { ok: false, error: "Preview changes before applying user group sync changes." },
      400,
    );
  }

  try {
    const client = dependencies.createClient
      ? dependencies.createClient(normalizedCredentials)
      : createStackApiV3Client(normalizedCredentials, normalizedInstance);
    const runnerInput = {
      csvText: payload.csvText,
      groupNameTemplate: payload.groupNameTemplate,
      syncMode: payload.syncMode,
      client,
    };
    let result: UserGroupSyncPlan | UserGroupSyncApplyResult;

    if (payload.action === "preview") {
      result = await previewUserGroupSync(runnerInput);
    } else {
      if (expectedPreview === null) {
        return browserJsonResponse(
          { ok: false, error: "Preview changes before applying user group sync changes." },
          400,
        );
      }

      const preview = await previewUserGroupSync(runnerInput);
      if (!userGroupSyncPlansMatch(preview, expectedPreview)) {
        return browserJsonResponse(
          {
            ok: false,
            error: "User group sync preview is stale. Preview changes again before applying.",
          },
          409,
        );
      }

      result = await applyUserGroupSyncPlan(preview, client);
    }

    return browserJsonResponse({ ok: true, result }, 200);
  } catch (error) {
    const errorMessage = toErrorMessage(error);
    return browserJsonResponse(
      { ok: false, error: errorMessage },
      error instanceof UserGroupSyncInputError ? 400 : 500,
    );
  }
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function normalizeWriteCredentials(credentials: SessionCredentials): SessionCredentials {
  const normalizedCredentials: SessionCredentials = { ...credentials };
  const accessToken = normalizeOptionalToken(credentials.accessToken);
  const pat = normalizeOptionalToken(credentials.pat);

  if (accessToken) {
    normalizedCredentials.accessToken = accessToken;
  } else {
    delete normalizedCredentials.accessToken;
  }

  if (pat) {
    normalizedCredentials.pat = pat;
  } else {
    delete normalizedCredentials.pat;
  }

  return normalizedCredentials;
}

function normalizeOptionalToken(token: string | undefined): string | undefined {
  const trimmedToken = token?.trim();
  return trimmedToken ? trimmedToken : undefined;
}

function createStackApiV3Client(
  credentials: SessionCredentials,
  normalizedInstance: NormalizedInstance,
): StackApiV3Client {
  return new StackApiV3Client({
    apiV3Url: normalizedInstance.apiV3Url,
    token: credentials.accessToken ?? "",
  });
}

function normalizeRequestInstance(baseUrl: string): NormalizedInstance | null {
  try {
    return normalizeInstanceUrl(baseUrl);
  } catch {
    return null;
  }
}

function isSupportedEnterpriseWriteTarget(normalizedInstance: NormalizedInstance): boolean {
  const url = new URL(normalizedInstance.baseUrl);
  const hostname = url.hostname.toLowerCase();

  return (
    url.protocol === "https:" &&
    (hostname === "stackenterprise.co" || hostname.endsWith(".stackenterprise.co"))
  );
}

function isUserGroupSyncRequestPayload(value: unknown): value is UserGroupSyncRequestPayload {
  if (
    !isRecord(value) ||
    (value.action !== "preview" && value.action !== "apply") ||
    typeof value.csvText !== "string" ||
    typeof value.groupNameTemplate !== "string" ||
    !isUserGroupSyncMode(value.syncMode) ||
    !isRecord(value.credentials)
  ) {
    return false;
  }

  return (
    typeof value.credentials.instanceType === "string" &&
    typeof value.credentials.baseUrl === "string" &&
    (value.credentials.accessToken === undefined || typeof value.credentials.accessToken === "string") &&
    (value.credentials.pat === undefined || typeof value.credentials.pat === "string") &&
    isOptionalAuthSource(value.credentials.authSource) &&
    isOptionalString(value.credentials.oauthClientId) &&
    (value.credentials.oauthScopes === undefined || isStringArray(value.credentials.oauthScopes)) &&
    isOptionalString(value.credentials.accessTokenExpiresAt)
  );
}

function isOptionalAuthSource(value: unknown): value is SessionCredentials["authSource"] | undefined {
  return value === undefined || value === "manual-pat" || value === "oauth-pkce";
}

function isOptionalString(value: unknown): value is string | undefined {
  return value === undefined || typeof value === "string";
}

function isUserGroupSyncMode(value: unknown): value is UserGroupSyncMode {
  return value === "add-only" || value === "exact-sync";
}

function isUserGroupSyncPlan(value: unknown): value is UserGroupSyncPlan {
  return (
    isRecord(value) &&
    isUserGroupSyncMode(value.syncMode) &&
    typeof value.groupNameTemplate === "string" &&
    isStringArray(value.blockingErrors) &&
    Array.isArray(value.skippedRows) &&
    value.skippedRows.every(isUserGroupSyncSkippedRow) &&
    Array.isArray(value.groups) &&
    value.groups.every(isPlannedUserGroupSyncGroup)
  );
}

function isUserGroupSyncSkippedRow(value: unknown): boolean {
  return (
    isRecord(value) &&
    Number.isInteger(value.rowNumber) &&
    typeof value.email === "string" &&
    typeof value.seniorManager === "string" &&
    typeof value.reason === "string"
  );
}

function isPlannedUserGroupSyncGroup(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.manager === "string" &&
    typeof value.groupName === "string" &&
    (value.existingGroupId === null || Number.isInteger(value.existingGroupId)) &&
    typeof value.createGroup === "boolean" &&
    isNumberArray(value.desiredUserIds) &&
    isNumberArray(value.addUserIds) &&
    isNumberArray(value.removeUserIds)
  );
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isNumberArray(value: unknown): value is number[] {
  return Array.isArray(value) && value.every((item) => Number.isInteger(item));
}

function userGroupSyncPlansMatch(left: UserGroupSyncPlan, right: UserGroupSyncPlan): boolean {
  return JSON.stringify(canonicalizeUserGroupSyncPlan(left)) === JSON.stringify(canonicalizeUserGroupSyncPlan(right));
}

function canonicalizeUserGroupSyncPlan(plan: UserGroupSyncPlan): CanonicalUserGroupSyncPlan {
  return {
    syncMode: plan.syncMode,
    groupNameTemplate: plan.groupNameTemplate,
    blockingErrors: [...plan.blockingErrors].sort(compareStrings),
    skippedRows: plan.skippedRows
      .map((row) => ({
        rowNumber: row.rowNumber,
        email: row.email,
        seniorManager: row.seniorManager,
        reason: row.reason,
      }))
      .sort(compareSkippedRows),
    groups: plan.groups
      .map((group) => ({
        manager: group.manager,
        groupName: group.groupName,
        existingGroupId: group.existingGroupId,
        createGroup: group.createGroup,
        desiredUserIds: sortNumbers(group.desiredUserIds),
        addUserIds: sortNumbers(group.addUserIds),
        removeUserIds: sortNumbers(group.removeUserIds),
      }))
      .sort(compareGroups),
  };
}

function compareGroups(left: CanonicalUserGroupSyncGroup, right: CanonicalUserGroupSyncGroup): number {
  return (
    compareStrings(left.groupName, right.groupName) ||
    compareStrings(left.manager, right.manager) ||
    compareNullableNumbers(left.existingGroupId, right.existingGroupId) ||
    compareBooleans(left.createGroup, right.createGroup) ||
    compareNumberArrays(left.desiredUserIds, right.desiredUserIds) ||
    compareNumberArrays(left.addUserIds, right.addUserIds) ||
    compareNumberArrays(left.removeUserIds, right.removeUserIds)
  );
}

function compareSkippedRows(
  left: CanonicalUserGroupSyncSkippedRow,
  right: CanonicalUserGroupSyncSkippedRow,
): number {
  return (
    left.rowNumber - right.rowNumber ||
    compareStrings(left.email, right.email) ||
    compareStrings(left.seniorManager, right.seniorManager) ||
    compareStrings(left.reason, right.reason)
  );
}

function sortNumbers(values: number[]): number[] {
  return [...values].sort((left, right) => left - right);
}

function compareNullableNumbers(left: number | null, right: number | null): number {
  if (left === right) {
    return 0;
  }

  if (left === null) {
    return -1;
  }

  if (right === null) {
    return 1;
  }

  return left - right;
}

function compareBooleans(left: boolean, right: boolean): number {
  if (left === right) {
    return 0;
  }

  return left ? 1 : -1;
}

function compareNumberArrays(left: number[], right: number[]): number {
  const length = Math.min(left.length, right.length);

  for (let index = 0; index < length; index += 1) {
    const comparison = left[index] - right[index];
    if (comparison !== 0) {
      return comparison;
    }
  }

  return left.length - right.length;
}

function compareStrings(left: string, right: string): number {
  if (left < right) {
    return -1;
  }

  if (left > right) {
    return 1;
  }

  return 0;
}

function jsonResponse(body: UserGroupSyncResponseBody, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
    },
  });
}

function redactedJsonResponse(
  body: UserGroupSyncResponseBody,
  status: number,
  redactCredentialSecrets: (value: string) => string,
): Response {
  return jsonResponse(redactBrowserStrings(body, redactCredentialSecrets) as UserGroupSyncResponseBody, status);
}

function createCredentialRedactor(
  rawCredentials: SessionCredentials,
  normalizedCredentials: SessionCredentials,
): (value: string) => string {
  const secretCandidates = [
    rawCredentials.accessToken,
    rawCredentials.pat,
    normalizedCredentials.accessToken,
    normalizedCredentials.pat,
  ].filter(isNonBlankString);
  const uniqueSecretCandidates = [...new Set(secretCandidates)].sort((left, right) => right.length - left.length);

  return (value) =>
    uniqueSecretCandidates.reduce(
      (redactedValue, secret) => redactedValue.split(secret).join(REDACTED_CREDENTIAL),
      value,
    );
}

function redactBrowserStrings(value: unknown, redactCredentialSecrets: (value: string) => string): unknown {
  if (typeof value === "string") {
    return redactCredentialSecrets(value);
  }

  if (Array.isArray(value)) {
    return value.map((item) => redactBrowserStrings(item, redactCredentialSecrets));
  }

  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, redactBrowserStrings(item, redactCredentialSecrets)]),
    );
  }

  return value;
}

function isNonBlankString(value: string | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
