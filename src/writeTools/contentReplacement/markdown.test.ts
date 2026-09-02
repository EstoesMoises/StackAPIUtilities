import { describe, expect, it } from "vitest";
import { replaceMarkdown } from "./markdown";

const rules = [{ id: "rule-1", find: "TermA", replace: "TermB" }];
const safe = { caseSensitive: true, wholeTerm: true, replaceInCode: false };

describe("replaceMarkdown", () => {
  it("changes visible Markdown text without regenerating its structure", () => {
    const source = [
      "# TermA guide",
      "",
      "Use **TermA**.",
      "",
      "- TermA list item",
      "",
      "> TermA quote",
      "",
      "Read [TermA](https://example.test).",
      "",
      "| Product |",
      "| --- |",
      "| TermA |",
    ].join("\n");

    const result = replaceMarkdown(source, rules, safe);

    expect(result.markdown).toBe(
      [
        "# TermB guide",
        "",
        "Use **TermB**.",
        "",
        "- TermB list item",
        "",
        "> TermB quote",
        "",
        "Read [TermB](https://example.test).",
        "",
        "| Product |",
        "| --- |",
        "| TermB |",
      ].join("\n"),
    );
    expect(result.changedOccurrences).toHaveLength(6);
    expect(result.protectedOccurrences).toEqual([]);
  });

  it("protects code contents and fenced info strings by default", () => {
    const source = [
      "`TermA`",
      "",
      "```ts TermA",
      "TermA",
      "```",
      "",
      "    TermA",
    ].join("\n");

    const result = replaceMarkdown(source, rules, safe);

    expect(result.markdown).toBe(source);
    expect(result.changedOccurrences).toEqual([]);
    expect(result.protectedOccurrences).toHaveLength(4);
    expect(result.protectedOccurrences.every((item) => item.reason === "code")).toBe(true);
  });

  it("changes only code contents when code replacement is enabled", () => {
    const source = [
      "`TermA`",
      "",
      "```ts TermA",
      "TermA",
      "```",
      "",
      "    TermA",
    ].join("\n");

    const result = replaceMarkdown(source, rules, { ...safe, replaceInCode: true });

    expect(result.markdown).toBe(
      [
        "`TermB`",
        "",
        "```ts TermA",
        "TermB",
        "```",
        "",
        "    TermB",
      ].join("\n"),
    );
    expect(result.changedOccurrences).toHaveLength(3);
    expect(result.protectedOccurrences).toEqual([
      expect.objectContaining({ before: "TermA", reason: "code" }),
    ]);
  });

  it("changes explicit link labels while protecting destinations, images, definitions, and autolinks", () => {
    const source = [
      '[TermA](https://docs/TermA "TermA")',
      '![TermA](https://img/TermA.png "TermA")',
      "<https://docs/TermA> <TermA@example.com>",
      "[TermA][docs]",
      "",
      '[docs]: https://reference/TermA "TermA"',
    ].join("\n");

    const result = replaceMarkdown(source, rules, safe);

    expect(result.markdown).toBe(
      [
        '[TermB](https://docs/TermA "TermA")',
        '![TermA](https://img/TermA.png "TermA")',
        "<https://docs/TermA> <TermA@example.com>",
        "[TermB][docs]",
        "",
        '[docs]: https://reference/TermA "TermA"',
      ].join("\n"),
    );
    expect(result.changedOccurrences).toHaveLength(2);
    expect(result.protectedOccurrences).toHaveLength(9);
    expect(result.protectedOccurrences.every((item) => item.reason === "destination")).toBe(
      true,
    );
  });

  it("changes raw HTML text but preserves and reports matching attributes", () => {
    const source = '<span data-product="TermA">TermA</span>';

    const result = replaceMarkdown(source, rules, safe);

    expect(result.markdown).toBe('<span data-product="TermA">TermB</span>');
    expect(result.changedOccurrences).toEqual([
      { ruleId: "rule-1", start: 27, end: 32, before: "TermA", after: "TermB" },
    ]);
    expect(result.protectedOccurrences).toEqual([
      {
        ruleId: "rule-1",
        start: 20,
        end: 25,
        before: "TermA",
        reason: "raw-html-attribute",
      },
    ]);
  });

  it("changes exact literal text around entities without rewriting encoded text", () => {
    const source = [
      "TermA &amp; My&#80;VM",
      "",
      '<div data-product="TermA">TermA &amp; My&#80;VM</div>',
    ].join("\n");

    const result = replaceMarkdown(source, rules, safe);

    expect(result.markdown).toBe(
      [
        "TermB &amp; My&#80;VM",
        "",
        '<div data-product="TermA">TermB &amp; My&#80;VM</div>',
      ].join("\n"),
    );
    expect(result.changedOccurrences).toHaveLength(2);
    expect(result.protectedOccurrences).toEqual([
      expect.objectContaining({ before: "TermA", reason: "raw-html-attribute" }),
    ]);
  });

  it("uses decoded entity characters as whole-term neighbors on both sides", () => {
    const source = "TermA&#50; &#65;TermA TermA";

    const result = replaceMarkdown(source, rules, safe);

    expect(result.markdown).toBe("TermA&#50; &#65;TermA TermB");
    expect(result.changedOccurrences).toEqual([
      { ruleId: "rule-1", start: 22, end: 27, before: "TermA", after: "TermB" },
    ]);
  });

  it("reports raw HTML comment and tag-name matches as protected syntax", () => {
    expect(replaceMarkdown("<!-- TermA -->", rules, safe).protectedOccurrences).toEqual([
      {
        ruleId: "rule-1",
        start: 5,
        end: 10,
        before: "TermA",
        reason: "raw-html-syntax",
      },
    ]);
    expect(replaceMarkdown("<TermA>visible</TermA>", rules, safe).protectedOccurrences).toEqual([
      {
        ruleId: "rule-1",
        start: 1,
        end: 6,
        before: "TermA",
        reason: "raw-html-syntax",
      },
      {
        ruleId: "rule-1",
        start: 16,
        end: 21,
        before: "TermA",
        reason: "raw-html-syntax",
      },
    ]);
  });

  it("reports script and style text as protected hidden raw HTML", () => {
    expect(replaceMarkdown("<script>TermA</script>", rules, safe).protectedOccurrences).toEqual([
      {
        ruleId: "rule-1",
        start: 8,
        end: 13,
        before: "TermA",
        reason: "raw-html-hidden",
      },
    ]);
    expect(replaceMarkdown("<style>TermA</style>", rules, safe).protectedOccurrences).toEqual([
      {
        ruleId: "rule-1",
        start: 7,
        end: 12,
        before: "TermA",
        reason: "raw-html-hidden",
      },
    ]);
  });

  it("uses Unicode letters, numbers, and underscore as whole-term boundaries", () => {
    expect(replaceMarkdown("TermA TermA2 _TermA caféTermA TermA界", rules, safe).markdown).toBe(
      "TermB TermA2 _TermA caféTermA TermA界",
    );
  });

  it("supports case-insensitive matching while retaining the original occurrence text", () => {
    const result = replaceMarkdown("terma TERMA TerMa2", rules, {
      ...safe,
      caseSensitive: false,
    });

    expect(result.markdown).toBe("TermB TermB TerMa2");
    expect(result.changedOccurrences.map((item) => item.before)).toEqual(["terma", "TERMA"]);
  });

  it("applies every rule to the original source without cascading", () => {
    const result = replaceMarkdown(
      "TermA and PBM",
      [
        { id: "1", find: "TermA", replace: "PBM" },
        { id: "2", find: "PBM", replace: "Benefits" },
      ],
      safe,
    );

    expect(result.markdown).toBe("PBM and Benefits");
    expect(result.changedOccurrences.map((item) => item.ruleId)).toEqual(["1", "2"]);
  });
});
