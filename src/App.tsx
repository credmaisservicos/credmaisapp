import { CredinhoLoader } from "@/components/brand/Credinho";
import { MotionConfig } from "framer-motion";
import { lazy, Suspense } from "react";
import { QueryClient } from "@tanstack/react-query";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { createIDBPersister } from "@/lib/offlineCache";
import { I18nProvider } from "@/lib/i18n";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/contexts/AuthContext";
import { AppModeProvider } from "@/contexts/AppModeContext";
import { ThemeProvider } from "@/contexts/ThemeContext";
import { WhiteLabelProvider } from "@/contexts/WhiteLabelContext";
import PlanGuard from "@/components/PlanGuard";
import ProtectedRoute from "@/components/ProtectedRoute";
import AdminRoute from "@/components/AdminRoute";
import DashboardLayout from "./components/DashboardLayout";
import OfflineIndicator from "./components/OfflineIndicator";
import ErrorBoundary from "./components/ErrorBoundary";
import SuspenseWatchdog from "./components/SuspenseWatchdog";
import { ConfirmProvider } from "./components/ConfirmProvider";
import PortalSessionGuard from "./components/PortalSessionGuard";
import NativeShell from "./components/NativeShell";

import Index from "./pages/Index";
const SiteInteligencia = lazy(() => import("./pages/site/Inteligencia"));
const SiteSobre = lazy(() => import("./pages/site/SobreCredmais"));
const SiteMissao = lazy(() => import("./pages/site/Missao"));
const SitePlanos = lazy(() => import("./pages/site/PlanosSite"));

import Login from "./pages/Login";
import ResetPassword from "./pages/ResetPassword";
const Dashboard = lazy(() => import("./pages/Dashboard"));
const PortalCliente = lazy(() => import("./pages/PortalCliente"));
// ... keep existing code
const NovoCliente = lazy(() => import("./pages/NovoCliente"));
const NotFound = lazy(() => import("./pages/NotFound"));
const Analises = lazy(() => import("./pages/Analises"));
const Clientes = lazy(() => import("./pages/Clientes"));
const Cobrancas = lazy(() => import("./pages/Cobrancas"));
const Carteira = lazy(() => import("./pages/Carteira"));
const Investidores = lazy(() => import("./pages/Investidores"));
const InvestidorDetalhe = lazy(() => import("./pages/InvestidorDetalhe"));


const PortalInvestidor = lazy(() => import("./pages/PortalInvestidor"));
const Lucros = lazy(() => import("./pages/Lucros"));
const Gastos = lazy(() => import("./pages/Gastos"));
const Metas = lazy(() => import("./pages/Metas"));
const Simulador = lazy(() => import("./pages/Simulador"));
const Ferramentas = lazy(() => import("./pages/Ferramentas"));
const Tarefas = lazy(() => import("./pages/Tarefas"));
const Anotacoes = lazy(() => import("./pages/Anotacoes"));
const Planilha = lazy(() => import("./pages/Planilha"));
const PuxadaDados = lazy(() => import("./pages/PuxadaDados"));
const Sobre = lazy(() => import("./pages/Sobre"));
const Perfil = lazy(() => import("./pages/Perfil"));
const Admin = lazy(() => import("./pages/Admin"));
const AdminBotAudit = lazy(() => import("./pages/AdminBotAudit"));
const Relatorios = lazy(() => import("./pages/Relatorios"));
const Historico = lazy(() => import("./pages/Historico"));
const HistoricoFinanceiro = lazy(() => import("./pages/HistoricoFinanceiro"));
const Configuracoes = lazy(() => import("./pages/Configuracoes"));
const Cobradores = lazy(() => import("./pages/Cobradores"));
const QRCodePage = lazy(() => import("./pages/QRCodePage"));
const CobradorExterno = lazy(() => import("./pages/CobradorExterno"));
const Auditoria = lazy(() => import("./pages/Auditoria"));
const Privacidade = lazy(() => import("./pages/Privacidade"));
const Termos = lazy(() => import("./pages/Termos"));

const ClienteDetalhe = lazy(() => import("./pages/ClienteDetalhe"));
const ContractRedirect = lazy(() => import("./pages/ContractRedirect"));
const Suporte = lazy(() => import("./pages/Suporte"));
const Notificacoes = lazy(() => import("./pages/Notificacoes"));
const Chat = lazy(() => import("./pages/Chat"));

