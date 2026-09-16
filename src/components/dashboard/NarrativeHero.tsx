import { Sparkles, TrendingUp, TrendingDown, AlertCircle, Landmark, Send, Clock, Wallet, type LucideIcon } from "lucide-react";

type Props = {
  userName?: string;
  capitalOnStreet: number;      // ativo agora (contratos active + overdue)
  totalLent: number;            // histórico — soma do capital de TODOS os contratos
  pendingReceivable: number;    // soma das parcelas pendentes (o que ainda entra)
  totalReceived: number;
  totalProfit: number;
  roi: number;
  overdueAmount: number;
  overdueCount: number;
  paidTodayAmount: number;
  vencendoHoje: number;
  deltaReceived?: number;
  activeContracts: number;
  totalContracts: number;
};

const safeNumber = (value: unknown) => {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
};
const fmt = (v: number) =>
  safeNumber(v).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const fmtCompact = (v: number) => {
  v = safeNumber(v);
  if (v >= 1_000_000) return `R$ ${(v / 1_000_000).toFixed(2)}M`;
  if (v >= 10_000) return `R$ ${(v / 1_000).toFixed(1)}k`;
  return `R$ ${fmt(v)}`;
};
const boundedPercent = (value: number, total: number) =>
  total > 0 ? Math.max(0, Math.min(100, (value / total) * 100)) : 0;

/**
 * Foco: quanto está NA RUA (ativo) e quanto foi EMPRESTADO (histórico).
 * Deixa claro o que ainda vai voltar (a receber) e o que já entrou.
 */
