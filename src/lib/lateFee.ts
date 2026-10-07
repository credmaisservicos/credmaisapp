// Política única de atraso: JUROS DIÁRIO COMPOSTO de 4% ao dia (padrão),
// aplicado sobre o valor acumulado (parcela + juros já acumulados).
// Ex.: parcela 100 → 1 dia = 104 → 2 dias = 108,16 → 3 dias = 112,49...
// A multa diária configurada (fixa ou percentual) e o teto acompanham o contrato.
import { parseLocalDate } from "@/lib/dateUtils";

export const DEFAULT_DAILY_LATE_RATE = 4; // % ao dia

export interface LateFeeInput {
  amount: number | string | null | undefined;
  due_date: string | null | undefined;
  status?: string | null;
  late_fee?: number | string | null;
  paid_amount?: number | string | null;
  late_fee_percent?: number | string | null;
  daily_interest_percent?: number | string | null;
  daily_penalty_type?: "percentage" | "fixed" | string | null;
  daily_penalty_value?: number | string | null;
  paid_at?: string | null;
  pre_settlement_snapshot?: unknown;
  has_active_settlement?: boolean;
  /**
   * Teto de juros de atraso, em % sobre o valor da parcela.
   * Vem de `contracts.max_interest_cap_percent`. Ex.: 100 = os juros nunca
   * passam do valor da própria parcela.
   *
   * Este campo era preenchido no cadastro do empréstimo, gravado no banco e
   * NUNCA lido — o operador definia um limite que não limitava nada. Com juros
   * de 4% ao dia compostos, isso importa: em 60 dias a parcela decupla.
   */
  max_interest_cap_percent?: number | string | null;
  /**
   * Algumas telas trazem a parcela com o contrato aninhado
   * (`select("*, contracts(...)")`). Aceitar as duas formas evita ter que
   * lembrar de achatar o objeto em cada lugar — e é justamente esse tipo de
   * "lembrar em todo lugar" que fez o teto nunca ser aplicado.
   */
  contracts?: {
    daily_interest_percent?: number | string | null;
    max_interest_cap_percent?: number | string | null;
    daily_penalty_type?: "percentage" | "fixed" | string | null;
    daily_penalty_value?: number | string | null;
  } | null;
}

const finiteNumber = (value: unknown) => {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
};

/** Lê um campo do contrato, esteja ele achatado na parcela ou aninhado. */
function doContrato(inst: LateFeeInput, campo: "daily_interest_percent" | "max_interest_cap_percent" | "daily_penalty_type" | "daily_penalty_value") {
  const direto = (inst as any)?.[campo];
  if (direto != null && direto !== "") return direto;
  return inst?.contracts?.[campo] ?? null;
}

/** Teto em valor absoluto (R$), ou null quando o contrato não define teto. */
export function interestCapOf(inst: LateFeeInput): number | null {
  const pct = finiteNumber(doContrato(inst, "max_interest_cap_percent"));
  if (!Number.isFinite(pct) || pct <= 0) return null;
  const base = Math.max(0, finiteNumber(inst?.amount));
  if (!base) return null;
  return Math.round(base * (pct / 100) * 100) / 100;
}

/** Dias inteiros de atraso (0 se ainda não venceu). */
export function daysLateOf(inst: LateFeeInput, now: Date = new Date()): number {
  if (!inst?.due_date) return 0;
  const due = parseLocalDate(inst.due_date);
  if (!due) return 0;
  const d0 = new Date(due.getFullYear(), due.getMonth(), due.getDate()).getTime();
  const n0 = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  return Math.max(0, Math.floor((n0 - d0) / 86400000));
}

/** Taxa diária efetiva do contrato (fallback 4% a.d.). */
export function dailyRateOf(inst: LateFeeInput): number {
  const pct = finiteNumber(doContrato(inst, "daily_interest_percent"));
  return pct === 0 ? DEFAULT_DAILY_LATE_RATE : Math.max(0, pct);
}

