import type { ReportWarning } from "../domain/types";

export type ReportSectionId = "overview" | "findings" | "evidence" | "methodology";

export type ReportQualityTone = "success" | "warning" | "neutral";

export interface ReportMetric {
  readonly label: string;
  readonly value: number | string;
}

export interface ReportFinding<TEvidence> {
  readonly tier: string;
  readonly evidence: TEvidence;
}

export interface ReportPresentationModel<TEvidence, TMethodology> {
  readonly reportKey: string;
  readonly kindLabel: string;
  readonly title: string;
  readonly sourceLabel: string;
  readonly generatedAt: string;
  readonly scopeLabel: string;
  readonly collectionLabel: string;
  readonly qualityLabel: string;
  readonly qualityTone: ReportQualityTone;
  readonly rowCount: number;
  readonly warnings: readonly ReportWarning[];
  readonly metrics: readonly ReportMetric[];
  readonly overview: string;
  readonly assessment?: string;
  readonly findings: readonly ReportFinding<TEvidence>[];
  readonly evidence: readonly TEvidence[];
  readonly methodology?: TMethodology;
  readonly availableSections: readonly ReportSectionId[];
  readonly exports: {
    readonly pdf: boolean;
    readonly csv: boolean;
    readonly markdown: boolean;
  };
}
