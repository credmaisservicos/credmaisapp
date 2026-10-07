import { CredinhoBannerArt, CredinhoLoader } from "@/components/brand/Credinho";
import { lazy, Suspense, useMemo, useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import {
  AlertCircle, Calendar, Landmark, TrendingUp, Users, ArrowRight,
  DollarSign, FileSignature, Clock, Sparkles,
  ArrowUpRight, Activity, Wallet, Target, ChevronRight, Zap,
  BarChart3, Receipt, Bot, Plus, RefreshCw,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { usePlan } from "@/hooks/usePlan";
import { useAuth } from "@/contexts/AuthContext";
import { useQuery } from "@tanstack/react-query";
import ErrorState from "@/components/feedback/ErrorState";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useMultiTableRealtime } from "@/hooks/useRealtimeSubscription";
const DashboardCharts = lazy(() => import("@/components/dashboard/DashboardCharts"));
import DailyBriefing from "@/components/dashboard/DailyBriefing";
import PeriodComparison from "@/components/dashboard/PeriodComparison";
import NarrativeHero from "@/components/dashboard/NarrativeHero";
import ExecutiveKPIs from "@/components/dashboard/ExecutiveKPIs";
import BentoKPI from "@/components/dashboard/BentoKPI";
import PendingCenter from "@/components/dashboard/PendingCenter";
import { formatBR, parseLocalDate } from "@/lib/dateUtils";
import { fetchAll } from "@/lib/fetchAll";
import { computeDashboardMetrics } from "@/lib/dashboardMetrics";

const safeNumber = (value: unknown) => {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
};

const Dashboard = () => {
  const { user, profile } = useAuth();
  const navigate = useNavigate();
  const [currentTime, setCurrentTime] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 60000);
    return () => clearInterval(timer);
  }, []);

  useMultiTableRealtime(
    ["contracts", "contract_installments", "profits", "clients", "goals"],
    [["dashboard-data", user?.id || ""]],
  );

  const { data, isLoading, isFetching, dataUpdatedAt, error: dashError, refetch: refetchDash } = useQuery({
    queryKey: ["dashboard-data", user?.id],
    queryFn: async () => {
      // Só as colunas que as métricas usam. Antes vinha `select("*")` das ~1.700
      // parcelas e de todos os contratos, com anexos e observações que a tela nem
      // abre — payload grande à toa, e no celular isso pesa.
      const [contracts, installments, clients, goals, profits] = await Promise.all([
        fetchAll((f, t) => supabase.from("contracts")
          .select("id, capital, total_interest, num_installments, status, created_at, client_id, clients(name, cpf_cnpj)")
          .eq("user_id", user!.id).range(f, t)),
        fetchAll((f, t) => supabase.from("contract_installments")
          .select("id, contract_id, client_id, amount, paid_amount, late_fee, due_date, paid_at, status")
          .eq("user_id", user!.id).range(f, t)),
        fetchAll((f, t) => supabase.from("clients").select("id, name, credit_score, status").eq("user_id", user!.id).range(f, t)),
        fetchAll((f, t) => supabase.from("goals").select("*").eq("user_id", user!.id).range(f, t)),
        fetchAll((f, t) => supabase.from("profits").select("amount, date").eq("user_id", user!.id).order("date", { ascending: false }).range(f, t)),
      ]);
      return {
        contracts, installments, clients, goals,
        profits,
      };
    },
    enabled: !!user,
  });

  // O cálculo mora em lib/dashboardMetrics para poder ser testado. Ficando aqui
  // dentro, o filtro errado de inadimplência passou meses sem ninguém notar.
  const metrics = useMemo(() => (data ? computeDashboardMetrics(data as any) : null), [data]);

  // ⚠️ IMPORTANTE: todos os hooks antes de qualquer early return
  const deltaReceived = useMemo(() => {
    if (!data) return undefined;
    const now = new Date();
    const d30 = new Date(now.getTime() - 30 * 86400000);
    const d60 = new Date(now.getTime() - 60 * 86400000);
    const paid = data.installments.filter((i: any) => i.status === "paid" && i.paid_at);
    const cur = paid.filter((i: any) => {
      const date = parseLocalDate(i.paid_at);
      return !!date && date >= d30;
    }).reduce((s: number, i: any) => s + safeNumber(i.paid_amount ?? i.amount), 0);
    const prev = paid.filter((i: any) => {
      const date = parseLocalDate(i.paid_at);
      return !!date && date >= d60 && date < d30;
    }).reduce((s: number, i: any) => s + safeNumber(i.paid_amount ?? i.amount), 0);
    if (prev === 0) return cur > 0 ? 100 : 0;
    return ((cur - prev) / prev) * 100;
  }, [data]);

  // Estava lá embaixo, DEPOIS dos dois returns antecipados — exatamente o que o
  // aviso acima proíbe. `usePlan` usa `useMemo`: enquanto o painel carregava o
  // componente saía no return do esqueleto e esse hook não rodava; quando os
  // dados chegavam ele passava a rodar, o React via mais hooks do que no render
  // anterior e derrubava a tela (erro #310, "Algo deu errado"). O painel é a
  // primeira tela de todo mundo depois do login.
  const { hasAutomations } = usePlan();

  if (dashError && !data) {
    return (
      <div className="max-w-[1400px] mx-auto">
        <ErrorState error={dashError} onRetry={() => refetchDash()} />
      </div>
    );
  }

  if (isLoading || !metrics) {
    return (
      <div role="status" aria-label="Carregando painel" className="space-y-6 max-w-[1400px] mx-auto animate-fade-in">
        <CredinhoLoader label="Carregando painel" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[1, 2, 3, 4].map((i) => <div key={i} className="h-24 skeleton-shimmer" />)}
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {[1, 2, 3, 4].map((i) => <div key={i} className="h-36 skeleton-shimmer" />)}
        </div>
        <div className="h-72 skeleton-shimmer rounded-3xl" />
        <span className="sr-only">Carregando…</span>
      </div>
    );
  }


  const fmt = (v: unknown) => safeNumber(v).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const hour = currentTime.getHours();
  const greeting = hour < 12 ? "Bom dia" : hour < 18 ? "Boa tarde" : "Boa noite";
  const timeStr = currentTime.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  const dateStr = currentTime.toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" });
  const firstName = profile?.name?.split(" ")[0] || "Usuário";

  const quickActions = [
    { label: "Novo cliente",    icon: Users,    path: "/clientes/novo", iconColor: "text-primary" },
    { label: "Nova cobrança",   icon: Receipt,  path: "/cobrancas",     iconColor: "text-success" },
    { label: "Ver carteira",    icon: Wallet,   path: "/carteira",      iconColor: "text-foreground" },
    ...(hasAutomations
      ? [{ label: "Agente IA", icon: Bot, path: "/agente-ia", iconColor: "text-foreground" }]
      : [{ label: "Relatórios", icon: Receipt, path: "/relatorios", iconColor: "text-foreground" }]),
  ];

  const urgencyCards = [
    { count: metrics.overdueCount, label: "Parcelas atrasadas", sub: "Necessitam atenção imediata", icon: AlertCircle, tone: "danger",  path: "/cobrancas" },
    { count: metrics.vencendoHoje, label: "Vencendo hoje",      sub: "Cobranças do dia",             icon: Calendar,    tone: "warning", path: "/cobrancas" },
    { count: metrics.proximos7,    label: "Próximos 7 dias",    sub: "Vencimentos da semana",        icon: Clock,       tone: "info",    path: "/cobrancas" },
  ];

  const toneMap: Record<string, { text: string; bg: string; border: string }> = {
    danger:  { text: "text-destructive", bg: "bg-destructive/6", border: "border-destructive/20" },
    warning: { text: "text-warning",     bg: "bg-warning/6",     border: "border-warning/20" },
    info:    { text: "text-info",        bg: "bg-info/6",        border: "border-info/20" },
  };

  return (
    <div className="relative space-y-5 md:space-y-6 pb-8 max-w-[1400px] mx-auto animate-fade-in">
      {/* ─── HERO — saudação + ações principais ─── */}
      <section className="credinho-banner credinho-dashboard-banner p-5 md:p-7">
        <CredinhoBannerArt priority />
        <div className="pointer-events-none absolute -right-16 -top-24 -z-10 h-72 w-72 rounded-full border-24 border-white/6" />
        <div className="pointer-events-none absolute right-20 top-10 -z-10 h-2 w-2 rounded-full bg-orange-300 shadow-[0_0_18px_6px_rgba(251,146,60,.65)]" />
        <div className="credinho-dashboard-copy relative flex flex-col gap-5">
          <div className="space-y-2 min-w-0">
            <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-amber-100/65">
              <span className="inline-flex items-center gap-1.5">
                <span className="status-dot status-dot-success" />
                Ao vivo
              </span>
              <span className="opacity-30">·</span>
              <span>{timeStr}</span>
            </div>
            <h1 className="text-3xl font-bold leading-tight tracking-tight text-white sm:text-4xl">
              <span className="font-normal text-amber-100/80">{greeting},</span>{" "}
              <span>{firstName}</span>
            </h1>
            <p className="text-sm capitalize text-amber-100/65">{dateStr}</p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <button
              onClick={() => refetchDash()}
              disabled={isFetching}
              className="flex items-center gap-2 rounded-xl border border-white/16 bg-white/8 px-3.5 py-2 text-xs font-semibold text-white transition hover:bg-white/[.14] disabled:opacity-60"
              title={dataUpdatedAt ? `Atualizado às ${new Date(dataUpdatedAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}` : "Atualizar painel"}
            >
              <RefreshCw size={13} className={isFetching ? "animate-spin" : ""} />
              {isFetching ? "Atualizando" : "Atualizar"}
            </button>
            {metrics.paidTodayAmount > 0 && (
              <div className="flex items-center gap-2 px-3.5 py-2 rounded-full bg-success/10 border border-success/25">
                <Zap size={13} className="text-success" />
                <span className="text-xs font-semibold text-success tabular-nums">
                  +R$ {fmt(metrics.paidTodayAmount)} hoje
                </span>
              </div>
            )}
            <button
              onClick={() => navigate("/tv")}
              className="flex items-center gap-2 rounded-xl border border-white/16 bg-white/8 px-3.5 py-2 text-xs font-medium text-white transition-colors hover:bg-white/[.14]"
            >
              <Activity size={13} className="text-primary" />
              Modo TV
            </button>
            <button
              onClick={() => navigate("/clientes/novo")}
              className="flex items-center gap-2 rounded-xl bg-linear-to-r from-[#e3a33e] via-[#ffdc91] to-[#e3a33e] px-4 py-2 text-xs font-bold text-[#201a10] shadow-lg shadow-amber-950/20 transition-colors hover:brightness-110"
            >
              <Plus size={14} strokeWidth={2.5} />
              Novo
            </button>
          </div>
        </div>

        {/* Quick actions inline */}
        <div className="relative mt-5 grid grid-cols-2 gap-2.5 border-t border-white/6 pt-5 md:grid-cols-4 md:gap-3">
          {quickActions.map((a, i) => (
            <button
              key={a.label}
              onClick={() => navigate(a.path)}
              className="group flex min-w-0 items-center gap-2.5 rounded-xl border border-white/12 bg-white/8 p-3 text-left text-white transition-colors hover:border-orange-300/40 hover:bg-white/[.14] md:p-3.5"
              style={{ animationDelay: `${i * 50}ms` }}
            >
              <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-background/60 ${a.iconColor}`}>
                <a.icon size={16} strokeWidth={2.2} />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[13px] md:text-sm font-semibold text-foreground leading-tight wrap-break-word">{a.label}</p>
                <p className="text-[9px] md:text-[10px] text-muted-foreground uppercase tracking-wider mt-0.5">Abrir →</p>
              </div>
            </button>
          ))}
        </div>
      </section>

      {/* ─── Daily AI Briefing ─── */}
      <DailyBriefing />

      <PendingCenter overdueCount={metrics.overdueCount} />

      {/* ─── Narrativa Executiva ─── */}
      <NarrativeHero
        userName={profile?.name}
        capitalOnStreet={metrics.capitalNaRua}
        totalLent={metrics.totalLent}
        pendingReceivable={metrics.pendingReceivable}
        totalReceived={metrics.totalReceived}
        totalProfit={metrics.totalProfitAmount}
        roi={metrics.roi}
        overdueAmount={metrics.totalOverdueAmount}
        overdueCount={metrics.overdueCount}
        paidTodayAmount={metrics.paidTodayAmount}
        vencendoHoje={metrics.vencendoHoje}
        deltaReceived={deltaReceived}
        activeContracts={metrics.contratosAtivos}
        totalContracts={metrics.totalContratos}
      />


      {/* ─── KPIs financeiros ─── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 md:gap-4">
        <BentoKPI label="Capital na Rua" value={`R$ ${fmt(metrics.capitalNaRua)}`} explanation="Soma do capital de todos os contratos que ainda estão ativos ou em atraso. É o dinheiro que está trabalhando por você." hint={`${metrics.contratosAtivos} contrato${metrics.contratosAtivos === 1 ? "" : "s"} ativo${metrics.contratosAtivos === 1 ? "" : "s"}`} icon={Landmark} tone="primary" onClick={() => navigate("/carteira")} />
        <BentoKPI label="Total Recebido" value={`R$ ${fmt(metrics.totalReceived)}`} explanation="Tudo que já entrou no caixa vindo das parcelas pagas — capital + juros." hint="Somando todas as parcelas quitadas" icon={Wallet} tone="success" delta={deltaReceived} positiveIsGood onClick={() => navigate("/analises")} />
        <BentoKPI label="Lucro Gerado" value={`R$ ${fmt(metrics.totalProfitAmount)}`} explanation="Parte de juros dos pagamentos recebidos — o que sobra depois de devolver o capital emprestado." hint={`ROI de ${metrics.roi.toFixed(1)}% sobre o capital`} icon={TrendingUp} tone="primary" onClick={() => navigate("/analises")} />
        <BentoKPI label="Em Atraso" value={`R$ ${fmt(metrics.totalOverdueAmount)}`} explanation="Parcelas cujo vencimento já passou e continuam pendentes. Priorize a cobrança para não virar prejuízo." hint={`${metrics.taxaInadimplencia.toFixed(1)}% de inadimplência`} icon={AlertCircle} tone={metrics.totalOverdueAmount > 0 ? "danger" : "muted"} onClick={() => navigate("/cobrancas")} />
      </div>

      {/* ─── Urgency Cards ─── */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {urgencyCards.map((c, i) => {
          const active = c.count > 0;
          const t = toneMap[c.tone];
          return (
            <button
              key={c.label}
              onClick={() => navigate(c.path)}
              className={`group rounded-2xl border p-4 text-left transition-colors md:p-5 ${active ? `${t.border} ${t.bg}` : "border-border/30 bg-card/30 hover:bg-card/50"}`}
              style={{ animationDelay: `${i * 60}ms` }}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${active ? t.bg : "bg-muted/40"}`}>
                    <c.icon size={19} className={active ? t.text : "text-muted-foreground"} />
                  </div>
                  <div className="min-w-0">
                    <p className={`text-2xl font-bold tabular-nums ${active ? t.text : "text-foreground"}`}>{c.count}</p>
                    <p className="text-xs font-semibold text-foreground/80 truncate">{c.label}</p>
                  </div>
                </div>
                <ChevronRight size={16} className="text-muted-foreground/40 group-hover:text-muted-foreground group-hover:translate-x-1 transition-all mt-1" />
              </div>
              <p className="text-[11px] text-muted-foreground/70 mt-3">{c.sub}</p>
            </button>
          );
        })}
      </div>

      {/* ─── Indicadores Executivos ─── */}
      <ExecutiveKPIs contracts={data.contracts} installments={data.installments} />


      {/* ─── Tabs: Visão Geral / Análises / Listas ─── */}
      <Tabs defaultValue="overview" className="w-full">
        <TabsList className="grid w-full grid-cols-3 rounded-xl border border-border/30 bg-card/50 p-1 md:inline-flex md:w-auto">
          <TabsTrigger value="overview" className="rounded-lg text-xs font-semibold data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">Visão geral</TabsTrigger>
          <TabsTrigger value="analytics" className="rounded-lg text-xs font-semibold data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">Análises</TabsTrigger>
          <TabsTrigger value="lists" className="rounded-lg text-xs font-semibold data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">Listas</TabsTrigger>
        </TabsList>

        {/* ─── TAB: Visão geral ─── */}
        <TabsContent value="overview" className="space-y-5 mt-5">
          {/* Quick Stats */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5 md:gap-3">
            {[
              { label: "Contratos ativos",   value: metrics.contratosAtivos, icon: FileSignature, color: "text-success",     bg: "bg-success/10" },
              { label: "Contratos em atraso", value: metrics.contratosAtraso, icon: AlertCircle,   color: "text-destructive", bg: "bg-destructive/10" },
              { label: "Total clientes",     value: metrics.totalClientes,   icon: Users,         color: "text-primary",     bg: "bg-primary/10" },
              { label: "Parcelas atrasadas", value: metrics.overdueCount,    icon: Clock,         color: "text-warning",     bg: "bg-warning/10" },
            ].map((item, i) => (
              <div
                key={item.label}
                className="rounded-2xl border border-border/30 bg-card/40 backdrop-blur-sm p-4 flex items-center gap-3 hover:bg-card/60 hover:border-border/50 transition-all duration-300 animate-fade-in"
                style={{ animationDelay: `${(i + 4) * 60}ms` }}
              >
                <div className={`w-11 h-11 rounded-2xl ${item.bg} flex items-center justify-center shrink-0`}>
                  <item.icon size={18} className={item.color} />
                </div>
                <div className="min-w-0">
                  <p className={`text-2xl font-bold tabular-nums ${item.color}`}>{item.value}</p>
                  <p className="text-[11px] text-muted-foreground truncate">{item.label}</p>
                </div>
              </div>
            ))}
          </div>

          {/* Weekly Activity + Goals side by side em telas grandes */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Weekly Activity */}
            <div className="rounded-3xl border border-border/30 bg-card/40 backdrop-blur-md p-6 animate-fade-in">
              <div className="flex items-center justify-between mb-5">
                <div className="flex items-center gap-2.5">
                  <div className="w-9 h-9 rounded-2xl bg-primary/10 flex items-center justify-center">
                    <BarChart3 size={15} className="text-primary" />
                  </div>
                  <div>
                    <h2 className="text-sm font-bold text-foreground">Atividade semanal</h2>
                    <p className="text-[10px] text-muted-foreground">Pagamentos recebidos nos últimos 7 dias</p>
                  </div>
                </div>
              </div>
              <div className="flex items-end gap-2 h-24">
                {metrics.weeklyActivity.map((w: any, i: number) => (
                  <div key={i} className="flex-1 flex flex-col items-center gap-2 group">
                    <span className="text-[10px] font-bold text-primary tabular-nums opacity-0 group-hover:opacity-100 transition">{w.count}</span>
                    <div
                      className={`w-full rounded-t-lg transition-all duration-700 ${w.count > 0 ? 'bg-linear-to-t from-primary/70 to-primary/30 group-hover:from-primary group-hover:to-primary/60' : 'bg-muted/30'}`}
                      style={{ height: `${Math.max(6, (w.count / metrics.maxActivity) * 72)}px`, animationDelay: `${i * 80}ms` }}
                    />
                    <span className="text-[10px] text-muted-foreground font-medium capitalize">{w.day}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Goals */}
            {metrics.goals.length > 0 ? (
              <div className="rounded-3xl border border-border/30 bg-card/40 backdrop-blur-md overflow-hidden animate-fade-in">
                <div className="flex items-center justify-between px-6 py-4 border-b border-border/30">
                  <div className="flex items-center gap-2.5">
                    <div className="w-9 h-9 rounded-2xl bg-primary/10 flex items-center justify-center">
                      <Target size={15} className="text-primary" />
                    </div>
                    <h2 className="text-sm font-bold text-foreground">Metas</h2>
                  </div>
                  <button
                    onClick={() => navigate("/ferramentas/metas")}
                    className="text-[10px] text-muted-foreground hover:text-primary flex items-center gap-1 font-semibold uppercase tracking-wider transition-colors"
                  >
                    Gerenciar <ArrowRight size={10} />
                  </button>
                </div>
                <div className="p-5 space-y-4">
                  {metrics.goals.slice(0, 3).map((g: any) => {
                    const currentAmount = safeNumber(g.current_amount);
                    const targetAmount = safeNumber(g.target_amount);
                    const pct = targetAmount > 0 ? Math.min(100, Math.max(0, (currentAmount / targetAmount) * 100)) : 0;
                    return (
                      <div key={g.id} className="space-y-1.5">
                        <div className="flex items-center justify-between">
                          <p className="text-xs font-semibold text-foreground truncate mr-2">{g.description}</p>
                          <span className="text-xs font-bold text-primary shrink-0 tabular-nums">{pct.toFixed(0)}%</span>
                        </div>
                        <div className="h-2 rounded-full bg-muted/40 overflow-hidden">
                          <div className="h-full rounded-full transition-all duration-700 ease-out bg-linear-to-r from-primary/60 to-primary" style={{ width: `${pct}%` }} />
                        </div>
                        <p className="text-[10px] text-muted-foreground tabular-nums">
                          R$ {fmt(currentAmount)} / R$ {fmt(targetAmount)}
                        </p>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : (
              <div className="rounded-3xl border border-dashed border-border/40 bg-card/20 flex flex-col items-center justify-center p-8 text-center animate-fade-in">
                <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center mb-3">
                  <Target size={20} className="text-primary" />
                </div>
                <p className="text-sm font-semibold text-foreground">Defina sua primeira meta</p>
                <p className="text-xs text-muted-foreground mt-1 mb-4">Acompanhe seu progresso mensal</p>
                <button onClick={() => navigate("/ferramentas/metas")} className="text-xs font-semibold text-primary hover:underline">
                  Criar meta →
                </button>
              </div>
            )}
          </div>
        </TabsContent>

        {/* ─── TAB: Análises ─── */}
        <TabsContent value="analytics" className="space-y-5 mt-5">
          <PeriodComparison installments={data?.installments || []} />
          <Suspense fallback={<div className="h-72 skeleton-shimmer rounded-2xl" aria-label="Carregando gráficos" />}>
            <DashboardCharts contracts={metrics.contracts} installments={data?.installments || []} profits={data?.profits || []} />
          </Suspense>
        </TabsContent>

        {/* ─── TAB: Listas ─── */}
        <TabsContent value="lists" className="mt-5">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Overdue List */}
            <div className="rounded-3xl border border-border/30 bg-card/40 backdrop-blur-md overflow-hidden animate-fade-in">
              <div className="flex items-center justify-between px-5 py-4 border-b border-border/30">
                <div className="flex items-center gap-2.5">
                  <div className="w-9 h-9 rounded-2xl bg-destructive/10 flex items-center justify-center">
                    <AlertCircle size={15} className="text-destructive" />
                  </div>
                  <h2 className="text-sm font-bold text-foreground">Parcelas atrasadas</h2>
                  {metrics.overdueCount > 0 && (
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-destructive/15 text-destructive font-bold">{metrics.overdueCount}</span>
                  )}
                </div>
                <button
                  onClick={() => navigate("/cobrancas")}
                  className="text-[10px] text-muted-foreground hover:text-primary flex items-center gap-1 font-semibold uppercase tracking-wider transition-colors"
                >
                  Ver todas <ArrowRight size={10} />
                </button>
              </div>
              {metrics.overdueList.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 px-6 text-center">
                  <div className="w-14 h-14 rounded-2xl bg-success/10 flex items-center justify-center mb-3">
                    <Sparkles size={22} className="text-success" />
                  </div>
                  <p className="text-sm font-semibold text-foreground">Tudo em dia!</p>
                  <p className="text-xs text-muted-foreground mt-1">Nenhuma parcela atrasada</p>
                </div>
              ) : (
                <div className="divide-y divide-border/20">
                  {metrics.overdueList.slice(0, 5).map((item: any) => (
                    <button
                      key={item.id}
                      onClick={() => navigate(`/clientes/${item.clientId || item.client_id}`)}
                      className="w-full flex items-center gap-3 px-5 py-3.5 hover:bg-destructive/5 transition-colors text-left"
                    >
                      <div className="w-9 h-9 rounded-xl bg-destructive/10 text-destructive flex items-center justify-center text-xs font-bold shrink-0">
                        {item.installment_number}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-foreground truncate">{item.clientName}</p>
                        <p className="text-xs text-muted-foreground tabular-nums">R$ {fmt(Number(item.amount))}</p>
                      </div>
                      <Badge variant="outline" className="bg-destructive/10 text-destructive border-destructive/25 text-[10px] font-bold rounded-lg px-2">
                        {item.daysOverdue}d
                      </Badge>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Recent Payments */}
            <div className="rounded-3xl border border-border/30 bg-card/40 backdrop-blur-md overflow-hidden animate-fade-in" style={{ animationDelay: "100ms" }}>
              <div className="flex items-center justify-between px-5 py-4 border-b border-border/30">
                <div className="flex items-center gap-2.5">
                  <div className="w-9 h-9 rounded-2xl bg-success/10 flex items-center justify-center">
                    <Activity size={15} className="text-success" />
                  </div>
                  <h2 className="text-sm font-bold text-foreground">Pagamentos recentes</h2>
                </div>
              </div>
              {metrics.recentPayments.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 px-6 text-center">
                  <div className="w-14 h-14 rounded-2xl bg-muted/40 flex items-center justify-center mb-3">
                    <DollarSign size={22} className="text-muted-foreground/60" />
                  </div>
                  <p className="text-sm font-semibold text-foreground">Sem pagamentos</p>
                  <p className="text-xs text-muted-foreground mt-1">Nenhum pagamento registrado ainda</p>
                </div>
              ) : (
                <div className="divide-y divide-border/20">
                  {metrics.recentPayments.map((item: any) => {
                    const contract = metrics.contracts.find((c: any) => c.id === item.contract_id);
                    return (
                      <div key={item.id} className="flex items-center gap-3 px-5 py-3.5 hover:bg-success/5 transition-colors">
                        <div className="w-9 h-9 rounded-xl bg-success/10 flex items-center justify-center shrink-0">
                          <ArrowUpRight size={15} className="text-success" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-foreground truncate">{contract?.clients?.name || "—"}</p>
                          <p className="text-xs text-muted-foreground">
                            Parcela {item.installment_number} · {item.paid_at ? formatBR(item.paid_at) : "—"}
                          </p>
                        </div>
                        <span className="text-sm font-bold text-success whitespace-nowrap tabular-nums">
                            +R$ {fmt(item.paid_amount ?? item.amount)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default Dashboard;
