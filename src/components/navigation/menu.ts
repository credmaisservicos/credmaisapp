import type { LucideIcon } from "lucide-react";
import {
  LayoutDashboard, BarChart3, Users, Receipt, Wallet,
  TrendingUp, DollarSign, Database, Target, Calculator,
  CheckSquare, StickyNote, Table, FileText,
  Crown, Sparkles, Settings, Bot, QrCode,
  UserCheck, Shield, Cog, User, LifeBuoy, MessageCircle,
  Archive, Landmark, Activity, Terminal, Smartphone, ShieldCheck,
} from "lucide-react";
import type { ModuleKey } from "@/contexts/WhiteLabelContext";

/**
 * Fonte única do menu do app.
 *
 * O menu lateral (desktop) e o menu "Mais" (celular) leem daqui, então uma
 * tela nova, uma regra de plano ou um módulo desligado no white-label valem
 * para os dois de uma vez. Antes cada um tinha a própria lista e o celular
 * mostrava telas restritas (auditoria, histórico) para qualquer usuário.
 */
export interface MenuItem {
  label: string;
  icon: LucideIcon;
  path: string;
  badge?: number;
  highlight?: boolean;
  module?: ModuleKey;
  /** Disponível somente no plano Completo (R$299) */
  pro?: boolean;
}

export interface MenuSection {
  title: string;
  items: MenuItem[];
  collapsible?: boolean;
  defaultOpen?: boolean;
}

/** Tom do ícone por rota — usado nos dois menus para o ícone ser o mesmo. */
export const menuIconTone: Record<string, string> = {
  "/hoje": "amber", "/dashboard": "blue", "/analises": "violet", "/clientes": "orange",
  "/cobrancas": "rose", "/investidores": "teal", "/carteira": "emerald", "/comercial": "indigo", "/garantias": "yellow",
  "/lucros": "green", "/gastos": "red", "/relatorios": "sky", "/historico-financeiro": "slate",
  "/comunicacao": "purple", "/comunicacao/inbox": "pink", "/chat": "cyan", "/cobradores": "lime",
  "/qrcode": "blue", "/ferramentas/simulador": "violet", "/ferramentas/metas": "amber", "/ferramentas/tarefas": "green",
  "/ferramentas/anotacoes": "yellow", "/ferramentas/planilha": "cyan", "/puxada-dados": "slate", "/configuracoes": "slate",
  "/suporte": "pink", "/auditoria": "red", "/admin": "amber", "/historico": "slate", "/perfil": "blue",
  "/notificacoes": "orange", "/sobre": "slate",
  "/admin?secao=support": "pink", "/admin?secao=automations": "violet", "/admin?secao=logs": "slate",
  "/admin?secao=settings": "amber", "/admin/bot-audit": "purple",
};

export const operationSections: MenuSection[] = [
  {
    title: "Início",
    items: [
      { label: "Hoje", icon: Sparkles, path: "/hoje", highlight: true },
      { label: "Painel", icon: LayoutDashboard, path: "/dashboard" },
      { label: "Análises", icon: BarChart3, path: "/analises", module: "analises" },
    ],
  },
  {
    title: "Operação",
    items: [
      { label: "Clientes", icon: Users, path: "/clientes" },
      { label: "Cobranças", icon: Receipt, path: "/cobrancas" },
      { label: "Investidores", icon: Landmark, path: "/investidores" },
      { label: "Carteira", icon: Wallet, path: "/carteira" },
      { label: "Comercial", icon: Smartphone, path: "/comercial" },
      { label: "Garantias", icon: ShieldCheck, path: "/garantias" },
    ],
  },
  {
    title: "Financeiro",
    items: [
      { label: "Lucros", icon: TrendingUp, path: "/lucros", module: "lucros" },
      { label: "Gastos", icon: DollarSign, path: "/gastos", module: "gastos" },
      { label: "Relatórios", icon: FileText, path: "/relatorios", module: "relatorios" },
      { label: "Histórico financeiro", icon: Archive, path: "/historico-financeiro" },
    ],
  },
  {
    title: "Comunicação & Automações",
    collapsible: true,
    defaultOpen: true,
    items: [
      { label: "Atendimento", icon: Bot, path: "/comunicacao", pro: true },
      { label: "Conversas", icon: MessageCircle, path: "/comunicacao/inbox", module: "comunicacao_inbox", pro: true },
      { label: "Chat interno", icon: MessageCircle, path: "/chat", module: "chat_interno" },
      { label: "Cobradores", icon: UserCheck, path: "/cobradores", module: "cobradores" },
      { label: "QR Code de acesso", icon: QrCode, path: "/qrcode", module: "portais" },
    ],
  },
  {
    title: "Ferramentas",
    collapsible: true,
    defaultOpen: false,
    items: [
      { label: "Simulador", icon: Calculator, path: "/ferramentas/simulador", module: "simulador" },
      { label: "Metas", icon: Target, path: "/ferramentas/metas", module: "metas" },
      { label: "Tarefas", icon: CheckSquare, path: "/ferramentas/tarefas", module: "tarefas" },
      { label: "Anotações", icon: StickyNote, path: "/ferramentas/anotacoes", module: "anotacoes" },
      { label: "Planilha", icon: Table, path: "/ferramentas/planilha", module: "planilha" },
      { label: "Consulta CPF/CNPJ", icon: Database, path: "/puxada-dados", module: "puxada_dados" },
    ],
  },
  {
    title: "Sistema",
    collapsible: true,
    defaultOpen: false,
    items: [
      { label: "Configurações", icon: Settings, path: "/configuracoes" },
      { label: "Suporte", icon: LifeBuoy, path: "/suporte" },
      { label: "Auditoria", icon: Shield, path: "/auditoria" },
      { label: "Admin", icon: Crown, path: "/admin" },
    ],
  },
];

