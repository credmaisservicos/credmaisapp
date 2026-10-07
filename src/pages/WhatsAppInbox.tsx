import { Credinho, CredinhoAvatar } from "@/components/brand/Credinho";
import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { friendlyError } from "@/lib/friendlyError";

import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import VoiceRecorder from "@/components/VoiceRecorder";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
  DropdownMenuLabel, DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger,
} from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { toast } from "@/hooks/use-toast";
import {
  Bot, Pause, Play, Search, Send, User, MessageCircle, Loader2,
  AlertTriangle, Ban, FileText, Wallet, CheckCircle2, MoreVertical, Sparkles,
  Tag as TagIcon, StickyNote, Clock, Paperclip, Download, BarChart3, Wand2, X, Activity,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import { getSignedUploadUrl } from "@/lib/storage";
import { formatBRDateTime, parseLocalDate, todayLocalISO } from "@/lib/dateUtils";

interface Conversation {
  id: string; user_id: string; client_id: string | null;
  phone: string; jid: string; instance: string | null;
  contact_name: string | null; last_message_at: string;
  last_message_preview: string | null; last_message_from: string | null;
  unread_count: number; bot_paused: boolean; needs_human: boolean;
  blocked: boolean; tags: string[] | null; last_intent: string | null;
  bot_status?: string | null; human_takeover_at?: string | null; human_takeover_reason?: string | null;
}

function normalizeConversation(value: unknown): Conversation | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, any>;
  if (!row.id) return null;
  return {
    ...row,
    id: String(row.id),
    user_id: String(row.user_id || ""),
    client_id: row.client_id ?? null,
    phone: String(row.phone || ""),
    jid: String(row.jid || ""),
    contact_name: row.contact_name ? String(row.contact_name) : null,
    last_message_at: row.last_message_at && !Number.isNaN(new Date(row.last_message_at).getTime())
      ? String(row.last_message_at) : new Date().toISOString(),
    last_message_preview: row.last_message_preview == null ? null : String(row.last_message_preview),
    last_message_from: row.last_message_from == null ? null : String(row.last_message_from),
    unread_count: Number.isFinite(Number(row.unread_count)) ? Number(row.unread_count) : 0,
    bot_paused: Boolean(row.bot_paused),
    needs_human: Boolean(row.needs_human),
    blocked: Boolean(row.blocked),
    tags: Array.isArray(row.tags) ? row.tags.map((tag: unknown) => String(tag || "")).filter(Boolean) : [],
    last_intent: row.last_intent == null ? null : String(row.last_intent),
  } as Conversation;
}

interface Message {
  id: string; conversation_id: string;
  direction: "in" | "out"; sender: "client" | "bot" | "human";
  message_type: string; content: string | null; created_at: string;
  media_url?: string | null; metadata?: any;
}

interface Template { id: string; name: string; content: string; }
interface Note { id: string; content: string; created_at: string; author_name?: string | null; }

type FilterKind = "all" | "unread" | "needs_human" | "bot" | "blocked";

const safeDate = (value: unknown) => {
  return parseLocalDate(typeof value === "string" || value instanceof Date ? value : null);
};
const safeRelativeTime = (value: unknown, addSuffix = false) => {
  const date = safeDate(value);
  return date ? formatDistanceToNow(date, { addSuffix, locale: ptBR }) : "data indisponível";
};
const safeTime = (value: unknown) => safeDate(value)?.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) || "—";
const safeDateTime = (value: unknown) => formatBRDateTime(typeof value === "string" ? value : null) || "data indisponível";

const INTENT_LABEL: Record<string, { label: string; color: string }> = {
  pagamento: { label: "💰 Pagamento", color: "bg-green-500/20 text-green-700 dark:text-green-300" },
  duvida: { label: "❓ Dúvida", color: "bg-blue-500/20 text-blue-700 dark:text-blue-300" },
  reclamacao: { label: "😤 Reclamação", color: "bg-red-500/20 text-red-700 dark:text-red-300" },
  negociacao: { label: "🤝 Negociação", color: "bg-amber-500/20 text-amber-700 dark:text-amber-300" },
  comprovante: { label: "📄 Comprovante", color: "bg-cyan-500/20 text-cyan-700 dark:text-cyan-300" },
  saudacao: { label: "👋 Saudação", color: "bg-violet-500/20 text-violet-700 dark:text-violet-300" },
  agressivo: { label: "⚠️ Agressivo", color: "bg-red-600/30 text-red-700 dark:text-red-200" },
};

