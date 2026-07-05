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
    vi.spyOn(window, "open").mockReturnValue(createPopup() as unknown as Window);
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
      oauthClientId: "client-123",
      oauthScopes: ["write_access"],
      accessTokenExpiresAt: "2026-07-05T12:00:00.000Z",
    } satisfies SessionCredentials;
    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          origin: window.location.origin,
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

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
