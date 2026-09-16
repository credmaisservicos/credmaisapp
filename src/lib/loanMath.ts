// Núcleo unificado de cálculo de empréstimos.
// Suporta 6 modos: installments, percentage, interest_only, price, bullet, grace.
import { parseLocalDate, addMonthsClamped, addDays, addBusinessDays } from "./dateUtils";

export type LoanMode =
  | "percentage"
  | "installments"
  | "interest_only"
  | "price"
  | "bullet"
  | "grace";
export type Frequency = "monthly" | "weekly" | "daily" | "biweekly" | "custom";
export type DailyMode = "mon-fri" | "mon-sat" | "mon-sun";
export type ValueMode = "rate" | "installment";

export interface CalculateLoanInput {
  capital: number;
  /** Taxa em % por período (ignorada se valueMode === "installment"). */
  rate?: number;
  /** Nº de parcelas / períodos. Pode ser 0 quando loanMode = "percentage" e valueMode = "rate". */
  periods?: number;
  frequency: Frequency;
  loanMode: LoanMode;
  valueMode?: ValueMode;
  /** Valor da parcela quando valueMode = "installment". */
  installmentValue?: number;
  /** Períodos de carência (apenas para loanMode = "grace"). */
  gracePeriods?: number;
}

export interface CalculateLoanResult {
  installmentAmount: number;
  totalAmount: number;
  totalInterest: number;
  numInstallments: number;
  /** Valor real de cada parcela (mesma length de numInstallments). */
  schedule: number[];
  /** Taxa derivada (%) quando valueMode = "installment". */
  derivedRate?: number;
  perPeriodLabel: string;
}

export const periodLabelFor = (f: Frequency): string => {
  switch (f) {
    case "daily": return "dia";
    case "weekly": return "semana";
    case "biweekly": return "quinzena";
    case "custom": return "parcela";
    default: return "mês";
  }
};

export const LOAN_MODE_LABEL: Record<LoanMode, string> = {
  installments: "Por Parcelas",
  percentage: "Por Porcentagem",
  interest_only: "Só Juros + Capital no Fim",
  price: "Juros Compostos (Price)",
  bullet: "Pagamento Único no Vencimento",
  grace: "Com Carência",
};

const uniform = (value: number, n: number): number[] => Array.from({ length: n }, () => value);

/** Distribui `total` em `n` parcelas iguais arredondadas a 2 casas, ajustando a última
 *  para que a soma bata exatamente o total (absorve centavo residual). */
const splitRounded = (total: number, n: number): number[] => {
  if (n <= 0) return [];
  if (n === 1) return [Math.round(total * 100) / 100];
  const base = Math.round((total / n) * 100) / 100;
  const arr = Array.from({ length: n - 1 }, () => base);
  const sumBase = base * (n - 1);
  const last = Math.round((total - sumBase) * 100) / 100;
  arr.push(last);
  return arr;
};

