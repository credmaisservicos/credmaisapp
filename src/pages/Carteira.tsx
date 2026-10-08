import { useState, useMemo, useEffect } from "react";
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
import { formatBR } from "@/lib/dateUtils";
import { useConfirm } from "@/components/ConfirmProvider";
import { walletCashReportSchema } from "@/lib/walletCashReport";
import { parseFinancialAmount } from "@/lib/financialEntry";
import {PaymentAllocationNotice} from '@/components/PaymentAllocationNotice';
import {useManualCashOperation} from '@/hooks/useManualCashOperation';
import {PendingManualCash} from '@/components/PendingManualCash';

type PeriodKey = "all" | "7d" | "30d" | "90d";
const safeNumber = (value: unknown) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
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
  const manual=useManualCashOperation(user?.id,()=>{setAmount('');setDescription('');setDialogOpen(false);});
  const saving=manual.busy;

  const [searchTerm, setSearchTerm] = useState("");
  const [historyPage, setHistoryPage] = useState(0);
  const periodDays: Record<PeriodKey, number | null> = { all: null, "7d": 7, "30d": 30, "90d": 90 };
  const days = periodDays[period];
  useEffect(() => {
    const timer=setTimeout(()=>{setSearchTerm(searchTimeline.trim());setHistoryPage(0);},250);
    return ()=>clearTimeout(timer);
  },[searchTimeline]);
  useMultiTableRealtime(["profits","expenses","contract_installments","transactions","contracts"],
    [["carteira-cash-report",user?.id||""],["payment-allocation-review",user?.id||""]]);
  const cashQuery=useQuery({
    queryKey:["carteira-cash-report",user?.id,period,searchTerm,historyPage],enabled:!!user,
    queryFn:async({signal})=>{
      const controller=new AbortController();const cancel=()=>controller.abort();
      if(signal.aborted)cancel();else signal.addEventListener('abort',cancel,{once:true});
      const timer=setTimeout(cancel,15_000);
      try{
        const {data,error}=await supabase.rpc('wallet_cash_report',{_days:days,_search:searchTerm,_offset:historyPage*50,_limit:50}).abortSignal(controller.signal);
        if(error)throw error;
        return walletCashReportSchema.parse(data);
      }finally{clearTimeout(timer);signal.removeEventListener('abort',cancel);}
    },
  });
  const loading=cashQuery.isPending;
  const loadError=cashQuery.error;

  const handleSave = async () => {
    if (!user || !amount || !description || saving) return;
    const now = new Date().toISOString();
    const val = parseFinancialAmount(amount);
    if (val === null) {
      toast({ title: "Valor inválido", variant: "destructive" });
      return;
    }
    await manual.run({operation:dialogType==='in'?'capital_injection':dialogType==='withdraw'?'capital_withdrawal':'expense_create',
      amount:val,description,date:now,category:dialogType==='out'?'Retirada manual':null});
  };

  const handleDeleteCapital = async (id: string) => {
    if (!(await confirm("Remover este lançamento de capital?"))) return;
    if (!user) return;
    await manual.run({operation:'capital_delete',entryId:id});
  };

  const summary=cashQuery.data;
  const totalCapital=summary?.totals.capital??0;
  const totalWithdrawals=summary?.totals.withdrawals??0;
  const totalLucros=summary?.totals.profit??0;
  const totalParcelas=summary?.totals.receipts??0;
  const principalRecebido=summary?.totals.principal??0;
  const unclassified=summary?.totals.unclassified??0;
  const totalEmprestimosLiberados=summary?.totals.disbursements??0;
  const totalSaidasRazao=summary?.totals.ledger_expenses??0;
  const totalGastos=summary?.totals.manual_expenses??0;
  const totalEntradas=summary?.totals.inflows??0;
  const totalSaidas=summary?.totals.outflows??0;
  const saldo=summary?.totals.balance??0;
  const capitalLiquido=totalCapital+principalRecebido-totalEmprestimosLiberados-totalWithdrawals;
  const periodCash=summary?.period;
  const inCur=periodCash?.inflows??0,outCur=periodCash?.outflows??0;
  const inPrev=periodCash?.previous_inflows??0,outPrev=periodCash?.previous_outflows??0;
  const stats={inCur,outCur,netCur:inCur-outCur,inDelta:inPrev>0?(inCur-inPrev)/inPrev*100:null,outDelta:outPrev>0?(outCur-outPrev)/outPrev*100:null};
  const closing={openingBalance:periodCash?.opening_balance??0,inflows:inCur,outflows:outCur,closingBalance:periodCash?.closing_balance??0};
  const forecast=summary?.forecast??{d7:0,d30:0,d90:0};
  const timeline=summary?.timeline??[];
  const fmt = (v: number) => safeNumber(v).toLocaleString("pt-BR", { minimumFractionDigits: 2 });
  const fmtCompact = (v: number) =>
    Math.abs(v) >= 1000 ? `R$ ${(v / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}k` : `R$ ${fmt(v)}`;

  const grouped = useMemo(()=>timeline.reduce((acc, t) => {
    const key = t.date?formatBR(t.date):"Data a conferir";
    if (!acc[key]) acc[key] = [];
    acc[key].push(t);
    return acc;
  }, {} as Record<string, typeof timeline>),[timeline]);

  const pendingNotice=<PendingManualCash pending={manual.pending} busy={manual.busy} storageError={manual.storageError} onRetry={()=>void manual.run()} onCancel={()=>void manual.cancel()} />;

  if (loading) {
    return (
      <div className="space-y-6">
        {pendingNotice}
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
        {pendingNotice}
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
  const unclassifiedPct=entradasTotal>0?unclassified/entradasTotal*100:0;

  const saidasTotal = totalSaidas;
  const gastosPct = saidasTotal > 0 ? (totalGastos / saidasTotal) * 100 : 0;
  const withdrawPct = saidasTotal > 0 ? (totalWithdrawals / saidasTotal) * 100 : 0;
  const emprestimosPct = saidasTotal > 0 ? (totalEmprestimosLiberados / saidasTotal) * 100 : 0;
  const razaoPct = saidasTotal > 0 ? (totalSaidasRazao / saidasTotal) * 100 : 0;

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
      {pendingNotice}
      {/* HERO — Saldo destacado */}
      <div className="rounded-2xl border border-white/8 bg-card/65 p-5 shadow-[0_18px_50px_-36px_rgba(0,0,0,.9)] animate-fade-in md:p-6">
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
                Capital líquido classificado: <span className="font-semibold text-foreground">R$ {fmt(capitalLiquido)}</span>
              </p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
            <button
              disabled={!manual.ready || !!manual.pending || saving}
              onClick={() => { setDialogType("in"); setAmount(""); setDescription(""); setDialogOpen(true); }}
              className="flex items-center justify-center gap-1.5 rounded-xl border border-success/25 bg-success/10 px-4 py-2.5 text-sm font-semibold text-success transition-colors hover:bg-success/20"
            >
              <Plus size={16} /> Aporte
            </button>
            <button
              disabled={!manual.ready || !!manual.pending || saving}
              onClick={() => { setDialogType("withdraw"); setAmount(""); setDescription(""); setDialogOpen(true); }}
              className="flex items-center justify-center gap-1.5 rounded-xl border border-warning/25 bg-warning/10 px-4 py-2.5 text-sm font-semibold text-warning transition-colors hover:bg-warning/20"
            >
              <Minus size={16} /> Retirar Capital
            </button>
            <button
              disabled={!manual.ready || !!manual.pending || saving}
              onClick={() => { setDialogType("out"); setAmount(""); setDescription(""); setDialogOpen(true); }}
              className="col-span-2 flex items-center justify-center gap-1.5 rounded-xl border border-destructive/25 bg-destructive/10 px-4 py-2.5 text-sm font-semibold text-destructive transition-colors hover:bg-destructive/20 sm:col-span-1"
            >
              <Minus size={16} /> Saída
            </button>
          </div>
        </div>

        {/* Composição do saldo em uma linha */}
        <div className="mt-5 grid grid-cols-2 gap-2.5 border-t border-white/6 pt-5 text-xs md:grid-cols-3 xl:grid-cols-6">
          {[
            { label: "Aportes", value: totalCapital, color: "text-primary", dot: "bg-primary" },
            { label: "Juros e encargos", value: totalLucros, color: "text-success", dot: "bg-success" },
            { label: "Recebimentos", value: totalParcelas, color: "text-info", dot: "bg-info" },
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

        <PaymentAllocationNotice />
        {summary && (summary.warnings.undated_amount>0 || summary.warnings.unlinked_receipts>0 || summary.warnings.future_amount>0 || summary.warnings.cash_above_installments>0) && (
          <section aria-label="Conferência do caixa" className="mt-3 rounded-xl border border-border bg-background/35 p-3 text-sm space-y-1">
            <p className="font-semibold">O histórico de caixa precisa de conferência</p>
            {summary.warnings.undated_amount>0&&<p>Sem data de recebimento: R$ {fmt(summary.warnings.undated_amount)}. Incluído no total; fora dos filtros por dias.</p>}
            {summary.warnings.unlinked_receipts>0&&<p>{summary.warnings.unlinked_receipts} recebimento(s) sem vínculo com uma parcela.</p>}
            {summary.warnings.cash_above_installments>0&&<p>Caixa acima do acumulado nas parcelas: R$ {fmt(summary.warnings.cash_above_installments)}. Confira os lançamentos antes de conciliar.</p>}
            {summary.warnings.future_amount>0&&<p>Com data posterior a hoje: R$ {fmt(summary.warnings.future_amount)}. Fora do saldo atual.</p>}
            <p className="text-xs text-muted-foreground">Nenhum lançamento antigo foi alterado. Capital e juros sem classificação dependem de revisão humana.</p>
          </section>
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
                {pendingNotice}
                <div className="space-y-4 pt-2">
                  <p className="text-xs text-muted-foreground -mt-1">Dinheiro disponível para emprestar. Não conta como lucro.</p>
                  <div><Label htmlFor="cash-description">Descrição</Label><Input id="cash-description" maxLength={500} disabled={saving || !!manual.pending} placeholder="Ex: Depósito inicial, Aporte sócio..." value={description} onChange={(e) => setDescription(e.target.value)} /></div>
                  <div><Label htmlFor="cash-amount">Valor (R$)</Label><Input id="cash-amount" disabled={saving || !!manual.pending} type="text" inputMode="decimal" placeholder="0,00" value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
                  <button disabled={!manual.ready || !!manual.pending || saving || !amount || !description.trim()} onClick={handleSave} className="w-full py-2.5 rounded-xl bg-success text-success-foreground font-semibold hover:opacity-90 transition-colors disabled:opacity-50">
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
                {pendingNotice}
                <div className="space-y-4 pt-2">
                  <p className="text-xs text-muted-foreground -mt-1">Reduz o capital disponível para emprestar. Não é gasto/despesa.</p>
                  <div><Label htmlFor="cash-description">Descrição</Label><Input id="cash-description" maxLength={500} disabled={saving || !!manual.pending} placeholder="Ex: Devolução sócio, Saque pessoal..." value={description} onChange={(e) => setDescription(e.target.value)} /></div>
                  <div><Label htmlFor="cash-amount">Valor (R$)</Label><Input id="cash-amount" disabled={saving || !!manual.pending} type="text" inputMode="decimal" placeholder="0,00" value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
                  <button disabled={!manual.ready || !!manual.pending || saving || !amount || !description.trim()} onClick={handleSave} className="w-full py-2.5 rounded-xl bg-warning text-warning-foreground font-semibold hover:opacity-90 transition-colors disabled:opacity-50">
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
                {pendingNotice}
                <div className="space-y-4 pt-2">
                  <div><Label htmlFor="cash-description">Descrição</Label><Input id="cash-description" maxLength={500} disabled={saving || !!manual.pending} placeholder="Ex: Saque, Pagamento..." value={description} onChange={(e) => setDescription(e.target.value)} /></div>
                  <div><Label htmlFor="cash-amount">Valor (R$)</Label><Input id="cash-amount" disabled={saving || !!manual.pending} type="text" inputMode="decimal" placeholder="0,00" value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
                  <button disabled={!manual.ready || !!manual.pending || saving || !amount || !description.trim()} onClick={handleSave} className="w-full py-2.5 rounded-xl bg-destructive text-destructive-foreground font-semibold hover:opacity-90 transition-colors disabled:opacity-50">
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
              onClick={() => {setHistoryPage(0);setPeriod(f);}}
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
            label: "Capital Classificado",
            value: capitalLiquido,
            color: "text-primary",
            bg: "bg-primary/10",
            ring: "border-primary/20",
            hint: "composição registrada",
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
            <div className="h-full bg-muted-foreground transition-all duration-700" style={{width:`${unclassifiedPct}%`}} title="Recebimentos sem classificação" />
          </div>
          <div className="grid grid-cols-2 min-[520px]:grid-cols-4 gap-2 mt-3 text-[11px]">
            <div className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-primary" /><span className="text-muted-foreground">Aportes</span><span className="ml-auto font-semibold text-foreground">{capitalPct.toFixed(0)}%</span></div>
            <div className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-success" /><span className="text-muted-foreground">Juros e encargos</span><span className="ml-auto font-semibold text-foreground">{lucrosPct.toFixed(0)}%</span></div>
            <div className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-info" /><span className="text-muted-foreground">Principal</span><span className="ml-auto font-semibold text-foreground">{parcelasPct.toFixed(0)}%</span></div>
            <div className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-muted-foreground" /><span className="text-muted-foreground">A classificar</span><span className="ml-auto font-semibold text-foreground">{unclassifiedPct.toFixed(0)}%</span></div>
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
            <span className="text-xs text-muted-foreground font-normal">({summary?.timeline_count??0})</span>
          </h2>
          <div className="relative w-full sm:w-auto">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              id="portfolio-timeline-search"
              name="portfolio_timeline_search"
              aria-label="Buscar no histórico da carteira"
              autoComplete="off"
              maxLength={200}
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
                  <div className="sticky top-0 z-5 flex items-center justify-between border-b border-border/60 bg-card/95 px-4 py-2.5 backdrop-blur-sm sm:px-5">
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
                            disabled={!manual.ready || saving || !!manual.pending}
                            onClick={() => t.remove_id && handleDeleteCapital(t.remove_id)}
                            className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive sm:opacity-0 sm:group-hover:opacity-100"
                            title="Remover"
                            aria-label={`Remover lançamento: ${t.desc}`}
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
        {(summary?.timeline_count??0)>50&&<div className="flex flex-wrap items-center justify-between gap-2 border-t border-border p-3 text-sm">
          <button type="button" disabled={historyPage===0||cashQuery.isFetching} onClick={()=>setHistoryPage(value=>value-1)} className="min-h-11 rounded-lg border px-3 disabled:opacity-50">Anterior</button>
          <span>Página {historyPage+1} de {Math.ceil((summary?.timeline_count??0)/50)}</span>
          <button type="button" disabled={(historyPage+1)*50>=(summary?.timeline_count??0)||cashQuery.isFetching} onClick={()=>setHistoryPage(value=>value+1)} className="min-h-11 rounded-lg border px-3 disabled:opacity-50">Próxima</button>
        </div>}
      </div>
    </div>
  );
};

export default Carteira;
