import { useCallback, useEffect, useRef, useState } from "react";
import type { ThrottleNotice } from "../api/httpClient";
import { MAX_STACK_API_V3_BACKOFF_NOTICE_SECONDS } from "../api/stackApiV3";
import type { SessionCredentials } from "../domain/types";
import {
  normalizeCurrentRequestModel,
  validateExactPriorRequestModel,
} from "../server/contentReplacementRequestValidation";
import {
  deleteContentReplacementJob,
  loadContentReplacementJob,
  saveContentReplacementJob,
} from "../utils/browserContentReplacementStorage";
import {
  createJobFingerprint,
  stableSerialize,
  toReplacementWireRequestModel,
} from "../writeTools/contentReplacement/proposals";
import {
  createReplacementJob,
  getNextApplyItem,
  getNextDetailBatch,
  getNextInventoryCursor,
  reduceReplacementJob,
  replacementItemKey,
} from "../writeTools/contentReplacement/jobState";
import type {
  DetailBatchResult,
  InventoryCursor,
  InventorySliceResult,
  PersistedContentReplacementFailure,
  PersistedContentReplacementItem,
  PersistedContentReplacementJob,
  ReplacementConfiguration,
  ReplacementItemRef,
  ReplacementProposal,
  ReplacementWireRequestModel,
} from "../writeTools/contentReplacement/types";

const SCAN_URL = "/api/write-tools/content-replacement/scan";
const APPLY_URL = "/api/write-tools/content-replacement/apply";
const RECOVERY_URL = "/api/write-tools/content-replacement/recover";
const STORAGE_ERROR = "Content replacement progress could not be saved.";
const STALE_SNAPSHOT_ERROR = "Stored recovery preparation is missing or stale.";
const INVALID_RESPONSE_MESSAGE = "The content replacement service returned an invalid response.";
const NETWORK_FAILURE_MESSAGE = "The content replacement request could not be completed.";
const BEFORE_UNLOAD_MESSAGE =
  "A content replacement request is active. Leaving now will pause the browser-coordinated job.";

export interface ContentReplacementJobStorageOperations {
  save(job: PersistedContentReplacementJob): Promise<void>;
  load(id: string): Promise<PersistedContentReplacementJob | null>;
  delete(id: string): Promise<void>;
}

export interface ContentReplacementJobDependencies {
  fetch: typeof fetch;
  storage: ContentReplacementJobStorageOperations;
  now: () => string;
  createId: () => string;
  waitUntil: (timestamp: string, signal: AbortSignal) => Promise<void>;
}

export interface ContentReplacementJobController {
  job: PersistedContentReplacementJob | null;
  busy: boolean;
  storageError: string | null;
  createJob(configuration: ReplacementConfiguration): Promise<void>;
  startScan(): Promise<void>;
  pause(): void;
  resume(): Promise<void>;
  cancel(): Promise<void>;
  deleteJob(): Promise<void>;
  deleteRecoverySnapshots(): Promise<void>;
  setItemIncluded(itemKey: string, included: boolean): Promise<void>;
  prepareApply(): Promise<void>;
  startApply(): Promise<void>;
  retryEligibleFailures(): Promise<void>;
  rescanStaleItems(itemKeys: string[]): Promise<void>;
  prepareRecovery(itemKeys: string[]): Promise<void>;
  startRecovery(itemKeys: string[]): Promise<void>;
}

const defaultStorage: ContentReplacementJobStorageOperations = {
  save: saveContentReplacementJob,
  load: loadContentReplacementJob,
  delete: deleteContentReplacementJob,
};

const defaultDependencies: ContentReplacementJobDependencies = {
  fetch: (...args) => globalThis.fetch(...args),
  storage: defaultStorage,
  now: () => new Date().toISOString(),
  createId: () => globalThis.crypto.randomUUID(),
  waitUntil: defaultWaitUntil,
};

