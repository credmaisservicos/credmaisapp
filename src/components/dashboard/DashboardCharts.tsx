import { useMemo, useState } from "react";
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, BarChart, Bar, CartesianGrid, Legend,
} from "recharts";
import { formatBR } from "@/lib/dateUtils";
import { TrendingUp, PieChart as PieIcon, BarChart3 } from "lucide-react";
import { isEmAtraso } from "@/lib/dashboardMetrics";

type Props = {
  contracts: any[];
  installments: any[];
  profits: any[];
};

type Period = "7d" | "30d" | "90d" | "12m";

const PERIOD_OPTIONS: { value: Period; label: string; days: number; bucket: "day" | "month" }[] = [
  { value: "7d", label: "7 dias", days: 7, bucket: "day" },
  { value: "30d", label: "30 dias", days: 30, bucket: "day" },
  { value: "90d", label: "90 dias", days: 90, bucket: "day" },
  { value: "12m", label: "12 meses", days: 365, bucket: "month" },
];

const fmtBRL = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl border border-border/60 bg-background/95 backdrop-blur px-3 py-2 shadow-xl">
      <p className="text-[11px] font-semibold text-foreground mb-1">{label}</p>
      {payload.map((p: any) => (
        <div key={p.dataKey} className="flex items-center gap-2 text-[11px]">
          <span className="w-2 h-2 rounded-full" style={{ background: p.color }} />
          <span className="text-muted-foreground">{p.name}:</span>
          <span className="font-bold text-foreground">
            {typeof p.value === "number" && p.value > 100 ? fmtBRL(p.value) : p.value}
          </span>
        </div>
      ))}
    </div>
  );
};