export function calculateLoan(input: CalculateLoanInput): CalculateLoanResult | null {
  const { capital, frequency, loanMode } = input;
  const valueMode: ValueMode = input.valueMode ?? "rate";
  const periods = input.periods ?? 0;
  const rate = input.rate ?? 0;
  const installmentValue = input.installmentValue ?? 0;
  const grace = Math.max(0, Math.floor(input.gracePeriods ?? 0));
  const label = periodLabelFor(frequency);

  if (!capital || capital <= 0) return null;

  // Modo "valor da parcela" → deriva a taxa (apenas com parcelas fixas/installments).
  if (valueMode === "installment") {
    if (loanMode !== "installments" || periods <= 0 || installmentValue <= 0) return null;
    const totalAmount = installmentValue * periods;
    if (totalAmount < capital) return null;
    const totalInterest = totalAmount - capital;
    const derivedRate = (totalInterest / (capital * periods)) * 100;
    return {
      installmentAmount: installmentValue,
      totalAmount,
      totalInterest,
      numInstallments: periods,
      schedule: uniform(installmentValue, periods),
      derivedRate,
      perPeriodLabel: label,
    };
  }

  if (rate <= 0) return null;

  // ── installments (juros simples, parcelas iguais) ──
  if (loanMode === "installments") {
    if (periods <= 0) return null;
    const juros = capital * (rate / 100) * periods;
    const total = capital + juros;
    const parcela = total / periods;
    return {
      installmentAmount: parcela,
      totalAmount: total,
      totalInterest: juros,
      numInstallments: periods,
      schedule: splitRounded(total, periods),
      perPeriodLabel: label,
    };
  }

  // ── percentage ──
  if (loanMode === "percentage") {
    // Contrato renov?vel: cada ciclo cobra somente os juros; o capital
    // continua aberto at? o operador escolher quitar capital + juros.
    if (periods <= 0) {
      const juros = capital * (rate / 100);
      return {
        installmentAmount: juros,
        totalAmount: capital + juros,
        totalInterest: juros,
        numInstallments: 1,
        schedule: [juros],
        perPeriodLabel: label,
      };
    }
    if (periods > 0) {
      // Porcentagem: taxa aplicada UMA vez sobre o capital (total),
      // e o total é dividido em N parcelas iguais.
      const juros = capital * (rate / 100);
      const total = capital + juros;
      const parcela = total / periods;
      return {
        installmentAmount: parcela,
        totalAmount: total,
        totalInterest: juros,
        numInstallments: periods,
        schedule: splitRounded(total, periods),
        perPeriodLabel: label,
      };
    }
    // auto
    const autoPeriods = Math.ceil(100 / rate);
    const payPer = capital * (rate / 100);
    const total = payPer * autoPeriods;
    return {
      installmentAmount: payPer,
      totalAmount: total,
      totalInterest: total - capital,
      numInstallments: autoPeriods,
      schedule: splitRounded(total, autoPeriods),
      perPeriodLabel: label,
    };
  }

  // ── interest_only: n-1 parcelas de juros + última com juros + capital ──
  if (loanMode === "interest_only") {
    if (periods <= 0) return null;
    const jurosPeriodo = capital * (rate / 100);
    const schedule: number[] = [];
    for (let i = 0; i < periods - 1; i++) schedule.push(jurosPeriodo);
    schedule.push(jurosPeriodo + capital);
    const totalAmount = schedule.reduce((a, b) => a + b, 0);
    return {
      installmentAmount: jurosPeriodo,
      totalAmount,
      totalInterest: totalAmount - capital,
      numInstallments: periods,
      schedule,
      perPeriodLabel: label,
    };
  }

  // ── price: PMT = PV * i / (1 - (1+i)^-n) ──
  if (loanMode === "price") {
    if (periods <= 0) return null;
    const i = rate / 100;
    const pmt = i === 0 ? capital / periods : (capital * i) / (1 - Math.pow(1 + i, -periods));
    const total = pmt * periods;
    return {
      installmentAmount: pmt,
      totalAmount: total,
      totalInterest: total - capital,
      numInstallments: periods,
      schedule: splitRounded(total, periods),
      perPeriodLabel: label,
    };
  }

  // ── bullet: 1 pagamento ao fim de N períodos (juros simples) ──
  if (loanMode === "bullet") {
    if (periods <= 0) return null;
    const total = capital * (1 + (rate / 100) * periods);
    return {
      installmentAmount: total,
      totalAmount: total,
      totalInterest: total - capital,
      numInstallments: 1,
      schedule: [total],
      perPeriodLabel: label,
    };
  }

  // ── grace: g períodos sem pagar (juros simples acumulam) + n parcelas iguais ──
  if (loanMode === "grace") {
    if (periods <= 0) return null;
    const capitalApos = capital * (1 + (rate / 100) * grace);
    const juros = capitalApos * (rate / 100) * periods;
    const totalPosCarencia = capitalApos + juros;
    const parcela = totalPosCarencia / periods;
    const schedule: number[] = [];
    for (let i = 0; i < grace; i++) schedule.push(0);
    for (let i = 0; i < periods; i++) schedule.push(parcela);
    const totalAmount = schedule.reduce((a, b) => a + b, 0);
    return {
      installmentAmount: parcela,
      totalAmount,
      totalInterest: totalAmount - capital,
      numInstallments: schedule.length,
      schedule,
      perPeriodLabel: label,
    };
  }

  return null;
}

/**
 * Deriva a taxa periódica (%) a partir do valor da parcela (juros simples).
 */
export function deriveRateFromInstallment(params: {
  capital: number;
  installment: number;
  periods: number;
}): number | null {
  const { capital, installment, periods } = params;
  if (capital <= 0 || installment <= 0 || periods <= 0) return null;
  const total = installment * periods;
  const juros = total - capital;
  return (juros / (capital * periods)) * 100;
}

