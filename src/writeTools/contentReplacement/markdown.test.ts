import { describe, expect, it } from "vitest";
import { replaceMarkdown } from "./markdown";

const rules = [{ id: "rule-1", find: "MyPVM", replace: "MyPBM" }];
const safe = { caseSensitive: true, wholeTerm: true, replaceInCode: false };

describe("replaceMarkdown", () => {
  it("changes visible Markdown text without regenerating its structure", () => {
    const source = [
      "# MyPVM guide",
      "",
      "Use **MyPVM**.",
      "",
      "- MyPVM list item",
      "",
      "> MyPVM quote",
      "",
      "Read [MyPVM](https://example.test).",
      "",
      "| Product |",
      "| --- |",
      "| MyPVM |",
    ].join("\n");

    const result = replaceMarkdown(source, rules, safe);

    expect(result.markdown).toBe(
      [
        "# MyPBM guide",
        "",
        "Use **MyPBM**.",
        "",
        "- MyPBM list item",
        "",
        "> MyPBM quote",
        "",
        "Read [MyPBM](https://example.test).",
        "",
        "| Product |",
        "| --- |",
        "| MyPBM |",
      ].join("\n"),
    );
    expect(result.changedOccurrences).toHaveLength(6);
    expect(result.protectedOccurrences).toEqual([]);
  });

  it("protects code contents and fenced info strings by default", () => {
    const source = [
      "`MyPVM`",
      "",
      "```ts MyPVM",
      "MyPVM",
      "```",
      "",
      "    MyPVM",
    ].join("\n");

    const result = replaceMarkdown(source, rules, safe);

    expect(result.markdown).toBe(source);
    expect(result.changedOccurrences).toEqual([]);
    expect(result.protectedOccurrences).toHaveLength(4);
    expect(result.protectedOccurrences.every((item) => item.reason === "code")).toBe(true);
  });

  it("changes only code contents when code replacement is enabled", () => {
    const source = [
      "`MyPVM`",
      "",
      "```ts MyPVM",
      "MyPVM",
      "```",
      "",
      "    MyPVM",
    ].join("\n");

    const result = replaceMarkdown(source, rules, { ...safe, replaceInCode: true });

    expect(result.markdown).toBe(
      [
        "`MyPBM`",
        "",
        "```ts MyPVM",
        "MyPBM",
        "```",
        "",
        "    MyPBM",
      ].join("\n"),
    );
    expect(result.changedOccurrences).toHaveLength(3);
    expect(result.protectedOccurrences).toEqual([
      expect.objectContaining({ before: "MyPVM", reason: "code" }),
    ]);
  });

  it("changes explicit link labels while protecting destinations, images, definitions, and autolinks", () => {
    const source = [
      '[MyPVM](https://docs/MyPVM "MyPVM")',
      '![MyPVM](https://img/MyPVM.png "MyPVM")',
      "<https://docs/MyPVM> <MyPVM@example.com>",
      "[MyPVM][docs]",
      "",
      '[docs]: https://reference/MyPVM "MyPVM"',
    ].join("\n");

    const result = replaceMarkdown(source, rules, safe);

    expect(result.markdown).toBe(
      [
        '[MyPBM](https://docs/MyPVM "MyPVM")',
        '![MyPVM](https://img/MyPVM.png "MyPVM")',
        "<https://docs/MyPVM> <MyPVM@example.com>",
        "[MyPBM][docs]",
        "",
        '[docs]: https://reference/MyPVM "MyPVM"',
      ].join("\n"),
    );
    expect(result.changedOccurrences).toHaveLength(2);
    expect(result.protectedOccurrences).toHaveLength(9);
    expect(result.protectedOccurrences.every((item) => item.reason === "destination")).toBe(
      true,
    );
  });

  it("changes raw HTML text but preserves and reports matching attributes", () => {
    const source = '<span data-product="MyPVM">MyPVM</span>';

    const result = replaceMarkdown(source, rules, safe);

    expect(result.markdown).toBe('<span data-product="MyPVM">MyPBM</span>');
    expect(result.changedOccurrences).toEqual([
      { ruleId: "rule-1", start: 27, end: 32, before: "MyPVM", after: "MyPBM" },
    ]);
    expect(result.protectedOccurrences).toEqual([
      {
        ruleId: "rule-1",
        start: 20,
        end: 25,
        before: "MyPVM",
        reason: "raw-html-attribute",
      },
    ]);
  });

  it("changes exact literal text around entities without rewriting encoded text", () => {
    const source = [
      "MyPVM &amp; My&#80;VM",
      "",
      '<div data-product="MyPVM">MyPVM &amp; My&#80;VM</div>',
    ].join("\n");

    const result = replaceMarkdown(source, rules, safe);

    expect(result.markdown).toBe(
      [
        "MyPBM &amp; My&#80;VM",
        "",
        '<div data-product="MyPVM">MyPBM &amp; My&#80;VM</div>',
      ].join("\n"),
    );
    expect(result.changedOccurrences).toHaveLength(2);
    expect(result.protectedOccurrences).toEqual([
      expect.objectContaining({ before: "MyPVM", reason: "raw-html-attribute" }),
    ]);
  });

  it("uses decoded entity characters as whole-term neighbors on both sides", () => {
    const source = "MyPVM&#50; &#65;MyPVM MyPVM";

    const result = replaceMarkdown(source, rules, safe);

    expect(result.markdown).toBe("MyPVM&#50; &#65;MyPVM MyPBM");
    expect(result.changedOccurrences).toEqual([
      { ruleId: "rule-1", start: 22, end: 27, before: "MyPVM", after: "MyPBM" },
    ]);
  });

  it("reports raw HTML comment and tag-name matches as protected syntax", () => {
    expect(replaceMarkdown("<!-- MyPVM -->", rules, safe).protectedOccurrences).toEqual([
      {
        ruleId: "rule-1",
        start: 5,
        end: 10,
        before: "MyPVM",
        reason: "raw-html-syntax",
      },
    ]);
    expect(replaceMarkdown("<MyPVM>visible</MyPVM>", rules, safe).protectedOccurrences).toEqual([
      {
        ruleId: "rule-1",
        start: 1,
        end: 6,
        before: "MyPVM",
        reason: "raw-html-syntax",
      },
      {
        ruleId: "rule-1",
        start: 16,
        end: 21,
        before: "MyPVM",
        reason: "raw-html-syntax",
      },
    ]);
  });

  it("reports script and style text as protected hidden raw HTML", () => {
    expect(replaceMarkdown("<script>MyPVM</script>", rules, safe).protectedOccurrences).toEqual([
      {
        ruleId: "rule-1",
        start: 8,
        end: 13,
        before: "MyPVM",
        reason: "raw-html-hidden",
      },
    ]);
    expect(replaceMarkdown("<style>MyPVM</style>", rules, safe).protectedOccurrences).toEqual([
      {
        ruleId: "rule-1",
        start: 7,
        end: 12,
        before: "MyPVM",
        reason: "raw-html-hidden",
      },
    ]);
  });

  it("uses Unicode letters, numbers, and underscore as whole-term boundaries", () => {
    expect(replaceMarkdown("MyPVM MyPVM2 _MyPVM caféMyPVM MyPVM界", rules, safe).markdown).toBe(
      "MyPBM MyPVM2 _MyPVM caféMyPVM MyPVM界",
    );
  });

  it("supports case-insensitive matching while retaining the original occurrence text", () => {
    const result = replaceMarkdown("mypvm MYPVM MyPvM2", rules, {
      ...safe,
      caseSensitive: false,
    });

    expect(result.markdown).toBe("MyPBM MyPBM MyPvM2");
    expect(result.changedOccurrences.map((item) => item.before)).toEqual(["mypvm", "MYPVM"]);
  });

  it("applies every rule to the original source without cascading", () => {
    const result = replaceMarkdown(
      "MyPVM and PBM",
      [
        { id: "1", find: "MyPVM", replace: "PBM" },
        { id: "2", find: "PBM", replace: "Benefits" },
      ],
      safe,
    );

    expect(result.markdown).toBe("PBM and Benefits");
    expect(result.changedOccurrences.map((item) => item.ruleId)).toEqual(["1", "2"]);
  });
});
