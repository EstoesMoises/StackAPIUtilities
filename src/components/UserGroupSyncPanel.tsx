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
const MISSING_CREDENTIALS_MESSAGE = "Save Enterprise session credentials before using write tools.";

export function UserGroupSyncPanel({ credentials }: UserGroupSyncPanelProps) {
  const [csvText, setCsvText] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [groupNameTemplate, setGroupNameTemplate] = useState(DEFAULT_TEMPLATE);
  const [syncMode, setSyncMode] = useState<UserGroupSyncMode>("add-only");
  const [preview, setPreview] = useState<UserGroupSyncPlan | null>(null);
  const [applyResult, setApplyResult] = useState<UserGroupSyncApplyResult | null>(null);
  const [pendingAction, setPendingAction] = useState<"preview" | "apply" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const requestInFlightRef = useRef(false);

  const exactSync = syncMode === "exact-sync";
  const hasCsv = csvText.trim() !== "";
  const requestPending = pendingAction !== null;
  const canPreview = hasCsv && !requestPending;
  const canApply =
    !requestPending &&
    preview !== null &&
    preview.blockingErrors.length === 0 &&
    credentials !== null &&
    hasCsv;

  async function handleFile(fileList: FileList | null) {
    const file = fileList?.[0];
    if (!file) return;

    setCsvText("");
    setFileName(null);
    setPreview(null);
    setApplyResult(null);
    setError(null);
    setMessage(null);

    try {
      const text = await readFileText(file);
      setCsvText(text);
      setFileName(file.name);
      setPreview(null);
      setApplyResult(null);
      setError(null);
      setMessage(`Loaded ${file.name}.`);
    } catch (caughtError) {
      setMessage(null);
      setError(caughtError instanceof Error ? caughtError.message : `Unable to read ${file.name}.`);
    }
  }

  async function runAction(action: "preview" | "apply") {
    if (requestInFlightRef.current) {
      return;
    }

    if (!credentials) {
      setError(MISSING_CREDENTIALS_MESSAGE);
      setMessage(null);
      return;
    }

    if (
      action === "apply" &&
      exactSync &&
      !window.confirm("Exact sync can remove users from generated VRM groups. Apply these changes?")
    ) {
      return;
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
        }),
      });
      const body = (await response.json()) as UserGroupSyncResponseBody;

      if (!body.ok) {
        setError(body.error);
        setMessage(null);
        if (action === "preview") {
          setPreview(null);
          setApplyResult(null);
        }
        return;
      }

      if (action === "preview") {
        setPreview(body.result as UserGroupSyncPlan);
        setApplyResult(null);
        setMessage("Preview ready.");
      } else {
        setApplyResult(body.result as UserGroupSyncApplyResult);
        setMessage("Apply completed.");
      }
    } catch (caughtError) {
      setMessage(null);
      setError(caughtError instanceof Error ? caughtError.message : "Unable to run user group sync.");
    } finally {
      requestInFlightRef.current = false;
      setPendingAction(null);
    }
  }

  return (
    <section className="workspace-panel" aria-labelledby="user-group-sync-heading">
      <div className="workspace-header">
        <p className="fs-caption fc-light mb4">Enterprise write tool</p>
        <h2 className="fs-headline2 m0" id="user-group-sync-heading">
          User Group Sync
        </h2>
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
              setPreview(null);
              setApplyResult(null);
            }}
          />
        </label>

        <label className="write-tool-checkbox">
          <input
            type="checkbox"
            checked={exactSync}
            onChange={(event) => {
              setSyncMode(event.currentTarget.checked ? "exact-sync" : "add-only");
              setPreview(null);
              setApplyResult(null);
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
