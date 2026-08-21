// @vitest-environment node

import { Document, Page, Text, View, renderToBuffer } from "@react-pdf/renderer";
import {
  Children,
  Fragment,
  createElement,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from "react";
import { inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import {
  completeSmeCoverageDecisionPack,
  emptySmeCoverageDecisionPack,
  partialSmeCoverageDecisionPack,
} from "../../test/fixtures/smeCoverageFixtures";
import type { SmeCoverageEvidenceRow } from "./model";
import { buildSmeCoveragePdfModel, type SmeCoveragePdfModel } from "./pdfModel";
import { SmeCoveragePdfDocument } from "./SmeCoveragePdfDocument";

const pdfPrimitives = new Set<unknown>([Document, Page, Text, View]);

describe("SmeCoveragePdfDocument", () => {
  it("renders complete report identity and metadata on a Helvetica A4 cover", () => {
    const model = buildSmeCoveragePdfModel(partialSmeCoverageDecisionPack());
    const { document, pages } = resolvedDocument(model);
    const cover = pages[0];

    expect(document.element.props.title).toBe("SME Coverage Decision Pack");
    expect(document.element.props.author).toBe("Stack API Utilities");
    expect(pages).toHaveLength(2);
    expect(pages.map((page) => page.element.props.size)).toEqual(["A4", "A4"]);
    expect(styleOf(cover)).toMatchObject({ padding: 36, fontFamily: "Helvetica" });
    expect(textOf(cover)).toContain("STACK API UTILITIES");
    expect(textOf(cover)).toContain(model.title);
    expect(textOf(cover)).toContain(model.snapshot.instanceHost);
    expect(textOf(cover)).toContain(model.snapshot.generatedAt);
    expect(textOf(cover)).toContain(model.snapshot.scopeLabel);
    expect(textOf(cover)).toContain(model.snapshot.collectionLabel);
    expect(textOf(cover)).toContain(`Analysis quality ${model.snapshot.completeness}`);
  });

  it("uses Helvetica and at least 36-point safe margins on wrapped content pages", () => {
    const { pages } = resolvedDocument(buildSmeCoveragePdfModel(completeSmeCoverageDecisionPack()));
    const contentStyle = styleOf(pages[1]);

    expect(contentStyle).toMatchObject({
      fontFamily: "Helvetica",
      paddingLeft: 36,
      paddingRight: 36,
    });
    expect(contentStyle.paddingTop).toBeGreaterThanOrEqual(36);
    expect(contentStyle.paddingBottom).toBeGreaterThanOrEqual(36);
    expect(pages[1].element.props.wrap).toBe(true);
  });

  it("places source-order warnings before metrics and all conclusions", () => {
    const base = buildSmeCoveragePdfModel(partialSmeCoverageDecisionPack());
    const model: SmeCoveragePdfModel = {
      ...base,
      warnings: ["First source warning.", "Second source warning."],
    };
    const contentText = textNodes(resolvedDocument(model).pages[1]);

    expect(indexOfText(contentText, "First source warning.")).toBeLessThan(
      indexOfText(contentText, "Second source warning."),
    );
    expect(indexOfText(contentText, "Second source warning.")).toBeLessThan(
      indexOfText(contentText, "Summary metrics"),
    );
    expect(indexOfText(contentText, "Summary metrics")).toBeLessThan(
      indexOfText(contentText, "Executive summary"),
    );
    expect(indexOfText(contentText, "Executive summary")).toBeLessThan(
      indexOfText(contentText, "Assessment"),
    );
  });

  it("renders required report sections and the complete-CSV note in order", () => {
    const contentText = textNodes(
      resolvedDocument(buildSmeCoveragePdfModel(completeSmeCoverageDecisionPack())).pages[1],
    );
    const requiredText = [
      "Evidence notes",
      "Summary metrics",
      "Executive summary",
      "Assessment",
      "Priority findings",
      "Methodology",
      "Supporting evidence appendix",
      "The accompanying evidence CSV contains the complete canonical dataset in decision-pack order.",
    ];

    expect(requiredText.map((text) => indexOfText(contentText, text))).toEqual(
      [...requiredText]
        .map((text) => indexOfText(contentText, text))
        .sort((left, right) => left - right),
    );
  });

  it("uses nearest-whole display rounding for rendered P75 and P90 ratios", async () => {
    const model = buildSmeCoveragePdfModel(completeSmeCoverageDecisionPack());
    const content = textOf(resolvedDocument(model).pages[1]);
    const buffer = await renderToBuffer(
      createElement(SmeCoveragePdfDocument, { model }) as unknown as Parameters<
        typeof renderToBuffer
      >[0],
    );
    const renderedText = extractRenderedPdfText(buffer);
    const compactRenderedText = renderedText.replace(/\s+/g, "");

    expect(content).toContain("P75 page views per SME 1,250");
    expect(content).toContain("P90 page views per SME 3,000");
    expect(content).not.toContain("P75 page views per SME 1,250.4");
    expect(content).not.toContain("P90 page views per SME 3,000.49");
    expect(compactRenderedText).toContain("P75pageviewsperSME1,250");
    expect(compactRenderedText).toContain("P90pageviewsperSME3,000");
    expect(compactRenderedText).not.toContain("P75pageviewsperSME1,250.4");
    expect(compactRenderedText).not.toContain("P90pageviewsperSME3,000.49");
  });

  it("renders explicit finding and appendix copy for an empty model", () => {
    const content = resolvedDocument(
      buildSmeCoveragePdfModel(emptySmeCoverageDecisionPack()),
    ).pages[1];

    expect(textOf(content)).toContain("No priority findings are in this decision pack.");
    expect(textOf(content)).toContain(
      "No finding rows are available for this bounded appendix.",
    );
  });

  it("keeps the empty appendix heading with its note and explicit empty copy", async () => {
    const model = buildSmeCoveragePdfModel(emptySmeCoverageDecisionPack());
    const buffer = await renderToBuffer(
      createElement(SmeCoveragePdfDocument, { model }) as unknown as Parameters<
        typeof renderToBuffer
      >[0],
    );
    const renderedPages = extractRenderedPdfTextPages(buffer).map((page) =>
      page.replace(/\s+/g, ""),
    );
    const appendixPage = renderedPages.find((page) =>
      page.includes("Supportingevidenceappendix"),
    );

    expect(appendixPage).toContain(
      "NoaccompanyingevidenceCSVisavailablebecausethisreportcontainsnocanonicalevidencerows.",
    );
    expect(appendixPage).not.toContain("completecanonicaldataset");
    expect(appendixPage).toContain(
      "Nofindingrowsareavailableforthisboundedappendix.",
    );
  });

  it("repeats bounded appendix headers and prevents finding cards and rows from splitting", () => {
    const base = buildSmeCoveragePdfModel(completeSmeCoverageDecisionPack());
    const sourceRow = completeSmeCoverageDecisionPack().evidence[0];
    const rows = Array.from({ length: 7 }, (_, index): SmeCoverageEvidenceRow => ({
      ...sourceRow,
      tagName: `appendix-row-${index + 1}`,
    }));
    const model: SmeCoveragePdfModel = {
      ...base,
      findingGroups: [{ tier: "Immediate gap", rows }],
      appendixRows: rows,
    };
    const content = resolvedDocument(model).pages[1];
    const views = descendants(content).filter((node) => node.element.type === View);
    const headerGroups = views.filter(
      (node) =>
        node.element.props.wrap === false &&
        textOf(node).includes("Tag Page views Questions SMEs Views / SME Tier Recommended action"),
    );
    const appendixRows = views.filter(
      (node) =>
        directPrimitiveChildren(node, Text).length === 7 &&
        /appendix-row-\d/.test(textOf(node)),
    );
    const findingCards = views.filter(
      (node) =>
        node.element.props.wrap === false &&
        textOf(node).includes("WHY IT MATTERS") &&
        textOf(node).includes("RECOMMENDED ACTION"),
    );

    expect(headerGroups).toHaveLength(2);
    expect(appendixRows).toHaveLength(7);
    expect(appendixRows.every((row) => row.element.props.wrap === false)).toBe(true);
    expect(findingCards.length).toBeGreaterThanOrEqual(7);
  });

  it("fixes brand and visible page-number footers on cover and content pages", () => {
    const { pages } = resolvedDocument(buildSmeCoveragePdfModel(completeSmeCoverageDecisionPack()));

    for (const page of pages) {
      const fixedBrand = descendants(page).find(
        (node) =>
          node.element.type === Text &&
          node.element.props.fixed === true &&
          textOf(node) === "Stack API Utilities",
      );
      const pageNumber = descendants(page).find(
        (node) =>
          node.element.type === Text &&
          node.element.props.fixed === true &&
          typeof node.element.props.render === "function",
      );
      const pageNumberStyle = styleOf(pageNumber);
      const render = pageNumber?.element.props.render as
        | ((input: { pageNumber: number }) => ReactNode)
        | undefined;

      expect(fixedBrand).toBeDefined();
      expect(pageNumberStyle).toMatchObject({ top: 813, left: 36, right: 36 });
      expect(render?.({ pageNumber: 7 })).toBe("Page 7");
    }

    const fixedContentBrand = descendants(pages[1]).find(
      (node) =>
        node.element.type === View &&
        node.element.props.fixed === true &&
        textOf(node).includes("STACK API UTILITIES"),
    );
    expect(fixedContentBrand).toBeDefined();
  });

  it("normalizes risky presentation Unicode to readable ASCII markers", () => {
    const base = buildSmeCoveragePdfModel(completeSmeCoverageDecisionPack());
    const model: SmeCoveragePdfModel = {
      ...base,
      overview: "Smart “quote” – status 🚦.",
    };
    const content = textOf(resolvedDocument(model).pages[1]);

    expect(content).toContain('Smart "quote" - status [symbol].');
    expect(content).not.toContain("🚦");
    expect(content).not.toContain("□");
    expect(content).not.toContain("?");
  });

  it("renders a nonempty, multi-page A4 PDF in a Node environment", async () => {
    const model = buildSmeCoveragePdfModel(partialSmeCoverageDecisionPack());
    const element = createElement(SmeCoveragePdfDocument, { model });
    const buffer = await renderToBuffer(
      element as unknown as Parameters<typeof renderToBuffer>[0],
    );
    const pdfSource = buffer.toString("latin1");
    const pageCount = Number(pdfSource.match(/\/Type \/Pages\s*\/Count (\d+)/)?.[1]);

    expect(buffer.subarray(0, 5).toString()).toBe("%PDF-");
    expect(buffer.byteLength).toBeGreaterThan(5_000);
    expect(pdfSource).toContain("/MediaBox [0 0 595.280029 841.890015]");
    expect(pageCount).toBeGreaterThanOrEqual(2);
  });
});

interface ResolvedNode {
  element: ReactElement<Record<string, unknown>>;
  children: readonly (ResolvedNode | string)[];
}

function resolvedDocument(model: SmeCoveragePdfModel): {
  document: ResolvedNode;
  pages: readonly ResolvedNode[];
} {
  const roots = resolveNode(SmeCoveragePdfDocument({ model }));
  const document = roots[0];
  if (!document || typeof document === "string" || document.element.type !== Document) {
    throw new Error("Expected a resolved React-PDF Document root.");
  }
  const pages = document.children.filter(
    (child): child is ResolvedNode => typeof child !== "string" && child.element.type === Page,
  );
  return { document, pages };
}

function resolveNode(node: ReactNode): readonly (ResolvedNode | string)[] {
  return Children.toArray(node).flatMap((child): readonly (ResolvedNode | string)[] => {
    if (typeof child === "string" || typeof child === "number") return [String(child)];
    if (!isValidElement<Record<string, unknown>>(child)) return [];

    if (child.type === Fragment) return resolveNode(child.props.children as ReactNode);
    if (typeof child.type === "function" && !pdfPrimitives.has(child.type)) {
      const component = child.type as (props: Record<string, unknown>) => ReactNode;
      return resolveNode(component(child.props));
    }

    return [{
      element: child,
      children: resolveNode(child.props.children as ReactNode),
    }];
  });
}

function descendants(root: ResolvedNode): readonly ResolvedNode[] {
  return [
    root,
    ...root.children.flatMap((child) =>
      typeof child === "string" ? [] : descendants(child),
    ),
  ];
}

function textNodes(root: ResolvedNode): readonly string[] {
  return descendants(root)
    .filter((node) => node.element.type === Text)
    .map(textOf)
    .filter(Boolean);
}

function textOf(node: ResolvedNode): string {
  return node.children
    .map((child) => (typeof child === "string" ? child : textOf(child)))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function styleOf(node: ResolvedNode | undefined): Record<string, unknown> {
  const style = node?.element.props.style;
  const styles = Array.isArray(style) ? style : [style];
  return Object.assign(
    {},
    ...styles.filter((item): item is Record<string, unknown> =>
      typeof item === "object" && item !== null,
    ),
  );
}

function directPrimitiveChildren(
  node: ResolvedNode,
  primitive: unknown,
): readonly ResolvedNode[] {
  return node.children.filter(
    (child): child is ResolvedNode =>
      typeof child !== "string" && child.element.type === primitive,
  );
}

function indexOfText(textNodesInOrder: readonly string[], expected: string): number {
  const index = textNodesInOrder.findIndex((text) => text.includes(expected));
  expect(index, `Expected resolved text to include: ${expected}`).toBeGreaterThanOrEqual(0);
  return index;
}

function extractRenderedPdfText(buffer: Buffer): string {
  return extractRenderedPdfTextPages(buffer).join(" ");
}

function extractRenderedPdfTextPages(buffer: Buffer): readonly string[] {
  const source = buffer.toString("latin1");
  const decodedStreams = [...source.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)].map(
    ([, compressed]) => inflateSync(Buffer.from(compressed, "latin1")).toString("latin1"),
  );

  return decodedStreams.map((stream) =>
    [...stream.matchAll(/\(((?:\\.|[^\\)])*)\)|<([0-9a-f]+)>/gi)]
      .map(([, literal, hexadecimal]) =>
        literal
          ? literal.replace(/\\([()\\])/g, "$1")
          : Buffer.from(hexadecimal, "hex").toString("latin1"),
      )
      .join(" ")
      .replace(/\s+/g, " ")
      .trim(),
  );
}
