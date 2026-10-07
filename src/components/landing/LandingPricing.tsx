import { Link } from "react-router-dom";
import { Check, Minus } from "lucide-react";

const plans = [
  {
    name: "Essencial",
    price: "199",
    tagline: "Para quem quer sair da planilha hoje.",
    highlight: false,
    items: [
      { label: "Clientes e contratos ilimitados", on: true },
      { label: "Juros de atraso calculados automaticamente", on: true },
      { label: "Portal do cliente e do investidor", on: true },
      { label: "Relatórios e painel financeiro", on: true },
      { label: "Automações de cobrança", on: false },
      { label: "Agente de IA no WhatsApp", on: false },
    ],
  },
  {
    name: "Completo",
    price: "299",
    tagline: "Operação no automático, do lembrete à quitação.",
    highlight: true,
    items: [
      { label: "Tudo do plano Essencial", on: true },
      { label: "Réguas de cobrança automáticas", on: true },
      { label: "Agente de IA no WhatsApp 24h", on: true },
      { label: "Disparos e follow-up inteligentes", on: true },
      { label: "Análises e briefing diário por IA", on: true },
      { label: "Suporte prioritário", on: true },
    ],
  },
];

const LandingPricing = () => {
  return (
    <section id="pricing" className="py-20 lg:py-28 relative">
      <div className="container mx-auto px-5 sm:px-6">
        <div className="max-w-2xl">
          <span className="text-[10px] uppercase tracking-[0.3em] text-primary">Planos</span>
          <h2 className="font-editorial text-[clamp(2rem,4.5vw,3.4rem)] leading-[1.05] text-foreground mt-4">
            Dois caminhos. Nenhuma surpresa na fatura.
          </h2>
        </div>

        <div className="mt-12 grid grid-cols-1 lg:grid-cols-2 gap-6" data-anim-group>
          {plans.map((plan) => (
            <div
              key={plan.name}
              data-anim="up"
              className={`relative rounded-3xl p-8 sm:p-10 border ${
                plan.highlight ? "border-primary/50 obsidian-card" : "border-border bg-card"
              }`}
            >
              {plan.highlight && (
                <span className="absolute -top-3 left-8 px-3 py-1 rounded-full text-[10px] font-semibold uppercase tracking-[0.18em] bg-primary text-primary-foreground">
                  Mais escolhido
                </span>
              )}
              <h3 className="font-editorial text-3xl text-foreground">{plan.name}</h3>
              <p className="text-sm text-muted-foreground mt-2">{plan.tagline}</p>

              <div className="flex items-end gap-2 mt-7">
                <span className="text-sm text-muted-foreground mb-2">R$</span>
                <span className="tnum font-editorial text-6xl text-foreground leading-none">{plan.price}</span>
                <span className="text-sm text-muted-foreground mb-2">/mês</span>
              </div>

              <div className="gold-line my-7" />

              <ul className="space-y-3.5">
                {plan.items.map((item) => (
                  <li key={item.label} className="flex items-start gap-3 text-sm">
                    {item.on ? (
                      <Check size={16} className="text-primary mt-0.5 shrink-0" />
                    ) : (
                      <Minus size={16} className="text-muted-foreground/60 mt-0.5 shrink-0" />
                    )}
                    <span className={item.on ? "text-foreground" : "text-muted-foreground/70 line-through"}>
                      {item.label}
                    </span>
                  </li>
                ))}
              </ul>

              <Link
                to="/checkout"
                className={`mt-9 flex items-center justify-center py-4 rounded-full font-semibold transition-opacity hover:opacity-90 ${
                  plan.highlight
                    ? "bg-primary text-primary-foreground"
                    : "border border-border text-foreground"
                }`}
              >
                Escolher {plan.name}
              </Link>
            </div>
          ))}
        </div>

        <p className="text-center text-xs text-muted-foreground mt-8">
          Pagamento seguro via Mercado Pago · Cancele quando quiser
        </p>
      </div>
    </section>
  );
};

export default LandingPricing;
