import { createRoot } from "react-dom/client";
import "./index.css";
import "./credinho.css";
import "./glass-overrides.css";
import "./workspace-overrides.css";
import "./mobile-overrides.css";
import "./menu-icons.css";
import { isNativeApp, iniciarShellNativo } from "./lib/native";

// Identifica esta publicação e garante um novo arquivo de entrada quando o CDN
// precisar se recuperar de um artefato antigo armazenado em cache.
document.documentElement.dataset.credmaisBuild = "2026-09-01-cache-recovery";

const MARKETING_PATHS = new Set([
  "/",
  "/planos",
  "/inteligencia",
  "/sobre-credmais",
  "/missao",
  "/privacidade",
  "/termos",
]);

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("Elemento raiz da aplicação não encontrado");

// O Capacitor serve o `index.html` a partir da raiz, então dentro do APK/IPA o
// `pathname` é sempre "/" — que está na lista de marketing acima. O app nativo
// abria no site institucional e a única saída era um link da landing. Aqui a
// raiz do app nativo passa a ser a área logada; quem não tem sessão o
// `ProtectedRoute` manda para o login.
if (isNativeApp() && window.location.pathname === "/") {
  window.history.replaceState(null, "", "/dashboard");
}

const appModule = !isNativeApp() && MARKETING_PATHS.has(window.location.pathname)
  ? import("./MarketingApp.tsx")
  : import("./App.tsx");

void appModule.then(({ default: RootApp }) => {
  createRoot(rootElement).render(<RootApp />);

  // Splash nativo sai agora que existe interface montada por baixo dele.
  void iniciarShellNativo();

  // A telemetria não compete com a primeira pintura. O ErrorBoundary ainda a
  // carrega imediatamente sob demanda se um componente falhar antes daqui.
  const installGlobalCapture = () => {
    void import("@/lib/reportError").then(({ instalarCapturaDeErros }) => instalarCapturaDeErros());
  };
  if ("requestIdleCallback" in window) {
    window.requestIdleCallback(installGlobalCapture, { timeout: 3_000 });
  } else {
    globalThis.setTimeout(installGlobalCapture, 1_000);
  }
});

// Splash hide: remove o splash do index.html após o React montar
const hideSplash = () => {
  const externalHide = (window as any).__SJ_HIDE_SPLASH__;
  if (typeof externalHide === "function") {
    externalHide();
    return;
  }
  const splash = document.getElementById("app-splash");
  if (splash) {
    splash.style.opacity = "0";
    setTimeout(() => splash.remove(), 350);
  }
};

requestAnimationFrame(hideSplash);

// Service Worker: NUNCA registra em iframes ou hosts de preview Lovable
const isInIframe = (() => {
  try { return window.self !== window.top; } catch { return true; }
})();
const isPreviewHost =
  location.hostname.includes("id-preview--") ||
  location.hostname.includes("lovableproject.com") ||
  location.hostname.includes("lovable.app") && location.hostname.startsWith("id-");

// No app nativo os assets já vêm dentro do pacote e a WebView serve tudo de
// `localhost`. Um service worker ali não acrescenta offline nenhum e ainda
// reintroduz o par "controllerchange → reload" sobre arquivos locais, que não
// mudam sem uma nova instalação do app.
if (isInIframe || isPreviewHost || isNativeApp()) {
  // Em preview, desregistra qualquer SW pré-existente para evitar conteúdo stale
  navigator.serviceWorker?.getRegistrations()
    .then((regs) => regs.forEach((r) => void r.unregister().catch(() => {})))
    .catch(() => {});
} else if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    const hadController = Boolean(navigator.serviceWorker.controller);
    let reloadingForUpdate = false;

    navigator.serviceWorker.addEventListener("controllerchange", () => {
      // A primeira instalação não precisa interromper a sessão. Em uma
      // atualização, recarrega uma vez para todos os chunks virem da mesma versão.
      if (!hadController || reloadingForUpdate) return;
      reloadingForUpdate = true;
      window.location.reload();
    });

    navigator.serviceWorker.register("/sw.js", { updateViaCache: "none" }).then((registration) => {
      const checkForUpdate = () => {
        if (!navigator.onLine || document.visibilityState !== "visible") return;
        // A browser pode rejeitar update durante troca/instalação do worker.
        // Isso é transitório e não deve virar uma rejeição global sem tratamento.
        void registration.update().catch(() => {});
      };
      checkForUpdate();

      // Abas que ficam abertas o dia inteiro também recebem novas publicações.
      document.addEventListener("visibilitychange", checkForUpdate);
      window.setInterval(checkForUpdate, 5 * 60_000);
    }).catch(() => {});
  });
}

// Auto-recover de chunks antigos após novo deploy
const CHUNK_ERROR_PATTERNS = [
  "Failed to fetch dynamically imported module",
  "Importing a module script failed",
  "error loading dynamically imported module",
  "Failed to load module script",
  "ChunkLoadError",
];

const recoverFromStaleChunk = (msg: string) => {
  if (!msg) return;
  if (!CHUNK_ERROR_PATTERNS.some((p) => msg.includes(p))) return;

  const last = Number(sessionStorage.getItem("__chunk_reloaded_at") || 0);
  // Janela de 30s para evitar loop infinito, mas permite nova recuperação depois
  if (Date.now() - last < 30_000) return;
  sessionStorage.setItem("__chunk_reloaded_at", String(Date.now()));

  // Limpa caches + service workers e recarrega forçadamente
  Promise.all([
    caches?.keys?.().then((keys) => Promise.all(keys.map((k) => caches.delete(k).catch(() => false)))).catch(() => []) ?? Promise.resolve(),
    navigator.serviceWorker?.getRegistrations().then((regs) => Promise.all(regs.map((r) => r.unregister().catch(() => false)))).catch(() => []) ?? Promise.resolve(),
  ]).finally(() => {
    // bypass cache
    location.reload();
  });
};

window.addEventListener("error", (e) => {
  recoverFromStaleChunk(String(e?.message || ""));
  recoverFromStaleChunk(String((e as any)?.error?.message || ""));
});
window.addEventListener("unhandledrejection", (e: any) => {
  recoverFromStaleChunk(String(e?.reason?.message || e?.reason || ""));
});