/**
 * Menu do painel do dono do app. Em modo "plataforma" ele SUBSTITUI o menu de
 * operação por completo — nenhuma tela de credor (clientes, contratos,
 * cobranças) aparece aqui.
 */
export const platformSections: MenuSection[] = [
  {
    title: "Plataforma",
    items: [
      { label: "Usuários & Assinaturas", icon: Users, path: "/admin" },
      { label: "Suporte", icon: LifeBuoy, path: "/admin?secao=support" },
      { label: "Automações", icon: Activity, path: "/admin?secao=automations" },
      { label: "Logs do sistema", icon: Terminal, path: "/admin?secao=logs" },
      { label: "Manutenção & Controle", icon: Cog, path: "/admin?secao=settings" },
    ],
  },
  {
    title: "Diagnóstico",
    items: [
      { label: "Auditoria do bot", icon: Bot, path: "/admin/bot-audit" },
      { label: "Trilha de auditoria", icon: Shield, path: "/auditoria" },
      { label: "Histórico", icon: Archive, path: "/historico" },
    ],
  },
  {
    title: "Conta",
    items: [{ label: "Meu perfil", icon: User, path: "/perfil" }],
  },
];

/** Rotas que só o dono do app enxerga, em qualquer menu. */
const ADMIN_ONLY_PATHS = ["/admin", "/auditoria", "/historico"];

export interface MenuVisibility {
  isPlatformAdmin: boolean;
  hasAutomations: boolean;
  modules?: Partial<Record<ModuleKey, boolean>> | null;
}

/** Aplica plano, módulos do white-label e permissão de admin a uma lista de seções. */
export function filterMenuSections(sections: MenuSection[], v: MenuVisibility): MenuSection[] {
  return sections
    .map((s) => ({
      ...s,
      items: s.items.filter((i) => {
        const basePath = i.path.split("?", 1)[0];
        if (ADMIN_ONLY_PATHS.some((path) => basePath === path || basePath.startsWith(`${path}/`))) return v.isPlatformAdmin;
        if (i.pro && !v.hasAutomations) return false;
        if (i.module && v.modules && v.modules[i.module] === false) return false;
        return true;
      }),
    }))
    .filter((s) => s.items.length > 0);
}

/**
 * Item ativo pela rota atual. Itens do painel apontam para /admin?secao=x, então
 * a comparação leva a query em conta — senão todos ficariam ativos juntos.
 */
export function isMenuPathActive(path: string, pathname: string, search: string, menuPaths?: string[]): boolean {
  const [p, q] = path.split("?");
  const samePath = pathname === p || pathname.startsWith(p + "/");
  if (!samePath) return false;
  if (pathname !== p && menuPaths?.some((candidate) => {
    const [candidatePath, candidateQuery] = candidate.split("?");
    return candidatePath !== p && candidatePath.startsWith(p + "/") && pathname === candidatePath
      && (!candidateQuery || new URLSearchParams(search).get("secao") === new URLSearchParams(candidateQuery).get("secao"));
  })) return false;
  const current = new URLSearchParams(search).get("secao");
  if (!q) return !current;
  return current === new URLSearchParams(q).get("secao");
}
