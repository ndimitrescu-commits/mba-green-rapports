import type { ReportContext } from "./types";

export interface ReportData {
  context: ReportContext;
}

export function buildReportData(context: ReportContext): ReportData {
  return { context };
}
