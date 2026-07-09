import { afterEach, describe, expect, it, vi } from "vitest";
import type { PersistedDatasetSessionSnapshot } from "../domain/datasetPersistence";
import {
  clearPersistedDatasetSession,
  loadPersistedDatasetSession,
  savePersistedDatasetSession,
} from "./browserDatasetStorage";

const originalIndexedDB = globalThis.indexedDB;

afterEach(() => {
  vi.unstubAllGlobals();
  if (originalIndexedDB) {
    vi.stubGlobal("indexedDB", originalIndexedDB);
  }
});

describe("browserDatasetStorage", () => {
  it("treats missing IndexedDB as empty browser storage", async () => {
    vi.stubGlobal("indexedDB", undefined);

    await expect(loadPersistedDatasetSession()).resolves.toBeNull();
    await expect(savePersistedDatasetSession(createSnapshot())).resolves.toBeUndefined();
    await expect(clearPersistedDatasetSession()).resolves.toBeUndefined();
  });

  it("opens the expected database and version", async () => {
    const fakeIndexedDB = installFakeIndexedDB();

    await loadPersistedDatasetSession();

    expect(fakeIndexedDB.openCalls).toEqual([{ name: "stack-api-utilities", version: 1 }]);
  });

  it("creates the dataset session object store during upgrade when missing", async () => {
    const fakeIndexedDB = installFakeIndexedDB();

    await loadPersistedDatasetSession();

    expect(fakeIndexedDB.createdObjectStores).toEqual(["dataset-session"]);
  });

  it("saves and loads the latest snapshot with the fixed key", async () => {
    const fakeIndexedDB = installFakeIndexedDB({ existingStores: ["dataset-session"] });
    const snapshot = createSnapshot();

    await savePersistedDatasetSession(snapshot);
    const loadedSnapshot = await loadPersistedDatasetSession();

    expect(fakeIndexedDB.putKeys).toEqual(["latest"]);
    expect(fakeIndexedDB.getKeys).toEqual(["latest"]);
    expect(loadedSnapshot).toEqual(snapshot);
  });

  it("clears the latest snapshot with the fixed key", async () => {
    const fakeIndexedDB = installFakeIndexedDB({ existingStores: ["dataset-session"] });
    fakeIndexedDB.records.set("latest", createSnapshot());

    await clearPersistedDatasetSession();
    const loadedSnapshot = await loadPersistedDatasetSession();

    expect(fakeIndexedDB.deleteKeys).toEqual(["latest"]);
    expect(loadedSnapshot).toBeNull();
  });

  it("rejects when IndexedDB cannot open", async () => {
    vi.stubGlobal("indexedDB", {
      open: () => {
        throw new Error("IndexedDB blocked");
      },
    });

    await expect(loadPersistedDatasetSession()).rejects.toThrow("IndexedDB blocked");
  });

  it("rejects when an asynchronous request fails", async () => {
    const fakeIndexedDB = installFakeIndexedDB({ existingStores: ["dataset-session"] });
    fakeIndexedDB.failNextStoreRequest(new Error("IndexedDB request failed"));

    await expect(loadPersistedDatasetSession()).rejects.toThrow("IndexedDB request failed");
  });

  it("rejects save when the transaction aborts after request success", async () => {
    const fakeIndexedDB = installFakeIndexedDB({ existingStores: ["dataset-session"] });
    fakeIndexedDB.abortNextWriteTransaction(new Error("IndexedDB save aborted"));

    await expect(savePersistedDatasetSession(createSnapshot())).rejects.toThrow(
      "IndexedDB save aborted",
    );
  });

  it("rejects clear when the transaction aborts after request success", async () => {
    const fakeIndexedDB = installFakeIndexedDB({ existingStores: ["dataset-session"] });
    fakeIndexedDB.records.set("latest", createSnapshot());
    fakeIndexedDB.abortNextWriteTransaction(new Error("IndexedDB clear aborted"));

    await expect(clearPersistedDatasetSession()).rejects.toThrow("IndexedDB clear aborted");
  });
});

function createSnapshot(): PersistedDatasetSessionSnapshot {
  return {
    version: 1,
    selectedReportId: "tag-report",
    selectedReportIds: ["tag-report"],
    datasets: {},
    reportOutputs: {},
    reportRunSnapshots: [],
    warnings: [],
  };
}

function installFakeIndexedDB(options: { existingStores?: string[] } = {}): FakeIndexedDB {
  const fakeIndexedDB = new FakeIndexedDB(options.existingStores ?? []);
  vi.stubGlobal("indexedDB", fakeIndexedDB.indexedDB);
  return fakeIndexedDB;
}

class FakeIndexedDB {
  readonly createdObjectStores: string[] = [];
  readonly deleteKeys: string[] = [];
  readonly getKeys: string[] = [];
  readonly openCalls: Array<{ name: string; version?: number }> = [];
  readonly putKeys: string[] = [];
  readonly records = new Map<string, unknown>();
  readonly indexedDB = {
    open: (name: string, version?: number) => this.open(name, version),
  };

