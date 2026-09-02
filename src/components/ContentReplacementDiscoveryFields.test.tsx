import { readFileSync } from "node:fs";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import {
  ContentReplacementDiscoveryFields,
  createInitialContentReplacementDiscoveryFieldsValue,
  type ContentReplacementDiscoveryFieldsValue,
} from "./ContentReplacementDiscoveryFields";

const ORIGIN = "https://example.stackenterprise.co";

function DiscoveryFieldsHarness() {
  const [value, setValue] = useState<ContentReplacementDiscoveryFieldsValue>(
    createInitialContentReplacementDiscoveryFieldsValue(),
  );
  return (
    <ContentReplacementDiscoveryFields
      value={value}
      onChange={setValue}
      expectedOrigin={ORIGIN}
      contentTypes={{ questions: true, answers: true, articles: true }}
      showValidation
    />
  );
}

describe("ContentReplacementDiscoveryFields", () => {
  it("defaults to the search-assisted Targeted scan and supports keyboard radio navigation", async () => {
    const user = userEvent.setup();
    render(<DiscoveryFieldsHarness />);

    const targeted = screen.getByRole("radio", { name: /Targeted scan/i });
    expect(targeted).toBeChecked();
    expect(screen.getByText("Search-assisted · may miss matches")).toBeVisible();

    targeted.focus();
    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("radio", { name: /Exact IDs or URLs/i })).toBeChecked();
    expect(screen.getByRole("radio", { name: /Exact IDs or URLs/i })).toHaveFocus();
    expect(screen.getByLabelText("Target type 1")).toHaveValue("question");
  });

  it("normalizes pasted same-origin targets and gives visible errors for a different origin", async () => {
    const user = userEvent.setup();
    render(<DiscoveryFieldsHarness />);

    await user.click(screen.getByRole("radio", { name: /Exact IDs or URLs/i }));
    await user.type(screen.getByLabelText("Paste target URLs"), `${ORIGIN}/questions/42\n${ORIGIN}/questions/42`);
    await user.click(screen.getByRole("button", { name: "Add pasted targets" }));
    expect(screen.getByText("1 valid target")).toBeVisible();
    expect(screen.getByText(/1 duplicate removed/i)).toBeVisible();

    await user.clear(screen.getByLabelText("Paste target URLs"));
    await user.type(screen.getByLabelText("Paste target URLs"), "https://elsewhere.stackenterprise.co/questions/19");
    await user.click(screen.getByRole("button", { name: "Add pasted targets" }));
    expect(screen.getByText(/must use the connected Stack Enterprise origin/i)).toBeVisible();
    expect(screen.getByLabelText("Paste target URLs")).toHaveAttribute("aria-invalid", "true");
  });

  it("keeps the typed editor bounded and requires an answer parent question", async () => {
    const user = userEvent.setup();
    render(<DiscoveryFieldsHarness />);

    await user.click(screen.getByRole("radio", { name: /Exact IDs or URLs/i }));
    await user.selectOptions(screen.getByLabelText("Target type 1"), "answer");
    await user.type(screen.getByLabelText("Target ID or URL 1"), "87");

    expect(screen.getByText(/answer target needs its parent question ID/i)).toBeVisible();
    expect(screen.getByLabelText("Parent question ID 1")).toBeVisible();
    await user.type(screen.getByLabelText("Parent question ID 1"), "42");
    expect(screen.getByText("1 valid target")).toBeVisible();
  });

  it("provides the separate exact-target CSV template and import path", async () => {
    const user = userEvent.setup();
    render(<DiscoveryFieldsHarness />);
    let downloadedBlob: Blob | undefined;
    await user.click(screen.getByRole("radio", { name: /Exact IDs or URLs/i }));
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: vi.fn((blob: Blob) => {
        downloadedBlob = blob;
        return "blob:exact-target-template";
      }),
    });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
    const link = { click: vi.fn(), download: "", href: "" };
    const createElement = vi.spyOn(document, "createElement").mockReturnValue(link as unknown as HTMLAnchorElement);

    await user.click(screen.getByRole("button", { name: "Download target CSV template" }));
    const downloadedText = await blobText(downloadedBlob!);
    createElement.mockRestore();
    expect(link.download).toBe("content-replacement-targets-template.csv");
    expect(downloadedText).toBe("type,id,parent_question_id\n");

    await user.upload(
      screen.getByLabelText("Import target CSV"),
      new File(["type,id,parent_question_id\narticle,9,"], "targets.csv", { type: "text/csv" }),
    );
    expect(await screen.findByText("1 valid target")).toBeVisible();
  });

  it("reports the 100,000 unique-target ceiling before a scan can be reviewed", async () => {
    const user = userEvent.setup();
    render(<DiscoveryFieldsHarness />);
    await user.click(screen.getByRole("radio", { name: /Exact IDs or URLs/i }));
    const targetUrls = Array.from(
      { length: 100_001 },
      (_, index) => `${ORIGIN}/questions/${index + 1}`,
    ).join("\n");
    fireEvent.change(screen.getByLabelText("Paste target URLs"), { target: { value: targetUrls } });
    await user.click(screen.getByRole("button", { name: "Add pasted targets" }));

    expect(screen.getByText(/no more than 100,000 unique targets/i)).toBeVisible();
  });

  it("keeps Full audit inline, explanatory, and free of a modal", async () => {
    const user = userEvent.setup();
    render(<DiscoveryFieldsHarness />);

    await user.click(screen.getByRole("radio", { name: /Full audit/i }));
    expect(screen.getByRole("note")).toHaveTextContent("may require thousands of API requests");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("defines a visible focus ring and narrow layout for the discovery choices", () => {
    const styles = readFileSync(`${process.cwd()}/src/styles/app.css`, "utf8");
    expect(styles).toMatch(/\.content-replacement-discovery-choice[^\n]*:focus-within[\s\S]*outline:\s*3px solid var\(--so-focus\)/);
    expect(styles).toMatch(/@media \(max-width: 640px\)[\s\S]*content-replacement-discovery-choices/);
  });
});

async function blobText(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(String(reader.result ?? "")));
    reader.addEventListener("error", () => reject(reader.error));
    reader.readAsText(blob);
  });
}
