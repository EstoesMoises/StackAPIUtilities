import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { SessionCredentials } from "../domain/types";
import { buildReplacementProposal, createJobFingerprint } from "../writeTools/contentReplacement/proposals";
import {
  createReplacementJob,
  createReplacementSelectionSnapshot,
  reduceReplacementJob,
} from "../writeTools/contentReplacement/jobState";
import type {
  PersistedContentReplacementJob,
  ReplacementConfiguration,
  ReplacementProposal,
} from "../writeTools/contentReplacement/types";
import {
  useContentReplacementJob,
  type ContentReplacementJobDependencies,
} from "./useContentReplacementJob";

const AT = "2026-09-01T12:00:00.000Z";
const LATER = "2026-09-01T12:01:00.000Z";
const credentials: SessionCredentials = {
  instanceType: "enterprise",
  baseUrl: "https://example.stackenterprise.co/",
  accessToken: "top-secret-token",
  apiKey: "top-secret-key",
  authSource: "oauth-pkce",
  oauthScopes: ["write_access", "no_expiry"],
};
const configuration: ReplacementConfiguration = {
  target: { kind: "enterprise-main" },
  contentTypes: { questions: true, answers: false, articles: false },
  discovery: { mode: "full" },
  rules: [{ id: "rule-1", find: "Old", replace: "New" }],
  options: { caseSensitive: true, wholeTerm: true, replaceInCode: false },
};

