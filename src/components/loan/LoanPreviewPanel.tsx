import { useMemo, useState } from "react";
import {
  Calendar, AlertTriangle, Info, ShieldAlert, TrendingDown,
  CalendarOff, Wand2, ChevronDown,
} from "lucide-react";
import {
  buildAmortization, evaluateLoanWarnings,
  type CalculateLoanInput, type CalculateLoanResult,
} from "@/lib/loanMath";
import {
  formatBR, isWeekend, isBrazilianHoliday, nextBusinessDay,
  toDateInputValue, parseLocalDate,
} from "@/lib/dateUtils";

type Tab = "summary" | "schedule" | "warnings";

interface Props {
  input: CalculateLoanInput;
  result: CalculateLoanResult | null;
  /** ISO dates (uma por parcela, mesma length de result.schedule). */
  dueDates: string[];
  /** Quando definido, datas tornam-se editáveis. */
  onDueDatesChange?: (next: string[]) => void;
  /** Cabeçalho compacto (esconde os totais grandes). */
  compact?: boolean;
}

const fmt = (v: number) => {
  const number = Number(v);
  return (Number.isFinite(number) ? number : 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

const dayBadge = (iso: string) => {
  if (isBrazilianHoliday(iso)) return { label: "Feriado", cls: "bg-destructive/15 text-destructive" };
  if (isWeekend(iso)) return { label: "Fim de semana", cls: "bg-warning/15 text-warning" };
  return null;
};

const levelStyle: Record<string, { cls: string; Icon: any }> = {
  danger: { cls: "border-destructive/40 bg-destructive/5 text-destructive", Icon: ShieldAlert },
  warn:   { cls: "border-warning/40 bg-warning/5 text-warning", Icon: AlertTriangle },
  info:   { cls: "border-primary/30 bg-primary/5 text-primary", Icon: Info },
};

export default function LoanPreviewPanel({
  input, result, dueDates, onDueDatesChange, compact,
}: Props) {
  const [tab, setTab] = useState<Tab>("summary");
  const [open, setOpen] = useState(true);

  const rows = useMemo(
    () => (result ? buildAmortization(result, input) : []),
    [result, input],
  );
  const warnings = useMemo(
    () => evaluateLoanWarnings(input, result),
    [input, result],
  );
  const editable = !!onDueDatesChange;
  const dangerCount = warnings.filter(w => w.level === "danger").length;
  const warnCount = warnings.filter(w => w.level === "warn").length;

  const setDate = (idx: number, value: string) => {
    if (!onDueDatesChange) return;
    const next = [...dueDates];
    next[idx] = value ? parseLocalDate(value)?.toISOString() ?? value : "";
    onDueDatesChange(next);
  };

  const fixAllNonBusiness = () => {
    if (!onDueDatesChange) return;
    onDueDatesChange(
      dueDates.map(iso => (iso && (isWeekend(iso) || isBrazilianHoliday(iso))
        ? nextBusinessDay(iso).toISOString()
        : iso))
    );
  };

  if (!result) return null;

  const nonBusinessCount = dueDates.filter(d => d && (isWeekend(d) || isBrazilianHoliday(d))).length;

  return (
    <div className="rounded-2xl border border-border bg-card overflow-hidden">
      {/* Header */}
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full px-5 py-3 border-b border-border flex items-center justify-between gap-2"
      >
        <div className="flex items-center gap-2">
          <Calendar size={15} className="text-primary" />
          <h2 className="font-semibold text-foreground text-sm">Pré-visualização do empréstimo</h2>
        </div>
        <div className="flex items-center gap-2">
          {dangerCount + warnCount > 0 && (
            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
              dangerCount > 0 ? "bg-destructive/15 text-destructive" : "bg-warning/15 text-warning"
            }`}>
              {dangerCount + warnCount} aviso{dangerCount + warnCount > 1 ? "s" : ""}
            </span>
          )}
          <ChevronDown size={14} className={`text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} />
        </div>
      </button>

      {open && (
        <>
          {/* Tabs */}
          <div className="flex border-b border-border bg-muted/20">
            {([
              { v: "summary" as Tab, label: "Resumo" },
              { v: "schedule" as Tab, label: `Cronograma (${rows.length})` },
              { v: "warnings" as Tab, label: `Avisos (${warnings.length})` },
            ]).map(t => (
              <button
                key={t.v}
                type="button"
                onClick={() => setTab(t.v)}
                className={`flex-1 text-xs font-semibold py-2.5 transition-colors ${
                  tab === t.v
                    ? "text-primary border-b-2 border-primary bg-card"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          {/* SUMMARY */}
          {tab === "summary" && (
            <div className="p-5 space-y-4">
              {!compact && (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {[
                    { label: "Capital", value: `R$ ${fmt(input.capital)}` },
                    { label: "Juros total", value: `R$ ${fmt(result.totalInterest)}`, color: "text-primary" },
                    { label: "Total a receber", value: `R$ ${fmt(result.totalAmount)}`, color: "text-success" },
                    { label: `Parcela / ${result.perPeriodLabel}`, value: `R$ ${fmt(result.installmentAmount)}` },
                  ].map(c => (
                    <div key={c.label} className="space-y-0.5">
                      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{c.label}</p>
                      <p className={`text-base font-bold ${c.color ?? "text-foreground"}`}>{c.value}</p>
                    </div>
                  ))}
                </div>
              )}
              {/* Lucro % barra */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-[10px] uppercase tracking-wider text-muted-foreground">
                  <span>Lucro sobre capital</span>
                  <span className="font-bold text-success">
                    {((Number.isFinite(result.totalInterest) ? result.totalInterest : 0) / Math.max(Number.isFinite(input.capital) ? input.capital : 0, 1) * 100).toFixed(1)}%
                  </span>
                </div>
                <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                  <div
                    className="h-full bg-linear-to-r from-primary to-success"
                    style={{ width: `${Math.min(200, (result.totalInterest / Math.max(input.capital, 1)) * 100) / 2}%` }}
                  />
                </div>
              </div>
              {nonBusinessCount > 0 && (
                <div className="flex items-center justify-between gap-3 px-3 py-2 rounded-lg bg-warning/5 border border-warning/30">
                  <div className="flex items-center gap-2 text-xs text-warning">
                    <CalendarOff size={14} />
                    {nonBusinessCount} vencimento{nonBusinessCount > 1 ? "s" : ""} em fim de semana ou feriado
                  </div>
                  {editable && (
                    <button
                      type="button"
                      onClick={fixAllNonBusiness}
                      className="text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full bg-warning text-warning-foreground hover:opacity-90"
                    >
                      <Wand2 size={10} className="inline mr-1" /> Ajustar
                    </button>
                  )}
                </div>
              )}
            </div>
          )}

          {/* SCHEDULE */}
          {tab === "schedule" && (
            <div className="overflow-x-auto max-h-[420px]">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-muted/40 backdrop-blur-sm z-10">
                  <tr className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    <th className="text-left px-3 py-2 font-semibold">#</th>
                    <th className="text-left px-3 py-2 font-semibold">Vencimento</th>
                    <th className="text-right px-3 py-2 font-semibold">Pagamento</th>
                    <th className="text-right px-3 py-2 font-semibold hidden sm:table-cell">Juros</th>
                    <th className="text-right px-3 py-2 font-semibold hidden sm:table-cell">Amortização</th>
                    <th className="text-right px-3 py-2 font-semibold">Saldo</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/40">
                  {rows.map((r, idx) => {
                    const iso = dueDates[idx];
                    const badge = iso ? dayBadge(iso) : null;
                    const isGrace = r.payment === 0;
                    return (
                      <tr key={idx} className={isGrace ? "bg-muted/30" : "hover:bg-muted/20"}>
                        <td className="px-3 py-2 font-bold text-primary">{r.n}</td>
                        <td className="px-3 py-2">
                          {editable ? (
                            <div className="flex items-center gap-1.5">
                              <input
                                type="date"
                                value={iso ? toDateInputValue(iso) : ""}
                                onChange={(e) => setDate(idx, e.target.value)}
                                className="bg-background border border-border rounded px-1.5 py-0.5 text-xs focus:outline-hidden focus:border-primary"
                              />
                              {badge && (
                                <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded-full ${badge.cls}`}>
                                  {badge.label}
                                </span>
                              )}
                            </div>
                          ) : (
                            <div className="flex items-center gap-1.5">
                              <span className="text-foreground">{iso ? formatBR(iso) : "—"}</span>
                              {badge && (
                                <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded-full ${badge.cls}`}>
                                  {badge.label}
                                </span>
                              )}
                            </div>
                          )}
                        </td>
                        <td className="px-3 py-2 text-right font-semibold text-foreground">
                          {isGrace ? <span className="text-muted-foreground italic">Carência</span> : `R$ ${fmt(r.payment)}`}
                        </td>
                        <td className="px-3 py-2 text-right text-muted-foreground hidden sm:table-cell">
                          R$ {fmt(r.interest)}
                        </td>
                        <td className="px-3 py-2 text-right text-muted-foreground hidden sm:table-cell">
                          R$ {fmt(r.principal)}
                        </td>
                        <td className="px-3 py-2 text-right text-primary font-semibold">
                          R$ {fmt(r.balance)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot className="sticky bottom-0 bg-muted/40 backdrop-blur-sm">
                  <tr className="text-[11px] font-bold">
                    <td colSpan={2} className="px-3 py-2 text-muted-foreground uppercase tracking-wider text-[10px]">Totais</td>
                    <td className="px-3 py-2 text-right text-success">R$ {fmt(result.totalAmount)}</td>
                    <td className="px-3 py-2 text-right text-primary hidden sm:table-cell">R$ {fmt(result.totalInterest)}</td>
                    <td className="px-3 py-2 text-right text-foreground hidden sm:table-cell">R$ {fmt(input.capital)}</td>
                    <td className="px-3 py-2 text-right text-foreground">—</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}

          {/* WARNINGS */}
          {tab === "warnings" && (
            <div className="p-5 space-y-2.5">
              {warnings.length === 0 ? (
                <div className="text-center py-8">
                  <TrendingDown size={28} className="mx-auto text-success mb-2" />
                  <p className="text-sm font-semibold text-foreground">Tudo certo</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Nenhum risco detectado para esses parâmetros.
                  </p>
                </div>
              ) : (
                warnings.map((w, i) => {
                  const { cls, Icon } = levelStyle[w.level];
                  return (
                    <div key={i} className={`rounded-xl border px-3.5 py-2.5 flex gap-2.5 ${cls}`}>
                      <Icon size={16} className="shrink-0 mt-0.5" />
                      <div className="min-w-0">
                        <p className="text-xs font-bold">{w.title}</p>
                        <p className="text-[11px] opacity-90 leading-snug">{w.message}</p>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
