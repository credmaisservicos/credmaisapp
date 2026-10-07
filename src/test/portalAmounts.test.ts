import { describe, expect, it } from "vitest";
import { accumulatedPaymentTotal, portalInstallmentAmount, portalFinancialSummary, portalReceivedAmount, withPortalContract, isPortalInstallmentOverdue } from "@/lib/portalAmounts";

describe("portalInstallmentAmount", () => {
  it('não cobra parcelas ou contratos cancelados e preserva recebimentos históricos', () => {
    const row = { amount: 100, due_date: '2026-08-01', status: 'cancelled', paid_amount: 40, late_fee: 25 };
    expect(portalInstallmentAmount(row)).toBe(0);
    expect(portalReceivedAmount(row)).toBe(40);
    expect(portalInstallmentAmount({ ...row, status: 'pending', contract_status: 'cancelled' })).toBe(0);
  });

  it('distingue zero registrado de pagamento legado sem valor', () => {
    const row = { amount: 100, due_date: null, status: 'paid' };
    expect(portalInstallmentAmount({ ...row, paid_amount: 0 })).toBe(0);
    expect(portalInstallmentAmount({ ...row, paid_amount: null })).toBe(100);
    expect(portalReceivedAmount({ ...row, status: 'pending', paid_amount: null })).toBe(0);
  });

  it('inclui multa fixa e mantém configurações da parcela quando presentes', () => {
    const now = new Date(2026, 7, 23, 16);
    const row = { amount: 100, paid_amount: 40, due_date: '2026-08-21', status: 'pending' };
    const contract = { daily_interest_percent: 1, daily_penalty_type: 'fixed', daily_penalty_value: 3 };
    expect(portalInstallmentAmount(withPortalContract(row, contract), now)).toBeCloseTo(68.01, 2);
    expect(portalInstallmentAmount(withPortalContract({ ...row, daily_penalty_value: 5 }, contract), now)).toBeCloseTo(72.01, 2);
  });

  it('soma pagamentos parciais e calcula pendência e atraso sem parcelas canceladas', () => {
    const contracts = [{ status: 'active', daily_interest_percent: 1, daily_penalty_type: 'fixed', daily_penalty_value: 3, installments: [
      { amount: 100, due_date: '2026-08-21', status: 'pending', paid_amount: 40 },
      { amount: 100, due_date: '2026-08-21', status: 'paid', paid_amount: 110 },
      { amount: 500, due_date: '2026-08-01', status: 'cancelled', paid_amount: 10 },
    ] }, { status: 'cancelled', installments: [{ amount: 900, due_date: '2026-08-01', status: 'pending', paid_amount: 20 }] }];
    expect(portalFinancialSummary(contracts, new Date(2026, 7, 23, 16))).toEqual({ activeContracts: 1, openAmount: 68.01, paidAmount: 180, overdueAmount: 68.01, openCount: 1, overdueCount: 1, paidCount: 1, progressPct: 50 });
  });

  it('o dia de vencimento não está atrasado, mesmo depois do meio-dia', () => {
    expect(isPortalInstallmentOverdue({ amount: 100, due_date: '2026-08-23', status: 'overdue' }, new Date(2026, 7, 23, 22))).toBe(false);
    expect(isPortalInstallmentOverdue({ amount: 100, due_date: '2026-08-22', status: 'pending' }, new Date(2026, 7, 23, 1))).toBe(true);
  });
  it("faz fallback para zero com valores financeiros inválidos", () => {
    expect(portalInstallmentAmount({ amount: "valor-legado-invalido", paid_amount: null, due_date: "2026-08-21", status: "paid" })).toBe(0);
    expect(accumulatedPaymentTotal({ amount: 100, paid_amount: "sem-valor", due_date: "2026-08-21" }, "também-inválido" as any)).toBe(0);
  });

  it("cobra apenas o saldo restante depois de pagamento parcial", () => {
    expect(portalInstallmentAmount({
      amount: 100,
      paid_amount: 40,
      due_date: "2026-08-21T12:00:00.000Z",
      status: "overdue",
      daily_interest_percent: 1,
    }, new Date("2026-08-23T12:00:00.000Z"))).toBeCloseTo(62.01, 2);
  });

  it("respeita o teto de juros no valor oferecido para pagamento", () => {
    expect(portalInstallmentAmount({
      amount: 100,
      due_date: "2026-05-01T12:00:00.000Z",
      status: "overdue",
      daily_interest_percent: 4,
      max_interest_cap_percent: 50,
    }, new Date("2026-08-23T12:00:00.000Z"))).toBe(150);
  });

  it("não soma novamente a multa ao valor total já pago", () => {
    expect(portalInstallmentAmount({
      amount: 100,
      paid_amount: 125,
      late_fee: 25,
      due_date: "2026-08-01T12:00:00.000Z",
      status: "paid",
    })).toBe(125);
  });

  it("envia ao servidor o total acumulado depois da quitação do saldo", () => {
    expect(accumulatedPaymentTotal({
      amount: 100,
      paid_amount: 40,
      due_date: "2026-08-21T12:00:00.000Z",
    }, 62.01)).toBe(102.01);
  });
});
