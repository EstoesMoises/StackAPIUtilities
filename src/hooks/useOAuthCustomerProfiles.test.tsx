import { StrictMode } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type {
  OAuthCustomerProfile,
  OAuthCustomerProfileDraft,
} from "../domain/oauthCustomerProfiles";
import type { OAuthCustomerProfileStoreSnapshot } from "../utils/browserOAuthProfileStorage";
import {
  useOAuthCustomerProfiles,
  type OAuthCustomerProfileStorageOperations,
} from "./useOAuthCustomerProfiles";

const UNAVAILABLE_WARNING =
  "Saved customers are unavailable in this browser. You can still enter OAuth details manually.";
const CORRUPT_WARNING = "One or more saved customer profiles could not be read.";
const WRITE_WARNING = "Customer profile changes could not be saved. Try again.";

function createProfile(
  id = "profile-1",
  customerName = "Demo Customer",
): OAuthCustomerProfile {
  return {
    schemaVersion: 2,
    id,
    customerName,
    baseUrl: `https://${id}.stackenterprise.co`,
    oauthClientId: `client-${id}`,
    apiKey: `key-${id}`,
    includeNoExpiry: false,
    createdAt: "2026-08-19T12:00:00.000Z",
    updatedAt: "2026-08-19T12:00:00.000Z",
  };
}

function draft(
  customerName = "New Customer",
  baseUrl = "https://new.stackenterprise.co",
  apiKey = "new-customer-key",
): OAuthCustomerProfileDraft {
  return {
    customerName,
    baseUrl,
    oauthClientId: `client-${customerName.toLowerCase().replace(/ /g, "-")}`,
    apiKey,
    includeNoExpiry: true,
  };
}

function emptyAvailableSnapshot(): OAuthCustomerProfileStoreSnapshot {
  return {
    available: true,
    profiles: [],
    preferences: { schemaVersion: 2 },
    malformedProfileCount: 0,
  };
}

function snapshotWith(
  profiles: OAuthCustomerProfile[],
  selectedProfileId?: string,
): OAuthCustomerProfileStoreSnapshot {
  return {
    available: true,
    profiles,
    preferences:
      selectedProfileId === undefined
        ? { schemaVersion: 2 }
        : { schemaVersion: 2, lastSelectedProfileId: selectedProfileId },
    malformedProfileCount: 0,
  };
}

