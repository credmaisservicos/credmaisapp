import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Landmark } from "lucide-react";
import { fetchAll } from "@/lib/fetchAll";

type Option = {
  id: string;
  principal: number;
  total_due: number;
  paid_amount: number;
  investor_name: string;
  status: string;
};

/**
 * Seletor opcional para vincular um contrato de cliente a uma
 * captação (investor_loan) do credor.
 */
export default function InvestorAllocationSelect({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (id: string | null) => void;
}) {
  const [options, setOptions] = useState<Option[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    (async () => {
      setLoading(true);
      setLoadError(false);
      try {
        const data = await fetchAll((from, to) => (supabase.from("investor_loans" as never) as any)
          .select("id, principal, total_due, paid_amount, status, investors(name)")
          .neq("status", "paid")
          .order("created_at", { ascending: false })
          .range(from, to));
        const rows = data.map((r: any) => ({
        id: String(r.id || ""),
        principal: Number.isFinite(Number(r.principal)) ? Number(r.principal) : 0,
        total_due: Number.isFinite(Number(r.total_due)) ? Number(r.total_due) : 0,
        paid_amount: Number.isFinite(Number(r.paid_amount)) ? Number(r.paid_amount) : 0,
        status: r.status,
        investor_name: r.investors?.name || "Investidor",
        }));
        setOptions(rows);
      } catch {
        setOptions([]);
        setLoadError(true);
      } finally {
        setLoading(false);
      }
    })();
  }, [reloadKey]);

  if (loading) return null;
  if (loadError) return <button type="button" onClick={() => setReloadKey((key) => key + 1)} className="text-xs text-destructive underline">Não foi possível carregar os investidores. Tentar novamente</button>;
  if (options.length === 0) return null;

  return (
    <div className="rounded-xl border border-primary/20 bg-primary/5 p-3">
      <label htmlFor="investor-allocation" className="flex items-center gap-1.5 text-xs font-semibold text-primary">
        <Landmark className="h-3.5 w-3.5" /> Alocação de capital (opcional)
      </label>
      <p className="mt-1 text-[11px] text-white/50">
        Vincule este empréstimo ao capital captado de um investidor específico.
      </p>
      <select
        id="investor-allocation"
        name="investor_allocation"
        value={value || ""}
        onChange={(e) => onChange(e.target.value || null)}
        className="mt-2 w-full rounded-lg border border-white/10 bg-slate-900/50 px-3 py-2 text-sm text-white outline-hidden focus:border-primary"
      >
        <option value="">— Capital próprio —</option>
        {options.map((o) => {
          const saldo = Math.max(0, (Number.isFinite(o.total_due) ? o.total_due : 0) - (Number.isFinite(o.paid_amount) ? o.paid_amount : 0));
          return (
            <option key={o.id} value={o.id}>
              {o.investor_name} — {o.principal.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
              {" "}(dívida restante {saldo.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })})
            </option>
          );
        })}
      </select>
    </div>
  );
}
