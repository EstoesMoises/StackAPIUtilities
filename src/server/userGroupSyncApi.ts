import { StackApiV3Client } from "../api/stackApiV3";
import type { NormalizedInstance } from "../credentials/credentialRules";
import type { SessionCredentials } from "../domain/types";
import {
  applyUserGroupSyncPlan,
  previewUserGroupSync,
  UserGroupSyncInputError,
  type UserGroupSyncApplyResult,
  type UserGroupSyncClient,
} from "../writeTools/userGroupSyncRunner";
import type { UserGroupSyncMode, UserGroupSyncPlan } from "../writeTools/userGroupSync";
import {
  prepareEnterpriseWriteContext,
  redactedJsonResponse,
  type EnterpriseWriteContextFailureCode,
} from "./enterpriseWriteRequest";

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

  const writeContext = prepareEnterpriseWriteContext(payload.credentials);
  if (!writeContext.ok) {
    return jsonResponse(
      { ok: false, error: userGroupSyncContextError(writeContext.code, writeContext.message) },
      writeContext.status,
    );
  }

  const normalizedCredentials = writeContext.credentials;
  const browserJsonResponse = (body: UserGroupSyncResponseBody, status: number) =>
    redactedJsonResponse(body, status, writeContext.redact);
  const normalizedInstance = writeContext.instance;

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

function createStackApiV3Client(
  credentials: SessionCredentials,
  normalizedInstance: NormalizedInstance,
): StackApiV3Client {
  return new StackApiV3Client({
    apiV3Url: normalizedInstance.apiV3Url,
    token: credentials.accessToken ?? "",
  });
}

function userGroupSyncContextError(
  code: EnterpriseWriteContextFailureCode,
  defaultMessage: string,
): string {
  if (code === "invalid_instance_url") {
    return "Enterprise user group sync requires a valid instance URL.";
  }

  if (code === "enterprise_credentials_required") {
    return "Enterprise user group sync requires Enterprise session credentials.";
  }

  if (code === "unsupported_enterprise_instance") {
    return "Enterprise user group sync requires a Stack Enterprise instance URL.";
  }

  return defaultMessage;
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
  return (
    value === undefined ||
    value === "manual-pat" ||
    value === "manual-enterprise-token" ||
    value === "oauth-pkce"
  );
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
