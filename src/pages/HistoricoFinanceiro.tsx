import { useMemo, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";
import { fetchAll } from "@/lib/fetchAll";
import { Archive, TrendingUp, Wallet, HandCoins, Search, FileText, CalendarRange } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatBR } from "@/lib/dateUtils";
import { useNavigate } from "react-router-dom";
import EmptyState from "@/components/EmptyState";
import ErrorState from "@/components/feedback/ErrorState";
import { useMultiTableRealtime } from "@/hooks/useRealtimeSubscription";

const fmt = (v: number) =>
  v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

type PeriodKey = "7d" | "30d" | "90d" | "6m" | "12m" | "ytd" | "all" | "custom";

const PRESETS: { key: PeriodKey; label: string }[] = [
  { key: "7d", label: "7 dias" },
  { key: "30d", label: "30 dias" },
  { key: "90d", label: "90 dias" },
  { key: "6m", label: "6 meses" },
  { key: "12m", label: "12 meses" },
  { key: "ytd", label: "Ano atual" },
  { key: "all", label: "Tudo" },
  { key: "custom", label: "Personalizado" },
];

function getRange(period: PeriodKey, from?: string, to?: string): { start: Date | null; end: Date | null } {
  const now = new Date();
  const end = new Date(now); end.setHours(23, 59, 59, 999);
  const start = new Date(now); start.setHours(0, 0, 0, 0);
  switch (period) {
    case "7d": start.setDate(start.getDate() - 6); return { start, end };
    case "30d": start.setDate(start.getDate() - 29); return { start, end };
    case "90d": start.setDate(start.getDate() - 89); return { start, end };
    case "6m": start.setMonth(start.getMonth() - 6); return { start, end };
    case "12m": start.setMonth(start.getMonth() - 12); return { start, end };
    case "ytd": return { start: new Date(now.getFullYear(), 0, 1), end };
    case "all": return { start: null, end: null };
    case "custom": {
      const s = from ? new Date(from + "T00:00:00") : null;
      const e = to ? new Date(to + "T23:59:59.999") : null;
      return { start: s, end: e };
    }
  }
}

