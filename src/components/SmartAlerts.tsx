import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { fetchAll } from "@/lib/fetchAll";
import { useMultiTableRealtime } from "@/hooks/useRealtimeSubscription";
import { toast } from "sonner";
import {
  AlertTriangle, Clock, Cake, Bell, CheckCheck, ChevronRight,
  X, Sparkles, TrendingDown, FileSignature, Loader2, RotateCcw
} from "lucide-react";
import CobrarAgoraModal, { CobrarInstallment } from "./CobrarAgoraModal";
import { formatBRDateTime, parseLocalDate } from "@/lib/dateUtils";

// Persisted-dismiss helpers (localStorage, per-user, with TTL)
const DISMISS_KEY = (uid?: string) => `smart-alerts:dismissed:${uid || "anon"}`;
const DAY_MS = 86_400_000;
// Group alerts reset daily; notification-bound alerts persist 30 days
const ttlForId = (id: string) => (id.startsWith("notif-") ? 30 * DAY_MS : DAY_MS);

type DismissMap = Record<string, number>; // id -> expiresAt (ms)

const loadDismissed = (uid?: string): DismissMap => {
  try {
    const raw = localStorage.getItem(DISMISS_KEY(uid));
    if (!raw) return {};
    const parsed: DismissMap = JSON.parse(raw);
    const now = Date.now();
    const clean: DismissMap = {};
    Object.entries(parsed).forEach(([k, exp]) => { if (exp > now) clean[k] = exp; });
    return clean;
  } catch { return {}; }
};

const saveDismissed = (uid: string | undefined, map: DismissMap) => {
  try { localStorage.setItem(DISMISS_KEY(uid), JSON.stringify(map)); } catch {}
};

type Alert = {
  id: string;
  group: "critical" | "warning" | "info" | "system";
  icon: any;
  title: string;
  description: string;
  count?: number;
  amount?: number;
  action?: { label: string; onClick: () => void };
  secondaryAction?: { label: string; onClick: () => void };
  dismissIds?: string[]; // notification ids to mark read
};

const groupStyles = {
  critical: { border: "border-destructive/30", bg: "bg-destructive/5", chip: "bg-destructive/15 text-destructive", icon: "text-destructive" },
  warning:  { border: "border-amber-500/30", bg: "bg-amber-500/5", chip: "bg-amber-500/15 text-amber-400", icon: "text-amber-400" },
  info:     { border: "border-primary/25", bg: "bg-primary/5", chip: "bg-primary/15 text-primary", icon: "text-primary" },
  system:   { border: "border-border/40", bg: "bg-muted/20", chip: "bg-muted/40 text-muted-foreground", icon: "text-muted-foreground" },
};

const safeNumber = (value: unknown) => {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
};
const fmtBRL = (v: number) => safeNumber(v).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const daysLate = (value: unknown) => {
  const date = parseLocalDate(typeof value === "string" ? value : null);
  return date ? Math.floor((Date.now() - date.getTime()) / DAY_MS) : 0;
};

interface Props {
  overdue: any[];
  dueToday: any[];
  notifications: any[];
}