/**
 * Gera as datas de vencimento das parcelas.
 */
export function generateInstallmentSchedule(params: {
  startDate: string;
  firstDueDate?: string;
  count: number;
  frequency: Frequency;
  dailyMode?: DailyMode;
  customDates?: (string | undefined)[];
  /** Para bullet: o único pagamento cai N períodos após a data base. */
  periodsAhead?: number;
}): string[] {
  const { startDate, firstDueDate, count, frequency, periodsAhead } = params;
  const dailyMode: DailyMode = params.dailyMode ?? "mon-fri";
  const customDates = params.customDates ?? [];

  const start = parseLocalDate(startDate);
  if (!start) return [];

  const addPeriod = (base: Date, n: number): Date => {
    if (frequency === "daily") return addBusinessDays(base, n, dailyMode);
    if (frequency === "weekly") return addDays(base, 7 * n);
    if (frequency === "biweekly") return addDays(base, 15 * n);
    return addMonthsClamped(base, n);
  };

  // Caso bullet: 1 data, N períodos no futuro
  if (periodsAhead && periodsAhead > 0 && count === 1) {
    return [addPeriod(start, periodsAhead).toISOString()];
  }

  const dates: string[] = [];

  if (frequency === "custom") {
    for (let i = 0; i < count; i++) {
      const d = customDates[i];
      const parsed = d ? parseLocalDate(d) : null;
      dates.push((parsed ?? addMonthsClamped(start, i + 1)).toISOString());
    }
    return dates;
  }

  const firstDueDateObj = parseLocalDate(firstDueDate);

  for (let i = 0; i < count; i++) {
    if (firstDueDateObj && i === 0) {
      dates.push(firstDueDateObj.toISOString());
      continue;
    }
    const base = firstDueDateObj ?? start;
    const step = firstDueDateObj ? i : i + 1;
    dates.push(addPeriod(base, step).toISOString());
  }

  return dates;
}

// ──────────────────────────────────────────────────────────────────────────
// Amortização (juros / amortização / saldo por parcela)
// ──────────────────────────────────────────────────────────────────────────

export interface AmortizationRow {
  n: number;
  payment: number;
  interest: number;
  principal: number;
  balance: number;
}

/**
 * Decompõe cada parcela em (juros, amortização, saldo devedor).
 * Funciona para todos os 6 modos. Bullet retorna 1 linha; grace inclui
 * linhas zeradas durante a carência (juros acumulando, sem pagamento).
 */
export function buildAmortization(
  result: CalculateLoanResult,
  input: CalculateLoanInput,
): AmortizationRow[] {
  const i = (input.rate ?? result.derivedRate ?? 0) / 100;
  const grace = Math.max(0, Math.floor(input.gracePeriods ?? 0));
  let balance = input.capital;
  const rows: AmortizationRow[] = [];

  if (input.loanMode === "bullet") {
    rows.push({
      n: 1,
      payment: result.schedule[0],
      interest: result.totalInterest,
      principal: input.capital,
      balance: 0,
    });
    return rows;
  }

  if (input.loanMode === "grace") {
    // Carência: juros simples acumulam, sem pagamento
    for (let k = 0; k < grace; k++) {
      const interest = input.capital * i;
      balance += interest;
      rows.push({ n: k + 1, payment: 0, interest, principal: 0, balance });
    }
    // Pós-carência: parcelas iguais (juros simples diluídos linearmente).
    // O total de juros pós-carência é (pmt * n − saldo pós-carência); distribuímos
    // igualmente por parcela para o saldo amortizar linearmente até zero e o total
    // reconciliar com result.totalInterest. (A fórmula antiga balance*i/(n−k) não
    // fechava: zerava o saldo cedo demais e subestimava os juros.)
    const remaining = result.schedule.length - grace;
    const pmt = result.schedule[grace] ?? 0;
    // Para fins contábeis, "principal devolvido" nunca pode superar o capital
    // originalmente emprestado. Os juros acumulados na carência continuam sendo
    // juros, não viram um novo aporte do usuário.
    const principalPer = remaining > 0 ? input.capital / remaining : 0;
    let principalRemaining = input.capital;
    for (let k = 0; k < remaining; k++) {
      const principal = k === remaining - 1 ? principalRemaining : principalPer;
      const interest = pmt - principal;
      principalRemaining = Math.max(0, principalRemaining - principal);
      balance = Math.max(0, balance - pmt);
      rows.push({ n: grace + k + 1, payment: pmt, interest, principal, balance });
    }
    return rows;
  }

  // Modos padrão (uniforme ou interest_only)
  result.schedule.forEach((payment, idx) => {
    let interest = 0;
    let principal = 0;

    if (input.loanMode === "price") {
      interest = balance * i;
      principal = payment - interest;
    } else if (input.loanMode === "interest_only") {
      interest = balance * i;
      principal = idx === result.schedule.length - 1 ? balance : 0;
    } else {
      // installments / percentage — juros simples diluídos linearmente
      interest = result.totalInterest / result.schedule.length;
      principal = payment - interest;
    }
    balance = Math.max(0, balance - principal);
    rows.push({ n: idx + 1, payment, interest, principal, balance });
  });
  return rows;
}

