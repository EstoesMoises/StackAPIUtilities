import { useRef, useState } from "react";
import type { SessionCredentials } from "../domain/types";
import type { UserGroupSyncMode, UserGroupSyncPlan } from "../writeTools/userGroupSync";
import type { UserGroupSyncApplyResult } from "../writeTools/userGroupSyncRunner";

interface UserGroupSyncPanelProps {
  credentials: SessionCredentials | null;
}

type UserGroupSyncResponseBody =
  | { ok: true; result: UserGroupSyncPlan | UserGroupSyncApplyResult }
  | { ok: false; error: string };

const DEFAULT_TEMPLATE = "{Senior Manager} VRM";
const MISSING_CREDENTIALS_MESSAGE = "Connect with Enterprise OAuth before using User Group Sync.";

export function UserGroupSyncPanel({ credentials }: UserGroupSyncPanelProps) {
  const [csvText, setCsvText] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [groupNameTemplate, setGroupNameTemplate] = useState(DEFAULT_TEMPLATE);
  const [syncMode, setSyncMode] = useState<UserGroupSyncMode>("add-only");
  const [preview, setPreview] = useState<UserGroupSyncPlan | null>(null);
  const [previewSnapshotKey, setPreviewSnapshotKey] = useState<string | null>(null);
  const [applyResult, setApplyResult] = useState<UserGroupSyncApplyResult | null>(null);
  const [pendingAction, setPendingAction] = useState<"preview" | "apply" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const requestInFlightRef = useRef(false);
  const fileReadRequestIdRef = useRef(0);
  const inputSnapshotKey = createInputSnapshotKey({
    credentials,
    csvText,
    groupNameTemplate,
    syncMode,
  });
  const latestInputSnapshotKeyRef = useRef(inputSnapshotKey);
  latestInputSnapshotKeyRef.current = inputSnapshotKey;

  const exactSync = syncMode === "exact-sync";
  const hasCsv = csvText.trim() !== "";
  const requestPending = pendingAction !== null;
  const canPreview = credentials !== null && hasCsv && !requestPending;
  const canApply =
    !requestPending &&
    preview !== null &&
    previewSnapshotKey === inputSnapshotKey &&
    preview.blockingErrors.length === 0 &&
    credentials !== null &&
    hasCsv;

  function clearSyncResults() {
    setPreview(null);
    setPreviewSnapshotKey(null);
    setApplyResult(null);
    setMessage(null);
    setError(null);
  }

  async function handleFile(fileList: FileList | null) {
    const fileReadRequestId = fileReadRequestIdRef.current + 1;
    fileReadRequestIdRef.current = fileReadRequestId;
    const file = fileList?.[0];
    if (!file) return;

    setCsvText("");
    setFileName(null);
    clearSyncResults();

    try {
      const text = await readFileText(file);
      if (fileReadRequestId !== fileReadRequestIdRef.current) {
        return;
      }
      setCsvText(text);
      setFileName(file.name);
      setError(null);
      setMessage(`Loaded ${file.name}.`);
    } catch (caughtError) {
      if (fileReadRequestId !== fileReadRequestIdRef.current) {
        return;
      }
      setMessage(null);
      setError(caughtError instanceof Error ? caughtError.message : `Unable to read ${file.name}.`);
    }
  }

  async function runAction(action: "preview" | "apply") {
    if (requestInFlightRef.current) {
      return;
    }

    if (action === "apply") {
      setApplyResult(null);
      setMessage(null);
      setError(null);
    }

    if (!credentials) {
      setError(MISSING_CREDENTIALS_MESSAGE);
      setMessage(null);
      return;
    }

    if (!hasCsv) {
      return;
    }

    const requestSnapshotKey = inputSnapshotKey;
    const expectedPreview = action === "apply" ? preview : null;

    if (
      action === "apply" &&
      (expectedPreview === null ||
        previewSnapshotKey !== requestSnapshotKey ||
        expectedPreview.blockingErrors.length > 0)
    ) {
      return;
    }

    if (
      action === "apply" &&
      exactSync &&
      !window.confirm("Exact sync can remove users from generated VRM groups. Apply these changes?")
    ) {
      return;
    }

    if (action === "preview") {
      clearSyncResults();
    }

    requestInFlightRef.current = true;
    setPendingAction(action);

    try {
      setError(null);
      const response = await fetch("/api/write-tools/user-group-sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          credentials,
          csvText,
          groupNameTemplate,
          syncMode,
          ...(action === "apply" ? { expectedPreview } : {}),
        }),
      });
      const body = (await response.json()) as UserGroupSyncResponseBody;

      if (!body.ok) {
        if (latestInputSnapshotKeyRef.current !== requestSnapshotKey) {
          return;
        }
        setError(body.error);
        setMessage(null);
        if (action === "preview") {
          setPreview(null);
          setPreviewSnapshotKey(null);
          setApplyResult(null);
        } else {
          setApplyResult(null);
        }
        return;
      }

      if (action === "preview") {
        if (latestInputSnapshotKeyRef.current !== requestSnapshotKey) {
          return;
        }
        setPreview(body.result as UserGroupSyncPlan);
        setPreviewSnapshotKey(requestSnapshotKey);
        setApplyResult(null);
        setMessage("Preview ready.");
      } else {
        if (latestInputSnapshotKeyRef.current !== requestSnapshotKey) {
          return;
        }
        setApplyResult(body.result as UserGroupSyncApplyResult);
        setMessage("Apply completed.");
      }
    } catch (caughtError) {
      if (latestInputSnapshotKeyRef.current !== requestSnapshotKey) {
        return;
      }
      setMessage(null);
      setError(caughtError instanceof Error ? caughtError.message : "Unable to run user group sync.");
      if (action === "preview") {
        setPreview(null);
        setPreviewSnapshotKey(null);
      }
      setApplyResult(null);
    } finally {
      requestInFlightRef.current = false;
      setPendingAction(null);
    }
  }

  return (
    <section className="workspace-panel" aria-labelledby="user-group-sync-heading">
      <div className="workspace-header">
        <div>
          <p className="workspace-kicker">Enterprise write tool</p>
          <h2 className="workspace-heading" id="user-group-sync-heading">
            User Group Sync
          </h2>
        </div>
      </div>

      <p className="workspace-copy">
        Upload the user export CSV, preview generated VRM groups, then apply Enterprise user group
        changes.
      </p>

      <div className="write-tool-form">
        <label className="d-block">
          <span className="d-block fs-caption tt-uppercase fc-light mb4">User export CSV</span>
          <input
            className="s-input"
            type="file"
            accept=".csv,text/csv"
            aria-label="Upload user export CSV"
            onChange={(event) => void handleFile(event.currentTarget.files)}
          />
        </label>

        <label className="d-block">
          <span className="d-block fs-caption tt-uppercase fc-light mb4">Group name template</span>
          <input
            className="s-input"
            aria-label="Group name template"
            value={groupNameTemplate}
            onChange={(event) => {
              setGroupNameTemplate(event.currentTarget.value);
              clearSyncResults();
            }}
          />
        </label>

        <label className="write-tool-checkbox">
          <input
            type="checkbox"
            checked={exactSync}
            onChange={(event) => {
              setSyncMode(event.currentTarget.checked ? "exact-sync" : "add-only");
              clearSyncResults();
            }}
          />{" "}
          Exact sync
        </label>

        {exactSync && (
          <div className="s-notice s-notice__warning" role="note">
            Exact sync can remove users from generated VRM groups when they are not present in the
            current CSV.
          </div>
        )}

        <div className="write-tool-actions">
          <button
            className="s-btn s-btn__primary"
            type="button"
            disabled={!canPreview}
            onClick={() => void runAction("preview")}
          >
            Preview changes
          </button>
          <button
            className="s-btn"
            type="button"
            disabled={!canApply}
            onClick={() => void runAction("apply")}
          >
            Apply changes
          </button>
        </div>
      </div>

      {!credentials && (
        <div className="s-notice s-notice__warning mt16" role="status">
          {MISSING_CREDENTIALS_MESSAGE}
        </div>
      )}
      {fileName && <p className="fs-caption fc-light mt12">Loaded file: {fileName}</p>}
      {message && (
        <div className="s-notice s-notice__success mt16" role="status">
          {message}
        </div>
      )}
      {error && (
        <div className="s-notice s-notice__danger mt16" role="alert">
          {error}
        </div>
      )}
      {preview && <PreviewSummary preview={preview} />}
      {applyResult && <ApplySummary result={applyResult} />}
    </section>
  );
}

