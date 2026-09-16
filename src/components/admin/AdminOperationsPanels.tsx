import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Activity, AlertTriangle, Bot, CheckCircle2, CircleDollarSign,
  Clock3, CreditCard, Landmark, LifeBuoy, RefreshCw, ShieldAlert,
  ShieldCheck, Users,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import ErrorState from "@/components/feedback/ErrorState";
import { formatBR, formatBRDateTime } from "@/lib/dateUtils";

type CountResult = { count: number | null; error: unknown };

const safeAdminNumber = (value: unknown) => {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
};
const safeAdminDate = (value: unknown) => formatBR(typeof value === "string" ? value : null) || "data indisponível";
const safeAdminDateTime = (value: unknown) => formatBRDateTime(typeof value === "string" ? value : null) || "data indisponível";

const countRows = async (table: string, apply?: (query: any) => any) => {
  let query = (supabase.from(table as any) as any).select("*", { count: "exact", head: true });
  if (apply) query = apply(query);
  const result = await query as CountResult;
  if (result.error) throw result.error;
  return result.count || 0;
};

const Metric = ({ icon: Icon, label, value, hint, tone = "primary" }: any) => {
  const tones: Record<string, string> = {
    primary: "bg-primary/10 text-primary",
    success: "bg-emerald-500/10 text-emerald-400",
    warning: "bg-amber-500/10 text-amber-400",
    danger: "bg-red-500/10 text-red-400",
    info: "bg-sky-500/10 text-sky-400",
  };
  return (
    <div className="rounded-2xl border border-border bg-card p-4 min-w-0">
      <div className={`h-9 w-9 rounded-xl flex items-center justify-center ${tones[tone] || tones.primary}`}>
        <Icon size={17} />
      </div>
      <p className="mt-3 text-xs text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-2xl font-bold text-foreground truncate">{value}</p>
      {hint && <p className="mt-1 text-[10px] text-muted-foreground line-clamp-2">{hint}</p>}
    </div>
  );
};

const PanelHeader = ({ title, subtitle, onRefresh, refreshing }: any) => (
  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
    <div>
      <h2 className="text-lg font-bold text-foreground">{title}</h2>
      <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>
    </div>
    <Button variant="outline" size="sm" onClick={onRefresh} disabled={refreshing} className="self-start sm:self-auto">
      <RefreshCw size={13} className={refreshing ? "animate-spin" : ""} /> Atualizar
    </Button>
  </div>
);

