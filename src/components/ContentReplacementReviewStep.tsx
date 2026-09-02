import { Fragment, useEffect, useMemo, useState, type ReactNode } from "react";
import type { ContentReplacementJobController } from "../hooks/useContentReplacementJob";
import { downloadReplacementPreview } from "../utils/contentReplacementDownloads";
import {
  createReplacementSelectionSnapshot,
  replacementItemKey,
} from "../writeTools/contentReplacement/jobState";
import type {
  PersistedContentReplacementItem,
  PersistedContentReplacementJob,
  ReplacementContentKind,
  ReplacementOccurrence,
  ReplacementProposal,
  ReplacementProposalField,
  ReplacementProtectedOccurrenceReason,
} from "../writeTools/contentReplacement/types";

const PAGE_SIZE = 50;

type ContentTypeFilter = "all" | ReplacementContentKind;
type FieldFilter = "all" | ReplacementProposalField;
type StatusFilter = "all" | "included" | "excluded";

interface ReviewFilters {
  contentType: ContentTypeFilter;
  ruleId: string;
  field: FieldFilter;
  status: StatusFilter;
  search: string;
}

const INITIAL_FILTERS: ReviewFilters = {
  contentType: "all",
  ruleId: "all",
  field: "all",
  status: "all",
  search: "",
};

export interface ContentReplacementReviewStepProps {
  controller: ContentReplacementJobController;
}

export function ContentReplacementReviewStep({ controller }: ContentReplacementReviewStepProps) {
  if (!controller.job) return null;
  return <ContentReplacementReviewStepView controller={controller} job={controller.job} />;
}

