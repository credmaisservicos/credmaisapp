import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useMultiTableRealtime } from "@/hooks/useRealtimeSubscription";
import { toast } from "sonner";
import {
  Sunrise, AlertCircle, CheckCircle2, ListTodo, Receipt,
  ArrowRight, MessageSquare, Loader2, Plus, Clock, Sparkles,
  UserPlus, Cake, DollarSign, TrendingUp, CalendarDays, Wallet, History, ShieldCheck
} from "lucide-react";
import SmartAlerts from "@/components/SmartAlerts";
import { formatBR, parseLocalDate } from "@/lib/dateUtils";
import { fetchAll } from "@/lib/fetchAll";
import { computeLateFeeBreakdown } from "@/lib/lateFee";
import { isMissingRpcError } from "@/lib/interestOnly";
import PayModal from "@/components/cobrancas/PayModal";
import ErrorState from "@/components/feedback/ErrorState";
import {financialAnalyticsSchema,financialDay,financialBounds,addFinancialDays,financialDaysBetween,periodReceiptTotals} from "@/lib/financialAnalytics";
import {useFinancialClock} from "@/hooks/useFinancialClock";
import { portalInstallmentAmount } from "@/lib/portalAmounts";

const startOfToday = () => { const d = new Date(); d.setHours(0,0,0,0); return d; };
const endOfToday = () => { const d = new Date(); d.setHours(23,59,59,999); return d; };
const startOfMonth = () => { const d = new Date(); d.setDate(1); d.setHours(0,0,0,0); return d; };
const endOfMonth = () => { const d = new Date(); d.setMonth(d.getMonth()+1, 0); d.setHours(23,59,59,999); return d; };
const inDays = (n: number) => { const d = startOfToday(); d.setDate(d.getDate()+n); return d; };
const safeNumber = (value: unknown) => {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
};
const fmtBRL = (v: number) => safeNumber(v).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtTime = (iso: string) => formatBR(iso, { day: "2-digit", month: "short" }) || "data indisponível";
const fmtDayLabel = (iso: string,reference=new Date()) => {
  const day=financialDay(iso);
  if (!day) return "";
  const diff=financialDaysBetween(reference,iso);
  if (diff === 0) return "Hoje";
  if (diff === 1) return "Amanhã";
  return new Date(day+'T12:00:00Z').toLocaleDateString('pt-BR',{timeZone:'America/Sao_Paulo',weekday:'short',day:'2-digit',month:'2-digit'});
};

