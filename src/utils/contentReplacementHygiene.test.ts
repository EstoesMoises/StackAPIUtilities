import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const APPROVED_REQUIREMENT_RECORD = "docs/superpowers/specs/2026-09-01-content-replacement-wizard-design.md";
const RELEVANT_EXTENSIONS = new Set([
  ".cjs", ".css", ".js", ".jsx", ".json", ".md", ".mdx", ".mjs", ".scss", ".ts", ".tsx", ".yaml", ".yml",
]);

describe("content replacement repository hygiene", () => {
  it("keeps protected customer terms out of tracked implementation artifacts", () => {
    const protectedTerms = [
      ["My", "P", "V", "M"].join(""),
      ["My", "P", "B", "M"].join(""),
    ];
    const trackedFiles = execFileSync(
      "git",
      ["ls-files", "-z", "--", "README.md", "src", "e2e", "docs"],
      { cwd: process.cwd() },
    ).toString("utf8").split("\0").filter(Boolean);
    const violations = trackedFiles.filter((relativePath) => {
      if (relativePath === APPROVED_REQUIREMENT_RECORD || shouldExclude(relativePath)) return false;
      if (relativePath !== "README.md" && !RELEVANT_EXTENSIONS.has(path.extname(relativePath))) return false;
      const contents = readFileSync(path.join(process.cwd(), relativePath), "utf8").toLocaleLowerCase("en-US");
      return protectedTerms.some((term) => contents.includes(term.toLocaleLowerCase("en-US")));
    });

    expect(violations).toEqual([]);
  });
});

function shouldExclude(relativePath: string): boolean {
  const segments = relativePath.split("/");
  return segments.some((segment) => [
    ".git", ".next", ".superpowers", "attachments", "build", "coverage", "dist", "node_modules",
  ].includes(segment));
}
