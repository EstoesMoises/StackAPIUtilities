import { afterEach, describe, expect, it, vi } from "vitest";
import type { OAuthCustomerProfile } from "../domain/oauthCustomerProfiles";
import {
  deleteOAuthCustomerProfile,
  loadOAuthCustomerProfileStore,
  saveLastSelectedOAuthCustomerProfileId,
  saveOAuthCustomerProfile,
  saveOAuthCustomerProfileAndSelect,
} from "./browserOAuthProfileStorage";

const originalIndexedDB = globalThis.indexedDB;

afterEach(() => {
  vi.unstubAllGlobals();
  if (originalIndexedDB) {
    vi.stubGlobal("indexedDB", originalIndexedDB);
  }
});

describe("browserOAuthProfileStorage", () => {
  it("opens a dedicated versioned database and creates both stores", async () => {
    const fake = installFakeIndexedDB();

    await loadOAuthCustomerProfileStore();

    expect(fake.openCalls).toEqual([
      { name: "stack-api-utilities-oauth-profiles", version: 1 },
    ]);
    expect(fake.createdObjectStores).toEqual(["profiles", "preferences"]);
    expect(fake.transactionCalls).toEqual([
      { storeNames: ["profiles", "preferences"], mode: "readonly" },
    ]);
  });

  it("round trips an exactly allowlisted profile without runtime secrets", async () => {
    const fake = installFakeIndexedDB({ existingStores: ["profiles", "preferences"] });
    const profile = {
      ...createProfile(),
      accessToken: "access-secret",
      apiKey: "api-secret",
      pat: "pat-secret",
      codeVerifier: "verifier-secret",
      oauthScopes: ["read"],
      authSource: "manual",
      clientSecret: "client-secret",
    } as OAuthCustomerProfile;

    await saveOAuthCustomerProfile(profile);

    expect(fake.store("profiles").get(profile.id)).toEqual(createProfile());
    expect(JSON.stringify(fake.store("profiles").get(profile.id))).not.toMatch(
      /accessToken|apiKey|pat|codeVerifier|oauthScopes|authSource|clientSecret/,
    );
    await expect(loadOAuthCustomerProfileStore()).resolves.toEqual({
      available: true,
      profiles: [createProfile()],
      preferences: { schemaVersion: 1 },
      malformedProfileCount: 0,
    });
  });

  it("updates an existing profile under the same ID", async () => {
    const fake = installFakeIndexedDB({ existingStores: ["profiles", "preferences"] });
    await saveOAuthCustomerProfile(createProfile());
    const updated = createProfile({
      customerName: "Updated Customer",
      oauthClientId: "updated-client",
      updatedAt: "2026-08-19T11:00:00.000Z",
    });

    await saveOAuthCustomerProfile(updated);

    expect([...fake.store("profiles").entries()]).toEqual([[updated.id, updated]]);
  });

  it("atomically saves a sanitized profile followed by its exact selection", async () => {
    const fake = installFakeIndexedDB({ existingStores: ["profiles", "preferences"] });
    const profile = {
      ...createProfile(),
      accessToken: "access-secret",
      clientSecret: "client-secret",
    } as OAuthCustomerProfile;

    await saveOAuthCustomerProfileAndSelect(profile);

    expect(fake.putCalls).toEqual([
      { storeName: "profiles", key: profile.id, value: createProfile() },
      {
        storeName: "preferences",
        key: "current",
        value: { schemaVersion: 1, lastSelectedProfileId: profile.id },
      },
    ]);
    expect(fake.store("profiles").get(profile.id)).toEqual(createProfile());
    expect(fake.store("preferences").get("current")).toEqual({
      schemaVersion: 1,
      lastSelectedProfileId: profile.id,
    });
    expect(fake.transactionCalls[fake.transactionCalls.length - 1]).toEqual({
      storeNames: ["profiles", "preferences"],
      mode: "readwrite",
    });
    expect(fake.closeCount).toBe(1);
  });

  it("rolls back profile and selection when the atomic selection put fails", async () => {
    const fake = installFakeIndexedDB({ existingStores: ["profiles", "preferences"] });
    fake.store("preferences").set("current", {
      schemaVersion: 1,
      lastSelectedProfileId: "existing-profile",
    });
    fake.failRequestAt(2, new Error("Atomic selection failed"));

    await expect(saveOAuthCustomerProfileAndSelect(createProfile())).rejects.toThrow(
      "Atomic selection failed",
    );

    expect(fake.store("profiles").size).toBe(0);
    expect(fake.store("preferences").get("current")).toEqual({
      schemaVersion: 1,
      lastSelectedProfileId: "existing-profile",
    });
    expect(fake.transactionEvents).toEqual(["error", "abort"]);
    expect(fake.closeCount).toBe(1);
  });

  it("rejects an invalid profile before opening IndexedDB", async () => {
    const fake = installFakeIndexedDB({ existingStores: ["profiles", "preferences"] });

    await expect(
      saveOAuthCustomerProfile({ ...createProfile(), customerName: " " }),
    ).rejects.toThrow("The customer profile is invalid.");
    expect(fake.openCalls).toEqual([]);
  });

  it("saves, replaces, clears, and loads the current profile preference", async () => {
    const fake = installFakeIndexedDB({ existingStores: ["profiles", "preferences"] });

    await saveLastSelectedOAuthCustomerProfileId("profile-1");
    await expect(loadOAuthCustomerProfileStore()).resolves.toMatchObject({
      preferences: { schemaVersion: 1, lastSelectedProfileId: "profile-1" },
    });

    await saveLastSelectedOAuthCustomerProfileId("profile-2");
    expect(fake.store("preferences").get("current")).toEqual({
      schemaVersion: 1,
      lastSelectedProfileId: "profile-2",
    });

    await saveLastSelectedOAuthCustomerProfileId();
    await expect(loadOAuthCustomerProfileStore()).resolves.toMatchObject({
      preferences: { schemaVersion: 1 },
    });
  });

  it.each(["", " ", "\tprofile-1", "profile-1\n"])(
    "rejects a blank or whitespace-padded selected profile ID (%j)",
    async (profileId) => {
      const fake = installFakeIndexedDB({ existingStores: ["profiles", "preferences"] });

      await expect(saveLastSelectedOAuthCustomerProfileId(profileId)).rejects.toThrow(
        "The customer profile selection is invalid.",
      );
      expect(fake.openCalls).toEqual([]);
    },
  );

  it("deletes a selected profile and clears its preference in one transaction", async () => {
    const fake = installFakeIndexedDB({ existingStores: ["profiles", "preferences"] });
    fake.store("profiles").set("profile-1", createProfile());
    fake.store("preferences").set("current", {
      schemaVersion: 1,
      lastSelectedProfileId: "profile-1",
    });

    await deleteOAuthCustomerProfile("profile-1");

    expect(fake.store("profiles").has("profile-1")).toBe(false);
    expect(fake.store("preferences").get("current")).toEqual({ schemaVersion: 1 });
    expect(fake.transactionCalls[fake.transactionCalls.length - 1]).toEqual({
      storeNames: ["profiles", "preferences"],
      mode: "readwrite",
    });
  });

  it("deletes a non-selected profile without changing another selection", async () => {
    const fake = installFakeIndexedDB({ existingStores: ["profiles", "preferences"] });
    fake.store("profiles").set("profile-1", createProfile());
    fake.store("preferences").set("current", {
      schemaVersion: 1,
      lastSelectedProfileId: "profile-2",
    });

    await deleteOAuthCustomerProfile("profile-1");

    expect(fake.store("profiles").has("profile-1")).toBe(false);
    expect(fake.store("preferences").get("current")).toEqual({
      schemaVersion: 1,
      lastSelectedProfileId: "profile-2",
    });
  });

  it("loads valid records while ignoring and counting malformed profiles", async () => {
    const fake = installFakeIndexedDB({ existingStores: ["profiles", "preferences"] });
    fake.store("profiles").set("valid", createProfile());
    fake.store("profiles").set("invalid-schema", { ...createProfile(), schemaVersion: 2 });
    fake.store("profiles").set("invalid-secret-only", { accessToken: "secret" });

    await expect(loadOAuthCustomerProfileStore()).resolves.toMatchObject({
      profiles: [createProfile()],
      malformedProfileCount: 2,
    });
  });

  it("sorts profile names with fixed en-US accent semantics and ID tie-breaking", async () => {
    const fake = installFakeIndexedDB({ existingStores: ["profiles", "preferences"] });
    fake.store("profiles").set(
      "id-z",
      createProfile({ id: "id-z", customerName: "acme" }),
    );
    fake.store("profiles").set(
      "id-a",
      createProfile({ id: "id-a", customerName: "ACME" }),
    );
    fake.store("profiles").set(
      "accent",
      createProfile({ id: "accent", customerName: "Ácme" }),
    );
    fake.store("profiles").set(
      "beta",
      createProfile({ id: "beta", customerName: "Beta" }),
    );

    const snapshot = await loadOAuthCustomerProfileStore();

    expect(snapshot.profiles.map(({ id }) => id)).toEqual(["id-a", "id-z", "accent", "beta"]);
  });

  it("defaults malformed preferences safely", async () => {
    const fake = installFakeIndexedDB({ existingStores: ["profiles", "preferences"] });
    fake.store("preferences").set("current", {
      schemaVersion: 1,
      lastSelectedProfileId: " ",
      accessToken: "secret",
    });

    await expect(loadOAuthCustomerProfileStore()).resolves.toMatchObject({
      preferences: { schemaVersion: 1 },
    });
  });

  it("returns an unavailable empty snapshot without IndexedDB", async () => {
    vi.stubGlobal("indexedDB", undefined);

    await expect(loadOAuthCustomerProfileStore()).resolves.toEqual({
      available: false,
      profiles: [],
      preferences: { schemaVersion: 1 },
      malformedProfileCount: 0,
    });
  });

  it.each([
    ["save profile", () => saveOAuthCustomerProfile(createProfile())],
    ["save profile and selection", () => saveOAuthCustomerProfileAndSelect(createProfile())],
    ["save selection", () => saveLastSelectedOAuthCustomerProfileId("profile-1")],
    ["delete profile", () => deleteOAuthCustomerProfile("profile-1")],
  ])("rejects %s when IndexedDB is unavailable", async (_name, mutate) => {
    vi.stubGlobal("indexedDB", undefined);

    await expect(mutate()).rejects.toThrow("Saved customers are unavailable in this browser.");
  });

  it("propagates asynchronous database open failures", async () => {
    const fake = installFakeIndexedDB();
    fake.failNextOpen(new Error("Profile database open failed"));

    await expect(loadOAuthCustomerProfileStore()).rejects.toThrow(
      "Profile database open failed",
    );
  });

  it.each([
    ["load profiles", () => loadOAuthCustomerProfileStore()],
    ["save profile", () => saveOAuthCustomerProfile(createProfile())],
    ["save profile and selection", () => saveOAuthCustomerProfileAndSelect(createProfile())],
    ["save selection", () => saveLastSelectedOAuthCustomerProfileId("profile-1")],
    ["delete profile", () => deleteOAuthCustomerProfile("profile-1")],
  ])("rejects %s when opening the database is blocked", async (_name, operation) => {
    const fake = installFakeIndexedDB();
    fake.blockNextOpen();

    await expect(operation()).rejects.toThrow(
      "Saved customers are unavailable in this browser.",
    );
    expect(fake.closeCount).toBe(0);
  });

  it("closes a database that succeeds after its blocked open already rejected", async () => {
    const fake = installFakeIndexedDB();
    fake.blockNextOpen({ succeedLater: true });

    await expect(loadOAuthCustomerProfileStore()).rejects.toThrow(
      "Saved customers are unavailable in this browser.",
    );
    await Promise.resolve();

    expect(fake.closeCount).toBe(1);
  });

  it("propagates object store request failures and closes the database", async () => {
    const fake = installFakeIndexedDB({ existingStores: ["profiles", "preferences"] });
    fake.failNextRequest(new Error("Profile request failed"));

    await expect(loadOAuthCustomerProfileStore()).rejects.toThrow("Profile request failed");
    expect(fake.transactionEvents).toEqual(["error", "abort"]);
    expect(fake.closeCount).toBe(1);
  });

  it("rolls back delete when its conditional preference-clearing put fails", async () => {
    const fake = installFakeIndexedDB({ existingStores: ["profiles", "preferences"] });
    fake.store("profiles").set("profile-1", createProfile());
    fake.store("preferences").set("current", {
      schemaVersion: 1,
      lastSelectedProfileId: "profile-1",
    });
    fake.failRequestAt(3, new Error("Preference clear failed"));

    await expect(deleteOAuthCustomerProfile("profile-1")).rejects.toThrow(
      "Preference clear failed",
    );
    expect(fake.store("profiles").get("profile-1")).toEqual(createProfile());
    expect(fake.store("preferences").get("current")).toEqual({
      schemaVersion: 1,
      lastSelectedProfileId: "profile-1",
    });
    expect(fake.transactionEvents).toEqual(["error", "abort"]);
    expect(fake.closeCount).toBe(1);
  });

  it.each(["abort", "error"] as const)(
    "awaits and propagates a load transaction %s",
    async (outcome) => {
      const fake = installFakeIndexedDB({ existingStores: ["profiles", "preferences"] });
      fake.failNextTransaction(outcome, new Error(`Load profiles ${outcome}`));

      await expect(loadOAuthCustomerProfileStore()).rejects.toThrow(
        `Load profiles ${outcome}`,
      );
      expect(fake.closeCount).toBe(1);
    },
  );

  it.each(["abort", "error"] as const)(
    "propagates a transaction %s and rolls back save profile",
    async (outcome) => {
      const fake = installFakeIndexedDB({ existingStores: ["profiles", "preferences"] });
      fake.failNextTransaction(outcome, new Error(`Save profile ${outcome}`));

      await expect(saveOAuthCustomerProfile(createProfile())).rejects.toThrow(
        `Save profile ${outcome}`,
      );
      expect(fake.store("profiles").size).toBe(0);
      expect(fake.closeCount).toBe(1);
    },
  );

  it.each(["abort", "error"] as const)(
    "propagates a transaction %s and rolls back save selection",
    async (outcome) => {
      const fake = installFakeIndexedDB({ existingStores: ["profiles", "preferences"] });
      fake.failNextTransaction(outcome, new Error(`Save selection ${outcome}`));

      await expect(saveLastSelectedOAuthCustomerProfileId("profile-1")).rejects.toThrow(
        `Save selection ${outcome}`,
      );
      expect(fake.store("preferences").size).toBe(0);
      expect(fake.closeCount).toBe(1);
    },
  );

  it.each(["abort", "error"] as const)(
    "propagates a transaction %s and rolls back atomic profile creation",
    async (outcome) => {
      const fake = installFakeIndexedDB({ existingStores: ["profiles", "preferences"] });
      fake.failNextTransaction(outcome, new Error(`Atomic profile ${outcome}`));

      await expect(saveOAuthCustomerProfileAndSelect(createProfile())).rejects.toThrow(
        `Atomic profile ${outcome}`,
      );
      expect(fake.store("profiles").size).toBe(0);
      expect(fake.store("preferences").size).toBe(0);
      expect(fake.closeCount).toBe(1);
    },
  );

  it.each(["abort", "error"] as const)(
    "propagates a transaction %s and atomically rolls back delete",
    async (outcome) => {
      const fake = installFakeIndexedDB({ existingStores: ["profiles", "preferences"] });
      fake.store("profiles").set("profile-1", createProfile());
      fake.store("preferences").set("current", {
        schemaVersion: 1,
        lastSelectedProfileId: "profile-1",
      });
      fake.failNextTransaction(outcome, new Error(`Delete profile ${outcome}`));

      await expect(deleteOAuthCustomerProfile("profile-1")).rejects.toThrow(
        `Delete profile ${outcome}`,
      );
      expect(fake.store("profiles").get("profile-1")).toEqual(createProfile());
      expect(fake.store("preferences").get("current")).toEqual({
        schemaVersion: 1,
        lastSelectedProfileId: "profile-1",
      });
      expect(fake.closeCount).toBe(1);
    },
  );

  it("closes every successfully opened database", async () => {
    const fake = installFakeIndexedDB({ existingStores: ["profiles", "preferences"] });

    await loadOAuthCustomerProfileStore();
    await saveOAuthCustomerProfile(createProfile());
    await saveOAuthCustomerProfileAndSelect(createProfile());
    await saveLastSelectedOAuthCustomerProfileId("profile-1");
    await deleteOAuthCustomerProfile("profile-1");

    expect(fake.closeCount).toBe(5);
  });
});

