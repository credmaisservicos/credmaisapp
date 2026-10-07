import { useState } from "react";
import { Link } from "react-router-dom";
import { Check, Download, Share, Plus, Smartphone, Apple, Globe, Monitor } from "lucide-react";
import { usePwaInstall } from "@/hooks/usePwaInstall";
import { useWhiteLabel } from "@/contexts/WhiteLabelContext";
import { useToast } from "@/hooks/use-toast";
import { appDistribution } from "@/lib/appDistribution";
import { detectDesktopInstallBrowser } from "@/lib/installPlatform";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";

/** Um botão escolhe a instalação disponível para o aparelho do usuário. */
const InstallAppCard = ({ showDownloadsLink = true }: { showDownloadsLink?: boolean }) => {
  const { installed, canPrompt, isIOS, isAndroid, install } = usePwaInstall();
  const { config } = useWhiteLabel();
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  const appName = config.companyName || "CredMais App";
  const icon = config.faviconUrl || config.companyLogo || "/apple-touch-icon.png";
  const apk = isAndroid ? appDistribution.android : null;
  const isDesktop = !isIOS && !isAndroid;
  const browser = detectDesktopInstallBrowser(typeof navigator === "undefined" ? "" : navigator.userAgent);
  const label = isIOS ? "Instalar no iPhone" : isAndroid ? "Instalar no Android" : "Instalar no computador";
  const steps = isIOS ? [
    { icon: Share, text: "No Safari, toque em Compartilhar." },
    { icon: Plus, text: 'Escolha "Adicionar à Tela de Início". Se aparecer "Abrir como App Web", deixe ativado.' },
    { icon: Check, text: 'Toque em "Adicionar". Depois, abra o app pelo ícone na tela inicial.' },
  ] : apk ? [
    { icon: Download, text: "Aguarde o download e abra o arquivo CredMais.apk." },
    { icon: Smartphone, text: "Se o Android pedir, permita a instalação por este navegador." },
    { icon: Check, text: 'Confirme em "Instalar" e depois toque em "Abrir".' },
  ] : isDesktop ? browser === "safari" ? [
    { icon: Globe, text: "No Safari do Mac, abra o menu Arquivo ou o botão Compartilhar." },
    { icon: Plus, text: 'Escolha "Adicionar ao Dock". Essa opção está disponível no macOS Sonoma 14 ou mais recente.' },
    { icon: Check, text: 'Confirme em "Adicionar" e abra o CredMais pelo ícone no Dock.' },
  ] : browser === "other" ? [
    { icon: Globe, text: "Abra esta página no Google Chrome ou Microsoft Edge para instalar." },
    { icon: Download, text: 'Clique em "Instalar no computador" ou no ícone de instalação da barra de endereço.' },
    { icon: Check, text: "Confirme a instalação e abra o CredMais pelo ícone nos seus aplicativos." },
  ] : [
    { icon: Globe, text: browser === "edge" ? "Abra o menu do Edge (…)." : "Abra o menu do Chrome (⋮)." },
    { icon: Plus, text: browser === "edge"
      ? 'Escolha "Mais ferramentas" → "Aplicativos" → "Instalar este site como aplicativo". Você também pode usar o ícone de instalação na barra de endereço.'
      : 'Escolha "Transmitir, salvar e compartilhar" → "Instalar esta página como um app". Você também pode usar o ícone de instalação na barra de endereço.' },
    { icon: Check, text: 'Confirme em "Instalar" e abra o CredMais pelo ícone nos seus aplicativos.' },
  ] : [
    { icon: Globe, text: "Abra o menu do Chrome ou Edge (⋮)." },
    { icon: Plus, text: 'Escolha "Instalar aplicativo" ou "Adicionar à tela inicial".' },
    { icon: Check, text: "Confirme a instalação e abra o ícone junto dos seus apps." },
  ];

  const handleInstall = async () => {
    if (isIOS || !canPrompt) { setGuideOpen(true); return; }
    setBusy(true);
    const accepted = await install();
    setBusy(false);
    if (accepted) toast({ title: "Instalação iniciada", description: "O navegador está adicionando o app ao seu aparelho." });
  };

  if (installed) return <div className="rounded-2xl border border-success/25 bg-success/5 p-5 space-y-4">
    <div className="flex items-center gap-3">
      <Check className="shrink-0 text-success" size={24} />
      <div><p className="text-sm font-semibold text-foreground">App instalado</p>
        <p className="text-xs text-muted-foreground">Você já está usando o {appName} como aplicativo.</p></div>
    </div>
    <Link to="/dashboard" className="flex min-h-11 items-center justify-center rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground">Abrir aplicativo</Link>
  </div>;

  const actionClass = "w-full min-h-12 flex items-center justify-center gap-2 px-3 py-3 rounded-xl bg-primary text-primary-foreground font-semibold text-sm hover:opacity-90 transition disabled:opacity-60";
  return <>
    <div className="rounded-2xl border border-primary/20 bg-primary/4 p-5 space-y-4">
      <div className="flex items-center gap-3">
        <img src={icon} alt="" className="w-12 h-12 rounded-xl object-cover bg-white/5 ring-1 ring-border/40 shrink-0" />
        <div className="min-w-0"><p className="text-sm font-bold text-foreground truncate">Instalar {appName}</p>
          <p className="text-xs leading-relaxed text-muted-foreground">{isDesktop ? "Abra em uma janela própria pelo ícone nos seus aplicativos e continue usando sua conta." : "Tenha o app na tela inicial e continue usando sua conta."}</p></div>
      </div>
      {apk ? <a href={apk} download="CredMais.apk" onClick={() => setGuideOpen(true)} className={actionClass}><Download size={18} />{label}</a>
        : <button type="button" onClick={() => void handleInstall()} disabled={busy} aria-haspopup={isIOS || !canPrompt ? "dialog" : undefined} className={actionClass}>
          {isIOS ? <Apple size={18} /> : isDesktop ? <Monitor size={18} /> : <Download size={18} />}{busy ? "Instalando..." : label}
        </button>}
      <p className="text-xs leading-relaxed text-muted-foreground">{isIOS
        ? "No iPhone, a instalação web é feita pelo Safari. Toque acima para ver os três passos."
        : apk ? "O download começa ao tocar. Depois, confirme a instalação no Android."
        : canPrompt ? `${isDesktop ? "Clique" : "Toque"} no botão e confirme a instalação na janela do navegador.`
        : `${isDesktop ? "Clique" : "Toque"} no botão para ver como instalar pelo menu do navegador.`}</p>
      {isDesktop && <p className="text-xs leading-relaxed text-muted-foreground">Disponível para Windows, macOS e Linux. As atualizações do app web são automáticas.</p>}
      {showDownloadsLink && <Link to="/baixar" className="flex items-center justify-center gap-2 text-sm font-semibold text-primary hover:underline"><Smartphone size={16} /> Instalação no seu aparelho</Link>}
    </div>
    <Dialog open={guideOpen} onOpenChange={setGuideOpen}>
      <DialogContent className="dark text-foreground">
        <DialogTitle className="pr-9 leading-snug">{label}</DialogTitle>
        <DialogDescription>{isIOS ? "Adicione a versão web do app à tela inicial do seu iPhone." : apk ? "Conclua a instalação do aplicativo Android." : isDesktop ? "Instale o CredMais no seu computador ou notebook seguindo os passos abaixo." : "Seu navegador ainda não liberou a janela de instalação. Use o menu para continuar."}</DialogDescription>
        <ol className="space-y-4 py-2">{steps.map(({ icon: Icon, text }, index) => <li key={text} className="flex items-start gap-3 text-sm leading-relaxed">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary"><Icon size={17} /></span>
          <span><strong>{index + 1}.</strong> {text}</span>
        </li>)}</ol>
        {isIOS && <p className="text-xs leading-relaxed text-muted-foreground">Se você abriu pelo WhatsApp ou outro navegador, abra este endereço no Safari para continuar.</p>}
        {isDesktop && browser === "safari" && <p className="text-xs leading-relaxed text-muted-foreground">Se "Adicionar ao Dock" não aparecer, abra esta página no Chrome ou Edge para instalar.</p>}
        <button type="button" onClick={() => setGuideOpen(false)} className={actionClass}>Entendi</button>
      </DialogContent>
    </Dialog>
  </>;
};

export default InstallAppCard;
