import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OAuthCustomerProfile } from "../domain/oauthCustomerProfiles";
import type { SessionCredentials } from "../domain/types";
import type { OAuthCustomerProfileStoreSnapshot } from "../utils/browserOAuthProfileStorage";
import { CredentialsPanel } from "./CredentialsPanel";

const profileStorageMocks = vi.hoisted(() => ({
  load: vi.fn(),
  saveProfile: vi.fn(),
  saveProfileAndSelect: vi.fn(),
  saveLastSelectedProfileId: vi.fn(),
  deleteProfile: vi.fn(),
}));

vi.mock("../utils/browserOAuthProfileStorage", () => ({
  loadOAuthCustomerProfileStore: profileStorageMocks.load,
  saveOAuthCustomerProfile: profileStorageMocks.saveProfile,
  saveOAuthCustomerProfileAndSelect: profileStorageMocks.saveProfileAndSelect,
  saveLastSelectedOAuthCustomerProfileId: profileStorageMocks.saveLastSelectedProfileId,
  deleteOAuthCustomerProfile: profileStorageMocks.deleteProfile,
}));

const originalClipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, "clipboard");

beforeEach(() => {
  profileStorageMocks.load.mockReset().mockReturnValue(new Promise(() => {}));
  profileStorageMocks.saveProfile.mockReset().mockResolvedValue(undefined);
  profileStorageMocks.saveProfileAndSelect.mockReset().mockResolvedValue(undefined);
  profileStorageMocks.saveLastSelectedProfileId.mockReset().mockResolvedValue(undefined);
  profileStorageMocks.deleteProfile.mockReset().mockResolvedValue(undefined);
  vi.spyOn(globalThis, "fetch").mockReturnValue(new Promise(() => {}));
});

afterEach(() => {
  vi.restoreAllMocks();
  if (originalClipboardDescriptor) {
    Object.defineProperty(navigator, "clipboard", originalClipboardDescriptor);
  } else {
    Reflect.deleteProperty(navigator, "clipboard");
  }
});

