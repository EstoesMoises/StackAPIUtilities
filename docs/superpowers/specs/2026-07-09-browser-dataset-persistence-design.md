# Browser Dataset Persistence Design

## Summary

Persist loaded datasets locally in the user's browser by default so live API runs and uploads survive refreshes, tab closes, and browser restarts. Credentials remain memory-only. Users can still remove individual datasets, and a new bulk flush action clears every stored dataset plus the current in-memory dataset/report state.

## Problem

The app currently treats credentials and report data as session-only. That is appropriate for credentials, but it makes datasets disappear between browser sessions. Live report runs can be slow, and uploads are tedious to repeat, so losing loaded datasets creates unnecessary friction for users who are iterating on reports or auditing raw outputs.

## Goals

- Persist datasets automatically by default in browser-local storage.
- Restore persisted datasets when the app loads.
- Keep credentials out of browser persistence entirely.
- Preserve the existing per-dataset `Remove` action.
- Add a bulk flush action that clears all current and persisted datasets.
- Keep report outputs, report snapshots, warnings, and dataset metadata consistent with restored datasets.
- Update product copy so the privacy model is accurate.

## Non-Goals

- Do not add a server database or backend persistence.
- Do not sync datasets across browsers, devices, users, or app origins.
- Do not persist credentials, access tokens, API keys, PATs, OAuth client IDs, or OAuth state.
- Do not build report history, named saved runs, or cross-session credential profiles.
- Do not encrypt datasets in this slice.

## Recommended Approach

Use IndexedDB from client-side code. IndexedDB is built into the browser and can store larger structured data than `localStorage`, which makes it a better fit for raw report datasets. The Next.js app does not need an external database for this feature.

The persistence layer should store a versioned snapshot of the non-credential session data needed to restore datasets:

- `datasets`
- `reportOutputs`
- `reportRunSnapshots`
- `warnings`
- `selectedReportId`
- `selectedReportIds`

The snapshot must never include `credentials` or `runQueue`.

## Data Flow

On app startup:

1. Create the normal initial session state with no credentials.
2. Load any persisted dataset snapshot from IndexedDB.
3. Validate the stored snapshot shape and version.
4. Merge valid persisted dataset state into the initial session state.
5. Restore the saved report selection when it still references known reports.
6. Fall back to the normal initial report selection for invalid report IDs.
7. Ignore invalid, incompatible, or unreadable snapshots and keep the app usable.

When datasets change:

1. Reducer actions update in-memory state as they do now.
2. A client-side persistence effect writes the non-credential dataset snapshot to IndexedDB.
3. Removing one dataset updates both memory and persistence.
4. Flushing all datasets clears the IndexedDB entry and resets dataset/report state in memory.

The reducer should remain focused on state transitions. IndexedDB reads and writes should live in a small browser storage module and React effects so tests can exercise both pieces independently.

## UI Behavior

The Datasets panel keeps the existing row-level `Remove` button for precise cleanup.

When at least one dataset exists, the Datasets panel also shows a bulk action near the panel header:

- Label: `Flush stored datasets`
- Behavior: clear all datasets from the current app state and IndexedDB.
- Visibility: hidden when no datasets exist.
- Copy should make the scope clear enough that users understand it is local browser data, not Stack Overflow data.

The existing session summary count should continue to reflect the current loaded datasets. After hydration, restored datasets count as loaded datasets. After a flush, the count returns to zero.

## Error Handling

Storage failures should not break report usage. If IndexedDB is unavailable, full, blocked, or throws an unexpected error:

- Keep the current in-memory session working.
- Surface a concise non-blocking warning when persistence fails.
- Allow downloads and per-dataset removal to continue.

If a stored snapshot cannot be parsed or does not match the expected shape, ignore it and continue with an empty dataset state. The flush action should still be able to clear the stored entry.

## Privacy And Product Copy

Update README and in-app copy to say:

- Credentials are kept in memory for the current browser session only.
- Datasets are stored locally in this browser by default.
- Users can remove individual datasets or flush all stored datasets from the Datasets panel.

This keeps the user-visible security promise precise: sensitive credentials remain ephemeral, while report data persists locally for convenience until removed.

## Testing

Add focused coverage for:

- Hydrating initial app state from a persisted dataset snapshot.
- Persisting loaded live API datasets without credentials.
- Persisting imported/uploaded datasets without credentials.
- Removing a single dataset updates persisted state.
- Flushing all datasets clears memory and browser storage.
- Handling unavailable or failing IndexedDB without crashing the app.
- Datasets panel hides the bulk flush action when empty and calls it when datasets exist.
