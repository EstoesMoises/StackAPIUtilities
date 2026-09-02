import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ContentReplacementDefineStep } from "./ContentReplacementDefineStep";
import type { ContentReplacementJobManagerStorage } from "./ContentReplacementJobManager";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ContentReplacementDefineStep", () => {
  it("includes the sensitive browser-local job manager in Define", async () => {
    const storage: ContentReplacementJobManagerStorage = {
      list: vi.fn().mockResolvedValue([]),
      delete: vi.fn().mockResolvedValue(undefined),
    };
    render(
      <ContentReplacementDefineStep
        onStartScan={vi.fn()}
        onOpenLocalJob={vi.fn()}
        contentReplacementStorage={storage}
      />,
    );

    expect(await screen.findByRole("heading", { name: "Browser-local replacement jobs" })).toBeVisible();
    expect(screen.getByText(/post bodies and complete request models/i)).toBeVisible();
  });

  it("renders safe defaults and keyboard-operable mapping controls", async () => {
    const user = userEvent.setup();
    render(<ContentReplacementDefineStep onStartScan={vi.fn()} />);

    expect(screen.getByText("Enterprise main site")).toBeVisible();
    expect(screen.getByLabelText("Questions")).toBeChecked();
    expect(screen.getByLabelText("Answers")).toBeChecked();
    expect(screen.getByLabelText("Articles")).toBeChecked();
    expect(screen.getByLabelText("Case-sensitive matching")).toBeChecked();
    expect(screen.getByLabelText("Whole-term matching")).toBeChecked();
    expect(screen.getByLabelText("Replace inside code")).not.toBeChecked();
    expect(screen.getByText("Advanced").closest("details")).not.toHaveAttribute("open");
    expect(screen.getByLabelText("Find term 1")).toBeVisible();
    expect(screen.getByLabelText("Replace term 1 with")).toBeVisible();

    await user.type(screen.getByLabelText("Find term 1"), "first");
    await user.type(screen.getByLabelText("Replace term 1 with"), "one");
    await user.click(screen.getByRole("button", { name: "Add mapping" }));
    await user.type(screen.getByLabelText("Find term 2"), "second");
    await user.type(screen.getByLabelText("Replace term 2 with"), "two");
    await user.click(screen.getByRole("button", { name: "Move mapping 2 up" }));

    expect(screen.getByLabelText("Find term 1")).toHaveValue("second");
    expect(screen.getByRole("button", { name: "Move mapping 1 up" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Remove mapping 2" }));
    expect(screen.queryByLabelText("Find term 2")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove mapping 1" })).toBeDisabled();
  });

  it("shows plain warnings and the contexts that always remain protected", async () => {
    const user = userEvent.setup();
    render(<ContentReplacementDefineStep onStartScan={vi.fn()} />);

    await user.click(screen.getByText("Advanced"));
    await user.click(screen.getByLabelText("Case-sensitive matching"));
    await user.click(screen.getByLabelText("Whole-term matching"));
    await user.click(screen.getByLabelText("Replace inside code"));

    expect(screen.getByText(/Case sensitivity is off/i)).toBeVisible();
    expect(screen.getByText(/Partial matching is on/i)).toBeVisible();
    expect(screen.getByText(/Code replacement is on/i)).toBeVisible();
    expect(screen.getByText(/Link, image, and autolink destinations/i)).toBeVisible();
    expect(screen.getByText(/raw HTML attributes remain protected/i)).toBeVisible();
  });

  it("requires an exact rule-summary checkpoint before scan and invalidates it after edits", async () => {
    const user = userEvent.setup();
    const onStartScan = vi.fn().mockResolvedValue(undefined);
    render(<ContentReplacementDefineStep onStartScan={onStartScan} />);

    await user.type(screen.getByLabelText("Find term 1"), "MyPVM");
    await user.type(screen.getByLabelText("Replace term 1 with"), "MyPBM");
    expect(screen.getByRole("button", { name: "Start scan" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Review rules" }));

    expect(screen.getByText("MyPVM → MyPBM")).toBeVisible();
    expect(screen.getByText(/Questions, Answers, Articles/)).toBeVisible();
    expect(screen.getByText(/Starting the scan performs reads only/i)).toBeVisible();
    expect(screen.getByRole("button", { name: "Start scan" })).toBeEnabled();

    await user.click(screen.getByLabelText("Articles"));
    expect(screen.queryByText("MyPVM → MyPBM")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Start scan" })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "Review rules" }));
    await user.click(screen.getByRole("button", { name: "Start scan" }));
    expect(onStartScan).toHaveBeenCalledOnce();
    expect(onStartScan).toHaveBeenCalledWith(expect.objectContaining({
      target: { kind: "enterprise-main" },
      contentTypes: { questions: true, answers: true, articles: false },
      rules: [{ id: expect.any(String), find: "MyPVM", replace: "MyPBM" }],
    }));
  });

  it("keeps row errors visible and reports identical duplicates", async () => {
    const user = userEvent.setup();
    render(<ContentReplacementDefineStep onStartScan={vi.fn()} />);

    await user.type(screen.getByLabelText("Find term 1"), "MyPVM");
    await user.click(screen.getByRole("button", { name: "Add mapping" }));
    await user.type(screen.getByLabelText("Find term 2"), "MyPVM");
    await user.type(screen.getByLabelText("Replace term 2 with"), "MyPBM");
    await user.click(screen.getByRole("button", { name: "Add mapping" }));
    await user.type(screen.getByLabelText("Find term 3"), "MyPVM");
    await user.type(screen.getByLabelText("Replace term 3 with"), "MyPBM");
    await user.click(screen.getByRole("button", { name: "Review rules" }));

    expect(screen.getByText(/Mapping 1: enter a replacement term/i)).toBeVisible();
    expect(screen.getByText('Removed duplicate rule "MyPVM" → "MyPBM".')).toBeVisible();
    expect(screen.getByRole("button", { name: "Start scan" })).toBeDisabled();
  });

  it("downloads the canonical local CSV template", async () => {
    const user = userEvent.setup();
    render(<ContentReplacementDefineStep onStartScan={vi.fn()} />);
    let downloadedBlob: Blob | undefined;
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: vi.fn((blob: Blob) => {
        downloadedBlob = blob;
        return "blob:replacement-template";
      }),
    });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
    const link = { click: vi.fn(), download: "", href: "" };
    vi.spyOn(document, "createElement").mockReturnValue(link as unknown as HTMLAnchorElement);

    await user.click(screen.getByRole("button", { name: "Download CSV template" }));

    expect(link.download).toBe("content-replacement-template.csv");
    expect(await blobText(downloadedBlob!)).toBe("find,replace\n");
    expect(screen.getByText(/CSV parsing stays in this browser/i)).toBeVisible();
  });

  it("offers append or replace for imports and retains invalid source rows", async () => {
    const user = userEvent.setup();
    render(<ContentReplacementDefineStep onStartScan={vi.fn()} />);
    await user.type(screen.getByLabelText("Find term 1"), "Manual");
    await user.type(screen.getByLabelText("Replace term 1 with"), "Existing");

    await user.upload(
      screen.getByLabelText("Import replacement CSV"),
      new File(["find,replace\nMyPVM,MyPBM\nCPR,"], "rules.csv", { type: "text/csv" }),
    );
    const choice = await screen.findByRole("group", { name: "Apply imported mappings" });
    expect(within(choice).getByRole("button", { name: "Append imported rows" })).toBeVisible();
    expect(screen.queryByLabelText("Find term 2")).not.toBeInTheDocument();

    await user.click(within(choice).getByRole("button", { name: "Append imported rows" }));
    expect(screen.getByLabelText("Find term 1")).toHaveValue("Manual");
    expect(screen.getByLabelText("Find term 2")).toHaveValue("MyPVM");
    expect(screen.getByLabelText("Find term 3")).toHaveValue("CPR");
    expect(screen.getByText(/CSV row 3, replace: enter a replacement term/i)).toBeVisible();

    await user.upload(
      screen.getByLabelText("Import replacement CSV"),
      new File(["find,replace\nSolo,Only"], "replacement.csv", { type: "text/csv" }),
    );
    await user.click(screen.getByRole("button", { name: "Replace current rows" }));
    expect(screen.getByLabelText("Find term 1")).toHaveValue("Solo");
    expect(screen.queryByLabelText("Find term 2")).not.toBeInTheDocument();
  });

  it("ignores stale file reads and reports the current file read error", async () => {
    const user = userEvent.setup();
    const first = deferred<string>();
    const firstFile = new File(["ignored"], "slow.csv", { type: "text/csv" });
    Object.defineProperty(firstFile, "text", { value: () => first.promise });
    const secondFile = new File(["ignored"], "broken.csv", { type: "text/csv" });
    Object.defineProperty(secondFile, "text", { value: () => Promise.reject(new Error("Disk read failed.")) });
    render(<ContentReplacementDefineStep onStartScan={vi.fn()} />);

    await user.upload(screen.getByLabelText("Import replacement CSV"), firstFile);
    await user.upload(screen.getByLabelText("Import replacement CSV"), secondFile);
    expect(await screen.findByRole("alert")).toHaveTextContent("Disk read failed.");

    await act(async () => first.resolve("find,replace\nStale,Value"));
    await waitFor(() => expect(screen.queryByText(/Stale/)).not.toBeInTheDocument());
    expect(screen.getByRole("alert")).toHaveTextContent("Disk read failed.");
  });

  it("consults current mappings when a deferred CSV read resolves", async () => {
    const user = userEvent.setup();
    const read = deferred<string>();
    const file = new File(["ignored"], "deferred.csv", { type: "text/csv" });
    Object.defineProperty(file, "text", { value: () => read.promise });
    render(<ContentReplacementDefineStep onStartScan={vi.fn()} />);

    await user.upload(screen.getByLabelText("Import replacement CSV"), file);
    await user.type(screen.getByLabelText("Find term 1"), "Manual");
    await user.type(screen.getByLabelText("Replace term 1 with"), "Existing");
    await act(async () => read.resolve("find,replace\nImported,Value"));

    expect(await screen.findByRole("group", { name: "Apply imported mappings" })).toBeVisible();
    expect(screen.getByLabelText("Find term 1")).toHaveValue("Manual");
    expect(screen.queryByLabelText("Find term 2")).not.toBeInTheDocument();
  });

  it("keeps valid mixed-import rows editable while file-shape errors block the checkpoint", async () => {
    const user = userEvent.setup();
    render(<ContentReplacementDefineStep onStartScan={vi.fn()} />);

    await user.upload(
      screen.getByLabelText("Import replacement CSV"),
      new File(["find,replace\nMyPVM,MyPBM\nBad,Row,Extra"], "mixed.csv", { type: "text/csv" }),
    );
    expect(screen.getByLabelText("Find term 1")).toHaveValue("MyPVM");
    expect(screen.getByText(/CSV row 3 must contain exactly two columns/i)).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Review rules" }));
    expect(screen.getByRole("alert", { name: "Rule validation summary" })).toHaveTextContent(/1 error prevents scanning/i);
    expect(screen.getByRole("button", { name: "Start scan" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Discard import errors" }));
    await user.click(screen.getByRole("button", { name: "Review rules" }));
    expect(screen.getByRole("button", { name: "Start scan" })).toBeEnabled();
  });

  it("validates overlong imported values and focuses the first invalid field", async () => {
    const user = userEvent.setup();
    render(<ContentReplacementDefineStep onStartScan={vi.fn()} />);
    const overlongFind = "x".repeat(201);

    await user.upload(
      screen.getByLabelText("Import replacement CSV"),
      new File([`find,replace\n${overlongFind},short`], "long.csv", { type: "text/csv" }),
    );
    await user.click(screen.getByRole("button", { name: "Review rules" }));

    const find = screen.getByLabelText("Find term 1");
    expect(find).toHaveAttribute("aria-invalid", "true");
    expect(find).toHaveFocus();
    expect(screen.getByRole("alert", { name: "Rule validation summary" })).toHaveTextContent(/1 error prevents scanning/i);
    expect(screen.getByText(/CSV row 2, find: use 200 characters or fewer/i)).toBeVisible();

    await user.clear(find);
    await user.type(find, "Fixed");
    expect(screen.queryByRole("alert", { name: "Rule validation summary" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Review rules" }));
    expect(screen.getByRole("button", { name: "Start scan" })).toBeEnabled();
  });

  it("announces failed validation and focuses the first invalid replacement", async () => {
    const user = userEvent.setup();
    render(<ContentReplacementDefineStep onStartScan={vi.fn()} />);
    await user.type(screen.getByLabelText("Find term 1"), "MyPVM");

    await user.click(screen.getByRole("button", { name: "Review rules" }));

    expect(screen.getByRole("alert", { name: "Rule validation summary" })).toHaveTextContent(
      /1 error prevents scanning.*Correct the highlighted field/i,
    );
    expect(screen.getByLabelText("Replace term 1 with")).toHaveFocus();
  });

  it("keeps Review available but blocks Start when credentials are not scan-ready", async () => {
    const user = userEvent.setup();
    const onStartScan = vi.fn();
    render(
      <ContentReplacementDefineStep
        onStartScan={onStartScan}
        scanReadiness={{ ready: false, message: "Reconnect Enterprise OAuth with write_access." }}
      />,
    );
    await user.type(screen.getByLabelText("Find term 1"), "MyPVM");
    await user.type(screen.getByLabelText("Replace term 1 with"), "MyPBM");
    await user.click(screen.getByRole("button", { name: "Review rules" }));

    expect(screen.getByText("MyPVM → MyPBM")).toBeVisible();
    expect(screen.getByText(/Reconnect Enterprise OAuth with write_access/i)).toBeVisible();
    expect(screen.getByRole("button", { name: "Start scan" })).toBeDisabled();
    expect(onStartScan).not.toHaveBeenCalled();
  });

  it("focuses the content-type group when zero scope is the first actionable blocker", async () => {
    const user = userEvent.setup();
    render(<ContentReplacementDefineStep onStartScan={vi.fn()} />);
    await user.type(screen.getByLabelText("Find term 1"), "MyPVM");
    await user.type(screen.getByLabelText("Replace term 1 with"), "MyPBM");
    await user.click(screen.getByLabelText("Questions"));
    await user.click(screen.getByLabelText("Answers"));
    await user.click(screen.getByLabelText("Articles"));

    await user.click(screen.getByRole("button", { name: "Review rules" }));

    const scope = screen.getByRole("group", { name: "Content types" });
    expect(scope).toHaveAttribute("aria-invalid", "true");
    expect(scope).toHaveAttribute("aria-describedby", "content-replacement-content-types-error");
    expect(screen.getByLabelText("Questions")).toHaveFocus();
    expect(screen.getByRole("alert", { name: "Rule validation summary" })).toHaveTextContent(
      "1 error prevents scanning. Select at least one content type.",
    );
  });

  it("focuses the accessible discard action when CSV errors are the only blocker", async () => {
    const user = userEvent.setup();
    render(<ContentReplacementDefineStep onStartScan={vi.fn()} />);
    await user.type(screen.getByLabelText("Find term 1"), "MyPVM");
    await user.type(screen.getByLabelText("Replace term 1 with"), "MyPBM");
    await user.upload(
      screen.getByLabelText("Import replacement CSV"),
      new File(["wrong,headers\nfoo,bar"], "invalid.csv", { type: "text/csv" }),
    );

    await user.click(screen.getByRole("button", { name: "Review rules" }));

    expect(screen.getByRole("button", { name: "Discard import errors" })).toHaveFocus();
    expect(screen.getByRole("alert", { name: "Rule validation summary" })).toHaveTextContent(
      /1 error prevents scanning\. Resolve the CSV import error/i,
    );
    expect(screen.getByRole("alert", { name: "Rule validation summary" })).not.toHaveTextContent(/highlighted field/i);
  });
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function blobText(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(String(reader.result ?? "")));
    reader.addEventListener("error", () => reject(reader.error));
    reader.readAsText(blob);
  });
}