export default function HistoricoFinanceiro() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [period, setPeriod] = useState<PeriodKey>("all");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");

  useMultiTableRealtime(
    ["contracts", "contract_installments"],
    [["historico-financeiro", user?.id || ""]],
  );

  const { data, isLoading, error: loadError, refetch } = useQuery({
    queryKey: ["historico-financeiro", user?.id],
    queryFn: async () => {
      const [contracts, installments] = await Promise.all([
        fetchAll((f, t) =>
          supabase.from("contracts")
            .select("*, clients(name, cpf_cnpj)")
            .eq("user_id", user!.id).eq("status", "completed")
            .order("created_at", { ascending: false }).range(f, t)
        ),
        fetchAll((f, t) =>
          supabase.from("contract_installments").select("*")
            .eq("user_id", user!.id).eq("status", "paid").range(f, t)
        ),
      ]);
      return { contracts, installments };
    },
    enabled: !!user,
  });

  const { start, end } = useMemo(
    () => getRange(period, customFrom, customTo),
    [period, customFrom, customTo]
  );

  // Data de quitação = maior paid_at das parcelas do contrato.
  // Fallback: created_at (caso não haja parcelas com paid_at, ex: contratos antigos).
  const completedAtMap = useMemo(() => {
    const map = new Map<string, string>();
    if (!data) return map;
    for (const i of data.installments as any[]) {
      if (!i.paid_at || !i.contract_id) continue;
      const cur = map.get(i.contract_id);
      if (!cur || new Date(i.paid_at) > new Date(cur)) {
        map.set(i.contract_id, i.paid_at);
      }
    }
    return map;
  }, [data]);

  const receivedByContract = useMemo(() => {
    const map = new Map<string, number>();
    if (!data) return map;
    for (const installment of data.installments as any[]) {
      if (!installment.contract_id) continue;
      map.set(
        installment.contract_id,
        (map.get(installment.contract_id) || 0) + Number(installment.paid_amount || installment.amount || 0),
      );
    }
    return map;
  }, [data]);

  const contractsInRange = useMemo(() => {
    if (!data) return [] as any[];
    const list = data.contracts.map((c: any) => ({
      ...c,
      completed_at: completedAtMap.get(c.id) || c.created_at,
    }));
    if (!start && !end) return list;
    return list.filter((c: any) => {
      const d = new Date(c.completed_at);
      if (start && d < start) return false;
      if (end && d > end) return false;
      return true;
    });
  }, [data, completedAtMap, start, end]);

  const summary = useMemo(() => {
    if (!data) return null;
    const totalRecebido = contractsInRange.reduce((sum: number, contract: any) =>
      sum + (receivedByContract.get(contract.id) || 0), 0);
    const totalCapital = contractsInRange.reduce((s: number, c: any) =>
      s + Number(c.capital || 0), 0);
    const totalLucro = totalRecebido - totalCapital;
    return {
      totalRecebido,
      totalCapital,
      totalLucro,
      ticketMedio: contractsInRange.length ? totalRecebido / contractsInRange.length : 0,
      quantidade: contractsInRange.length,
    };
  }, [data, contractsInRange, receivedByContract]);

  const filtered = useMemo(() => {
    const term = search.toLowerCase().trim();
    if (!term) return contractsInRange;
    const digits = term.replace(/\D/g, "");
    return contractsInRange.filter((c: any) =>
      c.clients?.name?.toLocaleLowerCase("pt-BR").includes(term) ||
      (digits.length > 0 && c.clients?.cpf_cnpj?.replace(/\D/g, "").includes(digits))
    );
  }, [contractsInRange, search]);

  const invalidCustomRange = period === "custom" && customFrom && customTo && customFrom > customTo;

  if (isLoading) {
    return (
      <div className="p-4 md:p-6 space-y-4">
        <Skeleton className="h-32 w-full rounded-2xl" />
        <Skeleton className="h-64 w-full rounded-2xl" />
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="p-4 md:p-6">
        <ErrorState
          title="Não foi possível carregar o histórico financeiro"
          description="Confira sua conexão e tente novamente."
          onRetry={() => void refetch()}
        />
      </div>
    );
  }

  return (
    <div className="md:p-6 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-slate-500/20 to-slate-500/5 border border-slate-500/20 flex items-center justify-center">
            <Archive className="text-slate-400" size={22} />
          </div>
          <div className="min-w-0">
            <h1 className="text-2xl md:text-3xl font-black tracking-tight">Histórico financeiro</h1>
            <p className="text-sm text-muted-foreground">
              Contratos quitados e lucros já realizados — fora das métricas ativas.
            </p>
          </div>
        </div>
      </div>

      {/* Seletor de período */}
      <div className="rounded-2xl border border-border/50 bg-card/40 backdrop-blur p-4 space-y-3">
        <div className="flex items-center gap-2 text-xs uppercase tracking-wider font-bold text-muted-foreground">
          <CalendarRange size={14} />
          Período
        </div>
        <div className="flex gap-2 overflow-x-auto pb-1">
          {PRESETS.map((p) => (
            <Button
              key={p.key}
              size="sm"
              variant={period === p.key ? "default" : "outline"}
              onClick={() => setPeriod(p.key)}
              className="h-8 shrink-0"
            >
              {p.label}
            </Button>
          ))}
        </div>
        {period === "custom" && (
          <div className="grid grid-cols-1 items-center gap-2 pt-1 sm:grid-cols-[1fr_auto_1fr]">
            <Input
              type="date"
              value={customFrom}
              onChange={(e) => setCustomFrom(e.target.value)}
              aria-label="Data inicial" className="h-9 w-full"
            />
            <span className="text-muted-foreground text-sm">até</span>
            <Input
              type="date"
              value={customTo}
              onChange={(e) => setCustomTo(e.target.value)}
              min={customFrom} aria-label="Data final" className="h-9 w-full"
            />
          </div>
        )}
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-3">
        <KPI icon={FileText} label="Contratos quitados" value={String(summary?.quantidade ?? 0)} tone="slate" />
        <KPI icon={HandCoins} label="Capital histórico" value={`R$ ${fmt(summary?.totalCapital ?? 0)}`} tone="indigo" />
        <KPI icon={Wallet} label="Recebido histórico" value={`R$ ${fmt(summary?.totalRecebido ?? 0)}`} tone="success" />
        <KPI icon={TrendingUp} label="Lucro histórico" value={`R$ ${fmt(summary?.totalLucro ?? 0)}`} tone="primary" />
        <KPI icon={Archive} label="Média por contrato" value={`R$ ${fmt(summary?.ticketMedio ?? 0)}`} tone="success" />
      </div>

      {/* Busca */}
      <div className="relative max-w-md">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar por cliente ou CPF/CNPJ..."
          aria-label="Buscar contrato quitado"
          className="pl-9"
        />
      </div>

      {/* Lista */}
      {invalidCustomRange ? (
        <EmptyState
          icon={CalendarRange}
          title="Período inválido"
          description="A data inicial deve ser anterior ou igual à data final."
        />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={Archive}
          title="Nada arquivado nesse período"
          description="Ajuste o período acima ou aguarde novos contratos serem quitados."
        />
      ) : (
        <div className="overflow-hidden rounded-2xl border border-border/60 bg-card/65">
          <div className="hidden grid-cols-[minmax(0,1fr)_auto_auto_auto] gap-4 border-b border-border/40 bg-muted/20 px-4 py-3 text-[11px] font-bold uppercase tracking-wider text-muted-foreground md:grid">
            <span>Cliente / contrato</span>
            <span className="text-right">Capital</span>
            <span className="text-right">Total pago</span>
            <span className="text-right">Lucro</span>
          </div>
          {filtered.map((c: any) => {
            const recebido = receivedByContract.get(c.id) || 0;
            const lucroRealizado = recebido - Number(c.capital || 0);
            return (
              <button
                key={c.id}
                onClick={() => navigate(`/clientes/${c.client_id}`)}
                className="grid w-full grid-cols-2 gap-3 border-b border-border/30 px-4 py-4 text-left transition-colors last:border-0 hover:bg-muted/20 md:grid-cols-[minmax(0,1fr)_auto_auto_auto] md:items-center md:gap-4 md:py-3"
              >
                <div className="min-w-0">
                  <p className="text-sm font-semibold truncate">
                    {c.clients?.name || "—"}
                  </p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <Badge variant="outline" className="text-[10px] h-5 border-slate-500/30 text-slate-400">
                      Quitado
                    </Badge>
                    <span className="text-[11px] text-muted-foreground">
                      {formatBR(c.completed_at || c.created_at)} · {c.num_installments}x
                    </span>
                  </div>
                </div>
                <span className="text-sm font-semibold tabular-nums text-muted-foreground md:text-right">
                  <span className="block text-[10px] uppercase md:hidden">Capital</span>R$ {fmt(Number(c.capital))}
                </span>
                <span className="text-right text-sm font-semibold tabular-nums text-success">
                  <span className="block text-[10px] uppercase md:hidden">Total pago</span>R$ {fmt(recebido)}
                </span>
                <span className={`text-right text-sm font-black tabular-nums md:text-right ${lucroRealizado >= 0 ? "text-primary" : "text-destructive"}`}>
                  <span className="block text-[10px] uppercase md:hidden">Resultado</span>R$ {fmt(lucroRealizado)}
                </span>
              </button>
            );
          })}
          {/* Footer com totais */}
          <div className="hidden grid-cols-[minmax(0,1fr)_auto_auto_auto] items-center gap-4 border-t border-border/40 bg-muted/30 px-4 py-3 font-black md:grid">
            <span className="text-xs uppercase tracking-wider text-muted-foreground">
              Totais ({filtered.length})
            </span>
            <span className="text-sm tabular-nums text-muted-foreground">
              R$ {fmt(filtered.reduce((s: number, c: any) => s + Number(c.capital || 0), 0))}
            </span>
            <span className="text-sm tabular-nums text-success">
              R$ {fmt(
                filtered.reduce((s: number, c: any) => {
                  return s + (receivedByContract.get(c.id) || 0);
                }, 0)
              )}
            </span>
            <span className="text-sm tabular-nums text-primary">
              R$ {fmt(filtered.reduce((s: number, c: any) => s + (receivedByContract.get(c.id) || 0) - Number(c.capital || 0), 0))}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

function KPI({
  icon: Icon, label, value, tone,
}: { icon: LucideIcon; label: string; value: string; tone: "slate" | "indigo" | "success" | "primary" }) {
  const map = {
    slate:   { bg: "bg-slate-500/10",   ring: "ring-slate-500/20",   text: "text-slate-400" },
    indigo:  { bg: "bg-indigo-500/10",  ring: "ring-indigo-500/20",  text: "text-indigo-400" },
    success: { bg: "bg-success/10",     ring: "ring-success/20",     text: "text-success" },
    primary: { bg: "bg-primary/10",     ring: "ring-primary/20",     text: "text-primary" },
  }[tone];
  return (
    <div className={`min-w-0 rounded-2xl border border-border/60 bg-card/65 p-4 ring-1 ${map.ring}`}>
      <div className="flex items-center gap-2 mb-2">
        <div className={`w-8 h-8 rounded-lg ${map.bg} flex items-center justify-center`}>
          <Icon size={14} className={map.text} />
        </div>
        <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{label}</span>
      </div>
      <p className={`break-words text-lg font-black tabular-nums sm:text-xl ${map.text}`}>{value}</p>
    </div>
  );
}
