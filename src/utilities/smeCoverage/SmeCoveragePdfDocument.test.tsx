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
import { describe, expect, it } from "vitest";
import {
  completeSmeCoverageDecisionPack,
  emptySmeCoverageDecisionPack,
  partialSmeCoverageDecisionPack,
} from "../../test/fixtures/smeCoverageFixtures";
import type { SmeCoverageDecisionPack } from "./model";
import { buildSmeCoveragePdfModel, type SmeCoveragePdfModel } from "./pdfModel";
import { SmeCoveragePdfDocument } from "./SmeCoveragePdfDocument";

const pdfPrimitives = new Set<unknown>([Document, Page, Text, View]);

describe("SmeCoveragePdfDocument", () => {
  it("uses two A4 content pages without a standalone cover", () => {
    const model = buildSmeCoveragePdfModel(completeSmeCoverageDecisionPack());
    const { document, pages } = resolvedDocument(model);

    expect(document.element.props.title).toBe("SME Coverage Executive Brief");
    expect(document.element.props.author).toBe("Stack API Utilities");
    expect(pages).toHaveLength(2);
    expect(pages.map((page) => page.element.props.size)).toEqual(["A4", "A4"]);
    expect(pages.every((page) => styleOf(page).fontFamily === "Helvetica")).toBe(true);
    expect(pages.every((page) => styleOf(page).paddingLeft === 36)).toBe(true);
    expect(textOf(pages[0])).toContain("Decision summary");
    expect(textOf(pages[1])).toContain("Priority action register");
    expect(textOf(document)).not.toContain("Supporting evidence appendix");
  });

  it("places source-order warnings before metrics and conclusions", () => {
    const base = completeSmeCoverageDecisionPack();
    const pack: SmeCoverageDecisionPack = {
      ...base,
      warnings: [
        { code: "first", message: "First source warning." },
        { code: "second", message: "Second source warning." },
      ],
    };
    const text = textNodes(resolvedDocument(buildSmeCoveragePdfModel(pack)).pages[0]);

    expect(indexOfText(text, "First source warning.")).toBeLessThan(
      indexOfText(text, "Second source warning."),
    );
    expect(indexOfText(text, "Second source warning.")).toBeLessThan(
      indexOfText(text, "Summary metrics"),
    );
    expect(indexOfText(text, "Summary metrics")).toBeLessThan(
      indexOfText(text, "Bottom line"),
    );
  });

  it("uses a full warning border without a colored side stripe", () => {
    const model = buildSmeCoveragePdfModel(partialSmeCoverageDecisionPack());
    const warning = descendants(resolvedDocument(model).pages[0]).find(
      (node) => node.element.type === Text && textOf(node) === model.warnings[0],
    );

    expect(styleOf(warning)).toMatchObject({
      borderWidth: 1,
      borderColor: "#e6b800",
      backgroundColor: "#fff4d1",
    });
    expect(styleOf(warning).borderLeftWidth).toBeUndefined();
  });

  it("renders a bounded, non-splitting action register and the complete-CSV handoff", () => {
    const model = buildSmeCoveragePdfModel(completeSmeCoverageDecisionPack());
    const secondPage = resolvedDocument(model).pages[1];
    const registerRows = descendants(secondPage).filter(
      (node) =>
        node.element.type === View &&
        node.element.props.wrap === false &&
        model.priorityRows.some(
          (row) => textOf(node).includes(row.tagName) && textOf(node).includes(row.recommendedAction),
        ),
    );

    expect(textOf(secondPage)).toContain("Priority action register");
    expect(textOf(secondPage)).toContain(model.completeEvidenceNote);
    expect(textOf(secondPage)).toContain("Methodology");
    expect(registerRows).toHaveLength(model.priorityRows.length);
  });

  it("keeps an empty report explicit on both pages", () => {
    const model = buildSmeCoveragePdfModel(emptySmeCoverageDecisionPack());
    const { pages } = resolvedDocument(model);

    expect(textOf(pages[0])).toContain("No tags were available for SME coverage analysis.");
    expect(textOf(pages[1])).toContain("No priority actions are available for this report.");
    expect(textOf(pages[1])).toContain(model.completeEvidenceNote);
  });

  it("normalizes risky presentation Unicode to readable ASCII markers", () => {
    const base = buildSmeCoveragePdfModel(completeSmeCoverageDecisionPack());
    const model: SmeCoveragePdfModel = {
      ...base,
      assessmentBrief: {
        ...base.assessmentBrief,
        bottomLine: "Smart “quote” – status 🚦.",
      },
    };
    const content = textOf(resolvedDocument(model).pages[0]);

    expect(content).toContain('Smart "quote" - status [symbol].');
    expect(content).not.toContain("🚦");
    expect(content).not.toContain("□");
  });

  it("fixes report identity and visible page-number footers on every page", () => {
    const { pages } = resolvedDocument(buildSmeCoveragePdfModel(completeSmeCoverageDecisionPack()));

    for (const page of pages) {
      const fixedBrand = descendants(page).find(
        (node) =>
          node.element.type === View &&
          node.element.props.fixed === true &&
          textOf(node).includes("STACK API UTILITIES"),
      );
      const pageNumber = descendants(page).find(
        (node) =>
          node.element.type === Text &&
          node.element.props.fixed === true &&
          typeof node.element.props.render === "function",
      );
      const render = pageNumber?.element.props.render as
        | ((input: { pageNumber: number; totalPages: number }) => ReactNode)
        | undefined;

      expect(fixedBrand).toBeDefined();
      expect(styleOf(pageNumber)).toMatchObject({ top: 813, left: 36, right: 36 });
      expect(styleOf(pageNumber).bottom).toBeUndefined();
      expect(render?.({ pageNumber: 2, totalPages: 3 })).toBe("Page 2 of 3");
    }
  });

  it.each([
    ["complete", completeSmeCoverageDecisionPack()],
    ["partial", partialSmeCoverageDecisionPack()],
  ])("renders a valid two-page %s executive brief", async (_state, pack) => {
    const buffer = await renderModel(buildSmeCoveragePdfModel(pack));

    expect(buffer.subarray(0, 5).toString()).toBe("%PDF-");
    expect(buffer.byteLength).toBeGreaterThan(4_000);
    expect(buffer.toString("latin1")).toContain("/MediaBox [0 0 595.280029 841.890015]");
    expect(renderedPageCount(buffer)).toBe(2);
  });

  it("keeps an unusually large assessment to no more than three rendered pages", async () => {
    const source = completeSmeCoverageDecisionPack();
    const seed = source.findings.immediateGaps[0];
    const immediateGaps = Array.from({ length: 20 }, (_, index) => ({
      ...seed,
      tagName: `high-demand-gap-${index + 1}`,
      recommendedAction:
        "Assign a primary SME, confirm backup ownership, and document the escalation route for this high-demand tag.",
    }));
    const pack: SmeCoverageDecisionPack = {
      ...source,
      findings: { ...source.findings, immediateGaps },
    };
    const model = buildSmeCoveragePdfModel(pack);
    const buffer = await renderModel(model);

    expect(model.priorityRows).toHaveLength(12);
    expect(model.omittedPriorityCount).toBe(10);
    expect(renderedPageCount(buffer)).toBeLessThanOrEqual(3);
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

function indexOfText(textNodesInOrder: readonly string[], expected: string): number {
  const index = textNodesInOrder.findIndex((text) => text.includes(expected));
  expect(index, `Expected resolved text to include: ${expected}`).toBeGreaterThanOrEqual(0);
  return index;
}

async function renderModel(model: SmeCoveragePdfModel): Promise<Buffer> {
  return renderToBuffer(
    createElement(SmeCoveragePdfDocument, { model }) as unknown as Parameters<
      typeof renderToBuffer
    >[0],
  );
}

function renderedPageCount(buffer: Buffer): number {
  const match = buffer.toString("latin1").match(/\/Type \/Pages\s*\/Count (\d+)/);
  if (!match) throw new Error("Unable to read rendered PDF page count.");
  return Number(match[1]);
}
