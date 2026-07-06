import type { ReactNode } from "react";
import { StackOverflowLogo } from "./StackOverflowLogo";

export type AppPanel = "report" | "credentials" | "uploads" | "datasets" | "write-tools";

interface AppShellSummary {
  credentialsSaved: boolean;
  datasetCount: number;
}

interface AppShellProps {
  activePanel: AppPanel;
  onPanelChange: (panel: AppPanel) => void;
  sidebar: ReactNode;
  children: ReactNode;
  summary?: AppShellSummary;
}

const panelLabels: Record<AppPanel, string> = {
  report: "Reports",
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
            <p className="app-kicker">Enterprise API tools</p>
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
      <section className="app-readiness-warning" role="note" aria-label="Production readiness warning">
        <strong>Pre-production warning:</strong>
        <p>
          This app is mostly untested and is not ready for production instances. Reach out to Moises on
          Slack with the reports you're using the most, what would be most useful, and let's connect on that.
        </p>
      </section>
      <div className="app-body">
        <aside className="app-sidebar">{sidebar}</aside>
        <main className="app-main" aria-label="Workspace">
          {children}
        </main>
      </div>
    </div>
  );
}
