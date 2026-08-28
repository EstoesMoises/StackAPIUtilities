import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { completeSmeCoverageDecisionPack } from "../test/fixtures/smeCoverageFixtures";
import {
  buildSmeCoverageAssessmentBrief,
  formatSmeCoverageAssessmentMarkdown,
} from "../utilities/smeCoverage/assessmentBrief";
import { SmeCoverageAssessment } from "./SmeCoverageAssessment";

const brief = buildSmeCoverageAssessmentBrief(completeSmeCoverageDecisionPack());

afterEach(() => {
  vi.restoreAllMocks();
});

describe("SmeCoverageAssessment", () => {
  it("renders a labeled hierarchy with concise priority evidence", () => {
    render(<SmeCoverageAssessment brief={brief} />);

    expect(screen.getByRole("heading", { name: "Bottom line" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "Immediate priorities" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "Critical under-coverage" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "Light coverage" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "Recommended next step" })).toBeVisible();
    expect(screen.getByTestId("assessment-content")).toHaveTextContent(
      "zeta-runtime12,346 page views · 0 SMEsAssign or confirm at least one SME.",
    );
    expect(screen.getByTestId("assessment-content")).not.toHaveAttribute("aria-live");
  });

  it("copies structured Markdown and announces success outside its reading content", async () => {
    const user = userEvent.setup();
    const writeText = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue(undefined);
    render(<SmeCoverageAssessment brief={brief} />);

    await user.click(screen.getByRole("button", { name: "Copy assessment" }));

    expect(writeText).toHaveBeenCalledWith(formatSmeCoverageAssessmentMarkdown(brief));
    expect(screen.getByRole("status")).toHaveTextContent(/assessment copied/i);
  });

  it("keeps the structured assessment visible and gives an actionable alert when copying fails", async () => {
    const user = userEvent.setup();
    vi.spyOn(navigator.clipboard, "writeText").mockRejectedValue(new Error("blocked"));
    render(<SmeCoverageAssessment brief={brief} />);

    await user.click(screen.getByRole("button", { name: "Copy assessment" }));

    expect(screen.getByRole("alert")).toHaveTextContent(/select the assessment and copy it manually/i);
    expect(screen.getByRole("heading", { name: "Bottom line" })).toBeVisible();
  });
});