const Hoje = () => {
  const { user } = useAuth();
  const clock=useFinancialClock();
  const financialToday=financialDay(clock)!;
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [savingId, setSavingId] = useState<string | null>(null);
  const [pendingPayment, setPendingPayment] = useState<any | null>(null);
  const [greeting, setGreeting] = useState("");

  useEffect(() => {
    const h = new Date().getHours();
    setGreeting(h < 12 ? "Bom dia" : h < 18 ? "Boa tarde" : "Boa noite");
  }, []);

  useMultiTableRealtime(
    ["contract_installments", "contracts", "transactions", "expenses", "todos", "notifications", "profits"],
    [["hoje", user?.id]],
  );

  const { data, isLoading, error: loadError, refetch } = useQuery({
    queryKey: ["hoje", user?.id,financialToday],
    queryFn: async () => {
      if (!user) return null;
      const bounds=financialBounds(financialToday,financialToday);
      const today=bounds.startDateTime,eod=bounds.endDateTime,in7=financialBounds(addFinancialDays(financialToday,7),addFinancialDays(financialToday,7)).endDateTime;
      const monthStart=financialToday.slice(0,7)+'-01';
      const monthEnd=new Date(Date.parse(monthStart+'T12:00:00Z'));monthEnd.setUTCMonth(monthEnd.getUTCMonth()+1);monthEnd.setUTCDate(0);
      const monthLast=monthEnd.toISOString().slice(0,10);
      const monthBounds=financialBounds(monthStart,monthLast),som=monthBounds.startDateTime,eom=monthBounds.endDateTime;

      const [
        dueTodayRes, overdueRes, todosRes, notifRes,promisesRes,
        next7Res,pendingMonthRes, clientsRes,
        cash, reconciliationRes,
      ] = await Promise.all([
        fetchAll((f, t) => supabase.from("contract_installments")
          .select("*, clients:client_id(name, phone, whatsapp), contracts:contract_id(capital, total_amount, total_interest, interest_rate, num_installments, loan_mode, frequency, daily_interest_percent, max_interest_cap_percent, status, daily_penalty_type, daily_penalty_value)")
          .eq("user_id", user.id).neq("status", "paid").neq("status", "cancelled")
          .gte("due_date", today).lt("due_date", eod)
          .order("due_date", { ascending: true }).range(f, t)).then((d) => ({ data: d })),
        fetchAll((f, t) => supabase.from("contract_installments")
          .select("*, clients:client_id(name, phone, whatsapp), contracts:contract_id(capital, total_amount, total_interest, interest_rate, num_installments, loan_mode, frequency, daily_interest_percent, max_interest_cap_percent, status, daily_penalty_type, daily_penalty_value)")
          .eq("user_id", user.id).neq("status", "paid").neq("status", "cancelled")
          .lt("due_date", today)
          .order("due_date", { ascending: true }).range(f, t)).then((d) => ({ data: d })),
        supabase.from("todos").select("id, task, is_complete").eq("user_id", user.id).eq("is_complete", false).order("created_at", { ascending: false }).limit(8),
        supabase.from("notifications").select("id, message, type, link, sent_at").eq("user_id", user.id).eq("is_read", false).order("sent_at", { ascending: false }).limit(5),
        supabase.from("audit_logs").select("id, details, created_at").eq("user_id", user.id).eq("action", "promise_to_pay").order("created_at", { ascending: false }).limit(5),
        // Agenda 7 dias (incluindo hoje)
        fetchAll((f, t) => supabase.from("contract_installments")
          .select("id, contract_id, amount, paid_amount, late_fee, pre_settlement_snapshot, due_date, status, client_id, clients:client_id(name), contracts:contract_id(status,daily_interest_percent,daily_penalty_type,daily_penalty_value,max_interest_cap_percent)")
          .eq("user_id", user.id).neq("status", "paid").neq("status", "cancelled")
          .gte("due_date", today).lt("due_date", in7)
          .order("due_date", { ascending: true }).range(f, t)).then((d) => ({ data: d })),
        // A receber no mês (pendente)
        fetchAll((f, t) => supabase.from("contract_installments").select("amount,paid_amount,late_fee,pre_settlement_snapshot,due_date,status,contracts:contract_id(status,daily_interest_percent,daily_penalty_type,daily_penalty_value,max_interest_cap_percent)")
          .eq("user_id", user.id).neq("status", "paid").neq("status", "cancelled")
          .gte("due_date", som).lt("due_date", eom).range(f, t)).then((d) => ({ data: d })),
        // Aniversariantes (puxa só os com birth_date e filtra no client)
        fetchAll((f, t) => supabase.from("clients")
          .select("id, name, birth_date, phone, whatsapp")
          .eq("user_id", user.id)
          .not("birth_date", "is", null)
          .range(f, t)).then((d) => ({ data: d })),
        (supabase as any).rpc("financial_analytics_report",{_expected_owner:user!.id}).then(({data,error}:any)=>{if(error)throw error;return financialAnalyticsSchema.parse(data);}),
        (supabase as any).rpc("financial_reconciliation"),
      ]);

      const failed = [dueTodayRes, todosRes, notifRes, promisesRes, next7Res, clientsRes]
        .find((result: any) => result?.error) as any;
      if (failed?.error) throw failed.error;

      for(const result of [dueTodayRes,overdueRes,next7Res,pendingMonthRes])result.data=(result.data||[]).filter((i:any)=>['active','overdue'].includes(i.contracts?.status||''));
      // Top devedores: agrupa atraso por cliente
      const debtors: Record<string, { id: string; name: string; total: number; count: number; phone?: string; whatsapp?: string }> = {};
      (overdueRes.data || []).forEach((i: any) => {
        const cid = i.client_id; if (!cid) return;
        if (!debtors[cid]) debtors[cid] = { id: cid, name: i.clients?.name || "Cliente", total: 0, count: 0, phone: i.clients?.phone, whatsapp: i.clients?.whatsapp };
        debtors[cid].total += portalInstallmentAmount(i,clock);
        debtors[cid].count += 1;
      });
      const topDebtors = Object.values(debtors).sort((a, b) => b.total - a.total).slice(0, 5);

      // Agenda 7 dias agrupada por data
      const agendaMap: Record<string, { date: string; items: any[]; total: number }> = {};
      (next7Res.data || []).forEach((i: any) => {
        const dueDate = String(i.due_date || "");
        if (!dueDate) return;
        const key = financialDay(dueDate);
        if(!key)return;
        if (!agendaMap[key]) agendaMap[key] = { date: dueDate, items: [], total: 0 };
        agendaMap[key].items.push(i);
        agendaMap[key].total += portalInstallmentAmount(i,clock);
      });
      const agenda = Object.values(agendaMap).sort((a, b) => a.date.localeCompare(b.date));

      // Aniversariantes de hoje
      const todayMD = financialToday.slice(5,10);
      const birthdays = (clientsRes.data || []).filter((c: any) => {
        if (!c.birth_date) return false;
        const md = c.birth_date.slice(5, 10);
        return md === todayMD;
      });

      const profitMonth=periodReceiptTotals(cash.receipts,monthStart,monthLast);
      const todayReceipts=periodReceiptTotals(cash.receipts,financialToday,financialToday);
      const aReceberMonth=(pendingMonthRes.data||[]).reduce((s:number,p:any)=>s+portalInstallmentAmount(p,clock),0);
      const promises = (promisesRes.data || []).map((p: any) => ({
        id: p.id, date: p.details?.promise_date, client: p.details?.client_name || "Cliente",
        msg: p.details?.message,
      }));
      const brokenPromises = promises.filter((p: any) => {
        const date = financialDay(p.date);
        return !!date && date < financialToday;
      }).length;

      return {
        dueToday: dueTodayRes.data || [],
        overdue: overdueRes.data || [],
        todos: todosRes.data || [],
        notifications: notifRes.data || [],
        profitToday: todayReceipts.interest+todayReceipts.fees,
        promises,
        brokenPromises,
        topDebtors,
        agenda,
        birthdays,
        paidRecent:cash.receipts.filter(r=>r.date).slice(0,5).map(r=>({...r,paid_at:r.date,paid_amount:r.amount,clients:{name:r.client_name||"Recebimento registrado"}})),
        profitMonth:profitMonth.interest+profitMonth.fees,
        aReceberMonth,
        availableCash:cash.wallet.totals.balance,
        cashWarnings:cash.wallet.totals.unclassified+cash.wallet.warnings.undated_amount,
        reconciliation: reconciliationRes.error ? null : reconciliationRes.data,
      };
    },
    enabled: !!user,
    staleTime: 30_000,
  });

  const totals = useMemo(() => ({
    dueToday: (data?.dueToday || []).reduce((s, i: any) => s + portalInstallmentAmount(i,clock), 0),
    overdue: (data?.overdue || []).reduce((s, i: any) => s + portalInstallmentAmount(i,clock), 0),
    overdueCount: data?.overdue.length || 0,
    dueTodayCount: data?.dueToday.length || 0,
  }), [data,clock]);

  const markPaid = async (
    inst: any,
    received: number,
    feeDiscount = 0,
    options?: { mode: "payment" | "interest_only" | "settle"; nextDueDate?: string },
  ) => {
    setSavingId(inst.id);
    if (options?.mode === "interest_only") {
      try {
        const { data: renewed, error } = await (supabase as any).rpc("renew_installment_interest", {
          _installment_id: inst.id,
          _next_due_date: options.nextDueDate,
          _method: "pix",
          _origin: "hoje",
        });
        if (error) {
          if (isMissingRpcError(error)) {
            throw new Error("A função segura de renovação não está ativa no Supabase. A migração precisa ser aplicada antes de registrar este pagamento.");
          }
          throw error;
        }
        setPendingPayment(null);
        toast.success("Juros recebidos e vencimento renovado", {
          description: `Recebido R$ ${fmtBRL(Number(renewed?.amount || received))}.`,
        });
        await Promise.all([
          qc.invalidateQueries({ queryKey: ["hoje"] }),
          qc.invalidateQueries({ queryKey: ["dashboard-data"] }),
        qc.invalidateQueries({queryKey:["analises-data"]}),
        qc.invalidateQueries({queryKey:["financial-analytics"]}),
        qc.invalidateQueries({queryKey:["carteira-cash-report"]}),
          qc.invalidateQueries({ queryKey: ["cobrancas-installments"] }),
        ]);
      } catch (error: any) {
        toast.error("Erro ao renovar vencimento", { description: error?.message });
        throw error;
      } finally {
        setSavingId(null);
      }
      return;
    }
    if (options?.mode === "settle") {
      try {
        const { error } = await (supabase as any).rpc("settle_percentage_installment", {
          _installment_id: inst.id,
          _method: "pix",
          _origin: "hoje",
        });
        if (error) throw error;
        setPendingPayment(null);
        toast.success("Capital e juros quitados");
        await Promise.all([
          qc.invalidateQueries({ queryKey: ["hoje"] }),
          qc.invalidateQueries({ queryKey: ["dashboard-data"] }),
        qc.invalidateQueries({queryKey:["analises-data"]}),
        qc.invalidateQueries({queryKey:["financial-analytics"]}),
        qc.invalidateQueries({queryKey:["carteira-cash-report"]}),
          qc.invalidateQueries({ queryKey: ["cobrancas-installments"] }),
        ]);
      } catch (error: any) {
        toast.error("Erro ao quitar capital e juros", { description: error?.message });
        throw error;
      } finally {
        setSavingId(null);
      }
      return;
    }
    // RPC atômico, o mesmo usado em Cobranças e no Detalhe do Cliente: numa
    // transação só ele baixa a parcela, lança o lucro (juros reais do contrato),
    // lança o caixa e conclui o contrato se foi a última.
    //
    // Esta tela gravava direto com .update() — o pagamento entrava na parcela e
    // NUNCA aparecia em Lucros nem no caixa. Em 2026-08-05 havia 88 pagamentos
    // recentes (R$ 16.164,28) fora do razão por causa deste caminho e dos outros
    // que também não usavam o RPC.
    const breakdown = computeLateFeeBreakdown(inst);
    const alreadyPaid = Number(inst.paid_amount || 0);
    const appliedDiscount = Math.max(0, Math.min(Number(feeDiscount || 0), breakdown.total));
    const totalDue = breakdown.withFees - appliedDiscount;
    const remaining = Math.max(0, Math.round((totalDue - alreadyPaid) * 100) / 100);
    const isFull = received + 0.005 >= remaining;
    try {
      const result = await supabase.rpc("pay_installment", {
            _installment_id: inst.id,
            _paid_total: alreadyPaid + received,
            _mark_paid: isFull,
            _method: "pix",
            _receipt_url: null,
            _source_key: null,
            _fee_discount:appliedDiscount,
          });
      if (result.error) throw result.error;
      setPendingPayment(null);
      toast.success(isFull ? (appliedDiscount > 0 ? "Parcela quitada com desconto" : "Pagamento registrado") : "Pagamento parcial registrado");
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["hoje"] }),
        qc.invalidateQueries({ queryKey: ["dashboard-data"] }),
        qc.invalidateQueries({queryKey:["analises-data"]}),
        qc.invalidateQueries({queryKey:["financial-analytics"]}),
        qc.invalidateQueries({queryKey:["carteira-cash-report"]}),
        qc.invalidateQueries({ queryKey: ["cobrancas-installments"] }),
      ]);
    } catch (error: any) {
      toast.error(appliedDiscount > 0 ? "Não foi possível aplicar o desconto" : "Erro ao registrar pagamento", { description: error?.message });
      throw error;
    } finally {
      setSavingId(null);
    }
  };

  const toggleTodo = async (id: string, current: boolean) => {
    if (!user) return;
    const { error } = await supabase.from("todos").update({ is_complete: !current }).eq("id", id).eq("user_id", user.id);
    if (error) { toast.error("Não foi possível atualizar a tarefa"); return; }
    qc.invalidateQueries({ queryKey: ["hoje"] });
  };

  const sendWhats = (phone?: string, clientName?: string, customMsg?: string, amount?: number, due?: string) => {
    if (!phone) { toast.error("Cliente sem telefone"); return; }
    const clean = phone.replace(/\D/g, "");
    const num = clean.startsWith("55") ? clean : `55${clean}`;
    const msg = encodeURIComponent(customMsg || `Olá ${clientName || ""}! Lembrete da parcela de R$ ${fmtBRL(amount || 0)} vencendo em ${due ? fmtTime(due) : "breve"}.`);
    window.open(`https://wa.me/${num}?text=${msg}`, "_blank", "noopener,noreferrer");
  };

  if (isLoading) {
    return (
      <div className="space-y-3 animate-pulse">
        <div className="h-16 rounded-2xl bg-muted/30" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          {Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-16 rounded-xl bg-muted/30" />)}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
          {Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-64 rounded-2xl bg-muted/30" />)}
        </div>
      </div>
    );
  }

  if (loadError || !data) {
    return <ErrorState error={loadError} title="Não foi possível carregar o resumo do dia" onRetry={() => { void refetch(); }} />;
  }

  const quickActions = [
    { label: "Novo cliente",         Icon: UserPlus,   to: "/clientes/novo", tone: "primary" },
    { label: "Registrar pagamento",  Icon: DollarSign, to: "/cobrancas",     tone: "success" },
  ] as const;

  const toneMap: Record<string, { chip: string; ring: string; dot: string }> = {
    primary: { chip: "bg-primary/10 text-primary",           ring: "ring-primary/20",     dot: "bg-primary" },
    success: { chip: "bg-success/10 text-success",           ring: "ring-success/20",     dot: "bg-success" },
    danger:  { chip: "bg-destructive/10 text-destructive",   ring: "ring-destructive/20", dot: "bg-destructive" },
    amber:   { chip: "bg-amber-500/10 text-amber-500",       ring: "ring-amber-500/20",   dot: "bg-amber-500" },
  };

  const nowLong = new Date().toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long" });
  const isCalm = totals.dueTodayCount === 0 && totals.overdueCount === 0;

  return (
    <section className="space-y-4 sm:space-y-5" aria-labelledby="hoje-title">
      <a
        href="#hoje-cobrancas"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-100 focus:px-3 focus:py-2 focus:rounded-lg focus:bg-primary focus:text-primary-foreground focus:text-xs focus:font-bold"
      >
        Pular para cobranças prioritárias
      </a>

      {/* ═══ Command Hero ═══
          Header editorial: data + saudação à esquerda, status pill inline,
          CTA primário à direita. Aurora sutil, sem excesso de vidro. */}
      <header className="relative overflow-hidden rounded-2xl border border-border/60 bg-card/65 shadow-[0_18px_50px_-38px_rgba(0,0,0,.9)] backdrop-blur-xl">
        <div className="pointer-events-none absolute inset-0 opacity-70" aria-hidden="true">
          <div className="absolute -top-24 -left-16 w-72 h-72 rounded-full bg-primary/[.07] blur-3xl" />
          <div className="absolute inset-x-6 bottom-0 h-px bg-linear-to-r from-transparent via-border/60 to-transparent" />
        </div>

        <div className="relative px-4 sm:px-6 py-4 sm:py-5 flex items-start sm:items-center justify-between gap-4 flex-wrap sm:flex-nowrap">
          <div className="min-w-0 flex items-center gap-4">
            <span className="hidden sm:flex w-10 h-10 rounded-xl bg-primary/10 ring-1 ring-primary/20 items-center justify-center shrink-0">
              <Sunrise size={20} className="text-primary" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <p className="text-[10px] uppercase tracking-[0.24em] text-muted-foreground font-bold truncate">
                {nowLong}
              </p>
              <h1 id="hoje-title" className="mt-1 text-xl sm:text-2xl font-extrabold text-foreground leading-none tracking-tight">
                {greeting}<span aria-hidden="true" className="ml-2 inline-block">👋</span>
              </h1>
              <p className="mt-2 text-xs text-muted-foreground flex items-center gap-2 flex-wrap" aria-live="polite">
                <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-bold ${isCalm ? "bg-success/10 text-success ring-1 ring-success/20" : "bg-amber-500/10 text-amber-500 ring-1 ring-amber-500/20"}`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${isCalm ? "bg-success" : "bg-amber-500"}`} />
                  {isCalm ? "Tudo em dia" : "Cobranças pendentes"}
                </span>
                {!isCalm && (
                  <>
                    <span className="tabular-nums">
                      <span className="font-bold text-foreground">{totals.dueTodayCount}</span>
                      <span className="ml-1 text-muted-foreground">hoje</span>
                    </span>
                    <span className="opacity-30">·</span>
                    <span className="tabular-nums">
                      <span className="font-bold text-destructive">{totals.overdueCount}</span>
                      <span className="ml-1 text-muted-foreground">em atraso</span>
                    </span>
                  </>
                )}
              </p>
            </div>
          </div>

          <button
            onClick={() => navigate("/clientes/novo")}
            className="w-full sm:w-auto shrink-0 h-10 px-4 rounded-xl text-sm font-bold text-primary-foreground flex items-center justify-center gap-2 transition-colors hover:brightness-110"
            style={{ background: "var(--gradient-button, linear-gradient(135deg,hsl(var(--primary)),hsl(var(--primary)/0.78)))" }}
            aria-label="Novo cliente"
          >
            <Plus size={15} />
            <span className="tracking-tight">Novo cliente</span>
          </button>
        </div>

        {/* KPI ribbon: só o essencial do "hoje" */}
        <div className="relative grid grid-cols-2 border-t border-border/60 divide-x divide-border/40">
          {[
            { label: "Vencendo hoje",    value: totals.dueToday,          sub: `${totals.dueTodayCount} parcelas`, tone: "primary" as const, Icon: Clock },
            { label: "Em atraso",        value: totals.overdue,           sub: `${totals.overdueCount} parcelas`, tone: "danger" as const,  Icon: AlertCircle },
          ].map((k) => {
            const t = toneMap[k.tone];
            return (
              <div key={k.label} className="group relative min-w-0 px-3 sm:px-5 py-3.5 transition-colors hover:bg-accent/20">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground font-bold truncate">{k.label}</p>
                  <span className={`w-6 h-6 rounded-lg ring-1 ${t.ring} ${t.chip} flex items-center justify-center shrink-0`}>
                    <k.Icon size={11} aria-hidden="true" />
                  </span>
                </div>
                <p className="text-[13px] sm:text-[15px] text-muted-foreground/50 font-semibold tabular-nums leading-none">R$</p>
                <p className="mt-0.5 text-lg sm:text-2xl font-extrabold text-foreground leading-none tracking-tight tabular-nums wrap-break-word">
                  {fmtBRL(k.value)}
                </p>
                <p className="mt-2 text-[11px] text-muted-foreground/80 truncate flex items-center gap-1.5">
                  <span className={`w-1 h-1 rounded-full ${t.dot}`} />
                  {k.sub}
                </p>
              </div>
            );
          })}
        </div>
      </header>

      {/* Assistente do dia: resumo determinístico, sem depender de IA. */}
      <section aria-label="Prioridades do dia" className="rounded-2xl border border-border/50 bg-card/60 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[.18em] text-primary">Assistente do dia</p>
            <h2 className="mt-1 text-sm font-bold text-foreground">Próximas ações recomendadas</h2>
          </div>
          <div className="flex flex-wrap gap-2 text-[11px]">
            <span className="rounded-full border border-border px-2.5 py-1 text-muted-foreground">
              Caixa <strong className="text-foreground">R$ {fmtBRL(Number(data?.availableCash || 0))}</strong>
            </span>
            {data?.reconciliation && (
              <span className={`rounded-full border px-2.5 py-1 font-semibold ${data.reconciliation.ok ? "border-success/25 text-success" : "border-destructive/30 text-destructive"}`}>
                <ShieldCheck size={11} className="mr-1 inline" />
                {data.reconciliation.ok ? "Contas conciliadas" : `${data.reconciliation.anomaly_count} divergência(s)`}
              </span>
            )}
          </div>
        </div>
        <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          {[
            { label: "Cobrar atrasadas", value: totals.overdueCount, detail: `R$ ${fmtBRL(totals.overdue)}`, to: "/cobrancas" },
            { label: "Receber hoje", value: totals.dueTodayCount, detail: `R$ ${fmtBRL(totals.dueToday)}`, to: "/cobrancas" },
            { label: "Promessas vencidas", value: data?.brokenPromises || 0, detail: "retomar contato", to: "/hoje#promessas" },
            { label: "Tarefas abertas", value: data?.todos?.length || 0, detail: "organizar operação", to: "/tarefas" },
          ].map((priority) => (
            <button key={priority.label} onClick={() => navigate(priority.to)}
              className="flex min-w-0 items-center justify-between gap-3 rounded-xl border border-border/40 bg-background/30 px-3 py-2.5 text-left hover:bg-accent/30">
              <span className="min-w-0"><span className="block truncate text-xs font-semibold text-foreground">{priority.label}</span><span className="text-[10px] text-muted-foreground">{priority.detail}</span></span>
              <span className="text-lg font-black tabular-nums text-primary">{priority.value}</span>
            </button>
          ))}
        </div>
      </section>

      {/* ═══ Atalhos ═══ Linha compacta abaixo do hero */}
      <nav aria-label="Ações rápidas" className="grid grid-cols-2 gap-2 sm:gap-3">
        {quickActions.map(a => {
          const t = toneMap[a.tone];
          return (
            <button
              key={a.label}
              onClick={() => navigate(a.to)}
              className="group relative min-w-0 overflow-hidden rounded-xl border border-border/50 bg-card/50 px-3 sm:px-4 py-3 flex items-center gap-2.5 text-left transition-colors hover:border-border hover:bg-card/80"
            >
              <span className={`shrink-0 w-9 h-9 rounded-xl ring-1 ${t.ring} ${t.chip} flex items-center justify-center`}>
                <a.Icon size={16} />
              </span>
              <span className="flex-1 min-w-0 text-[13px] font-bold text-foreground truncate tracking-tight">
                {a.label}
              </span>
              <ArrowRight size={13} className="text-muted-foreground/40 opacity-0 -translate-x-1 group-hover:opacity-100 group-hover:translate-x-0 transition-all duration-200" />
            </button>
          );
        })}
      </nav>

      {/* Visão operacional: contexto suficiente para decidir sem abrir relatórios. */}
      {!!data?.cashWarnings&&<p role="status" className="rounded-xl border border-border p-3 text-sm text-muted-foreground">Há recebimentos sem composição ou data comprovada. O caixa inclui o histórico comprovado; o lucro do período usa somente recebimentos datados e classificados.</p>}
      <section aria-label="Resumo da operação" className="grid grid-cols-2 xl:grid-cols-4 gap-2.5">
        {[
          { label: "Lucro hoje", value: data?.profitToday || 0, helper: "resultado confirmado", Icon: TrendingUp, tone: "text-success bg-success/10 ring-success/20" },
          { label: "A receber no mês", value: data?.aReceberMonth || 0, helper: "parcelas pendentes", Icon: CalendarDays, tone: "text-foreground bg-white/6 ring-white/10" },
          { label: "Lucro no mês", value: data?.profitMonth || 0, helper: "resultado realizado", Icon: Wallet, tone: "text-success bg-success/10 ring-success/20" },
          { label: "Pagamentos recentes", value: data?.paidRecent?.length || 0, helper: "últimas baixas", Icon: History, tone: "text-muted-foreground bg-white/4 ring-white/10", count: true },
        ].map((item) => (
          <article key={item.label} className="min-w-0 rounded-xl border border-white/10 bg-card/55 p-3 sm:p-4 backdrop-blur-xl">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-[10px] font-bold uppercase tracking-[.14em] text-muted-foreground truncate">{item.label}</p>
                <p className="mt-2 text-base sm:text-xl font-extrabold tabular-nums text-foreground wrap-break-word">
                {item.count ? item.value : `R$ ${fmtBRL(safeNumber(item.value))}`}
                </p>
                <p className="mt-1 text-[11px] text-muted-foreground">{item.helper}</p>
              </div>
              <span className={`w-9 h-9 rounded-xl ring-1 flex items-center justify-center shrink-0 ${item.tone}`}>
                <item.Icon size={15} aria-hidden="true" />
              </span>
            </div>
          </article>
        ))}
      </section>



      {/* Primeiro nível: Cobranças + painel lateral */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <section
          id="hoje-cobrancas"
          aria-labelledby="hoje-cobrancas-title"
          className="lg:col-span-2 rounded-2xl border border-border/40 bg-card/60 overflow-hidden shadow-[0_18px_50px_-42px_rgba(0,0,0,.9)]"
        >
          <div className="px-4 py-3 border-b border-border/30 flex items-center justify-between gap-3">
            <h2 id="hoje-cobrancas-title" className="text-sm font-bold text-foreground flex items-center gap-1.5">
              <Receipt size={12} className="text-primary" /> Cobranças prioritárias
            </h2>
            <button type="button" onClick={() => navigate("/cobrancas")} className="text-xs text-primary hover:underline flex items-center gap-1">
              Ver todas <ArrowRight size={10} />
            </button>
          </div>
          <ul className="divide-y divide-border/20 max-h-[380px] overflow-y-auto">
            {[...(data?.overdue || []), ...(data?.dueToday || [])].length === 0 && (
              <li className="py-10 text-center list-none">
                <CheckCircle2 size={28} className="mx-auto text-success/60 mb-1.5" />
                <p className="text-xs font-semibold text-foreground">Tudo em dia!</p>
              </li>
            )}
            {[...(data?.overdue || []), ...(data?.dueToday || [])].slice(0, 30).map((inst: any) => {
              const dueLocal = parseLocalDate(inst.due_date);
              if (!dueLocal) return null;
              const daysLate=Math.max(0,financialDaysBetween(inst.due_date,clock));
              const isOverdue=daysLate>0;
              const clientName = inst.clients?.name || "Cliente";
              const amount = portalInstallmentAmount(inst,clock);
              return (
                <li key={inst.id} className="px-3 sm:px-4 py-3 grid grid-cols-[minmax(0,1fr)_auto] sm:grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-x-3 gap-y-2 hover:bg-accent/20 transition-colors">
                  <button onClick={() => navigate(`/clientes/${inst.client_id}`)} className="flex-1 min-w-0 text-left">
                    <div className="flex items-center gap-1.5 mb-0.5">
                      <p className="text-xs font-semibold text-foreground truncate">{clientName}</p>
                      {isOverdue && (
                        <span className="text-xs px-1.5 py-0.5 rounded-full bg-destructive/15 text-destructive font-bold">{daysLate}d</span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground truncate">
                      Parc {inst.installment_number} · {fmtTime(inst.due_date)}
                      {inst.contract_id && (
                        <span className="ml-1 px-1 py-0.5 rounded bg-primary/10 text-primary font-mono text-xs" title={`Contrato ${inst.contract_id}`}>
                          #{String(inst.contract_id).slice(0, 6)}
                        </span>
                      )}
                    </p>
                  </button>
                  <p className="text-xs sm:text-sm font-bold text-foreground whitespace-nowrap">R$ {fmtBRL(amount)}</p>
                  <div className="col-span-2 sm:col-span-1 grid grid-cols-2 sm:flex gap-1.5">
                    <button
                      onClick={() => sendWhats(inst.clients?.whatsapp || inst.clients?.phone, clientName, undefined, amount, inst.due_date)}
                      className="min-w-9 min-h-9 px-2 rounded-lg bg-success/10 text-success hover:bg-success/20 inline-flex items-center justify-center gap-1.5"
                      aria-label={`Cobrar ${clientName} pelo WhatsApp`}
                    >
                      <MessageSquare size={12} />
                      <span className="text-[11px] font-bold sm:hidden">WhatsApp</span>
                    </button>
                    <button
                      onClick={() => setPendingPayment({ ...inst, client_name: clientName })}
                      disabled={savingId === inst.id}
                      className="min-h-9 px-2.5 rounded-lg bg-primary text-primary-foreground text-xs font-bold hover:bg-primary/90 disabled:opacity-50 flex items-center justify-center gap-1"
                    >
                      {savingId === inst.id ? <Loader2 size={11} className="animate-spin" /> : <CheckCircle2 size={11} />}
                      <span>Pagar</span>
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>

        <aside className="space-y-3" aria-label="Tarefas e alertas">
          <section className="rounded-2xl border border-border/40 bg-card/60 overflow-hidden">
            <div className="px-3 py-2 border-b border-border/30 flex items-center justify-between">
              <h2 className="text-sm font-bold text-foreground flex items-center gap-1.5">
                <ListTodo size={12} className="text-amber-400" /> Tarefas
              </h2>
              <button onClick={() => navigate("/ferramentas/tarefas")} className="text-xs text-primary hover:underline">Ver tudo</button>
            </div>
            <ul className="divide-y divide-border/20 max-h-48 overflow-y-auto">
              {data?.todos.length === 0 && (
                <li className="px-3 py-5 text-xs text-muted-foreground text-center list-none">Nenhuma tarefa</li>
              )}
              {data?.todos.map((t: any) => (
                <li key={t.id}>
                  <button
                    onClick={() => toggleTodo(t.id, t.is_complete)}
                    className="w-full px-3 py-2 flex items-start gap-2 hover:bg-accent/20 transition-colors text-left"
                  >
                    <div className="w-3.5 h-3.5 mt-0.5 rounded border-2 border-border shrink-0" />
                    <p className="text-xs text-foreground flex-1 leading-snug">{t.task}</p>
                  </button>
                </li>
              ))}
            </ul>
          </section>

          {data?.promises && data.promises.length > 0 && (
            <section className="rounded-2xl border border-primary/20 bg-primary/5 overflow-hidden">
              <div className="px-3 py-2 border-b border-primary/20">
                <h2 className="text-sm font-bold text-primary flex items-center gap-1.5">
                  <Sparkles size={12} /> Promessas IA
                </h2>
              </div>
              <ul className="divide-y divide-primary/10">
                {data.promises.map((p: any) => (
                  <li key={p.id} className="px-3 py-2">
                    <p className="text-xs font-bold text-foreground">{p.client}</p>
                    <p className="text-xs text-muted-foreground line-clamp-1 italic">"{p.msg}"</p>
                    <div className="mt-0.5 flex items-center gap-1">
                      <Clock size={9} className="text-primary" />
                      <span className="text-xs font-bold text-primary">{p.date ? formatBR(p.date) : '??'}</span>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <SmartAlerts
            overdue={data?.overdue || []}
            dueToday={data?.dueToday || []}
            notifications={data?.notifications || []}
          />
        </aside>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <section className="rounded-2xl border border-white/10 bg-card/55 overflow-hidden" aria-labelledby="agenda-title">
          <div className="px-4 py-3 border-b border-white/8 flex items-center justify-between">
            <div>
              <h2 id="agenda-title" className="text-sm font-bold text-foreground">Próximos 7 dias</h2>
              <p className="text-[11px] text-muted-foreground">Agenda prevista de recebimentos</p>
            </div>
            <CalendarDays size={16} className="text-muted-foreground" />
          </div>
          <div className="divide-y divide-white/6 max-h-72 overflow-y-auto">
            {(data?.agenda || []).length === 0 && <p className="p-6 text-center text-xs text-muted-foreground">Nenhum vencimento nos próximos dias.</p>}
            {(data?.agenda || []).map((day: any) => (
              <button key={day.date} onClick={() => navigate("/cobrancas")} className="w-full px-4 py-3 flex items-center justify-between gap-3 text-left hover:bg-white/[.035] transition-colors">
                <div>
                  <p className="text-xs font-bold text-foreground capitalize">{fmtDayLabel(day.date,clock)}</p>
                  <p className="text-[11px] text-muted-foreground">{day.items.length} parcela{day.items.length !== 1 ? "s" : ""}</p>
                </div>
                <p className="text-sm font-bold tabular-nums text-foreground">R$ {fmtBRL(day.total)}</p>
              </button>
            ))}
          </div>
        </section>

        <section className="rounded-2xl border border-white/10 bg-card/55 overflow-hidden" aria-labelledby="recentes-title">
          <div className="px-4 py-3 border-b border-white/8 flex items-center justify-between">
            <div>
              <h2 id="recentes-title" className="text-sm font-bold text-foreground">Pagamentos recentes</h2>
              <p className="text-[11px] text-muted-foreground">Últimas baixas confirmadas</p>
            </div>
            <History size={16} className="text-muted-foreground" />
          </div>
          <div className="divide-y divide-white/6 max-h-72 overflow-y-auto">
            {(data?.paidRecent || []).length === 0 && <p className="p-6 text-center text-xs text-muted-foreground">Nenhum pagamento recente.</p>}
            {(data?.paidRecent || []).map((payment: any) => (
              <button key={payment.id} onClick={() => navigate(`/clientes/${payment.client_id}`)} className="w-full px-4 py-3 flex items-center justify-between gap-3 text-left hover:bg-white/[.035] transition-colors">
                <div className="min-w-0">
                  <p className="text-xs font-bold text-foreground truncate">{payment.clients?.name || "Cliente"}</p>
                  <p className="text-[11px] text-muted-foreground">{payment.paid_at ? formatBR(payment.paid_at) : "Data não informada"}</p>
                </div>
                <p className="text-sm font-bold tabular-nums text-success shrink-0">+ R$ {fmtBRL(safeNumber(payment.paid_amount))}</p>
              </button>
            ))}
          </div>
        </section>
      </div>

      {/* Aniversariantes — só aparece se houver alguém hoje */}
      {(data?.birthdays || []).length > 0 && (
        <section className="rounded-2xl border border-pink-500/20 bg-pink-500/5 overflow-hidden">
          <div className="px-3 py-2 border-b border-pink-500/20 flex items-center justify-between">
            <h2 className="text-sm font-bold text-pink-400 flex items-center gap-1.5">
              <Cake size={12} /> Aniversariantes de hoje
            </h2>
          </div>
          <ul className="divide-y divide-pink-500/10">
            {(data?.birthdays || []).map((c: any) => (
              <li key={c.id} className="px-3 py-2 flex items-center gap-2">
                <span className="text-base" aria-hidden>🎂</span>
                <button onClick={() => navigate(`/clientes/${c.id}`)} className="flex-1 min-w-0 text-left">
                  <p className="text-xs font-semibold text-foreground truncate">{c.name}</p>
                  <p className="text-xs text-muted-foreground">{formatBR(c.birth_date)}</p>
                </button>
                <button
                  onClick={() => sendWhats(c.whatsapp || c.phone, c.name, `Feliz aniversário, ${c.name}! 🎉 Tudo de bom para você hoje.`)}
                  className="min-w-8 min-h-8 p-1.5 rounded-lg bg-pink-500/15 text-pink-400 hover:bg-pink-500/25"
                >
                  <MessageSquare size={11} />
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {pendingPayment && (() => {
        const fee = computeLateFeeBreakdown(pendingPayment,clock);
        const alreadyPaid = safeNumber(pendingPayment.paid_amount);
        const remaining = Math.max(0, Math.round((fee.withFees - alreadyPaid) * 100) / 100);
        return (
          <PayModal
            inst={pendingPayment}
            fee={fee}
            alreadyPaid={alreadyPaid}
            remaining={remaining}
            daysLate={fee.daysLate}
            onCancel={() => setPendingPayment(null)}
            onConfirm={(value, feeDiscount, options) => markPaid(pendingPayment, value, feeDiscount, options)}
          />
        );
      })()}
    </section>
  );
};

export default Hoje;
