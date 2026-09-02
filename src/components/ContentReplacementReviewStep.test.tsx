import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { ContentReplacementJobController } from "../hooks/useContentReplacementJob";
import type {
  PersistedContentReplacementItem,
  PersistedContentReplacementJob,
  ReplacementContentKind,
  ReplacementProposal,
} from "../writeTools/contentReplacement/types";
import { ContentReplacementReviewStep } from "./ContentReplacementReviewStep";

describe("ContentReplacementReviewStep", () => {
  it("paginates at 50 rows in stable numeric order and keeps table overflow named and focusable", async () => {
    const user = userEvent.setup();
    const proposals = Object.fromEntries(
      Array.from({ length: 51 }, (_, index) => {
        const id = 51 - index;
        return [`question:${id}`, item(proposal("question", id), true)];
      }),
    );
    render(<ContentReplacementReviewStep controller={controller(job(proposals))} />);

    const tableRegion = screen.getByRole("region", { name: "Replacement proposal review table" });
    expect(tableRegion).toHaveAttribute("tabindex", "0");
    expect(within(tableRegion).getAllByRole("row")).toHaveLength(51);
    expect(within(tableRegion).getAllByText("Question 1")[0]).toBeVisible();
    expect(within(tableRegion).queryAllByText("Question 51")).toHaveLength(0);
    expect(screen.getByText("Showing 1–50 of 51 proposals")).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Next page" }));
    expect(within(tableRegion).getAllByRole("row")).toHaveLength(2);
    expect(within(tableRegion).getAllByText("Question 51")[0]).toBeVisible();
    expect(screen.getByRole("button", { name: "Next page" })).toBeDisabled();
  });

  it("composes filters, resets pagination, and bulk-excludes only the complete filtered result", async () => {
    const user = userEvent.setup();
    const jobController = controller(job({
      "question:4": item(proposal("question", 4, { title: "Alpha migration", field: "title", ruleId: "rule-2" }), true),
      "answer:3": item(proposal("answer", 3, { title: "Alpha context", ruleId: "rule-10" }), true),
      "article:2": item(proposal("article", 2, { title: "Beta article", ruleId: "rule-2" }), false),
    }));
    render(<ContentReplacementReviewStep controller={jobController} />);

    await user.selectOptions(screen.getByLabelText("Content type"), "question");
    await user.selectOptions(screen.getByLabelText("Replacement rule"), "rule-2");
    await user.selectOptions(screen.getByLabelText("Affected field"), "title");
    await user.selectOptions(screen.getByLabelText("Review status"), "included");
    await user.type(screen.getByLabelText("Search title, context, or ID"), "alpha");

    expect(screen.getByRole("status", { name: "Review results count" })).toHaveTextContent("1 matching proposal");
    expect(screen.getByText("Question 4")).toBeVisible();
    expect(screen.queryByText("Answer 3")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Exclude 1 filtered proposal" }));
    expect(jobController.setItemsIncluded).toHaveBeenCalledTimes(1);
    expect(jobController.setItemsIncluded).toHaveBeenCalledWith(["question:4"], false);
    expect(jobController.setItemIncluded).not.toHaveBeenCalled();
    expect(summaryText("1 post selected · 1 changed occurrence")).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(screen.getByRole("status", { name: "Review results count" })).toHaveTextContent("3 matching proposals");
  });

  it("keeps exact selection totals synchronized and prepares apply only with a nonzero selection", async () => {
    const user = userEvent.setup();
    const first = proposal("question", 1);
    first.changedOccurrences.push({ field: "body", ruleId: "rule-2", start: 15, end: 18, before: "old", after: "new" });
    const jobController = controller(job({
      "question:1": item(first, true),
      "article:2": item(proposal("article", 2), false),
    }));
    render(<ContentReplacementReviewStep controller={jobController} />);

    expect(summaryText("1 post selected · 2 changed occurrences")).toBeVisible();
    await user.click(screen.getByLabelText("Include question 1"));
    expect(jobController.setItemIncluded).toHaveBeenCalledWith("question:1", false);
    expect(summaryText("0 posts selected · 0 changed occurrences")).toBeVisible();
    expect(screen.getByRole("button", { name: "Continue with 0 posts and 0 changed occurrences" })).toBeDisabled();

    await user.click(screen.getByLabelText("Include article 2"));
    await user.click(screen.getByRole("button", { name: "Continue with 1 post and 1 changed occurrence" }));
    expect(jobController.prepareApply).toHaveBeenCalledOnce();
    expect(jobController.prepareApply).toHaveBeenCalledWith({
      itemKeys: ["article:2"],
      selectedItems: 1,
      selectedChangedOccurrences: 1,
    });
  });

  it("blocks selection-dependent actions until a deferred row save settles", async () => {
    const user = userEvent.setup();
    const gate = deferred<boolean>();
    const jobController = controller(job({
      "question:1": item(proposal("question", 1), true),
      "article:2": item(proposal("article", 2), true),
    }));
    vi.mocked(jobController.setItemIncluded).mockReturnValueOnce(gate.promise);
    render(<ContentReplacementReviewStep controller={jobController} />);

    await user.click(screen.getByLabelText("Include question 1"));

    expect(screen.getByRole("button", { name: "Continue with 1 post and 1 changed occurrence" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Exclude 2 filtered proposals" })).toBeDisabled();
    expect(screen.getByLabelText("Content type")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Next page" })).toBeDisabled();
    expect(jobController.prepareApply).not.toHaveBeenCalled();

    await act(async () => gate.resolve(true));
    await waitFor(() => expect(screen.getByRole("button", {
      name: "Continue with 1 post and 1 changed occurrence",
    })).toBeEnabled());
  });

  it("rolls back a failed row save and refuses Continue until selection is saved", async () => {
    const user = userEvent.setup();
    const jobController = controller(job({
      "question:1": item(proposal("question", 1), true),
      "article:2": item(proposal("article", 2), true),
    }));
    vi.mocked(jobController.setItemIncluded).mockResolvedValueOnce(false);
    render(<ContentReplacementReviewStep controller={jobController} />);

    await user.click(screen.getByLabelText("Include question 1"));

    expect(await screen.findByRole("alert")).toHaveTextContent("Selection was not saved");
    expect(summaryText("2 posts selected · 2 changed occurrences")).toBeVisible();
    expect(screen.getByRole("button", { name: "Continue with 2 posts and 2 changed occurrences" })).toBeDisabled();
    expect(jobController.prepareApply).not.toHaveBeenCalled();
  });

  it("bulk selection persists once and rolls the entire filtered set back on failure", async () => {
    const user = userEvent.setup();
    const jobController = controller(job({
      "question:1": item(proposal("question", 1), true),
      "article:2": item(proposal("article", 2), true),
    }));
    vi.mocked(jobController.setItemsIncluded).mockResolvedValueOnce(false);
    render(<ContentReplacementReviewStep controller={jobController} />);

    await user.click(screen.getByRole("button", { name: "Exclude 2 filtered proposals" }));

    expect(jobController.setItemsIncluded).toHaveBeenCalledOnce();
    expect(jobController.setItemsIncluded).toHaveBeenCalledWith(["question:1", "article:2"], false);
    expect(jobController.setItemIncluded).not.toHaveBeenCalled();
    expect(await screen.findByRole("alert")).toHaveTextContent("Selection was not saved");
    expect(summaryText("2 posts selected · 2 changed occurrences")).toBeVisible();
  });

  it("expands full safe Markdown details, highlights valid offsets, and maintains a three-item LRU", async () => {
    const user = userEvent.setup();
    const proposals = Object.fromEntries(
      [1, 2, 3, 4].map((id) => [`question:${id}`, item(proposal("question", id), true)]),
    );
    const jobController = controller(job(proposals));
    render(<ContentReplacementReviewStep controller={jobController} />);

    for (const id of [1, 2, 3]) {
      await user.click(screen.getByRole("button", { name: `View details for question ${id}` }));
    }
    await user.click(screen.getByRole("button", { name: "Hide details for question 1" }));
    await user.click(screen.getByRole("button", { name: "View details for question 1" }));
    await user.click(screen.getByRole("button", { name: "View details for question 4" }));

    expect(screen.getByRole("region", { name: "Question 1 proposed changes" })).toBeVisible();
    expect(screen.queryByRole("region", { name: "Question 2 proposed changes" })).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Question 3 proposed changes" })).toBeVisible();
    const detail = screen.getByRole("region", { name: "Question 4 proposed changes" });
    expect(detail).toHaveTextContent("Use MyPVM. Keep [label](https://outside.example/MyPVM).");
    expect(within(detail).getAllByText("MyPVM", { selector: "mark" }).length).toBeGreaterThan(0);
    expect(within(detail).getAllByText("MyPBM", { selector: "mark" }).length).toBeGreaterThan(0);
    expect(within(detail).getByText("Code — unchanged")).toBeVisible();
    expect(within(detail).getByText("Owner 7 (#7)")).toBeVisible();
    expect(within(detail).getByText("Editor 8 (#8)")).toBeVisible();
    expect(within(detail).getByText(/"tags": \[/)).toBeVisible();
    expect(within(detail).queryByRole("link", { name: /outside/i })).not.toBeInTheDocument();

    await user.click(within(detail).getByRole("button", { name: "Exclude question 4" }));
    expect(jobController.setItemIncluded).toHaveBeenCalledWith("question:4", false);
  });

  it("falls back to plain text for overlapping offsets, exports every proposal, and keeps errors retryable", async () => {
    const user = userEvent.setup();
    const malformed = proposal("question", 1);
    malformed.changedOccurrences.push({ field: "body", ruleId: "rule-2", start: 6, end: 10, before: "overlap", after: "safe" });
    const jobController = controller(job({
      "question:1": item(malformed, true),
      "answer:2": item(proposal("answer", 2), true),
    }));
    jobController.storageError = "Content replacement progress could not be saved.";
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: vi.fn(() => "blob:preview") });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
    const createObjectURL = vi.mocked(URL.createObjectURL);
    const revokeObjectURL = vi.mocked(URL.revokeObjectURL);
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    render(<ContentReplacementReviewStep controller={jobController} />);

    expect(screen.getByRole("alert")).toHaveTextContent("Content replacement progress could not be saved.");
    await user.click(screen.getByRole("button", { name: "Download complete preview CSV" }));
    expect(createObjectURL).toHaveBeenCalledOnce();
    expect(click).toHaveBeenCalledOnce();
    expect(revokeObjectURL).toHaveBeenCalledOnce();

    await user.click(screen.getByRole("button", { name: "View details for question 1" }));
    const before = screen.getByTestId("question-1-body-before");
    expect(within(before).queryByRole("mark")).not.toBeInTheDocument();
    expect(before).toHaveTextContent("Use MyPVM. Keep [label](https://outside.example/MyPVM).");
  });

  it("always displays the persisted matching and protection policy", () => {
    render(<ContentReplacementReviewStep controller={controller(job({}))} />);

    const policy = screen.getByRole("region", { name: "Matching and protection policy" });
    expect(policy).toHaveTextContent("Case-sensitive");
    expect(policy).toHaveTextContent("Partial matching");
    expect(policy).toHaveTextContent("Code excluded");
    expect(policy).toHaveTextContent("Always protected: link and image destinations, raw HTML attributes and hidden content");
  });
});

function controller(currentJob: PersistedContentReplacementJob): ContentReplacementJobController {
  return {
    job: currentJob,
    busy: false,
    rehydrating: false,
    storageError: null,
    operationError: null,
    credentialReadiness: { valid: true, refreshRequired: false, message: "" },
    createJob: vi.fn(),
    startScan: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    cancel: vi.fn(),
    deleteJob: vi.fn(),
    deleteRecoverySnapshots: vi.fn(),
    setItemIncluded: vi.fn().mockResolvedValue(true),
    setItemsIncluded: vi.fn().mockResolvedValue(true),
    prepareApply: vi.fn().mockResolvedValue(true),
    startApply: vi.fn(),
    retryEligibleFailures: vi.fn(),
    rescanStaleItems: vi.fn(),
    prepareRecovery: vi.fn(),
    startRecovery: vi.fn(),
  };
}

function job(proposals: Record<string, PersistedContentReplacementItem>): PersistedContentReplacementJob {
  return {
    schemaVersion: 1,
    revision: 0,
    id: "job-1",
    fingerprint: "f".repeat(64),
    baseUrl: "https://example.stackenterprise.co",
    target: { kind: "enterprise-main" },
    configuration: {
      target: { kind: "enterprise-main" },
      contentTypes: { questions: true, answers: true, articles: true },
      discovery: { mode: "full" },
      rules: [
        { id: "rule-2", find: "old", replace: "new" },
        { id: "rule-10", find: "MyPVM", replace: "MyPBM" },
      ],
      options: { caseSensitive: true, wholeTerm: false, replaceInCode: false },
    },
    stage: "review",
    status: "completed",
    inventoryQueue: [],
    detailQueue: [],
    progress: {
      questionPages: 1, answerPages: 1, articlePages: 1, inventoryItems: 3,
      detailsInspected: 3, proposalsFound: Object.keys(proposals).length,
      protectedOccurrences: Object.keys(proposals).length, applyCompleted: 0, recoveryCompleted: 0,
    },
    proposals,
    recoverySnapshotStatus: "none",
    createdAt: "2026-09-02T12:00:00.000Z",
    updatedAt: "2026-09-02T12:00:00.000Z",
  };
}

function item(value: ReplacementProposal, included: boolean): PersistedContentReplacementItem {
  return {
    proposal: value,
    included,
    exclusionReason: included ? undefined : "user",
    attemptCount: 0,
    status: included ? "pending" : "excluded",
  };
}

function proposal(
  kind: ReplacementContentKind,
  id: number,
  overrides: { title?: string; field?: "title" | "body"; ruleId?: string } = {},
): ReplacementProposal {
  const title = overrides.title ?? `${capitalize(kind)} ${id}`;
  const body = "Use MyPVM. Keep [label](https://outside.example/MyPVM).";
  const afterBody = "Use MyPBM. Keep [label](https://outside.example/MyPVM).";
  const ref = kind === "question"
    ? { kind, questionId: id } as const
    : kind === "answer"
      ? { kind, questionId: 1, answerId: id } as const
      : { kind, articleId: id } as const;
  const request = kind === "answer"
    ? { body }
    : kind === "question"
      ? { title, body, tags: ["replacement", "review"] }
      : {
          title, body, tags: ["replacement"], type: "knowledgeArticle" as const,
          expirationDate: null,
          permissions: { editableBy: "specificEditors" as const, editorUserIds: [7], editorUserGroupIds: [9] },
        };
  const afterRequest = kind === "answer" ? { body: afterBody } : { ...request, body: afterBody };
  const field = overrides.field ?? "body";
  return {
    before: { kind, ref, request } as ReplacementProposal["before"],
    after: { kind, ref, request: afterRequest } as ReplacementProposal["after"],
    fields: {
      ...(kind === "answer" ? {} : { title: { beforeMarkdown: title, afterMarkdown: title } }),
      body: { beforeMarkdown: body, afterMarkdown: afterBody },
    },
    changedOccurrences: [{
      field,
      ruleId: overrides.ruleId ?? "rule-10",
      start: field === "body" ? 4 : 0,
      end: field === "body" ? 9 : Math.min(5, title.length),
      before: field === "body" ? "MyPVM" : title.slice(0, 5),
      after: field === "body" ? "MyPBM" : title.slice(0, 5),
    }],
    protectedOccurrences: [{
      field: "body", ruleId: "rule-10", start: 34, end: 56,
      before: "https://outside.example/MyPVM", reason: "code",
    }],
    appliedRuleIds: [overrides.ruleId ?? "rule-10"],
    metadata: {
      titleContext: title,
      webUrl: `https://example.stackenterprise.co/${kind}/${id}`,
      owner: { id: 7, name: "Owner 7" },
      lastEditor: { id: 8, name: "Editor 8" },
      lastActivityDate: "2026-09-02T11:00:00.000Z",
    },
    scannedRequestChecksum: "a".repeat(64),
    proposedRequestChecksum: "b".repeat(64),
    proposalFingerprint: "c".repeat(64),
  };
}

function capitalize(value: string): string {
  return `${value[0].toUpperCase()}${value.slice(1)}`;
}

function summaryText(value: string): HTMLElement {
  return screen.getByText((_, element) => element?.tagName === "P" && element.textContent === value);
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => { resolve = resolvePromise; });
  return { promise, resolve };
}
