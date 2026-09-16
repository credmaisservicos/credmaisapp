import { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useInfiniteQuery } from "@tanstack/react-query";
import { Shield, Search, Activity, FilePlus, Trash2, CreditCard, Edit, Download } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useRealtimeSubscription } from "@/hooks/useRealtimeSubscription";
import ErrorState from "@/components/feedback/ErrorState";
import type { Database } from "@/integrations/supabase/types";
import { formatBRDateTime, todayLocalISO } from "@/lib/dateUtils";

type AuditLog = Database["public"]["Tables"]["audit_logs"]["Row"];
const PAGE_SIZE = 200;
const csvCell = (value: unknown) => {
  let text = String(value ?? "");
  if (/^[=+\-@]/.test(text.trimStart())) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
};
const auditDateTime = (value: unknown) => formatBRDateTime(typeof value === "string" ? value : null) || "data indisponível";

const actionLabels: Record<string, string> = {
  create: "Criação",
  update: "Atualização",
  delete: "Exclusão",
  payment: "Pagamento",
  login: "Login",
  export: "Exportação",
};

const entityLabels: Record<string, string> = {
  contract: "Contrato",
  client: "Cliente",
  installment: "Parcela",
  transaction: "Transação",
  collector: "Cobrador",
  settings: "Configurações",
};

const actionIcons: Record<string, any> = {
  create: FilePlus,
  update: Edit,
  delete: Trash2,
  payment: CreditCard,
};

const actionColors: Record<string, string> = {
  create: "bg-emerald-500/10 text-emerald-500 border-emerald-500/20",
  update: "bg-blue-500/10 text-blue-500 border-blue-500/20",
  delete: "bg-destructive/10 text-destructive border-destructive/20",
  payment: "bg-primary/10 text-primary border-primary/20",
};