const TvMode = lazy(() => import("./pages/TvMode"));
const BuscarClientes = lazy(() => import("./pages/BuscarClientes"));
const Hoje = lazy(() => import("./pages/Hoje"));
const Planos = lazy(() => import("./pages/Planos"));
const Checkout = lazy(() => import("./pages/Checkout"));
const CheckoutSucesso = lazy(() => import("./pages/CheckoutSucesso"));
const CheckoutErro = lazy(() => import("./pages/CheckoutErro"));
const CheckoutPendente = lazy(() => import("./pages/CheckoutPendente"));
const CentralBot = lazy(() => import("./pages/CentralBot"));
const WhatsAppInbox = lazy(() => import("./pages/WhatsAppInbox"));
const Comercial = lazy(() => import("./pages/Comercial"));
const Estoque = lazy(() => import("./pages/Estoque"));
const VendasCelulares = lazy(() => import("./pages/VendasCelulares"));
const Locacoes = lazy(() => import("./pages/Locacoes"));
const Garantias = lazy(() => import("./pages/Garantias"));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 2,
      // Mantém em disco as consultas vistas nos últimos três dias. Antes o
      // coletor removia tudo após dez minutos, tornando o PWA quase inútil sem rede.
      gcTime: 1000 * 60 * 60 * 24 * 3,
      refetchOnWindowFocus: false,
      retry: (failureCount, error: any) => {
        const status = error?.status ?? error?.code;
        // não retentar 4xx (auth/permissão/validação)
        if (typeof status === "number" && status >= 400 && status < 500) return false;
        return failureCount < 2;
      },
      retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 8000),
    },
    mutations: {
      retry: 0,
    },
  },
});

const PageLoader = () => (<SuspenseWatchdog><CredinhoLoader label="Carregando página" /></SuspenseWatchdog>);


const idbPersister = createIDBPersister();

