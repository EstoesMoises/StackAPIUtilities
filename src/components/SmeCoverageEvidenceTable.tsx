import { useMemo } from "react";
import { createColumnHelper, type SortingFn } from "@tanstack/react-table";
import type { SmeCoverageEvidenceRow } from "../utilities/smeCoverage/model";
import { formatDisplayedRatio } from "../utilities/smeCoverage/narrative";
import {
  ReportEvidenceExplorer,
  type EvidenceFacet,
} from "./ReportEvidenceExplorer";

interface SmeCoverageEvidenceTableProps {
  evidence: readonly SmeCoverageEvidenceRow[];
}

const columnHelper = createColumnHelper<SmeCoverageEvidenceRow>();
const codeUnitSort: SortingFn<SmeCoverageEvidenceRow> = (left, right, columnId) => {
  const leftValue = String(left.getValue(columnId));
  const rightValue = String(right.getValue(columnId));
  return leftValue < rightValue ? -1 : leftValue > rightValue ? 1 : 0;
};

const columns = [
  columnHelper.accessor("tagName", {
    header: "Tag",
    sortingFn: codeUnitSort,
    cell: (context) => <strong>{context.getValue()}</strong>,
  }),
  columnHelper.accessor((row) => row.pageViews ?? undefined, {
    id: "pageViews",
    header: "Page views",
    sortUndefined: "last",
    cell: (context) => formatNumber(context.getValue()),
  }),
  columnHelper.accessor((row) => row.questionCount ?? undefined, {
    id: "questionCount",
    header: "Questions",
    sortUndefined: "last",
    cell: (context) => formatNumber(context.getValue()),
  }),
  columnHelper.accessor("questionCountBasis", {
    header: "Question-count basis",
    sortingFn: codeUnitSort,
  }),
  columnHelper.accessor((row) => row.smeCount ?? undefined, {
    id: "smeCount",
    header: "SMEs",
    sortUndefined: "last",
    cell: (context) => formatSmeCount(context.getValue()),
  }),
  columnHelper.accessor((row) => row.pageViewsPerSme ?? undefined, {
    id: "pageViewsPerSme",
    header: "Page views per SME",
    sortUndefined: "last",
    cell: (context) => {
      const value = context.getValue();
      return value === undefined ? "Unavailable" : formatDisplayedRatio(value);
    },
  }),
  columnHelper.accessor((row) => row.coveragePercentile ?? undefined, {
    id: "coveragePercentile",
    header: "Coverage percentile",
    sortUndefined: "last",
    cell: (context) => formatNumber(context.getValue()),
  }),
  columnHelper.accessor("coverageTier", {
    header: "Coverage tier",
    sortingFn: codeUnitSort,
    cell: (context) => (
      <span className={`sme-tier-badge sme-tier-badge__${tierClass(context.getValue())}`}>
        {context.getValue()}
      </span>
    ),
  }),
  columnHelper.display({
    id: "evidenceQuality",
    header: "Evidence quality",
    cell: ({ row }) => evidenceQuality(row.original),
  }),
  columnHelper.accessor("demandQuality", {
    header: "Demand quality",
    sortingFn: codeUnitSort,
  }),
  columnHelper.accessor("smeQuality", {
    header: "SME quality",
    sortingFn: codeUnitSort,
  }),
  columnHelper.accessor("reason", {
    header: "Reason",
    sortingFn: codeUnitSort,
  }),
  columnHelper.accessor("recommendedAction", {
    header: "Recommended action",
    sortingFn: codeUnitSort,
  }),
];

const defaultColumnVisibility = {
  questionCount: false,
  questionCountBasis: false,
  coveragePercentile: false,
  reason: false,
  demandQuality: false,
  smeQuality: false,
} as const;

export function SmeCoverageEvidenceTable({ evidence }: SmeCoverageEvidenceTableProps) {
  const coverageTiers = useMemo(
    () => [...new Set(evidence.map((row) => row.coverageTier))],
    [evidence],
  );
  const facets = useMemo<readonly EvidenceFacet<SmeCoverageEvidenceRow>[]>(
    () => [
      {
        id: "coverageTier",
        label: "Coverage tier",
        allLabel: "All coverage tiers",
        options: coverageTiers,
        matches: matchesCoverageTier,
      },
      {
        id: "evidenceQuality",
        label: "Evidence quality",
        allLabel: "All evidence quality",
        options: ["Complete", "Needs review"],
        matches: matchesEvidenceQuality,
      },
    ],
    [coverageTiers],
  );

  return (
    <div className="sme-evidence">
      <ReportEvidenceExplorer
        rows={evidence}
        columns={columns}
        defaultColumnVisibility={defaultColumnVisibility}
        facets={facets}
        getSearchText={getSmeEvidenceSearchText}
        getRowId={getSmeEvidenceRowId}
        ariaLabel="SME coverage evidence table"
        emptyMessage="No evidence rows are in this decision pack."
      />
    </div>
  );
}

function evidenceQuality(row: SmeCoverageEvidenceRow): "Complete" | "Needs review" {
  return row.demandQuality === "Complete" && row.smeQuality === "Complete"
    ? "Complete"
    : "Needs review";
}

function matchesCoverageTier(row: SmeCoverageEvidenceRow, value: string): boolean {
  return row.coverageTier === value;
}

function matchesEvidenceQuality(row: SmeCoverageEvidenceRow, value: string): boolean {
  return evidenceQuality(row) === value;
}

function getSmeEvidenceSearchText(row: SmeCoverageEvidenceRow): string {
  return [
    row.tagName,
    row.pageViews,
    formatNumber(row.pageViews ?? undefined),
    row.questionCount,
    formatNumber(row.questionCount ?? undefined),
    row.questionCountBasis,
    row.smeCount,
    formatSmeCount(row.smeCount ?? undefined),
    row.pageViewsPerSme,
    row.pageViewsPerSme === null ? "Unavailable" : formatDisplayedRatio(row.pageViewsPerSme),
    row.coveragePercentile,
    formatNumber(row.coveragePercentile ?? undefined),
    row.coverageTier,
    evidenceQuality(row),
    row.demandQuality,
    row.smeQuality,
    row.reason,
    row.recommendedAction,
  ].join(" ");
}

function getSmeEvidenceRowId(row: SmeCoverageEvidenceRow): string {
  return row.tagName;
}

function formatNumber(value: number | undefined): string {
  return value === undefined
    ? "Unavailable"
    : value.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

function formatSmeCount(value: number | undefined): string {
  if (value === undefined) return "Unavailable";
  if (value === 0) return "No SME";
  return value.toLocaleString("en-US");
}

function tierClass(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-");
}
