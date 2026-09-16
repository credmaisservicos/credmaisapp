import { useState, useMemo } from "react";
import { DollarSign, Plus, X, ArrowDownRight, Search, Calendar, Tag, PieChart, Edit2, Download, Trash2, MoreVertical, BarChart3, TrendingDown, Receipt } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { fetchAll } from "@/lib/fetchAll";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { friendlyError } from "@/lib/friendlyError";
import { SkeletonList } from "@/components/feedback/Skeletons";
import { Loader2 } from "lucide-react";

import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter
} from "@/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
import { formatBR, parseLocalDate, todayLocalISO } from "@/lib/dateUtils";
import { Button } from "@/components/ui/button";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMultiTableRealtime } from "@/hooks/useRealtimeSubscription";
import EmptyState from "@/components/EmptyState";
import ErrorState from "@/components/feedback/ErrorState";
import { parseFinancialAmount, parseFinancialDate } from "@/lib/financialEntry";

const safeNumber = (value: unknown) => {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
};
const fmt = (v: number) => safeNumber(v).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const CATEGORY_COLORS: Record<string, string> = {
  "Operacional": "bg-blue-500/10 text-blue-500 border-blue-500/20",
  "Pessoal": "bg-purple-500/10 text-purple-500 border-purple-500/20",
  "Transporte": "bg-amber-500/10 text-amber-600 border-amber-500/20",
  "Alimentação": "bg-orange-500/10 text-orange-500 border-orange-500/20",
  "Marketing": "bg-pink-500/10 text-pink-500 border-pink-500/20",
  "Equipamentos": "bg-cyan-500/10 text-cyan-500 border-cyan-500/20",
  "Impostos": "bg-red-500/10 text-red-500 border-red-500/20",
  "Outros": "bg-muted text-muted-foreground border-border",
};

const getCategoryStyle = (cat: string) =>
  CATEGORY_COLORS[cat] || "bg-accent/30 text-foreground border-border";

const SUGGESTED_CATEGORIES = ["Operacional", "Pessoal", "Transporte", "Alimentação", "Marketing", "Equipamentos", "Impostos", "Outros"];