function PreviewSummary({ preview }: { preview: UserGroupSyncPlan }) {
  const exactSync = preview.syncMode === "exact-sync";

  return (
    <div className="write-tool-preview">
      <h3 className="fs-subheading mt24">Preview</h3>
      <p className="fs-body2">{exactSync ? "Exact sync" : "Add-only"}</p>
      {preview.blockingErrors.length > 0 && (
        <div className="s-notice s-notice__danger" role="alert">
          {preview.blockingErrors.map((blockingError) => (
            <p className="m0" key={blockingError}>
              {blockingError}
            </p>
          ))}
        </div>
      )}
      <table className="write-tool-table">
        <thead>
          <tr>
            <th>Group</th>
            <th>Manager</th>
            <th>Action</th>
            <th>Members to add</th>
            {exactSync && <th>Members to remove</th>}
          </tr>
        </thead>
        <tbody>
          {preview.groups.map((group) => (
            <tr key={group.groupName}>
              <td>{group.groupName}</td>
              <td>{group.manager}</td>
              <td>{group.createGroup ? "Create group" : "Update group"}</td>
              <td>{formatIds(group.addUserIds)}</td>
              {exactSync && <td>{formatIds(group.removeUserIds)}</td>}
            </tr>
          ))}
        </tbody>
      </table>
      {preview.skippedRows.length > 0 && (
        <>
          <h3 className="fs-subheading mt24">Skipped rows</h3>
          <ul>
            {preview.skippedRows.map((row) => (
              <li key={`${row.rowNumber}-${row.email}-${row.reason}`}>
                Row {row.rowNumber}: {row.reason}
                {row.email ? ` (${row.email})` : ""}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function ApplySummary({ result }: { result: UserGroupSyncApplyResult }) {
  return (
    <div className="write-tool-preview">
      <h3 className="fs-subheading mt24">Apply summary</h3>
      <ul>
        {result.operations.map((operation, index) => (
          <li key={`${operation.kind}-${operation.groupName}-${index}`}>
            {operation.kind} {operation.status} for {operation.groupName}:{" "}
            {formatIds(operation.userIds).toLowerCase()}
            {operation.error ? ` (${operation.error})` : ""}
          </li>
        ))}
      </ul>
    </div>
  );
}

function formatIds(userIds: number[]) {
  return userIds.join(", ") || "None";
}

function createInputSnapshotKey(input: {
  credentials: SessionCredentials | null;
  csvText: string;
  groupNameTemplate: string;
  syncMode: UserGroupSyncMode;
}) {
  return JSON.stringify({
    credentials: input.credentials
      ? {
          instanceType: input.credentials.instanceType,
          baseUrl: input.credentials.baseUrl,
          apiKey: input.credentials.apiKey ?? null,
          accessToken: input.credentials.accessToken ?? null,
          pat: input.credentials.pat ?? null,
        }
      : null,
    csvText: input.csvText,
    groupNameTemplate: input.groupNameTemplate,
    syncMode: input.syncMode,
  });
}

async function readFileText(file: File) {
  if (typeof file.text === "function") {
    return file.text();
  }

  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(String(reader.result ?? "")));
    reader.addEventListener("error", () =>
      reject(reader.error ?? new Error(`Unable to read ${file.name}.`)),
    );
    reader.readAsText(file);
  });
}
