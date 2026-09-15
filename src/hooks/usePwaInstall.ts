import { useCallback, useEffect, useState } from "react";
import { isNativeApp } from "@/lib/native";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export type InstallMethod = "prompt" | "ios-manual" | "unsupported";

let sharedPrompt: BeforeInstallPromptEvent | null = null;
let sharedInstalled = false;
let listenersReady = false;
const subscribers = new Set<() => void>();

const publish = () => subscribers.forEach((subscriber) => subscriber());

const isStandalone = (): boolean => {
  if (typeof window === "undefined") return false;
  // Dentro do APK/IPA o app já está instalado. Sem isto o aviso "instale o
  // aplicativo" aparece dentro do próprio aplicativo — e o botão não faz nada,
  // porque a WebView nunca dispara `beforeinstallprompt`.
  if (isNativeApp()) return true;
  return (
    window.matchMedia?.("(display-mode: standalone)").matches ||
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true
  );
};

const detectIOS = (): boolean => {
  if (typeof navigator === "undefined") return false;
  const iOSDevice = /iPad|iPhone|iPod/.test(navigator.userAgent);
  const iPadDesktopUA = /Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1;
  return iOSDevice || iPadDesktopUA;
};

/**
 * Mantém um único evento de instalação para todo o app. Assim o aviso do
 * painel e Configurações compartilham o mesmo prompt, mesmo após navegar.
 */
const ensureGlobalListeners = () => {
  if (listenersReady || typeof window === "undefined") return;
  listenersReady = true;
  sharedInstalled = isStandalone();

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    sharedPrompt = event as BeforeInstallPromptEvent;
    publish();
  });

  window.addEventListener("appinstalled", () => {
    sharedInstalled = true;
    sharedPrompt = null;
    publish();
  });

  window.matchMedia?.("(display-mode: standalone)")?.addEventListener?.("change", (event) => {
    if (!event.matches) return;
    sharedInstalled = true;
    sharedPrompt = null;
    publish();
  });
};

ensureGlobalListeners();

export function usePwaInstall() {
  const [, refresh] = useState(0);
  const [isIOS] = useState(detectIOS);

  useEffect(() => {
    const subscriber = () => refresh((version) => version + 1);
    subscribers.add(subscriber);
    return () => {
      subscribers.delete(subscriber);
    };
  }, []);

  const installed = sharedInstalled || isStandalone();
  const method: InstallMethod = sharedPrompt ? "prompt" : isIOS ? "ios-manual" : "unsupported";

  const install = useCallback(async (): Promise<boolean> => {
    const prompt = sharedPrompt;
    if (!prompt) return false;
    try {
      await prompt.prompt();
      const { outcome } = await prompt.userChoice;
      sharedPrompt = null;
      publish();
      return outcome === "accepted";
    } catch {
      sharedPrompt = null;
      publish();
      return false;
    }
  }, []);

  return {
    installed,
    canPrompt: !!sharedPrompt && !installed,
    method,
    isIOS,
    install,
  };
}
