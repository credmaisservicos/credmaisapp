import { Credinho } from "@/components/brand/Credinho";
import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { CheckCircle2, ArrowRight, Mail, Loader2, AlertCircle, Clock } from "lucide-react";
import { useWhiteLabel } from "@/contexts/WhiteLabelContext";
import { supabase } from "@/integrations/supabase/client";

export default function CheckoutSucesso() {
  const navigate = useNavigate();
  const { config } = useWhiteLabel();
  const brand = config.companyName || "CredMais App";
  const [params] = useSearchParams();
  const id = params.get("id") || params.get("payment_id");
  const email = params.get("email") || "";
  const [status, setStatus] = useState<string | null>(null);
  const [checking, setChecking] = useState(!!id);
  const [checkError, setCheckError] = useState(!id);

  useEffect(() => {
    document.title = `Confirmação de pagamento — ${brand}`;
  }, [brand]);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    const check = async () => {
      try {
        const { data, error } = await supabase.functions.invoke("mercadopago-check-status", { body: { id } });
        if (error || !(data as any)?.status) throw error || new Error("Status ausente");
        if (!cancelled) setStatus((data as any).status);
      } catch {
        if (!cancelled) setCheckError(true);
      }
      finally { if (!cancelled) setChecking(false); }
    };
    check();
    return () => { cancelled = true; };
  }, [id]);

  const isApproved = status === "approved";
  const isPending = status === "pending" || status === "in_process" || status === "authorized";

  return (
    <div className="min-h-dvh bg-black text-white flex items-center justify-center px-6">
      <div className="max-w-md w-full text-center p-10 rounded-3xl bg-white/4 border border-white/10 backdrop-blur-xl">
        <Credinho pose={isApproved && !checking && !checkError ? "results" : "thinking"} className="mx-auto w-[110px]" />
        <div className="w-20 h-20 rounded-full bg-emerald-500/15 border border-emerald-400/30 flex items-center justify-center mx-auto mb-6">
          {checking ? <Loader2 size={40} className="text-emerald-400 animate-spin" /> : isApproved ? <CheckCircle2 size={40} className="text-emerald-400" /> : isPending ? <Clock size={40} className="text-yellow-400" /> : <AlertCircle size={40} className="text-red-400" />}
        </div>
        <h1 className="text-2xl font-display font-bold mb-3">
          {isApproved ? "Pagamento aprovado!" : isPending ? "Pagamento em análise" : "Confirmação indisponível"}
        </h1>
        <p className="text-white/60 text-sm leading-relaxed mb-6">
          {isApproved ? <>
            Sua assinatura do <strong>{brand}</strong> foi confirmada. Enviamos um <strong>link de acesso</strong> para
            {email ? <> <strong className="text-white/80">{email}</strong></> : " seu e-mail"} — abra sua caixa de entrada para entrar no painel.
          </> : isPending ? <>
            O pagamento foi recebido e ainda está em análise. O acesso será liberado após a aprovação.
          </> : <>
            {checkError ? "Não conseguimos confirmar este pagamento agora. Confira novamente pelo login ou tente mais tarde." : "Este pagamento não foi aprovado."}
          </>}
        </p>
        <div className="flex items-center justify-center gap-2 text-xs text-white/50 bg-white/3 border border-white/10 rounded-xl py-3 px-4 mb-8">
          <Mail size={14} className="text-amber-300" />
          {isApproved ? "Não recebeu? Verifique a caixa de spam ou promoções." : "Nenhum acesso é liberado sem confirmação do pagamento."}
        </div>
        <button
          onClick={() => navigate("/login")}
          className="w-full py-4 rounded-2xl bg-white text-black font-bold tracking-wide hover:bg-white/90 transition-all flex items-center justify-center gap-2"
        >
          Ir para login <ArrowRight size={18} />
        </button>
        {id && (
          <p className="text-[11px] text-white/30 mt-4">ID do pagamento: {id}</p>
        )}
      </div>
    </div>
  );
}
