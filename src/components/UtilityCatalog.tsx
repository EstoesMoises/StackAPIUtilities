import { useId } from "react";
import { getExecutableUtilities } from "../domain/utilityRegistry";
import type { UtilityId } from "../domain/types";

interface UtilityCatalogProps {
  selectedUtilityId: UtilityId;
  onSelect: (utilityId: UtilityId) => void;
}

export function UtilityCatalog({ selectedUtilityId, onSelect }: UtilityCatalogProps) {
  const utilities = getExecutableUtilities();
  const utilityIdPrefix = useId();

  return (
    <section className="utility-catalog" aria-labelledby="utility-catalog-heading">
      <h2 className="fs-title mb12" id="utility-catalog-heading">
        Utility Catalog
      </h2>
      <div className="utility-list">
        {utilities.map((utility) => {
          const titleId = `${utilityIdPrefix}-${utility.id}-title`;
          const scopeId = `${utilityIdPrefix}-${utility.id}-scope`;
          const modeId = `${utilityIdPrefix}-${utility.id}-mode`;
          const descriptionId = `${utilityIdPrefix}-${utility.id}-description`;

          return (
            <button
              className={`utility-list-button${selectedUtilityId === utility.id ? " is-selected" : ""}`}
              type="button"
              aria-pressed={selectedUtilityId === utility.id}
              aria-labelledby={titleId}
              aria-describedby={`${scopeId} ${modeId} ${descriptionId}`}
              onClick={() => onSelect(utility.id)}
              key={utility.id}
            >
              <span className="utility-list-title" id={titleId}>
                {utility.title}
              </span>
              <span className="utility-list-scope" id={scopeId}>
                {utility.scopeLabel}
              </span>
              <span className="utility-list-meta" id={modeId}>
                {formatUtilityMode(utility.mode)}
              </span>
              <span className="utility-list-description" id={descriptionId}>
                {utility.description}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function formatUtilityMode(mode: "read-only"): string {
  return mode === "read-only" ? "Read-only" : mode;
}