export function useContentReplacementJob(
  credentials: SessionCredentials | null,
  initialJob: PersistedContentReplacementJob | null = null,
  dependencies: ContentReplacementJobDependencies = defaultDependencies,
): ContentReplacementJobController {
  const [job, setJobState] = useState<PersistedContentReplacementJob | null>(initialJob);
  const [busy, setBusyState] = useState(false);
  const [storageError, setStorageError] = useState<string | null>(null);
  const jobRef = useRef(initialJob);
  const credentialsRef = useRef(credentials);
  const dependenciesRef = useRef(dependencies);
  const mountedRef = useRef(true);
  const operationRef = useRef(0);
  const runningRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const pauseBarrierRef = useRef<Promise<boolean>>(Promise.resolve(true));
  const initialJobIdRef = useRef(initialJob?.id);

  credentialsRef.current = credentials;
  dependenciesRef.current = dependencies;

  const setJob = useCallback((next: PersistedContentReplacementJob | null) => {
    jobRef.current = next;
    if (mountedRef.current) setJobState(next);
  }, []);

  const setBusy = useCallback((next: boolean) => {
    if (mountedRef.current) setBusyState(next);
  }, []);

  const stopOperation = useCallback(() => {
    operationRef.current += 1;
    runningRef.current = false;
    abortRef.current?.abort();
    abortRef.current = null;
    setBusy(false);
  }, [setBusy]);

  useEffect(() => {
    mountedRef.current = true;
    const nextId = initialJob?.id;
    if (initialJobIdRef.current !== nextId) {
      stopOperation();
      initialJobIdRef.current = nextId;
      setJob(initialJob);
      setStorageError(null);
    }
    return () => {
      mountedRef.current = false;
      stopOperation();
    };
  }, [initialJob, setJob, stopOperation]);

  const beforeUnload = useCallback((event: BeforeUnloadEvent) => {
    event.preventDefault();
    event.returnValue = BEFORE_UNLOAD_MESSAGE;
    return BEFORE_UNLOAD_MESSAGE;
  }, []);

  useEffect(() => {
    if (!busy) return;
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [beforeUnload, busy]);

  const persist = useCallback(async (
    candidate: PersistedContentReplacementJob,
    token?: number,
  ): Promise<boolean> => {
    try {
      await dependenciesRef.current.storage.save(candidate);
    } catch {
      if (mountedRef.current) setStorageError(STORAGE_ERROR);
      stopOperation();
      return false;
    }
    if (token !== undefined && token !== operationRef.current) return false;
    setStorageError(null);
    setJob(candidate);
    return true;
  }, [setJob, stopOperation]);

  const runExclusive = useCallback(async (
    operation: (token: number) => Promise<void>,
  ): Promise<void> => {
    if (runningRef.current) return;
    runningRef.current = true;
    if (!await pauseBarrierRef.current) {
      runningRef.current = false;
      return;
    }
    const token = operationRef.current + 1;
    operationRef.current = token;
    try {
      await operation(token);
    } finally {
      if (operationRef.current === token) {
        runningRef.current = false;
        abortRef.current = null;
        setBusy(false);
      }
    }
  }, [setBusy]);

  const request = useCallback(async (
    url: string,
    payload: Record<string, unknown>,
    token: number,
  ): Promise<{ response: Response } | { aborted: true } | { failed: true }> => {
    const controller = new AbortController();
    abortRef.current = controller;
    setBusy(true);
    try {
      const response = await dependenciesRef.current.fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      if (token !== operationRef.current) return { aborted: true };
      return { response };
    } catch {
      if (controller.signal.aborted || token !== operationRef.current) return { aborted: true };
      return { failed: true };
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      if (token === operationRef.current) setBusy(false);
    }
  }, [setBusy]);

  const persistResponse = useCallback(async (
    candidate: PersistedContentReplacementJob,
    notices: readonly ThrottleNotice[],
    at: string,
    token: number,
  ): Promise<boolean> => {
    const seconds = notices.reduce((maximum, notice) => Math.max(maximum, notice.seconds), 0);
    const withThrottle = seconds > 0
      ? reduceReplacementJob(candidate, {
          type: "run/set-retry-at",
          nextRetryAt: addSeconds(at, seconds),
          at,
        })
      : candidate;
    if (!await persist(withThrottle, token)) return false;
    if (seconds === 0) return true;

    const controller = new AbortController();
    abortRef.current = controller;
    setBusy(true);
    try {
      await dependenciesRef.current.waitUntil(withThrottle.nextRetryAt!, controller.signal);
      if (token !== operationRef.current) return false;
    } catch {
      return false;
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      if (token === operationRef.current) setBusy(false);
    }
    return persist(reduceReplacementJob(withThrottle, { type: "run/clear-retry-at", at }), token);
  }, [persist, setBusy]);

  const createJob = useCallback(async (configuration: ReplacementConfiguration): Promise<void> => {
    const supplied = credentialsRef.current;
    if (!supplied) return;
    const baseUrl = normalizeOrigin(supplied.baseUrl);
    const fingerprint = await createJobFingerprint({ baseUrl, configuration });
    const createdAt = dependenciesRef.current.now();
    const candidate = createReplacementJob({
      id: dependenciesRef.current.createId(),
      fingerprint,
      baseUrl,
      configuration,
      createdAt,
    });
    stopOperation();
    await persist(candidate);
  }, [persist, stopOperation]);

  const scanLoop = useCallback(async (token: number): Promise<void> => {
    let current = jobRef.current;
    if (!current || current.stage !== "scan") return;
    if (current.status !== "running") {
      const resumed = reduceReplacementJob(current, {
        type: "run/resume",
        at: dependenciesRef.current.now(),
      });
      if (resumed === current || !await persist(resumed, token)) return;
      current = resumed;
    }
    while (token === operationRef.current) {
      const cursor = getNextInventoryCursor(current);
      const refs = cursor ? [] : getNextDetailBatch(current);
      if (!cursor && refs.length === 0) {
        const complete = reduceReplacementJob(current, {
          type: "scan/queues-drained",
          at: dependenciesRef.current.now(),
        });
        if (complete !== current) await persist(complete, token);
        return;
      }
      const supplied = credentialsRef.current;
      if (!supplied) {
        await persist(scanFailure(current, "authorization", false, "Reconnect Enterprise credentials.", dependenciesRef.current.now()), token);
        return;
      }
      const payload = cursor
        ? {
            action: "inventory",
            credentials: credentialsForJob(supplied, current),
            configuration: current.configuration,
            jobFingerprint: current.fingerprint,
            cursor,
          }
        : {
            action: "details",
            credentials: credentialsForJob(supplied, current),
            configuration: current.configuration,
            jobFingerprint: current.fingerprint,
            refs,
          };
      const fetched = await request(SCAN_URL, payload, token);
      if ("aborted" in fetched) return;
      if ("failed" in fetched) {
        await persist(scanFailure(current, "network", true, NETWORK_FAILURE_MESSAGE, dependenciesRef.current.now()), token);
        return;
      }
      const parsed = await parseScanResponse(fetched.response, cursor ? "inventory" : "details");
      const at = dependenciesRef.current.now();
      if (!parsed.ok) {
        await persist(scanFailure(
          current,
          failureCategoryForStatus(fetched.response.status),
          fetched.response.status >= 500 || fetched.response.status === 429,
          parsed.message,
          at,
        ), token);
        return;
      }
      const reduced = cursor
        ? reduceReplacementJob(current, {
            type: "scan/inventory-succeeded",
            cursor,
            result: parsed.result as InventorySliceResult,
            at,
          })
        : reduceReplacementJob(current, {
            type: "scan/details-succeeded",
            refs,
            result: parsed.result as DetailBatchResult,
            at,
          });
      if (!await persistResponse(reduced, parsed.throttleNotices, at, token)) return;
      current = jobRef.current!;
    }
  }, [persist, persistResponse, request]);

  const startScan = useCallback(() => runExclusive(scanLoop), [runExclusive, scanLoop]);

  const pause = useCallback((): void => {
    const current = jobRef.current;
    stopOperation();
    if (!current || current.status !== "running") return;
    const paused = reduceReplacementJob(current, { type: "run/pause", at: dependenciesRef.current.now() });
    pauseBarrierRef.current = persist(paused, operationRef.current);
  }, [persist, stopOperation]);

  const resume = useCallback(async (): Promise<void> => {
    const current = jobRef.current;
    if (!current) return;
    if (current.stage === "scan") await startScan();
  }, [startScan]);

  const cancel = useCallback(async (): Promise<void> => {
    const current = jobRef.current;
    if (!current) return;
    stopOperation();
    await persist(reduceReplacementJob(current, {
      type: "run/cancel",
      at: dependenciesRef.current.now(),
    }));
  }, [persist, stopOperation]);

  const deleteJob = useCallback(async (): Promise<void> => {
    const current = jobRef.current;
    if (!current) return;
    stopOperation();
    try {
      await dependenciesRef.current.storage.delete(current.id);
      setStorageError(null);
      setJob(null);
    } catch {
      if (mountedRef.current) setStorageError(STORAGE_ERROR);
    }
  }, [setJob, stopOperation]);

  const setItemIncluded = useCallback(async (itemKey: string, included: boolean): Promise<void> => {
    const current = jobRef.current;
    if (!current) return;
    const next = reduceReplacementJob(current, {
      type: "review/set-included",
      itemKey,
      included,
      reason: "user",
      at: dependenciesRef.current.now(),
    });
    if (next !== current) await persist(next);
  }, [persist]);

  const prepareApply = useCallback(async (): Promise<void> => {
    const current = jobRef.current;
    if (!current) return;
    const next = reduceReplacementJob(current, { type: "apply/prepare", at: dependenciesRef.current.now() });
    if (next !== current) await persist(next);
  }, [persist]);

  const applyLoop = useCallback(async (token: number): Promise<void> => {
    const visible = jobRef.current;
    if (!visible) return;
    let stored: PersistedContentReplacementJob | null;
    try {
      stored = await dependenciesRef.current.storage.load(visible.id);
    } catch {
      if (mountedRef.current) setStorageError(STORAGE_ERROR);
      return;
    }
    if (
      !stored || stored.id !== visible.id || stored.fingerprint !== visible.fingerprint ||
      stored.updatedAt !== visible.updatedAt || stored.recoverySnapshotStatus !== "ready" ||
      stableSerialize(stored) !== stableSerialize(visible)
    ) {
      if (mountedRef.current) setStorageError(STALE_SNAPSHOT_ERROR);
      return;
    }
    let current = stored;
    const started = reduceReplacementJob(current, { type: "apply/start", at: dependenciesRef.current.now() });
    if (started === current || !await persist(started, token)) return;
    current = started;
    while (token === operationRef.current) {
      const item = getNextApplyItem(current);
      if (!item) return;
      const itemKey = replacementItemKey(item.proposal.before.ref);
      const applying = reduceReplacementJob(current, {
        type: "apply/item-started", itemKey, at: dependenciesRef.current.now(),
      });
      if (!await persist(applying, token)) return;
      current = applying;
      const supplied = credentialsRef.current;
      if (!supplied) {
        const failed = reduceReplacementJob(current, {
          type: "apply/item-finished", itemKey,
          result: { status: "permission", error: "Reconnect Enterprise credentials." },
          at: dependenciesRef.current.now(),
        });
        await persist(failed, token);
        return;
      }
      const fetched = await request(APPLY_URL, {
        credentials: credentialsForJob(supplied, current),
        configuration: current.configuration,
        jobFingerprint: current.fingerprint,
        itemRef: item.proposal.before.ref,
        expectedScannedRequestChecksum: item.proposal.scannedRequestChecksum,
        expectedProposedRequestChecksum: item.proposal.proposedRequestChecksum,
        expectedProposalFingerprint: item.proposal.proposalFingerprint,
      }, token);
      if ("aborted" in fetched) return;
      const at = dependenciesRef.current.now();
      const parsed = "failed" in fetched
        ? { ok: false as const, result: { status: "network" as const, error: NETWORK_FAILURE_MESSAGE }, throttleNotices: [] }
        : await parseApplyResponse(fetched.response);
      const finished = reduceReplacementJob(current, {
        type: "apply/item-finished", itemKey, result: parsed.result, at,
      });
      if (!await persistResponse(finished, parsed.throttleNotices, at, token)) return;
      current = jobRef.current!;
      if (!parsed.ok && parsed.stop) return;
    }
  }, [persist, persistResponse, request]);

  const runApplyRef = useRef<() => Promise<void>>(async () => undefined);
  const runApply = useCallback(() => runExclusive(applyLoop), [applyLoop, runExclusive]);
  runApplyRef.current = runApply;

  const startApply = runApply;

  const retryEligibleFailures = useCallback(async (): Promise<void> => {
    const current = jobRef.current;
    if (!current) return;
    const next = reduceReplacementJob(current, {
      type: "apply/retry-eligible",
      at: dependenciesRef.current.now(),
    });
    if (next === current || !await persist(next)) return;
    await runApplyRef.current();
  }, [persist]);

  const rescanStaleItems = useCallback(async (itemKeys: string[]): Promise<void> => {
    const original = jobRef.current;
    if (!original) return;
    const keys = orderedItemKeys(original, itemKeys)
      .filter((key) => original.proposals[key]?.status === "stale");
    if (keys.length === 0) return;
    await runExclusive(async (token) => {
      for (let offset = 0; offset < keys.length && token === operationRef.current; offset += 10) {
        const batchKeys = keys.slice(offset, offset + 10);
        const refs = batchKeys.map((key) => original.proposals[key].proposal.before.ref);
        const supplied = credentialsRef.current;
        if (!supplied) {
          await persist(reduceReplacementJob(jobRef.current!, {
            type: "scan/stale-details-failed",
            requestedItemKeys: batchKeys,
            failure: { category: "authorization", retryable: false, message: "Reconnect Enterprise credentials." },
            at: dependenciesRef.current.now(),
          }), token);
          return;
        }
        const fetched = await request(SCAN_URL, {
          action: "details",
          credentials: credentialsForJob(supplied, original),
          configuration: original.configuration,
          jobFingerprint: original.fingerprint,
          refs,
        }, token);
        if ("aborted" in fetched) return;
        if ("failed" in fetched) {
          await persist(reduceReplacementJob(jobRef.current!, {
            type: "scan/stale-details-failed",
            requestedItemKeys: batchKeys,
            failure: { category: "network", retryable: true, message: NETWORK_FAILURE_MESSAGE },
            at: dependenciesRef.current.now(),
          }), token);
          return;
        }
        const parsed = await parseScanResponse(fetched.response, "details");
        if (!parsed.ok) {
          await persist(reduceReplacementJob(jobRef.current!, {
            type: "scan/stale-details-failed",
            requestedItemKeys: batchKeys,
            failure: {
              category: failureCategoryForStatus(fetched.response.status),
              retryable: fetched.response.status >= 500 || fetched.response.status === 429,
              message: parsed.message,
            },
            at: dependenciesRef.current.now(),
          }), token);
          return;
        }
        const at = dependenciesRef.current.now();
        const next = reduceReplacementJob(jobRef.current!, {
          type: "scan/stale-details-succeeded",
          requestedItemKeys: batchKeys,
          result: parsed.result as DetailBatchResult,
          at,
        });
        if (!await persistResponse(next, parsed.throttleNotices, at, token)) return;
        if (fetched.response.status >= 400 && fetched.response.status < 500 &&
          fetched.response.status !== 429) return;
      }
    });
  }, [persist, persistResponse, request, runExclusive]);

  const prepareRecovery = useCallback(async (itemKeys: string[]): Promise<void> => {
    const initial = jobRef.current;
    const requested = initial ? orderedItemKeys(initial, itemKeys) : [];
    await runExclusive(async (token) => {
      for (const itemKey of requested) {
        let current = jobRef.current;
        const item = current?.proposals[itemKey];
        if (!current || !isSuccessfullyApplied(item)) continue;
        const previewing = reduceReplacementJob(current, {
          type: "recovery/preview-started", itemKey, at: dependenciesRef.current.now(),
        });
        if (!await persist(previewing, token)) return;
        current = previewing;
        const supplied = credentialsRef.current;
        if (!supplied) return;
        const prior = toReplacementWireRequestModel(item.proposal.before);
        const fetched = await request(RECOVERY_URL, recoveryPayload(
          "preview", credentialsForJob(supplied, current), current, item, prior,
        ), token);
        if ("aborted" in fetched) return;
        const at = dependenciesRef.current.now();
        if ("failed" in fetched) {
          const failed = reduceReplacementJob(current, {
            type: "recovery/preview-failed", itemKey,
            failure: { category: "network", retryable: true, message: NETWORK_FAILURE_MESSAGE }, at,
          });
          if (!await persist(failed, token)) return;
          continue;
        }
        const parsed = await parseRecoveryPreviewResponse(fetched.response, item.proposal.before.ref);
        const next = parsed.ok
          ? reduceReplacementJob(current, {
              type: "recovery/preview-finished", itemKey, result: parsed.result, at,
            })
          : reduceReplacementJob(current, {
              type: "recovery/preview-failed", itemKey,
              failure: parsed.failure ?? {
                  category: failureCategoryForStatus(fetched.response.status),
                  retryable: fetched.response.status >= 500,
                  message: parsed.message,
                },
              at,
            });
        if (!await persistResponse(next, parsed.throttleNotices, at, token)) return;
        if (fetched.response.status >= 400 && fetched.response.status < 500 &&
          fetched.response.status !== 429) return;
      }
    });
  }, [persist, persistResponse, request, runExclusive]);

  const startRecovery = useCallback(async (itemKeys: string[]): Promise<void> => {
    const visible = jobRef.current;
    if (!visible) return;
    await runExclusive(async (token) => {
      let stored: PersistedContentReplacementJob | null;
      try {
        stored = await dependenciesRef.current.storage.load(visible.id);
      } catch {
        if (mountedRef.current) setStorageError(STORAGE_ERROR);
        return;
      }
      if (
        !stored || stored.updatedAt !== visible.updatedAt || stored.recoverySnapshotStatus !== "ready" ||
        stableSerialize(stored) !== stableSerialize(visible)
      ) {
        if (mountedRef.current) setStorageError(STALE_SNAPSHOT_ERROR);
        return;
      }
      const requested = orderedItemKeys(stored, itemKeys).filter((key) => {
        const item = stored!.proposals[key];
        return item?.status === "ready-to-recover" &&
          item.recovery?.preview?.status === "recoverable" && previewMatchesGeneration(item);
      });
      if (requested.length === 0) return;
      let current = reduceReplacementJob(stored, {
        type: "recovery/start", itemKeys: requested, at: dependenciesRef.current.now(),
      });
      if (!await persist(current, token)) return;
      for (const itemKey of requested) {
        const item = current.proposals[itemKey];
        if (!isSuccessfullyApplied(item) || item.recovery?.preview?.status !== "recoverable") continue;
        const prior = toReplacementWireRequestModel(item.recovery.priorRequestModel);
        const payload = recoveryPayload(
          "apply",
          credentialsRef.current ? credentialsForJob(credentialsRef.current, current) : null,
          current,
          item,
          prior,
        );
        if (!payload.credentials) return;
        const recovering = reduceReplacementJob(current, {
          type: "recovery/item-started", itemKey, at: dependenciesRef.current.now(),
        });
        if (!await persist(recovering, token)) return;
        current = recovering;
        const fetched = await request(RECOVERY_URL, payload, token);
        if ("aborted" in fetched) return;
        const at = dependenciesRef.current.now();
        const parsed = "failed" in fetched
          ? { result: { status: "network" as const, error: NETWORK_FAILURE_MESSAGE }, throttleNotices: [] }
          : await parseRecoveryApplyResponse(fetched.response);
        const next = reduceReplacementJob(current, {
          type: "recovery/item-finished", itemKey, result: parsed.result, at,
        });
        if (!await persistResponse(next, parsed.throttleNotices, at, token)) return;
        current = jobRef.current!;
        if (parsed.stop) return;
      }
    });
  }, [persist, persistResponse, request, runExclusive]);

  const deleteRecoverySnapshots = useCallback(async (): Promise<void> => {
    const current = jobRef.current;
    if (!current) return;
    const next = reduceReplacementJob(current, {
      type: "recovery/delete-snapshots",
      at: dependenciesRef.current.now(),
    });
    if (next !== current) await persist(next);
  }, [persist]);

  return {
    job,
    busy,
    storageError,
    createJob,
    startScan,
    pause,
    resume: async () => {
      const current = jobRef.current;
      if (current?.stage === "apply") await runApplyRef.current();
      else await resume();
    },
    cancel,
    deleteJob,
    deleteRecoverySnapshots,
    setItemIncluded,
    prepareApply,
    startApply,
    retryEligibleFailures,
    rescanStaleItems,
    prepareRecovery,
    startRecovery,
  };
}

function scanFailure(
  job: PersistedContentReplacementJob,
  category: PersistedContentReplacementFailure["category"],
  retryable: boolean,
  message: string,
  at: string,
): PersistedContentReplacementJob {
  return reduceReplacementJob(job, {
    type: "scan/failed",
    failure: { category, retryable, message },
    at,
  });
}

function recoveryPayload(
  action: "preview" | "apply",
  credentials: SessionCredentials | null,
  job: PersistedContentReplacementJob,
  item: PersistedContentReplacementItem & { recovery: NonNullable<PersistedContentReplacementItem["recovery"]> },
  priorRequestModel: ReplacementWireRequestModel,
): Record<string, unknown> & { credentials: SessionCredentials | null } {
  return {
    action,
    credentials,
    jobFingerprint: job.fingerprint,
    itemRef: item.proposal.before.ref,
    priorRequestModel,
    expectedPriorRequestChecksum: item.recovery.scannedRequestChecksum,
    expectedPostApplyChecksum: item.recovery.observedPostApplyChecksum,
  };
}

function isSuccessfullyApplied(
  item: PersistedContentReplacementItem | undefined,
): item is PersistedContentReplacementItem & {
  result: Extract<NonNullable<PersistedContentReplacementItem["result"]>, { kind: "applied" | "unchanged" }>;
  recovery: NonNullable<PersistedContentReplacementItem["recovery"]> & { observedPostApplyChecksum: string };
} {
  return !!item && (item.result?.kind === "applied" || item.result?.kind === "unchanged") &&
    item.recovery?.observedPostApplyChecksum === item.result.observedRequestChecksum;
}

function previewMatchesGeneration(item: PersistedContentReplacementItem): boolean {
  const preview = item.recovery?.preview;
  return !!preview && preview.sourceAttemptCount === item.attemptCount &&
    preview.sourceApplyCompletedAt === item.result?.completedAt;
}

type ParsedScanResponse =
  | { ok: true; result: InventorySliceResult | DetailBatchResult; throttleNotices: ThrottleNotice[] }
  | { ok: false; message: string };

async function parseScanResponse(response: Response, expected: "inventory" | "details"): Promise<ParsedScanResponse> {
  const body = await safeJson(response);
  if (!isRecord(body) || !hasOnlyKeys(body, response.ok ? ["ok", "result", "throttleNotices"] : ["ok", "error"])) {
    return { ok: false, message: INVALID_RESPONSE_MESSAGE };
  }
  if (body.ok !== true || !response.ok) return { ok: false, message: safeHttpMessage(response.status) };
  const notices = parseThrottleNotices(body.throttleNotices);
  if (!notices || !isRecord(body.result)) return { ok: false, message: INVALID_RESPONSE_MESSAGE };
  if (expected === "inventory") {
    const result = parseInventoryResult(body.result);
    return result ? { ok: true, result, throttleNotices: notices } : { ok: false, message: INVALID_RESPONSE_MESSAGE };
  }
  const result = parseDetailResult(body.result);
  return result ? { ok: true, result, throttleNotices: notices } : { ok: false, message: INVALID_RESPONSE_MESSAGE };
}

function parseInventoryResult(value: Record<string, unknown>): InventorySliceResult | null {
  if (!hasOnlyKeys(value, ["candidates", "answerCursors", "nextCursor", "inspectedCount", "pageKind"]) ||
    !Array.isArray(value.candidates) || !Array.isArray(value.answerCursors) ||
    !isCount(value.inspectedCount) ||
    (value.pageKind !== "questions" && value.pageKind !== "answers" && value.pageKind !== "articles")) return null;
  const candidates = value.candidates.map(parseRef);
  const answerCursors = value.answerCursors.map(parseCursor);
  const nextCursor = value.nextCursor === null ? null : parseCursor(value.nextCursor);
  if (candidates.some((item) => !item) || answerCursors.some((item) => item?.kind !== "answers") ||
    (value.nextCursor !== null && !nextCursor)) return null;
  return {
    candidates: candidates as ReplacementItemRef[],
    answerCursors: answerCursors as Extract<InventoryCursor, { kind: "answers" }>[],
    nextCursor,
    inspectedCount: value.inspectedCount,
    pageKind: value.pageKind,
  };
}

function parseDetailResult(value: Record<string, unknown>): DetailBatchResult | null {
  if (!hasOnlyKeys(value, ["proposals", "inspectedCount", "protectedOccurrenceCount"]) ||
    !Array.isArray(value.proposals) || !isCount(value.inspectedCount) ||
    !isCount(value.protectedOccurrenceCount)) return null;
  if (value.proposals.some((proposal) => !isRecord(proposal))) return null;
  return {
    proposals: value.proposals as ReplacementProposal[],
    inspectedCount: value.inspectedCount,
    protectedOccurrenceCount: value.protectedOccurrenceCount,
  };
}

async function parseApplyResponse(response: Response): Promise<{
  ok: boolean;
  stop?: boolean;
  result:
    | { status: "updated" | "already-applied" | "stale"; observedRequestChecksum: string }
    | { status: "permission" | "validation" | "network" | "failed"; error: string };
  throttleNotices: ThrottleNotice[];
}> {
  const body = await safeJson(response);
  if (!response.ok || !isRecord(body) || body.ok !== true) {
    const status = response.status === 401 || response.status === 403 ? "permission" :
      response.status === 400 || response.status === 422 ? "validation" :
      response.status >= 500 || response.status === 429 ? "network" : "failed";
    return {
      ok: false,
      stop: response.status >= 400 && response.status < 500 && response.status !== 429,
      result: { status, error: safeHttpMessage(response.status) },
      throttleNotices: [],
    };
  }
  if (!hasOnlyKeys(body, ["ok", "result", "throttleNotices"]) || !isRecord(body.result)) {
    return { ok: false, stop: true, result: { status: "failed", error: INVALID_RESPONSE_MESSAGE }, throttleNotices: [] };
  }
  const notices = parseThrottleNotices(body.throttleNotices);
  if (!notices) {
    return { ok: false, stop: true, result: { status: "failed", error: INVALID_RESPONSE_MESSAGE }, throttleNotices: [] };
  }
  const result = body.result;
  if ((result.status === "updated" || result.status === "already-applied" || result.status === "stale") &&
    hasOnlyKeys(result, ["status", "observedRequestChecksum"]) && isDigest(result.observedRequestChecksum)) {
    return { ok: true, result: { status: result.status, observedRequestChecksum: result.observedRequestChecksum }, throttleNotices: notices };
  }
  if ((result.status === "permission" || result.status === "validation" || result.status === "network" || result.status === "failed") &&
    hasOnlyKeys(result, ["status", "error"]) && typeof result.error === "string") {
    return { ok: true, result: { status: result.status, error: sanitizeItemError(result.status) }, throttleNotices: notices };
  }
  return { ok: false, stop: true, result: { status: "failed", error: INVALID_RESPONSE_MESSAGE }, throttleNotices: [] };
}

async function parseRecoveryPreviewResponse(response: Response, ref: ReplacementItemRef): Promise<
  | {
      ok: true;
      result: {
        status: "recoverable" | "already-recovered" | "conflict";
        currentRequestModel: ReplacementWireRequestModel;
        observedRequestChecksum: string;
      };
      throttleNotices: ThrottleNotice[];
    }
  | {
      ok: false;
      message: string;
      throttleNotices: ThrottleNotice[];
      failure?: Omit<PersistedContentReplacementFailure, "occurredAt">;
    }
> {
  const body = await safeJson(response);
  if (!response.ok || !isRecord(body) || body.ok !== true ||
    !hasOnlyKeys(body, ["ok", "result", "throttleNotices"]) || !isRecord(body.result)) {
    return { ok: false, message: safeHttpMessage(response.status), throttleNotices: [] };
  }
  const notices = parseThrottleNotices(body.throttleNotices);
  const result = body.result;
  if (notices &&
    (result.status === "permission" || result.status === "validation" ||
      result.status === "network" || result.status === "failed") &&
    hasOnlyKeys(result, ["status", "error"]) && typeof result.error === "string") {
    const category = result.status === "permission" ? "authorization" :
      result.status === "failed" ? "server" : result.status;
    return {
      ok: false,
      message: sanitizeItemError(result.status),
      throttleNotices: notices,
      failure: {
        category,
        retryable: result.status === "network" || result.status === "failed",
        message: sanitizeItemError(result.status),
      },
    };
  }
  const current = normalizeCurrentRequestModel(result.currentRequestModel, ref);
  const prior = validateExactPriorRequestModel(result.priorRequestModel, ref);
  if (!notices || !current || !prior ||
    (result.status !== "recoverable" && result.status !== "already-recovered" && result.status !== "conflict") ||
    !isDigest(result.observedRequestChecksum) ||
    !hasOnlyKeys(result, ["status", "currentRequestModel", "priorRequestModel", "observedRequestChecksum"])) {
    return { ok: false, message: INVALID_RESPONSE_MESSAGE, throttleNotices: [] };
  }
  return {
    ok: true,
    result: { status: result.status, currentRequestModel: current, observedRequestChecksum: result.observedRequestChecksum },
    throttleNotices: notices,
  };
}

async function parseRecoveryApplyResponse(response: Response): Promise<{
  result:
    | { status: "recovered" | "already-recovered" | "conflict"; observedRequestChecksum: string }
    | { status: "permission" | "validation" | "network" | "failed"; error: string };
  throttleNotices: ThrottleNotice[];
  stop?: boolean;
}> {
  const body = await safeJson(response);
  if (!response.ok || !isRecord(body) || body.ok !== true ||
    !hasOnlyKeys(body, ["ok", "result", "throttleNotices"]) || !isRecord(body.result)) {
    return {
      result: { status: response.status >= 500 ? "network" : "failed", error: safeHttpMessage(response.status) },
      throttleNotices: [],
      stop: response.status >= 400 && response.status < 500 && response.status !== 429,
    };
  }
  const notices = parseThrottleNotices(body.throttleNotices);
  if (!notices) {
    return { result: { status: "failed", error: INVALID_RESPONSE_MESSAGE }, throttleNotices: [], stop: true };
  }
  const result = body.result;
  if ((result.status === "recovered" || result.status === "already-recovered" || result.status === "conflict") &&
    hasOnlyKeys(result, ["status", "observedRequestChecksum"]) && isDigest(result.observedRequestChecksum)) {
    return { result: { status: result.status, observedRequestChecksum: result.observedRequestChecksum }, throttleNotices: notices };
  }
  if ((result.status === "permission" || result.status === "validation" || result.status === "network" || result.status === "failed") &&
    hasOnlyKeys(result, ["status", "error"]) && typeof result.error === "string") {
    return { result: { status: result.status, error: sanitizeItemError(result.status) }, throttleNotices: notices };
  }
  return { result: { status: "failed", error: INVALID_RESPONSE_MESSAGE }, throttleNotices: [] };
}

function parseThrottleNotices(value: unknown): ThrottleNotice[] | null {
  if (!Array.isArray(value) || value.length > 100) return null;
  const output: ThrottleNotice[] = [];
  for (const notice of value) {
    if (!isRecord(notice) || !hasOnlyKeys(notice, notice.remaining === undefined
      ? ["kind", "seconds"] : ["kind", "seconds", "remaining"]) ||
      (notice.kind !== "backoff" && notice.kind !== "burst" && notice.kind !== "token-bucket") ||
      !isCount(notice.seconds) || notice.seconds > MAX_STACK_API_V3_BACKOFF_NOTICE_SECONDS ||
      (notice.remaining !== undefined && !isCount(notice.remaining))) return null;
    output.push(notice.remaining === undefined
      ? { kind: notice.kind, seconds: notice.seconds }
      : { kind: notice.kind, seconds: notice.seconds, remaining: notice.remaining });
  }
  return output;
}

function parseCursor(value: unknown): InventoryCursor | null {
  if (!isRecord(value)) return null;
  if ((value.kind === "questions" || value.kind === "articles") &&
    hasOnlyKeys(value, ["kind", "page"]) && isPositiveInteger(value.page)) {
    return { kind: value.kind, page: value.page };
  }
  if (value.kind === "answers" && hasOnlyKeys(value, ["kind", "questionId", "page"]) &&
    isPositiveInteger(value.questionId) && isPositiveInteger(value.page)) {
    return { kind: "answers", questionId: value.questionId, page: value.page };
  }
  return null;
}

function parseRef(value: unknown): ReplacementItemRef | null {
  if (!isRecord(value)) return null;
  if (value.kind === "question" && hasOnlyKeys(value, ["kind", "questionId"]) && isPositiveInteger(value.questionId)) {
    return { kind: "question", questionId: value.questionId };
  }
  if (value.kind === "answer" && hasOnlyKeys(value, ["kind", "questionId", "answerId"]) &&
    isPositiveInteger(value.questionId) && isPositiveInteger(value.answerId)) {
    return { kind: "answer", questionId: value.questionId, answerId: value.answerId };
  }
  if (value.kind === "article" && hasOnlyKeys(value, ["kind", "articleId"]) && isPositiveInteger(value.articleId)) {
    return { kind: "article", articleId: value.articleId };
  }
  return null;
}

async function safeJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function safeHttpMessage(status: number): string {
  if (status === 401 || status === 403) return "Stack Enterprise credentials or permissions were rejected.";
  if (status >= 400 && status < 500) return "The content replacement request was rejected.";
  if (status >= 500) return "The content replacement service is temporarily unavailable.";
  return INVALID_RESPONSE_MESSAGE;
}

function sanitizeItemError(status: "permission" | "validation" | "network" | "failed"): string {
  if (status === "permission") return "Stack Enterprise permission was denied.";
  if (status === "validation") return "Stack Enterprise rejected the content update.";
  if (status === "network") return NETWORK_FAILURE_MESSAGE;
  return "The content replacement item could not be completed.";
}

function failureCategoryForStatus(status: number): PersistedContentReplacementFailure["category"] {
  if (status === 401 || status === 403) return "authorization";
  if (status === 400 || status === 409 || status === 422) return "validation";
  if (status === 429) return "rate-limit";
  if (status >= 500) return "server";
  return "unknown";
}

function normalizeOrigin(value: string): string {
  try {
    return new URL(value).origin;
  } catch {
    return value.trim();
  }
}

function credentialsForJob(
  credentials: SessionCredentials,
  job: Pick<PersistedContentReplacementJob, "baseUrl">,
): SessionCredentials {
  return { ...credentials, baseUrl: job.baseUrl };
}

function orderedItemKeys(
  job: PersistedContentReplacementJob,
  requestedKeys: readonly string[],
): string[] {
  const requested = new Set(requestedKeys);
  return Object.keys(job.proposals).filter((key) => requested.has(key));
}

function addSeconds(timestamp: string, seconds: number): string {
  return new Date(Date.parse(timestamp) + seconds * 1_000).toISOString();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const allowed = new Set(keys);
  return Object.keys(value).length === keys.length && Object.keys(value).every((key) => allowed.has(key));
}

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isPositiveInteger(value: unknown): value is number {
  return isCount(value) && value > 0;
}

function isDigest(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

function defaultWaitUntil(timestamp: string, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const delay = Math.max(0, Date.parse(timestamp) - Date.now());
    const timer = window.setTimeout(resolve, Math.min(delay, 2_147_483_647));
    signal.addEventListener("abort", () => {
      window.clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    }, { once: true });
  });
}
