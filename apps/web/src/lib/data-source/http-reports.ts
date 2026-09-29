/** Read-only questions for the API adapter: the report screen and the "today" numbers. */
import { DomainError } from "../demo/engine";
import { apiFetch } from "./http-client";
import { mapReportSummary, mapTodayStats, type ReportSummaryApi, type TodayStatsApi } from "./live-mappers";
import type { DataSource } from "./types";

export const reportQueries = {
  async reportSummary(filter) {
    const r = await apiFetch<ReportSummaryApi>("/v1/reports/summary", { query: { from: filter.from, to: filter.to, branchId: filter.branchId ?? undefined } });
    return mapReportSummary(r, filter);
  },

  async today(branchId) {
    // The server answers for one branch; adding branches up would need each one's net sales to be right about margins.
    if (!branchId) throw new DomainError("INTERNAL", { feature: "today(all branches)" });
    return mapTodayStats(await apiFetch<TodayStatsApi>("/v1/reports/today", { query: { branchId } }));
  },
} satisfies Partial<DataSource>;