const SmartAlerts = ({ overdue, dueToday, notifications }: Props) => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [dismissedMap, setDismissedMap] = useState<DismissMap>({});
  const dismissed = useMemo(() => new Set(Object.keys(dismissedMap)), [dismissedMap]);

  // Hydrate from localStorage on mount / user change
  useEffect(() => {
    setDismissedMap(loadDismissed(user?.id));
  }, [user?.id]);
  const [busy, setBusy] = useState(false);
  const [cobrarOpen, setCobrarOpen] = useState(false);
  const [cobrarTitle, setCobrarTitle] = useState("Cobrar agora");
  const [cobrarList, setCobrarList] = useState<CobrarInstallment[]>([]);

  const openCobrar = (title: string, list: any[]) => {
    setCobrarTitle(title);
    setCobrarList(list as CobrarInstallment[]);
    setCobrarOpen(true);
  };

  // Birthdays today
  const { data: birthdays } = useQuery({
    queryKey: ["hoje-birthdays", user?.id],
    queryFn: async () => {
      if (!user) return [];
      const data = await fetchAll<any>((from, to) => supabase
        .from("clients")
        .select("id, name, birth_date, phone, whatsapp")
        .eq("user_id", user.id)
        .not("birth_date", "is", null)
        .range(from, to));
      const today = new Date();
      return (data || []).filter((c: any) => {
        if (!c.birth_date) return false;
        const d = parseLocalDate(c.birth_date);
        if (!d) return false;
        return d.getDate() === today.getDate() && d.getMonth() === today.getMonth();
      });
    },
    enabled: !!user,
    staleTime: 5 * 60_000,
  });

  // Contracts pending signature
  const { data: pendingSigs } = useQuery({
    queryKey: ["hoje-pending-sigs", user?.id],
    queryFn: async () => {
      if (!user) return [];
      const { data, error } = await supabase
        .from("contracts")
        .select("id, client_id, capital, clients:client_id(name)")
        .eq("user_id", user.id)
        .eq("signature_status", "pending")
        .eq("status", "active")
        .limit(10);
      if (error) throw error;
      return data || [];
    },
    enabled: !!user,
    staleTime: 60_000,
  });

  useMultiTableRealtime(
    ["clients", "contracts", "notifications", "contract_installments"],
    [["hoje-birthdays", user?.id], ["hoje-pending-sigs", user?.id], ["hoje", user?.id]],
  );


  const alerts = useMemo<Alert[]>(() => {
    const list: Alert[] = [];

    // 1) Critical: overdue >7 days (high-risk bucket)
    const critOverdue = overdue.filter((i: any) => {
      const days = daysLate(i.due_date);
      return days >= 7;
    });
    if (critOverdue.length > 0) {
      const total = critOverdue.reduce((s, i: any) => s + safeNumber(i.amount), 0);
      list.push({
        id: "crit-overdue",
        group: "critical",
        icon: AlertTriangle,
        title: `${critOverdue.length} cobrança${critOverdue.length !== 1 ? "s" : ""} crítica${critOverdue.length !== 1 ? "s" : ""}`,
        description: `Mais de 7 dias em atraso · R$ ${fmtBRL(total)}`,
        count: critOverdue.length,
        amount: total,
        action: { label: "Cobrar agora", onClick: () => openCobrar(`Cobrar ${critOverdue.length} crítica${critOverdue.length !== 1 ? "s" : ""}`, critOverdue) },
        secondaryAction: { label: "Ver lista", onClick: () => navigate("/cobrancas?filter=overdue") },
      });
    }



    // 2) Warning: recent overdue (<7d)
    const lightOverdue = overdue.filter((i: any) => {
      const days = daysLate(i.due_date);
      return days < 7;
    });
    if (lightOverdue.length > 0) {
      const total = lightOverdue.reduce((s, i: any) => s + safeNumber(i.amount), 0);
      list.push({
        id: "light-overdue",
        group: "warning",
        icon: TrendingDown,
        title: `${lightOverdue.length} atraso${lightOverdue.length !== 1 ? "s" : ""} recente${lightOverdue.length !== 1 ? "s" : ""}`,
        description: `Atrasados há menos de 7 dias · R$ ${fmtBRL(total)}`,
        count: lightOverdue.length,
        action: { label: "Cobrar agora", onClick: () => openCobrar(`Cobrar ${lightOverdue.length} atraso${lightOverdue.length !== 1 ? "s" : ""} recente${lightOverdue.length !== 1 ? "s" : ""}`, lightOverdue) },
        secondaryAction: { label: "Ver lista", onClick: () => navigate("/cobrancas?filter=overdue") },
      });
    }

    // 3) Info: due today
    if (dueToday.length > 0) {
      const total = dueToday.reduce((s, i: any) => s + safeNumber(i.amount), 0);
      list.push({
        id: "due-today",
        group: "info",
        icon: Clock,
        title: `${dueToday.length} vence${dueToday.length !== 1 ? "m" : ""} hoje`,
        description: `Total previsto · R$ ${fmtBRL(total)}`,
        count: dueToday.length,
        action: { label: "Cobrar agora", onClick: () => openCobrar(`Cobrar ${dueToday.length} de hoje`, dueToday) },
        secondaryAction: { label: "Enviar lembretes", onClick: () => navigate("/cobrancas?filter=today") },
      });
    }

    // 4) Birthdays
    if ((birthdays || []).length > 0) {
      list.push({
        id: "birthdays",
        group: "info",
        icon: Cake,
        title: `${birthdays!.length} aniversariante${birthdays!.length !== 1 ? "s" : ""} hoje`,
        description: birthdays!.slice(0, 3).map((b: any) => b.name).join(", ") + (birthdays!.length > 3 ? "..." : ""),
        count: birthdays!.length,
        action: { label: "Ver clientes", onClick: () => navigate("/clientes") },
      });
    }

    // 5) Pending signatures
    if ((pendingSigs || []).length > 0) {
      list.push({
        id: "pending-sigs",
        group: "warning",
        icon: FileSignature,
        title: `${pendingSigs!.length} contrato${pendingSigs!.length !== 1 ? "s" : ""} sem assinatura`,
        description: "Aguardando assinatura do cliente",
        count: pendingSigs!.length,
        action: { label: "Revisar", onClick: () => navigate("/clientes") },
      });
    }

    // 6) System notifications grouped by type
    const byType: Record<string, any[]> = {};
    (notifications || []).forEach((n: any) => {
      const k = n.type || "system";
      (byType[k] = byType[k] || []).push(n);
    });
    Object.entries(byType).forEach(([type, arr]) => {
      if (arr.length === 1) {
        const n = arr[0];
        const message = String(n.message || "");
        list.push({
          id: `notif-${n.id}`,
          group: "system",
          icon: Bell,
          title: message.length > 60 ? message.slice(0, 60) + "..." : message || "Notificação sem mensagem",
          description: formatBRDateTime(n.sent_at) || "Data indisponível",
          action: n.link ? { label: "Abrir", onClick: () => navigate(n.link) } : undefined,
          dismissIds: [n.id],
        });
      } else {
        list.push({
          id: `notif-group-${type}`,
          group: "system",
          icon: Bell,
          title: `${arr.length} notificações · ${type}`,
          description: String(arr[0].message || "Notificação sem mensagem").slice(0, 50) + "...",
          count: arr.length,
          action: { label: "Ver todas", onClick: () => navigate("/notificacoes") },
          dismissIds: arr.map((n: any) => n.id),
        });
      }
    });

    return list.filter(a => !dismissed.has(a.id));
  }, [overdue, dueToday, notifications, birthdays, pendingSigs, dismissed, navigate]);

  const persistDismiss = (ids: string[]) => {
    setDismissedMap((prev) => {
      const now = Date.now();
      const next = { ...prev };
      ids.forEach((id) => { next[id] = now + ttlForId(id); });
      saveDismissed(user?.id, next);
      return next;
    });
  };

  const dismissAlert = async (alert: Alert) => {
    if (alert.dismissIds?.length) {
      const { error } = await supabase.from("notifications").update({ is_read: true })
        .eq("user_id", user!.id).in("id", alert.dismissIds);
      if (error) {
        toast.error("Não foi possível dispensar o alerta");
        return;
      }
      qc.invalidateQueries({ queryKey: ["hoje"] });
    }
    persistDismiss([alert.id]);
  };

  const dismissAll = async () => {
    if (alerts.length === 0) return;
    setBusy(true);
    const allNotifIds = alerts.flatMap(a => a.dismissIds || []);
    if (allNotifIds.length > 0) {
      const { error } = await supabase.from("notifications").update({ is_read: true })
        .eq("user_id", user!.id).in("id", allNotifIds);
      if (error) {
        setBusy(false);
        toast.error("Não foi possível limpar os alertas");
        return;
      }
    }
    persistDismiss(alerts.map(a => a.id));
    qc.invalidateQueries({ queryKey: ["hoje"] });
    setBusy(false);
    toast.success("Alertas limpos", {
      action: {
        label: "Restaurar",
        onClick: () => {
          setDismissedMap({});
          saveDismissed(user?.id, {});
        },
      },
    });
  };

  const restoreAll = () => {
    setDismissedMap({});
    saveDismissed(user?.id, {});
    toast.success("Alertas restaurados");
  };

  const hiddenCount = Object.keys(dismissedMap).length;

  // Group alerts by severity for sectioned rendering
  const order: Array<Alert["group"]> = ["critical", "warning", "info", "system"];
  const groupMeta: Record<Alert["group"], { label: string; to: string }> = {
    critical: { label: "Crítico", to: "/cobrancas?filter=overdue" },
    warning:  { label: "Atenção", to: "/cobrancas?filter=overdue" },
    info:     { label: "Informativo", to: "/cobrancas?filter=today" },
    system:   { label: "Sistema", to: "/notificacoes" },
  };
  const grouped = order
    .map((g) => ({ group: g, items: alerts.filter((a) => a.group === g) }))
    .filter((s) => s.items.length > 0);

  return (
    <div className="rounded-2xl border border-border/40 bg-card/60 overflow-hidden">
      <div className="px-4 py-3 border-b border-border/30 flex items-center justify-between">
        <h2 className="text-sm font-bold text-foreground flex items-center gap-2">
          <Sparkles size={14} className="text-primary" /> Alertas inteligentes
          {alerts.length > 0 && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-primary/15 text-primary font-bold">
              {alerts.length}
            </span>
          )}
        </h2>
        <div className="flex items-center gap-3">
          {hiddenCount > 0 && (
            <button
              onClick={restoreAll}
              className="text-[11px] text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded"
              title={`${hiddenCount} alerta${hiddenCount !== 1 ? "s" : ""} dispensado${hiddenCount !== 1 ? "s" : ""}`}
            >
              <RotateCcw size={11} /> Restaurar ({hiddenCount})
            </button>
          )}
          {alerts.length > 1 && (
            <button
              onClick={dismissAll}
              disabled={busy}
              className="text-[11px] text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded"
            >
              {busy ? <Loader2 size={11} className="animate-spin" /> : <CheckCheck size={11} />}
              Limpar todos
            </button>
          )}
        </div>
      </div>
      <div className="max-h-[440px] overflow-y-auto">
        {grouped.length === 0 && (
          <div className="py-10 text-center">
            <CheckCheck size={28} className="mx-auto text-success/60 mb-2" />
            <p className="text-sm font-semibold text-foreground">Nada urgente</p>
            <p className="text-xs text-muted-foreground mt-1">Você está em dia com tudo</p>
          </div>
        )}
        {grouped.map((section) => {
          const ss = groupStyles[section.group];
          const meta = groupMeta[section.group];
          return (
            <section key={section.group} aria-label={meta.label}>
              <header className={`px-4 py-1.5 flex items-center justify-between border-y border-border/20 ${ss.bg}`}>
                <span className={`text-[10px] font-bold uppercase tracking-wider ${ss.icon} flex items-center gap-1.5`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${ss.icon.replace("text-", "bg-")}`} />
                  {meta.label}
                  <span className="text-muted-foreground font-semibold normal-case tracking-normal">
                    · {section.items.length}
                  </span>
                </span>
                <button
                  onClick={() => navigate(meta.to)}
                  className="text-[10px] font-bold text-muted-foreground hover:text-foreground hover:underline flex items-center gap-0.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded"
                  aria-label={`Ver lista completa de ${meta.label}`}
                >
                  Ver todos <ChevronRight size={10} />
                </button>
              </header>
              <div className="divide-y divide-border/20">
                {section.items.map((a) => {
                  const s = groupStyles[a.group];
                  const Icon = a.icon;
                  return (
                    <div key={a.id} className={`px-4 py-3 flex items-start gap-3 hover:bg-accent/20 transition-colors group ${s.bg}`}>
                      <div className={`w-8 h-8 rounded-lg ${s.chip} flex items-center justify-center shrink-0`}>
                        <Icon size={15} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2">
                          <p className="text-sm font-semibold text-foreground leading-tight">{a.title}</p>
                          <button
                            onClick={() => dismissAlert(a)}
                            className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded hover:bg-accent/40 shrink-0"
                            title="Dispensar"
                            aria-label="Dispensar alerta"
                          >
                            <X size={12} className="text-muted-foreground" />
                          </button>
                        </div>
                        <p className="text-[11px] text-muted-foreground mt-0.5 leading-snug">{a.description}</p>
                        {(a.action || a.secondaryAction) && (
                          <div className="mt-2 flex items-center gap-3 flex-wrap">
                            {a.action && (
                              <button
                                onClick={a.action.onClick}
                                className={`text-[11px] font-bold ${s.icon} hover:underline flex items-center gap-0.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded`}
                              >
                                {a.action.label} <ChevronRight size={11} />
                              </button>
                            )}
                            {a.secondaryAction && (
                              <button
                                onClick={a.secondaryAction.onClick}
                                className="text-[11px] font-semibold text-muted-foreground hover:text-foreground hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded"
                              >
                                {a.secondaryAction.label}
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>

      <CobrarAgoraModal
        open={cobrarOpen}
        onClose={() => setCobrarOpen(false)}
        title={cobrarTitle}
        installments={cobrarList}
      />
    </div>
  );
};

export default SmartAlerts;
