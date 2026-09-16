import { useState, useEffect, useMemo } from "react";
import {
  Users, Ban, CheckCircle, Search, Shield, Crown, MessageCircle,
  TrendingUp, UserCheck, UserX, Calendar, Filter, MoreVertical,
  Mail, Trash2, Eye, AlertTriangle, Sparkles, Download, LifeBuoy,
  LayoutDashboard, Activity, Terminal, Lock, Settings2, CreditCard
} from "lucide-react";
import SupportInbox from "@/components/admin/SupportInbox";
import GrantAccessDialog from "@/components/admin/GrantAccessDialog";
import PlatformSettingsPanel from "@/components/admin/PlatformSettingsPanel";
import ClientErrorsPanel from "@/components/admin/ClientErrorsPanel";
import { AdminFinancePanel, AdminOverviewPanel, AdminSecurityPanel } from "@/components/admin/AdminOperationsPanels";
import { useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { friendlyError } from "@/lib/friendlyError";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter
} from "@/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
  DropdownMenuSeparator, DropdownMenuLabel
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle
} from "@/components/ui/alert-dialog";
import { formatBR, formatBRDateTime, todayLocalISO } from "@/lib/dateUtils";
import { PLANS, normalizeTier } from "@/lib/plans";
import ErrorState from "@/components/feedback/ErrorState";
import { fetchAll } from "@/lib/fetchAll";
import { hasProfileEntitlement } from "@/lib/entitlement";

const csvCell = (value: unknown) => {
  let text = String(value ?? "");
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
};

