import { Credinho, CredinhoAvatar } from "@/components/brand/Credinho";
import { computeOutstandingPrincipal, isEmAtraso, isEmAberto } from "@/lib/dashboardMetrics";
import { useState, useRef, useEffect, useCallback } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { fetchAll } from "@/lib/fetchAll";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import {
  Send, Bot, User, BarChart3, FileText, Wifi, WifiOff,
  QrCode, RefreshCw, LogOut, MessageSquare, Phone, CheckCircle2,
  Loader2, AlertTriangle, Settings, Inbox, Reply, ChevronLeft,
  ToggleLeft, ToggleRight, Shield, Zap, Clock, Volume2, BellOff,
  Search, Sparkles, Copy, Trash2, Users, DollarSign, TrendingUp, Filter, X,
  Image as ImageIcon, Mic, Video, File as FileIcon, MapPin, Sticker, Check, CheckCheck
} from "lucide-react";
import { formatBR, formatBRDateTime, parseLocalDate, todayLocalISO } from "@/lib/dateUtils";
import { SafeMessageContent } from "@/components/agent/SafeMessageContent";
import { parsePaymentAmount } from '@/lib/paymentInput';
import { useNavigate } from "react-router-dom";

interface Message {
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
}

interface WhatsAppChat {
  id: string;
  name?: string;
  remoteJid: string;
  phone?: string;
  lastMessage?: string;
  lastMessageKind?: "image" | "audio" | "video" | "document" | "sticker" | "location" | "contact" | "text";
  lastMessageFromMe?: boolean;
  updatedAt?: string;
  unreadCount?: number;
  profilePicUrl?: string;
  conversationId?: string;
  needsHuman?: boolean;
  botPaused?: boolean;
  botStatus?: string;
  humanReason?: string | null;
}

interface WhatsAppMessageKey {
  id?: string;
  fromMe?: boolean;
  remoteJid?: string;
  remoteJidAlt?: string;
}

interface WhatsAppMsg {
  id?: string;
  key?: WhatsAppMessageKey;
  message?: Record<string, unknown>;
  messageTimestamp?: number;
  pushName?: string | null;
}

interface EvolutionChatRecord {
  id?: string | null;
  remoteJid?: string | null;
  pushName?: string | null;
  updatedAt?: string | null;
  unreadCount?: number | null;
  lastMessage?: {
    key?: WhatsAppMessageKey;
    message?: Record<string, unknown>;
    pushName?: string | null;
  };
}

type ConnectionStatus = "checking" | "disconnected" | "qr_ready" | "connecting" | "connected" | "error";
type TabType = "chat" | "whatsapp" | "mensagens" | "documentos" | "config" | "metricas" | "relatorios";
type UnknownRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is UnknownRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const extractWhatsAppText = (value: unknown, depth = 0): string => {
  if (depth > 6 || value == null) return "";

  if (typeof value === "string") {
    return value.trim();
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const text = extractWhatsAppText(item, depth + 1);
      if (text) return text;
    }
    return "";
  }

  if (!isRecord(value)) {
    return "";
  }

  const directFields = [
    "conversation",
    "text",
    "caption",
    "contentText",
    "hydratedContentText",
    "displayText",
    "selectedDisplayText",
    "title",
    "description",
  ] as const;

  for (const field of directFields) {
    const candidate = value[field];
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }

  for (const nestedValue of Object.values(value)) {
    const text = extractWhatsAppText(nestedValue, depth + 1);
    if (text) return text;
  }

  return "";
};

const getJidLabel = (jid?: string | null) => (jid ? jid.split("@")[0] : undefined);

const getTimestampValue = (value?: string | number | null) => {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "string" && value) {
    const timestamp = new Date(value).getTime();
    return Number.isFinite(timestamp) ? timestamp : 0;
  }
  return 0;
};

const safeAgentNumber = (value: unknown) => {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
};

const getChatPhone = (chat: EvolutionChatRecord): string | undefined => {
  const candidates = [chat.lastMessage?.key?.remoteJidAlt, chat.remoteJid];

  for (const candidate of candidates) {
    if (!candidate) continue;

    if (candidate.endsWith("@s.whatsapp.net")) {
      const phone = candidate.replace(/\D/g, "");
      if (phone) return phone;
    }

    if (candidate.endsWith("@g.us") || candidate.endsWith("@lid")) {
      return candidate;
    }

    const phone = candidate.replace(/\D/g, "");
    if (phone) return phone;

    return candidate;
  }

  return undefined;
};

const getChatDisplayName = (chat: EvolutionChatRecord) =>
  chat.pushName?.trim() ||
  chat.lastMessage?.pushName?.trim() ||
  getJidLabel(chat.lastMessage?.key?.remoteJidAlt) ||
  getJidLabel(chat.remoteJid) ||
  "Conversa sem nome";

const getEvolutionInstancePayload = (payload: unknown): UnknownRecord | null => {
  if (Array.isArray(payload)) {
    return (payload.find(isRecord) as UnknownRecord | undefined) ?? null;
  }

  if (!isRecord(payload)) {
    return null;
  }

  if (isRecord(payload.instance)) {
    return payload.instance;
  }

  // Edge function wraps array responses as { data: [...], chats: [...], messages: [...] }
  if (Array.isArray(payload.data)) {
    const fromData = (payload.data as unknown[]).find(isRecord) as UnknownRecord | undefined;
    if (fromData) return fromData;
  }

  const indexedInstance = Object.entries(payload).find(
    ([key, value]) => /^\d+$/.test(key) && isRecord(value)
  );

  return indexedInstance ? (indexedInstance[1] as UnknownRecord) : payload;
};

const isEvolutionInstanceConnected = (payload: unknown) => {
  const instance = getEvolutionInstancePayload(payload);
  const rootStatus = isRecord(payload) ? payload.status : undefined;
  const statuses = [instance?.status, instance?.connectionStatus, instance?.state, rootStatus];

  return statuses.some((status) => status === "open" || status === "connected");
};

/**
 * Rola ATE O FIM a lista que contem o elemento, e nada mais.
 *
 * Antes os dois efeitos de conversa chamavam `scrollIntoView` no marcador do
 * fim da lista. Como a lista fica na parte de baixo de uma pagina longa, quem
 * rolava era a JANELA: abrir o Agente de IA no celular jogava a pessoa 607px
 * para baixo, com o cabecalho e as abas fora da tela. E a conversa ja nasce com
 * a mensagem de boas-vindas, entao acontecia sempre.
 */
const rolarListaAteOFim = (ref: React.RefObject<HTMLDivElement>) => {
  let el: HTMLElement | null = ref.current?.parentElement ?? null;
  while (el) {
    const overflow = getComputedStyle(el).overflowY;
    if ((overflow === "auto" || overflow === "scroll") && el.scrollHeight > el.clientHeight) {
      // Mexer no `scrollTop` de um container faz o navegador reposicionar a
      // janela junto (ancoragem de rolagem). Guardamos onde a pagina estava e
      // devolvemos na mesma hora: a lista anda, a pagina fica parada.
      const paginaX = window.scrollX;
      const paginaY = window.scrollY;
      el.scrollTop = el.scrollHeight;
      if (window.scrollX !== paginaX || window.scrollY !== paginaY) {
        window.scrollTo(paginaX, paginaY);
      }
      return;
    }
    el = el.parentElement;
  }
};