const Auditoria = () => {
  const { user } = useAuth();
  const [filterAction, setFilterAction] = useState("");
  const [filterEntity, setFilterEntity] = useState("");
  const [search, setSearch] = useState("");

  useRealtimeSubscription("audit_logs", [["audit-logs", user?.id || ""]]);

  const { data, isLoading, isError, error, refetch, fetchNextPage, hasNextPage, isFetchingNextPage } = useInfiniteQuery({
    queryKey: ["audit-logs", user?.id, filterAction, filterEntity],
    queryFn: async ({ pageParam }) => {
      const query = supabase
        .from("audit_logs")
        .select("*")
        .order("created_at", { ascending: false })
        .range(pageParam, pageParam + PAGE_SIZE - 1);

      let filteredQuery = query;
      if (filterAction) filteredQuery = filteredQuery.eq("action", filterAction);
      if (filterEntity) filteredQuery = filteredQuery.eq("entity_type", filterEntity);

      const { data, error } = await filteredQuery;
      if (error) throw error;
      return (data || []) as AuditLog[];
    },
    initialPageParam: 0,
    getNextPageParam: (lastPage, pages) => lastPage.length === PAGE_SIZE ? pages.length * PAGE_SIZE : undefined,
    enabled: !!user,
  });
  const logs = data?.pages.flat() || [];

  const filteredLogs = search
    ? logs.filter((l) =>
        JSON.stringify(l.details || "").toLowerCase().includes(search.toLowerCase()) ||
        (l.entity_type || "").toLowerCase().includes(search.toLowerCase()) ||
        (l.action || "").toLowerCase().includes(search.toLowerCase())
      )
    : logs;

  const selectCls = "px-3 py-2.5 rounded-2xl bg-card border border-border text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 transition-all";

  const exportCsv = () => {
    const rows = [
      ["Data", "Ação", "Entidade", "ID", "Detalhes"],
      ...filteredLogs.map((l) => [
        auditDateTime(l.created_at),
        actionLabels[l.action] || l.action,
        entityLabels[l.entity_type] || l.entity_type,
        l.entity_id || "",
        JSON.stringify(l.details || {}),
      ]),
    ];
    const csv = rows.map(r => r.map(csvCell).join(",")).join("\r\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `auditoria-${todayLocalISO()}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const statItems = [
    { label: "Ações carregadas", value: logs.length, icon: Activity, color: "text-primary", bg: "bg-primary/10" },
    { label: "Criações", value: logs.filter((l) => l.action === "create").length, icon: FilePlus, color: "text-emerald-500", bg: "bg-emerald-500/10" },
    { label: "Pagamentos", value: logs.filter((l) => l.action === "payment").length, icon: CreditCard, color: "text-blue-500", bg: "bg-blue-500/10" },
    { label: "Exclusões", value: logs.filter((l) => l.action === "delete").length, icon: Trash2, color: "text-destructive", bg: "bg-destructive/10" },
  ];

  return (
    <div className="space-y-6">
      <div className="page-hero animate-fade-in">
        <div className="page-hero-content flex items-center gap-3">
          <div className="page-hero-icon">
            <Shield size={22} />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-shimmer">Auditoria</h1>
            <p className="text-sm text-muted-foreground mt-0.5">Histórico rastreável das ações do sistema</p>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 animate-fade-in" style={{ animationDelay: "100ms" }}>
        <div className="relative flex-1 min-w-[200px]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar nos logs..."
            aria-label="Buscar nos logs de auditoria"
            className={`${selectCls} pl-9 w-full`}
          />
        </div>
        <select name="audit-action-filter" aria-label="Filtrar por ação" value={filterAction} onChange={(e) => setFilterAction(e.target.value)} className={selectCls}>
          <option value="">Todas as ações</option>
          {Object.entries(actionLabels).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
        <select name="audit-entity-filter" aria-label="Filtrar por entidade" value={filterEntity} onChange={(e) => setFilterEntity(e.target.value)} className={selectCls}>
          <option value="">Todas as entidades</option>
          {Object.entries(entityLabels).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
        <button
          type="button"
          onClick={exportCsv}
          disabled={filteredLogs.length === 0}
          className="px-4 py-2.5 rounded-2xl bg-primary text-primary-foreground text-sm font-medium flex items-center gap-2 hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
        >
          <Download size={14} /> Exportar CSV
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
        {statItems.map((s, idx) => (
          <div key={s.label} className="rounded-2xl border border-border bg-card p-4 animate-fade-in card-hover" style={{ animationDelay: `${(idx + 1) * 80}ms` }}>
            <div className="flex items-center gap-2 mb-2">
              <div className={`w-8 h-8 rounded-lg ${s.bg} flex items-center justify-center`}>
                <s.icon size={16} className={s.color} />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">{s.label}</p>
            <p className="text-2xl font-bold text-foreground mt-1">{s.value}</p>
          </div>
        ))}
      </div>

      {/* Log list */}
      <div className="rounded-2xl border border-border bg-card overflow-hidden animate-fade-in">
        {isLoading ? (
          <div className="p-5 space-y-3">
            {[1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-12 rounded-lg" />)}
          </div>
        ) : isError ? (
          <div className="p-5"><ErrorState error={error} onRetry={() => refetch()} /></div>
        ) : filteredLogs.length === 0 ? (
          <div className="py-16 text-center">
            <Shield size={48} className="mx-auto text-muted-foreground/20 mb-4" />
            <p className="text-sm text-muted-foreground">Nenhum registro encontrado</p>
          </div>
        ) : (
          <div className="divide-y divide-border max-h-[600px] overflow-y-auto">
            {filteredLogs.map((log) => {
              const details = log.details && !Array.isArray(log.details) && typeof log.details === "object" ? log.details : {};
              const Icon = actionIcons[log.action] || Activity;
              return (
                <div key={log.id} className="flex items-start gap-3 px-5 py-3.5 hover:bg-accent/50 transition-colors">
                  <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 mt-0.5 ${actionColors[log.action]?.split(" ")[0] || "bg-muted"}`}>
                    <Icon size={16} className={actionColors[log.action]?.split(" ")[1] || "text-muted-foreground"} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge variant="outline" className={actionColors[log.action] || "bg-muted text-muted-foreground border-border"}>
                        {actionLabels[log.action] || log.action}
                      </Badge>
                      <span className="text-sm text-foreground font-medium">
                        {entityLabels[log.entity_type] || log.entity_type}
                      </span>
                      {typeof details.description === "string" && (
                        <span className="text-xs text-muted-foreground truncate">— {details.description}</span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      {auditDateTime(log.created_at)}
                      {log.entity_id && <span className="ml-2 opacity-50">ID: {log.entity_id.slice(0, 8)}…</span>}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
        {!isLoading && !isError && hasNextPage && (
          <div className="p-4 border-t border-border text-center">
            <button type="button" onClick={() => fetchNextPage()} disabled={isFetchingNextPage} className="px-4 py-2 rounded-xl border border-border text-sm hover:bg-accent disabled:opacity-50">
              {isFetchingNextPage ? "Carregando..." : "Carregar mais 200 registros"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default Auditoria;
