import { useState, useMemo, useEffect, useRef } from "react";
import { TrendingUp, Plus, X, Search, Calendar, ArrowUpRight, Edit2, Download, Trash2, MoreVertical, BarChart3, Wallet, SlidersHorizontal, CheckSquare, Square, Trophy, Target, Sparkles, ArrowUpDown, AlertTriangle, RefreshCw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { fetchAll } from "@/lib/fetchAll";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter
} from "@/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
import { formatBR, todayLocalISO } from "@/lib/dateUtils";
import { Button } from "@/components/ui/button";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMultiTableRealtime } from "@/hooks/useRealtimeSubscription";
import { friendlyError } from "@/lib/friendlyError";
import { parseFinancialAmount, parseFinancialDate } from "@/lib/financialEntry";

const fmt = (v: number) => v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function useDebounced<T>(value: T, ms = 200) {
  const [v, setV] = useState(value);
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t); }, [value, ms]);
  return v;
}

type TimeFilter = "all" | "today" | "7d" | "30d" | "90d" | "ytd";
type SortKey = "date_desc" | "date_asc" | "amount_desc" | "amount_asc";
type SourceFilter = "all" | "operational" | "manual";

const Lucros = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [desc, setDesc] = useState("");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(todayLocalISO());
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounced(search, 200);
  const [timeFilter, setTimeFilter] = useState<TimeFilter>("all");
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("all");
  const [sortKey, setSortKey] = useState<SortKey>("date_desc");
  const [showFilters, setShowFilters] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  useMultiTableRealtime(["profits"], [["lucros-data", user?.id || ""]]);

  // "/" focuses search
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "/" && !["INPUT", "TEXTAREA"].includes((e.target as HTMLElement).tagName)) {
        e.preventDefault(); searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const { data: profits = [], isLoading: loading, error: loadError, refetch } = useQuery({
    queryKey: ["lucros-data", user?.id],
    queryFn: async () => {
      const data = await fetchAll((f, t) => supabase.from("profits").select("*").eq("user_id", user!.id).order("date", { ascending: false }).range(f, t));
      return data;
    },
    enabled: !!user,
  });

  const resetForm = () => {
    setDesc(""); setAmount(""); setDate(todayLocalISO());
    setEditingId(null); setShowForm(false);
  };

  const handleEdit = (p: any) => {
    if (ehDePagamento(p)) {
      toast({
        title: "Lucro operacional protegido",
        description: "Esse valor é calculado pelo pagamento da parcela. Para corrigi-lo, estorne e registre o pagamento novamente.",
        variant: "destructive",
      });
      return;
    }
    setDesc(p.description); setAmount(String(p.amount));
    setDate(String(p.date || "").slice(0, 10));
    setEditingId(p.id); setShowForm(true);
  };

  const handleSubmit = async () => {
    if (!user || !desc.trim() || !amount || saving) return;
    const parsedAmount = parseFinancialAmount(amount);
    if (parsedAmount === null) {
      toast({ title: "Valor inválido", description: "Informe um valor maior que zero.", variant: "destructive" });
      return;
    }
    const parsedDate = parseFinancialDate(date);
    if (!parsedDate) {
      toast({ title: "Data inválida", description: "Informe uma data válida.", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const result = editingId
        ? await supabase.from("profits").update({ description: desc.trim(), amount: parsedAmount, date: parsedDate }).eq("id", editingId).eq("user_id", user.id).is("installment_id", null)
        : await supabase.from("profits").insert({ user_id: user.id, description: desc.trim(), amount: parsedAmount, date: parsedDate });
      if (result.error) {
        toast({ ...friendlyError(result.error), variant: "destructive" });
        return;
      }
      toast({ title: editingId ? "✓ Lucro atualizado!" : "✓ Lucro registrado!" });
      resetForm();
      qc.invalidateQueries({ queryKey: ["lucros-data"] });
      qc.invalidateQueries({ queryKey: ["carteira-profits"] });
    } finally {
      setSaving(false);
    }
  };

  /**
   * Lucro com `installment_id` nasceu de um pagamento registrado — ele é a
   * contrapartida contábil daquela parcela. Apagar na mão desamarra o razão: a
   * parcela continua paga e o juros dela some do resultado. O caminho certo é
   * estornar o pagamento, que remove parcela, lucro e caixa juntos.
   */
  const ehDePagamento = (p: any) => !!p?.installment_id;

  const handleDelete = async (id: string) => {
    const alvo = (profits as any[]).find((p) => p.id === id);
    if (ehDePagamento(alvo)) {
      setDeleteConfirm(null);
      toast({
        title: "Este lucro veio de um pagamento",
        description: "Para removê-lo, estorne o pagamento da parcela em Cobranças ou no cliente — assim o caixa e a parcela voltam junto.",
        variant: "destructive",
      });
      return;
    }
    if (!user) return;
    const { error } = await supabase.from("profits").delete().eq("id", id).eq("user_id", user.id);
    setDeleteConfirm(null);
    if (error) { toast({ ...friendlyError(error, "Não foi possível excluir."), variant: "destructive" }); return; }
    setSelected(prev => { const n = new Set(prev); n.delete(id); return n; });
    qc.invalidateQueries({ queryKey: ["lucros-data"] });
    toast({ title: "Lucro excluído" });
  };

  const handleBulkDelete = async () => {
    if (selected.size === 0) return;
    const todos = Array.from(selected);
    const vinculados = todos.filter((id) => ehDePagamento((profits as any[]).find((p) => p.id === id)));
    const ids = todos.filter((id) => !vinculados.includes(id));

    if (ids.length === 0) {
      setBulkDeleteOpen(false);
      toast({
        title: "Nada foi excluído",
        description: `${vinculados.length} lançamento(s) vieram de pagamentos. Estorne a parcela para removê-los.`,
        variant: "destructive",
      });
      return;
    }

    if (!user) return;
    const { error } = await supabase.from("profits").delete().in("id", ids).eq("user_id", user.id);
    setSelected(new Set());
    setBulkDeleteOpen(false);
    if (error) { toast({ ...friendlyError(error, "Não foi possível excluir."), variant: "destructive" }); return; }
    qc.invalidateQueries({ queryKey: ["lucros-data"] });
    toast({
      title: `${ids.length} lucro(s) excluído(s)`,
      description: vinculados.length
        ? `${vinculados.length} foram mantidos por virem de pagamentos.`
        : undefined,
    });
  };

  const filtered = useMemo(() => {
    const now = new Date();
    const startOfDay = new Date(now); startOfDay.setHours(0,0,0,0);
    const startOfYear = new Date(now.getFullYear(), 0, 1);
    const filterDays: Record<string, number> = { "7d": 7, "30d": 30, "90d": 90 };
    const days = filterDays[timeFilter];
    const term = debouncedSearch.toLowerCase().trim();

    const arr = profits.filter((p: any) => {
      const pd = new Date(p.date);
      if (timeFilter === "today" && pd < startOfDay) return false;
      if (timeFilter === "ytd" && pd < startOfYear) return false;
      if (days) {
        const diff = (now.getTime() - pd.getTime()) / 86400000;
        if (diff > days) return false;
      }
      if (sourceFilter === "operational" && !p.client_id) return false;
      if (sourceFilter === "manual" && p.client_id) return false;
      if (term && !p.description.toLowerCase().includes(term)) return false;
      return true;
    });

    arr.sort((a: any, b: any) => {
      switch (sortKey) {
        case "date_asc": return new Date(a.date).getTime() - new Date(b.date).getTime();
        case "amount_desc": return Number(b.amount) - Number(a.amount);
        case "amount_asc": return Number(a.amount) - Number(b.amount);
        default: return new Date(b.date).getTime() - new Date(a.date).getTime();
      }
    });
    return arr;
  }, [profits, debouncedSearch, timeFilter, sourceFilter, sortKey]);

  const handleExportCSV = () => {
    const header = "Data,Descrição,Valor,Origem\n";
    const rows = filtered.map((p: any) =>
      `${formatBR(p.date)},"${p.description.replace(/"/g, '""')}",${Number(p.amount).toFixed(2)},${p.client_id ? "Operacional" : "Manual"}`
    ).join("\n");
    const blob = new Blob([header + rows], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = `lucros_${new Date().toISOString().slice(0,10)}.csv`; a.click();
    URL.revokeObjectURL(url);
    toast({ title: "CSV exportado!" });
  };

  // KPIs
  const total = filtered.reduce((acc: number, p: any) => acc + Number(p.amount), 0);
  const totalAll = profits.reduce((acc: number, p: any) => acc + Number(p.amount), 0);

  const now = new Date();
  const startOfWeek = new Date(now); startOfWeek.setDate(now.getDate() - now.getDay()); startOfWeek.setHours(0,0,0,0);
  const weekTotal = profits.filter((p: any) => new Date(p.date) >= startOfWeek).reduce((s: number, p: any) => s + Number(p.amount), 0);

  const monthlyData = useMemo(() => {
    return Array.from({ length: 6 }, (_, i) => {
      const d = new Date(now.getFullYear(), now.getMonth() - (5 - i), 1);
      const monthStr = d.toLocaleDateString("pt-BR", { month: "short" }).replace(".", "");
      const amount = profits.filter((p: any) => {
        const pd = new Date(p.date);
        return pd.getMonth() === d.getMonth() && pd.getFullYear() === d.getFullYear();
      }).reduce((s: number, p: any) => s + Number(p.amount), 0);
      return { month: monthStr, amount };
    });

  }, [profits]);
  const maxMonthly = Math.max(...monthlyData.map(m => m.amount), 1);

  const currentMonthTotal = monthlyData[5]?.amount || 0;
  const prevMonthTotal = monthlyData[4]?.amount || 0;
  const monthlyChange = prevMonthTotal > 0
    ? ((currentMonthTotal - prevMonthTotal) / prevMonthTotal * 100).toFixed(1)
    : currentMonthTotal > 0 ? "+100" : "0";

  // Projection: based on daily pace this month
  const dayOfMonth = now.getDate();
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const projection = dayOfMonth > 0 ? (currentMonthTotal / dayOfMonth) * daysInMonth : 0;

  const avgPerEntry = profits.length > 0 ? totalAll / profits.length : 0;

  const todayTotal = profits.filter((p: any) => {
    const d = new Date(p.date);
    return d.toDateString() === new Date().toDateString();
  }).reduce((s: number, p: any) => s + Number(p.amount), 0);

  // Top descriptions
  const topDescriptions = useMemo(() => {
    const map = new Map<string, number>();
    filtered.forEach((p: any) => {
      const k = p.description.trim();
      map.set(k, (map.get(k) || 0) + Number(p.amount));
    });
    return Array.from(map.entries()).sort((a, b) => b[1] - a[1]).slice(0, 5);
  }, [filtered]);

  // Source breakdown
  const opTotal = filtered.filter((p: any) => p.client_id).reduce((s: number, p: any) => s + Number(p.amount), 0);
  const manualTotal = total - opTotal;

  const grouped = useMemo(() => filtered.reduce((acc: Record<string, any[]>, p: any) => {
    const key = formatBR(p.date);
    if (!acc[key]) acc[key] = [];
    acc[key].push(p);
    return acc;
  }, {} as Record<string, any[]>), [filtered]);

  const inputCls = "w-full px-4 py-3 rounded-2xl bg-card border border-border text-foreground placeholder:text-muted-foreground text-sm focus:ring-2 focus:ring-primary/30 focus:border-primary/50 outline-none transition-all";

  const allVisibleIds = useMemo(() => filtered.map((p: any) => p.id), [filtered]);
  const allSelected = allVisibleIds.length > 0 && allVisibleIds.every(id => selected.has(id));
  const toggleAll = () => {
    if (allSelected) setSelected(new Set());
    else setSelected(new Set(allVisibleIds));
  };
  const toggleOne = (id: string) => {
    setSelected(prev => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  };
  const selectedTotal = filtered.filter((p: any) => selected.has(p.id)).reduce((s: number, p: any) => s + Number(p.amount), 0);

  const activeFilterCount = (timeFilter !== "all" ? 1 : 0) + (sourceFilter !== "all" ? 1 : 0) + (sortKey !== "date_desc" ? 1 : 0);

  // Evita ações em massa sobre itens que deixaram de estar visíveis após uma
  // busca ou troca de filtro.
  useEffect(() => {
    setSelected(new Set());
  }, [debouncedSearch, timeFilter, sourceFilter, sortKey]);

  const bestMonth = monthlyData.reduce((best, m) => (m.amount > best.amount ? m : best), monthlyData[0] || { month: "-", amount: 0 });
  const avgMonthly = monthlyData.reduce((s, m) => s + m.amount, 0) / (monthlyData.length || 1);
  const progressToBest = bestMonth.amount > 0 ? (currentMonthTotal / bestMonth.amount) * 100 : 0;

  return (
    <div className="space-y-4 sm:space-y-5 animate-fade-in pb-24">
      {/* HERO Premium */}
      <div className="relative overflow-hidden rounded-2xl border border-border/60 bg-card/65 p-4 sm:p-6 shadow-[0_18px_50px_-40px_rgba(0,0,0,.9)] backdrop-blur-xl">
        <div className="absolute -top-24 -right-16 w-64 h-64 rounded-full bg-success/[.07] blur-3xl pointer-events-none" />

        <div className="relative flex flex-col lg:flex-row lg:items-center justify-between gap-6">
          <div className="min-w-0 flex items-start gap-3 sm:gap-4">
            <div className="hidden sm:flex w-11 h-11 rounded-xl bg-success/15 border border-success/20 items-center justify-center">
              <TrendingUp size={26} className="text-success" />
            </div>
            <div className="min-w-0">
              <p className="text-xs uppercase tracking-widest text-muted-foreground font-medium">Lucros</p>
              <h1 className="text-xl sm:text-2xl font-bold text-foreground tracking-tight">Total acumulado</h1>
              <div className="flex items-baseline gap-2 mt-1">
                <span className="max-w-full text-3xl sm:text-4xl font-bold text-success tracking-tight tabular-nums break-words">R$ {fmt(totalAll)}</span>
              </div>
              <p className="text-xs text-muted-foreground mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="flex items-center gap-1"><Sparkles size={12} className="text-success" /> {profits.length} lançamento(s)</span>
                <span className="text-border">•</span>
                <span>Média/lançamento <span className="font-semibold text-foreground">R$ {fmt(avgPerEntry)}</span></span>
                {bestMonth.amount > 0 && <><span className="text-border">•</span><span>Melhor mês <span className="font-semibold text-foreground">{bestMonth.month}</span></span></>}
              </p>
            </div>
          </div>

          <div className="grid w-full grid-cols-2 gap-2 lg:w-auto">
            {filtered.length > 0 && (
              <button onClick={handleExportCSV} className="btn-ghost justify-center">
                <Download size={14} /> CSV
              </button>
            )}
            <button onClick={() => { resetForm(); setShowForm(true); }} className="btn-premium justify-center">
              <Plus size={16} /> Novo Lucro
            </button>
          </div>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5 stagger-fade-in">
        {[
          { icon: Calendar, label: "Este Mês", value: currentMonthTotal, color: "text-success", bg: "bg-success/10", ring: "border-success/20",
            delta: prevMonthTotal > 0 ? Number(monthlyChange) : null, hint: "vs mês anterior" },
          { icon: Wallet, label: "Esta Semana", value: weekTotal, color: "text-foreground", bg: "bg-accent/50", ring: "border-border", hint: "acumulado" },
          { icon: Wallet, label: "Hoje", value: todayTotal, color: "text-foreground", bg: "bg-accent/50", ring: "border-border", hint: "registros do dia" },
          { icon: Target, label: "Projeção Mês", value: projection, color: "text-primary", bg: "bg-primary/10", ring: "border-primary/20",
            hint: `${dayOfMonth}/${daysInMonth} dias` },
          { icon: Trophy, label: "Melhor Mês", value: bestMonth.amount, color: "text-warning", bg: "bg-warning/10", ring: "border-warning/20",
            hint: bestMonth.month || "-" },
        ].map((s, idx) => (
          <div key={s.label} className={`min-w-0 rounded-xl border ${s.ring} bg-card/60 p-3 sm:p-4 hover:border-primary/30 transition-colors`} style={{ animationDelay: `${idx * 60}ms` }}>
            <div className="flex items-center justify-between mb-2">
              <div className={`w-9 h-9 rounded-xl ${s.bg} flex items-center justify-center`}>
                <s.icon size={15} className={s.color} />
              </div>
              {s.delta != null && (
                <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${s.delta >= 0 ? "bg-success/10 text-success" : "bg-destructive/10 text-destructive"}`}>
                  {s.delta >= 0 ? "+" : ""}{s.delta.toFixed(0)}%
                </span>
              )}
            </div>
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider">{s.label}</p>
            <p className={`text-base sm:text-lg font-bold mt-1 leading-tight tabular-nums break-words ${s.color}`}>R$ {fmt(s.value)}</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">{s.hint}</p>
          </div>
        ))}
      </div>

      {/* Monthly chart + Top Fontes */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <div className="lg:col-span-2 rounded-2xl border border-border bg-card p-5">
          <div className="flex items-start justify-between mb-4 gap-3 flex-wrap">
            <div>
              <p className="text-sm font-semibold text-foreground flex items-center gap-1.5">
                <BarChart3 size={14} className="text-primary" /> Evolução Mensal
              </p>
              <p className="text-[10px] text-muted-foreground mt-0.5">Últimos 6 meses • Média R$ {fmt(avgMonthly)}</p>
            </div>
            {bestMonth.amount > 0 && currentMonthTotal > 0 && (
              <div className="text-right">
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Progresso do melhor mês</p>
                <p className="text-sm font-bold text-success">{progressToBest.toFixed(0)}%</p>
              </div>
            )}
          </div>
          <div className="relative flex items-end gap-2 h-36">
            {/* linha de média */}
            {avgMonthly > 0 && maxMonthly > 0 && (
              <div
                className="absolute left-0 right-0 border-t border-dashed border-primary/30 pointer-events-none"
                style={{ bottom: `${(avgMonthly / maxMonthly) * 100}%` }}
              >
                <span className="absolute -top-4 right-0 text-[9px] text-primary/70 font-semibold">média</span>
              </div>
            )}
            {monthlyData.map((m, i) => {
              const heightPct = Math.max(4, (m.amount / maxMonthly) * 100);
              const isCurrentMonth = i === 5;
              const isBest = m.amount === bestMonth.amount && m.amount > 0;
              return (
                <div key={i} className="flex-1 flex flex-col items-center gap-1.5 group relative h-full justify-end">
                  <div className="absolute -top-8 left-1/2 -translate-x-1/2 px-2 py-1 rounded-lg bg-popover border border-border shadow-lg text-[10px] font-semibold text-foreground opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-10">
                    R$ {fmt(m.amount)}
                  </div>
                  <div className="w-full flex items-end justify-center" style={{ height: `${heightPct}%` }}>
                    <div
                      className={`w-full rounded-t-lg transition-all duration-500 cursor-pointer ${
                        isCurrentMonth
                          ? "bg-gradient-to-t from-success to-success/40 shadow-[0_0_20px_hsl(var(--success)/0.4)]"
                          : isBest
                          ? "bg-gradient-to-t from-warning/70 to-warning/30"
                          : "bg-success/20 hover:bg-success/30"
                      } h-full`}
                    />
                  </div>
                  <span className={`text-[10px] ${isCurrentMonth ? "text-foreground font-semibold" : "text-muted-foreground"}`}>
                    {m.month}{isBest && !isCurrentMonth ? " ★" : ""}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        <div className="rounded-2xl border border-border bg-card p-5">
          <p className="text-sm font-semibold text-foreground flex items-center gap-1.5 mb-3">
            <Trophy size={14} className="text-primary" /> Top Fontes
            <span className="text-[10px] text-muted-foreground font-normal ml-auto">no período</span>
          </p>
          {topDescriptions.length === 0 ? (
            <p className="text-[11px] text-muted-foreground text-center py-6">Sem dados no período</p>
          ) : (
            <div className="space-y-2.5">
              {topDescriptions.map(([name, val], i) => {
                const pct = total > 0 ? (val / total) * 100 : 0;
                const medals = ["bg-warning/20 text-warning", "bg-muted-foreground/20 text-foreground", "bg-orange-500/20 text-orange-500"];
                return (
                  <div key={name}>
                    <div className="flex items-center justify-between text-[11px] mb-1 gap-2">
                      <span className="text-foreground truncate flex-1 flex items-center gap-1.5">
                        <span className={`w-4 h-4 rounded-full text-[9px] font-bold flex items-center justify-center shrink-0 ${medals[i] || "bg-muted/40 text-muted-foreground"}`}>{i+1}</span>
                        {name}
                      </span>
                      <span className="font-semibold text-success shrink-0 tabular-nums">R$ {fmt(val)}</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-muted/40 overflow-hidden">
                      <div className="h-full bg-gradient-to-r from-success/60 to-success rounded-full" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Source split */}
      {filtered.length > 0 && (
        <div className="rounded-2xl border border-border bg-card p-4">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-xs mb-3">
            <span className="flex items-center gap-1.5 font-semibold text-foreground">
              <Sparkles size={12} className="text-primary" /> Composição do período
            </span>
            <span className="ml-auto text-muted-foreground">Média: <span className="font-semibold text-foreground">R$ {fmt(avgPerEntry)}</span></span>
          </div>
          <div className="h-2 rounded-full bg-muted overflow-hidden flex mb-2">
            <div className="h-full bg-success transition-all duration-700" style={{ width: `${total > 0 ? (opTotal/total)*100 : 0}%` }} />
            <div className="h-full bg-primary transition-all duration-700" style={{ width: `${total > 0 ? (manualTotal/total)*100 : 0}%` }} />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 sm:gap-3 text-[11px]">
            <div className="flex min-w-0 items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-success" />
              <span className="text-muted-foreground">Operacional</span>
              <span className="ml-auto font-semibold text-foreground tabular-nums">R$ {fmt(opTotal)}</span>
              <span className="text-[10px] text-muted-foreground">({total > 0 ? ((opTotal/total)*100).toFixed(0) : 0}%)</span>
            </div>
            <div className="flex min-w-0 items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-primary" />
              <span className="text-muted-foreground">Manual</span>
              <span className="ml-auto font-semibold text-foreground tabular-nums">R$ {fmt(manualTotal)}</span>
              <span className="text-[10px] text-muted-foreground">({total > 0 ? ((manualTotal/total)*100).toFixed(0) : 0}%)</span>
            </div>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input ref={searchRef} type="text" placeholder="Buscar lucros... (atalho /)" value={search} onChange={e => setSearch(e.target.value)}
            className={`${inputCls} pl-9 pr-16`} />
          {!search && <kbd className="absolute right-3 top-1/2 -translate-y-1/2 px-1.5 py-0.5 rounded border border-border bg-muted/50 text-[10px] text-muted-foreground">/</kbd>}
          {search && <button onClick={() => setSearch("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"><X size={14} /></button>}
        </div>
        <button onClick={() => setShowFilters(s => !s)} className="btn-ghost relative">
          <SlidersHorizontal size={14} /> Filtros
          {activeFilterCount > 0 && (
            <span className="ml-1 px-1.5 py-0.5 rounded-full bg-primary text-primary-foreground text-[10px] font-bold">{activeFilterCount}</span>
          )}
        </button>
      </div>

      {showFilters && (
        <div className="rounded-2xl border border-border bg-card p-4 space-y-3 animate-fade-in">
          <div>
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2 font-semibold">Período</p>
            <div className="flex flex-wrap gap-1.5">
              {([
                ["all","Todos"],["today","Hoje"],["7d","7 dias"],["30d","30 dias"],["90d","90 dias"],["ytd","Ano"]
              ] as [TimeFilter, string][]).map(([k, label]) => (
                <button key={k} onClick={() => setTimeFilter(k)}
                  className={`px-3 py-1.5 rounded-lg text-[11px] font-medium transition-colors ${
                    timeFilter === k ? "bg-primary text-primary-foreground" : "bg-muted/30 text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                  }`}>{label}</button>
              ))}
            </div>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2 font-semibold">Origem</p>
            <div className="flex flex-wrap gap-1.5">
              {([
                ["all","Todas"],["operational","Operacional"],["manual","Manual"]
              ] as [SourceFilter, string][]).map(([k, label]) => (
                <button key={k} onClick={() => setSourceFilter(k)}
                  className={`px-3 py-1.5 rounded-lg text-[11px] font-medium transition-colors ${
                    sourceFilter === k ? "bg-primary text-primary-foreground" : "bg-muted/30 text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                  }`}>{label}</button>
              ))}
            </div>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2 font-semibold flex items-center gap-1"><ArrowUpDown size={10}/> Ordenar</p>
            <div className="flex flex-wrap gap-1.5">
              {([
                ["date_desc","Mais recente"],["date_asc","Mais antigo"],["amount_desc","Maior valor"],["amount_asc","Menor valor"]
              ] as [SortKey, string][]).map(([k, label]) => (
                <button key={k} onClick={() => setSortKey(k)}
                  className={`px-3 py-1.5 rounded-lg text-[11px] font-medium transition-colors ${
                    sortKey === k ? "bg-primary text-primary-foreground" : "bg-muted/30 text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                  }`}>{label}</button>
              ))}
            </div>
          </div>
          {activeFilterCount > 0 && (
            <button onClick={() => { setTimeFilter("all"); setSourceFilter("all"); setSortKey("date_desc"); }}
              className="text-[11px] text-muted-foreground hover:text-foreground underline">Limpar filtros</button>
          )}
        </div>
      )}

      {/* Filtered total indicator */}
      {(timeFilter !== "all" || sourceFilter !== "all" || debouncedSearch) && (
        <div className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-success/5 border border-success/15">
          <TrendingUp size={14} className="text-success" />
          <span className="text-xs text-muted-foreground">Filtrado:</span>
          <span className="text-sm font-bold text-success">R$ {fmt(total)}</span>
          <span className="text-[10px] text-muted-foreground">({filtered.length} registros)</span>
        </div>
      )}

      {/* List grouped by date */}
      {loading ? (
        <div className="space-y-2">{[1,2,3].map(i => <div key={i} className="h-16 rounded-xl bg-muted/30 animate-pulse" />)}</div>
      ) : loadError ? (
        <div className="rounded-2xl border border-destructive/30 bg-destructive/5 py-14 text-center">
          <AlertTriangle className="mx-auto h-10 w-10 text-destructive" />
          <p className="mt-3 font-semibold text-foreground">Não foi possível carregar os lucros</p>
          <Button variant="outline" className="mt-4 gap-2" onClick={() => void refetch()}>
            <RefreshCw className="h-4 w-4" /> Tentar novamente
          </Button>
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-20 rounded-2xl border border-dashed border-border bg-card/50">
          <div className="w-20 h-20 mx-auto rounded-2xl bg-muted/30 flex items-center justify-center mb-5">
            <TrendingUp size={32} className="text-muted-foreground/40" />
          </div>
          <p className="text-foreground font-semibold text-lg">{debouncedSearch ? `Sem resultados para "${debouncedSearch}"` : "Nenhum lucro registrado"}</p>
          <p className="text-sm text-muted-foreground mt-2">Registre seus lucros para acompanhar a evolução financeira</p>
          {!debouncedSearch && (
            <button onClick={() => { resetForm(); setShowForm(true); }}
              className="mt-5 inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold text-primary-foreground"
              style={{ background: "var(--gradient-button)" }}>
              <Plus size={14} /> Registrar Primeiro Lucro
            </button>
          )}
        </div>
      ) : (
        <div className="rounded-2xl border border-border bg-card overflow-hidden">
          {/* Select all bar */}
          <div className="flex items-center gap-2 px-4 py-2 border-b border-border/50 bg-muted/10">
            <button onClick={toggleAll} className="flex items-center gap-2 text-[11px] text-muted-foreground hover:text-foreground">
              {allSelected ? <CheckSquare size={14} className="text-primary"/> : <Square size={14}/>}
              {allSelected ? "Desmarcar tudo" : "Selecionar tudo"}
            </button>
            <span className="text-[11px] text-muted-foreground ml-auto">{filtered.length} registro(s)</span>
          </div>
          <div className="max-h-[500px] overflow-y-auto">
            {Object.entries(grouped).map(([dateStr, items]: [string, any[]]) => (
              <div key={dateStr}>
                <div className="flex items-center gap-2 px-4 py-2.5 text-[10px] uppercase tracking-wider text-muted-foreground font-semibold sticky top-0 bg-card/95 backdrop-blur-sm z-[5] border-b border-border/50">
                  <Calendar size={10} /> {dateStr}
                  <span className="text-success font-bold ml-auto text-xs normal-case">
                    +R$ {fmt(items.reduce((s: number, p: any) => s + Number(p.amount), 0))}
                  </span>
                </div>
                <div className="divide-y divide-border/30">
                  {items.map((p: any) => {
                    const isSel = selected.has(p.id);
                    return (
                      <div key={p.id} className={`grid grid-cols-[auto_auto_minmax(0,1fr)_auto] sm:grid-cols-[auto_auto_minmax(0,1fr)_auto_auto] items-center gap-x-2.5 sm:gap-x-3 gap-y-2 px-3 sm:px-4 py-3 group transition-colors ${isSel ? "bg-primary/5" : "hover:bg-accent/20"}`}>
                        <button onClick={() => toggleOne(p.id)} className="shrink-0 text-muted-foreground hover:text-primary">
                          {isSel ? <CheckSquare size={16} className="text-primary"/> : <Square size={16}/>}
                        </button>
                        <div className="w-10 h-10 rounded-xl bg-success/10 border border-success/10 flex items-center justify-center shrink-0">
                          <ArrowUpRight size={16} className="text-success" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <p className="text-sm font-medium text-foreground truncate">{p.description}</p>
                            {p.client_id && (
                              <Badge variant="outline" className="text-[9px] px-1.5 py-0 bg-success/5 border-success/20 text-success shrink-0">Operacional</Badge>
                            )}
                          </div>
                          <p className="text-[10px] text-muted-foreground mt-0.5">
                            {formatBR(p.date, { day: "2-digit", month: "long", year: "numeric" })}
                          </p>
                        </div>
                        <span className="col-span-2 sm:col-span-1 col-start-3 sm:col-start-auto text-sm font-bold text-success whitespace-nowrap">+R$ {fmt(Number(p.amount))}</span>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <button className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent/50 sm:opacity-0 sm:group-hover:opacity-100 transition-all" aria-label={`Ações para ${p.description}`}>
                              <MoreVertical size={14} />
                            </button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-40">
                            {!ehDePagamento(p) && (
                              <>
                                <DropdownMenuItem onClick={() => handleEdit(p)} className="gap-2 text-xs">
                                  <Edit2 size={12} /> Editar
                                </DropdownMenuItem>
                                <DropdownMenuSeparator />
                              </>
                            )}
                            <DropdownMenuItem onClick={() => setDeleteConfirm(p.id)} className="gap-2 text-xs text-destructive focus:text-destructive">
                              <Trash2 size={12} /> Excluir
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Sticky bulk bar */}
      {selected.size > 0 && (
        <div className="mobile-dock fixed bottom-3 left-3 right-3 sm:left-1/2 sm:right-auto sm:-translate-x-1/2 z-30 flex flex-wrap items-center justify-center gap-2 sm:gap-3 px-3 sm:px-4 py-3 rounded-2xl bg-popover border border-border shadow-2xl animate-fade-in">
          <span className="text-xs font-semibold text-foreground">{selected.size} selecionado(s)</span>
          <span className="text-xs text-success font-bold">R$ {fmt(selectedTotal)}</span>
          <div className="h-5 w-px bg-border" />
          <button onClick={() => setSelected(new Set())} className="text-xs text-muted-foreground hover:text-foreground">Limpar</button>
          <Button variant="destructive" size="sm" onClick={() => setBulkDeleteOpen(true)} className="h-8 text-xs">
            <Trash2 size={12} className="mr-1"/> Excluir
          </Button>
        </div>
      )}

      {/* Add/Edit Dialog */}
      <Dialog open={showForm} onOpenChange={(open) => { if (!open) resetForm(); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {editingId ? <Edit2 size={18} className="text-primary" /> : <Plus size={18} className="text-success" />}
              {editingId ? "Editar Lucro" : "Novo Lucro"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Descrição</label>
              <input type="text" placeholder="Ex: Juros recebidos, Comissão..." value={desc} onChange={e => setDesc(e.target.value)} className={inputCls} />
              <div className="flex flex-wrap gap-1.5 mt-2">
                {["Juros", "Comissão", "Multa", "Taxa", "Venda"].map(tag => (
                  <button key={tag} type="button" onClick={() => setDesc(tag)}
                    className="px-2 py-1 rounded-lg text-[10px] bg-muted/40 text-muted-foreground hover:bg-primary/15 hover:text-primary transition-colors">
                    {tag}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Valor (R$)</label>
              <input type="text" inputMode="decimal" placeholder="0,00" value={amount} onChange={e => setAmount(e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Data</label>
              <input type="date" value={date} onChange={e => setDate(e.target.value)} className={inputCls} />
            </div>
          </div>
          <DialogFooter className="mt-4">
            <Button variant="outline" onClick={resetForm}>Cancelar</Button>
            <Button disabled={saving || !desc.trim() || !amount} onClick={handleSubmit}
              className="bg-success text-success-foreground hover:bg-success/90">
              {saving ? "Salvando..." : editingId ? "Atualizar" : "Registrar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <Dialog open={!!deleteConfirm} onOpenChange={(open) => { if (!open) setDeleteConfirm(null); }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-destructive flex items-center gap-2">
              <Trash2 size={18} /> Excluir Lucro?
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">Esta ação não pode ser desfeita.</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteConfirm(null)}>Cancelar</Button>
            <Button variant="destructive" onClick={() => deleteConfirm && handleDelete(deleteConfirm)}>Excluir</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bulk Delete */}
      <Dialog open={bulkDeleteOpen} onOpenChange={setBulkDeleteOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-destructive flex items-center gap-2">
              <Trash2 size={18} /> Excluir {selected.size} lucro(s)?
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">Total: <span className="font-bold text-success">R$ {fmt(selectedTotal)}</span>. Esta ação não pode ser desfeita.</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBulkDeleteOpen(false)}>Cancelar</Button>
            <Button variant="destructive" onClick={handleBulkDelete}>Excluir Todos</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Lucros;
