import { isEmAtraso, isEmAberto } from "@/lib/dashboardMetrics";
import { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import {
  Plus, UserCheck, UserX, Key, Trash2, Users, X, Phone, Mail, MapPin,
  Copy, Search, Shield, Edit2, Check, MoreVertical, ChevronDown, Eye, EyeOff,
  Star, TrendingUp, Clock, AlertTriangle, FileText, DollarSign, Calendar,
  ArrowRight, ExternalLink
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter
} from "@/components/ui/dialog";
import { formatBR, parseLocalDate } from "@/lib/dateUtils";
import { Button } from "@/components/ui/button";
import { useMultiTableRealtime } from "@/hooks/useRealtimeSubscription";
import { useConfirm } from "@/components/ConfirmProvider";
import { friendlyError } from "@/lib/friendlyError";
import ErrorState from "@/components/feedback/ErrorState";
import { fetchAll } from "@/lib/fetchAll";

const safeNumber = (value: unknown) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
};

const Cobradores = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [saving, setSaving] = useState(false);
  const [assignModal, setAssignModal] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [expandedCard, setExpandedCard] = useState<string | null>(null);
  const [tokenVisibility, setTokenVisibility] = useState<Record<string, boolean>>({});
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [clientSearch, setClientSearch] = useState("");
  const [fichaCollector, setFichaCollector] = useState<string | null>(null);
  const [assignCobrancaModal, setAssignCobrancaModal] = useState<string | null>(null);
  const [cobrancaClientSearch, setCobrancaClientSearch] = useState("");

  useMultiTableRealtime(
    ["collectors", "collector_assignments", "collector_tokens", "clients"],
    [["collectors", user?.id || ""], ["collector-assignments", user?.id || ""], ["collector-tokens", user?.id || ""]],
  );

  const { data: collectors = [], error: collectorsError } = useQuery({
    queryKey: ["collectors", user?.id],
    queryFn: async () => {
      return fetchAll((from, to) => supabase.from("collectors").select("*").eq("user_id", user!.id).order("name").range(from, to));
    },
    enabled: !!user,
  });

  const { data: assignments = [], error: assignmentsError } = useQuery({
    queryKey: ["collector-assignments", user?.id],
    queryFn: async () => {
      return fetchAll((from, to) => supabase.from("collector_assignments").select("*, clients(id, name, phone, whatsapp, cpf_cnpj, status)").eq("user_id", user!.id).range(from, to));
    },
    enabled: !!user,
  });

  const { data: tokens = [], error: tokensError } = useQuery({
    queryKey: ["collector-tokens", user?.id],
    queryFn: async () => {
      return fetchAll((from, to) => supabase.from("collector_tokens").select("*").eq("user_id", user!.id).range(from, to));
    },
    enabled: !!user,
  });

  const { data: clients = [], error: clientsError } = useQuery({
    queryKey: ["clients-list", user?.id],
    queryFn: async () => {
      return fetchAll((from, to) => supabase.from("clients").select("id, name, phone, whatsapp, cpf_cnpj, status").eq("user_id", user!.id).order("name").range(from, to));
    },
    enabled: !!user,
  });

  const { data: allInstallments = [], error: installmentsError } = useQuery({
    queryKey: ["all-installments-collectors", user?.id],
    queryFn: async () => {
      const clientIds = assignments.map((a: any) => a.client_id);
      if (clientIds.length === 0) return [];
      const assignedClients = new Set(clientIds);
      const installments = await fetchAll((from, to) => supabase
        .from("contract_installments")
        .select("*, contracts(capital, interest_rate, frequency)")
        .eq("user_id", user!.id)
        .order("due_date")
        .range(from, to));
      return installments.filter((installment: any) => assignedClients.has(installment.client_id));
    },
    enabled: !!user && assignments.length > 0,
  });

  const inv = (key: string) => queryClient.invalidateQueries({ queryKey: [key] });
  const queryError = collectorsError || assignmentsError || tokensError || clientsError || installmentsError;

  const copyText = async (value: string, successTitle = "Copiado!") => {
    try {
      await navigator.clipboard.writeText(value);
      toast({ title: successTitle });
      return true;
    } catch {
      toast({ title: "Não foi possível copiar", description: "Selecione e copie o código manualmente.", variant: "destructive" });
      return false;
    }
  };

  const resetForm = () => {
    setName(""); setPhone(""); setEmail(""); setCity(""); setState("");
    setEditingId(null); setShowForm(false);
  };

  const handleEdit = (c: any) => {
    setName(c.name); setPhone(c.phone); setEmail(c.email || "");
    setCity(c.city); setState(c.state);
    setEditingId(c.id); setShowForm(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setSaving(true);

    if (editingId) {
      const { error } = await supabase.from("collectors")
        .update({ name, phone, email, city, state })
        .eq("id", editingId)
        .eq("user_id", user.id);
      setSaving(false);
      if (error) toast({ ...friendlyError(error), variant: "destructive" });
      else {
        toast({ title: "✓ Cobrador atualizado!" });
        resetForm(); inv("collectors");
      }
    } else {
      const { error } = await supabase.from("collectors")
        .insert({ user_id: user.id, name, phone, email, city, state });
      setSaving(false);
      if (error) toast({ ...friendlyError(error), variant: "destructive" });
      else {
        toast({ title: "✓ Cobrador adicionado!" });
        resetForm(); inv("collectors");
      }
    }
  };

  const handleToggleActive = async (id: string, isActive: boolean) => {
    if (!user) return;
    const { error } = await supabase.from("collectors").update({ is_active: !isActive }).eq("id", id).eq("user_id", user.id);
    if (error) return toast({ ...friendlyError(error, "Não foi possível atualizar o cobrador."), variant: "destructive" });
    inv("collectors");
    toast({ title: isActive ? "Cobrador desativado" : "Cobrador ativado" });
  };

  const handleDelete = async (id: string) => {
    if (!user) return;
    const { error } = await supabase.from("collectors").delete().eq("id", id).eq("user_id", user.id);
    if (error) {
      setDeleteConfirm(null);
      return toast({ ...friendlyError(error, "Não foi possível excluir o cobrador."), variant: "destructive" });
    }
    inv("collectors"); inv("collector-assignments"); inv("collector-tokens");
    toast({ title: "Cobrador excluído" });
    setDeleteConfirm(null);
  };

  const handleGenerateToken = async (collectorId: string) => {
    if (!user) return;
    const token = crypto.randomUUID().replace(/-/g, "").slice(0, 16).toUpperCase();
    const { error } = await supabase.from("collector_tokens")
      .insert({ user_id: user.id, collector_id: collectorId, token });
    if (error) toast({ ...friendlyError(error), variant: "destructive" });
    else {
      const copied = await copyText(token, "Token gerado e copiado!");
      if (!copied) toast({ title: "Token gerado", description: token });
      inv("collector-tokens");
      setTokenVisibility(prev => ({ ...prev, [collectorId]: true }));
    }
  };

  const handleRevokeToken = async (tokenId: string) => {
    if (!user) return;
    if (!(await confirm("Revogar este token de acesso? O cobrador perderá o acesso ao portal."))) return;
    const { error } = await supabase.from("collector_tokens").delete().eq("id", tokenId).eq("user_id", user.id);
    if (error) return toast({ ...friendlyError(error, "Não foi possível revogar o token."), variant: "destructive" });
    inv("collector-tokens");
    toast({ title: "Token revogado" });
  };

  const handleAssign = async (collectorId: string, clientId: string) => {
    if (!user) return;
    const { error } = await supabase.from("collector_assignments")
      .insert({ user_id: user.id, collector_id: collectorId, client_id: clientId });
    if (error) toast({ ...friendlyError(error), variant: "destructive" });
    else {
      toast({ title: "✓ Cliente atribuído!" });
      inv("collector-assignments");
      inv("all-installments-collectors");
    }
  };

  const handleRemoveAssignment = async (id: string) => {
    if (!user) return;
    if (!(await confirm("Remover esta atribuição de cliente?"))) return;
    const { error } = await supabase.from("collector_assignments").delete().eq("id", id).eq("user_id", user.id);
    if (error) return toast({ ...friendlyError(error, "Não foi possível remover a atribuição."), variant: "destructive" });
    inv("collector-assignments");
    inv("all-installments-collectors");
    toast({ title: "Atribuição removida" });
  };

  const filteredCollectors = collectors.filter((c: any) =>
    !search || (c.name || "").toLowerCase().includes(search.toLowerCase()) ||
    (c.phone || "").includes(search) || c.city?.toLowerCase().includes(search.toLowerCase())
  );

  const stats = {
    total: collectors.length,
    active: collectors.filter((c: any) => c.is_active !== false).length,
    inactive: collectors.filter((c: any) => c.is_active === false).length,
    assigned: new Set(assignments.map((a: any) => a.collector_id)).size,
    totalAssignments: assignments.length,
  };

  const inputCls = "w-full px-4 py-2.5 rounded-2xl bg-card border border-border text-sm text-foreground placeholder:text-muted-foreground focus:ring-2 focus:ring-primary/30 focus:border-primary/50 outline-hidden transition-all";

  const formatPhone = (value: string) => {
    const digits = value.replace(/\D/g, "").slice(0, 11);
    if (digits.length <= 2) return `(${digits}`;
    if (digits.length <= 7) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
  };

  const fmt = (v: number) => safeNumber(v).toLocaleString("pt-BR", { minimumFractionDigits: 2 });
  const now = new Date();

  // Ficha data
  const fichaData = fichaCollector ? collectors.find((c: any) => c.id === fichaCollector) : null;
  const fichaAssignments = fichaCollector ? assignments.filter((a: any) => a.collector_id === fichaCollector) : [];
  const fichaTokens = fichaCollector ? tokens.filter((t: any) => t.collector_id === fichaCollector) : [];
  const fichaClientIds = fichaAssignments.map((a: any) => a.client_id);
  const fichaInstallments = allInstallments.filter((i: any) => fichaClientIds.includes(i.client_id));
  const fichaPending = fichaInstallments.filter((i: any) => isEmAberto(i));
  const fichaOverdue = fichaPending.filter((i: any) => isEmAtraso(i, now));
  const fichaPaid = fichaInstallments.filter((i: any) => i.status === "paid");
  const fichaTotalPending = fichaPending.reduce((s: number, i: any) => s + safeNumber(i.amount), 0);
  const fichaTotalOverdue = fichaOverdue.reduce((s: number, i: any) => s + safeNumber(i.amount), 0);
  const fichaTotalPaid = fichaPaid.reduce((s: number, i: any) => s + safeNumber(i.paid_amount ?? i.amount), 0);

  if (queryError) {
    return (
      <ErrorState
        title="Não foi possível carregar os cobradores"
        error={queryError}
        onRetry={() => {
          ["collectors", "collector-assignments", "collector-tokens", "clients-list", "all-installments-collectors"]
            .forEach((key) => void inv(key));
        }}
      />
    );
  }

  return (
    <div className="space-y-5 animate-fade-in">
      {/* Header */}
      <div className="rounded-2xl border border-border/60 bg-card/65 p-4 sm:p-5 shadow-[0_18px_50px_-40px_rgba(0,0,0,.9)] backdrop-blur-xl">
        <div className="page-hero-content flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="min-w-0 flex items-center gap-3">
            <div className="hidden sm:flex w-10 h-10 rounded-xl bg-primary/15 border border-primary/20 items-center justify-center text-primary">
              <Shield size={22} />
            </div>
            <div>
              <h1 className="text-xl sm:text-2xl font-bold text-foreground">Cobradores</h1>
              <p className="text-sm text-muted-foreground mt-0.5">Gestão completa de cobradores externos</p>
            </div>
          </div>
          <button type="button" onClick={() => { resetForm(); setShowForm(!showForm); }} className="btn-premium w-full sm:w-auto justify-center">
            <Plus size={16} /> Novo Cobrador
          </button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
        {[
          { label: "Total", value: stats.total, icon: Users, color: "text-foreground", bg: "bg-accent/30" },
          { label: "Ativos", value: stats.active, icon: UserCheck, color: "text-success", bg: "bg-success/10" },
          { label: "Inativos", value: stats.inactive, icon: UserX, color: "text-destructive", bg: "bg-destructive/10" },
          { label: "Clientes Atribuídos", value: stats.totalAssignments, icon: TrendingUp, color: "text-primary", bg: "bg-primary/10" },
        ].map(s => (
          <div key={s.label} className="min-w-0 rounded-xl border border-border bg-card/60 p-3 sm:p-4 transition-colors hover:border-primary/20">
            <div className="flex items-center justify-between mb-2">
              <div className={`w-8 h-8 rounded-lg ${s.bg} flex items-center justify-center`}>
                <s.icon size={14} className={s.color} />
              </div>
            </div>
            <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider mt-0.5">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Search */}
      {collectors.length > 0 && (
        <div className="relative">
          <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            id="collectors-search"
            name="collectors_search"
            aria-label="Buscar cobradores"
            autoComplete="off"
            type="text"
            placeholder="Buscar por nome, telefone ou cidade..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className={`${inputCls} pl-10`}
          />
          {search && (
            <button type="button" aria-label="Limpar busca de cobradores" onClick={() => setSearch("")} className="absolute right-3.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
              <X size={14} />
            </button>
          )}
        </div>
      )}

      {/* Form */}
      {showForm && (
        <form onSubmit={handleSubmit} className="rounded-2xl border border-primary/20 bg-card p-4 sm:p-6 space-y-5 animate-scale-in shadow-lg">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
                {editingId ? <Edit2 size={14} className="text-primary" /> : <Plus size={14} className="text-primary" />}
              </div>
              <h2 className="font-semibold text-foreground">{editingId ? "Editar Cobrador" : "Novo Cobrador"}</h2>
            </div>
            <button type="button" onClick={resetForm} className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors">
              <X size={18} />
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="collector-name" className="text-xs font-medium text-muted-foreground mb-1.5 block">Nome Completo *</label>
              <input id="collector-name" name="collector_name" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex: João Silva" required className={inputCls} />
            </div>
            <div>
              <label htmlFor="collector-phone" className="text-xs font-medium text-muted-foreground mb-1.5 block">Telefone / WhatsApp *</label>
              <input id="collector-phone" name="collector_phone" autoComplete="tel" value={phone} onChange={(e) => setPhone(formatPhone(e.target.value))} placeholder="(00) 00000-0000" required className={inputCls} />
            </div>
            <div>
              <label htmlFor="collector-email" className="text-xs font-medium text-muted-foreground mb-1.5 block">E-mail</label>
              <input id="collector-email" name="collector_email" autoComplete="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="email@exemplo.com" className={inputCls} />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-2">
                <label htmlFor="collector-city" className="text-xs font-medium text-muted-foreground mb-1.5 block">Cidade *</label>
                <input id="collector-city" name="collector_city" autoComplete="address-level2" value={city} onChange={(e) => setCity(e.target.value)} placeholder="São Paulo" required className={inputCls} />
              </div>
              <div>
                <label htmlFor="collector-state" className="text-xs font-medium text-muted-foreground mb-1.5 block">UF *</label>
                <input id="collector-state" name="collector_state" autoComplete="address-level1" value={state} onChange={(e) => setState(e.target.value.toUpperCase())} placeholder="SP" maxLength={2} required className={inputCls} />
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3 pt-1">
            <button type="submit" disabled={saving}
              className="flex items-center gap-2 px-6 py-2.5 rounded-xl text-sm font-semibold text-primary-foreground disabled:opacity-50 hover:shadow-lg transition-all"
              style={{ background: "var(--gradient-button)" }}>
              {editingId ? <Check size={14} /> : <Plus size={14} />}
              {saving ? "Salvando..." : editingId ? "Salvar Alterações" : "Cadastrar"}
            </button>
            {editingId && (
              <button type="button" onClick={resetForm} className="px-4 py-2.5 rounded-xl text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors">
                Cancelar
              </button>
            )}
          </div>
        </form>
      )}

      {/* Empty State */}
      {filteredCollectors.length === 0 ? (
        <div className="text-center py-20 rounded-2xl border border-dashed border-border bg-card/50">
          <div className="w-20 h-20 mx-auto rounded-2xl bg-muted/30 flex items-center justify-center mb-5">
            <Users size={32} className="text-muted-foreground/40" />
          </div>
          <p className="text-foreground font-semibold text-lg">
            {search ? "Nenhum cobrador encontrado" : "Nenhum cobrador cadastrado"}
          </p>
          <p className="text-sm text-muted-foreground mt-2 max-w-md mx-auto">
            {search
              ? `Não encontramos resultados para "${search}". Tente outro termo.`
              : "Cadastre cobradores para distribuir a carteira de clientes e gerenciar cobranças externas."}
          </p>
          {!search && (
            <button onClick={() => { resetForm(); setShowForm(true); }}
              className="mt-5 inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold text-primary-foreground"
              style={{ background: "var(--gradient-button)" }}>
              <Plus size={14} /> Cadastrar Primeiro Cobrador
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 stagger-fade-in">
          {filteredCollectors.map((c: any) => {
            const cTokens = tokens.filter((t: any) => t.collector_id === c.id);
            const cAssignments = assignments.filter((a: any) => a.collector_id === c.id);
            const isActive = c.is_active !== false;
            const isExpanded = expandedCard === c.id;
            const showToken = tokenVisibility[c.id];

            // Stats for this collector
            const cClientIds = cAssignments.map((a: any) => a.client_id);
            const cInstallments = allInstallments.filter((i: any) => cClientIds.includes(i.client_id));
            const cPending = cInstallments.filter((i: any) => isEmAberto(i));
            const cOverdue = cPending.filter((i: any) => isEmAtraso(i, now));

            return (
              <div key={c.id}
                className={`min-w-0 rounded-2xl border bg-card/70 overflow-hidden transition-colors ${
                  isActive ? "border-border hover:border-primary/20" : "border-border/50 opacity-75"
                }`}>
                {/* Top accent bar */}
                <div className={`h-1 w-full ${isActive ? "bg-linear-to-r from-primary/60 to-primary/20" : "bg-muted"}`} />

                <div className="p-4 sm:p-5 space-y-4">
                  {/* Header */}
                  <div className="flex min-w-0 items-start justify-between gap-2">
                    <div
                      className="flex min-w-0 items-center gap-3 cursor-pointer rounded-lg outline-hidden focus-visible:ring-2 focus-visible:ring-primary/60"
                      role="button"
                      tabIndex={0}
                      aria-label={`Ver ficha de ${c.name || "cobrador"}`}
                      onClick={() => setFichaCollector(c.id)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          setFichaCollector(c.id);
                        }
                      }}
                    >
                      <div className={`relative w-12 h-12 rounded-xl flex items-center justify-center text-base font-bold shadow-xs ${
                        isActive
                          ? "bg-linear-to-br from-primary/20 to-primary/5 text-primary border border-primary/10"
                          : "bg-muted text-muted-foreground"
                      }`}>
                        {c.name?.charAt(0)?.toUpperCase()}
                        <span className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-card ${
                          isActive ? "bg-success" : "bg-muted-foreground"
                        }`} />
                      </div>
                      <div className="min-w-0">
                        <p className="font-semibold text-foreground text-base hover:text-primary transition-colors truncate">{c.name}</p>
                        <div className="flex items-center gap-3 mt-1">
                          <span className="flex items-center gap-1 text-xs text-muted-foreground">
                            <Phone size={10} /> {c.phone}
                          </span>
                          <span className="flex items-center gap-1 text-xs text-muted-foreground">
                            <MapPin size={10} /> {c.city}/{c.state}
                          </span>
                        </div>
                        {c.email && (
                          <span className="flex items-center gap-1 text-xs text-muted-foreground mt-0.5">
                            <Mail size={10} /> {c.email}
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className={`text-[10px] ${
                        isActive
                          ? "bg-success/10 text-success border-success/20"
                          : "bg-destructive/10 text-destructive border-destructive/20"
                      }`}>
                        {isActive ? "Ativo" : "Inativo"}
                      </Badge>

                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button type="button" aria-label={`Ações de ${c.name || "cobrador"}`} className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors">
                            <MoreVertical size={16} />
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-48">
                          <DropdownMenuItem onClick={() => setFichaCollector(c.id)} className="gap-2">
                            <FileText size={14} /> Ver Ficha
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => handleEdit(c)} className="gap-2">
                            <Edit2 size={14} /> Editar
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => handleToggleActive(c.id, isActive)} className="gap-2">
                            {isActive ? <><UserX size={14} /> Desativar</> : <><UserCheck size={14} /> Ativar</>}
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => handleGenerateToken(c.id)} className="gap-2">
                            <Key size={14} /> Gerar Token
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem onClick={() => setAssignModal(c.id)} className="gap-2">
                            <Users size={14} /> Atribuir Cliente
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => setAssignCobrancaModal(c.id)} className="gap-2">
                            <DollarSign size={14} /> Atribuir Cobranças
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem onClick={() => setDeleteConfirm(c.id)} className="gap-2 text-destructive focus:text-destructive">
                            <Trash2 size={14} /> Excluir
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </div>

                  {/* Quick stats */}
                  <div className="grid grid-cols-1 min-[400px]:grid-cols-3 gap-2">
                    <div className="flex-1 flex items-center gap-2 p-2.5 rounded-xl bg-accent/20">
                      <Users size={12} className="text-primary shrink-0" />
                      <span className="text-xs text-foreground font-medium">{cAssignments.length}</span>
                      <span className="text-[10px] text-muted-foreground">clientes</span>
                    </div>
                    <div className="flex-1 flex items-center gap-2 p-2.5 rounded-xl bg-accent/20">
                      <DollarSign size={12} className="text-amber-500 shrink-0" />
                      <span className="text-xs text-foreground font-medium">{cPending.length}</span>
                      <span className="text-[10px] text-muted-foreground">pendentes</span>
                    </div>
                    <div className="flex-1 flex items-center gap-2 p-2.5 rounded-xl bg-accent/20">
                      <AlertTriangle size={12} className="text-destructive shrink-0" />
                      <span className="text-xs text-foreground font-medium">{cOverdue.length}</span>
                      <span className="text-[10px] text-muted-foreground">atrasadas</span>
                    </div>
                  </div>

                  {/* Token section */}
                  {cTokens.length > 0 && (
                    <div className="space-y-1.5">
                      {cTokens.map((t: any) => (
                        <div key={t.id} className="flex items-center gap-2 p-2.5 rounded-xl bg-muted/30 border border-border/50">
                          <Key size={12} className="text-muted-foreground shrink-0" />
                          <span className="text-xs font-mono text-foreground flex-1 truncate">
                            {showToken ? t.token : "••••••••••••••••"}
                          </span>
                          <button onClick={() => setTokenVisibility(prev => ({ ...prev, [c.id]: !prev[c.id] }))}
                            className="p-1 rounded hover:bg-accent text-muted-foreground" title={showToken ? "Ocultar" : "Mostrar"}>
                            {showToken ? <EyeOff size={12} /> : <Eye size={12} />}
                          </button>
                          <button onClick={() => void copyText(t.token, "Token copiado!")}
                            className="p-1 rounded hover:bg-accent text-muted-foreground" title="Copiar">
                            <Copy size={12} />
                          </button>
                          <button onClick={() => handleRevokeToken(t.id)}
                            className="p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive" title="Revogar">
                            <X size={12} />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Assigned clients */}
                  {cAssignments.length > 0 && (
                    <div>
                      <button type="button" onClick={() => setExpandedCard(isExpanded ? null : c.id)} aria-expanded={isExpanded} aria-label={`${isExpanded ? "Ocultar" : "Mostrar"} clientes atribuídos a ${c.name || "cobrador"}`}
                        className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground mb-2 transition-colors">
                        <ChevronDown size={12} className={`transition-transform ${isExpanded ? "rotate-180" : ""}`} />
                        {cAssignments.length} {cAssignments.length === 1 ? "cliente atribuído" : "clientes atribuídos"}
                      </button>
                      {isExpanded && (
                        <div className="flex flex-wrap gap-1.5 animate-fade-in">
                          {cAssignments.map((a: any) => (
                            <Badge key={a.id} variant="outline" className="text-[11px] gap-1.5 py-1 px-2.5 bg-accent/30 hover:bg-accent/50 transition-colors">
                              {a.clients?.name}
                              <button type="button" onClick={() => handleRemoveAssignment(a.id)} aria-label={`Remover ${a.clients?.name || "cliente"} da carteira do cobrador`}
                                className="hover:text-destructive transition-colors"><X size={10} /></button>
                            </Badge>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Quick action buttons */}
                  <div className="flex items-center gap-2 pt-1">
                    <button type="button" onClick={() => setFichaCollector(c.id)}
                      className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium bg-accent/50 text-foreground hover:bg-accent transition-all">
                      <FileText size={12} /> Ver Ficha
                    </button>
                    <button type="button" onClick={() => setAssignCobrancaModal(c.id)}
                      className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium bg-primary/10 text-primary hover:bg-primary/20 transition-all">
                      <DollarSign size={12} /> Atribuir Cobranças
                    </button>
                    <button type="button" onClick={() => handleGenerateToken(c.id)} aria-label={`Gerar token para ${c.name || "cobrador"}`}
                      className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium bg-accent/50 text-foreground hover:bg-accent transition-all">
                      <Key size={12} />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ============ FICHA DO COBRADOR ============ */}
      <Dialog open={!!fichaCollector} onOpenChange={() => setFichaCollector(null)}>
        <DialogContent className="w-[calc(100vw-1.5rem)] sm:max-w-2xl max-h-[90dvh] overflow-y-auto">
          {fichaData && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-xl bg-linear-to-br from-primary/20 to-primary/5 flex items-center justify-center text-lg font-bold text-primary border border-primary/10">
                    {fichaData.name?.charAt(0)?.toUpperCase()}
                  </div>
                  <div>
                    <p className="text-lg font-bold text-foreground">{fichaData.name}</p>
                    <p className="text-sm text-muted-foreground font-normal">{fichaData.city}/{fichaData.state}</p>
                  </div>
                </DialogTitle>
              </DialogHeader>

              <div className="space-y-5 mt-2">
                {/* Contact Info */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="flex items-center gap-2.5 p-3 rounded-xl bg-accent/20 border border-border/50">
                    <Phone size={14} className="text-primary shrink-0" />
                    <div>
                      <p className="text-[10px] text-muted-foreground uppercase">Telefone</p>
                      <p className="text-sm font-medium text-foreground">{fichaData.phone}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2.5 p-3 rounded-xl bg-accent/20 border border-border/50">
                    <Mail size={14} className="text-primary shrink-0" />
                    <div>
                      <p className="text-[10px] text-muted-foreground uppercase">E-mail</p>
                      <p className="text-sm font-medium text-foreground truncate">{fichaData.email || "—"}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2.5 p-3 rounded-xl bg-accent/20 border border-border/50">
                    <Calendar size={14} className="text-primary shrink-0" />
                    <div>
                      <p className="text-[10px] text-muted-foreground uppercase">Cadastro</p>
                      <p className="text-sm font-medium text-foreground">{formatBR(fichaData.created_at)}</p>
                    </div>
                  </div>
                </div>

                {/* Financial Stats */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div className="p-3 rounded-xl border border-border bg-card">
                    <p className="text-[10px] text-muted-foreground uppercase">Clientes</p>
                    <p className="text-xl font-bold text-foreground">{fichaAssignments.length}</p>
                  </div>
                  <div className="p-3 rounded-xl border border-border bg-card">
                    <p className="text-[10px] text-muted-foreground uppercase">A Receber</p>
                    <p className="text-base sm:text-lg font-bold leading-tight text-amber-500 wrap-break-word">R$ {fmt(fichaTotalPending)}</p>
                  </div>
                  <div className="p-3 rounded-xl border border-border bg-card">
                    <p className="text-[10px] text-muted-foreground uppercase">Atrasado</p>
                    <p className="text-base sm:text-lg font-bold leading-tight text-destructive wrap-break-word">R$ {fmt(fichaTotalOverdue)}</p>
                  </div>
                  <div className="p-3 rounded-xl border border-border bg-card">
                    <p className="text-[10px] text-muted-foreground uppercase">Recebido</p>
                    <p className="text-base sm:text-lg font-bold leading-tight text-success wrap-break-word">R$ {fmt(fichaTotalPaid)}</p>
                  </div>
                </div>

                {/* Tokens */}
                {fichaTokens.length > 0 && (
                  <div>
                    <h3 className="text-sm font-semibold text-foreground mb-2 flex items-center gap-2">
                      <Key size={14} className="text-primary" /> Tokens de Acesso
                    </h3>
                    <div className="space-y-1.5">
                      {fichaTokens.map((t: any) => (
                        <div key={t.id} className="flex items-center gap-2 p-2.5 rounded-xl bg-muted/30 border border-border/50">
                          <span className="text-xs font-mono text-foreground flex-1 truncate">{t.token}</span>
                          <Badge variant="outline" className={`text-[10px] ${t.is_active ? "bg-success/10 text-success border-success/20" : "bg-destructive/10 text-destructive border-destructive/20"}`}>
                            {t.is_active ? "Ativo" : "Revogado"}
                          </Badge>
                          <button onClick={() => void copyText(t.token)}
                            className="p-1 rounded hover:bg-accent text-muted-foreground"><Copy size={12} /></button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Assigned Clients with Installments */}
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
                      <Users size={14} className="text-primary" /> Clientes & Cobranças Atribuídas
                    </h3>
                    <button onClick={() => { setFichaCollector(null); setAssignCobrancaModal(fichaCollector); }}
                      className="flex items-center gap-1 text-xs font-medium text-primary hover:text-primary/80 transition-colors">
                      <Plus size={12} /> Atribuir
                    </button>
                  </div>

                  {fichaAssignments.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-6">Nenhum cliente atribuído</p>
                  ) : (
                    <div className="space-y-3">
                      {fichaAssignments.map((a: any) => {
                        const clientInst = fichaInstallments.filter((i: any) => i.client_id === a.client_id);
                        const clientPending = clientInst.filter((i: any) => isEmAberto(i));
                        const clientOverdue = clientPending.filter((i: any) => isEmAtraso(i, now));
                        const clientTotal = clientPending.reduce((s: number, i: any) => s + safeNumber(i.amount), 0);

                        return (
                          <div key={a.id} className="rounded-xl border border-border bg-card/50 overflow-hidden">
                            <div className="flex items-center gap-3 px-4 py-3 border-b border-border/50">
                              <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center text-sm font-bold text-primary">
                                {a.clients?.name?.charAt(0)?.toUpperCase()}
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-semibold text-foreground truncate">{a.clients?.name}</p>
                                <p className="text-[11px] text-muted-foreground">
                                  {a.clients?.phone || a.clients?.whatsapp || "Sem telefone"}
                                  {a.clients?.cpf_cnpj && ` · ${a.clients.cpf_cnpj}`}
                                </p>
                              </div>
                              <div className="text-right shrink-0">
                                <p className="text-sm font-bold text-foreground">R$ {fmt(clientTotal)}</p>
                                <div className="flex items-center gap-2">
                                  {clientOverdue.length > 0 && (
                                    <Badge variant="outline" className="text-[10px] bg-destructive/10 text-destructive border-destructive/20">
                                      {clientOverdue.length} atrasada(s)
                                    </Badge>
                                  )}
                                  {clientPending.length > 0 && clientOverdue.length === 0 && (
                                    <Badge variant="outline" className="text-[10px] bg-amber-500/10 text-amber-500 border-amber-500/20">
                                      {clientPending.length} pendente(s)
                                    </Badge>
                                  )}
                                  {clientPending.length === 0 && (
                                    <Badge variant="outline" className="text-[10px] bg-success/10 text-success border-success/20">
                                      Em dia
                                    </Badge>
                                  )}
                                </div>
                              </div>
                            </div>
                            {clientPending.length > 0 && (
                              <div className="divide-y divide-border/30 max-h-40 overflow-y-auto">
                                {clientPending.slice(0, 5).map((inst: any) => {
                                  const isOverdue = isEmAtraso(inst, now);
                                  return (
                                    <div key={inst.id} className="flex items-center gap-3 px-4 py-2">
                                      <div className={`w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold ${
                                        isOverdue ? "bg-destructive/10 text-destructive" : "bg-amber-500/10 text-amber-500"
                                      }`}>
                                        {inst.installment_number}
                                      </div>
                                      <div className="flex-1">
                                        <p className="text-xs font-medium text-foreground">R$ {fmt(Number(inst.amount))}</p>
                                        <p className="text-[10px] text-muted-foreground">
                                          {formatBR(inst.due_date)}
                                          {isOverdue && (
                                            <span className="text-destructive ml-1">
                                              ({(() => { const due = parseLocalDate(inst.due_date); return due ? Math.max(0, Math.floor((now.getTime() - due.getTime()) / 86400000)) : 0; })()}d atrás)
                                            </span>
                                          )}
                                        </p>
                                      </div>
                                    </div>
                                  );
                                })}
                                {clientPending.length > 5 && (
                                  <p className="text-[10px] text-muted-foreground text-center py-1.5">
                                    +{clientPending.length - 5} parcelas
                                  </p>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>

              <DialogFooter className="gap-2 mt-4">
                <Button variant="outline" onClick={() => setFichaCollector(null)}>Fechar</Button>
                <Button onClick={() => { setFichaCollector(null); setAssignCobrancaModal(fichaData.id); }}
                  className="gap-1.5" style={{ background: "var(--gradient-button)" }}>
                  <DollarSign size={14} /> Atribuir Cobranças
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* ============ ATRIBUIR COBRANÇAS (clientes com parcelas pendentes) ============ */}
      <Dialog open={!!assignCobrancaModal} onOpenChange={() => { setAssignCobrancaModal(null); setCobrancaClientSearch(""); }}>
        <DialogContent className="sm:max-w-lg max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <DollarSign size={18} className="text-primary" />
              Atribuir Cobranças
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground -mt-2">
            Selecione clientes com cobranças pendentes para atribuir ao cobrador. As cobranças ficarão disponíveis no portal do cobrador.
          </p>
          <div className="space-y-3">
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input
                id="collector-billing-client-search"
                name="collector_billing_client_search"
                aria-label="Buscar cliente para atribuir cobranças"
                autoComplete="off"
                value={cobrancaClientSearch}
                onChange={(e) => setCobrancaClientSearch(e.target.value)}
                placeholder="Buscar cliente..."
                className={`${inputCls} pl-9 text-sm`}
                autoFocus
              />
            </div>
            <div className="max-h-96 overflow-y-auto space-y-2 pr-1">
              {clients
                .filter((cl: any) => {
                  const collectorAssigns = assignments.filter((a: any) => a.collector_id === assignCobrancaModal);
                  return !collectorAssigns.some((a: any) => a.client_id === cl.id) &&
                    (!cobrancaClientSearch || (cl.name || "").toLowerCase().includes(cobrancaClientSearch.toLowerCase()));
                })
                .map((cl: any) => {
                  // Find pending installments for this client
                  const clientPendingInst = allInstallments.filter((i: any) =>
                    i.client_id === cl.id && isEmAberto(i)
                  );
                  const clientOverdueInst = clientPendingInst.filter((i: any) => isEmAtraso(i, now));
                  const totalPending = clientPendingInst.reduce((s: number, i: any) => s + safeNumber(i.amount), 0);

                  return (
                    <button type="button" key={cl.id}
                      onClick={() => { handleAssign(assignCobrancaModal!, cl.id); }}
                      className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm hover:bg-accent/50 text-foreground transition-colors text-left border border-border/50 bg-card/50">
                      <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center text-sm font-bold text-primary shrink-0">
                        {cl.name?.charAt(0)?.toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium truncate">{cl.name}</p>
                        <p className="text-[11px] text-muted-foreground">
                          {cl.phone || cl.whatsapp || "Sem telefone"}
                          {cl.cpf_cnpj && ` · ${cl.cpf_cnpj}`}
                        </p>
                      </div>
                      <div className="text-right shrink-0">
                        {clientPendingInst.length > 0 ? (
                          <>
                            <p className="text-sm font-bold text-foreground">R$ {fmt(totalPending)}</p>
                            <div className="flex items-center gap-1">
                              <span className="text-[10px] text-amber-500">{clientPendingInst.length} parcela(s)</span>
                              {clientOverdueInst.length > 0 && (
                                <span className="text-[10px] text-destructive">· {clientOverdueInst.length} atrasada(s)</span>
                              )}
                            </div>
                          </>
                        ) : (
                          <span className="text-[10px] text-success">Em dia</span>
                        )}
                      </div>
                      <ArrowRight size={14} className="text-muted-foreground shrink-0" />
                    </button>
                  );
                })}
              {clients.filter((cl: any) => {
                const collectorAssigns = assignments.filter((a: any) => a.collector_id === assignCobrancaModal);
                return !collectorAssigns.some((a: any) => a.client_id === cl.id) &&
                  (!cobrancaClientSearch || (cl.name || "").toLowerCase().includes(cobrancaClientSearch.toLowerCase()));
              }).length === 0 && (
                <p className="text-center text-sm text-muted-foreground py-6">
                  {cobrancaClientSearch ? "Nenhum cliente encontrado" : "Todos os clientes já foram atribuídos"}
                </p>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Assign Client Dialog */}
      <Dialog open={!!assignModal} onOpenChange={() => { setAssignModal(null); setClientSearch(""); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Users size={18} className="text-primary" />
              Atribuir Cliente
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input
                id="collector-client-search"
                name="collector_client_search"
                aria-label="Buscar cliente para atribuir"
                autoComplete="off"
                value={clientSearch}
                onChange={(e) => setClientSearch(e.target.value)}
                placeholder="Buscar cliente..."
                className={`${inputCls} pl-9 text-sm`}
                autoFocus
              />
            </div>
            <div className="max-h-60 overflow-y-auto space-y-1 pr-1">
              {clients
                .filter((cl: any) => {
                  const collectorAssigns = assignments.filter((a: any) => a.collector_id === assignModal);
                  return !collectorAssigns.some((a: any) => a.client_id === cl.id) &&
                    (!clientSearch || (cl.name || "").toLowerCase().includes(clientSearch.toLowerCase()));
                })
                .map((cl: any) => (
                  <button type="button" key={cl.id}
                    onClick={() => { handleAssign(assignModal!, cl.id); setAssignModal(null); setClientSearch(""); }}
                    className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm hover:bg-accent/50 text-foreground transition-colors text-left">
                    <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center text-xs font-bold text-primary">
                      {cl.name?.charAt(0)?.toUpperCase()}
                    </div>
                    {cl.name}
                  </button>
                ))}
              {clients.filter((cl: any) => {
                const collectorAssigns = assignments.filter((a: any) => a.collector_id === assignModal);
                return !collectorAssigns.some((a: any) => a.client_id === cl.id) &&
                  (!clientSearch || (cl.name || "").toLowerCase().includes(clientSearch.toLowerCase()));
              }).length === 0 && (
                <p className="text-center text-sm text-muted-foreground py-6">
                  {clientSearch ? "Nenhum cliente encontrado" : "Todos os clientes já foram atribuídos"}
                </p>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={!!deleteConfirm} onOpenChange={() => setDeleteConfirm(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle size={18} />
              Excluir Cobrador
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Esta ação é irreversível. Todos os tokens e atribuições deste cobrador serão removidos.
          </p>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setDeleteConfirm(null)}>Cancelar</Button>
            <Button variant="destructive" onClick={() => deleteConfirm && handleDelete(deleteConfirm)}>
              <Trash2 size={14} className="mr-1.5" /> Excluir
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Cobradores;
