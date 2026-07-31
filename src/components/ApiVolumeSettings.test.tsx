import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { ApiVolumeSettingsValue } from "../domain/types";
import {
  DEFAULT_SME_COVERAGE_SETTINGS,
  getSmeCoveragePresetDisclosure,
} from "../utilities/smeCoverage/settings";
import { ApiVolumeSettings } from "./ApiVolumeSettings";

const utilityProps = {
  radioName: "sme-coverage-run-preset",
  helpText:
    "Choose how much source evidence to collect. Higher limits reduce the chance of a partial sample, but take longer to run.",
  recordDetail: "Tags, questions, assigned-SME counts",
  getDisclosure: getSmeCoveragePresetDisclosure,
} as const;

describe("ApiVolumeSettings", () => {
  it("uses the utility Deep default and utility-only disclosure copy", () => {
    const { container } = render(<ControlledVolumeSettings />);

    expect(screen.getByRole("group", { name: "Record coverage" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Deep audit" })).toBeChecked();
    expect(screen.getAllByText("Tags, questions, assigned-SME counts")).toHaveLength(3);
    expect(screen.getAllByText(/partial sample/i).length).toBeGreaterThan(0);

    const renderedCopy = container.textContent?.toLowerCase() ?? "";
    expect(renderedCopy).not.toContain("top-answerer");
    expect(renderedCopy).not.toContain("users");
    expect(renderedCopy).not.toContain("articles");
    expect(renderedCopy).not.toContain("date");
    expect(renderedCopy).not.toContain("comparison");
  });

  it("emits exact Quick and Standard volume settings", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<ControlledVolumeSettings onChange={onChange} />);

    await user.click(screen.getByRole("radio", { name: "Quick sample" }));

    expect(onChange).toHaveBeenLastCalledWith({
      pageSize: 50,
      maxPagesPerDataset: 1,
      runPreset: "quick-sample",
    });
    expect(screen.getByRole("radio", { name: "Quick sample" })).toBeChecked();

    await user.click(screen.getByRole("radio", { name: "Standard report" }));

    expect(onChange).toHaveBeenLastCalledWith({
      pageSize: 100,
      maxPagesPerDataset: 5,
      runPreset: "standard",
    });
    expect(screen.getByRole("radio", { name: "Standard report" })).toBeChecked();
  });

  it("clears a preset for custom settings and restores a matching preset", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<ControlledVolumeSettings onChange={onChange} />);

    await user.click(screen.getByRole("button", { name: "Advanced API volume settings" }));
    await user.clear(screen.getByLabelText("Max pages per dataset"));
    await user.type(screen.getByLabelText("Max pages per dataset"), "8");

    expect(onChange).toHaveBeenLastCalledWith({
      pageSize: 100,
      maxPagesPerDataset: 8,
      runPreset: undefined,
    });
    expect(screen.getByRole("radio", { name: "Deep audit" })).not.toBeChecked();
    expect(screen.getByRole("radio", { name: "Standard report" })).not.toBeChecked();

    await user.clear(screen.getByLabelText("Max pages per dataset"));
    await user.type(screen.getByLabelText("Max pages per dataset"), "5");

    expect(onChange).toHaveBeenLastCalledWith({
      pageSize: 100,
      maxPagesPerDataset: 5,
      runPreset: "standard",
    });
    expect(screen.getByRole("radio", { name: "Standard report" })).toBeChecked();
  });
});

function ControlledVolumeSettings({ onChange = vi.fn() }: { onChange?: ReturnType<typeof vi.fn> }) {
  const [value, setValue] = useState<ApiVolumeSettingsValue>(DEFAULT_SME_COVERAGE_SETTINGS);

  return (
    <ApiVolumeSettings
      {...utilityProps}
      value={value}
      onChange={(nextValue) => {
        onChange(nextValue);
        setValue(nextValue);
      }}
    />
  );
}
