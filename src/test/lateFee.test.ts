import { describe, it, expect } from "vitest";
import {
  computeLateFee,
  computeLateFeeBreakdown,
  calculateFeeDiscount,
  daysLateOf,
  dailyRateOf,
  outstandingDue,
  totalDue,
  DEFAULT_DAILY_LATE_RATE,
} from "@/lib/lateFee";

// Este módulo decide quanto o cliente deve a mais por atraso — é o cálculo que
// aparece na cobrança, no portal e nas mensagens do bot. Até aqui não tinha teste.
//
// Regra vigente: juros COMPOSTO diário sobre o valor da parcela, sem multa fixa.

const DIA = 86400000;
const emDias = (n: number) => new Date(Date.now() + n * DIA);
const venceEm = (n: number) => new Date(Date.now() + n * DIA).toISOString();

describe("daysLateOf", () => {
  it("não conta atraso antes do vencimento", () => {
    expect(daysLateOf({ amount: 100, due_date: venceEm(3) })).toBe(0);
  });

  it("não conta atraso no próprio dia do vencimento", () => {
    expect(daysLateOf({ amount: 100, due_date: venceEm(0) })).toBe(0);
  });

  it("preserva o dia de vencimento em datas YYYY-MM-DD no fuso brasileiro", () => {
    const hoje = new Date();
    const dataLocal = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, "0")}-${String(hoje.getDate()).padStart(2, "0")}`;
    expect(daysLateOf({ amount: 100, due_date: dataLocal }, hoje)).toBe(0);
  });

  it("conta dias inteiros, ignorando a hora do vencimento", () => {
    const ontemDeManha = new Date();
    ontemDeManha.setDate(ontemDeManha.getDate() - 1);
    ontemDeManha.setHours(1, 0, 0, 0);
    expect(daysLateOf({ amount: 100, due_date: ontemDeManha.toISOString() })).toBe(1);
  });

  it("devolve 0 para data ausente ou inválida", () => {
    expect(daysLateOf({ amount: 100, due_date: null })).toBe(0);
    expect(daysLateOf({ amount: 100, due_date: "data-torta" })).toBe(0);
  });
});

describe("desconto nos encargos", () => {
  it("aplica percentual somente sobre multa/juros, preservando o principal", () => {
    expect(calculateFeeDiscount(150, 50, 50)).toEqual({
      discountable: 50,
      discount: 25,
      amountToReceive: 125,
    });
    expect(calculateFeeDiscount(150, 50, 100).amountToReceive).toBe(100);
  });

  it("não devolve encargo que já tenha sido pago", () => {
    expect(calculateFeeDiscount(20, 50, 100)).toEqual({
      discountable: 20,
      discount: 20,
      amountToReceive: 0,
    });
  });
});

describe("outstandingDue", () => {
  it("desconta pagamentos parciais do principal e dos juros", () => {
    const now = new Date("2026-08-23T12:00:00.000Z");
    const inst = {
      amount: 100,
      paid_amount: 40,
      due_date: "2026-08-21T12:00:00.000Z",
      status: "overdue",
      daily_interest_percent: 1,
    };

    expect(outstandingDue(inst, now)).toBeCloseTo(62.01, 2);
  });

  it("nunca retorna saldo negativo", () => {
    expect(outstandingDue({
      amount: 100,
      paid_amount: 150,
      due_date: "2026-08-24T12:00:00.000Z",
      status: "pending",
    }, new Date("2026-08-23T12:00:00.000Z"))).toBe(0);
  });

  it("ignora pagamentos e encargos negativos vindos de dados legados", () => {
    const inst = { amount: 100, paid_amount: -20, late_fee: -10, due_date: null, status: "paid" };
    expect(outstandingDue(inst)).toBe(100);
    expect(totalDue(inst)).toBe(100);
  });
});

describe("dailyRateOf", () => {
  it("usa a taxa do contrato quando existe", () => {
    expect(dailyRateOf({ amount: 100, due_date: null, daily_interest_percent: 2 })).toBe(2);
  });

  it("cai no padrão de 4% a.d. quando o contrato não define", () => {
    expect(dailyRateOf({ amount: 100, due_date: null })).toBe(DEFAULT_DAILY_LATE_RATE);
    expect(dailyRateOf({ amount: 100, due_date: null, daily_interest_percent: 0 })).toBe(4);
  });
});

describe("computeLateFee — juros composto diário", () => {
  it('preserva encargos registrados acima do cálculo atual, como a baixa no servidor', () => {
    expect(computeLateFee({ amount: 100, due_date: '2026-08-21', status: 'pending', late_fee: 15, daily_interest_percent: 1 }, new Date(2026, 7, 23))).toBe(15);
    expect(computeLateFee({ amount: 100, due_date: '2099-01-01', status: 'pending', late_fee: 15 })).toBe(15);
  });
  it.each([{ has_active_settlement: true }, { pre_settlement_snapshot: {} }])('congela encargos em uma quitação com snapshot ativo: %o', marker => {
    expect(computeLateFee({ amount: 100, due_date: '2026-08-01', status: 'pending', late_fee: 15, ...marker }, new Date(2026, 7, 23))).toBe(15);
  });
  const parcela = (dias: number, extras = {}) => ({
    amount: 100,
    due_date: venceEm(-dias),
    status: "pending",
    ...extras,
  });

  it("é zero antes de vencer", () => {
    expect(computeLateFee({ amount: 100, due_date: venceEm(5), status: "pending" })).toBe(0);
  });

  it("não gera encargo negativo para parcela com principal inválido", () => {
    const inst = { amount: -100, due_date: venceEm(-3), status: "pending" };
    expect(computeLateFee(inst)).toBe(0);
    expect(totalDue(inst)).toBe(0);
  });

  it("1 dia a 4% cobra 4,00", () => {
    expect(computeLateFee(parcela(1))).toBeCloseTo(4, 2);
  });

  it("compõe: 2 dias dão 8,16 e não 8,00", () => {
    // 100 * (1,04^2 - 1) = 8,16 — se desse 8,00 seria juros simples
    expect(computeLateFee(parcela(2))).toBeCloseTo(8.16, 2);
  });

  it("3 dias dão 12,49", () => {
    expect(computeLateFee(parcela(3))).toBeCloseTo(12.49, 2);
  });

  it("cresce rápido: 30 dias a 4% passam de 2x a parcela", () => {
    const juros = computeLateFee(parcela(30));
    expect(juros).toBeGreaterThan(200);
    expect(juros).toBeCloseTo(100 * (Math.pow(1.04, 30) - 1), 1);
  });

  it("respeita a taxa própria do contrato", () => {
    expect(computeLateFee(parcela(2, { daily_interest_percent: 1 }))).toBeCloseTo(2.01, 2);
  });

  it("parcela paga congela o valor que foi cobrado, não recalcula", () => {
    const paga = { amount: 100, due_date: venceEm(-10), status: "paid", late_fee: 7.5 };
    expect(computeLateFee(paga)).toBe(7.5);
  });

  it("parcela cancelada também congela", () => {
    const cancelada = { amount: 100, due_date: venceEm(-10), status: "cancelled", late_fee: 3 };
    expect(computeLateFee(cancelada)).toBe(3);
  });

  it("parcela sem valor não inventa juros", () => {
    expect(computeLateFee({ amount: 0, due_date: venceEm(-10), status: "pending" })).toBe(0);
  });

  it("arredonda para centavos", () => {
    const v = computeLateFee(parcela(7));
    expect(Number.isInteger(Math.round(v * 100))).toBe(true);
    expect(v).toBe(Math.round(v * 100) / 100);
  });
});

describe("totalDue e breakdown", () => {
  it("total é parcela + juros acumulado", () => {
    const p = { amount: 100, due_date: venceEm(-2), status: "pending" };
    expect(totalDue(p)).toBeCloseTo(108.16, 2);
  });

  it("breakdown não tem multa fixa — só o juros diário", () => {
    const b = computeLateFeeBreakdown({ amount: 100, due_date: venceEm(-2), status: "pending" });
    expect(b.multa).toBe(0);
    expect(b.multaPct).toBe(0);
    expect(b.daysLate).toBe(2);
    expect(b.jurosPct).toBe(4);
    expect(b.juros).toBeCloseTo(8.16, 2);
    expect(b.withFees).toBeCloseTo(108.16, 2);
  });

  it("juros do breakdown bate com o total, sem dupla contagem", () => {
    const p = { amount: 250, due_date: venceEm(-5), status: "pending" };
    const b = computeLateFeeBreakdown(p);
    expect(b.total).toBeCloseTo(computeLateFee(p), 2);
    expect(b.withFees).toBeCloseTo(totalDue(p), 2);
  });
});

describe("teto de juros do contrato", () => {
  // `max_interest_cap_percent` era preenchido no cadastro do empréstimo, gravado
  // no banco e nunca lido: o operador definia um limite que não limitava nada.
  const base = { amount: 100, due_date: venceEm(-60), status: "pending" };

  it("sem teto, os juros crescem sem limite", () => {
    // 60 dias a 4% ao dia composto passam de 9x o valor da parcela
    expect(computeLateFee(base)).toBeGreaterThan(900);
  });

  it("com teto de 100%, os juros param no valor da parcela", () => {
    expect(computeLateFee({ ...base, max_interest_cap_percent: 100 })).toBe(100);
  });

  it("teto de 50% limita à metade da parcela", () => {
    expect(computeLateFee({ ...base, max_interest_cap_percent: 50 })).toBe(50);
  });

  it("teto não infla juros quando ainda não foi atingido", () => {
    const doisDias = { amount: 100, due_date: venceEm(-2), status: "pending", max_interest_cap_percent: 100 };
    expect(computeLateFee(doisDias)).toBeCloseTo(8.16, 2); // continua o composto normal
  });

  it("teto zero ou ausente é tratado como sem teto", () => {
    expect(computeLateFee({ ...base, max_interest_cap_percent: 0 })).toBeGreaterThan(900);
    expect(computeLateFee({ ...base, max_interest_cap_percent: null })).toBeGreaterThan(900);
  });

  it("lê o teto também quando o contrato vem aninhado na parcela", () => {
    // Cobranças e Detalhe do Cliente trazem `select("*, contracts(...)")`
    expect(computeLateFee({ ...base, contracts: { max_interest_cap_percent: 100 } })).toBe(100);
  });

  it("a taxa diária também é lida do contrato aninhado", () => {
    const inst = { amount: 100, due_date: venceEm(-2), status: "pending", contracts: { daily_interest_percent: 1 } };
    expect(dailyRateOf(inst)).toBe(1);
    expect(computeLateFee(inst)).toBeCloseTo(2.01, 2);
  });

  it("o breakdown respeita o teto, sem divergir do total", () => {
    const comTeto = { ...base, max_interest_cap_percent: 100 };
    const b = computeLateFeeBreakdown(comTeto);
    expect(b.juros).toBe(100);
    expect(b.withFees).toBe(200);
    expect(b.total).toBe(computeLateFee(comTeto));
  });
});

describe("independência da hora do dia", () => {
  it("o valor não muda se o cálculo roda de manhã ou de noite", () => {
    const p = { amount: 100, due_date: venceEm(-3), status: "pending" };
    const manha = new Date(); manha.setHours(6, 0, 0, 0);
    const noite = new Date(); noite.setHours(23, 30, 0, 0);
    expect(computeLateFee(p, manha)).toBeCloseTo(computeLateFee(p, noite), 2);
  });
});

describe("dados legados inválidos", () => {
  it("não propaga NaN quando valores financeiros chegam inválidos", () => {
    const value = computeLateFee({ amount: "valor-legado-invalido", late_fee: "sem-valor", due_date: "2026-01-01", status: "paid" });
    expect(Number.isFinite(value)).toBe(true);
    expect(Number.isFinite(totalDue({ amount: "valor-legado-invalido", due_date: "2026-01-01" }))).toBe(true);
  });
});
