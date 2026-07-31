import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SmeCoverageAssessment } from "./SmeCoverageAssessment";

const assessment = "First prepared paragraph.\n\nSecond prepared paragraph.";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("SmeCoverageAssessment", () => {
  it("copies the exact prepared assessment and announces success outside its reading content", async () => {
    const user = userEvent.setup();
    const writeText = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue(undefined);
    render(<SmeCoverageAssessment assessment={assessment} />);

    await user.click(screen.getByRole("button", { name: "Copy assessment" }));

    expect(writeText).toHaveBeenCalledWith(assessment);
    expect(screen.getByRole("status")).toHaveTextContent(/assessment copied/i);
    expect(screen.getByTestId("assessment-content")).toHaveTextContent(
      "First prepared paragraph.Second prepared paragraph.",
    );
    expect(screen.getByTestId("assessment-content")).not.toHaveAttribute("aria-live");
  });

  it("keeps the assessment unchanged and gives an actionable alert when copying fails", async () => {
    const user = userEvent.setup();
    vi.spyOn(navigator.clipboard, "writeText").mockRejectedValue(new Error("blocked"));
    render(<SmeCoverageAssessment assessment={assessment} />);

    await user.click(screen.getByRole("button", { name: "Copy assessment" }));

    expect(screen.getByRole("alert")).toHaveTextContent(/select the assessment and copy it manually/i);
    expect(screen.getByTestId("assessment-content")).toHaveTextContent(
      "First prepared paragraph.Second prepared paragraph.",
    );
  });
});
