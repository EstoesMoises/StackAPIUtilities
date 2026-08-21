import {
  Document,
  Page,
  StyleSheet,
  Text,
  View,
} from "@react-pdf/renderer";
import type { ReactNode } from "react";
import type { SmeCoverageEvidenceRow } from "./model";
import { formatDisplayedRatio } from "./narrative";
import type {
  SmeCoveragePdfFindingGroup,
  SmeCoveragePdfModel,
} from "./pdfModel";

interface SmeCoveragePdfDocumentProps {
  model: SmeCoveragePdfModel;
}

const colors = {
  orange: "#c94f12",
  ink: "#232629",
  text: "#3b4045",
  muted: "#6a737c",
  border: "#d6d9dc",
  soft: "#f5f6f6",
  warning: "#fff4d1",
  warningBorder: "#e6b800",
  white: "#ffffff",
};

const styles = StyleSheet.create({
  page: {
    paddingTop: 54,
    paddingRight: 36,
    paddingBottom: 42,
    paddingLeft: 36,
    fontFamily: "Helvetica",
    fontSize: 9,
    lineHeight: 1.42,
    color: colors.text,
    backgroundColor: colors.white,
  },
  cover: {
    padding: 36,
    fontFamily: "Helvetica",
    fontSize: 10,
    lineHeight: 1.4,
    color: colors.text,
    backgroundColor: colors.white,
  },
  coverRule: {
    height: 4,
    marginBottom: 46,
    backgroundColor: colors.orange,
  },
  eyebrow: {
    marginBottom: 10,
    fontSize: 8,
    letterSpacing: 1.4,
    color: colors.muted,
  },
  title: {
    maxWidth: 430,
    marginBottom: 14,
    fontSize: 29,
    lineHeight: 1.08,
    fontFamily: "Helvetica-Bold",
    color: colors.ink,
  },
  deck: {
    maxWidth: 390,
    marginBottom: 42,
    fontSize: 12,
    lineHeight: 1.5,
    color: colors.muted,
  },
  coverMeta: {
    width: "100%",
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  coverMetaRow: {
    flexDirection: "row",
    paddingVertical: 9,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  coverMetaLabel: {
    width: 112,
    paddingRight: 12,
    fontSize: 8,
    color: colors.muted,
  },
  coverMetaValue: {
    flexGrow: 1,
    flexBasis: 0,
    fontFamily: "Helvetica-Bold",
    color: colors.ink,
  },
  pageBrand: {
    position: "absolute",
    top: 22,
    left: 36,
    right: 36,
    flexDirection: "row",
    justifyContent: "space-between",
    paddingBottom: 7,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    fontSize: 7,
    color: colors.muted,
  },
  pageBrandName: {
    letterSpacing: 0.8,
  },
  heading: {
    marginTop: 16,
    marginBottom: 7,
    paddingBottom: 4,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    fontSize: 14,
    lineHeight: 1.2,
    fontFamily: "Helvetica-Bold",
    color: colors.ink,
  },
  firstHeading: {
    marginTop: 0,
  },
  subheading: {
    marginTop: 11,
    marginBottom: 5,
    fontSize: 11,
    lineHeight: 1.25,
    fontFamily: "Helvetica-Bold",
    color: colors.ink,
  },
  paragraph: {
    marginBottom: 7,
  },
  emptyCopy: {
    marginBottom: 7,
    color: colors.muted,
    fontFamily: "Helvetica-Oblique",
  },
  warning: {
    marginBottom: 6,
    paddingVertical: 7,
    paddingHorizontal: 9,
    borderLeftWidth: 3,
    borderLeftColor: colors.warningBorder,
    backgroundColor: colors.warning,
  },
  metricGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    marginBottom: 3,
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderColor: colors.border,
  },
  metric: {
    width: "33.333%",
    minHeight: 48,
    paddingVertical: 8,
    paddingHorizontal: 9,
    borderRightWidth: 1,
    borderBottomWidth: 1,
    borderColor: colors.border,
  },
  metricLabel: {
    marginBottom: 3,
    fontSize: 7,
    color: colors.muted,
  },
  metricValue: {
    fontSize: 15,
    lineHeight: 1.1,
    fontFamily: "Helvetica-Bold",
    color: colors.ink,
  },
  findingCard: {
    marginBottom: 7,
    padding: 8,
    borderWidth: 1,
    borderColor: colors.border,
  },
  findingTopLine: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 4,
  },
  findingTag: {
    width: "58%",
    paddingRight: 8,
    fontFamily: "Helvetica-Bold",
    color: colors.ink,
  },
  findingNumbers: {
    width: "42%",
    textAlign: "right",
    color: colors.muted,
  },
  findingLabel: {
    marginTop: 3,
    fontSize: 7,
    fontFamily: "Helvetica-Bold",
    color: colors.muted,
  },
  methodGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderColor: colors.border,
  },
  methodItem: {
    width: "50%",
    padding: 7,
    borderRightWidth: 1,
    borderBottomWidth: 1,
    borderColor: colors.border,
  },
  methodLabel: {
    marginBottom: 2,
    fontSize: 7,
    color: colors.muted,
  },
  methodValue: {
    color: colors.ink,
  },
  table: {
    width: "100%",
    marginTop: 3,
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderColor: colors.border,
  },
  tableHeader: {
    flexDirection: "row",
    backgroundColor: colors.soft,
  },
  tableRow: {
    flexDirection: "row",
  },
  tableHeaderText: {
    fontSize: 6.5,
    fontFamily: "Helvetica-Bold",
    color: colors.ink,
  },
  tableCell: {
    paddingVertical: 5,
    paddingHorizontal: 4,
    borderRightWidth: 1,
    borderBottomWidth: 1,
    borderColor: colors.border,
    fontSize: 7,
    lineHeight: 1.3,
  },
  appendixTag: { width: "16%" },
  appendixPageViews: { width: "11%", textAlign: "right" },
  appendixQuestions: { width: "9%", textAlign: "right" },
  appendixSmes: { width: "8%", textAlign: "right" },
  appendixRatio: { width: "12%", textAlign: "right" },
  appendixTier: { width: "18%" },
  appendixAction: { width: "26%" },
  footerLeft: {
    position: "absolute",
    bottom: 18,
    left: 36,
    fontSize: 7,
    color: colors.muted,
  },
  footerRight: {
    position: "absolute",
    top: 813,
    left: 36,
    right: 36,
    fontSize: 7,
    color: colors.muted,
    textAlign: "right",
  },
});

