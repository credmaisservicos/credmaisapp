/**
 * Cálculo do valor de "pagar só juros" de uma parcela.
 *
 * Regra do negócio: o cliente pode quitar apenas o rendimento do período
 * (juros do contrato + juros/multa de atraso, quando informados) e manter o
 * capital principal pendente para o próximo vencimento.
 *
 * Usa a decomposição gravada de cada parcela quando disponível (Price/carência)
 * e mantém os cálculos por modo para contratos antigos sem essa decomposição.
 */
export function interestOnlyAmount(
  inst: {
    amount?: number | string | null;
    scheduled_interest?: number | string | null;
    installment_number?: number | string | null;
  },
  contract?: {
    capital?: number | string | null;
    total_amount?: number | string | null;
    total_interest?: number | string | null;
    interest_rate?: number | string | null;
    num_installments?: number | string | null;
    installment_amount?: number | string | null;
    grace_periods?: number | string | null;
    loan_mode?: string | null;
  } | null,
  extraLateInterest = 0,
): number {
  const finite = (value: unknown) => Number.isFinite(Number(value ?? 0)) ? Number(value ?? 0) : 0;
  const instAmount = finite(inst?.amount);
  if (!contract) return 0;

  const mode = String(contract.loan_mode || "installments").toLowerCase();
  const n = finite(contract.num_installments);
  const capital = finite(contract.capital);
  const totalAmount = finite(contract.total_amount);
  const totalInterest =
    finite(contract.total_interest) || Math.max(0, totalAmount - capital);

  let base: number;
  if (mode === "bullet") {
    base = totalInterest;
  } else if (mode === "percentage" || mode === "interest_only") {
    base = capital * (finite(contract.interest_rate) / 100);
  } else if (finite(inst?.scheduled_interest) > 0) {
    base = finite(inst.scheduled_interest);
  } else if (mode === "price" && n > 0) {
    const rate = Math.max(0, finite(contract.interest_rate)) / 100;
    const periodsElapsed = Math.max(0, Math.floor(finite(inst?.installment_number) - 1));
    const payment = finite(contract.installment_amount) || instAmount;
    if (rate === 0) {
      base = 0;
    } else {
      const growth = Math.pow(1 + rate, periodsElapsed);
      const balanceBeforePayment = Math.max(0, capital * growth - payment * ((growth - 1) / rate));
      base = balanceBeforePayment * rate;
    }
  } else if (mode === "grace" && n > 0) {
    const gracePeriods = Math.max(0, Math.floor(finite(contract.grace_periods)));
    const installmentNumber = Math.max(1, Math.floor(finite(inst?.installment_number)));
    const remainingPayments = n - gracePeriods;
    const payment = finite(contract.installment_amount) || instAmount;
    base = installmentNumber <= gracePeriods
      ? capital * (Math.max(0, finite(contract.interest_rate)) / 100)
      : remainingPayments > 0 ? payment - capital / remainingPayments : totalInterest / n;
  } else if (n <= 0) {
    base = Math.min(instAmount, totalInterest || instAmount);
  } else {
    base = totalInterest / n;
  }

  const extra = Math.max(0, finite(extraLateInterest));
  const value = Math.max(0, finite(base)) + extra;
  return Math.round(Math.min(value, instAmount + extra) * 100) / 100;
}

const INTEREST_ONLY_RENEWAL_MODES = new Set([
  "installments",
  "percentage",
  "interest_only",
  "price",
  "bullet",
  "grace",
]);

/** Indica se o modo do contrato aceita renovar o vencimento pagando só juros. */
export function supportsInterestOnlyRenewal(mode: unknown): boolean {
  return INTEREST_ONLY_RENEWAL_MODES.has(String(mode || "installments").toLowerCase());
}

/** true quando o erro do PostgREST é "RPC não existe no schema cache". */
export function isMissingRpcError(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  return error.code === "PGRST202" || /schema cache|could not find the function/i.test(error.message || "");
}

/** Próximo vencimento da renovação, respeitando a frequência do contrato. */
export function nextInterestDueDate(
  currentDueDate: string,
  frequency?: string | null,
  reference = new Date(),
): string {
  const raw = String(currentDueDate || "").slice(0, 10);
  const [year, month, day] = raw.split("-").map(Number);
  const next = year && month && day
    ? new Date(year, month - 1, day, 12)
    : new Date(reference.getFullYear(), reference.getMonth(), reference.getDate(), 12);

  const addCycle = () => {
    const freq = String(frequency || "monthly");
    if (freq === "weekly") next.setDate(next.getDate() + 7);
    else if (freq === "biweekly" || freq === "fortnightly") next.setDate(next.getDate() + 14);
    else if (freq === "daily_mon-fri" || freq === "daily-mon-fri") {
      do { next.setDate(next.getDate() + 1); } while (next.getDay() === 0 || next.getDay() === 6);
    } else if (freq === "daily_mon-sat" || freq === "daily-mon-sat") {
      do { next.setDate(next.getDate() + 1); } while (next.getDay() === 0);
    } else if (freq.startsWith("daily")) next.setDate(next.getDate() + 1);
    else {
      const originalDay = next.getDate();
      next.setDate(1);
      next.setMonth(next.getMonth() + 1);
      const lastDay = new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate();
      next.setDate(Math.min(originalDay, lastDay));
    }
  };

  const today = new Date(reference.getFullYear(), reference.getMonth(), reference.getDate());
  do { addCycle(); } while (next.getTime() <= today.getTime());

  const y = next.getFullYear();
  const m = String(next.getMonth() + 1).padStart(2, "0");
  const d = String(next.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
