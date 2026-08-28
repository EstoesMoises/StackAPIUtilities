import type { SmeCoverageDecisionPack } from "../utilities/smeCoverage/model";
import { buildSmeCoveragePdfModel } from "../utilities/smeCoverage/pdfModel";
import { downloadBlobFile } from "./downloads";
import { buildSmeCoverageFileSuffix } from "./smeCoverageDownloads";

export async function downloadSmeCoveragePdf(
  pack: SmeCoverageDecisionPack,
): Promise<void> {
  const [{ pdf }, { SmeCoveragePdfDocument }] = await Promise.all([
    import("@react-pdf/renderer"),
    import("../utilities/smeCoverage/SmeCoveragePdfDocument"),
  ]);
  const document = <SmeCoveragePdfDocument model={buildSmeCoveragePdfModel(pack)} />;
  const blob = await pdf(document).toBlob();

  downloadBlobFile(buildPdfFileName(pack), blob);
}

export function buildPdfFileName(pack: SmeCoverageDecisionPack): string {
  return `sme-coverage-decision-pack-${buildSmeCoverageFileSuffix(pack)}.pdf`;
}
