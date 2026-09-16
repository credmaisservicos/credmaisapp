import { useState, useMemo } from "react";
import {
  Wallet,
  ArrowUpRight,
  ArrowDownRight,
  TrendingUp,
  TrendingDown,
  Banknote,
  CreditCard,
  Plus,
  Minus,
  Calendar,
  Search,
  X,
  PiggyBank,
  Receipt,
  Sparkles,
  Activity,
  AlertTriangle,
  RefreshCw,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMultiTableRealtime } from "@/hooks/useRealtimeSubscription";
import { formatBR, parseLocalDate } from "@/lib/dateUtils";
import { useConfirm } from "@/components/ConfirmProvider";
import { fetchAll } from "@/lib/fetchAll";
import { parseFinancialAmount } from "@/lib/financialEntry";

type PeriodKey = "all" | "7d" | "30d" | "90d";
const safeNumber = (value: unknown) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
};
const safeDateMs = (value: unknown) => {
  return parseLocalDate(typeof value === "string" || value instanceof Date ? value : null)?.getTime() ?? null;
};

const Carteira = () => {
  const confirm = useConfirm();
  const { user } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [period, setPeriod] = useState<PeriodKey>("all");
  const [searchTimeline, setSearchTimeline] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogType, setDialogType] = useState<"in" | "out" | "withdraw">("in");
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);

  useMultiTableRealtime(
    ["profits", "expenses", "contract_installments", "transactions"],
    [
      ["carteira-profits", user?.id || ""],
      ["carteira-expenses", user?.id || ""],
      // Precisa bater EXATAMENTE com o queryKey da consulta abaixo. Estava
      // "carteira-installments" enquanto a query usava outro nome — o realtime
      // nunca atualizava a carteira quando um pagamento era registrado.
      ["carteira-installments-recebidas", user?.id || ""],
      ["carteira-capital", user?.id || ""],
      ["carteira-withdrawals", user?.id || ""],
      ["carteira-receivables", user?.id || ""],
    ],
  );

  const { data: profits = [], isLoading: loadingProfits, error: profitsError } = useQuery({
    queryKey: ["carteira-profits", user?.id],
    queryFn: async () => fetchAll((f, t) => supabase.from("profits").select("*").eq("user_id", user!.id).order("date", { ascending: false }).range(f, t)),
    enabled: !!user,
  });

  const { data: expenses = [], isLoading: loadingExpenses, error: expensesError } = useQuery({
    queryKey: ["carteira-expenses", user?.id],
    queryFn: async () => fetchAll((f, t) => supabase.from("expenses").select("*").eq("user_id", user!.id).order("date", { ascending: false }).range(f, t)),
    enabled: !!user,
  });

  const { data: installments = [], isLoading: loadingInst, error: installmentsError } = useQuery({
    queryKey: ["carteira-installments-recebidas", user?.id],
    queryFn: async () =>
      // TODAS as parcelas recebidas, não só as de contrato ativo.
      //
      // A consulta anterior limitava a contratos "active"/"overdue" — o dinheiro
      // que entrou por contratos já quitados sumia da carteira. Em 2026-08-05
      // eram R$ 121.756,96 de recebimento invisível, mais da metade do total.
      // Contrato encerrado sai do "capital na rua" (isso é do painel), mas o
      // dinheiro que ele trouxe continua no caixa.
      fetchAll((f, t) =>
        supabase.from("contract_installments")
          .select("id, amount, paid_amount, paid_at, contract_id, client_id")
          .eq("user_id", user!.id)
          .eq("status", "paid")
          .order("paid_at", { ascending: false })
          .range(f, t),
      ),
    enabled: !!user,
  });

  const { data: capital = [], isLoading: loadingCapital, error: capitalError } = useQuery({
    queryKey: ["carteira-capital", user?.id],
    queryFn: async () => fetchAll((f, t) => supabase.from("transactions").select("*").eq("user_id", user!.id).eq("type", "capital_injection").order("date", { ascending: false }).range(f, t)),
    enabled: !!user,
  });

  const { data: withdrawals = [], isLoading: loadingWithdraw, error: withdrawalsError } = useQuery({
    queryKey: ["carteira-withdrawals", user?.id],
    queryFn: async () => fetchAll((f, t) => supabase.from("transactions").select("*").eq("user_id", user!.id).eq("type", "capital_withdrawal").order("date", { ascending: false }).range(f, t)),
    enabled: !!user,
  });

  const { data: ledgerOutflows = [], isLoading: loadingLedger, error: ledgerError } = useQuery({
    queryKey: ["carteira-ledger-outflows", user?.id],
    queryFn: async () => fetchAll((f, t) => supabase.from("transactions").select("*")
      .eq("user_id", user!.id).in("type", ["loan_disbursement", "expense"])
      .order("date", { ascending: false }).range(f, t)),
    enabled: !!user,
  });

  const { data: receivables = [], isLoading: loadingReceivables, error: receivablesError } = useQuery({
    queryKey: ["carteira-receivables", user?.id],
    queryFn: async () => fetchAll((f, t) => supabase.from("contract_installments")
      .select("id,amount,paid_amount,due_date,status").eq("user_id", user!.id)
      .neq("status", "paid").neq("status", "cancelled").order("due_date").range(f, t)),
    enabled: !!user,
  });

  const { data: reconciliation } = useQuery({
    queryKey: ["financial-reconciliation", user?.id],
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("financial_reconciliation");
      if (error) return null; // Compatível enquanto a migração remota não foi aplicada.
      return data as { ok: boolean; checked_installments: number; anomaly_count: number };
    },
    enabled: !!user,
    retry: false,
  });

  const loading = loadingProfits || loadingExpenses || loadingInst || loadingCapital || loadingWithdraw || loadingLedger || loadingReceivables;
  const loadError = profitsError || expensesError || installmentsError || capitalError || withdrawalsError || ledgerError || receivablesError;

  const handleSave = async () => {
    if (!user || !amount || !description || saving) return;
    setSaving(true);
    const now = new Date().toISOString();
    const val = parseFinancialAmount(amount);
    if (val === null) {
      toast({ title: "Valor inválido", variant: "destructive" });
      setSaving(false);
      return;
    }

    if (dialogType === "in") {
      const { error } = await supabase.from("transactions").insert({
        user_id: user.id, amount: val, description, date: now,
        type: "capital_injection", category: "Aporte de capital",
      });
      if (error) { toast({ title: "Erro ao adicionar aporte", variant: "destructive" }); setSaving(false); return; }
    } else if (dialogType === "withdraw") {
      const { error } = await supabase.from("transactions").insert({
        user_id: user.id, amount: val, description, date: now,
        type: "capital_withdrawal", category: "Retirada de capital",
      });
      if (error) { toast({ title: "Erro ao retirar capital", variant: "destructive" }); setSaving(false); return; }
    } else {
      const { error } = await supabase.from("expenses").insert({ user_id: user.id, amount: val, description, date: now, category: "Retirada manual" });
      if (error) { toast({ title: "Erro ao registrar saída", variant: "destructive" }); setSaving(false); return; }
    }

    toast({ title: dialogType === "in" ? "✓ Aporte adicionado!" : dialogType === "withdraw" ? "✓ Capital retirado!" : "✓ Saída registrada!" });
    setAmount(""); setDescription(""); setDialogOpen(false); setSaving(false);
    qc.invalidateQueries({ queryKey: ["carteira-capital"] });
    qc.invalidateQueries({ queryKey: ["carteira-withdrawals"] });
    qc.invalidateQueries({ queryKey: ["carteira-expenses"] });
    qc.invalidateQueries({ queryKey: ["dashboard-data"] });
  };

  const handleDeleteCapital = async (id: string) => {
    if (!(await confirm("Remover este lançamento de capital?"))) return;
    if (!user) return;
    const { error } = await supabase.from("transactions").delete().eq("id", id).eq("user_id", user.id);
    if (error) { toast({ title: "Erro ao remover", variant: "destructive" }); return; }
    toast({ title: "✓ Lançamento removido" });
    qc.invalidateQueries({ queryKey: ["carteira-capital"] });
    qc.invalidateQueries({ queryKey: ["carteira-withdrawals"] });
  };

  // === Totais globais (saldo real) ===
  //
  // O lucro NÃO é uma entrada separada: ele já está dentro da parcela recebida.
  // Uma parcela de R$ 250 com R$ 220 de juros gera uma linha em `profits` de
  // R$ 220 — somar as duas contava R$ 470 de entrada para R$ 250 que entraram.
  // Na base de 2026-08-05 isso inflava o saldo em R$ 24.159,34.
  //
  // O lucro continua visível como composição: quanto do que entrou era juros.
  const totalCapital = capital.reduce((a: number, c: any) => a + safeNumber(c.amount), 0);
  const totalWithdrawals = withdrawals.reduce((a: number, w: any) => a + safeNumber(w.amount), 0);
  const totalLucros = profits.reduce((a: number, p: any) => a + safeNumber(p.amount), 0);
  const totalParcelas = installments.reduce((a: number, i: any) => a + safeNumber(i.paid_amount || i.amount), 0);
  // Enquanto a migração ainda não chegou ao ambiente remoto, a diferença
  // recebimentos-lucro preserva compatibilidade. Após a migração, o razão
  // passa a fornecer a mesma composição de forma explícita.
  const principalRecebido = installments.some((i: any) => i.paid_principal != null)
    ? installments.reduce((a: number, i: any) => a + safeNumber(i.paid_principal), 0)
    : Math.max(0, totalParcelas - totalLucros);
  const totalEmprestimosLiberados = ledgerOutflows.filter((t: any) => t.type === "loan_disbursement").reduce((a: number, t: any) => a + safeNumber(t.amount), 0);
  const totalSaidasRazao = ledgerOutflows.filter((t: any) => t.type === "expense").reduce((a: number, t: any) => a + safeNumber(t.amount), 0);
  const totalGastos = expenses.reduce((a: number, e: any) => a + safeNumber(e.amount), 0);
  const totalEntradas = totalCapital + totalParcelas;
  const totalSaidas = totalGastos + totalWithdrawals + totalEmprestimosLiberados + totalSaidasRazao;
  const saldo = totalEntradas - totalSaidas;

  // === Filtros de período ===
  const periodDays: Record<PeriodKey, number | null> = { all: null, "7d": 7, "30d": 30, "90d": 90 };
  const withinPeriod = (dateStr: string, days: number | null) => {
    if (days == null) return true;
    const timestamp = safeDateMs(dateStr);
    if (timestamp == null) return false;
    const diff = (Date.now() - timestamp) / 86400000;
    return diff <= days;
  };

  const days = periodDays[period];
  const prevDays = days ? days * 2 : null;

  const sumIn = (arr: any[], key: string, from: number | null, to: number | null) =>
    arr.filter((r) => {
      const timestamp = safeDateMs(r.date || r.paid_at);
      if (timestamp == null) return false;
      const d = (Date.now() - timestamp) / 86400000;
      if (from != null && d > from) return false;
      if (to != null && d <= to) return false;
      return true;
    }).reduce((a, r) => a + safeNumber(r[key] ?? r.amount), 0);

  const stats = useMemo(() => {
    // Sem o lucro na soma: ele já vem embutido na parcela (ver totais acima).
    const received = installments.map((i: any) => ({ ...i, amount: safeNumber(i.paid_amount || i.amount), date: i.paid_at }));
    const inCur = sumIn(capital, "amount", days, null) + sumIn(received, "amount", days, null);
    const outCur = sumIn(expenses, "amount", days, null) + sumIn(withdrawals, "amount", days, null) + sumIn(ledgerOutflows, "amount", days, null);
    const inPrev = prevDays ? sumIn(capital, "amount", prevDays, days) + sumIn(received, "amount", prevDays, days) : 0;
    const outPrev = prevDays ? sumIn(expenses, "amount", prevDays, days) + sumIn(withdrawals, "amount", prevDays, days) + sumIn(ledgerOutflows, "amount", prevDays, days) : 0;
    const inDelta = inPrev > 0 ? ((inCur - inPrev) / inPrev) * 100 : null;
    const outDelta = outPrev > 0 ? ((outCur - outPrev) / outPrev) * 100 : null;
    return { inCur, outCur, netCur: inCur - outCur, inDelta, outDelta };
  }, [capital, installments, expenses, withdrawals, ledgerOutflows, days, prevDays]);

  const closing = useMemo(() => ({
    openingBalance: period === "all" ? 0 : saldo - stats.netCur,
    inflows: stats.inCur,
    outflows: stats.outCur,
    closingBalance: saldo,
  }), [period, saldo, stats]);

  // Capital líquido disponível (aportes − retiradas de capital)
  const capitalLiquido = totalCapital + principalRecebido - totalEmprestimosLiberados - totalWithdrawals;

  const forecast = useMemo(() => {
    const now = new Date(); now.setHours(23, 59, 59, 999);
    const sumUntil = (daysAhead: number) => {
      const end = new Date(now.getTime() + daysAhead * 86400000);
      return receivables.filter((i: any) => {
        const due = safeDateMs(i.due_date);
        return due != null && due <= end.getTime();
      }).reduce((sum: number, i: any) => sum + Math.max(0, safeNumber(i.amount) - safeNumber(i.paid_amount)), 0);
    };
    return { d7: sumUntil(7), d30: sumUntil(30), d90: sumUntil(90) };
  }, [receivables]);

  const timeline = useMemo(() => {
    const all = [
      ...capital.map((c: any) => ({ type: "in" as const, desc: c.description, amount: safeNumber(c.amount), date: c.date, source: "Aporte", removable: true, id: c.id })),
      ...withdrawals.map((w: any) => ({ type: "out" as const, desc: w.description, amount: safeNumber(w.amount), date: w.date, source: "Retirada de capital", removable: true, id: w.id })),
      // O lucro NÃO entra na linha do tempo como movimento próprio: ele já está
      // dentro da parcela recebida logo abaixo. Aparecia duas vezes.
      ...installments.map((i: any) => ({ type: "in" as const, desc: "Parcela recebida", amount: safeNumber(i.paid_amount || i.amount), date: i.paid_at, source: "Parcela", removable: false, id: i.id })),
      ...ledgerOutflows.map((t: any) => ({ type: "out" as const, desc: t.description, amount: safeNumber(t.amount), date: t.date, source: t.type === "loan_disbursement" ? "Empréstimo liberado" : "Pagamento a investidor", removable: false, id: t.id })),
      ...expenses.map((e: any) => ({ type: "out" as const, desc: e.description, amount: safeNumber(e.amount), date: e.date, source: e.category || "Gasto", removable: false, id: e.id })),
    ].sort((a, b) => (safeDateMs(b.date) ?? 0) - (safeDateMs(a.date) ?? 0));

    return all.filter((t) => {
      if (!withinPeriod(t.date, days)) return false;
      if (searchTimeline && !String(t.desc || "").toLowerCase().includes(searchTimeline.toLowerCase()) && !String(t.source || "").toLowerCase().includes(searchTimeline.toLowerCase())) return false;
      return true;
    });
  }, [expenses, installments, capital, withdrawals, ledgerOutflows, days, searchTimeline]);

  const fmt = (v: number) => safeNumber(v).toLocaleString("pt-BR", { minimumFractionDigits: 2 });
  const fmtCompact = (v: number) =>
    Math.abs(v) >= 1000 ? `R$ ${(v / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}k` : `R$ ${fmt(v)}`;

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-32 rounded-3xl" />
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-32 rounded-2xl" />)}
        </div>
        <Skeleton className="h-96 rounded-2xl" />
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="rounded-2xl border border-destructive/30 bg-destructive/5 px-6 py-14 text-center">
        <AlertTriangle className="mx-auto h-10 w-10 text-destructive" />
        <h2 className="mt-3 font-semibold text-foreground">Não foi possível carregar a carteira</h2>
        <p className="mt-1 text-sm text-muted-foreground">Confira sua conexão e tente novamente.</p>
        <button
          onClick={() => void qc.invalidateQueries({ predicate: (query) => String(query.queryKey[0]).startsWith("carteira-") })}
          className="mt-4 inline-flex items-center gap-2 rounded-xl border border-border bg-background px-4 py-2 text-sm font-semibold hover:bg-muted"
        >
          <RefreshCw className="h-4 w-4" /> Tentar novamente
        </button>
      </div>
    );
  }

  // === Composição de entradas (para barra segmentada) ===
  const entradasTotal = totalCapital + totalParcelas;
  const capitalPct = entradasTotal > 0 ? (totalCapital / entradasTotal) * 100 : 0;
  const lucrosPct = entradasTotal > 0 ? (totalLucros / entradasTotal) * 100 : 0;
  const parcelasPct = entradasTotal > 0 ? (principalRecebido / entradasTotal) * 100 : 0;

  const saidasTotal = totalSaidas;
  const gastosPct = saidasTotal > 0 ? (totalGastos / saidasTotal) * 100 : 0;
  const withdrawPct = saidasTotal > 0 ? (totalWithdrawals / saidasTotal) * 100 : 0;
  const emprestimosPct = saidasTotal > 0 ? (totalEmprestimosLiberados / saidasTotal) * 100 : 0;
  const razaoPct = saidasTotal > 0 ? (totalSaidasRazao / saidasTotal) * 100 : 0;

  const grouped = timeline.reduce((acc, t) => {
    const key = formatBR(t.date);
    if (!acc[key]) acc[key] = [];
    acc[key].push(t);
    return acc;
  }, {} as Record<string, typeof timeline>);

  const dayTotals = (items: typeof timeline) =>
    items.reduce((acc, t) => {
      if (t.type === "in") acc.in += t.amount; else acc.out += t.amount;
      return acc;
    }, { in: 0, out: 0 });

  const sourceIcon = (source: string) => {
    if (source === "Aporte") return <PiggyBank size={14} />;
    if (source === "Lucro") return <TrendingUp size={14} />;
    if (source === "Parcela") return <CreditCard size={14} />;
    if (source === "Retirada de capital") return <ArrowDownRight size={14} />;
    return <Receipt size={14} />;
  };

  return (
    <div className="space-y-5 md:space-y-6">
      {/* HERO — Saldo destacado */}
      <div className="rounded-2xl border border-white/[.08] bg-card/65 p-5 shadow-[0_18px_50px_-36px_rgba(0,0,0,.9)] animate-fade-in md:p-6">
        <div className="flex flex-col justify-between gap-5 lg:flex-row lg:items-center">
          <div className="flex items-start gap-4">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-primary/20 bg-primary/10">
              <Banknote size={21} className="text-primary" />
            </div>
            <div>
              <p className="text-xs uppercase tracking-widest text-muted-foreground font-medium">Carteira</p>
              <h1 className="text-display text-xl font-bold tracking-tight text-foreground sm:text-2xl">
                Saldo Total
              </h1>
              <div className="flex items-baseline gap-2 mt-1">
                <span className={`text-3xl font-bold tracking-tight tabular-nums sm:text-4xl md:text-5xl ${saldo >= 0 ? "text-success" : "text-destructive"}`}>
                  R$ {fmt(saldo)}
                </span>
              </div>
              <p className="text-xs text-muted-foreground mt-1.5 flex items-center gap-1.5">
                <Sparkles size={12} className="text-primary" />
                Capital líquido disponível: <span className="font-semibold text-foreground">R$ {fmt(capitalLiquido)}</span>
              </p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
            <button
              onClick={() => { setDialogType("in"); setAmount(""); setDescription(""); setDialogOpen(true); }}
              className="flex items-center justify-center gap-1.5 rounded-xl border border-success/25 bg-success/10 px-4 py-2.5 text-sm font-semibold text-success transition-colors hover:bg-success/20"
            >
              <Plus size={16} /> Aporte
            </button>
            <button
              onClick={() => { setDialogType("withdraw"); setAmount(""); setDescription(""); setDialogOpen(true); }}
              className="flex items-center justify-center gap-1.5 rounded-xl border border-warning/25 bg-warning/10 px-4 py-2.5 text-sm font-semibold text-warning transition-colors hover:bg-warning/20"
            >
              <Minus size={16} /> Retirar Capital
            </button>
            <button
              onClick={() => { setDialogType("out"); setAmount(""); setDescription(""); setDialogOpen(true); }}
              className="col-span-2 flex items-center justify-center gap-1.5 rounded-xl border border-destructive/25 bg-destructive/10 px-4 py-2.5 text-sm font-semibold text-destructive transition-colors hover:bg-destructive/20 sm:col-span-1"
            >
              <Minus size={16} /> Saída
            </button>
          </div>
        </div>

        {/* Composição do saldo em uma linha */}
        <div className="mt-5 grid grid-cols-2 gap-2.5 border-t border-white/[.06] pt-5 text-xs md:grid-cols-3 xl:grid-cols-6">
          {[
            { label: "Aportes", value: totalCapital, color: "text-primary", dot: "bg-primary" },
            { label: "Lucros", value: totalLucros, color: "text-success", dot: "bg-success" },
            { label: "Parcelas", value: totalParcelas, color: "text-info", dot: "bg-info" },
            { label: "Empréstimos liberados", value: -totalEmprestimosLiberados, color: "text-warning", dot: "bg-warning" },
            { label: "Retiradas", value: -totalWithdrawals, color: "text-warning", dot: "bg-warning" },
            { label: "Gastos", value: -totalGastos, color: "text-destructive", dot: "bg-destructive" },
          ].map((c) => (
            <div key={c.label} className="rounded-xl border border-border/40 bg-background/35 px-3 py-2.5">
              <div className="flex items-center gap-1.5 text-muted-foreground">
                <span className={`w-1.5 h-1.5 rounded-full ${c.dot}`} />
                {c.label}
              </div>
              <p className={`text-sm font-bold mt-1 ${c.color}`}>
                {c.value < 0 ? "−" : ""}R$ {fmt(Math.abs(c.value))}
              </p>
            </div>
          ))}
        </div>

        {reconciliation && (
          <div className={`mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border px-3 py-2 text-xs ${
            reconciliation.ok ? "border-success/20 bg-success/5 text-success" : "border-destructive/30 bg-destructive/5 text-destructive"
          }`}>
            <span className="font-semibold">
              {reconciliation.ok ? "Razão financeiro conciliado" : `${reconciliation.anomaly_count} divergência(s) financeira(s) detectada(s)`}
            </span>
            <span className="text-muted-foreground">{reconciliation.checked_installments} parcelas verificadas</span>
          </div>
        )}

        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogContent>
            {dialogType === "in" && (
              <>
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2 text-success">
                    <ArrowUpRight size={20} /> Adicionar Aporte de Capital
                  </DialogTitle>
                </DialogHeader>
                <div className="space-y-4 pt-2">
                  <p className="text-xs text-muted-foreground -mt-1">Dinheiro disponível para emprestar. Não conta como lucro.</p>
                  <div><Label>Descrição</Label><Input placeholder="Ex: Depósito inicial, Aporte sócio..." value={description} onChange={(e) => setDescription(e.target.value)} /></div>
                  <div><Label>Valor (R$)</Label><Input type="text" inputMode="decimal" placeholder="0,00" value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
                  <button disabled={saving || !amount || !description} onClick={handleSave} className="w-full py-2.5 rounded-xl bg-success text-success-foreground font-semibold hover:opacity-90 transition-colors disabled:opacity-50">
                    {saving ? "Salvando..." : "Confirmar Aporte"}
                  </button>
                </div>
              </>
            )}
            {dialogType === "withdraw" && (
              <>
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2 text-warning">
                    <ArrowDownRight size={20} /> Retirar Capital
                  </DialogTitle>
                </DialogHeader>
                <div className="space-y-4 pt-2">
                  <p className="text-xs text-muted-foreground -mt-1">Reduz o capital disponível para emprestar. Não é gasto/despesa.</p>
                  <div><Label>Descrição</Label><Input placeholder="Ex: Devolução sócio, Saque pessoal..." value={description} onChange={(e) => setDescription(e.target.value)} /></div>
                  <div><Label>Valor (R$)</Label><Input type="text" inputMode="decimal" placeholder="0,00" value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
                  <button disabled={saving || !amount || !description} onClick={handleSave} className="w-full py-2.5 rounded-xl bg-warning text-warning-foreground font-semibold hover:opacity-90 transition-colors disabled:opacity-50">
                    {saving ? "Salvando..." : "Confirmar Retirada"}
                  </button>
                </div>
              </>
            )}
            {dialogType === "out" && (
              <>
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2 text-destructive">
                    <ArrowDownRight size={20} /> Registrar Saída
                  </DialogTitle>
                </DialogHeader>
                <div className="space-y-4 pt-2">
                  <div><Label>Descrição</Label><Input placeholder="Ex: Saque, Pagamento..." value={description} onChange={(e) => setDescription(e.target.value)} /></div>
                  <div><Label>Valor (R$)</Label><Input type="text" inputMode="decimal" placeholder="0,00" value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
                  <button disabled={saving || !amount || !description} onClick={handleSave} className="w-full py-2.5 rounded-xl bg-destructive text-destructive-foreground font-semibold hover:opacity-90 transition-colors disabled:opacity-50">
                    {saving ? "Salvando..." : "Confirmar Saída"}
                  </button>
                </div>
              </>
            )}
          </DialogContent>
        </Dialog>
      </div>

      <section className="rounded-2xl border border-border/50 bg-card/55 p-4" aria-label="Previsão de caixa">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[.16em] text-primary">Previsão de caixa</p>
            <h2 className="mt-1 text-sm font-bold text-foreground">Entradas previstas pelas parcelas</h2>
          </div>
          <span className="text-[11px] text-muted-foreground">Valores em aberto, incluindo atrasados</span>
        </div>
        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
          {[
            { label: "Próximos 7 dias", value: forecast.d7 },
            { label: "Próximos 30 dias", value: forecast.d30 },
            { label: "Próximos 90 dias", value: forecast.d90 },
          ].map((item) => (
            <div key={item.label} className="rounded-xl border border-border/40 bg-background/30 px-3 py-3">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{item.label}</p>
              <p className="mt-1 text-lg font-black tabular-nums text-foreground">R$ {fmt(item.value)}</p>
              <p className="mt-1 text-[10px] text-muted-foreground">Saldo projetado: R$ {fmt(saldo + item.value)}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Filtro de período */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Activity size={14} className="text-primary" />
          <span className="font-medium text-foreground">Movimentações no período</span>
        </div>
        <div className="pill-tabs">
          {(["all", "7d", "30d", "90d"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setPeriod(f)}
              className={`pill-tab text-xs px-3 py-1.5 ${period === f ? "pill-tab-active" : "pill-tab-inactive"}`}
            >
              {f === "all" ? "Total" : f === "7d" ? "7 dias" : f === "30d" ? "30 dias" : "90 dias"}
            </button>
          ))}
        </div>
      </div>

      {/* Stats — período */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 stagger-fade-in">
        {[
          {
            icon: ArrowUpRight,
            label: "Entradas",
            value: stats.inCur,
            color: "text-success",
            bg: "bg-success/10",
            ring: "border-success/20",
            delta: stats.inDelta,
            hint: period === "all" ? "todo o período" : "vs período anterior",
          },
          {
            icon: ArrowDownRight,
            label: "Saídas",
            value: stats.outCur,
            color: "text-destructive",
            bg: "bg-destructive/10",
            ring: "border-destructive/20",
            delta: stats.outDelta,
            hint: period === "all" ? "todo o período" : "vs período anterior",
            deltaInverted: true,
          },
          {
            icon: TrendingUp,
            label: "Resultado Líquido",
            value: stats.netCur,
            color: stats.netCur >= 0 ? "text-success" : "text-destructive",
            bg: stats.netCur >= 0 ? "bg-success/10" : "bg-destructive/10",
            ring: stats.netCur >= 0 ? "border-success/20" : "border-destructive/20",
            hint: "entradas − saídas",
          },
          {
            icon: PiggyBank,
            label: "Capital Líquido",
            value: capitalLiquido,
            color: "text-primary",
            bg: "bg-primary/10",
            ring: "border-primary/20",
            hint: "disponível p/ emprestar",
          },
        ].map((s, idx) => {
          const deltaVal = s.delta;
          const deltaPositive = s.deltaInverted ? (deltaVal ?? 0) < 0 : (deltaVal ?? 0) >= 0;
          return (
            <div
              key={s.label}
              className={`rounded-2xl border ${s.ring} bg-card/55 p-4 transition-colors hover:border-primary/30 sm:p-5`}
              style={{ animationDelay: `${idx * 60}ms` }}
            >
              <div className="flex items-center justify-between mb-3">
                <div className={`w-10 h-10 rounded-xl ${s.bg} flex items-center justify-center`}>
                  <s.icon size={18} className={s.color} />
                </div>
                {deltaVal != null && (
                  <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full flex items-center gap-1 ${deltaPositive ? "bg-success/10 text-success" : "bg-destructive/10 text-destructive"}`}>
                    {deltaPositive ? <TrendingUp size={10} /> : <TrendingDown size={10} />}
                    {Math.abs(deltaVal).toFixed(0)}%
                  </span>
                )}
              </div>
              <p className="text-xs text-muted-foreground">{s.label}</p>
              <p className={`mt-0.5 text-xl font-bold ${s.color} tabular-nums sm:text-2xl`}>{fmtCompact(s.value)}</p>
              <p className="text-[10px] text-muted-foreground mt-1">{s.hint}</p>
            </div>
          );
        })}
      </div>

      <section className="rounded-2xl border border-border/50 bg-card/45 p-4 sm:p-5" aria-label="Fechamento financeiro do período">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[.16em] text-primary">Fechamento do período</p>
            <h2 className="mt-1 text-sm font-bold text-foreground">Conferência do saldo da carteira</h2>
          </div>
          <span className="rounded-full border border-border/50 bg-background/35 px-2.5 py-1 text-[10px] font-semibold text-muted-foreground">
            {period === "all" ? "Desde o início" : `Últimos ${days} dias`}
          </span>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-x-5 gap-y-4 lg:grid-cols-4">
          {[
            { label: "Saldo inicial", value: closing.openingBalance },
            { label: "Entradas", value: closing.inflows, tone: "text-success" },
            { label: "Saídas", value: closing.outflows, tone: "text-destructive" },
            { label: "Saldo final", value: closing.closingBalance, tone: closing.closingBalance >= 0 ? "text-foreground" : "text-destructive" },
          ].map((item) => (
            <div key={item.label} className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{item.label}</p>
              <p className={`mt-1 truncate text-base font-black tabular-nums sm:text-lg ${item.tone || "text-foreground"}`} title={`R$ ${fmt(item.value)}`}>
                R$ {fmt(item.value)}
              </p>
            </div>
          ))}
        </div>
        <p className="mt-4 border-t border-border/40 pt-3 text-[10px] text-muted-foreground">
          Saldo inicial + entradas − saídas = saldo final. Os juros já estão incluídos nas parcelas recebidas e não são somados novamente.
        </p>
      </section>

      {/* Composição de fluxo */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 animate-fade-in">
        <div className="rounded-2xl border border-border/50 bg-card/55 p-4 sm:p-5">
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm font-semibold text-foreground flex items-center gap-2">
              <ArrowUpRight size={16} className="text-success" /> Composição das Entradas
            </span>
            <span className="text-xs text-muted-foreground">R$ {fmt(totalEntradas)}</span>
          </div>
          <div className="h-3 rounded-full bg-muted overflow-hidden flex">
            <div className="h-full bg-primary transition-all duration-700" style={{ width: `${capitalPct}%` }} title="Aportes" />
            <div className="h-full bg-success transition-all duration-700" style={{ width: `${lucrosPct}%` }} title="Lucros" />
            <div className="h-full bg-info transition-all duration-700" style={{ width: `${parcelasPct}%` }} title="Principal recebido" />
          </div>
          <div className="grid grid-cols-1 min-[420px]:grid-cols-3 gap-2 mt-3 text-[11px]">
            <div className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-primary" /><span className="text-muted-foreground">Aportes</span><span className="ml-auto font-semibold text-foreground">{capitalPct.toFixed(0)}%</span></div>
            <div className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-success" /><span className="text-muted-foreground">Lucros</span><span className="ml-auto font-semibold text-foreground">{lucrosPct.toFixed(0)}%</span></div>
            <div className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-info" /><span className="text-muted-foreground">Principal</span><span className="ml-auto font-semibold text-foreground">{parcelasPct.toFixed(0)}%</span></div>
          </div>
        </div>

        <div className="rounded-2xl border border-border/50 bg-card/55 p-4 sm:p-5">
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm font-semibold text-foreground flex items-center gap-2">
              <ArrowDownRight size={16} className="text-destructive" /> Composição das Saídas
            </span>
            <span className="text-xs text-muted-foreground">R$ {fmt(totalSaidas)}</span>
          </div>
          <div className="h-3 rounded-full bg-muted overflow-hidden flex">
            <div className="h-full bg-destructive transition-all duration-700" style={{ width: `${gastosPct}%` }} title="Gastos" />
            <div className="h-full bg-warning transition-all duration-700" style={{ width: `${withdrawPct}%` }} title="Retiradas" />
            <div className="h-full bg-orange-500 transition-all duration-700" style={{ width: `${emprestimosPct}%` }} title="Empréstimos liberados" />
            <div className="h-full bg-muted-foreground transition-all duration-700" style={{ width: `${razaoPct}%` }} title="Movimentos da razão" />
          </div>
          <div className="grid grid-cols-2 min-[520px]:grid-cols-4 gap-2 mt-3 text-[11px]">
            <div className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-destructive" /><span className="text-muted-foreground">Gastos</span><span className="ml-auto font-semibold text-foreground">{gastosPct.toFixed(0)}%</span></div>
            <div className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-warning" /><span className="text-muted-foreground">Retiradas</span><span className="ml-auto font-semibold text-foreground">{withdrawPct.toFixed(0)}%</span></div>
            <div className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-orange-500" /><span className="text-muted-foreground">Liberados</span><span className="ml-auto font-semibold text-foreground">{emprestimosPct.toFixed(0)}%</span></div>
            <div className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-muted-foreground" /><span className="text-muted-foreground">Razão</span><span className="ml-auto font-semibold text-foreground">{razaoPct.toFixed(0)}%</span></div>
          </div>
        </div>
      </div>

      {/* Timeline */}
      <div className="overflow-hidden rounded-2xl border border-border/50 bg-card/55 animate-fade-in">
        <div className="sticky-header flex flex-col items-start justify-between gap-3 border-b border-border px-4 py-4 sm:flex-row sm:items-center sm:px-5">
          <h2 className="font-semibold text-foreground flex items-center gap-2">
            <CreditCard size={18} className="text-primary" /> Histórico
            <span className="text-xs text-muted-foreground font-normal">({timeline.length})</span>
          </h2>
          <div className="relative w-full sm:w-auto">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              id="portfolio-timeline-search"
              name="portfolio_timeline_search"
              aria-label="Buscar no histórico da carteira"
              autoComplete="off"
              type="text"
              placeholder="Buscar por descrição ou origem..."
              value={searchTimeline}
              onChange={(e) => setSearchTimeline(e.target.value)}
              className="w-full rounded-xl border border-border bg-accent/50 py-2 pl-9 pr-8 text-xs text-foreground placeholder:text-muted-foreground sm:w-72 input-enhanced"
            />
            {searchTimeline && (
              <button type="button" aria-label="Limpar busca do histórico" onClick={() => setSearchTimeline("")} className="absolute right-2 top-1/2 -translate-y-1/2">
                <X size={12} className="text-muted-foreground" />
              </button>
            )}
          </div>
        </div>

        {timeline.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon"><Wallet size={28} className="text-muted-foreground/30" /></div>
            <p className="text-muted-foreground text-sm">Nenhuma transação encontrada.</p>
          </div>
        ) : (
          <div className="max-h-[560px] overflow-y-auto">
            {Object.entries(grouped).map(([date, items]) => {
              const tot = dayTotals(items);
              const net = tot.in - tot.out;
              return (
                <div key={date}>
                  <div className="sticky top-0 z-[5] flex items-center justify-between border-b border-border/60 bg-card/95 px-4 py-2.5 backdrop-blur sm:px-5">
                    <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                      <Calendar size={11} /> {date}
                    </span>
                    <span className={`text-[11px] font-bold tabular-nums ${net >= 0 ? "text-success" : "text-destructive"}`}>
                      {net >= 0 ? "+" : "−"}R$ {fmt(Math.abs(net))}
                    </span>
                  </div>
                  <div className="divide-y divide-border/40">
                    {items.map((t, idx) => (
                      <div key={idx} className="group flex items-center gap-2.5 px-3 py-3 transition-colors hover:bg-accent/30 sm:gap-3 sm:px-5">
                        <div className={`w-1 self-stretch rounded-full ${t.type === "in" ? "bg-success" : "bg-destructive"}`} />
                        <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${t.type === "in" ? "bg-success/10 text-success" : "bg-destructive/10 text-destructive"}`}>
                          {sourceIcon(t.source)}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-foreground truncate">{t.desc}</p>
                          <p className="text-[11px] text-muted-foreground flex items-center gap-1.5 mt-0.5">
                            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-muted/50 text-[10px] font-medium">
                              {t.source}
                            </span>
                          </p>
                        </div>
                        <span className={`whitespace-nowrap text-xs font-bold tabular-nums sm:text-sm ${t.type === "in" ? "text-success" : "text-destructive"}`}>
                          {t.type === "in" ? "+" : "−"}R$ {fmt(t.amount)}
                        </span>
                        {t.removable && (
                          <button
                            onClick={() => handleDeleteCapital(t.id)}
                            className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive sm:opacity-0 sm:group-hover:opacity-100"
                            title="Remover"
                          >
                            <X size={14} />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default Carteira;