describe("CredentialsPanel", () => {
  it("shows read-only mixed-lane requirements for SME Coverage Analyzer", () => {
    renderCredentialsPanel({ workflow: { kind: "utility", utilityId: "sme-coverage-analyzer" } });

    expect(screen.getByText("Scope notes for selected utility")).toBeInTheDocument();
    expect(screen.getByText("SME Coverage Analyzer credential notes")).toBeInTheDocument();
    expect(screen.getByText(/read-only/i)).toBeInTheDocument();
    expect(screen.getByText(/both API lanes/i)).toBeInTheDocument();
    expect(screen.getByText(/API key, Access token/i)).toBeInTheDocument();
  });

  it("starts read-only utility Enterprise OAuth with no write scopes", async () => {
    const user = userEvent.setup();
    const popup = createPopup();
    vi.spyOn(window, "open").mockReturnValue(popup as unknown as Window);
    const fetchMock = mockOAuthEndpoints();

    renderCredentialsPanel({ workflow: { kind: "utility", utilityId: "sme-coverage-analyzer" } });

    await user.selectOptions(screen.getByLabelText("Instance type"), "enterprise");
    await user.type(screen.getByLabelText("Instance URL"), "https://demo.stackenterprise.co");
    await user.type(screen.getByLabelText("OAuth Client ID"), "client-123");
    await user.click(screen.getByRole("button", { name: "Connect with Enterprise OAuth" }));

    await waitFor(() => expect(findOAuthStartCall(fetchMock)).toBeDefined());
    const startCall = findOAuthStartCall(fetchMock);
    expect(JSON.parse(String(startCall?.[1]?.body))).toMatchObject({ scopes: [] });
    expect(JSON.parse(String(startCall?.[1]?.body)).scopes).not.toContain("write_access");
  });

  it("starts User Group Sync Enterprise OAuth with exactly write_access", async () => {
    const user = userEvent.setup();
    const popup = createPopup();
    vi.spyOn(window, "open").mockReturnValue(popup as unknown as Window);
    const fetchMock = mockOAuthEndpoints(
      "https://demo.stackenterprise.co/oauth?state=write-tool",
    );

    renderCredentialsPanel({ workflow: { kind: "write-tool", writeToolId: "user-group-sync" } });

    expect(screen.getByText("User Group Sync credential notes")).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("Instance type"), "enterprise");
    await user.type(screen.getByLabelText("Instance URL"), "https://demo.stackenterprise.co");
    await user.type(screen.getByLabelText("OAuth Client ID"), "client-123");
    await user.click(screen.getByRole("button", { name: "Connect with Enterprise OAuth" }));

    await waitFor(() => expect(findOAuthStartCall(fetchMock)).toBeDefined());
    expect(JSON.parse(String(findOAuthStartCall(fetchMock)?.[1]?.body))).toMatchObject({
      scopes: ["write_access"],
    });
  });

  it("shows PAT credentials for Basic/Business and hides Enterprise OAuth controls", () => {
    renderCredentialsPanel();

    expect(screen.getByLabelText("Instance type")).toHaveValue("basic-business");
    expect(screen.getByLabelText("Personal access token")).toBeInTheDocument();
    expect(screen.queryByLabelText("OAuth Client ID")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Connect with Enterprise OAuth" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Access token")).not.toBeInTheDocument();
  });

  it("shows OAuth controls and API key support for Enterprise", async () => {
    const user = userEvent.setup();

    renderCredentialsPanel();

    await user.selectOptions(screen.getByLabelText("Instance type"), "enterprise");

    expect(screen.getByLabelText("API key")).toBeInTheDocument();
    expect(screen.getByLabelText("Access token (optional)")).toBeInTheDocument();
    expect(screen.getByText("Optional if you connect with Enterprise OAuth.")).toBeInTheDocument();
    expect(screen.getByLabelText("OAuth Client ID")).toBeInTheDocument();
    expect(screen.getByLabelText("Request non-expiring token")).not.toBeChecked();
    expect(screen.getByRole("button", { name: "Connect with Enterprise OAuth" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Personal access token")).not.toBeInTheDocument();
  });

  it("saves manually pasted Enterprise access tokens like session credentials", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();

    renderCredentialsPanel({ onSave });

    await user.selectOptions(screen.getByLabelText("Instance type"), "enterprise");
    await user.type(screen.getByLabelText("Instance URL"), "https://demo.stackenterprise.co");
    await user.type(screen.getByLabelText("API key"), "api-key");
    await user.type(screen.getByLabelText("Access token (optional)"), " manual-token ");
    await user.click(screen.getByRole("button", { name: "Save session credentials" }));

    expect(onSave).toHaveBeenCalledWith({
      instanceType: "enterprise",
      baseUrl: "https://demo.stackenterprise.co",
      apiKey: "api-key",
      oauthClientId: undefined,
      accessToken: "manual-token",
      authSource: "manual-enterprise-token",
    });
  });

  it("initializes the Enterprise access token field from existing manual token credentials", () => {
    renderCredentialsPanel({
      credentials: {
        instanceType: "enterprise",
        baseUrl: "https://demo.stackenterprise.co",
        accessToken: "manual-token",
        authSource: "manual-enterprise-token",
      },
    });

    expect(screen.getByLabelText("Access token (optional)")).toHaveValue("manual-token");
  });

  it("starts Enterprise OAuth with write_access and no no_expiry by default", async () => {
    const user = userEvent.setup();
    const popup = createPopup();
    vi.spyOn(window, "open").mockReturnValue(popup as unknown as Window);
    const fetchMock = mockOAuthEndpoints();

    renderCredentialsPanel();

    await user.selectOptions(screen.getByLabelText("Instance type"), "enterprise");
    await user.type(screen.getByLabelText("Instance URL"), " https://demo.stackenterprise.co ");
    await user.type(screen.getByLabelText("OAuth Client ID"), " client-123 ");
    await user.click(screen.getByRole("button", { name: "Connect with Enterprise OAuth" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith("/api/oauth/pkce/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          baseUrl: "https://demo.stackenterprise.co",
          clientId: "client-123",
          scopes: ["write_access"],
          includeNoExpiry: false,
        }),
      });
    });
    expect(popup.location.href).toBe("https://demo.stackenterprise.co/oauth?state=abc");
  });

  it("starts Enterprise OAuth with no-expiry opt in", async () => {
    const user = userEvent.setup();
    const popup = createPopup();
    vi.spyOn(window, "open").mockReturnValue(popup as unknown as Window);
    const fetchMock = mockOAuthEndpoints();

    renderCredentialsPanel();

    await user.selectOptions(screen.getByLabelText("Instance type"), "enterprise");
    await user.type(screen.getByLabelText("Instance URL"), "https://demo.stackenterprise.co");
    await user.type(screen.getByLabelText("OAuth Client ID"), "client-123");
    await user.click(screen.getByLabelText("Request non-expiring token"));
    await user.click(screen.getByRole("button", { name: "Connect with Enterprise OAuth" }));

    await waitFor(() => expect(findOAuthStartCall(fetchMock)).toBeDefined());
    expect(JSON.parse(String(findOAuthStartCall(fetchMock)?.[1]?.body))).toEqual({
      baseUrl: "https://demo.stackenterprise.co",
      clientId: "client-123",
      scopes: ["write_access"],
      includeNoExpiry: true,
    });
  });

  it("saves OAuth callback credentials merged with Enterprise API key", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    const popup = createPopup();
    vi.spyOn(window, "open").mockReturnValue(popup as unknown as Window);
    mockOAuthEndpoints();

    renderCredentialsPanel({ onSave });

    await user.selectOptions(screen.getByLabelText("Instance type"), "enterprise");
    await user.type(screen.getByLabelText("Instance URL"), "https://demo.stackenterprise.co");
    await user.type(screen.getByLabelText("API key"), "api-key");
    await user.type(screen.getByLabelText("OAuth Client ID"), "client-override");
    await user.click(screen.getByRole("button", { name: "Connect with Enterprise OAuth" }));

    const credential = {
      instanceType: "enterprise",
      baseUrl: "https://demo.stackenterprise.co",
      accessToken: "oauth-token",
      authSource: "oauth-pkce",
      oauthClientId: "client-override",
      oauthScopes: ["write_access"],
      accessTokenExpiresAt: "2026-07-05T12:00:00.000Z",
    } satisfies SessionCredentials;
    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          origin: window.location.origin,
          source: popup as unknown as MessageEventSource,
          data: { type: "stack-api-oauth-pkce-result", ok: true, credential },
        }),
      );
    });

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith({
        instanceType: "enterprise",
        baseUrl: "https://demo.stackenterprise.co",
        apiKey: "api-key",
        accessToken: "oauth-token",
        authSource: "oauth-pkce",
        oauthClientId: "client-override",
        oauthScopes: ["write_access"],
        accessTokenExpiresAt: "2026-07-05T12:00:00.000Z",
      });
    });
  });

  it("keeps OAuth callback credentials bound to the pending Enterprise URL", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    const popup = createPopup();
    vi.spyOn(window, "open").mockReturnValue(popup as unknown as Window);
    mockOAuthEndpoints();

    renderCredentialsPanel({ onSave });

    await user.selectOptions(screen.getByLabelText("Instance type"), "enterprise");
    await user.type(screen.getByLabelText("Instance URL"), "https://demo.stackenterprise.co");
    await user.type(screen.getByLabelText("OAuth Client ID"), "client-123");
    await user.click(screen.getByRole("button", { name: "Connect with Enterprise OAuth" }));
    await user.clear(screen.getByLabelText("Instance URL"));
    await user.type(screen.getByLabelText("Instance URL"), "https://other.stackenterprise.co");

    const credential = enterpriseOAuthCredentials();
    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          origin: window.location.origin,
          source: popup as unknown as MessageEventSource,
          data: { type: "stack-api-oauth-pkce-result", ok: true, credential },
        }),
      );
    });

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
        baseUrl: "https://demo.stackenterprise.co",
        oauthClientId: "client-123",
        accessToken: "oauth-token",
        authSource: "oauth-pkce",
      }));
    });
  });

  it("accepts OAuth callback credentials when the pending Enterprise URL normalizes to the returned origin", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    const popup = createPopup();
    const fetchMock = mockOAuthEndpoints();
    vi.spyOn(window, "open").mockReturnValue(popup as unknown as Window);

    renderCredentialsPanel({ onSave });

    await user.selectOptions(screen.getByLabelText("Instance type"), "enterprise");
    await user.type(screen.getByLabelText("Instance URL"), "https://demo.stackenterprise.co/");
    await user.type(screen.getByLabelText("OAuth Client ID"), "client-123");
    await user.click(screen.getByRole("button", { name: "Connect with Enterprise OAuth" }));

    expect(JSON.parse(String(findOAuthStartCall(fetchMock)?.[1]?.body))).toEqual(expect.objectContaining({
      baseUrl: "https://demo.stackenterprise.co/",
    }));

    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          origin: window.location.origin,
          source: popup as unknown as MessageEventSource,
          data: {
            type: "stack-api-oauth-pkce-result",
            ok: true,
            credential: enterpriseOAuthCredentials(),
          },
        }),
      );
    });

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
        baseUrl: "https://demo.stackenterprise.co",
        oauthClientId: "client-123",
        accessToken: "oauth-token",
        authSource: "oauth-pkce",
      }));
    });
  });

  it("clears preserved OAuth credentials when the Enterprise URL changes before save", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();

    renderCredentialsPanel({ credentials: enterpriseOAuthCredentials(), onSave });

    await user.clear(screen.getByLabelText("Instance URL"));
    await user.type(screen.getByLabelText("Instance URL"), "https://other.stackenterprise.co");
    await user.click(screen.getByRole("button", { name: "Save session credentials" }));

    expect(onSave).toHaveBeenCalledWith({
      instanceType: "enterprise",
      baseUrl: "https://other.stackenterprise.co",
      apiKey: undefined,
      oauthClientId: "client-123",
    });
  });

  it("clears preserved OAuth credentials when the OAuth Client ID changes before save", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();

    renderCredentialsPanel({ credentials: enterpriseOAuthCredentials(), onSave });

    await user.clear(screen.getByLabelText("OAuth Client ID"));
    await user.type(screen.getByLabelText("OAuth Client ID"), "client-456");
    await user.click(screen.getByRole("button", { name: "Save session credentials" }));

    expect(onSave).toHaveBeenCalledWith({
      instanceType: "enterprise",
      baseUrl: "https://demo.stackenterprise.co",
      apiKey: undefined,
      oauthClientId: "client-456",
    });
  });

  it("preserves OAuth credentials when Enterprise URL and OAuth Client ID still match", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();

    renderCredentialsPanel({ credentials: enterpriseOAuthCredentials(), onSave });

    await user.click(screen.getByRole("button", { name: "Save session credentials" }));

    expect(onSave).toHaveBeenCalledWith({
      instanceType: "enterprise",
      baseUrl: "https://demo.stackenterprise.co",
      apiKey: undefined,
      oauthClientId: "client-123",
      accessToken: "oauth-token",
      authSource: "oauth-pkce",
      oauthScopes: ["write_access"],
      accessTokenExpiresAt: "2026-07-05T12:00:00.000Z",
    });
  });

  it("preserves OAuth credentials when the Enterprise URL changes only by trailing slash", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();

    renderCredentialsPanel({ credentials: enterpriseOAuthCredentials(), onSave });

    await user.clear(screen.getByLabelText("Instance URL"));
    await user.type(screen.getByLabelText("Instance URL"), "https://demo.stackenterprise.co/");
    await user.click(screen.getByRole("button", { name: "Save session credentials" }));

    expect(onSave).toHaveBeenCalledWith({
      instanceType: "enterprise",
      baseUrl: "https://demo.stackenterprise.co/",
      apiKey: undefined,
      oauthClientId: "client-123",
      accessToken: "oauth-token",
      authSource: "oauth-pkce",
      oauthScopes: ["write_access"],
      accessTokenExpiresAt: "2026-07-05T12:00:00.000Z",
    });
  });

  it("ignores same-origin OAuth success messages without a pending flow", () => {
    const onSave = vi.fn();

    renderCredentialsPanel({ onSave });

    window.dispatchEvent(
      new MessageEvent("message", {
        origin: window.location.origin,
        data: {
          type: "stack-api-oauth-pkce-result",
          ok: true,
          credential: enterpriseOAuthCredentials(),
        },
      }),
    );

    expect(onSave).not.toHaveBeenCalled();
  });

  it("ignores same-origin OAuth success messages without the active popup source", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    const popup = createPopup();
    vi.spyOn(window, "open").mockReturnValue(popup as unknown as Window);
    mockOAuthEndpoints();

    renderCredentialsPanel({ onSave });

    await user.selectOptions(screen.getByLabelText("Instance type"), "enterprise");
    await user.type(screen.getByLabelText("Instance URL"), "https://demo.stackenterprise.co");
    await user.type(screen.getByLabelText("OAuth Client ID"), "client-123");
    const connectButton = screen.getByRole("button", { name: "Connect with Enterprise OAuth" });
    await user.click(connectButton);

    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          origin: window.location.origin,
          data: {
            type: "stack-api-oauth-pkce-result",
            ok: true,
            credential: enterpriseOAuthCredentials(),
          },
        }),
      );
    });

    expect(onSave).not.toHaveBeenCalled();
    expect(connectButton).toBeDisabled();
  });

  it("rejects malformed same-origin OAuth credentials after OAuth start", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    const popup = createPopup();
    vi.spyOn(window, "open").mockReturnValue(popup as unknown as Window);
    mockOAuthEndpoints();

    renderCredentialsPanel({ onSave });

    await user.selectOptions(screen.getByLabelText("Instance type"), "enterprise");
    await user.type(screen.getByLabelText("Instance URL"), "https://demo.stackenterprise.co");
    await user.type(screen.getByLabelText("OAuth Client ID"), "client-123");
    await user.click(screen.getByRole("button", { name: "Connect with Enterprise OAuth" }));

    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          origin: window.location.origin,
          source: popup as unknown as MessageEventSource,
          data: {
            type: "stack-api-oauth-pkce-result",
            ok: true,
            credential: {
              instanceType: "enterprise",
              baseUrl: "",
              accessToken: "oauth-token",
              authSource: "oauth-pkce",
            },
          },
        }),
      );
    });

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Unable to save Enterprise OAuth credentials. Try again.",
    );
    expect(onSave).not.toHaveBeenCalled();
  });

  it("ignores same-origin OAuth success messages from a different source", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    const popup = createPopup();
    vi.spyOn(window, "open").mockReturnValue(popup as unknown as Window);
    mockOAuthEndpoints();

    renderCredentialsPanel({ onSave });

    await user.selectOptions(screen.getByLabelText("Instance type"), "enterprise");
    await user.type(screen.getByLabelText("Instance URL"), "https://demo.stackenterprise.co");
    await user.type(screen.getByLabelText("OAuth Client ID"), "client-123");
    await user.click(screen.getByRole("button", { name: "Connect with Enterprise OAuth" }));

    window.dispatchEvent(
      new MessageEvent("message", {
        origin: window.location.origin,
        source: createPopup() as unknown as MessageEventSource,
        data: {
          type: "stack-api-oauth-pkce-result",
          ok: true,
          credential: enterpriseOAuthCredentials(),
        },
      }),
    );

    expect(onSave).not.toHaveBeenCalled();
  });

  it("does not call OAuth start when the popup is blocked", async () => {
    const user = userEvent.setup();
    vi.spyOn(window, "open").mockReturnValue(null);
    const fetchMock = mockOAuthEndpoints();

    renderCredentialsPanel();

    await user.selectOptions(screen.getByLabelText("Instance type"), "enterprise");
    await user.type(screen.getByLabelText("Instance URL"), "https://demo.stackenterprise.co");
    await user.type(screen.getByLabelText("OAuth Client ID"), "client-123");
    await user.click(screen.getByRole("button", { name: "Connect with Enterprise OAuth" }));

    expect(oauthStartCallCount(fetchMock)).toBe(0);
    expect(await screen.findByText("Enable pop-ups to connect with Enterprise OAuth.")).toBeInTheDocument();
  });

  it("prevents duplicate OAuth starts while a start request is unresolved", async () => {
    const user = userEvent.setup();
    const pendingStart = deferred<Response>();
    vi.spyOn(window, "open").mockReturnValue(createPopup() as unknown as Window);
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
      if (String(input) === "/api/oauth/pkce/config") {
        return Promise.resolve(jsonResponse({
          ok: true,
          redirectUri: "https://utilities.example.com/api/oauth/pkce/callback",
        }));
      }
      if (String(input) === "/api/oauth/pkce/start") {
        return pendingStart.promise;
      }
      return Promise.reject(new Error(`Unexpected fetch: ${String(input)}`));
    });

    renderCredentialsPanel();

    await user.selectOptions(screen.getByLabelText("Instance type"), "enterprise");
    await user.type(screen.getByLabelText("Instance URL"), "https://demo.stackenterprise.co");
    await user.type(screen.getByLabelText("OAuth Client ID"), "client-123");
    const connectButton = screen.getByRole("button", { name: "Connect with Enterprise OAuth" });
    await user.click(connectButton);
    await user.click(connectButton);

    expect(oauthStartCallCount(fetchMock)).toBe(1);
    expect(connectButton).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel Enterprise OAuth" })).toBeInTheDocument();
  });

  it("cancels a pending OAuth flow and allows a retry", async () => {
    const user = userEvent.setup();
    const firstPopup = createPopup();
    const secondPopup = createPopup();
    vi.spyOn(window, "open")
      .mockReturnValueOnce(firstPopup as unknown as Window)
      .mockReturnValueOnce(secondPopup as unknown as Window);
    let oauthStartCount = 0;
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      if (String(input) === "/api/oauth/pkce/config") {
        return jsonResponse({
          ok: true,
          redirectUri: "https://utilities.example.com/api/oauth/pkce/callback",
        });
      }
      if (String(input) === "/api/oauth/pkce/start") {
        oauthStartCount += 1;
        return jsonResponse({
          ok: true,
          authorizationUrl: `https://demo.stackenterprise.co/oauth?state=${oauthStartCount}`,
        });
      }
      throw new Error(`Unexpected fetch: ${String(input)}`);
    });

    renderCredentialsPanel();

    await user.selectOptions(screen.getByLabelText("Instance type"), "enterprise");
    await user.type(screen.getByLabelText("Instance URL"), "https://demo.stackenterprise.co");
    await user.type(screen.getByLabelText("OAuth Client ID"), "client-123");
    const connectButton = screen.getByRole("button", { name: "Connect with Enterprise OAuth" });
    await user.click(connectButton);

    expect(connectButton).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Cancel Enterprise OAuth" }));

    expect(firstPopup.close).toHaveBeenCalled();
    expect(connectButton).toBeEnabled();

    await user.click(connectButton);

    expect(oauthStartCallCount(fetchMock)).toBe(2);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Connect with Enterprise OAuth" })).toBeDisabled();
    });
  });

  it("ignores old popup callbacks after OAuth cancellation", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    const popup = createPopup();
    vi.spyOn(window, "open").mockReturnValue(popup as unknown as Window);
    mockOAuthEndpoints();

    renderCredentialsPanel({ onSave });

    await user.selectOptions(screen.getByLabelText("Instance type"), "enterprise");
    await user.type(screen.getByLabelText("Instance URL"), "https://demo.stackenterprise.co");
    await user.type(screen.getByLabelText("OAuth Client ID"), "client-123");
    await user.click(screen.getByRole("button", { name: "Connect with Enterprise OAuth" }));
    await user.click(screen.getByRole("button", { name: "Cancel Enterprise OAuth" }));

    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          origin: window.location.origin,
          source: popup as unknown as MessageEventSource,
          data: {
            type: "stack-api-oauth-pkce-result",
            ok: true,
            credential: enterpriseOAuthCredentials(),
          },
        }),
      );
    });

    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Connect with Enterprise OAuth" })).toBeEnabled();
  });

  it("initializes no-expiry opt in from existing OAuth scopes", () => {
    renderCredentialsPanel({
      credentials: {
        ...enterpriseOAuthCredentials(),
        oauthScopes: ["write_access", "no_expiry"],
      },
    });

    expect(screen.getByLabelText("Request non-expiring token")).toBeChecked();
  });

  it("ignores OAuth callback credentials from another origin", () => {
    const onSave = vi.fn();

    renderCredentialsPanel({ onSave });

    const credential = {
      instanceType: "enterprise",
      baseUrl: "https://demo.stackenterprise.co",
      accessToken: "oauth-token",
      authSource: "oauth-pkce",
      oauthClientId: "client-123",
      oauthScopes: ["write_access"],
      accessTokenExpiresAt: "2026-07-05T12:00:00.000Z",
    } satisfies SessionCredentials;
    window.dispatchEvent(
      new MessageEvent("message", {
        origin: "https://attacker.example",
        data: { type: "stack-api-oauth-pkce-result", ok: true, credential },
      }),
    );

    expect(onSave).not.toHaveBeenCalled();
  });

  it("closes the popup and shows server OAuth errors", async () => {
    const user = userEvent.setup();
    const popup = createPopup();
    vi.spyOn(window, "open").mockReturnValue(popup as unknown as Window);
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      if (String(input) === "/api/oauth/pkce/config") {
        return jsonResponse({
          ok: true,
          redirectUri: "https://utilities.example.com/api/oauth/pkce/callback",
        });
      }
      return jsonResponse({ ok: false, error: "bad oauth" });
    });

    renderCredentialsPanel();

    await user.selectOptions(screen.getByLabelText("Instance type"), "enterprise");
    await user.type(screen.getByLabelText("Instance URL"), "https://demo.stackenterprise.co");
    await user.type(screen.getByLabelText("OAuth Client ID"), "client-123");
    await user.click(screen.getByRole("button", { name: "Connect with Enterprise OAuth" }));

    expect(await screen.findByText("bad oauth")).toBeInTheDocument();
    expect(popup.close).toHaveBeenCalled();
  });

  it("restores the last selected customer into a pristine Enterprise draft", async () => {
    mockOAuthEndpoints();
    const open = vi.spyOn(window, "open");
    installProfileStorage({
      profiles: [enterpriseProfile()],
      lastSelectedProfileId: "profile-1",
    });

    renderCredentialsPanel();
    await userEvent.setup().selectOptions(screen.getByLabelText("Instance type"), "enterprise");

    expect(await screen.findByLabelText("Saved customer")).toHaveValue("profile-1");
    expect(screen.getByLabelText("Customer name")).toHaveValue("Demo Customer");
    expect(screen.getByLabelText("Instance URL")).toHaveValue(
      "https://demo.stackenterprise.co",
    );
    expect(screen.getByLabelText("OAuth Client ID")).toHaveValue("client-123");
    expect(screen.getByLabelText("Request non-expiring token")).not.toBeChecked();
    expect(open).not.toHaveBeenCalled();
  });

  it("selects the profile matching existing Enterprise session credentials", async () => {
    mockOAuthEndpoints();
    const matchingProfile = enterpriseProfile({
      id: "matching-profile",
      customerName: "Matching Customer",
      includeNoExpiry: true,
    });
    installProfileStorage({
      profiles: [enterpriseProfile({
        id: "unrelated-profile",
        baseUrl: "https://unrelated.stackenterprise.co",
        oauthClientId: "unrelated-client",
      }), matchingProfile],
      lastSelectedProfileId: "unrelated-profile",
    });

    renderCredentialsPanel({
      credentials: {
        ...enterpriseOAuthCredentials(),
        baseUrl: "https://demo.stackenterprise.co/",
      },
    });

    await waitFor(() => {
      expect(screen.getByLabelText("Saved customer")).toHaveValue("matching-profile");
    });
    expect(screen.getByLabelText("Customer name")).toHaveValue("Matching Customer");
    expect(screen.getByLabelText("Request non-expiring token")).toBeChecked();
    expect(profileStorageMocks.saveLastSelectedProfileId).toHaveBeenCalledWith(
      "matching-profile",
    );
  });

  it("keeps nonmatching Enterprise session values as a new unsaved customer", async () => {
    mockOAuthEndpoints();
    installProfileStorage({
      profiles: [enterpriseProfile()],
      lastSelectedProfileId: "profile-1",
    });
    const credentials: SessionCredentials = {
      ...enterpriseOAuthCredentials(),
      baseUrl: "https://other.stackenterprise.co",
      oauthClientId: "other-client",
      apiKey: "session-api-key",
      oauthScopes: ["write_access", "no_expiry"],
    };

    renderCredentialsPanel({ credentials });

    await waitFor(() => expect(screen.getByLabelText("Saved customer")).toHaveValue(""));
    expect(screen.getByLabelText("Customer name")).toHaveValue("");
    expect(screen.getByLabelText("Instance URL")).toHaveValue(
      "https://other.stackenterprise.co",
    );
    expect(screen.getByLabelText("OAuth Client ID")).toHaveValue("other-client");
    expect(screen.getByLabelText("API key")).toHaveValue("session-api-key");
    expect(screen.getByLabelText("Request non-expiring token")).toBeChecked();
    expect(profileStorageMocks.saveLastSelectedProfileId).toHaveBeenCalledWith(undefined);
  });

  it("applies the restored customer when switching from Basic session credentials", async () => {
    mockOAuthEndpoints();
    installProfileStorage({
      profiles: [enterpriseProfile()],
      lastSelectedProfileId: "profile-1",
    });
    renderCredentialsPanel({
      credentials: {
        instanceType: "basic-business",
        baseUrl: "https://stackoverflowteams.com/c/demo",
        pat: "basic-pat",
        authSource: "manual-pat",
      },
    });

    await waitFor(() => expect(profileStorageMocks.load).toHaveBeenCalled());
    await userEvent.setup().selectOptions(screen.getByLabelText("Instance type"), "enterprise");

    expect(await screen.findByLabelText("Saved customer")).toHaveValue("profile-1");
    expect(screen.getByLabelText("Customer name")).toHaveValue("Demo Customer");
    expect(screen.getByLabelText("Instance URL")).toHaveValue(
      "https://demo.stackenterprise.co",
    );
  });

  it("does not let late profile hydration overwrite user edits", async () => {
    mockOAuthEndpoints();
    const storage = installDeferredProfileStorage();
    renderCredentialsPanel();
    const user = userEvent.setup();

    await user.selectOptions(screen.getByLabelText("Instance type"), "enterprise");
    await user.type(
      screen.getByLabelText("Instance URL"),
      "https://manual.stackenterprise.co",
    );
    storage.resolve({
      profiles: [enterpriseProfile()],
      lastSelectedProfileId: "profile-1",
    });

    await waitFor(() => expect(screen.getByLabelText("Saved customer")).toBeEnabled());
    expect(screen.getByLabelText("Instance URL")).toHaveValue(
      "https://manual.stackenterprise.co",
    );
  });

  it("applies rapid profile choices immediately while preference writes are pending", async () => {
    mockOAuthEndpoints();
    const secondProfile = enterpriseProfile({
      id: "profile-2",
      customerName: "Second Customer",
      baseUrl: "https://second.stackenterprise.co",
      oauthClientId: "client-2",
    });
    const thirdProfile = enterpriseProfile({
      id: "profile-3",
      customerName: "Third Customer",
      baseUrl: "https://third.stackenterprise.co",
      oauthClientId: "client-3",
      includeNoExpiry: true,
    });
    installProfileStorage({
      profiles: [enterpriseProfile(), secondProfile, thirdProfile],
      lastSelectedProfileId: "profile-1",
    });
    const firstPreferenceWrite = deferred<void>();
    profileStorageMocks.saveLastSelectedProfileId
      .mockReturnValueOnce(firstPreferenceWrite.promise)
      .mockResolvedValue(undefined);
    renderCredentialsPanel();
    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText("Instance type"), "enterprise");
    await waitFor(() => {
      expect(screen.getByLabelText("Customer name")).toHaveValue("Demo Customer");
    });

    await user.selectOptions(screen.getByLabelText("Saved customer"), "profile-2");
    expect(screen.getByLabelText("Saved customer")).toHaveValue("profile-2");
    expect(screen.getByLabelText("Customer name")).toHaveValue("Second Customer");
    expect(screen.getByLabelText("Instance URL")).toHaveValue(
      "https://second.stackenterprise.co",
    );

    await user.selectOptions(screen.getByLabelText("Saved customer"), "profile-3");
    expect(screen.getByLabelText("Saved customer")).toHaveValue("profile-3");
    expect(screen.getByLabelText("Customer name")).toHaveValue("Third Customer");
    expect(screen.getByLabelText("Instance URL")).toHaveValue(
      "https://third.stackenterprise.co",
    );
    expect(screen.getByLabelText("Request non-expiring token")).toBeChecked();

    firstPreferenceWrite.resolve();
    await waitFor(() => {
      expect(profileStorageMocks.saveLastSelectedProfileId).toHaveBeenLastCalledWith("profile-3");
    });
  });

  it("saves only the strict non-sensitive customer profile draft", async () => {
    mockOAuthEndpoints();
    installProfileStorage();
    const onSave = vi.fn();
    renderCredentialsPanel({
      credentials: {
        instanceType: "enterprise",
        baseUrl: "https://demo.stackenterprise.co",
        apiKey: "secret-api-key",
        accessToken: "secret-access-token",
        authSource: "manual-enterprise-token",
        oauthClientId: "client-123",
        oauthScopes: ["write_access", "no_expiry"],
      },
      onSave,
    });
    const user = userEvent.setup();
    await waitFor(() => expect(screen.getByRole("button", { name: "Save customer" })).toBeEnabled());
    await user.type(screen.getByLabelText("Customer name"), "Demo Customer");
    await user.click(screen.getByRole("button", { name: "Save customer" }));

    await waitFor(() => expect(profileStorageMocks.saveProfileAndSelect).toHaveBeenCalledTimes(1));
    const savedProfile = profileStorageMocks.saveProfileAndSelect.mock.calls[0][0];
    expect(savedProfile).toMatchObject({
      customerName: "Demo Customer",
      baseUrl: "https://demo.stackenterprise.co",
      oauthClientId: "client-123",
      includeNoExpiry: true,
    });
    expect(Object.keys(savedProfile).sort()).toEqual([
      "baseUrl",
      "createdAt",
      "customerName",
      "id",
      "includeNoExpiry",
      "oauthClientId",
      "schemaVersion",
      "updatedAt",
    ]);
    expect(JSON.stringify(savedProfile)).not.toMatch(
      /accessToken|apiKey|pat|oauthScopes|authSource|authorizationCode|verifier|state/i,
    );
    expect(onSave).not.toHaveBeenCalled();
  });

  it("updates and deletes a profile without clearing secrets or saving the session", async () => {
    mockOAuthEndpoints();
    installProfileStorage({
      profiles: [enterpriseProfile()],
      lastSelectedProfileId: "profile-1",
    });
    const onSave = vi.fn();
    renderCredentialsPanel({
      credentials: {
        instanceType: "enterprise",
        baseUrl: "https://demo.stackenterprise.co",
        apiKey: "secret-api-key",
        accessToken: "secret-access-token",
        authSource: "manual-enterprise-token",
        oauthClientId: "client-123",
      },
      onSave,
    });
    const user = userEvent.setup();
    await waitFor(() => {
      expect(screen.getByLabelText("Customer name")).toHaveValue("Demo Customer");
    });
    await user.clear(screen.getByLabelText("Customer name"));
    await user.type(screen.getByLabelText("Customer name"), "Renamed Customer");
    await user.click(screen.getByRole("button", { name: "Update customer" }));

    await waitFor(() => {
      expect(profileStorageMocks.saveProfile).toHaveBeenCalledWith(
        expect.objectContaining({ id: "profile-1", customerName: "Renamed Customer" }),
      );
    });
    expect(screen.getByLabelText("API key")).toHaveValue("secret-api-key");
    expect(screen.getByLabelText("Access token (optional)")).toHaveValue(
      "secret-access-token",
    );

    vi.spyOn(window, "confirm").mockReturnValue(true);
    await user.click(screen.getByRole("button", { name: "Delete customer" }));
    await waitFor(() => expect(profileStorageMocks.deleteProfile).toHaveBeenCalledWith("profile-1"));
    expect(screen.getByLabelText("Saved customer")).toHaveValue("");
    expect(screen.getByLabelText("Customer name")).toHaveValue("");
    expect(screen.getByLabelText("Instance URL")).toHaveValue("");
    expect(screen.getByLabelText("OAuth Client ID")).toHaveValue("");
    expect(screen.getByLabelText("Request non-expiring token")).not.toBeChecked();
    expect(screen.getByLabelText("API key")).toHaveValue("secret-api-key");
    expect(screen.getByLabelText("Access token (optional)")).toHaveValue(
      "secret-access-token",
    );
    expect(onSave).not.toHaveBeenCalled();
  });

  it("clears only profile-backed fields when starting a new customer", async () => {
    mockOAuthEndpoints();
    installProfileStorage({
      profiles: [enterpriseProfile()],
      lastSelectedProfileId: "profile-1",
    });
    renderCredentialsPanel({
      credentials: {
        instanceType: "enterprise",
        baseUrl: "https://demo.stackenterprise.co",
        apiKey: "secret-api-key",
        accessToken: "secret-access-token",
        authSource: "manual-enterprise-token",
        oauthClientId: "client-123",
      },
    });
    await waitFor(() => {
      expect(screen.getByLabelText("Customer name")).toHaveValue("Demo Customer");
    });

    await userEvent.setup().click(screen.getByRole("button", { name: "New customer" }));

    expect(screen.getByLabelText("Saved customer")).toHaveValue("");
    expect(screen.getByLabelText("Customer name")).toHaveValue("");
    expect(screen.getByLabelText("Instance URL")).toHaveValue("");
    expect(screen.getByLabelText("OAuth Client ID")).toHaveValue("");
    expect(screen.getByLabelText("API key")).toHaveValue("secret-api-key");
    expect(screen.getByLabelText("Access token (optional)")).toHaveValue(
      "secret-access-token",
    );
  });

  it("associates profile URL and client ID validation errors with their fields", async () => {
    mockOAuthEndpoints();
    installProfileStorage();
    renderCredentialsPanel();
    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText("Instance type"), "enterprise");
    await waitFor(() => expect(screen.getByRole("button", { name: "Save customer" })).toBeEnabled());
    await user.type(screen.getByLabelText("Customer name"), "Demo Customer");
    await user.click(screen.getByRole("button", { name: "Save customer" }));

    const baseUrl = screen.getByLabelText("Instance URL");
    const clientId = screen.getByLabelText("OAuth Client ID");
    expect(baseUrl).toHaveAttribute("aria-invalid", "true");
    expect(clientId).toHaveAttribute("aria-invalid", "true");
    expect(baseUrl).toHaveAccessibleDescription("Enter a Stack Enterprise HTTPS instance URL.");
    expect(clientId).toHaveAccessibleDescription("Enter an OAuth client ID.");
    expect(screen.getAllByRole("alert")).toEqual(expect.arrayContaining([
      expect.objectContaining({ textContent: "Enter a Stack Enterprise HTTPS instance URL." }),
      expect.objectContaining({ textContent: "Enter an OAuth client ID." }),
    ]));

    await user.selectOptions(screen.getByLabelText("Instance type"), "basic-business");
    expect(screen.getByLabelText("Instance URL")).not.toHaveAttribute("aria-invalid");
    expect(screen.queryByText("Enter a Stack Enterprise HTTPS instance URL.")).not.toBeInTheDocument();
  });

  it("keeps manual OAuth usable when saved-customer storage is unavailable", async () => {
    installProfileStorage({ available: false });
    const fetchMock = mockOAuthEndpoints();
    vi.spyOn(window, "open").mockReturnValue(createPopup() as unknown as Window);
    renderCredentialsPanel();
    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText("Instance type"), "enterprise");
    expect(await screen.findByText(/still enter OAuth details manually/i)).toBeInTheDocument();
    await user.type(screen.getByLabelText("Instance URL"), "https://demo.stackenterprise.co");
    await user.type(screen.getByLabelText("OAuth Client ID"), "client-123");

    expect(screen.getByLabelText("Instance URL")).toBeEnabled();
    expect(screen.getByLabelText("OAuth Client ID")).toBeEnabled();
    expect(screen.getByRole("button", { name: "Connect with Enterprise OAuth" })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "Connect with Enterprise OAuth" }));
    expect(findOAuthStartCall(fetchMock)).toBeDefined();
  });

  it("reports malformed profiles while restoring valid saved customers", async () => {
    mockOAuthEndpoints();
    installProfileStorage({
      profiles: [enterpriseProfile()],
      lastSelectedProfileId: "profile-1",
      malformedProfileCount: 1,
    });
    renderCredentialsPanel();

    await userEvent.setup().selectOptions(screen.getByLabelText("Instance type"), "enterprise");

    expect(await screen.findByText(/could not be read/i)).toBeInTheDocument();
    expect(screen.getByLabelText("Saved customer")).toHaveValue("profile-1");
    expect(screen.getByLabelText("Customer name")).toHaveValue("Demo Customer");
  });

  it("keeps an edited draft when profile switching is cancelled", async () => {
    mockOAuthEndpoints();
    installProfileStorage({
      profiles: [enterpriseProfile(), enterpriseProfile({
        id: "profile-2",
        customerName: "Other Customer",
      })],
      lastSelectedProfileId: "profile-1",
    });
    vi.spyOn(window, "confirm").mockReturnValue(false);
    renderCredentialsPanel();
    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText("Instance type"), "enterprise");
    await waitFor(() => {
      expect(screen.getByLabelText("Customer name")).toHaveValue("Demo Customer");
    });
    await user.type(screen.getByLabelText("Customer name"), " edited");
    await user.selectOptions(screen.getByLabelText("Saved customer"), "profile-2");

    expect(screen.getByLabelText("Saved customer")).toHaveValue("profile-1");
    expect(screen.getByLabelText("Customer name")).toHaveValue("Demo Customer edited");
    expect(profileStorageMocks.saveLastSelectedProfileId).not.toHaveBeenCalled();
  });

  it("clears a stale OAuth error when a different customer target is applied", async () => {
    installProfileStorage({
      profiles: [enterpriseProfile(), enterpriseProfile({
        id: "profile-2",
        customerName: "Other Customer",
        baseUrl: "https://other.stackenterprise.co",
        oauthClientId: "other-client",
      })],
      lastSelectedProfileId: "profile-1",
    });
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      if (String(input) === "/api/oauth/pkce/config") {
        return jsonResponse({
          ok: true,
          redirectUri: "https://utilities.example.com/api/oauth/pkce/callback",
        });
      }
      return jsonResponse({ ok: false, error: "bad oauth" });
    });
    vi.spyOn(window, "open").mockReturnValue(createPopup() as unknown as Window);
    renderCredentialsPanel();
    const user = userEvent.setup();
    await waitFor(() => {
      expect(screen.getByLabelText("Customer name")).toHaveValue("Demo Customer");
    });
    await user.click(screen.getByRole("button", { name: "Connect with Enterprise OAuth" }));
    expect(await screen.findByText("bad oauth")).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText("Saved customer"), "profile-2");

    expect(screen.queryByText("bad oauth")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Instance URL")).toHaveValue(
      "https://other.stackenterprise.co",
    );
  });

  it("shows and copies the server-controlled OAuth redirect URL", async () => {
    mockOAuthEndpoints();
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    renderCredentialsPanel();
    await user.selectOptions(screen.getByLabelText("Instance type"), "enterprise");

    expect(await screen.findByLabelText("OAuth redirect URL")).toHaveValue(
      "https://utilities.example.com/api/oauth/pkce/callback",
    );
    await user.click(screen.getByRole("button", { name: "Copy redirect URL" }));
    expect(writeText).toHaveBeenCalledWith(
      "https://utilities.example.com/api/oauth/pkce/callback",
    );
    expect(await screen.findByText("Redirect URL copied.")).toBeInTheDocument();
  });

  it("reports malformed redirect configuration without blocking OAuth", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      if (String(input) === "/api/oauth/pkce/config") {
        return jsonResponse({ ok: true, redirectUri: 42 });
      }
      return jsonResponse({
        ok: true,
        authorizationUrl: "https://demo.stackenterprise.co/oauth?state=abc",
      });
    });
    vi.spyOn(window, "open").mockReturnValue(createPopup() as unknown as Window);
    renderCredentialsPanel();
    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText("Instance type"), "enterprise");
    expect(await screen.findByText(
      "OAuth redirect URL could not be loaded. Check the server OAuth configuration.",
    )).toBeInTheDocument();
    expect(screen.getByLabelText("OAuth redirect URL")).toHaveValue("");
    await user.type(screen.getByLabelText("Instance URL"), "https://demo.stackenterprise.co");
    await user.type(screen.getByLabelText("OAuth Client ID"), "client-123");
    await user.click(screen.getByRole("button", { name: "Connect with Enterprise OAuth" }));

    expect(findOAuthStartCall(fetchMock)).toBeDefined();
    expect(screen.queryByText("Unable to start Enterprise OAuth. Try again.")).not.toBeInTheDocument();
  });

  it("reports redirect configuration failure without blocking OAuth", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      if (String(input) === "/api/oauth/pkce/config") {
        throw new Error("config failed");
      }
      return jsonResponse({
        ok: true,
        authorizationUrl: "https://demo.stackenterprise.co/oauth?state=abc",
      });
    });
    vi.spyOn(window, "open").mockReturnValue(createPopup() as unknown as Window);
    renderCredentialsPanel();
    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText("Instance type"), "enterprise");
    expect(await screen.findByText(
      "OAuth redirect URL could not be loaded. Check the server OAuth configuration.",
    )).toBeInTheDocument();
    await user.type(screen.getByLabelText("Instance URL"), "https://demo.stackenterprise.co");
    await user.type(screen.getByLabelText("OAuth Client ID"), "client-123");
    await user.click(screen.getByRole("button", { name: "Connect with Enterprise OAuth" }));

    expect(findOAuthStartCall(fetchMock)).toBeDefined();
  });

  it("leaves the redirect URL visible after copy failure and still starts OAuth", async () => {
    const fetchMock = mockOAuthEndpoints();
    const user = userEvent.setup();
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn().mockRejectedValue(new Error("copy failed")) },
    });
    vi.spyOn(window, "open").mockReturnValue(createPopup() as unknown as Window);
    renderCredentialsPanel();
    await user.selectOptions(screen.getByLabelText("Instance type"), "enterprise");
    const redirectField = await screen.findByLabelText("OAuth redirect URL");
    await user.click(screen.getByRole("button", { name: "Copy redirect URL" }));

    expect(await screen.findByText(
      "Redirect URL was not copied. Copy it manually from the field.",
    )).toBeInTheDocument();
    expect(redirectField).toHaveValue(
      "https://utilities.example.com/api/oauth/pkce/callback",
    );
    await user.type(screen.getByLabelText("Instance URL"), "https://demo.stackenterprise.co");
    await user.type(screen.getByLabelText("OAuth Client ID"), "client-123");
    await user.click(screen.getByRole("button", { name: "Connect with Enterprise OAuth" }));
    expect(findOAuthStartCall(fetchMock)).toBeDefined();
  });

  it("loads redirect configuration once across lane toggles and keeps an in-flight result", async () => {
    const config = deferred<Response>();
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
      if (String(input) === "/api/oauth/pkce/config") {
        return config.promise;
      }
      return Promise.resolve(jsonResponse({
        ok: true,
        authorizationUrl: "https://demo.stackenterprise.co/oauth?state=abc",
      }));
    });
    renderCredentialsPanel();
    const user = userEvent.setup();

    await user.selectOptions(screen.getByLabelText("Instance type"), "enterprise");
    expect(fetchMock.mock.calls.filter(([input]) =>
      String(input) === "/api/oauth/pkce/config")).toHaveLength(1);
    await user.selectOptions(screen.getByLabelText("Instance type"), "basic-business");
    await user.selectOptions(screen.getByLabelText("Instance type"), "enterprise");
    expect(fetchMock.mock.calls.filter(([input]) =>
      String(input) === "/api/oauth/pkce/config")).toHaveLength(1);

    config.resolve(jsonResponse({
      ok: true,
      redirectUri: "https://utilities.example.com/api/oauth/pkce/callback",
    }));
    expect(await screen.findByLabelText("OAuth redirect URL")).toHaveValue(
      "https://utilities.example.com/api/oauth/pkce/callback",
    );
  });

  it("locks all external profile fields during a pending create and re-enables them", async () => {
    mockOAuthEndpoints();
    installProfileStorage();
    const create = deferred<void>();
    profileStorageMocks.saveProfileAndSelect.mockReturnValue(create.promise);
    renderCredentialsPanel();
    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText("Instance type"), "enterprise");
    await waitFor(() => expect(screen.getByRole("button", { name: "Save customer" })).toBeEnabled());
    await user.type(screen.getByLabelText("Customer name"), "Demo Customer");
    await user.type(screen.getByLabelText("Instance URL"), "https://demo.stackenterprise.co");
    await user.type(screen.getByLabelText("OAuth Client ID"), "client-123");
    await user.click(screen.getByLabelText("Request non-expiring token"));
    await user.type(screen.getByLabelText("API key"), "api-key");
    await user.type(screen.getByLabelText("Access token (optional)"), "access-token");
    await user.click(screen.getByRole("button", { name: "Save customer" }));

    await waitFor(() => expect(screen.getByLabelText("Instance type")).toBeDisabled());
    expect(screen.getByLabelText("Instance URL")).toBeDisabled();
    expect(screen.getByLabelText("OAuth Client ID")).toBeDisabled();
    expect(screen.getByLabelText("Request non-expiring token")).toBeDisabled();
    expect(screen.getByLabelText("API key")).toBeEnabled();
    expect(screen.getByLabelText("Access token (optional)")).toBeEnabled();
    expect(screen.getByRole("button", { name: "Connect with Enterprise OAuth" })).toBeEnabled();

    create.resolve();
    await waitFor(() => expect(screen.getByLabelText("Instance type")).toBeEnabled());
    expect(screen.getByLabelText("Instance URL")).toBeEnabled();
    expect(screen.getByLabelText("OAuth Client ID")).toBeEnabled();
    expect(screen.getByLabelText("Request non-expiring token")).toBeEnabled();
  });

  it("locks all external profile fields during a pending update and re-enables them", async () => {
    mockOAuthEndpoints();
    installProfileStorage({
      profiles: [enterpriseProfile()],
      lastSelectedProfileId: "profile-1",
    });
    const update = deferred<void>();
    profileStorageMocks.saveProfile.mockReturnValue(update.promise);
    renderCredentialsPanel();
    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText("Instance type"), "enterprise");
    await waitFor(() => {
      expect(screen.getByLabelText("Customer name")).toHaveValue("Demo Customer");
    });
    await user.type(screen.getByLabelText("Customer name"), " edited");
    await user.click(screen.getByRole("button", { name: "Update customer" }));

    await waitFor(() => expect(screen.getByLabelText("Instance type")).toBeDisabled());
    expect(screen.getByLabelText("Instance URL")).toBeDisabled();
    expect(screen.getByLabelText("OAuth Client ID")).toBeDisabled();
    expect(screen.getByLabelText("Request non-expiring token")).toBeDisabled();
    expect(screen.getByLabelText("API key")).toBeEnabled();
    expect(screen.getByLabelText("Access token (optional)")).toBeEnabled();
    expect(screen.getByRole("button", { name: "Connect with Enterprise OAuth" })).toBeEnabled();

    update.resolve();
    await waitFor(() => expect(screen.getByLabelText("Instance type")).toBeEnabled());
  });

  it("starts profile OAuth with only workflow scopes and no profile metadata override", async () => {
    const fetchMock = mockOAuthEndpoints();
    installProfileStorage({
      profiles: [enterpriseProfile({ includeNoExpiry: true })],
      lastSelectedProfileId: "profile-1",
    });
    vi.spyOn(window, "open").mockReturnValue(createPopup() as unknown as Window);
    renderCredentialsPanel({
      workflow: { kind: "write-tool", writeToolId: "user-group-sync" },
    });
    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText("Instance type"), "enterprise");
    await waitFor(() => {
      expect(screen.getByLabelText("Customer name")).toHaveValue("Demo Customer");
    });
    await user.click(screen.getByRole("button", { name: "Connect with Enterprise OAuth" }));

    const startCall = findOAuthStartCall(fetchMock);
    expect(JSON.parse(String(startCall?.[1]?.body))).toEqual({
      baseUrl: "https://demo.stackenterprise.co",
      clientId: "client-123",
      scopes: ["write_access"],
      includeNoExpiry: true,
    });
    expect(String(startCall?.[1]?.body)).not.toMatch(/redirect|customerName/i);
    expect(profileStorageMocks.saveProfile).not.toHaveBeenCalled();
    expect(profileStorageMocks.saveProfileAndSelect).not.toHaveBeenCalled();
  });
});

