import { useCallback, useEffect, useRef, useState } from "react";
import type { FetchLike } from "../api/httpClient";
import type { LiveReportRunResult } from "../collectors/liveReportRunner";
import type { ReportId, SessionCredentials } from "../domain/types";
import { createReportJob, runReportJob } from "../reports/resumable/reportJobRunner";
import { reportJobStore } from "../reports/resumable/reportJobStore";
import type { ReportJob, ReportJobProgress, ReportJobStore } from "../reports/resumable/types";

export interface ReportJobDependencies {
  store?: ReportJobStore;
  fetchFn?: FetchLike;
  runExclusive?: <T>(operation: () => Promise<T>) => Promise<T>;
}

export interface ReportJobController {
  progress: ReportJobProgress | null;
  ready: boolean;
  busy: boolean;
  error: string | null;
  start(reportId: ReportId, periods: ReportJob["periods"]): Promise<void>;
  resume(): Promise<void>;
  pause(): void;
  discard(): Promise<void>;
}

export function useReportJob(
  credentials: SessionCredentials | null,
  onComplete: (results: LiveReportRunResult[], job: ReportJob) => void | Promise<void>,
  dependencies: ReportJobDependencies = {},
): ReportJobController {
  const store = dependencies.store ?? reportJobStore;
  const [progress, setProgress] = useState<ReportJobProgress | null>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(false);
  const lifecycle = useRef(0);
  const jobRef = useRef<ReportJob | null>(null);
  const busyRef = useRef(false);
  const discardingRef = useRef(false);
  const hydration = useRef<Promise<void>>(Promise.resolve());
  const active = useRef<{ controller: AbortController; promise: Promise<void> } | null>(null);
  const credentialsRef = useRef(credentials);
  const callbackRef = useRef(onComplete);
  const configuration = useRef({ store, fetchFn: dependencies.fetchFn, runExclusive: dependencies.runExclusive ?? withReportLock });
  credentialsRef.current = credentials;
  callbackRef.current = onComplete;
  configuration.current = { store, fetchFn: dependencies.fetchFn, runExclusive: dependencies.runExclusive ?? withReportLock };

  const isCurrent = useCallback((generation: number) => mounted.current && lifecycle.current === generation, []);
  const updateProgress = useCallback((next: ReportJobProgress | null, generation: number) => {
    if (!isCurrent(generation)) return;
    jobRef.current = next?.job ?? null;
    setProgress(next);
  }, [isCurrent]);
  const pause = useCallback(() => { active.current?.controller.abort(); }, []);

  useEffect(() => {
    mounted.current = true;
    const generation = ++lifecycle.current;
    setReady(false);
    setError(null);
    updateProgress(null, generation);
    const exclusive = configuration.current.runExclusive;
    hydration.current = (async () => {
      try {
        let job = await store.load();
        if (!isCurrent(generation)) return;
        if (job?.status === "running") {
          // A running tab owns this lock. Only an abandoned run may be normalized to paused.
          updateProgress(toProgress(job), generation);
          job = await exclusive(async () => {
            const latest = await store.load();
            if (!isCurrent(generation)) return latest;
            return latest?.status === "running"
              ? store.save({ ...latest, status: "paused", error: null, updatedAt: new Date().toISOString() })
              : latest;
          });
        }
        updateProgress(job ? toProgress(job) : null, generation);
        if (isCurrent(generation) && job?.error) setError(job.error);
      } catch (failure) {
        if (isCurrent(generation)) setError(errorMessage(failure));
      } finally {
        if (isCurrent(generation)) setReady(true);
      }
    })();
    window.addEventListener("pagehide", pause);
    window.addEventListener("offline", pause);
    return () => {
      mounted.current = false;
      pause();
      window.removeEventListener("pagehide", pause);
      window.removeEventListener("offline", pause);
    };
  }, [store, isCurrent, pause, updateProgress]);

  const begin = useCallback((selection?: { reportId: ReportId; periods: ReportJob["periods"] }): Promise<void> => {
    if (!mounted.current || busyRef.current) return Promise.resolve();
    busyRef.current = true;
    setBusy(true);
    setError(null);
    const generation = lifecycle.current;
    const controller = new AbortController();
    const { signal } = controller;
    const options = configuration.current;
    const assertActive = () => {
      signal.throwIfAborted();
      if (!isCurrent(generation)) throw new DOMException("Report paused", "AbortError");
    };
    const promise = (async () => {
      try {
        // Starting before hydration finishes must not overwrite an unseen saved report.
        await hydration.current;
        assertActive();
        const connection = credentialsRef.current;
        if (!connection) throw Error("Connect your instance before running or resuming a report.");
        await options.runExclusive(async () => {
          assertActive();
          let job = await options.store.load();
          assertActive();
          if (selection) {
            if (job && job.status !== "complete") throw Error("Resume or discard the unfinished saved report before starting another.");
            const created = await createReportJob(selection.reportId, connection, selection.periods);
            assertActive();
            job = await options.store.create(created);
          } else {
            if (!job) throw Error("There is no saved report to resume.");
            if (jobRef.current && job.id !== jobRef.current.id) throw Error("The saved report changed in another tab. Reload before continuing.");
          }
          updateProgress(toProgress(job), generation);
          assertActive();
          const completed = await runReportJob(job, connection, {
            store: options.store, fetchFn: options.fetchFn, signal,
            onProgress: (next) => updateProgress(next, generation),
          });
          assertActive();
          try {
            await callbackRef.current(completed.results, completed.job);
          } catch (failure) {
            // A complete collection can be replayed if the final output validation fails.
            const failed = await options.store.save({ ...completed.job, status: "failed", error: errorMessage(failure) });
            updateProgress(toProgress(failed), generation);
            throw failure;
          }
        });
      } catch (failure) {
        if (isCurrent(generation) && !signal.aborted) setError(errorMessage(failure));
      } finally {
        const ownsActiveRun = active.current?.controller === controller;
        if (ownsActiveRun) active.current = null;
        if (ownsActiveRun && !discardingRef.current) {
          busyRef.current = false;
          if (mounted.current) setBusy(false);
        }
      }
    })();
    active.current = { controller, promise };
    return promise;
  }, [isCurrent, updateProgress]);

  const start = useCallback((reportId: ReportId, periods: ReportJob["periods"]) => begin({
    reportId, periods: periods.map((period) => ({ periodRole: period.periodRole, scope: { ...period.scope } })),
  }), [begin]);
  const resume = useCallback(() => begin(), [begin]);

  const discard = useCallback(async () => {
    if (!mounted.current || discardingRef.current) return;
    discardingRef.current = true;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    const generation = lifecycle.current;
    const options = configuration.current;
    const expectedId = jobRef.current?.id;
    const running = active.current;
    running?.controller.abort();
    try {
      await running?.promise;
      await hydration.current;
      if (!isCurrent(generation)) return;
      const id = expectedId ?? jobRef.current?.id;
      if (!id) return;
      await options.runExclusive(async () => {
        const latest = await options.store.load();
        if (!isCurrent(generation)) return;
        if (latest && latest.id !== id) throw Error("The saved report changed in another tab. Reload before discarding it.");
        await options.store.delete(id);
        updateProgress(null, generation);
      });
    } catch (failure) {
      if (isCurrent(generation)) setError(errorMessage(failure));
    } finally {
      discardingRef.current = false;
      busyRef.current = false;
      if (isCurrent(generation)) setBusy(false);
    }
  }, [isCurrent, updateProgress]);

  return { progress, ready, busy, error, start, resume, pause, discard };
}

async function withReportLock<T>(operation: () => Promise<T>): Promise<T> {
  if (typeof navigator === "undefined" || !navigator.locks?.request) {
    throw Error("This browser does not support Web Locks required to safely resume reports. Use a supported browser.");
  }
  return navigator.locks.request("stack-report-job", { ifAvailable: true }, async (lock) => {
    if (!lock) throw Error("This report is active in another tab. Pause it there before continuing here.");
    return operation();
  });
}
function toProgress(job: ReportJob): ReportJobProgress {
  return { job, estimate: null, restoring: job.completedRequests > 0 && job.status !== "complete" };
}
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "The report operation failed. Saved progress is available to retry.";
}
