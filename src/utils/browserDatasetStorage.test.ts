import { afterEach, describe, expect, it, vi } from "vitest";
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
    await expect(
      savePersistedDatasetSession({
        version: 1,
        selectedReportId: "tag-report",
        selectedReportIds: ["tag-report"],
        datasets: {},
        reportOutputs: {},
        reportRunSnapshots: [],
        warnings: [],
      }),
    ).resolves.toBeUndefined();
    await expect(clearPersistedDatasetSession()).resolves.toBeUndefined();
  });

  it("rejects when IndexedDB cannot open", async () => {
    vi.stubGlobal("indexedDB", {
      open: () => {
        throw new Error("IndexedDB blocked");
      },
    });

    await expect(loadPersistedDatasetSession()).rejects.toThrow("IndexedDB blocked");
  });
});
