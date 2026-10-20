import Papa from "papaparse";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  downloadBlobFile,
  downloadTextFile,
  recordsToCsv,
  recordsToCsvWithHeaders,
  recordsToJson,
} from "./downloads";

describe("downloads", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("serializes records to CSV with escaped commas", () => {
    expect(recordsToCsv([{ name: "Harley Q.", tags: "release-management, product-support" }])).toBe(
      'name,tags\nHarley Q.,"release-management, product-support"',
    );
  });

  it("serializes records to pretty JSON", () => {
    expect(recordsToJson([{ id: 1 }])).toBe('[\n  {\n    "id": 1\n  }\n]');
  });

  it("serializes records to CSV using a stable union of keys", () => {
    expect(recordsToCsv([{ id: 1 }, { id: 2, name: "Harley Q." }])).toBe("id,name\n1,\n2,Harley Q.");
  });

  it("serializes fixed CSV headers for empty records and escapes RFC-style values", () => {
    expect(
      recordsToCsvWithHeaders(["name", "note", "missing"], [
        { name: "Harley, Q.", note: 'Said "hello"\r\nthen left' },
      ]),
    ).toBe('name,note,missing\n"Harley, Q.","Said ""hello""\r\nthen left",');
    expect(recordsToCsvWithHeaders(["name", "note"], [])).toBe("name,note");
  });

  it("formats only datetime-shaped columns while preserving IDs, counts, and invalid values", () => {
    const record = {
      creation_date: 1_735_689_600,
      creationDate: "2025-01-01T13:00:00.125+01:00",
      lastUsed: "2025-01-02",
      last_used: "2025-01-02 13:45:12",
      createdAt: "1735689600000",
      completed_at: "2025-01-01T12:00:00",
      timestamp: 1_735_689_600,
      eventTimestamp: 1_735_689_600,
      invalid_date: "2025-02-30",
      missing_date: null,
      boolean_date: false,
      user_id: 1_735_689_600,
      view_count: 1_735_689_600,
      daysSinceLastUsed: 1_735_689_600,
      date_count: 1_735_689_600,
      timestampCount: 1_735_689_600,
      body: "2025-01-01T12:00:00Z",
    };
    const original = structuredClone(record);
    const rows = Papa.parse<Record<string, string>>(recordsToCsv([record]), { header: true }).data;
    expect(rows[0]).toEqual({
      creation_date: "2025-01-01 00:00:00",
      creationDate: "2025-01-01 12:00:00.125",
      lastUsed: "2025-01-02 00:00:00",
      last_used: "2025-01-02 13:45:12",
      createdAt: "2025-01-01 00:00:00",
      completed_at: "2025-01-01 12:00:00",
      timestamp: "2025-01-01 00:00:00",
      eventTimestamp: "2025-01-01 00:00:00",
      invalid_date: "2025-02-30",
      missing_date: "",
      boolean_date: "false",
      user_id: "1735689600",
      view_count: "1735689600",
      daysSinceLastUsed: "1735689600",
      date_count: "1735689600",
      timestampCount: "1735689600",
      body: "2025-01-01T12:00:00Z",
    });
    expect(record).toEqual(original);
    expect(JSON.parse(recordsToJson([record]))).toEqual([original]);
  });

  it("preserves nested objects and arrays as JSON cells with readable dates", () => {
    const record = {
      owner: { user_id: 1_735_689_600, creation_date: 1_735_689_600, display_name: 'Ada, "Countess"' },
      answers: [{ answer_id: 1, creationDate: "2025-01-01T13:00:00.1234567+01:00" }],
      badge_counts: { gold: 1_735_689_600, silver: 2 },
      tags: ["python", "c++"],
    };
    const original = structuredClone(record);
    const rows = Papa.parse<Record<string, string>>(recordsToCsv([record]), { header: true }).data;
    expect(JSON.parse(rows[0].owner)).toEqual({
      user_id: 1_735_689_600, creation_date: "2025-01-01 00:00:00", display_name: 'Ada, "Countess"',
    });
    expect(JSON.parse(rows[0].answers)).toEqual([{ answer_id: 1, creationDate: "2025-01-01 12:00:00.123" }]);
    expect(JSON.parse(rows[0].badge_counts)).toEqual(record.badge_counts);
    expect(JSON.parse(rows[0].tags)).toEqual(record.tags);
    expect(record).toEqual(original);
    expect(JSON.parse(recordsToJson([record]))).toEqual([original]);
  });

  it("downloads the exact Blob with the requested filename and revokes its URL", () => {
    const blob = new Blob(["pdf"], { type: "application/pdf" });
    const link = { click: vi.fn(), download: "", href: "" };
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: vi.fn(() => "blob:test"),
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: vi.fn(),
    });
    vi.spyOn(document, "createElement").mockReturnValue(link as unknown as HTMLAnchorElement);

    downloadBlobFile("decision-pack.pdf", blob);

    expect(URL.createObjectURL).toHaveBeenCalledWith(blob);
    expect(link.href).toBe("blob:test");
    expect(link.download).toBe("decision-pack.pdf");
    expect(link.click).toHaveBeenCalledOnce();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:test");
  });

  it("makes text downloads delegate through the Blob behavior", () => {
    let receivedBlob: Blob | undefined;
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: vi.fn((blob: Blob) => {
        receivedBlob = blob;
        return "blob:text";
      }),
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: vi.fn(),
    });
    vi.spyOn(document, "createElement").mockReturnValue({
      click: vi.fn(),
      download: "",
      href: "",
    } as unknown as HTMLAnchorElement);

    downloadTextFile("report.csv", "contents", "text/csv;charset=utf-8");

    expect(receivedBlob?.type).toBe("text/csv;charset=utf-8");
    expect(receivedBlob?.size).toBe(8);
  });

  it("revokes object URLs and rethrows when Blob download click throws", () => {
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: vi.fn(() => "blob:test"),
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: vi.fn(),
    });
    vi.spyOn(document, "createElement").mockReturnValue({
      click: () => {
        throw new Error("click failed");
      },
      download: "",
      href: "",
    } as unknown as HTMLAnchorElement);

    const blob = new Blob(["contents"], { type: "text/csv" });

    expect(() => downloadBlobFile("report.csv", blob)).toThrow("click failed");
    expect(URL.createObjectURL).toHaveBeenCalledWith(blob);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:test");
  });
});