type AppendixColumnStyle =
  | typeof styles.appendixTag
  | typeof styles.appendixPageViews
  | typeof styles.appendixQuestions
  | typeof styles.appendixSmes
  | typeof styles.appendixRatio
  | typeof styles.appendixTier
  | typeof styles.appendixAction;

export function SmeCoveragePdfDocument({ model }: SmeCoveragePdfDocumentProps) {
  return (
    <Document title={model.title} author="Stack API Utilities">
      <Page size="A4" style={styles.cover}>
        <View style={styles.coverRule} />
        <Text style={styles.eyebrow}>STACK API UTILITIES</Text>
        <Text style={styles.title}>{model.title}</Text>
        <Text style={styles.deck}>
          A concise decision document for reviewing subject-matter expert coverage against observed tag demand.
        </Text>
        <View style={styles.coverMeta}>
          <CoverMetaRow label="Instance" value={model.snapshot.instanceHost} />
          <CoverMetaRow label="Generated" value={model.snapshot.generatedAt} />
          <CoverMetaRow label="Scope" value={model.snapshot.scopeLabel} />
          <CoverMetaRow label="Collection" value={model.snapshot.collectionLabel} />
          <CoverMetaRow
            label="Analysis quality"
            value={model.snapshot.completeness}
          />
        </View>
        <PdfFooter />
      </Page>

      <Page size="A4" style={styles.page} wrap>
        <PdfPageBrand title={model.title} />
        <PdfWarnings warnings={model.warnings} />
        <PdfMetrics metrics={model.metrics} />
        <PdfSection title="Executive summary">
          <Text style={styles.paragraph}>{safePdfText(model.overview)}</Text>
        </PdfSection>
        <PdfSection title="Assessment">
          {model.assessmentParagraphs.length > 0 ? (
            model.assessmentParagraphs.map((paragraph, index) => (
              <Text key={`assessment:${index}`} style={styles.paragraph}>
                {safePdfText(paragraph)}
              </Text>
            ))
          ) : (
            <Text style={styles.emptyCopy}>No assessment narrative is available.</Text>
          )}
        </PdfSection>
        <PdfFindings groups={model.findingGroups} />
        <PdfMethodology
          methodology={model.methodology}
          completeness={model.snapshot.completeness}
        />
        <PdfAppendix rows={model.appendixRows} note={model.completeEvidenceNote} />
        <PdfFooter />
      </Page>
    </Document>
  );
}

function CoverMetaRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.coverMetaRow}>
      <Text style={styles.coverMetaLabel}>{label}</Text>
      <Text style={styles.coverMetaValue}>{safePdfText(value)}</Text>
    </View>
  );
}

function PdfPageBrand({ title }: { title: string }) {
  return (
    <View style={styles.pageBrand} fixed>
      <Text style={styles.pageBrandName}>STACK API UTILITIES</Text>
      <Text>{safePdfText(title)}</Text>
    </View>
  );
}