  private readonly objectStores: Set<string>;
  private nextStoreRequestError: Error | null = null;
  private nextTransactionAbort: Error | null = null;

  constructor(existingStores: string[]) {
    this.objectStores = new Set(existingStores);
  }

  failNextStoreRequest(error: Error): void {
    this.nextStoreRequestError = error;
  }

  abortNextWriteTransaction(error: Error): void {
    this.nextTransactionAbort = error;
  }

  hasObjectStore(name: string): boolean {
    return this.objectStores.has(name);
  }

  createObjectStore(name: string): void {
    this.objectStores.add(name);
    this.createdObjectStores.push(name);
  }

  consumeStoreRequestError(): Error | null {
    const error = this.nextStoreRequestError;
    this.nextStoreRequestError = null;
    return error;
  }

  consumeTransactionAbort(): Error | null {
    const error = this.nextTransactionAbort;
    this.nextTransactionAbort = null;
    return error;
  }

  private open(name: string, version?: number): IDBOpenDBRequest {
    this.openCalls.push({ name, version });

    const database = new FakeIDBDatabase(this);
    const request = new FakeIDBOpenRequest(database);

    queueMicrotask(() => {
      if (!this.hasObjectStore("dataset-session")) {
        request.fireUpgradeNeeded();
      }

      request.fireSuccess(database);
    });

    return request as unknown as IDBOpenDBRequest;
  }
}

class FakeIDBDatabase {
  readonly objectStoreNames = {
    contains: (name: string) => this.fakeIndexedDB.hasObjectStore(name),
  };

  constructor(private readonly fakeIndexedDB: FakeIndexedDB) {}

  createObjectStore(name: string): IDBObjectStore {
    this.fakeIndexedDB.createObjectStore(name);
    return new FakeIDBObjectStore(
      this.fakeIndexedDB,
      new FakeIDBTransaction(this.fakeIndexedDB),
    ) as unknown as IDBObjectStore;
  }

  transaction(_storeName: string, _mode?: IDBTransactionMode): IDBTransaction {
    return new FakeIDBTransaction(this.fakeIndexedDB) as unknown as IDBTransaction;
  }

  close(): void {}
}

class FakeIDBTransaction {
  error: Error | null = null;
  onabort: (() => void) | null = null;
  oncomplete: (() => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(private readonly fakeIndexedDB: FakeIndexedDB) {}

  objectStore(_name: string): IDBObjectStore {
    return new FakeIDBObjectStore(this.fakeIndexedDB, this) as unknown as IDBObjectStore;
  }

  finishWrite(): void {
    const abortError = this.fakeIndexedDB.consumeTransactionAbort();

    queueMicrotask(() => {
      if (abortError) {
        this.error = abortError;
        this.onabort?.();
        return;
      }

      this.oncomplete?.();
    });
  }
}

class FakeIDBObjectStore {
  constructor(
    private readonly fakeIndexedDB: FakeIndexedDB,
    private readonly transaction: FakeIDBTransaction,
  ) {}

  get(key: IDBValidKey): IDBRequest<unknown> {
    const normalizedKey = String(key);
    this.fakeIndexedDB.getKeys.push(normalizedKey);

    return this.scheduleRequest(() => this.fakeIndexedDB.records.get(normalizedKey));
  }

  put(value: unknown, key: IDBValidKey): IDBRequest<IDBValidKey> {
    const normalizedKey = String(key);
    this.fakeIndexedDB.putKeys.push(normalizedKey);

    return this.scheduleRequest(() => {
      this.fakeIndexedDB.records.set(normalizedKey, value);
      return key;
    }, true);
  }

  delete(key: IDBValidKey): IDBRequest<undefined> {
    const normalizedKey = String(key);
    this.fakeIndexedDB.deleteKeys.push(normalizedKey);

    return this.scheduleRequest(() => {
      this.fakeIndexedDB.records.delete(normalizedKey);
      return undefined;
    }, true);
  }

  private scheduleRequest<T>(operation: () => T, isWrite = false): IDBRequest<T> {
    const request = new FakeIDBRequest<T>();

    queueMicrotask(() => {
      const requestError = this.fakeIndexedDB.consumeStoreRequestError();

      if (requestError) {
        request.fireError(requestError);
        return;
      }

      request.fireSuccess(operation());

      if (isWrite) {
        this.transaction.finishWrite();
      }
    });

    return request as unknown as IDBRequest<T>;
  }
}

class FakeIDBRequest<T> {
  error: Error | null = null;
  onsuccess: (() => void) | null = null;
  onerror: (() => void) | null = null;
  result!: T;

  fireSuccess(result: T): void {
    this.result = result;
    this.onsuccess?.();
  }

  fireError(error: Error): void {
    this.error = error;
    this.onerror?.();
  }
}

class FakeIDBOpenRequest<T> extends FakeIDBRequest<T> {
  onupgradeneeded: (() => void) | null = null;

  constructor(result: T) {
    super();
    this.result = result;
  }

  fireUpgradeNeeded(): void {
    this.onupgradeneeded?.();
  }
}
