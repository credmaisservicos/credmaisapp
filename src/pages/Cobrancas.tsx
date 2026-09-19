import { useSessionPreference } from "@/hooks/useSessionPreference";
import { useState, useMemo, useEffect, useRef, useCallback } from "react";
import InstallmentRow from "@/components/cobrancas/InstallmentRow";
import PayModal from "@/components/cobrancas/PayModal";
import { useNavigate } from "react-router-dom";
import InadimplenciaPanel from "@/components/cobrancas/InadimplenciaPanel";
import {
  Receipt, Check, MessageSquare, Search, X, AlertTriangle, Clock, CheckCircle,
  CalendarDays, Mail, CheckSquare, Square, MinusSquare, List, Copy,
  Calendar as CalendarIcon, SlidersHorizontal, ArrowUpDown, Zap, Flame,
  History, Bell, Send, Phone, TrendingUp, Wallet, Percent, Sparkles, ExternalLink
  , ChevronDown, ChevronRight, Layers, ListTree
} from "lucide-react";
import { computeLateFee, computeLateFeeBreakdown } from "@/lib/lateFee";
import { applyInterestOnlyRenewalFallback, isMissingRpcError } from "@/lib/interestOnly";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMultiTableRealtime } from "@/hooks/useRealtimeSubscription";
import CalendarView from "@/components/cobrancas/CalendarView";
import { formatBR, parseLocalDate, todayLocalISO, toDateInputValue } from "@/lib/dateUtils";
import EmptyState from "@/components/EmptyState";
import { SkeletonList } from "@/components/feedback/Skeletons";
import ErrorState from "@/components/feedback/ErrorState";
import CollectionMetrics from "@/components/cobrancas/CollectionMetrics";
import { fetchAll } from "@/lib/fetchAll";
import { formatPhoneBR, getPreferredPhone } from "@/lib/phone";
import { renderMessage } from "@/lib/messageTemplate";
import { useWhiteLabel } from "@/contexts/WhiteLabelContext";
import { isEmAberto, isEmAtraso } from "../../supabase/functions/_shared/installmentStatus";
import { portalInstallmentAmount } from "@/lib/portalAmounts";
import "@/cobrancas-overrides.css";

const safeNumber = (value: unknown, fallback = 0) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
};
const fmt = (v: number) => safeNumber(v).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const relTime = (iso: string) => {
  const d = new Date(iso).getTime();
  if (!Number.isFinite(d)) return "—";
  const diff = Math.max(0, Date.now() - d);
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "agora";
  if (mins < 60) return `${mins}min`;
  const h = Math.floor(mins / 60);
  if (h < 24) return `${h}h`;
  const days = Math.floor(h / 24);
  return `${days}d`;
};

// Frase humana para a próxima parcela do grupo (ou a mais atrasada)
const humanDueLabel = (items: any[]): { text: string; tone: "danger" | "warn" | "ok" | "muted" } => {
  const unpaid = items.filter((i: any) => isEmAberto(i));
  if (!unpaid.length) return { text: "Tudo em dia", tone: "ok" };
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const startOfDay = (d: Date) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
  const withDates = unpaid.map((i: any) => ({ i, d: parseLocalDate(i.due_date) })).filter((x: any) => x.d).map((x: any) => ({ i: x.i, d: startOfDay(x.d!) }));
  if (!withDates.length) return { text: `${unpaid.length} pendente(s)`, tone: "muted" };
  const overdue = withDates.filter((x: any) => x.d.getTime() < today.getTime());
  if (overdue.length) {
    const maxDays = Math.max(...overdue.map((x: any) => Math.round((today.getTime() - x.d.getTime()) / 86400000)));
    return { text: overdue.length === 1 ? `há ${maxDays} dia${maxDays === 1 ? "" : "s"} em atraso` : `${overdue.length} parcelas em atraso · até ${maxDays}d`, tone: "danger" };
  }
  withDates.sort((a: any, b: any) => a.d.getTime() - b.d.getTime());
  const next = withDates[0];
  const diffDays = Math.round((next.d.getTime() - today.getTime()) / 86400000);
  if (diffDays === 0) return { text: "vence hoje", tone: "warn" };
  if (diffDays === 1) return { text: "vence amanhã", tone: "warn" };
  if (diffDays <= 7) return { text: `vence em ${diffDays} dias`, tone: "warn" };
  return { text: `vence em ${diffDays} dias`, tone: "muted" };
};

type StatusFilter = "all" | "pending" | "overdue" | "paid";
type PeriodFilter = "all" | "today" | "tomorrow" | "7d" | "30d" | "future";
type SortKey = "priority" | "due_asc" | "due_desc" | "amount_desc" | "amount_asc" | "overdue_days";

const collectionPriority = (installment: any) => {
  const due = parseLocalDate(installment.due_date);
  const days = due ? Math.max(0, Math.floor((Date.now() - due.getTime()) / 86400000)) : 0;
  const amount = safeNumber(installment.amount);
  const score = safeNumber(installment.clients?.credit_score, 100);
  return (isEmAtraso(installment) ? 10_000 : 0) + days * 100 + Math.min(amount, 10_000) + Math.max(0, 100 - score) * 10;
};

const useDebounced = <T,>(value: T, ms = 180) => {
  const [v, setV] = useState(value);
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t); }, [value, ms]);
  return v;
};

