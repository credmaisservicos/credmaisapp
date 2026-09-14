import { useState, useEffect } from "react";
import { StickyNote, Plus, Trash2, Calendar, Search, X, Edit, Check } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { useConfirm } from "@/components/ConfirmProvider";
import EmptyState from "@/components/EmptyState";
import { friendlyError } from "@/lib/friendlyError";
import { SkeletonCards } from "@/components/feedback/Skeletons";
import ErrorState from "@/components/feedback/ErrorState";
import LoadingButton from "@/components/feedback/LoadingButton";
import type { Database } from "@/integrations/supabase/types";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { loadProductivityQueue, loadProductivitySnapshot, queueOfflineNote, saveProductivitySnapshot } from "@/lib/offlineProductivity";
import { PRODUCTIVITY_SYNCED_EVENT } from "@/components/ProductivityOfflineSync";

type Note = Database["public"]["Tables"]["notes"]["Row"];

const Anotacoes = () => {
  const confirm = useConfirm();
  const { user } = useAuth();
  const { toast } = useToast();
  const online = useOnlineStatus();
  const [notes, setNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState("");
  const [search, setSearch] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());

  const fetchNotes = async () => {
    if (!user) return;
    if (!navigator.onLine) {
      setNotes(loadProductivitySnapshot<Note>("notes", user.id));
      setPendingIds(new Set(loadProductivityQueue(user.id).filter((i) => i.entity === "notes").map((i) => i.row.id)));
      setLoadError(null);
      setLoading(false);
      return;
    }
    // Filtro explícito por dono. A RLS já garante o isolamento, mas depender só
    // dela deixa a tela à mercê de uma policy afrouxada no futuro — e sem o
    // filtro o Postgres também não usa o índice por user_id.
    const { data, error } = await supabase.from("notes").select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });
    if (error) {
      if (!navigator.onLine) {
        setLoadError(null);
        setNotes(loadProductivitySnapshot<Note>("notes", user.id));
        setPendingIds(new Set(loadProductivityQueue(user.id).filter((i) => i.entity === "notes").map((i) => i.row.id)));
      } else setLoadError(error);
    } else {
      const rows = data || [];
      setLoadError(null);
      setNotes(rows);
      saveProductivitySnapshot("notes", user.id, rows);
      setPendingIds(new Set(loadProductivityQueue(user.id).filter((i) => i.entity === "notes").map((i) => i.row.id)));
    }
    setLoading(false);
  };

  useEffect(() => {
    if (!user) return;
    fetchNotes();
    const ch = supabase
      .channel("realtime-notes")
      .on("postgres_changes" as any, { event: "*", schema: "public", table: "notes", filter: `user_id=eq.${user.id}` }, () => fetchNotes())
      .subscribe();
    const sync = () => void fetchNotes();
    window.addEventListener(PRODUCTIVITY_SYNCED_EVENT, sync);
    return () => { supabase.removeChannel(ch); window.removeEventListener(PRODUCTIVITY_SYNCED_EVENT, sync); };
  }, [user]);

  const handleAdd = async () => {
    if (!user || !title.trim() || saving) return;
    if (!online) {
      const row = queueOfflineNote(user.id, title.trim());
      const next = [row, ...notes];
      setNotes(next);
      saveProductivitySnapshot("notes", user.id, next);
      setPendingIds((current) => new Set(current).add(row.id));
      setTitle("");
      setShowForm(false);
      toast({ title: "Anotação salva offline", description: "Será sincronizada ao reconectar." });
      return;
    }
    setSaving(true);
    const { error } = await supabase.from("notes").insert({ user_id: user.id, title: title.trim() });
    setSaving(false);
    if (error) toast({ ...friendlyError(error), variant: "destructive" });
    else { toast({ title: "✓ Anotação criada!" }); setTitle(""); setShowForm(false); fetchNotes(); }
  };


  const handleDelete = async (id: string) => {
    if (!user || busyId) return;
    if (!online) {
      toast({ title: "Edição indisponível offline", description: "Reconecte para excluir uma anotação.", variant: "destructive" });
      return;
    }
    if (!(await confirm("Excluir esta anotação?"))) return;
    setBusyId(id);
    const { error } = await supabase.from("notes").delete().eq("id", id).eq("user_id", user.id);
    setBusyId(null);
    if (error) {
      toast({ ...friendlyError(error, "Não foi possível excluir a anotação."), variant: "destructive" });
      return;
    }
    toast({ title: "Anotação excluída" });
    fetchNotes();
  };

  const handleEdit = async (id: string) => {
    if (!user || !editTitle.trim() || busyId) return;
    if (!online) {
      toast({ title: "Edição indisponível offline", description: "Reconecte para alterar uma anotação.", variant: "destructive" });
      return;
    }
    setBusyId(id);
    const { error } = await supabase.from("notes").update({ title: editTitle.trim() }).eq("id", id).eq("user_id", user.id);
    setBusyId(null);
    if (error) {
      toast({ ...friendlyError(error, "Não foi possível atualizar a anotação."), variant: "destructive" });
      return;
    }
    toast({ title: "✓ Atualizada!" });
    setEditingId(null);
    fetchNotes();
  };

  const filtered = notes.filter(n => !search || n.title.toLowerCase().includes(search.toLowerCase()));

  const colors = [
    "bg-primary/5 border-primary/15",
    "bg-success/5 border-success/15",
    "bg-warning/5 border-warning/15",
    "bg-info/5 border-info/15",
  ];

  const timeAgo = (date: string) => {
    const diff = Date.now() - new Date(date).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 60) return `${mins}min atrás`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h atrás`;
    const days = Math.floor(hrs / 24);
    return `${days}d atrás`;
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="page-hero">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="w-12 h-12 rounded-2xl bg-primary/15 flex items-center justify-center shadow-[0_0_20px_hsl(var(--primary)/0.2)]">
              <StickyNote size={22} className="text-primary" />
            </div>
            <div>
              <h1 className="text-headline text-2xl md:text-3xl text-foreground">Anotações</h1>
              <p className="text-muted-foreground text-sm mt-0.5">{notes.length} nota{notes.length !== 1 ? "s" : ""} salva{notes.length !== 1 ? "s" : ""}</p>
            </div>
          </div>
          <button onClick={() => setShowForm(!showForm)} className="btn-premium w-full sm:w-auto justify-center">
            <Plus size={16} /> Nova Anotação
          </button>
        </div>
      </div>

      {/* Search */}
      {notes.length > 3 && (
        <div className="relative">
          <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input type="text" placeholder="Buscar anotações..." value={search} onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-10 pr-10 py-3 rounded-2xl bg-card border border-border text-foreground placeholder:text-muted-foreground text-sm input-enhanced" />
          {search && (
            <button onClick={() => setSearch("")} className="absolute right-3 top-1/2 -translate-y-1/2 p-1 rounded-md hover:bg-accent text-muted-foreground">
              <X size={14} />
            </button>
          )}
        </div>
      )}

      {showForm && (
        <div className="rounded-2xl border border-border bg-card p-6 space-y-4 animate-scale-in">
          <div>
            <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5 block">Conteúdo</label>
            <textarea value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ex: Lembrar de cobrar fulano amanhã..."
              rows={3}
              className="w-full px-4 py-3 rounded-2xl bg-card border border-border text-foreground placeholder:text-muted-foreground text-sm input-enhanced resize-none"
              onKeyDown={(e) => e.key === "Enter" && (e.metaKey || e.ctrlKey) && handleAdd()} />
            <p className="text-[10px] text-muted-foreground mt-1">Ctrl/Cmd+Enter para salvar</p>
          </div>
          <div className="flex gap-2">
            <LoadingButton onClick={handleAdd} loading={saving} loadingText="Salvando…">Salvar</LoadingButton>
            <button onClick={() => setShowForm(false)} className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors">Cancelar</button>
          </div>
        </div>
      )}

      {loading ? (
        <SkeletonCards count={6} height="h-28" />
      ) : loadError ? (
        <ErrorState error={loadError} onRetry={() => { setLoadError(null); setLoading(true); fetchNotes(); }} />
      ) : filtered.length === 0 ? (

        <EmptyState
          icon={StickyNote}
          title={search ? `Nenhum resultado para "${search}"` : "Nenhuma anotação"}
          description={search ? "Tente outro termo" : "Crie uma anotação para não esquecer"}
        />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 stagger-fade-in">
          {filtered.map((n, i) => (
            <div key={n.id} className={`rounded-2xl border p-5 group relative card-hover ${colors[i % colors.length]}`}>
              {pendingIds.has(n.id) && <span className="absolute bottom-3 right-4 text-[9px] font-semibold text-warning">Pendente de sincronização</span>}
              {editingId === n.id ? (
                <div className="space-y-2">
                  <textarea value={editTitle} onChange={(e) => setEditTitle(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg bg-card border border-border text-foreground text-sm resize-none" rows={2} autoFocus />
                  <div className="flex gap-2">
                    <button onClick={() => handleEdit(n.id)} disabled={busyId === n.id} aria-label="Salvar anotação" className="p-1.5 rounded-lg bg-success/10 text-success hover:bg-success/20 disabled:opacity-50"><Check size={14} /></button>
                    <button onClick={() => setEditingId(null)} disabled={busyId === n.id} aria-label="Cancelar edição" className="p-1.5 rounded-lg bg-muted text-muted-foreground hover:bg-accent disabled:opacity-50"><X size={14} /></button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="flex items-start gap-3">
                    <StickyNote size={16} className="text-primary mt-0.5 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-foreground pr-12 whitespace-pre-wrap">{n.title}</p>
                      <p className="text-[10px] text-muted-foreground mt-2 flex items-center gap-1">
                        <Calendar size={10} /> {timeAgo(n.created_at)}
                      </p>
                    </div>
                  </div>
                  <div className="absolute top-4 right-4 flex gap-1 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-all">
                    <button onClick={() => { setEditingId(n.id); setEditTitle(n.title); }}
                      aria-label="Editar anotação" className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-all">
                      <Edit size={13} />
                    </button>
                    <button onClick={() => handleDelete(n.id)} disabled={busyId === n.id}
                      aria-label="Excluir anotação" className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-all disabled:opacity-50">
                      <Trash2 size={13} />
                    </button>
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default Anotacoes;
