import { Bell, Check, CheckCheck, Trash2, ExternalLink, AlertCircle, AlertTriangle, CheckCircle2, Info, MessageSquare, DollarSign, Users, Settings as SettingsIcon, Sparkles, X } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useState, useEffect, useRef, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useIsMobile } from "@/hooks/use-mobile";
import { toast } from "sonner";
import { formatBR, parseLocalDate } from "@/lib/dateUtils";
import { safeNotificationPath } from "@/lib/notification";

interface NotificationItem {
  id: string;
  message: string;
  from: string;
  type: string | null;
  link: string | null;
  is_read: boolean;
  created_at: string;
}

type FilterTab = "all" | "unread" | "read";

const typeMeta = (type?: string | null) => {
  const t = (type || "info").toLowerCase();
  if (t === "success" || t === "payment" || t === "paid") return { icon: CheckCircle2, color: "text-success", bg: "bg-success/10", ring: "ring-success/20", label: "Sucesso" };
  if (t === "warning" || t === "warn" || t === "overdue" || t === "due") return { icon: AlertTriangle, color: "text-warning", bg: "bg-warning/10", ring: "ring-warning/20", label: "Atenção" };
  if (t === "error" || t === "danger" || t === "blocked") return { icon: AlertCircle, color: "text-destructive", bg: "bg-destructive/10", ring: "ring-destructive/20", label: "Erro" };
  if (t === "support" || t === "ticket") return { icon: MessageSquare, color: "text-info", bg: "bg-info/10", ring: "ring-info/20", label: "Suporte" };
  if (t === "billing" || t === "subscription") return { icon: DollarSign, color: "text-primary", bg: "bg-primary/10", ring: "ring-primary/20", label: "Cobrança" };
  if (t === "client") return { icon: Users, color: "text-cyan-400", bg: "bg-cyan-400/10", ring: "ring-cyan-400/20", label: "Cliente" };
  if (t === "system") return { icon: SettingsIcon, color: "text-muted-foreground", bg: "bg-muted/40", ring: "ring-border", label: "Sistema" };
  if (t === "broadcast" || t === "announcement") return { icon: Sparkles, color: "text-violet-400", bg: "bg-violet-400/10", ring: "ring-violet-400/20", label: "Comunicado" };
  return { icon: Info, color: "text-info", bg: "bg-info/10", ring: "ring-info/20", label: "Info" };
};

const timeAgo = (dateStr: string) => {
  const date = parseLocalDate(dateStr);
  if (!date) return "data indisponível";
  const diff = (Date.now() - date.getTime()) / 1000;
  if (diff < 60) return "agora";
  if (diff < 3600) return `${Math.floor(diff / 60)}min`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  if (diff < 2592000) return `${Math.floor(diff / 86400)}d`;
  return formatBR(dateStr);
};

// Extrai chips estruturados de mensagens longas (valores, parcelas, clientes)
const extractHighlights = (msg: string) => {
  const chips: { label: string; tone: "money" | "count" | "people" }[] = [];
  const money = msg.match(/R\$\s?[\d.,]+/);
  if (money) chips.push({ label: money[0].replace(/\s+/g, " "), tone: "money" });
  const parcelas = msg.match(/(\d+)\s*parcela/i);
  if (parcelas) chips.push({ label: `${parcelas[1]} parcela${Number(parcelas[1]) > 1 ? "s" : ""}`, tone: "count" });
  const clientes = msg.match(/(\d+)\s*cliente/i);
  if (clientes) chips.push({ label: `${clientes[1]} cliente${Number(clientes[1]) > 1 ? "s" : ""}`, tone: "people" });
  return chips;
};

const groupByDate = (items: NotificationItem[]) => {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today); yesterday.setDate(yesterday.getDate() - 1);
  const week = new Date(today); week.setDate(week.getDate() - 7);
  const groups: Record<string, NotificationItem[]> = { Hoje: [], Ontem: [], "Esta semana": [], "Mais antigas": [] };
  for (const n of items) {
    const d = parseLocalDate(n.created_at);
    if (!d) { groups["Mais antigas"].push(n); continue; }
    d.setHours(0, 0, 0, 0);
    if (d.getTime() === today.getTime()) groups["Hoje"].push(n);
    else if (d.getTime() === yesterday.getTime()) groups["Ontem"].push(n);
    else if (d >= week) groups["Esta semana"].push(n);
    else groups["Mais antigas"].push(n);
  }
  return groups;
};

