import {UploadImage} from '@/components/UploadMedia';
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  LifeBuoy, Search, Send, ChevronLeft, AlertCircle, CheckCircle2, Clock,
  Inbox, User as UserIcon, Filter, Lock, Sparkles, Wand2,
} from "lucide-react";
import { formatDistanceToNow, format } from "date-fns";
import { ptBR } from "date-fns/locale";
import ErrorState from "@/components/feedback/ErrorState";
import { fetchAll } from "@/lib/fetchAll";
import { parseLocalDate } from "@/lib/dateUtils";

const safeDate = (value: unknown) => {
  return parseLocalDate(typeof value === "string" || value instanceof Date ? value : null);
};
const relativeDate = (value: unknown) => {
  const date = safeDate(value);
  return date ? formatDistanceToNow(date, { addSuffix: true, locale: ptBR }) : "data indisponível";
};

type Ticket = {
  id: string;
  user_id: string;
  subject: string;
  category: string;
  priority: string;
  status: string;
  last_message_at: string;
  unread_by_user: boolean;
  unread_by_admin: boolean;
  created_at: string;
  ai_category?: string | null;
  ai_severity?: string | null;
  ai_suggested_reply?: string | null;
  ai_triaged_at?: string | null;
};

type TicketMessage = {
  id: string;
  ticket_id: string;
  sender_id: string;
  sender_role: string;
  sender_name: string;
  message: string;
  is_internal: boolean;
  created_at: string;
};

type UserMini = { id: string; name: string; email: string | null; avatar_url: string | null };

const categoryLabels: Record<string, string> = {
  general: "Geral",
  technical: "Técnico",
  billing: "Financeiro",
  feature: "Sugestão",
  bug: "Bug",
};

const priorityLabels: Record<string, { label: string; className: string }> = {
  low: { label: "Baixa", className: "bg-muted text-muted-foreground" },
  normal: { label: "Normal", className: "bg-blue-500/10 text-blue-400 border-blue-500/30" },
  high: { label: "Alta", className: "bg-amber-500/10 text-amber-400 border-amber-500/30" },
  urgent: { label: "Urgente", className: "bg-red-500/10 text-red-400 border-red-500/30" },
};

