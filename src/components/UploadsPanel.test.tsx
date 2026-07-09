import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { tagMetricsCsv } from "../test/fixtures/reportFixtures";
import { UploadsPanel } from "./UploadsPanel";

describe("UploadsPanel", () => {
  it("imports a CSV file and reports loaded rows", async () => {
    const user = userEvent.setup();
    const onImported = vi.fn();
    render(<UploadsPanel onImported={onImported} />);
    const file = new File([tagMetricsCsv], "tag_metrics.csv", { type: "text/csv" });

    expect(
      screen.getByText(
        "Upload existing CSV or JSON outputs from current SO4T scripts. Files are parsed locally in this browser. Loaded datasets stay stored locally until removed from the Datasets panel.",
      ),
    ).toBeInTheDocument();

    await user.upload(screen.getByLabelText("Upload report outputs"), file);

    expect(await screen.findByText("Imported tag_metrics.csv for Tag Report.")).toBeInTheDocument();
    expect(onImported).toHaveBeenCalledWith(
      expect.objectContaining({
        datasetName: "tags",
        fileName: "tag_metrics.csv",
        reportId: "tag-report",
        records: expect.arrayContaining([
          expect.objectContaining({ tagName: "machine-learning", totalPageViews: 551412 }),
        ]),
      }),
    );
  });
});
