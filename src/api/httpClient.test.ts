import { describe, expect, it } from "vitest";

import { InvalidApiResponseError, readJsonResponse } from "./httpClient";

describe("readJsonResponse", () => {
  it("throws a safe typed error for invalid successful JSON without retaining response data", async () => {
    const response = new Response("secret response body", { status: 200 });

    const result = readJsonResponse(response, "Stack API v3");

    await expect(result).rejects.toEqual(expect.objectContaining({
      name: "InvalidApiResponseError",
      message: "Stack API v3 returned invalid JSON.",
    }));
    await expect(result).rejects.toBeInstanceOf(InvalidApiResponseError);
    await expect(result).rejects.not.toHaveProperty("cause");
    await expect(result).rejects.not.toHaveProperty("url");
    await expect(result).rejects.not.toHaveProperty("responseText");
    await expect(result).rejects.not.toThrow(/secret|unknown URL/);
  });
});
