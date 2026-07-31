import type {
  SmeCoverageAnalysisResult,
  SmeCoverageEvidenceRow,
  SmeCoverageSourceStatus,
} from "./model";

export interface SmeCoverageNarrative {
  overview: string;
  assessment: string;
}

export function formatDisplayedRatio(value: number): string {
  return Math.round(value).toLocaleString("en-US");
}

export function buildSmeCoverageNarrative(analysis: SmeCoverageAnalysisResult): SmeCoverageNarrative {
  const questionSampleCapped = isCapped(analysis.sourceStatus.questions);
  const collectedSourceSample =
    isCapped(analysis.sourceStatus.tags) || isCapped(analysis.sourceStatus.tagSmeCounts);

  if (analysis.evidence.length === 0) {
    const sampleNotes: string[] = [];
    if (questionSampleCapped) sampleNotes.push("The question source is a partial sample.");
    if (collectedSourceSample) sampleNotes.push("The result covers a collected source sample.");
    const sampleNote = sampleNotes.length > 0 ? ` ${sampleNotes.join(" ")}` : "";
    return {
      overview: `No tags were available for SME coverage analysis.${sampleNote}`,
      assessment: `No evidence rows were available, so no coverage conclusion was produced.${sampleNote}`,
    };
  }

  const paragraphs = buildFindingParagraphs(analysis, questionSampleCapped);
  if (paragraphs.length === 0 && analysis.methodology.percentileSampleSufficient) {
    paragraphs.push("No priority coverage gaps were found in the analyzed evidence.");
  }
  const sampleNote = assessmentSampleNote(questionSampleCapped, collectedSourceSample);
  if (sampleNote) appendSentence(paragraphs, sampleNote);

  if (!analysis.methodology.percentileSampleSufficient) {
    appendSentence(
      paragraphs,
      `Relative covered-tag risk could not be classified because only ${analysis.methodology.coveredActiveSampleSize} eligible covered active ${tagLabel(analysis.methodology.coveredActiveSampleSize)} were available; review the raw ratios.`,
    );
  }

  return {
    overview: buildOverview(analysis, questionSampleCapped, collectedSourceSample),
    assessment: paragraphs.join("\n\n"),
  };
}

function buildFindingParagraphs(
  analysis: SmeCoverageAnalysisResult,
  questionSampleCapped: boolean,
): string[] {
  const paragraphs: string[] = [];
  const ratioLabel = questionSampleCapped ? "collected-sample page views per SME" : "page views per SME";
  const critical = analysis.findings.criticalUnderCoverage.slice(0, 10);
  const immediate = analysis.findings.immediateGaps.slice(0, 10);
  const light = analysis.findings.lightCoverage.slice(0, 10);

  if (critical.length > 0) {
    paragraphs.push(
      `Critical covered gaps: ${ratioRows(critical, ratioLabel)}. Coverage is thin relative to observed demand; expand and validate SME ownership.`,
    );
  }
  if (immediate.length > 0) {
    paragraphs.push(
      `Immediate no-SME gaps: ${tagRows(immediate)}. These active tags have no identifiable SME coverage; assign or confirm at least one SME.`,
    );
  }
  if (light.length > 0) {
    paragraphs.push(
      `Light coverage: ${ratioRows(light, ratioLabel)}. Review whether additional SMEs would improve resilience.`,
    );
  }

  return paragraphs;
}

function buildOverview(
  analysis: SmeCoverageAnalysisResult,
  questionSampleCapped: boolean,
  collectedSourceSample: boolean,
): string {
  const sampleNotes: string[] = [];
  if (questionSampleCapped) sampleNotes.push("This analysis uses a partial sample of collected questions.");
  if (collectedSourceSample) sampleNotes.push("This analysis covers a collected source sample.");
  const samplePrefix = sampleNotes.length > 0 ? `${sampleNotes.join(" ")} ` : "";
  const immediateCount = analysis.findings.immediateGaps.length;
  const criticalCount = analysis.findings.criticalUnderCoverage.length;
  const lightCount = analysis.findings.lightCoverage.length;

  let finding: string;
  if (immediateCount > 0) {
    finding = `${immediateCount} active ${tagLabel(immediateCount)} ${haveVerb(immediateCount)} immediate no-SME gaps.`;
  } else if (criticalCount > 0) {
    finding = `${criticalCount} covered ${tagLabel(criticalCount)} ${haveVerb(criticalCount)} critical under-coverage.`;
  } else if (lightCount > 0) {
    finding = `${lightCount} covered ${tagLabel(lightCount)} ${haveVerb(lightCount)} light SME coverage.`;
  } else if (analysis.methodology.percentileSampleSufficient) {
    finding = "No priority coverage gaps were found in the analyzed evidence.";
  } else {
    finding = "No priority covered-tag classification is available.";
  }

  const limitation = analysis.methodology.percentileSampleSufficient
    ? ""
    : ` Relative covered-tag risk was not classified because only ${analysis.methodology.coveredActiveSampleSize} eligible covered active ${tagLabel(analysis.methodology.coveredActiveSampleSize)} were available.`;
  return `${samplePrefix}${finding}${limitation}`;
}

function assessmentSampleNote(questionSampleCapped: boolean, collectedSourceSample: boolean): string {
  const notes: string[] = [];
  if (questionSampleCapped) {
    notes.push("Demand conclusions use collected-sample page views from a partial sample.");
  }
  if (collectedSourceSample) {
    notes.push(
      "These conclusions cover a collected source sample; page-view enumeration remains labeled by its evidence basis.",
    );
  }
  return notes.join(" ");
}

function appendSentence(paragraphs: string[], sentence: string): void {
  if (paragraphs.length === 0) {
    paragraphs.push(sentence);
    return;
  }
  paragraphs[paragraphs.length - 1] = `${paragraphs[paragraphs.length - 1]} ${sentence}`;
}

function ratioRows(rows: readonly SmeCoverageEvidenceRow[], ratioLabel: string): string {
  return rows
    .map((row) => {
      if (row.pageViewsPerSme === null) return `\`${row.tagName}\``;
      return `\`${row.tagName}\` (${formatDisplayedRatio(row.pageViewsPerSme)} ${ratioLabel})`;
    })
    .join(", ");
}

function tagRows(rows: readonly SmeCoverageEvidenceRow[]): string {
  return rows.map((row) => `\`${row.tagName}\``).join(", ");
}

function isCapped(source: SmeCoverageSourceStatus[keyof SmeCoverageSourceStatus]): boolean {
  return source.reachedMaxPages || source.hasMore;
}

function tagLabel(count: number): "tag" | "tags" {
  return count === 1 ? "tag" : "tags";
}

function haveVerb(count: number): "has" | "have" {
  return count === 1 ? "has" : "have";
}