export const AdminOverviewPanel = () => {
  const query = useQuery({
    queryKey: ["admin", "operational-overview"],
    queryFn: async () => {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const day = today.toISOString();
      const [users, activeSubscriptions, openTickets, unreadTickets, automationErrors, clientErrors, botFailures, contracts] = await Promise.all([
        countRows("profiles"),
        countRows("subscriptions", (q) => q.eq("status", "active")),
        countRows("support_tickets", (q) => q.neq("status", "closed")),
        countRows("support_tickets", (q) => q.eq("unread_by_admin", true)),
        countRows("automation_logs", (q) => q.eq("level", "error").gte("created_at", day)),
        countRows("client_errors", (q) => q.gte("criado_em", day)),
        countRows("bot_actions_log", (q) => q.eq("success", false).gte("created_at", day)),
        countRows("contracts"),
      ]);
      return { users, activeSubscriptions, openTickets, unreadTickets, automationErrors, clientErrors, botFailures, contracts };
    },
    refetchInterval: 60_000,
  });

  if (query.error) return <ErrorState error={query.error} onRetry={() => query.refetch()} />;
  const d = query.data;
  return (
    <div className="space-y-5 animate-fade-in">
      <PanelHeader title="Central de operação" subtitle="Saúde da plataforma e filas que exigem atenção" onRefresh={() => query.refetch()} refreshing={query.isFetching} />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Metric icon={Users} label="Usuários" value={d?.users ?? "—"} hint="Perfis cadastrados" />
        <Metric icon={CreditCard} label="Assinaturas ativas" value={d?.activeSubscriptions ?? "—"} tone="success" />
        <Metric icon={Landmark} label="Contratos" value={d?.contracts ?? "—"} hint="Em toda a plataforma" tone="info" />
        <Metric icon={LifeBuoy} label="Tickets abertos" value={d?.openTickets ?? "—"} hint={`${d?.unreadTickets || 0} aguardando leitura`} tone={d?.unreadTickets ? "warning" : "success"} />
        <Metric icon={Activity} label="Falhas de automação hoje" value={d?.automationErrors ?? "—"} tone={d?.automationErrors ? "danger" : "success"} />
        <Metric icon={ShieldAlert} label="Erros do app hoje" value={d?.clientErrors ?? "—"} tone={d?.clientErrors ? "warning" : "success"} />
        <Metric icon={Bot} label="Falhas do bot hoje" value={d?.botFailures ?? "—"} tone={d?.botFailures ? "danger" : "success"} />
        <Metric icon={ShieldCheck} label="Estado geral" value={(d?.automationErrors || d?.clientErrors || d?.botFailures) ? "Atenção" : "Saudável"} tone={(d?.automationErrors || d?.clientErrors || d?.botFailures) ? "warning" : "success"} />
      </div>
      <div className="rounded-2xl border border-border bg-card p-5">
        <h3 className="text-sm font-semibold text-foreground">Prioridades automáticas</h3>
        <div className="mt-3 grid gap-2 md:grid-cols-2">
          {[
            { ok: !d?.unreadTickets, text: d?.unreadTickets ? `${d.unreadTickets} ticket(s) aguardando atendimento` : "Nenhum ticket não lido", icon: LifeBuoy },
            { ok: !d?.automationErrors, text: d?.automationErrors ? `${d.automationErrors} falha(s) de automação hoje` : "Automações sem falhas hoje", icon: Activity },
            { ok: !d?.botFailures, text: d?.botFailures ? `${d.botFailures} ação(ões) do bot falharam hoje` : "Bot sem falhas registradas hoje", icon: Bot },
            { ok: !d?.clientErrors, text: d?.clientErrors ? `${d.clientErrors} erro(s) de interface hoje` : "Frontend sem erros registrados hoje", icon: ShieldAlert },
          ].map((item) => (
            <div key={item.text} className="flex items-center gap-3 rounded-xl border border-border/70 bg-accent/20 p-3">
              <item.icon size={15} className={item.ok ? "text-emerald-400" : "text-amber-400"} />
              <span className="text-xs text-foreground">{item.text}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export const AdminFinancePanel = () => {
  const query = useQuery({
    queryKey: ["admin", "finance"],
    queryFn: async () => {
      const [{ data: subscriptions, error: subError }, { data: transactions, error: txError }] = await Promise.all([
        supabase.from("subscriptions").select("id,email,status,plan_name,plan_tier,provider,amount_paid,current_period_end,created_at").order("created_at", { ascending: false }).limit(100),
        supabase.from("transactions").select("id,type,amount,principal_amount,interest_amount,date,description").order("date", { ascending: false }).limit(100),
      ]);
      if (subError) throw subError;
      if (txError) throw txError;
      return { subscriptions: subscriptions || [], transactions: transactions || [] };
    },
  });
  const summary = useMemo(() => {
    const subscriptions = query.data?.subscriptions || [];
    const transactions = query.data?.transactions || [];
    return {
      active: subscriptions.filter((s) => s.status === "active").length,
      pending: subscriptions.filter((s) => ["pending", "in_process"].includes(s.status)).length,
      failed: subscriptions.filter((s) => ["failed", "cancelled", "canceled"].includes(s.status)).length,
      paid: subscriptions.reduce((sum, s) => sum + safeAdminNumber(s.amount_paid), 0),
      volume: transactions.reduce((sum, t) => sum + Math.abs(safeAdminNumber(t.amount)), 0),
    };
  }, [query.data]);
  if (query.error) return <ErrorState error={query.error} onRetry={() => query.refetch()} />;
  return (
    <div className="space-y-5 animate-fade-in">
      <PanelHeader title="Financeiro da plataforma" subtitle="Assinaturas, recebimentos e conciliação operacional" onRefresh={() => query.refetch()} refreshing={query.isFetching} />
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <Metric icon={CheckCircle2} label="Ativas" value={summary.active} tone="success" />
        <Metric icon={Clock3} label="Pendentes" value={summary.pending} tone="warning" />
        <Metric icon={AlertTriangle} label="Falhas/canceladas" value={summary.failed} tone={summary.failed ? "danger" : "success"} />
        <Metric icon={CircleDollarSign} label="Pagamentos registrados" value={summary.paid.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })} />
        <Metric icon={Landmark} label="Movimentação recente" value={summary.volume.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })} tone="info" />
      </div>
      <div className="rounded-2xl border border-border bg-card overflow-hidden">
        <div className="p-4 border-b border-border"><h3 className="text-sm font-semibold">Assinaturas recentes</h3></div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-xs text-left">
            <thead className="bg-accent/30 text-muted-foreground"><tr><th className="p-3">Cliente</th><th className="p-3">Plano</th><th className="p-3">Provedor</th><th className="p-3">Valor</th><th className="p-3">Status</th><th className="p-3">Período</th></tr></thead>
            <tbody className="divide-y divide-border/60">
              {(query.data?.subscriptions || []).map((s) => <tr key={s.id}><td className="p-3">{s.email || "—"}</td><td className="p-3">{s.plan_name || s.plan_tier || "—"}</td><td className="p-3">{s.provider || "—"}</td><td className="p-3">{safeAdminNumber(s.amount_paid).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}</td><td className="p-3"><Badge variant={s.status === "active" ? "default" : "outline"}>{s.status || "—"}</Badge></td><td className="p-3 text-muted-foreground">{safeAdminDate(s.current_period_end)}</td></tr>)}
          {!query.isLoading && !(query.data?.subscriptions || []).length && <tr><td colSpan={6} className="p-8 text-center text-muted-foreground">Nenhuma assinatura registrada.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export const AdminSecurityPanel = () => {
  const query = useQuery({
    queryKey: ["admin", "security-health"],
    queryFn: async () => {
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const [blocked, admins, auditEvents, clientErrors, botFailures] = await Promise.all([
        countRows("profiles", (q) => q.eq("is_blocked", true)),
        countRows("profiles", (q) => q.eq("is_admin", true)),
        countRows("audit_logs", (q) => q.gte("created_at", since)),
        countRows("client_errors", (q) => q.gte("criado_em", since)),
        countRows("bot_actions_log", (q) => q.eq("success", false).gte("created_at", since)),
      ]);
      const { data: recent, error } = await supabase.from("audit_logs").select("id,action,entity_type,entity_id,created_at").order("created_at", { ascending: false }).limit(30);
      if (error) throw error;
      return { blocked, admins, auditEvents, clientErrors, botFailures, recent: recent || [] };
    },
  });
  if (query.error) return <ErrorState error={query.error} onRetry={() => query.refetch()} />;
  const d = query.data;
  return (
    <div className="space-y-5 animate-fade-in">
      <PanelHeader title="Segurança e governança" subtitle="Permissões privilegiadas, bloqueios e trilha administrativa" onRefresh={() => query.refetch()} refreshing={query.isFetching} />
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <Metric icon={ShieldCheck} label="Administradores" value={d?.admins ?? "—"} />
        <Metric icon={ShieldAlert} label="Usuários bloqueados" value={d?.blocked ?? "—"} tone={d?.blocked ? "warning" : "success"} />
        <Metric icon={Activity} label="Eventos de auditoria (24h)" value={d?.auditEvents ?? "—"} tone="info" />
        <Metric icon={AlertTriangle} label="Erros do app (24h)" value={d?.clientErrors ?? "—"} tone={d?.clientErrors ? "warning" : "success"} />
        <Metric icon={Bot} label="Falhas do bot (24h)" value={d?.botFailures ?? "—"} tone={d?.botFailures ? "danger" : "success"} />
      </div>
      <div className="rounded-2xl border border-border bg-card overflow-hidden">
        <div className="p-4 border-b border-border"><h3 className="text-sm font-semibold">Atividade administrativa recente</h3></div>
        <div className="divide-y divide-border/60">
          {(d?.recent || []).map((event) => <div key={event.id} className="p-3 flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 text-xs"><Badge variant="outline">{event.action || "—"}</Badge><span className="font-medium">{event.entity_type || "—"}</span><span className="font-mono text-[10px] text-muted-foreground truncate flex-1">{event.entity_id || "—"}</span><time className="text-muted-foreground">{safeAdminDateTime(event.created_at)}</time></div>)}
          {!query.isLoading && !(d?.recent || []).length && <p className="p-8 text-center text-sm text-muted-foreground">Nenhum evento recente.</p>}
        </div>
      </div>
    </div>
  );
};