/** Juros de atraso acumulados (composto diário). */
export function computeLateFee(inst: LateFeeInput, now: Date = new Date()): number {
  if (!inst) return 0;
  const stored = Math.max(0, finiteNumber(inst.late_fee));

  // Já paga/cancelada: mostra o valor que foi efetivamente cobrado.
  if (inst.status === "paid" || inst.status === "cancelled") return stored;
  if (inst.has_active_settlement === true || inst.pre_settlement_snapshot != null) return stored;

  const base = Math.max(0, finiteNumber(inst.amount));
  if (!base) return stored;

  const days = daysLateOf(inst, now);
  if (days <= 0) return stored;

  const rate = dailyRateOf(inst) / 100;
  const interest = base * (Math.pow(1 + rate, days) - 1);
  const penaltyValue = Math.max(0, finiteNumber(doContrato(inst, "daily_penalty_value")));
  const penalty = doContrato(inst, "daily_penalty_type") === "fixed"
    ? penaltyValue * days
    : base * (penaltyValue / 100) * days;
  const total = Math.round((interest + penalty) * 100) / 100;

  // Respeita o teto do contrato, quando houver.
  const teto = interestCapOf(inst);
  // O RPC de baixa preserva o encargo já registrado, inclusive após alterar a regra.
  return Math.max(stored, teto !== null ? Math.min(total, teto) : total);
}

export function totalDue(inst: LateFeeInput, now?: Date): number {
  return Math.max(0, finiteNumber(inst?.amount)) + computeLateFee(inst, now);
}

/** Saldo realmente exigível, descontando pagamentos parciais já registrados. */
export function outstandingDue(inst: LateFeeInput, now?: Date): number {
  return Math.max(0, totalDue(inst, now) - Math.max(0, finiteNumber(inst?.paid_amount)));
}

export interface LateFeeBreakdown {
  daysLate: number;
  base: number;
  multaPct: number;   // percentual diário; zero quando a multa é fixa
  jurosPct: number;   // % ao dia
  multa: number;      // parcela da multa diária contida no encargo total
  juros: number;      // restante do encargo, sem duplicar a multa
  total: number;
  withFees: number;
}

export function computeLateFeeBreakdown(inst: LateFeeInput, now: Date = new Date()): LateFeeBreakdown {
  const baseValue = Number(inst?.amount ?? 0);
  const base = Number.isFinite(baseValue) ? Math.max(0, baseValue) : 0;
  const total = computeLateFee(inst, now);
  const daysLate = daysLateOf(inst, now);
  const jurosPct = dailyRateOf(inst);
  const penaltyValue = Math.max(0, Number(doContrato(inst, "daily_penalty_value")) || 0);
  const penaltyType = doContrato(inst, "daily_penalty_type") === "fixed" ? "fixed" : "percentage";
  const rawPenalty = penaltyType === "fixed"
    ? penaltyValue * daysLate
    : base * (penaltyValue / 100) * daysLate;
  const multa = Math.min(Math.round(rawPenalty * 100) / 100, total);
  return {
    daysLate,
    base,
    multaPct: penaltyType === "percentage" ? penaltyValue : 0,
    jurosPct,
    multa,
    juros: Math.max(0, Math.round((total - multa) * 100) / 100),
    total,
    withFees: base + total,
  };
}

/** Calcula desconto somente sobre encargos ainda pendentes, nunca sobre o principal. */
export function calculateFeeDiscount(remainingDue: number, totalFees: number, percent: number) {
  const remainingValue = Number(remainingDue ?? 0);
  const feesValue = Number(totalFees ?? 0);
  const percentValue = Number(percent ?? 0);
  const remaining = Math.max(0, Math.round((Number.isFinite(remainingValue) ? remainingValue : 0) * 100) / 100);
  const discountable = Math.max(0, Math.min(Number.isFinite(feesValue) ? feesValue : 0, remaining));
  const safePercent = Math.max(0, Math.min(100, Number.isFinite(percentValue) ? percentValue : 0));
  const discount = Math.round(discountable * safePercent) / 100;
  return {
    discountable,
    discount,
    amountToReceive: Math.max(0, Math.round((remaining - discount) * 100) / 100),
  };
}
