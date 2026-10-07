import { createRoot } from "react-dom/client";
// Captura o instalador mesmo quando a pessoa visita o site antes de /baixar.
import "./hooks/usePwaInstall";
import { canReloadForAppUpdate } from "./lib/appUpdateReload";
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
  // Espera o primeiro conteúdo montado; importar este arquivo ainda não significa
  // que App/MarketingApp já terminou de baixar em uma conexão lenta.
  const hideWhenMounted = () => {
    if (rootElement.childElementCount > 0) hideSplash();
    else requestAnimationFrame(hideWhenMounted);
  };
  requestAnimationFrame(hideWhenMounted);

  // Splash nativo sai agora que existe interface montada por baixo dele.
  void iniciarShellNativo();

  // A telemetria não compete com a primeira pintura. O ErrorBoundary ainda a
  // carrega imediatamente sob demanda se um componente falhar antes daqui.
  const installGlobalCapture = () => {
    void import("@/lib/reportError")
      .then(({ instalarCapturaDeErros }) => instalarCapturaDeErros())
      .catch(() => {
        // Telemetry can be interrupted by navigation or a temporary network
        // failure. Its own import must not produce an unhandled app error.
      });
  };
  if ("requestIdleCallback" in window) {
    window.requestIdleCallback(installGlobalCapture, { timeout: 3_000 });
  } else {
    globalThis.setTimeout(installGlobalCapture, 1_000);
  }
}).catch((error: unknown) => {
  console.error("Não foi possível iniciar o CredMais", error);
  (window as any).__SJ_SHOW_BOOT_ERROR__?.();
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
    let hadController = Boolean(navigator.serviceWorker.controller);
    let reloadingForUpdate = false;
    const changedForms = new WeakSet<HTMLFormElement>();
    document.addEventListener("input", event => {
      const form = event.target instanceof Element ? event.target.closest("form") : null;
      if (form) changedForms.add(form);
    });
    navigator.serviceWorker.addEventListener("message", event => {
      if (event.data?.type === "APP_UPDATE_READY") {
        event.ports[0]?.postMessage({ ready: canReloadForAppUpdate(document, changedForms) });
      }
    });

    navigator.serviceWorker.addEventListener("controllerchange", () => {
      // A primeira instalação não precisa interromper a sessão. Em uma
      // atualização, recarrega uma vez para todos os chunks virem da mesma versão.
      if (!hadController) { hadController = true; return; }
      if (reloadingForUpdate) return;
      reloadingForUpdate = true;
      const reloadWhenReady = () => {
        if (canReloadForAppUpdate(document, changedForms)) window.location.reload();
        else window.setTimeout(reloadWhenReady, 5000);
      };
      reloadWhenReady();
    });

    navigator.serviceWorker.register("/sw.js", { updateViaCache: "none" }).then((registration) => {
      const warmOfflineRoutes = () => {
        const connection = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
        if (!navigator.onLine || document.visibilityState !== "visible" || connection?.saveData ||
          ["slow-2g", "2g", "3g"].includes(connection?.effectiveType ?? "")) return;
        navigator.serviceWorker.controller?.postMessage({ type: "WARM_OFFLINE_ROUTES" });
      };
      // As telas extras não concorrem com a primeira abertura ou redes limitadas.
      void navigator.serviceWorker.ready.then(() => {
        window.setTimeout(() => {
          if ("requestIdleCallback" in window) window.requestIdleCallback(warmOfflineRoutes, { timeout: 30_000 });
          else warmOfflineRoutes();
        }, 30_000);
      });
      const checkForUpdate = () => {
        if (!navigator.onLine || document.visibilityState !== "visible") return;
        // A browser pode rejeitar update durante troca/instalação do worker.
        // Isso é transitório e não deve virar uma rejeição global sem tratamento.
        void registration.update().then(() => {
          registration.waiting?.postMessage({ type: "CHECK_UPDATE" });
        }).catch(() => {});
      };
      registration.addEventListener("updatefound", () => {
        const installing = registration.installing;
        installing?.addEventListener("statechange", () => {
          if (installing.state === "installed") registration.waiting?.postMessage({ type: "CHECK_UPDATE" });
        });
      });
      checkForUpdate();

      // Abas que ficam abertas o dia inteiro também recebem novas publicações.
      document.addEventListener("visibilitychange", checkForUpdate);
      window.setInterval(checkForUpdate, 5 * 60_000);
      document.addEventListener("click", () => {
        window.setTimeout(() => registration.waiting?.postMessage({ type: "CHECK_UPDATE" }), 0);
      });
    }).catch(() => {});
  });
}

// Um erro real de importação apresenta recuperação. Tempo de espera, sozinho,
// não é motivo para apagar o modo offline nem reiniciar formulários.
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

  if (!rootElement.childElementCount) (window as any).__SJ_SHOW_BOOT_ERROR__?.();
};

window.addEventListener("error", (e) => {
  recoverFromStaleChunk(String(e?.message || ""));
  recoverFromStaleChunk(String((e as any)?.error?.message || ""));
});
window.addEventListener("unhandledrejection", (e: any) => {
  recoverFromStaleChunk(String(e?.reason?.message || e?.reason || ""));
});
