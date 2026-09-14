import { useLocation, Link, useNavigate } from "react-router-dom";
import { ChevronRight, ChevronLeft, Home } from "lucide-react";
import { useMemo } from "react";

const LABELS: Record<string, string> = {
  dashboard: "Painel",
  hoje: "Hoje",
  clientes: "Clientes",
  novo: "Novo",
  buscar: "Buscar",
  contratos: "Contratos",
  cobrancas: "Cobranças",
  carteira: "Carteira",
  comercial: "Comercial",
  estoque: "Estoque",
  vendas: "Vendas",
  locacoes: "Locações",
  garantias: "Garantias",
  investidores: "Investidores",
  lucros: "Lucros",
  gastos: "Gastos",
  analises: "Análises",
  relatorios: "Relatórios",
  cobradores: "Cobradores",
  historico: "Histórico",
  "historico-financeiro": "Histórico financeiro",
  configuracoes: "Configurações",
  whatsapp: "WhatsApp",
  qrcode: "Portais",
  comunicacao: "Comunicação",
  inbox: "Conversas",
  "agente-ia": "Agente IA",
  "bot-audit": "Auditoria do bot",
  auditoria: "Auditoria",
  automacoes: "Automações",
  suporte: "Suporte",
  notificacoes: "Notificações",
  chat: "Chat",
  inadimplencia: "Inadimplência",
  perfil: "Perfil",
  admin: "Admin",
  sobre: "Sobre",
  "puxada-dados": "Puxada de Dados",
  ferramentas: "Ferramentas",
  metas: "Metas",
  simulador: "Simulador",
  tarefas: "Tarefas",
  anotacoes: "Anotações",
  planilha: "Planilha",
};

const labelFor = (seg: string) => {
  if (LABELS[seg]) return LABELS[seg];
  // UUID-ish (cliente/:id) — encurta
  if (/^[0-9a-f]{8}-/i.test(seg)) return "Detalhes";
  return decodeURIComponent(seg).replace(/-/g, " ");
};

/**
 * Telas que já desenham o próprio botão de voltar no topo (ficha do cliente,
 * cadastro em etapas, investidor). Nelas a barra compacta do celular não
 * aparece, para não haver dois "voltar" um em cima do outro.
 */
const OWN_BACK_BUTTON = [/^\/clientes\/[^/]+$/, /^\/investidores\/[^/]+$/];

const Breadcrumbs = () => {
  const { pathname } = useLocation();
  const navigate = useNavigate();

  const segments = useMemo(() => pathname.split("/").filter(Boolean), [pathname]);

  // Não renderizar no dashboard root
  if (segments.length === 0 || (segments.length === 1 && segments[0] === "dashboard")) {
    return null;
  }

  const isNested = segments.length >= 2;
  const parentHref = "/" + segments.slice(0, -1).join("/");
  const parentLabel = labelFor(segments[segments.length - 2] ?? "dashboard");
  const currentLabel = labelFor(segments[segments.length - 1]);
  const showMobileBack = isNested && !OWN_BACK_BUTTON.some((re) => re.test(pathname));

  return (
    <>
      {/* Celular: sem menu lateral, uma tela interna (ex.: Ferramentas › Metas)
          precisa de um caminho claro de volta ao pai. */}
      {showMobileBack && (
        <nav
          aria-label="Voltar"
          className="app-mobile-subnav sm:hidden flex items-center gap-1 px-2 h-10 border-b border-border/20 bg-card/30 text-[12px]"
        >
          <button
            type="button"
            onClick={() => navigate(parentHref)}
            className="flex items-center gap-0.5 min-h-[40px] pl-1 pr-2.5 rounded-lg text-primary font-semibold active:bg-primary/10 transition-colors"
          >
            <ChevronLeft size={18} />
            <span className="truncate max-w-[40vw]">{parentLabel}</span>
          </button>
          <ChevronRight size={12} className="text-muted-foreground/40 shrink-0" />
          <span className="text-foreground font-semibold truncate min-w-0 px-1 capitalize">{currentLabel}</span>
        </nav>
      )}

      <nav
        aria-label="Breadcrumb"
        className="hidden sm:flex items-center gap-1 px-3 lg:px-6 h-9 border-b border-border/20 bg-card/30 text-[11px] text-muted-foreground"
      >
        <Link
          to="/dashboard"
          className="flex items-center gap-1 hover:text-foreground transition-colors px-1.5 py-0.5 rounded-md hover:bg-muted/40"
        >
          <Home size={11} />
          <span>Painel</span>
        </Link>
        {segments.map((seg, i) => {
          const href = "/" + segments.slice(0, i + 1).join("/");
          const isLast = i === segments.length - 1;
          return (
            <span key={href} className="flex items-center gap-1">
              <ChevronRight size={11} className="text-muted-foreground/40" />
              {isLast ? (
                <span className="text-foreground font-semibold px-1.5 py-0.5 capitalize">
                  {labelFor(seg)}
                </span>
              ) : (
                <Link
                  to={href}
                  className="hover:text-foreground transition-colors px-1.5 py-0.5 rounded-md hover:bg-muted/40 capitalize"
                >
                  {labelFor(seg)}
                </Link>
              )}
            </span>
          );
        })}
      </nav>
    </>
  );
};

export default Breadcrumbs;