export default function NarrativeHero({
  userName,
  capitalOnStreet,
  totalLent,
  pendingReceivable,
  totalReceived,
  totalProfit,
  roi,
  overdueAmount,
  overdueCount,
  paidTodayAmount,
  vencendoHoje,
  deltaReceived,
  activeContracts,
  totalContracts,
}: Props) {
  const primeiroNome = (userName || "").split(" ")[0] || "você";
  const safeCapitalOnStreet = safeNumber(capitalOnStreet);
  const safeTotalLent = safeNumber(totalLent);
  const safeTotalReceived = safeNumber(totalReceived);
  const safeOverdueAmount = safeNumber(overdueAmount);
  const safeRoi = safeNumber(roi);
  const healthy = safeOverdueAmount === 0 || (safeCapitalOnStreet > 0 && safeOverdueAmount < safeCapitalOnStreet * 0.05);
  const healthPct = safeCapitalOnStreet > 0
    ? Math.max(0, Math.min(100, 100 - (safeOverdueAmount / safeCapitalOnStreet) * 100))
    : 100;
  const returnedPct = boundedPercent(safeTotalReceived, safeTotalLent);
  const overduePct = boundedPercent(safeOverdueAmount, safeCapitalOnStreet);
  // ROI só faz sentido quando existe base
  const showROI = safeRoi > 0 && safeTotalLent > 0;

  const deltaTxt =
    typeof deltaReceived === "number" && isFinite(deltaReceived)
      ? `${deltaReceived >= 0 ? "▲" : "▼"} ${Math.abs(deltaReceived).toFixed(1)}% vs período anterior`
      : null;

  const nada = safeTotalLent === 0 && safeCapitalOnStreet === 0;

  return (
    <div className="overflow-hidden rounded-2xl border border-white/[.08] bg-card/55 p-5 backdrop-blur-xl animate-fade-in md:p-6">
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1.35fr_1fr] lg:gap-8">
        {/* ─── Coluna narrativa ─── */}
        <div className="space-y-5">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 border border-primary/20">
            <Sparkles size={12} className="text-primary" />
            <span className="text-[10px] font-bold uppercase tracking-widest text-primary">
              Resumo executivo
            </span>
          </div>

          {nada ? (
            <p className="text-2xl md:text-3xl font-bold leading-tight text-foreground">
              {primeiroNome}, sua carteira ainda está vazia. Cadastre seu primeiro empréstimo para começar a acompanhar o dinheiro na rua.
            </p>
          ) : (
            <>
              <p className="text-2xl md:text-3xl font-bold leading-tight text-foreground tracking-tight">
                {primeiroNome}, você tem{" "}
                <span className="text-primary">R$ {fmt(capitalOnStreet)}</span>{" "}
                <span className="opacity-80">circulando na rua</span>
                {safeTotalLent > safeCapitalOnStreet && (
                  <>
                    {" "}de um total de{" "}
                    <span className="text-foreground">R$ {fmt(totalLent)}</span>{" "}
                    <span className="opacity-80">já emprestados</span>
                  </>
                )}
                .
              </p>

              <p className="text-sm md:text-base text-muted-foreground leading-relaxed">
                Ainda tem <strong className="text-primary">R$ {fmt(pendingReceivable)}</strong> a receber
                {" "}e já entrou <strong className="text-foreground">R$ {fmt(totalReceived)}</strong> no caixa
                {totalProfit > 0 && (
                  <>, sendo <strong className="text-success">R$ {fmt(totalProfit)}</strong> de lucro</>
                )}
                {showROI && (
                  <> — retorno de <strong className="text-success">{safeRoi.toFixed(1)}%</strong></>
                )}
                .{" "}
                {safeOverdueAmount > 0 ? (
                  <>
                    Há <strong className="text-destructive">R$ {fmt(overdueAmount)}</strong> em atraso
                    ({overdueCount} parcela{overdueCount === 1 ? "" : "s"}) — vale priorizar hoje.
                  </>
                ) : (
                  <>Sua carteira está <strong className="text-success">100% em dia</strong>. Excelente sinal.</>
                )}
              </p>
            </>
          )}

          {/* ─── Breakdown financeiro: 4 pilares ─── */}
          {!nada && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5 pt-1">
              <MiniStat
                icon={Landmark}
                label="Na rua"
                value={fmtCompact(capitalOnStreet)}
                sub={`${activeContracts} ativo${activeContracts === 1 ? "" : "s"}`}
                tone="primary"
              />
              <MiniStat
                icon={Send}
                label="Emprestado"
                value={fmtCompact(totalLent)}
                sub={`${totalContracts} contrato${totalContracts === 1 ? "" : "s"}`}
                tone="indigo"
              />
              <MiniStat
                icon={Clock}
                label="A receber"
                value={fmtCompact(pendingReceivable)}
                sub="parcelas pendentes"
                tone="warning"
              />
              <MiniStat
                icon={Wallet}
                label="Recebido"
                value={fmtCompact(totalReceived)}
                sub={totalProfit > 0 ? `+${fmtCompact(totalProfit)} lucro` : "no caixa"}
                tone="success"
              />
            </div>
          )}

          {/* mini highlights (chips) */}
          {(paidTodayAmount > 0 || vencendoHoje > 0 || deltaTxt) && (
            <div className="flex flex-wrap gap-2 pt-1">
              {paidTodayAmount > 0 && (
                <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-success/10 border border-success/20 text-[11px] font-semibold text-success">
                  <TrendingUp size={11} /> Hoje: +R$ {fmt(paidTodayAmount)}
                </span>
              )}
              {vencendoHoje > 0 && (
                <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-warning/10 border border-warning/20 text-[11px] font-semibold text-warning">
                  {vencendoHoje} vencendo hoje
                </span>
              )}
              {deltaTxt && (
                <span
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-[11px] font-semibold ${
                    (deltaReceived ?? 0) >= 0
                      ? "bg-success/10 border-success/20 text-success"
                      : "bg-destructive/10 border-destructive/20 text-destructive"
                  }`}
                >
                  {(deltaReceived ?? 0) >= 0 ? <TrendingUp size={11} /> : <TrendingDown size={11} />}
                  {deltaTxt}
                </span>
              )}
            </div>
          )}
        </div>

        {/* ─── Coluna saúde da carteira ─── */}
        <div className="rounded-3xl border border-border/40 bg-card/50 backdrop-blur p-5 space-y-5">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              Saúde da carteira
            </span>
            <div className={`w-2 h-2 rounded-full ${healthy ? "bg-success" : "bg-destructive"}`} />
          </div>

          <div>
            <div className="flex items-baseline justify-between mb-2">
              <span className="text-xs text-muted-foreground">Em dia</span>
              <span className={`text-3xl font-black tabular-nums ${healthy ? "text-success" : "text-destructive"}`}>
                {healthPct.toFixed(0)}%
              </span>
            </div>
            <div className="h-2.5 rounded-full bg-muted/40 overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-700 ${
                  healthy
                    ? "bg-gradient-to-r from-success/70 to-success"
                    : "bg-gradient-to-r from-destructive/70 to-destructive"
                }`}
                style={{ width: `${Math.max(4, healthPct)}%` }}
              />
            </div>
          </div>

          {/* Divisão: quanto ainda está fora vs quanto voltou */}
          {safeTotalLent > 0 && (
            <div className="pt-1 space-y-2">
              <div className="flex items-center justify-between text-[11px]">
                <span className="text-muted-foreground">Já retornou ao caixa</span>
                <span className="font-bold text-success tabular-nums">
                  {returnedPct.toFixed(0)}%
                </span>
              </div>
              <div className="h-1.5 rounded-full bg-muted/40 overflow-hidden">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-success/60 to-success transition-all duration-700"
                  style={{ width: `${returnedPct}%` }}
                />
              </div>
            </div>
          )}

          {safeOverdueAmount > 0 && safeCapitalOnStreet > 0 && (
            <div className="flex items-start gap-2 pt-1 text-[11px] text-muted-foreground">
              <AlertCircle size={12} className="text-destructive shrink-0 mt-0.5" />
              <span>
                <strong className="text-destructive">
                  {overduePct.toFixed(1)}%
                </strong>{" "}
                da carteira ativa precisa de cobrança
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ─── MiniStat: micro-card usado no breakdown ─── */
function MiniStat({
  icon: Icon,
  label,
  value,
  sub,
  tone,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  sub: string;
  tone: "primary" | "success" | "warning" | "indigo";
}) {
  const toneMap = {
    primary: { text: "text-primary",       bg: "bg-primary/10",       ring: "ring-primary/20" },
    success: { text: "text-success",       bg: "bg-success/10",       ring: "ring-success/20" },
    warning: { text: "text-warning",       bg: "bg-warning/10",       ring: "ring-warning/20" },
    indigo:  { text: "text-indigo-400",    bg: "bg-indigo-500/10",    ring: "ring-indigo-500/20" },
  }[tone];

  return (
    <div className={`rounded-2xl border border-border/40 bg-background/40 backdrop-blur p-3 ring-1 ${toneMap.ring} hover:-translate-y-0.5 transition-transform`}>
      <div className="flex items-center gap-2 mb-1.5">
        <div className={`w-7 h-7 rounded-lg ${toneMap.bg} flex items-center justify-center`}>
          <Icon size={13} className={toneMap.text} />
        </div>
        <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{label}</span>
      </div>
      <p className={`text-base font-bold tabular-nums ${toneMap.text}`}>{value}</p>
      <p className="text-[10px] text-muted-foreground/80 truncate">{sub}</p>
    </div>
  );
}
