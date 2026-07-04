import { describe, expect, it } from "vitest";
import { recordsToCsv, recordsToJson } from "./downloads";

describe("downloads", () => {
  it("serializes records to CSV with escaped commas", () => {
    expect(recordsToCsv([{ name: "Harley Q.", tags: "release-management, product-support" }])).toBe(
      'name,tags\nHarley Q.,"release-management, product-support"',
    );
  });

  it("serializes records to pretty JSON", () => {
    expect(recordsToJson([{ id: 1 }])).toBe('[\n  {\n    "id": 1\n  }\n]');
  });
});
