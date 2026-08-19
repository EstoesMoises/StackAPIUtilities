import {
  OAUTH_CUSTOMER_PROFILE_SCHEMA_VERSION,
  parseOAuthCustomerProfile,
  parseOAuthCustomerProfilePreferences,
  type OAuthCustomerProfile,
  type OAuthCustomerProfilePreferences,
} from "../domain/oauthCustomerProfiles";

const DATABASE_NAME = "stack-api-utilities-oauth-profiles";
const DATABASE_VERSION = 1;
const PROFILE_STORE_NAME = "profiles";
const PREFERENCE_STORE_NAME = "preferences";
const CURRENT_PREFERENCE_KEY = "current";
const STORAGE_UNAVAILABLE_MESSAGE = "Saved customers are unavailable in this browser.";
const customerProfileNameCollator = new Intl.Collator("en-US", {
  usage: "sort",
  sensitivity: "accent",
});

export interface OAuthCustomerProfileStoreSnapshot {
  available: boolean;
  profiles: OAuthCustomerProfile[];
  preferences: OAuthCustomerProfilePreferences;
  malformedProfileCount: number;
}

export async function loadOAuthCustomerProfileStore(): Promise<OAuthCustomerProfileStoreSnapshot> {
  const database = await openDatabase();

  if (!database) {
    return {
      available: false,
      profiles: [],
      preferences: defaultPreferences(),
      malformedProfileCount: 0,
    };
  }

  try {
    const transaction = database.transaction(
      [PROFILE_STORE_NAME, PREFERENCE_STORE_NAME],
      "readonly",
    );
    const profileRequest = transaction.objectStore(PROFILE_STORE_NAME).getAll();
    const preferenceRequest = transaction
      .objectStore(PREFERENCE_STORE_NAME)
      .get(CURRENT_PREFERENCE_KEY);

    const [storedProfiles, storedPreferences] = await Promise.all([
      requestToPromise<unknown[]>(profileRequest),
      requestToPromise<unknown>(preferenceRequest),
      transactionToPromise(transaction),
    ]);

    const profiles: OAuthCustomerProfile[] = [];
    let malformedProfileCount = 0;

    for (const storedProfile of storedProfiles) {
      const profile = parseOAuthCustomerProfile(storedProfile);
      if (profile) {
        profiles.push(profile);
      } else {
        malformedProfileCount += 1;
      }
    }

    profiles.sort((left, right) => {
      const nameComparison = customerProfileNameCollator.compare(
        left.customerName,
        right.customerName,
      );
      if (nameComparison !== 0) {
        return nameComparison;
      }
      return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
    });

    return {
      available: true,
      profiles,
      preferences:
        parseOAuthCustomerProfilePreferences(storedPreferences) ?? defaultPreferences(),
      malformedProfileCount,
    };
  } finally {
    database.close();
  }
}

export async function saveOAuthCustomerProfile(profile: OAuthCustomerProfile): Promise<void> {
  const sanitizedProfile = parseOAuthCustomerProfile(profile);
  if (!sanitizedProfile) {
    throw new Error("The customer profile is invalid.");
  }

  const database = await requireDatabase();

  try {
    const transaction = database.transaction(PROFILE_STORE_NAME, "readwrite");
    const request = transaction
      .objectStore(PROFILE_STORE_NAME)
      .put(sanitizedProfile, sanitizedProfile.id);

    await Promise.all([requestToPromise(request), transactionToPromise(transaction)]);
  } finally {
    database.close();
  }
}

export async function saveLastSelectedOAuthCustomerProfileId(profileId?: string): Promise<void> {
  if (profileId !== undefined && (profileId.length === 0 || profileId.trim() !== profileId)) {
    throw new Error("The customer profile selection is invalid.");
  }

  const preferences: OAuthCustomerProfilePreferences =
    profileId === undefined
      ? defaultPreferences()
      : {
          schemaVersion: OAUTH_CUSTOMER_PROFILE_SCHEMA_VERSION,
          lastSelectedProfileId: profileId,
        };
  const database = await requireDatabase();

  try {
    const transaction = database.transaction(PREFERENCE_STORE_NAME, "readwrite");
    const request = transaction
      .objectStore(PREFERENCE_STORE_NAME)
      .put(preferences, CURRENT_PREFERENCE_KEY);

    await Promise.all([requestToPromise(request), transactionToPromise(transaction)]);
  } finally {
    database.close();
  }
}

export async function deleteOAuthCustomerProfile(profileId: string): Promise<void> {
  const database = await requireDatabase();

  try {
    const transaction = database.transaction(
      [PROFILE_STORE_NAME, PREFERENCE_STORE_NAME],
      "readwrite",
    );
    const profileStore = transaction.objectStore(PROFILE_STORE_NAME);
    const preferenceStore = transaction.objectStore(PREFERENCE_STORE_NAME);
    const deleteRequest = profileStore.delete(profileId);
    const preferenceRequest = preferenceStore.get(CURRENT_PREFERENCE_KEY);

    await Promise.all([
      requestToPromise(deleteRequest),
      clearPreferenceIfSelected(preferenceRequest, preferenceStore, profileId),
      transactionToPromise(transaction),
    ]);
  } finally {
    database.close();
  }
}

function defaultPreferences(): OAuthCustomerProfilePreferences {
  return { schemaVersion: OAUTH_CUSTOMER_PROFILE_SCHEMA_VERSION };
}

async function openDatabase(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") {
    return null;
  }

  const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);

  request.onupgradeneeded = () => {
    const database = request.result;

    if (!database.objectStoreNames.contains(PROFILE_STORE_NAME)) {
      database.createObjectStore(PROFILE_STORE_NAME);
    }
    if (!database.objectStoreNames.contains(PREFERENCE_STORE_NAME)) {
      database.createObjectStore(PREFERENCE_STORE_NAME);
    }
  };

  return openRequestToPromise(request);
}

async function requireDatabase(): Promise<IDBDatabase> {
  const database = await openDatabase();
  if (!database) {
    throw new Error(STORAGE_UNAVAILABLE_MESSAGE);
  }
  return database;
}

function clearPreferenceIfSelected(
  request: IDBRequest<unknown>,
  store: IDBObjectStore,
  profileId: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => {
      const preferences = parseOAuthCustomerProfilePreferences(request.result);
      if (preferences?.lastSelectedProfileId !== profileId) {
        resolve();
        return;
      }

      const putRequest = store.put(defaultPreferences(), CURRENT_PREFERENCE_KEY);
      putRequest.onsuccess = () => resolve();
      putRequest.onerror = () =>
        reject(putRequest.error ?? new Error("IndexedDB request failed."));
    };
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed."));
  });
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed."));
  });
}

function openRequestToPromise(request: IDBOpenDBRequest): Promise<IDBDatabase> {
  let settled = false;

  return new Promise((resolve, reject) => {
    request.onsuccess = () => {
      if (settled) {
        request.result.close();
        return;
      }

      settled = true;
      resolve(request.result);
    };
    request.onerror = () => {
      if (settled) {
        return;
      }

      settled = true;
      reject(request.error ?? new Error("IndexedDB request failed."));
    };
    request.onblocked = () => {
      if (settled) {
        return;
      }

      settled = true;
      reject(new Error(STORAGE_UNAVAILABLE_MESSAGE));
    };
  });
}

function transactionToPromise(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () =>
      reject(transaction.error ?? new Error("IndexedDB transaction failed."));
    transaction.onabort = () =>
      reject(transaction.error ?? new Error("IndexedDB transaction aborted."));
  });
}
