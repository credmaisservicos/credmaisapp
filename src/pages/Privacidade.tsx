import { useEffect } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Shield, Lock, FileText, Trash2, Download, Mail } from "lucide-react";
import { motion, useReducedMotion } from "framer-motion";
import { Grain, SiteFooter, SiteHeader } from "@/components/site/SiteLayout";

const Privacidade = () => {
  const reducedMotion = useReducedMotion();
  useEffect(() => {
    document.title = "Política de Privacidade — CREDMAIS APP";
    const meta = document.querySelector('meta[name="description"]');
    if (meta) meta.setAttribute("content", "Política de privacidade e tratamento de dados pessoais do CREDMAIS APP conforme a LGPD.");
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
            <Shield size={12} /> LGPD — Lei 13.709/2018
          </div>
          <h1 className="font-display text-[clamp(3rem,8vw,6rem)] font-semibold leading-[.88] tracking-[-.06em]">Política de Privacidade</h1>
          <p className="text-sm text-muted-foreground">
            Última atualização: {new Date().toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" })}
          </p>
        </header>

        <p className="text-sm text-muted-foreground">
          Esta página descreve como o <strong className="text-foreground">CREDMAIS APP</strong> coleta, usa,
          armazena e protege seus dados pessoais e os dados dos seus clientes. Ela é mantida pela
          equipe do produto e reflete as práticas atuais visíveis no aplicativo.
        </p>

        <Section icon={FileText} title="1. Dados que coletamos">
          <p>Coletamos apenas o necessário para operar o serviço:</p>
          <ul className="list-disc pl-5 space-y-1">
            <li><strong>Cadastro:</strong> nome, e-mail, avatar, chave PIX.</li>
            <li><strong>Operacionais:</strong> clientes que você cadastra, contratos, parcelas, pagamentos, cobranças, notas, gastos e metas.</li>
            <li><strong>Comunicação:</strong> mensagens de WhatsApp trocadas via bot integrado (quando ativado por você).</li>
            <li><strong>Técnicos:</strong> logs de auditoria e uso das automações para segurança e diagnóstico.</li>
          </ul>
        </Section>

        <Section icon={Lock} title="2. Como usamos e protegemos">
          <ul className="list-disc pl-5 space-y-1">
            <li>Dados ficam armazenados em infraestrutura Supabase (banco Postgres com criptografia em repouso e em trânsito via TLS).</li>
            <li>Acesso restrito por RLS (Row Level Security): cada conta só vê os próprios dados.</li>
            <li>Chaves de API e segredos ficam em cofre server-side, nunca expostos ao navegador.</li>
            <li>Backups automáticos periódicos, retidos pelo provedor.</li>
          </ul>
        </Section>

        <Section icon={Mail} title="3. Compartilhamento com terceiros">
          <p>Compartilhamos dados apenas com prestadores essenciais à operação:</p>
          <ul className="list-disc pl-5 space-y-1">
            <li><strong>Supabase</strong> — hospedagem de banco e autenticação.</li>
            <li><strong>Anthropic / Lovable AI</strong> — IA do assistente de cobrança (mensagens são processadas sem treinar modelos).</li>
            <li><strong>Evolution API</strong> — envio/recebimento de mensagens WhatsApp (opcional).</li>
            <li><strong>Brevo</strong> — envio de e-mails transacionais.</li>
          </ul>
          <p>Não vendemos, alugamos nem cedemos seus dados para fins publicitários.</p>
        </Section>

        <Section icon={Download} title="4. Seus direitos (Art. 18 da LGPD)">
          <p>Você pode a qualquer momento, dentro do próprio app:</p>
          <ul className="list-disc pl-5 space-y-1">
            <li><strong>Acessar e portar</strong> seus dados: em <em>Perfil → Meus dados</em>, botão <em>Baixar meus dados</em> (JSON completo).</li>
            <li><strong>Corrigir</strong> qualquer informação de cadastro diretamente na tela de <em>Perfil</em>.</li>
            <li><strong>Apagar sua conta</strong> e todos os dados vinculados em <em>Perfil → Zona de Perigo → Apagar minha conta</em>.</li>
            <li><strong>Solicitar informações</strong> adicionais por e-mail (abaixo).</li>
          </ul>
        </Section>

        <Section icon={Trash2} title="5. Retenção e exclusão">
          <p>
            Enquanto sua conta estiver ativa, mantemos os dados operacionais para você. Ao apagar
            a conta, o registro de usuário é removido imediatamente e os dados vinculados ficam
            inacessíveis (removidos por cascata das tabelas com FK). Backups históricos podem
            reter cópias por até 30 dias antes de serem sobrescritos.
          </p>
        </Section>

        <Section icon={Mail} title="6. Contato do Encarregado (DPO)">
          <p>
            Dúvidas, solicitações ou reclamações relacionadas ao tratamento dos seus dados:
          </p>
          <p>
            E-mail: <a href="mailto:privacidade@credmaisapp.com.br" className="text-primary hover:underline">privacidade@credmaisapp.com.br</a>
          </p>
          <p>
            Responderemos em até <strong>15 dias corridos</strong> conforme prazo previsto pela ANPD.
          </p>
        </Section>

        <p className="text-xs text-muted-foreground text-center pt-4">
          Ao continuar usando o CREDMAIS APP você concorda com esta política. Alterações significativas serão comunicadas por e-mail.
        </p>
      </div><SiteFooter />
    </div>
  );
};

export default Privacidade;
