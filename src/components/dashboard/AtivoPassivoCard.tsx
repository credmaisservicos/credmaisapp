import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { TrendingUp, TrendingDown, Landmark, Wallet, AlertTriangle } from "lucide-react";
import { Link } from "react-router-dom";

const brl = (n: number) => (Number(n) || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

type Data = {
  ativo_capital: number;
  ativo_a_receber: number;
  passivo_captado: number;
  passivo_a_pagar: number;
  alocado_capital: number;
};

export default function AtivoPassivoCard() {
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    (async () => {
      setLoading(true);
      setError(null);
      const { data: res, error: queryError } = await supabase.rpc("get_ativo_passivo" as never);
      if (queryError) {
        setError("Não foi possível carregar o balanço da operação.");
        setLoading(false);
        return;
      }
      setData((res as any) || null);
      setLoading(false);
    })();
  }, [attempt]);

  if (error) return (
    <div className="rounded-2xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
      <p>{error}</p>
      <button type="button" className="mt-2 font-semibold underline underline-offset-4" onClick={() => setAttempt((value) => value + 1)}>Tentar novamente</button>
    </div>
  );

  if (loading || !data) return null;

  const spread = data.ativo_a_receber - data.passivo_a_pagar;
  const spreadPositive = spread >= 0;
  const cobertura = data.ativo_capital > 0 ? (data.alocado_capital / data.ativo_capital) * 100 : 0;
  const alerta = data.passivo_captado > data.ativo_capital && data.passivo_captado > 0;

  // Nada a mostrar se o usuário ainda não tem investidores nem contratos
  if (data.ativo_capital === 0 && data.passivo_captado === 0) return null;

  return (
    <div className="rounded-2xl border border-white/[.08] bg-card/55 p-5 backdrop-blur-xl">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-widest text-primary/80">Balanço da Operação</p>
          <h3 className="mt-0.5 font-heading text-lg font-bold text-white">Ativo × Passivo</h3>
        </div>
        <Link
          to="/investidores"
          className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] text-white/70 hover:bg-white/10"
        >
          Ver investidores →
        </Link>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        {/* Ativo */}
        <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4">
          <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-emerald-300">
            <TrendingUp className="h-3.5 w-3.5" /> Ativo (na rua)
          </div>
          <p className="mt-2 font-mono text-2xl font-bold text-white">{brl(data.ativo_capital)}</p>
          <p className="mt-1 text-[11px] text-white/50">A receber: <b className="text-emerald-300">{brl(data.ativo_a_receber)}</b></p>
        </div>

        {/* Passivo */}
        <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4">
          <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-amber-300">
            <TrendingDown className="h-3.5 w-3.5" /> Passivo (captado)
          </div>
          <p className="mt-2 font-mono text-2xl font-bold text-white">{brl(data.passivo_captado)}</p>
          <p className="mt-1 text-[11px] text-white/50">A pagar: <b className="text-amber-300">{brl(data.passivo_a_pagar)}</b></p>
        </div>

        {/* Spread */}
        <div className={`rounded-xl border p-4 ${spreadPositive ? "border-primary/30 bg-primary/10" : "border-red-500/30 bg-red-500/10"}`}>
          <div className={`flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest ${spreadPositive ? "text-primary" : "text-red-300"}`}>
            <Wallet className="h-3.5 w-3.5" /> Spread líquido
          </div>
          <p className={`mt-2 font-mono text-2xl font-bold ${spreadPositive ? "text-white" : "text-red-200"}`}>{brl(spread)}</p>
          <p className="mt-1 text-[11px] text-white/50">
            {spreadPositive ? "Você recebe mais do que paga" : "Atenção: passivo maior que ativo"}
          </p>
        </div>
      </div>

      {/* Cobertura */}
      {data.passivo_captado > 0 && (
        <div className="mt-4">
          <div className="mb-1.5 flex justify-between text-[11px] text-white/60">
            <span className="flex items-center gap-1"><Landmark className="h-3 w-3" /> Capital lastreado por investidores</span>
            <b className="text-white">{cobertura.toFixed(1)}%</b>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-white/5">
            <div
              className={`h-full rounded-full ${cobertura > 100 ? "bg-red-400" : "bg-gradient-to-r from-primary to-violet-400"}`}
              style={{ width: `${Math.min(100, cobertura)}%` }}
            />
          </div>
        </div>
      )}

      {alerta && (
        <div className="mt-3 flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-200">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            Alerta: seu passivo com investidores ({brl(data.passivo_captado)}) é maior que seu capital ativo na rua ({brl(data.ativo_capital)}).
            Considere reduzir captação ou aumentar empréstimos.
          </span>
        </div>
      )}
    </div>
  );
}
