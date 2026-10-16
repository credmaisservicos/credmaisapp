import { describe, expect, it } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import * as financialAnalytics from "@/lib/financialAnalytics";
import { addFinancialDays, financialAnalyticsWindows, financialDaysBetween } from "@/lib/financialAnalytics";

describe("financial analytics report set", () => {
  it("omits a duplicated previous report for a combined window", () => {
    const buildReportSet = (financialAnalytics as any).financialAnalyticsReportSet;
    expect(buildReportSet).toBeTypeOf("function");
    const cash = { receipts: [{ id: "current" }] };
    const stored = JSON.parse(JSON.stringify(buildReportSet([cash])));

    expect(stored.previousCash).toBeUndefined();
    expect(stored.previousCash ?? stored.cash).toEqual(cash);
  });

  it("keeps the previous report for a split comparison", () => {
    const buildReportSet = (financialAnalytics as any).financialAnalyticsReportSet;
    expect(buildReportSet).toBeTypeOf("function");
    const current = { receipts: [{ id: "current" }] };
    const previous = { receipts: [{ id: "previous" }] };

    expect(buildReportSet([current, previous])).toEqual({ cash: current, previousCash: previous });
  });

  it("does not duplicate combined-window details after a changed cache refetch", () => {
    const buildReportSet = (financialAnalytics as any).financialAnalyticsReportSet;
    const cache = new QueryClient();
    const report = (walletTotal: number) => ({
      wallet: { totals: { disbursements: walletTotal } },
      disbursements: [{ id: "one" }],
    });
    const queryKey = ["financial-report"];

    cache.setQueryData(queryKey, buildReportSet([report(10)]));
    cache.setQueryData(queryKey, buildReportSet([report(20)]));
    const stored = cache.getQueryData(queryKey) as any;
    const details = stored.cash.disbursements.concat(stored.previousCash?.disbursements ?? []);

    expect(stored.previousCash).toBeUndefined();
    expect(details).toHaveLength(1);
    cache.clear();
  });
});

describe("janelas do relatÃ³rio financeiro", () => {
  it("combina perÃ­odos atual e anterior quando cabem no limite do RPC", () => {
    expect(financialAnalyticsWindows("2026-08-01", "2026-08-30")).toEqual([
      { from: "2026-07-02", to: "2026-08-30" },
    ]);
  });

  it("separa uma comparaÃ§Ã£o longa em duas consultas vÃ¡lidas", () => {
    const from = "2020-01-01";
    const to = "2026-01-01";
    const days = financialDaysBetween(from, to) + 1;
    expect(financialAnalyticsWindows(from, to)).toEqual([
      { from, to },
      { from: addFinancialDays(from, -days), to: addFinancialDays(from, -1) },
    ]);
  });
});
