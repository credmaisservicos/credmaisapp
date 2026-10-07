import { useEffect } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, FileText, CreditCard, Ban, AlertTriangle, Scale, RefreshCw, Mail } from "lucide-react";
import { PLANS } from "@/lib/plans";
import { motion, useReducedMotion } from "framer-motion";
import { Grain, SiteFooter, SiteHeader } from "@/components/site/SiteLayout";

/**
 * O rodapé do site já linkava para /termos, mas a rota não existia: quem
 * clicava caía num 404. Esta página descreve o serviço como ele realmente
 * funciona hoje — planos, cobrança pelo Mercado Pago, cancelamento, o que o
 * app faz e o que ele não faz.
 *
 * O texto é um ponto de partida honesto, não parecer jurídico: quem vende
 * software para operação de crédito deve passar isto por um advogado antes de
 * tratá-lo como contrato definitivo.
 */
const Termos = () => {
  const reducedMotion = useReducedMotion();
  useEffect(() => {
    document.title = "Termos de Uso — CREDMAIS APP";
    const meta = document.querySelector('meta[name="description"]');
    if (meta) meta.setAttribute("content", "Termos de uso do CREDMAIS APP: planos, pagamento, cancelamento e responsabilidades.");
  }, []);

  const Section = ({ icon: Icon, title, children }: any) => (
    <motion.section initial={{ opacity: 0, y: reducedMotion ? 0 : 30 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: "-60px" }} className="space-y-3 rounded-[1.75rem] border border-white/10 bg-white/4.5 p-6 md:p-8">
      <div className="flex items-center gap-2.5">
        <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
          <Icon size={16} className="text-[#64b5ff]" />
        </div>
        <h2 className="text-base font-semibold">{title}</h2>
      </div>
      <div className="space-y-2 text-sm leading-relaxed text-white/60">{children}</div>
    </motion.section>
  );

  return (
    <div className="min-h-dvh bg-[#020719] text-white">
      <Grain /><SiteHeader />
      <div className="mx-auto max-w-4xl space-y-6 px-5 py-16 sm:px-8 sm:py-24">
        <Link to="/" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors">
          <ArrowLeft size={16} /> Voltar
        </Link>

        <header className="space-y-4 border-b border-white/10 pb-12">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 text-primary text-xs font-semibold">
            <FileText size={12} /> Termos de Uso
          </div>
          <h1 className="font-display text-[clamp(3rem,8vw,6rem)] font-semibold leading-[.88] tracking-[-.06em]">Termos de Uso</h1>
          <p className="text-sm text-muted-foreground">
            Estes termos valem para quem contrata e usa o CREDMAIS APP. Ao criar
            uma conta, você concorda com eles.
          </p>
        </header>

        <Section icon={FileText} title="1. O que é o serviço">
          <p>
            O CREDMAIS APP é um software de gestão para quem empresta dinheiro:
            cadastro de clientes, controle de contratos e parcelas, cobrança,
            relatórios e um portal onde o seu cliente acompanha o que deve.
          </p>
          <p>
            <span className="text-foreground font-medium">O que ele não é:</span>{" "}
            não somos instituição financeira, não emprestamos dinheiro, não
            intermediamos crédito e não somos parte nos contratos que você faz
            com os seus clientes. A relação de crédito é sua com eles.
          </p>
        </Section>

        <Section icon={Scale} title="2. Responsabilidade sobre a sua operação">
          <p>
            Você é responsável pela legalidade da sua atividade, pelas taxas que
            pratica, pelos contratos que emite e pelo tratamento que dá aos seus
            clientes — inclusive no tom das cobranças enviadas pelo aplicativo.
          </p>
          <p>
            O Código de Defesa do Consumidor proíbe expor o devedor a ridículo ou
            submetê-lo a constrangimento e ameaça (art. 42 e art. 71). Os textos
            de cobrança do sistema podem ser editados por você; o que for enviado
            a partir da sua conta é de sua responsabilidade.
          </p>
        </Section>

        <Section icon={CreditCard} title="3. Planos e pagamento">
          <p>
            O serviço é cobrado por assinatura mensal, nos planos{" "}
            {PLANS.essencial.name} (R$ {PLANS.essencial.priceLabel}/mês) e{" "}
            {PLANS.completo.name} (R$ {PLANS.completo.priceLabel}/mês). Os
            recursos de cada plano estão descritos na página de planos.
          </p>
          <p>
            O pagamento é processado pelo Mercado Pago. Não guardamos os dados do
            seu cartão. A assinatura é renovada a cada ciclo enquanto não for
            cancelada.
          </p>
          <p>
            Falta de pagamento suspende o acesso ao aplicativo. Os seus dados
            continuam guardados durante a suspensão e voltam a ficar acessíveis
            quando a assinatura for regularizada.
          </p>
        </Section>

        <Section icon={RefreshCw} title="4. Cancelamento">
          <p>
            Você pode cancelar quando quiser, sem multa. O acesso continua até o
            fim do ciclo já pago; não há devolução proporcional de mensalidade em
            curso.
          </p>
          <p>
            Antes de cancelar, exporte os seus dados — a exportação fica em
            Perfil → Meus dados. A exclusão da conta apaga clientes, contratos,
            parcelas, mensagens e backups de forma definitiva.
          </p>
        </Section>

        <Section icon={Ban} title="5. Uso proibido">
          <p>Não é permitido usar o serviço para:</p>
          <ul className="list-disc list-inside space-y-1">
            <li>atividade ilícita ou cobrança abusiva;</li>
            <li>enviar mensagem a quem não é seu cliente, ou spam em massa;</li>
            <li>tentar acessar dados de outro assinante;</li>
            <li>revender ou redistribuir o acesso a terceiros sem autorização.</li>
          </ul>
          <p>
            Conta usada para qualquer um desses fins pode ser suspensa sem aviso
            prévio.
          </p>
        </Section>

        <Section icon={AlertTriangle} title="6. Disponibilidade e limites">
          <p>
            Trabalhamos para manter o serviço no ar, mas ele depende de terceiros
            — hospedagem, provedor de WhatsApp, meio de pagamento. Não garantimos
            funcionamento ininterrupto nem nos responsabilizamos por lucro
            cessante decorrente de indisponibilidade.
          </p>
          <p>
            Cálculos de juros, multa e valores exibidos são ferramentas de apoio.
            Confira antes de usar em contrato ou em cobrança.
          </p>
        </Section>

        <Section icon={Mail} title="7. Mudanças e contato">
          <p>
            Estes termos podem mudar. Alteração relevante é avisada dentro do
            aplicativo. Continuar usando depois do aviso significa concordar com
            a nova versão.
          </p>
          <p>
            Dúvidas sobre estes termos ou sobre dados pessoais: fale com o suporte
            dentro do aplicativo, ou veja a{" "}
            <Link to="/privacidade" className="text-primary hover:underline">
              Política de Privacidade
            </Link>
            .
          </p>
        </Section>

        <p className="text-xs text-muted-foreground text-center pt-2">
          Última atualização: agosto de 2026.
        </p>
      </div><SiteFooter />
    </div>
  );
};

export default Termos;
