import type { ReactNode } from "react";
import { StackOverflowLogo } from "./StackOverflowLogo";

export type AppPanel =
  | "report"
  | "utilities"
  | "credentials"
  | "uploads"
  | "datasets"
  | "write-tools";

interface AppShellSummary {
  credentialsSaved: boolean;
  datasetCount: number;
}

interface AppShellProps {
  activePanel: AppPanel;
  onPanelChange: (panel: AppPanel) => void;
  sidebar?: ReactNode;
  children: ReactNode;
  summary?: AppShellSummary;
}

const panelLabels: Record<AppPanel, string> = {
  report: "Scripts",
  utilities: "Utilities",
  credentials: "Credentials",
  uploads: "Uploads",
  datasets: "Datasets",
  "write-tools": "Write Tools",
};

export function AppShell({ activePanel, onPanelChange, sidebar, children, summary }: AppShellProps) {
  const credentialsLabel = summary?.credentialsSaved ? "Credentials saved" : "No credentials";
  const datasetCount = summary?.datasetCount ?? 0;
  const datasetLabel = `${datasetCount} ${datasetCount === 1 ? "dataset" : "datasets"}`;

  return (
    <div className="app-shell">
      <header className="app-topbar">
        <div className="app-brand-block">
          <StackOverflowLogo className="app-brand-logo" />
          <div className="app-title">
            <h1 className="app-heading">Stack API Utilities</h1>
          </div>
        </div>
        <nav className="app-nav" aria-label="Application panels">
          {(Object.keys(panelLabels) as AppPanel[]).map((panel) => (
            <button
              className={`app-nav-button${activePanel === panel ? " is-selected" : ""}`}
              type="button"
              aria-pressed={activePanel === panel}
              onClick={() => onPanelChange(panel)}
              key={panel}
            >
              {panelLabels[panel]}
            </button>
          ))}
        </nav>
        <div className="app-session-pills" aria-label="Session status">
          <span className="session-pill">{credentialsLabel}</span>
          <span className="session-pill">{datasetLabel}</span>
        </div>
      </header>
      <section className="app-readiness-warning" role="note" aria-label="Open-source tooling notice">
        <strong>Open-source notice:</strong>
        <p>
          These tools are open-source contributions provided as-is and on a best-effort basis. They are not
          official Stack Overflow products or supported services. Customers should review the logic in the{" "}
          <a href="https://github.com/EstoesMoises/StackAPIUtilities">GitHub repository</a> and are solely
          responsible for testing, validating, and running the tools.
        </p>
      </section>
      <div className={`app-body${sidebar ? "" : " app-body__focused"}`}>
        {sidebar && <aside className="app-sidebar">{sidebar}</aside>}
        <main className="app-main" aria-label="Workspace">
          {children}
        </main>
      </div>
    </div>
  );
}