function renderCredentialsPanel({
  credentials = null,
  onSave = vi.fn(),
  workflow = { kind: "report", reportId: "tag-report" },
}: {
  credentials?: SessionCredentials | null;
  onSave?: (credentials: SessionCredentials) => void;
  workflow?:
    | { kind: "report"; reportId: "tag-report" }
    | { kind: "utility"; utilityId: "sme-coverage-analyzer" }
    | { kind: "write-tool"; writeToolId: "user-group-sync" };
} = {}) {
  return render(
    <CredentialsPanel
      workflow={workflow}
      credentials={credentials}
      onSave={onSave}
    />,
  );
}

function createPopup() {
  return {
    location: { href: "" },
    close: vi.fn(),
  };
}

function enterpriseOAuthCredentials(): SessionCredentials {
  return {
    instanceType: "enterprise",
    baseUrl: "https://demo.stackenterprise.co",
    accessToken: "oauth-token",
    authSource: "oauth-pkce",
    oauthClientId: "client-123",
    oauthScopes: ["write_access"],
    accessTokenExpiresAt: "2026-07-05T12:00:00.000Z",
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });

  return { promise, resolve, reject };
}

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function mockOAuthEndpoints(
  authorizationUrl = "https://demo.stackenterprise.co/oauth?state=abc",
) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    if (String(input) === "/api/oauth/pkce/config") {
      return jsonResponse({
        ok: true,
        redirectUri: "https://utilities.example.com/api/oauth/pkce/callback",
      });
    }
    if (String(input) === "/api/oauth/pkce/start" && init?.method === "POST") {
      return jsonResponse({ ok: true, authorizationUrl });
    }
    throw new Error(`Unexpected fetch: ${String(input)}`);
  });
}

