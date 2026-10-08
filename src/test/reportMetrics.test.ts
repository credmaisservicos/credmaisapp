import { describe, expect, it } from "vitest";
import { installmentOutstanding, reportableInstallments, summarizeReportInstallments } from "@/lib/reportMetrics";

describe("reportMetrics", () => {
  it("mantém parcelas de contrato quitado e exclui cancelamentos", () => {
    const installments = [
      { contract_id: "active", status: "pending", amount: 100, due_date: "2099-01-01" },
      { contract_id: "completed", status: "paid", amount: 200, paid_amount: 200, due_date: "2026-08-01" },
      { contract_id: "cancelled", status: "pending", amount: 300, due_date: "2026-08-01" },
      { contract_id: "active", status: "cancelled", amount: 400, due_date: "2026-08-01" },
    ];
    expect(reportableInstallments(installments, [
      { id: "active", status: "active" },
      { id: "completed", status: "completed" },
      { id: "cancelled", status: "cancelled" },
    ])).toEqual(installments.slice(0, 2));
  });

  it("calcula somente o saldo restante após pagamento parcial", () => {
    expect(installmentOutstanding({ amount: 200, late_fee: 20, paid_amount: 70 })).toBe(150);
    expect(installmentOutstanding({ amount: 100, paid_amount: 130 })).toBe(0);
  });

  it("reconcilia contagens e valor vencido", () => {
    expect(summarizeReportInstallments([
      { status: "paid", amount: 100, paid_amount: 100, due_date: "2026-08-01" },
      { status: "pending", amount: 200, paid_amount: 50, late_fee: 10,pre_settlement_snapshot:{}, due_date: "2026-08-01" },
      { status: "pending", amount: 300, due_date: "2099-08-01" },
    ], new Date("2026-08-23T12:00:00-03:00"))).toEqual({
      paidCount: 1, overdueCount: 1, pendingCount: 1, totalOverdue: 160,
    });
  });
});
