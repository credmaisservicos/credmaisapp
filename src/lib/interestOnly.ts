/**
 * Cálculo do valor de "pagar só juros" de uma parcela.
 *
 * Regra do negócio: o cliente pode quitar apenas o rendimento do período
 * (juros do contrato + juros/multa de atraso, quando informados) e manter o
 * capital principal pendente para o próximo vencimento.
 *
 * Funciona para todos os tipos de empréstimo:
 * - parcelado (installments/price): juros totais divididos pelo nº de parcelas
 * - porcentagem / só juros / bullet: a própria parcela já é o rendimento
 */
export function interestOnlyAmount(
  inst: { amount?: number | string | null },
  contract?: {
    capital?: number | string | null;
    total_amount?: number | string | null;
    total_interest?: number | string | null;
    interest_rate?: number | string | null;
    num_installments?: number | string | null;
    loan_mode?: string | null;
  } | null,
  extraLateInterest = 0,
): number {
  const finite = (value: unknown) => Number.isFinite(Number(value ?? 0)) ? Number(value ?? 0) : 0;
  const instAmount = finite(inst?.amount);
  if (!contract) return 0;

  const mode = contract.loan_mode || "installments";
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
  } else if (n <= 0) {
    base = Math.min(instAmount, totalInterest || instAmount);
  } else {
    base = totalInterest / n;
  }

  const extra = Math.max(0, finite(extraLateInterest));
  const value = Math.max(0, finite(base)) + extra;
  return Math.round(Math.min(value, instAmount + extra) * 100) / 100;
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
