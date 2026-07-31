import { getExecutableUtilities } from "../domain/utilityRegistry";
import type { UtilityId } from "../domain/types";

interface UtilityCatalogProps {
  selectedUtilityId: UtilityId;
  onSelect: (utilityId: UtilityId) => void;
}

export function UtilityCatalog({ selectedUtilityId, onSelect }: UtilityCatalogProps) {
  const utilities = getExecutableUtilities();

  return (
    <section className="utility-catalog" aria-labelledby="utility-catalog-heading">
      <h2 className="fs-title mb12" id="utility-catalog-heading">
        Utility Catalog
      </h2>
      <div className="utility-list">
        {utilities.map((utility) => (
          <button
            className={`utility-list-button${selectedUtilityId === utility.id ? " is-selected" : ""}`}
            type="button"
            aria-pressed={selectedUtilityId === utility.id}
            aria-label={utility.title}
            onClick={() => onSelect(utility.id)}
            key={utility.id}
          >
            <span className="utility-list-title">{utility.title}</span>
            <span className="utility-list-scope">{utility.scopeLabel}</span>
            <span className="utility-list-meta">{formatUtilityMode(utility.mode)}</span>
            <span className="utility-list-description">{utility.description}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

function formatUtilityMode(mode: "read-only"): string {
  return mode === "read-only" ? "Read-only" : mode;
}
