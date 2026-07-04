import { afterEach, describe, expect, it, vi } from "vitest";
import { downloadTextFile, recordsToCsv, recordsToJson } from "./downloads";

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

  it("revokes object URLs when click throws", () => {
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

    expect(() => downloadTextFile("report.csv", "contents", "text/csv")).toThrow("click failed");
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:test");
  });
});
