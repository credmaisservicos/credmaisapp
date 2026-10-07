import { useEffect, useMemo, useState } from "react";
import { friendlyError } from "@/lib/friendlyError";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  LifeBuoy, Plus, MessageSquare, Send, ChevronLeft, Clock, CheckCircle2,
  AlertCircle, Search, Inbox,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
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
};

type TicketMessage = {
  id: string;
  ticket_id: string;
  sender_id: string;
  sender_role: string;
  sender_name: string;
  message: string;
  created_at: string;
};

const categoryLabels: Record<string, string> = {
  general: "Geral",
  technical: "Problema técnico",
  billing: "Financeiro / Assinatura",
  feature: "Sugestão de melhoria",
  bug: "Reportar bug",
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
      return { label: "Em análise", icon: AlertCircle, className: "bg-blue-500/10 text-blue-400 border-blue-500/30" };
    case "answered":
      return { label: "Respondido", icon: CheckCircle2, className: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30" };
    case "closed":
      return { label: "Fechado", icon: CheckCircle2, className: "bg-muted text-muted-foreground border-border" };
    default:
      return { label: status, icon: Clock, className: "bg-muted text-muted-foreground" };
  }
};

const Suporte = () => {
  const { user, profile } = useAuth();
  const { toast } = useToast();
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [search, setSearch] = useState("");
  const [activeTicket, setActiveTicket] = useState<Ticket | null>(null);
  const [messages, setMessages] = useState<TicketMessage[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [messagesError, setMessagesError] = useState<unknown>(null);
  const [reply, setReply] = useState("");
  const [sending, setSending] = useState(false);

  // New ticket
  const [newOpen, setNewOpen] = useState(false);
  const [newSubject, setNewSubject] = useState("");
  const [newCategory, setNewCategory] = useState("general");
  const [newPriority, setNewPriority] = useState("normal");
  const [newMessage, setNewMessage] = useState("");
  const [creating, setCreating] = useState(false);

  const fetchTickets = async () => {
    if (!user) return;
    try {
      const data = await fetchAll<Ticket>((from, to) => supabase
        .from("support_tickets")
        .select("*")
        .eq("user_id", user.id)
        .order("last_message_at", { ascending: false })
        .range(from, to));
      setLoadError(null);
      setTickets(data);
      setActiveTicket((current) => current ? data.find((ticket) => ticket.id === current.id) || null : null);
    } catch (error) {
      setLoadError(error);
    }
    setLoading(false);
  };

  const fetchMessages = async (ticketId: string) => {
    setMessagesLoading(true);
    const { data, error } = await supabase
      .from("support_ticket_messages")
      .select("*")
      .eq("ticket_id", ticketId)
      .order("created_at", { ascending: false })
      .limit(500);
    if (error) setMessagesError(error);
    else {
      setMessagesError(null);
      setMessages([...((data as TicketMessage[]) || [])].reverse());
    }
    setMessagesLoading(false);
  };

  useEffect(() => {
    fetchTickets();
    if (!user) return;
    const ch = supabase
      .channel("realtime-support-tickets-user")
      .on("postgres_changes" as any, { event: "*", schema: "public", table: "support_tickets", filter: `user_id=eq.${user.id}` }, () => fetchTickets())
      .subscribe();
    return () => { supabase.removeChannel(ch); };

  }, [user]);

  useEffect(() => {
    if (!activeTicket || !user) return;
    fetchMessages(activeTicket.id);
    // mark as read
    if (activeTicket.unread_by_user) {
      supabase.from("support_tickets").update({ unread_by_user: false }).eq("id", activeTicket.id).eq("user_id", user.id)
        .then(({ error }) => {
          if (!error) setTickets((prev) => prev.map((ticket) => ticket.id === activeTicket.id ? { ...ticket, unread_by_user: false } : ticket));
          else toast({ ...friendlyError(error, "Não foi possível marcar o ticket como lido."), variant: "destructive" });
        });
    }
    const ch = supabase
      .channel(`realtime-ticket-messages-${activeTicket.id}`)
      .on("postgres_changes" as any, { event: "INSERT", schema: "public", table: "support_ticket_messages", filter: `ticket_id=eq.${activeTicket.id}` }, (payload: any) => {
        setMessages((prev) => [...prev, payload.new]);
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [activeTicket, user]);

  const filtered = useMemo(() => {
    if (!search.trim()) return tickets;
    const q = search.toLowerCase();
    return tickets.filter((t) => (t.subject || "").toLowerCase().includes(q));
  }, [tickets, search]);

  const handleCreateTicket = async () => {
    if (!user || !newSubject.trim() || !newMessage.trim()) {
      toast({ title: "Preencha assunto e mensagem", variant: "destructive" });
      return;
    }
    setCreating(true);
    const { data: ticket, error } = await supabase
      .from("support_tickets")
      .insert({
        user_id: user.id,
        subject: newSubject.trim(),
        category: newCategory,
        priority: newPriority,
        status: "open",
        unread_by_admin: true,
      })
      .select()
      .single();
    if (error || !ticket) {
      toast({ title: "Erro ao criar ticket", description: error?.message, variant: "destructive" });
      setCreating(false);
      return;
    }
    // Se a primeira mensagem falhar, o ticket existe VAZIO: você acha que
    // descreveu o problema e o suporte recebe um chamado sem texto. O erro
    // precisa aparecer.
    const { error: msgError } = await supabase.from("support_ticket_messages").insert({
      ticket_id: ticket.id,
      sender_id: user.id,
      sender_role: "user",
      sender_name: profile?.name || "Usuário",
      message: newMessage.trim(),
    });
    if (msgError) {
      await supabase.from("support_tickets").delete().eq("id", ticket.id).eq("user_id", user.id);
      toast({
        ...friendlyError(msgError, "Não foi possível enviar o chamado. Seus dados foram mantidos para tentar novamente."),
        variant: "destructive",
      });
      setCreating(false);
      return;
    }
    // Triagem IA em background — não bloqueia UX
    supabase.functions.invoke("support-triage", { body: { ticket_id: ticket.id } }).catch(() => {});
    toast({ title: "Ticket aberto!", description: "Você receberá uma resposta em breve." });
    setNewOpen(false);
    setNewSubject("");
    setNewMessage("");
    setNewCategory("general");
    setNewPriority("normal");
    setCreating(false);
    fetchTickets();
  };

  const handleSendReply = async () => {
    if (!activeTicket || !reply.trim() || !user) return;
    setSending(true);
    try {
      const { error } = await supabase.from("support_ticket_messages").insert({
        ticket_id: activeTicket.id,
        sender_id: user.id,
        sender_role: "user",
        sender_name: profile?.name || "Usuário",
        message: reply.trim(),
      });
      if (error) toast({ ...friendlyError(error, "Não foi possível enviar sua mensagem."), variant: "destructive" });
      else setReply("");
    } finally {
      setSending(false);
    }
  };

  // ============ DETAIL VIEW ============
  if (activeTicket) {
    const sb = statusBadge(activeTicket.status);
    const StatusIcon = sb.icon;
    return (
      <div className="min-h-dvh p-4 md:p-6 max-w-4xl mx-auto">
        <button onClick={() => setActiveTicket(null)} className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors mb-4">
          <ChevronLeft size={16} /> Voltar para tickets
        </button>
        <div className="rounded-2xl border border-border/40 bg-card/60 backdrop-blur-xs overflow-hidden">
          <div className="p-5 border-b border-border/40 flex items-start justify-between gap-3">
            <div>
              <h1 className="text-xl font-semibold text-foreground">{activeTicket.subject}</h1>
              <div className="flex flex-wrap items-center gap-2 mt-2">
                <Badge variant="outline" className={sb.className}>
                  <StatusIcon size={12} className="mr-1" /> {sb.label}
                </Badge>
                <Badge variant="outline" className={priorityLabels[activeTicket.priority]?.className}>
                  {priorityLabels[activeTicket.priority]?.label || activeTicket.priority}
                </Badge>
                <Badge variant="outline" className="bg-muted text-muted-foreground">
                  {categoryLabels[activeTicket.category] || activeTicket.category}
                </Badge>
                <span className="text-xs text-muted-foreground">
                  Aberto {relativeDate(activeTicket.created_at)}
                </span>
              </div>
            </div>
          </div>

          <div className="p-5 space-y-4 max-h-[55vh] overflow-y-auto">
            {messagesLoading ? (
              <p className="text-center text-muted-foreground text-sm py-8">Carregando mensagens...</p>
            ) : messagesError ? (
              <ErrorState error={messagesError} onRetry={() => fetchMessages(activeTicket.id)} />
            ) : messages.length === 0 ? (
              <p className="text-center text-muted-foreground text-sm py-8">Nenhuma mensagem neste ticket.</p>
            ) : (
              messages.map((m) => {
                const isMe = m.sender_role === "user";
                return (
                  <div key={m.id} className={`flex ${isMe ? "justify-end" : "justify-start"}`}>
                    <div className={`max-w-[75%] rounded-2xl px-4 py-3 ${isMe ? "bg-primary text-primary-foreground" : "bg-muted text-foreground"}`}>
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-xs font-semibold opacity-90">
                          {isMe ? "Você" : `🛡️ ${m.sender_name}`}
                        </span>
                        <span className="text-[10px] opacity-60">
                          {relativeDate(m.created_at)}
                        </span>
                      </div>
                      <p className="text-sm whitespace-pre-wrap wrap-break-word">{m.message}</p>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {activeTicket.status !== "closed" ? (
            <div className="p-4 border-t border-border/40 bg-card/40">
              <div className="flex gap-2 items-end">
                <Textarea
                  value={reply}
                  onChange={(e) => setReply(e.target.value)}
                  placeholder="Digite sua resposta..."
                  maxLength={4000}
                  className="min-h-[60px] resize-none"
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleSendReply();
                  }}
                />
                <Button onClick={handleSendReply} disabled={!reply.trim() || sending} className="shrink-0">
                  <Send size={14} />
                </Button>
              </div>
              <p className="text-[10px] text-muted-foreground mt-1">Pressione Ctrl+Enter para enviar</p>
            </div>
          ) : (
            <div className="p-4 text-center text-sm text-muted-foreground border-t border-border/40">
              Este ticket foi fechado.
            </div>
          )}
        </div>
      </div>
    );
  }

  // ============ LIST VIEW ============
  return (
    <div className="min-h-dvh md:p-6 max-w-5xl mx-auto space-y-6">
      <div className="page-hero animate-fade-in">
        <div className="page-hero-content flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3">
            <div className="page-hero-icon">
              <LifeBuoy size={22} />
            </div>
            <div className="min-w-0">
              <h1 className="text-2xl font-bold text-shimmer">Central de Suporte</h1>
              <p className="text-sm text-muted-foreground mt-0.5">Abra um ticket e fale com nossa equipe</p>
            </div>
          </div>
          <button onClick={() => setNewOpen(true)} className="btn-premium w-full sm:w-auto justify-center">
            <Plus size={16} /> Novo ticket
          </button>
        </div>
      </div>

      <div className="relative mb-4">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar tickets..."
          aria-label="Buscar tickets de suporte"
          className="pl-9"
        />
      </div>

      {loading ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-20 rounded-xl bg-muted/30 animate-pulse" />
          ))}
        </div>
      ) : loadError ? (
        <ErrorState error={loadError} onRetry={() => { setLoading(true); fetchTickets(); }} />
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 rounded-2xl border border-dashed border-border/40 bg-card/30">
          <Inbox className="mx-auto text-muted-foreground/40 mb-3" size={48} />
          <h3 className="font-medium text-foreground mb-1">Nenhum ticket aberto</h3>
          <p className="text-sm text-muted-foreground mb-4">Precisa de ajuda? Crie seu primeiro ticket.</p>
          <Button onClick={() => setNewOpen(true)} variant="outline" className="gap-2">
            <Plus size={14} /> Abrir ticket
          </Button>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((t) => {
            const sb = statusBadge(t.status);
            const StatusIcon = sb.icon;
            return (
              <button
                key={t.id}
                onClick={() => setActiveTicket(t)}
                className="w-full text-left rounded-xl border border-border/40 bg-card/60 hover:bg-card/80 hover:border-primary/30 transition-all p-4 flex items-center gap-4 group"
              >
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${t.unread_by_user ? "bg-primary/15 text-primary ring-1 ring-primary/30" : "bg-muted text-muted-foreground"}`}>
                  <MessageSquare size={16} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className={`text-sm truncate ${t.unread_by_user ? "font-semibold text-foreground" : "font-medium text-foreground/90"}`}>
                      {t.subject}
                    </h3>
                    {t.unread_by_user && <span className="w-2 h-2 rounded-full bg-primary shrink-0" />}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline" className={`${sb.className} text-[10px] py-0 px-1.5 h-5`}>
                      <StatusIcon size={10} className="mr-1" />{sb.label}
                    </Badge>
                    <span className="text-[11px] text-muted-foreground">
                      {categoryLabels[t.category] || t.category}
                    </span>
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

      {/* New Ticket Dialog */}
      <Dialog open={newOpen} onOpenChange={setNewOpen}>
        <DialogContent className="max-h-[90dvh] w-[calc(100vw-1.5rem)] max-w-lg overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Abrir novo ticket</DialogTitle>
            <DialogDescription>Descreva sua dúvida ou problema. Nossa equipe responderá em breve.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label htmlFor="subject">Assunto *</Label>
              <Input
                id="subject"
                value={newSubject}
                onChange={(e) => setNewSubject(e.target.value)}
                placeholder="Ex: Não consigo cadastrar cliente"
                maxLength={120}
              />
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <Label>Categoria</Label>
                <Select value={newCategory} onValueChange={setNewCategory}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(categoryLabels).map(([k, v]) => (
                      <SelectItem key={k} value={k}>{v}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Prioridade</Label>
                <Select value={newPriority} onValueChange={setNewPriority}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(priorityLabels).map(([k, v]) => (
                      <SelectItem key={k} value={k}>{v.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label htmlFor="message">Mensagem *</Label>
              <Textarea
                id="message"
                value={newMessage}
                onChange={(e) => setNewMessage(e.target.value)}
                placeholder="Descreva em detalhes..."
                rows={5}
                maxLength={2000}
              />
              <p className="text-[10px] text-muted-foreground mt-1">{newMessage.length}/2000</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNewOpen(false)}>Cancelar</Button>
            <Button onClick={handleCreateTicket} disabled={creating || !newSubject.trim() || !newMessage.trim()}>
              {creating ? "Enviando..." : "Abrir ticket"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Suporte;