function PdfWarnings({ warnings }: { warnings: readonly string[] }) {
  return (
    <View>
      <Text style={[styles.heading, styles.firstHeading]}>Evidence notes</Text>
      {warnings.length > 0 ? (
        warnings.map((warning, index) => (
          <Text key={`warning:${index}`} style={styles.warning}>
            {safePdfText(warning)}
          </Text>
        ))
      ) : (
        <Text style={styles.emptyCopy}>No evidence limitations are listed in this decision pack.</Text>
      )}
    </View>
  );
}

function PdfMetrics({ metrics }: { metrics: SmeCoveragePdfModel["metrics"] }) {
  return (
    <View>
      <Text style={styles.heading}>Summary metrics</Text>
      <View style={styles.metricGrid}>
        {metrics.map((metric) => (
          <View key={metric.label} style={styles.metric}>
            <Text style={styles.metricLabel}>{safePdfText(metric.label)}</Text>
            <Text style={styles.metricValue}>{formatPdfNumber(metric.value)}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

function PdfSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View>
      <Text style={styles.heading}>{title}</Text>
      {children}
    </View>
  );
}

function PdfFindings({
  groups,
}: {
  groups: SmeCoveragePdfModel["findingGroups"];
}) {
  return (
    <View>
      <Text style={styles.heading}>Priority findings</Text>
      {groups.length > 0 ? (
        groups.map((group) => <PdfFindingGroup key={group.tier} group={group} />)
      ) : (
        <Text style={styles.emptyCopy}>No priority findings are in this decision pack.</Text>
      )}
    </View>
  );
}

function PdfFindingGroup({ group }: { group: SmeCoveragePdfFindingGroup }) {
  const [firstRow, ...remainingRows] = group.rows;

  return (
    <View>
      <View wrap={false}>
        <Text style={styles.subheading}>{safePdfText(group.tier)}</Text>
        <PdfFindingCard row={firstRow} groupTier={group.tier} index={0} />
      </View>
      {remainingRows.map((row, index) => (
        <PdfFindingCard
          key={`${group.tier}:${row.tagName}:${index + 1}`}
          row={row}
          groupTier={group.tier}
          index={index + 1}
        />
      ))}
    </View>
  );
}

function PdfFindingCard({
  row,
  groupTier,
  index,
}: {
  row: SmeCoverageEvidenceRow;
  groupTier: SmeCoveragePdfFindingGroup["tier"];
  index: number;
}) {
  return (
    <View
      key={`${groupTier}:${row.tagName}:${index}`}
      style={styles.findingCard}
      wrap={false}
    >
      <View style={styles.findingTopLine}>
        <Text style={styles.findingTag}>{safePdfText(row.tagName)}</Text>
        <Text style={styles.findingNumbers}>
          {`${formatPdfNumber(row.pageViews)} views | ${formatPdfNumber(row.smeCount)} SMEs`}
        </Text>
      </View>
      <Text style={styles.findingLabel}>WHY IT MATTERS</Text>
      <Text>{safePdfText(row.reason)}</Text>
      <Text style={styles.findingLabel}>RECOMMENDED ACTION</Text>
      <Text>{safePdfText(row.recommendedAction)}</Text>
    </View>
  );
}

function PdfMethodology({
  methodology,
  completeness,
}: {
  methodology: SmeCoveragePdfModel["methodology"];
  completeness: SmeCoveragePdfModel["snapshot"]["completeness"];
}) {
  const activeRule = `At least ${methodology.activityQuestionMinimum} question or more than ${methodology.activityPageViewThresholdExclusive} page views`;
  const items = [
    ["Active-tag rule", activeRule],
    ["Coverage ratio", methodology.ratioFormula],
    ["Active-tag median page views", formatMethodValue(methodology.activeTagMedianPageViews)],
    ["Eligible covered active-tag sample", formatPdfNumber(methodology.coveredActiveSampleSize)],
    ["P75 page views per SME", formatMethodRatio(methodology.p75PageViewsPerSme)],
    ["P90 page views per SME", formatMethodRatio(methodology.p90PageViewsPerSme)],
    ["Percentile sample sufficient", methodology.percentileSampleSufficient ? "Yes" : "No"],
    ["Analysis quality", completeness],
  ] as const;

  return (
    <View wrap={false}>
      <Text style={styles.heading}>Methodology</Text>
      <View style={styles.methodGrid}>
        {items.map(([label, value]) => (
          <View key={label} style={styles.methodItem}>
            <Text style={styles.methodLabel}>{label}</Text>
            <Text style={styles.methodValue}>{safePdfText(value)}</Text>
          </View>
        ))}
      </View>
      <Text style={[styles.paragraph, { marginTop: 7 }]}>
        {safePdfText(`Display rounding: ${methodology.roundingRule}.`)}
      </Text>
      <Text style={styles.paragraph}>
        Complete, Partial, and Empty describe analysis quality independently of collection status. Review evidence notes before qualifying conclusions from a Partial result.
      </Text>
    </View>
  );
}

function PdfAppendix({
  rows,
  note,
}: {
  rows: readonly SmeCoverageEvidenceRow[];
  note: string;
}) {
  const rowGroups = chunkRows(rows, 6);

  return (
    <View>
      <View wrap={false}>
        <Text style={styles.heading}>Supporting evidence appendix</Text>
        <Text style={styles.paragraph}>{safePdfText(note)}</Text>
        {rows.length === 0 ? (
          <Text style={styles.emptyCopy}>
            No finding rows are available for this bounded appendix.
          </Text>
        ) : null}
      </View>
      {rows.length > 0 ? (
        rowGroups.map((rowGroup, groupIndex) => (
          <View key={`appendix-group:${groupIndex}`} style={styles.table} wrap={false}>
            <View style={styles.tableHeader}>
              <AppendixCell style={styles.appendixTag} header>Tag</AppendixCell>
              <AppendixCell style={styles.appendixPageViews} header>Page views</AppendixCell>
              <AppendixCell style={styles.appendixQuestions} header>Questions</AppendixCell>
              <AppendixCell style={styles.appendixSmes} header>SMEs</AppendixCell>
              <AppendixCell style={styles.appendixRatio} header>Views / SME</AppendixCell>
              <AppendixCell style={styles.appendixTier} header>Tier</AppendixCell>
              <AppendixCell style={styles.appendixAction} header>Recommended action</AppendixCell>
            </View>
            {rowGroup.map((row, rowIndex) => (
              <View
                key={`appendix:${row.tagName}:${groupIndex}:${rowIndex}`}
                style={styles.tableRow}
                wrap={false}
              >
                <AppendixCell style={styles.appendixTag}>{row.tagName}</AppendixCell>
                <AppendixCell style={styles.appendixPageViews}>{formatPdfNumber(row.pageViews)}</AppendixCell>
                <AppendixCell style={styles.appendixQuestions}>{formatPdfNumber(row.questionCount)}</AppendixCell>
                <AppendixCell style={styles.appendixSmes}>{formatPdfNumber(row.smeCount)}</AppendixCell>
                <AppendixCell style={styles.appendixRatio}>{formatPdfNumber(row.pageViewsPerSme)}</AppendixCell>
                <AppendixCell style={styles.appendixTier}>{row.coverageTier}</AppendixCell>
                <AppendixCell style={styles.appendixAction}>{row.recommendedAction}</AppendixCell>
              </View>
            ))}
          </View>
        ))
      ) : null}
    </View>
  );
}

function AppendixCell({
  children,
  style,
  header = false,
}: {
  children: string;
  style: AppendixColumnStyle;
  header?: boolean;
}) {
  return (
    <Text style={[styles.tableCell, style, ...(header ? [styles.tableHeaderText] : [])]}>
      {safePdfText(children)}
    </Text>
  );
}

function PdfFooter() {
  return (
    <>
      <Text style={styles.footerLeft} fixed>Stack API Utilities</Text>
      <Text
        style={styles.footerRight}
        fixed
        render={({ pageNumber }) => `Page ${pageNumber}`}
      />
    </>
  );
}

function formatPdfNumber(value: number | null): string {
  return value === null
    ? "Unavailable"
    : value.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

function formatMethodValue(value: number | null): string {
  return value === null ? "Not calculated" : formatPdfNumber(value);
}

function formatMethodRatio(value: number | null): string {
  return value === null ? "Not calculated" : formatDisplayedRatio(value);
}

function chunkRows(
  rows: readonly SmeCoverageEvidenceRow[],
  size: number,
): readonly (readonly SmeCoverageEvidenceRow[])[] {
  const chunks: SmeCoverageEvidenceRow[][] = [];
  for (let index = 0; index < rows.length; index += size) {
    chunks.push(rows.slice(index, index + size));
  }
  return chunks;
}

function safePdfText(value: string): string {
  return value
    .replace(/[\u2010-\u2015\u2212]/g, "-")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/\u2026/g, "...")
    .replace(/\u00a0/g, " ")
    .replace(/\u20ac/g, "EUR")
    .replace(/[^\u000a\u000d\u0020-\u007e\u00a1-\u00ff]/gu, "[symbol]");
}
