import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SessionCredentials } from "../domain/types";
import { CredentialsPanel } from "./CredentialsPanel";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("CredentialsPanel", () => {
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
    expect(screen.getByLabelText("OAuth Client ID")).toBeInTheDocument();
    expect(screen.getByLabelText("Request non-expiring token")).not.toBeChecked();
    expect(screen.getByRole("button", { name: "Connect with Enterprise OAuth" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Personal access token")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Access token")).not.toBeInTheDocument();
  });

  it("starts Enterprise OAuth with write_access and no no_expiry by default", async () => {
    const user = userEvent.setup();
    const popup = createPopup();
    vi.spyOn(window, "open").mockReturnValue(popup as unknown as Window);
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({ ok: true, authorizationUrl: "https://demo.stackenterprise.co/oauth?state=abc" }),
    );

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
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({ ok: true, authorizationUrl: "https://demo.stackenterprise.co/oauth?state=abc" }),
    );

    renderCredentialsPanel();

    await user.selectOptions(screen.getByLabelText("Instance type"), "enterprise");
    await user.type(screen.getByLabelText("Instance URL"), "https://demo.stackenterprise.co");
    await user.type(screen.getByLabelText("OAuth Client ID"), "client-123");
    await user.click(screen.getByLabelText("Request non-expiring token"));
    await user.click(screen.getByRole("button", { name: "Connect with Enterprise OAuth" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({
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
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({ ok: true, authorizationUrl: "https://demo.stackenterprise.co/oauth?state=abc" }),
    );

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
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({ ok: true, authorizationUrl: "https://demo.stackenterprise.co/oauth?state=abc" }),
    );

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

  it("rejects malformed same-origin OAuth credentials after OAuth start", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    const popup = createPopup();
    vi.spyOn(window, "open").mockReturnValue(popup as unknown as Window);
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({ ok: true, authorizationUrl: "https://demo.stackenterprise.co/oauth?state=abc" }),
    );

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
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({ ok: true, authorizationUrl: "https://demo.stackenterprise.co/oauth?state=abc" }),
    );

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
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({ ok: true, authorizationUrl: "https://demo.stackenterprise.co/oauth?state=abc" }),
    );

    renderCredentialsPanel();

    await user.selectOptions(screen.getByLabelText("Instance type"), "enterprise");
    await user.type(screen.getByLabelText("Instance URL"), "https://demo.stackenterprise.co");
    await user.type(screen.getByLabelText("OAuth Client ID"), "client-123");
    await user.click(screen.getByRole("button", { name: "Connect with Enterprise OAuth" }));

    expect(fetchMock).not.toHaveBeenCalled();
    expect(await screen.findByText("Enable pop-ups to connect with Enterprise OAuth.")).toBeInTheDocument();
  });

  it("prevents duplicate OAuth starts while a start request is unresolved", async () => {
    const user = userEvent.setup();
    const pendingStart = deferred<Response>();
    vi.spyOn(window, "open").mockReturnValue(createPopup() as unknown as Window);
    const fetchMock = vi.spyOn(globalThis, "fetch").mockReturnValue(pendingStart.promise);

    renderCredentialsPanel();

    await user.selectOptions(screen.getByLabelText("Instance type"), "enterprise");
    await user.type(screen.getByLabelText("Instance URL"), "https://demo.stackenterprise.co");
    await user.type(screen.getByLabelText("OAuth Client ID"), "client-123");
    const connectButton = screen.getByRole("button", { name: "Connect with Enterprise OAuth" });
    await user.click(connectButton);
    await user.click(connectButton);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(connectButton).toBeDisabled();
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
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ ok: false, error: "bad oauth" }));

    renderCredentialsPanel();

    await user.selectOptions(screen.getByLabelText("Instance type"), "enterprise");
    await user.type(screen.getByLabelText("Instance URL"), "https://demo.stackenterprise.co");
    await user.type(screen.getByLabelText("OAuth Client ID"), "client-123");
    await user.click(screen.getByRole("button", { name: "Connect with Enterprise OAuth" }));

    expect(await screen.findByText("bad oauth")).toBeInTheDocument();
    expect(popup.close).toHaveBeenCalled();
  });
});

function renderCredentialsPanel({
  credentials = null,
  onSave = vi.fn(),
}: {
  credentials?: SessionCredentials | null;
  onSave?: (credentials: SessionCredentials) => void;
} = {}) {
  return render(
    <CredentialsPanel
      selectedReportId="tag-report"
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
