import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Download, X, Share } from "lucide-react";
import { usePwaInstall } from "@/hooks/usePwaInstall";
import { useToast } from "@/hooks/use-toast";

/**
 * Convite discreto para instalar o app. Aparece uma vez; se o usuário dispensar,
 * some de vez (o cartão completo continua em Configurações → Aplicativo Mobile).
 */
const DISMISS_KEY = "pwa-install-dismissed";

const InstallAppBanner = () => {
  const { installed, canPrompt, isIOS, platform, install } = usePwaInstall();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem(DISMISS_KEY) === "1";
    } catch {
      return false;
    }
  });
  const [busy, setBusy] = useState(false);

  // Só convida quem realmente pode instalar: ou o navegador liberou o prompt,
  // ou é um iPhone (onde o caminho é manual, mas existe).
  if (installed || dismissed || (!canPrompt && !isIOS)) return null;

  const dismiss = () => {
    try {
      localStorage.setItem(DISMISS_KEY, "1");
    } catch {}
    setDismissed(true);
  };

  const handleClick = async () => {
    if (canPrompt) {
      setBusy(true);
      const accepted = await install();
      setBusy(false);
      if (accepted) {
        toast({ title: "✓ App instalado!", description: "O ícone já está na sua tela inicial." });
        return;
      }
      dismiss();
      return;
    }
    // iPhone: não dá para instalar por código — leva ao passo a passo
    navigate("/baixar");
  };

  return (
    <div className="mx-auto max-w-[1600px] px-4 pt-3 sm:px-5 md:px-6 lg:px-8">
      <div className="flex items-center gap-3 rounded-xl border border-primary/25 bg-primary/[0.07] px-3.5 py-2.5">
        <img src="/apple-touch-icon.png" alt="" className="w-8 h-8 rounded-lg object-cover shrink-0" />
        <p className="flex-1 text-xs text-foreground/90 leading-snug">
          <strong className="font-semibold">{platform === "desktop" ? "Instale o app no computador ou notebook." : "Instale o app no celular."}</strong>{" "}
          <span className="text-muted-foreground">
            {canPrompt
              ? "Abra pelo ícone do app e continue usando sua conta."
              : "No iPhone é pelo Safari, em Compartilhar → Adicionar à Tela de Início."}
          </span>
        </p>
        <button
          onClick={handleClick}
          disabled={busy}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-[11px] font-semibold hover:opacity-90 transition shrink-0 disabled:opacity-60"
        >
          {canPrompt ? <Download size={12} /> : <Share size={12} />}
          {busy ? "..." : canPrompt ? "Instalar" : "Ver como"}
        </button>
        <button
          onClick={dismiss}
          aria-label="Dispensar"
          className="text-muted-foreground hover:text-foreground transition p-0.5 shrink-0"
        >
          <X size={14} />
        </button>
      </div>
    </div>
  );
};

export default InstallAppBanner;
