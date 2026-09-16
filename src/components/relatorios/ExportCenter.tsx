import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { fetchAll } from "@/lib/fetchAll";
import { toast } from "sonner";
import { Download, FileSpreadsheet, Users, FileSignature, Receipt, Wallet, TrendingUp, Loader2 } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { buildReportDateRange } from "@/lib/reportPeriod";
import { todayLocalISO } from "@/lib/dateUtils";

type EntityKey = "clients" | "contracts" | "contract_installments" | "transactions" | "profits" | "expenses";

interface EntityDef {
  key: EntityKey;
  label: string;
  hint: string;
  icon: LucideIcon;
  color: string;
  dated: boolean; // filter by date range
  dateField?: string;
}

const ENTITIES: EntityDef[] = [
  { key: "clients", label: "Clientes", hint: "Todos os clientes cadastrados", icon: Users, color: "text-primary", dated: false },
  { key: "contracts", label: "Contratos", hint: "Contratos criados no período", icon: FileSignature, color: "text-info", dated: true, dateField: "created_at" },
  // Apontava para `installments`, a tabela legada substituída por
  // `contract_installments` — a exportação de parcelas vinha sempre VAZIA.
  { key: "contract_installments", label: "Parcelas", hint: "Parcelas com vencimento no período", icon: Receipt, color: "text-warning", dated: true, dateField: "due_date" },
  { key: "transactions", label: "Caixa", hint: "Entradas e saídas do período", icon: Wallet, color: "text-info", dated: true, dateField: "date" },
  { key: "profits", label: "Lucros", hint: "Lucros lançados no período", icon: TrendingUp, color: "text-success", dated: true, dateField: "date" },
  { key: "expenses", label: "Despesas", hint: "Despesas do período", icon: Wallet, color: "text-destructive", dated: true, dateField: "date" },
];

const toCSV = (rows: any[]): string => {
  if (!rows.length) return "";
  const headers = Object.keys(rows[0]);
  const escape = (v: unknown) => {
    if (v === null || v === undefined) return "";
    const raw = typeof v === "object" ? JSON.stringify(v) : String(v);
    const s = /^[=+\-@]/.test(raw.trimStart()) ? `'${raw}` : raw;
    return `"${s.replace(/"/g, '""')}"`;
  };
  return [headers.join(","), ...rows.map((r) => headers.map((h) => escape(r[h])).join(","))].join("\n");
};