// suave "ding" sintetizado via WebAudio (sem assets)
const playDing = () => {
  try {
    const Ctx = (window.AudioContext || (window as any).webkitAudioContext);
    if (!Ctx) return;
    const ctx = new Ctx();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = "sine";
    o.frequency.setValueAtTime(880, ctx.currentTime);
    o.frequency.exponentialRampToValueAtTime(1320, ctx.currentTime + 0.08);
    g.gain.setValueAtTime(0.0001, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.18, ctx.currentTime + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.4);
    o.connect(g); g.connect(ctx.destination);
    o.start(); o.stop(ctx.currentTime + 0.42);
  } catch {}
};

const NotificationsBell = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [tab, setTab] = useState<FilterTab>("all");
  const [loading, setLoading] = useState(true);
  const firstLoad = useRef(true);

  const unreadCount = useMemo(() => items.filter((n) => !n.is_read).length, [items]);

  useEffect(() => {
    if (!user) return;
    const fetchAll = async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from("notifications")
        .select("*")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) {
        toast.error("Não foi possível carregar as notificações", { description: error.message });
      } else {
        setItems((data || []) as NotificationItem[]);
      }
      setLoading(false);
      firstLoad.current = false;
    };
    fetchAll();

    const channel = supabase
      .channel("notifications-bell")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${user.id}` }, (payload) => {
        const n = payload.new as NotificationItem;
        setItems((prev) => [n, ...prev]);
        if (!firstLoad.current) {
          playDing();
          const meta = typeMeta(n.type);
          const destination = safeNotificationPath(n.link);
          toast(n.message, {
            description: n.from,
            icon: <meta.icon className={`${meta.color}`} size={16} />,
            action: destination ? { label: "Ver", onClick: () => navigate(destination) } : undefined,
            duration: 6000,
          });
          // favicon flash via title
          const orig = document.title;
          let i = 0;
          const flash = setInterval(() => {
            document.title = i % 2 === 0 ? `🔔 (${unreadCount + 1}) Nova notificação` : orig;
            i++;
            if (i > 5) { clearInterval(flash); document.title = orig; }
          }, 800);
        }
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "notifications", filter: `user_id=eq.${user.id}` }, (payload) => {
        const n = payload.new as NotificationItem;
        setItems((prev) => prev.map((i) => (i.id === n.id ? n : i)));
      })
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "notifications", filter: `user_id=eq.${user.id}` }, (payload) => {
        setItems((prev) => prev.filter((i) => i.id !== (payload.old as any).id));
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };

  }, [user]);

  const filtered = useMemo(() => {
    if (tab === "unread") return items.filter((n) => !n.is_read);
    if (tab === "read") return items.filter((n) => n.is_read);
    return items;
  }, [items, tab]);

  const grouped = useMemo(() => groupByDate(filtered), [filtered]);

  const handleMarkAllRead = async () => {
    if (!user || unreadCount === 0) return;
    const ids = items.filter((n) => !n.is_read).map((n) => n.id);
    const previous = items;
    setItems((prev) => prev.map((n) => ({ ...n, is_read: true })));
    const { error } = await supabase.from("notifications").update({ is_read: true }).eq("user_id", user.id).in("id", ids);
    if (error) {
      setItems(previous);
      toast.error("Não foi possível marcar as notificações", { description: error.message });
      return;
    }
    toast.success(`${ids.length} notificações marcadas como lidas`);
  };

  const handleMarkOne = async (id: string, read: boolean) => {
    if (!user) return;
    const previous = items;
    setItems((prev) => prev.map((n) => (n.id === id ? { ...n, is_read: read } : n)));
    const { error } = await supabase.from("notifications").update({ is_read: read }).eq("id", id).eq("user_id", user.id);
    if (error) {
      setItems(previous);
      toast.error("Não foi possível atualizar a notificação", { description: error.message });
    }
  };

  const handleDelete = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!user) return;
    const previous = items;
    setItems((prev) => prev.filter((n) => n.id !== id));
    const { error } = await supabase.from("notifications").delete().eq("id", id).eq("user_id", user.id);
    if (error) {
      setItems(previous);
      toast.error("Não foi possível excluir a notificação", { description: error.message });
    }
  };

  const handleDeleteAllRead = async () => {
    if (!user) return;
    const readIds = items.filter((n) => n.is_read).map((n) => n.id);
    if (readIds.length === 0) return;
    const previous = items;
    setItems((prev) => prev.filter((n) => !n.is_read));
    const { error } = await supabase.from("notifications").delete().eq("user_id", user.id).in("id", readIds);
    if (error) {
      setItems(previous);
      toast.error("Não foi possível limpar as notificações", { description: error.message });
      return;
    }
    toast.success(`${readIds.length} notificações removidas`);
  };

  const handleClick = (n: NotificationItem) => {
    if (!n.is_read) handleMarkOne(n.id, true);
    const destination = safeNotificationPath(n.link);
    if (destination) navigate(destination);
    setOpen(false);
  };

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="p-2.5 rounded-full hover:bg-muted/50 transition-all duration-200 text-muted-foreground/60 hover:text-foreground relative"
        aria-label={`Notificações${unreadCount > 0 ? ` (${unreadCount} não lidas)` : ""}`}
      >
        <Bell size={17} className={unreadCount > 0 ? "animate-[wiggle_2s_ease-in-out_infinite]" : ""} />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-gradient-to-br from-destructive to-rose-600 text-destructive-foreground text-[10px] flex items-center justify-center font-bold ring-2 ring-card shadow-lg shadow-destructive/30">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40 bg-background/20 backdrop-blur-[2px]" onClick={() => setOpen(false)} />
          <div
            className={`${
              isMobile
                ? "fixed top-[6.75rem] right-3 left-3"
                : "absolute right-0 top-12 w-[min(420px,calc(100vw-1.5rem))]"
            } max-h-[calc(100vh-5rem)] flex flex-col bg-card border border-border/60 rounded-2xl shadow-2xl shadow-black/40 z-50 overflow-hidden animate-scale-in`}
          >
            {/* Header */}
            <div className="px-4 pt-4 pb-3 border-b border-border/40 bg-gradient-to-b from-muted/20 to-transparent">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-xl bg-primary/10 flex items-center justify-center ring-1 ring-primary/20">
                    <Bell size={15} className="text-primary" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-foreground leading-none">Notificações</h3>
                    <p className="text-[10px] text-muted-foreground mt-1">
                      {unreadCount > 0 ? `${unreadCount} não lida${unreadCount > 1 ? "s" : ""}` : "Tudo em dia"}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  aria-label="Fechar notificações"
                  className="p-1.5 rounded-lg hover:bg-muted/50 text-muted-foreground hover:text-foreground transition"
                >
                  <X size={14} />
                </button>
              </div>

              {/* Tabs */}
              <div className="flex items-center gap-1 p-1 bg-muted/30 rounded-xl">
                {([
                  { k: "all", label: "Todas", count: items.length },
                  { k: "unread", label: "Não lidas", count: unreadCount },
                  { k: "read", label: "Lidas", count: items.length - unreadCount },
                ] as const).map((t) => (
                  <button
                    key={t.k}
                    onClick={() => setTab(t.k)}
                    className={`flex-1 px-2 py-1.5 rounded-lg text-[11px] font-semibold transition-all flex items-center justify-center gap-1.5 ${
                      tab === t.k
                        ? "bg-card text-foreground shadow-sm ring-1 ring-border/60"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {t.label}
                    <span className={`text-[9px] px-1.5 py-0.5 rounded-md ${tab === t.k ? "bg-primary/15 text-primary" : "bg-muted/60"}`}>
                      {t.count}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            {/* List */}
            <div className="overflow-y-auto flex-1 min-h-[200px]">
              {loading ? (
                <div className="p-3 space-y-2">
                  {[1, 2, 3].map((i) => (
                    <div key={i} className="flex gap-3 p-3 animate-pulse">
                      <div className="w-9 h-9 rounded-xl bg-muted/40" />
                      <div className="flex-1 space-y-2">
                        <div className="h-3 bg-muted/40 rounded w-3/4" />
                        <div className="h-2 bg-muted/30 rounded w-1/2" />
                      </div>
                    </div>
                  ))}
                </div>
              ) : filtered.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
                  <div className="w-14 h-14 rounded-2xl bg-muted/30 flex items-center justify-center mb-3">
                    <Bell size={22} className="text-muted-foreground/40" />
                  </div>
                  <p className="text-sm font-semibold text-foreground">
                    {tab === "unread" ? "Nenhuma não lida" : tab === "read" ? "Nenhuma lida ainda" : "Sem notificações"}
                  </p>
                  <p className="text-[11px] text-muted-foreground mt-1 max-w-[240px]">
                    {tab === "unread" ? "Você está em dia com tudo!" : "Quando algo acontecer, aparecerá aqui."}
                  </p>
                </div>
              ) : (
                <div>
                  {Object.entries(grouped).map(([label, list]) =>
                    list.length === 0 ? null : (
                      <div key={label}>
                        <div className="sticky top-0 z-10 px-4 py-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground/70 bg-card/95 backdrop-blur-sm border-b border-border/30">
                          {label}
                        </div>
                        {list.map((n) => {
                          const meta = typeMeta(n.type);
                          const Icon = meta.icon;
                          const message = String(n.message || "");
                          const chips = extractHighlights(message);
                          const isLong = message.length > 140;
                          return (
                            <div
                              key={n.id}
                              onClick={() => handleClick(n)}
                              className={`group relative px-3 py-3 border-b border-border/20 last:border-0 cursor-pointer transition-all hover:bg-accent/40 ${
                                !n.is_read ? "bg-primary/[0.04]" : ""
                              }`}
                            >
                              {!n.is_read && (
                                <span className="absolute left-0 top-3 bottom-3 w-[3px] rounded-r bg-primary shadow-[0_0_8px_hsl(var(--primary))]" />
                              )}
                              <div className="flex gap-3">
                                <div className={`shrink-0 w-9 h-9 rounded-xl ${meta.bg} ring-1 ${meta.ring} flex items-center justify-center`}>
                                  <Icon size={15} className={meta.color} />
                                </div>
                                <div className="flex-1 min-w-0">
                                  <p
                                    className={`text-[13px] leading-snug ${!n.is_read ? "text-foreground font-medium" : "text-muted-foreground"} line-clamp-2 group-hover:line-clamp-none break-words`}
                                    title={isLong ? message : undefined}
                                  >
                                    {message || "Notificação sem mensagem"}
                                  </p>
                                  {chips.length > 0 && (
                                    <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                                      {chips.map((c, i) => (
                                        <span
                                          key={i}
                                          className={`text-[10px] font-bold px-2 py-0.5 rounded-md ring-1 ${
                                            c.tone === "money"
                                              ? "bg-success/10 text-success ring-success/20"
                                              : c.tone === "count"
                                              ? "bg-warning/10 text-warning ring-warning/20"
                                              : "bg-info/10 text-info ring-info/20"
                                          }`}
                                        >
                                          {c.label}
                                        </span>
                                      ))}
                                    </div>
                                  )}
                                  <div className="flex items-center gap-2 mt-1.5">
                                    <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-md ${meta.bg} ${meta.color}`}>
                                      {meta.label}
                                    </span>
                                    <span className="text-[10px] text-muted-foreground/70 truncate max-w-[130px]">{n.from}</span>
                                    <span className="text-[10px] text-muted-foreground/50">·</span>
                                    <span className="text-[10px] text-muted-foreground/70">{timeAgo(n.created_at)}</span>
                                    {safeNotificationPath(n.link) && <ExternalLink size={9} className="text-muted-foreground/40 ml-auto" />}
                                  </div>
                                </div>
                              </div>
                              {/* Hover actions */}
                              <div className="absolute right-2 top-2 opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-0.5 bg-card rounded-lg ring-1 ring-border/60 shadow-md p-0.5">
                                {!n.is_read && (
                                  <button
                                    onClick={(e) => { e.stopPropagation(); handleMarkOne(n.id, true); }}
                                    className="p-1 rounded-md hover:bg-muted text-muted-foreground hover:text-success transition"
                                    title="Marcar como lida"
                                  >
                                    <Check size={12} />
                                  </button>
                                )}
                                <button
                                  onClick={(e) => handleDelete(n.id, e)}
                                  className="p-1 rounded-md hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition"
                                  title="Excluir"
                                >
                                  <Trash2 size={12} />
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )
                  )}
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="px-3 py-2 border-t border-border/40 bg-muted/20 flex items-center justify-between gap-2">
              <button
                onClick={() => { setOpen(false); navigate("/notificacoes"); }}
                className="text-[11px] font-semibold text-primary hover:underline px-2 py-1"
              >
                Ver todas
              </button>
              <div className="flex items-center gap-1">
                {unreadCount > 0 && (
                  <button
                    onClick={handleMarkAllRead}
                    className="text-[11px] font-medium text-muted-foreground hover:text-foreground px-2 py-1 rounded-lg hover:bg-muted/50 transition flex items-center gap-1"
                  >
                    <CheckCheck size={12} /> Marcar lidas
                  </button>
                )}
                {items.some((n) => n.is_read) && (
                  <button
                    onClick={handleDeleteAllRead}
                    className="text-[11px] font-medium text-muted-foreground hover:text-destructive px-2 py-1 rounded-lg hover:bg-destructive/10 transition flex items-center gap-1"
                    title="Limpar lidas"
                  >
                    <Trash2 size={12} />
                  </button>
                )}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default NotificationsBell;
