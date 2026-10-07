import { Link } from "react-router-dom";
import { Check, X } from "lucide-react";
import { SitePage, Card } from "@/components/site/SiteLayout";
import { PLAN_LIST } from "@/lib/plans";

const FAQ = [
  ["Posso trocar de plano depois?", "Sim. A troca é imediata e o valor é ajustado na próxima cobrança."],
  ["Tem limite de clientes?", "Não. Clientes, contratos e parcelas são ilimitados nos dois planos."],
  ["Como funciona o pagamento?", "Assinatura mensal via Mercado Pago (PIX ou cartão), com liberação automática."],
  ["Preciso instalar algo?", "Não. Funciona no navegador do celular, tablet e computador."],
];

export default function PlanosSite() {
  return (
    <SitePage
      eyebrow="Planos"
      title="Escolha seu plano"
      intro="Dois planos, nenhuma pegadinha. Comece organizando a carteira e ligue a automação com IA quando quiser."
    >
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {PLAN_LIST.map((plan) => (
          <Card key={plan.tier} className={plan.highlight ? "border-[#A46A19]/60 bg-[#A46A19]/6" : ""}>
            {plan.highlight && (
              <div className="mb-4 inline-flex rounded-full bg-[#A46A19] px-3 py-1 text-[10px] uppercase tracking-widest text-white">
                Mais completo
              </div>
            )}
            <div className="font-display text-xl font-semibold">{plan.name}</div>
            <p className="mt-2 text-sm text-white/60">{plan.tagline}</p>
            <div className="mt-6 flex items-end gap-1">
              <span className="font-display text-4xl font-bold">R$ {plan.priceLabel}</span>
              <span className="pb-1 text-xs text-white/40">/mês</span>
            </div>
            <ul className="mt-6 space-y-2">
              {plan.features.map((f) => (
                <li key={f} className="flex gap-2 text-sm text-white/75">
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-[#F5BD59]" />
                  <span>{f}</span>
                </li>
              ))}
              {plan.missing?.map((f) => (
                <li key={f} className="flex gap-2 text-sm text-white/35 line-through">
                  <X className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{f}</span>
                </li>
              ))}
            </ul>
            <Link
              to={`/checkout?plan=${plan.tier}`}
              className={`mt-8 flex items-center justify-center rounded-xl px-6 py-3.5 text-sm font-medium transition-colors ${
                plan.highlight
                  ? "bg-[#A46A19] text-white hover:bg-[#F5BD59]"
                  : "border border-white/15 text-white hover:bg-white/5"
              }`}
            >
              Assinar {plan.name}
            </Link>
          </Card>
        ))}
      </div>

      <h2 className="font-display mt-16 text-2xl font-semibold tracking-tight md:text-3xl">Perguntas frequentes</h2>
      <div className="mt-8 grid grid-cols-1 gap-4 md:grid-cols-2">
        {FAQ.map(([q, a]) => (
          <Card key={q}>
            <div className="text-sm font-medium">{q}</div>
            <p className="mt-2 text-sm leading-relaxed text-white/60">{a}</p>
          </Card>
        ))}
      </div>

      <a
        href="https://wa.me/5511964541758"
        target="_blank"
        rel="noreferrer"
        className="mt-10 inline-flex text-sm text-white/60 hover:text-white"
      >
        Falar com o time — (11) 96454-1758
      </a>
    </SitePage>
  );
}
