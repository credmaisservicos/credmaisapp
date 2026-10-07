import { CredinhoBanner } from "@/components/brand/Credinho";
import { useState, useEffect, lazy, Suspense, useCallback } from "react";

import Sidebar from "@/components/Sidebar";
import TopBar from "@/components/TopBar";
import MobileBottomNav from "@/components/MobileBottomNav";
import Breadcrumbs from "@/components/Breadcrumbs";
import GlobalAnnouncement from "@/components/GlobalAnnouncement";
import InstallAppBanner from "@/components/InstallAppBanner";
import NativeAppUpdateBanner from "@/components/NativeAppUpdateBanner";
import { Navigate, Outlet, useLocation, useNavigationType } from "react-router-dom";
import { useIsMobile } from "@/hooks/use-mobile";
import { usePushNotifications } from "@/hooks/usePushNotifications";
import { useAppMode, isPlatformPath, isNeutralPath } from "@/contexts/AppModeContext";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { toast } from "sonner";
import ProductivityOfflineSync from "@/components/ProductivityOfflineSync";

// Defer heavy overlays — they're only rendered after user interaction.
const GlobalSearch = lazy(() => import("@/components/GlobalSearch"));
const QuickPaymentModal = lazy(() => import("@/components/QuickPaymentModal"));
const KeyboardShortcutsHelp = lazy(() => import("@/components/KeyboardShortcutsHelp"));
const OnboardingTourAuto = lazy(() =>
  import("@/components/onboarding/OnboardingTour").then((m) => ({ default: m.OnboardingTourAuto }))
);

const DashboardLayout = () => {
  const [collapsed, setCollapsed] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [payOpen, setPayOpen] = useState(false);
  const isMobile = useIsMobile();
  const location = useLocation();
  const navigationType = useNavigationType();
  const { mode } = useAppMode();
  const online = useOnlineStatus();
  usePushNotifications();

  const openQuickPayment = useCallback(() => {
    if (!online) {
      toast.error("Pagamento indisponível sem internet", {
        description: "Reconecte para registrar a baixa com segurança e evitar duplicidade.",
      });
      return;
    }
    setPayOpen(true);
  }, [online]);

  // Subscription enforcement lives in ProtectedRoute (single source of truth).

  // Em modo plataforma o dono do app não vê tela de operação: se cair numa por
  // link antigo ou URL digitada, volta para o painel. Trocar para "Minha operação"
  // no seletor libera tudo de novo.
  const blockedByMode =
    mode === "platform" &&
    !isPlatformPath(location.pathname) &&
    !isNeutralPath(location.pathname);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      const inField = t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setSearchOpen((prev) => !prev);
      }
      if (!inField && !e.metaKey && !e.ctrlKey && !e.altKey && (e.key === "p" || e.key === "P")) {
        e.preventDefault();
        if (online) setPayOpen((prev) => !prev);
        else openQuickPayment();
      }
      if (e.key === "Escape") { setSearchOpen(false); setPayOpen(false); }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [openQuickPayment]);

  // No celular a página inteira rola (não um painel interno), então trocar de
  // tela por um toque herdava a posição de rolagem da anterior e a nova abria
  // no meio. Voltar (POP) preserva a posição, como o usuário espera.
  useEffect(() => {
    if (!isMobile || navigationType === "POP") return;
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
  }, [isMobile, navigationType, location.pathname]);

  // Improvement #14: Auto-collapse sidebar on small desktop screens
  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth < 1100 && !isMobile) setCollapsed(true);
    };
    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [isMobile]);

  if (blockedByMode) return <Navigate to="/admin" replace />;

  return (
    <div className="app-shell min-h-dvh bg-background relative overflow-x-hidden">
      <ProductivityOfflineSync />
      {/* Static mesh gradients — no animation (animated blur is one of the heaviest paints).
       *
       * Ficam dentro de uma camada `fixed` que corta o que passa da tela. Antes
       * eram `absolute` soltos aqui: o primeiro tem 600px de largura começando a
       * 25% da tela, então num celular de 360px a borda direita caía em 690px e
       * ESTE container passava a ter 690px de área rolável.
       *
       * O estrago aparecia no cadastro de cliente, que dá foco automático no
       * campo Nome: o navegador rolava o container para revelar o campo, o app
       * inteiro deslizava 280px para fora da tela — e o `overflow-x-hidden` daqui
       * escondia a barra, então não havia como rolar de volta. No celular a tela
       * simplesmente ficava preta com um pedaço de formulário na borda.
       *
       * `fixed` + `overflow-hidden` faz o enfeite não somar largura para ninguém.
       */}
      <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
        <div className="absolute top-0 left-1/4 w-[600px] h-[600px] bg-primary/4 rounded-full blur-[80px]" />
        <div className="absolute bottom-0 right-0 w-[480px] h-[480px] bg-stone-200/2.5 rounded-full blur-[70px]" />
      </div>

      {/* Desktop: sidebar */}
      {!isMobile && (
        <Sidebar collapsed={collapsed} onToggleCollapse={() => setCollapsed(!collapsed)} />
      )}

      <div className={`app-workspace transition-[margin] duration-300 ${isMobile ? "ml-0" : collapsed ? "ml-[76px]" : "ml-[240px]"}`}>
        <TopBar onSearchClick={() => setSearchOpen(true)} onQuickPayment={openQuickPayment} />

        <GlobalAnnouncement />
        <NativeAppUpdateBanner />
        <InstallAppBanner />
        <Breadcrumbs />
        <main
          className={`app-content max-w-[1680px] mx-auto min-w-0 ${
            isMobile
              ? "px-3 py-3 pb-[calc(7.5rem+env(safe-area-inset-bottom))]"
              : "px-4 py-4 sm:px-5 sm:py-5 md:px-6 md:py-6 lg:px-8 lg:py-8"
          }`}
        >
          <CredinhoBanner />
          <Outlet />
        </main>
      </div>


      {/* Mobile: bottom nav */}
      {isMobile && <MobileBottomNav onQuickPayment={openQuickPayment} />}


      <Suspense fallback={null}>
        {searchOpen && <GlobalSearch open={searchOpen} onClose={() => setSearchOpen(false)} />}
        {payOpen && <QuickPaymentModal open={payOpen} onClose={() => setPayOpen(false)} />}
        <KeyboardShortcutsHelp />
        <OnboardingTourAuto />
      </Suspense>
    </div>
  );
};

export default DashboardLayout;