const Cobrancas = () => {
  const { user, profile } = useAuth();
  // Nome da empresa vem do white-label do assinante, não de um literal no código.
  const { config: whiteLabel } = useWhiteLabel();
  const navigate = useNavigate();
  const { toast } = useToast();
  const qc = useQueryClient();
  const preferenceKey = `cobrancas:v1:${user?.id ?? "anon"}:`;
  const [filter, setFilter] = useSessionPreference<StatusFilter>(preferenceKey + "status", "all", ["all", "overdue", "paid", "pending"]);
  const [period, setPeriod] = useSessionPreference<PeriodFilter>(preferenceKey + "period", "all", ["all", "today", "tomorrow", "7d", "30d", "future"]);
  const [sort, setSort] = useSessionPreference<SortKey>(preferenceKey + "sort", "priority", ["priority", "due_asc", "due_desc", "amount_desc", "amount_asc", "overdue_days"]);
  const [search, setSearch] = useSessionPreference<string>(preferenceKey + "search", "");
  const dSearch = useDebounced(search, 180);
  const [confirmPayId, setConfirmPayId] = useState<string | null>(null);
  const [bulkPayOpen, setBulkPayOpen] = useState(false);
  const [bulkPaying, setBulkPaying] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [view, setView] = useSessionPreference<"list" | "calendar">(preferenceKey + "view", "list", ["list", "calendar"]);
  const [cobrarAteOpen, setCobrarAteOpen] = useState(false);
  const [bulkPreview, setBulkPreview] = useState<null | { groups: { clientId: string; clientName: string; phone: string; message: string; items: any[] }[]; skipped: number; totalItems: number }>(null);
  const [bulkSending, setBulkSending] = useState(false);
  const [previewEditIdx, setPreviewEditIdx] = useState<number | null>(null);
  const todayISO = todayLocalISO();
  const [cobrarAteDate, setCobrarAteDate] = useState<string>(todayISO);
  const [cobrarAteSelected, setCobrarAteSelected] = useState<Set<string>>(new Set());
  const [focoDia, setFocoDia] = useSessionPreference<boolean>(preferenceKey + "focoDia", false);
  const [bucket, setBucket] = useSessionPreference<"all" | "today" | "1-7" | "8-30" | "30+">(preferenceKey + "bucket", "all", ["all", "today", "1-7", "8-30", "30+"]);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [groupMode, setGroupMode] = useSessionPreference<"expanded" | "collapsed">(preferenceKey + "groupMode", "collapsed", ["expanded", "collapsed"]);
  const toggleGroupCollapse = useCallback((cid: string) => {
    setCollapsed(prev => {
      const n = new Set(prev);
      if (n.has(cid)) n.delete(cid);
      else n.add(cid);
      return n;
    });
  }, []);
  const [historyFor, setHistoryFor] = useState<{ installmentId: string; clientName: string } | null>(null);
  const [showAutomation, setShowAutomation] = useState(false);
  const [showAging, setShowAging] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  // Keyboard "/" focus
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (e.key === "/" && tag !== "INPUT" && tag !== "TEXTAREA") {
        e.preventDefault();
        searchRef.current?.focus();
      } else if (e.key === "Escape" && document.activeElement === searchRef.current) {
        setSearch(""); searchRef.current?.blur();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setSearch]);

  useMultiTableRealtime(
    ["contract_installments", "contracts"],
    [["cobrancas-installments", user?.id || ""]],
  );

  const { data: installments = [], isLoading: loading, error: loadError, refetch: refetchInstallments } = useQuery({
    queryKey: ["cobrancas-installments", user?.id],
    queryFn: async () => {
      const data = await fetchAll((f, t) => supabase
        .from("contract_installments")
        .select("*, clients:client_id(name, phone, whatsapp, email, credit_score), contracts(capital, frequency, interest_rate, num_installments, total_amount, total_interest, loan_mode, daily_interest_percent, max_interest_cap_percent, daily_penalty_type, daily_penalty_value)")
        .eq("user_id", user!.id)
        .order("due_date", { ascending: true })
        .range(f, t));

      const today = new Date(); today.setHours(0,0,0,0);
      return (data || []).map((inst: any) => {
        const client = inst.clients;
        const isOverdue = isEmAtraso(inst, today);
        return {
          ...inst,
          status: isOverdue ? "overdue" : inst.status,
          client_name: client?.name || "—",
          // Cadastro aceita Telefone ou WhatsApp. Para cobrança, ambos são o
          // mesmo canal de contato e o WhatsApp preenchido tem prioridade.
          client_phone: getPreferredPhone(client),
          client_email: client?.email || null,
        };
      });
    },
    enabled: !!user,
  });

  const { data: attempts = [] } = useQuery({
    queryKey: ["collection-attempts", user?.id],
    queryFn: async () => {
      return fetchAll((from, to) => supabase
        .from("collection_attempts")
        .select("id, installment_id, client_id, channel, message_preview, created_at")
        .eq("user_id", user!.id)
        .order("created_at", { ascending: false })
        .range(from, to));
    },
    enabled: !!user,
    staleTime: 30_000,
  });

  const lastAttemptByInst = useMemo(() => {
    const m = new Map<string, any>();
    for (const a of attempts) if (a.installment_id && !m.has(a.installment_id)) m.set(a.installment_id, a);
    return m;
  }, [attempts]);

  const { data: reminderSettings, refetch: refetchSettings } = useQuery({
    queryKey: ["cobr-reminder-settings", user?.id],
    queryFn: async () => {
      const { data } = await supabase.from("settings")
        .select("bot_send_hour, bot_send_minute, bot_auto_send")
        .eq("user_id", user!.id).maybeSingle();
      return data || { bot_send_hour: 9, bot_send_minute: 0, bot_auto_send: false };
    },
    enabled: !!user,
  });

  const logAttempt = async (inst: any, channel: "whatsapp" | "email" | "pix_copy" | "manual", preview?: string) => {
    if (!user) return;
    const { error } = await supabase.from("collection_attempts").insert({
        user_id: user.id,
        client_id: inst.client_id,
        contract_id: inst.contract_id,
        installment_id: inst.id,
        channel,
        message_preview: (preview || "").slice(0, 280),
      });
    if (error) {
      console.error("[cobrancas] falha ao registrar tentativa", error);
      toast({ title: "Cobrança aberta, mas o histórico não foi salvo", description: "Tente registrar novamente para manter a auditoria.", variant: "destructive" });
      return;
    }
    qc.invalidateQueries({ queryKey: ["collection-attempts", user.id] });
  };


  // Pagamento atômico via RPC no servidor: atualiza a parcela, lança lucro (juros
  // reais do contrato) e caixa (só o dinheiro novo) e conclui o contrato — tudo
  // numa transação. Elimina os estados inconsistentes das escritas separadas.
  const markPaidOne = async (inst: any, paidValue?: number) => {
    if (!user) return;
    const paid = Math.max(0, safeNumber(paidValue ?? computeLateFeeBreakdown(inst).withFees));
    const { error } = await supabase.rpc("pay_installment", {
      _installment_id: inst.id,
      _paid_total: paid,
      _mark_paid: true,
      _method: "pix",
      _receipt_url: null,
      _source_key: null,
    });
    if (error) throw error;
  };

  const markPaidPartial = async (inst: any, amount: number) => {
    if (!user) return;
    const prev = Math.max(0, safeNumber(inst.paid_amount));
    const next = Math.round((prev + Math.max(0, safeNumber(amount))) * 100) / 100;
    const { error } = await supabase.rpc("pay_installment", {
      _installment_id: inst.id,
      _paid_total: next,
      _mark_paid: false,
      _method: "pix",
      _receipt_url: null,
      _source_key: null,
    });
    if (error) throw error;
  };

  const optimisticMarkPaid = (ids: string[]) => {
    const key = ["cobrancas-installments", user?.id];
    const prev = qc.getQueryData<any[]>(key);
    qc.setQueryData<any[]>(key, (old) =>
      (old || []).map((i: any) =>
        ids.includes(i.id)
          ? { ...i, status: "paid", paid_at: new Date().toISOString(), paid_amount: computeLateFeeBreakdown(i).withFees, _optimistic: true }
          : i
      )
    );
    return prev;
  };

  const handleMarkPaid = async (
    id: string,
    paidValue?: number,
    feeDiscount = 0,
    options?: { mode: "payment" | "interest_only" | "settle"; nextDueDate?: string },
  ) => {
    const inst = installments.find((i: any) => i.id === id);
    if (!inst) return;
    if (options?.mode === "interest_only") {
      if (!options.nextDueDate) return;
      const { data, error } = await (supabase as any).rpc("renew_installment_interest", {
        _installment_id: id,
        _next_due_date: options.nextDueDate,
        _method: "pix",
        _origin: "cobrancas",
      });
      if (error) {
        // Banco ainda sem a migração da RPC: renova direto pelas tabelas
        // protegidas por RLS, do mesmo jeito que o detalhe do cliente já faz.
        if (!isMissingRpcError(error) || !user?.id) {
          toast({ title: "Erro ao renovar vencimento", description: error.message, variant: "destructive" });
          throw error;
        }
        try {
          await applyInterestOnlyRenewalFallback(supabase, {
            userId: user.id,
            installment: inst,
            nextDueDate: options.nextDueDate,
            received: Math.max(0, safeNumber(paidValue)),
            method: "pix",
            origin: "cobrancas",
          });
        } catch (fallbackError: any) {
          toast({ title: "Erro ao renovar vencimento", description: fallbackError.message, variant: "destructive" });
          throw fallbackError;
        }
      }
      setConfirmPayId(null);
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["cobrancas-installments"] }),
        qc.invalidateQueries({ queryKey: ["dashboard-data"] }),
      ]);
      toast({
        title: "✓ Juros recebidos e vencimento renovado",
        description: `Recebido R$ ${fmt(Number(data?.amount || paidValue || 0))}. Novo vencimento: ${formatBR(options.nextDueDate)}.`,
      });
      return;
    }
    if (options?.mode === "settle") {
      const { error } = await (supabase as any).rpc("settle_percentage_installment", {
        _installment_id: id,
        _method: "pix",
      });
      if (error) {
        toast({ title: "Erro ao quitar contrato", description: error.message, variant: "destructive" });
        throw error;
      }
      setConfirmPayId(null);
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["cobrancas-installments"] }),
        qc.invalidateQueries({ queryKey: ["dashboard-data"] }),
      ]);
      toast({ title: "✓ Contrato quitado", description: "Capital e juros foram registrados separadamente." });
      return;
    }
    const { withFees, base } = computeLateFeeBreakdown(inst);
    const appliedDiscount = Math.max(0, Math.min(safeNumber(feeDiscount), Math.max(0, withFees - base)));
    const totalDue = Math.round((withFees - appliedDiscount) * 100) / 100;
    const alreadyPaid = Number(inst.paid_amount || 0);
    const remaining = Math.max(0, Math.round((totalDue - alreadyPaid) * 100) / 100);
    const value = Math.max(0, safeNumber(paidValue ?? remaining));
    if (value <= 0 && totalDue > alreadyPaid + 0.005) { toast({ title: "Informe um valor válido", variant: "destructive" }); return; }

    const isFull = value + 0.005 >= remaining;

    if (isFull) {
      const snapshot = optimisticMarkPaid([id]);
      try {
        await markPaidOne(inst, alreadyPaid + value);
        setConfirmPayId(null);
        qc.invalidateQueries({ queryKey: ["cobrancas-installments"] });
        qc.invalidateQueries({ queryKey: ["dashboard-data"] });
        toast({
          title: appliedDiscount > 0 ? "✓ Parcela quitada com desconto" : "✓ Parcela quitada!",
          description: appliedDiscount > 0 ? `Desconto de R$ ${fmt(appliedDiscount)} nos encargos.` : undefined,
        });
      } catch (e: any) {
        qc.setQueryData(["cobrancas-installments", user?.id], snapshot);
        toast({ title: appliedDiscount > 0 ? "Não foi possível aplicar o desconto" : "Erro ao registrar pagamento", description: e.message, variant: "destructive" });
        throw e;
      }
    } else {
      try {
        await markPaidPartial(inst, value);
        setConfirmPayId(null);
        qc.invalidateQueries({ queryKey: ["cobrancas-installments"] });
        qc.invalidateQueries({ queryKey: ["dashboard-data"] });
        toast({ title: "✓ Pagamento parcial registrado", description: `Restam R$ ${fmt(remaining - value)}` });
      } catch (e: any) {
        toast({ title: "Erro ao registrar pagamento parcial", description: e.message, variant: "destructive" });
        throw e;
      }
    }
  };

  const handleBulkMarkPaid = async () => {
    const items = installments.filter((i: any) => selected.has(i.id) && isEmAberto(i));
    if (items.length === 0) { toast({ title: "Nada para pagar" }); return; }
    optimisticMarkPaid(items.map((i: any) => i.id));
    setBulkPaying(true);
    setBulkPayOpen(false);
    setSelected(new Set());
    let ok = 0, fail = 0;
    for (const inst of items) {
      try { await markPaidOne(inst); ok++; } catch { fail++; }
    }
    setBulkPaying(false);
    qc.invalidateQueries({ queryKey: ["cobrancas-installments"] });
    qc.invalidateQueries({ queryKey: ["dashboard-data"] });
    toast({
      title: `✓ ${ok} parcela(s) pagas`,
      description: fail > 0 ? `${fail} pagamento(s) não foram aplicados.` : undefined,
    });
  };

  const buildMessage = (inst: any, opts: { includePix?: boolean } = {}) => {
    const portalUrl = `${window.location.origin}/portal-cliente?o=${user!.id}`;
    const total = inst.contracts?.num_installments || inst.total_installments || "";
    const parcelaInfo = total ? `${inst.installment_number}/${total}` : `${inst.installment_number}`;
    const nome = inst.client_name || "";
    const bd = computeLateFeeBreakdown(inst);
    const paid = Number(inst.paid_amount || 0);
    const valorAtualizado = Math.max(0, Math.round((bd.withFees - paid) * 100) / 100);
    const valor = fmt(valorAtualizado);
    const data = formatBR(inst.due_date);
    const feeLine = bd.total > 0
      ? `Parcela: R$ ${fmt(bd.base)}\nJuros de atraso (${bd.jurosPct}% ao dia · ${bd.daysLate} dia${bd.daysLate !== 1 ? "s" : ""}): R$ ${fmt(bd.total)}\n*Total atualizado: R$ ${valor}*`
      : `Valor: R$ ${valor}`;
    const customTemplate = profile?.billing_message;
    let base: string;
    if (customTemplate) {
      // Renderizador compartilhado com o bot: mesma lista de variáveis nos dois.
      // A versão anterior fixava "CredMais App" como [Nome da Empresa] — quem usa
      // o sistema com a própria marca mandava o nome errado para o cliente.
      base = renderMessage(customTemplate, {
        nome,
        empresa: whiteLabel.companyName || "",
        parcela: parcelaInfo,
        numero: String(inst.installment_number ?? ""),
        juros: fmt(bd.total),
        valor,
        data,
        portal: portalUrl,
        pix: (profile as any)?.pix_key ?? "",
      }).replace(/Sr\(a\)\s*/g, "");
      if (bd.total > 0 && !/juros|multa/i.test(customTemplate)) {
        base += `\n\nJuros de atraso (${bd.jurosPct}% ao dia · ${bd.daysLate} dia${bd.daysLate !== 1 ? "s" : ""}): R$ ${fmt(bd.total)}\nTotal atualizado: R$ ${valor}`;
      }
    } else {
      // Mensagem curta padrão
      base = `*Aviso de pagamento*\n${nome}\nParcela ${parcelaInfo}\n${feeLine}\nVenceu em ${data}\n\nPortal: ${portalUrl}`;
    }
    const pix = (profile as any)?.pix_key;
    if (opts.includePix && pix && !/PIX/i.test(base)) {
      base += `\n\nPIX: ${pix}`;
    }
    return base;
  };


  const handleWhatsApp = (inst: any, opts: { withPix?: boolean } = {}) => {
    if (!inst.client_phone) { toast({ title: "Sem telefone", variant: "destructive" }); return; }
    const phone = inst.client_phone.replace(/\D/g, "");
    const withPix = opts.withPix ?? !!(profile as any)?.pix_key;
    const message = buildMessage(inst, { includePix: withPix });
    if (withPix && (profile as any)?.pix_key) {
      navigator.clipboard?.writeText((profile as any).pix_key).catch(() => {});
    }
    window.open(`https://wa.me/${phone.startsWith("55") ? phone : "55" + phone}?text=${encodeURIComponent(message)}`, "_blank", "noopener,noreferrer");
    logAttempt(inst, "whatsapp", message);
  };

  const handleEmail = (inst: any) => {
    if (!inst.client_email) { toast({ title: "Sem e-mail", variant: "destructive" }); return; }
    const totalSub = inst.contracts?.num_installments;
    const subject = `Cobrança - Parcela ${inst.installment_number}${totalSub ? ` de ${totalSub}` : ""}`;
    const body = buildMessage(inst, { includePix: true });
    window.open(`mailto:${inst.client_email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`, "_blank", "noopener,noreferrer");
    logAttempt(inst, "email", body);
  };


  const toggleSelect = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    const selectable = filtered.filter((i: any) => isEmAberto(i)).map((i: any) => i.id);
    const allSelected = selectable.length > 0 && selectable.every((id: string) => selected.has(id));
    setSelected(allSelected ? new Set() : new Set(selectable));
  };

  const getSelectedItems = () => installments.filter((i: any) => selected.has(i.id));

  const buildBulkWhatsAppMessage = (clientName: string, items: any[]) => {
    const pix = (profile as any)?.pix_key;
    const portalUrl = `${window.location.origin}/portal-cliente?o=${user!.id}`;
    let total = 0;
    let totalFees = 0;
    const lines = items.map((i: any) => {
      const bd = computeLateFeeBreakdown(i);
      const paid = Number(i.paid_amount || 0);
      const due = Math.max(0, Math.round((bd.withFees - paid) * 100) / 100);
      total += due;
      totalFees += bd.total;
      const extra = bd.total > 0 ? ` (parcela R$ ${fmt(bd.base)} + juros R$ ${fmt(bd.total)} · ${bd.daysLate}d)` : "";
      return `Parcela ${i.installment_number} — R$ ${fmt(due)} — venceu ${formatBR(i.due_date)}${extra}`;
    }).join("\n");
    const feesBlock = totalFees > 0 ? `\nJuros de atraso: R$ ${fmt(totalFees)}` : "";
    const pixBlock = pix ? `\n\nPIX: ${pix}` : "";
    return `*Aviso de pagamento*\n${clientName}\n${lines}${feesBlock}\n*Total atualizado: R$ ${fmt(total)}*${pixBlock}\n\nPortal: ${portalUrl}`;

  };

  const handleBulk = (channel: "whatsapp" | "email") => {
    let items = getSelectedItems().filter((i: any) => isEmAberto(i));
    if (!items.length) {
      const overdue = filtered.filter((i: any) => i.status === "overdue");
      if (!overdue.length) { toast({ title: "Selecione parcelas ou tenha atrasadas" }); return; }
      items = overdue;
    }

    if (channel === "whatsapp") {
      // Agrupar por cliente para enviar UMA mensagem consolidada com PIX
      const byClient = new Map<string, any[]>();
      items.forEach((i: any) => {
        if (!byClient.has(i.client_id)) byClient.set(i.client_id, []);
        byClient.get(i.client_id)!.push(i);
      });
      const groups: { clientId: string; clientName: string; phone: string; message: string; items: any[] }[] = [];
      let skipped = 0;
      byClient.forEach((clientItems, clientId) => {
        const first = clientItems[0];
        if (!first.client_phone) { skipped++; return; }
        const phone = first.client_phone.replace(/\D/g, "");
        const num = phone.startsWith("55") ? phone : `55${phone}`;
        groups.push({
          clientId,
          clientName: first.client_name,
          phone: num,
          message: buildBulkWhatsAppMessage(first.client_name, clientItems),
          items: clientItems,
        });
      });
      if (!groups.length) {
        toast({ title: "Nenhum cliente com telefone válido", description: `${skipped} parcela(s) sem contato.` });
        return;
      }
      setBulkPreview({ groups, skipped, totalItems: items.length });
      return;
    }

    let opened = 0, skipped = 0;
    items.forEach((inst: any, idx: number) => {
      if (!inst.client_email) { skipped++; return; }
      setTimeout(() => handleEmail(inst), idx * 350);
      opened++;
    });
    toast({
      title: `Enviando ${opened} cobrança(s) por E-mail`,
      description: skipped > 0 ? `${skipped} cliente(s) sem contato e foram ignorados.` : undefined,
    });
    setSelected(new Set());
  };


  const confirmBulkPreview = async () => {
    if (!bulkPreview) return;
    setBulkSending(true);
    const pix = (profile as any)?.pix_key;
    if (pix) navigator.clipboard?.writeText(pix).catch(() => {});
    bulkPreview.groups.forEach((g, idx) => {
      setTimeout(() => {
        window.open(`https://wa.me/${g.phone}?text=${encodeURIComponent(g.message)}`, "_blank", "noopener,noreferrer");
        g.items.forEach((i: any) => logAttempt(i, "whatsapp", g.message));
      }, idx * 400);
    });
    toast({
      title: `📲 ${bulkPreview.groups.length} cliente(s) sendo cobrado(s) via WhatsApp`,
      description: `${bulkPreview.totalItems} parcela(s) consolidada(s). ${pix ? "Chave PIX copiada. " : ""}${bulkPreview.skipped > 0 ? `${bulkPreview.skipped} sem telefone.` : ""}`.trim(),
    });
    setSelected(new Set());
    setBulkPreview(null);
    setPreviewEditIdx(null);
    // Refresh installments so the new "cobrado" status from the DB trigger shows up
    setTimeout(() => {
      qc.invalidateQueries({ queryKey: ["cobrancas-installments"] });
    }, 800);
    setBulkSending(false);
  };

  // Filtering + sorting
  const filtered = useMemo(() => {
    const q = dSearch.trim().toLowerCase();
    const now = new Date(); now.setHours(0, 0, 0, 0);
    const in7 = new Date(now); in7.setDate(in7.getDate() + 7);
    const in30 = new Date(now); in30.setDate(in30.getDate() + 30);
    const tomorrow = new Date(now); tomorrow.setDate(tomorrow.getDate() + 1);

    let arr = installments.filter((inst: any) => {
      if (inst.status === "cancelled") return false;
      if (filter !== "all" && inst.status !== filter) return false;
      if (focoDia) {
        if (inst.status === "paid") return false;
        const d = parseLocalDate(inst.due_date);
        if (!d) return false;
        // Focar do dia = atrasadas + vence hoje
        if (d > now) return false;
      }
      if (bucket !== "all") {
        if (inst.status === "paid") return false;
        const d = parseLocalDate(inst.due_date);
        if (!d) return false;
        const days = Math.floor((now.getTime() - d.getTime()) / 86400000);
        if (bucket === "today" && days !== 0) return false;
        if (bucket === "1-7" && (days < 1 || days > 7)) return false;
        if (bucket === "8-30" && (days < 8 || days > 30)) return false;
        if (bucket === "30+" && days <= 30) return false;
      }
      if (q) {
        const name = (inst.client_name || "").toLowerCase();
        const num = `${inst.installment_number}`;
        const amt = String(inst.amount);
        if (!name.includes(q) && !num.includes(q) && !amt.includes(q)) return false;
      }
      if (period !== "all") {
        const d = parseLocalDate(inst.due_date);
        if (!d) return false;
        if (period === "today") {
          const same = d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
          if (!same) return false;
        } else if (period === "tomorrow") {
          const same = d.getFullYear() === tomorrow.getFullYear() && d.getMonth() === tomorrow.getMonth() && d.getDate() === tomorrow.getDate();
          if (!same) return false;
        } else if (period === "7d") {
          if (d < now || d >= in7) return false;
        } else if (period === "30d") {
          if (d < now || d >= in30) return false;
        } else if (period === "future") {
          if (d < tomorrow) return false;
        }
      }
      return true;
    });

    const ts = (s: string) => (parseLocalDate(s)?.getTime() ?? 0);
    const overdueDays = (i: any) => Math.max(0, Math.floor((Date.now() - ts(i.due_date)) / 86400000));
    if (sort === "priority") arr = [...arr].sort((a, b) => collectionPriority(b) - collectionPriority(a));
    else if (sort === "due_asc") arr = [...arr].sort((a, b) => ts(a.due_date) - ts(b.due_date));
    else if (sort === "due_desc") arr = [...arr].sort((a, b) => ts(b.due_date) - ts(a.due_date));
    else if (sort === "amount_desc") arr = [...arr].sort((a, b) => safeNumber(b.amount) - safeNumber(a.amount));
    else if (sort === "amount_asc") arr = [...arr].sort((a, b) => safeNumber(a.amount) - safeNumber(b.amount));
    else if (sort === "overdue_days") arr = [...arr].sort((a, b) => overdueDays(b) - overdueDays(a));
    return arr;
  }, [installments, filter, period, sort, dSearch, focoDia, bucket]);

  // Aggregate per-client contract facts using ALL installments (unfiltered) so numbers are stable
  const clientAggregates = useMemo(() => {
    // Which contracts still have any non-paid installment (active contracts only)
    const contractHasOpen = new Map<string, boolean>();
    for (const inst of installments as any[]) {
      if (!inst.contract_id) continue;
      if (isEmAberto(inst)) contractHasOpen.set(inst.contract_id, true);
      else if (!contractHasOpen.has(inst.contract_id)) contractHasOpen.set(inst.contract_id, false);
    }
    const m = new Map<string, { loaned: number; totalInstallments: number; grossExpected: number; paidAmount: number; paidCount: number; overdueCount: number; overdueFees: number; overdueAmount: number }>();
    const seenContracts = new Map<string, Set<string>>();
    for (const inst of installments as any[]) {
      const cid = inst.client_id;
      // Skip installments of fully-paid / finished contracts
      if (inst.contract_id && !contractHasOpen.get(inst.contract_id)) continue;
      if (!m.has(cid)) { m.set(cid, { loaned: 0, totalInstallments: 0, grossExpected: 0, paidAmount: 0, paidCount: 0, overdueCount: 0, overdueFees: 0, overdueAmount: 0 }); seenContracts.set(cid, new Set()); }

      const agg = m.get(cid)!;
      const set = seenContracts.get(cid)!;
      if (inst.contract_id && !set.has(inst.contract_id)) {
        set.add(inst.contract_id);
        const c = inst.contracts || {};
        agg.loaned += safeNumber(c.capital);
        agg.totalInstallments += safeNumber(c.num_installments);
      }
      agg.grossExpected += safeNumber(inst.amount);
      if (inst.status === "paid") {
        agg.paidCount += 1;
        // Usa o valor contratual da parcela (sem multa) para "recebido"
        agg.paidAmount += safeNumber(inst.amount);
      }
      if (inst.status === "overdue") {
        agg.overdueCount += 1;
        agg.overdueAmount += safeNumber(inst.amount);
        agg.overdueFees += computeLateFee(inst);
      }
    }

    return m;
  }, [installments]);

  const grouped = useMemo(() => {
    const map = new Map<string, { client_id: string; client_name: string; items: any[]; total: number; totalWithFees: number; totalFees: number; minDue: string }>();
    filtered.forEach((inst: any) => {
      if (!map.has(inst.client_id)) {
        map.set(inst.client_id, { client_id: inst.client_id, client_name: inst.client_name, items: [], total: 0, totalWithFees: 0, totalFees: 0, minDue: inst.due_date });
      }
      const g = map.get(inst.client_id)!;
      g.items.push(inst);
      if (isEmAberto(inst)) {
        const base = safeNumber(inst.amount);
        const fee = computeLateFee(inst);
        g.total += base;
        g.totalFees += fee;
        g.totalWithFees += base + fee;
      }
      if (inst.due_date < g.minDue) g.minDue = inst.due_date;
    });

    const groups = Array.from(map.values());
    const key = (g: any) => {
      if (sort === "priority") return -Math.max(...g.items.map(collectionPriority));
      if (sort === "amount_desc") return -g.total;
      if (sort === "amount_asc") return g.total;
      if (sort === "overdue_days") {
        const maxDays = Math.max(...g.items.map((i: any) => {
          const d = parseLocalDate(i.due_date);
          return d ? Math.max(0, Math.floor((Date.now() - d.getTime()) / 86400000)) : 0;
        }));
        return -maxDays;
      }
      const t = parseLocalDate(g.minDue)?.getTime() ?? 0;
      return sort === "due_desc" ? -t : t;
    };
    groups.sort((a, b) => key(a) - key(b));
    groups.forEach((g: any) => {
      g.items.sort((a: any, b: any) => {
        if (sort === "priority") return collectionPriority(b) - collectionPriority(a);
        if (sort === "amount_desc") return safeNumber(b.amount) - safeNumber(a.amount);
        if (sort === "amount_asc") return safeNumber(a.amount) - safeNumber(b.amount);
        if (sort === "overdue_days") {
          const da = parseLocalDate(a.due_date) ? Math.max(0, Math.floor((Date.now() - parseLocalDate(a.due_date)!.getTime()) / 86400000)) : 0;
          const db = parseLocalDate(b.due_date) ? Math.max(0, Math.floor((Date.now() - parseLocalDate(b.due_date)!.getTime()) / 86400000)) : 0;
          return db - da;
        }
        const ta = parseLocalDate(a.due_date)?.getTime() ?? 0;
        const tb = parseLocalDate(b.due_date)?.getTime() ?? 0;
        return sort === "due_desc" ? tb - ta : ta - tb;
      });
    });
    return groups;
  }, [filtered, sort]);

  const stats = useMemo(() => {
    const pending = installments.filter((i: any) => isEmAberto(i) && !isEmAtraso(i));
    const overdue = installments.filter((i: any) => isEmAtraso(i));
    const paid = installments.filter((i: any) => i.status === "paid");
    const totalPending = pending.reduce((s: number, i: any) => s + portalInstallmentAmount(i), 0)
      + overdue.reduce((s: number, i: any) => s + portalInstallmentAmount(i), 0);
    const totalOverdue = overdue.reduce((s: number, i: any) => s + portalInstallmentAmount(i), 0);
    const totalPaid = paid.reduce((s: number, i: any) => s + safeNumber(i.paid_amount ?? i.amount), 0);
    const totalContracts = installments.length;
    const inadimplencia = totalContracts > 0 ? (overdue.length / totalContracts) * 100 : 0;
    return {
      total: installments.length,
      pending: pending.length,
      overdue: overdue.length,
      paid: paid.length,
      totalPending, totalOverdue, totalPaid, inadimplencia,
    };
  }, [installments]);

  // Selected sum
  const selectedSum = useMemo(() => {
    return getSelectedItems().reduce((s: number, i: any) => s + portalInstallmentAmount(i), 0);
  }, [selected, installments]);

  const dueTodayStats = useMemo(() => {
    const today = new Date(); today.setHours(0,0,0,0);
    const items = installments.filter((i: any) => {
      if (!isEmAberto(i)) return false;
      const d = parseLocalDate(i.due_date);
      return d && d.toDateString() === today.toDateString();
    });
    return { count: items.length, total: items.reduce((s: number, i: any) => s + portalInstallmentAmount(i), 0) };
  }, [installments]);

  const activeFilters = (period !== "all" ? 1 : 0) + (sort !== "priority" ? 1 : 0) + (focoDia ? 1 : 0) + (bucket !== "all" ? 1 : 0);
  const clearFilters = () => { setPeriod("all"); setSort("priority"); setFocoDia(false); setBucket("all"); };
  const applyFocus = useCallback((k: "hoje" | "amanha" | "atrasadas" | "7d" | "todas" | "pagas") => {
    setFocoDia(false); setBucket("all");
    if (k === "hoje") { setPeriod("today"); setFilter("all"); }
    else if (k === "amanha") { setPeriod("tomorrow"); setFilter("all"); }
    else if (k === "atrasadas") { setPeriod("all"); setFilter("overdue"); }
    else if (k === "7d") { setPeriod("7d"); setFilter("all"); }
    else if (k === "todas") { setPeriod("all"); setFilter("all"); }
    else if (k === "pagas") { setPeriod("all"); setFilter("paid"); }
  }, []);

  const copyPix = async (inst: any) => {
    const pix = (profile as any)?.pix_key;
    if (!pix) { toast({ title: "PIX não configurado", description: "Adicione sua chave PIX nas Configurações.", variant: "destructive" }); return; }
    try {
      await navigator.clipboard.writeText(pix);
      toast({ title: "✓ PIX copiado", description: `R$ ${fmt(Number(inst.amount))} · ${inst.client_name}` });
      logAttempt(inst, "pix_copy", pix);
    } catch {
      toast({ title: "Erro ao copiar", variant: "destructive" });
    }
  };

  const saveReminderTime = async (hour: number, minute: number, auto: boolean) => {
    if (!user) return;
    const { data: saved, error } = await supabase.from("settings").upsert({
      user_id: user.id, bot_send_hour: hour, bot_send_minute: minute, bot_auto_send: auto,
    }, { onConflict: "user_id" }).select("user_id").single();
    if (error) {
      toast({ title: "Não foi possível atualizar os lembretes", description: error.message, variant: "destructive" });
      return;
    }
    if (!saved) {
      toast({ title: "Não foi possível confirmar os lembretes", variant: "destructive" });
      return;
    }
    await refetchSettings();
    toast({ title: "✓ Lembretes atualizados" });
  };

  const hasPixKey = Boolean((profile as any)?.pix_key);
  const onRowClick = useCallback((clientId: string) => navigate(`/clientes/${clientId}`), [navigate]);
  const onToggleSel = useCallback((id: string) => toggleSelect(id), []);
  const onShowHistory = useCallback((id: string, name: string) => setHistoryFor({ installmentId: id, clientName: name }), []);
  const onMarkPaidCb = useCallback((id: string) => setConfirmPayId(id), []);
  const onWhatsAppCb = useCallback((inst: any) => handleWhatsApp(inst), []);
  const onCopyPixCb = useCallback((inst: any) => copyPix(inst), []);
  const onEmailCb = useCallback((inst: any) => handleEmail(inst), []);

  const renderRow = (inst: any) => (
    <InstallmentRow
      key={inst.id}
      inst={inst}
      isSel={selected.has(inst.id)}
      hasPixKey={hasPixKey}
      lastAttempt={lastAttemptByInst.get(inst.id) || null}
      onRowClick={onRowClick}
      onToggleSelect={onToggleSel}
      onWhatsApp={onWhatsAppCb}
      onCopyPix={onCopyPixCb}
      onEmail={onEmailCb}
      onMarkPaid={onMarkPaidCb}
      onShowHistory={onShowHistory}
    />
  );


  const handleWhatsAppGroup = (group: any) => {
    const phone = group.items[0]?.client_phone;
    if (!phone) { toast({ title: "Sem telefone", variant: "destructive" }); return; }
    const clean = phone.replace(/\D/g, "");
    const num = clean.startsWith("55") ? clean : `55${clean}`;
    const unpaid = group.items.filter((i: any) => isEmAberto(i));
    let total = 0;
    let totalFees = 0;
    const lines = unpaid.map((i: any) => {
      const bd = computeLateFeeBreakdown(i);
      const paid = safeNumber(i.paid_amount);
      const due = Math.max(0, Math.round((bd.withFees - paid) * 100) / 100);
      total += due;
      totalFees += bd.total;
      const extra = bd.total > 0 ? ` [parcela R$ ${fmt(bd.base)} + juros R$ ${fmt(bd.total)} · ${bd.daysLate}d]` : "";
      return `- Parcela #${i.installment_number} · R$ ${fmt(due)} (venc. ${formatBR(i.due_date)})${extra}`;
    }).join("\n");
    const portalUrl = `${window.location.origin}/portal-cliente?o=${user!.id}`;
    const feesBlock = totalFees > 0 ? `\nJuros de atraso incluídos: R$ ${fmt(totalFees)}` : "";
    const msg = `Olá ${group.client_name}, tudo bem?\n\nIdentificamos ${unpaid.length} parcelas pendentes totalizando R$ ${fmt(total)}:\n${lines}${feesBlock}\n\nVocê pode regularizar via PIX ou pelo portal: ${portalUrl}`;
    window.open(`https://wa.me/${num}?text=${encodeURIComponent(msg)}`, "_blank", "noopener,noreferrer");
  };

  const toggleGroupSelect = (group: any) => {
    const ids = group.items.filter((i: any) => isEmAberto(i)).map((i: any) => i.id);
    const allSelected = ids.length > 0 && ids.every((id: string) => selected.has(id));
    setSelected(prev => {
      const next = new Set(prev);
      if (allSelected) ids.forEach((id: string) => next.delete(id));
      else ids.forEach((id: string) => next.add(id));
      return next;
    });
  };

  return (
    <div className="collections-page space-y-5 pb-24">
      {/* Resumo operacional */}
      <div className="collections-hero rounded-2xl border p-5 sm:p-6 animate-fade-in">
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
          <div className="collections-hero-summary flex items-start gap-4 min-w-0">
            <div className="collections-hero-icon flex h-11 w-11 shrink-0 items-center justify-center rounded-xl sm:h-12 sm:w-12">
              <Receipt size={22} className="text-primary" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs uppercase tracking-widest text-muted-foreground font-medium">Cobranças</p>
              <h1 className="text-display text-xl font-semibold tracking-[-0.025em] text-foreground sm:text-2xl">
                Total a Receber
              </h1>
              <div className="flex items-baseline gap-2 mt-1">
                <span className="collections-total money-fit block max-w-full whitespace-nowrap text-3xl font-semibold tracking-[-0.045em] tabular-nums sm:text-4xl md:text-5xl">
                  R$ {fmt(stats.totalOverdue + dueTodayStats.total)}
                </span>
              </div>
              <p className="text-xs text-muted-foreground mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="flex items-center gap-1"><AlertTriangle size={12} className="text-destructive" /> {stats.overdue} atrasada(s)</span>
                <span className="text-border">•</span>
                <span className="flex items-center gap-1"><CalendarDays size={12} className="text-primary" /> {dueTodayStats.count} vence(m) hoje</span>
              </p>
            </div>
          </div>

          <div className="collections-hero-actions grid grid-cols-1 gap-2 sm:grid-cols-2 lg:min-w-[21rem]">
            {stats.overdue > 0 && selected.size === 0 && (
              <button onClick={() => handleBulk("whatsapp")} className="collections-primary-action btn-premium">
                <MessageSquare size={14} /> Cobrar atrasadas ({stats.overdue})
              </button>
            )}
            <button
              onClick={() => { setCobrarAteDate(todayISO); setCobrarAteSelected(new Set()); setCobrarAteOpen(true); }}
              className="collections-secondary-action flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-xs font-semibold transition-colors focus-ring"
              title="Selecionar parcelas até uma data"
            >
              <CalendarIcon size={13} className="text-primary" /> Cobrar até…
            </button>
          </div>
        </div>
      </div>


      {/* Automação e métricas — colapsado por padrão */}
      <section className="collections-overview-grid" aria-label="Resumo das cobranças">
        <button className="collections-overview-card is-today" onClick={() => applyFocus("hoje")}><span className="collections-overview-icon"><CalendarDays size={17}/></span><span><small>Vence hoje</small><strong>{dueTodayStats.count} parcelas</strong><em>R$ {fmt(dueTodayStats.total)}</em></span><ChevronRight size={15}/></button>
        <button className="collections-overview-card is-overdue" onClick={() => applyFocus("atrasadas")}><span className="collections-overview-icon"><AlertTriangle size={17}/></span><span><small>Atrasadas</small><strong>{stats.overdue} parcelas</strong><em>R$ {fmt(stats.totalOverdue)}</em></span><ChevronRight size={15}/></button>
        <button className="collections-overview-card is-open" onClick={() => { setFilter("pending"); setPeriod("all"); }}><span className="collections-overview-icon"><Clock size={17}/></span><span><small>Em aberto</small><strong>{stats.pending} parcelas</strong><em>R$ {fmt(stats.totalPending)}</em></span><ChevronRight size={15}/></button>
        <button className="collections-overview-card is-paid" onClick={() => applyFocus("pagas")}><span className="collections-overview-icon"><CheckCircle size={17}/></span><span><small>Recebido</small><strong>{stats.paid} parcelas</strong><em>R$ {fmt(stats.totalPaid)}</em></span><ChevronRight size={15}/></button>
      </section>
      {showAutomation && <CollectionMetrics />}



      {/* Reminder schedule card — só no modo avançado */}
      {showAutomation && reminderSettings && (
        <div className="collections-automation rounded-2xl border p-4 flex flex-col sm:flex-row items-start sm:items-center gap-3 animate-fade-in">
          <div className="flex items-center gap-2.5 flex-1 min-w-0">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${reminderSettings.bot_auto_send ? "bg-success/15 text-success" : "bg-muted text-muted-foreground"}`}>
              <Bell size={18} />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-bold text-foreground">Lembrete automático diário</p>
              <p className="text-[11px] text-muted-foreground">
                {reminderSettings.bot_auto_send
                  ? `Disparo todo dia às ${String(reminderSettings.bot_send_hour).padStart(2,"0")}:${String(reminderSettings.bot_send_minute).padStart(2,"0")} para parcelas vencidas`
                  : "Desligado — ative para enviar cobranças automáticas todo dia"}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <input
              type="time"
              value={`${String(reminderSettings.bot_send_hour ?? 9).padStart(2,"0")}:${String(reminderSettings.bot_send_minute ?? 0).padStart(2,"0")}`}
              onChange={(e) => {
                const [h, m] = e.target.value.split(":").map(Number);
                saveReminderTime(h || 0, m || 0, reminderSettings.bot_auto_send);
              }}
              className="px-3 py-1.5 rounded-xl bg-muted/40 border border-border text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary/40"
            />
            <button
              onClick={() => saveReminderTime(reminderSettings.bot_send_hour ?? 9, reminderSettings.bot_send_minute ?? 0, !reminderSettings.bot_auto_send)}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-colors ${
                reminderSettings.bot_auto_send
                  ? "bg-success text-success-foreground hover:opacity-90"
                  : "bg-muted text-foreground hover:bg-accent"
              }`}
            >
              <Send size={12} /> {reminderSettings.bot_auto_send ? "Ativo" : "Ativar"}
            </button>
          </div>
        </div>
      )}


      {/* KPIs enriquecidos — clicáveis (foco) */}
      {(() => {
        const startOfDay = new Date(); startOfDay.setHours(0,0,0,0);
        const cobradoIds = new Set<string>();
        for (const a of attempts as any[]) {
          if (!a?.created_at) continue;
          if (new Date(a.created_at).getTime() >= startOfDay.getTime()) {
            if (a.channel === "whatsapp" || a.channel === "email") cobradoIds.add(a.client_id);
          }
        }
        const totalRec = stats.totalOverdue + dueTodayStats.total || 1;
        const overduePct = Math.round((stats.totalOverdue / totalRec) * 100);
        const kpis = [
          {
            label: "Vence hoje", value: dueTodayStats.count, amount: dueTodayStats.total,
            hint: `${dueTodayStats.count} parcela${dueTodayStats.count === 1 ? "" : "s"}`,
            icon: CalendarDays, color: "text-primary", bg: "bg-primary/10", ring: "border-primary/20",
            active: period === "today" && filter === "all" && !focoDia,
            onClick: () => applyFocus("hoje"),
          },
          {
            label: "Atrasadas", value: stats.overdue, amount: stats.totalOverdue,
            hint: `${overduePct}% do total a receber`,
            icon: AlertTriangle, color: "text-destructive", bg: "bg-destructive/10", ring: stats.overdue > 0 ? "border-destructive/30" : "border-border",
            active: filter === "overdue",
            onClick: () => applyFocus("atrasadas"),
            urgent: stats.overdue > 0,
          },
          {
            label: "Cobrado hoje", value: cobradoIds.size, amount: null,
            hint: `${cobradoIds.size} cliente${cobradoIds.size === 1 ? "" : "s"} contactado${cobradoIds.size === 1 ? "" : "s"}`,
            icon: CheckCircle, color: "text-success", bg: "bg-success/10", ring: "border-border",
            active: false,
            onClick: () => {},
          },
        ];
        return (
          <div className="collections-stats grid grid-cols-2 lg:grid-cols-3 gap-3 stagger-fade-in">
            {kpis.map((s, idx) => (
              <button
                key={s.label}
                onClick={s.onClick}
                style={{ animationDelay: `${idx * 60}ms` }}
                className={`collection-stat relative overflow-hidden rounded-2xl border p-4 text-left transition-colors focus-ring group ${idx === 2 ? "col-span-2 lg:col-span-1" : ""} ${s.active ? "is-active" : s.ring}`}
              >
                {s.urgent && <div className="absolute inset-y-4 left-0 w-0.5 rounded-full bg-destructive" />}
                <div className="mb-2 flex items-start justify-between">
                  <div className={`flex h-9 w-9 items-center justify-center rounded-xl ${s.bg}`}>
                    <s.icon size={18} className={s.color} />
                  </div>
                  <span className={`text-2xl font-bold tabular-nums ${s.color}`}>{s.value}</span>
                </div>
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold">{s.label}</p>
                {s.amount != null && (
                  <p className="text-lg font-bold text-foreground mt-0.5 tabular-nums">R$ {fmt(s.amount)}</p>
                )}
                <p className="text-[11px] text-muted-foreground mt-0.5">{s.hint}</p>
              </button>
            ))}
          </div>
        );
      })()}

      {/* Toolbar unificada — busca + tabs com contagem + ações */}
      {(() => {
        const today0 = new Date(); today0.setHours(0,0,0,0);
        const tomorrow0 = new Date(today0); tomorrow0.setDate(tomorrow0.getDate() + 1);
        const in7 = new Date(today0); in7.setDate(in7.getDate() + 7);
        const tomorrowCount = installments.filter((i: any) => {
          if (!isEmAberto(i)) return false;
          const d = parseLocalDate(i.due_date); if (!d) return false;
          return d.getFullYear() === tomorrow0.getFullYear() && d.getMonth() === tomorrow0.getMonth() && d.getDate() === tomorrow0.getDate();
        }).length;
        const next7Count = installments.filter((i: any) => {
          if (!isEmAberto(i)) return false;
          const d = parseLocalDate(i.due_date); if (!d) return false;
          return d.getTime() >= today0.getTime() && d.getTime() <= in7.getTime();
        }).length;
        const tabs = [
          { key: "hoje", label: "Hoje", count: dueTodayStats.count, tone: "primary", match: period === "today" && filter === "all" && !focoDia },
          { key: "amanha", label: "Amanhã", count: tomorrowCount, tone: "warn", match: period === "tomorrow" && filter === "all" && !focoDia },
          { key: "atrasadas", label: "Atrasadas", count: stats.overdue, tone: "destructive", match: filter === "overdue" },
          { key: "7d", label: "Próx. 7d", count: next7Count, tone: "muted", match: period === "7d" && filter === "all" },
          { key: "todas", label: "Todas", count: stats.pending + stats.overdue, tone: "muted", match: filter === "all" && period === "all" && !focoDia },
          { key: "pagas", label: "Pagas", count: stats.paid, tone: "success", match: filter === "paid" },
        ] as const;
        const sortLabel = sort === "priority" ? "Prioridade inteligente" : sort === "overdue_days" ? "Mais atrasadas" : sort === "due_asc" ? "Vencimento" : "Maior valor";
        return (
          <div className="collection-toolbar relative rounded-2xl border p-3 sm:p-3.5 animate-fade-in">
            <div className="collection-command-row grid gap-2 lg:grid-cols-[minmax(18rem,1fr)_auto]">
              {/* Search */}
              <div className="relative flex-1 min-w-0 group">
                <Search size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground group-focus-within:text-primary transition-colors" />
                <input
                  id="collections-search"
                  name="collections_search"
                  aria-label="Buscar cobranças"
                  autoComplete="off"
                  ref={searchRef}
                  type="text"
                  placeholder="Buscar por cliente, parcela # ou valor…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="h-11 w-full rounded-xl border border-border/50 bg-background/60 pl-11 pr-11 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground/50 focus:border-primary/40 focus:ring-2 focus:ring-primary/10"
                />
                <div className="absolute right-2.5 top-1/2 -translate-y-1/2 flex items-center gap-1.5">
                  {search ? (
                    <button type="button" aria-label="Limpar busca" onClick={() => setSearch("")} className="p-1.5 rounded-md hover:bg-accent text-muted-foreground"><X size={14} /></button>
                  ) : (
                    <kbd className="hidden md:inline-flex items-center px-1.5 py-0.5 rounded-md border border-border/40 bg-muted/40 text-[10px] font-mono text-muted-foreground">/</kbd>
                  )}
                </div>
              </div>

              {/* Sort + selection */}
              <div className="collection-sort-actions flex items-center gap-2">
                <div className="relative min-w-0 flex-1 xl:flex-none">
                  <ArrowUpDown size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                  <select
                    id="collections-sort"
                    name="collections_sort"
                    value={sort}
                    onChange={(e) => setSort(e.target.value as SortKey)}
                    className="w-full appearance-none pl-8 pr-8 h-11 rounded-xl text-xs font-semibold bg-background/60 text-foreground border border-border/50 hover:border-primary/30 focus:outline-none focus:ring-2 focus:ring-primary/10 transition-all cursor-pointer"
                    title={`Ordenar por: ${sortLabel}`}
                    aria-label="Ordenar por"
                  >
                    <option value="priority">Prioridade inteligente</option>
                    <option value="overdue_days">Mais atrasadas</option>
                    <option value="due_asc">Vencimento próximo</option>
                    <option value="amount_desc">Maior valor</option>
                  </select>
                  <ChevronDown size={13} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                </div>
                <button
                  onClick={toggleSelectAll}
                  className={`flex h-11 shrink-0 items-center gap-2 rounded-xl px-3.5 text-xs font-semibold transition-colors focus-ring ${selected.size > 0 ? "bg-primary/10 border border-primary/40 text-primary" : "bg-background/60 border border-border/50 text-foreground hover:border-primary/30"}`}
                  title="Selecionar todas visíveis"
                >
                  {selected.size > 0 ? <CheckSquare size={14} /> : <Square size={14} />}
                  <span className="hidden sm:inline">{selected.size > 0 ? `${selected.size} sel.` : "Selecionar"}</span>
                </button>
              </div>
            </div>

            {search && (
              <p className="mt-1.5 px-1 text-[11px] text-muted-foreground" aria-live="polite">
                {filtered.length} {filtered.length === 1 ? "resultado encontrado" : "resultados encontrados"}
              </p>
            )}

            {/* Períodos ficam em uma faixa própria para nunca disputar espaço com a busca. */}
            <div className="collection-tabs mt-3 grid grid-cols-3 gap-1 rounded-xl border p-1 sm:grid-cols-6">
              {tabs.map((f) => {
                const toneColor = f.tone === "destructive" ? "text-destructive" : f.tone === "success" ? "text-success" : f.tone === "primary" ? "text-primary" : "text-muted-foreground";
                return (
                  <button
                    key={f.key}
                    onClick={() => applyFocus(f.key as any)}
                    className={`relative flex min-w-0 items-center justify-center gap-1.5 rounded-lg px-2 h-10 text-xs font-semibold whitespace-nowrap transition-all ${f.match ? "is-active text-foreground" : "text-muted-foreground hover:text-foreground"}`}
                  >
                    <span className="truncate">{f.label}</span>
                    {f.count > 0 && (
                      <span className={`inline-flex shrink-0 items-center justify-center min-w-[20px] h-[18px] px-1 rounded-full text-[10px] font-bold tabular-nums ${f.match ? `bg-muted ${toneColor}` : "bg-background/70 text-muted-foreground"}`}>
                        {f.count}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            {/* Ações secundárias inline */}
            <div className="collection-tools flex flex-wrap items-center gap-1.5 mt-3 pt-3 border-t border-border/40">
              <span className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground/70 pl-2 pr-1">Ferramentas</span>
              <button
                onClick={() => setShowAging(v => !v)}
                className={`inline-flex items-center gap-1.5 h-7 px-2.5 rounded-lg text-[11px] font-medium transition-all ${showAging ? "bg-primary/15 text-primary" : "text-muted-foreground hover:bg-accent hover:text-foreground"}`}
              >
                <AlertTriangle size={11} /> Análise por cliente
              </button>
              <button
                onClick={() => setShowAutomation(v => !v)}
                className={`inline-flex items-center gap-1.5 h-7 px-2.5 rounded-lg text-[11px] font-medium transition-all ${showAutomation ? "bg-primary/15 text-primary" : "text-muted-foreground hover:bg-accent hover:text-foreground"}`}
              >
                <Bell size={11} /> Automação
              </button>
              <button
                onClick={() => setView(view === "calendar" ? "list" : "calendar")}
                className={`inline-flex items-center gap-1.5 h-7 px-2.5 rounded-lg text-[11px] font-medium transition-all ${view === "calendar" ? "bg-primary/15 text-primary" : "text-muted-foreground hover:bg-accent hover:text-foreground"}`}
              >
                <CalendarIcon size={11} /> {view === "calendar" ? "Lista" : "Calendário"}
              </button>
              {(search || activeFilters > 0) && (
                <button
                  onClick={() => { setSearch(""); clearFilters(); }}
                  className="ml-auto inline-flex items-center gap-1.5 h-7 px-2.5 rounded-lg text-[11px] font-medium text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-all"
                >
                  <X size={11} /> Limpar filtros
                </button>
              )}
            </div>
          </div>
        );
      })()}

      {showAging && <InadimplenciaPanel />}


      {/* Sticky bulk action bar */}
      {selected.size > 0 && (
        <div className="collection-bulk-bar mobile-dock sticky bottom-3 z-30 grid gap-3 rounded-2xl border px-4 py-3 backdrop-blur-xl animate-fade-in md:grid-cols-[1fr_auto] md:items-center">
          <div className="collection-bulk-summary flex min-w-0 items-center gap-3">
            <span className="text-sm font-semibold text-primary">{selected.size} selecionada(s)</span>
            <span className="text-xs text-foreground/80">Total: <span className="font-bold text-foreground">R$ {fmt(selectedSum)}</span></span>
            <button onClick={() => setSelected(new Set())} className="text-xs text-muted-foreground hover:text-foreground">Limpar</button>
          </div>
          <div className="collection-bulk-actions grid grid-cols-3 gap-2">
            <button onClick={() => handleBulk("whatsapp")} className="px-3 py-1.5 rounded-xl text-xs font-semibold bg-success/15 hover:bg-success/25 text-success border border-success/30 flex items-center gap-1.5">
              <MessageSquare size={13} /> WhatsApp
            </button>
            <button onClick={() => handleBulk("email")} className="px-3 py-1.5 rounded-xl text-xs font-semibold bg-primary/15 hover:bg-primary/25 text-primary border border-primary/30 flex items-center gap-1.5">
              <Mail size={13} /> E-mail
            </button>
            <button onClick={() => setBulkPayOpen(true)} className="px-3 py-1.5 rounded-xl text-xs font-semibold bg-foreground text-background hover:opacity-90 flex items-center gap-1.5">
              <Zap size={13} /> Marcar como pagas
            </button>
          </div>
        </div>
      )}

      {/* Calendar view */}
      {view === "calendar" && !loading && (
        <CalendarView
          installments={filtered}
          onWhatsApp={handleWhatsApp}
          onMarkPaid={(id) => setConfirmPayId(id)}
          onClickInstallment={(i) => navigate(`/clientes/${i.client_id}`)}
        />
      )}



      {/* List */}
      {view === "list" && (<>
      {loading ? (
        <SkeletonList rows={6} height="h-16" className="space-y-3" />
      ) : loadError ? (
        <ErrorState error={loadError} onRetry={() => refetchInstallments()} />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={Receipt}
          title={installments.length === 0 ? "Nenhuma parcela gerada ainda." : "Nenhuma parcela com esses filtros."}
          description={installments.length === 0
            ? "Crie um contrato para gerar parcelas automaticamente."
            : "Tente ajustar a busca, status ou período."}
          action={(search || activeFilters > 0 || filter !== "all") ? (
            <button onClick={() => { setSearch(""); setFilter("all"); clearFilters(); }} className="px-4 py-2 rounded-xl text-xs font-semibold bg-muted/40 hover:bg-muted text-foreground">
              Limpar tudo
            </button>
          ) : undefined}
        />
      ) : (
        <div className="collection-list space-y-3 stagger-fade-in">
          {(() => null)()}
          {(() => {
            const maxTotalWithFees = Math.max(1, ...grouped.map((g: any) => g.totalWithFees || g.total || 0));
            return grouped.map((group: any) => {
            const groupSelectable = group.items.filter((i: any) => isEmAberto(i));
            const groupSelectedCount = groupSelectable.filter((i: any) => selected.has(i.id)).length;
            const allSelected = groupSelectable.length > 0 && groupSelectedCount === groupSelectable.length;
            const someSelected = groupSelectedCount > 0 && !allSelected;
            const hasUnpaid = groupSelectable.length > 0;
            const unpaidCount = groupSelectable.length;
            const isCollapsed = groupMode === "collapsed" ? !collapsed.has(group.client_id) : collapsed.has(group.client_id);
            const showHeader = hasUnpaid;
            const dueInfo = humanDueLabel(group.items);
            const toneClass =
              dueInfo.tone === "danger" ? "bg-destructive/15 text-destructive border-destructive/30"
              : dueInfo.tone === "warn" ? "bg-amber-500/15 text-amber-500 border-amber-500/30"
              : dueInfo.tone === "ok" ? "bg-success/15 text-success border-success/30"
              : "bg-muted/40 text-muted-foreground border-border";
            const barPct = Math.min(100, Math.round(((group.totalWithFees || group.total) / maxTotalWithFees) * 100));
            const firstUnpaid = groupSelectable[0];
            // Progress: paid installments across active contracts of this client
            const agg = clientAggregates.get(group.client_id);
            const totalActiveInst = agg?.totalInstallments || group.items.length;
            const paidCount = Math.max(0, totalActiveInst - unpaidCount);
            const progressPct = totalActiveInst > 0 ? Math.round((paidCount / totalActiveInst) * 100) : 0;
            const initials = (group.client_name || "?").split(/\s+/).map((s: string) => s[0]).filter(Boolean).slice(0, 2).join("").toUpperCase();
            const rawPhone = group.items[0]?.client_phone || "";
            const phoneDigits = rawPhone.replace(/\D/g, "");
            const phoneMasked = formatPhoneBR(rawPhone);
            // Last attempt across group
            let lastAttemptAt: number | null = null;
            for (const it of group.items) {
              const a = lastAttemptByInst.get(it.id);
              if (a?.created_at) {
                const t = new Date(a.created_at).getTime();
                if (!lastAttemptAt || t > lastAttemptAt) lastAttemptAt = t;
              }
            }
            const daysSinceContact = lastAttemptAt ? Math.floor((Date.now() - lastAttemptAt) / 86400000) : null;
            // Next unpaid due date
            const nextUnpaid = [...groupSelectable]
              .filter((x: any) => !!x.due_date)
              .sort((a: any, b: any) => (parseLocalDate(a.due_date)?.getTime() ?? Number.MAX_SAFE_INTEGER) - (parseLocalDate(b.due_date)?.getTime() ?? Number.MAX_SAFE_INTEGER))[0];
            const nextDueDate = nextUnpaid?.due_date ? parseLocalDate(nextUnpaid.due_date) : null;
            const nextDueLabel = nextDueDate && !isNaN(nextDueDate.getTime())
              ? nextDueDate.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" })
              : null;
            const avatarRing =
              dueInfo.tone === "danger" ? "ring-destructive/50 bg-destructive/15 text-destructive"
              : dueInfo.tone === "warn" ? "ring-amber-500/50 bg-amber-500/15 text-amber-500"
              : dueInfo.tone === "ok" ? "ring-success/40 bg-success/15 text-success"
              : "ring-border bg-muted/40 text-muted-foreground";
            // Extra metrics
            const maxDaysLate = groupSelectable.reduce((max: number, it: any) => {
              const due = parseLocalDate(it.due_date);
              if (!due) return max;
              const d = Math.floor((Date.now() - due.getTime()) / 86400000);
              return d > max ? d : max;
            }, 0);
            const avgTicket = agg && totalActiveInst > 0 ? (agg.grossExpected / totalActiveInst) : 0;
            const feePct = (group.total > 0 && group.totalFees > 0) ? Math.round((group.totalFees / group.total) * 100) : 0;

            const accentColor =
              dueInfo.tone === "danger" ? "bg-destructive"
              : dueInfo.tone === "warn" ? "bg-amber-500"
              : dueInfo.tone === "ok" ? "bg-success"
              : "bg-primary";
            const cardTint =
              dueInfo.tone === "danger" ? "bg-destructive/[0.025]"
              : dueInfo.tone === "warn" ? "bg-amber-500/[0.025]"
              : "bg-card/60";
            const copyPhone = async () => {
              try { await navigator.clipboard.writeText(phoneDigits || rawPhone); toast({ title: "Telefone copiado" }); } catch {}
            };

            return (
              <div key={group.client_id} className={`collection-account-card group relative overflow-hidden rounded-2xl border ${cardTint} transition-colors ${dueInfo.tone === "danger" ? "is-overdue border-destructive/25" : "border-border"}`}>
                <div className={`absolute inset-y-4 left-0 w-0.5 rounded-full ${accentColor}`} />
                {showHeader && (
                  <div className="p-4 sm:p-5 flex flex-col gap-4">
                    {/* Top row: avatar + name + status + quick chips + select */}
                    <div className="flex items-start gap-3">
                      <button
                        aria-label="Selecionar todas as parcelas do cliente"
                        onClick={(e) => { e.stopPropagation(); toggleGroupSelect(group); }}
                        className="shrink-0 p-1 rounded hover:bg-accent transition-colors focus-ring mt-1"
                        title="Selecionar todas"
                      >
                        {allSelected
                          ? <CheckSquare size={18} className="text-primary" />
                          : someSelected
                            ? <MinusSquare size={18} className="text-primary" />
                            : <Square size={18} className="text-muted-foreground" />}
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); navigate(`/clientes/${group.client_id}`); }}
                        className={`relative flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ring-1 ${avatarRing} text-sm font-bold focus-ring`}
                        title="Abrir ficha do cliente"
                      >
                        {initials || "?"}
                        <span className={`absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full border-2 border-card ${dueInfo.tone === "danger" ? "bg-destructive" : dueInfo.tone === "warn" ? "bg-amber-500" : dueInfo.tone === "ok" ? "bg-success" : "bg-muted-foreground"}`} />
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); toggleGroupCollapse(group.client_id); }}
                        className="min-w-0 flex-1 text-left focus-ring rounded-lg"
                        title={isCollapsed ? "Mostrar parcelas" : "Ocultar parcelas"}
                        aria-expanded={!isCollapsed}
                      >
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-[15px] font-bold text-foreground truncate max-w-[260px] tracking-tight">{group.client_name}</p>
                          <span className={`shrink-0 px-2 py-0.5 rounded-full text-[10px] font-semibold border ${toneClass}`}>
                            {dueInfo.text}
                          </span>
                          {maxDaysLate > 0 && (
                            <span className="shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-destructive/10 text-destructive border border-destructive/25">
                              <Flame size={10} /> {maxDaysLate}d atraso
                            </span>
                          )}
                        </div>
                        <div className="mt-1.5 flex items-center gap-2 flex-wrap text-[11px] text-muted-foreground">
                          {phoneMasked && (
                            <span className="inline-flex items-center gap-1"><Phone size={11} /> <span className="tabular-nums">{phoneMasked}</span></span>
                          )}
                          {nextDueLabel && (
                            <span className="inline-flex items-center gap-1"><CalendarDays size={11} /> próx: <span className="font-semibold text-foreground">{nextDueLabel}</span></span>
                          )}
                          <span className="inline-flex items-center gap-1">
                            <MessageSquare size={11} />
                            {daysSinceContact === null ? "nunca cobrado" : daysSinceContact === 0 ? "cobrado hoje" : `há ${daysSinceContact}d`}
                          </span>
                          <span className="inline-flex items-center gap-1"><Layers size={11} /> {unpaidCount} em aberto</span>
                        </div>
                      </button>
                      <div className="hidden sm:flex shrink-0 flex-col items-end gap-0.5">
                        <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Total devido</span>
                        <span className={`text-xl font-black tabular-nums leading-none ${dueInfo.tone === "danger" ? "text-destructive" : "text-foreground"}`}>R$ {fmt(group.totalWithFees || group.total)}</span>
                        {group.totalFees > 0 && (
                          <span className="text-[10px] text-destructive font-semibold inline-flex items-center gap-1">
                            <TrendingUp size={10} /> +R$ {fmt(group.totalFees)} ({feePct}% multa)
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Mobile total */}
                    <div className="sm:hidden flex items-baseline gap-2 flex-wrap">
                      <span className={`text-xl font-black tabular-nums ${dueInfo.tone === "danger" ? "text-destructive" : "text-foreground"}`}>R$ {fmt(group.totalWithFees || group.total)}</span>
                      {group.totalFees > 0 && (
                        <span className="text-[11px] text-destructive font-semibold">+R$ {fmt(group.totalFees)} multa</span>
                      )}
                    </div>

                    {/* KPIs - richer with icons */}
                    {agg && !isCollapsed && (() => {
                      const expectedProfit = Math.max(0, (agg.grossExpected || 0) - (agg.loaned || 0));
                      const realizedProfit = agg.grossExpected > 0
                        ? Math.max(0, ((agg.paidAmount || 0) / agg.grossExpected) * expectedProfit)
                        : 0;
                      const paidPctValue = agg.grossExpected > 0 ? Math.round(((agg.paidAmount || 0) / agg.grossExpected) * 100) : 0;
                      return (
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                          <div className="rounded-xl border border-border/60 bg-background/50 backdrop-blur px-3 py-2.5 hover:border-primary/30 transition-colors">
                            <p className="text-[9px] uppercase tracking-wide text-muted-foreground font-semibold inline-flex items-center gap-1"><Wallet size={10} /> Emprestado</p>
                            <p className="text-sm font-bold text-foreground tabular-nums mt-1">R$ {fmt(agg.loaned)}</p>
                            {avgTicket > 0 && <p className="text-[9px] text-muted-foreground mt-0.5 tabular-nums">ticket R$ {fmt(avgTicket)}</p>}
                          </div>
                          <div className="rounded-xl border border-border/60 bg-background/50 backdrop-blur px-3 py-2.5 hover:border-primary/30 transition-colors">
                            <p className="text-[9px] uppercase tracking-wide text-muted-foreground font-semibold inline-flex items-center gap-1"><Layers size={10} /> Parcelas pagas</p>
                            <p className="text-sm font-bold tabular-nums mt-1">
                              <span className="text-success">{paidCount}</span>
                              <span className="text-muted-foreground">/{totalActiveInst}</span>
                              <span className="ml-1 text-[10px] font-semibold text-muted-foreground">({progressPct}%)</span>
                            </p>
                            <p className="text-[9px] text-success/80 mt-0.5 tabular-nums font-semibold">recebido R$ {fmt(agg.paidAmount)}</p>
                            <p className="text-[9px] text-muted-foreground tabular-nums">a receber R$ {fmt(Math.max(0, agg.grossExpected - agg.paidAmount))}</p>
                          </div>
                          <div className="rounded-xl border border-success/25 bg-success/[0.055] px-3 py-2.5">
                            <p className="text-[9px] uppercase tracking-wide text-success/80 font-semibold inline-flex items-center gap-1"><TrendingUp size={10} /> Lucro previsto</p>
                            <p className="text-sm font-bold text-success tabular-nums mt-1">R$ {fmt(expectedProfit)}</p>
                            <p className="text-[9px] text-success/80 mt-0.5 tabular-nums">já rendeu R$ {fmt(realizedProfit)}</p>
                            {agg.loaned > 0 && <p className="text-[9px] text-muted-foreground tabular-nums">ROI final {Math.round((expectedProfit / agg.loaned) * 100)}%</p>}
                          </div>
                          {agg.overdueCount > 0 ? (
                            <div className="rounded-xl border border-destructive/25 bg-destructive/[0.055] px-3 py-2.5">
                              <p className="text-[9px] uppercase tracking-wide text-destructive/90 font-semibold inline-flex items-center gap-1"><AlertTriangle size={10} /> {agg.overdueCount} atrasada{agg.overdueCount === 1 ? "" : "s"}</p>
                              <p className="text-sm font-bold text-foreground tabular-nums mt-1">R$ {fmt(agg.overdueAmount)}</p>
                              <p className="text-[10px] font-semibold text-destructive tabular-nums">c/ multa R$ {fmt(agg.overdueAmount + agg.overdueFees)}</p>
                            </div>
                          ) : (
                            <div className="rounded-xl border border-success/25 bg-success/[0.055] px-3 py-2.5">
                              <p className="text-[9px] uppercase tracking-wide text-success/80 font-semibold inline-flex items-center gap-1"><CheckCircle size={10} /> Situação</p>
                              <p className="text-sm font-bold text-success mt-1">Em dia</p>
                              <p className="text-[9px] text-success/70 mt-0.5">nenhum atraso</p>
                            </div>
                          )}
                        </div>
                      );
                    })()}

                    {/* Progress bar with milestones */}
                    {!isCollapsed && <div className="space-y-1">
                      <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                        <span className="font-semibold inline-flex items-center gap-1"><Percent size={10} /> Progresso do contrato</span>
                        <span className="tabular-nums font-semibold text-foreground">{paidCount}/{totalActiveInst} · {progressPct}%</span>
                      </div>
                      <div className="relative h-2 rounded-full bg-muted/40 overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all bg-gradient-to-r ${progressPct >= 80 ? "from-success to-success/70" : progressPct >= 40 ? "from-primary to-primary/70" : "from-amber-500 to-amber-400"}`}
                          style={{ width: `${Math.max(2, progressPct)}%` }}
                        />
                        {[25, 50, 75].map((m) => (
                          <span key={m} className="absolute top-0 h-full w-px bg-background/60" style={{ left: `${m}%` }} />
                        ))}
                      </div>
                    </div>}

                    {/* Actions */}
                    <div className="collection-card-actions grid grid-cols-4 gap-2 pt-0.5">
                      <button
                        onClick={(e) => { e.stopPropagation(); handleWhatsAppGroup(group); }}
                        className="col-span-2 flex items-center justify-center gap-1.5 rounded-xl bg-success px-3 py-2.5 text-sm font-semibold text-success-foreground transition-colors hover:bg-success/90 focus-ring sm:col-span-1"
                        title="Cobrar via WhatsApp"
                      >
                        <MessageSquare size={15} /> Cobrar
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          if (unpaidCount === 1 && firstUnpaid) setConfirmPayId(firstUnpaid.id);
                          else toggleGroupCollapse(group.client_id);
                        }}
                        className="flex items-center justify-center gap-1.5 rounded-xl bg-primary px-3 py-2.5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 focus-ring"
                        title={unpaidCount === 1 ? "Marcar como paga" : "Ver parcelas"}
                      >
                        <Check size={15} /> {unpaidCount === 1 ? "Pagar" : isCollapsed ? "Ver parcelas" : "Ocultar"}
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); copyPhone(); }}
                        disabled={!phoneDigits}
                        className="hidden min-w-0 items-center justify-center gap-1.5 rounded-xl bg-accent px-2 py-2.5 text-xs font-semibold text-foreground transition-colors hover:bg-accent/70 focus-ring disabled:cursor-not-allowed disabled:opacity-50 sm:flex"
                        title={phoneDigits ? `Copiar ${phoneMasked}` : "Cliente sem telefone"}
                        aria-label={phoneDigits ? `Copiar telefone ${phoneMasked}` : "Cliente sem telefone cadastrado"}
                      >
                        <Copy size={14} className="shrink-0" /> <span className="truncate tabular-nums">{phoneMasked || "Sem telefone"}</span>
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); navigate(`/clientes/${group.client_id}`); }}
                        className="flex items-center justify-center gap-1.5 rounded-xl bg-accent px-3 py-2.5 text-sm font-semibold text-foreground transition-colors hover:bg-accent/70 focus-ring"
                        title="Abrir cliente"
                      >
                        <ExternalLink size={14} /> Ficha
                      </button>
                    </div>
                  </div>
                )}


                {(!showHeader || !isCollapsed) && (
                  <div className={showHeader ? "border-t border-border bg-background/40 px-2 py-2 space-y-1.5" : ""}>
                    {group.items.map((inst: any) => renderRow(inst))}
                  </div>
                )}
              </div>
            );
          });
          })()}
        </div>
      )}
      </>)}



      {/* Payment Confirmation Modal (com pagamento parcial) */}
      {confirmPayId && (() => {
        const inst = installments.find((i: any) => i.id === confirmPayId);
        if (!inst) return null;
        const fee = computeLateFeeBreakdown(inst);
        const alreadyPaid = Number(inst.paid_amount || 0);
        const totalDue = Math.round(fee.withFees * 100) / 100;
        const remaining = Math.max(0, Math.round((totalDue - alreadyPaid) * 100) / 100);
        const dueDate = parseLocalDate(inst.due_date);
        const today = new Date(); today.setHours(0,0,0,0);
        const daysLate = dueDate ? Math.floor((today.getTime() - dueDate.getTime()) / 86400000) : 0;
        return <PayModal
          inst={inst}
          fee={fee}
          alreadyPaid={alreadyPaid}
          remaining={remaining}
          daysLate={daysLate}
          onCancel={() => setConfirmPayId(null)}
          onConfirm={(value, feeDiscount, options) => handleMarkPaid(confirmPayId, value, feeDiscount, options)}
        />;
      })()}

      {/* Bulk WhatsApp preview modal */}
      {bulkPreview && (
        <div className="modal-backdrop" onClick={() => !bulkSending && (setBulkPreview(null), setPreviewEditIdx(null))}>
          <div className="modal-content collection-modal-shell max-w-2xl w-full max-h-[90vh] flex flex-col" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Pré-visualizar cobrança em lote">
            <div className="collection-modal-header px-5 py-4 border-b border-border flex items-center justify-between gap-3">
              <div>
                <h3 className="text-base font-semibold flex items-center gap-2"><MessageSquare size={16} className="text-success" /> Pré-visualizar cobrança em lote</h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {bulkPreview.groups.length} cliente(s) • {bulkPreview.totalItems} parcela(s){bulkPreview.skipped > 0 ? ` • ${bulkPreview.skipped} sem telefone` : ""}
                </p>
              </div>
              <button aria-label="Fechar prévia" disabled={bulkSending} onClick={() => { setBulkPreview(null); setPreviewEditIdx(null); }} className="p-1.5 rounded-lg hover:bg-accent text-muted-foreground"><X size={16} /></button>
            </div>
            <div className="collection-modal-body flex-1 overflow-y-auto px-5 py-4 space-y-3">
              {bulkPreview.groups.map((g, idx) => (
                <div key={g.clientId} className="rounded-2xl border border-border bg-card/50">
                  <div className="collection-preview-row px-4 py-2.5 border-b border-border flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-sm font-semibold truncate">{g.clientName}</div>
                      <div className="text-[11px] text-muted-foreground">📱 +{g.phone} • {g.items.length} parcela(s)</div>
                    </div>
                    <div className="collection-preview-actions flex items-center gap-1.5 shrink-0">
                      <button
                        onClick={() => { navigator.clipboard?.writeText(g.message); toast({ title: "Mensagem copiada" }); }}
                        className="px-2 py-1 rounded-lg text-[11px] bg-accent hover:bg-accent/70 text-foreground flex items-center gap-1"
                        title="Copiar mensagem"
                      ><Copy size={11} /> Copiar</button>
                      <button
                        onClick={() => setPreviewEditIdx(previewEditIdx === idx ? null : idx)}
                        className="px-2 py-1 rounded-lg text-[11px] bg-primary/15 hover:bg-primary/25 text-primary"
                      >{previewEditIdx === idx ? "Pronto" : "Editar"}</button>
                      <button
                        aria-label="Remover deste lote"
                        onClick={() => {
                          setBulkPreview((prev) => prev ? { ...prev, groups: prev.groups.filter((_, i) => i !== idx), totalItems: prev.totalItems - g.items.length } : prev);
                          if (previewEditIdx === idx) setPreviewEditIdx(null);
                        }}
                        className="px-2 py-1 rounded-lg text-[11px] bg-destructive/15 hover:bg-destructive/25 text-destructive"
                        title="Remover deste lote"
                      ><X size={11} /></button>
                    </div>
                  </div>
                  {previewEditIdx === idx ? (
                    <textarea
                      value={g.message}
                      onChange={(e) => {
                        const v = e.target.value;
                        setBulkPreview((prev) => prev ? { ...prev, groups: prev.groups.map((gr, i) => i === idx ? { ...gr, message: v } : gr) } : prev);
                      }}
                      rows={10}
                      className="w-full px-4 py-3 text-xs bg-background border-0 rounded-b-2xl resize-y font-mono outline-none"
                    />
                  ) : (
                    <pre className="px-4 py-3 text-xs whitespace-pre-wrap text-foreground/90 font-sans">{g.message}</pre>
                  )}
                </div>
              ))}
              {bulkPreview.groups.length === 0 && (
                <div className="text-center text-sm text-muted-foreground py-8">Nenhum cliente no lote.</div>
              )}
            </div>
            <div className="collection-modal-footer px-5 py-4 border-t border-border flex items-center gap-2">
              <button disabled={bulkSending} onClick={() => { setBulkPreview(null); setPreviewEditIdx(null); }} className="flex-1 px-4 py-2.5 rounded-2xl border border-border text-sm text-muted-foreground hover:bg-accent transition-colors disabled:opacity-50">Cancelar</button>
              <button
                disabled={bulkSending || bulkPreview.groups.length === 0}
                onClick={confirmBulkPreview}
                className="flex-1 px-4 py-2.5 rounded-2xl text-sm font-semibold bg-success text-success-foreground hover:opacity-90 transition-all disabled:opacity-50 flex items-center justify-center gap-2"
              >
                <Send size={14} /> {bulkSending ? "Abrindo..." : `Enviar ${bulkPreview.groups.length} WhatsApp`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bulk pay modal */}
      {bulkPayOpen && (
        <div className="modal-backdrop" onClick={() => !bulkPaying && setBulkPayOpen(false)}>
          <div className="modal-content max-w-sm p-6 space-y-4" onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Confirmar pagamento em lote">
            <div className="text-center">
              <div className="w-14 h-14 rounded-2xl bg-success/10 flex items-center justify-center mx-auto mb-3">
                <Zap size={28} className="text-success" />
              </div>
              <h3 className="text-lg font-bold text-foreground">Marcar {getSelectedItems().filter((i: any) => isEmAberto(i)).length} parcela(s) como pagas?</h3>
              <p className="text-sm text-muted-foreground mt-2">Total recebido: <span className="font-bold text-foreground">R$ {fmt(selectedSum)}</span></p>
              <p className="text-[11px] text-muted-foreground mt-1">As receitas e o lucro serão registrados automaticamente.</p>
            </div>
            <div className="flex gap-2">
              <button disabled={bulkPaying} onClick={() => setBulkPayOpen(false)} className="flex-1 px-4 py-2.5 rounded-2xl border border-border text-sm text-muted-foreground hover:bg-accent transition-colors disabled:opacity-50">Cancelar</button>
              <button disabled={bulkPaying} onClick={handleBulkMarkPaid} className="flex-1 px-4 py-2.5 rounded-xl text-sm font-semibold bg-success text-success-foreground hover:opacity-90 transition-all disabled:opacity-50">
                {bulkPaying ? "Processando..." : "Confirmar"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Cobrar até <data> Modal */}
      {cobrarAteOpen && (() => {
        const limit = parseLocalDate(cobrarAteDate);
        if (limit) limit.setHours(23, 59, 59, 999);
        const items = installments
          .filter((i: any) => isEmAberto(i))
          .filter((i: any) => {
            const d = parseLocalDate(i.due_date);
            return d && limit && d <= limit;
          })
          .sort((a: any, b: any) => (parseLocalDate(a.due_date)?.getTime() ?? 0) - (parseLocalDate(b.due_date)?.getTime() ?? 0));

        const today = new Date(); today.setHours(0,0,0,0);
        const groups = new Map<string, any[]>();
        items.forEach((i: any) => {
          const arr = groups.get(i.client_id) || [];
          arr.push(i);
          groups.set(i.client_id, arr);
        });
        const totalAll = items.reduce((s: number, i: any) => s + portalInstallmentAmount(i), 0);
        const totalOverdue = items.filter((i: any) => i.status === "overdue").reduce((s: number, i: any) => s + portalInstallmentAmount(i), 0);
        const totalToday = items.filter((i: any) => {
          const d = parseLocalDate(i.due_date);
          return d && d.toDateString() === today.toDateString();
        }).reduce((s: number, i: any) => s + portalInstallmentAmount(i), 0);

        const allIds = items.map((i: any) => i.id);
        const allChecked = allIds.length > 0 && allIds.every((id: string) => cobrarAteSelected.has(id));
        const selItems = items.filter((i: any) => cobrarAteSelected.has(i.id));
        const selSum = selItems.reduce((s: number, i: any) => s + portalInstallmentAmount(i), 0);

        const toggleAll = () => setCobrarAteSelected(allChecked ? new Set() : new Set(allIds));
        const toggleOne = (id: string) => setCobrarAteSelected(prev => {
          const n = new Set(prev);
          if (n.has(id)) n.delete(id);
          else n.add(id);
          return n;
        });

        const cobrarSelecionados = () => {
          const target = (selItems.length > 0 ? selItems : items).filter((i: any) => i.client_phone);
          if (target.length === 0) { toast({ title: "Sem telefones para cobrar", variant: "destructive" }); return; }
          target.forEach((inst: any, idx: number) => setTimeout(() => handleWhatsApp(inst), idx * 350));
          toast({ title: `Enviando ${target.length} cobrança(s) por WhatsApp` });
        };
        const baixarSelecionados = async () => {
          const target = selItems.length > 0 ? selItems : items;
          if (target.length === 0) return;
          optimisticMarkPaid(target.map((i: any) => i.id));
          setCobrarAteSelected(new Set());
          let ok = 0, fail = 0;
          for (const inst of target) { try { await markPaidOne(inst); ok++; } catch { fail++; } }
          qc.invalidateQueries({ queryKey: ["cobrancas-installments"] });
          qc.invalidateQueries({ queryKey: ["dashboard-data"] });
          toast({ title: `✓ ${ok} parcela(s) marcadas como pagas`, description: fail > 0 ? `${fail} falha(s).` : undefined });
        };

        return (
          <div className="modal-backdrop" onClick={() => setCobrarAteOpen(false)}>
            <div className="modal-content collection-modal-shell w-full max-w-3xl max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Cobrar até a data selecionada">
              {/* Header */}
              <div className="px-5 py-4 border-b border-border flex items-center justify-between gap-3 shrink-0">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-primary/15 flex items-center justify-center">
                    <CalendarIcon size={18} className="text-primary" />
                  </div>
                  <div>
                    <h3 className="text-base font-bold text-foreground">Cobrar até a data selecionada</h3>
                    <p className="text-[11px] text-muted-foreground">Inclui atrasadas anteriores + vencendo até a data.</p>
                  </div>
                </div>
                <button aria-label="Fechar" onClick={() => setCobrarAteOpen(false)} className="p-2 rounded-lg hover:bg-accent text-muted-foreground"><X size={16} /></button>
              </div>

              {/* Date + presets */}
              <div className="px-5 py-3 border-b border-border space-y-3 shrink-0">
                <div className="flex flex-wrap items-center gap-2">
                  <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Data limite</label>
                  <input
                    type="date"
                    value={cobrarAteDate}
                    onChange={(e) => { setCobrarAteDate(e.target.value); setCobrarAteSelected(new Set()); }}
                    className="px-3 py-1.5 rounded-xl bg-muted/40 border border-border text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary/40"
                  />
                  {[
                    { label: "Hoje", days: 0 },
                    { label: "+3 dias", days: 3 },
                    { label: "+7 dias", days: 7 },
                    { label: "Fim do mês", days: -1 },
                  ].map(p => (
                    <button
                      key={p.label}
                      onClick={() => {
                        const d = new Date();
                        if (p.days === -1) { d.setMonth(d.getMonth() + 1, 0); }
                        else d.setDate(d.getDate() + p.days);
                        setCobrarAteDate(toDateInputValue(d));
                        setCobrarAteSelected(new Set());
                      }}
                      className="px-2.5 py-1 rounded-lg bg-muted/30 text-xs text-muted-foreground hover:bg-muted/60 hover:text-foreground transition-colors"
                    >{p.label}</button>
                  ))}
                </div>
                <div className="collection-date-summary grid grid-cols-3 gap-2">
                  <div className="rounded-xl bg-destructive/10 border border-destructive/20 p-2.5">
                    <p className="text-[10px] uppercase tracking-wider text-destructive font-semibold">Atrasadas</p>
                    <p className="money-fit text-sm font-bold text-destructive">R$ {fmt(totalOverdue)}</p>
                  </div>
                  <div className="rounded-xl bg-warning/10 border border-warning/20 p-2.5">
                    <p className="text-[10px] uppercase tracking-wider text-warning font-semibold">Vence hoje</p>
                    <p className="money-fit text-sm font-bold text-warning">R$ {fmt(totalToday)}</p>
                  </div>
                  <div className="rounded-xl bg-primary/10 border border-primary/20 p-2.5">
                    <p className="text-[10px] uppercase tracking-wider text-primary font-semibold">Total a cobrar</p>
                    <p className="money-fit text-sm font-bold text-primary">R$ {fmt(totalAll)}</p>
                  </div>
                </div>
              </div>

              {/* List */}
              <div className="collection-modal-body flex-1 overflow-y-auto px-5 py-3">
                {items.length === 0 ? (
                  <div className="text-center py-10">
                    <CheckCircle size={32} className="text-success mx-auto mb-2" />
                    <p className="text-sm text-foreground font-medium">Nada a cobrar até esta data 🎉</p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <button onClick={toggleAll} className="flex items-center gap-2 text-xs font-medium text-muted-foreground hover:text-foreground">
                        {allChecked ? <CheckSquare size={14} className="text-primary" /> : <Square size={14} />}
                        {allChecked ? "Desmarcar todas" : `Selecionar ${items.length}`}
                      </button>
                      <span className="text-[11px] text-muted-foreground">{groups.size} cliente(s)</span>
                    </div>
                    {Array.from(groups.entries()).map(([cid, list]) => {
                      const name = list[0].client_name;
                      const sum = list.reduce((s, i) => s + portalInstallmentAmount(i), 0);
                      return (
                        <div key={cid} className="rounded-xl border border-border bg-card/50">
                          <div className="px-3 py-2 border-b border-border flex items-center justify-between gap-3">
                            <p className="min-w-0 truncate text-sm font-semibold text-foreground">{name}</p>
                            <p className="money-fit shrink-0 text-xs font-bold text-primary">R$ {fmt(sum)}</p>
                          </div>
                          <div className="divide-y divide-border/40">
                            {list.map((inst: any) => {
                              const d = parseLocalDate(inst.due_date);
                              const days = d ? Math.floor((today.getTime() - d.getTime()) / 86400000) : 0;
                              return (
                                <label key={inst.id} className="flex items-center gap-3 px-3 py-2 hover:bg-accent/30 cursor-pointer">
                                  <input
                                    type="checkbox"
                                    checked={cobrarAteSelected.has(inst.id)}
                                    onChange={() => toggleOne(inst.id)}
                                    className="w-4 h-4 accent-primary"
                                  />
                                  <div className="flex-1 min-w-0">
                                    <p className="text-xs font-medium text-foreground truncate">
                                      Parcela #{inst.installment_number} · {formatBR(inst.due_date)}
                                    </p>
                                    <p className="text-[11px]">
                                      <span className={inst.status === "overdue" ? "text-destructive font-semibold" : "text-muted-foreground"}>
                                        {inst.status === "overdue" ? `${days}d em atraso` : days === 0 ? "Vence hoje" : `Em ${-days}d`}
                                      </span>
                                    </p>
                                  </div>
                                  <p className="text-sm font-bold text-foreground shrink-0">R$ {fmt(Number(inst.amount))}</p>
                                </label>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Footer */}
              {items.length > 0 && (
                <div className="collection-date-footer px-5 py-3 border-t border-border bg-card/95 backdrop-blur flex items-center justify-between gap-3 shrink-0">
                  <div className="min-w-0">
                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{selItems.length > 0 ? `${selItems.length} selecionada(s)` : "Todas as parcelas"}</p>
                    <p className="money-fit truncate text-base font-bold text-foreground">R$ {fmt(selItems.length > 0 ? selSum : totalAll)}</p>
                  </div>
                  <div className="collection-date-actions flex items-center gap-2 shrink-0">
                    <button onClick={cobrarSelecionados} className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-success/15 text-success border border-success/30 text-xs font-semibold hover:bg-success/25 transition-colors">
                      <MessageSquare size={14} /> Cobrar WhatsApp
                    </button>
                    <button onClick={baixarSelecionados} className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-primary text-primary-foreground text-xs font-semibold hover:opacity-90 transition-opacity">
                      <Check size={14} /> Dar baixa
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        );
      })()}

      {/* History modal */}
      {historyFor && (() => {
        const list = attempts.filter((a: any) => a.installment_id === historyFor.installmentId);
        return (
          <div className="modal-backdrop" onClick={() => setHistoryFor(null)}>
            <div className="modal-content max-w-md p-0" onClick={e => e.stopPropagation()}>
              <div className="px-5 py-4 border-b border-border flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <div className="w-9 h-9 rounded-xl bg-primary/15 flex items-center justify-center"><History size={16} className="text-primary" /></div>
                  <div>
                    <h3 className="text-sm font-bold text-foreground">Histórico de cobranças</h3>
                    <p className="text-[11px] text-muted-foreground">{historyFor.clientName}</p>
                  </div>
                </div>
                <button onClick={() => setHistoryFor(null)} className="p-1.5 rounded-lg hover:bg-accent text-muted-foreground"><X size={14} /></button>
              </div>
              <div className="max-h-[60vh] overflow-y-auto p-4 space-y-2">
                {list.length === 0 ? (
                  <EmptyState compact title="Sem tentativas" description="Nenhuma cobrança foi registrada para esta parcela ainda." />
                ) : list.map((a: any) => (
                  <div key={a.id} className="rounded-xl border border-border bg-card/50 p-3">
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <span className="text-[11px] font-bold uppercase tracking-wider text-primary">
                        {a.channel === "whatsapp" ? "💬 WhatsApp" : a.channel === "email" ? "✉️ E-mail" : a.channel === "pix_copy" ? "🔑 PIX copiado" : a.channel === "sms" ? "📱 SMS" : "✍️ Manual"}
                      </span>
                      <span className="text-[10px] text-muted-foreground">há {relTime(a.created_at)}</span>
                    </div>
                    {a.message_preview && (
                      <p className="text-[11px] text-muted-foreground whitespace-pre-wrap line-clamp-3">{a.message_preview}</p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        );
      })()}
    </div>

  );
};

export default Cobrancas;
