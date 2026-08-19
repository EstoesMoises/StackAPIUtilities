import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { OAuthCustomerProfile } from "../domain/oauthCustomerProfiles";
import {
  OAuthCustomerProfileManager,
  type OAuthCustomerProfileManagerProps,
} from "./OAuthCustomerProfileManager";

afterEach(() => {
  vi.restoreAllMocks();
});

function createProfile(
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

function defaultProps(): OAuthCustomerProfileManagerProps {
  return {
    profiles: [],
    customerName: "",
    dirty: false,
    ready: true,
    available: true,
    busy: false,
    errors: {},
    warning: null,
    onCustomerNameChange: vi.fn(),
    onSelect: vi.fn(),
    onSave: vi.fn(),
    onUpdate: vi.fn(),
    onDelete: vi.fn(),
  };
}

function renderManager(overrides: Partial<OAuthCustomerProfileManagerProps> = {}) {
  const props = { ...defaultProps(), ...overrides };
  return { props, ...render(<OAuthCustomerProfileManager {...props} />) };
}

describe("OAuthCustomerProfileManager", () => {
  it("renders browser-local profile fields and invokes controlled callbacks", async () => {
    const user = userEvent.setup();
    const profile = createProfile();
    const secondProfile = createProfile({ id: "profile-2", customerName: "Other Customer" });
    const props = defaultProps();
    const onCustomerNameChange = vi.fn();

    function ControlledManager() {
      const [customerName, setCustomerName] = useState("");

      return (
        <OAuthCustomerProfileManager
          {...props}
          profiles={[profile, secondProfile]}
          customerName={customerName}
          onCustomerNameChange={(value) => {
            onCustomerNameChange(value);
            setCustomerName(value);
          }}
        />
      );
    }

    render(<ControlledManager />);

    expect(screen.getByRole("group", { name: "Saved customer profiles" })).toBeInTheDocument();
    expect(screen.getByText(/non-sensitive OAuth settings in this browser/i)).toBeInTheDocument();
    expect(screen.getByLabelText("Saved customer")).toHaveValue("");
    expect(screen.getByRole("option", { name: "New customer" })).toHaveValue("");

    await user.selectOptions(screen.getByLabelText("Saved customer"), "profile-2");
    await user.type(screen.getByLabelText("Customer name"), "Acme");
    await user.click(screen.getByRole("button", { name: "Save customer" }));

    expect(props.onSelect).toHaveBeenCalledWith("profile-2");
    expect(onCustomerNameChange).toHaveBeenLastCalledWith("Acme");
    expect(screen.getByLabelText("Customer name")).toHaveValue("Acme");
    expect(props.onSave).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: "Update customer" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete customer" })).not.toBeInTheDocument();
  });

  it("keeps the controlled selection when dirty profile switching is cancelled", async () => {
    const user = userEvent.setup();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const onSelect = vi.fn();
    renderManager({
      profiles: [
        createProfile(),
        createProfile({ id: "profile-2", customerName: "Other Customer" }),
      ],
      selectedProfileId: "profile-1",
      dirty: true,
      onSelect,
    });

    await user.selectOptions(screen.getByLabelText("Saved customer"), "profile-2");

    expect(confirm).toHaveBeenCalledWith("Discard unsaved customer profile changes?");
    expect(onSelect).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Saved customer")).toHaveValue("profile-1");
  });

  it("switches profiles after dirty-change confirmation is accepted", async () => {
    const user = userEvent.setup();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const onSelect = vi.fn();
    renderManager({
      profiles: [
        createProfile(),
        createProfile({ id: "profile-2", customerName: "Other Customer" }),
      ],
      selectedProfileId: "profile-1",
      dirty: true,
      onSelect,
    });

    await user.selectOptions(screen.getByLabelText("Saved customer"), "profile-2");

    expect(onSelect).toHaveBeenCalledWith("profile-2");
  });

  it("applies the same dirty confirmation rule to New customer", async () => {
    const user = userEvent.setup();
    const confirm = vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValueOnce(true);
    const onSelect = vi.fn();
    renderManager({
      profiles: [createProfile()],
      selectedProfileId: "profile-1",
      dirty: true,
      onSelect,
    });

    await user.click(screen.getByRole("button", { name: "New customer" }));
    expect(onSelect).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "New customer" }));
    expect(confirm).toHaveBeenCalledTimes(2);
    expect(onSelect).toHaveBeenCalledWith(undefined);
  });

  it("confirms and clears a dirty new-customer draft when New customer is clicked", async () => {
    const user = userEvent.setup();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const onSelect = vi.fn();
    renderManager({ dirty: true, onSelect });

    await user.click(screen.getByRole("button", { name: "New customer" }));

    expect(window.confirm).toHaveBeenCalledWith(
      "Discard unsaved customer profile changes?",
    );
    expect(onSelect).toHaveBeenCalledWith(undefined);
  });

  it("uses the exact deletion warning and honors cancel and accept", async () => {
    const user = userEvent.setup();
    const confirm = vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValueOnce(true);
    const onDelete = vi.fn();
    renderManager({
      profiles: [createProfile()],
      selectedProfileId: "profile-1",
      onDelete,
    });

    await user.click(screen.getByRole("button", { name: "Delete customer" }));
    expect(onDelete).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Delete customer" }));
    expect(confirm).toHaveBeenNthCalledWith(
      1,
      "Delete this saved customer profile? Active session credentials will not be removed.",
    );
    expect(confirm).toHaveBeenNthCalledWith(
      2,
      "Delete this saved customer profile? Active session credentials will not be removed.",
    );
    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it("associates the customer-name error and exposes warning and dirty status text", () => {
    renderManager({
      dirty: true,
      errors: {
        customerName: "Use a unique customer name.",
        baseUrl: "Enter a Stack Enterprise HTTPS instance URL.",
        oauthClientId: "Enter an OAuth client ID.",
        includeNoExpiry: "Choose whether to include users without an expiry date.",
      },
      warning: "Customer profile changes could not be saved. Try again.",
    });

    const error = screen.getByText("Use a unique customer name.");
    expect(error).toHaveAttribute("role", "alert");
    expect(screen.getByLabelText("Customer name")).toHaveAttribute(
      "aria-describedby",
      error.id,
    );
    expect(screen.getByText("Unsaved customer profile changes.")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(
      "Customer profile changes could not be saved. Try again.",
    );
  });

  it("disables all controls during a profile mutation", () => {
    renderManager({
      profiles: [createProfile()],
      selectedProfileId: "profile-1",
      dirty: true,
      busy: true,
    });

    expect(screen.getByLabelText("Saved customer")).toBeDisabled();
    expect(screen.getByLabelText("Customer name")).toBeDisabled();
    expect(screen.getByRole("button", { name: "New customer" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Update customer" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Delete customer" })).toBeDisabled();
  });

  it("conveys loading and keeps profile actions disabled until ready", () => {
    renderManager({ ready: false });

    expect(screen.getByRole("status")).toHaveTextContent("Loading saved customers");
    expect(screen.getByLabelText("Saved customer")).toBeDisabled();
    expect(screen.getByRole("button", { name: "New customer" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Save customer" })).toBeDisabled();
    expect(screen.getByLabelText("Customer name")).toBeEnabled();
  });

  it("conveys unavailable storage while leaving manual OAuth input usable", () => {
    renderManager({ available: false });

    expect(screen.getByRole("status")).toHaveTextContent(
      "Saved customers are unavailable in this browser",
    );
    expect(screen.getByLabelText("Saved customer")).toBeDisabled();
    expect(screen.getByRole("button", { name: "New customer" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Save customer" })).toBeDisabled();
    expect(screen.getByLabelText("Customer name")).toBeEnabled();
  });

  it("shows selected-profile actions and disables Update until the draft is dirty", () => {
    renderManager({ profiles: [createProfile()], selectedProfileId: "profile-1" });

    expect(screen.getByRole("button", { name: "Update customer" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Delete customer" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Save customer" })).not.toBeInTheDocument();
  });

  it("uses non-submit buttons when nested in the credentials form", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn((event: React.FormEvent<HTMLFormElement>) => event.preventDefault());
    const props = defaultProps();
    const { rerender } = render(
      <form onSubmit={onSubmit}>
        <OAuthCustomerProfileManager {...props} />
      </form>,
    );

    await user.click(screen.getByRole("button", { name: "New customer" }));
    await user.click(screen.getByRole("button", { name: "Save customer" }));

    rerender(
      <form onSubmit={onSubmit}>
        <OAuthCustomerProfileManager
          {...props}
          profiles={[createProfile()]}
          selectedProfileId="profile-1"
          dirty
        />
      </form>,
    );
    vi.spyOn(window, "confirm").mockReturnValue(true);
    await user.click(screen.getByRole("button", { name: "Update customer" }));
    await user.click(screen.getByRole("button", { name: "Delete customer" }));

    expect(props.onUpdate).toHaveBeenCalledTimes(1);
    expect(props.onDelete).toHaveBeenCalledTimes(1);
    expect(onSubmit).not.toHaveBeenCalled();
    for (const button of screen.getAllByRole("button")) {
      expect(button).toHaveAttribute("type", "button");
    }
  });
});
