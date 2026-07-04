import type { ReactNode } from "react";

export type AppPanel = "report" | "credentials" | "uploads";

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
};

export function AppShell({ activePanel, onPanelChange, sidebar, children, summary }: AppShellProps) {
  const credentialsLabel = summary?.credentialsSaved ? "Credentials saved" : "No credentials";
  const datasetCount = summary?.datasetCount ?? 0;
  const datasetLabel = `${datasetCount} ${datasetCount === 1 ? "dataset" : "datasets"}`;

  return (
    <div className="app-shell">
      <header className="app-topbar">
        <div className="app-brand-block">
          <div className="app-brand-mark" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
          <div className="app-title">
            <p className="app-kicker">SO4T reports</p>
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
      <div className="app-body">
        <aside className="app-sidebar">{sidebar}</aside>
        <main className="app-main" aria-label="Workspace">
          {children}
        </main>
      </div>
    </div>
  );
}