function createProfile(overrides: Partial<OAuthCustomerProfile> = {}): OAuthCustomerProfile {
  return {
    schemaVersion: 1,
    id: "profile-1",
    customerName: "Acme",
    baseUrl: "https://acme.stackenterprise.co",
    oauthClientId: "acme-client",
    includeNoExpiry: false,
    createdAt: "2026-08-19T10:00:00.000Z",
    updatedAt: "2026-08-19T10:00:00.000Z",
    ...overrides,
  };
}

function installFakeIndexedDB(options: { existingStores?: string[] } = {}): FakeIndexedDB {
  const fake = new FakeIndexedDB(options.existingStores ?? []);
  vi.stubGlobal("indexedDB", fake.indexedDB);
  return fake;
}

type TransactionFailure = { outcome: "abort" | "error"; error: Error };
type OpenBlock = { succeedLater: boolean };
type RequestFailure = { remainingRequests: number; error: Error };

class FakeIndexedDB {
  readonly createdObjectStores: string[] = [];
  readonly openCalls: Array<{ name: string; version?: number }> = [];
  readonly transactionCalls: Array<{
    storeNames: string[];
    mode: IDBTransactionMode;
  }> = [];
  readonly transactionEvents: Array<"error" | "abort"> = [];
  readonly putCalls: Array<{ storeName: string; key: IDBValidKey; value: unknown }> = [];
  readonly indexedDB = {
    open: (name: string, version?: number) => this.open(name, version),
  };

