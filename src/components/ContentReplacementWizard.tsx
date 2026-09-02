import { useState } from "react";
import type { SessionCredentials } from "../domain/types";
import { getEnterpriseWriteCredentialReadiness } from "../credentials/enterpriseV3Credentials";
import {
  useContentReplacementJob,
  type ContentReplacementJobController,
} from "../hooks/useContentReplacementJob";
import type {
  ContentReplacementJobStage,
  PersistedContentReplacementJob,
  ReplacementConfiguration,
} from "../writeTools/contentReplacement/types";
import { ContentReplacementApplyStep } from "./ContentReplacementApplyStep";
import { ContentReplacementDefineStep } from "./ContentReplacementDefineStep";
import { ContentReplacementReviewStep } from "./ContentReplacementReviewStep";
import { ContentReplacementScanStep } from "./ContentReplacementScanStep";

export interface ContentReplacementWizardProps {
  credentials: SessionCredentials | null;
  initialJob?: PersistedContentReplacementJob | null;
  controller?: ContentReplacementJobController;
  onReconnect?: () => void;
  now?: Date;
}

export function ContentReplacementWizard(props: ContentReplacementWizardProps) {
  if (props.controller) {
    return <ContentReplacementWizardView {...props} controller={props.controller} />;
  }
  return <ConnectedContentReplacementWizard {...props} />;
}

function ConnectedContentReplacementWizard({
  credentials,
  initialJob = null,
  onReconnect,
  now,
}: Omit<ContentReplacementWizardProps, "controller">) {
  const controller = useContentReplacementJob(credentials, initialJob);
  return (
    <ContentReplacementWizardView
      credentials={credentials}
      controller={controller}
      onReconnect={onReconnect}
      now={now}
    />
  );
}

function ContentReplacementWizardView({
  credentials,
  controller,
  onReconnect,
  now,
}: ContentReplacementWizardProps & { controller: ContentReplacementJobController }) {
  const [confirmingConfigurationEdit, setConfirmingConfigurationEdit] = useState(false);
  const [definingNewJob, setDefiningNewJob] = useState(false);
  const activeStep = definingNewJob ? 0 : wizardStep(controller.job?.stage);
  const baseCredentialReadiness = getEnterpriseWriteCredentialReadiness(credentials, { now });
  const credentialReadiness = controller.credentialReadiness.refreshRequired
    ? controller.credentialReadiness
    : baseCredentialReadiness;

  async function startScan(configuration: ReplacementConfiguration) {
    if (!await controller.createJob(configuration)) return;
    setDefiningNewJob(false);
    setConfirmingConfigurationEdit(false);
    await controller.startScan();
  }

  return (
    <section className="workspace-panel content-replacement-wizard" aria-labelledby="content-replacement-heading">
      <header className="workspace-header">
        <div>
          <h1 className="workspace-heading" id="content-replacement-heading">Content Replacement</h1>
          <p className="workspace-copy">Define, scan, review, and apply literal term changes across the Enterprise main site.</p>
        </div>
      </header>

      <nav className="content-replacement-step-nav" aria-label="Content replacement steps">
        <ol aria-label="Content replacement progress">
          {(["Define", "Scan", "Review", "Apply"] as const).map((label, index) => {
            const complete = index < activeStep;
            const current = index === activeStep;
            return (
              <li key={label} className={current ? "is-current" : complete ? "is-complete" : "is-future"}>
                <span aria-current={current ? "step" : undefined}>{label}</span>
                {complete && <span className="content-replacement-step-state">Complete</span>}
                {current && <span className="content-replacement-step-state">Current</span>}
              </li>
            );
          })}
        </ol>
      </nav>

      <div className="content-replacement-stage">
        {activeStep === 0 && (
          <ContentReplacementDefineStep
            onStartScan={startScan}
            disabled={controller.busy}
            scanReadiness={{ ready: credentialReadiness.valid, message: credentialReadiness.message }}
            setupError={controller.operationError ?? controller.storageError}
            storageError={controller.storageError}
            onReconnect={onReconnect}
          />
        )}
        {activeStep === 1 && (
          <ContentReplacementScanStep
            controller={controller}
            credentials={credentials}
            onReconnect={onReconnect}
          />
        )}
        {activeStep === 2 && (
          <>
            <div className="content-replacement-review-back">
              <button
                type="button"
                className="s-btn s-btn__outlined"
                disabled={controller.busy}
                onClick={() => setConfirmingConfigurationEdit(true)}
              >
                Edit configuration
              </button>
              {confirmingConfigurationEdit && (
                <div className="s-notice s-notice__warning" role="group" aria-label="Confirm configuration edit">
                  <p>Changing rules, matching options, the instance, or content scope invalidates this completed scan. A confirmed edit starts a separate new job; it never mutates these reviewed proposals.</p>
                  <div className="write-tool-actions">
                    <button type="button" className="s-btn s-btn__outlined" onClick={() => setConfirmingConfigurationEdit(false)}>Keep reviewed proposals</button>
                    <button
                      type="button"
                      className="s-btn s-btn__outlined"
                      onClick={() => {
                        setConfirmingConfigurationEdit(false);
                        setDefiningNewJob(true);
                      }}
                    >
                      Create a new job
                    </button>
                  </div>
                </div>
              )}
            </div>
            <ContentReplacementReviewStep controller={controller} />
          </>
        )}
        {activeStep === 3 && (
          <ContentReplacementApplyStep controller={controller} />
        )}
      </div>
    </section>
  );
}

function wizardStep(stage: ContentReplacementJobStage | undefined): number {
  if (!stage || stage === "define") return 0;
  if (stage === "scan") return 1;
  if (stage === "review") return 2;
  return 3;
}
