import { Credinho } from "@/components/brand/Credinho";
import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Clock, ArrowRight, Loader2, CheckCircle2, AlertCircle } from "lucide-react";
import { useWhiteLabel } from "@/contexts/WhiteLabelContext";
import { supabase } from "@/integrations/supabase/client";

export default function CheckoutPendente() {
  const navigate = useNavigate();
  const { config } = useWhiteLabel();
  const brand = config.companyName || "CredMais App";
  const [params] = useSearchParams();
  const id = params.get("id") || params.get("payment_id");
  const email = params.get("email") || "";
  const [status, setStatus] = useState<string>("pending");
  const [checkError, setCheckError] = useState(!id);

  useEffect(() => {
    document.title = `Pagamento pendente — ${brand}`;
  }, [brand]);

  // Poll status every 6s until approved/rejected
  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    let timer: number | undefined;
    const check = async () => {
      try {
        const { data, error } = await supabase.functions.invoke("mercadopago-check-status", { body: { id } });
        if (error || !(data as any)?.status) throw error || new Error("Status ausente");
        const s = (data as any)?.status;
        if (!cancelled && s) {
          setCheckError(false);
          setStatus(s);
          if (s === "approved") {
            navigate(`/checkout/sucesso?id=${id}&email=${encodeURIComponent(email)}`);
            return;
          }
          if (s === "rejected" || s === "cancelled") {
            navigate(`/checkout/erro?id=${id}`);
            return;
          }
        }
      } catch {
        if (!cancelled) setCheckError(true);
      }
      if (!cancelled) timer = window.setTimeout(check, 6000);
    };
    check();
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, [id, email, navigate]);

  const approved = status === "approved";

  return (
    <div className="min-h-dvh bg-black text-white flex items-center justify-center px-6">
      <div className="max-w-md w-full text-center p-10 rounded-3xl bg-white/4 border border-white/10 backdrop-blur-xl">
        <Credinho pose={approved && !checkError ? "results" : "thinking"} className="mx-auto w-[110px]" />
        <div className="w-20 h-20 rounded-full bg-yellow-500/15 border border-yellow-400/30 flex items-center justify-center mx-auto mb-6">
          {approved ? <CheckCircle2 size={40} className="text-emerald-400" /> : checkError ? <AlertCircle size={40} className="text-red-400" /> : <Clock size={40} className="text-yellow-400" />}
        </div>
        <h1 className="text-2xl font-display font-bold mb-3">Pagamento em análise</h1>
        <p className="text-white/60 text-sm leading-relaxed mb-6">
          Estamos aguardando a confirmação do <strong>{brand}</strong>. Assim que aprovado, você receberá
          um e-mail com o link de acesso — Pix costuma levar segundos, boleto até 2 dias úteis.
        </p>
        <div className="flex items-center justify-center gap-2 text-xs text-white/50 bg-white/3 border border-white/10 rounded-xl py-3 px-4 mb-8">
          {checkError ? <AlertCircle size={14} className="text-red-300" /> : <Loader2 size={14} className="text-amber-300 animate-spin" />}
          {checkError ? "Não foi possível confirmar agora; tentaremos novamente." : "Verificando status a cada 6 segundos..."}
        </div>
        <button
          onClick={() => navigate("/")}
          className="w-full py-4 rounded-2xl bg-white text-black font-bold tracking-wide hover:bg-white/90 transition-all flex items-center justify-center gap-2"
        >
          Voltar ao início <ArrowRight size={18} />
        </button>
        {id && <p className="text-[11px] text-white/30 mt-4">ID do pagamento: {id}</p>}
      </div>
    </div>
  );
}