  closeCount = 0;
  private readonly stores = new Map<string, Map<string, unknown>>();
  private nextOpenBlock: OpenBlock | null = null;
  private nextOpenError: Error | null = null;
  private nextRequestFailure: RequestFailure | null = null;
  private nextTransactionFailure: TransactionFailure | null = null;

  constructor(existingStores: string[]) {
    for (const storeName of existingStores) {
      this.stores.set(storeName, new Map());
    }
  }

  store(name: string): Map<string, unknown> {
    const store = this.stores.get(name);
    if (!store) {
      throw new Error(`Missing fake object store: ${name}`);
    }
    return store;
  }

  hasStore(name: string): boolean {
    return this.stores.has(name);
  }

  createStore(name: string): void {
    this.stores.set(name, new Map());
    this.createdObjectStores.push(name);
  }

  failNextOpen(error: Error): void {
    this.nextOpenError = error;
  }

  blockNextOpen(options: { succeedLater?: boolean } = {}): void {
    this.nextOpenBlock = { succeedLater: options.succeedLater ?? false };
  }

  failNextRequest(error: Error): void {
    this.failRequestAt(1, error);
  }

  failRequestAt(requestNumber: number, error: Error): void {
    this.nextRequestFailure = { remainingRequests: requestNumber, error };
  }

