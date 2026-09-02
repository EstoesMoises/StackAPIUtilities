import { useEffect, useId, useRef, useState } from "react";
import {
  deleteContentReplacementJob,
  listContentReplacementJobs,
  type ContentReplacementJobSummary,
  type ContentReplacementJobSummaryPage,
} from "../utils/browserContentReplacementStorage";

const JOBS_PER_PAGE = 25;

export interface ContentReplacementJobManagerStorage {
  list(options: { offset: number; limit: number }): Promise<ContentReplacementJobSummaryPage>;
  delete(id: string): Promise<void>;
}

export interface ContentReplacementJobManagerProps {
  onOpenJob(jobId: string): void;
  onDeleteJob?(jobId: string): void;
  storage?: ContentReplacementJobManagerStorage;
}

const defaultStorage: ContentReplacementJobManagerStorage = {
  list: listContentReplacementJobs,
  delete: deleteContentReplacementJob,
};

export function ContentReplacementJobManager({
  onOpenJob,
  onDeleteJob,
  storage = defaultStorage,
}: ContentReplacementJobManagerProps) {
  const headingId = useId();
  const requestId = useRef(0);
  const [jobs, setJobs] = useState<ContentReplacementJobSummary[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [operationError, setOperationError] = useState(false);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [page, setPage] = useState(1);

  useEffect(() => {
    const currentRequest = requestId.current + 1;
    requestId.current = currentRequest;
    setLoading(true);
    setLoadError(false);
    void storage.list({ offset: (page - 1) * JOBS_PER_PAGE, limit: JOBS_PER_PAGE }).then((result) => {
      if (requestId.current !== currentRequest) return;
      const nextPageCount = Math.max(1, Math.ceil(result.totalCount / JOBS_PER_PAGE));
      if (page > nextPageCount) {
        setPage(nextPageCount);
        return;
      }
      setJobs(result.jobs);
      setTotalCount(result.totalCount);
    }).catch(() => {
      if (requestId.current !== currentRequest) return;
      setJobs([]);
      setLoadError(true);
    }).finally(() => {
      if (requestId.current === currentRequest) setLoading(false);
    });
    return () => {
      if (requestId.current === currentRequest) requestId.current += 1;
    };
  }, [page, storage]);

  const pageCount = Math.max(1, Math.ceil(totalCount / JOBS_PER_PAGE));
  const boundedPage = Math.min(page, pageCount);

  async function confirmDelete(jobId: string) {
    if (deletingId !== null || pendingDeleteId !== jobId || !jobs.some((job) => job.id === jobId)) return;
    setDeletingId(jobId);
    setOperationError(false);
    setAnnouncement("");
    try {
      await storage.delete(jobId);
      setJobs((current) => current.filter((job) => job.id !== jobId));
      const nextTotalCount = Math.max(0, totalCount - 1);
      const nextPageCount = Math.max(1, Math.ceil(nextTotalCount / JOBS_PER_PAGE));
      setTotalCount(nextTotalCount);
      if (page > nextPageCount) setPage(nextPageCount);
      setPendingDeleteId(null);
      onDeleteJob?.(jobId);
      setAnnouncement(`Content replacement job ${jobId}, its post content, and recovery snapshots were deleted from this browser.`);
    } catch {
      setOperationError(true);
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <section className="content-replacement-job-manager" aria-labelledby={headingId}>
      <div className="content-replacement-job-manager-heading">
        <div>
          <h3 id={headingId}>Browser-local replacement jobs</h3>
          <p>
            Sensitive local data: saved jobs can contain post bodies and complete request models.
            Credentials are never stored with them.
          </p>
        </div>
        {!loading && !loadError && (
          <span className="content-replacement-job-count">
            {totalCount.toLocaleString()} browser-local {totalCount === 1 ? "job" : "jobs"}
          </span>
        )}
      </div>

      {loading && <p role="status">Loading browser-local replacement jobs…</p>}
      {loadError && (
        <div className="s-notice s-notice__warning" role="alert">
          Browser-local replacement jobs could not be loaded. Current replacement work can still be defined.
        </div>
      )}
      {operationError && (
        <div className="s-notice s-notice__danger" role="alert">
          The browser-local replacement job could not be deleted. Try again.
        </div>
      )}
      {!loading && !loadError && totalCount === 0 && (
        <p className="content-replacement-job-empty">No replacement jobs are stored in this browser.</p>
      )}
      {jobs.length > 0 && (
        <ul className="content-replacement-job-list">
          {jobs.map((job) => {
            const confirming = pendingDeleteId === job.id;
            const deleting = deletingId === job.id;
            return (
              <li key={job.id}>
                <div className="content-replacement-job-summary">
                  <div>
                    <strong>{stageLabel(job)}</strong>
                    <span>{job.mappingCount.toLocaleString()} {job.mappingCount === 1 ? "mapping" : "mappings"} · {job.proposedPostCount.toLocaleString()} proposed {job.proposedPostCount === 1 ? "post" : "posts"}</span>
                  </div>
                  <dl>
                    <div><dt>Job</dt><dd>{job.id}</dd></div>
                    <div><dt>Instance</dt><dd>{hostLabel(job.baseUrl)}</dd></div>
                    <div><dt>Updated</dt><dd><time dateTime={job.updatedAt}>{formatTimestamp(job.updatedAt)}</time></dd></div>
                  </dl>
                </div>
                <div className="content-replacement-job-actions">
                  <button
                    className="s-btn s-btn__outlined"
                    type="button"
                    disabled={deletingId !== null}
                    aria-label={`Resume content replacement job ${job.id}`}
                    onClick={() => onOpenJob(job.id)}
                  >
                    Open job
                  </button>
                  <button
                    className="s-btn s-btn__outlined content-replacement-delete-action"
                    type="button"
                    disabled={deletingId !== null}
                    aria-label={`Delete content replacement job ${job.id}`}
                    onClick={() => setPendingDeleteId(job.id)}
                  >
                    Delete local job
                  </button>
                </div>
                {confirming && (
                  <div className="content-replacement-job-delete-confirmation" role="group" aria-label={`Confirm deletion of content replacement job ${job.id}`}>
                    <p>Delete job {job.id}, including its post content and recovery snapshots? This cannot be undone.</p>
                    <div className="write-tool-actions">
                      <button className="s-btn s-btn__outlined" type="button" disabled={deleting} onClick={() => setPendingDeleteId(null)}>Keep local job</button>
                      <button className="s-btn s-btn__outlined content-replacement-delete-action" type="button" disabled={deleting} onClick={() => void confirmDelete(job.id)}>
                        {deleting ? "Deleting…" : `Confirm delete ${job.id}`}
                      </button>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {pageCount > 1 && (
        <nav className="content-replacement-job-pagination" aria-label="Replacement job pagination">
          <button className="s-btn s-btn__outlined" type="button" aria-label="Previous jobs page" disabled={boundedPage === 1} onClick={() => setPage(boundedPage - 1)}>Previous</button>
          <span>Page {boundedPage} of {pageCount}</span>
          <button className="s-btn s-btn__outlined" type="button" aria-label="Next jobs page" disabled={boundedPage === pageCount} onClick={() => setPage(boundedPage + 1)}>Next</button>
        </nav>
      )}
      {announcement && <p className="content-replacement-job-announcement" role="status" aria-live="polite">{announcement}</p>}
    </section>
  );
}

function stageLabel(job: ContentReplacementJobSummary): string {
  if (job.stage === "define") return "Definition saved";
  if (job.stage === "scan") {
    if (job.status === "completed") return "Scan complete";
    if (job.status === "failed") return "Scan needs attention";
    if (job.status === "cancelled") return "Scan cancelled";
    if (job.status === "running") return "Scan interrupted";
    return "Scan paused";
  }
  if (job.stage === "review") return "Review complete";
  if (job.stage === "apply") return job.status === "running" ? "Apply interrupted" : "Ready to apply";
  if (job.stage === "results") return "Apply results";
  return job.status === "running" ? "Recovery interrupted" : "Recovery results";
}

function hostLabel(value: string): string {
  try {
    return new URL(value).host;
  } catch {
    return "Enterprise instance";
  }
}

function formatTimestamp(value: string): string {
  return new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}