function createStorage(
  snapshot: OAuthCustomerProfileStoreSnapshot = emptyAvailableSnapshot(),
) {
  return {
    load: vi.fn().mockResolvedValue(snapshot),
    saveProfile: vi.fn().mockResolvedValue(undefined),
    saveProfileAndSelect: vi.fn().mockResolvedValue(undefined),
    saveLastSelectedProfileId: vi.fn().mockResolvedValue(undefined),
    deleteProfile: vi.fn().mockResolvedValue(undefined),
  } satisfies OAuthCustomerProfileStorageOperations;
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

async function waitUntilReady(result: {
  current: { ready: boolean };
}): Promise<void> {
  await waitFor(() => expect(result.current.ready).toBe(true));
}

describe("useOAuthCustomerProfiles", () => {
  it("hydrates profiles and restores a valid last selection exactly once", async () => {
    const profile = createProfile();
    const storage = createStorage(snapshotWith([profile], profile.id));
    const replacementStorage = createStorage();
    const { result, rerender } = renderHook(
      ({ operations }) => useOAuthCustomerProfiles(operations),
      { initialProps: { operations: storage } },
    );

    await waitUntilReady(result);
    rerender({ operations: replacementStorage });

    expect(result.current.profiles).toEqual([profile]);
    expect(result.current.available).toBe(true);
    expect(result.current.selectedProfileId).toBe(profile.id);
    expect(result.current.selectedProfile).toEqual(profile);
    expect(storage.load).toHaveBeenCalledTimes(1);
    expect(replacementStorage.load).not.toHaveBeenCalled();
  });

  it("hydrates once in StrictMode", async () => {
    const profile = createProfile();
    const storage = createStorage(snapshotWith([profile], profile.id));
    const { result } = renderHook(() => useOAuthCustomerProfiles(storage), {
      wrapper: StrictMode,
    });

    await waitUntilReady(result);

    expect(storage.load).toHaveBeenCalledTimes(1);
    expect(result.current.profiles).toEqual([profile]);
    expect(result.current.selectedProfileId).toBe(profile.id);
  });

  it("rejects mutations before hydration without writes or visible-state races", async () => {
    const hydrated = createProfile("hydrated", "Hydrated Customer");
    const pendingLoad = deferred<OAuthCustomerProfileStoreSnapshot>();
    const storage = createStorage();
    storage.load.mockReturnValue(pendingLoad.promise);
    const { result } = renderHook(() => useOAuthCustomerProfiles(storage));

    await act(async () => {
      expect(await result.current.createProfile(draft("Early Customer"))).toEqual({
        ok: false,
        errors: {},
      });
      expect(await result.current.updateProfile(draft("Early Update"))).toEqual({
        ok: false,
        errors: {},
      });
      expect(await result.current.deleteSelectedProfile()).toBe(false);
    });

    expect(result.current.busy).toBe(false);
    expect(storage.saveProfileAndSelect).not.toHaveBeenCalled();
    expect(storage.saveProfile).not.toHaveBeenCalled();
    expect(storage.deleteProfile).not.toHaveBeenCalled();

    await act(async () => {
      pendingLoad.resolve(snapshotWith([hydrated], hydrated.id));
      await pendingLoad.promise;
    });
    await waitUntilReady(result);

    expect(result.current.profiles).toEqual([hydrated]);
    expect(result.current.selectedProfile).toEqual(hydrated);
  });

  it("sorts hydrated profiles without mutating the storage snapshot", async () => {
    const zulu = createProfile("zulu", "Zulu");
    const equalHigh = createProfile("z-id", "alpha");
    const accented = createProfile("accented", "Álpha");
    const equalLow = createProfile("a-id", "Alpha");
    const storedOrder = [zulu, equalHigh, accented, equalLow];
    const snapshot = snapshotWith(storedOrder);
    const storage = createStorage(snapshot);
    const { result } = renderHook(() => useOAuthCustomerProfiles(storage));

    await waitUntilReady(result);

    expect(result.current.profiles.map((profile) => profile.id)).toEqual([
      equalLow.id,
      equalHigh.id,
      accented.id,
      zulu.id,
    ]);
    expect(snapshot.profiles).toEqual([zulu, equalHigh, accented, equalLow]);
  });

  it("clears a stale last-selected preference without selecting a profile", async () => {
    const profile = createProfile();
    const storage = createStorage(snapshotWith([profile], "missing-profile"));
    const { result } = renderHook(() => useOAuthCustomerProfiles(storage));

    await waitUntilReady(result);
    await waitFor(() =>
      expect(storage.saveLastSelectedProfileId).toHaveBeenCalledWith(undefined),
    );

    expect(result.current.selectedProfileId).toBeUndefined();
    expect(result.current.selectedProfile).toBeUndefined();
    expect(result.current.warning).toBeNull();
  });

  it.each([
    [
      "an unavailable snapshot",
      async () => ({
        available: false,
        profiles: [createProfile()],
        preferences: { schemaVersion: 2 as const, lastSelectedProfileId: "profile-1" },
        malformedProfileCount: 0,
      }),
    ],
    ["a rejected load", async () => Promise.reject(new Error("blocked database"))],
  ])("keeps manual OAuth available after %s", async (_label, load) => {
    const storage = createStorage();
    storage.load.mockImplementation(load);
    const { result } = renderHook(() => useOAuthCustomerProfiles(storage));

    await waitUntilReady(result);

    expect(result.current.available).toBe(false);
    expect(result.current.profiles).toEqual([]);
    expect(result.current.selectedProfileId).toBeUndefined();
    expect(result.current.warning).toBe(UNAVAILABLE_WARNING);
  });

  it("retains valid profiles while warning about malformed records", async () => {
    const profile = createProfile();
    const storage = createStorage({
      ...snapshotWith([profile]),
      malformedProfileCount: 2,
    });
    const { result } = renderHook(() => useOAuthCustomerProfiles(storage));

    await waitUntilReady(result);

    expect(result.current.profiles).toEqual([profile]);
    expect(result.current.available).toBe(true);
    expect(result.current.warning).toBe(CORRUPT_WARNING);
  });

  it("does not update state or warnings after unmount", async () => {
    const pendingLoad = deferred<OAuthCustomerProfileStoreSnapshot>();
    const storage = createStorage();
    storage.load.mockReturnValue(pendingLoad.promise);
    const hook = renderHook(() => useOAuthCustomerProfiles(storage));
    hook.unmount();

    await act(async () => {
      pendingLoad.reject(new Error("late failure"));
      await pendingLoad.promise.catch(() => undefined);
    });

    expect(hook.result.current.ready).toBe(false);
    expect(hook.result.current.warning).toBeNull();

    const pendingClear = deferred<void>();
    const staleStorage = createStorage(snapshotWith([], "missing-profile"));
    staleStorage.saveLastSelectedProfileId.mockReturnValue(pendingClear.promise);
    const staleHook = renderHook(() => useOAuthCustomerProfiles(staleStorage));
    await waitUntilReady(staleHook.result);
    await waitFor(() => expect(staleStorage.saveLastSelectedProfileId).toHaveBeenCalled());
    staleHook.unmount();

    await act(async () => {
      pendingClear.reject(new Error("late clear failure"));
      await pendingClear.promise.catch(() => undefined);
    });

    expect(staleHook.result.current.warning).toBeNull();
  });

  it("updates selection immediately, ignores invalid IDs, and does not revert after a write failure", async () => {
    const first = createProfile("profile-1", "Alpha");
    const second = createProfile("profile-2", "Beta");
    const pendingWrite = deferred<void>();
    const storage = createStorage(snapshotWith([first, second], first.id));
    storage.saveLastSelectedProfileId.mockReturnValue(pendingWrite.promise);
    const { result } = renderHook(() => useOAuthCustomerProfiles(storage));
    await waitUntilReady(result);

    let selection!: Promise<void>;
    act(() => {
      selection = result.current.selectProfile(second.id);
    });

    expect(result.current.selectedProfileId).toBe(second.id);
    expect(result.current.selectedProfile).toEqual(second);
    await waitFor(() =>
      expect(storage.saveLastSelectedProfileId).toHaveBeenCalledWith(second.id),
    );

    await act(async () => {
      await result.current.selectProfile("not-a-profile");
    });
    expect(storage.saveLastSelectedProfileId).toHaveBeenCalledTimes(1);
    expect(result.current.selectedProfileId).toBe(second.id);

    await act(async () => {
      pendingWrite.reject(new Error("preference failed"));
      await selection;
    });

    expect(result.current.selectedProfileId).toBe(second.id);
    expect(result.current.warning).toBe(WRITE_WARNING);
  });

  it("returns create validation errors without writing", async () => {
    const storage = createStorage();
    const { result } = renderHook(() => useOAuthCustomerProfiles(storage));
    await waitUntilReady(result);

    let mutation;
    await act(async () => {
      mutation = await result.current.createProfile({
        customerName: "",
        baseUrl: "not-a-url",
        oauthClientId: "",
        apiKey: "",
        includeNoExpiry: false,
      });
    });

    expect(mutation).toEqual({
      ok: false,
      errors: {
        customerName: "Enter a customer name.",
        baseUrl: "Enter a Stack Enterprise HTTPS instance URL.",
        oauthClientId: "Enter an OAuth client ID.",
      },
    });
    expect(storage.saveProfileAndSelect).not.toHaveBeenCalled();
    expect(storage.saveProfile).not.toHaveBeenCalled();
    expect(storage.saveLastSelectedProfileId).not.toHaveBeenCalled();
    expect(result.current.busy).toBe(false);
  });

  it("commits a created profile only after its atomic storage write succeeds", async () => {
    const atomicWrite = deferred<void>();
    const storage = createStorage();
    storage.saveProfileAndSelect.mockReturnValue(atomicWrite.promise);
    const { result } = renderHook(() => useOAuthCustomerProfiles(storage));
    await waitUntilReady(result);

    let mutationPromise!: ReturnType<typeof result.current.createProfile>;
    act(() => {
      mutationPromise = result.current.createProfile(draft());
    });

    expect(result.current.busy).toBe(true);
    expect(result.current.profiles).toEqual([]);
    await waitFor(() =>
      expect(storage.saveProfileAndSelect).toHaveBeenCalledTimes(1),
    );
    const savedProfile = storage.saveProfileAndSelect.mock.calls[0][0];
    expect(savedProfile.apiKey).toBe("new-customer-key");
    expect(result.current.profiles).toEqual([]);
    expect(result.current.selectedProfileId).toBeUndefined();

    let mutation;
    await act(async () => {
      atomicWrite.resolve(undefined);
      mutation = await mutationPromise;
    });

    expect(mutation).toEqual({ ok: true, profile: savedProfile });
    expect(result.current.profiles).toEqual([savedProfile]);
    expect(result.current.selectedProfileId).toBe(savedProfile.id);
    expect(result.current.busy).toBe(false);
    expect(storage.saveProfile).not.toHaveBeenCalled();
    expect(storage.saveLastSelectedProfileId).not.toHaveBeenCalled();
  });

  it("retains visible create state when the atomic write fails", async () => {
    const existing = createProfile("existing", "Existing");
    const storage = createStorage(snapshotWith([existing], existing.id));
    storage.saveProfileAndSelect.mockRejectedValue(new Error("atomic write failed"));
    const { result } = renderHook(() => useOAuthCustomerProfiles(storage));
    await waitUntilReady(result);

    let mutation;
    await act(async () => {
      mutation = await result.current.createProfile(draft());
    });

    expect(mutation).toEqual({ ok: false, errors: {} });
    expect(result.current.profiles).toEqual([existing]);
    expect(result.current.selectedProfileId).toBe(existing.id);
    expect(result.current.warning).toBe(WRITE_WARNING);
    expect(storage.saveProfile).not.toHaveBeenCalled();
    expect(storage.saveLastSelectedProfileId).not.toHaveBeenCalled();
  });

  it("does not update visible state when a create completes after unmount", async () => {
    const atomicWrite = deferred<void>();
    const storage = createStorage();
    storage.saveProfileAndSelect.mockReturnValue(atomicWrite.promise);
    const hook = renderHook(() => useOAuthCustomerProfiles(storage));
    await waitUntilReady(hook.result);

    let creation!: ReturnType<typeof hook.result.current.createProfile>;
    act(() => {
      creation = hook.result.current.createProfile(draft());
    });
    await waitFor(() => expect(storage.saveProfileAndSelect).toHaveBeenCalledTimes(1));
    hook.unmount();

    atomicWrite.resolve(undefined);
    expect((await creation).ok).toBe(true);

    expect(hook.result.current.profiles).toEqual([]);
    expect(hook.result.current.selectedProfileId).toBeUndefined();
    expect(hook.result.current.warning).toBeNull();
  });

  it("updates the selected profile, preserves deterministic order, and rejects collisions", async () => {
    const selected = createProfile("selected", "Zulu");
    const duplicateHigh = createProfile("z-id", "Bravo");
    const duplicateLow = createProfile("a-id", "Bravo");
    const storage = createStorage(
      snapshotWith([duplicateHigh, selected, duplicateLow], selected.id),
    );
    const { result } = renderHook(() => useOAuthCustomerProfiles(storage));
    await waitUntilReady(result);

    let updated;
    await act(async () => {
      updated = await result.current.updateProfile(
        draft("Able", "https://new.stackenterprise.co", "updated-key"),
      );
    });

    expect(updated).toMatchObject({ ok: true });
    expect(result.current.profiles.map((profile) => profile.id)).toEqual([
      selected.id,
      duplicateLow.id,
      duplicateHigh.id,
    ]);
    expect(result.current.selectedProfileId).toBe(selected.id);
    expect(result.current.selectedProfile?.customerName).toBe("Able");
    expect(storage.saveProfile).toHaveBeenCalledTimes(1);
    expect(storage.saveProfile).toHaveBeenCalledWith(
      expect.objectContaining({ apiKey: "updated-key" }),
    );

    let collision;
    await act(async () => {
      collision = await result.current.updateProfile(draft("Bravo"));
    });

    expect(collision).toEqual({
      ok: false,
      errors: { customerName: "Use a unique customer name." },
    });
    expect(storage.saveProfile).toHaveBeenCalledTimes(1);
  });

  it("retains the original selected profile when an update write fails", async () => {
    const selected = createProfile();
    const storage = createStorage(snapshotWith([selected], selected.id));
    storage.saveProfile.mockRejectedValue(new Error("update failed"));
    const { result } = renderHook(() => useOAuthCustomerProfiles(storage));
    await waitUntilReady(result);

    let mutation;
    await act(async () => {
      mutation = await result.current.updateProfile(draft("Renamed"));
    });

    expect(mutation).toEqual({ ok: false, errors: {} });
    expect(result.current.profiles).toEqual([selected]);
    expect(result.current.selectedProfile).toEqual(selected);
    expect(result.current.warning).toBe(WRITE_WARNING);
  });

  it("keeps a queued update targeted at the profile selected when it was invoked", async () => {
    const first = createProfile("profile-a", "Alpha");
    const second = createProfile("profile-b", "Beta");
    const queueBlocker = deferred<void>();
    const storage = createStorage(snapshotWith([first, second], first.id));
    storage.saveLastSelectedProfileId
      .mockReturnValueOnce(queueBlocker.promise)
      .mockResolvedValueOnce(undefined);
    const { result } = renderHook(() => useOAuthCustomerProfiles(storage));
    await waitUntilReady(result);

    let firstSelection!: Promise<void>;
    let update!: ReturnType<typeof result.current.updateProfile>;
    let secondSelection!: Promise<void>;
    act(() => {
      firstSelection = result.current.selectProfile(first.id);
      update = result.current.updateProfile(
        draft("Alpha Updated", "https://alpha-updated.stackenterprise.co"),
      );
      secondSelection = result.current.selectProfile(second.id);
    });

    expect(result.current.selectedProfileId).toBe(second.id);
    await waitFor(() =>
      expect(storage.saveLastSelectedProfileId).toHaveBeenCalledWith(first.id),
    );
    expect(storage.saveProfile).not.toHaveBeenCalled();

    await act(async () => {
      queueBlocker.resolve(undefined);
      expect((await update).ok).toBe(true);
      await Promise.all([firstSelection, secondSelection]);
    });

    expect(storage.saveProfile).toHaveBeenCalledWith(
      expect.objectContaining({ id: first.id, customerName: "Alpha Updated" }),
    );
    expect(result.current.profiles).toEqual([
      expect.objectContaining({ id: first.id, customerName: "Alpha Updated" }),
      second,
    ]);
    expect(result.current.selectedProfileId).toBe(second.id);
    expect(result.current.selectedProfile).toEqual(second);
  });

  it("deletes the selected profile only after storage succeeds and skips writes without a selection", async () => {
    const selected = createProfile();
    const pendingDelete = deferred<void>();
    const storage = createStorage(snapshotWith([selected], selected.id));
    storage.deleteProfile.mockReturnValue(pendingDelete.promise);
    const { result } = renderHook(() => useOAuthCustomerProfiles(storage));
    await waitUntilReady(result);

    let deletion!: Promise<boolean>;
    act(() => {
      deletion = result.current.deleteSelectedProfile();
    });
    expect(result.current.profiles).toEqual([selected]);
    expect(result.current.selectedProfileId).toBe(selected.id);

    await act(async () => {
      pendingDelete.resolve(undefined);
      expect(await deletion).toBe(true);
    });

    expect(storage.deleteProfile).toHaveBeenCalledWith(selected.id);
    expect(result.current.profiles).toEqual([]);
    expect(result.current.selectedProfileId).toBeUndefined();

    await act(async () => {
      expect(await result.current.deleteSelectedProfile()).toBe(false);
    });
    expect(storage.deleteProfile).toHaveBeenCalledTimes(1);
  });

  it("retains the selected profile when deletion fails", async () => {
    const selected = createProfile();
    const storage = createStorage(snapshotWith([selected], selected.id));
    storage.deleteProfile.mockRejectedValue(new Error("delete failed"));
    const { result } = renderHook(() => useOAuthCustomerProfiles(storage));
    await waitUntilReady(result);

    await act(async () => {
      expect(await result.current.deleteSelectedProfile()).toBe(false);
    });

    expect(result.current.profiles).toEqual([selected]);
    expect(result.current.selectedProfile).toEqual(selected);
    expect(result.current.warning).toBe(WRITE_WARNING);
  });

  it("recovers the queue after rejection and serializes selection and mutation writes", async () => {
    const selected = createProfile();
    const failedSelection = deferred<void>();
    const atomicWrite = deferred<void>();
    const events: string[] = [];
    const storage = createStorage(snapshotWith([selected]));
    storage.saveLastSelectedProfileId
      .mockImplementationOnce(async () => {
        events.push("selection:start");
        await failedSelection.promise;
      });
    storage.saveProfileAndSelect.mockImplementation(async () => {
      events.push("create:start");
      await atomicWrite.promise;
      events.push("create:end");
    });
    const { result } = renderHook(() => useOAuthCustomerProfiles(storage));
    await waitUntilReady(result);

    let selection!: Promise<void>;
    let creation!: ReturnType<typeof result.current.createProfile>;
    act(() => {
      selection = result.current.selectProfile(selected.id);
      creation = result.current.createProfile(draft());
    });
    await waitFor(() => expect(events).toEqual(["selection:start"]));
    expect(storage.saveProfileAndSelect).not.toHaveBeenCalled();

    await act(async () => {
      failedSelection.reject(new Error("first operation failed"));
      await selection;
    });
    await waitFor(() => expect(events).toEqual(["selection:start", "create:start"]));

    await act(async () => {
      atomicWrite.resolve(undefined);
      expect((await creation).ok).toBe(true);
    });

    expect(events).toEqual(["selection:start", "create:start", "create:end"]);
  });

  it("keeps busy true until overlapping create, update, and delete mutations settle", async () => {
    const selected = createProfile();
    const updateWrite = deferred<void>();
    const deleteWrite = deferred<void>();
    const createWrite = deferred<void>();
    const storage = createStorage(snapshotWith([selected], selected.id));
    storage.saveProfile.mockReturnValue(updateWrite.promise);
    storage.saveProfileAndSelect.mockReturnValue(createWrite.promise);
    storage.deleteProfile.mockReturnValue(deleteWrite.promise);
    const { result } = renderHook(() => useOAuthCustomerProfiles(storage));
    await waitUntilReady(result);

    let update!: ReturnType<typeof result.current.updateProfile>;
    let deletion!: Promise<boolean>;
    let creation!: ReturnType<typeof result.current.createProfile>;
    act(() => {
      update = result.current.updateProfile(draft("Updated Customer"));
      deletion = result.current.deleteSelectedProfile();
      creation = result.current.createProfile(
        draft("Created Customer", "https://created.stackenterprise.co"),
      );
    });

    expect(result.current.busy).toBe(true);
    await waitFor(() => expect(storage.saveProfile).toHaveBeenCalledTimes(1));

    await act(async () => {
      updateWrite.resolve(undefined);
      expect((await update).ok).toBe(true);
    });
    await waitFor(() => expect(storage.deleteProfile).toHaveBeenCalledTimes(1));
    expect(result.current.busy).toBe(true);

    await act(async () => {
      deleteWrite.resolve(undefined);
      expect(await deletion).toBe(true);
    });
    await waitFor(() => expect(storage.saveProfileAndSelect).toHaveBeenCalledTimes(1));
    expect(result.current.busy).toBe(true);

    await act(async () => {
      createWrite.resolve(undefined);
      expect((await creation).ok).toBe(true);
    });
    expect(result.current.busy).toBe(false);
  });

  it("warns when stale preference cleanup fails and clears the warning", async () => {
    const storage = createStorage(snapshotWith([], "missing-profile"));
    storage.saveLastSelectedProfileId.mockRejectedValue(new Error("clear failed"));
    const { result } = renderHook(() => useOAuthCustomerProfiles(storage));

    await waitUntilReady(result);
    await waitFor(() => expect(result.current.warning).toBe(WRITE_WARNING));

    act(() => {
      result.current.clearWarning();
    });
    expect(result.current.warning).toBeNull();
  });
});
