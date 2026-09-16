import { AlertTriangle, ShieldCheck, ShieldAlert, TrendingDown } from "lucide-react";

export type RiskLevel = "baixo" | "medio" | "alto" | "critico";

export function riskFromScore(score: number | null | undefined): RiskLevel {
  const s = Number(score ?? 0);
  const normalized = Number.isFinite(s) ? Math.max(0, Math.min(100, s)) : 0;
  if (normalized >= 75) return "baixo";
  if (normalized >= 50) return "medio";
  if (normalized >= 25) return "alto";
  return "critico";
}

const CFG: Record<RiskLevel, { label: string; cls: string; icon: React.ComponentType<any> }> = {
  baixo:    { label: "Baixo risco",    cls: "bg-emerald-500/10 text-emerald-500 ring-emerald-500/20",    icon: ShieldCheck },
  medio:    { label: "Médio risco",    cls: "bg-amber-500/10 text-amber-500 ring-amber-500/20",           icon: TrendingDown },
  alto:     { label: "Alto risco",     cls: "bg-orange-500/10 text-orange-500 ring-orange-500/20",        icon: ShieldAlert },
  critico:  { label: "Risco crítico",  cls: "bg-destructive/10 text-destructive ring-destructive/20",     icon: AlertTriangle },
};

/** Badge preditivo de inadimplência derivado do credit_score (0-100). */
export default function RiskBadge({ score, compact = false }: { score: number | null | undefined; compact?: boolean }) {
  const normalizedScore = Number.isFinite(Number(score)) ? Math.max(0, Math.min(100, Number(score))) : 0;
  const level = riskFromScore(normalizedScore);
  const { label, cls, icon: Icon } = CFG[level];
  return (
    <span
      title={`${label} — score ${normalizedScore}/100`}
      className={`inline-flex items-center gap-1 rounded-md ring-1 font-semibold ${cls} ${compact ? "px-1.5 py-0.5 text-[9px]" : "px-2 py-0.5 text-[10px]"}`}
    >
      <Icon size={compact ? 9 : 10} />
      {compact ? label.split(" ")[0] : label}
    </span>
  );
}