const Gastos = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [desc, setDesc] = useState("");
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState("");
  const [date, setDate] = useState(todayLocalISO());
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");
  const [catFilter, setCatFilter] = useState("all");
  const [timeFilter, setTimeFilter] = useState<"all" | "7d" | "30d" | "90d">("all");
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  useMultiTableRealtime(
    ["expenses"],
    [["gastos-data", user?.id || ""]],
  );

  const { data: expenses = [], isLoading: loading, error: loadError, refetch } = useQuery({
    queryKey: ["gastos-data", user?.id],
    queryFn: async () => {
      const data = await fetchAll((f, t) => supabase.from("expenses").select("*").eq("user_id", user!.id).order("date", { ascending: false }).range(f, t));
      return data;
    },
    enabled: !!user,
  });

  const resetForm = () => {
    setDesc(""); setAmount(""); setCategory(""); setDate(todayLocalISO());
    setEditingId(null); setShowForm(false);
  };

  const handleEdit = (e: any) => {
    setDesc(e.description); setAmount(String(e.amount));
    setCategory(e.category || ""); setDate(String(e.date || "").slice(0, 10));
    setEditingId(e.id); setShowForm(true);
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

    const payload = {
      description: desc.trim(), amount: parsedAmount,
      date: parsedDate, category: category.trim() || null,
    };
    try {
      const result = editingId
        ? await supabase.from("expenses").update(payload).eq("id", editingId).eq("user_id", user.id)
        : await supabase.from("expenses").insert({ ...payload, user_id: user.id });
      if (result.error) {
        toast({ ...friendlyError(result.error), variant: "destructive" });
        return;
      }
      toast({ title: editingId ? "✓ Gasto atualizado!" : "✓ Gasto registrado!" });
      resetForm();
      qc.invalidateQueries({ queryKey: ["gastos-data"] });
      qc.invalidateQueries({ queryKey: ["carteira-expenses"] });
      qc.invalidateQueries({ queryKey: ["dashboard-data"] });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!user) return;
    // Confere o erro: antes avisava "Gasto excluído" mesmo quando a exclusão
    // falhava, e o valor continuava descontando do saldo da carteira.
    const { error } = await supabase.from("expenses").delete().eq("id", id).eq("user_id", user.id);
    setDeleteConfirm(null);
    if (error) { toast({ ...friendlyError(error, "Não foi possível excluir o gasto."), variant: "destructive" }); return; }
    qc.invalidateQueries({ queryKey: ["gastos-data"] });
    qc.invalidateQueries({ queryKey: ["carteira-expenses"] });
    toast({ title: "Gasto excluído" });
  };

  const handleExportCSV = () => {
    const header = "Data,Descrição,Categoria,Valor\n";
    const rows = filtered.map((e: any) =>
      `${formatBR(e.date) || "data indisponível"},"${String(e.description || "").replace(/"/g, '""')}","${String(e.category || "").replace(/"/g, '""')}",${safeNumber(e.amount).toFixed(2)}`
    ).join("\n");
    const blob = new Blob([header + rows], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = `gastos_${todayLocalISO()}.csv`; a.click();
    URL.revokeObjectURL(url);
    toast({ title: "CSV exportado!" });
  };

  const categories = useMemo(() => [...new Set(expenses.map((e: any) => e.category || "Sem categoria"))], [expenses]);

  const filtered = useMemo(() => {
    const now = new Date();
    const filterDays: Record<string, number> = { "7d": 7, "30d": 30, "90d": 90 };
    const days = filterDays[timeFilter];
    return expenses.filter((e: any) => {
      if (days) {
        const dateValue = parseLocalDate(e.date);
        if (!dateValue) return false;
        const diff = (now.getTime() - dateValue.getTime()) / 86400000;
        if (diff > days) return false;
      }
      if (catFilter !== "all" && (e.category || "Sem categoria") !== catFilter) return false;
      if (search && !(e.description || "").toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });
  }, [expenses, search, catFilter, timeFilter]);

  const totalFiltered = filtered.reduce((acc: number, e: any) => acc + safeNumber(e.amount), 0);
  const totalAll = expenses.reduce((acc: number, e: any) => acc + safeNumber(e.amount), 0);

  const catBreakdown = useMemo(() => {
    const map = new Map<string, number>();
    expenses.forEach((e: any) => {
      const cat = e.category || "Sem categoria";
      map.set(cat, (map.get(cat) || 0) + safeNumber(e.amount));
    });
    return Array.from(map.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([cat, total]) => ({ cat, total, pct: totalAll > 0 ? (total / totalAll) * 100 : 0 }));
  }, [expenses, totalAll]);

  const monthlyData = useMemo(() => {
    const now = new Date();
    return Array.from({ length: 6 }, (_, i) => {
      const d = new Date(now.getFullYear(), now.getMonth() - (5 - i), 1);
      const monthStr = d.toLocaleDateString("pt-BR", { month: "short" }).replace(".", "");
      const amount = expenses.filter((e: any) => {
        const ed = parseLocalDate(e.date);
        return !!ed && ed.getMonth() === d.getMonth() && ed.getFullYear() === d.getFullYear();
      }).reduce((s: number, e: any) => s + safeNumber(e.amount), 0);
      return { month: monthStr, amount };
    });
  }, [expenses]);
  const maxMonthly = Math.max(...monthlyData.map(m => m.amount), 1);

  const currentMonthTotal = monthlyData[5]?.amount || 0;
  const prevMonthTotal = monthlyData[4]?.amount || 0;
  const monthlyChange = prevMonthTotal > 0
    ? ((currentMonthTotal - prevMonthTotal) / prevMonthTotal * 100).toFixed(1)
    : currentMonthTotal > 0 ? "+100" : "0";

  const todayTotal = expenses.filter((e: any) => {
    const d = parseLocalDate(e.date);
    const today = parseLocalDate(todayLocalISO());
    return !!d && !!today && d.toDateString() === today.toDateString();
  }).reduce((s: number, e: any) => s + safeNumber(e.amount), 0);

  const grouped = filtered.reduce((acc: Record<string, any[]>, e: any) => {
    const key = formatBR(e.date);
    if (!acc[key]) acc[key] = [];
    acc[key].push(e);
    return acc;
  }, {} as Record<string, any[]>);

  const inputCls = "w-full px-4 py-3 rounded-2xl bg-card border border-border text-foreground placeholder:text-muted-foreground text-sm focus:ring-2 focus:ring-primary/30 focus:border-primary/50 outline-none transition-all";

  return (
    <div className="space-y-4 sm:space-y-5 animate-fade-in">
      <div className="relative overflow-hidden rounded-2xl border border-border/60 bg-card/65 p-4 sm:p-6 shadow-[0_18px_50px_-40px_rgba(0,0,0,.9)] backdrop-blur-xl">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex min-w-0 items-start gap-3">
            <div className="hidden sm:flex w-11 h-11 rounded-xl bg-destructive/15 items-center justify-center border border-destructive/20">
              <TrendingDown size={22} className="text-destructive" />
            </div>
            <div className="min-w-0">
              <h1 className="text-xl sm:text-2xl font-bold text-foreground tracking-tight">Gastos</h1>
              <p className="text-muted-foreground text-sm mt-1">Controle suas despesas por categoria</p>
            </div>
          </div>
          <div className="grid w-full grid-cols-2 gap-2 sm:w-auto">
            {filtered.length > 0 && (
            <button type="button" onClick={handleExportCSV} className="btn-ghost justify-center">
                <Download size={14} /> CSV
              </button>
            )}
            <button type="button" onClick={() => { resetForm(); setShowForm(true); }} className="btn-premium justify-center">
              <Plus size={16} /> Novo Gasto
            </button>
          </div>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
        <div className="min-w-0 rounded-xl border border-border bg-card/60 p-3 sm:p-4">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-8 h-8 rounded-lg bg-destructive/10 flex items-center justify-center">
              <TrendingDown size={14} className="text-destructive" />
            </div>
          </div>
          <p className="text-base sm:text-lg font-bold leading-tight text-destructive tabular-nums break-words">R$ {fmt(totalAll)}</p>
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider mt-0.5">Total Geral</p>
        </div>
        <div className="min-w-0 rounded-xl border border-border bg-card/60 p-3 sm:p-4">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
              <Calendar size={14} className="text-primary" />
            </div>
          </div>
          <p className="text-base sm:text-lg font-bold leading-tight text-foreground tabular-nums break-words">R$ {fmt(currentMonthTotal)}</p>
          <div className="flex items-center gap-1.5 mt-0.5">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Este Mês</p>
            {prevMonthTotal > 0 && (
              <Badge variant="outline" className={`text-[9px] px-1 py-0 ${
                Number(monthlyChange) <= 0 ? "text-success bg-success/10 border-success/20" : "text-destructive bg-destructive/10 border-destructive/20"
              }`}>
                {Number(monthlyChange) >= 0 ? "+" : ""}{monthlyChange}%
              </Badge>
            )}
          </div>
        </div>
        <div className="min-w-0 rounded-xl border border-border bg-card/60 p-3 sm:p-4">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-8 h-8 rounded-lg bg-accent/50 flex items-center justify-center">
              <Receipt size={14} className="text-foreground" />
            </div>
          </div>
          <p className="text-base sm:text-lg font-bold leading-tight text-foreground tabular-nums break-words">R$ {fmt(todayTotal)}</p>
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider mt-0.5">Hoje</p>
        </div>
        <div className="min-w-0 rounded-xl border border-border bg-card/60 p-3 sm:p-4">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-8 h-8 rounded-lg bg-accent/50 flex items-center justify-center">
              <Tag size={14} className="text-foreground" />
            </div>
          </div>
          <p className="text-xl font-bold text-foreground">{categories.length}</p>
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider mt-0.5">Categorias</p>
        </div>
      </div>

      {/* Monthly Chart + Category Breakdown */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="rounded-2xl border border-border bg-card p-5">
          <div className="flex items-center justify-between mb-4">
            <p className="text-xs font-semibold text-foreground flex items-center gap-1.5">
              <BarChart3 size={13} className="text-primary" /> Evolução Mensal
            </p>
            <p className="text-[10px] text-muted-foreground">Últimos 6 meses</p>
          </div>
          <div className="flex items-end gap-2 h-24">
            {monthlyData.map((m, i) => {
              const heightPct = Math.max(4, (m.amount / maxMonthly) * 100);
              const isCurrentMonth = i === 5;
              return (
                <div key={i} className="flex-1 flex flex-col items-center gap-1.5 group relative">
                  <div className="absolute -top-8 left-1/2 -translate-x-1/2 px-2 py-1 rounded-lg bg-popover border border-border shadow-lg text-[10px] font-semibold text-foreground opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-10">
                    R$ {fmt(m.amount)}
                  </div>
                  <div
                    className={`w-full rounded-lg transition-all duration-500 cursor-pointer ${
                      isCurrentMonth
                        ? "bg-gradient-to-t from-destructive/80 to-destructive/40"
                        : "bg-destructive/20 hover:bg-destructive/30"
                    }`}
                    style={{ height: `${heightPct}%` }}
                  />
                  <span className={`text-[10px] ${isCurrentMonth ? "text-foreground font-semibold" : "text-muted-foreground"}`}>
                    {m.month}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        <div className="rounded-2xl border border-border bg-card p-5">
          <div className="flex items-center gap-2 mb-4">
            <PieChart size={13} className="text-primary" />
            <p className="text-xs font-semibold text-foreground">Por Categoria</p>
          </div>
          <div className="space-y-2.5">
            {catBreakdown.slice(0, 5).map(({ cat, total, pct }) => (
              <button
                key={cat}
                onClick={() => setCatFilter(catFilter === cat ? "all" : cat)}
                className={`w-full text-left transition-all rounded-lg p-1.5 -mx-1.5 ${
                  catFilter === cat ? "ring-1 ring-primary/30 bg-primary/5" : "hover:bg-accent/20"
                }`}
              >
                <div className="flex items-center justify-between text-xs mb-1">
                  <span className="font-medium text-foreground truncate mr-2 flex items-center gap-1.5">
                    <span className={`inline-block w-2 h-2 rounded-full ${getCategoryStyle(cat).split(" ")[0]?.replace("/10", "/60").replace("/30", "/60")}`} />
                    {cat}
                  </span>
                  <span className="text-muted-foreground shrink-0">R$ {fmt(total)} · {pct.toFixed(0)}%</span>
                </div>
                <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                  <div className="h-full rounded-full bg-destructive/50 transition-all duration-500" style={{ width: `${pct}%` }} />
                </div>
              </button>
            ))}
            {catBreakdown.length === 0 && (
              <p className="text-xs text-muted-foreground text-center py-4">Nenhuma categoria registrada</p>
            )}
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input id="expenses-search" name="expenses_search" aria-label="Buscar gastos" type="text" placeholder="Buscar gastos..." value={search} onChange={e => setSearch(e.target.value)}
            className={`${inputCls} pl-9`} />
          {search && <button type="button" aria-label="Limpar busca de gastos" onClick={() => setSearch("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"><X size={14} /></button>}
        </div>
        <div className="flex rounded-xl border border-border bg-card overflow-hidden">
          {(["all", "7d", "30d", "90d"] as const).map(f => (
              <button type="button" key={f} onClick={() => setTimeFilter(f)}
              className={`px-4 py-2.5 text-xs font-medium transition-colors ${
                timeFilter === f
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground hover:bg-accent/50"
              }`}>
              {f === "all" ? "Todos" : f}
            </button>
          ))}
        </div>
      </div>

      {/* Active category filter */}
      {catFilter !== "all" && (
        <div className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-destructive/5 border border-destructive/15">
          <Tag size={12} className="text-destructive" />
          <span className="text-xs text-muted-foreground">Categoria:</span>
          <Badge variant="outline" className={`text-[10px] ${getCategoryStyle(catFilter)}`}>{catFilter}</Badge>
          <span className="text-sm font-bold text-destructive ml-auto">R$ {fmt(totalFiltered)}</span>
          <button type="button" onClick={() => setCatFilter("all")} className="p-1 rounded-lg hover:bg-accent text-muted-foreground hover:text-foreground">
            <X size={12} />
          </button>
        </div>
      )}

      {/* Filtered total (time only) */}
      {timeFilter !== "all" && catFilter === "all" && (
        <div className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-destructive/5 border border-destructive/15">
          <TrendingDown size={14} className="text-destructive" />
          <span className="text-xs text-muted-foreground">Período filtrado:</span>
          <span className="text-sm font-bold text-destructive">R$ {fmt(totalFiltered)}</span>
          <span className="text-[10px] text-muted-foreground">({filtered.length} registros)</span>
        </div>
      )}

      {/* List grouped by date */}
      {loading ? (
        <SkeletonList rows={5} height="h-16" />
      ) : loadError ? (
        <ErrorState
          title="Não foi possível carregar os gastos"
          description="Confira sua conexão e tente novamente."
          onRetry={() => void refetch()}
        />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={TrendingDown}
          title={search ? `Sem resultados para "${search}"` : "Nenhum gasto registrado"}
          description={search ? "Tente outro termo de busca." : "Registre seus gastos para controlar despesas."}
          action={!search ? (
            <button type="button" onClick={() => { resetForm(); setShowForm(true); }}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold text-primary-foreground"
              style={{ background: "var(--gradient-button)" }}>
              <Plus size={14} /> Registrar Primeiro Gasto
            </button>
          ) : undefined}
        />
      ) : (
        <div className="rounded-2xl border border-border bg-card overflow-hidden">
          <div className="max-h-[500px] overflow-y-auto">
            {Object.entries(grouped).map(([dateStr, items]: [string, any[]]) => (
              <div key={dateStr}>
                <div className="flex items-center gap-2 px-4 py-2.5 text-[10px] uppercase tracking-wider text-muted-foreground font-semibold sticky top-0 bg-card/95 backdrop-blur-sm z-[5] border-b border-border/50">
                  <Calendar size={10} /> {dateStr}
                  <span className="text-destructive font-bold ml-auto text-xs normal-case">
                    −R$ {fmt(items.reduce((s: number, e: any) => s + safeNumber(e.amount), 0))}
                  </span>
                </div>
                <div className="divide-y divide-border/30">
                  {items.map((e: any) => (
                    <div key={e.id} className="grid grid-cols-[auto_minmax(0,1fr)_auto] sm:grid-cols-[auto_minmax(0,1fr)_auto_auto] items-center gap-x-2.5 sm:gap-x-3 gap-y-2 px-3 sm:px-4 py-3 group hover:bg-accent/20 transition-colors">
                      <div className="w-10 h-10 rounded-xl bg-destructive/10 border border-destructive/10 flex items-center justify-center shrink-0">
                        <ArrowDownRight size={16} className="text-destructive" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-foreground truncate">{e.description}</p>
                        <div className="flex items-center gap-2 mt-0.5">
                          <p className="text-[10px] text-muted-foreground">
                            {formatBR(e.date, { day: "2-digit", month: "long", year: "numeric" })}
                          </p>
                          {e.category && (
                            <Badge variant="outline" className={`text-[9px] px-1.5 py-0 ${getCategoryStyle(e.category)}`}>
                              {e.category}
                            </Badge>
                          )}
                        </div>
                      </div>
                      <span className="col-span-2 sm:col-span-1 col-start-2 sm:col-start-auto text-sm font-bold text-destructive whitespace-nowrap">−R$ {fmt(e.amount)}</span>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button type="button" className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent/50 sm:opacity-0 sm:group-hover:opacity-100 transition-all" aria-label={`Ações para ${e.description || "gasto"}`}>
                            <MoreVertical size={14} />
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-40">
                          <DropdownMenuItem onClick={() => handleEdit(e)} className="gap-2 text-xs">
                            <Edit2 size={12} /> Editar
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem onClick={() => setDeleteConfirm(e.id)} className="gap-2 text-xs text-destructive focus:text-destructive">
                            <Trash2 size={12} /> Excluir
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Add/Edit Dialog */}
      <Dialog open={showForm} onOpenChange={(open) => { if (!open) resetForm(); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {editingId ? <Edit2 size={18} className="text-primary" /> : <Plus size={18} className="text-destructive" />}
              {editingId ? "Editar Gasto" : "Novo Gasto"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div>
              <label htmlFor="expense-description" className="text-xs font-medium text-muted-foreground mb-1.5 block">Descrição</label>
              <input id="expense-description" name="expense_description" type="text" placeholder="Ex: Aluguel, Gasolina..." value={desc} onChange={e => setDesc(e.target.value)} className={inputCls} />
            </div>
            <div>
              <label htmlFor="expense-amount" className="text-xs font-medium text-muted-foreground mb-1.5 block">Valor (R$)</label>
              <input id="expense-amount" name="expense_amount" type="text" inputMode="decimal" placeholder="0,00" value={amount} onChange={e => setAmount(e.target.value)} className={inputCls} />
            </div>
            <div>
              <label htmlFor="expense-category" className="text-xs font-medium text-muted-foreground mb-1.5 block">Categoria</label>
              <input id="expense-category" name="expense_category" type="text" placeholder="Ex: Operacional" value={category} onChange={e => setCategory(e.target.value)} className={inputCls} />
              <div className="flex flex-wrap gap-1.5 mt-2">
                {SUGGESTED_CATEGORIES.map(c => (
                  <button key={c} type="button" onClick={() => setCategory(c)}
                    className={`text-[10px] px-2 py-1 rounded-full border transition-colors ${
                      category === c ? "bg-primary text-primary-foreground border-primary" : "bg-card border-border text-muted-foreground hover:bg-accent"
                    }`}>
                    {c}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label htmlFor="expense-date" className="text-xs font-medium text-muted-foreground mb-1.5 block">Data</label>
              <input id="expense-date" name="expense_date" type="date" value={date} onChange={e => setDate(e.target.value)} className={inputCls} />
            </div>
          </div>
          <DialogFooter className="mt-4">
            <Button variant="outline" onClick={resetForm}>Cancelar</Button>
            <Button disabled={saving || !desc.trim() || !amount} onClick={handleSubmit} aria-busy={saving}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90 gap-2">
              {saving && <Loader2 size={15} className="animate-spin" />}
              {saving ? "Salvando…" : editingId ? "Atualizar" : "Registrar"}
            </Button>

          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <Dialog open={!!deleteConfirm} onOpenChange={(open) => { if (!open) setDeleteConfirm(null); }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-destructive flex items-center gap-2">
              <Trash2 size={18} /> Excluir Gasto?
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">Esta ação não pode ser desfeita.</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteConfirm(null)}>Cancelar</Button>
            <Button variant="destructive" onClick={() => deleteConfirm && handleDelete(deleteConfirm)}>Excluir</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Gastos;
