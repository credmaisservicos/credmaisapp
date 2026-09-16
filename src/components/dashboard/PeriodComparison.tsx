import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Minus, TrendingUp } from "lucide-react";
import { parseLocalDate } from "@/lib/dateUtils";

type Props = {
  installments: any[];
};

type Period = "7d" | "30d" | "90d";
const OPTIONS: { v: Period; label: string; days: number }[] = [
  { v: "7d", label: "7 dias", days: 7 },
  { v: "30d", label: "30 dias", days: 30 },
  { v: "90d", label: "90 dias", days: 90 },
];

const safeNumber = (value: unknown) => {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
};
const fmt = (v: number) => safeNumber(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

export default function PeriodComparison({ installments }: Props) {
  const [period, setPeriod] = useState<Period>("30d");
  const cfg = OPTIONS.find((o) => o.v === period)!;

  const stats = useMemo(() => {
    const now = new Date();
    const windowMs = cfg.days * 86400000;
    const currentStart = new Date(now.getTime() - windowMs);
    const previousStart = new Date(now.getTime() - 2 * windowMs);

    const sumPaid = (from: Date, to: Date) =>
      installments
        .filter((i) => { const date = parseLocalDate(i.paid_at); return i.status === "paid" && !!date && date >= from && date < to; })
        .reduce((s, i) => s + safeNumber(i.paid_amount || i.amount), 0);

    const countPaid = (from: Date, to: Date) =>
      installments.filter((i) => { const date = parseLocalDate(i.paid_at); return i.status === "paid" && !!date && date >= from && date < to; }).length;

    const current = sumPaid(currentStart, now);
    const previous = sumPaid(previousStart, currentStart);
    const currentN = countPaid(currentStart, now);
    const previousN = countPaid(previousStart, currentStart);

    const variation = previous > 0 ? ((current - previous) / previous) * 100 : current > 0 ? 100 : 0;
    const variationN = previousN > 0 ? ((currentN - previousN) / previousN) * 100 : currentN > 0 ? 100 : 0;
    const avgTicketCurrent = currentN > 0 ? current / currentN : 0;
    const avgTicketPrevious = previousN > 0 ? previous / previousN : 0;
    const avgVar = avgTicketPrevious > 0 ? ((avgTicketCurrent - avgTicketPrevious) / avgTicketPrevious) * 100 : 0;

    return { current, previous, variation, currentN, previousN, variationN, avgTicketCurrent, avgVar };
  }, [installments, cfg]);

  const Trend = ({ v }: { v: number }) => {
    if (Math.abs(v) < 0.5) return <span className="inline-flex items-center gap-1 text-muted-foreground text-[10px] font-bold"><Minus size={10} /> 0%</span>;
    const up = v > 0;
    return (
      <span className={`inline-flex items-center gap-1 text-[10px] font-bold ${up ? "text-success" : "text-destructive"}`}>
        {up ? <ArrowUp size={10} /> : <ArrowDown size={10} />} {Math.abs(v).toFixed(1)}%
      </span>
    );
  };

  return (
    <div className="premium-card p-5 animate-fade-in">
      <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-2xl bg-primary/10 flex items-center justify-center">
            <TrendingUp size={14} className="text-primary" />
          </div>
          <h3 className="text-headline text-sm text-foreground">Comparativo de Períodos</h3>
        </div>
        <div className="inline-flex items-center gap-1 p-1 rounded-full glass-card">
          {OPTIONS.map((o) => (
            <button
              type="button"
              key={o.v}
              onClick={() => setPeriod(o.v)}
              className={`px-3 py-1.5 rounded-full text-[10px] font-semibold uppercase tracking-wider transition-all ${
                period === o.v ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="space-y-1">
          <p className="text-label">Recebido</p>
          <div className="flex items-baseline gap-2">
            <p className="text-headline text-xl text-foreground">{fmt(stats.current)}</p>
            <Trend v={stats.variation} />
          </div>
          <p className="text-[10px] text-muted-foreground">vs anterior: {fmt(stats.previous)}</p>
        </div>
        <div className="space-y-1">
          <p className="text-label">Nº Pagamentos</p>
          <div className="flex items-baseline gap-2">
            <p className="text-headline text-xl text-foreground">{stats.currentN}</p>
            <Trend v={stats.variationN} />
          </div>
          <p className="text-[10px] text-muted-foreground">vs anterior: {stats.previousN}</p>
        </div>
        <div className="space-y-1">
          <p className="text-label">Ticket Médio</p>
          <div className="flex items-baseline gap-2">
            <p className="text-headline text-xl text-foreground">{fmt(stats.avgTicketCurrent)}</p>
            <Trend v={stats.avgVar} />
          </div>
          <p className="text-[10px] text-muted-foreground">média por pagamento</p>
        </div>
      </div>
    </div>
  );
}