function ContentReplacementReviewStepView({
  controller,
  job,
}: {
  controller: ContentReplacementJobController;
  job: PersistedContentReplacementJob;
}) {
  const [filters, setFilters] = useState<ReviewFilters>(INITIAL_FILTERS);
  const [page, setPage] = useState(1);
  const [selectionOverrides, setSelectionOverrides] = useState<Record<string, boolean>>({});
  const [pendingSelectionSaves, setPendingSelectionSaves] = useState(0);
  const [selectionSaveError, setSelectionSaveError] = useState<string | null>(null);
  const [expandedKeys, setExpandedKeys] = useState<string[]>([]);

  useEffect(() => {
    setSelectionOverrides({});
  }, [job.updatedAt, controller.storageError, controller.operationError]);

  const entries = useMemo(
    () => Object.entries(job.proposals)
      .map(([key, item]) => ({ key, item, included: selectionOverrides[key] ?? item.included }))
      .sort(compareReviewEntries),
    [job.proposals, selectionOverrides],
  );
  const filtered = useMemo(
    () => entries.filter((entry) => matchesFilters(entry.item, entry.included, filters)),
    [entries, filters],
  );
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const boundedPage = Math.min(page, pageCount);
  const pageEntries = filtered.slice((boundedPage - 1) * PAGE_SIZE, boundedPage * PAGE_SIZE);
  const selected = entries.filter(({ included }) => included);
  const selectedOccurrences = selected.reduce(
    (total, { item }) => total + item.proposal.changedOccurrences.length,
    0,
  );
  const start = filtered.length === 0 ? 0 : (boundedPage - 1) * PAGE_SIZE + 1;
  const end = Math.min(boundedPage * PAGE_SIZE, filtered.length);
  const error = selectionSaveError ?? controller.storageError ?? controller.operationError;
  const selectionBusy = pendingSelectionSaves > 0;

  function updateFilter<K extends keyof ReviewFilters>(key: K, value: ReviewFilters[K]) {
    setFilters((current) => ({ ...current, [key]: value }));
    setPage(1);
  }

  function clearFilters() {
    setFilters(INITIAL_FILTERS);
    setPage(1);
  }

  async function setIncluded(key: string, included: boolean) {
    return persistSelection([key], included, () => controller.setItemIncluded(key, included));
  }

  async function setFilteredIncluded(included: boolean) {
    const itemKeys = filtered.map(({ key }) => key);
    await persistSelection(itemKeys, included, () => controller.setItemsIncluded(itemKeys, included));
  }

  async function persistSelection(
    itemKeys: readonly string[],
    included: boolean,
    save: () => Promise<boolean>,
  ) {
    const updates = Object.fromEntries(itemKeys.map((key) => [key, included]));
    setSelectionOverrides((current) => ({ ...current, ...updates }));
    setSelectionSaveError(null);
    setPendingSelectionSaves((current) => current + 1);
    let saved = false;
    try {
      saved = await save();
    } catch {
      saved = false;
    } finally {
      setPendingSelectionSaves((current) => Math.max(0, current - 1));
    }
    if (!saved) {
      setSelectionOverrides((current) => {
        const next = { ...current };
        itemKeys.forEach((key) => delete next[key]);
        return next;
      });
      setSelectionSaveError("Selection was not saved. Try again.");
    }
    return saved;
  }

  function toggleExpanded(key: string) {
    setExpandedKeys((current) => {
      if (current.includes(key)) return current.filter((entry) => entry !== key);
      return [...current.filter((entry) => entry !== key), key].slice(-3);
    });
  }

  async function continueToApply() {
    if (selected.length === 0 || selectionBusy || selectionSaveError) return;
    const reviewedProposals = Object.fromEntries(
      entries.map(({ key, item, included }) => [key, included === item.included ? item : { ...item, included }]),
    );
    const prepared = await controller.prepareApply(createReplacementSelectionSnapshot(reviewedProposals));
    if (!prepared) {
      setSelectionOverrides({});
      setSelectionSaveError("The confirmed selection changed before Apply preparation. Review it and try again.");
    }
  }

  return (
    <section className="content-replacement-review" aria-labelledby="content-replacement-review-heading">
      <header className="content-replacement-step-header">
        <div>
          <h2 id="content-replacement-review-heading">Review proposed changes</h2>
          <p>Inspect the complete proposed updates, exclude posts when needed, and export a credential-free preview before applying.</p>
        </div>
        <button
          type="button"
          className="s-btn s-btn__outlined"
          disabled={selectionBusy}
          onClick={() => downloadReplacementPreview(entries.map(({ item, included }) => ({ ...item, included })), job.configuration)}
        >
          Download complete preview CSV
        </button>
      </header>

      <PolicySummary controller={controller} />

      {error && (
        <div className="content-replacement-error" role="alert">
          {selectionSaveError ? (
            <strong>{selectionSaveError}</strong>
          ) : (
            <><strong>Review changes were not saved.</strong> {error} Retry the selection or Continue action.</>
          )}
        </div>
      )}

      <div className="content-replacement-review-filters" aria-label="Review filters">
        <label>
          <span>Content type</span>
          <select
            className="s-select"
            disabled={selectionBusy}
            value={filters.contentType}
            onChange={(event) => updateFilter("contentType", event.target.value as ContentTypeFilter)}
          >
            <option value="all">All content types</option>
            <option value="question">Questions</option>
            <option value="answer">Answers</option>
            <option value="article">Articles</option>
          </select>
        </label>
        <label>
          <span>Replacement rule</span>
          <select className="s-select" disabled={selectionBusy} value={filters.ruleId} onChange={(event) => updateFilter("ruleId", event.target.value)}>
            <option value="all">All rules</option>
            {job.configuration.rules.map((rule) => (
              <option key={rule.id} value={rule.id}>{rule.find} → {rule.replace}</option>
            ))}
          </select>
        </label>
        <label>
          <span>Affected field</span>
          <select
            className="s-select"
            disabled={selectionBusy}
            value={filters.field}
            onChange={(event) => updateFilter("field", event.target.value as FieldFilter)}
          >
            <option value="all">All fields</option>
            <option value="title">Title</option>
            <option value="body">Body</option>
          </select>
        </label>
        <label>
          <span>Review status</span>
          <select
            className="s-select"
            disabled={selectionBusy}
            value={filters.status}
            onChange={(event) => updateFilter("status", event.target.value as StatusFilter)}
          >
            <option value="all">Included and excluded</option>
            <option value="included">Included</option>
            <option value="excluded">Excluded</option>
          </select>
        </label>
        <label className="content-replacement-review-search">
          <span>Search title, context, or ID</span>
          <input
            className="s-input"
            type="search"
            disabled={selectionBusy}
            value={filters.search}
            onChange={(event) => updateFilter("search", event.target.value)}
          />
        </label>
        <button type="button" className="s-btn s-btn__outlined" disabled={selectionBusy} onClick={clearFilters}>Clear filters</button>
      </div>

      <div className="content-replacement-review-toolbar">
        <p role="status" aria-label="Review results count" aria-live="polite">
          {filtered.length} matching {plural(filtered.length, "proposal")}
        </p>
        <div className="content-replacement-review-bulk" aria-label="Bulk selection for filtered proposals">
          <span>Scope: all {filtered.length} filtered {plural(filtered.length, "proposal")}</span>
          <button
            type="button"
            className="s-btn s-btn__outlined"
            disabled={selectionBusy || filtered.length === 0}
            onClick={() => void setFilteredIncluded(true)}
          >
            Include {filtered.length} filtered {plural(filtered.length, "proposal")}
          </button>
          <button
            type="button"
            className="s-btn s-btn__outlined"
            disabled={selectionBusy || filtered.length === 0}
            onClick={() => void setFilteredIncluded(false)}
          >
            Exclude {filtered.length} filtered {plural(filtered.length, "proposal")}
          </button>
        </div>
      </div>

      <div
        className="content-replacement-review-table-wrap"
        role="region"
        aria-label="Replacement proposal review table"
        tabIndex={0}
      >
        <table className="s-table content-replacement-review-table">
          <caption>Replacement proposals. Expand a row to inspect complete Markdown and request details.</caption>
          <thead>
            <tr>
              <th scope="col">Include</th>
              <th scope="col">Content</th>
              <th scope="col">Title or context</th>
              <th scope="col">Rules</th>
              <th scope="col">Fields</th>
              <th scope="col">Changed</th>
              <th scope="col">Protected</th>
              <th scope="col">Details</th>
            </tr>
          </thead>
          <tbody>
            {pageEntries.map(({ key, item, included }) => {
              const proposal = item.proposal;
              const identity = proposalIdentity(proposal);
              const detailsId = `replacement-proposal-details-${safeId(key)}`;
              const expanded = expandedKeys.includes(key);
              return (
                <Fragment key={key}>
                  <tr className={included ? "is-included" : "is-excluded"}>
                    <td>
                      <input
                        type="checkbox"
                        checked={included}
                        disabled={selectionBusy}
                        aria-label={`Include ${identity.kind} ${identity.id}`}
                        onChange={(event) => void setIncluded(key, event.target.checked)}
                      />
                      <span className="content-replacement-review-state">{included ? "Included" : "Excluded"}</span>
                    </td>
                    <th scope="row">{capitalize(identity.kind)} {identity.id}</th>
                    <td>{proposalTitle(proposal)}</td>
                    <td>{sorted(proposal.appliedRuleIds).join(", ")}</td>
                    <td>{sorted([...new Set(proposal.changedOccurrences.map(({ field }) => field))]).join(", ")}</td>
                    <td>{proposal.changedOccurrences.length}</td>
                    <td>{proposal.protectedOccurrences.length}</td>
                    <td>
                      <button
                        type="button"
                        className="s-btn s-btn__outlined s-btn__xs"
                        aria-expanded={expanded}
                        aria-controls={detailsId}
                        onClick={() => toggleExpanded(key)}
                      >
                        {expanded ? "Hide" : "View"} details for {identity.kind} {identity.id}
                      </button>
                    </td>
                  </tr>
                  {expanded && (
                    <tr className="content-replacement-review-detail-row">
                      <td colSpan={8}>
                        <ProposalDetails
                          id={detailsId}
                          jobBaseUrl={job.baseUrl}
                          item={item}
                          included={included}
                          disabled={selectionBusy}
                          onSetIncluded={(next) => setIncluded(key, next)}
                        />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
        {filtered.length === 0 && (
          <div className="content-replacement-review-empty" role="status">
            No proposals match the current filters. Clear filters to return to the full review.
          </div>
        )}
      </div>

      <div className="content-replacement-review-pagination" aria-label="Review pagination">
        <span>Showing {start}–{end} of {filtered.length} proposals</span>
        <button
          type="button"
          className="s-btn s-btn__outlined"
          disabled={selectionBusy || boundedPage <= 1}
          onClick={() => setPage((current) => Math.max(1, current - 1))}
        >
          Previous page
        </button>
        <span>Page {boundedPage} of {pageCount}</span>
        <button
          type="button"
          className="s-btn s-btn__outlined"
          disabled={selectionBusy || boundedPage >= pageCount}
          onClick={() => setPage((current) => Math.min(pageCount, current + 1))}
        >
          Next page
        </button>
      </div>

      <footer className="content-replacement-review-summary">
        <p aria-live="polite">
          <strong>{selected.length} {plural(selected.length, "post")} selected</strong>
          {" · "}{selectedOccurrences} changed {plural(selectedOccurrences, "occurrence")}
        </p>
        <button
          type="button"
          className="s-btn s-btn__primary"
          disabled={
            selected.length === 0 || controller.busy || selectionBusy || selectionSaveError !== null ||
            controller.storageError !== null || controller.operationError !== null
          }
          onClick={() => void continueToApply()}
        >
          Continue with {selected.length} {plural(selected.length, "post")} and {selectedOccurrences} changed {plural(selectedOccurrences, "occurrence")}
        </button>
      </footer>
    </section>
  );
}

function PolicySummary({ controller }: { controller: ContentReplacementJobController }) {
  const options = controller.job!.configuration.options;
  return (
    <section className="content-replacement-review-policy" role="region" aria-label="Matching and protection policy">
      <h3>Matching and protection policy</h3>
      <ul>
        <li>{options.caseSensitive ? "Case-sensitive" : "Case-insensitive"}</li>
        <li>{options.wholeTerm ? "Whole-term matching" : "Partial matching"}</li>
        <li>{options.replaceInCode ? "Code included" : "Code excluded"}</li>
        <li>Always protected: link and image destinations, raw HTML attributes and hidden content</li>
      </ul>
    </section>
  );
}

function ProposalDetails({
  id,
  jobBaseUrl,
  item,
  included,
  disabled,
  onSetIncluded,
}: {
  id: string;
  jobBaseUrl: string;
  item: PersistedContentReplacementItem;
  included: boolean;
  disabled: boolean;
  onSetIncluded(included: boolean): Promise<boolean>;
}) {
  const proposal = item.proposal;
  const identity = proposalIdentity(proposal);
  const metadata = proposal.metadata ?? proposal.before.metadata;
  return (
    <section id={id} className="content-replacement-review-detail" role="region" aria-label={`${capitalize(identity.kind)} ${identity.id} proposed changes`}>
      <header>
        <div>
          <h3>{capitalize(identity.kind)} {identity.id} proposed changes</h3>
          <p>{proposal.changedOccurrences.length} changed and {proposal.protectedOccurrences.length} protected {plural(proposal.protectedOccurrences.length, "occurrence")}</p>
        </div>
        <button type="button" className="s-btn s-btn__outlined" disabled={disabled} onClick={() => void onSetIncluded(!included)}>
          {included ? "Exclude" : "Include"} {identity.kind} {identity.id}
        </button>
      </header>

      <dl className="content-replacement-review-metadata">
        <div><dt>Owner</dt><dd>{personLabel(metadata?.owner)}</dd></div>
        <div><dt>Last editor</dt><dd>{personLabel(metadata?.lastEditor)}</dd></div>
        <div><dt>Last activity</dt><dd>{metadata?.lastActivityDate ?? "Not provided"}</dd></div>
        <div><dt>Web URL</dt><dd><SafeWebUrl value={metadata?.webUrl} expectedBaseUrl={jobBaseUrl} /></dd></div>
      </dl>

      {proposal.fields.title && (
        <FieldComparison proposal={proposal} field="title" label="Title" identity={`${identity.kind}-${identity.id}`} />
      )}
      <FieldComparison proposal={proposal} field="body" label="Body Markdown" identity={`${identity.kind}-${identity.id}`} />

      <section className="content-replacement-review-occurrences" aria-labelledby={`${id}-changed-heading`}>
        <h4 id={`${id}-changed-heading`}>Every changed occurrence</h4>
        <ol>
          {proposal.changedOccurrences.map((occurrence, index) => (
            <li key={`${occurrence.field}-${occurrence.start}-${occurrence.end}-${index}`}>
              <strong>{capitalize(occurrence.field)}</strong> · Rule {occurrence.ruleId}: <code>{occurrence.before}</code> → <code>{occurrence.after}</code>
            </li>
          ))}
        </ol>
      </section>

      <section className="content-replacement-review-protected" aria-labelledby={`${id}-protected-heading`}>
        <h4 id={`${id}-protected-heading`}>Protected occurrences</h4>
        {proposal.protectedOccurrences.length === 0 ? (
          <p>None.</p>
        ) : (
          <ul>
            {proposal.protectedOccurrences.map((occurrence, index) => (
              <li key={`${occurrence.field}-${occurrence.start}-${occurrence.end}-${index}`}>
                <strong>{protectedReasonLabel(occurrence.reason)}</strong>
                {" — "}{capitalize(occurrence.field)}, rule {occurrence.ruleId}: <code>{occurrence.before}</code>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="content-replacement-review-request" aria-labelledby={`${id}-request-heading`}>
        <h4 id={`${id}-request-heading`}>Normalized API request after replacement</h4>
        <pre>{JSON.stringify(proposal.after.request, null, 2)}</pre>
      </section>
    </section>
  );
}

function FieldComparison({
  proposal,
  field,
  label,
  identity,
}: {
  proposal: ReplacementProposal;
  field: ReplacementProposalField;
  label: string;
  identity: string;
}) {
  const content = proposal.fields[field];
  if (!content) return null;
  const occurrences = proposal.changedOccurrences.filter((occurrence) => occurrence.field === field);
  return (
    <section className="content-replacement-review-comparison" aria-label={`${label} before and after`}>
      <div>
        <h4>{label} before</h4>
        <pre data-testid={`${identity}-${field}-before`}><HighlightedMarkdown markdown={content.beforeMarkdown} occurrences={occurrences} version="before" /></pre>
      </div>
      <div>
        <h4>{label} after</h4>
        <pre data-testid={`${identity}-${field}-after`}><HighlightedMarkdown markdown={content.afterMarkdown} occurrences={occurrences} version="after" /></pre>
      </div>
    </section>
  );
}

function HighlightedMarkdown({
  markdown,
  occurrences,
  version,
}: {
  markdown: string;
  occurrences: readonly ReplacementOccurrence[];
  version: "before" | "after";
}) {
  const ranges = highlightRanges(markdown, occurrences, version);
  if (!ranges) return <>{markdown}</>;
  const nodes: ReactNode[] = [];
  let cursor = 0;
  ranges.forEach((range, index) => {
    if (range.start > cursor) nodes.push(markdown.slice(cursor, range.start));
    nodes.push(<mark key={`${range.start}-${range.end}-${index}`}>{markdown.slice(range.start, range.end)}</mark>);
    cursor = range.end;
  });
  if (cursor < markdown.length) nodes.push(markdown.slice(cursor));
  return <>{nodes}</>;
}

function highlightRanges(
  markdown: string,
  occurrences: readonly ReplacementOccurrence[],
  version: "before" | "after",
): Array<{ start: number; end: number }> | null {
  const ordered = [...occurrences].sort((left, right) => left.start - right.start || left.end - right.end);
  const ranges: Array<{ start: number; end: number }> = [];
  let previousEnd = -1;
  let shift = 0;
  for (const occurrence of ordered) {
    if (
      !Number.isSafeInteger(occurrence.start) || !Number.isSafeInteger(occurrence.end) ||
      occurrence.start < 0 || occurrence.end <= occurrence.start || occurrence.start < previousEnd
    ) return null;
    const start = version === "before" ? occurrence.start : occurrence.start + shift;
    const end = version === "before" ? occurrence.end : start + occurrence.after.length;
    const expected = version === "before" ? occurrence.before : occurrence.after;
    if (start < 0 || end > markdown.length || markdown.slice(start, end) !== expected) return null;
    ranges.push({ start, end });
    previousEnd = occurrence.end;
    shift += occurrence.after.length - (occurrence.end - occurrence.start);
  }
  return ranges;
}

function SafeWebUrl({ value, expectedBaseUrl }: { value: string | undefined; expectedBaseUrl: string }) {
  if (!value) return <>Not provided</>;
  try {
    const url = new URL(value);
    const expected = new URL(expectedBaseUrl);
    if (url.protocol === "https:" && url.hostname === expected.hostname && url.port === expected.port) {
      return <a href={url.href} target="_blank" rel="noreferrer">{value}</a>;
    }
  } catch {
    // Invalid or unexpected URLs remain inspectable as text.
  }
  return <>{value}</>;
}

function matchesFilters(
  item: PersistedContentReplacementItem,
  included: boolean,
  filters: ReviewFilters,
): boolean {
  const proposal = item.proposal;
  if (filters.contentType !== "all" && proposal.before.kind !== filters.contentType) return false;
  if (filters.ruleId !== "all" && !proposal.appliedRuleIds.includes(filters.ruleId)) return false;
  if (filters.field !== "all" && !proposal.changedOccurrences.some(({ field }) => field === filters.field)) return false;
  if (filters.status === "included" && !included) return false;
  if (filters.status === "excluded" && included) return false;
  const query = filters.search.trim().toLocaleLowerCase("en-US");
  if (!query) return true;
  const identity = proposalIdentity(proposal);
  const searchable = `${proposalTitle(proposal)} ${identity.kind} ${identity.id} ${replacementItemKey(proposal.before.ref)}`
    .toLocaleLowerCase("en-US");
  return searchable.includes(query);
}

function compareReviewEntries(
  left: { item: PersistedContentReplacementItem },
  right: { item: PersistedContentReplacementItem },
): number {
  const leftIdentity = proposalIdentity(left.item.proposal);
  const rightIdentity = proposalIdentity(right.item.proposal);
  return leftIdentity.id - rightIdentity.id || kindRank(leftIdentity.kind) - kindRank(rightIdentity.kind) ||
    questionContext(left.item.proposal) - questionContext(right.item.proposal);
}

function proposalIdentity(proposal: ReplacementProposal): { kind: ReplacementContentKind; id: number } {
  const ref = proposal.before.ref;
  return {
    kind: ref.kind,
    id: ref.kind === "question" ? ref.questionId : ref.kind === "answer" ? ref.answerId : ref.articleId,
  };
}

function questionContext(proposal: ReplacementProposal): number {
  const ref = proposal.before.ref;
  return ref.kind === "article" ? -1 : ref.questionId;
}

function kindRank(kind: ReplacementContentKind): number {
  return kind === "question" ? 0 : kind === "answer" ? 1 : 2;
}

function proposalTitle(proposal: ReplacementProposal): string {
  return proposal.metadata?.titleContext ?? proposal.before.metadata?.titleContext ??
    (proposal.before.kind === "answer" ? `Question ${proposal.before.ref.questionId}` : proposal.before.request.title);
}

function personLabel(person: { id: number; name?: string } | undefined): string {
  if (!person) return "Not provided";
  return person.name ? `${person.name} (#${person.id})` : `#${person.id}`;
}

function protectedReasonLabel(reason: ReplacementProtectedOccurrenceReason): string {
  switch (reason) {
    case "code": return "Code — unchanged";
    case "destination": return "Link destination — unchanged";
    case "raw-html-attribute": return "Raw HTML attribute — unchanged";
    case "raw-html-syntax": return "Raw HTML syntax — unchanged";
    case "raw-html-hidden": return "Raw HTML hidden content — unchanged";
  }
}

function sorted(values: readonly string[]): string[] {
  return [...values].sort((left, right) => left < right ? -1 : left > right ? 1 : 0);
}

function safeId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "-");
}

function capitalize(value: string): string {
  return `${value[0].toUpperCase()}${value.slice(1)}`;
}

function plural(count: number, singular: string): string {
  return count === 1 ? singular : `${singular}s`;
}
