import { Sparkles, TrendingUp, TrendingDown } from "lucide-react";

type Props = {
  periodLabel: string;
  totalReceived: number;
  totalProfit: number;
  deltaReceived: number;
  deltaProfit: number;
  paidCount: number;
  newContracts: number;
  overdueAmount: number;
  overdueCount: number;
  forecast30: number;
};

const safeNumber = (value: unknown) => {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
};

const fmt = (v: unknown) =>
  safeNumber(v).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * Bloco de storytelling que abre a página de Análises — explica em uma frase
 * o momento do período selecionado e o que veio depois.
 */
export default function AnaliseNarrative({
  periodLabel,
  totalReceived,
  totalProfit,
  deltaReceived,
  deltaProfit,
  paidCount,
  newContracts,
  overdueAmount,
  overdueCount,
  forecast30,
}: Props) {
  const receivedDelta = safeNumber(deltaReceived);
  const profitDelta = safeNumber(deltaProfit);
  const goodReceived = receivedDelta >= 0;
  const goodProfit = profitDelta >= 0;

  const veredicto =
    profitDelta > 10
      ? "Período de alta — mantenha o ritmo de novos contratos."
      : deltaProfit >= 0
        ? "Período estável, seguindo a média."
        : "Período abaixo do anterior — vale revisar a régua de cobrança.";

  return (
    <div className="relative overflow-hidden rounded-[32px] border border-primary/15 bg-gradient-to-br from-primary/[0.06] via-card/50 to-card/20 backdrop-blur-xl p-6 md:p-7 shadow-xl animate-fade-in">
      <div className="pointer-events-none absolute -top-20 -right-16 w-64 h-64 rounded-full bg-primary/15 blur-3xl opacity-40" />

      <div className="relative z-10 space-y-4">
        <div className="flex items-center gap-2">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 border border-primary/20">
            <Sparkles size={12} className="text-primary" />
            <span className="text-[10px] font-bold uppercase tracking-widest text-primary">
              O que aconteceu · {periodLabel}
            </span>
          </div>
        </div>

        <p className="text-headline text-xl md:text-2xl leading-snug text-foreground">
          Você recebeu{" "}
          <span className="text-success">R$ {fmt(totalReceived)}</span>{" "}
          <span
            className={`inline-flex items-center gap-1 text-sm font-bold px-2 py-0.5 rounded-lg align-middle ${
              goodReceived ? "bg-success/10 text-success" : "bg-destructive/10 text-destructive"
            }`}
          >
            {goodReceived ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
            {Math.abs(receivedDelta).toFixed(1)}%
          </span>{" "}
          e lucrou{" "}
          <span className="text-primary">R$ {fmt(totalProfit)}</span>{" "}
          <span
            className={`inline-flex items-center gap-1 text-sm font-bold px-2 py-0.5 rounded-lg align-middle ${
              goodProfit ? "bg-success/10 text-success" : "bg-destructive/10 text-destructive"
            }`}
          >
            {goodProfit ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
            {Math.abs(profitDelta).toFixed(1)}%
          </span>
          .
        </p>

        <p className="text-sm text-muted-foreground leading-relaxed">
          Foram <strong className="text-foreground">{paidCount}</strong> parcelas pagas e{" "}
          <strong className="text-foreground">{newContracts}</strong> novos contratos criados.{" "}
          {overdueAmount > 0 ? (
            <>
              Ainda há <strong className="text-destructive">R$ {fmt(overdueAmount)}</strong> em{" "}
              atraso ({overdueCount} parcelas). Nos próximos 30 dias, a previsão é receber{" "}
              <strong className="text-info">R$ {fmt(forecast30)}</strong>.
            </>
          ) : (
            <>
              Sua carteira está <strong className="text-success">100% em dia</strong>. Nos próximos
              30 dias, a previsão é receber{" "}
              <strong className="text-info">R$ {fmt(forecast30)}</strong>.
            </>
          )}
        </p>

        <div className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-card/60 border border-border/40 text-xs font-medium text-foreground">
          <span className="text-lg">{deltaProfit >= 0 ? "📈" : "📉"}</span>
          {veredicto}
        </div>
      </div>
    </div>
  );
}
