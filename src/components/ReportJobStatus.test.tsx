import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ReportJobStatus } from "./ReportJobStatus";
import type { ReportJobProgress } from "../reports/resumable/types";
const progress: ReportJobProgress = { restoring: false, estimate: { minimumSeconds: 7200, maximumSeconds: 10800 }, job: {
  version: 1, id: "job", revision: 0, reportId: "tag-report", reportTitle: "Tag Report", connectionKey: "enterprise|https://example.com", credentialFingerprint: "a".repeat(64),
  periods: [{ periodRole: "current", scope: {} }], status: "running", createdAt: "2026-01-01", updatedAt: "2026-01-01",
  completedRequests: 500, savedBytes: 1024, activeMs: 60000, timings: { v2: { count: 500, milliseconds: 60000 }, v3: { count: 0, milliseconds: 0 } },
  retryAt: null, stage: "Collecting questions", error: null,
} };
const controls = { onPause: vi.fn(), onResume: vi.fn(), onDiscard: vi.fn(), onReconnect: vi.fn() };
describe("report job controls", () => {
  it("shows a measured hours range and lets the user pause", async () => {
    render(<ReportJobStatus progress={progress} busy ready hasCredentials error={null} {...controls} />);
    expect(screen.getByText(/2.*3.*hours/i)).toBeInTheDocument();
    expect(screen.getByText(/500.*requests/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Pause collection" }));
    expect(controls.onPause).toHaveBeenCalledOnce();
  });
  it("restores paused without pretending the browser is still collecting", () => {
    render(<ReportJobStatus progress={{ ...progress, estimate: null, job: { ...progress.job, status: "paused" } }} busy={false} ready hasCredentials={false} error={null} {...controls} />);
    expect(screen.getByRole("button", { name: "Reconnect to resume" })).toBeInTheDocument();
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
    expect(screen.getByText(/saved in this browser/i)).toBeInTheDocument();
  });
  it("labels an unknown workload without displaying a fabricated countdown", () => {
    render(<ReportJobStatus progress={{ ...progress, estimate: null, job: { ...progress.job, stage: "Discovering questions" } }} busy ready hasCredentials error={null} {...controls} />);
    expect(screen.getByText("Discovering report size…")).toBeInTheDocument();
    expect(screen.queryByText(/remaining while/i)).not.toBeInTheDocument();
  });
});