export default function DashboardCharts({ contracts, installments, profits }: Props) {
  const [period, setPeriod] = useState<Period>("30d");
  const cfg = PERIOD_OPTIONS.find((p) => p.value === period)!;

  // Time series: received vs profit
  const timeSeries = useMemo(() => {
    const now = new Date();
    const buckets = new Map<string, { received: number; profit: number; overdue: number }>();
    const keys: string[] = [];

    if (cfg.bucket === "day") {
      for (let i = cfg.days - 1; i >= 0; i--) {
        const d = new Date(now);
        d.setDate(d.getDate() - i);
        const k = d.toISOString().slice(0, 10);
        keys.push(k);
        buckets.set(k, { received: 0, profit: 0, overdue: 0 });
      }
    } else {
      for (let i = 11; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
        keys.push(k);
        buckets.set(k, { received: 0, profit: 0, overdue: 0 });
      }
    }

    const keyOf = (dateStr: string) =>
      cfg.bucket === "day" ? dateStr.slice(0, 10) : dateStr.slice(0, 7);

    installments.forEach((i: any) => {
      if (i.status === "paid" && i.paid_at) {
        const k = keyOf(i.paid_at);
        const b = buckets.get(k);
        if (b) {
          const amt = Number(i.paid_amount || i.amount || 0);
          b.received += amt;
        }
      }
      // Mesma regra do painel: em atraso é "não paga e já venceu". Filtrar por
      // status === "pending" deixava de fora tudo que o check-overdue já marcou,
      // e o gráfico mostrava uma fração da inadimplência real.
      if (isEmAtraso(i as any, now)) {
        const k = keyOf(i.due_date);
        const b = buckets.get(k);
        if (b) b.overdue += Number(i.amount || 0);
      }
    });

    // Lucro vem do razão confirmado, nunca de capital/número de parcelas.
    // Essa aproximação era incorreta para Price, somente juros e carência.
    profits.forEach((profit: any) => {
      if (!profit.date) return;
      const bucket = buckets.get(keyOf(profit.date));
      if (bucket) bucket.profit += Number(profit.amount || 0);
    });

    return keys.map((k) => {
      const b = buckets.get(k)!;
      const label =
        cfg.bucket === "day"
          ? formatBR(k + "T00:00", { day: "2-digit", month: "2-digit" })
          : formatBR(k + "-01", { month: "short" }).replace(".", "");
      return { label, Recebido: Math.round(b.received), Lucro: Math.round(b.profit), Atraso: Math.round(b.overdue) };
    });
  }, [installments, profits, cfg]);

  // Status distribution
  const statusData = useMemo(() => {
    const map: Record<string, number> = { active: 0, completed: 0, overdue: 0, cancelled: 0 };
    contracts.forEach((c: any) => {
      map[c.status] = (map[c.status] || 0) + 1;
    });
    return [
      { name: "Ativos", value: map.active, color: "hsl(var(--primary))" },
      { name: "Concluídos", value: map.completed, color: "hsl(var(--success))" },
      { name: "Em Atraso", value: map.overdue, color: "hsl(var(--destructive))" },
      { name: "Cancelados", value: map.cancelled, color: "hsl(var(--muted-foreground))" },
    ].filter((x) => x.value > 0);
  }, [contracts]);

  // Top clients by received
  const topClients = useMemo(() => {
    const map = new Map<string, { name: string; total: number }>();
    installments.forEach((i: any) => {
      if (i.status !== "paid") return;
      const c = contracts.find((c: any) => c.id === i.contract_id);
      if (!c?.clients?.name) return;
      const cur = map.get(c.clients.name) || { name: c.clients.name, total: 0 };
      cur.total += Number(i.paid_amount || i.amount || 0);
      map.set(c.clients.name, cur);
    });
    return [...map.values()].sort((a, b) => b.total - a.total).slice(0, 5).reverse();
  }, [installments, contracts]);

  return (
    <div className="space-y-4">
      {/* Header + Period filter */}
      <div className="flex items-center justify-between flex-wrap gap-3 animate-fade-in">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-2xl bg-primary/10 flex items-center justify-center">
            <BarChart3 size={14} className="text-primary" />
          </div>
          <h2 className="text-headline text-sm text-foreground">Análise Visual</h2>
        </div>
        <div className="inline-flex items-center gap-1 p-1 rounded-full glass-card">
          {PERIOD_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => setPeriod(opt.value)}
              className={`px-3 py-1.5 rounded-full text-[10px] font-semibold uppercase tracking-wider transition-all ${
                period === opt.value
                  ? "bg-primary text-primary-foreground shadow-md"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Revenue area chart */}
      <div className="premium-card p-5 animate-fade-in">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-2xl bg-success/10 flex items-center justify-center">
              <TrendingUp size={14} className="text-success" />
            </div>
            <h3 className="text-headline text-sm text-foreground">Recebimentos & Lucro</h3>
          </div>
          <span className="text-[10px] text-muted-foreground">Período: {cfg.label}</span>
        </div>
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={timeSeries} margin={{ top: 5, right: 5, left: -15, bottom: 0 }}>
              <defs>
                <linearGradient id="grdRecebido" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="hsl(var(--success))" stopOpacity={0.4} />
                  <stop offset="100%" stopColor="hsl(var(--success))" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="grdLucro" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.4} />
                  <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} vertical={false} />
              <XAxis dataKey="label" stroke="hsl(var(--muted-foreground))" fontSize={10} tickLine={false} axisLine={false} />
              <YAxis stroke="hsl(var(--muted-foreground))" fontSize={10} tickLine={false} axisLine={false} tickFormatter={(v) => v >= 1000 ? `${(v/1000).toFixed(0)}k` : v} />
              <Tooltip content={<CustomTooltip />} />
              <Legend wrapperStyle={{ fontSize: 11 }} iconType="circle" />
              <Area type="monotone" dataKey="Recebido" stroke="hsl(var(--success))" strokeWidth={2} fill="url(#grdRecebido)" />
              <Area type="monotone" dataKey="Lucro" stroke="hsl(var(--primary))" strokeWidth={2} fill="url(#grdLucro)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Pie + Top clients */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="premium-card p-5 animate-fade-in">
          <div className="flex items-center gap-2.5 mb-4">
            <div className="w-8 h-8 rounded-2xl bg-primary/10 flex items-center justify-center">
              <PieIcon size={14} className="text-primary" />
            </div>
            <h3 className="text-headline text-sm text-foreground">Status dos Contratos</h3>
          </div>
          <div className="h-56">
            {statusData.length === 0 ? (
              <div className="h-full flex items-center justify-center text-xs text-muted-foreground">
                Nenhum contrato cadastrado
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={statusData}
                    dataKey="value"
                    nameKey="name"
                    innerRadius={45}
                    outerRadius={75}
                    paddingAngle={3}
                    stroke="hsl(var(--background))"
                    strokeWidth={2}
                  >
                    {statusData.map((s) => (
                      <Cell key={s.name} fill={s.color} />
                    ))}
                  </Pie>
                  <Tooltip content={<CustomTooltip />} />
                  <Legend wrapperStyle={{ fontSize: 11 }} iconType="circle" />
                </PieChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        <div className="premium-card p-5 animate-fade-in">
          <div className="flex items-center gap-2.5 mb-4">
            <div className="w-8 h-8 rounded-2xl bg-success/10 flex items-center justify-center">
              <BarChart3 size={14} className="text-success" />
            </div>
            <h3 className="text-headline text-sm text-foreground">Top 5 Clientes (Recebido)</h3>
          </div>
          <div className="h-56">
            {topClients.length === 0 ? (
              <div className="h-full flex items-center justify-center text-xs text-muted-foreground">
                Sem pagamentos registrados
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={topClients} layout="vertical" margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} horizontal={false} />
                  <XAxis type="number" stroke="hsl(var(--muted-foreground))" fontSize={10} tickLine={false} axisLine={false} tickFormatter={(v) => v >= 1000 ? `${(v/1000).toFixed(0)}k` : v} />
                  <YAxis type="category" dataKey="name" stroke="hsl(var(--muted-foreground))" fontSize={10} tickLine={false} axisLine={false} width={90} />
                  <Tooltip content={<CustomTooltip />} />
                  <Bar dataKey="total" name="Total" fill="hsl(var(--primary))" radius={[0, 8, 8, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
