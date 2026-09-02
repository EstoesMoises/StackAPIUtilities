import { getDiscoveryPresentation } from "../writeTools/contentReplacement/discovery";
import type { ReplacementConfiguration } from "../writeTools/contentReplacement/types";

export function ContentReplacementCoverageEvidence({
  configuration,
}: {
  configuration: ReplacementConfiguration;
}) {
  const presentation = getDiscoveryPresentation(configuration.discovery);
  return (
    <aside
      className={`content-replacement-coverage content-replacement-coverage__${configuration.discovery.mode}`}
      role="note"
      aria-label="Discovery coverage"
    >
      <span className="content-replacement-coverage-label">Discovery coverage</span>
      <strong>{presentation.label}</strong>
    </aside>
  );
}
