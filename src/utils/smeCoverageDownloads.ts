import type { SmeCoverageDecisionPack } from "../utilities/smeCoverage/model";
import { buildSmeCoverageEvidenceCsv, buildSmeCoverageMarkdown } from "../utilities/smeCoverage/exports";
import { downloadTextFile } from "./downloads";

interface SmeCoverageDownload {
  fileName: string;
  contents: string;
  mimeType: string;
}

export function buildSmeCoverageMarkdownDownload(
  pack: SmeCoverageDecisionPack,
): SmeCoverageDownload {
  return {
    fileName: `sme-coverage-decision-pack-${buildFileSuffix(pack)}.md`,
    contents: buildSmeCoverageMarkdown(pack),
    mimeType: "text/markdown;charset=utf-8",
  };
}

export function buildSmeCoverageCsvDownload(pack: SmeCoverageDecisionPack): SmeCoverageDownload {
  return {
    fileName: `sme-coverage-evidence-${buildFileSuffix(pack)}.csv`,
    contents: buildSmeCoverageEvidenceCsv(pack),
    mimeType: "text/csv;charset=utf-8",
  };
}

export function downloadSmeCoverageMarkdown(pack: SmeCoverageDecisionPack): void {
  const download = buildSmeCoverageMarkdownDownload(pack);
  downloadTextFile(download.fileName, download.contents, download.mimeType);
}

export function downloadSmeCoverageEvidenceCsv(pack: SmeCoverageDecisionPack): void {
  const download = buildSmeCoverageCsvDownload(pack);
  downloadTextFile(download.fileName, download.contents, download.mimeType);
}

function buildFileSuffix(pack: SmeCoverageDecisionPack): string {
  return `${sanitizeFileNamePart(pack.snapshot.instanceHost)}-${pack.snapshot.generatedAt.slice(0, 10)}`;
}

function sanitizeFileNamePart(value: string): string {
  return value.trim().replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-|-$/g, "") || "report";
}
