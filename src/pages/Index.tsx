import { Link } from "react-router-dom";
import { ArrowUpRight, Check, ShieldCheck, Handshake, ChartNoAxesCombined, Zap, Heart, MessageCircle } from "lucide-react";
import { SiteHeader, SiteFooter } from "@/components/site/SiteLayout";
import { Credinho, type CredinhoPose } from "@/components/brand/Credinho";
import { PLAN_LIST } from "@/lib/plans";

const chapters: { pose: CredinhoPose; label: string; title: string; text: string; to: string }[] = [
  { pose: "organize", label: "01 / ORGANIZAÇÃO", title: "Cada detalhe no seu lugar.", text: "Clientes, contratos, parcelas e histórico financeiro. Sua operação organizada em uma única visão.", to: "/sobre-credmais" },
  { pose: "thinking", label: "02 / INTELIGÊNCIA", title: "Uma rotina mais leve.", text: "Lembretes, WhatsApp e PIX conectados para acompanhar cada compromisso da sua carteira.", to: "/inteligencia" },
  { pose: "results", label: "03 / PROGRESSO", title: "Clareza para o próximo passo.", text: "Lucro, capital e recebimentos à mão. Entenda seus resultados e planeje suas próximas conquistas.", to: "/planos" },
];
const values = [
  { icon: Handshake, label: "Confiança" }, { icon: ChartNoAxesCombined, label: "Organização" },
  { icon: ShieldCheck, label: "Segurança" }, { icon: Zap, label: "Progresso" }, { icon: Heart, label: "Sempre com você" },
];
export default function Index() {
  return <div className="credinho-site">
    <SiteHeader />
    <main>
      <section className="credinho-hero">
        <picture className="credinho-hero-background" aria-hidden="true">
          <source media="(max-width: 639px)" srcSet="/mascots/credinho-v2/hero-mobile.webp" />
          <img src="/mascots/credinho-v2/hero-wide.webp" alt="" width={1774} height={887} loading="eager" decoding="async" />
        </picture>
        <div className="credinho-hero-shade" aria-hidden="true" />
        <div className="credinho-hero-grid">
          <div className="credinho-hero-copy">
            <span className="credinho-kicker">✦ CONHEÇA SEU NOVO PARCEIRO</span>
            <h1>Mais controle.<br />Mais <span>conquistas.</span></h1>
            <p className="mt-7 max-w-lg text-base leading-8 text-white/60 sm:text-lg">Sua gestão financeira ganhou um parceiro. Com o CredMais e o Credinho, você organiza hoje e dá o próximo passo com confiança.</p>
            <div className="mt-9 flex flex-col gap-3 sm:flex-row">
              <Link to="/checkout?plan=completo" className="credinho-button">Começar minha jornada <ArrowUpRight size={19} /></Link>
              <Link to="/login" className="credinho-button-secondary">Acessar minha conta</Link>
            </div>
            <p className="mt-6 flex items-center gap-2 text-xs text-white/50"><ShieldCheck size={15} className="text-[#f5bd59]" /> Clientes, contratos e cobranças em um só lugar.</p>
          </div>
        </div>
        <div className="credinho-values">{values.map(({ icon: Icon, label }) => <div key={label}><Icon size={24} strokeWidth={1.5} /><span>{label}</span></div>)}</div>
      </section>
      <section className="credinho-section" id="recursos">
        <div className="flex flex-col justify-between gap-6 md:flex-row md:items-end">
          <div><span className="credinho-kicker">UM PARCEIRO. MUITAS POSSIBILIDADES.</span><h2 className="credinho-title mt-4">Com você em<br />cada movimento.</h2></div>
          <p className="max-w-sm text-sm leading-7 text-white/55">Do primeiro contrato ao próximo resultado, uma experiência pensada para simplificar sua rotina.</p>
        </div>
        <div className="mt-12 grid gap-5 md:grid-cols-3">{chapters.map(c => <Link key={c.label} to={c.to} className="credinho-feature group">
          <div className="credinho-feature-art"><Credinho pose={c.pose} /><span className="credinho-feature-arrow"><ArrowUpRight size={19} /></span></div>
          <div className="p-6 sm:p-7"><span className="credinho-kicker">{c.label}</span><h3 className="mt-4 text-2xl font-semibold tracking-tight">{c.title}</h3><p className="mt-3 text-sm leading-7 text-white/55">{c.text}</p></div>
        </Link>)}</div>
      </section>
      <section className="credinho-section pt-0">
        <div className="credinho-story">
          <div className="credinho-story-art"><Credinho pose="story" /></div>
          <div className="relative z-10 py-10 md:py-16"><span className="credinho-kicker">MENOS COMPLICAÇÃO. MAIS DIREÇÃO.</span><h2 className="credinho-title mt-5">Organiza hoje.<br /><span className="text-[#f5bd59]">Conquista amanhã.</span></h2>
            <p className="mt-6 max-w-md text-sm leading-7 text-white/60">Deixe as planilhas espalhadas para trás. Acompanhe vencimentos, consulte contratos e mantenha sua carteira sempre por perto, no computador ou no celular.</p>
            <div className="mt-7 flex flex-wrap gap-2">{["Gestão de empréstimos", "Controle financeiro", "Mais oportunidades"].map(t => <span key={t} className="rounded-full border border-white/15 px-4 py-2 text-[11px] text-white/65">{t}</span>)}</div>
            <Link to="/sobre-credmais" className="mt-8 inline-flex items-center gap-2 text-sm font-semibold text-[#f5bd59]">Conhecer o app <ArrowUpRight size={17} /></Link>
          </div>
        </div>
      </section>
      <section className="credinho-section pt-0" id="planos">
        <span className="credinho-kicker">O PRÓXIMO PASSO É SEU</span><h2 className="credinho-title mt-4">Um plano para<br />suas conquistas.</h2>
        <div className="mt-12 grid gap-5 md:grid-cols-2">{PLAN_LIST.map(plan => <article key={plan.tier} className={`credinho-plan ${plan.highlight ? "credinho-plan-highlight" : ""}`}>
          <div className="flex items-center justify-between gap-3"><h3 className="text-lg font-semibold">{plan.name}</h3>{plan.highlight && <span className="rounded-full bg-[#f5bd59]/15 px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-[#f5bd59]">Mais completo</span>}</div>
          <div className="mt-6 text-5xl font-semibold tracking-tight">R$ {plan.priceLabel}<span className="ml-2 text-sm font-normal tracking-normal text-white/50">/mês</span></div>
          <ul className="mt-7 flex-1 space-y-3 border-t border-white/10 pt-7">{plan.features.map(f => <li key={f} className="flex gap-3 text-sm text-white/65"><Check className="mt-0.5 h-4 w-4 shrink-0 text-[#f5bd59]" />{f}</li>)}</ul>
          <Link to={`/checkout?plan=${plan.tier}`} className={`mt-8 ${plan.highlight ? "credinho-button" : "credinho-button-secondary"}`}>Assinar {plan.name}<ArrowUpRight size={17} /></Link>
        </article>)}</div>
      </section>
      <section className="credinho-section pt-0"><div className="credinho-final">
        <div className="relative z-10"><span className="credinho-kicker">CREDMAIS + VOCÊ</span><h2 className="credinho-title mt-4">Mais que crédito.<br />Realizações.</h2><p className="mt-5 text-sm text-white/60">Seu próximo capítulo começa com mais controle.</p><Link to="/checkout?plan=completo" className="credinho-button mt-7 w-fit">Vamos começar <ArrowUpRight size={18} /></Link><div><a href="https://wa.me/5511964541758" target="_blank" rel="noreferrer" className="mt-5 inline-flex items-center gap-2 text-sm text-white/60 hover:text-white"><MessageCircle size={16} /> Falar com a equipe</a></div></div>
        <Credinho pose="final" className="credinho-final-pose" />
      </div></section>
    </main>
    <SiteFooter />
  </div>;
}