const App = () => (
  <MotionConfig reducedMotion="user">
  <PersistQueryClientProvider
    client={queryClient}
    persistOptions={{ persister: idbPersister, maxAge: 1000 * 60 * 60 * 24 * 3, buster: "sj-v1" }}
  >
    <I18nProvider>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <OfflineIndicator />
      <AuthProvider>
        <WhiteLabelProvider>
          <ThemeProvider>
          <ConfirmProvider>
          <BrowserRouter>
            <AppModeProvider>
            <ErrorBoundary>
              <NativeShell />
              <PortalSessionGuard />
              <Suspense fallback={<PageLoader />}>
                <Routes>
                  <Route path="/" element={<Index />} />
                  <Route path="/login" element={<Login />} />
                  <Route path="/planos" element={<SitePlanos />} />
                  <Route path="/assinatura" element={<Planos />} />
                  <Route path="/inteligencia" element={<SiteInteligencia />} />
                  <Route path="/sobre-credmais" element={<SiteSobre />} />
                  <Route path="/missao" element={<SiteMissao />} />
                  <Route path="/checkout" element={<Checkout />} />
                  <Route path="/checkout/sucesso" element={<CheckoutSucesso />} />
                  <Route path="/checkout/erro" element={<CheckoutErro />} />
                  <Route path="/checkout/pendente" element={<CheckoutPendente />} />
                  <Route path="/reset-password" element={<ResetPassword />} />
                  <Route path="/portal-cliente" element={<PortalCliente />} />
                  {/* Alias público usado nas mensagens de cobrança/WhatsApp (?t=token) */}
                  <Route path="/portal" element={<PortalCliente />} />
                  <Route path="/portal/*" element={<PortalCliente />} />
                  <Route path="/investidor/:token" element={<PortalInvestidor />} />
                  <Route path="/privacidade" element={<Privacidade />} />
                  <Route path="/termos" element={<Termos />} />
                  <Route path="/cobrador-externo" element={<CobradorExterno />} />
                  <Route path="/tv" element={<ProtectedRoute><TvMode /></ProtectedRoute>} />
                  <Route element={<ProtectedRoute><DashboardLayout /></ProtectedRoute>}>
                    <Route path="/dashboard" element={<ErrorBoundary><Dashboard /></ErrorBoundary>} />
                    <Route path="/hoje" element={<ErrorBoundary><Hoje /></ErrorBoundary>}/>
                    <Route path="/analises" element={<ErrorBoundary><Analises /></ErrorBoundary>} />
                    <Route path="/clientes" element={<ErrorBoundary><Clientes /></ErrorBoundary>} />
                    <Route path="/clientes/novo" element={<ErrorBoundary><NovoCliente /></ErrorBoundary>} />
                    <Route path="/clientes/buscar" element={<ErrorBoundary><BuscarClientes /></ErrorBoundary>} />
                    <Route path="/clientes/:id" element={<ErrorBoundary><ClienteDetalhe /></ErrorBoundary>} />
                    <Route path="/contratos/:id" element={<ContractRedirect />} />
                    <Route path="/cobrancas" element={<ErrorBoundary><Cobrancas /></ErrorBoundary>} />
                    <Route path="/carteira" element={<ErrorBoundary><Carteira /></ErrorBoundary>} />
                    <Route path="/comercial" element={<ErrorBoundary><Comercial /></ErrorBoundary>} />
                    <Route path="/comercial/estoque" element={<ErrorBoundary><Estoque /></ErrorBoundary>} />
                    <Route path="/comercial/vendas" element={<ErrorBoundary><VendasCelulares /></ErrorBoundary>} />
                    <Route path="/comercial/locacoes" element={<ErrorBoundary><Locacoes /></ErrorBoundary>} />
                    <Route path="/garantias" element={<ErrorBoundary><Garantias /></ErrorBoundary>} />
                    <Route path="/investidores" element={<ErrorBoundary><Investidores /></ErrorBoundary>} />
                    <Route path="/investidores/:id" element={<ErrorBoundary><InvestidorDetalhe /></ErrorBoundary>} />


                    <Route path="/lucros" element={<ErrorBoundary><Lucros /></ErrorBoundary>} />
                    <Route path="/gastos" element={<ErrorBoundary><Gastos /></ErrorBoundary>} />
                    <Route path="/ferramentas" element={<ErrorBoundary><Ferramentas /></ErrorBoundary>} />
                    <Route path="/ferramentas/metas" element={<ErrorBoundary><Metas /></ErrorBoundary>} />
                    <Route path="/ferramentas/simulador" element={<ErrorBoundary><Simulador /></ErrorBoundary>} />
                    <Route path="/ferramentas/tarefas" element={<ErrorBoundary><Tarefas /></ErrorBoundary>} />
                    <Route path="/ferramentas/anotacoes" element={<ErrorBoundary><Anotacoes /></ErrorBoundary>} />
                    <Route path="/ferramentas/planilha" element={<ErrorBoundary><Planilha /></ErrorBoundary>} />
                    <Route path="/puxada-dados" element={<ErrorBoundary><PuxadaDados /></ErrorBoundary>} />
                    <Route path="/sobre" element={<Sobre />} />
                    <Route path="/perfil" element={<ErrorBoundary><Perfil /></ErrorBoundary>} />
                    <Route path="/admin" element={<AdminRoute><ErrorBoundary><Admin /></ErrorBoundary></AdminRoute>} />
                    <Route path="/admin/bot-audit" element={<AdminRoute><ErrorBoundary><AdminBotAudit /></ErrorBoundary></AdminRoute>} />
                    <Route path="/relatorios" element={<ErrorBoundary><Relatorios /></ErrorBoundary>} />
                    <Route path="/historico" element={<AdminRoute><ErrorBoundary><Historico /></ErrorBoundary></AdminRoute>} />
                    <Route path="/historico-financeiro" element={<ErrorBoundary><HistoricoFinanceiro /></ErrorBoundary>} />
                    <Route path="/configuracoes" element={<ErrorBoundary><Configuracoes /></ErrorBoundary>} />
                    <Route path="/cobradores" element={<ErrorBoundary><Cobradores /></ErrorBoundary>} />
                    <Route path="/qrcode" element={<QRCodePage />} />
                    <Route path="/comunicacao" element={<PlanGuard><ErrorBoundary><CentralBot /></ErrorBoundary></PlanGuard>} />
                    <Route path="/central" element={<Navigate to="/comunicacao" replace />} />
                    <Route path="/comunicacao/inbox" element={<PlanGuard><ErrorBoundary><WhatsAppInbox /></ErrorBoundary></PlanGuard>} />
                    <Route path="/agente-ia" element={<Navigate to="/comunicacao?tab=agente" replace />} />
                    <Route path="/bot-performance" element={<Navigate to="/comunicacao?tab=performance" replace />} />
                    <Route path="/automacoes" element={<Navigate to="/comunicacao?tab=automacoes" replace />} />
                    <Route path="/configuracoes/whatsapp" element={<Navigate to="/comunicacao?tab=whatsapp" replace />} />
                    <Route path="/auditoria" element={<AdminRoute><ErrorBoundary><Auditoria /></ErrorBoundary></AdminRoute>} />
                    <Route path="/suporte" element={<ErrorBoundary><Suporte /></ErrorBoundary>} />
                    <Route path="/notificacoes" element={<ErrorBoundary><Notificacoes /></ErrorBoundary>} />
                    <Route path="/chat" element={<ErrorBoundary><Chat /></ErrorBoundary>} />
                    <Route path="/inadimplencia" element={<Navigate to="/cobrancas?tab=aging" replace />} />
                  </Route>
                  <Route path="*" element={<NotFound />} />
                </Routes>
              </Suspense>
            </ErrorBoundary>
            </AppModeProvider>
          </BrowserRouter>
          </ConfirmProvider>
          </ThemeProvider>
        </WhiteLabelProvider>
      </AuthProvider>
    </TooltipProvider>
    </I18nProvider>
  </PersistQueryClientProvider>
  </MotionConfig>
);

export default App;
