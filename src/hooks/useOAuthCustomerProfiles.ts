import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  createOAuthCustomerProfile,
  updateOAuthCustomerProfile,
  type OAuthCustomerProfile,
  type OAuthCustomerProfileDraft,
  type OAuthCustomerProfileMutationResult,
} from "../domain/oauthCustomerProfiles";
import {
  deleteOAuthCustomerProfile,
  loadOAuthCustomerProfileStore,
  saveLastSelectedOAuthCustomerProfileId,
  saveOAuthCustomerProfile,
  saveOAuthCustomerProfileAndSelect,
  type OAuthCustomerProfileStoreSnapshot,
} from "../utils/browserOAuthProfileStorage";

const UNAVAILABLE_WARNING =
  "Saved customers are unavailable in this browser. You can still enter OAuth details manually.";
const CORRUPT_WARNING = "One or more saved customer profiles could not be read.";
const WRITE_WARNING = "Customer profile changes could not be saved. Try again.";
const customerProfileNameCollator = new Intl.Collator("en-US", {
  usage: "sort",
  sensitivity: "accent",
});

export interface OAuthCustomerProfileStorageOperations {
  load: () => Promise<OAuthCustomerProfileStoreSnapshot>;
  saveProfile: (profile: OAuthCustomerProfile) => Promise<void>;
  saveProfileAndSelect: (profile: OAuthCustomerProfile) => Promise<void>;
  saveLastSelectedProfileId: (profileId?: string) => Promise<void>;
  deleteProfile: (profileId: string) => Promise<void>;
}

export interface UseOAuthCustomerProfilesResult {
  profiles: OAuthCustomerProfile[];
  selectedProfile?: OAuthCustomerProfile;
  selectedProfileId?: string;
  ready: boolean;
  available: boolean;
  busy: boolean;
  warning: string | null;
  selectProfile(profileId?: string): Promise<void>;
  createProfile(
    draft: OAuthCustomerProfileDraft,
    options?: { accessTokenPresent?: boolean },
  ): Promise<OAuthCustomerProfileMutationResult>;
  updateProfile(
    draft: OAuthCustomerProfileDraft,
    options?: { accessTokenPresent?: boolean },
  ): Promise<OAuthCustomerProfileMutationResult>;
  deleteSelectedProfile(): Promise<boolean>;
  clearWarning(): void;
}

const defaultStorage: OAuthCustomerProfileStorageOperations = {
  load: loadOAuthCustomerProfileStore,
  saveProfile: saveOAuthCustomerProfile,
  saveProfileAndSelect: saveOAuthCustomerProfileAndSelect,
  saveLastSelectedProfileId: saveLastSelectedOAuthCustomerProfileId,
  deleteProfile: deleteOAuthCustomerProfile,
};

