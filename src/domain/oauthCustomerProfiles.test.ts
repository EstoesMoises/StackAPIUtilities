import { describe, expect, it } from "vitest";
import {
  OAUTH_CUSTOMER_PROFILE_SCHEMA_VERSION,
  createOAuthCustomerProfile,
  isOAuthCustomerProfileDraftDirty,
  parseOAuthCustomerProfile,
  parseOAuthCustomerProfilePreferences,
  toOAuthCustomerProfileDraft,
  updateOAuthCustomerProfile,
  type OAuthCustomerProfile,
} from "./oauthCustomerProfiles";

const draft = {
  customerName: "Acme",
  baseUrl: "https://acme.stackenterprise.co",
  oauthClientId: "acme-client",
  includeNoExpiry: false,
};

const profile: OAuthCustomerProfile = {
  schemaVersion: OAUTH_CUSTOMER_PROFILE_SCHEMA_VERSION,
  id: "profile-1",
  createdAt: "2026-08-19T10:00:00.000Z",
  updatedAt: "2026-08-19T10:00:00.000Z",
  ...draft,
};

describe("OAuth customer profiles", () => {
  it("creates a normalized profile with injected ID and time", () => {
    const result = createOAuthCustomerProfile(
      {
        customerName: "  Acme  ",
        baseUrl: "https://acme.stackenterprise.co/path?source=test",
        oauthClientId: "  client-id  ",
        includeNoExpiry: true,
      },
      [],
      { createId: () => "new-profile", now: () => new Date("2026-08-19T12:34:56.000Z") },
    );

    expect(result).toEqual({
      ok: true,
      profile: {
        schemaVersion: 1,
        id: "new-profile",
        customerName: "Acme",
        baseUrl: "https://acme.stackenterprise.co",
        oauthClientId: "client-id",
        includeNoExpiry: true,
        createdAt: "2026-08-19T12:34:56.000Z",
        updatedAt: "2026-08-19T12:34:56.000Z",
      },
    });
  });

  it("rejects customer names duplicated case-insensitively after trimming", () => {
    expect(createOAuthCustomerProfile({ ...draft, customerName: "  aCmE " }, [profile])).toEqual({
      ok: false,
      errors: { customerName: "Use a unique customer name." },
    });
  });

  it.each([
    ["Greek sigma case forms", "ΟΣ", "οσ"],
    ["canonically equivalent accents", "É", "E\u0301"],
  ])("rejects customer names duplicated by %s", (_description, existingName, newName) => {
    expect(
      createOAuthCustomerProfile(
        { ...draft, customerName: newName },
        [{ ...profile, customerName: existingName }],
      ),
    ).toEqual({
      ok: false,
      errors: { customerName: "Use a unique customer name." },
    });
  });

  it("retains accent distinctions in customer names", () => {
    const result = createOAuthCustomerProfile(
      { ...draft, customerName: "È" },
      [{ ...profile, customerName: "É" }],
      { createId: () => "profile-2", now: () => new Date("2026-08-20T10:00:00.000Z") },
    );

    expect(result.ok).toBe(true);
  });

  it("updates a profile while retaining its own name and immutable fields", () => {
    const result = updateOAuthCustomerProfile(
      profile,
      {
        customerName: " ACME ",
        baseUrl: "https://acme.stackenterprise.co/new-path",
        oauthClientId: " updated-client ",
        includeNoExpiry: true,
      },
      [profile],
      { now: () => new Date("2026-08-20T11:00:00.000Z") },
    );

    expect(result).toEqual({
      ok: true,
      profile: {
        ...profile,
        customerName: "ACME",
        baseUrl: "https://acme.stackenterprise.co",
        oauthClientId: "updated-client",
        includeNoExpiry: true,
        updatedAt: "2026-08-20T11:00:00.000Z",
      },
    });
  });

  it("rejects an update that collides with a different existing profile", () => {
    const otherProfile = { ...profile, id: "profile-2", customerName: "Other Customer" };

    expect(
      updateOAuthCustomerProfile(
        profile,
        { ...draft, customerName: "other customer" },
        [profile, otherProfile],
      ),
    ).toEqual({
      ok: false,
      errors: { customerName: "Use a unique customer name." },
    });
  });

  it.each([
    ["blank name", { ...draft, customerName: "  " }, { customerName: "Enter a customer name." }],
    ["blank client ID", { ...draft, oauthClientId: "  " }, { oauthClientId: "Enter an OAuth client ID." }],
    ["HTTP URL", { ...draft, baseUrl: "http://acme.stackenterprise.co" }, { baseUrl: "Enter a Stack Enterprise HTTPS instance URL." }],
    ["unrelated URL", { ...draft, baseUrl: "https://example.com" }, { baseUrl: "Enter a Stack Enterprise HTTPS instance URL." }],
  ])("rejects a %s", (_description, invalidDraft, errors) => {
    expect(createOAuthCustomerProfile(invalidDraft, [])).toEqual({ ok: false, errors });
  });

  it("rejects a non-boolean includeNoExpiry at the mutation boundary", () => {
    expect(createOAuthCustomerProfile({ ...draft, includeNoExpiry: "true" } as never, [])).toEqual({
      ok: false,
      errors: { includeNoExpiry: "Choose whether to include users without an expiry date." },
    });
  });

  it.each([
    ["customerName", null, { customerName: "Enter a customer name." }],
    ["baseUrl", 42, { baseUrl: "Enter a Stack Enterprise HTTPS instance URL." }],
    ["oauthClientId", {}, { oauthClientId: "Enter an OAuth client ID." }],
  ])("returns structured errors for a non-string %s", (field, value, errors) => {
    expect(createOAuthCustomerProfile({ ...draft, [field]: value } as never, [])).toEqual({
      ok: false,
      errors,
    });
  });

  it.each([
    ["an invalid schema", { ...profile, schemaVersion: 2 }],
    ["a non-boolean includeNoExpiry", { ...profile, includeNoExpiry: "false" }],
    ["an invalid timestamp", { ...profile, createdAt: "not a timestamp" }],
    ["a non-exact timestamp", { ...profile, updatedAt: "2026-08-19T10:00:00Z" }],
    ["a noncanonical base URL", { ...profile, baseUrl: "https://acme.stackenterprise.co/" }],
    ["a whitespace-padded name", { ...profile, customerName: " Acme" }],
    ["a whitespace-padded client ID", { ...profile, oauthClientId: "acme-client " }],
  ])("rejects a persisted profile with %s", (_description, value) => {
    expect(parseOAuthCustomerProfile(value)).toBeNull();
  });

  it("reconstructs profiles from an exact allowlist", () => {
    const parsed = parseOAuthCustomerProfile({
      ...profile,
      accessToken: "secret-token",
      apiKey: "secret-key",
      oauthScopes: ["read"],
      authSource: "manual",
      codeVerifier: "secret-verifier",
      clientSecret: "secret-client-secret",
    });

    expect(parsed).toEqual(profile);
    expect(parsed).not.toHaveProperty("accessToken");
    expect(parsed).not.toHaveProperty("apiKey");
    expect(parsed).not.toHaveProperty("oauthScopes");
    expect(parsed).not.toHaveProperty("authSource");
    expect(parsed).not.toHaveProperty("codeVerifier");
    expect(parsed).not.toHaveProperty("clientSecret");
  });

  it("parses preferences from an allowlist", () => {
    expect(
      parseOAuthCustomerProfilePreferences({
        schemaVersion: 1,
        lastSelectedProfileId: " profile-1 ",
      }),
    ).toBeNull();
    expect(
      parseOAuthCustomerProfilePreferences({
        schemaVersion: 1,
        lastSelectedProfileId: "profile-1",
        accessToken: "secret-token",
        apiKey: "secret-key",
        oauthScopes: ["read"],
        authSource: "manual",
        codeVerifier: "secret-verifier",
        clientSecret: "secret-client-secret",
      }),
    ).toEqual({ schemaVersion: 1, lastSelectedProfileId: "profile-1" });
    expect(parseOAuthCustomerProfilePreferences({ schemaVersion: 2 })).toBeNull();
    expect(parseOAuthCustomerProfilePreferences({ schemaVersion: 1, lastSelectedProfileId: " " })).toBeNull();
  });

  it("converts profiles to drafts and detects clean versus normalized dirty drafts", () => {
    expect(toOAuthCustomerProfileDraft(profile)).toEqual(draft);
    expect(
      isOAuthCustomerProfileDraftDirty(profile, {
        ...draft,
        customerName: " Acme ",
        baseUrl: "https://acme.stackenterprise.co/path",
        oauthClientId: " acme-client ",
      }),
    ).toBe(false);
    expect(isOAuthCustomerProfileDraftDirty(profile, { ...draft, includeNoExpiry: true })).toBe(true);
  });
});