  failNextTransaction(outcome: "abort" | "error", error: Error): void {
    this.nextTransactionFailure = { outcome, error };
  }

  consumeRequestError(): Error | null {
    if (!this.nextRequestFailure) {
      return null;
    }

    this.nextRequestFailure.remainingRequests -= 1;
    if (this.nextRequestFailure.remainingRequests > 0) {
      return null;
    }

    const { error } = this.nextRequestFailure;
    this.nextRequestFailure = null;
    return error;
  }

  recordTransactionEvent(event: "error" | "abort"): void {
    this.transactionEvents.push(event);
  }

  consumeTransactionFailure(): TransactionFailure | null {
    const failure = this.nextTransactionFailure;
    this.nextTransactionFailure = null;
    return failure;
  }

  createTransaction(
    storeNames: string | string[],
    mode: IDBTransactionMode = "readonly",
  ): FakeIDBTransaction {
    const normalizedStoreNames = typeof storeNames === "string" ? [storeNames] : [...storeNames];
    this.transactionCalls.push({ storeNames: normalizedStoreNames, mode });
    return new FakeIDBTransaction(
      this,
      normalizedStoreNames,
      mode,
      this.consumeTransactionFailure(),
    );
  }

  private open(name: string, version?: number): IDBOpenDBRequest {
    this.openCalls.push({ name, version });
    const database = new FakeIDBDatabase(this);
    const request = new FakeIDBOpenRequest(database);
    const openBlock = this.nextOpenBlock;
    const openError = this.nextOpenError;
    this.nextOpenBlock = null;
    this.nextOpenError = null;

    queueMicrotask(() => {
      if (openError) {
        request.fireError(openError);
        return;
      }

      if (openBlock) {
        request.fireBlocked();
        if (openBlock.succeedLater) {
          queueMicrotask(() => this.finishOpen(request, database));
        }
        return;
      }

      this.finishOpen(request, database);
    });

    return request as unknown as IDBOpenDBRequest;
  }

