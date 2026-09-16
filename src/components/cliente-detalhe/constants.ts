import { Hash, Percent, Coins, TrendingDown, Target, PauseCircle } from "lucide-react";
import type { LoanMode } from "@/lib/loanMath";

export const LOAN_MODES: { v: LoanMode; label: string; desc: string; Icon: any }[] = [
  { v: "installments", label: "Por Parcelas", desc: "Parcelas iguais (juros simples)", Icon: Hash },
  { v: "percentage", label: "Por Porcentagem", desc: "Paga % até quitar", Icon: Percent },
  { v: "interest_only", label: "Só Juros + Capital no Fim", desc: "Juros por período, capital na última", Icon: Coins },
  { v: "price", label: "Juros Compostos (Price)", desc: "PMT fixo com amortização", Icon: TrendingDown },
  { v: "bullet", label: "Pagamento Único", desc: "Tudo numa data futura", Icon: Target },
  { v: "grace", label: "Com Carência", desc: "X períodos sem pagar", Icon: PauseCircle },
];

export const fmt = (v: number) => {
  const value = Number(v);
  return (Number.isFinite(value) ? value : 0).toLocaleString("pt-BR", { minimumFractionDigits: 2 });
};
export const FREQ: Record<string, string> = { daily: "Diário", weekly: "Semanal", biweekly: "Quinzenal", monthly: "Mensal", custom: "Personalizado" };
export const DAILY_MODES: Record<string, string> = { "mon-fri": "Seg → Sex", "mon-sat": "Seg → Sáb", "mon-sun": "Todos os dias" };
export const formatFrequency = (value?: string | null) => {
  const raw = String(value || "monthly");
  if (raw.startsWith("daily_")) return `Diário · ${DAILY_MODES[raw.slice(6)] || raw.slice(6)}`;
  return FREQ[raw] || raw;
};
export const INPUT = "w-full px-3 py-2.5 rounded-lg bg-card border border-border text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring";
