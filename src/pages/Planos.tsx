import { motion } from "framer-motion";
import { Check, Sparkles, Shield, Zap, ArrowLeft } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import LandingPricing from "@/components/landing/LandingPricing";
import ConstellationBackground from "@/components/ConstellationBackground";

const faqs = [
  {
    q: "Posso cancelar quando quiser?",
    a: "Sim. A assinatura é mensal e sem fidelidade. Cancele com 1 clique na sua área de perfil ou pelo Mercado Pago a qualquer momento.",
  },
  {
    q: "Qual a diferença entre os planos?",
    a: "O plano Essencial (R$ 199) inclui clientes e contratos ilimitados, cobranças, portal do cliente, portal do cobrador, investidores e relatórios. O plano Completo (R$ 299) adiciona o agente de IA no WhatsApp, a cobrança automática, o inbox e as automações.",
  },
  {
    q: "Como recebo acesso após pagar?",
    a: "Logo após a confirmação do pagamento pelo Mercado Pago, você recebe automaticamente um e-mail com um link mágico para entrar no sistema sem precisar de senha.",
  },
  {
    q: "Posso usar no celular?",
    a: "Sim! O CredMais App é um PWA — instale como app no Android/iPhone diretamente do navegador, sem precisar baixar da loja.",
  },
];

const Planos = () => {
  const navigate = useNavigate();
  const [openFaq, setOpenFaq] = useState<number | null>(0);

  return (
    <div className="relative min-h-dvh bg-black text-white overflow-hidden">
      <ConstellationBackground />

      <button
        onClick={() => navigate("/")}
        className="fixed top-6 left-6 z-20 flex items-center gap-2 px-4 py-2 rounded-full bg-white/4 border border-white/10 text-white/60 hover:text-white hover:bg-white/8 transition-all backdrop-blur-md"
      >
        <ArrowLeft size={16} />
        <span className="text-sm">Voltar</span>
      </button>

      {/* Hero */}
      <section className="relative pt-32 pb-12 px-6">
        <div className="container mx-auto text-center max-w-3xl">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-white/5 border border-white/10 text-xs text-white/60 uppercase tracking-widest mb-6"
          >
            <Sparkles size={12} className="text-amber-400" />
            Dois planos · sem fidelidade
          </motion.div>
          <motion.h1
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="text-5xl md:text-6xl font-display font-bold mb-6 leading-tight"
          >
            Escolha o plano <br />
            <span className="text-gradient-gold">ideal para você</span>
          </motion.h1>
          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="text-white/50 text-lg leading-relaxed"
          >
            Essencial por R$ 199/mês para gerir toda a carteira, ou Completo por R$ 299/mês com agente de IA e automações de cobrança.
          </motion.p>
        </div>
      </section>

      {/* Pricing card */}
      <LandingPricing />

      {/* Benefits */}
      <section className="py-20 px-6">
        <div className="container mx-auto max-w-5xl grid grid-cols-1 md:grid-cols-3 gap-6">
          {[
            { icon: Zap, title: "Ativação imediata", desc: "Acesso liberado em segundos após o pagamento via link mágico no e-mail." },
            { icon: Shield, title: "Pagamento seguro", desc: "Processado pelo Mercado Pago — PIX, cartão ou boleto. Sem fidelidade." },
            { icon: Sparkles, title: "Atualizações inclusas", desc: "Todo recurso novo já vem incluso no seu plano, sem custo extra." },
          ].map((b, i) => (
            <motion.div
              key={b.title}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.1 }}
              className="p-6 rounded-2xl bg-white/3 border border-white/10 backdrop-blur-md"
            >
              <div className="w-10 h-10 rounded-xl bg-amber-400/10 flex items-center justify-center mb-4">
                <b.icon size={18} className="text-amber-400" />
              </div>
              <h2 className="font-display font-bold text-lg mb-2">{b.title}</h2>
              <p className="text-sm text-white/50 leading-relaxed">{b.desc}</p>
            </motion.div>
          ))}
        </div>
      </section>

      {/* FAQ */}
      <section className="py-20 px-6">
        <div className="container mx-auto max-w-2xl">
          <h2 className="text-3xl md:text-4xl font-display font-bold text-center mb-12">
            Perguntas <span className="text-gradient-gold">frequentes</span>
          </h2>
          <div className="space-y-3">
            {faqs.map((faq, i) => (
              <div
                key={i}
                className="rounded-2xl bg-white/3 border border-white/10 overflow-hidden"
              >
                <button
                  onClick={() => setOpenFaq(openFaq === i ? null : i)}
                  className="w-full px-6 py-5 flex items-center justify-between text-left hover:bg-white/2 transition"
                >
                  <span className="font-medium text-white pr-4">{faq.q}</span>
                  <span className={`text-amber-400 text-xl transition-transform ${openFaq === i ? "rotate-45" : ""}`}>+</span>
                </button>
                {openFaq === i && (
                  <div className="px-6 pb-5 text-sm text-white/60 leading-relaxed">{faq.a}</div>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      <footer className="py-10 text-center text-white/30 text-xs tracking-wider">
        © {new Date().getFullYear()} CREDMAIS APP · TODOS OS DIREITOS RESERVADOS
      </footer>
    </div>
  );
};

export default Planos;
