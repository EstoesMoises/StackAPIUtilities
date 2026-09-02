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
import { ContentReplacementDefineStep } from "./ContentReplacementDefineStep";
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
  const activeStep = wizardStep(controller.job?.stage);
  const baseCredentialReadiness = getEnterpriseWriteCredentialReadiness(credentials, { now });
  const credentialReadiness = controller.credentialReadiness.refreshRequired
    ? controller.credentialReadiness
    : baseCredentialReadiness;

  async function startScan(configuration: ReplacementConfiguration) {
    if (!await controller.createJob(configuration)) return;
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
          <section className="content-replacement-placeholder" aria-labelledby="content-replacement-review-heading">
            <h2 id="content-replacement-review-heading">Review proposed changes</h2>
            <p>Review controls are added in the next implementation stage. This placeholder appears only after the complete scan reaches Review.</p>
          </section>
        )}
        {activeStep === 3 && (
          <section className="content-replacement-placeholder" aria-labelledby="content-replacement-apply-heading">
            <h2 id="content-replacement-apply-heading">Apply reviewed changes</h2>
            <p>Apply controls are added in the next implementation stage. This placeholder appears only after the job reaches Apply.</p>
          </section>
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
