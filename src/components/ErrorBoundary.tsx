import { Component, ErrorInfo, ReactNode } from "react";
import { AlertTriangle, RotateCcw, Home } from "lucide-react";
import { useInRouterContext, useLocation } from "react-router-dom";
import { useEffect, useRef } from "react";

interface Props {
  children: ReactNode;
  fallback?: (error: Error, reset: () => void) => ReactNode;
  resetKey?: string;
}

interface State {
  error: Error | null;
}

const CHUNK_LOAD_PATTERNS = [
  "Failed to fetch dynamically imported module",
  "Importing a module script failed",
  "error loading dynamically imported module",
  "ChunkLoadError",
  "Loading chunk",
];

function isChunkLoadError(error: Error | null): boolean {
  if (!error) return false;
  const msg = `${error.name} ${error.message}`;
  return CHUNK_LOAD_PATTERNS.some((p) => msg.includes(p));
}

class ErrorBoundaryInner extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidUpdate(prevProps: Props) {
    if (this.state.error && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ error: null });
    }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {

    console.error("[ErrorBoundary]", error, info.componentStack);

    // Registra em `client_errors` para o dono do app ver em /admin → Logs.
    // Antes o erro morria no console do navegador do cliente.
    void import("@/lib/reportError").then(({ reportError }) => reportError(error, {
      origem: "error-boundary",
      componente: info.componentStack?.slice(0, 1000),
    })).catch(() => {
      // Reporting is optional: keep the original recovery screen usable when
      // the reporting module cannot be downloaded.
    });

  }

  reset = () => this.setState({ error: null });

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    if (this.props.fallback) return this.props.fallback(error, this.reset);

    // Rotas públicas (portal do cliente / cobrador externo) NUNCA devem
    // levar o usuário para o app do emprestador. Detectamos o contexto
    // pelo pathname atual e escondemos o botão de "Início".
    const path = typeof window !== "undefined" ? window.location.pathname.toLowerCase() : "";
    const isPortalContext =
      path.startsWith("/portal-cliente") ||
      path.startsWith("/cobrador-externo");

    return (
      <div className="min-h-[60vh] flex items-center justify-center p-6">
        <div className="max-w-md w-full rounded-2xl border border-destructive/30 bg-card/60 backdrop-blur-sm p-6 text-center space-y-4">
          <div className="mx-auto w-12 h-12 rounded-full bg-destructive/10 text-destructive flex items-center justify-center">
            <AlertTriangle size={22} />
          </div>
          <div>
            <h2 className="text-lg font-bold text-foreground">Algo deu errado</h2>
            <p className="text-xs text-muted-foreground mt-1">
              {isPortalContext
                ? "Não foi possível carregar esta tela. Tente novamente."
                : "Esta tela travou. Tente recarregar ou voltar pro início."}
            </p>
            <p className="sr-only" role="alert">
              A aplicação encontrou um erro inesperado nesta tela.
            </p>
          </div>
          <div className="flex gap-2 justify-center">
            <button
              onClick={isChunkLoadError(error) ? () => window.location.reload() : this.reset}
              className="px-3 py-2 rounded-lg bg-primary text-primary-foreground text-xs font-bold flex items-center gap-1.5 hover:opacity-90"
            >
              <RotateCcw size={12} /> Tentar de novo
            </button>
            {!isPortalContext && (
              <a
                href="/dashboard"
                className="px-3 py-2 rounded-lg bg-muted text-foreground text-xs font-bold flex items-center gap-1.5 hover:bg-accent"
              >
                <Home size={12} /> Início
              </a>
            )}
          </div>
        </div>
      </div>
    );
  }
}


// Wrapper para auto-resetar quando o usuário troca de rota,
// evitando ficar "preso" na tela de erro ao navegar pelo menu.
const ComRota = ({ children, fallback }: Omit<Props, "resetKey">) => {
  const { pathname } = useLocation();
  return (
    <ErrorBoundaryInner resetKey={pathname} fallback={fallback}>
      {children}
    </ErrorBoundaryInner>
  );
};

const ErrorBoundary = ({ children, fallback }: Omit<Props, "resetKey">) => {
  // Antes isto era `useLocation()` dentro de um try/catch, para funcionar também
  // fora do Router. Só que um hook chamado condicionalmente é justamente o que
  // provoca o erro #310 — e aqui o estrago seria o pior possível: quem quebraria
  // é o componente encarregado de segurar as quebras das outras telas.
  //
  // `useInRouterContext` é um hook comum, chamado sempre; quem depende do Router
  // fica no componente filho, que só é montado quando há Router.
  const dentroDoRouter = useInRouterContext();
  if (!dentroDoRouter) {
    return (
      <ErrorBoundaryInner resetKey="static" fallback={fallback}>
        {children}
      </ErrorBoundaryInner>
    );
  }
  return <ComRota fallback={fallback}>{children}</ComRota>;
};

export default ErrorBoundary;
