import { describe, expect, it } from "vitest";
import { accumulatedPaymentTotal, portalInstallmentAmount } from "@/lib/portalAmounts";

describe("portalInstallmentAmount", () => {
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
