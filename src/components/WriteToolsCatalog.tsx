import type { CredentialRequirement, InstanceType } from "../domain/types";

export type WriteToolId = "user-group-sync";

export interface WriteToolDefinition {
  id: WriteToolId;
  title: string;
  scope: string;
  status: string;
  supportedInstances: readonly InstanceType[];
  credentialRequirements: readonly CredentialRequirement[];
  oauthScopes: readonly string[];
}

interface WriteToolsCatalogProps {
  selectedToolId: WriteToolId;
  onSelect: (toolId: WriteToolId) => void;
}

export const writeTools: WriteToolDefinition[] = [
  {
    id: "user-group-sync",
    title: "User Group Sync",
    scope: "Enterprise",
    status: "Preview required",
    supportedInstances: ["enterprise"],
    credentialRequirements: ["access-token"],
    oauthScopes: ["write_access"],
  },
];

export function WriteToolsCatalog({ selectedToolId, onSelect }: WriteToolsCatalogProps) {
  return (
    <section className="write-tools-catalog" aria-labelledby="write-tools-catalog-heading">
      <h2 className="fs-title mb12" id="write-tools-catalog-heading">
        Write Tools
      </h2>
      <div className="write-tool-list">
        {writeTools.map((tool) => (
          <button
            className={`write-tool-list-button${selectedToolId === tool.id ? " is-selected" : ""}`}
            type="button"
            aria-pressed={selectedToolId === tool.id}
            aria-label={tool.title}
            onClick={() => onSelect(tool.id)}
            key={tool.id}
          >
            <span className="write-tool-list-title">{tool.title}</span>
            <span className="write-tool-list-source">{tool.scope}</span>
            <span className="write-tool-list-meta">{tool.status}</span>
          </button>
        ))}
      </div>
    </section>
  );
}