function findOAuthStartCall(fetchMock: ReturnType<typeof mockOAuthEndpoints>) {
  return fetchMock.mock.calls.find(([input]) => String(input) === "/api/oauth/pkce/start");
}

function oauthStartCallCount(fetchMock: ReturnType<typeof mockOAuthEndpoints>) {
  return fetchMock.mock.calls.filter(([input]) => String(input) === "/api/oauth/pkce/start").length;
}

function enterpriseProfile(
  overrides: Partial<OAuthCustomerProfile> = {},
): OAuthCustomerProfile {
  return {
    schemaVersion: 1,
    id: "profile-1",
    customerName: "Demo Customer",
    baseUrl: "https://demo.stackenterprise.co",
    oauthClientId: "client-123",
    includeNoExpiry: false,
    createdAt: "2026-08-19T12:00:00.000Z",
    updatedAt: "2026-08-19T12:00:00.000Z",
    ...overrides,
  };
}

function installProfileStorage(options: {
  profiles?: OAuthCustomerProfile[];
  lastSelectedProfileId?: string;
  available?: boolean;
  malformedProfileCount?: number;
} = {}) {
  profileStorageMocks.load.mockResolvedValue({
    available: options.available ?? true,
    profiles: options.profiles ?? [],
    preferences: {
      schemaVersion: 1,
      ...(options.lastSelectedProfileId
        ? { lastSelectedProfileId: options.lastSelectedProfileId }
        : {}),
    },
    malformedProfileCount: options.malformedProfileCount ?? 0,
  } satisfies OAuthCustomerProfileStoreSnapshot);
}

function installDeferredProfileStorage() {
  const load = deferred<OAuthCustomerProfileStoreSnapshot>();
  profileStorageMocks.load.mockReturnValue(load.promise);
  return {
    resolve({
      profiles,
      lastSelectedProfileId,
    }: {
      profiles: OAuthCustomerProfile[];
      lastSelectedProfileId?: string;
    }) {
      load.resolve({
        available: true,
        profiles,
        preferences: {
          schemaVersion: 1,
          ...(lastSelectedProfileId ? { lastSelectedProfileId } : {}),
        },
        malformedProfileCount: 0,
      });
    },
  };
}
