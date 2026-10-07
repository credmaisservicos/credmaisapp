import { Link } from "react-router-dom";
import { Sparkles, Lock, ArrowRight } from "lucide-react";
import { usePlan } from "@/hooks/usePlan";
import { PLANS } from "@/lib/plans";

/**
 * Bloqueia rotas exclusivas do plano Completo (agente de IA, automações,
 * inbox de WhatsApp). No plano Essencial a tela vira um convite de upgrade.
 */
const PlanGuard = ({ children }: { children: React.ReactNode }) => {
  const { hasAutomations } = usePlan();

  if (hasAutomations) return <>{children}</>;

  return (
    <div className="min-h-[70vh] flex items-center justify-center p-6">
      <div className="max-w-lg w-full glass-card p-8 text-center space-y-5">
        <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto">
          <Lock className="text-primary" size={26} />
        </div>
        <div className="space-y-2">
          <h1 className="text-xl font-bold text-foreground">
            Disponível no plano {PLANS.completo.name}
          </h1>
          <p className="text-sm text-muted-foreground">
            O agente de IA, a cobrança automática no WhatsApp e as automações fazem parte do
            plano {PLANS.completo.name} (R$ {PLANS.completo.priceLabel}/mês). Seu plano atual é o{" "}
            {PLANS.essencial.name} (R$ {PLANS.essencial.priceLabel}/mês).
          </p>
        </div>

        <ul className="text-left text-sm text-muted-foreground space-y-2">
          {PLANS.completo.features.slice(1).map((f) => (
            <li key={f} className="flex items-start gap-2">
              <Sparkles size={14} className="text-primary mt-0.5 shrink-0" />
              <span>{f}</span>
            </li>
          ))}
        </ul>

        <Link
          to="/planos"
          className="w-full inline-flex items-center justify-center gap-2 py-3 rounded-xl bg-primary text-primary-foreground font-semibold text-sm hover:opacity-90 transition"
        >
          Fazer upgrade agora
          <ArrowRight size={16} />
        </Link>
      </div>
    </div>
  );
};

export default PlanGuard;