export default function WhatsAppInbox() {
  const { user } = useAuth();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [notes, setNotes] = useState<Note[]>([]);
  const [draft, setDraft] = useState("");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<FilterKind>("all");
  const [sending, setSending] = useState(false);
  const [loadingConversations, setLoadingConversations] = useState(true);
  const [conversationsError, setConversationsError] = useState<string | null>(null);
  const [loadingMsgs, setLoadingMsgs] = useState(false);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [notesOpen, setNotesOpen] = useState(false);
  const [newNote, setNewNote] = useState("");
  const [tagsOpen, setTagsOpen] = useState(false);
  const [newTag, setNewTag] = useState("");
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [scheduleDate, setScheduleDate] = useState("");
  const [scheduleTime, setScheduleTime] = useState("");
  const [scheduleText, setScheduleText] = useState("");
  const [metricsOpen, setMetricsOpen] = useState(false);
  const [hourlyStats, setHourlyStats] = useState<{ hour: number; count: number }[]>([]);
  const [metrics, setMetrics] = useState({
    total: 0, today: 0, needsHuman: 0, botReplies7d: 0, humanReplies7d: 0,
  });
  const [actionsOpen, setActionsOpen] = useState(false);
  const [botActions, setBotActions] = useState<Array<{ id: string; tool_name: string; tool_input: any; tool_output: any; success: boolean; created_at: string }>>([]);
  const [actionsLoading, setActionsLoading] = useState(false);

  const openBotActions = async () => {
    if (!selected || !user) return;
    setActionsOpen(true);
    setActionsLoading(true);
    const { data, error } = await supabase
      .from("bot_actions_log")
      .select("id, tool_name, tool_input, tool_output, success, created_at")
      .eq("user_id", user.id)
      .eq("conversation_id", selected.id)
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) toast({ ...friendlyError(error, "Não foi possível carregar as ações do bot."), variant: "destructive" });
    else setBotActions((data || []) as any);
    setActionsLoading(false);
  };
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const selected = useMemo(
    () => conversations.find((c) => c.id === selectedId) || null,
    [conversations, selectedId]
  );

  // === Load conversations + realtime ===
  useEffect(() => {
    if (!user) return;
    let mounted = true;
    const load = async () => {
      if (mounted) { setLoadingConversations(true); setConversationsError(null); }
      const { data, error } = await supabase
        .from("whatsapp_conversations").select("*")
        .eq("user_id", user.id).order("last_message_at", { ascending: false }).limit(300);
      if (!mounted) return;
      if (error) setConversationsError(error.message);
      else setConversations((data || []).map(normalizeConversation).filter((item): item is Conversation => !!item));
      setLoadingConversations(false);
    };
    load();
    const channel = supabase
      .channel("wa-conversations")
      .on("postgres_changes" as any,
        { event: "*", schema: "public", table: "whatsapp_conversations", filter: `user_id=eq.${user.id}` },
        () => load()
      ).subscribe();
    return () => { mounted = false; supabase.removeChannel(channel); };
  }, [user]);

  // === Templates ===
  useEffect(() => {
    if (!user) return;
    supabase.from("message_templates")
      .select("id, name, content").eq("user_id", user.id)
      .eq("is_active", true).order("name")
      .then(({ data }) => setTemplates((data as Template[]) || []));
  }, [user]);

  // === Métricas ===
  useEffect(() => {
    if (!user) return;
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const since7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const total = conversations.length;
    const todayCount = conversations.filter(c => {
      const lastMessage = parseLocalDate(c.last_message_at);
      return !!lastMessage && lastMessage >= today;
    }).length;
    const needsHuman = conversations.filter(c => c.needs_human).length;
    supabase.from("whatsapp_messages")
      .select("sender, created_at").eq("user_id", user.id)
      .eq("direction", "out").gte("created_at", since7d)
      .then(({ data }) => {
        const bot = (data || []).filter((m: any) => m.sender === "bot").length;
        const human = (data || []).filter((m: any) => m.sender === "human").length;
        setMetrics({ total, today: todayCount, needsHuman, botReplies7d: bot, humanReplies7d: human });
      });
  }, [conversations, user]);

  // === Messages + notes para conversa selecionada ===
  useEffect(() => {
    if (!selectedId || !user) { setMessages([]); setNotes([]); return; }
    let mounted = true;
    setLoadingMsgs(true);

    const load = async () => {
      const [messageResult, noteResult] = await Promise.all([
        supabase.from("whatsapp_messages").select("*")
          .eq("user_id", user.id).eq("conversation_id", selectedId).order("created_at", { ascending: false }).limit(500),
        supabase.from("whatsapp_notes").select("*")
          .eq("user_id", user.id).eq("conversation_id", selectedId).order("created_at", { ascending: false }),
      ]);
      if (!mounted) return;
      if (messageResult.error || noteResult.error) {
        const loadError = messageResult.error || noteResult.error;
        toast({ ...friendlyError(loadError, "Não foi possível carregar esta conversa."), variant: "destructive" });
        setLoadingMsgs(false);
        return;
      }
      setMessages([...((messageResult.data as Message[]) || [])].reverse());
      setNotes((noteResult.data as Note[]) || []);
      setLoadingMsgs(false);
      const { error: readError } = await supabase.from("whatsapp_conversations").update({ unread_count: 0 }).eq("id", selectedId).eq("user_id", user.id);
      if (readError) toast({ ...friendlyError(readError, "Não foi possível marcar a conversa como lida."), variant: "destructive" });
    };
    load();

    const ch = supabase
      .channel(`wa-msg-${selectedId}`)
      .on("postgres_changes" as any,
        { event: "INSERT", schema: "public", table: "whatsapp_messages", filter: `conversation_id=eq.${selectedId}` },
        (p) => setMessages(prev => [...prev, p.new as Message]))
      .on("postgres_changes" as any,
        { event: "UPDATE", schema: "public", table: "whatsapp_messages", filter: `conversation_id=eq.${selectedId}` },
        (p) => setMessages(prev => prev.map(m => m.id === (p.new as Message).id ? p.new as Message : m)))
      .subscribe();


    return () => { mounted = false; supabase.removeChannel(ch); };
  }, [selectedId, user]);

  // Scroll automático
  useEffect(() => {
    requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
    });
  }, [messages.length, selectedId]);

  // === KEYBOARD SHORTCUTS ===
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Não interfere em inputs/textareas
      const tag = (e.target as HTMLElement)?.tagName;
      const isInput = tag === "INPUT" || tag === "TEXTAREA";

      // Navegação ↑/↓
      if (!isInput && (e.key === "ArrowUp" || e.key === "ArrowDown") && filtered.length) {
        e.preventDefault();
        const idx = filtered.findIndex(c => c.id === selectedId);
        const next = e.key === "ArrowDown"
          ? Math.min(idx + 1, filtered.length - 1)
          : Math.max(idx - 1, 0);
        setSelectedId(filtered[next < 0 ? 0 : next].id);
      }
      // Ctrl+Enter envia
      if (e.ctrlKey && e.key === "Enter" && draft.trim() && selected) {
        e.preventDefault(); send();
      }
      // Ctrl+P pausa bot
      if (e.ctrlKey && e.key.toLowerCase() === "p" && selected) {
        e.preventDefault(); toggleBot();
      }
      // Ctrl+R resolve
      if (e.ctrlKey && e.key.toLowerCase() === "r" && selected) {
        e.preventDefault(); quickAction("mark_resolved", "Resolvido");
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);

  }, [selectedId, conversations, search, filter, draft]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return conversations.filter(c => {
      if (filter === "unread" && c.unread_count <= 0) return false;
      if (filter === "needs_human" && c.bot_status !== "handoff" && !c.needs_human) return false;
      if (filter === "bot" && c.bot_paused) return false;
      if (filter === "blocked" && !c.blocked) return false;
      if (!q) return true;
      return (c.contact_name || "").toLowerCase().includes(q)
        || (c.phone || "").includes(q)
        || (c.last_message_preview || "").toLowerCase().includes(q)
        || (c.tags || []).some(t => String(t || "").toLowerCase().includes(q));
    });
  }, [conversations, search, filter]);

  // === Helpers ===
  const invokeSend = async (payload: Record<string, any>) => {
    const { data: sess } = await supabase.auth.getSession();
    const token = sess.session?.access_token;
    const res = await supabase.functions.invoke("whatsapp-send", {
      body: payload,
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    });
    if (res.error) throw res.error;
    if (res.data?.error || res.data?.ok !== true) throw new Error(res.data?.error || "O envio não foi confirmado pelo servidor.");
  };

  const send = async () => {
    if (!draft.trim() || !selected) return;
    setSending(true);
    try {
      await invokeSend({ conversation_id: selected.id, text: draft.trim() });
      setDraft("");
    } catch (e: any) {
      toast({ title: "Erro ao enviar", description: e?.message || "Falha", variant: "destructive" });
    } finally { setSending(false); }
  };

  const quickAction = async (action: string, label: string) => {
    if (!selected) return;
    setSending(true);
    try {
      await invokeSend({ conversation_id: selected.id, action });
      toast({ title: label });
    } catch (e: any) {
      toast({ title: "Erro", description: e?.message || "Falha", variant: "destructive" });
    } finally { setSending(false); }
  };

  const toggleBot = async () => {
    if (!selected || !user) return;
    const next = !selected.bot_paused;
    const patch: any = { bot_paused: next };
    // Ao reativar, limpa qualquer handoff pendente
    if (!next) {
      patch.bot_status = "active";
      patch.needs_human = false;
      patch.human_takeover_at = null;
      patch.human_takeover_reason = null;
    } else {
      patch.bot_status = "paused";
    }
    const { error } = await supabase.from("whatsapp_conversations").update(patch).eq("id", selected.id).eq("user_id", user.id);
    if (error) return toast({ ...friendlyError(error, "Não foi possível atualizar o bot."), variant: "destructive" });
    toast({ title: next ? "Bot pausado" : "Bot reativado — handoff limpo" });
  };

  const toggleBlock = async () => {
    if (!selected || !user) return;
    const next = !selected.blocked;
    const { error } = await supabase.from("whatsapp_conversations")
      .update({ blocked: next, bot_paused: next || selected.bot_paused }).eq("id", selected.id).eq("user_id", user.id);
    if (error) return toast({ ...friendlyError(error, "Não foi possível bloquear o contato."), variant: "destructive" });
    toast({ title: next ? "Bloqueado 🚫" : "Desbloqueado" });
  };

  // Renomeada: com o prefixo `use` o ESLint tratava esta funcao comum como
  // hook. Nao era um hook — mas o nome escondia a diferenca, e um dia alguem
  // moveria a chamada para o corpo do componente sem perceber.
  const inserirTemplate = (tpl: Template) => {
    if (!selected) return;
    const name = (selected.contact_name || "").split(" ")[0] || "";
    setDraft(tpl.content.replace(/\{nome\}/gi, name));
  };

  // === Tags ===
  const addTag = async (value = newTag) => {
    if (!selected || !value.trim() || !user) return;
    const tags = Array.from(new Set([...(selected.tags || []), value.trim()]));
    const { error } = await supabase.from("whatsapp_conversations").update({ tags }).eq("id", selected.id).eq("user_id", user.id);
    if (error) return toast({ ...friendlyError(error, "Não foi possível adicionar a tag."), variant: "destructive" });
    setConversations(previous => previous.map(conversation => conversation.id === selected.id ? { ...conversation, tags } : conversation));
    setNewTag("");
  };
  const removeTag = async (t: string) => {
    if (!selected || !user) return;
    const tags = (selected.tags || []).filter(x => x !== t);
    const { error } = await supabase.from("whatsapp_conversations").update({ tags }).eq("id", selected.id).eq("user_id", user.id);
    if (error) toast({ ...friendlyError(error, "Não foi possível remover a tag."), variant: "destructive" });
  };

  // === Notes ===
  const addNote = async () => {
    if (!selected || !newNote.trim() || !user) return;
    const { error } = await supabase.from("whatsapp_notes").insert({
      conversation_id: selected.id, user_id: user.id,
      content: newNote.trim(), author_name: user.email,
    });
    if (error) return toast({ ...friendlyError(error, "Não foi possível salvar a nota."), variant: "destructive" });
    setNewNote("");
    const { data } = await supabase.from("whatsapp_notes").select("*")
      .eq("user_id", user.id).eq("conversation_id", selected.id).order("created_at", { ascending: false });
    setNotes((data as Note[]) || []);
  };

  // === Mídia ===
  const onFileSelected = async (file: File) => {
    if (!selected || !user) return;
    setSending(true);
    let uploadedPath: string | null = null;
    try {
      const ext = file.name.split(".").pop() || "bin";
      const path = `${user.id}/whatsapp/${Date.now()}.${ext}`;
      uploadedPath = path;
      const { error: upErr } = await supabase.storage.from("uploads").upload(path, file, { upsert: false });
      if (upErr) throw upErr;
      const publicUrl = await getSignedUploadUrl(path);
      if (!publicUrl) throw new Error("Falha ao gerar URL do arquivo");
      const type: "image" | "document" | "audio" =
        file.type.startsWith("image/") ? "image"
        : file.type.startsWith("audio/") ? "audio"
        : "document";
      await invokeSend({
        conversation_id: selected.id,
        media_url: publicUrl, media_type: type,
        caption: draft.trim() || undefined,
      });
      setDraft("");
      toast({ title: "Mídia enviada" });
    } catch (e: any) {
      if (uploadedPath) await supabase.storage.from("uploads").remove([uploadedPath]);
      toast({ title: "Erro mídia", description: e?.message, variant: "destructive" });
    } finally { setSending(false); }
  };

  // === Agendamento ===
  const scheduleSend = async () => {
    if (!selected || !scheduleText.trim() || !scheduleDate || !scheduleTime) return;
    const scheduledDate = new Date(`${scheduleDate}T${scheduleTime}`);
    if (!Number.isFinite(scheduledDate.getTime()) || scheduledDate.getTime() <= Date.now()) {
      toast({ title: "Horário inválido", description: "Escolha uma data e hora futuras.", variant: "destructive" });
      return;
    }
    const iso = scheduledDate.toISOString();
    setSending(true);
    try {
      await invokeSend({ conversation_id: selected.id, text: scheduleText.trim(), schedule_for: iso });
      toast({ title: "Mensagem agendada" });
      setScheduleOpen(false); setScheduleText(""); setScheduleDate(""); setScheduleTime("");
    } catch (e: any) {
      toast({ title: "Erro", description: e?.message, variant: "destructive" });
    } finally { setSending(false); }
  };


  // === Export ===
  const exportConversation = () => {
    if (!selected) return;
    const lines = [
      `Conversa com ${selected.contact_name || selected.phone}`,
      `Exportado em ${new Date().toLocaleString("pt-BR")}`,
      "─".repeat(60), "",
    ];
    messages.forEach(m => {
      const who = m.direction === "in" ? "CLIENTE" : (m.sender === "bot" ? "BOT" : "OPERADOR");
      const ts = safeDateTime(m.created_at);
      lines.push(`[${ts}] ${who}: ${m.content || `[${m.message_type}]`}`);
    });
    if (notes.length) {
      lines.push("", "─".repeat(60), "NOTAS INTERNAS", "");
      notes.forEach(n => lines.push(`[${safeDateTime(n.created_at)}] ${n.content}`));
    }
    const blob = new Blob([lines.join("\n")], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `conversa-${selected.phone}-${Date.now()}.txt`; a.click();
    URL.revokeObjectURL(url);
  };

  // === Métricas avançadas (modal) ===
  const loadAdvancedMetrics = async () => {
    if (!user) return;
    setMetricsOpen(true);
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const { data } = await supabase.from("whatsapp_messages")
      .select("created_at").eq("user_id", user.id)
      .eq("direction", "in").gte("created_at", since);
    const buckets = Array.from({ length: 24 }, (_, h) => ({ hour: h, count: 0 }));
    (data || []).forEach((m: any) => {
      const h = safeDate(m.created_at)?.getHours() ?? 0;
      buckets[h].count++;
    });
    setHourlyStats(buckets);
  };

  const maxHourly = Math.max(1, ...hourlyStats.map(h => h.count));

  const totalUnread = conversations.reduce((s, c) => s + (c.unread_count || 0), 0);

  return (
    <div className="space-y-4">
      {/* HERO Premium */}
      <div className="relative overflow-hidden rounded-3xl border border-border bg-gradient-to-br from-emerald-500/10 via-card to-card p-5 md:p-6 animate-fade-in">
        <div className="absolute -top-20 -right-16 w-64 h-64 rounded-full bg-emerald-500/15 blur-3xl pointer-events-none" />
        <div className="absolute -bottom-24 -left-16 w-64 h-64 rounded-full bg-primary/10 blur-3xl pointer-events-none" />

        <div className="relative flex flex-col lg:flex-row lg:items-center justify-between gap-5">
          <div className="flex items-start gap-4">
            <div className="w-14 h-14 rounded-2xl bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center shadow-[0_0_30px_rgb(16_185_129/0.25)]">
              <MessageCircle size={26} className="text-emerald-500" />
            </div>
            <div>
              <p className="text-[11px] uppercase tracking-widest text-muted-foreground font-medium">WhatsApp</p>
              <h1 className="text-display text-2xl md:text-3xl font-bold text-foreground tracking-tight">Conversas</h1>
              <p className="text-xs text-muted-foreground mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="flex items-center gap-1"><MessageCircle size={11} className="text-emerald-500" /> {metrics.total} ativas</span>
                {totalUnread > 0 && <><span className="text-border">•</span><span className="text-primary font-semibold">{totalUnread} não lida{totalUnread === 1 ? "" : "s"}</span></>}
                {metrics.needsHuman > 0 && <><span className="text-border">•</span><span className="text-destructive font-semibold flex items-center gap-1"><AlertTriangle size={11} /> {metrics.needsHuman} precisa(m) de você</span></>}
              </p>
            </div>
          </div>

          {/* Mini KPIs inline */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {[
              { label: "Hoje", value: metrics.today, color: "text-foreground", bg: "bg-card/70" },
              { label: "Bot 7d", value: metrics.botReplies7d, color: "text-primary", bg: "bg-primary/10" },
              { label: "Humano 7d", value: metrics.humanReplies7d, color: "text-foreground", bg: "bg-card/70" },
              { label: "Alerta", value: metrics.needsHuman, color: metrics.needsHuman > 0 ? "text-destructive" : "text-muted-foreground", bg: metrics.needsHuman > 0 ? "bg-destructive/10" : "bg-card/70" },
            ].map((k) => (
              <div key={k.label} className={`rounded-xl border border-border/60 ${k.bg} backdrop-blur px-3 py-2 min-w-[76px]`}>
                <p className="text-[9px] uppercase tracking-wider text-muted-foreground font-semibold">{k.label}</p>
                <p className={`text-xl font-bold tabular-nums ${k.color}`}>{k.value}</p>
              </div>
            ))}
            <button
              onClick={loadAdvancedMetrics}
              className="col-span-2 sm:col-span-4 flex items-center justify-center gap-1.5 rounded-xl border border-border/60 bg-card/70 backdrop-blur px-3 py-1.5 text-[11px] font-semibold text-primary hover:bg-primary/10 transition-colors"
            >
              <BarChart3 size={12} /> Análise horária (7d)
            </button>
          </div>
        </div>
      </div>

      {/* A coluna da lista era fixa em 360px, sem variante para telas pequenas:
          num celular de 360px sobram 336px depois do padding, então a caixa
          vazava para fora e a conversa ficava espremida. No celular as duas
          partes passam a ficar uma embaixo da outra, com altura natural. */}
      <div className="grid grid-cols-1 gap-3 lg:h-[calc(100vh-16rem)] lg:grid-cols-[360px_1fr]">
        {/* Lista de conversas */}
        <Card className="flex flex-col overflow-hidden rounded-2xl border-border/60">
          <div className="p-3 border-b border-border/60 space-y-2.5 bg-gradient-to-b from-card to-card/50">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold flex items-center gap-2 text-sm">
                <MessageCircle className="h-4 w-4 text-emerald-500" /> Conversas
                <span className="text-[10px] text-muted-foreground font-normal">({filtered.length})</span>
              </h2>
              <span className="text-[10px] text-muted-foreground font-normal">↑↓ navega</span>
            </div>
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
              <Input value={search} onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar (nome, tag, msg)..." className="pl-8 h-9 text-sm rounded-xl" />
            </div>
            <div className="flex gap-1 flex-wrap">
              {([
                ["all", "Todas"], ["unread", "Não lidas"], ["needs_human", "🆘 Humano"],
                ["bot", "Bot on"], ["blocked", "🚫"],
              ] as [FilterKind, string][]).map(([k, l]) => (
                <button key={k} onClick={() => setFilter(k)}
                  className={`text-[11px] px-2.5 py-1 rounded-full border transition font-medium ${
                    filter === k ? "bg-primary text-primary-foreground border-primary shadow-sm"
                                 : "border-border/60 text-muted-foreground hover:bg-muted/40 hover:text-foreground"}`}>{l}</button>
              ))}
            </div>
          </div>
          <ScrollArea className="flex-1">
            {loadingConversations && (
              <div className="flex items-center justify-center gap-2 p-8 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Carregando conversas...
              </div>
            )}
            {!loadingConversations && conversationsError && (
              <div className="p-6 text-center">
                <AlertTriangle className="mx-auto h-6 w-6 text-destructive" />
                <p className="mt-2 text-sm font-semibold">Falha ao carregar conversas</p>
                <p className="mt-1 text-xs text-muted-foreground">{conversationsError}</p>
              </div>
            )}
            {!loadingConversations && !conversationsError && filtered.length === 0 && (
              <div className="p-8 text-center">
                <div className="w-12 h-12 rounded-2xl bg-muted/40 flex items-center justify-center mx-auto mb-3">
                  <MessageCircle className="h-5 w-5 text-muted-foreground" />
                </div>
                <p className="text-sm text-muted-foreground">Nenhuma conversa</p>
                <p className="text-[11px] text-muted-foreground/70 mt-0.5">Ajuste os filtros ou busca</p>
              </div>
            )}
            {!loadingConversations && !conversationsError && filtered.map((c) => {
              const intentBadge = c.last_intent && INTENT_LABEL[c.last_intent];
              const name = c.contact_name || c.phone;
              const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((s) => s[0]?.toUpperCase() || "").join("") || "?";
              const isActive = selectedId === c.id;
              const urgent = c.bot_status === "handoff" || c.needs_human;
              return (
                <button key={c.id} onClick={() => setSelectedId(c.id)}
                  className={`w-full text-left px-3 py-3 border-b border-border/40 transition-all relative ${
                    isActive ? "bg-primary/10" : "hover:bg-muted/30"
                  }`}>
                  {urgent && <span className="absolute left-0 top-0 bottom-0 w-1 bg-destructive rounded-r-full" />}
                  {isActive && !urgent && <span className="absolute left-0 top-0 bottom-0 w-1 bg-primary rounded-r-full" />}
                  <div className="flex items-start gap-2.5">
                    {/* Avatar */}
                    <div className="relative shrink-0">
                      <div className={`w-10 h-10 rounded-full flex items-center justify-center text-[11px] font-bold ${
                        urgent ? "bg-destructive/20 text-destructive border border-destructive/30"
                               : isActive ? "bg-primary/20 text-primary border border-primary/30"
                                          : "bg-gradient-to-br from-emerald-500/20 to-emerald-500/5 text-emerald-600 dark:text-emerald-400 border border-border"
                      }`}>{initials}</div>
                      {c.bot_status !== "handoff" && !c.bot_paused && !c.blocked && (
                        <div className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full bg-primary border-2 border-card flex items-center justify-center" title="Bot ativo">
                          <Bot className="h-2 w-2 text-primary-foreground" />
                        </div>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className={`text-sm truncate ${c.unread_count > 0 ? "font-bold text-foreground" : "font-semibold text-foreground/90"}`}>{name}</span>
                        <span className="text-[10px] text-muted-foreground shrink-0">
                          {safeRelativeTime(c.last_message_at)}
                        </span>
                      </div>
                      <div className="flex items-center gap-1 mt-0.5 flex-wrap">
                        {c.bot_status === "handoff" && (
                          <Badge variant="destructive" className="text-[9px] py-0 h-4 px-1.5 animate-pulse font-semibold">🚨 humano</Badge>
                        )}
                        {c.bot_status !== "handoff" && c.needs_human && (
                          <Badge variant="destructive" className="text-[9px] py-0 h-4 px-1.5"><AlertTriangle className="h-2.5 w-2.5 mr-0.5" />precisa</Badge>
                        )}
                        {c.bot_paused && c.bot_status !== "handoff" && !c.blocked && (
                          <Badge variant="outline" className="text-[9px] py-0 h-4 px-1.5 border-amber-500/40 text-amber-600 dark:text-amber-400">bot off</Badge>
                        )}
                        {c.blocked && <Badge variant="secondary" className="text-[9px] py-0 h-4 px-1.5">🚫</Badge>}
                        {intentBadge && !urgent && (
                          <span className={`text-[9px] px-1.5 py-0.5 rounded-full ${intentBadge.color}`}>{intentBadge.label}</span>
                        )}
                        {(c.tags || []).slice(0, 2).map(t => (
                          <span key={t} className="text-[9px] px-1.5 py-0.5 rounded-full bg-primary/10 text-primary">#{t}</span>
                        ))}
                      </div>
                      <div className="flex items-center justify-between gap-2 mt-1">
                        <p className={`text-xs truncate flex-1 ${c.unread_count > 0 ? "text-foreground/80 font-medium" : "text-muted-foreground"}`}>
                          {c.last_message_from === "bot" && <Bot className="inline h-2.5 w-2.5 mr-0.5 text-primary" />}
                          {c.last_message_from === "human" && <User className="inline h-2.5 w-2.5 mr-0.5 text-emerald-500" />}
                          {c.last_message_preview || "—"}
                        </p>
                        {c.unread_count > 0 && (
                          <Badge className="h-5 min-w-5 px-1.5 text-[10px] rounded-full shrink-0">{c.unread_count}</Badge>
                        )}
                      </div>
                    </div>
                  </div>
                </button>
              );
            })}
          </ScrollArea>
        </Card>


        {/* Chat */}
        <Card className="flex flex-col overflow-hidden rounded-2xl border-border/60">
          {!selected ? (
            <div className="flex-1 flex flex-col items-center justify-center text-center px-8 bg-gradient-to-b from-transparent to-muted/10">
              <Credinho pose="thinking" className="credinho-chat-empty" />
              <h3 className="text-lg font-bold text-foreground mb-1">Sua caixa de conversas</h3>
              <p className="text-sm text-muted-foreground max-w-sm">Selecione uma conversa à esquerda para responder, acionar o bot ou registrar notas internas.</p>
              <div className="flex items-center gap-2 mt-4 text-[11px] text-muted-foreground">
                <kbd className="px-1.5 py-0.5 rounded bg-muted border border-border text-[10px]">↑</kbd>
                <kbd className="px-1.5 py-0.5 rounded bg-muted border border-border text-[10px]">↓</kbd>
                <span>navegar</span>
                <span className="mx-1">•</span>
                <kbd className="px-1.5 py-0.5 rounded bg-muted border border-border text-[10px]">Ctrl+P</kbd>
                <span>pausar bot</span>
              </div>
            </div>
          ) : (
            <>
              {/* Header */}
              {(() => {
                const hname = selected.contact_name || selected.phone;
                const hinitials = hname.split(/\s+/).filter(Boolean).slice(0, 2).map((s) => s[0]?.toUpperCase() || "").join("") || "?";
                const inHandoff = selected.bot_status === "handoff";
                const botOn = !selected.bot_paused && !inHandoff && !selected.blocked;
                return (
              <div className="p-3 border-b border-border/60 flex items-center justify-between gap-2 bg-gradient-to-r from-card via-card to-emerald-500/5">
                <div className="min-w-0 flex-1 flex items-center gap-3">
                  <div className={`w-11 h-11 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${
                    inHandoff || selected.needs_human ? "bg-destructive/20 text-destructive border border-destructive/30"
                    : "bg-gradient-to-br from-emerald-500/20 to-emerald-500/5 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20"
                  }`}>{hinitials}</div>
                  <div className="min-w-0 flex-1">
                    <h3 className="font-bold text-foreground truncate leading-tight">{hname}</h3>
                    <div className="flex items-center gap-2 text-[11px] flex-wrap mt-0.5">
                      <span className="text-muted-foreground">{selected.phone}</span>
                      <span className="text-border">•</span>
                      {inHandoff ? (
                        <span className="text-destructive font-semibold flex items-center gap-1">
                          <span className="w-1.5 h-1.5 rounded-full bg-destructive animate-pulse" />
                          Aguardando atendente{selected.human_takeover_reason ? ` — ${selected.human_takeover_reason}` : ""}
                        </span>
                      ) : selected.needs_human ? (
                        <span className="text-destructive font-semibold flex items-center gap-1">
                          <AlertTriangle className="h-2.5 w-2.5" /> Precisa de atenção
                        </span>
                      ) : botOn ? (
                        <span className="text-primary font-semibold flex items-center gap-1">
                          <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
                          Bot ativo
                        </span>
                      ) : selected.blocked ? (
                        <span className="text-muted-foreground font-semibold flex items-center gap-1">
                          <Ban className="h-2.5 w-2.5" /> Bloqueado
                        </span>
                      ) : (
                        <span className="text-amber-600 dark:text-amber-400 font-semibold">Bot pausado</span>
                      )}
                      {(selected.tags || []).map(t => (
                        <span key={t} className="inline-flex items-center gap-1 bg-primary/10 text-primary px-1.5 py-0.5 rounded-full font-medium">
                          #{t}
                          <button onClick={() => removeTag(t)} className="hover:text-destructive"><X className="h-2.5 w-2.5" /></button>
                        </span>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-1.5">
                  <Button size="sm" variant={selected.bot_status === "handoff" ? "destructive" : (selected.bot_paused ? "default" : "outline")}
                    onClick={toggleBot} className="gap-1.5 h-8" title="Ctrl+P">
                    {selected.bot_status === "handoff"
                      ? (<><Play className="h-3.5 w-3.5" />Reassumir bot</>)
                      : selected.bot_paused
                        ? (<><Play className="h-3.5 w-3.5" />Reativar</>)
                        : (<><Pause className="h-3.5 w-3.5" />Pausar</>)}
                  </Button>
                  <Button size="sm" variant="outline" className="h-8 w-8 p-0" title="Ações do bot" onClick={openBotActions}>
                    <Activity className="h-4 w-4" />
                  </Button>
                  <Popover open={tagsOpen} onOpenChange={setTagsOpen}>
                    <PopoverTrigger asChild>
                      <Button size="sm" variant="outline" className="h-8 w-8 p-0" title="Tags">
                        <TagIcon className="h-4 w-4" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-64 p-3 space-y-2">
                      <p className="text-xs font-medium">Etiquetas</p>
                      <div className="flex flex-wrap gap-1">
                        {(selected.tags || []).map(t => (
                          <span key={t} className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full inline-flex items-center gap-1">
                            #{t}
                            <button onClick={() => removeTag(t)}><X className="h-3 w-3" /></button>
                          </span>
                        ))}
                        {!(selected.tags?.length) && <span className="text-xs text-muted-foreground">Sem etiquetas</span>}
                      </div>
                      <div className="flex gap-1">
                        <Input value={newTag} onChange={(e) => setNewTag(e.target.value)}
                          onKeyDown={(e) => e.key === "Enter" && addTag()}
                          placeholder="Nova etiqueta" className="h-8 text-xs" />
                        <Button size="sm" className="h-8" onClick={() => addTag()}>+</Button>
                      </div>
                      <div className="flex gap-1 flex-wrap pt-1">
                        {["VIP", "Inadimplente", "Negociação", "Quitado"].map(t => (
                          <button key={t} onClick={() => addTag(t)}
                            className="text-[10px] px-2 py-0.5 rounded-full border hover:bg-muted">+ {t}</button>
                        ))}
                      </div>
                    </PopoverContent>
                  </Popover>
                  <Button size="sm" variant="outline" className="h-8 w-8 p-0 relative"
                    onClick={() => setNotesOpen(true)} title="Notas internas">
                    <StickyNote className="h-4 w-4" />
                    {notes.length > 0 && (
                      <span className="absolute -top-1 -right-1 bg-primary text-primary-foreground text-[9px] rounded-full h-4 min-w-4 px-1 flex items-center justify-center">{notes.length}</span>
                    )}
                  </Button>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button size="sm" variant="outline" className="h-8 w-8 p-0"><MoreVertical className="h-4 w-4" /></Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-56">
                      <DropdownMenuLabel>Ações</DropdownMenuLabel>
                      {selected.needs_human && (
                        <DropdownMenuItem onClick={() => quickAction("mark_resolved", "Resolvido")}>
                          <CheckCircle2 className="h-4 w-4 mr-2" />Marcar como resolvido <span className="ml-auto text-[10px] opacity-60">Ctrl+R</span>
                        </DropdownMenuItem>
                      )}
                      <DropdownMenuItem onClick={() => setScheduleOpen(true)}>
                        <Clock className="h-4 w-4 mr-2" />Agendar mensagem
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={exportConversation}>
                        <Download className="h-4 w-4 mr-2" />Exportar conversa
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onClick={toggleBlock}>
                        <Ban className="h-4 w-4 mr-2" />
                        {selected.blocked ? "Desbloquear" : "Bloquear contato"}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>
                );
              })()}



              {/* Mensagens */}
              <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-2 bg-muted/10">
                {loadingMsgs && (
                  <div className="flex justify-center py-4"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>
                )}
                {messages.map((m) => {
                  const isOut = m.direction === "out";
                  const isFollowup = m.metadata?.followup;
                  const isScheduled = m.metadata?.scheduled;
                  return (
                    <div key={m.id} className={`flex ${isOut ? "justify-end" : "justify-start"}`}>
                      <div className={`max-w-[70%] rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap break-words ${
                        isOut
                          ? m.sender === "bot" ? "bg-primary/15 text-foreground" : "bg-primary text-primary-foreground"
                          : "bg-card border border-border"}`}>
                        {isOut && (
                          <div className="flex items-center gap-1 text-[10px] opacity-70 mb-0.5">
                            {m.sender === "bot"
                              ? (<><CredinhoAvatar size={20} /> Bot IA{isFollowup && " • follow-up"}</>)
                              : (<><User className="h-3 w-3" /> Você{isScheduled && " • agendada"}</>)}
                          </div>
                        )}
                        {m.media_url && m.message_type === "image" && (
                          <img src={m.media_url} alt="" className="rounded mb-1 max-h-60" />
                        )}
                        {m.media_url && m.message_type !== "image" && (
                          <a href={m.media_url} target="_blank" rel="noreferrer" className="text-xs underline mb-1 block">
                            📎 {m.message_type}
                          </a>
                        )}
                        <div>{m.content || <em className="opacity-60">[{m.message_type}]</em>}</div>
                        <div className="text-[9px] opacity-60 mt-0.5 text-right">
                          {safeTime(m.created_at)}
                        </div>
                      </div>
                    </div>
                  );
                })}
                {messages.length === 0 && !loadingMsgs && (
                  <div className="text-center text-xs text-muted-foreground py-8">Sem mensagens</div>
                )}
              </div>


              {/* Quick actions */}
              <div className="px-3 pt-2 flex gap-1.5 flex-wrap border-t border-border">
                <Button size="sm" variant="outline" className="h-7 text-xs gap-1"
                  onClick={() => quickAction("send_pix", "PIX enviado")}>
                  <Wallet className="h-3 w-3" />PIX
                </Button>
                <Button size="sm" variant="outline" className="h-7 text-xs gap-1"
                  onClick={() => quickAction("send_receipt_request", "Pedido enviado")}>
                  <FileText className="h-3 w-3" />Comprovante
                </Button>
                <Button size="sm" variant="outline" className="h-7 text-xs gap-1"
                  onClick={() => setScheduleOpen(true)}>
                  <Clock className="h-3 w-3" />Agendar
                </Button>
                {templates.length > 0 && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button size="sm" variant="outline" className="h-7 text-xs gap-1">
                        <FileText className="h-3 w-3" />Templates
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start" className="max-w-xs">
                      <DropdownMenuLabel>Inserir template</DropdownMenuLabel>
                      <DropdownMenuSeparator />
                      {templates.map(t => (
                        <DropdownMenuItem key={t.id} onClick={() => inserirTemplate(t)} className="flex-col items-start">
                          <span className="font-medium">{t.name}</span>
                          <span className="text-[10px] text-muted-foreground line-clamp-1">{t.content}</span>
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </div>

              {/* Composer */}
              <div className="p-3 border-t border-border flex gap-2">
                <input ref={fileInputRef} type="file" className="hidden"
                  accept="image/*,application/pdf,audio/*"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) onFileSelected(f); e.target.value = ""; }} />
                <Button size="icon" variant="outline" className="self-end h-10 w-10"
                  disabled={selected.blocked || sending} onClick={() => fileInputRef.current?.click()}>
                  <Paperclip className="h-4 w-4" />
                </Button>
                <VoiceRecorder
                  className="self-end h-10 w-10"
                  onTranscribed={(t) => setDraft((d) => (d ? d + " " : "") + t)}
                  title="Ditar mensagem"
                />
                <Textarea value={draft} onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey && !e.ctrlKey) { e.preventDefault(); send(); }
                  }}
                  placeholder={selected.blocked ? "Contato bloqueado" : "Digite (Enter envia, Shift+Enter nova linha, Ctrl+Enter envia)..."}
                  rows={2} className="resize-none bg-primary/10 border-primary/30 focus-visible:border-primary/60 focus-visible:ring-2 focus-visible:ring-primary/30" disabled={selected.blocked} />
                <Button onClick={send} disabled={sending || !draft.trim() || selected.blocked} className="self-end">
                  {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                </Button>
              </div>
            </>
          )}
        </Card>
      </div>

      {/* Modal Notas */}
      <Dialog open={notesOpen} onOpenChange={setNotesOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Notas internas</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="flex gap-2">
              <Textarea value={newNote} onChange={(e) => setNewNote(e.target.value)}
                placeholder="Anotação privada (não enviada ao cliente)..." rows={3} />
              <VoiceRecorder
                className="self-start"
                onTranscribed={(t) => setNewNote((n) => (n ? n + " " : "") + t)}
                title="Ditar nota"
              />
            </div>
            <Button size="sm" onClick={addNote} disabled={!newNote.trim()}>Adicionar nota</Button>
            <div className="max-h-72 overflow-y-auto space-y-2 pt-2 border-t">
              {notes.length === 0 && <p className="text-xs text-muted-foreground text-center py-4">Sem notas ainda</p>}
              {notes.map(n => (
                <div key={n.id} className="text-xs p-2 bg-muted/40 rounded">
                  <p className="whitespace-pre-wrap">{n.content}</p>
                  <p className="text-[10px] text-muted-foreground mt-1">
                    {safeDateTime(n.created_at)}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Modal Agendar */}
      <Dialog open={scheduleOpen} onOpenChange={setScheduleOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Agendar mensagem</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <Textarea value={scheduleText} onChange={(e) => setScheduleText(e.target.value)}
              placeholder="Mensagem..." rows={3} />
            <div className="grid grid-cols-2 gap-2">
              <Input type="date" value={scheduleDate} onChange={(e) => setScheduleDate(e.target.value)} min={todayLocalISO()} />
              <Input type="time" value={scheduleTime} onChange={(e) => setScheduleTime(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setScheduleOpen(false)}>Cancelar</Button>
            <Button onClick={scheduleSend} disabled={!scheduleText.trim() || !scheduleDate || !scheduleTime || sending}>
              <Clock className="h-4 w-4 mr-1" />Agendar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Modal Métricas avançadas */}
      <Dialog open={metricsOpen} onOpenChange={setMetricsOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>Métricas avançadas (7 dias)</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div>
              <p className="text-sm font-medium mb-2">Mensagens recebidas por hora do dia</p>
              <div className="flex items-end gap-1 h-40">
                {hourlyStats.map(h => (
                  <div key={h.hour} className="flex-1 flex flex-col items-center gap-1">
                    <div className="w-full bg-primary/70 rounded-t transition-all hover:bg-primary"
                      style={{ height: `${(h.count / maxHourly) * 100}%`, minHeight: h.count ? "4px" : "2px" }}
                      title={`${h.count} msgs`} />
                    <span className="text-[8px] text-muted-foreground">{h.hour}h</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3 text-center">
              <div className="p-3 bg-muted/40 rounded">
                <p className="text-[10px] uppercase text-muted-foreground">Total recebidas</p>
                <p className="text-2xl font-bold">{hourlyStats.reduce((s, h) => s + h.count, 0)}</p>
              </div>
              <div className="p-3 bg-muted/40 rounded">
                <p className="text-[10px] uppercase text-muted-foreground">Pico de hora</p>
                <p className="text-2xl font-bold">{hourlyStats.findIndex(h => h.count === maxHourly)}h</p>
              </div>
              <div className="p-3 bg-muted/40 rounded">
                <p className="text-[10px] uppercase text-muted-foreground">% resolvidas por bot</p>
                <p className="text-2xl font-bold">
                  {metrics.botReplies7d + metrics.humanReplies7d > 0
                    ? Math.round((metrics.botReplies7d / (metrics.botReplies7d + metrics.humanReplies7d)) * 100)
                    : 0}%
                </p>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={actionsOpen} onOpenChange={setActionsOpen}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Activity className="h-4 w-4" /> Ações do bot</DialogTitle>
          </DialogHeader>
          <ScrollArea className="flex-1 pr-3">
            {actionsLoading ? (
              <div className="text-center py-8 text-sm text-muted-foreground">Carregando…</div>
            ) : botActions.length === 0 ? (
              <div className="text-center py-8 text-sm text-muted-foreground">Nenhuma ação registrada para esta conversa.</div>
            ) : (
              <div className="space-y-2">
                {botActions.map((a) => (
                  <div key={a.id} className="border border-border rounded-lg p-3 text-xs space-y-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <Badge variant={a.success ? "default" : "destructive"} className="text-[10px]">
                          {a.success ? "OK" : "Falhou"}
                        </Badge>
                        <span className="font-mono font-semibold">{a.tool_name}</span>
                      </div>
                      <span className="text-muted-foreground text-[10px]">
                        {safeRelativeTime(a.created_at, true)}
                      </span>
                    </div>
                    {a.tool_input && Object.keys(a.tool_input).length > 0 && (
                      <pre className="bg-muted/40 rounded p-2 overflow-x-auto text-[10px] leading-relaxed">
                        {JSON.stringify(a.tool_input, null, 2)}
                      </pre>
                    )}
                    {a.tool_output && (
                      <pre className="bg-muted/20 rounded p-2 overflow-x-auto text-[10px] leading-relaxed text-muted-foreground">
                        {typeof a.tool_output === "string" ? a.tool_output : JSON.stringify(a.tool_output, null, 2)}
                      </pre>
                    )}
                  </div>
                ))}
              </div>
            )}
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function MetricCard({ label, value, accent }: { label: string; value: number; accent?: "warning" | "primary" }) {
  return (
    <Card className="p-3">
      <p className="text-[11px] text-muted-foreground uppercase tracking-wide">{label}</p>
      <p className={`text-2xl font-bold mt-0.5 ${
        accent === "warning" && value > 0 ? "text-destructive" :
        accent === "primary" ? "text-primary" : ""}`}>{value}</p>
    </Card>
  );
}