const AgenteIA = ({embedded=false,view='chat'}:{embedded?:boolean;view?:'chat'|'documentos'} = {}) => {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [tab, setTab] = useState<TabType>(view);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Message[]>([
    { role: "assistant", content: "Olá! Sou o assistente IA do CredMais App. Como posso ajudar?", timestamp: new Date() },
  ]);
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // WhatsApp state
  const [whatsappStatus, setWhatsappStatus] = useState<ConnectionStatus>("disconnected");
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [instanceName, setInstanceName] = useState<string>("");
  const [pollingQr, setPollingQr] = useState(false);
  const qrIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Messages state
  const [whatsappChats, setWhatsappChats] = useState<WhatsAppChat[]>([]);
  const [selectedChat, setSelectedChat] = useState<WhatsAppChat | null>(null);
  const [chatMessages, setChatMessages] = useState<WhatsAppMsg[]>([]);
  const [replyInput, setReplyInput] = useState("");
  const [loadingChats, setLoadingChats] = useState(false);
  const [loadingMsgs, setLoadingMsgs] = useState(false);
  const [sendingReply, setSendingReply] = useState(false);
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const chatInputRef = useRef<HTMLInputElement>(null);
  const [chatSearch, setChatSearch] = useState("");
  const [chatFilter, setChatFilter] = useState<"all" | "human" | "unread" | "users" | "groups">("all");

  // AI Assist State
  const [aiAssist, setAiAssist] = useState<{ summary?: string; intent?: string; suggestions: string[] }>({ suggestions: [] });
  const [loadingAi, setLoadingAi] = useState(false);

  // Fetch AI assist data
  const loadAiAssist = async (convoId: string) => {
    setLoadingAi(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      const [resSummary, resSuggest] = await Promise.all([
        fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/whatsapp-ai-assist`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
          body: JSON.stringify({ conversation_id: convoId, mode: "summarize" }),
        }).then(r => r.json()),
        fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/whatsapp-ai-assist`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
          body: JSON.stringify({ conversation_id: convoId, mode: "suggest" }),
        }).then(r => r.json())
      ]);

      setAiAssist({
        summary: resSummary?.summary || "",
        intent: resSummary?.next_action || "",
        suggestions: resSuggest?.suggestions || []
      });
    } catch (err) {
      console.error("Erro AI Assist:", err);
    } finally {
      setLoadingAi(false);
    }
  };

  // Agent config state
  const [agentConfig, setAgentConfig] = useState({
    chatbotEnabled: true,
    autoCollections: true,
    autoReply: true,
    sendPix: true,
    notifyOwner: true,
    maxMessagesPerDay: 50,
    workHourStart: 8,
    workHourEnd: 20,
    tone: "formal" as "formal" | "casual" | "firme",
    useAi: false,
  });

  const { data: settings } = useQuery({
    queryKey: ["settings-agent", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("settings_safe")
        .select("bot_enabled, bot_auto_send, bot_send_pix, bot_notify_owner, bot_max_messages_per_day, bot_send_hour, bot_send_minute, bot_tone, whatsapp_instance, bot_use_ai")
        .eq("user_id", user!.id)
        .single();
      if(error)throw error;
      return data;
    },
    enabled: !!user,
  });

  // Sync config from DB
  useEffect(() => {
    if (settings) {
      setAgentConfig((prev) => ({
        ...prev,
        chatbotEnabled: settings.bot_enabled ?? true,
        autoCollections: settings.bot_auto_send ?? true,
        sendPix: settings.bot_send_pix ?? true,
        notifyOwner: settings.bot_notify_owner ?? true,
        maxMessagesPerDay: settings.bot_max_messages_per_day ?? 50,
        workHourStart: settings.bot_send_hour ?? 8,
        tone: (settings.bot_tone as any) ?? "formal",
        useAi: settings.bot_use_ai ?? false,
      }));
    }
  }, [settings]);

  const { data: dashData } = useQuery({
    queryKey: ["agent-context", user?.id],
    queryFn: async () => {
      const [contracts, installments, clients, profits] = await Promise.all([
        fetchAll((f, t) => supabase.from("contracts").select("*, clients(name)").eq("user_id", user!.id).range(f, t)),
        fetchAll((f, t) => supabase.from("contract_installments").select("*").eq("user_id", user!.id).range(f, t)),
        fetchAll((f, t) => supabase.from("clients").select("id, name, credit_score, status, phone, whatsapp").eq("user_id", user!.id).range(f, t)),
        fetchAll((f, t) => supabase.from("profits").select("amount,date").eq("user_id", user!.id).range(f, t)),
      ]);
      return { contracts, installments, clients, profits };
    },
    enabled: !!user,
  });

  const { data: reviewCenter, refetch: refetchReviewCenter, isLoading: loadingReviewCenter } = useQuery({
    queryKey: ["agent-review-center", user?.id],
    queryFn: async () => {
      const [{ data: leads, error: leadsError }, { data: receipts, error: receiptsError }] = await Promise.all([
        supabase.from("leads").select("id,name,phone,cpf,email,score,stage,notes,converted_client_id,updated_at").eq("user_id", user!.id).order("updated_at", { ascending: false }).limit(200),
        (supabase as any).from("whatsapp_receipt_reviews").select("*,clients(name),contract_installments(installment_number,due_date,amount,paid_amount)").eq("user_id", user!.id).order("created_at", { ascending: false }).limit(200),
      ]);
      if (leadsError) throw leadsError;
      if (receiptsError) throw receiptsError;
      const documentLeads = (leads || []).filter((lead: any) => {
        const docs = lead?.notes?.docs;
        return docs && Array.isArray(docs.validations) && docs.validations.length > 0;
      });
      return { leads: documentLeads as any[], receipts: (receipts || []) as any[] };
    },
    enabled: !!user,
    refetchInterval: tab === "documentos" ? 15_000 : false,
  });

  const { data: agentHealth } = useQuery({
    queryKey: ["agent-health", user?.id],
    queryFn: async () => {
      const since = new Date(Date.now() - 86_400_000).toISOString();
      const [handoffs, pendingReceipts, botFailures, collectionFailures, lastAction] = await Promise.all([
        supabase.from("whatsapp_conversations").select("id", { count: "exact", head: true }).eq("user_id", user!.id).eq("needs_human", true),
        (supabase as any).from("whatsapp_receipt_reviews").select("id", { count: "exact", head: true }).eq("user_id", user!.id).eq("status", "pending"),
        (supabase as any).from("bot_actions_log").select("id", { count: "exact", head: true }).eq("user_id", user!.id).eq("success", false).gte("created_at", since),
        supabase.from("audit_logs").select("id", { count: "exact", head: true }).eq("user_id", user!.id).eq("entity_type", "auto_collection").eq("action", "message_failed").gte("created_at", since),
        (supabase as any).from("bot_actions_log").select("created_at").eq("user_id", user!.id).order("created_at", { ascending: false }).limit(1).maybeSingle(),
      ]);
      return { handoffs: handoffs.count || 0, pendingReceipts: pendingReceipts.count || 0, failures24h: (botFailures.count || 0) + (collectionFailures.count || 0), lastActionAt: lastAction.data?.created_at || null };
    },
    enabled: !!user,
    refetchInterval: 30_000,
  });

  const [receiptAmounts, setReceiptAmounts] = useState<Record<string,string>>({});
  const [receiptDates,setReceiptDates]=useState<Record<string,string>>({});
  const approveReceipt = async (reviewId: string) => {
    const item=(reviewCenter?.receipts || []).find((row:any)=>row.id===reviewId);
    const amount=parsePaymentAmount(receiptAmounts[reviewId] ?? String(item?.amount || ''));
    if(amount==null || amount<=0){toast({title:"Informe um valor recebido válido",description:'Use, por exemplo, 1.234,56.',variant:"destructive"});return;}
    const nextDue=item?.metadata?.payment_kind==='interest_only'?receiptDates[reviewId]:null;
    if(item?.metadata?.payment_kind==='interest_only'&&!nextDue){toast({title:'Informe o novo vencimento da renovação.',variant:'destructive'});return;}
    const { error } = await (supabase as any).rpc("confirm_whatsapp_receipt", { _review_id: reviewId, _received_amount:amount,_next_due_date:nextDue });
    if (error) {
      toast({ title: "Não foi possível aprovar", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Comprovante aprovado e pagamento registrado" });
    await refetchReviewCenter();
    queryClient.invalidateQueries({ queryKey: ["agent-context", user?.id] });
  };

  const rejectReceipt = async (reviewId: string) => {
    const { error } = await (supabase as any).from("whatsapp_receipt_reviews").update({
      status: "rejected", reviewed_at: new Date().toISOString(), reviewed_by: user!.id,
    }).eq("id", reviewId).eq("user_id", user!.id).eq("status", "pending");
    if (error) {
      toast({ title: "Não foi possível rejeitar", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Comprovante rejeitado" });
    await refetchReviewCenter();
  };

  const convertLeadToClient = async (lead: any) => {
    const missing = Array.isArray(lead?.notes?.docs?.missing) ? lead.notes.docs.missing : [];
    if (missing.length > 0) {
      toast({ title: "Documentação incompleta", description: `Ainda faltam: ${missing.join(", ")}.`, variant: "destructive" });
      return;
    }
    const { data, error } = await (supabase as any).rpc("convert_whatsapp_lead_to_client", { _lead_id: lead.id });
    if (error) {
      toast({ title: "Não foi possível criar a ficha", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: data?.already_converted ? "Ficha já vinculada" : "Ficha do cliente criada", description: "Os dados e documentos da solicitação foram aproveitados." });
    await refetchReviewCenter();
    queryClient.invalidateQueries({ queryKey: ["agent-context", user?.id] });
  };

  const reviewDocument = async (lead: any, validationIndex: number, approved: boolean) => {
    const notes = { ...(lead.notes || {}) };
    const docs = { ...(notes.docs || {}) };
    const validations = [...(docs.validations || [])];
    const validation = { ...validations[validationIndex], decision: approved ? "accepted" : "resend", manually_reviewed_at: new Date().toISOString(), manually_reviewed_by: user!.id };
    validations[validationIndex] = validation;
    const received = new Set<string>(Array.isArray(docs.received) ? docs.received : []);
    if (approved) received.add(validation.document_type); else received.delete(validation.document_type);
    const missing = (Array.isArray(docs.missing) ? docs.missing : []).filter((type: string) => !received.has(type));
    if (!approved && validation.document_type && !missing.includes(validation.document_type)) missing.push(validation.document_type);
    const nextNotes = { ...notes, docs: { ...docs, validations, received: [...received], missing } };
    const { error } = await supabase.from("leads").update({ notes: nextNotes }).eq("id", lead.id).eq("user_id", user!.id);
    if (error) {
      toast({ title: "Não foi possível revisar o documento", description: error.message, variant: "destructive" });
      return;
    }
    if (!approved) {
      const { data: conversations } = await supabase.from("whatsapp_conversations")
        .select("id,phone").eq("user_id", user!.id).limit(200);
      const targetPhone = String(lead.phone || "").replace(/\D/g, "");
      const conversation = (conversations || []).find((item: any) => String(item.phone || "").replace(/\D/g, "") === targetPhone);
      if (conversation?.id) {
        const label = validation.label || validation.document_type || "documento";
        const reason = Array.isArray(validation.reasons) && validation.reasons.length > 0
          ? ` Motivo: ${validation.reasons.join("; ")}.`
          : " O arquivo não pôde ser validado com segurança.";
        const { error: sendError } = await supabase.functions.invoke("whatsapp-send", {
          body: { conversation_id: conversation.id, text: `Precisamos que você envie novamente o documento: ${label}.${reason} Envie uma foto ou PDF nítido, completo e sem cortes.` },
        });
        if (sendError) {
          toast({ title: "Revisão salva, mas a mensagem não foi enviada", description: sendError.message, variant: "destructive" });
        }
      } else {
        await supabase.from("notifications").insert({ user_id: user!.id, type: "warning", message: `Documento de ${lead.name || lead.phone} marcado para reenvio, mas não há conversa vinculada.` });
      }
    }
    toast({ title: approved ? "Documento aprovado" : "Reenvio solicitado ao cliente" });
    await refetchReviewCenter();
  };

  const openStoredDocument = async (path?: string | null) => {
    if (!path) return;
    const { data, error } = await supabase.storage.from("uploads").createSignedUrl(path, 300);
    if (error || !data?.signedUrl) {
      toast({ title: "Não foi possível abrir o arquivo", description: error?.message, variant: "destructive" });
      return;
    }
    window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  };

  const callEvolutionApi = useCallback(async (actionName: string, extra: Record<string, any> = {}) => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) throw new Error("Sem sessão");
    const resp = await fetch(
      `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/evolution-api`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ action: actionName, ...extra }),
      }
    );
    const data = await resp.json();
    if (!resp.ok) {
      throw new Error(data?.error || data?.details || "Falha ao comunicar com o WhatsApp");
    }
    return data;
  }, []);

  const webhookConfiguredRef = useRef<string | null>(null);
  const configureWebhook = useCallback(async (targetInstanceName: string) => {
    if (!targetInstanceName || webhookConfiguredRef.current === targetInstanceName) return;
    webhookConfiguredRef.current = targetInstanceName;
    try {
      const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/whatsapp-webhook`;
      await callEvolutionApi("setWebhook", { instanceName: targetInstanceName, data: { url } });
    } catch (err) {
      console.error("[AgenteIA] Falha ao configurar webhook:", err);
      webhookConfiguredRef.current = null;
    }
  }, [callEvolutionApi]);

  // Check WhatsApp status
  useEffect(() => {
    if (embedded || settings === undefined) return;
    checkStatus();
  }, [settings,embedded]);

  const checkStatus = async () => {
    setWhatsappStatus("checking");
    try {
      const instance = settings?.whatsapp_instance || `instancia-${user?.id.split("-")[0]}`;
      const data = await callEvolutionApi("check_status", { instanceName: instance });
      setInstanceName(instance);

      if (isEvolutionInstanceConnected(data)) {
        setWhatsappStatus("connected");
        setQrCode(null);
        stopPolling();
        configureWebhook(instance);
      } else {
        setWhatsappStatus("disconnected");
      }
    } catch {
      setWhatsappStatus("disconnected");
    }
  };

  const createInstance = async () => {
    setWhatsappStatus("connecting");
    try {
      const previousInstance = settings?.whatsapp_instance;
      if (previousInstance) {
        await callEvolutionApi("deleteInstance", { instanceName: previousInstance });
      }
      const nextInstanceName = `instancia-${user!.id.split("-")[0]}-${Date.now().toString(36)}`;

      // Registra a instância no tenant antes de pedir sua criação. A função Edge
      // usa esse vínculo para impedir que um usuário opere a instância de outro.
      const { error } = await supabase
        .from("settings")
        .update({ whatsapp_instance: nextInstanceName })
        .eq("user_id", user!.id);
      if (error) throw error;
      queryClient.setQueryData(["settings-agent", user?.id], (current: any) => ({
        ...(current || {}),
        whatsapp_instance: nextInstanceName,
      }));

      const data = await callEvolutionApi("createInstance", { instanceName: nextInstanceName });
      setInstanceName(nextInstanceName);

      if (isEvolutionInstanceConnected(data)) {
        setWhatsappStatus("connected");
        toast({ title: "WhatsApp conectado!" });
        configureWebhook(nextInstanceName);
        return;
      }
      await fetchQr(nextInstanceName);
    } catch (err: any) {
      setWhatsappStatus("error");
      toast({ title: "Erro", description: err.message, variant: "destructive" });
    }
  };

  const fetchQr = async (targetInstanceName = instanceName) => {
    try {
      if (!targetInstanceName) {
        setWhatsappStatus("disconnected");
        return;
      }

      const data = await callEvolutionApi("get_qr", { instanceName: targetInstanceName });
      const qr = data?.base64 || data?.qrcode?.base64 || data?.qrcode?.code || data?.code;
      if (isEvolutionInstanceConnected(data)) {
        setWhatsappStatus("connected");
        setQrCode(null);
        stopPolling();
        configureWebhook(targetInstanceName);
        return;
      }
      if (qr) {
        const src = qr.startsWith("data:") ? qr : `data:image/png;base64,${qr.replace(/^data:image\/[a-z]+;base64,/, "")}`;
        setQrCode(src);
        setWhatsappStatus("qr_ready");
        startPolling(targetInstanceName);
      } else {
        setTimeout(() => fetchQr(targetInstanceName), 3000);
      }
    } catch {
      setWhatsappStatus("error");
    }
  };

  const startPolling = (targetInstanceName = instanceName) => {
    if (qrIntervalRef.current) return;
    setPollingQr(true);
    qrIntervalRef.current = setInterval(async () => {
      try {
        const data = await callEvolutionApi("check_status", { instanceName: targetInstanceName });
        if (isEvolutionInstanceConnected(data)) {
          setWhatsappStatus("connected");
          setQrCode(null);
          stopPolling();
          configureWebhook(targetInstanceName);
          toast({ title: "✅ WhatsApp Conectado!" });
        }
      } catch {}
    }, 5000);
  };

  const stopPolling = () => {
    if (qrIntervalRef.current) {
      clearInterval(qrIntervalRef.current);
      qrIntervalRef.current = null;
    }
    setPollingQr(false);
  };

  useEffect(() => () => stopPolling(), []);

  const handleLogout = async () => {
    try {
      if (!instanceName) return;
      await callEvolutionApi("deleteInstance", { instanceName });
      stopPolling();
      setWhatsappStatus("disconnected");
      setQrCode(null);
      setInstanceName("");
      webhookConfiguredRef.current = null;
      queryClient.setQueryData(["settings-agent", user?.id], (current: any) => ({
        ...(current || {}),
        whatsapp_instance: null,
      }));
      await queryClient.invalidateQueries({ queryKey: ["settings-agent", user?.id] });
      toast({ title: "Desconectado", description: "A instância foi removida. Você pode conectar outro número." });
    } catch (err: any) {
      toast({ title: "Erro", description: err.message, variant: "destructive" });
    }
  };

  // Fetch WhatsApp chats (silent = no loading spinner, used for polling)
  const loadChats = async (silent = false) => {
    if (whatsappStatus !== "connected") return;

    if (!silent) setLoadingChats(true);
    try {
      const data = await callEvolutionApi("find_chats", { instanceName, count: 500 });
      const rawChats: EvolutionChatRecord[] = Array.isArray(data)
        ? (data as EvolutionChatRecord[])
        : Array.isArray(data?.chats)
          ? (data.chats as EvolutionChatRecord[])
          : [];
      const { data: conversationRows } = await supabase
        .from("whatsapp_conversations")
        .select("id,jid,phone,contact_name,last_message_preview,last_message_at,unread_count,needs_human,bot_paused,bot_status,human_takeover_reason")
        .eq("user_id", user!.id)
        .order("last_message_at", { ascending: false })
        .limit(500);
      const normalizeContact = (value?: string | null) => String(value || "").replace(/\D/g, "");
      const conversationsByPhone = new Map<string, any>();
      for (const row of conversationRows || []) {
        const phoneKey = normalizeContact(row.phone || row.jid);
        if (phoneKey) conversationsByPhone.set(phoneKey, row);
      }
      const uniqueChats = new Map<string, WhatsAppChat>();

      rawChats.forEach((chat: any) => {
        const remoteJid = (chat.remoteJid || chat.id || chat.key?.remoteJid)?.trim();
        if (!remoteJid || remoteJid === "status@broadcast") return;
        if (uniqueChats.has(remoteJid)) return;

        const lastMsg = chat.lastMessage?.message as Record<string, unknown> | undefined;
        let lastKind: WhatsAppChat["lastMessageKind"] = "text";
        if (lastMsg) {
          const m = lastMsg as any;
          if (m.imageMessage) lastKind = "image";
          else if (m.audioMessage || m.pttMessage) lastKind = "audio";
          else if (m.videoMessage) lastKind = "video";
          else if (m.documentMessage || m.documentWithCaptionMessage) lastKind = "document";
          else if (m.stickerMessage) lastKind = "sticker";
          else if (m.locationMessage || m.liveLocationMessage) lastKind = "location";
          else if (m.contactMessage || m.contactsArrayMessage) lastKind = "contact";
        }

        const phone = getChatPhone(chat) || remoteJid.split("@")[0];
        const conversation = conversationsByPhone.get(normalizeContact(phone));
        uniqueChats.set(remoteJid, {
          id: remoteJid,
          name: getChatDisplayName(chat) || chat.pushName || chat.name || remoteJid.split("@")[0],
          remoteJid,
          phone,
          lastMessage: extractWhatsAppText(chat.lastMessage?.message) || chat.lastMessage?.text || "",
          lastMessageKind: lastKind,
          lastMessageFromMe: !!chat.lastMessage?.key?.fromMe,
          updatedAt: chat.updatedAt || chat.updated_at || chat.lastMessage?.messageTimestamp || "",
          unreadCount: chat.unreadCount ?? chat.unread_count ?? 0,
          profilePicUrl: chat.profilePicUrl || chat.profilePictureUrl || chat.profilePicture || undefined,
          conversationId: conversation?.id,
          needsHuman: !!conversation?.needs_human,
          botPaused: !!conversation?.bot_paused,
          botStatus: conversation?.bot_status,
          humanReason: conversation?.human_takeover_reason,
        });
      });

      // Mantém a fila humana visível mesmo se a Evolution não devolver a conversa
      // na listagem atual (por exemplo, logo após reconectar uma instância).
      for (const row of conversationRows || []) {
        if (!row.jid || uniqueChats.has(row.jid)) continue;
        uniqueChats.set(row.jid, {
          id: row.jid,
          name: row.contact_name || row.phone || "Contato",
          remoteJid: row.jid,
          phone: row.phone,
          lastMessage: row.last_message_preview || "",
          updatedAt: row.last_message_at,
          unreadCount: row.unread_count || 0,
          conversationId: row.id,
          needsHuman: !!row.needs_human,
          botPaused: !!row.bot_paused,
          botStatus: row.bot_status,
          humanReason: row.human_takeover_reason,
        });
      }

      const chats = Array.from(uniqueChats.values()).sort(
        (a, b) => getTimestampValue(b.updatedAt) - getTimestampValue(a.updatedAt)
      );

      setWhatsappChats(chats);
    } catch (err: unknown) {
      if (!silent) {
        const description = err instanceof Error ? err.message : "Erro ao carregar conversas";
        toast({ title: "Erro ao carregar chats", description, variant: "destructive" });
      }
    } finally {
      if (!silent) setLoadingChats(false);
    }
  };

  // Auto-load chats on tab switch
  // Auto-load chats on tab switch (and re-check status in case user connected elsewhere)
  useEffect(() => {
    if (tab === "mensagens") {
      if (whatsappStatus !== "connected") {
        checkStatus();
      } else {
        loadChats();
      }
    }
  }, [tab, whatsappStatus]);

  // Auto-poll chats list every 10s when on mensagens tab
  const chatsPollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (tab === "mensagens" && whatsappStatus === "connected") {
      chatsPollingRef.current = setInterval(() => loadChats(true), 10000);
    }
    return () => {
      if (chatsPollingRef.current) {
        clearInterval(chatsPollingRef.current);
        chatsPollingRef.current = null;
      }
    };
  }, [tab, whatsappStatus]);

  // Fetch messages for a specific chat (silent = no loading spinner)
  const refreshChatMessages = async (remoteJid: string, silent = false) => {
    if (!silent) setLoadingMsgs(true);
    try {
      const data = await callEvolutionApi("find_messages", { instanceName, remoteJid, count: 200 });
      const rawMsgs: any[] = Array.isArray(data)
        ? data
        : Array.isArray(data?.messages?.records)
          ? data.messages.records
          : Array.isArray(data?.messages)
            ? data.messages
            : [];
      const nextMessages = (rawMsgs as WhatsAppMsg[]).sort(
        (a, b) => getTimestampValue(a.messageTimestamp) - getTimestampValue(b.messageTimestamp)
      );
      setChatMessages(nextMessages);
    } catch (err: unknown) {
      if (!silent) {
        const description = err instanceof Error ? err.message : "Erro ao carregar mensagens";
        toast({ title: "Erro", description, variant: "destructive" });
      }
    } finally {
      if (!silent) setLoadingMsgs(false);
    }
  };

  const openChat = async (chat: WhatsAppChat) => {
    setSelectedChat(chat);
    setReplyInput("");
    setAiAssist({ suggestions: [] });

    const { data: convo } = chat.conversationId ? { data: { id: chat.conversationId } } : await supabase
      .from("whatsapp_conversations")
      .select("id")
      .eq("user_id", user?.id)
      .eq("phone", chat.phone)
      .maybeSingle();

    if (convo) {
      loadAiAssist(convo.id);
    }

    await refreshChatMessages(chat.remoteJid);
  };

  const setConversationMode = async (chat: WhatsAppChat, human: boolean) => {
    const conversationId = chat.conversationId;
    if (!conversationId) {
      toast({ title: "Conversa ainda não sincronizada", variant: "destructive" });
      return false;
    }
    const patch = human
      ? {
          needs_human: false, bot_paused: true, bot_status: "human",
          human_takeover_at: new Date().toISOString(),
        }
      : {
          needs_human: false, bot_paused: false, bot_status: "active",
          human_takeover_reason: null,
        };
    const { error } = await supabase
      .from("whatsapp_conversations")
      .update(patch)
      .eq("id", conversationId)
      .eq("user_id", user!.id);
    if (error) {
      toast({ title: "Não foi possível atualizar o atendimento", description: error.message, variant: "destructive" });
      return false;
    }
    const updated = { ...chat, needsHuman: false, botPaused: human, botStatus: human ? "human" : "active", humanReason: human ? chat.humanReason : null };
    setSelectedChat(updated);
    setWhatsappChats((current) => current.map((item) => item.id === chat.id ? updated : item));
    toast({ title: human ? "Conversa assumida" : "Conversa devolvida ao agente" });
    return true;
  };

  // Auto-poll messages every 5s when a chat is open
  const msgsPollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (selectedChat && tab === "mensagens" && whatsappStatus === "connected") {
      msgsPollingRef.current = setInterval(
        () => refreshChatMessages(selectedChat.remoteJid, true),
        5000
      );
    }
    return () => {
      if (msgsPollingRef.current) {
        clearInterval(msgsPollingRef.current);
        msgsPollingRef.current = null;
      }
    };
  }, [selectedChat, tab, whatsappStatus]);

  useEffect(() => {
    // Sem `block: "nearest"` isto rolava a PÁGINA inteira, não só a lista — e
    // rodava também na montagem, com a conversa ainda vazia: quem abria a tela
    // caía 600px abaixo do cabeçalho, sem entender o que tinha acontecido.
    if (!chatMessages?.length) return;
    rolarListaAteOFim(chatScrollRef);
  }, [chatMessages]);

  const sendReply = async () => {
    if (!replyInput.trim() || !selectedChat || sendingReply) return;
    setSendingReply(true);
    try {
      const messageText = replyInput.trim();
      if (!selectedChat.botPaused && !(await setConversationMode(selectedChat, true))) return;
      await callEvolutionApi("send_message", {
        instanceName,
        phone: selectedChat.phone || selectedChat.remoteJid,
        message: messageText,
      });
      if (selectedChat.conversationId) {
        await supabase.from("whatsapp_messages").insert({
          conversation_id: selectedChat.conversationId,
          user_id: user!.id,
          direction: "out",
          sender: "human",
          message_type: "text",
          content: messageText,
        });
        await supabase.from("whatsapp_conversations").update({
          last_message_at: new Date().toISOString(),
          last_message_preview: messageText.slice(0, 200),
          last_message_from: "human",
          unread_count: 0,
        }).eq("id", selectedChat.conversationId).eq("user_id", user!.id);
      }
      setChatMessages((prev) => [
        ...prev,
        {
          key: { id: Date.now().toString(), fromMe: true, remoteJid: selectedChat.remoteJid },
          message: { conversation: messageText },
          messageTimestamp: Math.floor(Date.now() / 1000),
        },
      ]);
      setReplyInput("");
      toast({ title: "Mensagem enviada!" });
    } catch (err: unknown) {
      const description = err instanceof Error ? err.message : "Erro ao enviar mensagem";
      toast({ title: "Erro ao enviar", description, variant: "destructive" });
    } finally {
      setSendingReply(false);
    }
  };

  // Save agent config
  const saveConfig = async () => {
    if (!user) return;
    try {
      const { error } = await supabase.from("settings").update({
        bot_enabled: agentConfig.chatbotEnabled,
        bot_auto_send: agentConfig.autoCollections,
        bot_send_pix: agentConfig.sendPix,
        bot_notify_owner: agentConfig.notifyOwner,
        bot_max_messages_per_day: agentConfig.maxMessagesPerDay,
        bot_send_hour: agentConfig.workHourStart,
        bot_tone: agentConfig.tone,
        bot_use_ai: agentConfig.useAi,
      }).eq("user_id", user.id);
      if (error) throw error;
      queryClient.invalidateQueries({ queryKey: ["settings-agent"] });
      toast({ title: "Configurações salvas!" });
    } catch (error) {
      toast({ title: "Erro ao salvar", description: error instanceof Error ? error.message : "Tente novamente.", variant: "destructive" });
    }
  };

  useEffect(() => {
    // Mesmo caso do outro: só rola quando existe mensagem, e só o necessário.
    if (!messages?.length) return;
    rolarListaAteOFim(scrollRef);
  }, [messages]);

  const buildContext = () => {
    if (!dashData) return null;
    const { contracts, installments, clients } = dashData;
    const now = new Date(); now.setHours(0,0,0,0);
    const overdueInstallments = installments.filter((i: any) => isEmAtraso(i, now));
    const activeContracts = contracts.filter((c: any) => c.status === "active" || c.status === "overdue");
    const todayStr = todayLocalISO();
    const dueToday = installments.filter((i: any) => isEmAberto(i) && i.due_date?.startsWith(todayStr));
    return {
      totalClients: clients.length,
      activeClients: clients.filter((c: any) => c.status === "Ativo").length,
      totalContracts: contracts.length,
      activeContracts: activeContracts.length,
      overdueCount: overdueInstallments.length,
      overdueAmount: overdueInstallments.reduce((s: number, i: any) => s + safeAgentNumber(i.amount), 0).toFixed(2),
      capitalOnStreet: safeAgentNumber(computeOutstandingPrincipal(activeContracts, installments)).toFixed(2),
      totalProfit: dashData.profits.reduce((s: number, p: any) => s + safeAgentNumber(p.amount), 0).toFixed(2),
      dueTodayCount: dueToday.length,
      clientsList: clients.slice(0, 20).map((c: any) => `- ${c.name} (Score: ${c.credit_score}, Status: ${c.status})`).join("\n"),
      overdueDetails: overdueInstallments.slice(0, 15).map((i: any) => `- Parcela ${i.installment_number}: R$ ${safeAgentNumber(i.amount).toFixed(2)} venc. ${formatBR(i.due_date)}`).join("\n"),
    };
  };

  const handleSend = async (override?: string) => {
    const text = (override ?? input).trim();
    if (!text || loading) return;
    const userMsg: Message = { role: "user", content: text, timestamp: new Date() };
    const updatedMessages = [...messages, userMsg];
    setMessages(updatedMessages);
    setInput("");
    setLoading(true);
    const context = buildContext();
    const apiMessages = updatedMessages.map((m) => ({ role: m.role, content: m.content }));
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Sem sessão");
      const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/agent-chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ messages: apiMessages, context }),
      });
      if (!resp.ok) {
        const errData = await resp.json();
        throw new Error(errData.error || "Erro na API");
      }
      const reader = resp.body!.getReader();
      const decoder = new TextDecoder();
      let assistantContent = "";
      let textBuffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        textBuffer += decoder.decode(value, { stream: true });
        let newlineIndex: number;
        while ((newlineIndex = textBuffer.indexOf("\n")) !== -1) {
          let line = textBuffer.slice(0, newlineIndex);
          textBuffer = textBuffer.slice(newlineIndex + 1);
          if (line.endsWith("\r")) line = line.slice(0, -1);
          if (line.startsWith(":") || line.trim() === "") continue;
          if (!line.startsWith("data: ")) continue;
          const jsonStr = line.slice(6).trim();
          if (jsonStr === "[DONE]") break;
          try {
            const parsed = JSON.parse(jsonStr);
            const content = parsed.choices?.[0]?.delta?.content;
            if (content) {
              assistantContent += content;
              setMessages((prev) => {
                const last = prev[prev.length - 1];
                if (last?.role === "assistant") {
                  return prev.map((m, i) => i === prev.length - 1 ? { ...m, content: assistantContent } : m);
                }
                return [...prev, { role: "assistant", content: assistantContent, timestamp: new Date() }];
              });
            }
          } catch {
            textBuffer = line + "\n" + textBuffer;
            break;
          }
        }
      }
      if (!assistantContent) {
        setMessages((prev) => [...prev, { role: "assistant", content: "Desculpe, não consegui processar. Tente novamente.", timestamp: new Date() }]);
      }
    } catch (err: any) {
      setMessages((prev) => [...prev, { role: "assistant", content: `❌ Erro: ${err.message}`, timestamp: new Date() }]);
      toast({ title: "Erro", description: err.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const now = new Date(); now.setHours(0,0,0,0);
  const overdue = dashData?.installments.filter((i: any) => isEmAtraso(i, now)).length || 0;
  const overdueAmount = dashData?.installments
    .filter((i: any) => isEmAtraso(i, now))
    .reduce((s: number, i: any) => s + safeAgentNumber(i.amount), 0) || 0;
  const capitalOnStreet = dashData
    ? computeOutstandingPrincipal(dashData.contracts as any, dashData.installments as any)
    : 0;
  const totalProfit = dashData?.profits.reduce((s: number, p: any) => s + safeAgentNumber(p.amount), 0) || 0;
  const unreadCount = whatsappChats.reduce((s, c) => s + (c.unreadCount || 0), 0);

  const fmt = (n: number) =>
    safeAgentNumber(n).toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

  const filteredChats = whatsappChats.filter((c) => {
    if (chatFilter === "human" && !c.needsHuman) return false;
    if (chatFilter === "unread" && !c.unreadCount) return false;
    if (chatFilter === "groups" && !c.remoteJid.endsWith("@g.us")) return false;
    if (chatFilter === "users" && c.remoteJid.endsWith("@g.us")) return false;
    if (chatSearch.trim()) {
      const q = chatSearch.toLowerCase();
      return (
        c.name?.toLowerCase().includes(q) ||
        c.phone?.toLowerCase().includes(q) ||
        c.lastMessage?.toLowerCase().includes(q)
      );
    }
    return true;
  });

  const quickPrompts = [
    { icon: <AlertTriangle size={14} />, label: "Quem deve mais?", prompt: "Liste os 5 clientes com maior valor em atraso e sugira uma abordagem para cada um." },
    { icon: <TrendingUp size={14} />, label: "Como está o caixa?", prompt: "Analise o capital na rua, lucro acumulado e me dê um resumo executivo do desempenho." },
    { icon: <Zap size={14} />, label: "O que cobrar hoje?", prompt: "Quais parcelas vencem hoje ou estão atrasadas? Priorize e me diga o que fazer primeiro." },
    { icon: <Users size={14} />, label: "Risco de crédito", prompt: "Quais clientes têm maior risco de inadimplência baseado em score e histórico? Sugira ações." },
  ];

  const runQuickPrompt = (p: string) => {
    handleSend(p);
  };

  const clearChat = () => {
    setMessages([
      { role: "assistant", content: "Olá! Sou o assistente IA do CredMais App. Como posso ajudar?", timestamp: new Date() },
    ]);
  };

  const copyMessage = (text: string) => {
    navigator.clipboard.writeText(text);
    toast({ title: "Copiado!" });
  };

  // "/" to focus chat input
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "/" && tab === "chat" && document.activeElement?.tagName !== "INPUT" && document.activeElement?.tagName !== "TEXTAREA") {
        e.preventDefault();
        chatInputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [tab]);

  const getMessageText = (msg: WhatsAppMsg) =>
    extractWhatsAppText(msg.message) || "";

  type MediaKind = "image" | "audio" | "video" | "document" | "sticker" | "location" | "contact" | "text";
  const detectMediaKind = (msg: WhatsAppMsg): MediaKind => {
    const m = msg.message as any;
    if (!m) return "text";
    if (m.imageMessage) return "image";
    if (m.audioMessage || m.pttMessage) return "audio";
    if (m.videoMessage) return "video";
    if (m.documentMessage || m.documentWithCaptionMessage) return "document";
    if (m.stickerMessage) return "sticker";
    if (m.locationMessage || m.liveLocationMessage) return "location";
    if (m.contactMessage || m.contactsArrayMessage) return "contact";
    return "text";
  };

  const getQuotedInfo = (msg: WhatsAppMsg) => {
    const ctx = (msg.message as any)?.extendedTextMessage?.contextInfo
      || (msg as any)?.contextInfo;
    const quoted = ctx?.quotedMessage;
    if (!quoted) return null;
    const text = extractWhatsAppText(quoted) || "[mídia]";
    const author = ctx?.participant ? getJidLabel(ctx.participant) : null;
    return { text: text.length > 120 ? text.slice(0, 120) + "…" : text, author };
  };

  // Returns best-effort URL for any media (image, sticker, audio, video, document).
  // Handles direct https URLs as well as base64 payloads injected by Evolution.
  const getMediaUrl = (msg: WhatsAppMsg, kind: MediaKind): string | null => {
    const m = msg.message as any;
    if (!m) return null;
    const node =
      kind === "image" ? m.imageMessage :
      kind === "sticker" ? m.stickerMessage :
      kind === "audio" ? (m.audioMessage || m.pttMessage) :
      kind === "video" ? m.videoMessage :
      kind === "document" ? (m.documentMessage || m.documentWithCaptionMessage?.message?.documentMessage) :
      null;
    if (!node) return null;

    const direct = node.url || node.directPath;
    if (typeof direct === "string" && direct.startsWith("http")) return direct;

    const b64 = node.mediaBase64 || node.base64 || m.base64;
    if (typeof b64 === "string" && b64.length > 100) {
      if (b64.startsWith("data:")) return b64;
      const mime = node.mimetype ||
        (kind === "image" ? "image/jpeg" :
         kind === "sticker" ? "image/webp" :
         kind === "audio" ? "audio/ogg" :
         kind === "video" ? "video/mp4" :
         "application/octet-stream");
      return `data:${mime};base64,${b64}`;
    }
    return null;
  };

  const getAudioSeconds = (msg: WhatsAppMsg): number | null => {
    const m = msg.message as any;
    const s = m?.audioMessage?.seconds ?? m?.pttMessage?.seconds;
    return typeof s === "number" ? s : null;
  };

  const getDocumentInfo = (msg: WhatsAppMsg) => {
    const d = (msg.message as any)?.documentMessage
      || (msg.message as any)?.documentWithCaptionMessage?.message?.documentMessage;
    if (!d) return null;
    const sizeBytes = Number(d.fileLength || 0);
    const sizeLabel = sizeBytes > 0
      ? sizeBytes >= 1024 * 1024
        ? `${(sizeBytes / 1024 / 1024).toFixed(1)} MB`
        : `${Math.max(1, Math.round(sizeBytes / 1024))} KB`
      : "";
    return {
      name: d.fileName || d.title || "documento",
      mime: d.mimetype || "",
      sizeLabel,
      pageCount: d.pageCount ? Number(d.pageCount) : 0,
    };
  };

  const getLocationInfo = (msg: WhatsAppMsg) => {
    const m = msg.message as any;
    const loc = m?.locationMessage || m?.liveLocationMessage;
    if (!loc) return null;
    const lat = loc.degreesLatitude ?? loc.latitude;
    const lng = loc.degreesLongitude ?? loc.longitude;
    if (typeof lat !== "number" || typeof lng !== "number") return { name: loc.name || "Localização", url: null as string | null };
    return {
      name: loc.name || loc.address || "Localização",
      url: `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`,
    };
  };

  const formatDateLabel = (ts: number) => {
    if (!Number.isFinite(ts) || ts <= 0) return "Data indisponível";
    const d = new Date(ts * 1000);
    const today = new Date();
    const yesterday = new Date(); yesterday.setDate(today.getDate() - 1);
    const same = (a: Date, b: Date) => a.toDateString() === b.toDateString();
    if (same(d, today)) return "Hoje";
    if (same(d, yesterday)) return "Ontem";
    return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" });
  };

  // Compact list timestamp: "14:32" today, "Ontem", weekday this week, else DD/MM/YY
  const formatChatListTime = (raw: string | undefined): string => {
    if (!raw) return "";
    const n = Number(raw);
    const d = !Number.isNaN(n) && n > 0
      ? new Date(n < 1e12 ? n * 1000 : n)
      : new Date(raw);
    if (Number.isNaN(d.getTime())) return "";
    const now = new Date();
    const sameDay = d.toDateString() === now.toDateString();
    if (sameDay) return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
    const y = new Date(); y.setDate(now.getDate() - 1);
    if (d.toDateString() === y.toDateString()) return "Ontem";
    const diff = (now.getTime() - d.getTime()) / 86400000;
    if (diff < 7) return d.toLocaleDateString("pt-BR", { weekday: "short" }).replace(".", "");
    return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit" });
  };

  // Deterministic vibrant gradient for avatar fallback based on JID
  const avatarGradient = (seed: string): string => {
    const palette = [
      "from-sky-500 to-indigo-500",
      "from-emerald-500 to-teal-500",
      "from-fuchsia-500 to-pink-500",
      "from-amber-500 to-orange-500",
      "from-violet-500 to-purple-500",
      "from-rose-500 to-red-500",
      "from-cyan-500 to-blue-500",
      "from-lime-500 to-emerald-500",
    ];
    let hash = 0;
    for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) | 0;
    return palette[Math.abs(hash) % palette.length];
  };

  const initialsOf = (name?: string): string => {
    if (!name) return "?";
    const parts = name.trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return "?";
    const a = parts[0][0] || "";
    const b = parts.length > 1 ? parts[parts.length - 1][0] : "";
    return (a + b).toUpperCase().slice(0, 2);
  };

  // Avatar component (image + colored gradient fallback with initials)
  const ChatAvatar = ({ chat, size = 40, isGroup }: { chat: { name?: string; remoteJid: string; profilePicUrl?: string }; size?: number; isGroup?: boolean }) => {
    const [errored, setErrored] = useState(false);
    const showImg = chat.profilePicUrl && !errored;
    const dim = { width: size, height: size };
    if (showImg) {
      return (
        <img
          src={chat.profilePicUrl}
          alt={chat.name || ""}
          onError={() => setErrored(true)}
          className="rounded-full object-cover shrink-0 ring-1 ring-border/50"
          style={dim}
          loading="lazy"
        />
      );
    }
    return (
      <div
        className={`rounded-full shrink-0 flex items-center justify-center text-white font-semibold bg-linear-to-br ${avatarGradient(chat.remoteJid)} ring-1 ring-border/30`}
        style={{ ...dim, fontSize: Math.round(size * 0.38) }}
      >
        {isGroup ? <Users size={Math.round(size * 0.45)} /> : initialsOf(chat.name)}
      </div>
    );
  };

  // Build a preview line for the chat list with media icon prefix and "Você:" tag
  const renderLastMessagePreview = (chat: WhatsAppChat) => {
    const kind = chat.lastMessageKind || "text";
    const labels: Record<string, { icon: React.ReactNode; text: string }> = {
      image: { icon: <ImageIcon size={12} />, text: "Foto" },
      audio: { icon: <Mic size={12} />, text: "Mensagem de voz" },
      video: { icon: <Video size={12} />, text: "Vídeo" },
      document: { icon: <FileIcon size={12} />, text: "Documento" },
      sticker: { icon: <Sticker size={12} />, text: "Figurinha" },
      location: { icon: <MapPin size={12} />, text: "Localização" },
      contact: { icon: <User size={12} />, text: "Contato" },
      text: { icon: null, text: "" },
    };
    const meta = labels[kind];
    const text = chat.lastMessage?.trim();
    return (
      <span className="flex items-center gap-1 min-w-0">
        {chat.lastMessageFromMe && (
          <CheckCheck size={12} className="text-muted-foreground shrink-0" />
        )}
        {meta.icon && <span className="opacity-70 shrink-0">{meta.icon}</span>}
        <span className="truncate">
          {kind === "text" ? (text || "...") : (text ? `${meta.text}: ${text}` : meta.text)}
        </span>
      </span>
    );
  };

  // Linkify plain text — splits into spans + clickable anchors
  const renderTextWithLinks = (raw: string, fromMe: boolean) => {
    const re = /(https?:\/\/[^\s]+)/g;
    const parts: Array<{ t: "text" | "url"; v: string }> = [];
    let last = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(raw)) !== null) {
      if (m.index > last) parts.push({ t: "text", v: raw.slice(last, m.index) });
      parts.push({ t: "url", v: m[0] });
      last = m.index + m[0].length;
    }
    if (last < raw.length) parts.push({ t: "text", v: raw.slice(last) });
    if (!parts.length) return raw;
    return parts.map((p, i) =>
      p.t === "url" ? (
        <a
          key={i}
          href={p.v}
          target="_blank"
          rel="noreferrer noopener"
          className={`underline underline-offset-2 break-all ${fromMe ? "text-primary-foreground" : "text-primary"}`}
        >
          {p.v}
        </a>
      ) : (
        <span key={i}>{p.v}</span>
      )
    );
  };

  const getStatusIcon = (msg: WhatsAppMsg) => {
    if (!msg.key?.fromMe) return null;
    const status = (msg as any).status;
    // Evolution status numbers: 0 pending, 1 sent, 2 delivered, 3 read, 4 played
    if (status === 3 || status === 4 || status === "READ") return <CheckCheck size={12} className="text-sky-400" />;
    if (status === 2 || status === "DELIVERY_ACK") return <CheckCheck size={12} className="text-primary-foreground/60" />;
    return <Check size={12} className="text-primary-foreground/60" />;
  };

  const ToggleSwitch = ({ enabled, onToggle, label, description }: { enabled: boolean; onToggle: () => void; label: string; description: string }) => (
    <div className="flex items-center justify-between py-3">
      <div className="flex-1 mr-4">
        <p className="text-sm font-medium text-foreground">{label}</p>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      <button onClick={onToggle} className="shrink-0">
        {enabled ? (
          <ToggleRight size={32} className="text-primary" />
        ) : (
          <ToggleLeft size={32} className="text-muted-foreground" />
        )}
      </button>
    </div>
  );

  return (
    <div className="space-y-6">
      {!embedded && <div className="page-hero animate-fade-in">
        <div className="page-hero-content flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="page-hero-icon">
              <CredinhoAvatar size={44} />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-shimmer">Agente IA</h1>
              <p className="text-sm text-muted-foreground mt-0.5">Assistente inteligente com WhatsApp integrado</p>
            </div>
          </div>
          <span className={`flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-full border ${whatsappStatus === "connected" ? "text-success bg-success/10 border-success/20" : "text-muted-foreground bg-muted/40 border-border"}`}>
            {whatsappStatus === "connected" ? <><Wifi size={12} /> Conectado</> : <><WifiOff size={12} /> Offline</>}
          </span>
        </div>
      </div>}

      {/* Tabs */}
      {!embedded && <div className="flex gap-2 flex-wrap">
        {([
          { id: "chat", label: "Chat IA", icon: <Bot size={16} /> },
          { id: "mensagens", label: "Mensagens", icon: <Inbox size={16} /> },
          { id: "documentos", label: `Revisões (${(reviewCenter?.receipts || []).filter((item: any) => item.status === "pending").length})`, icon: <Shield size={16} /> },
          { id: "whatsapp", label: "WhatsApp", icon: <Phone size={16} /> },
          { id: "config", label: "Configurações", icon: <Settings size={16} /> },
          { id: "metricas", label: "Métricas", icon: <BarChart3 size={16} /> },
          { id: "relatorios", label: "Relatórios", icon: <FileText size={16} /> },
        ] as { id: TabType; label: string; icon: React.ReactNode }[]).map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)} className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${tab === t.id ? "bg-primary text-primary-foreground" : "bg-card border border-border text-muted-foreground hover:text-foreground"}`}>
            {t.icon} {t.label}
          </button>
        ))}
      </div>}

      {/* ========== REVISÕES TAB ========== */}
      {tab === "documentos" && (
        <div className="space-y-5">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            {[
              { label: "WhatsApp", value: whatsappStatus === "connected" ? "Conectado" : "Offline", alert: whatsappStatus !== "connected" },
              { label: "Aguardando humano", value: String(agentHealth?.handoffs || 0), alert: (agentHealth?.handoffs || 0) > 0 },
              { label: "Comprovantes", value: String(agentHealth?.pendingReceipts || 0), alert: (agentHealth?.pendingReceipts || 0) > 0 },
              { label: "Falhas em 24h", value: String(agentHealth?.failures24h || 0), alert: (agentHealth?.failures24h || 0) > 0 },
              { label: "Última atividade", value: formatBRDateTime(agentHealth?.lastActionAt) || "Sem registro", alert: false },
            ].map((item) => (
              <div key={item.label} className={`rounded-xl border p-4 ${item.alert ? "border-amber-500/30 bg-amber-500/5" : "border-border bg-card"}`}>
                <p className="text-xs text-muted-foreground">{item.label}</p><p className="mt-1 text-sm font-semibold text-foreground">{item.value}</p>
              </div>
            ))}
          </div>
          <div className="rounded-2xl border border-border bg-card p-5">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <h2 className="font-semibold text-foreground">Comprovantes aguardando confirmação</h2>
                <p className="text-xs text-muted-foreground">Nenhuma baixa ocorre até uma pessoa aprovar.</p>
              </div>
              <button onClick={() => refetchReviewCenter()} className="rounded-lg border border-border p-2 hover:bg-muted" aria-label="Atualizar revisões">
                <RefreshCw size={15} className={loadingReviewCenter ? "animate-spin" : ""} />
              </button>
            </div>
            <div className="space-y-3">
              {(reviewCenter?.receipts || []).filter((item: any) => item.status === "pending").length === 0 ? (
                <p className="rounded-xl bg-muted/30 p-4 text-sm text-muted-foreground">Nenhum comprovante pendente.</p>
              ) : (reviewCenter?.receipts || []).filter((item: any) => item.status === "pending").map((item: any) => (
                <div key={item.id} className="rounded-xl border border-amber-500/25 bg-amber-500/5 p-4">
                  <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
                    <div>
                      <p className="font-semibold text-foreground">{item.clients?.name || "Cliente"}</p>
                      <p className="text-sm text-muted-foreground">
                        Parcela #{item.contract_installments?.installment_number || "não identificada"} · {safeAgentNumber(item.amount).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">Confira o favorecido e o recebimento no banco antes de aprovar.</p>
                      <p className="mt-1 text-xs text-muted-foreground">O pagamento será aplicado à parcela indicada; eventual sobra será aplicada às demais parcelas abertas deste cliente.</p>
                      <label className="mt-2 block text-xs">Valor efetivamente recebido
                        <input aria-label={`Valor recebido de ${item.clients?.name || "cliente"}`} type="text" inputMode="decimal" className="ml-2 rounded border bg-background px-2 py-1"
                          value={receiptAmounts[item.id] ?? String(item.amount || "")} onChange={e=>setReceiptAmounts(prev=>({...prev,[item.id]:e.target.value}))}/>
                      </label>
                      {item.metadata?.payment_kind==='interest_only'&&<label className="mt-2 block text-xs">Novo vencimento da renovação
                        <input aria-label="Novo vencimento da renovação" type="date" className="ml-2 rounded border bg-background px-2 py-1" value={receiptDates[item.id]||''} onChange={e=>setReceiptDates(prev=>({...prev,[item.id]:e.target.value}))}/>
                      </label>}
                    </div>
                    <div className="flex gap-2">
                      {item.metadata?.storage_path && <button onClick={()=>openStoredDocument(item.metadata.storage_path)} className="rounded-lg border px-3 py-2 text-xs">Abrir comprovante</button>}
                      <button onClick={() => rejectReceipt(item.id)} className="rounded-lg border border-destructive/30 px-3 py-2 text-xs font-semibold text-destructive hover:bg-destructive/10">Rejeitar</button>
                      <button onClick={() => approveReceipt(item.id)} disabled={!item.installment_id} className="rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground disabled:opacity-50">Confirmar recebimento e registrar</button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-2xl border border-border bg-card p-5">
            <h2 className="font-semibold text-foreground">Documentos das solicitações</h2>
            <p className="mb-4 text-xs text-muted-foreground">Confira arquivos suspeitos, ilegíveis e aprovados pela triagem.</p>
            <div className="space-y-4">
              {(reviewCenter?.leads || []).length === 0 ? (
                <p className="rounded-xl bg-muted/30 p-4 text-sm text-muted-foreground">Nenhum documento recebido.</p>
              ) : [...(reviewCenter?.leads || [])].sort((a: any, b: any) => {
                const priority = (lead: any) => lead.converted_client_id ? 3 : (lead.notes?.docs?.missing || []).length > 0 ? 0 : 1;
                return priority(a) - priority(b);
              }).map((lead: any) => (
                <div key={lead.id} className="rounded-xl border border-border p-4">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <div>
                      <p className="font-semibold text-foreground">{lead.name || lead.phone}</p>
                      <p className="text-xs text-muted-foreground">Faltando: {(lead.notes?.docs?.missing || []).join(", ") || "nenhum"}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`rounded-full px-2.5 py-1 text-[10px] font-semibold ${(lead.notes?.docs?.missing || []).length > 0 ? "bg-amber-500/10 text-amber-600" : lead.converted_client_id ? "bg-emerald-500/10 text-emerald-600" : "bg-primary/10 text-primary"}`}>
                        {lead.converted_client_id ? "Ficha criada" : (lead.notes?.docs?.missing || []).length > 0 ? "Reenvio pendente" : "Pronto para ficha"}
                      </span>
                      <button onClick={() => lead.converted_client_id ? navigate(`/clientes/${lead.converted_client_id}`) : convertLeadToClient(lead)} disabled={!lead.converted_client_id && (lead.notes?.docs?.missing || []).length > 0}
                        className="rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50"
                        title={(lead.notes?.docs?.missing || []).length > 0 ? "Aprove os documentos pendentes primeiro" : undefined}>
                        {lead.converted_client_id ? "Abrir ficha" : "Criar ficha do cliente"}
                      </button>
                    </div>
                  </div>
                  <div className="grid gap-2 md:grid-cols-2">
                    {(lead.notes?.docs?.validations || []).map((validation: any, index: number) => (
                      <div key={`${lead.id}-${index}`} className="rounded-lg bg-muted/30 p-3">
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <p className="text-sm font-medium text-foreground">{validation.label || validation.document_type}</p>
                            <p className="text-xs text-muted-foreground">{validation.reasons?.join("; ") || "Sem observações"}</p>
                          </div>
                          <span className={`text-[10px] font-bold ${validation.decision === "accepted" ? "text-emerald-600" : validation.decision === "resend" ? "text-destructive" : "text-amber-600"}`}>{validation.decision}</span>
                        </div>
                        <div className="mt-3 flex flex-wrap gap-2">
                          {validation.path && <button onClick={() => openStoredDocument(validation.path)} className="rounded-md border border-border px-2.5 py-1.5 text-xs font-medium hover:bg-muted">Abrir arquivo</button>}
                          <button onClick={() => reviewDocument(lead, index, false)} className="rounded-md border border-destructive/30 px-2.5 py-1.5 text-xs font-medium text-destructive">Pedir reenvio</button>
                          <button onClick={() => reviewDocument(lead, index, true)} className="rounded-md bg-primary px-2.5 py-1.5 text-xs font-medium text-primary-foreground">Aprovar</button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ========== MENSAGENS TAB ========== */}
      {tab === "mensagens" && (
        <div className="rounded-2xl border border-border bg-card flex flex-col min-h-[360px] h-[calc(100dvh-280px)] lg:h-[calc(100vh-280px)]">
          {whatsappStatus !== "connected" ? (
            <div className="flex-1 flex items-center justify-center text-center p-6">
              <div className="space-y-3">
                <WifiOff size={40} className="mx-auto text-muted-foreground" />
                <p className="text-foreground font-medium">WhatsApp não conectado</p>
                <p className="text-sm text-muted-foreground">Conecte na aba WhatsApp para ver as mensagens.</p>
              </div>
            </div>
          ) : !selectedChat ? (
            <>
              <div className="p-4 border-b border-border space-y-3">
                <div className="flex items-center justify-between">
                  <h2 className="font-semibold text-foreground flex items-center gap-2">
                    <Inbox size={18} /> Conversas
                    {unreadCount > 0 && (
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-primary text-primary-foreground">
                        {unreadCount}
                      </span>
                    )}
                  </h2>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={async () => {
                        try {
                          await callEvolutionApi("update_settings", { instanceName });
                          toast({ title: "Sincronizando histórico", description: "Pode levar alguns minutos. Atualizando..." });
                          setTimeout(() => loadChats(), 5000);
                        } catch (e: any) {
                          toast({ title: "Erro", description: e.message, variant: "destructive" });
                        }
                      }}
                      className="text-xs px-2.5 py-1.5 rounded-lg bg-primary/10 text-primary border border-primary/20 hover:bg-primary/20 transition-colors font-medium"
                      title="Sincronizar todo o histórico do WhatsApp"
                    >
                      Sincronizar histórico
                    </button>
                    <button onClick={() => loadChats()} disabled={loadingChats} className="p-2 rounded-lg hover:bg-muted/50 transition-colors">
                      <RefreshCw size={16} className={`text-muted-foreground ${loadingChats ? "animate-spin" : ""}`} />
                    </button>
                  </div>
                </div>
                <div className="relative">
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <input
                    value={chatSearch}
                    onChange={(e) => setChatSearch(e.target.value)}
                    placeholder="Buscar por nome, telefone ou mensagem..."
                    className="w-full pl-9 pr-9 py-2 rounded-lg bg-muted/30 border border-border text-sm text-foreground placeholder:text-muted-foreground focus:outline-hidden focus:ring-1 focus:ring-ring"
                  />
                  {chatSearch && (
                    <button onClick={() => setChatSearch("")} className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded hover:bg-muted">
                      <X size={12} className="text-muted-foreground" />
                    </button>
                  )}
                </div>
                <div className="flex gap-1.5">
                  {([
                    { id: "all", label: "Todas", count: whatsappChats.length },
                    { id: "human", label: "Aguardando", count: whatsappChats.filter(c => c.needsHuman).length },
                    { id: "unread", label: "Não lidas", count: whatsappChats.filter(c => c.unreadCount).length },
                    { id: "users", label: "Usuários", count: whatsappChats.filter(c => !c.remoteJid.endsWith("@g.us")).length },
                    { id: "groups", label: "Grupos", count: whatsappChats.filter(c => c.remoteJid.endsWith("@g.us")).length },
                  ] as const).map((f) => (
                    <button
                      key={f.id}
                      onClick={() => setChatFilter(f.id)}
                      className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${chatFilter === f.id ? "bg-primary text-primary-foreground" : "bg-muted/30 border border-border text-muted-foreground hover:text-foreground"}`}
                    >
                      {f.label}
                      <span className="opacity-70">{f.count}</span>
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex-1 overflow-y-auto">
                {loadingChats ? (
                  <div className="flex items-center justify-center py-10">
                    <Loader2 size={24} className="animate-spin text-muted-foreground" />
                  </div>
                ) : filteredChats.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-10 text-sm text-muted-foreground gap-2">
                    <Inbox size={28} className="opacity-40" />
                    {chatSearch || chatFilter !== "all" ? "Nenhuma conversa corresponde aos filtros" : "Nenhuma conversa encontrada"}
                  </div>
                ) : (
                  filteredChats.map((chat) => {
                    const isGroup = chat.remoteJid.endsWith("@g.us");
                    const time = formatChatListTime(chat.updatedAt);
                    return (
                      <button
                        key={chat.id}
                        onClick={() => openChat(chat)}
                        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-muted/40 transition-colors border-b border-border/40 text-left group"
                      >
                        <ChatAvatar chat={chat} size={44} isGroup={isGroup} />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-2">
                            <p className={`text-sm truncate ${chat.unreadCount ? "font-semibold text-foreground" : "font-medium text-foreground"}`}>
                              {chat.name}
                            </p>
                            {time && (
                              <span className={`text-[10px] shrink-0 ${chat.unreadCount ? "text-primary font-semibold" : "text-muted-foreground"}`}>
                                {time}
                              </span>
                            )}
                          </div>
                          <div className={`text-xs truncate mt-0.5 ${chat.unreadCount ? "text-foreground/80" : "text-muted-foreground"}`}>
                            {renderLastMessagePreview(chat)}
                          </div>
                          {chat.needsHuman && (
                            <div className="mt-1 flex items-center gap-1 text-[10px] font-semibold text-amber-600">
                              <AlertTriangle size={11} /> Aguardando atendente
                            </div>
                          )}
                        </div>
                        {chat.unreadCount ? (
                          <span className="shrink-0 min-w-[20px] h-5 px-1.5 rounded-full bg-primary text-primary-foreground text-[10px] flex items-center justify-center font-bold shadow-xs">
                            {chat.unreadCount > 99 ? "99+" : chat.unreadCount}
                          </span>
                        ) : null}
                      </button>
                    );
                  })
                )}
              </div>
            </>
          ) : (
            <>
              <div className="p-3 border-b border-border flex items-center gap-3 bg-card/50 backdrop-blur-sm">
                <button onClick={() => { setSelectedChat(null); setChatMessages([]); }} className="p-1.5 rounded-lg hover:bg-muted/50">
                  <ChevronLeft size={18} className="text-foreground" />
                </button>
                <ChatAvatar chat={selectedChat} size={38} isGroup={selectedChat.remoteJid.endsWith("@g.us")} />
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-sm text-foreground truncate">{selectedChat.name}</p>
                  {selectedChat.phone && (
                    <p className="text-[11px] text-muted-foreground truncate">
                      {selectedChat.remoteJid.endsWith("@g.us") ? "Grupo" : selectedChat.phone}
                    </p>
                  )}
                </div>
                {!selectedChat.remoteJid.endsWith("@g.us") && (
                  selectedChat.botPaused ? (
                    <button
                      onClick={() => setConversationMode(selectedChat, false)}
                      className="shrink-0 rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-muted"
                    >
                      Finalizar e devolver ao bot
                    </button>
                  ) : (
                    <button
                      onClick={() => setConversationMode(selectedChat, true)}
                      className="shrink-0 rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-semibold text-slate-950 hover:bg-amber-400"
                    >
                      Assumir conversa
                    </button>
                  )
                )}
              </div>
              {selectedChat.humanReason && (
                <div className="border-b border-amber-500/20 bg-amber-500/10 px-4 py-2 text-xs text-amber-700 dark:text-amber-300">
                  Motivo do encaminhamento: {selectedChat.humanReason}
                </div>
              )}
              <div className="flex-1 overflow-y-auto p-4 space-y-1 bg-linear-to-b from-background to-muted/10 relative">
                {/* AI Assist Sidebar/Panel */}
                {selectedChat && aiAssist.summary && (
                  <div className="sticky top-0 z-20 mb-4 rounded-xl border border-primary/20 bg-primary/5 backdrop-blur-md p-3 shadow-xs animate-in fade-in slide-in-from-top-2">
                    <div className="flex items-start gap-2.5">
                      <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                        <Sparkles size={16} className="text-primary" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <h4 className="text-[11px] font-bold text-primary uppercase tracking-wider mb-1">Resumo Inteligente</h4>
                        <p className="text-xs text-foreground/90 leading-relaxed">{aiAssist.summary}</p>
                        {aiAssist.intent && (
                          <div className="mt-2 flex items-center gap-1.5">
                            <span className="text-[10px] font-semibold text-muted-foreground uppercase">Próxima Ação:</span>
                            <span className="text-[10px] font-bold text-primary px-1.5 py-0.5 rounded bg-primary/10 border border-primary/20">{aiAssist.intent}</span>
                          </div>
                        )}
                      </div>
                      <button onClick={() => setAiAssist({ suggestions: [] })} className="p-1 rounded hover:bg-primary/10 text-muted-foreground"><X size={14} /></button>
                    </div>
                  </div>
                )}

                {loadingMsgs ? (
                  <div className="flex items-center justify-center py-10">
                    <Loader2 size={24} className="animate-spin text-muted-foreground" />
                  </div>
                ) : chatMessages.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-16 text-sm text-muted-foreground gap-2">
                    <MessageSquare size={32} className="opacity-30" />
                    <p>Nenhuma mensagem ainda</p>
                  </div>
                ) : (
                  chatMessages.map((msg, i) => {
                    const fromMe = msg.key?.fromMe;
                    const ts = Number(msg.messageTimestamp) || 0;
                    const prevTs = i > 0 ? Number(chatMessages[i - 1].messageTimestamp) || 0 : 0;
                    const showDate = i === 0 || (ts > 0 && prevTs > 0 && new Date(ts * 1000).toDateString() !== new Date(prevTs * 1000).toDateString());
                    const prevMsg = i > 0 ? chatMessages[i - 1] : null;
                    const sameSender = !!prevMsg && prevMsg.key?.fromMe === fromMe && (prevMsg.key as any)?.participant === (msg.key as any)?.participant && !showDate;
                    const isGroup = selectedChat?.remoteJid.endsWith("@g.us");
                    const senderName = isGroup && !fromMe && !sameSender
                      ? (msg.pushName || getJidLabel((msg.key as any)?.participantAlt) || getJidLabel((msg.key as any)?.participant))
                      : null;
                    const kind = detectMediaKind(msg);
                    const text = getMessageText(msg);
                    const quoted = getQuotedInfo(msg);
                    const time = ts > 0 ? new Date(ts * 1000).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : "—";
                    const imageUrl = kind === "image" ? getMediaUrl(msg, "image") : null;
                    const stickerUrl = kind === "sticker" ? getMediaUrl(msg, "sticker") : null;
                    const audioUrl = kind === "audio" ? getMediaUrl(msg, "audio") : null;
                    const videoUrl = kind === "video" ? getMediaUrl(msg, "video") : null;
                    const docUrl = kind === "document" ? getMediaUrl(msg, "document") : null;
                    const audioSecs = kind === "audio" ? getAudioSeconds(msg) : null;
                    const docInfo = kind === "document" ? getDocumentInfo(msg) : null;
                    const locInfo = kind === "location" ? getLocationInfo(msg) : null;

                    // Sticker = bubble-less, just the sticker image
                    if (kind === "sticker") {
                      return (
                        <div key={msg.id || i}>
                          {showDate && (
                            <div className="flex justify-center my-3">
                              <span className="text-[10px] font-medium uppercase tracking-wide px-3 py-1 rounded-full bg-muted/60 text-muted-foreground border border-border/50">
                                {formatDateLabel(ts)}
                              </span>
                            </div>
                          )}
                          <div className={`flex ${fromMe ? "justify-end" : "justify-start"} ${sameSender ? "mt-0.5" : "mt-2"}`}>
                            <div className="flex flex-col items-end gap-0.5">
                              {stickerUrl ? (
                                <img src={stickerUrl} alt="figurinha" className="w-32 h-32 object-contain" loading="lazy" />
                              ) : (
                                <div className="w-24 h-24 rounded-lg bg-muted/50 flex items-center justify-center text-muted-foreground">
                                  <Sticker size={28} />
                                </div>
                              )}
                              <div className="flex items-center gap-1 text-muted-foreground">
                                <span className="text-[10px]">{time}</span>
                                {getStatusIcon(msg)}
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    }

                    const isMediaOnly = !text && (kind === "image" || kind === "video");

                    return (
                      <div key={msg.id || i}>
                        {showDate && (
                          <div className="flex justify-center my-3">
                            <span className="text-[10px] font-medium uppercase tracking-wide px-3 py-1 rounded-full bg-muted/60 text-muted-foreground border border-border/50">
                              {formatDateLabel(ts)}
                            </span>
                          </div>
                        )}
                        <div className={`flex ${fromMe ? "justify-end" : "justify-start"} ${sameSender ? "mt-0.5" : "mt-2"}`}>
                          <div className={`max-w-[78%] rounded-2xl text-sm shadow-xs overflow-hidden ${isMediaOnly ? "p-1" : "px-3 py-2"} ${fromMe ? "bg-primary text-primary-foreground rounded-br-sm" : "bg-card text-foreground border border-border/50 rounded-bl-sm"}`}>
                            {senderName && (
                              <p className={`text-[11px] font-semibold mb-1 ${fromMe ? "text-primary-foreground/90" : "text-primary"} ${isMediaOnly ? "px-2 pt-1" : ""}`}>{senderName}</p>
                            )}
                            {quoted && (
                              <div className={`mb-1.5 px-2 py-1.5 rounded-md border-l-2 text-[11px] ${isMediaOnly ? "mx-1" : ""} ${fromMe ? "bg-primary-foreground/10 border-primary-foreground/40" : "bg-muted/60 border-primary/60"}`}>
                                {quoted.author && <p className="font-semibold opacity-80">{quoted.author}</p>}
                                <p className="opacity-70 line-clamp-2">{quoted.text}</p>
                              </div>
                            )}

                            {kind === "image" && (imageUrl ? (
                              <a href={imageUrl} target="_blank" rel="noreferrer noopener" className="block">
                                <img src={imageUrl} alt="" className="rounded-xl max-w-full max-h-72 object-cover" loading="lazy" />
                              </a>
                            ) : (
                              <div className="flex items-center gap-2 py-1 opacity-80"><ImageIcon size={14} /><span className="text-xs italic">Imagem</span></div>
                            ))}

                            {kind === "video" && (videoUrl ? (
                              <video src={videoUrl} controls className="rounded-xl max-w-full max-h-72" preload="metadata" />
                            ) : (
                              <div className="flex items-center gap-2 py-1 opacity-80"><Video size={14} /><span className="text-xs italic">Vídeo</span></div>
                            ))}

                            {kind === "audio" && (
                              audioUrl ? (
                                <audio
                                  src={audioUrl}
                                  controls
                                  preload="metadata"
                                  className="h-9 max-w-[260px] w-full"
                                />
                              ) : (
                                <div className={`flex items-center gap-2.5 py-1 px-1 min-w-[160px] ${fromMe ? "text-primary-foreground" : "text-foreground"}`}>
                                  <div className={`w-8 h-8 rounded-full flex items-center justify-center ${fromMe ? "bg-primary-foreground/15" : "bg-primary/10"}`}>
                                    <Mic size={14} />
                                  </div>
                                  <div className="flex-1">
                                    <div className={`h-1 rounded-full ${fromMe ? "bg-primary-foreground/30" : "bg-primary/30"}`} />
                                    <p className="text-[10px] opacity-70 mt-1">
                                      {audioSecs ? `${Math.floor(audioSecs / 60)}:${String(audioSecs % 60).padStart(2, "0")}` : "Mensagem de voz"}
                                    </p>
                                  </div>
                                </div>
                              )
                            )}

                            {kind === "document" && docInfo && (
                              <a
                                href={docUrl || undefined}
                                target="_blank"
                                rel="noreferrer noopener"
                                className={`flex items-center gap-2.5 py-2 px-2.5 rounded-lg min-w-[220px] transition-colors ${fromMe ? "bg-primary-foreground/10 hover:bg-primary-foreground/15" : "bg-muted/50 hover:bg-muted/70"} ${!docUrl ? "pointer-events-none" : ""}`}
                              >
                                <div className={`w-9 h-9 rounded-md flex items-center justify-center shrink-0 ${fromMe ? "bg-primary-foreground/20" : "bg-primary/15 text-primary"}`}>
                                  <FileIcon size={18} />
                                </div>
                                <div className="min-w-0 flex-1">
                                  <p className="text-xs font-medium truncate">{docInfo.name}</p>
                                  <p className="text-[10px] opacity-70 truncate">
                                    {[docInfo.pageCount ? `${docInfo.pageCount} pág` : "", docInfo.sizeLabel, docInfo.mime?.split("/")[1]?.toUpperCase()].filter(Boolean).join(" · ")}
                                  </p>
                                </div>
                              </a>
                            )}

                            {kind === "location" && locInfo && (
                              <a
                                href={locInfo.url || undefined}
                                target="_blank"
                                rel="noreferrer noopener"
                                className={`flex items-center gap-2 py-1.5 px-2 rounded-md ${fromMe ? "bg-primary-foreground/10" : "bg-muted/50"} ${!locInfo.url ? "pointer-events-none" : "hover:opacity-90"}`}
                              >
                                <MapPin size={14} className="opacity-80" />
                                <span className="text-xs font-medium">{locInfo.name}</span>
                              </a>
                            )}

                            {kind === "contact" && (
                              <div className={`flex items-center gap-2 py-1.5 px-2 rounded-md ${fromMe ? "bg-primary-foreground/10" : "bg-muted/50"}`}>
                                <User size={14} className="opacity-80" />
                                <span className="text-xs font-medium">Contato compartilhado</span>
                              </div>
                            )}

                            {text && (
                              <p className={`whitespace-pre-wrap wrap-break-word leading-relaxed ${isMediaOnly ? "px-2 pt-2" : (kind !== "text" ? "mt-1.5" : "")}`}>
                                {renderTextWithLinks(text, !!fromMe)}
                              </p>
                            )}

                            <div className={`flex items-center justify-end gap-1 ${isMediaOnly ? "px-2 pb-1 pt-0.5" : "mt-0.5"} ${fromMe ? "text-primary-foreground/70" : "text-muted-foreground"}`}>
                              <span className="text-[10px]">{time}</span>
                              {getStatusIcon(msg)}
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
                <div ref={chatScrollRef} />
              </div>
              <div className="border-t border-border p-3 space-y-3">
                {selectedChat && aiAssist.suggestions.length > 0 && (
                  <div className="flex flex-wrap gap-2 animate-in fade-in slide-in-from-bottom-2">
                    {aiAssist.suggestions.map((s, idx) => (
                      <button
                        key={idx}
                        onClick={() => setReplyInput(s)}
                        className="px-3 py-1.5 rounded-full bg-primary/10 border border-primary/20 text-[11px] font-medium text-primary hover:bg-primary hover:text-primary-foreground transition-all active:scale-95"
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                )}
                <div className="flex gap-2">

                  <input
                    value={replyInput}
                    onChange={(e) => setReplyInput(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && sendReply()}
                    placeholder="Digite sua resposta..."
                    className="flex-1 px-4 py-2.5 rounded-lg bg-muted/30 border border-border text-sm text-foreground placeholder:text-muted-foreground focus:outline-hidden focus:ring-1 focus:ring-ring"
                  />
                  <button onClick={sendReply} disabled={!replyInput.trim() || sendingReply} className="p-2.5 rounded-lg bg-primary text-primary-foreground disabled:opacity-50">
                    {sendingReply ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* ========== CONFIG TAB ========== */}
      {tab === "config" && (
        <div className="space-y-4">
          <div className="rounded-2xl border border-border bg-card p-5 space-y-1">
            <h2 className="font-semibold text-foreground flex items-center gap-2 mb-3"><Bot size={18} /> Chatbot IA</h2>
            <ToggleSwitch
              enabled={agentConfig.chatbotEnabled}
              onToggle={() => setAgentConfig((p) => ({ ...p, chatbotEnabled: !p.chatbotEnabled }))}
              label="Chatbot Ativo"
              description="Responde mensagens automaticamente via IA no WhatsApp"
            />
            <ToggleSwitch
              enabled={agentConfig.autoReply}
              onToggle={() => setAgentConfig((p) => ({ ...p, autoReply: !p.autoReply }))}
              label="Resposta Automática"
              description="Responde automaticamente quando o cliente envia mensagem"
            />
            <div className="py-3">
              <p className="text-sm font-medium text-foreground mb-2">Tom das respostas</p>
              <div className="flex gap-2">
                {(["formal", "casual", "firme"] as const).map((t) => (
                  <button
                    key={t}
                    onClick={() => setAgentConfig((p) => ({ ...p, tone: t }))}
                    className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${agentConfig.tone === t ? "bg-primary text-primary-foreground" : "bg-muted/30 border border-border text-muted-foreground"}`}
                  >
                    {t === "formal" ? "Formal" : t === "casual" ? "Casual" : "Firme"}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-border bg-card p-5 space-y-1">
            <h2 className="font-semibold text-foreground flex items-center gap-2 mb-3"><Zap size={18} /> Agente de Cobranças</h2>
            <ToggleSwitch
              enabled={agentConfig.autoCollections}
              onToggle={() => setAgentConfig((p) => ({ ...p, autoCollections: !p.autoCollections }))}
              label="Cobranças Automáticas"
              description="Envia mensagens de cobrança automaticamente para parcelas atrasadas"
            />
            <ToggleSwitch
              enabled={agentConfig.useAi}
              onToggle={() => setAgentConfig((p) => ({ ...p, useAi: !p.useAi }))}
              label="Inteligência Artificial"
              description="Cria mensagens personalizadas quando a integração de IA está disponível"
            />

            <ToggleSwitch
              enabled={agentConfig.sendPix}
              onToggle={() => setAgentConfig((p) => ({ ...p, sendPix: !p.sendPix }))}
              label="Enviar Chave Pix"
              description="Inclui a chave Pix na mensagem de cobrança"
            />
            <ToggleSwitch
              enabled={agentConfig.notifyOwner}
              onToggle={() => setAgentConfig((p) => ({ ...p, notifyOwner: !p.notifyOwner }))}
              label="Notificar Proprietário"
              description="Receba uma notificação quando uma cobrança for enviada"
            />
            <div className="py-3">
              <label className="text-sm font-medium text-foreground block mb-2">Limite diário de mensagens</label>
              <input
                type="number"
                value={agentConfig.maxMessagesPerDay}
                onChange={(e) => setAgentConfig((p) => ({ ...p, maxMessagesPerDay: Number(e.target.value) }))}
                className="w-24 px-3 py-2 rounded-lg bg-muted/30 border border-border text-sm text-foreground focus:outline-hidden focus:ring-1 focus:ring-ring"
              />
            </div>
            <div className="py-3">
              <label className="text-sm font-medium text-foreground block mb-2 flex items-center gap-2">
                <Clock size={14} /> Horário de envio
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={0}
                  max={23}
                  value={agentConfig.workHourStart}
                  onChange={(e) => setAgentConfig((p) => ({ ...p, workHourStart: Number(e.target.value) }))}
                  className="w-16 px-3 py-2 rounded-lg bg-muted/30 border border-border text-sm text-foreground focus:outline-hidden"
                />
                <span className="text-sm text-muted-foreground">às</span>
                <input
                  type="number"
                  min={0}
                  max={23}
                  value={agentConfig.workHourEnd}
                  onChange={(e) => setAgentConfig((p) => ({ ...p, workHourEnd: Number(e.target.value) }))}
                  className="w-16 px-3 py-2 rounded-lg bg-muted/30 border border-border text-sm text-foreground focus:outline-hidden"
                />
                <span className="text-sm text-muted-foreground">horas</span>
              </div>
            </div>
          </div>

          <button
            onClick={saveConfig}
            className="w-full py-3 rounded-xl bg-primary text-primary-foreground font-medium hover:opacity-90 transition-opacity"
          >
            Salvar Configurações
          </button>
        </div>
      )}

      {/* ========== WHATSAPP TAB ========== */}
      {tab === "whatsapp" && (
        <div className="rounded-2xl border border-border bg-card p-6 space-y-6">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-foreground flex items-center gap-2"><MessageSquare size={20} /> Conexão WhatsApp</h2>
            {whatsappStatus === "connected" && (
              <button onClick={handleLogout} className="flex items-center gap-2 px-3 py-1.5 text-sm rounded-lg bg-destructive/10 text-destructive hover:bg-destructive/20 transition-colors">
                <LogOut size={14} /> Desconectar
              </button>
            )}
          </div>
          {whatsappStatus === "connected" ? (
            <div className="text-center py-10 space-y-4">
              <div className="w-20 h-20 rounded-full bg-primary/10 flex items-center justify-center mx-auto">
                <CheckCircle2 size={40} className="text-primary" />
              </div>
              <p className="text-lg font-semibold text-foreground">WhatsApp Conectado!</p>
              <p className="text-sm text-muted-foreground">Instância: <span className="font-mono text-xs bg-muted px-2 py-0.5 rounded">{instanceName}</span></p>
              <div className="bg-muted/30 border border-border rounded-xl p-3 text-left max-w-sm mx-auto">
                <p className="text-xs font-semibold text-foreground flex items-center gap-1.5"><Shield size={12} className="text-primary" /> Webhook de IA configurado automaticamente</p>
                <p className="text-[10px] text-muted-foreground mt-1">O atendente IA está ativo nesta instância, com memória de longo prazo por cliente.</p>
              </div>
              <div className="grid grid-cols-3 gap-3 max-w-sm mx-auto mt-4">
                <div className="rounded-xl bg-muted/30 border border-border p-3 text-center">
                  <p className="text-2xl font-bold text-foreground">{dashData?.clients.length || 0}</p>
                  <p className="text-xs text-muted-foreground">Clientes</p>
                </div>
                <div className="rounded-xl bg-muted/30 border border-border p-3 text-center">
                  <p className="text-2xl font-bold text-foreground">{overdue}</p>
                  <p className="text-xs text-muted-foreground">Atrasados</p>
                </div>
                <div className="rounded-xl bg-muted/30 border border-border p-3 text-center">
                  <p className="text-2xl font-bold text-primary">Ativo</p>
                  <p className="text-xs text-muted-foreground">Status</p>
                </div>
              </div>
            </div>
          ) : whatsappStatus === "qr_ready" && qrCode ? (
            <div className="text-center py-6 space-y-4">
              <p className="text-foreground font-medium">Escaneie o QR Code com seu WhatsApp</p>
              <div className="inline-block p-4 bg-white rounded-2xl shadow-lg">
                <img src={qrCode.startsWith("data:") ? qrCode : `data:image/png;base64,${qrCode}`} alt="QR Code" className="w-64 h-64 object-contain" />
              </div>
              {pollingQr && <p className="text-xs text-muted-foreground flex items-center justify-center gap-2"><Loader2 size={12} className="animate-spin" /> Aguardando...</p>}
              <button onClick={() => fetchQr()} className="flex items-center gap-2 mx-auto px-4 py-2 rounded-lg bg-muted/50 border border-border text-sm text-foreground hover:bg-muted transition-colors"><RefreshCw size={14} /> Novo QR</button>
            </div>
          ) : (
            <div className="text-center py-10 space-y-4">
              <div className="w-20 h-20 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto"><QrCode size={36} className="text-primary" /></div>
              <p className="text-foreground font-medium">Conectar WhatsApp</p>
              <p className="text-sm text-muted-foreground">Crie a instância e gere o QR Code automaticamente.</p>
              <button onClick={createInstance} disabled={whatsappStatus === "connecting" || whatsappStatus === "checking"} className="px-6 py-3 rounded-xl bg-primary text-primary-foreground text-sm font-semibold hover:opacity-90 transition-opacity disabled:opacity-50 flex items-center gap-2 mx-auto">
                {whatsappStatus === "connecting" || whatsappStatus === "checking" ? <><Loader2 size={16} className="animate-spin" /> Conectando...</> : <><Wifi size={16} /> Conectar WhatsApp</>}
              </button>
            </div>
          )}
        </div>
      )}

      {/* ========== CHAT IA TAB ========== */}
      {tab === "chat" && (
        <div className="space-y-4">
          {/* KPI Strip - Contexto que a IA vê */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {[
              { icon: <Users size={14} />, label: "Clientes", value: dashData?.clients.length || 0, color: "text-primary" },
              { icon: <DollarSign size={14} />, label: "Capital na rua", value: fmt(capitalOnStreet), color: "text-foreground" },
              { icon: <AlertTriangle size={14} />, label: "Em atraso", value: `${overdue} · ${fmt(overdueAmount)}`, color: overdue > 0 ? "text-destructive" : "text-success" },
              { icon: <TrendingUp size={14} />, label: "Lucro total", value: fmt(totalProfit), color: "text-success" },
            ].map((k) => (
              <div key={k.label} className="rounded-xl border border-border bg-card p-3">
                <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground uppercase tracking-wide">
                  {k.icon} {k.label}
                </div>
                <p className={`text-base font-bold mt-1 ${k.color}`}>{k.value}</p>
              </div>
            ))}
          </div>

        <div className="rounded-2xl border border-border bg-card flex flex-col min-h-[360px] h-[calc(100dvh-400px)] lg:h-[calc(100vh-400px)] lg:min-h-[420px]">
            <div className="px-4 py-2.5 border-b border-border flex items-center justify-between">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <CredinhoAvatar size={28} /><span>Credinho · IA conectada · {messages.filter(m => m.role === "user").length} pergunta{messages.filter(m => m.role === "user").length !== 1 ? "s" : ""}</span>
              </div>
              <button onClick={clearChat} className="flex items-center gap-1.5 px-2 py-1 rounded-md text-xs text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors">
                <Trash2 size={12} /> Limpar
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-4 notranslate" translate="no">
              {messages.length <= 1 && !loading && <div className="flex items-center gap-4 rounded-2xl border border-primary/15 bg-background/40 p-3"><Credinho pose="thinking" className="credinho-chat-intro" /><div><p className="text-sm font-semibold">Vamos encontrar seu próximo passo?</p><p className="mt-1 text-xs text-muted-foreground">Pergunte sobre sua carteira, seus clientes ou os resultados.</p></div></div>}
              {messages.map((msg, i) => (
                <div key={i} className={`group flex gap-3 ${msg.role === "user" ? "flex-row-reverse" : ""}`}>
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${msg.role === "assistant" ? "bg-primary/10" : "bg-accent"}`}>
                    {msg.role === "assistant" ? <CredinhoAvatar /> : <User size={16} className="text-foreground" />}
                  </div>
                  <div className={`max-w-[75%] rounded-xl px-4 py-2.5 text-sm relative ${msg.role === "assistant" ? "bg-muted/50 text-foreground" : "bg-primary text-primary-foreground"}`}>
                    <SafeMessageContent content={msg.content} />
                    <div className="flex items-center justify-between gap-2 mt-1.5">
                      <p className={`text-[10px] ${msg.role === "assistant" ? "text-muted-foreground" : "text-primary-foreground/60"}`}>
                        {msg.timestamp.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                      </p>
                      {msg.role === "assistant" && msg.content.length > 20 && (
                        <button onClick={() => copyMessage(msg.content)} className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-background/40">
                          <Copy size={11} className="text-muted-foreground" />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
              {loading && (
                <div className="flex gap-3">
                  <CredinhoAvatar />
                  <div className="bg-muted/50 rounded-xl px-4 py-3 text-sm text-muted-foreground flex items-center gap-2">
                    <Loader2 size={12} className="animate-spin" /> Analisando seus dados...
                  </div>
                </div>
              )}
              <div ref={scrollRef} />
            </div>

            {/* Quick prompts */}
            {messages.length <= 1 && !loading && (
              <div className="px-4 pb-2">
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-2 flex items-center gap-1.5">
                  <Sparkles size={10} /> Sugestões rápidas
                </p>
                <div className="grid grid-cols-2 gap-2">
                  {quickPrompts.map((q) => (
                    <button
                      key={q.label}
                      onClick={() => runQuickPrompt(q.prompt)}
                      className="flex items-center gap-2 px-3 py-2 rounded-lg bg-muted/30 border border-border text-xs text-foreground hover:bg-muted/60 hover:border-primary/40 transition-colors text-left"
                    >
                      <span className="text-primary">{q.icon}</span>
                      <span className="truncate">{q.label}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="border-t border-border p-3">
              <div className="flex gap-2">
                <input
                  ref={chatInputRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleSend()}
                  placeholder='Pergunte algo... (atalho: "/")'
                  className="flex-1 px-4 py-2.5 rounded-lg bg-primary/10 border border-primary/30 text-sm text-foreground placeholder:text-muted-foreground focus:outline-hidden focus:border-primary/60 focus:ring-2 focus:ring-primary/25"
                />
                <button onClick={() => handleSend()} disabled={!input.trim() || loading} className="p-2.5 rounded-lg bg-primary text-primary-foreground disabled:opacity-50 hover:opacity-90 transition-opacity">
                  {loading ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Metrics */}
      {tab === "metricas" && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              { label: "Capital na rua", value: fmt(capitalOnStreet), icon: <DollarSign size={16} />, color: "text-primary" },
              { label: "Lucro acumulado", value: fmt(totalProfit), icon: <TrendingUp size={16} />, color: "text-success" },
              { label: "Em atraso", value: fmt(overdueAmount), icon: <AlertTriangle size={16} />, color: overdue > 0 ? "text-destructive" : "text-muted-foreground" },
              { label: "Clientes ativos", value: dashData?.clients.filter((c: any) => c.status === "Ativo").length || 0, icon: <Users size={16} />, color: "text-foreground" },
            ].map((m) => (
              <div key={m.label} className="rounded-2xl border border-border bg-card p-5">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs text-muted-foreground uppercase tracking-wide">{m.label}</p>
                  <span className={m.color}>{m.icon}</span>
                </div>
                <p className={`text-2xl font-bold ${m.color}`}>{m.value}</p>
              </div>
            ))}
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              { label: "Conversas IA", value: messages.filter((m) => m.role === "user").length },
              { label: "Mensagens trocadas", value: messages.length },
              { label: "Conversas WhatsApp", value: whatsappChats.length },
              { label: "Não lidas", value: unreadCount },
              { label: "Parcelas atrasadas", value: overdue },
              { label: "Total contratos", value: dashData?.contracts.length || 0 },
              { label: "WhatsApp", value: whatsappStatus === "connected" ? "Online" : "Offline" },
              { label: "Chatbot", value: agentConfig.chatbotEnabled ? "Ativo" : "Pausado" },
            ].map((m) => (
              <div key={m.label} className="rounded-xl border border-border bg-card/60 p-4">
                <p className="text-[10px] text-muted-foreground uppercase tracking-wide">{m.label}</p>
                <p className="text-lg font-semibold text-foreground mt-1">{m.value}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Reports */}
      {tab === "relatorios" && (
        <div className="rounded-2xl border border-border bg-card p-6">
          <h2 className="font-semibold text-foreground mb-4">Insights do Portfólio</h2>
          <div className="space-y-3">
            {[
              dashData && dashData.clients.length > 0 ? `Você gerencia ${dashData.clients.length} clientes e ${dashData.contracts.length} contratos.` : null,
              overdue > 0 ? `⚠️ ${overdue} parcelas atrasadas precisam de ação.` : "✅ Nenhuma parcela atrasada!",
              whatsappStatus === "connected" ? "📱 WhatsApp conectado e pronto." : "📱 WhatsApp não conectado.",
              agentConfig.chatbotEnabled ? "🤖 Chatbot IA ativo." : "🤖 Chatbot desativado.",
              agentConfig.autoCollections ? "⚡ Cobranças automáticas ativas." : "⚡ Cobranças automáticas desativadas.",
            ].filter(Boolean).map((insight, i) => (
              <div key={i} className="px-4 py-3 rounded-lg bg-muted/30 border border-border text-sm text-foreground">{insight}</div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default AgenteIA;