// ──────────────────────────────────────────────────────────────────────────
// Avisos inteligentes
// ──────────────────────────────────────────────────────────────────────────

export type LoanWarningLevel = "info" | "warn" | "danger";
export interface LoanWarning {
  level: LoanWarningLevel;
  title: string;
  message: string;
}

/**
 * Heurísticas de risco/sanidade para o operador.
 * Não bloqueia — apenas alerta.
 */
export function evaluateLoanWarnings(
  input: CalculateLoanInput,
  result: CalculateLoanResult | null,
): LoanWarning[] {
  const out: LoanWarning[] = [];
  if (!result) return out;

  const finite = (value: unknown) => Number.isFinite(Number(value)) ? Number(value) : 0;
  const capital = finite(input.capital);
  const totalInterest = finite(result.totalInterest);
  const rate = finite(input.rate ?? result.derivedRate);
  const f = input.frequency;
  // Taxa equivalente mensal aproximada (juros simples) p/ comparar
  const monthlyEq =
    f === "daily" ? rate * 22 :
    f === "weekly" ? rate * 4.33 :
    f === "biweekly" ? rate * 2 :
    rate;

  if (monthlyEq >= 30) {
    out.push({
      level: "danger",
      title: "Taxa muito alta",
      message: `Equivalente a ~${monthlyEq.toFixed(1)}% ao mês. Risco de inadimplência alto e questionável legalmente.`,
    });
  } else if (monthlyEq >= 20) {
    out.push({
      level: "warn",
      title: "Taxa acima do mercado",
      message: `~${monthlyEq.toFixed(1)}% ao mês. Avalie capacidade de pagamento do cliente.`,
    });
  }

  if (totalInterest > capital * 2) {
    out.push({
      level: "warn",
      title: "Juros maiores que 2× o capital",
      message: `Cliente vai pagar R$ ${totalInterest.toFixed(2)} de juros sobre R$ ${capital.toFixed(2)}.`,
    });
  }

  if (result.numInstallments > 24 && input.loanMode !== "bullet") {
    out.push({
      level: "info",
      title: "Prazo longo",
      message: `${result.numInstallments} pagamentos — monitore renegociação ao longo do contrato.`,
    });
  }

  if (input.loanMode === "interest_only") {
    out.push({
      level: "info",
      title: "Atenção: parcela final pesada",
      message: `Última parcela inclui o capital — R$ ${finite(result.schedule[result.schedule.length - 1]).toFixed(2)}.`,
    });
  }

  if (input.loanMode === "bullet") {
    out.push({
      level: "warn",
      title: "Pagamento único concentrado",
      message: "Todo o valor cai numa data só. Confirme que o cliente terá liquidez.",
    });
  }

  if (input.loanMode === "grace" && (input.gracePeriods ?? 0) > 0) {
    const totalGraceInterest = capital * (rate / 100) * finite(input.gracePeriods);
    out.push({
      level: "info",
      title: "Juros acumulam na carência",
      message: `Durante a carência o cliente não paga, mas R$ ${totalGraceInterest.toFixed(2)} de juros entram no capital.`,
    });
  }

  if (capital >= 10000) {
    out.push({
      level: "info",
      title: "Valor alto — exija garantia",
      message: "Para empréstimos acima de R$ 10k considere avalista, contrato assinado e comprovante de renda.",
    });
  }

  return out;
}

