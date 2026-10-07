import { useState, useEffect } from "react";
import { Target, Plus, X, TrendingUp, Trophy, Minus, DollarSign, Calendar, Edit } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { useConfirm } from "@/components/ConfirmProvider";
import { friendlyError } from "@/lib/friendlyError";
import { SkeletonCards } from "@/components/feedback/Skeletons";
import LoadingButton from "@/components/feedback/LoadingButton";
import ErrorState from "@/components/feedback/ErrorState";
import { parseFinancialAmount, parseFinancialDelta } from "@/lib/financialEntry";
import { useQueryClient } from "@tanstack/react-query";


const Metas = () => {
  const confirm = useConfirm();
  const { user } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [goals, setGoals] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [desc, setDesc] = useState("");
  const [target, setTarget] = useState("");
  const [frequency, setFrequency] = useState("Mensal");
  const [saving, setSaving] = useState(false);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [incrementId, setIncrementId] = useState<string | null>(null);
  const [incrementVal, setIncrementVal] = useState("");
  const frequencyValues: Record<string, string> = {
    Diária: "daily",
    Semanal: "weekly",
    Mensal: "monthly",
    Anual: "yearly",
  };
  const frequencyLabels: Record<string, string> = Object.fromEntries(
    Object.entries(frequencyValues).map(([label, value]) => [value, label]),
  );

  const fetchGoals = async () => {
    if (!user) return;
    setLoadError(null);
    // Escopo explícito por dono, além da RLS (ver Anotacoes.tsx).
    const { data, error } = await supabase.from("goals").select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });
    if (error) setLoadError(error.message);
    else setGoals(data || []);
    setLoading(false);
  };

  useEffect(() => {
    if (!user) return;
    fetchGoals();
    const ch = supabase
      .channel("realtime-goals")
      .on("postgres_changes" as any, { event: "*", schema: "public", table: "goals", filter: `user_id=eq.${user.id}` }, () => fetchGoals())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [user]);

  const safeNumber = (value: unknown) => {
    const number = Number(value);
    return Number.isFinite(number) ? number : 0;
  };
  const fmt = (v: number) => safeNumber(v).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const inputCls = "w-full px-4 py-3 rounded-2xl bg-card border border-border text-foreground placeholder:text-muted-foreground text-sm input-enhanced";

  const handleAdd = async () => {
    if (!user || !desc.trim() || !target || saving) return;
    const parsedTarget = parseFinancialAmount(target);
    if (parsedTarget === null) {
      toast({ title: "Valor inválido", description: "Informe um alvo maior que zero.", variant: "destructive" });
      return;
    }
    setSaving(true);
    const { error } = await supabase.from("goals").insert({
      user_id: user.id, description: desc.trim(), target_amount: parsedTarget,
      frequency: frequencyValues[frequency] || frequency,
    });
    setSaving(false);
    if (error) toast({ ...friendlyError(error), variant: "destructive" });
    else {
      toast({ title: "✓ Meta criada!" }); setDesc(""); setTarget(""); setFrequency("Mensal"); setShowForm(false);
      qc.invalidateQueries({ queryKey: ["dashboard-data"] });
      fetchGoals();
    }
  };

  const handleIncrement = async (id: string, currentAmount: number, rawValue = incrementVal) => {
    if (!user || updatingId) return;
    const val = parseFinancialDelta(rawValue);
    if (val === null) {
      toast({ title: "Valor inválido", description: "Informe um valor diferente de zero.", variant: "destructive" });
      return;
    }
    setUpdatingId(id);
    let { error } = await supabase.rpc("increment_goal_amount", { _goal_id: id, _delta: val });

    // Compatibilidade durante a aplicação gradual da migração: a comparação
    // com o valor lido impede sobrescrever uma atualização concorrente.
    if (error?.code === "PGRST202" || error?.code === "42883") {
      const newAmount = Math.max(0, currentAmount + val);
      const fallback = await supabase.from("goals").update({ current_amount: newAmount })
        .eq("id", id).eq("user_id", user.id).eq("current_amount", currentAmount)
        .select("id").maybeSingle();
      error = fallback.error;
      if (!error && !fallback.data) {
        setUpdatingId(null);
        await fetchGoals();
        toast({ title: "A meta mudou em outro lugar", description: "O valor foi recarregado. Tente novamente.", variant: "destructive" });
        return;
      }
    }
    setUpdatingId(null);
    if (error) return toast({ ...friendlyError(error, "Não foi possível atualizar a meta."), variant: "destructive" });
    toast({ title: val > 0 ? `+R$ ${fmt(val)} adicionado!` : `R$ ${fmt(Math.abs(val))} removido` });
    setIncrementId(null); setIncrementVal("");
    qc.invalidateQueries({ queryKey: ["dashboard-data"] });
    fetchGoals();
  };

  const handleDelete = async (id: string) => {
    if (!user) return;
    if (!(await confirm("Excluir esta meta?"))) return;
    const { error } = await supabase.from("goals").delete().eq("id", id).eq("user_id", user.id);
    if (error) return toast({ ...friendlyError(error, "Não foi possível excluir a meta."), variant: "destructive" });
    toast({ title: "Meta removida" });
    qc.invalidateQueries({ queryKey: ["dashboard-data"] });
    fetchGoals();
  };

  const totalTarget = goals.reduce((s, g) => s + safeNumber(g.target_amount), 0);
  const totalCurrent = goals.reduce((s, g) => s + safeNumber(g.current_amount), 0);
  const overallPct = totalTarget > 0 ? Math.min((totalCurrent / totalTarget) * 100, 100) : 0;
  const completedGoals = goals.filter(g => safeNumber(g.current_amount) >= safeNumber(g.target_amount) && safeNumber(g.target_amount) > 0).length;

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="page-hero">
        <div className="page-hero-content flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="page-hero-icon">
              <Target size={22} />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-shimmer">Metas</h1>
              <p className="text-muted-foreground text-sm mt-0.5">Defina e acompanhe suas metas financeiras</p>
            </div>
          </div>
          <button type="button" onClick={() => setShowForm(!showForm)} className="btn-premium w-full sm:w-auto justify-center">
            <Plus size={16} /> Nova Meta
          </button>
        </div>
      </div>

      {/* Stats */}
      {goals.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 stagger-fade-in">
          <div className="rounded-2xl border border-border bg-card p-4 card-shine">
            <Trophy size={14} className="text-primary mb-1" />
            <p className="text-2xl font-bold text-foreground">{goals.length}</p>
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Total</p>
          </div>
          <div className="rounded-2xl border border-border bg-card p-4 card-shine">
            <Target size={14} className="text-success mb-1" />
            <p className="text-2xl font-bold text-success">{completedGoals}</p>
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Atingidas</p>
          </div>
          <div className="rounded-2xl border border-border bg-card p-4 card-shine">
            <DollarSign size={14} className="text-primary mb-1" />
            <p className="text-lg font-bold text-foreground">R$ {fmt(totalCurrent)}</p>
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Atual</p>
          </div>
          <div className="rounded-2xl border border-border bg-card p-4 card-shine">
            <TrendingUp size={14} className="text-primary mb-1" />
            <p className="text-lg font-bold text-primary">{overallPct.toFixed(0)}%</p>
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Progresso</p>
          </div>
        </div>
      )}

      {/* Overall Progress */}
      {goals.length > 0 && (
        <div className="rounded-2xl border border-border bg-card p-5">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Trophy size={18} className="text-primary" />
              <span className="font-semibold text-foreground text-sm">Progresso Geral</span>
            </div>
            <span className="text-sm font-bold text-primary">{overallPct.toFixed(0)}%</span>
          </div>
          <div className="h-3 rounded-full bg-muted overflow-hidden">
            <div className="h-full rounded-full transition-all duration-700" style={{ width: `${overallPct}%`, background: overallPct >= 100 ? "hsl(var(--success))" : "var(--gradient-gold)" }} />
          </div>
          <p className="text-xs text-muted-foreground mt-2">R$ {fmt(totalCurrent)} de R$ {fmt(totalTarget)}</p>
        </div>
      )}

      {showForm && (
        <div className="rounded-2xl border border-border bg-card p-6 space-y-4 animate-scale-in">
          <div>
            <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5 block">Descrição da Meta</label>
            <input type="text" name="goal_description" aria-label="Descrição da meta" value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Ex: Lucrar R$ 10.000 este mês" className={inputCls} />
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5 block">Valor Alvo (R$)</label>
              <input type="text" name="goal_target" aria-label="Valor alvo da meta" inputMode="decimal" value={target} onChange={(e) => setTarget(e.target.value)} placeholder="10.000,00" className={inputCls} />
            </div>
            <div>
              <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5 block">Frequência</label>
              <select name="goal_frequency" aria-label="Frequência da meta" value={frequency} onChange={(e) => setFrequency(e.target.value)} className={inputCls}>
                <option value="Diária">Diária</option>
                <option value="Semanal">Semanal</option>
                <option value="Mensal">Mensal</option>
                <option value="Anual">Anual</option>
              </select>
            </div>
          </div>
          <div className="flex gap-2">
            <LoadingButton onClick={handleAdd} loading={saving} loadingText="Salvando…">Criar Meta</LoadingButton>
            <button type="button" onClick={() => setShowForm(false)} className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors">Cancelar</button>
          </div>
        </div>
      )}

      {loading ? (
        <SkeletonCards count={4} height="h-40" className="grid grid-cols-1 sm:grid-cols-2 gap-4" />
      ) : loadError ? (
        <ErrorState title="Não foi possível carregar as metas" description={loadError} onRetry={() => void fetchGoals()} />
      ) : goals.length === 0 ? (
        <div className="text-center py-16">
          <div className="w-16 h-16 mx-auto rounded-2xl bg-muted/30 flex items-center justify-center mb-4">
            <Target size={28} className="text-muted-foreground/40" />
          </div>
          <p className="text-foreground font-medium">Nenhuma meta definida</p>
          <p className="text-sm text-muted-foreground mt-1">Crie uma meta e acompanhe seu progresso</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 stagger-fade-in">
          {goals.map((g) => {
            const targetAmount = safeNumber(g.target_amount);
            const currentAmount = safeNumber(g.current_amount);
            const pct = targetAmount > 0 ? Math.min(Math.max((currentAmount / targetAmount) * 100, 0), 100) : 0;
            const isComplete = pct >= 100;
            return (
              <div key={g.id} className={`rounded-2xl border bg-card p-5 relative group card-hover ${isComplete ? "border-success/30" : "border-border"}`}>
                <button type="button" onClick={() => handleDelete(g.id)} disabled={updatingId === g.id}
                  aria-label={`Excluir meta ${g.description}`}
                  className="absolute right-3 top-3 rounded-lg p-1.5 text-muted-foreground transition-all hover:bg-destructive/10 hover:text-destructive disabled:opacity-50 sm:opacity-0 sm:group-hover:opacity-100 sm:focus:opacity-100">
                  <X size={14} />
                </button>
                <div className="flex items-start gap-3 mb-3">
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${isComplete ? "bg-success/10" : "bg-primary/8"}`}>
                    {isComplete ? <Trophy size={18} className="text-success" /> : <Target size={18} className="text-primary" />}
                  </div>
                  <div>
                    <h3 className="font-semibold text-foreground">{g.description}</h3>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-xs text-muted-foreground">{frequencyLabels[g.frequency] || g.frequency}</span>
                      {isComplete && <span className="text-[9px] font-bold text-success bg-success/10 px-1.5 py-0.5 rounded">✓ ATINGIDA</span>}
                    </div>
                  </div>
                </div>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="text-xs text-muted-foreground">R$ {fmt(Number(g.current_amount))} / R$ {fmt(Number(g.target_amount))}</p>
                    <span className={`text-xs font-bold ${isComplete ? "text-success" : "text-primary"}`}>{pct.toFixed(0)}%</span>
                  </div>
                  <div className="h-2.5 rounded-full bg-muted overflow-hidden">
                    <div className="h-full rounded-full transition-all duration-500" style={{ width: `${pct}%`, background: isComplete ? "hsl(var(--success))" : "var(--gradient-gold)" }} />
                  </div>
                </div>

                {/* Quick increment */}
                {incrementId === g.id ? (
                  <div className="mt-3 flex items-center gap-2 animate-fade-in">
                    <input type="text" name="goal_increment" aria-label="Valor do incremento da meta" inputMode="decimal" value={incrementVal} onChange={(e) => setIncrementVal(e.target.value)}
                      placeholder="Valor" className="flex-1 px-3 py-2 rounded-lg bg-card border border-border text-sm text-foreground" autoFocus />
                    <button type="button" onClick={() => handleIncrement(g.id, currentAmount)} disabled={updatingId === g.id}
                      aria-label="Confirmar atualização da meta" className="px-3 py-2 rounded-lg bg-success/10 text-success text-xs font-semibold hover:bg-success/20 transition-all disabled:opacity-50">
                      <Plus size={14} />
                    </button>
                    <button type="button" onClick={() => setIncrementId(null)}
                      className="px-2 py-2 rounded-lg text-muted-foreground hover:bg-accent text-xs"><X size={14} /></button>
                  </div>
                ) : (
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <button type="button" onClick={() => { setIncrementId(g.id); setIncrementVal(""); }}
                      className="flex items-center gap-1.5 text-xs text-primary hover:bg-primary/10 px-3 py-1.5 rounded-lg font-medium transition-all">
                      <TrendingUp size={12} /> Atualizar valor
                    </button>
                    {[100, 500, 1000].map(v => (
                      <button key={v} disabled={updatingId === g.id} onClick={() => {
                        void handleIncrement(g.id, currentAmount, String(v));
                      }}
                        className="text-[10px] px-2 py-1 rounded-md bg-accent/50 text-muted-foreground hover:text-foreground hover:bg-accent transition-all disabled:opacity-50">
                        +{v}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default Metas;
