import type { SessionState } from "../domain/types";

interface SessionOverviewProps {
  state: SessionState;
}

export function SessionOverview({ state }: SessionOverviewProps) {
  const datasets = Object.values(state.datasets).filter((dataset) => dataset !== undefined);

  if (datasets.length === 0) {
    return null;
  }

  return (
    <section className="session-overview" aria-labelledby="session-overview-heading">
      <h2 className="fs-title mb12" id="session-overview-heading">
        Session Data
      </h2>
      <div className="session-overview-grid">
        {datasets.map((dataset) => (
          <article className="dataset-card" key={dataset.name}>
            <h3 className="fs-body2 mb4">{dataset.name}</h3>
            <p className="fs-caption fc-light m0">{dataset.records.length} records</p>
          </article>
        ))}
      </div>
    </section>
  );
}
