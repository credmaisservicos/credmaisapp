import { useState, useEffect, useMemo } from "react";
import { Table, Download, Search, X, ArrowUpDown, Filter, Users, DollarSign } from "lucide-react";
import EmptyState from "@/components/EmptyState";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { fetchAll } from "@/lib/fetchAll";
import { useNavigate } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import ErrorState from "@/components/feedback/ErrorState";
import { buildClientSpreadsheetRows } from "@/lib/clientSpreadsheet";

const safeNumber = (value: unknown) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
};
const fmt = (v: number) => safeNumber(v).toLocaleString("pt-BR", { minimumFractionDigits: 2 });
const csvCell = (value: unknown) => {
  let text = String(value ?? "");
  if (/^[=+\-@]/.test(text.trimStart())) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
};

const Planilha = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [clients, setClients] = useState<any[]>([]);
  const [contracts, setContracts] = useState<any[]>([]);
  const [installments, setInstallments] = useState<any[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [sortBy, setSortBy] = useState<"name" | "capital" | "status">("name");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  useEffect(() => {
    if (!user) return;
    const fetch = async () => {
      try {
        const [c, ct, i] = await Promise.all([
          fetchAll((f, t) => supabase.from("clients").select("*").eq("user_id", user.id).order("name").range(f, t)),
          fetchAll((f, t) => supabase.from("contracts").select("*").eq("user_id", user.id).range(f, t)),
          fetchAll((f, t) => supabase.from("contract_installments").select("*").eq("user_id", user.id).range(f, t)),
        ]);
        setClients(c);
        setContracts(ct);
        setInstallments(i);
        setLoadError(null);
      } catch (error) {
        setLoadError(error);
      } finally {
        setLoading(false);
      }
    };
    fetch();
    const ch = supabase
      .channel("realtime-planilha")
      .on("postgres_changes" as any, { event: "*", schema: "public", table: "clients", filter: `user_id=eq.${user.id}` }, fetch)
      .on("postgres_changes" as any, { event: "*", schema: "public", table: "contracts", filter: `user_id=eq.${user.id}` }, fetch)
      .on("postgres_changes" as any, { event: "*", schema: "public", table: "contract_installments", filter: `user_id=eq.${user.id}` }, fetch)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [user]);

  const enriched = useMemo(
    () => buildClientSpreadsheetRows(clients, contracts, installments),
    [clients, contracts, installments],
  );

  const filtered = enriched.filter((c) =>
    `${c.name} ${c.cpf_cnpj || ""} ${c.phone || ""}`.toLowerCase().includes(search.toLowerCase())
  );

  const sorted = [...filtered].sort((a, b) => {
    const dir = sortDir === "asc" ? 1 : -1;
    if (sortBy === "name") return String(a.name || "").localeCompare(String(b.name || ""), "pt-BR") * dir;
    if (sortBy === "capital") return (safeNumber(a.totalCapital) - safeNumber(b.totalCapital)) * dir;
    return String(a.status || "").localeCompare(String(b.status || ""), "pt-BR") * dir;
  });

  const toggleSort = (col: typeof sortBy) => {
    if (sortBy === col) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortBy(col); setSortDir("asc"); }
  };

  const totals = useMemo(() => ({
    capital: enriched.reduce((s, c) => s + c.totalCapital, 0),
    amount: enriched.reduce((s, c) => s + c.totalAmount, 0),
    paid: enriched.reduce((s, c) => s + c.totalPaid, 0),
    overdue: enriched.reduce((s, c) => s + c.overdueCount, 0),
  }), [enriched]);

  const handleExportCSV = () => {
    const header = ["Nome", "CPF/CNPJ", "Telefone", "Status", "Capital", "Total", "Pago", "Contratos", "Parcelas Pagas", "Parcelas Total", "Atrasadas"].map(csvCell).join(",");
    const rows = sorted.map(c => [c.name, c.cpf_cnpj, c.phone, c.status, safeNumber(c.totalCapital).toFixed(2), safeNumber(c.totalAmount).toFixed(2), safeNumber(c.totalPaid).toFixed(2), c.contractCount, c.paidCount, c.totalInstallments, c.overdueCount].map(csvCell).join(",")).join("\r\n");
    const blob = new Blob([`\uFEFF${header}\r\n${rows}`], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "planilha-clientes.csv";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="page-hero">
        <div className="page-hero-content flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="page-hero-icon">
              <Table size={22} />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-shimmer">Planilha</h1>
              <p className="text-muted-foreground text-sm mt-0.5">Visão completa dos dados de todos os clientes</p>
            </div>
          </div>
          <button type="button" onClick={handleExportCSV} disabled={loading || sorted.length === 0} className="btn-premium disabled:opacity-50 disabled:cursor-not-allowed">
            <Download size={16} /> Exportar CSV
          </button>
        </div>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-1 min-[420px]:grid-cols-2 sm:grid-cols-4 gap-3 stagger-fade-in">
        {[
          { label: "Clientes", value: enriched.length, icon: Users, color: "text-foreground" },
          { label: "Capital Total", value: `R$ ${fmt(totals.capital)}`, icon: DollarSign, color: "text-primary" },
          { label: "Total Pago", value: `R$ ${fmt(totals.paid)}`, icon: DollarSign, color: "text-success" },
          { label: "Atrasadas", value: totals.overdue, icon: Filter, color: "text-destructive" },
        ].map(s => (
          <div key={s.label} className="rounded-2xl border border-border bg-card p-4 card-shine">
            <div className="flex items-center gap-2 mb-1">
              <s.icon size={14} className={s.color} />
              <span className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold">{s.label}</span>
            </div>
            <p className={`text-lg font-bold ${s.color}`}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* Search */}
      <div className="relative">
        <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <input type="text" placeholder="Buscar cliente..." value={search} onChange={(e) => setSearch(e.target.value)}
          aria-label="Buscar cliente na planilha" className="w-full pl-10 pr-10 py-3 rounded-2xl bg-card border border-border text-foreground placeholder:text-muted-foreground text-sm input-enhanced" />
        {search && (
          <button type="button" onClick={() => setSearch("")} aria-label="Limpar busca" className="absolute right-3 top-1/2 -translate-y-1/2 p-1 rounded-md hover:bg-accent text-muted-foreground"><X size={14} /></button>
        )}
      </div>

      {loading ? (
        <div className="space-y-2">{[1,2,3,4].map(i => <div key={i} className="h-14 rounded-xl skeleton-shimmer" />)}</div>
      ) : loadError ? (
        <ErrorState error={loadError} onRetry={() => { setLoading(true); setLoadError(null); window.location.reload(); }} />
      ) : sorted.length === 0 ? (
        <EmptyState
          icon={Users}
          title="Nenhum cliente encontrado"
          description="Ajuste a busca ou os filtros, ou cadastre seu primeiro cliente."
        />
      ) : (
        <div className="rounded-2xl border border-border overflow-x-auto bg-card" role="region" aria-label="Planilha de clientes" tabIndex={0}>
          <table className="w-full text-sm min-w-[900px]">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                {[
                  { key: "name" as const, label: "Cliente" },
                  { key: "capital" as const, label: "Capital" },
                  { key: "status" as const, label: "Status" },
                ].map(col => (
                  <th key={col.key} aria-sort={sortBy === col.key ? (sortDir === "asc" ? "ascending" : "descending") : "none"}
                    className="text-left px-4 py-3 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                    <button type="button" onClick={() => toggleSort(col.key)}
                      className="inline-flex items-center gap-1 rounded-md text-left hover:text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary/60">
                      {col.label} <ArrowUpDown size={10} className={sortBy === col.key ? "text-primary" : "opacity-30"} />
                    </button>
                  </th>
                ))}
                <th className="text-left px-4 py-3 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Total</th>
                <th className="text-left px-4 py-3 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Pago</th>
                <th className="text-left px-4 py-3 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Progresso</th>
                <th className="text-left px-4 py-3 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Atraso</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((c) => {
                const pct = c.totalInstallments > 0
                  ? Math.max(0, Math.min(100, Math.round((c.paidCount / c.totalInstallments) * 100)))
                  : 0;
                return (
                  <tr key={c.id} role="link" tabIndex={0} aria-label={`Abrir cliente ${c.name}`} onClick={() => navigate(`/clientes/${c.id}`)} onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      navigate(`/clientes/${c.id}`);
                    }
                  }}
                    className="border-t border-border hover:bg-accent/30 cursor-pointer transition-colors group">
                    <td className="px-4 py-3">
                      <p className="font-medium text-foreground group-hover:text-primary transition-colors">{c.name}</p>
                      <p className="text-xs text-muted-foreground">{c.cpf_cnpj || c.phone || "—"}</p>
                    </td>
                    <td className="px-4 py-3 font-semibold text-foreground">R$ {fmt(c.totalCapital)}</td>
                    <td className="px-4 py-3">
                      <Badge variant="outline" className={c.status === "Ativo" ? "bg-success/10 text-success border-success/20" : "bg-muted text-muted-foreground"}>
                        {c.status}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">R$ {fmt(c.totalAmount)}</td>
                    <td className="px-4 py-3 text-success font-medium">R$ {fmt(c.totalPaid)}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="w-20 h-2 rounded-full bg-muted overflow-hidden">
                          <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${pct}%` }} />
                        </div>
                        <span className="text-[10px] text-muted-foreground font-medium">{c.paidCount}/{c.totalInstallments}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      {c.overdueCount > 0 ? (
                        <span className="text-xs font-bold text-destructive bg-destructive/10 px-2 py-0.5 rounded-md">{c.overdueCount}</span>
                      ) : (
                        <span className="text-xs text-muted-foreground/50">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default Planilha;
