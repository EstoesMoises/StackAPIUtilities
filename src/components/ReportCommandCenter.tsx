import { useEffect, useId, useRef, useState } from "react";
import type { Key, KeyboardEvent, ReactNode } from "react";
import type { ReportSectionId } from "../reports/reportPresentation";

export interface ReportCommandCenterSection<SectionId extends ReportSectionId = ReportSectionId> {
  id: SectionId;
  label: string;
  content: ReactNode;
}

export type ReportCommandCenterSections<SectionId extends ReportSectionId = ReportSectionId> =
  readonly [
    ReportCommandCenterSection<SectionId>,
    ...ReportCommandCenterSection<SectionId>[],
  ];

export function requireReportCommandCenterSections<SectionId extends ReportSectionId>(
  sections: readonly ReportCommandCenterSection<SectionId>[],
): ReportCommandCenterSections<SectionId> {
  if (sections.length === 0) {
    throw new Error("ReportCommandCenter requires at least one section.");
  }

  return sections as ReportCommandCenterSections<SectionId>;
}

export interface ReportCommandCenterProps<SectionId extends ReportSectionId = ReportSectionId> {
  reportKey: Key;
  header: ReactNode;
  sections: ReportCommandCenterSections<SectionId>;
}

export function ReportCommandCenter<SectionId extends ReportSectionId>({
  reportKey,
  header,
  sections,
}: ReportCommandCenterProps<SectionId>) {
  return (
    <section className="report-command-center" aria-label="Generated report">
      <header className="report-command-center-header">{header}</header>
      <ReportCommandCenterTabs key={reportKey} sections={sections} />
    </section>
  );
}

function ReportCommandCenterTabs<SectionId extends ReportSectionId>({
  sections,
}: Pick<ReportCommandCenterProps<SectionId>, "sections">) {
  const baseId = useId();
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const firstSection = sections[0];
  const [activeId, setActiveId] = useState<SectionId>(firstSection.id);
  const [visitedIds, setVisitedIds] = useState<ReadonlySet<SectionId>>(
    () => new Set([firstSection.id]),
  );
  const selectedId = sections.some((section) => section.id === activeId)
    ? activeId
    : firstSection.id;

  useEffect(() => {
    if (!sections.some((section) => section.id === activeId)) {
      setActiveId(firstSection.id);
    }
  }, [activeId, firstSection.id, sections]);

  function selectAdjacentTab(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;

    event.preventDefault();
    const offset = event.key === "ArrowRight" ? 1 : -1;
    const nextIndex = (index + offset + sections.length) % sections.length;
    selectSection(sections[nextIndex].id);
    tabRefs.current[nextIndex]?.focus();
  }

  function selectSection(id: SectionId) {
    setVisitedIds((current) => {
      if (current.has(id)) return current;
      return new Set([...current, id]);
    });
    setActiveId(id);
  }

  return (
    <>
      <div
        className="s-navigation s-navigation__muted report-command-center-tabs"
        role="tablist"
        aria-label="Report sections"
      >
        {sections.map((section, index) => {
          const selected = section.id === selectedId;
          const tabId = `${baseId}-tab-${index}`;
          const panelId = `${baseId}-panel-${index}`;

          return (
            <button
              className="s-navigation--item report-command-center-tab"
              id={tabId}
              key={section.id}
              ref={(node) => {
                tabRefs.current[index] = node;
              }}
              type="button"
              role="tab"
              aria-controls={panelId}
              aria-selected={selected}
              tabIndex={selected ? 0 : -1}
              onClick={() => selectSection(section.id)}
              onKeyDown={(event) => selectAdjacentTab(event, index)}
            >
              {section.label}
            </button>
          );
        })}
      </div>
      {sections.map((section, index) => {
        const selected = section.id === selectedId;
        if (!selected && !visitedIds.has(section.id)) return null;

        return (
          <div
            className="report-command-center-panel"
            id={`${baseId}-panel-${index}`}
            key={section.id}
            role="tabpanel"
            aria-labelledby={`${baseId}-tab-${index}`}
            hidden={!selected}
            tabIndex={selected ? 0 : -1}
          >
            {section.content}
          </div>
        );
      })}
    </>
  );
}