const safeAdminMoney = (value: unknown) => {
  const number = Number(value ?? 0);
  return (Number.isFinite(number) ? number : 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};
const safeAdminNumber = (value: unknown) => {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
};
const safeAdminDateTime = (value: unknown) => formatBRDateTime(typeof value === "string" ? value : null) || "data indisponível";

type UserRow = {
  id: string;
  name: string;
  email: string | null;
  avatar_url: string | null;
  is_admin: boolean;
  is_blocked: boolean;
  is_chat_blocked: boolean;
  subscription_type: string | null;
  plan_tier?: string | null;
  subscription_expires_at: string | null;
  trial_ends_at: string | null;
  created_at: string;
  loan_balance: number;
  profit_balance: number;
  expense_balance: number;
};

type FilterTab = "all" | "active" | "blocked" | "expired" | "admins";
type AdminSection = "overview" | "users" | "finance" | "support" | "automations" | "security" | "logs" | "settings";

const ADMIN_SECTIONS: AdminSection[] = ["overview", "users", "finance", "support", "automations", "security", "logs", "settings"];
const isAdminSection = (v: string | null): v is AdminSection =>
  !!v && (ADMIN_SECTIONS as string[]).includes(v);

const Admin = () => {
  const { profile, user, isPlatformAdmin } = useAuth();
  const { toast } = useToast();

  // A seção vive na URL (?secao=) para que o menu lateral do painel consiga
  // apontar direto para cada uma e o botão voltar do navegador funcione.
  const [searchParams, setSearchParams] = useSearchParams();
  const sectionParam = searchParams.get("secao");
  const section: AdminSection = isAdminSection(sectionParam) ? sectionParam : "overview";
  const setSection = (next: AdminSection) => {
    setSearchParams(next === "overview" ? {} : { secao: next }, { replace: false });
  };
  const [supportUnread, setSupportUnread] = useState(0);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState<FilterTab>("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [detailUser, setDetailUser] = useState<UserRow | null>(null);
  const [confirmAction, setConfirmAction] = useState<{
    title: string;
    description: string;
    onConfirm: () => void;
  } | null>(null);
  const [notifyOpen, setNotifyOpen] = useState(false);
  const [notifyMsg, setNotifyMsg] = useState("");
  const [notifyRecipients, setNotifyRecipients] = useState<UserRow[]>([]);
  const [notifySending, setNotifySending] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);

  const fetchUsers = async () => {
    try {
      const data = await fetchAll<UserRow>((from, to) => supabase
        .from("profiles")
        .select("*")
        .order("created_at", { ascending: false })
        .range(from, to));
      setLoadError(null);
      setUsers(data);
    } catch (error) {
      setLoadError(error);
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchUsers();
    const ch = supabase
      .channel("realtime-admin-profiles")
      .on("postgres_changes" as any, { event: "*", schema: "public", table: "profiles" }, () => fetchUsers())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  // Counter of unread support tickets (for the tab badge)
  useEffect(() => {
    const fetchUnread = async () => {
      const { count } = await supabase
        .from("support_tickets")
        .select("*", { count: "exact", head: true })
        .eq("unread_by_admin", true);
      setSupportUnread(count || 0);
    };
    fetchUnread();
    const ch = supabase
      .channel("realtime-support-unread")
      .on("postgres_changes" as any, { event: "*", schema: "public", table: "support_tickets" }, fetchUnread)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  const isExpired = (u: UserRow) => !u.is_admin && !hasProfileEntitlement({
    subscriptionType: u.subscription_type,
    trialEndsAt: u.trial_ends_at,
    subscriptionExpiresAt: u.subscription_expires_at,
  });

  // ============ STATS ============
  const stats = useMemo(() => {
    const total = users.length;
    const blocked = users.filter((u) => u.is_blocked).length;
    const admins = users.filter((u) => u.is_admin).length;
    const monthly = users.filter((u) => u.subscription_type === "monthly").length;
    const yearly = users.filter((u) => u.subscription_type === "yearly").length;
    const lifetime = users.filter((u) => u.subscription_type === "lifetime").length;
    const expired = users.filter((u) => isExpired(u) && !u.is_admin).length;
    const active = users.filter((u) => !u.is_blocked && !isExpired(u)).length;

    // Receita recorrente pelo preço REAL do plano de cada assinante.
    // A conta anterior usava `monthly * 49,90 + yearly * 499/12` — preços de uma
    // tabela que não existe mais (hoje é 199 e 299) — e olhava para
    // `subscription_type`, que diz a periodicidade, não o plano. O plano está em
    // `plan_tier`. Com a base atual isso mostrava R$ 149,70 no lugar de R$ 897.
    //
    // Só entra quem paga de forma recorrente e está em dia: vitalício não gera
    // receita mensal, e expirado não gera receita nenhuma.
    const mrr = users.reduce((soma, u) => {
      if (u.is_admin || isExpired(u)) return soma;
      if (u.subscription_type !== "monthly" && u.subscription_type !== "yearly") return soma;
      const mensalidade = PLANS[normalizeTier(u.plan_tier)].price;
      // Plano anual entra rateado no mês, para comparar com o mensal.
      return soma + (u.subscription_type === "yearly" ? (mensalidade * 12 * 0.8) / 12 : mensalidade);
    }, 0);
    const churn = total > 0 ? (expired / total) * 100 : 0;
    const newThisMonth = users.filter((u) => {
      const d = new Date(u.created_at);
      const now = new Date();
      return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
    }).length;
    const totalLoaned = users.reduce((s, u) => s + safeAdminNumber(u.loan_balance), 0);
    const totalProfit = users.reduce((s, u) => s + safeAdminNumber(u.profit_balance), 0);
    return { total, blocked, admins, monthly, yearly, lifetime, expired, active, newThisMonth, totalLoaned, totalProfit, mrr, churn };
  }, [users]);

  // ============ FILTERED ============
  const filtered = useMemo(() => {
    let list = users;
    if (tab === "active") list = list.filter((u) => !u.is_blocked && !isExpired(u));
    else if (tab === "blocked") list = list.filter((u) => u.is_blocked);
    else if (tab === "expired") list = list.filter((u) => isExpired(u) && !u.is_admin);
    else if (tab === "admins") list = list.filter((u) => u.is_admin);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((u) => `${u.name} ${u.email || ""}`.toLowerCase().includes(q));
    }
    return list;
  }, [users, tab, search]);

  // ============ ACTIONS ============
  const handleToggleBlock = async (userId: string, current: boolean) => {
    const { error } = await supabase.from("profiles").update({ is_blocked: !current }).eq("id", userId);
    if (error) toast({ ...friendlyError(error, "Não foi possível atualizar o usuário."), variant: "destructive" });
    else toast({ title: current ? "Usuário desbloqueado" : "Usuário bloqueado" });
  };

  const handleToggleChatBlock = async (userId: string, current: boolean) => {
    const { error } = await supabase.from("profiles").update({ is_chat_blocked: !current }).eq("id", userId);
    if (error) { toast({ ...friendlyError(error, "Não foi possível atualizar o chat."), variant: "destructive" }); return; }
    toast({ title: current ? "Chat desbloqueado" : "Chat bloqueado" });
  };

  const handleToggleAdmin = async (userId: string, current: boolean) => {
    const { error } = await supabase.rpc("admin_set_user_admin", { _target_user_id: userId, _make_admin: !current });
    if (error) { toast({ ...friendlyError(error, "Não foi possível atualizar o administrador."), variant: "destructive" }); return; }
    toast({ title: current ? "Admin removido" : "Promovido a admin" });
  };

  const handleSetSubscription = async (userId: string, type: "monthly" | "yearly" | "lifetime") => {
    const expiresAt = new Date();
    if (type === "monthly") expiresAt.setMonth(expiresAt.getMonth() + 1);
    else if (type === "yearly") expiresAt.setFullYear(expiresAt.getFullYear() + 1);
    else expiresAt.setFullYear(2099, 11, 31);
    const { error } = await supabase.from("profiles").update({
      subscription_type: type,
      subscription_expires_at: expiresAt.toISOString(),
      trial_ends_at: type === "lifetime" ? expiresAt.toISOString() : null,
      is_blocked: false,
    }).eq("id", userId);
    if (error) { toast({ ...friendlyError(error, "Não foi possível atualizar a assinatura."), variant: "destructive" }); return; }
    setUsers((prev) => prev.map((u) => (u.id === userId
      ? { ...u, subscription_type: type, subscription_expires_at: expiresAt.toISOString(), is_blocked: false }
      : u)));
    toast({ title: type === "lifetime" ? "Acesso vitalício liberado" : "Assinatura atualizada" });
  };

  const handleSetPlanTier = async (userId: string, tier: string) => {
    const { error } = await supabase.from("profiles").update({ plan_tier: tier } as any).eq("id", userId);
    if (error) { toast({ ...friendlyError(error, "Não foi possível atualizar o plano."), variant: "destructive" }); return; }
    setUsers((prev) => prev.map((u) => (u.id === userId ? { ...u, plan_tier: tier } : u)));
    toast({ title: tier === "essencial" ? "Plano Essencial aplicado" : "Plano Completo aplicado" });
  };

  const handleExtendSubscription = async (userId: string, days: number) => {
    const u = users.find((x) => x.id === userId);
    const base = u?.subscription_expires_at ? new Date(u.subscription_expires_at) : new Date();
    if (base < new Date()) base.setTime(Date.now());
    base.setDate(base.getDate() + days);
    const { error } = await supabase.from("profiles").update({ subscription_expires_at: base.toISOString() }).eq("id", userId);
    if (error) { toast({ ...friendlyError(error, "Não foi possível estender a assinatura."), variant: "destructive" }); return; }
    toast({ title: `+${days} dias adicionados` });
  };

  // ============ BULK ============
  const toggleSelectAll = () => {
    if (selected.size === filtered.length) setSelected(new Set());
    else setSelected(new Set(filtered.map((u) => u.id)));
  };
  const toggleSelect = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  };

  const bulkBlock = async (block: boolean) => {
    const ids = Array.from(selected);
    const { error } = await supabase.from("profiles").update({ is_blocked: block }).in("id", ids);
    if (error) { toast({ ...friendlyError(error, "Não foi possível atualizar em massa."), variant: "destructive" }); return; }
    toast({ title: `${ids.length} usuário(s) ${block ? "bloqueados" : "desbloqueados"}` });
    setSelected(new Set());
  };

  const bulkExtend = async (days: number) => {
    const ids = Array.from(selected);
    for (const id of ids) await handleExtendSubscription(id, days);
    setSelected(new Set());
  };

  const openNotify = (recipients: UserRow[]) => {
    if (recipients.length === 0) return;
    setNotifyRecipients(recipients);
    setNotifyMsg("");
    setNotifyOpen(true);
  };

  const sendNotification = async () => {
    const message = notifyMsg.trim();
    if (!message || notifyRecipients.length === 0 || notifySending) return;

    setNotifySending(true);
    const rows = notifyRecipients.map(({ id: user_id }) => ({
      user_id,
      message,
      from: "Administração",
      type: "admin",
      link: "/notificacoes",
    }));
    const { error } = await supabase.from("notifications").insert(rows);
    setNotifySending(false);

    if (error) {
      toast({ ...friendlyError(error, "Não foi possível enviar a mensagem."), variant: "destructive" });
      return;
    }

    toast({
      title: notifyRecipients.length === 1 ? "Mensagem enviada" : "Mensagens enviadas",
      description: notifyRecipients.length === 1
        ? `${notifyRecipients[0].name} recebeu uma nova notificação no app.`
        : `${notifyRecipients.length} usuários receberam uma nova notificação no app.`,
    });
    setNotifyMsg("");
    setNotifyOpen(false);
    setNotifyRecipients([]);
    setSelected(new Set());
  };

  const exportCSV = () => {
    const headers = ["Nome", "Email", "Plano", "Expira", "Status", "Admin", "Criado em"];
    const rows = filtered.map((u) => [
      u.name,
      u.email || "",
      u.subscription_type || "",
      u.subscription_expires_at ? formatBR(u.subscription_expires_at) : "",
      u.is_blocked ? "Bloqueado" : isExpired(u) ? "Expirado" : "Ativo",
      u.is_admin ? "Sim" : "Não",
      formatBR(u.created_at),
    ]);
    const csv = [headers, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n");
    const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `usuarios-${todayLocalISO()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const tabs: { key: FilterTab; label: string; count: number }[] = [
    { key: "all", label: "Todos", count: stats.total },
    { key: "active", label: "Ativos", count: stats.active },
    { key: "blocked", label: "Bloqueados", count: stats.blocked },
    { key: "expired", label: "Expirados", count: stats.expired },
    { key: "admins", label: "Admins", count: stats.admins },
  ];

  if (!isPlatformAdmin) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <div className="w-20 h-20 rounded-2xl bg-destructive/10 flex items-center justify-center mb-4">
          <Shield size={40} className="text-destructive" />
        </div>
        <h1 className="text-xl font-bold text-foreground mb-2">Acesso Restrito</h1>
        <p className="text-muted-foreground max-w-sm">
          Você não tem permissão para acessar esta página. Apenas administradores podem visualizar este painel.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <GrantAccessDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onDone={fetchUsers}
      />

      {/* Header */}
      <div className="page-hero animate-fade-in">
        <div className="page-hero-content flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="page-hero-icon">
              <Crown size={22} />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-shimmer">Painel Administrativo</h1>
              <p className="text-muted-foreground text-sm mt-0.5">
                Gerencie usuários, assinaturas e permissões em tempo real
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => setCreateOpen(true)} className="btn-ghost">
              <UserCheck size={14} /> Liberar acesso
            </button>
            <Link to="/admin/bot-audit" className="btn-ghost">
              <Activity size={14} /> Bot Audit
            </Link>
            <button type="button" onClick={exportCSV} className="btn-ghost">
              <Download size={14} /> Exportar CSV
            </button>
          </div>
        </div>
      </div>

      {/* Section Navigation */}
      <div className="flex flex-nowrap items-center gap-1 border-b border-border overflow-x-auto scrollbar-thin">
        <NavButton
          active={section === "overview"}
          onClick={() => setSection("overview")}
          icon={LayoutDashboard}
          label="Visão geral"
        />
        <NavButton
          active={section === "users"}
          onClick={() => setSection("users")}
          icon={Users}
          label="Usuários"
        />
        <NavButton
          active={section === "finance"}
          onClick={() => setSection("finance")}
          icon={CreditCard}
          label="Financeiro"
        />
        <NavButton
          active={section === "support"}
          onClick={() => setSection("support")}
          icon={LifeBuoy}
          label="Suporte"
          badge={supportUnread}
        />
        <NavButton
          active={section === "automations"}
          onClick={() => setSection("automations")}
          icon={Activity}
          label="Automações"
        />
        <NavButton
          active={section === "security"}
          onClick={() => setSection("security")}
          icon={Lock}
          label="Segurança"
        />
        <NavButton
          active={section === "logs"}
          onClick={() => setSection("logs")}
          icon={Terminal}
          label="Logs"
        />
        <NavButton
          active={section === "settings"}
          onClick={() => setSection("settings")}
          icon={Settings2}
          label="Plataforma"
        />
      </div>

      {section === "overview" ? (
        <AdminOverviewPanel />
      ) : section === "finance" ? (
        <AdminFinancePanel />
      ) : section === "support" ? (
        <SupportInbox />
      ) : section === "automations" ? (
        <AdminAutomacoesWrapper />
      ) : section === "security" ? (
        <AdminSecurityPanel />
      ) : section === "logs" ? (
        <AdminLogs />
      ) : section === "settings" ? (
        <PlatformSettingsPanel />
      ) : (
      <>
      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <KpiCard icon={Users} label="Total" value={stats.total} tone="primary" />
        <KpiCard icon={UserCheck} label="Ativos" value={stats.active} tone="success" />
        <KpiCard icon={UserX} label="Bloqueados" value={stats.blocked} tone="danger" />
        <KpiCard icon={AlertTriangle} label="Expirados" value={stats.expired} tone="warning" />
        <KpiCard icon={Crown} label="Admins" value={stats.admins} tone="accent" />
        <KpiCard icon={Sparkles} label="Novos (mês)" value={stats.newThisMonth} tone="info" />
      </div>

      {/* Plan distribution */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="rounded-2xl border border-border bg-card p-5">
          <p className="text-xs font-medium text-muted-foreground mb-3 flex items-center gap-2">
            <TrendingUp size={14} /> DISTRIBUIÇÃO DE PLANOS
          </p>
          <div className="space-y-3">
            <PlanBar label="Mensal" value={stats.monthly} total={stats.total} color="bg-blue-500" />
            <PlanBar label="Anual" value={stats.yearly} total={stats.total} color="bg-emerald-500" />
            <PlanBar label="Vitalício" value={stats.lifetime} total={stats.total} color="bg-amber-500" />
            <PlanBar
              label="Sem plano"
              value={stats.total - stats.monthly - stats.yearly - stats.lifetime}
              total={stats.total}
              color="bg-muted-foreground/40"
            />
          </div>
        </div>
        <div className="rounded-2xl border border-border bg-card p-5">
          <p className="text-xs font-medium text-muted-foreground mb-3 flex items-center gap-2">
            <TrendingUp size={14} /> SAÚDE DA BASE & FINANCEIRO
          </p>
          <div className="grid grid-cols-2 gap-3">
            <MiniStat label="Receita mensal" value={`R$ ${stats.mrr.toFixed(2)}`} />
            <MiniStat label="Taxa Churn" value={`${stats.churn.toFixed(1)}%`} />
            <MiniStat label="Capital Total" value={`R$ ${(stats.totalLoaned / 1000).toFixed(1)}k`} />
            <MiniStat label="Lucro Total" value={`R$ ${(stats.totalProfit / 1000).toFixed(1)}k`} />
          </div>
        </div>
      </div>

      {/* Filters tabs */}
      <div className="flex flex-wrap items-center gap-2 border-b border-border pb-3">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors flex items-center gap-2 ${
              tab === t.key
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground hover:bg-accent"
            }`}
          >
            {t.label}
            <span className={`text-xs px-1.5 py-0.5 rounded ${
              tab === t.key ? "bg-primary-foreground/20" : "bg-accent"
            }`}>{t.count}</span>
          </button>
        ))}
      </div>

      {/* Search + bulk bar */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            placeholder="Buscar por nome ou email..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 rounded-lg bg-input/80 border border-border/50 text-foreground placeholder:text-muted-foreground text-sm focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </div>
        {selected.size > 0 && (
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-primary/10 border border-primary/30">
            <span className="text-xs font-medium text-foreground">{selected.size} selecionado(s)</span>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" variant="outline" className="h-7 text-xs">Ações</Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel>Ações em massa</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => bulkBlock(true)}><Ban size={14} className="mr-2" />Bloquear</DropdownMenuItem>
                <DropdownMenuItem onClick={() => bulkBlock(false)}><CheckCircle size={14} className="mr-2" />Desbloquear</DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => bulkExtend(7)}>+7 dias de assinatura</DropdownMenuItem>
                <DropdownMenuItem onClick={() => bulkExtend(30)}>+30 dias de assinatura</DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => openNotify(users.filter((u) => selected.has(u.id)))}>
                  <Mail size={14} className="mr-2" />Enviar notificação
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setSelected(new Set())}>
              Limpar
            </Button>
          </div>
        )}
      </div>

      {/* Table */}
      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-16 rounded-xl bg-muted/40 animate-pulse" />
          ))}
        </div>
      ) : loadError ? (
        <ErrorState error={loadError} onRetry={() => { setLoading(true); fetchUsers(); }} />
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 rounded-2xl border border-dashed border-border">
          <Users size={40} className="mx-auto text-muted-foreground mb-3" />
          <p className="text-foreground font-medium">Nenhum usuário encontrado</p>
          <p className="text-sm text-muted-foreground mt-1">Ajuste os filtros ou a busca.</p>
        </div>
      ) : (
        <div className="rounded-2xl border border-border overflow-hidden bg-card">
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[1000px]">
              <thead className="bg-accent/40">
                <tr>
                  <th className="px-3 py-3 w-10">
                    <input
                      type="checkbox"
                      checked={selected.size > 0 && selected.size === filtered.length}
                      onChange={toggleSelectAll}
                      className="rounded border-border"
                    />
                  </th>
                  <th className="text-left px-4 py-3 text-muted-foreground font-medium text-xs uppercase tracking-wider">Usuário</th>
                  <th className="text-left px-4 py-3 text-muted-foreground font-medium text-xs uppercase tracking-wider">Plano</th>
                  <th className="text-left px-4 py-3 text-muted-foreground font-medium text-xs uppercase tracking-wider">Expira</th>
                  <th className="text-left px-4 py-3 text-muted-foreground font-medium text-xs uppercase tracking-wider">Status</th>
                  <th className="text-left px-4 py-3 text-muted-foreground font-medium text-xs uppercase tracking-wider">Cadastro</th>
                  <th className="text-right px-4 py-3 text-muted-foreground font-medium text-xs uppercase tracking-wider">Ações</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((u) => {
                  const expired = isExpired(u);
                  const checked = selected.has(u.id);
                  return (
                    <tr
                      key={u.id}
                      className={`border-t border-border hover:bg-accent/20 transition-colors ${checked ? "bg-primary/5" : ""}`}
                    >
                      <td className="px-3 py-3">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleSelect(u.id)}
                          className="rounded border-border"
                        />
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <div className="w-9 h-9 rounded-full bg-gradient-to-br from-primary/30 to-primary/10 flex items-center justify-center text-sm font-semibold text-foreground overflow-hidden flex-shrink-0">
                            {u.avatar_url ? (
                              <img src={u.avatar_url} alt="" className="w-full h-full object-cover" />
                            ) : (
                              u.name?.charAt(0)?.toUpperCase() || "U"
                            )}
                          </div>
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <p className="text-foreground font-medium truncate">{u.name}</p>
                              {u.is_admin && (
                                <Badge variant="outline" className="h-4 px-1 text-[9px] border-primary/50 text-primary">
                                  ADMIN
                                </Badge>
                              )}
                            </div>
                            <p className="text-xs text-muted-foreground truncate">{u.email || "—"}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <select
                          value={u.subscription_type || "monthly"}
                          onChange={(e) => handleSetSubscription(u.id, e.target.value as "monthly" | "yearly" | "lifetime")}
                          className="text-xs px-2 py-1 rounded-md bg-input border border-border text-foreground"
                        >
                          <option value="monthly">Mensal</option>
                          <option value="yearly">Anual</option>
                          <option value="lifetime">Vitalício</option>
                        </select>
                        <select
                          value={u.plan_tier || "completo"}
                          onChange={(e) => handleSetPlanTier(u.id, e.target.value)}
                          className="mt-1 text-xs px-2 py-1 rounded-md bg-input border border-border text-foreground"
                          title="Plano contratado (define acesso a IA e automações)"
                        >
                          <option value="essencial">Essencial R$199</option>
                          <option value="completo">Completo R$299</option>
                        </select>
                      </td>
                      <td className="px-4 py-3">
                        {u.subscription_expires_at ? (
                          <div className="flex items-center gap-1.5">
                            <Calendar size={12} className={expired ? "text-destructive" : "text-muted-foreground"} />
                            <span className={`text-xs ${expired ? "text-destructive font-medium" : "text-muted-foreground"}`}>
                              {formatBR(u.subscription_expires_at)}
                            </span>
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {u.is_blocked ? (
                          <Badge className="bg-destructive/15 text-destructive border-0 hover:bg-destructive/20">Bloqueado</Badge>
                        ) : expired ? (
                          <Badge className="bg-amber-500/15 text-amber-500 border-0 hover:bg-amber-500/20">Expirado</Badge>
                        ) : (
                          <Badge className="bg-emerald-500/15 text-emerald-500 border-0 hover:bg-emerald-500/20">Ativo</Badge>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">
                        {formatBR(u.created_at)}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={() => setDetailUser(u)}
                            className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                            title="Ver detalhes"
                            aria-label={`Ver detalhes de ${u.name}`}
                          >
                            <Eye size={15} />
                          </button>
                          <button
                            onClick={() =>
                              setConfirmAction({
                                title: u.is_blocked ? "Desbloquear usuário?" : "Bloquear usuário?",
                                description: u.is_blocked
                                  ? `${u.name} voltará a ter acesso ao sistema.`
                                  : `${u.name} perderá acesso ao sistema imediatamente.`,
                                onConfirm: () => handleToggleBlock(u.id, u.is_blocked),
                              })
                            }
                            className={`p-1.5 rounded-lg transition-colors ${
                              u.is_blocked
                                ? "text-emerald-500 hover:bg-emerald-500/15"
                                : "text-destructive hover:bg-destructive/15"
                            }`}
                            title={u.is_blocked ? "Desbloquear" : "Bloquear"}
                            aria-label={u.is_blocked ? `Desbloquear ${u.name}` : `Bloquear ${u.name}`}
                          >
                            {u.is_blocked ? <CheckCircle size={15} /> : <Ban size={15} />}
                          </button>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <button className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors" aria-label={`Mais ações para ${u.name}`}>
                                <MoreVertical size={15} />
                              </button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-52">
                              <DropdownMenuLabel className="text-xs">{u.name}</DropdownMenuLabel>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem onClick={() => openNotify([u])}>
                                <Mail size={14} className="mr-2" /> Enviar mensagem
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem onClick={() => handleExtendSubscription(u.id, 7)}>
                                <Calendar size={14} className="mr-2" /> +7 dias
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => handleExtendSubscription(u.id, 30)}>
                                <Calendar size={14} className="mr-2" /> +30 dias
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => handleExtendSubscription(u.id, 365)}>
                                <Calendar size={14} className="mr-2" /> +1 ano
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem onClick={() => handleToggleChatBlock(u.id, u.is_chat_blocked)}>
                                <MessageCircle size={14} className="mr-2" />
                                {u.is_chat_blocked ? "Liberar chat" : "Bloquear chat"}
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onClick={() =>
                                  setConfirmAction({
                                    title: u.is_admin ? "Remover admin?" : "Promover a admin?",
                                    description: u.is_admin
                                      ? `${u.name} perderá acesso administrativo.`
                                      : `${u.name} terá acesso total ao sistema.`,
                                    onConfirm: () => handleToggleAdmin(u.id, u.is_admin),
                                  })
                                }
                              >
                                <Crown size={14} className="mr-2" />
                                {u.is_admin ? "Remover admin" : "Tornar admin"}
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
      </>
      )}

      {/* Detail dialog */}
      <Dialog open={!!detailUser} onOpenChange={(o) => !o && setDetailUser(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-gradient-to-br from-primary/30 to-primary/10 flex items-center justify-center text-foreground font-semibold overflow-hidden">
                {detailUser?.avatar_url ? (
                  <img src={detailUser.avatar_url} alt="" className="w-full h-full object-cover" />
                ) : (
                  detailUser?.name?.charAt(0)?.toUpperCase()
                )}
              </div>
              {detailUser?.name}
            </DialogTitle>
            <DialogDescription>{detailUser?.email}</DialogDescription>
          </DialogHeader>
          {detailUser && (
            <div className="space-y-3 text-sm">
              <DetailRow label="ID" value={detailUser.id} mono />
              <DetailRow label="Plano" value={`${detailUser.subscription_type === "lifetime" ? "Vitalício" : detailUser.subscription_type === "yearly" ? "Anual" : "Mensal"} · ${detailUser.plan_tier === "essencial" ? "Essencial (R$199)" : "Completo (R$299)"}`} />
              <DetailRow
                label="Expira em"
                value={
                  safeAdminDateTime(detailUser.subscription_expires_at)
                }
              />
              <DetailRow label="Cadastrado em" value={safeAdminDateTime(detailUser.created_at)} />
              <DetailRow label="Capital emprestado" value={`R$ ${safeAdminMoney(detailUser.loan_balance)}`} />
              <DetailRow label="Lucro acumulado" value={`R$ ${safeAdminMoney(detailUser.profit_balance)}`} />
              <DetailRow label="Despesas" value={`R$ ${safeAdminMoney(detailUser.expense_balance)}`} />
              <div className="flex flex-wrap gap-2 pt-2">
                {detailUser.is_admin && <Badge className="bg-primary/20 text-primary border-0">Admin</Badge>}
                {detailUser.is_blocked && <Badge className="bg-destructive/20 text-destructive border-0">Bloqueado</Badge>}
                {detailUser.is_chat_blocked && <Badge className="bg-muted text-muted-foreground border-0">Chat bloqueado</Badge>}
                {isExpired(detailUser) && <Badge className="bg-amber-500/20 text-amber-500 border-0">Expirado</Badge>}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Notify dialog */}
      <Dialog
        open={notifyOpen}
        onOpenChange={(open) => {
          if (notifySending) return;
          setNotifyOpen(open);
          if (!open) {
            setNotifyMsg("");
            setNotifyRecipients([]);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {notifyRecipients.length === 1 ? "Enviar mensagem direta" : "Enviar notificação"}
            </DialogTitle>
            <DialogDescription>
              {notifyRecipients.length === 1
                ? `${notifyRecipients[0]?.name} receberá a mensagem no sino e na central de notificações do app.`
                : `A mensagem será enviada para ${notifyRecipients.length} usuários selecionados.`}
            </DialogDescription>
          </DialogHeader>
          <textarea
            value={notifyMsg}
            onChange={(e) => setNotifyMsg(e.target.value)}
            rows={4}
            maxLength={1000}
            autoFocus
            aria-label="Mensagem para o usuário"
            placeholder="Digite a mensagem que o usuário receberá..."
            className="w-full px-3 py-2 rounded-lg bg-input border border-border text-sm focus:outline-none focus:ring-1 focus:ring-ring"
          />
          <p className="text-right text-xs text-muted-foreground">{notifyMsg.length}/1000</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNotifyOpen(false)} disabled={notifySending}>Cancelar</Button>
            <Button onClick={sendNotification} disabled={!notifyMsg.trim() || notifySending}>
              {notifySending ? "Enviando..." : "Enviar e notificar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirm dialog */}
      <AlertDialog open={!!confirmAction} onOpenChange={(o) => !o && setConfirmAction(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirmAction?.title}</AlertDialogTitle>
            <AlertDialogDescription>{confirmAction?.description}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                confirmAction?.onConfirm();
                setConfirmAction(null);
              }}
            >
              Confirmar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

// ============= sub components =============
const NavButton = ({ active, onClick, icon: Icon, label, badge }: any) => (
  <button
    type="button"
    onClick={onClick}
    className={`shrink-0 whitespace-nowrap px-3 sm:px-4 py-3 text-sm font-medium transition-colors flex items-center gap-2 border-b-2 -mb-px ${
      active
        ? "border-primary text-foreground"
        : "border-transparent text-muted-foreground hover:text-foreground"
    }`}
  >
    <Icon size={16} /> {label}
    {badge > 0 && (
      <span className="ml-1 min-w-[20px] h-5 px-1.5 rounded-full bg-primary text-primary-foreground text-[10px] font-bold flex items-center justify-center animate-pulse">
        {badge}
      </span>
    )}
  </button>
);

const AdminAutomacoesWrapper = () => {
  const [automations, setAutomations] = useState<any[]>([]);
  const [logs, setLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<unknown>(null);

  const fetchData = async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [{ data: autos, error: autosError }, { data: logsData, error: logsError }] = await Promise.all([
        supabase.from("system_automations").select("*").order("name"),
        supabase.from("automation_logs").select("*").order("created_at", { ascending: false }).limit(30),
      ]);
      if (autosError) throw autosError;
      if (logsError) throw logsError;
      setAutomations(autos || []);
      setLogs(logsData || []);
    } catch (error) {
      setLoadError(error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  return (
    <div className="space-y-6 animate-fade-in">
      {loadError && <ErrorState error={loadError} onRetry={() => void fetchData()} />}
      {loading && <p className="py-8 text-center text-sm text-muted-foreground">Carregando automações...</p>}
      {!loading && !loadError && automations.length === 0 && (
        <p className="rounded-2xl border border-border bg-card p-8 text-center text-sm text-muted-foreground">Nenhuma automação configurada.</p>
      )}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {!loadError && automations.map((auto) => (
          <div key={auto.id} className="rounded-2xl border border-border bg-card p-5 space-y-4">
            <div className="flex justify-between items-start">
              <div className="p-2.5 rounded-xl bg-primary/10 text-primary">
                <Activity size={20} />
              </div>
              <Badge variant={auto.status === "active" ? "default" : "secondary"}>
                {auto.status === "active" ? "Ativo" : "Pausado"}
              </Badge>
            </div>
            <div>
              <h3 className="font-bold text-foreground">{auto.name}</h3>
              <p className="text-xs text-muted-foreground mt-1">Status: {auto.status}</p>
            </div>
            <div className="grid grid-cols-2 gap-3 pt-2">
              <div className="bg-accent/30 rounded-xl p-2.5">
                <p className="text-[10px] text-muted-foreground uppercase">Execuções</p>
                <p className="text-lg font-bold">{auto.total_executions || 0}</p>
              </div>
              <div className="bg-accent/30 rounded-xl p-2.5">
                <p className="text-[10px] text-muted-foreground uppercase">Sucesso</p>
                <p className="text-lg font-bold text-emerald-500">{auto.success_rate || 0}%</p>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="rounded-2xl border border-border bg-card overflow-hidden">
        <div className="p-4 border-b border-border bg-accent/20 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Terminal size={16} className="text-primary" />
            <h3 className="font-semibold text-sm">Logs Recentes do Sistema</h3>
          </div>
          <Button variant="ghost" size="sm" onClick={fetchData} className="h-8 text-xs">Atualizar</Button>
        </div>
        <div className="p-4 bg-muted/30 font-mono text-[11px] space-y-1.5 max-h-[400px] overflow-y-auto">
          {!loadError && logs.map((log) => (
            <div key={log.id} className="flex gap-3 border-b border-border/5 py-1 last:border-0">
              <span className="text-muted-foreground shrink-0">{safeAdminDateTime(log.created_at)}</span>
              <span className={log.level === "error" ? "text-red-400" : log.level === "warning" ? "text-amber-400" : "text-emerald-400"}>
                [{String(log.level || "info").toUpperCase()}]
              </span>
              <span className="text-foreground/80">{log.message}</span>
            </div>
          ))}
          {!loading && !loadError && logs.length === 0 && <p className="text-muted-foreground text-center py-8 italic">Nenhum log disponível.</p>}
        </div>
      </div>
    </div>
  );
};

const AdminLogs = () => {
  const [logs, setLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const fetchLogs = async () => {
      setLoading(true);
      setLoadError(null);
      const { data, error } = await supabase.from("audit_logs").select("*").order("created_at", { ascending: false }).limit(100);
      if (error) {
        setLoadError(error);
        setLoading(false);
        return;
      }
      setLogs(data || []);
      setLoading(false);
    };
    fetchLogs();
  }, [attempt]);

  return (
    <div className="space-y-4">
    <ClientErrorsPanel />
    {loadError && <ErrorState error={loadError} onRetry={() => setAttempt((value) => value + 1)} />}
    <div className="rounded-2xl border border-border bg-card overflow-hidden animate-fade-in">
       <div className="overflow-x-auto">
         <table className="w-full text-xs text-left">
           <thead className="bg-accent/40 text-muted-foreground uppercase tracking-wider">
             <tr>
               <th className="px-4 py-3">Data/Hora</th>
               <th className="px-4 py-3">Ação</th>
               <th className="px-4 py-3">Tabela</th>
               <th className="px-4 py-3">ID Recurso</th>
               <th className="px-4 py-3">Dados</th>
             </tr>
           </thead>
           <tbody className="divide-y divide-border/50">
             {loading && <tr><td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">Carregando auditoria...</td></tr>}
             {!loading && !loadError && logs.length === 0 && <tr><td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">Nenhum registro de auditoria.</td></tr>}
             {!loadError && logs.map((log) => (
               <tr key={log.id} className="hover:bg-accent/20 transition-colors">
                 <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">
                    {safeAdminDateTime(log.created_at)}
                 </td>
                 <td className="px-4 py-3 font-medium">
                   <Badge variant="outline" className={
                     log.action === 'INSERT' ? 'bg-emerald-500/10 text-emerald-500' :
                     log.action === 'DELETE' ? 'bg-red-500/10 text-red-500' :
                     'bg-blue-500/10 text-blue-500'
                   }>
                     {log.action}
                   </Badge>
                 </td>
                 <td className="px-4 py-3 text-muted-foreground">{log.entity_type || "—"}</td>
                 <td className="px-4 py-3 font-mono text-[10px] text-muted-foreground truncate max-w-[100px]" title={log.entity_id || ""}>
                   {log.entity_id || "—"}
                 </td>
                 <td className="px-4 py-3">
                   <div className="max-w-[300px] truncate text-muted-foreground" title={JSON.stringify(log.details)}>
                     {JSON.stringify(log.details || {})}
                   </div>
                 </td>
               </tr>
             ))}
           </tbody>
         </table>
       </div>
    </div>
    </div>
  );
};


const toneMap = {
  primary: "from-primary/20 to-primary/5 text-primary",
  success: "from-emerald-500/20 to-emerald-500/5 text-emerald-500",
  danger: "from-destructive/20 to-destructive/5 text-destructive",
  warning: "from-amber-500/20 to-amber-500/5 text-amber-500",
  accent: "from-purple-500/20 to-purple-500/5 text-purple-400",
  info: "from-sky-500/20 to-sky-500/5 text-sky-400",
} as const;

const KpiCard = ({
  icon: Icon, label, value, tone,
}: { icon: any; label: string; value: number; tone: keyof typeof toneMap }) => (
  <div className="rounded-2xl border border-border bg-card p-4 hover:border-primary/30 transition-colors">
    <div className={`w-9 h-9 rounded-xl bg-gradient-to-br ${toneMap[tone]} flex items-center justify-center mb-2`}>
      <Icon size={16} />
    </div>
    <p className="text-xs text-muted-foreground">{label}</p>
    <p className="text-2xl font-bold text-foreground mt-0.5">{value}</p>
  </div>
);

const PlanBar = ({ label, value, total, color }: { label: string; value: number; total: number; color: string }) => {
  const safeTotal = Math.max(0, safeAdminNumber(total));
  const safeValue = Math.max(0, safeAdminNumber(value));
  const pct = safeTotal > 0 ? Math.min(100, (safeValue / safeTotal) * 100) : 0;
  return (
    <div>
      <div className="flex items-center justify-between text-xs mb-1.5">
        <span className="text-muted-foreground">{label}</span>
        <span className="text-foreground font-medium">{safeValue} ({pct.toFixed(0)}%)</span>
      </div>
      <div className="h-2 rounded-full bg-muted overflow-hidden">
        <div className={`h-full ${color} transition-all`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
};

const MiniStat = ({ label, value }: { label: string; value: string }) => (
  <div className="rounded-xl bg-accent/30 p-3">
    <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
    <p className="text-lg font-bold text-foreground mt-0.5">{value}</p>
  </div>
);

const DetailRow = ({ label, value, mono }: { label: string; value: string; mono?: boolean }) => (
  <div className="flex justify-between items-start gap-3 py-1.5 border-b border-border/50 last:border-0">
    <span className="text-xs text-muted-foreground">{label}</span>
    <span className={`text-xs text-foreground text-right ${mono ? "font-mono" : ""} truncate max-w-[60%]`}>{value}</span>
  </div>
);

export default Admin;
