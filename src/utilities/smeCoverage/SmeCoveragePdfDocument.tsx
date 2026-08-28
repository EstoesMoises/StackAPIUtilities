import {
  Document,
  Page,
  StyleSheet,
  Text,
  View,
} from "@react-pdf/renderer";
import type {
  SmeCoverageAssessmentItem,
  SmeCoverageAssessmentSection,
} from "./assessmentBrief";
import type { SmeCoverageEvidenceRow } from "./model";
import type { SmeCoveragePdfModel } from "./pdfModel";

interface SmeCoveragePdfDocumentProps {
  model: SmeCoveragePdfModel;
}

const colors = {
  orange: "#c94f12",
  orangeSoft: "#fff2eb",
  orangeDeep: "#87380f",
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
    paddingTop: 55,
    paddingRight: 36,
    paddingBottom: 44,
    paddingLeft: 36,
    fontFamily: "Helvetica",
    fontSize: 9,
    lineHeight: 1.38,
    color: colors.text,
    backgroundColor: colors.white,
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
  brandName: {
    letterSpacing: 0.7,
  },
  orangeRule: {
    width: 42,
    height: 3,
    marginBottom: 12,
    backgroundColor: colors.orange,
  },
  title: {
    marginBottom: 6,
    fontFamily: "Helvetica-Bold",
    fontSize: 24,
    lineHeight: 1.08,
    color: colors.ink,
  },
  deck: {
    marginBottom: 15,
    fontSize: 10,
    color: colors.muted,
  },
  metaGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    marginBottom: 13,
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderColor: colors.border,
  },
  metaItem: {
    width: "50%",
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderRightWidth: 1,
    borderBottomWidth: 1,
    borderColor: colors.border,
  },
  metaWide: {
    width: "100%",
  },
  metaLabel: {
    marginBottom: 2,
    fontSize: 6.5,
    color: colors.muted,
  },
  metaValue: {
    fontFamily: "Helvetica-Bold",
    color: colors.ink,
  },
  heading: {
    marginTop: 12,
    marginBottom: 6,
    paddingBottom: 4,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    fontFamily: "Helvetica-Bold",
    fontSize: 13,
    lineHeight: 1.2,
    color: colors.ink,
  },
  firstHeading: {
    marginTop: 0,
  },
  warning: {
    marginBottom: 5,
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderWidth: 1,
    borderColor: colors.warningBorder,
    backgroundColor: colors.warning,
  },
  metricGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderColor: colors.border,
  },
  metric: {
    width: "33.333%",
    minHeight: 42,
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderRightWidth: 1,
    borderBottomWidth: 1,
    borderColor: colors.border,
  },
  metricLabel: {
    marginBottom: 2,
    fontSize: 6.5,
    color: colors.muted,
  },
  metricValue: {
    fontFamily: "Helvetica-Bold",
    fontSize: 14,
    lineHeight: 1.05,
    color: colors.ink,
  },
  bottomLine: {
    padding: 9,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.soft,
  },
  bottomLineLabel: {
    marginBottom: 3,
    fontSize: 7,
    fontFamily: "Helvetica-Bold",
    color: colors.muted,
  },
  assessment: {
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderColor: colors.border,
  },
  assessmentSection: {
    flexDirection: "row",
    borderRightWidth: 1,
    borderBottomWidth: 1,
    borderColor: colors.border,
  },
  assessmentLabel: {
    width: "27%",
    padding: 7,
    fontFamily: "Helvetica-Bold",
    color: colors.ink,
    backgroundColor: colors.soft,
  },
  assessmentItems: {
    width: "73%",
    paddingVertical: 5,
    paddingHorizontal: 7,
  },
  assessmentItem: {
    marginVertical: 2,
    fontSize: 8,
  },
  nextStep: {
    marginTop: 7,
    padding: 8,
    borderWidth: 1,
    borderColor: colors.border,
  },
  nextStepLabel: {
    marginBottom: 2,
    fontSize: 7,
    fontFamily: "Helvetica-Bold",
    color: colors.ink,
  },
  table: {
    width: "100%",
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
  tableCell: {
    paddingVertical: 6,
    paddingHorizontal: 5,
    borderRightWidth: 1,
    borderBottomWidth: 1,
    borderColor: colors.border,
    fontSize: 7.3,
    lineHeight: 1.3,
  },
  tableHeaderText: {
    fontFamily: "Helvetica-Bold",
    fontSize: 6.7,
    color: colors.ink,
  },
  priorityTag: {
    width: "20%",
    fontFamily: "Helvetica-Bold",
    color: colors.ink,
  },
  priorityDemand: {
    width: "18%",
  },
  priorityTier: {
    width: "22%",
  },
  priorityAction: {
    width: "40%",
  },
  omitted: {
    marginTop: 7,
    color: colors.muted,
    fontFamily: "Helvetica-Oblique",
  },
  evidenceHandoff: {
    marginTop: 13,
    padding: 9,
    borderWidth: 1,
    borderColor: colors.orange,
    backgroundColor: colors.orangeSoft,
    color: colors.orangeDeep,
  },
  handoffLabel: {
    marginBottom: 3,
    fontFamily: "Helvetica-Bold",
    color: colors.ink,
  },
  methodology: {
    marginTop: 12,
    paddingTop: 7,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    color: colors.muted,
    fontSize: 7.5,
  },
  emptyCopy: {
    padding: 9,
    borderWidth: 1,
    borderColor: colors.border,
    color: colors.muted,
    backgroundColor: colors.soft,
    fontFamily: "Helvetica-Oblique",
  },
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

type PriorityColumnStyle =
  | typeof styles.priorityTag
  | typeof styles.priorityDemand
  | typeof styles.priorityTier
  | typeof styles.priorityAction;

export function SmeCoveragePdfDocument({ model }: SmeCoveragePdfDocumentProps) {
  return (
    <Document title={model.title} author="Stack API Utilities">
      <Page size="A4" style={styles.page} wrap>
        <PdfPageBrand title={model.title} />
        <PdfDecisionSummary model={model} />
        <PdfFooter />
      </Page>

      <Page size="A4" style={styles.page} wrap>
        <PdfPageBrand title={model.title} />
        <PdfPriorityRegister model={model} />
        <PdfEvidenceHandoff note={model.completeEvidenceNote} />
        <View wrap={false}>
          <Text style={styles.heading}>Methodology</Text>
          <Text style={styles.methodology}>{safePdfText(model.methodologySummary)}</Text>
        </View>
        <PdfFooter />
      </Page>
    </Document>
  );
}

function PdfDecisionSummary({ model }: { model: SmeCoveragePdfModel }) {
  return (
    <View>
      <View style={styles.orangeRule} />
      <Text style={styles.title}>Decision summary</Text>
      <Text style={styles.deck}>A compact, share-ready view of SME coverage risk and the actions that matter most.</Text>
      <View style={styles.metaGrid}>
        <MetaItem label="Instance" value={model.snapshot.instanceHost} />
        <MetaItem label="Generated" value={model.snapshot.generatedAt} />
        <MetaItem label="Analysis quality" value={model.snapshot.completeness} />
        <MetaItem label="Collection" value={model.snapshot.collectionLabel} />
        <MetaItem label="Scope" value={model.snapshot.scopeLabel} wide />
      </View>
      <PdfWarnings warnings={model.warnings} />
      <Text style={[styles.heading, model.warnings.length === 0 ? styles.firstHeading : {}]}>Summary metrics</Text>
      <View style={styles.metricGrid}>
        {model.metrics.map((metric) => (
          <View key={metric.label} style={styles.metric}>
            <Text style={styles.metricLabel}>{safePdfText(metric.label)}</Text>
            <Text style={styles.metricValue}>{formatPdfNumber(metric.value)}</Text>
          </View>
        ))}
      </View>
      <Text style={styles.heading}>Assessment</Text>
      <View style={styles.bottomLine} wrap={false}>
        <Text style={styles.bottomLineLabel}>Bottom line</Text>
        <Text>{safePdfText(model.assessmentBrief.bottomLine)}</Text>
      </View>
      <View style={styles.assessment}>
        {model.assessmentBrief.sections.map((section) => (
          <PdfAssessmentSection key={section.heading} section={section} />
        ))}
      </View>
      <View style={styles.nextStep} wrap={false}>
        <Text style={styles.nextStepLabel}>Recommended next step</Text>
        <Text>{safePdfText(model.assessmentBrief.recommendedNextStep)}</Text>
      </View>
    </View>
  );
}

function MetaItem({
  label,
  value,
  wide = false,
}: {
  label: string;
  value: string;
  wide?: boolean;
}) {
  return (
    <View style={[styles.metaItem, ...(wide ? [styles.metaWide] : [])]}>
      <Text style={styles.metaLabel}>{label}</Text>
      <Text style={styles.metaValue}>{safePdfText(value)}</Text>
    </View>
  );
}

function PdfWarnings({ warnings }: { warnings: readonly string[] }) {
  if (warnings.length === 0) return null;
  return (
    <View>
      <Text style={[styles.heading, styles.firstHeading]}>Evidence notes</Text>
      {warnings.map((warning, index) => (
        <Text key={`warning:${index}`} style={styles.warning}>
          {safePdfText(warning)}
        </Text>
      ))}
    </View>
  );
}

function PdfAssessmentSection({
  section,
}: {
  section: SmeCoverageAssessmentSection;
}) {
  return (
    <View style={styles.assessmentSection} wrap={false}>
      <Text style={styles.assessmentLabel}>{safePdfText(section.heading)}</Text>
      <View style={styles.assessmentItems}>
        {section.items.map((item) => (
          <Text key={`${section.heading}:${item.tagName}`} style={styles.assessmentItem}>
            {safePdfText(formatAssessmentItem(item))}
          </Text>
        ))}
        {section.omittedCount > 0 ? (
          <Text style={styles.assessmentItem}>
            {safePdfText(`+ ${formatPdfNumber(section.omittedCount)} additional ${section.omittedCount === 1 ? "priority" : "priorities"} in CSV`)}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

function PdfPriorityRegister({ model }: { model: SmeCoveragePdfModel }) {
  return (
    <View>
      <View style={styles.orangeRule} />
      <Text style={styles.title}>Priority action register</Text>
      <Text style={styles.deck}>Ranked actions are bounded for a concise brief. The accompanying CSV remains the complete evidence source.</Text>
      {model.priorityRows.length > 0 ? (
        <View style={styles.table}>
          <View style={styles.tableHeader} fixed>
            <PriorityCell style={styles.priorityTag} header>Tag</PriorityCell>
            <PriorityCell style={styles.priorityDemand} header>Demand / SMEs</PriorityCell>
            <PriorityCell style={styles.priorityTier} header>Tier</PriorityCell>
            <PriorityCell style={styles.priorityAction} header>Recommended action</PriorityCell>
          </View>
          {model.priorityRows.map((row, index) => (
            <View key={`${row.coverageTier}:${row.tagName}:${index}`} style={styles.tableRow} wrap={false}>
              <PriorityCell style={styles.priorityTag}>{row.tagName}</PriorityCell>
              <PriorityCell style={styles.priorityDemand}>{formatDemand(row)}</PriorityCell>
              <PriorityCell style={styles.priorityTier}>{row.coverageTier}</PriorityCell>
              <PriorityCell style={styles.priorityAction}>{row.recommendedAction}</PriorityCell>
            </View>
          ))}
        </View>
      ) : (
        <Text style={styles.emptyCopy}>No priority actions are available for this report.</Text>
      )}
      {model.omittedPriorityCount > 0 ? (
        <Text style={styles.omitted}>
          {safePdfText(`${formatPdfNumber(model.omittedPriorityCount)} additional ${model.omittedPriorityCount === 1 ? "priority is" : "priorities are"} available in the evidence CSV.`)}
        </Text>
      ) : null}
    </View>
  );
}

function PriorityCell({
  children,
  style,
  header = false,
}: {
  children: string;
  style: PriorityColumnStyle;
  header?: boolean;
}) {
  return (
    <Text style={[styles.tableCell, style, ...(header ? [styles.tableHeaderText] : [])]}>
      {safePdfText(children)}
    </Text>
  );
}

function PdfEvidenceHandoff({ note }: { note: string }) {
  return (
    <View style={styles.evidenceHandoff} wrap={false}>
      <Text style={styles.handoffLabel}>Complete evidence lives in the CSV</Text>
      <Text>{safePdfText(note)}</Text>
    </View>
  );
}

function PdfPageBrand({ title }: { title: string }) {
  return (
    <View style={styles.pageBrand} fixed>
      <Text style={styles.brandName}>STACK API UTILITIES</Text>
      <Text>{safePdfText(title)}</Text>
    </View>
  );
}

function PdfFooter() {
  return (
    <>
      <Text style={styles.footerLeft} fixed>Stack API Utilities</Text>
      <Text
        style={styles.footerRight}
        fixed
        render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`}
      />
    </>
  );
}

function formatAssessmentItem(item: SmeCoverageAssessmentItem): string {
  return `${item.tagName} | ${formatPdfNumber(item.pageViews)} views | ${formatPdfNumber(item.smeCount)} ${item.smeCount === 1 ? "SME" : "SMEs"} | ${item.recommendedAction}`;
}

function formatDemand(row: SmeCoverageEvidenceRow): string {
  return `${formatPdfNumber(row.pageViews)} views / ${formatPdfNumber(row.smeCount)} ${row.smeCount === 1 ? "SME" : "SMEs"}`;
}

function formatPdfNumber(value: number | null): string {
  return value === null
    ? "Unavailable"
    : value.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

function safePdfText(value: string): string {
  return value
    .replace(/[\u2010-\u2015\u2212]/g, "-")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[^\x09\x0a\x0d\x20-\x7e\u00a0-\u00ff]/gu, "[symbol]");
}
