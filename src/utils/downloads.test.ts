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