function inventoryProgress() {
  return {
    apiRequestsCompleted: 1,
    searchPages: 0,
    searchTermsCompleted: 0,
    answerBearingQuestionsQueued: 0,
    zeroAnswerQuestionsSkipped: 0,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function questionProposal(id = 1): Promise<ReplacementProposal> {
  const built = await buildReplacementProposal({
    kind: "question",
    ref: { kind: "question", questionId: id },
    request: { title: "Old title", body: "Body", tags: ["tag"] },
    metadata: { titleContext: "kept locally" },
  }, configuration);
  if (!built) throw new Error("fixture did not produce a proposal");
  return built;
}

function storage(initial: PersistedContentReplacementJob | null = null) {
  let persisted = initial;
  return {
    save: vi.fn(async (job: PersistedContentReplacementJob, expectedRevision: number | null) => {
      if ((persisted?.revision ?? null) !== expectedRevision) return { status: "conflict" as const };
      persisted = job;
      return { status: "saved" as const };
    }),
    load: vi.fn(async () => persisted),
    delete: vi.fn(async () => { persisted = null; }),
    current: () => persisted,
  };
}

function dependencies(
  fetcher: ContentReplacementJobDependencies["fetch"] = vi.fn(),
  initial: PersistedContentReplacementJob | null = null,
) {
  const store = storage(initial);
  let tick = 0;
  return {
    store,
    value: {
      fetch: fetcher,
      storage: store,
      now: () => tick++ === 0 ? AT : LATER,
      createId: () => "job-1",
      waitUntil: vi.fn().mockResolvedValue(undefined),
    } satisfies ContentReplacementJobDependencies,
  };
}

async function scannedReviewJob(...proposals: ReplacementProposal[]): Promise<PersistedContentReplacementJob> {
  const fingerprint = await createJobFingerprint({
    baseUrl: "https://example.stackenterprise.co",
    configuration,
  });
  let job = createReplacementJob({
    id: "job-1", fingerprint, baseUrl: "https://example.stackenterprise.co",
    configuration, createdAt: AT,
  });
  const refs = proposals.map((candidate) => candidate.before.ref);
  job = { ...job, inventoryQueue: [], detailQueue: refs };
  for (let offset = 0; offset < refs.length; offset += 10) {
    const batchRefs = refs.slice(offset, offset + 10);
    const batchProposals = proposals.slice(offset, offset + 10);
    job = reduceReplacementJob(job, {
      type: "scan/details-succeeded", refs: batchRefs,
      result: { proposals: batchProposals, inspectedCount: batchProposals.length, protectedOccurrenceCount: 0 }, at: AT,
    });
  }
  return reduceReplacementJob(job, { type: "scan/queues-drained", at: AT });
}

async function appliedJob(...proposals: ReplacementProposal[]): Promise<PersistedContentReplacementJob> {
  let job = prepareJob(await scannedReviewJob(...proposals), AT);
  job = reduceReplacementJob(job, { type: "apply/start", at: AT });
  for (const proposal of proposals) {
    const itemKey = `question:${proposal.before.ref.kind === "question" ? proposal.before.ref.questionId : 0}`;
    job = reduceReplacementJob(job, { type: "apply/item-started", itemKey, at: AT });
    job = reduceReplacementJob(job, {
      type: "apply/item-finished", itemKey,
      result: { status: "updated", observedRequestChecksum: proposal.proposedRequestChecksum }, at: AT,
    });
  }
  return job;
}

function prepareJob(job: PersistedContentReplacementJob, at: string): PersistedContentReplacementJob {
  return reduceReplacementJob(job, {
    type: "apply/prepare",
    expectedSelection: createReplacementSelectionSnapshot(job.proposals),
    at,
  });
}

describe("useContentReplacementJob", () => {
  it("creates a validated normalized credential-free job before making it active", async () => {
    const deps = dependencies();
    const { result } = renderHook(() => useContentReplacementJob(credentials, null, deps.value));

    await act(async () => result.current.createJob(configuration));

    expect(result.current.job?.baseUrl).toBe("https://example.stackenterprise.co");
    expect(deps.store.save).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(deps.store.save.mock.calls[0][0])).not.toMatch(/top-secret|accessToken|apiKey/);
    expect(result.current.job).toEqual(deps.store.current());
  });

  it("publishes newly created and explicitly deleted job identities to the App owner", async () => {
    const deps = dependencies();
    const onJobSelected = vi.fn();
    const onJobDeleted = vi.fn();
    const { result } = renderHook(() => useContentReplacementJob(
      credentials,
      null,
      deps.value,
      { onJobSelected, onJobDeleted },
    ));

    await act(async () => result.current.createJob(configuration));
    expect(onJobSelected).toHaveBeenCalledWith("job-1");

    await act(async () => result.current.deleteJob());
    expect(onJobDeleted).toHaveBeenCalledWith("job-1");
  });

  it.each([
    "http://example.stackenterprise.co",
    "https://example.stackenterprise.co/path",
    "https://example.stackenterprise.co?query=1",
    "https://user@example.stackenterprise.co",
    "https://example.stackenterprise.co.evil.test",
  ])("rejects unsupported write origins before persistence or fetch: %s", async (baseUrl) => {
    const fetcher = vi.fn();
    const deps = dependencies(fetcher);
    const { result } = renderHook(() => useContentReplacementJob({ ...credentials, baseUrl }, null, deps.value));

    let created = true;
    await act(async () => { created = await result.current.createJob(configuration); });
    await act(async () => result.current.startScan());

    expect(created).toBe(false);
    expect(result.current.job).toBeNull();
    expect(deps.store.save).not.toHaveBeenCalled();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("requires an actual valid credential change after an authorization rejection", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ ok: false, error: "secret upstream detail" }, 401))
      .mockResolvedValueOnce(jsonResponse({
        ok: true,
        result: {
          candidates: [], answerCursors: [], nextCursor: null, inspectedCount: 0, pageKind: "questions",
          progress: inventoryProgress(),
        },
        throttleNotices: [],
      }));
    const deps = dependencies(fetcher);
    const hook = renderHook(
      ({ supplied }) => useContentReplacementJob(supplied, null, deps.value),
      { initialProps: { supplied: credentials } },
    );
    await act(async () => hook.result.current.createJob(configuration));
    await act(async () => hook.result.current.startScan());

    expect(hook.result.current.job).toMatchObject({ status: "paused", operationError: { category: "authorization" } });
    expect(hook.result.current.credentialReadiness).toMatchObject({ valid: false, refreshRequired: true });
    await act(async () => hook.result.current.resume());
    expect(fetcher).toHaveBeenCalledTimes(1);

    hook.rerender({ supplied: { ...credentials, accessToken: "   " } });
    expect(hook.result.current.credentialReadiness).toMatchObject({ valid: false, refreshRequired: false });
    await act(async () => hook.result.current.resume());
    expect(fetcher).toHaveBeenCalledTimes(1);

    hook.rerender({ supplied: { ...credentials } });
    expect(hook.result.current.credentialReadiness).toMatchObject({ valid: false, refreshRequired: true });

    hook.rerender({ supplied: { ...credentials, accessToken: "fresh-token" } });
    expect(hook.result.current.credentialReadiness).toMatchObject({ valid: true, refreshRequired: false });
    await act(async () => hook.result.current.resume());
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(deps.store.current())).not.toMatch(/fresh-token|top-secret-token|credentialFingerprint/i);
  });

  it("does not infer a rejected credential from persisted authorization state after a full reload", async () => {
    let interrupted = createReplacementJob({
      id: "reload-without-memory-job",
      fingerprint: "f".repeat(64),
      baseUrl: "https://example.stackenterprise.co",
      configuration,
      createdAt: AT,
    });
    interrupted = reduceReplacementJob(interrupted, {
      type: "run/credential-interrupted",
      failure: { category: "authorization", retryable: true, message: "Credentials rejected." },
      at: AT,
    });
    const deps = dependencies(vi.fn(), interrupted);
    const hook = renderHook(
      ({ supplied }) => useContentReplacementJob(supplied, interrupted, deps.value),
      { initialProps: { supplied: credentials } },
    );

    expect(hook.result.current.credentialReadiness).toMatchObject({ valid: true, refreshRequired: false });
    hook.rerender({ supplied: { ...credentials } });
    expect(hook.result.current.credentialReadiness).toMatchObject({ valid: true, refreshRequired: false });
  });

  it("retains a canonical rejected token identity across remounts until authenticated success", async () => {
    const firstResponse = deferred<Response>();
    const fetcher = vi.fn()
      .mockReturnValueOnce(firstResponse.promise)
      .mockResolvedValueOnce(jsonResponse({
        ok: true,
        result: {
          candidates: [], answerCursors: [], nextCursor: null, inspectedCount: 0, pageKind: "questions",
          progress: inventoryProgress(),
        },
        throttleNotices: [],
      }));
    const deps = dependencies(fetcher);
    deps.value.createId = () => "canonical-remount-job";
    const tokenA: SessionCredentials = {
      ...credentials,
      baseUrl: "https://EXAMPLE.stackenterprise.co/",
      accessToken: "  token-a  ",
      oauthScopes: ["no_expiry", "write_access"],
    };
    const first = renderHook(() => useContentReplacementJob(tokenA, null, deps.value));
    await act(async () => first.result.current.createJob(configuration));
    let scan!: Promise<void>;
    act(() => { scan = first.result.current.startScan(); });
    await waitFor(() => expect(fetcher).toHaveBeenCalledOnce());
    firstResponse.resolve(jsonResponse({ ok: false, error: "rejected" }, 401));
    await act(async () => scan);
    const persisted = deps.store.current();
    expect(JSON.stringify(persisted)).not.toMatch(/token-a|credentialFingerprint|rejectedCredential/i);
    first.unmount();

    const equivalentA: SessionCredentials = {
      ...tokenA,
      baseUrl: "https://example.stackenterprise.co",
      accessToken: "token-a",
      oauthScopes: ["write_access", "no_expiry"],
    };
    const second = renderHook(
      ({ supplied }) => useContentReplacementJob(supplied, persisted, deps.value),
      { initialProps: { supplied: equivalentA } },
    );
    expect(second.result.current.credentialReadiness).toMatchObject({ valid: false, refreshRequired: true });

    second.rerender({
      supplied: {
        ...equivalentA,
        authSource: "manual-enterprise-token",
        oauthScopes: [],
        accessTokenExpiresAt: undefined,
      },
    });
    expect(second.result.current.credentialReadiness).toMatchObject({ valid: false, refreshRequired: true });

    const tokenB = { ...equivalentA, accessToken: "token-b" };
    second.rerender({ supplied: tokenB });
    expect(second.result.current.credentialReadiness).toMatchObject({ valid: true, refreshRequired: false });
    second.rerender({ supplied: tokenA });
    expect(second.result.current.credentialReadiness).toMatchObject({ valid: false, refreshRequired: true });

    second.rerender({ supplied: tokenB });
    await act(async () => second.result.current.resume());
    expect(fetcher).toHaveBeenCalledTimes(2);
    second.rerender({ supplied: equivalentA });
    expect(second.result.current.credentialReadiness).toMatchObject({ valid: true, refreshRequired: false });
  });

  it("clears an in-memory rejection when its job is explicitly deleted", async () => {
    const fetcher = vi.fn().mockResolvedValue(jsonResponse({ ok: false, error: "rejected" }, 403));
    const deps = dependencies(fetcher);
    deps.value.createId = () => "deleted-rejection-job";
    const first = renderHook(() => useContentReplacementJob(credentials, null, deps.value));
    await act(async () => first.result.current.createJob(configuration));
    await act(async () => first.result.current.startScan());
    const rejectedJob = first.result.current.job;
    expect(first.result.current.credentialReadiness).toMatchObject({ valid: false, refreshRequired: true });
    await act(async () => first.result.current.deleteJob());
    first.unmount();

    const second = renderHook(() => useContentReplacementJob(credentials, rejectedJob, deps.value));
    expect(second.result.current.credentialReadiness).toMatchObject({ valid: true, refreshRequired: false });
  });

  it("rejects the credential used by an in-flight request without tainting a newer input", async () => {
    const pending = deferred<Response>();
    const fetcher = vi.fn()
      .mockReturnValueOnce(pending.promise)
      .mockResolvedValueOnce(jsonResponse({
        ok: true,
        result: {
          candidates: [], answerCursors: [], nextCursor: null, inspectedCount: 0, pageKind: "questions",
          progress: inventoryProgress(),
        },
        throttleNotices: [],
      }));
    const deps = dependencies(fetcher);
    const hook = renderHook(
      ({ supplied }) => useContentReplacementJob(supplied, null, deps.value),
      { initialProps: { supplied: credentials } },
    );
    await act(async () => hook.result.current.createJob(configuration));
    let scan!: Promise<void>;
    act(() => { scan = hook.result.current.startScan(); });
    await waitFor(() => expect(fetcher).toHaveBeenCalledOnce());
    hook.rerender({ supplied: { ...credentials, accessToken: "fresh-before-response" } });
    pending.resolve(jsonResponse({ ok: false, error: "rejected" }, 403));
    await act(async () => scan);

    expect(hook.result.current.credentialReadiness).toMatchObject({ valid: true, refreshRequired: false });
    await act(async () => hook.result.current.resume());
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("sequences one bounded scan request at a time and persists every response before continuing", async () => {
    const proposal = await questionProposal();
    const firstSave = deferred<void>();
    const fetcher = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        ok: true,
        result: {
          candidates: [{ kind: "question", questionId: 1 }], answerCursors: [], nextCursor: null,
          inspectedCount: 1, pageKind: "questions",
          progress: inventoryProgress(),
        },
        throttleNotices: [],
      }))
      .mockResolvedValueOnce(jsonResponse({
        ok: true,
        result: { proposals: [proposal], inspectedCount: 1, protectedOccurrenceCount: 0 },
        throttleNotices: [],
    }));
    const deps = dependencies(fetcher);
    const baseSave = deps.store.save.getMockImplementation()!;
    deps.store.save.mockImplementationOnce(async (job, expectedRevision) => {
      await firstSave.promise;
      return baseSave(job, expectedRevision);
    });
    const { result } = renderHook(() => useContentReplacementJob(credentials, null, deps.value));
    let creation!: Promise<boolean>;
    act(() => { creation = result.current.createJob(configuration); });
    expect(fetcher).not.toHaveBeenCalled();
    firstSave.resolve();
    await act(async () => creation);

    await act(async () => result.current.startScan());

    expect(fetcher).toHaveBeenCalledTimes(2);
    const firstBody = JSON.parse(fetcher.mock.calls[0][1].body as string);
    const secondBody = JSON.parse(fetcher.mock.calls[1][1].body as string);
    expect(firstBody).toMatchObject({
      action: "inventory",
      credentials: { ...credentials, baseUrl: "https://example.stackenterprise.co" },
    });
    expect(secondBody).toMatchObject({ action: "details", refs: [{ kind: "question", questionId: 1 }] });
    expect(result.current.job).toMatchObject({ stage: "review", status: "completed" });
    expect(deps.store.save.mock.invocationCallOrder[2]).toBeLessThan(fetcher.mock.invocationCallOrder[1]);
    expect(deps.store.save.mock.calls.every(([job]) => !JSON.stringify(job).includes("top-secret"))).toBe(true);
  });

  it("persists a returned throttle deadline before awaiting an abortable delay", async () => {
    const fetcher = vi.fn().mockResolvedValue(jsonResponse({
      ok: true,
      result: {
        candidates: [], answerCursors: [], nextCursor: null, inspectedCount: 0, pageKind: "questions",
        progress: inventoryProgress(),
      },
      throttleNotices: [{ kind: "backoff", seconds: 3 }],
    }));
    const deps = dependencies(fetcher);
    const { result } = renderHook(() => useContentReplacementJob(credentials, null, deps.value));
    await act(async () => result.current.createJob(configuration));
    await act(async () => result.current.startScan());

    expect(deps.value.waitUntil).toHaveBeenCalledWith(
      "2026-09-01T12:01:03.000Z",
      expect.any(AbortSignal),
    );
    const waitOrder = (deps.value.waitUntil as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0];
    const throttledSave = deps.store.save.mock.calls.findIndex(([job]) => job.nextRetryAt !== undefined);
    expect(deps.store.save.mock.invocationCallOrder[throttledSave]).toBeLessThan(waitOrder);
  });

  it("aborts an in-flight request on pause and ignores its stale response", async () => {
    const pending = deferred<Response>();
    let requestSignal: AbortSignal | undefined;
    const fetcher = vi.fn((_url, init) => {
      requestSignal = init?.signal;
      return pending.promise;
    });
    const deps = dependencies(fetcher);
    const { result } = renderHook(() => useContentReplacementJob(credentials, null, deps.value));
    await act(async () => result.current.createJob(configuration));
    let scan!: Promise<void>;
    act(() => { scan = result.current.startScan(); });
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));

    act(() => result.current.pause());
    expect(requestSignal?.aborted).toBe(true);
    pending.resolve(jsonResponse({ ok: false, error: "contains top-secret-token" }, 500));
    await act(async () => scan);
    await waitFor(() => expect(result.current.job?.status).toBe("paused"));
    expect(result.current.job?.failure).toBeUndefined();
  });

  it("does not let a deferred stale parser save after pause and delete", async () => {
    const parsedBody = deferred<unknown>();
    const response = {
      ok: true,
      status: 200,
      json: vi.fn(() => parsedBody.promise),
    } as unknown as Response;
    const fetcher = vi.fn().mockResolvedValue(response);
    const deps = dependencies(fetcher);
    const first = renderHook(() => useContentReplacementJob(credentials, null, deps.value));
    await act(async () => first.result.current.createJob(configuration));
    let scan!: Promise<void>;
    act(() => { scan = first.result.current.startScan(); });
    await waitFor(() => expect(response.json).toHaveBeenCalledTimes(1));

    act(() => first.result.current.pause());
    await waitFor(() => expect(first.result.current.job?.status).toBe("paused"));
    await act(async () => first.result.current.deleteJob());
    const savesAfterDelete = deps.store.save.mock.calls.length;
    expect(deps.store.current()).toBeNull();
    expect(first.result.current.job).toBeNull();

    parsedBody.resolve({
      ok: true,
      result: {
        candidates: [], answerCursors: [], nextCursor: null, inspectedCount: 0, pageKind: "questions",
        progress: inventoryProgress(),
      },
      throttleNotices: [],
    });
    await act(async () => scan);

    expect(deps.store.save).toHaveBeenCalledTimes(savesAfterDelete);
    expect(deps.store.current()).toBeNull();
    expect(first.result.current.job).toBeNull();
    const remounted = renderHook(() => useContentReplacementJob(credentials, deps.store.current(), deps.value));
    expect(remounted.result.current.job).toBeNull();
  });

  it("waits for the paused checkpoint to persist before an immediate resume", async () => {
    const firstResponse = deferred<Response>();
    const pausedSave = deferred<void>();
    const fetcher = vi.fn()
      .mockReturnValueOnce(firstResponse.promise)
      .mockResolvedValueOnce(jsonResponse({
        ok: true,
        result: {
          candidates: [], answerCursors: [], nextCursor: null, inspectedCount: 0, pageKind: "questions",
          progress: inventoryProgress(),
        },
        throttleNotices: [],
      }));
    const deps = dependencies(fetcher);
    const { result } = renderHook(() => useContentReplacementJob(credentials, null, deps.value));
    await act(async () => result.current.createJob(configuration));
    let firstRun!: Promise<void>;
    act(() => { firstRun = result.current.startScan(); });
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    const baseSave = deps.store.save.getMockImplementation()!;
    deps.store.save.mockImplementationOnce(async (job, expectedRevision) => {
      await pausedSave.promise;
      return baseSave(job, expectedRevision);
    });

    let resumed!: Promise<void>;
    act(() => {
      result.current.pause();
      resumed = result.current.resume();
    });
    await Promise.resolve();
    expect(fetcher).toHaveBeenCalledTimes(1);

    pausedSave.resolve();
    firstResponse.resolve(jsonResponse({ ok: false, error: "stale" }, 500));
    await act(async () => {
      await firstRun;
      await resumed;
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("stops immediately on persistence failure and retains the last persisted state", async () => {
    const fetcher = vi.fn().mockResolvedValue(jsonResponse({
      ok: true,
      result: {
        candidates: [], answerCursors: [], nextCursor: null, inspectedCount: 0, pageKind: "questions",
        progress: inventoryProgress(),
      },
      throttleNotices: [],
    }));
    const deps = dependencies(fetcher);
    const { result } = renderHook(() => useContentReplacementJob(credentials, null, deps.value));
    await act(async () => result.current.createJob(configuration));
    const persistedBeforeRun = result.current.job;
    deps.store.save.mockRejectedValueOnce(new Error("database leaked top-secret-token"));

    await act(async () => result.current.startScan());

    expect(fetcher).not.toHaveBeenCalled();
    expect(result.current.job).toEqual(persistedBeforeRun);
    expect(result.current.storageError).toBe("Content replacement progress could not be saved.");
  });

  it("retries a failed initial save and starts the scan only after persistence succeeds", async () => {
    const fetcher = vi.fn().mockResolvedValue(jsonResponse({
      ok: true,
      result: {
        candidates: [], answerCursors: [], nextCursor: null, inspectedCount: 0, pageKind: "questions",
        progress: inventoryProgress(),
      },
      throttleNotices: [],
    }));
    const deps = dependencies(fetcher);
    deps.store.save.mockRejectedValueOnce(new Error("quota"));
    const { result } = renderHook(() => useContentReplacementJob(credentials, null, deps.value));

    let first = true;
    await act(async () => { first = await result.current.createJob(configuration); });
    expect(first).toBe(false);
    expect(result.current.storageError).toBe("Content replacement progress could not be saved.");
    expect(result.current.job).toBeNull();
    expect(fetcher).not.toHaveBeenCalled();

    let second = false;
    await act(async () => { second = await result.current.createJob(configuration); });
    expect(second).toBe(true);
    expect(result.current.storageError).toBeNull();
    await act(async () => result.current.startScan());
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("atomically persists every recovery record before any apply request", async () => {
    const proposal = await questionProposal();
    const initial = await scannedReviewJob(proposal);
    const snapshotSave = deferred<void>();
    const fetcher = vi.fn().mockResolvedValue(jsonResponse({
      ok: true,
      result: { status: "updated", observedRequestChecksum: proposal.proposedRequestChecksum },
      throttleNotices: [],
    }));
    const deps = dependencies(fetcher, initial);
    const baseSave = deps.store.save.getMockImplementation()!;
    deps.store.save.mockImplementationOnce(async (job, expectedRevision) => {
      await snapshotSave.promise;
      return baseSave(job, expectedRevision);
    });
    const { result } = renderHook(() => useContentReplacementJob(credentials, initial, deps.value));
    let preparation!: Promise<boolean>;
    act(() => { preparation = result.current.prepareApply(createReplacementSelectionSnapshot(initial.proposals)); });
    await waitFor(() => expect(deps.store.save).toHaveBeenCalledTimes(1));
    expect(result.current.job).toEqual(initial);
    expect(fetcher).not.toHaveBeenCalled();
    snapshotSave.resolve();
    await act(async () => preparation);
    expect(result.current.job?.recoverySnapshotStatus).toBe("ready");
    deps.store.load.mockResolvedValueOnce(result.current.job);

    await act(async () => result.current.startApply());
    const snapshotSaveOrder = deps.store.save.mock.invocationCallOrder[0];
    expect(snapshotSaveOrder).toBeLessThan(fetcher.mock.invocationCallOrder[0]);
    const body = JSON.parse(fetcher.mock.calls[0][1].body as string);
    expect(body).not.toHaveProperty("replacementBody");
    expect(body).not.toHaveProperty("proposal");
    expect(JSON.stringify(body)).not.toContain("kept locally");
  });

  it("bulk-selects captured unique keys with one reducer transition and one durable save", async () => {
    const first = await questionProposal(1);
    const second = await questionProposal(2);
    const initial = await scannedReviewJob(first, second);
    const deps = dependencies(vi.fn(), initial);
    const { result } = renderHook(() => useContentReplacementJob(credentials, initial, deps.value));

    let saved = false;
    await act(async () => {
      saved = await result.current.setItemsIncluded(["question:2", "question:1"], false);
    });

    expect(saved).toBe(true);
    expect(deps.store.save).toHaveBeenCalledOnce();
    expect(result.current.job?.proposals["question:1"]).toMatchObject({ included: false, exclusionReason: "bulk" });
    expect(result.current.job?.proposals["question:2"]).toMatchObject({ included: false, exclusionReason: "bulk" });

    let invalid = true;
    await act(async () => {
      invalid = await result.current.setItemsIncluded(["question:1", "question:1"], true);
    });
    expect(invalid).toBe(false);
    expect(deps.store.save).toHaveBeenCalledOnce();
  });

  it("bulk-updates thousands of captured keys with one full-job save", async () => {
    const proposals = await Promise.all(Array.from({ length: 2_000 }, (_, index) => questionProposal(index + 1)));
    const initial = await scannedReviewJob(...proposals);
    const deps = dependencies(vi.fn(), initial);
    const { result } = renderHook(() => useContentReplacementJob(credentials, initial, deps.value));
    const itemKeys = proposals.map((candidate) =>
      `question:${candidate.before.ref.kind === "question" ? candidate.before.ref.questionId : 0}`
    );

    let saved = false;
    await act(async () => {
      saved = await result.current.setItemsIncluded(itemKeys, false);
    });

    expect(saved).toBe(true);
    expect(deps.store.save).toHaveBeenCalledOnce();
    expect(Object.values(result.current.job!.proposals).filter((candidate) => candidate.included)).toHaveLength(0);
  });

  it("returns selection-save failure and leaves the confirmed job unchanged", async () => {
    const initial = await scannedReviewJob(await questionProposal());
    const deps = dependencies(vi.fn(), initial);
    deps.store.save.mockRejectedValueOnce(new Error("quota"));
    const { result } = renderHook(() => useContentReplacementJob(credentials, initial, deps.value));

    let saved = true;
    await act(async () => { saved = await result.current.setItemIncluded("question:1", false); });

    expect(saved).toBe(false);
    expect(result.current.job).toEqual(initial);
    expect(result.current.storageError).toBe("Content replacement progress could not be saved.");
  });

  it("rolls back a failed bulk selection as one durable save", async () => {
    const initial = await scannedReviewJob(await questionProposal(1), await questionProposal(2));
    const deps = dependencies(vi.fn(), initial);
    deps.store.save.mockRejectedValueOnce(new Error("quota"));
    const { result } = renderHook(() => useContentReplacementJob(credentials, initial, deps.value));

    let saved = true;
    await act(async () => {
      saved = await result.current.setItemsIncluded(["question:2", "question:1"], false);
    });

    expect(saved).toBe(false);
    expect(deps.store.save).toHaveBeenCalledOnce();
    expect(result.current.job).toEqual(initial);
  });

  it("serializes a deferred selection save before preparing its exact reviewed snapshot", async () => {
    const initial = await scannedReviewJob(await questionProposal(1), await questionProposal(2));
    const reviewed = reduceReplacementJob(initial, {
      type: "review/set-included",
      itemKey: "question:1",
      included: false,
      reason: "user",
      at: LATER,
    });
    const expectedSelection = createReplacementSelectionSnapshot(reviewed.proposals);
    const gate = deferred<void>();
    const deps = dependencies(vi.fn(), initial);
    const baseSave = deps.store.save.getMockImplementation()!;
    deps.store.save.mockImplementationOnce(async (saved, expectedRevision) => {
      await gate.promise;
      return baseSave(saved, expectedRevision);
    });
    const { result } = renderHook(() => useContentReplacementJob(credentials, initial, deps.value));

    let selection!: Promise<boolean>;
    let preparation!: Promise<boolean>;
    act(() => {
      selection = result.current.setItemIncluded("question:1", false);
      preparation = result.current.prepareApply(expectedSelection);
    });
    await waitFor(() => expect(deps.store.save).toHaveBeenCalledOnce());
    expect(result.current.job).toEqual(initial);
    gate.resolve();

    let selectionSaved = false;
    let prepared = false;
    await act(async () => {
      selectionSaved = await selection;
      prepared = await preparation;
    });
    expect(selectionSaved).toBe(true);
    expect(prepared).toBe(true);
    expect(deps.store.save).toHaveBeenCalledTimes(2);
    expect(result.current.job?.stage).toBe("apply");
  });

  it("refuses an expected newer selection after its save fails", async () => {
    const initial = await scannedReviewJob(await questionProposal());
    const reviewed = reduceReplacementJob(initial, {
      type: "review/set-included",
      itemKey: "question:1",
      included: false,
      reason: "user",
      at: LATER,
    });
    const expectedSelection = createReplacementSelectionSnapshot(reviewed.proposals);
    const deps = dependencies(vi.fn(), initial);
    deps.store.save.mockRejectedValueOnce(new Error("quota"));
    const { result } = renderHook(() => useContentReplacementJob(credentials, initial, deps.value));

    let selectionSaved = true;
    let prepared = true;
    await act(async () => {
      selectionSaved = await result.current.setItemIncluded("question:1", false);
      prepared = await result.current.prepareApply(expectedSelection);
    });

    expect(selectionSaved).toBe(false);
    expect(prepared).toBe(false);
    expect(deps.store.save).toHaveBeenCalledOnce();
    expect(result.current.job).toEqual(initial);
  });

  it("refuses apply when the reloaded persisted snapshot is stale", async () => {
    const proposal = await questionProposal();
    const review = await scannedReviewJob(proposal);
    const deps = dependencies(vi.fn(), review);
    const { result } = renderHook(() => useContentReplacementJob(credentials, review, deps.value));
    await act(async () => result.current.prepareApply(createReplacementSelectionSnapshot(review.proposals)));
    deps.store.load.mockResolvedValueOnce(review);

    await act(async () => result.current.startApply());

    expect(deps.value.fetch).not.toHaveBeenCalled();
    expect(result.current.storageError).toBe("Stored recovery preparation is missing or stale.");
  });

  it("rejects a malformed apply response union without persisting returned text", async () => {
    const proposal = await questionProposal();
    const review = await scannedReviewJob(proposal);
    const prepared = prepareJob(review, AT);
    const fetcher = vi.fn().mockResolvedValue(jsonResponse({
      ok: true,
      result: { status: "updated", observedRequestChecksum: proposal.proposedRequestChecksum },
      throttleNotices: [{ kind: "backoff", seconds: "top-secret-token" }],
    }));
    const deps = dependencies(fetcher, prepared);
    const { result } = renderHook(() => useContentReplacementJob(credentials, prepared, deps.value));

    await act(async () => result.current.startApply());

    expect(result.current.job?.proposals["question:1"]).toMatchObject({
      status: "failed",
      failure: {
        category: "server",
        retryable: true,
        message: "The content replacement service returned an invalid response.",
      },
    });
    expect(JSON.stringify(deps.store.current())).not.toContain("top-secret-token");
  });

  it("uses newly supplied credentials on resume without persisting them", async () => {
    const fetcher = vi.fn().mockResolvedValue(jsonResponse({
      ok: true,
      result: {
        candidates: [], answerCursors: [], nextCursor: null, inspectedCount: 0, pageKind: "questions",
        progress: inventoryProgress(),
      },
      throttleNotices: [],
    }));
    const deps = dependencies(fetcher);
    const fresh = { ...credentials, accessToken: "fresh-token" };
    const hook = renderHook(
      ({ supplied }) => useContentReplacementJob(supplied, null, deps.value),
      { initialProps: { supplied: credentials } },
    );
    await act(async () => hook.result.current.createJob(configuration));
    hook.rerender({ supplied: fresh });

    await act(async () => hook.result.current.resume());

    const body = JSON.parse(fetcher.mock.calls[0][1].body as string);
    expect(body.credentials.accessToken).toBe("fresh-token");
    expect(deps.store.save.mock.calls.every(([job]) => !JSON.stringify(job).includes("fresh-token"))).toBe(true);
  });

  it("never transmits credentials from a different Enterprise origin", async () => {
    const fetcher = vi.fn();
    const deps = dependencies(fetcher);
    const mismatched = { ...credentials, baseUrl: "https://other.stackenterprise.co", accessToken: "origin-b-token" };
    const hook = renderHook(
      ({ supplied }) => useContentReplacementJob(supplied, null, deps.value),
      { initialProps: { supplied: credentials } },
    );
    await act(async () => hook.result.current.createJob(configuration));
    hook.rerender({ supplied: mismatched });

    await act(async () => hook.result.current.resume());

    expect(fetcher).not.toHaveBeenCalled();
    expect(hook.result.current.job).toMatchObject({
      status: "paused",
      operationError: { category: "authorization" },
    });
    expect(JSON.stringify(deps.store.current())).not.toContain("origin-b-token");
  });

  it.each([
    ["PAT-only", { instanceType: "enterprise", baseUrl: "https://example.stackenterprise.co", pat: "pat" }],
    ["missing auth source", { ...credentials, authSource: undefined }],
    ["missing write scope", { ...credentials, oauthScopes: ["no_expiry"] }],
    ["missing expiry", { ...credentials, oauthScopes: ["write_access"], accessTokenExpiresAt: undefined }],
  ] as const)("pauses before apply activation for %s credentials", async (_label, supplied) => {
    const proposal = await questionProposal();
    const prepared = prepareJob(await scannedReviewJob(proposal), AT);
    const deps = dependencies(vi.fn(), prepared);
    const { result } = renderHook(() => useContentReplacementJob(supplied as SessionCredentials, prepared, deps.value));

    await act(async () => result.current.startApply());

    expect(deps.value.fetch).not.toHaveBeenCalled();
    expect(result.current.job).toMatchObject({
      status: "paused", operationError: { category: "authorization" },
      proposals: { "question:1": { status: "ready-to-apply", attemptCount: 0 } },
    });
  });

  it("accepts a manual Enterprise token while ignoring stale OAuth metadata", async () => {
    const proposal = await questionProposal();
    const prepared = prepareJob(await scannedReviewJob(proposal), AT);
    const fetcher = vi.fn().mockResolvedValue(jsonResponse({
      ok: true,
      result: { status: "updated", observedRequestChecksum: proposal.proposedRequestChecksum },
      throttleNotices: [],
    }));
    const deps = dependencies(fetcher, prepared);
    const manual = {
      ...credentials,
      authSource: "manual-enterprise-token" as const,
      accessTokenExpiresAt: "2000-01-01T00:00:00.000Z",
      oauthScopes: [],
    };
    const { result } = renderHook(() => useContentReplacementJob(manual, prepared, deps.value));

    await act(async () => result.current.startApply());

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(result.current.job?.proposals["question:1"].status).toBe("applied");
  });

  it("turns an item-level permission response into a reconnectable credential interruption", async () => {
    const proposal = await questionProposal();
    const prepared = prepareJob(await scannedReviewJob(proposal), AT);
    const fetcher = vi.fn().mockResolvedValue(jsonResponse({
      ok: true,
      result: { status: "permission", error: "upstream detail" },
      throttleNotices: [],
    }));
    const deps = dependencies(fetcher, prepared);
    const { result } = renderHook(() => useContentReplacementJob(credentials, prepared, deps.value));

    await act(async () => result.current.startApply());

    expect(result.current.job).toMatchObject({
      status: "paused",
      operationError: { category: "authorization", retryable: true },
      proposals: { "question:1": { status: "ready-to-apply" } },
    });
    expect(result.current.credentialReadiness).toMatchObject({ valid: false, refreshRequired: true });
    expect(JSON.stringify(deps.store.current())).not.toMatch(/top-secret-token|credentialFingerprint/i);
  });

  it("interrupts a persisted applying item during rehydration and requires explicit resume", async () => {
    const proposal = await questionProposal();
    let initial = prepareJob(await scannedReviewJob(proposal), AT);
    initial = reduceReplacementJob(initial, { type: "apply/start", at: AT });
    initial = reduceReplacementJob(initial, { type: "apply/item-started", itemKey: "question:1", at: AT });
    const deps = dependencies(vi.fn(), initial);

    const { result } = renderHook(() => useContentReplacementJob(credentials, initial, deps.value));

    await waitFor(() => expect(result.current.job?.status).toBe("paused"));
    expect(result.current.job?.proposals["question:1"].status).toBe("ready-to-apply");
    expect(deps.value.fetch).not.toHaveBeenCalled();
    expect(deps.store.save).toHaveBeenCalled();
  });

  it("keeps a newly selected job visible when the prior interrupted checkpoint settles", async () => {
    const interruptedA = runningScanJob("job-a");
    const selectedB = createScanJob("job-b");
    const checkpointGate = deferred<void>();
    const jobs = new Map([[interruptedA.id, interruptedA], [selectedB.id, selectedB]]);
    const storage = multiJobStorage(jobs, { delayedSaveId: interruptedA.id, saveGate: checkpointGate.promise });
    const deps = { ...dependencies().value, storage };
    const hook = renderHook(
      ({ initial }) => useContentReplacementJob(credentials, initial, deps),
      { initialProps: { initial: interruptedA as PersistedContentReplacementJob | null } },
    );

    expect(hook.result.current.rehydrating).toBe(true);
    await waitFor(() => expect(storage.save).toHaveBeenCalledWith(
      expect.objectContaining({ id: "job-a", status: "paused" }),
      interruptedA.revision,
    ));

    hook.rerender({ initial: selectedB });
    expect(hook.result.current.rehydrating).toBe(false);
    expect(hook.result.current.job?.id).toBe("job-b");

    checkpointGate.resolve();
    await waitFor(() => expect(jobs.get("job-a")?.status).toBe("paused"));
    expect(hook.result.current.job?.id).toBe("job-b");
  });

  it("keeps a newly created job visible when an earlier interrupted checkpoint settles", async () => {
    const interruptedA = runningScanJob("job-a");
    const checkpointGate = deferred<void>();
    const jobs = new Map([[interruptedA.id, interruptedA]]);
    const storage = multiJobStorage(jobs, { delayedSaveId: interruptedA.id, saveGate: checkpointGate.promise });
    const base = dependencies();
    const deps = { ...base.value, storage, createId: () => "job-new" };
    const hook = renderHook(
      ({ initial }) => useContentReplacementJob(credentials, initial, deps),
      { initialProps: { initial: interruptedA as PersistedContentReplacementJob | null } },
    );

    await waitFor(() => expect(storage.save).toHaveBeenCalledTimes(1));
    let blockedCreation = true;
    await act(async () => { blockedCreation = await hook.result.current.createJob(configuration); });
    expect(blockedCreation).toBe(false);
    expect(jobs.has("job-new")).toBe(false);

    hook.rerender({ initial: null });
    let created = false;
    await act(async () => { created = await hook.result.current.createJob(configuration); });
    expect(created).toBe(true);
    expect(hook.result.current.job?.id).toBe("job-new");

    checkpointGate.resolve();
    await waitFor(() => expect(jobs.get("job-a")?.status).toBe("paused"));
    expect(hook.result.current.job?.id).toBe("job-new");
  });

  it("rehydrates an unmounted active scan through a persisted paused checkpoint", async () => {
    const pending = deferred<Response>();
    const fetcher = vi.fn().mockReturnValue(pending.promise);
    const deps = dependencies(fetcher);
    const first = renderHook(() => useContentReplacementJob(credentials, null, deps.value));
    await act(async () => first.result.current.createJob(configuration));
    let scan!: Promise<void>;
    act(() => { scan = first.result.current.startScan(); });
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    first.unmount();
    const persistedRunning = deps.store.current();
    expect(persistedRunning?.status).toBe("running");

    const second = renderHook(() => useContentReplacementJob(credentials, persistedRunning, deps.value));
    await waitFor(() => expect(second.result.current.job?.status).toBe("paused"));
    expect(second.result.current.job?.inventoryQueue).toEqual([{ kind: "questions", page: 1 }]);

    pending.resolve(jsonResponse({ ok: false, error: "stale" }, 500));
    await act(async () => scan);
    expect(fetcher).toHaveBeenCalledTimes(1);
    second.unmount();
  });

  it("accepts a valid Full-audit inventory result with the required progress delta", async () => {
    const fetcher = vi.fn().mockResolvedValue(jsonResponse({
      ok: true,
      result: {
        candidates: [],
        answerCursors: [],
        nextCursor: null,
        inspectedCount: 1,
        pageKind: "questions",
        progress: {
          apiRequestsCompleted: 1,
          searchPages: 0,
          searchTermsCompleted: 0,
          answerBearingQuestionsQueued: 0,
          zeroAnswerQuestionsSkipped: 0,
        },
      },
      throttleNotices: [],
    }));
    const deps = dependencies(fetcher);
    const { result } = renderHook(() => useContentReplacementJob(credentials, null, deps.value));
    await act(async () => result.current.createJob(configuration));

    await act(async () => result.current.startScan());

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(result.current.job).toMatchObject({ stage: "review", status: "completed" });
  });

  it("accepts a Full-audit questions page when valid-zero answers were skipped", async () => {
    const fetcher = vi.fn().mockResolvedValue(jsonResponse({
      ok: true,
      result: {
        candidates: [],
        answerCursors: [],
        nextCursor: null,
        inspectedCount: 1,
        pageKind: "questions",
        progress: {
          apiRequestsCompleted: 1,
          searchPages: 0,
          searchTermsCompleted: 0,
          answerBearingQuestionsQueued: 0,
          zeroAnswerQuestionsSkipped: 1,
        },
      },
      throttleNotices: [],
    }));
    const deps = dependencies(fetcher);
    const answersEnabled = {
      ...configuration,
      contentTypes: { questions: true, answers: true, articles: false },
    };
    const { result } = renderHook(() => useContentReplacementJob(credentials, null, deps.value));
    await act(async () => result.current.createJob(answersEnabled));

    await act(async () => result.current.startScan());

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(result.current.job).toMatchObject({ stage: "review", status: "completed" });
  });

  it.each([
    ["missing progress", undefined],
    ["an unknown progress field", {
      apiRequestsCompleted: 1,
      searchPages: 0,
      searchTermsCompleted: 0,
      answerBearingQuestionsQueued: 0,
      zeroAnswerQuestionsSkipped: 0,
      extra: 0,
    }],
    ["a negative progress counter", {
      apiRequestsCompleted: -1,
      searchPages: 0,
      searchTermsCompleted: 0,
      answerBearingQuestionsQueued: 0,
      zeroAnswerQuestionsSkipped: 0,
    }],
    ["a fractional progress counter", {
      apiRequestsCompleted: 1.5,
      searchPages: 0,
      searchTermsCompleted: 0,
      answerBearingQuestionsQueued: 0,
      zeroAnswerQuestionsSkipped: 0,
    }],
    ["an unsafe progress counter", {
      apiRequestsCompleted: Number.MAX_SAFE_INTEGER + 1,
      searchPages: 0,
      searchTermsCompleted: 0,
      answerBearingQuestionsQueued: 0,
      zeroAnswerQuestionsSkipped: 0,
    }],
  ])("rejects an inventory result with %s", async (_label, progress) => {
    const fetcher = vi.fn().mockResolvedValue(jsonResponse({
      ok: true,
      result: {
        candidates: [], answerCursors: [], nextCursor: null, inspectedCount: 0, pageKind: "questions",
        ...(progress === undefined ? {} : { progress }),
      },
      throttleNotices: [],
    }));
    const deps = dependencies(fetcher);
    const { result } = renderHook(() => useContentReplacementJob(credentials, null, deps.value));
    await act(async () => result.current.createJob(configuration));

    await act(async () => result.current.startScan());

    expect(result.current.job).toMatchObject({ status: "failed", failure: { category: "server" } });
  });

  it("pauses apply before item activation when compatible credentials are unavailable", async () => {
    const proposal = await questionProposal();
    const prepared = prepareJob(await scannedReviewJob(proposal), AT);
    const deps = dependencies(vi.fn(), prepared);
    const { result } = renderHook(() => useContentReplacementJob(null, prepared, deps.value));

    await act(async () => result.current.startApply());

    expect(deps.value.fetch).not.toHaveBeenCalled();
    expect(result.current.job).toMatchObject({
      status: "paused",
      operationError: { category: "authorization" },
      proposals: { "question:1": { status: "ready-to-apply", attemptCount: 0 } },
    });
  });

  it("rejects malformed or discontinuous scan success before reducer mutation", async () => {
    const fetcher = vi.fn().mockResolvedValue(jsonResponse({
      ok: true,
      result: {
        candidates: [{ kind: "question", questionId: 1 }], answerCursors: [],
        nextCursor: { kind: "questions", page: 3 }, inspectedCount: 1, pageKind: "questions",
        progress: inventoryProgress(),
      },
      throttleNotices: [],
    }));
    const deps = dependencies(fetcher);
    const { result } = renderHook(() => useContentReplacementJob(credentials, null, deps.value));
    await act(async () => result.current.createJob(configuration));

    await act(async () => result.current.startScan());

    expect(result.current.job).toMatchObject({ status: "failed", failure: { category: "server" } });
    expect(result.current.job?.detailQueue).toEqual([]);
  });

  it.each([
    ["disabled answers", configuration, 1, [{ kind: "answers", questionId: 1, page: 1 }], [{ kind: "question", questionId: 1 }], 0],
    ["omitted answer cursor", { ...configuration, contentTypes: { questions: true, answers: true, articles: false } }, 2,
      [{ kind: "answers", questionId: 1, page: 1 }], [{ kind: "question", questionId: 1 }], 2],
    ["duplicate answer cursor", { ...configuration, contentTypes: { questions: true, answers: true, articles: false } }, 2,
      [{ kind: "answers", questionId: 1, page: 1 }, { kind: "answers", questionId: 1, page: 1 }], [{ kind: "question", questionId: 1 }], 2],
  ] as const)("blocks %s inventory before queue mutation", async (
    _label,
    config,
    inspectedCount,
    answerCursors,
    candidates,
    answerBearingQuestionsQueued,
  ) => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        ok: true,
        result: {
          candidates,
          answerCursors,
          nextCursor: null,
          inspectedCount,
          pageKind: "questions",
          progress: {
            ...inventoryProgress(),
            answerBearingQuestionsQueued,
          },
        },
        throttleNotices: [],
      }))
      .mockResolvedValue(jsonResponse({ ok: false, error: "should not continue" }, 500));
    const deps = dependencies(fetcher);
    const { result } = renderHook(() => useContentReplacementJob(credentials, null, deps.value));
    await act(async () => result.current.createJob(config as ReplacementConfiguration));

    await act(async () => result.current.startScan());

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(result.current.job).toMatchObject({ status: "failed", detailQueue: [] });
  });

  it("serializes a deferred local save before delete so delete wins on disk and in memory", async () => {
    const proposal = await questionProposal();
    const initial = await scannedReviewJob(proposal);
    const gate = deferred<void>();
    const deps = dependencies(vi.fn(), initial);
    const baseSave = deps.store.save.getMockImplementation()!;
    deps.store.save.mockImplementationOnce(async (saved, expectedRevision) => {
      await gate.promise;
      return baseSave(saved, expectedRevision);
    });
    const { result } = renderHook(() => useContentReplacementJob(credentials, initial, deps.value));
    let prepare!: Promise<boolean>;
    act(() => { prepare = result.current.prepareApply(createReplacementSelectionSnapshot(initial.proposals)); });
    await waitFor(() => expect(deps.store.save).toHaveBeenCalledTimes(1));
    let deletion!: Promise<void>;
    act(() => { deletion = result.current.deleteJob(); });

    expect(deps.store.delete).not.toHaveBeenCalled();
    gate.resolve();
    await act(async () => { await prepare; await deletion; });

    expect(deps.store.save.mock.invocationCallOrder[0]).toBeLessThan(deps.store.delete.mock.invocationCallOrder[0]);
    expect(deps.store.current()).toBeNull();
    expect(result.current.job).toBeNull();
  });

  it("serializes a deferred save and delete across hook remounts for the same job", async () => {
    const proposal = await questionProposal();
    const initial = await scannedReviewJob(proposal);
    const gate = deferred<void>();
    const deps = dependencies(vi.fn(), initial);
    const baseSave = deps.store.save.getMockImplementation()!;
    const baseDelete = deps.store.delete.getMockImplementation()!;
    const events: string[] = [];
    deps.store.save.mockImplementationOnce(async (saved, expectedRevision) => {
      events.push("save-start");
      await gate.promise;
      await baseSave(saved, expectedRevision);
      events.push("save-complete");
      return { status: "saved" as const };
    });
    deps.store.delete.mockImplementationOnce(async () => {
      events.push("delete");
      await baseDelete();
    });
    const first = renderHook(() => useContentReplacementJob(credentials, initial, deps.value));
    let prepare!: Promise<boolean>;
    act(() => { prepare = first.result.current.prepareApply(createReplacementSelectionSnapshot(initial.proposals)); });
    await waitFor(() => expect(events).toEqual(["save-start"]));
    first.unmount();

    const second = renderHook(() => useContentReplacementJob(credentials, deps.store.current(), deps.value));
    let deletion!: Promise<void>;
    act(() => { deletion = second.result.current.deleteJob(); });
    await Promise.resolve();
    expect(events).toEqual(["save-start"]);

    gate.resolve();
    await act(async () => { await prepare; await deletion; });

    expect(events).toEqual(["save-start", "save-complete", "delete"]);
    expect(deps.store.current()).toBeNull();
    expect(second.result.current.job).toBeNull();
    const third = renderHook(() => useContentReplacementJob(credentials, deps.store.current(), deps.value));
    expect(third.result.current.job).toBeNull();
  });

  it("serializes a deferred save and cancellation across hook remounts for the same job", async () => {
    const proposal = await questionProposal();
    const initial = prepareJob(await scannedReviewJob(proposal), AT);
    const gate = deferred<void>();
    const deps = dependencies(vi.fn(), initial);
    const baseSave = deps.store.save.getMockImplementation()!;
    const events: string[] = [];
    deps.store.save.mockImplementationOnce(async (saved, expectedRevision) => {
      events.push("save-start");
      await gate.promise;
      await baseSave(saved, expectedRevision);
      events.push("save-complete");
      return { status: "saved" as const };
    });
    deps.store.save.mockImplementationOnce(async (saved, expectedRevision) => {
      await baseSave(saved, expectedRevision);
      events.push("cancel-save");
      return { status: "saved" as const };
    });
    const first = renderHook(() => useContentReplacementJob(credentials, initial, deps.value));
    let firstCancellation!: Promise<void>;
    act(() => { firstCancellation = first.result.current.cancel(); });
    await waitFor(() => expect(events).toEqual(["save-start"]));
    first.unmount();

    const second = renderHook(() => useContentReplacementJob(credentials, deps.store.current(), deps.value));
    let cancellation!: Promise<void>;
    act(() => { cancellation = second.result.current.cancel(); });
    await Promise.resolve();
    expect(events).toEqual(["save-start"]);

    gate.resolve();
    await act(async () => { await firstCancellation; await cancellation; });

    expect(events).toEqual(["save-start", "save-complete", "cancel-save"]);
    expect(deps.store.current()).toMatchObject({ status: "cancelled" });
    expect(second.result.current.job).toMatchObject({ status: "cancelled" });
    const third = renderHook(() => useContentReplacementJob(credentials, deps.store.current(), deps.value));
    expect(third.result.current.job).toMatchObject({ status: "cancelled" });
  });

  it("refuses stale Apply preparation after a remounted controller loses a selection CAS race", async () => {
    const initial = await scannedReviewJob(await questionProposal(1), await questionProposal(2));
    const staleSelection = createReplacementSelectionSnapshot(initial.proposals);
    const gate = deferred<void>();
    const deps = dependencies(vi.fn(), initial);
    const baseSave = deps.store.save.getMockImplementation()!;
    deps.store.save.mockImplementationOnce(async (saved, expectedRevision) => {
      await gate.promise;
      return baseSave(saved, expectedRevision);
    });
    const first = renderHook(() => useContentReplacementJob(credentials, initial, deps.value));

    let selection!: Promise<boolean>;
    act(() => { selection = first.result.current.setItemIncluded("question:1", false); });
    await waitFor(() => expect(deps.store.save).toHaveBeenCalledOnce());
    first.unmount();

    const second = renderHook(() => useContentReplacementJob(credentials, initial, deps.value));
    let stalePrepare!: Promise<boolean>;
    act(() => { stalePrepare = second.result.current.prepareApply(staleSelection); });
    gate.resolve();

    let selected = false;
    let prepared = true;
    await act(async () => {
      selected = await selection;
      prepared = await stalePrepare;
    });

    expect(selected).toBe(true);
    expect(prepared).toBe(false);
    expect(deps.store.current()).toMatchObject({
      stage: "review",
      proposals: { "question:1": { included: false }, "question:2": { included: true } },
    });
    expect(second.result.current.job).toEqual(deps.store.current());
    expect(second.result.current.storageError).toBe(
      "Content replacement changed in another session. Review the latest saved selection and retry.",
    );

    let retried = false;
    await act(async () => {
      retried = await second.result.current.prepareApply(
        createReplacementSelectionSnapshot(second.result.current.job!.proposals),
      );
    });
    expect(retried).toBe(true);
    expect(deps.store.current()).toMatchObject({ stage: "apply" });
    expect(second.result.current.storageError).toBeNull();
  });

  it("composes concurrent single and bulk selection controllers from the latest durable revision", async () => {
    const initial = await scannedReviewJob(await questionProposal(1), await questionProposal(2));
    const gate = deferred<void>();
    const deps = dependencies(vi.fn(), initial);
    const baseSave = deps.store.save.getMockImplementation()!;
    deps.store.save.mockImplementationOnce(async (saved, expectedRevision) => {
      await gate.promise;
      return baseSave(saved, expectedRevision);
    });
    const first = renderHook(() => useContentReplacementJob(credentials, initial, deps.value));
    const second = renderHook(() => useContentReplacementJob(credentials, initial, deps.value));

    let single!: Promise<boolean>;
    let bulk!: Promise<boolean>;
    act(() => {
      single = first.result.current.setItemIncluded("question:1", false);
      bulk = second.result.current.setItemsIncluded(["question:2"], false);
    });
    await waitFor(() => expect(deps.store.save).toHaveBeenCalledOnce());
    gate.resolve();
    await act(async () => { await single; await bulk; });

    expect(deps.store.save).toHaveBeenCalledTimes(2);
    expect(deps.store.current()?.proposals).toMatchObject({
      "question:1": { included: false },
      "question:2": { included: false },
    });
    expect(second.result.current.job).toEqual(deps.store.current());
  });

  it("rejects malformed detail proposal evidence before reducer mutation", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        ok: true,
        result: {
          candidates: [{ kind: "question", questionId: 1 }], answerCursors: [], nextCursor: null,
          inspectedCount: 1, pageKind: "questions",
          progress: inventoryProgress(),
        }, throttleNotices: [],
      }))
      .mockResolvedValueOnce(jsonResponse({
        ok: true,
        result: { proposals: [{}], inspectedCount: 1, protectedOccurrenceCount: 0 },
        throttleNotices: [],
      }));
    const deps = dependencies(fetcher);
    const { result } = renderHook(() => useContentReplacementJob(credentials, null, deps.value));
    await act(async () => result.current.createJob(configuration));

    await act(async () => result.current.startScan());

    expect(result.current.job).toMatchObject({ status: "failed", failure: { category: "server" } });
    expect(result.current.job?.proposals).toEqual({});
  });

  it("persists an exhausted 429 deadline and retries the identical cursor after waiting", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        ok: false,
        error: {
          code: "rate_limited", message: "Content scan is temporarily rate limited.", retryAfterSeconds: 4,
        },
      }, 429))
      .mockResolvedValueOnce(jsonResponse({
        ok: true,
        result: {
          candidates: [], answerCursors: [], nextCursor: null, inspectedCount: 0, pageKind: "questions",
          progress: inventoryProgress(),
        },
        throttleNotices: [],
      }));
    const deps = dependencies(fetcher);
    const { result } = renderHook(() => useContentReplacementJob(credentials, null, deps.value));
    await act(async () => result.current.createJob(configuration));

    await act(async () => result.current.startScan());

    expect(deps.value.waitUntil).toHaveBeenCalledWith("2026-09-01T12:01:04.000Z", expect.any(AbortSignal));
    expect(JSON.parse(fetcher.mock.calls[0][1].body as string).cursor)
      .toEqual(JSON.parse(fetcher.mock.calls[1][1].body as string).cursor);
    const deadlineSave = deps.store.save.mock.calls.findIndex(([saved]) => saved.nextRetryAt !== undefined);
    expect(deadlineSave).toBeGreaterThanOrEqual(0);
    expect(deps.store.save.mock.invocationCallOrder[deadlineSave])
      .toBeLessThan((deps.value.waitUntil as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0]);
  });

  it("does not delete snapshots while a controlled request can still complete", async () => {
    const pending = deferred<Response>();
    const proposal = await questionProposal();
    const initial = await appliedJob(proposal);
    const fetcher = vi.fn().mockReturnValue(pending.promise);
    const deps = dependencies(fetcher, initial);
    const { result } = renderHook(() => useContentReplacementJob(credentials, initial, deps.value));
    let preview!: Promise<void>;
    act(() => { preview = result.current.prepareRecovery(["question:1"]); });
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));

    await act(async () => result.current.deleteRecoverySnapshots());
    expect(result.current.job?.recoverySnapshotStatus).toBe("ready");

    pending.resolve(jsonResponse({ ok: false, error: "safe" }, 400));
    await act(async () => preview);
    expect(deps.store.delete).not.toHaveBeenCalled();
  });

  it("previews and recovers sequentially with metadata-free exact wire models", async () => {
    const proposal = await questionProposal();
    const initial = await appliedJob(proposal);
    const currentWireModel = {
      kind: "question" as const,
      ref: { kind: "question" as const, questionId: 1 },
      request: { title: "New title", body: "Body", tags: ["tag"] },
    };
    const fetcher = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        ok: true,
        result: {
          status: "recoverable", currentRequestModel: currentWireModel,
          priorRequestModel: { ...proposal.before, metadata: undefined },
          observedRequestChecksum: proposal.proposedRequestChecksum,
        },
        throttleNotices: [],
      }))
      .mockResolvedValueOnce(jsonResponse({
        ok: true,
        result: { status: "recovered", observedRequestChecksum: proposal.scannedRequestChecksum },
        throttleNotices: [],
      }));
    const deps = dependencies(fetcher, initial);
    const { result } = renderHook(() => useContentReplacementJob(credentials, initial, deps.value));

    await act(async () => result.current.prepareRecovery(["question:1"]));
    expect(result.current.job?.proposals["question:1"].recovery?.preview?.status).toBe("recoverable");
    expect(fetcher.mock.calls[0][0]).toBe("/api/write-tools/content-replacement/recover");
    const previewBody = JSON.parse(fetcher.mock.calls[0][1].body as string);
    expect(previewBody.action).toBe("preview");
    expect(previewBody.priorRequestModel).not.toHaveProperty("metadata");

    await act(async () => result.current.startRecovery(["question:1"]));
    const recoveryBody = JSON.parse(fetcher.mock.calls[1][1].body as string);
    expect(recoveryBody.action).toBe("apply");
    expect(recoveryBody.priorRequestModel).not.toHaveProperty("metadata");
    expect(result.current.job?.proposals["question:1"].status).toBe("recovered");
  });

  it.each([401, 403])("turns a raw recovery-apply HTTP %i into reconnect state and requires a fresh-token preview", async (status) => {
    const proposal = await questionProposal();
    const initial = await appliedJob(proposal);
    const previewResponse = jsonResponse({
      ok: true,
      result: {
        status: "recoverable",
        currentRequestModel: {
          kind: "question",
          ref: proposal.before.ref,
          request: proposal.after.request,
        },
        priorRequestModel: {
          kind: "question",
          ref: proposal.before.ref,
          request: proposal.before.request,
        },
        observedRequestChecksum: proposal.proposedRequestChecksum,
      },
      throttleNotices: [],
    });
    const fetcher = vi.fn()
      .mockResolvedValueOnce(previewResponse)
      .mockResolvedValueOnce(jsonResponse({ ok: false, error: `response-secret-${status}` }, status))
      .mockResolvedValueOnce(jsonResponse({
        ok: true,
        result: {
          status: "recoverable",
          currentRequestModel: {
            kind: "question",
            ref: proposal.before.ref,
            request: proposal.after.request,
          },
          priorRequestModel: {
            kind: "question",
            ref: proposal.before.ref,
            request: proposal.before.request,
          },
          observedRequestChecksum: proposal.proposedRequestChecksum,
        },
        throttleNotices: [],
      }));
    const deps = dependencies(fetcher, initial);
    const hook = renderHook(
      ({ supplied }) => useContentReplacementJob(supplied, initial, deps.value),
      { initialProps: { supplied: credentials } },
    );
    await act(async () => hook.result.current.prepareRecovery(["question:1"]));
    await act(async () => hook.result.current.startRecovery(["question:1"]));

    expect(hook.result.current.job).toMatchObject({
      status: "paused",
      operationError: { category: "authorization", retryable: true },
      activeOperation: { kind: "recovery-preview" },
      proposals: { "question:1": { status: "applied" } },
    });
    expect(hook.result.current.operationError).toBe("Stack Enterprise credentials or permissions were rejected.");
    expect(hook.result.current.credentialReadiness).toMatchObject({ valid: false, refreshRequired: true });
    expect(JSON.stringify(deps.store.current())).not.toMatch(new RegExp(`response-secret-${status}|top-secret-token|rejectedCredential`, "i"));

    hook.rerender({
      supplied: {
        ...credentials,
        authSource: "manual-enterprise-token",
        oauthScopes: [],
      },
    });
    expect(hook.result.current.credentialReadiness).toMatchObject({ valid: false, refreshRequired: true });
    await act(async () => hook.result.current.resume());
    expect(fetcher).toHaveBeenCalledTimes(2);

    hook.rerender({ supplied: { ...credentials, accessToken: "fresh-recovery-token" } });
    expect(hook.result.current.credentialReadiness).toMatchObject({ valid: true, refreshRequired: false });
    await act(async () => hook.result.current.resume());
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(JSON.parse(fetcher.mock.calls[2][1].body as string).action).toBe("preview");
    expect(hook.result.current.job?.proposals["question:1"].status).toBe("ready-to-recover");
  });

  it("persists a sanitized retryable recovery-preview network failure", async () => {
    const proposal = await questionProposal();
    const initial = await appliedJob(proposal);
    const fetcher = vi.fn().mockResolvedValue(jsonResponse({
      ok: true,
      result: { status: "network", error: "top-secret-token from upstream" },
      throttleNotices: [],
    }));
    const deps = dependencies(fetcher, initial);
    const { result } = renderHook(() => useContentReplacementJob(credentials, initial, deps.value));

    await act(async () => result.current.prepareRecovery(["question:1"]));

    expect(result.current.job?.proposals["question:1"]).toMatchObject({
      status: "recovery-failed",
      failure: {
        category: "network",
        retryable: true,
        message: "The content replacement request could not be completed.",
      },
    });
    expect(JSON.stringify(deps.store.current())).not.toContain("top-secret-token from upstream");
  });

  it("stops a recovery-preview run after a persisted HTTP 4xx invalid request", async () => {
    const first = await questionProposal(1);
    const second = await questionProposal(2);
    const initial = await appliedJob(first, second);
    const fetcher = vi.fn().mockResolvedValue(jsonResponse({
      ok: false,
      error: "top-secret-token invalid payload",
    }, 400));
    const deps = dependencies(fetcher, initial);
    const { result } = renderHook(() => useContentReplacementJob(credentials, initial, deps.value));

    await act(async () => result.current.prepareRecovery(["question:1", "question:2"]));

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(result.current.job?.proposals["question:1"].failure).toMatchObject({
      category: "validation",
      retryable: false,
    });
    expect(result.current.job?.proposals["question:2"].status).toBe("applied");
    expect(JSON.stringify(deps.store.current())).not.toContain("top-secret-token invalid payload");
  });

  it("persists and honors recovery-preview throttling before the next preview call", async () => {
    const first = await questionProposal(1);
    const second = await questionProposal(2);
    const initial = await appliedJob(first, second);
    const previewResponse = (proposal: ReplacementProposal, seconds: number) => jsonResponse({
      ok: true,
      result: {
        status: "recoverable",
        currentRequestModel: {
          kind: "question",
          ref: proposal.before.ref,
          request: proposal.after.request,
        },
        priorRequestModel: {
          kind: "question",
          ref: proposal.before.ref,
          request: proposal.before.request,
        },
        observedRequestChecksum: proposal.proposedRequestChecksum,
      },
      throttleNotices: seconds ? [{ kind: "backoff", seconds }] : [],
    });
    const fetcher = vi.fn()
      .mockResolvedValueOnce(previewResponse(first, 2))
      .mockResolvedValueOnce(previewResponse(second, 0));
    const deps = dependencies(fetcher, initial);
    const { result } = renderHook(() => useContentReplacementJob(credentials, initial, deps.value));

    await act(async () => result.current.prepareRecovery(["question:2", "question:1"]));

    expect(deps.value.waitUntil).toHaveBeenCalledWith(
      "2026-09-01T12:01:02.000Z",
      expect.any(AbortSignal),
    );
    const throttledSave = deps.store.save.mock.calls.findIndex(([saved]) => saved.nextRetryAt !== undefined);
    expect(throttledSave).toBeGreaterThanOrEqual(0);
    expect(deps.store.save.mock.invocationCallOrder[throttledSave])
      .toBeLessThan(fetcher.mock.invocationCallOrder[1]);
    expect(JSON.parse(fetcher.mock.calls[0][1].body as string).itemRef.questionId).toBe(1);
  });

  it("warns on unload only while a request or throttle wait is active", async () => {
    const pending = deferred<Response>();
    const fetcher = vi.fn().mockReturnValue(pending.promise);
    const add = vi.spyOn(window, "addEventListener");
    const remove = vi.spyOn(window, "removeEventListener");
    const deps = dependencies(fetcher);
    const { result, unmount } = renderHook(() => useContentReplacementJob(credentials, null, deps.value));
    await act(async () => result.current.createJob(configuration));
    let scan!: Promise<void>;
    act(() => { scan = result.current.startScan(); });
    await waitFor(() => expect(result.current.busy).toBe(true));
    expect(add).toHaveBeenCalledWith("beforeunload", expect.any(Function));

    pending.resolve(jsonResponse({ ok: false, error: "safe" }, 400));
    await act(async () => scan);
    await waitFor(() => expect(result.current.busy).toBe(false));
    expect(remove).toHaveBeenCalledWith("beforeunload", expect.any(Function));
    unmount();
  });

  it("deletes a job only through the explicit controller action", async () => {
    const proposal = await questionProposal();
    const initial = await scannedReviewJob(proposal);
    const deps = dependencies(vi.fn(), initial);
    const { result } = renderHook(() => useContentReplacementJob(credentials, initial, deps.value));

    await act(async () => result.current.deleteJob());

    expect(deps.store.delete).toHaveBeenCalledWith("job-1");
    expect(result.current.job).toBeNull();
  });

  it("deletes only recovery snapshots while preserving successful apply results", async () => {
    const proposal = await questionProposal();
    const initial = await appliedJob(proposal);
    const deps = dependencies(vi.fn(), initial);
    const { result } = renderHook(() => useContentReplacementJob(credentials, initial, deps.value));

    await act(async () => result.current.deleteRecoverySnapshots());

    const item = result.current.job?.proposals["question:1"];
    expect(item?.recovery).toBeUndefined();
    expect(item?.result).toEqual(initial.proposals["question:1"].result);
    expect(result.current.job?.recoverySnapshotStatus).toBe("none");
    expect(deps.store.delete).not.toHaveBeenCalled();
  });

  it("retries network failures but leaves permission failures terminal", async () => {
    const first = await questionProposal(1);
    const second = await questionProposal(2);
    let initial = prepareJob(await scannedReviewJob(first, second), AT);
    initial = reduceReplacementJob(initial, { type: "apply/start", at: AT });
    initial = reduceReplacementJob(initial, { type: "apply/item-started", itemKey: "question:1", at: AT });
    initial = reduceReplacementJob(initial, {
      type: "apply/item-finished", itemKey: "question:1",
      result: { status: "network", error: "safe" }, at: AT,
    });
    initial = reduceReplacementJob(initial, { type: "apply/item-started", itemKey: "question:2", at: AT });
    initial = reduceReplacementJob(initial, {
      type: "apply/item-finished", itemKey: "question:2",
      result: { status: "permission", error: "safe" }, at: AT,
    });
    const fetcher = vi.fn().mockResolvedValue(jsonResponse({
      ok: true,
      result: { status: "updated", observedRequestChecksum: first.proposedRequestChecksum },
      throttleNotices: [],
    }));
    const deps = dependencies(fetcher, initial);
    const { result } = renderHook(() => useContentReplacementJob(credentials, initial, deps.value));

    await act(async () => result.current.retryEligibleFailures());

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(result.current.job?.proposals["question:1"].status).toBe("applied");
    expect(result.current.job?.proposals["question:2"].status).toBe("failed");
  });

  it("rescans only requested stale refs through bounded canonical detail calls", async () => {
    const staleProposal = await questionProposal(1);
    const successfulProposal = await questionProposal(2);
    let initial = prepareJob(await scannedReviewJob(staleProposal, successfulProposal), AT);
    initial = reduceReplacementJob(initial, { type: "apply/start", at: AT });
    initial = reduceReplacementJob(initial, { type: "apply/item-started", itemKey: "question:1", at: AT });
    initial = reduceReplacementJob(initial, {
      type: "apply/item-finished", itemKey: "question:1",
      result: { status: "stale", observedRequestChecksum: "f".repeat(64) }, at: AT,
    });
    initial = reduceReplacementJob(initial, { type: "apply/item-started", itemKey: "question:2", at: AT });
    initial = reduceReplacementJob(initial, {
      type: "apply/item-finished", itemKey: "question:2",
      result: { status: "updated", observedRequestChecksum: successfulProposal.proposedRequestChecksum }, at: AT,
    });
    const refreshed = await buildReplacementProposal({
      kind: "question",
      ref: { kind: "question", questionId: 1 },
      request: { title: "Old revised", body: "Body", tags: ["tag"] },
    }, configuration);
    if (!refreshed) throw new Error("Expected refreshed proposal");
    const fetcher = vi.fn().mockResolvedValue(jsonResponse({
      ok: true,
      result: { proposals: [refreshed], inspectedCount: 1, protectedOccurrenceCount: 0 },
      throttleNotices: [],
    }));
    const deps = dependencies(fetcher, initial);
    const { result } = renderHook(() => useContentReplacementJob(credentials, initial, deps.value));

    await act(async () => result.current.rescanStaleItems(["question:2", "question:1", "question:1"]));

    const body = JSON.parse(fetcher.mock.calls[0][1].body as string);
    expect(body).toMatchObject({
      action: "details",
      refs: [{ kind: "question", questionId: 1 }],
      jobFingerprint: initial.fingerprint,
    });
    expect(body.refs).toHaveLength(1);
    expect(result.current.job?.proposals["question:1"].proposal.proposalFingerprint)
      .toBe(refreshed.proposalFingerprint);
  });

  it("persists every stale-rescan batch when more than ten refs are requested", async () => {
    const originals = await Promise.all(Array.from({ length: 11 }, (_, index) => questionProposal(index + 1)));
    let initial = prepareJob(await scannedReviewJob(...originals), AT);
    initial = reduceReplacementJob(initial, { type: "apply/start", at: AT });
    for (let id = 1; id <= 11; id += 1) {
      initial = reduceReplacementJob(initial, { type: "apply/item-started", itemKey: `question:${id}`, at: AT });
      initial = reduceReplacementJob(initial, {
        type: "apply/item-finished",
        itemKey: `question:${id}`,
        result: { status: "stale", observedRequestChecksum: "f".repeat(64) },
        at: AT,
      });
    }
    const refreshed = await Promise.all(Array.from({ length: 11 }, async (_, index) => {
      const id = index + 1;
      const built = await buildReplacementProposal({
        kind: "question",
        ref: { kind: "question", questionId: id },
        request: { title: `Old revised ${id}`, body: "Body", tags: ["tag"] },
      }, configuration);
      if (!built) throw new Error("Expected refreshed proposal");
      return built;
    }));
    const fetcher = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        ok: true,
        result: { proposals: refreshed.slice(0, 10), inspectedCount: 10, protectedOccurrenceCount: 0 },
        throttleNotices: [],
      }))
      .mockResolvedValueOnce(jsonResponse({
        ok: true,
        result: { proposals: refreshed.slice(10), inspectedCount: 1, protectedOccurrenceCount: 0 },
        throttleNotices: [],
      }));
    const deps = dependencies(fetcher, initial);
    const { result } = renderHook(() => useContentReplacementJob(credentials, initial, deps.value));

    await act(async () => result.current.rescanStaleItems(
      Array.from({ length: 11 }, (_, index) => `question:${index + 1}`),
    ));

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fetcher.mock.calls[0][1].body as string).refs).toHaveLength(10);
    expect(JSON.parse(fetcher.mock.calls[1][1].body as string).refs).toHaveLength(1);
    expect(result.current.job?.proposals["question:11"].proposal.proposalFingerprint)
      .toBe(refreshed[10].proposalFingerprint);
    expect(result.current.job?.progress.detailsInspected).toBe(initial.progress.detailsInspected);
  });

  it("persists a sanitized root failure when a stale-item rescan transport fails", async () => {
    const proposal = await questionProposal();
    let initial = prepareJob(await scannedReviewJob(proposal), AT);
    initial = reduceReplacementJob(initial, { type: "apply/start", at: AT });
    initial = reduceReplacementJob(initial, { type: "apply/item-started", itemKey: "question:1", at: AT });
    initial = reduceReplacementJob(initial, {
      type: "apply/item-finished", itemKey: "question:1",
      result: { status: "stale", observedRequestChecksum: "f".repeat(64) }, at: AT,
    });
    const fetcher = vi.fn().mockRejectedValue(new Error("top-secret-token transport detail"));
    const deps = dependencies(fetcher, initial);
    const { result } = renderHook(() => useContentReplacementJob(credentials, initial, deps.value));

    await act(async () => result.current.rescanStaleItems(["question:1"]));

    expect(result.current.job).toMatchObject({
      stage: "results",
      status: "failed",
      failure: {
        category: "network",
        retryable: true,
        message: "The content replacement request could not be completed.",
      },
    });
    expect(JSON.stringify(deps.store.current())).not.toContain("top-secret-token transport detail");
  });

  it("replaces prior evidence when a configuration change produces a new fingerprint", async () => {
    const proposal = await questionProposal();
    const initial = await scannedReviewJob(proposal);
    const deps = dependencies(vi.fn(), initial);
    const changed = {
      ...configuration,
      contentTypes: { questions: false, answers: false, articles: true },
    };
    const { result } = renderHook(() => useContentReplacementJob(credentials, initial, deps.value));

    await act(async () => result.current.createJob(changed));

    expect(result.current.job?.fingerprint).not.toBe(initial.fingerprint);
    expect(result.current.job?.proposals).toEqual({});
    expect(result.current.job?.inventoryQueue).toEqual([{ kind: "articles", page: 1 }]);
  });
});

function createScanJob(id: string): PersistedContentReplacementJob {
  return createReplacementJob({
    id,
    fingerprint: "f".repeat(64),
    baseUrl: "https://example.stackenterprise.co",
    configuration,
    createdAt: AT,
  });
}

function runningScanJob(id: string): PersistedContentReplacementJob {
  return reduceReplacementJob(createScanJob(id), { type: "run/resume", at: AT });
}

function multiJobStorage(
  jobs: Map<string, PersistedContentReplacementJob>,
  options: { delayedSaveId?: string; saveGate?: Promise<void> } = {},
) {
  return {
    save: vi.fn(async (job: PersistedContentReplacementJob, expectedRevision: number | null) => {
      if (job.id === options.delayedSaveId) await options.saveGate;
      const persisted = jobs.get(job.id) ?? null;
      if ((persisted?.revision ?? null) !== expectedRevision) return { status: "conflict" as const };
      jobs.set(job.id, job);
      return { status: "saved" as const };
    }),
    load: vi.fn(async (id: string) => jobs.get(id) ?? null),
    delete: vi.fn(async (id: string) => { jobs.delete(id); }),
  };
}
