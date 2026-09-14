import { useMemo } from "react";
import { Card } from "@/components/ui/card";
import { TrendingUp, TrendingDown, Clock, Target, Repeat, Calendar, LineChart } from "lucide-react";
import { isEmAtraso, isEmAberto } from "@/lib/dashboardMetrics";

interface Props {
  contracts: any[];
  installments: any[];
}

const fmt = (v: number) => `R$ ${Number(v || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const ExecutiveKPIs = ({ contracts, installments }: Props) => {
  const kpis = useMemo(() => {
    const now = new Date();
    const paid = installments.filter((i) => i.status === "paid" && i.paid_at);
    // Atraso e "em aberto" pelas mesmas regras do painel: um filtro por status
    // específico deixava de fora as parcelas que o check-overdue já marcou.
    const overdue = installments.filter((i) => isEmAtraso(i as any, now));
    const pending = installments.filter((i) => isEmAberto(i as any));

    // DSO — média de dias entre vencimento e pagamento (últimos 90d)
    const paid90 = paid.filter((i) => {
      const d = new Date(i.paid_at);
      return (now.getTime() - d.getTime()) / 86400000 <= 90;
    });
    let dso = 0;
    if (paid90.length) {
      const sum = paid90.reduce((s, i) => {
        const due = new Date(i.due_date).getTime();
        const p = new Date(i.paid_at).getTime();
        return s + Math.max(0, (p - due) / 86400000);
      }, 0);
      dso = sum / paid90.length;
    }

    // PMR — prazo médio dos contratos ativos (dias até liquidação prevista)
    const activePending = pending.filter((i) => {
      const c = contracts.find((c) => c.id === i.contract_id);
      return c && (c.status === "active" || c.status === "overdue");
    });
    let pmr = 0;
    if (activePending.length) {
      const sum = activePending.reduce((s, i) => {
        const due = new Date(i.due_date).getTime();
        return s + Math.max(0, (due - now.getTime()) / 86400000);
      }, 0);
      pmr = sum / activePending.length;
    }

    // Taxa de recuperação — % de parcelas atrasadas que acabaram sendo pagas nos últimos 180d
    const recovery = (() => {
      const totalOverdueEver = paid.filter((i) => {
        const due = new Date(i.due_date);
        const p = new Date(i.paid_at);
        return p > due;
      }).length + overdue.length;
      const recovered = paid.filter((i) => {
        const due = new Date(i.due_date);
        const p = new Date(i.paid_at);
        return p > due;
      }).length;
      if (!totalOverdueEver) return 0;
      return (recovered / totalOverdueEver) * 100;
    })();

    // Projeção de caixa 30 / 60 / 90 dias
    const bucket = (from: number, to: number) => {
      const start = new Date(now.getTime() + from * 86400000);
      const end = new Date(now.getTime() + to * 86400000);
      return pending
        .filter((i) => {
          const d = new Date(i.due_date);
          return d >= start && d < end;
        })
        .reduce((s, i) => s + Number(i.amount || 0), 0);
    };

    const cash30 = bucket(0, 30);
    const cash60 = bucket(30, 60);
    const cash90 = bucket(60, 90);
    const cashTotal = cash30 + cash60 + cash90;

    // Ticket médio ativo
    const activeContracts = contracts.filter((c) => c.status === "active" || c.status === "overdue");
    const ticket = activeContracts.length
      ? activeContracts.reduce((s, c) => s + Number(c.capital || 0), 0) / activeContracts.length
      : 0;

    return { dso, pmr, recovery, cash30, cash60, cash90, cashTotal, ticket };
  }, [contracts, installments]);

  const executiveCards = [
    { label: "DSO", value: `${kpis.dso.toFixed(1)}d`, hint: "Days Sales Outstanding · atraso médio de recebimento", icon: Clock, tone: kpis.dso <= 3 ? "success" : kpis.dso <= 10 ? "warning" : "danger" },
    { label: "PMR", value: `${kpis.pmr.toFixed(0)}d`, hint: "Prazo médio de recebimento previsto", icon: Calendar, tone: "primary" },
    { label: "Taxa de recuperação", value: `${kpis.recovery.toFixed(1)}%`, hint: "% de parcelas atrasadas que foram quitadas", icon: Repeat, tone: kpis.recovery >= 70 ? "success" : kpis.recovery >= 40 ? "warning" : "danger" },
    { label: "Ticket médio ativo", value: fmt(kpis.ticket), hint: "Capital médio por contrato ativo", icon: Target, tone: "primary" },
  ];

  const toneMap: Record<string, { text: string; bg: string; border: string }> = {
    success: { text: "text-emerald-500", bg: "bg-emerald-500/10", border: "border-emerald-500/20" },
    warning: { text: "text-amber-500", bg: "bg-amber-500/10", border: "border-amber-500/20" },
    danger: { text: "text-destructive", bg: "bg-destructive/10", border: "border-destructive/20" },
    primary: { text: "text-primary", bg: "bg-primary/10", border: "border-primary/20" },
  };

  const maxCash = Math.max(kpis.cash30, kpis.cash60, kpis.cash90, 1);

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-xl bg-primary/15 flex items-center justify-center text-primary">
            <LineChart size={16} />
          </div>
          <div>
            <h3 className="text-sm font-bold uppercase tracking-widest">Indicadores executivos</h3>
            <p className="text-xs text-muted-foreground">DSO, PMR, recuperação e projeção de caixa 90d</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {executiveCards.map((c) => {
          const t = toneMap[c.tone];
          return (
            <Card key={c.label} className={`p-4 rounded-2xl border ${t.border} ${t.bg}`}>
              <div className="flex items-start justify-between mb-2">
                <span className={`w-9 h-9 rounded-xl flex items-center justify-center ${t.bg} ring-1 ${t.border}`}>
                  <c.icon size={16} className={t.text} />
                </span>
              </div>
              <p className={`text-2xl font-bold tabular-nums ${t.text}`}>{c.value}</p>
              <p className="text-xs font-semibold text-foreground/80 mt-1">{c.label}</p>
              <p className="text-[10px] text-muted-foreground mt-1 leading-snug">{c.hint}</p>
            </Card>
          );
        })}
      </div>

      <Card className="p-5 rounded-2xl bg-gradient-to-br from-card via-card to-primary/5 border-primary/20">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
          <div>
            <h4 className="text-sm font-bold">Projeção de caixa · próximos 90 dias</h4>
            <p className="text-xs text-muted-foreground">Baseada nas parcelas pendentes por janela de vencimento</p>
          </div>
          <div className="text-right">
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground">Total previsto</p>
            <p className="text-xl font-bold text-primary">{fmt(kpis.cashTotal)}</p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {[
            { label: "30 dias", value: kpis.cash30, color: "from-emerald-500 to-emerald-400", ring: "ring-emerald-500/30" },
            { label: "60 dias", value: kpis.cash60, color: "from-primary to-primary/70", ring: "ring-primary/30" },
            { label: "90 dias", value: kpis.cash90, color: "from-violet-500 to-violet-400", ring: "ring-violet-500/30" },
          ].map((b) => (
            <div key={b.label} className={`rounded-2xl border border-border/40 bg-card/60 p-4 ring-1 ${b.ring}`}>
              <p className="text-[10px] uppercase font-bold text-muted-foreground tracking-widest">{b.label}</p>
              <p className="mt-1 text-lg font-bold tabular-nums">{fmt(b.value)}</p>
              <div className="mt-3 h-2 bg-muted rounded-full overflow-hidden">
                <div className={`h-full bg-gradient-to-r ${b.color}`} style={{ width: `${(b.value / maxCash) * 100}%` }} />
              </div>
            </div>
          ))}
        </div>
      </Card>
    </section>
  );
};

export default ExecutiveKPIs;