  private finishOpen(
    request: FakeIDBOpenRequest<FakeIDBDatabase>,
    database: FakeIDBDatabase,
  ): void {
    if (!this.hasStore("profiles") || !this.hasStore("preferences")) {
      request.fireUpgradeNeeded();
    }
    request.fireSuccess(database);
  }
}

class FakeIDBDatabase {
  readonly objectStoreNames = {
    contains: (name: string) => this.fake.hasStore(name),
  };

  constructor(private readonly fake: FakeIndexedDB) {}

  createObjectStore(name: string): IDBObjectStore {
    this.fake.createStore(name);
    return {} as IDBObjectStore;
  }

  transaction(
    storeNames: string | string[],
    mode: IDBTransactionMode = "readonly",
  ): IDBTransaction {
    return this.fake.createTransaction(storeNames, mode) as unknown as IDBTransaction;
  }

  close(): void {
    this.fake.closeCount += 1;
  }
}

class FakeIDBTransaction {
  error: Error | null = null;
  onabort: (() => void) | null = null;
  oncomplete: (() => void) | null = null;
  onerror: (() => void) | null = null;

  private pendingRequests = 0;
  private completionQueued = false;
  private finished = false;
  private initialTaskActive = true;
  private requestCallbackActive = false;
  private readonly stagedWrites: Array<() => void> = [];