export function useOAuthCustomerProfiles(
  storage: OAuthCustomerProfileStorageOperations = defaultStorage,
): UseOAuthCustomerProfilesResult {
  const [profiles, setProfilesState] = useState<OAuthCustomerProfile[]>([]);
  const [selectedProfileId, setSelectedProfileIdState] = useState<string>();
  const [ready, setReady] = useState(false);
  const [available, setAvailable] = useState(true);
  const [busy, setBusy] = useState(false);
  const [warning, setWarning] = useState<string | null>(null);

  const storageRef = useRef(storage);
  const profilesRef = useRef<OAuthCustomerProfile[]>([]);
  const selectedProfileIdRef = useRef<string>();
  const mountedRef = useRef(true);
  const loadStartedRef = useRef(false);
  const readyRef = useRef(false);
  const operationQueueRef = useRef<Promise<void>>(Promise.resolve());
  const pendingMutationCountRef = useRef(0);

  const setProfiles = useCallback((nextProfiles: OAuthCustomerProfile[]) => {
    profilesRef.current = nextProfiles;
    if (mountedRef.current) {
      setProfilesState(nextProfiles);
    }
  }, []);

  const setSelectedProfileId = useCallback((nextProfileId?: string) => {
    selectedProfileIdRef.current = nextProfileId;
    if (mountedRef.current) {
      setSelectedProfileIdState(nextProfileId);
    }
  }, []);

  const enqueue = useCallback(function enqueueOperation<T>(
    operation: () => Promise<T>,
  ): Promise<T> {
    const result = operationQueueRef.current.then(operation, operation);
    operationQueueRef.current = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }, []);

  const beginMutation = useCallback(() => {
    pendingMutationCountRef.current += 1;
    if (mountedRef.current) {
      setBusy(true);
    }
  }, []);

  const finishMutation = useCallback(() => {
    pendingMutationCountRef.current = Math.max(0, pendingMutationCountRef.current - 1);
    if (mountedRef.current) {
      setBusy(pendingMutationCountRef.current > 0);
    }
  }, []);

  const showWriteWarning = useCallback(() => {
    if (mountedRef.current) {
      setWarning(WRITE_WARNING);
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    if (loadStartedRef.current) {
      return () => {
        mountedRef.current = false;
      };
    }
    loadStartedRef.current = true;

    void storageRef.current
      .load()
      .then((snapshot) => {
        if (!mountedRef.current) {
          return;
        }

        if (!snapshot.available) {
          setProfiles([]);
          setSelectedProfileId(undefined);
          setAvailable(false);
          setWarning(UNAVAILABLE_WARNING);
          return;
        }

        setAvailable(true);
        setProfiles(sortProfiles([...snapshot.profiles]));
        const storedSelection = snapshot.preferences.lastSelectedProfileId;
        const restoredSelection =
          storedSelection !== undefined &&
          snapshot.profiles.some((profile) => profile.id === storedSelection)
            ? storedSelection
            : undefined;
        setSelectedProfileId(restoredSelection);

        if (snapshot.malformedProfileCount > 0) {
          setWarning(CORRUPT_WARNING);
        }

        if (storedSelection !== undefined && restoredSelection === undefined) {
          void enqueue(() => storageRef.current.saveLastSelectedProfileId(undefined)).catch(
            showWriteWarning,
          );
        }
      })
      .catch(() => {
        if (!mountedRef.current) {
          return;
        }
        setProfiles([]);
        setSelectedProfileId(undefined);
        setAvailable(false);
        setWarning(UNAVAILABLE_WARNING);
      })
      .finally(() => {
        readyRef.current = true;
        if (mountedRef.current) {
          setReady(true);
        }
      });

    return () => {
      mountedRef.current = false;
    };
  }, [enqueue, setProfiles, setSelectedProfileId, showWriteWarning]);

  const selectProfile = useCallback(
    async (profileId?: string): Promise<void> => {
      if (
        profileId !== undefined &&
        !profilesRef.current.some((profile) => profile.id === profileId)
      ) {
        return;
      }

      setSelectedProfileId(profileId);
      try {
        await enqueue(() => storageRef.current.saveLastSelectedProfileId(profileId));
      } catch {
        showWriteWarning();
      }
    },
    [enqueue, setSelectedProfileId, showWriteWarning],
  );

  const createProfile = useCallback(
    async (
      draft: OAuthCustomerProfileDraft,
      options: { accessTokenPresent?: boolean } = {},
    ): Promise<OAuthCustomerProfileMutationResult> => {
      if (!readyRef.current) {
        return failedMutation();
      }

      beginMutation();
      try {
        return await enqueue(async () => {
          const mutation = createOAuthCustomerProfile(draft, profilesRef.current, options);
          if (!mutation.ok) {
            return mutation;
          }

          try {
            await storageRef.current.saveProfileAndSelect(mutation.profile);
          } catch {
            showWriteWarning();
            return failedMutation();
          }

          setProfiles(sortProfiles([...profilesRef.current, mutation.profile]));
          setSelectedProfileId(mutation.profile.id);
          return mutation;
        });
      } finally {
        finishMutation();
      }
    },
    [beginMutation, enqueue, finishMutation, setProfiles, setSelectedProfileId, showWriteWarning],
  );

  const updateProfile = useCallback(
    async (
      draft: OAuthCustomerProfileDraft,
      options: { accessTokenPresent?: boolean } = {},
    ): Promise<OAuthCustomerProfileMutationResult> => {
      if (!readyRef.current) {
        return failedMutation();
      }

      const profileId = selectedProfileIdRef.current;
      if (profileId === undefined) {
        return failedMutation();
      }

      beginMutation();
      try {
        return await enqueue(async () => {
          const selected = profilesRef.current.find(
            (profile) => profile.id === profileId,
          );
          if (!selected) {
            return failedMutation();
          }

          const mutation = updateOAuthCustomerProfile(
            selected,
            draft,
            profilesRef.current,
            options,
          );
          if (!mutation.ok) {
            return mutation;
          }

          try {
            await storageRef.current.saveProfile(mutation.profile);
          } catch {
            showWriteWarning();
            return failedMutation();
          }

          setProfiles(
            sortProfiles(
              profilesRef.current.map((profile) =>
                profile.id === mutation.profile.id ? mutation.profile : profile,
              ),
            ),
          );
          return mutation;
        });
      } finally {
        finishMutation();
      }
    },
    [beginMutation, enqueue, finishMutation, setProfiles, showWriteWarning],
  );

  const deleteSelectedProfile = useCallback(async (): Promise<boolean> => {
    if (!readyRef.current) {
      return false;
    }

    const profileId = selectedProfileIdRef.current;
    if (profileId === undefined) {
      return false;
    }

    beginMutation();
    try {
      return await enqueue(async () => {
        try {
          await storageRef.current.deleteProfile(profileId);
        } catch {
          showWriteWarning();
          return false;
        }

        setProfiles(profilesRef.current.filter((profile) => profile.id !== profileId));
        if (selectedProfileIdRef.current === profileId) {
          setSelectedProfileId(undefined);
        }
        return true;
      });
    } finally {
      finishMutation();
    }
  }, [
    beginMutation,
    enqueue,
    finishMutation,
    setProfiles,
    setSelectedProfileId,
    showWriteWarning,
  ]);

  const clearWarning = useCallback(() => {
    if (mountedRef.current) {
      setWarning(null);
    }
  }, []);

  const selectedProfile = useMemo(
    () => profiles.find((profile) => profile.id === selectedProfileId),
    [profiles, selectedProfileId],
  );

  return {
    profiles,
    selectedProfile,
    selectedProfileId,
    ready,
    available,
    busy,
    warning,
    selectProfile,
    createProfile,
    updateProfile,
    deleteSelectedProfile,
    clearWarning,
  };
}

function sortProfiles(profiles: OAuthCustomerProfile[]): OAuthCustomerProfile[] {
  return profiles.sort(compareProfiles);
}

function compareProfiles(
  left: OAuthCustomerProfile,
  right: OAuthCustomerProfile,
): number {
  const nameComparison = customerProfileNameCollator.compare(
    left.customerName,
    right.customerName,
  );
  if (nameComparison !== 0) {
    return nameComparison;
  }
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
}

function failedMutation(): OAuthCustomerProfileMutationResult {
  return { ok: false, errors: {} };
}
