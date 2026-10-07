import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";

import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/use-toast";
import {
  Landmark, Plus, RefreshCw, Wallet, TrendingUp,
  CheckCircle2, ExternalLink, Trash2, Copy, DollarSign,
  Search, ArrowUpDown, CalendarDays, AlertTriangle, Users, Pencil, Undo2,
} from "lucide-react";
import { buildInvestorLoanUpdate, validateInvestorLoanTerms } from "@/lib/investorLoan";
import { fetchAll } from "@/lib/fetchAll";
import { formatBR, parseLocalDate, todayLocalISO, toDateInputValue } from "@/lib/dateUtils";



const brl = (n: number) => {
  const value = Number(n ?? 0);
  return (Number.isFinite(value) ? value : 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
};
const safeNumber = (value: unknown) => {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
};
const fmtDate = (d?: string | null) => d ? formatBR(d) || "-" : "-";

export type Investor = {
  id: string; name: string; cpf_cnpj: string | null; email: string | null;
  phone: string | null; whatsapp: string | null; pix_key: string | null;
  pix_key_type: string | null; notes: string | null; access_token: string;
  status: string; created_at: string;
};
export type Loan = {
  id: string; investor_id: string; principal: number; interest_rate: number;
  total_due: number; paid_amount: number; start_date: string; due_date: string;
  frequency: string; status: string; payment_method: string | null;
  paid_at: string | null; notes: string | null; created_at: string;
};

export default function Investidores() {
  const { user } = useAuth();
  const navigate = useNavigate();
  /** Abre o perfil completo do investidor em página própria (igual ao perfil do cliente). */
  const openProfile = (id: string) => navigate(`/investidores/${id}`);


  const [investors, setInvestors] = useState<Investor[]>([]);
  const [loans, setLoans] = useState<Loan[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const expandedId = searchParams.get("perfil");
  const setExpandedId = (id: string | null) => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (id) next.set("perfil", id);
        else next.delete("perfil");
        return next;
      },
      { replace: false },
    );
  };
  const [newOpen, setNewOpen] = useState(false);
  const [newLoanOpen, setNewLoanOpen] = useState(false);
  const [payOpen, setPayOpen] = useState<string | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [editLoanId, setEditLoanId] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "active" | "overdue" | "paid">("all");
  const [sortBy, setSortBy] = useState<"total" | "name" | "prox">("total");


  const load = async () => {
    if (!user?.id) return;
    setLoading(true);
    setLoadError(null);
    try {
      const [investorResult, loanResult] = await Promise.all([
        fetchAll<Investor>((from, to) => (supabase.from("investors" as never) as any).select("*").eq("user_id", user.id).order("created_at", { ascending: false }).range(from, to)),
        fetchAll<Loan>((from, to) => (supabase.from("investor_loans" as never) as any).select("*").eq("user_id", user.id).order("due_date", { ascending: true }).range(from, to)),
      ]);
      setInvestors(investorResult);
      setLoans(loanResult);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Não foi possível carregar os investidores.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load();   }, [user?.id]);

  const selected = investors.find((i) => i.id === selectedId) || null;
  const selectedLoans = useMemo(
    () => loans.filter((l) => l.investor_id === (selectedId || "")),
    [loans, selectedId],
  );

  const totals = useMemo(() => {
    const active = loans.filter((l) => l.status !== "paid");
    return {
      captado: active.reduce((s, l) => s + safeNumber(l.principal), 0),
      devido: active.reduce((s, l) => s + Math.max(0, safeNumber(l.total_due) - safeNumber(l.paid_amount)), 0),
      pago: loans.reduce((s, l) => s + safeNumber(l.paid_amount), 0),
      contagem: investors.filter((i) => i.status === "active").length,
    };
  }, [loans, investors]);

  const perInvestor = (id: string) => {
    const all = loans.filter((l) => l.investor_id === id);
    const active = all.filter((l) => l.status !== "paid");
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const overdue = active.filter((l) => {
      const due = parseLocalDate(l.due_date);
      return !!due && due < today;
    });
    const totalDue = active.reduce((s, l) => s + safeNumber(l.total_due), 0);
    const capital = active.reduce((s, l) => s + safeNumber(l.principal), 0);
    const paidActive = active.reduce((s, l) => s + safeNumber(l.paid_amount), 0);
    const saldo = Math.max(0, totalDue - paidActive);
    const pct = totalDue > 0 ? Math.min(100, Math.round((paidActive / totalDue) * 100)) : 0;
    const prox = active.map((r) => r.due_date).filter((value): value is string => !!parseLocalDate(value)).sort((a, b) => (parseLocalDate(a)?.getTime() ?? Number.MAX_SAFE_INTEGER) - (parseLocalDate(b)?.getTime() ?? Number.MAX_SAFE_INTEGER))[0] || null;
    const proxDays = prox && parseLocalDate(prox) ? Math.floor((parseLocalDate(prox)!.getTime() - today.getTime()) / 86400000) : null;
    const state: "overdue" | "warn" | "ok" | "paid" =
      overdue.length > 0 ? "overdue" :
      proxDays !== null && proxDays <= 7 ? "warn" :
      active.length === 0 && all.length > 0 ? "paid" : "ok";
    return { total: totalDue, capital, paid: paidActive, saldo, pct, prox, proxDays, count: active.length, allCount: all.length, overdueCount: overdue.length, state };
  };

  const copyPortal = async (token: string) => {
    const url = `${window.location.origin}/investidor/${token}`;
    try {
      await navigator.clipboard.writeText(url);
      toast({ title: "Link copiado!", description: url });
    } catch {
      toast({ title: "Não foi possível copiar", description: "Abra o portal e copie o endereço do navegador.", variant: "destructive" });
    }
  };

  /** Dar baixa: abre o pagamento do empréstimo aberto mais próximo do vencimento. */
  const darBaixa = (investorId: string) => {
    const aberto = loans
      .filter((l) => l.investor_id === investorId && l.status !== "paid")
      .sort((a, b) => String(a.due_date || "9999-12-31").localeCompare(String(b.due_date || "9999-12-31")))[0];
    if (!aberto) { toast({ title: "Nenhum empréstimo em aberto", variant: "destructive" }); return; }
    setPayOpen(aberto.id);
  };

  const regenerateToken = async (id: string) => {
    const { data, error } = await supabase.rpc("investor_regenerate_token" as never, { _investor_id: id } as never);
    if (error) { toast({ title: "Erro", description: error.message, variant: "destructive" }); return; }
    toast({ title: "Novo link gerado" });
    void load();
    if (data) void copyPortal(data as string);
  };

  const deleteInvestor = async (id: string) => {
    if (!confirm("Excluir este investidor e todos os empréstimos vinculados?")) return;
    if (!user?.id) return;
    const { error } = await supabase.from("investors" as never).delete().eq("id", id).eq("user_id", user.id);
    if (error) { toast({ title: "Erro", description: error.message, variant: "destructive" }); return; }
    toast({ title: "Investidor excluído" });
    setSelectedId(null);
    void load();
  };

  /** Remove um empréstimo do investidor e os pagamentos vinculados. */
  const deleteLoan = async (loanId: string) => {
    if (!confirm("Excluir este empréstimo e os pagamentos registrados nele?")) return;
    if (!user?.id) return;
    const { error } = await supabase.from("investor_loans" as never).delete().eq("id", loanId).eq("user_id", user.id);
    if (error) { toast({ title: "Erro", description: error.message, variant: "destructive" }); return; }
    toast({ title: "Empréstimo excluído" });
    void load();
  };

  /** Desfaz (estorna) o último pagamento registrado no empréstimo. */
  const undoLastPayment = async (loanId: string) => {
    const loan = loans.find((l) => l.id === loanId);
    if (!loan) return;
    if (Number(loan.paid_amount) <= 0) {
      toast({ title: "Nenhum pagamento para desfazer", variant: "destructive" });
      return;
    }
    if (!confirm("Desfazer o último pagamento deste empréstimo?")) return;
    const { error } = await supabase.rpc("reverse_last_investor_payment", { _loan_id: loanId });
    if (error) { toast({ title: "Erro", description: error.message, variant: "destructive" }); return; }
    toast({ title: "Pagamento desfeito", description: `Saldo devedor atualizado.` });
    void load();
  };



  // Enriched list: filter + sort + search
  const enriched = useMemo(() => {
    const q = search.trim().toLowerCase();
    const rows = investors.map((inv) => ({ inv, s: perInvestor(inv.id) }))
      .filter(({ inv, s }) => {
        if (filter === "active" && s.count === 0) return false;
        if (filter === "overdue" && s.overdueCount === 0) return false;
        if (filter === "paid" && !(s.count === 0 && s.allCount > 0)) return false;
        if (!q) return true;
        return (inv.name || "").toLowerCase().includes(q) ||
          (inv.cpf_cnpj || "").toLowerCase().includes(q) ||
          (inv.email || "").toLowerCase().includes(q) ||
          (inv.whatsapp || inv.phone || "").toLowerCase().includes(q);
      });
    rows.sort((a, b) => {
      if (sortBy === "name") return String(a.inv.name || "").localeCompare(String(b.inv.name || ""), "pt-BR");
      if (sortBy === "prox") {
        const pa = a.s.prox || "9999-99-99"; const pb = b.s.prox || "9999-99-99";
        return pa.localeCompare(pb);
      }
      return b.s.total - a.s.total;
    });
    // overdue always first
    rows.sort((a, b) => (b.s.overdueCount > 0 ? 1 : 0) - (a.s.overdueCount > 0 ? 1 : 0));
    return rows;
  }, [investors, loans, search, filter, sortBy]);

  const overdueCount = enriched.filter(({ s }) => s.overdueCount > 0).length;

  // Perfil aberto via ?perfil=<id> — precisa existir para o modal renderizar
  const expandedProfile = useMemo(() => {
    if (!expandedId) return null;
    const inv = investors.find((i) => i.id === expandedId);
    if (!inv) return null;
    return {
      inv,
      s: perInvestor(inv.id),
      loans: loans.filter((l) => l.investor_id === inv.id),
    };
  }, [expandedId, investors, loans]);


  return (
    <>
      <div className="space-y-5 md:p-6">

        {/* Header */}
        <header className="rounded-2xl border border-border/60 bg-card/65 p-4 sm:p-5 flex flex-wrap items-center justify-between gap-4 backdrop-blur-xl">
          <div className="min-w-0">
            <h1 className="flex items-center gap-3 font-heading text-xl sm:text-2xl font-bold text-foreground tracking-tight">
              <span className="hidden sm:inline-flex h-10 w-10 items-center justify-center rounded-xl bg-primary/15 ring-1 ring-primary/25">
                <Landmark className="h-6 w-6 text-primary" />
              </span>
              Carteira de Investidores
            </h1>
            <p className="mt-1.5 text-sm text-muted-foreground">
              Capital captado, contratos ativos e portal exclusivo de cada investidor.
            </p>
          </div>
          <Button size="lg" onClick={() => setNewOpen(true)} className="w-full sm:w-auto gap-2">
            <Plus className="h-4 w-4" /> Novo investidor
          </Button>
        </header>

        {/* KPIs */}
        <section className="grid grid-cols-2 gap-2.5 md:grid-cols-4">
          <KpiCard icon={Users} label="Investidores ativos" value={String(totals.contagem)} tone="primary" hint={`${investors.length} no total`} />
          <KpiCard icon={Wallet} label="Capital captado" value={brl(totals.captado)} tone="emerald" hint="em contratos ativos" />
          <KpiCard icon={TrendingUp} label="Total a pagar" value={brl(totals.devido)} tone="amber" hint={overdueCount ? `${overdueCount} c/ atraso` : "todos em dia"} />
          <KpiCard icon={CheckCircle2} label="Já pago" value={brl(totals.pago)} tone="violet" hint="acumulado" />
        </section>

        {/* Toolbar */}
        <div className="flex flex-col gap-3 rounded-2xl border border-border/60 bg-card/50 p-3 backdrop-blur-sm md:flex-row md:items-center md:justify-between">
          <div className="relative flex-1 md:max-w-sm">
            <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar por nome, documento, e-mail…"
              className="pl-9"
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {([
              { k: "all", label: "Todos", n: investors.length },
              { k: "active", label: "Com saldo", n: investors.filter(i => perInvestor(i.id).count > 0).length },
              { k: "overdue", label: "Atrasados", n: overdueCount },
              { k: "paid", label: "Quitados", n: investors.filter(i => { const s = perInvestor(i.id); return s.count === 0 && s.allCount > 0; }).length },
            ] as const).map((f) => (
              <button
                key={f.k}
                onClick={() => setFilter(f.k)}
                className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                  filter === f.k
                    ? "border-primary bg-primary text-primary-foreground shadow-xs"
                    : "border-border bg-background/40 text-muted-foreground hover:text-foreground hover:border-primary/40"
                }`}
              >
                {f.label}
                <span className={`rounded-full px-1.5 text-[10px] font-bold ${filter === f.k ? "bg-primary-foreground/20" : "bg-muted/60"}`}>{f.n}</span>
              </button>
            ))}
            <div className="ml-1 flex items-center gap-1 rounded-full border border-border bg-background/40 px-2 py-1 text-xs">
              <ArrowUpDown size={12} className="text-muted-foreground" />
              <select name="investors-sort" aria-label="Ordenar investidores" value={sortBy} onChange={(e) => setSortBy(e.target.value as any)} className="bg-transparent text-xs font-medium outline-hidden">
                <option value="total">Maior saldo</option>
                <option value="prox">Próximo vencimento</option>
                <option value="name">Nome (A→Z)</option>
              </select>
            </div>
          </div>
        </div>

        {/* Cards grid */}
        {loading ? (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-56 animate-pulse rounded-2xl border border-border/50 bg-card/40" />
            ))}
          </div>
        ) : loadError ? (
          <div className="rounded-2xl border border-destructive/30 bg-destructive/5 py-12 text-center">
            <AlertTriangle className="mx-auto h-10 w-10 text-destructive" />
            <p className="mt-3 font-semibold text-foreground">Não foi possível carregar os investidores</p>
            <p className="mx-auto mt-1 max-w-lg text-sm text-muted-foreground">{loadError}</p>
            <Button variant="outline" className="mt-4 gap-2" onClick={() => void load()}>
              <RefreshCw className="h-4 w-4" /> Tentar novamente
            </Button>
          </div>
        ) : investors.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border/60 py-16 text-center">
            <Landmark className="mx-auto h-12 w-12 text-muted-foreground/40" />
            <p className="mt-3 text-sm text-muted-foreground">Nenhum investidor cadastrado ainda.</p>
            <Button className="mt-4" onClick={() => setNewOpen(true)}><Plus className="mr-1 h-4 w-4" /> Cadastrar o primeiro</Button>
          </div>
        ) : enriched.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border/60 py-12 text-center text-sm text-muted-foreground">
            Nenhum investidor corresponde aos filtros.
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {enriched.map(({ inv, s }) => {
              const initials = (inv.name || "?").split(/\s+/).map(x => x[0]).filter(Boolean).slice(0, 2).join("").toUpperCase();
              const accentGrad =
                s.state === "overdue" ? "from-destructive via-destructive/60 to-amber-500" :
                s.state === "warn" ? "from-amber-500 via-amber-400 to-amber-300" :
                s.state === "paid" ? "from-success via-success/70 to-primary" :
                "from-primary via-primary/70 to-primary/30";
              const ringCls =
                s.state === "overdue" ? "ring-destructive/40 bg-destructive/10 text-destructive" :
                s.state === "warn" ? "ring-amber-500/40 bg-amber-500/10 text-amber-500" :
                s.state === "paid" ? "ring-success/40 bg-success/10 text-success" :
                "ring-primary/30 bg-primary/10 text-primary";
              const dot =
                s.state === "overdue" ? "bg-destructive" :
                s.state === "warn" ? "bg-amber-500" :
                s.state === "paid" ? "bg-success" : "bg-primary";
              const proxLabel = s.prox
                ? (s.proxDays! < 0 ? `${Math.abs(s.proxDays!)}d atraso` :
                   s.proxDays === 0 ? "vence hoje" :
                   s.proxDays! <= 7 ? `em ${s.proxDays}d` : fmtDate(s.prox))
                : "—";

              return (
                <article
                  key={inv.id}
                  className={`group relative min-w-0 overflow-hidden rounded-2xl border bg-card/70 backdrop-blur-xs transition-colors ${
                    s.state === "overdue" ? "border-destructive/30" : "border-border/70"
                  }`}
                >
                  <div className={`h-[3px] w-full bg-linear-to-r ${accentGrad}`} />
                  <div className="p-4 sm:p-5 space-y-4">
                    {/* Head — avatar + identity */}
                    <div className="flex items-start gap-3">
                      <button
                        onClick={() => openProfile(inv.id)}
                        className={`relative shrink-0 h-12 w-12 rounded-full ring-2 ${ringCls} flex items-center justify-center text-sm font-bold transition-transform group-hover:scale-105 focus-ring`}
                        title="Abrir perfil"
                      >
                        {initials || "?"}
                        <span className={`absolute -bottom-0.5 -right-0.5 h-3.5 w-3.5 rounded-full border-2 border-card ${dot}`} />
                      </button>
                      <button
                        onClick={() => openProfile(inv.id)}
                        className="min-w-0 flex-1 text-left focus-ring rounded-lg"
                      >
                        <p className="truncate text-[15px] font-bold text-foreground tracking-tight" title={inv.name}>{inv.name}</p>
                        <div className="mt-1 flex items-center gap-1.5 flex-wrap text-[11px] text-muted-foreground">
                          {inv.cpf_cnpj && <span className="tabular-nums">{inv.cpf_cnpj}</span>}
                          {(inv.whatsapp || inv.phone) && <span className="tabular-nums">· {inv.whatsapp || inv.phone}</span>}
                        </div>
                        <div className="mt-2 flex items-center gap-1.5 flex-wrap">
                          {s.overdueCount > 0 && (
                            <span className="inline-flex items-center gap-1 rounded-full border border-destructive/25 bg-destructive/10 px-2 py-0.5 text-[10px] font-bold text-destructive">
                              <AlertTriangle size={10} /> {s.overdueCount} em atraso
                            </span>
                          )}
                          {s.state === "paid" && (
                            <span className="inline-flex items-center gap-1 rounded-full border border-success/25 bg-success/10 px-2 py-0.5 text-[10px] font-bold text-success">
                              <CheckCircle2 size={10} /> quitado
                            </span>
                          )}
                          <span className="inline-flex items-center gap-1 rounded-full border border-border/60 bg-background/50 px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">
                            {s.count} contrato{s.count === 1 ? "" : "s"}
                          </span>
                        </div>
                      </button>
                    </div>

                    {/* Balance hero */}
                    <div className={`rounded-xl border p-3 ${
                      s.state === "overdue" ? "border-destructive/25 bg-destructive/5" : "border-border/60 bg-background/40"
                    }`}>
                      <div className="flex items-end justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold">Saldo a receber</p>
                          <p className={`text-xl sm:text-2xl font-black tabular-nums leading-tight mt-0.5 wrap-break-word ${s.state === "overdue" ? "text-destructive" : "text-foreground"}`}>
                            {brl(s.saldo)}
                          </p>
                        </div>
                        <div className={`shrink-0 text-right ${
                          s.state === "overdue" ? "text-destructive" : s.state === "warn" ? "text-amber-500" : "text-muted-foreground"
                        }`}>
                          <p className="text-[10px] uppercase tracking-widest font-semibold flex items-center gap-1 justify-end">
                            <CalendarDays size={10} /> Próx.
                          </p>
                          <p className="text-sm font-bold tabular-nums leading-tight mt-0.5">{proxLabel}</p>
                        </div>
                      </div>
                    </div>

                    {/* KPIs */}
                    <div className="grid grid-cols-2 gap-2">
                      <div className="rounded-xl border border-border/60 bg-background/40 px-3 py-2">
                        <p className="text-[9px] uppercase tracking-widest text-muted-foreground font-semibold">Capital</p>
                        <p className="text-sm font-bold text-foreground tabular-nums mt-0.5">{brl(s.capital)}</p>
                      </div>
                      <div className="rounded-xl border border-border/60 bg-background/40 px-3 py-2">
                        <p className="text-[9px] uppercase tracking-widest text-muted-foreground font-semibold">Total</p>
                        <p className="text-sm font-bold text-foreground tabular-nums mt-0.5">{brl(s.total)}</p>
                      </div>
                    </div>

                    {/* Progress */}
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between text-[11px]">
                        <span className="font-semibold text-muted-foreground">Recebido {brl(s.paid)}</span>
                        <span className="tabular-nums font-bold text-foreground">{s.pct}%</span>
                      </div>
                      <div className="relative h-2 overflow-hidden rounded-full bg-muted/50">
                        <div
                          className={`h-full rounded-full transition-all bg-linear-to-r ${
                            s.pct >= 80 ? "from-success to-success/70" : s.pct >= 40 ? "from-primary to-primary/70" : "from-amber-500 to-amber-400"
                          }`}
                          style={{ width: `${Math.max(s.pct > 0 ? 4 : 0, s.pct)}%` }}
                        />
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={() => darBaixa(inv.id)}
                        disabled={s.count === 0}
                        className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg bg-linear-to-br from-primary to-primary/85 px-3 py-2.5 text-xs font-bold text-primary-foreground transition-all hover:shadow-md hover:shadow-primary/30 active:scale-[0.98] focus-ring disabled:opacity-40"
                      >
                        <DollarSign size={13} /> Dar baixa
                      </button>
                      <button
                        onClick={() => setEditId(inv.id)}
                        title="Editar perfil do investidor"
                        className="h-9 w-9 inline-flex items-center justify-center rounded-lg border border-border bg-accent/40 text-foreground transition-all hover:bg-accent active:scale-[0.98] focus-ring"
                      >
                        <Pencil size={14} />
                      </button>
                      <button
                        onClick={() => void copyPortal(inv.access_token)}
                        title="Copiar link do portal"
                        className="h-9 w-9 inline-flex items-center justify-center rounded-lg border border-border bg-accent/40 text-foreground transition-all hover:bg-accent active:scale-[0.98] focus-ring"
                      >
                        <Copy size={14} />
                      </button>
                      <button
                        onClick={() => window.open(`/investidor/${inv.access_token}`, "_blank", "noopener,noreferrer")}
                        title="Abrir portal do investidor"
                        className="h-9 w-9 inline-flex items-center justify-center rounded-lg border border-border bg-accent/40 text-foreground transition-all hover:bg-accent active:scale-[0.98] focus-ring"
                      >
                        <ExternalLink size={14} />
                      </button>
                    </div>

                    {/* Secondary actions */}
                    <div className="flex items-center justify-between border-t border-border/50 pt-3 text-[11px]">
                      <button
                        onClick={() => { setSelectedId(inv.id); setNewLoanOpen(true); }}
                        className="inline-flex items-center gap-1 font-bold text-primary hover:underline"
                      >
                        <Plus size={13} /> Novo empréstimo
                      </button>
                      <div className="flex items-center gap-1 text-muted-foreground">
                        <button onClick={() => regenerateToken(inv.id)} className="h-7 w-7 inline-flex items-center justify-center rounded-md hover:bg-accent hover:text-foreground transition-colors" title="Gerar novo link do portal">
                          <RefreshCw size={12} />
                        </button>
                        <button onClick={() => deleteInvestor(inv.id)} className="h-7 w-7 inline-flex items-center justify-center rounded-md hover:bg-destructive/10 hover:text-destructive transition-colors" title="Excluir investidor">
                          <Trash2 size={12} />
                        </button>
                      </div>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>


      {expandedProfile && (
        <Dialog open onOpenChange={(o) => !o && setExpandedId(null)}>
          <DialogContent className="max-h-[90dvh] max-w-2xl overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Landmark className="h-5 w-5 text-primary" /> {expandedProfile.inv.name}
              </DialogTitle>
            </DialogHeader>

            <div className="space-y-4">
              <div className="grid gap-2 text-xs text-muted-foreground sm:grid-cols-2">
                {expandedProfile.inv.cpf_cnpj && <p>Documento: <span className="text-foreground tabular-nums">{expandedProfile.inv.cpf_cnpj}</span></p>}
                {expandedProfile.inv.email && <p>E-mail: <span className="text-foreground">{expandedProfile.inv.email}</span></p>}
                {(expandedProfile.inv.whatsapp || expandedProfile.inv.phone) && (
                  <p>Contato: <span className="text-foreground tabular-nums">{expandedProfile.inv.whatsapp || expandedProfile.inv.phone}</span></p>
                )}
                {expandedProfile.inv.pix_key && <p>Pix: <span className="text-foreground break-all">{expandedProfile.inv.pix_key}</span></p>}
              </div>

              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <KpiCard icon={Wallet} label="Capital" value={brl(expandedProfile.s.capital)} tone="primary" />
                <KpiCard icon={TrendingUp} label="Saldo" value={brl(expandedProfile.s.saldo)} tone="amber" />
                <KpiCard icon={CheckCircle2} label="Pago" value={brl(expandedProfile.s.paid)} tone="emerald" />
                <KpiCard icon={CalendarDays} label="Próx. venc." value={expandedProfile.s.prox ? fmtDate(expandedProfile.s.prox) : "—"} tone="violet" />
              </div>

              <div className="flex flex-wrap gap-2">
                <Button size="sm" onClick={() => { setSelectedId(expandedProfile.inv.id); setNewLoanOpen(true); }} className="gap-1.5">
                  <Plus size={14} /> Novo empréstimo
                </Button>
                <Button size="sm" variant="outline" onClick={() => setEditId(expandedProfile.inv.id)} className="gap-1.5">
                  <Pencil size={14} /> Editar perfil
                </Button>
                <Button size="sm" variant="outline" onClick={() => darBaixa(expandedProfile.inv.id)} className="gap-1.5">
                  <DollarSign size={14} /> Dar baixa
                </Button>
                <Button size="sm" variant="outline" onClick={() => copyPortal(expandedProfile.inv.access_token)} className="gap-1.5">
                  <Copy size={14} /> Copiar link do portal
                </Button>
                <Button size="sm" variant="outline" onClick={() => window.open(`/investidor/${expandedProfile.inv.access_token}`, "_blank", "noopener,noreferrer")} className="gap-1.5">
                  <ExternalLink size={14} /> Abrir portal
                </Button>
                <Button size="sm" variant="outline" onClick={() => regenerateToken(expandedProfile.inv.id)} className="gap-1.5">
                  <RefreshCw size={14} /> Novo link
                </Button>
              </div>

              <div>
                <p className="mb-2 text-xs font-bold uppercase tracking-widest text-muted-foreground">
                  Empréstimos ({expandedProfile.loans.length})
                </p>
                {expandedProfile.loans.length === 0 ? (
                  <p className="rounded-xl border border-dashed border-border/60 py-8 text-center text-sm text-muted-foreground">
                    Nenhum empréstimo registrado para este investidor.
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {expandedProfile.loans.map((l) => {
                      const saldoLoan = safeNumber(l.total_due) - safeNumber(l.paid_amount);
                      return (
                        <li key={l.id} className="rounded-xl border border-border/60 bg-background/40 p-3">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div>
                              <p className="font-mono text-lg font-bold text-foreground">{brl(Number(l.total_due))}</p>
                              <p className="text-[11px] text-muted-foreground">
                                Capital {brl(safeNumber(l.principal))} • Juros {safeNumber(l.interest_rate)}% • Vence {fmtDate(l.due_date)}
                              </p>
                            </div>
                            <div className="flex flex-wrap items-center gap-1.5">
                              <Badge variant={l.status === "paid" ? "secondary" : "outline"}>
                                {l.status === "paid" ? "Quitado" : `Saldo ${brl(saldoLoan)}`}
                              </Badge>
                              {l.status !== "paid" && (
                                <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setPayOpen(l.id)}>
                                  <DollarSign size={13} /> Pagar
                                </Button>
                              )}
                              <Button size="sm" variant="ghost" className="h-8 w-8 p-0" title="Editar valores do empréstimo"
                                onClick={() => setEditLoanId(l.id)}>
                                <Pencil size={13} />
                              </Button>
                              <Button size="sm" variant="ghost" className="h-8 w-8 p-0" title="Desfazer último pagamento"
                                disabled={Number(l.paid_amount) <= 0}
                                onClick={() => void undoLastPayment(l.id)}>
                                <Undo2 size={13} />
                              </Button>
                              <Button size="sm" variant="ghost" className="h-8 w-8 p-0 text-destructive hover:text-destructive"
                                title="Excluir empréstimo" onClick={() => void deleteLoan(l.id)}>
                                <Trash2 size={13} />
                              </Button>
                            </div>

                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>

              {expandedProfile.inv.notes && (
                <p className="rounded-xl border border-border/60 bg-background/40 p-3 text-xs text-muted-foreground">
                  {expandedProfile.inv.notes}
                </p>
              )}

              <div className="flex justify-end border-t border-border/50 pt-3">
                <Button size="sm" variant="ghost" className="gap-1.5 text-destructive hover:text-destructive"
                  onClick={() => { const id = expandedProfile.inv.id; setExpandedId(null); void deleteInvestor(id); }}>
                  <Trash2 size={14} /> Excluir investidor
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}

      <NewInvestorDialog open={newOpen} onOpenChange={setNewOpen} onCreated={(id) => { setSelectedId(id); void load(); }} />

      {editId && investors.find((i) => i.id === editId) && (
        <EditInvestorDialog
          investor={investors.find((i) => i.id === editId)!}
          onClose={() => setEditId(null)}
          onSaved={() => { setEditId(null); void load(); }}
        />
      )}

      {selected && (
        <NewLoanDialog
          open={newLoanOpen}
          onOpenChange={setNewLoanOpen}
          investor={selected}
          onCreated={() => void load()}
        />
      )}
      {payOpen && loans.some((l) => l.id === payOpen) && (
        <PayLoanDialog
          loanId={payOpen}
          loan={loans.find((l) => l.id === payOpen)!}
          onClose={() => setPayOpen(null)}
          onPaid={() => { setPayOpen(null); void load(); }}
        />
      )}
      {editLoanId && loans.some((l) => l.id === editLoanId) && (
        <EditLoanDialog
          loan={loans.find((l) => l.id === editLoanId)!}
          onClose={() => setEditLoanId(null)}
          onSaved={() => { setEditLoanId(null); void load(); }}
        />
      )}

    </>
  );
}

export function KpiCard({ icon: Icon, label, value, tone, hint }: { icon: any; label: string; value: string; tone: string; hint?: string }) {
  const tones: Record<string, string> = {
    primary: "from-primary/20 to-primary/5 text-primary",
    emerald: "from-emerald-500/20 to-emerald-500/5 text-emerald-300",
    amber: "from-amber-500/20 to-amber-500/5 text-amber-300",
    violet: "from-violet-500/20 to-violet-500/5 text-violet-300",
  };
  return (
    <div className={`min-w-0 rounded-xl border border-white/10 bg-linear-to-br ${tones[tone]} p-3 sm:p-4`}>
      <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest opacity-80">
        <Icon className="h-3.5 w-3.5" /> {label}
      </div>
      <p className="mt-2 font-mono text-base sm:text-xl font-bold leading-tight text-foreground wrap-break-word">{value}</p>
      {hint && <p className="mt-1 text-[10px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

function NewInvestorDialog({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (o: boolean) => void; onCreated: (id: string) => void }) {
  const { user } = useAuth();
  const [form, setForm] = useState({ name: "", cpf_cnpj: "", email: "", whatsapp: "", phone: "", pix_key: "", notes: "" });
  const [loading, setLoading] = useState(false);
  const submit = async () => {
    if (!form.name.trim()) { toast({ title: "Nome obrigatório", variant: "destructive" }); return; }
    if (!user?.id) return;
    setLoading(true);
    const { data, error } = await supabase.from("investors" as never)
      .insert({ ...form, user_id: user.id } as never).select("id, access_token").single();
    setLoading(false);
    if (error) { toast({ title: "Erro", description: error.message, variant: "destructive" }); return; }
    toast({ title: "Investidor cadastrado!" });
    onCreated((data as any).id);
    setForm({ name: "", cpf_cnpj: "", email: "", whatsapp: "", phone: "", pix_key: "", notes: "" });
    onOpenChange(false);
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100vw-1.5rem)] max-h-[90dvh] max-w-lg overflow-y-auto">
        <DialogHeader><DialogTitle>Novo investidor</DialogTitle></DialogHeader>
        <div className="grid gap-3">
          <div><Label>Nome *</Label><Input name="investor_name" autoComplete="name" aria-label="Nome do investidor" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div><Label>CPF/CNPJ</Label><Input name="investor_cpf_cnpj" aria-label="CPF ou CNPJ do investidor" value={form.cpf_cnpj} onChange={(e) => setForm({ ...form, cpf_cnpj: e.target.value })} /></div>
            <div><Label>WhatsApp</Label><Input name="investor_whatsapp" autoComplete="tel" aria-label="WhatsApp do investidor" value={form.whatsapp} onChange={(e) => setForm({ ...form, whatsapp: e.target.value })} /></div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div><Label>E-mail</Label><Input name="investor_email" autoComplete="email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
            <div><Label>Telefone</Label><Input name="investor_phone" autoComplete="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>
          </div>
          <div><Label>Chave PIX</Label><Input name="investor_pix_key" aria-label="Chave PIX do investidor" value={form.pix_key} onChange={(e) => setForm({ ...form, pix_key: e.target.value })} /></div>
          <div><Label>Observações</Label><Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2} /></div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={submit} disabled={loading}>{loading ? "Salvando…" : "Cadastrar"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function NewLoanDialog({ open, onOpenChange, investor, onCreated }: { open: boolean; onOpenChange: (o: boolean) => void; investor: Investor; onCreated: () => void }) {
  const { user } = useAuth();
  const [principal, setPrincipal] = useState("");
  const [rate, setRate] = useState("20");
  const [dueDate, setDueDate] = useState("");
  const [freq, setFreq] = useState("bullet");
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(false);

  const totalDue = useMemo(() => {
    const p = parseFloat(principal.replace(",", ".")) || 0;
    const r = parseFloat(rate.replace(",", ".")) || 0;
    return p * (1 + r / 100);
  }, [principal, rate]);

  const submit = async () => {
    const p = parseFloat(principal.replace(",", ".")) || 0;
    const r = parseFloat(rate.replace(",", ".")) || 0;
    const termsError = validateInvestorLoanTerms({ principal: p, interestRate: r, totalDue });
    if (termsError) { toast({ title: "Valores inválidos", description: termsError, variant: "destructive" }); return; }
    if (!dueDate) { toast({ title: "Informe o vencimento", variant: "destructive" }); return; }
    if (!user?.id) return;
    setLoading(true);
    const { error } = await supabase.from("investor_loans" as never).insert({
      investor_id: investor.id, user_id: user.id, principal: p, interest_rate: r,
      total_due: totalDue, due_date: dueDate, frequency: freq, notes,
    } as never);
    setLoading(false);
    if (error) { toast({ title: "Erro", description: error.message, variant: "destructive" }); return; }
    toast({ title: "Empréstimo registrado!" });
    setPrincipal(""); setRate("20"); setDueDate(""); setNotes("");
    onCreated();
    onOpenChange(false);
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100vw-1.5rem)] max-h-[90dvh] max-w-md overflow-y-auto">
        <DialogHeader><DialogTitle>Novo empréstimo — {investor.name}</DialogTitle></DialogHeader>
        <div className="grid gap-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div><Label>Valor recebido (R$) *</Label><Input name="investor_loan_principal" aria-label="Valor recebido" inputMode="decimal" value={principal} onChange={(e) => setPrincipal(e.target.value)} placeholder="10000" /></div>
            <div><Label>Juros (%) *</Label><Input name="investor_loan_rate" aria-label="Juros do empréstimo" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} /></div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div><Label>Vencimento *</Label><Input name="investor_loan_due_date" aria-label="Vencimento do empréstimo" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} /></div>
            <div>
              <Label>Modalidade</Label>
              <select name="investor_loan_frequency" aria-label="Modalidade do empréstimo" value={freq} onChange={(e) => setFreq(e.target.value)} className="h-10 w-full rounded-md border bg-background px-3 text-sm">
                <option value="bullet">Pagamento único</option>
                <option value="monthly">Juros mensais</option>
              </select>
            </div>
          </div>
          <div className="rounded-xl border border-primary/20 bg-primary/5 p-3 text-center">
            <p className="text-xs uppercase text-muted-foreground">Total a pagar</p>
            <p className="mt-1 font-mono text-2xl font-bold text-primary">{brl(totalDue)}</p>
          </div>
          <div><Label>Observações</Label><Textarea name="investor_loan_notes" aria-label="Observações do empréstimo" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={submit} disabled={loading}>{loading ? "Salvando…" : "Registrar"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function PayLoanDialog({ loanId, loan, onClose, onPaid }: { loanId: string; loan: Loan; onClose: () => void; onPaid: () => void }) {
  const { user } = useAuth();
  const saldo = Math.max(0, safeNumber(loan.total_due) - safeNumber(loan.paid_amount));
  const interest = Math.round(safeNumber(loan.principal) * safeNumber(loan.interest_rate) / 100 * 100) / 100;
  const automaticNextDue = useMemo(() => {
    const date = parseLocalDate(loan.due_date) ?? new Date();
    if (loan.frequency === "weekly") date.setDate(date.getDate() + 7);
    else if (loan.frequency === "biweekly") date.setDate(date.getDate() + 15);
    else date.setMonth(date.getMonth() + 1);
    return toDateInputValue(date);
  }, [loan.due_date, loan.frequency]);
  const [amount, setAmount] = useState(String(saldo.toFixed(2)));
  const [method, setMethod] = useState("pix");
  const [mode, setMode] = useState<"full" | "partial" | "interest_only">("full");
  const [nextDueDate, setNextDueDate] = useState(automaticNextDue);
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(false);
  const submit = async () => {
    const a = parseFloat(amount.replace(",", ".")) || 0;
    if (a <= 0) { toast({ title: "Valor inválido", variant: "destructive" }); return; }
    if (mode !== "interest_only" && a > saldo) { toast({ title: "Valor acima do saldo", description: `O máximo é ${brl(saldo)}.`, variant: "destructive" }); return; }
    if (mode === "interest_only" && !nextDueDate) { toast({ title: "Informe o novo vencimento", variant: "destructive" }); return; }
    if (!user?.id) return;
    setLoading(true);
    const { error } = mode === "interest_only"
      ? await (supabase as any).rpc("register_investor_interest_payment", {
          _loan_id: loanId, _amount: interest, _next_due_date: nextDueDate,
          _method: method, _notes: notes || null,
        })
      : await supabase.rpc("register_investor_payment", {
          _loan_id: loanId, _amount: a, _method: method, _notes: notes || null,
        });
    setLoading(false);
    if (error) { toast({ title: "Erro", description: error.message, variant: "destructive" }); return; }
    toast({ title: mode === "interest_only" ? "Juros pagos e vencimento renovado!" : mode === "full" ? "Empréstimo quitado!" : "Pagamento parcial registrado!" });
    onPaid();
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="w-[calc(100vw-1.5rem)] max-w-sm">
        <DialogHeader><DialogTitle>Registrar pagamento</DialogTitle></DialogHeader>
        <div className="grid gap-3">
          <div className="rounded-xl border border-white/5 bg-white/2 p-3 text-center">
            <p className="text-xs uppercase text-muted-foreground">Saldo devedor</p>
            <p className="font-mono text-2xl font-bold">{brl(saldo)}</p>
          </div>
          <div className="grid grid-cols-3 gap-1.5">
            <Button type="button" size="sm" variant={mode === "full" ? "default" : "outline"} onClick={() => { setMode("full"); setAmount(saldo.toFixed(2)); }}>Quitar</Button>
            <Button type="button" size="sm" variant={mode === "partial" ? "default" : "outline"} onClick={() => { setMode("partial"); setAmount(""); }}>Parcial</Button>
            <Button type="button" size="sm" variant={mode === "interest_only" ? "default" : "outline"} disabled={interest <= 0} onClick={() => { setMode("interest_only"); setAmount(interest.toFixed(2)); }}>Só juros</Button>
          </div>
          <div><Label>Valor pago (R$)</Label><Input name="investor_payment_amount" aria-label="Valor pago" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
          {mode === "interest_only" && <div className="space-y-2 rounded-xl border border-amber-400/25 bg-amber-500/5 p-3">
            <p className="text-xs text-muted-foreground">O principal não será abatido. Paga <strong className="text-foreground">{brl(interest)}</strong> e renova o vencimento.</p>
            <div><Label>Novo vencimento</Label><Input name="investor_payment_next_due_date" aria-label="Novo vencimento" type="date" min={todayLocalISO()} value={nextDueDate} onChange={(e) => setNextDueDate(e.target.value)} /></div>
          </div>}
          <div>
            <Label>Método</Label>
            <select name="investor_payment_method" aria-label="Método do pagamento" value={method} onChange={(e) => setMethod(e.target.value)} className="h-10 w-full rounded-md border bg-background px-3 text-sm">
              <option value="pix">Pix</option><option value="dinheiro">Dinheiro</option>
              <option value="transferencia">Transferência</option><option value="outros">Outros</option>
            </select>
          </div>
          <div><Label>Observação</Label><Textarea name="investor_payment_notes" aria-label="Observação do pagamento" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Opcional" /></div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button onClick={submit} disabled={loading}>{loading ? "Salvando…" : "Confirmar"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Edição do cadastro do investidor (dados de contato, Pix e observações). */
export function EditInvestorDialog({ investor, onClose, onSaved }: { investor: Investor; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({
    name: investor.name || "",
    cpf_cnpj: investor.cpf_cnpj || "",
    email: investor.email || "",
    whatsapp: investor.whatsapp || "",
    phone: investor.phone || "",
    pix_key: investor.pix_key || "",
    notes: investor.notes || "",
    status: investor.status || "active",
  });
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    if (!form.name.trim()) { toast({ title: "Nome obrigatório", variant: "destructive" }); return; }
    setLoading(true);
    const { error } = await supabase.from("investors" as never)
      .update({ ...form, updated_at: new Date().toISOString() } as never)
      .eq("id", investor.id);
    setLoading(false);
    if (error) { toast({ title: "Erro", description: error.message, variant: "destructive" }); return; }
    toast({ title: "Perfil atualizado!" });
    onSaved();
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="w-[calc(100vw-1.5rem)] max-h-[90dvh] max-w-lg overflow-y-auto">
        <DialogHeader><DialogTitle>Editar perfil — {investor.name}</DialogTitle></DialogHeader>
        <div className="grid gap-3">
          <div><Label>Nome *</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div><Label>CPF/CNPJ</Label><Input value={form.cpf_cnpj} onChange={(e) => setForm({ ...form, cpf_cnpj: e.target.value })} /></div>
            <div><Label>WhatsApp</Label><Input value={form.whatsapp} onChange={(e) => setForm({ ...form, whatsapp: e.target.value })} /></div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div><Label>E-mail</Label><Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
            <div><Label>Telefone</Label><Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>
          </div>
          <div><Label>Chave PIX</Label><Input value={form.pix_key} onChange={(e) => setForm({ ...form, pix_key: e.target.value })} /></div>
          <div>
            <Label>Situação</Label>
            <select name="investor_status" aria-label="Situação do investidor" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}
              className="h-10 w-full rounded-md border bg-background px-3 text-sm">
              <option value="active">Ativo</option>
              <option value="inactive">Inativo</option>
            </select>
          </div>
          <div><Label>Observações</Label><Textarea name="investor_notes" aria-label="Observações do investidor" rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button onClick={submit} disabled={loading}>{loading ? "Salvando…" : "Salvar"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Edição dos valores do empréstimo do investidor (capital, juros, total, vencimento e situação). */
export function EditLoanDialog({ loan, onClose, onSaved }: { loan: Loan; onClose: () => void; onSaved: () => void }) {
  const [principal, setPrincipal] = useState(String(Number(loan.principal)));
  const [rate, setRate] = useState(String(Number(loan.interest_rate)));
  const [totalDue, setTotalDue] = useState(String(Number(loan.total_due)));
  const paidAmount = Number(loan.paid_amount);
  const [dueDate, setDueDate] = useState(loan.due_date || "");
  const [freq, setFreq] = useState(loan.frequency || "bullet");
  const [notes, setNotes] = useState(loan.notes || "");
  const [loading, setLoading] = useState(false);

  const num = (v: string) => parseFloat(String(v).replace(",", ".")) || 0;

  /** Recalcula o total com base em capital + juros. */
  const recalcTotal = () => setTotalDue((num(principal) * (1 + num(rate) / 100)).toFixed(2));

  const submit = async () => {
    const termsError = validateInvestorLoanTerms({
      principal: num(principal), interestRate: num(rate), totalDue: num(totalDue), paidAmount,
    });
    if (termsError) { toast({ title: "Valores inconsistentes", description: termsError, variant: "destructive" }); return; }
    if (!dueDate) { toast({ title: "Informe o vencimento", variant: "destructive" }); return; }
    setLoading(true);
    const { error } = await supabase.from("investor_loans" as never).update(buildInvestorLoanUpdate({
      principal: num(principal), interestRate: num(rate), totalDue: num(totalDue),
      dueDate, frequency: freq, notes,
    }) as never).eq("id", loan.id);
    setLoading(false);
    if (error) { toast({ title: "Erro", description: error.message, variant: "destructive" }); return; }
    toast({ title: "Empréstimo atualizado!" });
    onSaved();
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="w-[calc(100vw-1.5rem)] max-h-[90dvh] max-w-lg overflow-y-auto">
        <DialogHeader><DialogTitle>Editar empréstimo</DialogTitle></DialogHeader>
        <div className="grid gap-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div><Label>Capital (R$) *</Label><Input inputMode="decimal" value={principal} onChange={(e) => setPrincipal(e.target.value)} /></div>
            <div><Label>Juros (%)</Label><Input inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} /></div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div><Label>Total a pagar (R$) *</Label><Input inputMode="decimal" value={totalDue} onChange={(e) => setTotalDue(e.target.value)} /></div>
            <div>
              <Label>Já pago (somente leitura)</Label>
              <Input value={brl(paidAmount)} readOnly aria-readonly="true" className="cursor-not-allowed opacity-70" />
              <p className="mt-1 text-[10px] text-muted-foreground">Use "Registrar pagamento" ou "Desfazer último pagamento".</p>
            </div>
          </div>
          <Button type="button" size="sm" variant="outline" className="justify-self-start gap-1.5" onClick={recalcTotal}>
            <RefreshCw size={13} /> Recalcular total pelo juros
          </Button>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div><Label>Vencimento *</Label><Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} /></div>
            <div>
              <Label>Modalidade</Label>
              <select value={freq} onChange={(e) => setFreq(e.target.value)} className="h-10 w-full rounded-md border bg-background px-3 text-sm">
                <option value="bullet">Pagamento único</option>
                <option value="monthly">Juros mensais</option>
              </select>
            </div>
          </div>
          <div className="rounded-xl border border-border/60 bg-muted/20 px-3 py-2.5">
            <p className="text-xs text-muted-foreground">Situação financeira</p>
            <p className="mt-0.5 text-sm font-semibold text-foreground">{loan.status === "paid" ? "Quitado" : "Em aberto"}</p>
          </div>
          <div>
            <Label>Observações</Label>
            <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
          <div className="rounded-xl border border-primary/20 bg-primary/5 p-3 text-center">
            <p className="text-xs uppercase text-muted-foreground">Saldo devedor</p>
            <p className="mt-1 font-mono text-2xl font-bold text-primary">
              {brl(Math.max(0, num(totalDue) - paidAmount))}
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button onClick={submit} disabled={loading}>{loading ? "Salvando…" : "Salvar"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