const statusBadge = (status: string) => {
  switch (status) {
    case "open":
      return { label: "Aberto", icon: AlertCircle, className: "bg-blue-500/10 text-blue-400 border-blue-500/30" };
    case "answered":
      return { label: "Respondido", icon: CheckCircle2, className: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30" };
    case "closed":
      return { label: "Fechado", icon: CheckCircle2, className: "bg-muted text-muted-foreground border-border" };
    default:
      return { label: status, icon: Clock, className: "bg-muted text-muted-foreground" };
  }
};

const SupportInbox = () => {
  const { user, profile } = useAuth();
  const { toast } = useToast();
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [usersMap, setUsersMap] = useState<Record<string, UserMini>>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [priorityFilter, setPriorityFilter] = useState<string>("all");
  const [activeTicket, setActiveTicket] = useState<Ticket | null>(null);
  const [messages, setMessages] = useState<TicketMessage[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [messagesError, setMessagesError] = useState<unknown>(null);
  const [reply, setReply] = useState("");
  const [internalNote, setInternalNote] = useState("");
  const [showInternalNotes, setShowInternalNotes] = useState(false);
  const [sending, setSending] = useState(false);

  const fetchTickets = async () => {
    setLoading(true);
    setLoadError(null);
    let tk: Ticket[];
    try {
      tk = await fetchAll<Ticket>((from, to) => supabase
        .from("support_tickets")
        .select("*")
        .order("last_message_at", { ascending: false })
        .range(from, to));
    } catch (error) {
      setLoadError(error);
      setLoading(false);
      return;
    }
    setTickets(tk);
    setActiveTicket((current) => current ? tk.find((ticket) => ticket.id === current.id) || null : null);

    const userIds = new Set(tk.map((x) => x.user_id));
    if (userIds.size > 0) {
      let users: UserMini[];
      try {
        users = await fetchAll<UserMini>((from, to) => supabase
          .from("profiles")
          .select("id, name, email, avatar_url")
          .order("id")
          .range(from, to));
      } catch (error) {
        setLoadError(error);
        setLoading(false);
        return;
      }
      const map: Record<string, UserMini> = {};
      users.forEach((x) => { if (userIds.has(x.id)) map[x.id] = x; });
      setUsersMap(map);
    } else {
      setUsersMap({});
    }
    setLoading(false);
  };

  const fetchMessages = async (ticketId: string) => {
    setMessagesLoading(true);
    setMessagesError(null);
    const { data, error } = await supabase
      .from("support_ticket_messages")
      .select("*")
      .eq("ticket_id", ticketId)
      .order("created_at", { ascending: false })
      .limit(500);
    if (error) setMessagesError(error);
    else setMessages([...((data as TicketMessage[]) || [])].reverse());
    setMessagesLoading(false);
  };

  useEffect(() => {
    fetchTickets();
    const ch = supabase
      .channel("realtime-support-tickets-admin")
      .on("postgres_changes" as any, { event: "*", schema: "public", table: "support_tickets" }, () => fetchTickets())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  useEffect(() => {
    if (!activeTicket) return;
    fetchMessages(activeTicket.id);
    if (activeTicket.unread_by_admin) {
      void supabase.from("support_tickets").update({ unread_by_admin: false }).eq("id", activeTicket.id)
        .then(({ error }) => {
          if (error) toast({ title: "Não foi possível marcar como lido", description: error.message, variant: "destructive" });
        });
    }
    const ch = supabase
      .channel(`realtime-admin-ticket-msgs-${activeTicket.id}`)
      .on("postgres_changes" as any, { event: "INSERT", schema: "public", table: "support_ticket_messages", filter: `ticket_id=eq.${activeTicket.id}` }, (payload: any) => {
        setMessages((prev) => [...prev, payload.new]);
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [activeTicket]);

  const stats = useMemo(() => ({
    total: tickets.length,
    open: tickets.filter((t) => t.status === "open").length,
    answered: tickets.filter((t) => t.status === "answered").length,
    closed: tickets.filter((t) => t.status === "closed").length,
    urgent: tickets.filter((t) => t.priority === "urgent" && t.status !== "closed").length,
    unread: tickets.filter((t) => t.unread_by_admin).length,
  }), [tickets]);

  const filtered = useMemo(() => {
    let list = tickets;
    if (statusFilter !== "all") list = list.filter((t) => t.status === statusFilter);
    if (priorityFilter !== "all") list = list.filter((t) => t.priority === priorityFilter);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((t) => {
        const u = usersMap[t.user_id];
        return (t.subject || "").toLowerCase().includes(q) ||
          (u?.name || "").toLowerCase().includes(q) ||
          (u?.email || "").toLowerCase().includes(q);
      });
    }
    return list;
  }, [tickets, statusFilter, priorityFilter, search, usersMap]);

  const handleSendReply = async () => {
    const content = showInternalNotes ? internalNote.trim() : reply.trim();
    if (!activeTicket || !content || !user || sending) return;
    setSending(true);
    const { error } = await supabase.from("support_ticket_messages").insert({
      ticket_id: activeTicket.id,
      sender_id: user.id,
      sender_role: "admin",
      sender_name: profile?.name || "Suporte",
      message: content,
      is_internal: showInternalNotes,
    });
    if (error) toast({ title: "Erro ao enviar", description: error.message, variant: "destructive" });
    else if (showInternalNotes) {
      setInternalNote("");
      toast({ title: "Nota interna adicionada", description: "Visível somente para administradores." });
    }
    else {
      setReply("");
      const { error: notificationError } = await supabase.from("notifications").insert({
        user_id: activeTicket.user_id,
        message: `🛡️ Suporte respondeu: "${activeTicket.subject}"`,
        from: "Suporte",
        type: "support",
        link: "/suporte",
      });
      if (notificationError) {
        toast({
          title: "Resposta enviada, mas o aviso falhou",
          description: notificationError.message,
          variant: "destructive",
        });
      }
    }
    setSending(false);
  };

  const handleChangeStatus = async (status: string) => {
    if (!activeTicket) return;
    const { error } = await supabase.from("support_tickets").update({ status }).eq("id", activeTicket.id);
    if (error) {
      toast({ title: "Não foi possível alterar o status", description: error.message, variant: "destructive" });
      return;
    }
    setActiveTicket({ ...activeTicket, status });
    toast({ title: `Status alterado para ${statusBadge(status).label}` });
  };

  const handleChangePriority = async (priority: string) => {
    if (!activeTicket) return;
    const { error } = await supabase.from("support_tickets").update({ priority }).eq("id", activeTicket.id);
    if (error) {
      toast({ title: "Não foi possível alterar a prioridade", description: error.message, variant: "destructive" });
      return;
    }
    setActiveTicket({ ...activeTicket, priority });
  };

  // ============ DETAIL ============
  if (activeTicket) {
    const sb = statusBadge(activeTicket.status);
    const StatusIcon = sb.icon;
    const u = usersMap[activeTicket.user_id];
    return (
      <div className="space-y-4">
        <button type="button" onClick={() => setActiveTicket(null)} className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors">
          <ChevronLeft size={16} /> Voltar para lista
        </button>
        <div className="rounded-2xl border border-border/40 bg-card/60 backdrop-blur-xs overflow-hidden">
          <div className="p-5 border-b border-border/40">
            <div className="flex items-start justify-between gap-3 mb-3">
              <div className="flex-1 min-w-0">
                <h2 className="text-lg font-semibold text-foreground">{activeTicket.subject}</h2>
                <div className="flex items-center gap-2 mt-2 text-sm">
                  <div className="w-7 h-7 rounded-full bg-muted flex items-center justify-center">
                    {u?.avatar_url ? (
                      <UploadImage src={u.avatar_url} alt="" className="w-7 h-7 rounded-full object-cover" />
                    ) : (
                      <UserIcon size={12} className="text-muted-foreground" />
                    )}
                  </div>
                  <span className="text-foreground font-medium">{u?.name || "Usuário"}</span>
                  <span className="text-muted-foreground">·</span>
                  <span className="text-muted-foreground text-xs">{u?.email}</span>
                </div>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Select value={activeTicket.status} onValueChange={handleChangeStatus}>
                <SelectTrigger className="h-8 w-auto gap-2 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="open">Aberto</SelectItem>
                  <SelectItem value="answered">Respondido</SelectItem>
                  <SelectItem value="closed">Fechado</SelectItem>
                </SelectContent>
              </Select>
              <Select value={activeTicket.priority} onValueChange={handleChangePriority}>
                <SelectTrigger className="h-8 w-auto gap-2 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">Baixa</SelectItem>
                  <SelectItem value="normal">Normal</SelectItem>
                  <SelectItem value="high">Alta</SelectItem>
                  <SelectItem value="urgent">Urgente</SelectItem>
                </SelectContent>
              </Select>
              <Badge variant="outline" className="bg-muted text-muted-foreground">
                {categoryLabels[activeTicket.category] || activeTicket.category}
              </Badge>
              <span className="text-xs text-muted-foreground">
                Aberto em {safeDate(activeTicket.created_at) ? format(safeDate(activeTicket.created_at)!, "dd/MM/yyyy HH:mm", { locale: ptBR }) : "data indisponível"}
              </span>
            </div>
          </div>

          {(activeTicket.ai_triaged_at || activeTicket.ai_suggested_reply) && (
            <div className="px-5 py-4 border-b border-border/40 bg-linear-to-br from-primary/5 to-purple-500/5">
              <div className="flex items-center gap-2 mb-2">
                <Sparkles size={14} className="text-primary" />
                <span className="text-[10px] font-bold uppercase tracking-wider text-primary">Triagem IA</span>
                {activeTicket.ai_category && (
                  <Badge variant="outline" className="text-[10px] capitalize bg-primary/10 border-primary/30">
                    {activeTicket.ai_category}
                  </Badge>
                )}
                {activeTicket.ai_severity && (
                  <Badge variant="outline" className={`text-[10px] uppercase ${
                    activeTicket.ai_severity === "high" ? "bg-red-500/10 text-red-400 border-red-500/30" :
                    activeTicket.ai_severity === "med" ? "bg-amber-500/10 text-amber-400 border-amber-500/30" :
                    "bg-emerald-500/10 text-emerald-400 border-emerald-500/30"
                  }`}>
                    {activeTicket.ai_severity === "high" ? "Alta" : activeTicket.ai_severity === "med" ? "Média" : "Baixa"}
                  </Badge>
                )}
              </div>
              {activeTicket.ai_suggested_reply && (
                <>
                  <p className="text-xs text-muted-foreground whitespace-pre-wrap mb-2 italic">
                    "{activeTicket.ai_suggested_reply}"
                  </p>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs gap-1.5"
                    onClick={() => { setReply(activeTicket.ai_suggested_reply || ""); setShowInternalNotes(false); }}
                  >
                    <Wand2 size={12} /> Usar sugestão
                  </Button>
                </>
              )}
            </div>
          )}


          <div className="p-5 space-y-4 max-h-[50vh] overflow-y-auto">
            {messagesLoading ? (
              <p className="py-8 text-center text-sm text-muted-foreground">Carregando mensagens...</p>
            ) : messagesError ? (
              <ErrorState error={messagesError} onRetry={() => void fetchMessages(activeTicket.id)} />
            ) : messages.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">Nenhuma mensagem neste ticket.</p>
            ) : messages.map((m) => {
              const isAdmin = m.sender_role === "admin";
              const isInternal = m.is_internal;
              return (
                <div key={m.id} className={`flex ${isAdmin ? "justify-end" : "justify-start"}`}>
                  <div className={`max-w-[85%] rounded-2xl px-4 py-3 sm:max-w-[75%] ${
                    isInternal
                      ? "border border-amber-500/30 bg-amber-500/10 text-foreground"
                      : isAdmin ? "bg-primary text-primary-foreground" : "bg-muted text-foreground"
                  }`}>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs font-semibold opacity-90">
                        {isInternal ? "🔒 Nota interna" : isAdmin ? "🛡️ Você (Suporte)" : m.sender_name}
                      </span>
                      <span className="text-[10px] opacity-60">
                        {relativeDate(m.created_at)}
                      </span>
                    </div>
                    <p className="text-sm whitespace-pre-wrap wrap-break-word">{m.message}</p>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="p-4 border-t border-border/40 bg-card/40 space-y-3">
            <div className="flex items-center gap-2 mb-1">
              <button type="button"
                onClick={() => setShowInternalNotes(false)}
                className={`text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-md transition-all ${!showInternalNotes ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent"}`}
              >
                Resposta ao Usuário
              </button>
              <button type="button"
                onClick={() => setShowInternalNotes(true)}
                className={`text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-md transition-all ${showInternalNotes ? "bg-amber-500 text-white" : "text-muted-foreground hover:bg-accent"}`}
              >
                Nota Interna (Apenas Admins)
              </button>
            </div>

            <div className="flex gap-2 items-end">
              <Textarea
                value={showInternalNotes ? internalNote : reply}
                onChange={(e) => showInternalNotes ? setInternalNote(e.target.value) : setReply(e.target.value)}
                placeholder={showInternalNotes ? "Adicione uma nota visível apenas para outros administradores..." : "Digite sua resposta como suporte..."}
                className={`min-h-[70px] resize-none ${showInternalNotes ? "border-amber-500/30 focus-visible:ring-amber-500/30" : ""}`}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleSendReply();
                }}
              />
              <Button 
                onClick={handleSendReply} 
                disabled={!(showInternalNotes ? internalNote.trim() : reply.trim()) || sending} 
                className={`shrink-0 ${showInternalNotes ? "bg-amber-500 hover:bg-amber-600 text-white" : ""}`}
              >
                {showInternalNotes ? <Lock size={14} /> : <Send size={14} />}
              </Button>
            </div>
            <p className="text-[10px] text-muted-foreground">
              {showInternalNotes ? "🔒 Notas internas nunca são enviadas ao usuário." : "Ctrl+Enter envia · O usuário receberá uma notificação."}
            </p>
          </div>
        </div>
      </div>
    );
  }

  // ============ LIST ============
  return (
    <div className="space-y-4">
      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <StatCard label="Total" value={stats.total} icon={LifeBuoy} color="text-foreground" />
        <StatCard label="Abertos" value={stats.open} icon={AlertCircle} color="text-blue-400" />
        <StatCard label="Respondidos" value={stats.answered} icon={CheckCircle2} color="text-emerald-400" />
        <StatCard label="Urgentes" value={stats.urgent} icon={AlertCircle} color="text-red-400" />
        <StatCard label="Não lidos" value={stats.unread} icon={Inbox} color="text-amber-400" highlight={stats.unread > 0} />
      </div>

      {/* Filters */}
      <div className="flex flex-col md:flex-row gap-3">
        <div className="relative flex-1">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por assunto, usuário ou email..."
            className="pl-9"
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="md:w-40"><Filter size={12} className="mr-1" /><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos status</SelectItem>
            <SelectItem value="open">Aberto</SelectItem>
            <SelectItem value="answered">Respondido</SelectItem>
            <SelectItem value="closed">Fechado</SelectItem>
          </SelectContent>
        </Select>
        <Select value={priorityFilter} onValueChange={setPriorityFilter}>
          <SelectTrigger className="md:w-40"><SelectValue placeholder="Prioridade" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas prioridades</SelectItem>
            <SelectItem value="urgent">Urgente</SelectItem>
            <SelectItem value="high">Alta</SelectItem>
            <SelectItem value="normal">Normal</SelectItem>
            <SelectItem value="low">Baixa</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* List */}
      {loading ? (
        <div className="space-y-2">
          {[1, 2, 3, 4].map((i) => <div key={i} className="h-20 rounded-xl bg-muted/30 animate-pulse" />)}
        </div>
      ) : loadError ? (
        <ErrorState error={loadError} onRetry={() => void fetchTickets()} />
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 rounded-2xl border border-dashed border-border/40 bg-card/30">
          <Inbox className="mx-auto text-muted-foreground/40 mb-3" size={48} />
          <p className="text-sm text-muted-foreground">Nenhum ticket encontrado</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((t) => {
            const sb = statusBadge(t.status);
            const StatusIcon = sb.icon;
            const u = usersMap[t.user_id];
            return (
              <button
                key={t.id}
                onClick={() => setActiveTicket(t)}
                className={`w-full text-left rounded-xl border bg-card/60 hover:bg-card/80 hover:border-primary/30 transition-all p-4 flex items-center gap-4 ${t.unread_by_admin ? "border-primary/40 ring-1 ring-primary/10" : "border-border/40"}`}
              >
                <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center shrink-0">
                  {u?.avatar_url ? (
                    <UploadImage src={u.avatar_url} alt="" className="w-10 h-10 rounded-full object-cover" />
                  ) : (
                    <UserIcon size={14} className="text-muted-foreground" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className={`text-sm truncate ${t.unread_by_admin ? "font-semibold text-foreground" : "font-medium text-foreground/90"}`}>
                      {t.subject}
                    </h3>
                    {t.unread_by_admin && <span className="w-2 h-2 rounded-full bg-primary shrink-0" />}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[11px] text-muted-foreground">{u?.name || "Usuário"}</span>
                    <Badge variant="outline" className={`${sb.className} text-[10px] py-0 px-1.5 h-5`}>
                      <StatusIcon size={10} className="mr-1" />{sb.label}
                    </Badge>
                    <Badge variant="outline" className={`${priorityLabels[t.priority]?.className} text-[10px] py-0 px-1.5 h-5`}>
                      {priorityLabels[t.priority]?.label}
                    </Badge>
                    <span className="text-[11px] text-muted-foreground/70">
                      · {relativeDate(t.last_message_at)}
                    </span>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};

const StatCard = ({ label, value, icon: Icon, color, highlight }: { label: string; value: number; icon: any; color: string; highlight?: boolean }) => (
  <div className={`rounded-xl border p-3 bg-card/60 ${highlight ? "border-primary/40 ring-1 ring-primary/20" : "border-border/40"}`}>
    <div className="flex items-center justify-between">
      <span className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">{label}</span>
      <Icon size={14} className={color} />
    </div>
    <p className={`text-2xl font-bold mt-1 ${color}`}>{value}</p>
  </div>
);

export default SupportInbox;