  constructor(
    private readonly fake: FakeIndexedDB,
    private readonly storeNames: string[],
    private readonly mode: IDBTransactionMode,
    private readonly failure: TransactionFailure | null,
  ) {
    queueMicrotask(() => {
      this.initialTaskActive = false;
    });
  }

  objectStore(name: string): IDBObjectStore {
    if (!this.storeNames.includes(name)) {
      throw new Error(`Store ${name} is not in this transaction.`);
    }
    return new FakeIDBObjectStore(this.fake, this, name) as unknown as IDBObjectStore;
  }

  startRequest(): void {
    if (this.finished || (!this.initialTaskActive && !this.requestCallbackActive)) {
      throw new Error("TransactionInactiveError");
    }
    this.pendingRequests += 1;
  }

  runRequestCallback(callback: () => void): void {
    this.requestCallbackActive = true;
    try {
      callback();
    } finally {
      this.requestCallbackActive = false;
    }
  }

  stageWrite(write: () => void): void {
    if (this.mode !== "readwrite") {
      throw new Error("ReadOnlyError");
    }
    this.stagedWrites.push(write);
  }

  finishRequest(): void {
    this.pendingRequests -= 1;
    this.queueCompletion();
  }

  failRequest(error: Error): void {
    this.error = error;
    this.finished = true;
    this.fake.recordTransactionEvent("error");
    this.onerror?.();
    this.fake.recordTransactionEvent("abort");
    this.onabort?.();
  }

