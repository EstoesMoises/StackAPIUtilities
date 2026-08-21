import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { DataTable } from "./DataTable";

describe("DataTable", () => {
  it("paginates dynamic report fields, resets search to page one, and preserves records", async () => {
    const user = userEvent.setup();
    const records = Object.freeze(
      Array.from({ length: 55 }, (_, index) =>
        Object.freeze({
          user_id: index + 1,
          display_name: `User ${index + 1}`,
          department: index % 2 === 0 ? "Engineering" : "Product",
        }),
      ),
    );
    const before = JSON.stringify(records);
    render(<DataTable records={records} />);

    const region = screen.getByRole("region", { name: "Report evidence table" });
    expect(within(region).getAllByRole("row")).toHaveLength(51);
    expect(screen.getByText("Rows 1–50 of 55")).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Next page" }));
    expect(screen.getByText("Rows 51–55 of 55")).toBeVisible();

    await user.type(screen.getByRole("searchbox", { name: "Search evidence" }), "User 3");
    expect(screen.getByRole("cell", { name: "User 3" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Previous page" })).toBeDisabled();
    expect(JSON.stringify(records)).toBe(before);
  });

  it("builds a stable first-seen column union and honestly renders structured values", async () => {
    const user = userEvent.setup();
    render(
      <DataTable
        records={[
          {
            user_id: 1,
            active: true,
            tags: ["react", "typescript"],
            metadata: { team: "Core" },
            note: null,
          },
          { display_name: "Ada", user_id: 2 },
        ]}
      />,
    );

    const region = screen.getByRole("region", { name: "Report evidence table" });
    const headers = within(region).getAllByRole("columnheader");
    expect(headers.map((header) => header.getAttribute("data-column-id"))).toEqual([
      "user_id",
      "active",
      "tags",
      "metadata",
      "note",
      "display_name",
    ]);
    expect(screen.getByRole("cell", { name: "true" })).toBeVisible();
    expect(screen.getByRole("cell", { name: '["react","typescript"]' })).toBeVisible();
    expect(screen.getByRole("cell", { name: '{"team":"Core"}' })).toBeVisible();
    expect(screen.getByRole("cell", { name: "null" })).toBeVisible();

    await user.type(screen.getByRole("searchbox", { name: "Search evidence" }), "Core");
    expect(screen.getByText("Rows 1–1 of 1")).toBeVisible();
    expect(screen.getByRole("cell", { name: '{"team":"Core"}' })).toBeVisible();
  });

  it("sorts comparable primitive values and leaves structured values unsortable", async () => {
    const user = userEvent.setup();
    render(
      <DataTable
        records={[
          { score: 10, metadata: { rank: 3 } },
          { score: 2, metadata: { rank: 1 } },
          { score: 7, metadata: { rank: 2 } },
        ]}
      />,
    );

    const region = screen.getByRole("region", { name: "Report evidence table" });
    const scoreHeader = within(region).getByRole("columnheader", { name: "score" });
    const metadataHeader = within(region).getByRole("columnheader", { name: "metadata" });
    expect(within(scoreHeader).getByRole("button", { name: "score" })).toBeVisible();
    expect(within(metadataHeader).queryByRole("button")).not.toBeInTheDocument();

    await user.click(within(scoreHeader).getByRole("button", { name: "score" }));
    expect(
      within(region)
        .getAllByRole("row")
        .slice(1)
        .map((row) => within(row).getAllByRole("cell")[0]?.textContent),
    ).toEqual(["2", "7", "10"]);
  });

  it("shows only the first eight fields by default while keeping every field revealable", async () => {
    const user = userEvent.setup();
    const record = Object.fromEntries(
      Array.from({ length: 10 }, (_, index) => [`field_${index + 1}`, `value-${index + 1}`]),
    );
    render(<DataTable records={[record]} />);

    const region = screen.getByRole("region", { name: "Report evidence table" });
    expect(within(region).getAllByRole("columnheader")).toHaveLength(8);
    expect(within(region).queryByRole("columnheader", { name: "field_9" })).not.toBeInTheDocument();

    await user.click(screen.getByText("Columns", { selector: "summary" }));
    expect(screen.getAllByRole("checkbox")).toHaveLength(10);
    await user.click(screen.getByRole("checkbox", { name: "field_9" }));
    expect(within(region).getByRole("columnheader", { name: "field_9" })).toBeVisible();
  });

  it("preserves explorer state for record updates with the same shape", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<DataTable records={[{ id: 1, name: "Old needle" }]} />);
    const search = screen.getByRole("searchbox", { name: "Search evidence" });
    await user.type(search, "needle");

    rerender(<DataTable records={[{ id: 2, name: "New needle" }]} />);

    expect(screen.getByRole("searchbox", { name: "Search evidence" })).toHaveValue("needle");
    expect(screen.getByRole("cell", { name: "New needle" })).toBeVisible();
  });

  it("resets stale explorer state when the dynamic column shape changes", async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <DataTable records={[{ name: "Legacy row", old_field: "legacy needle" }]} />,
    );
    await user.type(screen.getByRole("searchbox", { name: "Search evidence" }), "legacy needle");

    rerender(<DataTable records={[{ name: "Fresh row", new_field: "current value" }]} />);

    expect(screen.getByRole("searchbox", { name: "Search evidence" })).toHaveValue("");
    expect(screen.getByRole("cell", { name: "Fresh row" })).toBeVisible();
    expect(screen.getByRole("columnheader", { name: "new_field" })).toBeVisible();
    expect(screen.queryByRole("columnheader", { name: "old_field" })).not.toBeInTheDocument();
  });

  it("shows the existing empty state when no records are loaded", () => {
    render(<DataTable records={[]} />);

    expect(screen.getByRole("status")).toHaveTextContent("No records loaded yet.");
    expect(screen.queryByRole("region", { name: "Report evidence table" })).not.toBeInTheDocument();
  });
});
