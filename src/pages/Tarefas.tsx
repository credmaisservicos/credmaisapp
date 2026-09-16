import { useState, useEffect } from "react";
import { CheckSquare, Plus, Trash2, CheckCircle, Circle, Calendar, GripVertical, Star, StarOff, Filter } from "lucide-react";
import EmptyState from "@/components/EmptyState";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { formatBR } from "@/lib/dateUtils";
import { useConfirm } from "@/components/ConfirmProvider";
import { friendlyError } from "@/lib/friendlyError";
import { SkeletonList } from "@/components/feedback/Skeletons";
import ErrorState from "@/components/feedback/ErrorState";
import LoadingButton from "@/components/feedback/LoadingButton";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { loadProductivityQueue, loadProductivitySnapshot, queueOfflineTodo, saveProductivitySnapshot } from "@/lib/offlineProductivity";
import { PRODUCTIVITY_SYNCED_EVENT } from "@/components/ProductivityOfflineSync";


const Tarefas = () => {
  const confirm = useConfirm();
  const { user } = useAuth();
  const { toast } = useToast();
  const online = useOnlineStatus();
  const [todos, setTodos] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [newTask, setNewTask] = useState("");
  const [filter, setFilter] = useState<"all" | "pending" | "done">("all");
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());

  const fetchTodos = async () => {
    if (!navigator.onLine) {
      setTodos(loadProductivitySnapshot("todos", user!.id));
      setPendingIds(new Set(loadProductivityQueue(user!.id).filter((i) => i.entity === "todos").map((i) => i.row.id)));
      setLoadError(null);
      setLoading(false);
      return;
    }
    // Escopo explícito por dono, além da RLS (ver Anotacoes.tsx).
    const { data, error } = await supabase.from("todos").select("*")
      .eq("user_id", user!.id)
      .order("created_at", { ascending: false });
    if (error) {
      if (!navigator.onLine) {
        setLoadError(null);
        setTodos(loadProductivitySnapshot("todos", user!.id));
        setPendingIds(new Set(loadProductivityQueue(user!.id).filter((i) => i.entity === "todos").map((i) => i.row.id)));
      } else setLoadError(error);
    } else {
      const rows = data || [];
      setLoadError(null);
      setTodos(rows);
      saveProductivitySnapshot("todos", user!.id, rows);
      setPendingIds(new Set(loadProductivityQueue(user!.id).filter((i) => i.entity === "todos").map((i) => i.row.id)));
    }
    setLoading(false);
  };

  useEffect(() => {
    if (!user) return;
    fetchTodos();
    const ch = supabase
      .channel("realtime-todos")
      .on("postgres_changes" as any, { event: "*", schema: "public", table: "todos", filter: `user_id=eq.${user.id}` }, () => fetchTodos())
      .subscribe();
    const sync = () => void fetchTodos();
    window.addEventListener(PRODUCTIVITY_SYNCED_EVENT, sync);
    return () => { supabase.removeChannel(ch); window.removeEventListener(PRODUCTIVITY_SYNCED_EVENT, sync); };
  }, [user]);

  const handleAdd = async () => {
    if (!user || !newTask.trim() || saving) return;
    if (!online) {
      const row = queueOfflineTodo(user.id, newTask.trim());
      const next = [row, ...todos];
      setTodos(next);
      saveProductivitySnapshot("todos", user.id, next);
      setPendingIds((current) => new Set(current).add(row.id));
      setNewTask("");
      toast({ title: "Tarefa salva offline", description: "Será sincronizada ao reconectar." });
      return;
    }
    setSaving(true);
    const { error } = await supabase.from("todos").insert({ user_id: user.id, task: newTask.trim() });
    setSaving(false);
    if (error) {
      toast({ ...friendlyError(error), variant: "destructive" });
    } else {
      setNewTask("");
      fetchTodos();
      toast({ title: "✓ Tarefa adicionada!" });
    }
  };


  const handleToggle = async (id: string, current: boolean) => {
    if (!user || busyId) return;
    if (!online) {
      toast({ title: "Alteração indisponível offline", description: "Reconecte para concluir ou reabrir tarefas.", variant: "destructive" });
      return;
    }
    setBusyId(id);
    const { error } = await supabase.from("todos").update({ is_complete: !current }).eq("id", id).eq("user_id", user.id);
    setBusyId(null);
    if (error) return toast({ ...friendlyError(error, "Não foi possível atualizar a tarefa."), variant: "destructive" });
    await fetchTodos();
  };

  const handleDelete = async (id: string) => {
    if (!user || busyId) return;
    if (!online) {
      toast({ title: "Exclusão indisponível offline", description: "Reconecte para excluir uma tarefa.", variant: "destructive" });
      return;
    }
    if (!(await confirm("Excluir esta tarefa?"))) return;
    setBusyId(id);
    const { error } = await supabase.from("todos").delete().eq("id", id).eq("user_id", user.id);
    setBusyId(null);
    if (error) {
      toast({ title: "Não foi possível excluir", description: "Tente novamente em instantes.", variant: "destructive" });
      return;
    }
    fetchTodos();
    toast({ title: "Tarefa excluída" });
  };

  const handleClearDone = async () => {
    if (!user) return;
    if (!online) {
      toast({ title: "Exclusão indisponível offline", description: "Reconecte para limpar tarefas concluídas.", variant: "destructive" });
      return;
    }
    if (!(await confirm("Limpar todas as tarefas concluídas?"))) return;
    const doneIds = todos.filter(t => t.is_complete).map(t => t.id);
    if (doneIds.length === 0) return;
    const { error } = await supabase.from("todos").delete().in("id", doneIds).eq("user_id", user.id);
    if (error) return toast({ ...friendlyError(error, "Não foi possível limpar as tarefas concluídas."), variant: "destructive" });
    fetchTodos();
    toast({ title: `${doneIds.length} tarefa(s) removida(s)` });
  };

  const all = todos;
  const pending = todos.filter((t) => !t.is_complete);
  const done = todos.filter((t) => t.is_complete);
  const displayed = filter === "pending" ? pending : filter === "done" ? done : all;

  const today = formatBR(new Date());

  return (
    <div className="space-y-6 max-w-2xl mx-auto animate-fade-in">
      <div className="page-hero">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="w-12 h-12 rounded-2xl bg-primary/15 flex items-center justify-center shadow-[0_0_20px_hsl(var(--primary)/0.2)]">
              <CheckSquare size={22} className="text-primary" />
            </div>
            <div>
              <h1 className="text-headline text-2xl md:text-3xl text-foreground">Tarefas</h1>
              <p className="text-muted-foreground text-sm mt-0.5">Organize suas tarefas diárias.</p>
            </div>
          </div>
          <span className="text-xs text-muted-foreground bg-card/70 border border-border/40 rounded-xl px-3 py-1.5 backdrop-blur">
            <Calendar size={12} className="inline mr-1" />{today}
          </span>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 min-[400px]:grid-cols-3 gap-3 stagger-fade-in">
        {[
          { label: "Total", value: all.length, accent: "text-foreground", f: "all" as const },
          { label: "Pendentes", value: pending.length, accent: "text-warning", f: "pending" as const },
          { label: "Concluídas", value: done.length, accent: "text-success", f: "done" as const },
        ].map(s => (
          <button type="button" key={s.label} onClick={() => setFilter(s.f)}
            className={`rounded-2xl border p-4 text-center transition-all card-hover ${filter === s.f ? "border-primary/30 bg-primary/5" : "border-border bg-card"}`}>
            <p className={`text-2xl font-bold ${s.accent}`}>{s.value}</p>
            <p className="text-[11px] text-muted-foreground uppercase tracking-wider mt-0.5">{s.label}</p>
          </button>
        ))}
      </div>

      {/* Add */}
      <div className="flex gap-2">
        <input
          id="new-task"
          name="new_task"
          aria-label="Nova tarefa"
          type="text"
          placeholder="Nova tarefa... (Enter para adicionar)"
          value={newTask}
          onChange={(e) => setNewTask(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleAdd()}
          className="flex-1 px-4 py-3 rounded-2xl bg-card border border-border text-foreground placeholder:text-muted-foreground text-sm input-enhanced"
        />
        <LoadingButton onClick={handleAdd} loading={saving} aria-label="Adicionar tarefa"
          icon={<Plus size={18} />} className="px-4 shrink-0">
          <span className="sr-only">Adicionar</span>
        </LoadingButton>

      </div>

      {/* Clear done */}
      {done.length > 0 && (
        <div className="flex justify-end">
          <button type="button" onClick={handleClearDone} className="text-xs text-muted-foreground hover:text-destructive transition-colors flex items-center gap-1">
            <Trash2 size={12} /> Limpar concluídas ({done.length})
          </button>
        </div>
      )}

      {loading ? (
        <SkeletonList rows={4} height="h-14" />
      ) : loadError ? (
        <ErrorState error={loadError} onRetry={() => { setLoadError(null); setLoading(true); fetchTodos(); }} />


      ) : displayed.length === 0 ? (
        <EmptyState
          icon={CheckSquare}
          title={filter === "done" ? "Nenhuma tarefa concluída" : filter === "pending" ? "Nenhuma tarefa pendente" : "Nenhuma tarefa"}
          description={filter === "all" ? "Adicione uma tarefa acima pra começar a se organizar." : "Mude o filtro pra ver outras tarefas."}
        />
      ) : (
        <div className="space-y-1.5">
          {displayed.map((t, i) => {
            const isDone = t.is_complete;
            return (
              <div key={t.id}
                className={`rounded-2xl border bg-card p-3.5 flex items-center gap-3 group card-hover animate-fade-in ${isDone ? "border-border/50 opacity-60" : "border-border"}`}
                style={{ animationDelay: `${i * 30}ms` }}>
                <button type="button" onClick={() => handleToggle(t.id, t.is_complete)} disabled={busyId === t.id}
                  aria-label={isDone ? `Reabrir tarefa ${t.task}` : `Concluir tarefa ${t.task}`}
                  className={`shrink-0 transition-all duration-200 disabled:opacity-50 ${isDone ? "text-success" : "text-muted-foreground hover:text-primary"}`}>
                  {isDone ? <CheckCircle size={22} /> : <Circle size={22} />}
                </button>
                <span className={`text-sm flex-1 ${isDone ? "text-muted-foreground line-through" : "text-foreground"}`}>
                  {t.task || "Sem título"}
                </span>
                {pendingIds.has(t.id) && <span className="text-[9px] font-semibold text-warning">Pendente</span>}
                <span className="text-[10px] text-muted-foreground/50 hidden sm:block">
                  {formatBR(t.created_at)}
                </span>
                <button type="button" onClick={() => handleDelete(t.id)} disabled={busyId === t.id}
                  aria-label={`Excluir tarefa ${t.task}`}
                  className="p-1 text-muted-foreground transition-all hover:rounded-lg hover:bg-destructive/10 hover:text-destructive disabled:opacity-50 sm:opacity-0 sm:group-hover:opacity-100 sm:focus:opacity-100">
                  <Trash2 size={14} />
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* Productivity tip */}
      {pending.length > 5 && (
        <div className="rounded-2xl border border-warning/20 bg-warning/5 p-4 text-xs text-warning flex items-center gap-2 animate-fade-in">
          <Filter size={14} />
          Você tem {pending.length} tarefas pendentes. Considere priorizar as mais importantes!
        </div>
      )}
    </div>
  );
};

export default Tarefas;