  private queueCompletion(): void {
    if (this.completionQueued || this.pendingRequests !== 0 || this.finished) {
      return;
    }
    this.completionQueued = true;

    queueMicrotask(() => {
      this.completionQueued = false;
      if (this.pendingRequests !== 0 || this.finished) {
        return;
      }
      this.finished = true;

      if (this.failure) {
        this.error = this.failure.error;
        if (this.failure.outcome === "abort") {
          this.fake.recordTransactionEvent("abort");
          this.onabort?.();
        } else {
          this.fake.recordTransactionEvent("error");
          this.onerror?.();
          this.fake.recordTransactionEvent("abort");
          this.onabort?.();
        }
        return;
      }

      for (const write of this.stagedWrites) {
        write();
      }
      this.oncomplete?.();
    });
  }
}

class FakeIDBObjectStore {
  constructor(
    private readonly fake: FakeIndexedDB,
    private readonly transaction: FakeIDBTransaction,
    private readonly storeName: string,
  ) {}

  get(key: IDBValidKey): IDBRequest<unknown> {
    return this.scheduleRequest(() => this.fake.store(this.storeName).get(String(key)));
  }

  getAll(): IDBRequest<unknown[]> {
    return this.scheduleRequest(() => [...this.fake.store(this.storeName).values()]);
  }

  put(value: unknown, key: IDBValidKey): IDBRequest<IDBValidKey> {
    this.fake.putCalls.push({ storeName: this.storeName, key, value });
    return this.scheduleRequest(() => {
      this.transaction.stageWrite(() => this.fake.store(this.storeName).set(String(key), value));
      return key;
    });
  }

  delete(key: IDBValidKey): IDBRequest<undefined> {
    return this.scheduleRequest(() => {
      this.transaction.stageWrite(() => this.fake.store(this.storeName).delete(String(key)));
      return undefined;
    });
  }

  private scheduleRequest<T>(operation: () => T): IDBRequest<T> {
    this.transaction.startRequest();
    const request = new FakeIDBRequest<T>();

    queueMicrotask(() => {
      const error = this.fake.consumeRequestError();
      if (error) {
        this.transaction.runRequestCallback(() => request.fireError(error));
        this.transaction.failRequest(error);
        return;
      }

      this.transaction.runRequestCallback(() => request.fireSuccess(operation()));
      this.transaction.finishRequest();
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
  onblocked: (() => void) | null = null;
  onupgradeneeded: (() => void) | null = null;

  constructor(result: T) {
    super();
    this.result = result;
  }

  fireUpgradeNeeded(): void {
    this.onupgradeneeded?.();
  }

  fireBlocked(): void {
    this.onblocked?.();
  }
}