const download = (name: string, content: string, type = "text/csv;charset=utf-8;") => {
  const blob = new Blob(["\ufeff" + content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
};

const ExportCenter = () => {
  const { user } = useAuth();
  const today = new Date();
  const monthStart = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-01`;
  const [from, setFrom] = useState(monthStart);
  const [to, setTo] = useState(todayLocalISO());
  const [selected, setSelected] = useState<Set<EntityKey>>(new Set(["contracts", "contract_installments"]));
  const [busy, setBusy] = useState<EntityKey | "all" | null>(null);

  const toggle = (k: EntityKey) => {
    const next = new Set(selected);
    if (next.has(k)) next.delete(k);
    else next.add(k);
    setSelected(next);
  };

  const fetchEntity = async (def: EntityDef) => {
    const range = buildReportDateRange(from, to);
    if (!range) throw new Error("Informe um período válido para exportação.");
    return fetchAll((f, t) => {
      let q = supabase.from(def.key).select("*").eq("user_id", user!.id).range(f, t);
      if (def.dated && def.dateField) {
        const isDateOnly = def.dateField === "due_date";
        q = q.gte(def.dateField, isDateOnly ? range.startDay : range.startDateTime)
          .lte(def.dateField, isDateOnly ? range.endDay : range.endDateTime);
      }
      return q;
    });
  };

  const exportOne = async (def: EntityDef) => {
    if (!user) return;
    setBusy(def.key);
    try {
      const rows = await fetchEntity(def);
      if (!rows.length) {
        toast.warning(`Nenhum registro em ${def.label.toLowerCase()} no período.`);
      } else {
        download(`${def.key}-${from}_a_${to}.csv`, toCSV(rows));
        toast.success(`${def.label}: ${rows.length} registro(s) exportados.`);
      }
    } catch (e: any) {
      toast.error(`Erro ao exportar ${def.label}: ${e.message}`);
    } finally {
      setBusy(null);
    }
  };

  const exportSelected = async () => {
    if (!user || selected.size === 0) return;
    setBusy("all");
    try {
      const defs = ENTITIES.filter((e) => selected.has(e.key));
      const results = await Promise.all(defs.map(async (d) => ({ def: d, rows: await fetchEntity(d) })));
      let count = 0;
      results.forEach(({ def, rows }) => {
        if (rows.length) {
          download(`${def.key}-${from}_a_${to}.csv`, toCSV(rows));
          count++;
        }
      });
      toast.success(`${count} arquivo(s) exportado(s).`);
    } catch (e: any) {
      toast.error("Erro ao exportar: " + e.message);
    } finally {
      setBusy(null);
    }
  };

  const setPreset = (days: number) => {
    const end = new Date();
    const start = new Date();
    start.setDate(end.getDate() - days);
    const local = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    setFrom(local(start));
    setTo(local(end));
  };

  return (
    <section className="overflow-hidden rounded-2xl border border-border/60 bg-card/65 animate-fade-in">
      <div className="flex flex-col gap-4 border-b border-border/40 px-4 py-4 sm:px-5 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-2">
          <FileSpreadsheet size={16} className="text-emerald-500" />
          <div>
            <h2 className="text-sm font-bold text-foreground uppercase tracking-widest">Central de Exportação</h2>
            <p className="text-[11px] text-muted-foreground">Baixe dados brutos em CSV (abre no Excel/Google Sheets)</p>
          </div>
        </div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:flex lg:flex-wrap lg:items-center">
          <div className="flex min-w-0 items-center gap-2 rounded-xl border border-border/40 bg-background/40 px-3 py-2">
            <label className="text-[10px] font-bold text-muted-foreground uppercase">De</label>
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)}
              aria-label="Data inicial da exportação" className="min-w-0 flex-1 bg-transparent text-xs font-semibold focus:outline-none [color-scheme:dark]" />
          </div>
          <div className="flex min-w-0 items-center gap-2 rounded-xl border border-border/40 bg-background/40 px-3 py-2">
            <label className="text-[10px] font-bold text-muted-foreground uppercase">Até</label>
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)}
              min={from} aria-label="Data final da exportação" className="min-w-0 flex-1 bg-transparent text-xs font-semibold focus:outline-none [color-scheme:dark]" />
          </div>
          <div className="flex items-center gap-1 sm:col-span-2">
            {[
              { label: "7d", d: 7 },
              { label: "30d", d: 30 },
              { label: "90d", d: 90 },
            ].map((p) => (
              <button type="button" key={p.label} onClick={() => setPreset(p.d)}
                className="px-2.5 py-2 rounded-lg text-[11px] font-bold text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors">
                {p.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="p-5 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {ENTITIES.map((e) => {
            const active = selected.has(e.key);
            const Icon = e.icon;
            const isBusy = busy === e.key;
            return (
              <div key={e.key}
                className={`rounded-2xl border p-4 transition-all ${active ? "border-primary/40 bg-primary/5" : "border-border/40 bg-card/40 hover:border-border"}`}>
                <div className="flex items-start justify-between gap-2 mb-3">
                  <label className="flex items-start gap-3 cursor-pointer flex-1 min-w-0">
                    <input type="checkbox" name={`export_${e.key}`} aria-label={`Selecionar ${e.label}`} checked={active} onChange={() => toggle(e.key)}
                      className="mt-1 w-4 h-4 rounded accent-primary" />
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <Icon size={14} className={e.color} />
                        <p className="text-sm font-bold text-foreground">{e.label}</p>
                      </div>
                      <p className="text-[11px] text-muted-foreground mt-0.5">{e.hint}</p>
                    </div>
                  </label>
                </div>
                <button type="button" onClick={() => exportOne(e)} disabled={isBusy || !user}
                  className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-xl bg-card/70 border border-border/40 text-[11px] font-bold hover:border-primary/40 hover:text-primary transition-all disabled:opacity-50">
                  {isBusy ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />}
                  Baixar CSV
                </button>
              </div>
            );
          })}
        </div>

        <div className="flex flex-col gap-3 border-t border-border/30 pt-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-[11px] text-muted-foreground">
            {selected.size === 0 ? "Selecione pelo menos uma entidade" : `${selected.size} entidade(s) selecionada(s)`}
          </p>
          <button type="button" onClick={exportSelected} disabled={selected.size === 0 || busy === "all"}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 px-5 py-2.5 text-xs font-bold text-white hover:bg-emerald-500 disabled:opacity-50 sm:w-auto">
            {busy === "all" ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
            Exportar selecionadas
          </button>
        </div>
      </div>
    </section>
  );
};

export default ExportCenter;
