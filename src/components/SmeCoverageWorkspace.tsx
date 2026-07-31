import type { ApiVolumeSettingsValue } from "../domain/types";
import type { SmeCoverageDecisionPack } from "../utilities/smeCoverage/model";
import { getSmeCoveragePresetDisclosure } from "../utilities/smeCoverage/settings";
import { ApiVolumeSettings } from "./ApiVolumeSettings";
import { SmeCoverageDecisionPack as SmeCoverageDecisionPackView } from "./SmeCoverageDecisionPack";
import {
  SmeCoverageRunProgress,
  type SmeCoverageRunStage,
} from "./SmeCoverageRunProgress";
import { StackOverflowLogo } from "./StackOverflowLogo";

export interface SmeCoverageRunUiState {
  status: "idle" | "running" | "succeeded" | "failed";
  kind?: "validation" | "collection" | "unsupported" | "unexpected";
  stage?: string;
  error?: string;
}

export interface SmeCoverageWorkspaceProps {
  settings: ApiVolumeSettingsValue;
  onSettingsChange: (settings: ApiVolumeSettingsValue) => void;
  onRun: () => void;
  runState: SmeCoverageRunUiState;
  decisionPack?: SmeCoverageDecisionPack;
}

export function SmeCoverageWorkspace({
  settings,
  onSettingsChange,
  onRun,
  runState,
  decisionPack,
}: SmeCoverageWorkspaceProps) {
  return (
    <div className="workspace-stack">
      <section className="workspace-panel sme-workspace" aria-labelledby="sme-workspace-heading">
        <div className="workspace-header">
          <div>
            <div className="sme-workspace-meta">
              <span>All-time demand · Current SME coverage</span>
              <span>Read-only</span>
            </div>
            <h2 className="workspace-heading" id="sme-workspace-heading">
              SME Coverage Analyzer
            </h2>
          </div>
          <StackOverflowLogo className="workspace-stack-mark" variant="glyph" />
        </div>
        <div className="sme-workspace-copy">
          <p>
            This utility compares all-time page-view demand with assigned SMEs at run time and
            applies transparent hybrid rules to the prepared evidence.
          </p>
          <p>
            It requires both API lanes in the same read-only run. You do not need to run a Script
            first or provide an upload.
          </p>
        </div>
        <ApiVolumeSettings
          value={settings}
          radioName="sme-coverage-run-preset"
          helpText="Choose how much source evidence to collect. Higher limits reduce the chance of a partial sample, but take longer to run."
          recordDetail="Tags, questions, assigned-SME counts"
          getDisclosure={getSmeCoveragePresetDisclosure}
          onChange={onSettingsChange}
        />
        <div className="run-controls">
          <button
            className="s-btn s-btn__filled report-run-primary"
            type="button"
            disabled={runState.status === "running"}
            onClick={onRun}
          >
            Run SME coverage analysis
          </button>
        </div>
        <SmeCoverageRunProgress
          status={runState.status}
          failedStage={runState.stage as SmeCoverageRunStage | undefined}
          error={runState.error}
        />
      </section>
      {decisionPack && <SmeCoverageDecisionPackView pack={decisionPack} onRunAgain={onRun} />}
    </div>
  );
}
