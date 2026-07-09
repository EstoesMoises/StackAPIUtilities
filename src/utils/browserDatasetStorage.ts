import type { PersistedDatasetSessionSnapshot } from "../domain/datasetPersistence";

const DATABASE_NAME = "stack-api-utilities";
const DATABASE_VERSION = 1;
const STORE_NAME = "dataset-session";
const SNAPSHOT_KEY = "latest";

export async function loadPersistedDatasetSession(): Promise<PersistedDatasetSessionSnapshot | null> {
  const database = await openDatabase();

  if (!database) {
    return null;
  }

  try {
    const store = database.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME);
    const snapshot = await requestToPromise<PersistedDatasetSessionSnapshot | undefined>(
      store.get(SNAPSHOT_KEY),
    );
    return snapshot ?? null;
  } finally {
    database.close();
  }
}

export async function savePersistedDatasetSession(
  snapshot: PersistedDatasetSessionSnapshot,
): Promise<void> {
  const database = await openDatabase();

  if (!database) {
    return;
  }

  try {
    const store = database.transaction(STORE_NAME, "readwrite").objectStore(STORE_NAME);
    await requestToPromise(store.put(snapshot, SNAPSHOT_KEY));
  } finally {
    database.close();
  }
}

export async function clearPersistedDatasetSession(): Promise<void> {
  const database = await openDatabase();

  if (!database) {
    return;
  }

  try {
    const store = database.transaction(STORE_NAME, "readwrite").objectStore(STORE_NAME);
    await requestToPromise(store.delete(SNAPSHOT_KEY));
  } finally {
    database.close();
  }
}

async function openDatabase(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") {
    return null;
  }

  const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);

  request.onupgradeneeded = () => {
    const database = request.result;

    if (!database.objectStoreNames.contains(STORE_NAME)) {
      database.createObjectStore(STORE_NAME);
    }
  };

  return requestToPromise(request);
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed."));
  });
}
