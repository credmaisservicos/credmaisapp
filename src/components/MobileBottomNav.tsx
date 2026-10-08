import {UploadImage} from '@/components/UploadMedia';
import { useNavigate, useLocation, Link } from "react-router-dom";
import {
  LayoutDashboard, Users, Receipt, MoreHorizontal, ClipboardList, Settings,
  MessageCircle, X, Sparkles, Plus, UserPlus, Wallet as WalletIcon, StickyNote,
  Search, Sun, Moon, Globe, LogOut, User, ChevronRight, Bell, Receipt as ReceiptIcon,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useAppMode } from "@/contexts/AppModeContext";
import { useTheme } from "@/contexts/ThemeContext";
import { useWhiteLabel } from "@/contexts/WhiteLabelContext";
import { usePlan } from "@/hooks/usePlan";
import { useChatUnread } from "@/hooks/useChatUnread";
import { LANGUAGES, useI18n } from "@/lib/i18n";
import {
  operationSections,
  platformSections,
  menuIconTone,
  filterMenuSections,
  isMenuPathActive,
  type MenuItem,
} from "@/components/navigation/menu";

interface Tab { label: string; icon: typeof Users; path: string }

const MORE = "__more__";

/** Abas fixas do app de operação. O que não cabe aqui vive no menu "Mais". */
const mainTabs: Tab[] = [
  { label: "Hoje", icon: Sparkles, path: "/hoje" },
  { label: "Cobranças", icon: Receipt, path: "/cobrancas" },
  { label: "Clientes", icon: Users, path: "/clientes" },
  { label: "Painel", icon: LayoutDashboard, path: "/dashboard" },
  { label: "Mais", icon: MoreHorizontal, path: MORE },
];

/** Barra do painel do dono do app — no celular substitui a de operação. */
const platformTabs: Tab[] = [
  { label: "Usuários", icon: Users, path: "/admin" },
  { label: "Suporte", icon: MessageCircle, path: "/admin?secao=support" },
  { label: "Logs", icon: ClipboardList, path: "/admin?secao=logs" },
  { label: "Sistema", icon: Settings, path: "/admin?secao=settings" },
  { label: "Mais", icon: MoreHorizontal, path: MORE },
];

const normalize = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

interface MobileBottomNavProps {
  onQuickPayment?: () => void;
}

const MobileBottomNav = ({ onQuickPayment }: MobileBottomNavProps) => {
  const location = useLocation();
  const navigate = useNavigate();
  const { profile, signOut, isPlatformAdmin } = useAuth();
  const { mode } = useAppMode();
  const { theme, toggleTheme } = useTheme();
  const { config } = useWhiteLabel();
  const { hasAutomations } = usePlan();
  const { lang, setLang } = useI18n();
  const chatUnread = useChatUnread();

  const [showMore, setShowMore] = useState(false);
  const [showFab, setShowFab] = useState(false);
  const [query, setQuery] = useState("");

  // Telas de preencher formulário: o botão flutuante atrapalha mais do que ajuda.
  const emFormulario = /^\/(clientes\/novo|configuracoes|perfil)/.test(location.pathname);
  const isPlatformMode = mode === "platform";
  const visibleTabs = isPlatformMode ? platformTabs : mainTabs;

  // Menu "Mais": mesmas seções e mesmas regras do menu lateral, menos o que já
  // está nas abas fixas (não faz sentido repetir Clientes/Cobranças aqui).
  const tabPaths = useMemo(() => new Set(visibleTabs.map((t) => t.path)), [visibleTabs]);
  const sections = useMemo(() => {
    const base = isPlatformMode
      ? platformSections
      : filterMenuSections(operationSections, { isPlatformAdmin, hasAutomations, modules: config.modulesEnabled });
    return base
      .map((s) => ({ ...s, items: s.items.filter((i) => !tabPaths.has(i.path)) }))
      .filter((s) => s.items.length > 0);
  }, [isPlatformMode, isPlatformAdmin, hasAutomations, config.modulesEnabled, tabPaths]);

  const allItems = useMemo(() => sections.flatMap((s) => s.items), [sections]);
  const filtered = useMemo(() => {
    const q = normalize(query.trim());
    if (!q) return null;
    return allItems.filter((i) => normalize(i.label).includes(q));
  }, [query, allItems]);

  const activeMenuPaths = useMemo(
    () => [...visibleTabs.map((tab) => tab.path), ...allItems.map((item) => item.path)],
    [visibleTabs, allItems],
  );
  const isActive = (path: string) => isMenuPathActive(path, location.pathname, location.search, activeMenuPaths);
  const isInMoreSection = allItems.some((i) => isActive(i.path));

  // Trocar de tela fecha o menu e o botão flutuante; nada fica sobrando por cima da página nova.
  useEffect(() => { setShowMore(false); setShowFab(false); setQuery(""); }, [location.pathname, location.search]);

  // Com o menu aberto a página de trás não rola e Esc fecha (teclado externo / desktop estreito).
  useEffect(() => {
    if (!showMore) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setShowMore(false); };
    document.addEventListener("keydown", esc);
    return () => { document.body.style.overflow = prev; document.removeEventListener("keydown", esc); };
  }, [showMore]);

  const go = (path: string) => { navigate(path); setShowMore(false); };

  const fabActions = [
    { label: "Novo cliente", icon: UserPlus, onClick: () => navigate("/clientes/novo") },
    { label: "Registrar pagamento", icon: ReceiptIcon, onClick: () => onQuickPayment?.() },
    { label: "Cobrar agora", icon: WalletIcon, onClick: () => navigate("/cobrancas") },
    { label: "Nova anotação", icon: StickyNote, onClick: () => navigate("/ferramentas/anotacoes") },
  ];

  const renderItem = (item: MenuItem) => {
    const active = isActive(item.path);
    const badge = item.path === "/chat" && chatUnread > 0 ? chatUnread : item.badge || 0;
    return (
      <Link
        key={item.path}
        to={item.path}
        onClick={() => setShowMore(false)}
        aria-current={active ? "page" : undefined}
        className={`mobile-menu-item relative flex flex-col items-center gap-1.5 p-2 rounded-xl transition-[color,background-color,box-shadow,transform] duration-200 active:scale-95 ${
          active ? "bg-primary/15 shadow-[0_0_12px_hsl(var(--primary)/0.15)]" : "hover:bg-accent/40"
        }`}
      >
        <span className={`mobile-app-icon mobile-app-icon-${menuIconTone[item.path] || "slate"}`}>
          <item.icon aria-hidden="true" size={19} strokeWidth={active ? 2.5 : 2} />
        </span>
        {badge > 0 && (
          <span className="absolute top-1 right-2 min-w-[16px] h-4 px-1 rounded-full bg-destructive text-destructive-foreground text-[9px] font-bold flex items-center justify-center ring-2 ring-background">
            {badge > 9 ? "9+" : badge}
          </span>
        )}
        <span className={`mobile-menu-label text-[10px] font-semibold leading-tight text-center ${active ? "text-primary" : "text-muted-foreground"}`}>
          {item.label}
        </span>
      </Link>
    );
  };

  const currentLang = LANGUAGES.find((l) => l.code === lang) ?? LANGUAGES[0];
  const nextLang = LANGUAGES[(LANGUAGES.findIndex((l) => l.code === currentLang.code) + 1) % LANGUAGES.length];

  return (
    <>
      {/* Menu "Mais" */}
      {showMore && (
        <>
          <div
            className="fixed inset-0 bg-background/70 backdrop-blur-xs z-28 animate-fade-in"
            onClick={() => setShowMore(false)}
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Menu completo"
            className="mobile-more-sheet fixed left-0 right-0 z-31 px-3 pb-2 animate-slide-up"
            style={{ bottom: "calc(4.75rem + env(safe-area-inset-bottom, 0px))" }}
          >
            <div className="glass-strong rounded-2xl border border-border/40 max-h-[72vh] flex flex-col shadow-2xl overflow-hidden">
              {/* Cabeçalho: quem está logado + fechar */}
              <div className="shrink-0 px-4 pt-3 pb-3 border-b border-border/30">
                <div className="mx-auto w-10 h-1 rounded-full bg-muted-foreground/30 mb-3" aria-hidden="true" />
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => go("/perfil")}
                    className="flex items-center gap-3 min-w-0 flex-1 text-left active:scale-[.98] transition-transform"
                  >
                    <span className="w-10 h-10 rounded-full bg-linear-to-br from-primary/25 to-primary/5 ring-1 ring-primary/25 flex items-center justify-center shrink-0 overflow-hidden">
                      {profile?.avatar_url ? (
                        <UploadImage src={profile.avatar_url} alt="" className="w-10 h-10 object-cover" />
                      ) : (
                        <User size={17} className="text-primary" />
                      )}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[13px] font-bold text-foreground truncate leading-tight">{profile?.name || "Usuário"}</span>
                      <span className="block text-[11px] text-muted-foreground truncate">{profile?.email || "Meu perfil"}</span>
                    </span>
                    <ChevronRight aria-hidden="true" size={15} className="text-muted-foreground/60 shrink-0" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowMore(false)}
                    aria-label="Fechar menu"
                    className="w-9 h-9 rounded-full hover:bg-accent/50 flex items-center justify-center transition-colors shrink-0"
                  >
                    <X size={18} className="text-muted-foreground" />
                  </button>
                </div>

                {/* Busca dentro do menu */}
                <label className="mt-3 flex items-center gap-2 h-10 px-3 rounded-xl bg-white/5 border border-white/10 focus-within:border-primary/50 transition-colors">
                  <Search size={14} className="text-muted-foreground shrink-0" />
                  <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Buscar no menu…"
                    aria-label="Buscar no menu"
                    name="menu-search"
                    autoComplete="off"
                    className="flex-1 min-w-0 bg-transparent text-[13px] text-foreground placeholder:text-muted-foreground/70 outline-hidden"
                  />
                  {query && (
                    <button type="button" onClick={() => setQuery("")} aria-label="Limpar busca" className="p-1 rounded-md text-muted-foreground">
                      <X size={13} />
                    </button>
                  )}
                </label>
              </div>

              {/* Conteúdo rolável */}
              <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-4 py-4">
                {filtered ? (
                  filtered.length > 0 ? (
                    <div className="mobile-menu-grid grid grid-cols-4 gap-2">{filtered.map(renderItem)}</div>
                  ) : (
                    <p className="py-8 text-center text-[12px] text-muted-foreground">Nenhuma tela com esse nome.</p>
                  )
                ) : (
                  <div className="space-y-5">
                    {sections.map((group) => (
                      <section key={group.title} aria-label={group.title}>
                        <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-muted-foreground/60 mb-2 px-1">
                          {group.title}
                        </p>
                        <div className="mobile-menu-grid grid grid-cols-4 gap-2">{group.items.map(renderItem)}</div>
                      </section>
                    ))}
                  </div>
                )}
              </div>

              {/* Rodapé: preferências que antes lotavam a barra superior */}
              <div className="shrink-0 border-t border-border/30 px-3 py-2.5 grid grid-cols-4 gap-1.5">
                <button
                  type="button"
                  onClick={toggleTheme}
                  className="mobile-menu-pref flex flex-col items-center gap-1 py-2 rounded-xl hover:bg-accent/40 text-muted-foreground"
                  aria-label={theme === "dark" ? "Ativar modo claro" : "Ativar modo escuro"}
                >
                  {theme === "dark" ? <Sun aria-hidden="true" size={17} className="text-amber-400" /> : <Moon aria-hidden="true" size={17} className="text-primary" />}
                  <span className="text-[10px] font-semibold">{theme === "dark" ? "Claro" : "Escuro"}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setLang(nextLang.code)}
                  className="mobile-menu-pref flex flex-col items-center gap-1 py-2 rounded-xl hover:bg-accent/40 text-muted-foreground"
                  aria-label={`Idioma: ${currentLang.label}. Trocar para ${nextLang.label}`}
                >
                  <Globe aria-hidden="true" size={17} />
                  <span className="text-[10px] font-semibold">{currentLang.flag} {currentLang.code.split("-")[0].toUpperCase()}</span>
                </button>
                <button
                  type="button"
                  onClick={() => go("/notificacoes")}
                  aria-label="Abrir avisos"
                  className="mobile-menu-pref flex flex-col items-center gap-1 py-2 rounded-xl hover:bg-accent/40 text-muted-foreground"
                >
                  <Bell aria-hidden="true" size={17} />
                  <span className="text-[10px] font-semibold">Avisos</span>
                </button>
                <button
                  type="button"
                  onClick={async () => { setShowMore(false); await signOut(); navigate("/"); }}
                  aria-label="Sair da conta"
                  className="mobile-menu-pref flex flex-col items-center gap-1 py-2 rounded-xl hover:bg-destructive/10 text-destructive"
                >
                  <LogOut aria-hidden="true" size={17} />
                  <span className="text-[10px] font-semibold">Sair</span>
                </button>
              </div>
            </div>
          </div>
        </>
      )}

      {/* FAB - Ações rápidas */}
      {showFab && (
        <div
          className="fixed inset-0 z-28 bg-background/40 backdrop-blur-xs animate-fade-in"
          onClick={() => setShowFab(false)}
        />
      )}
      {/* Ações rápidas são de operação — não fazem sentido no painel do dono.
          Também somem nas telas de formulário e com o menu aberto: ali o botão
          flutuante fica por cima do que a pessoa está usando. */}
      <div
        className={`mobile-fab fixed right-4 z-30 flex-col items-end gap-2.5 ${isPlatformMode || emFormulario || showMore ? "hidden" : "flex"}`}
        style={{ bottom: "calc(5rem + env(safe-area-inset-bottom, 0px))" }}
      >
        {showFab && fabActions.map((a, i) => (
          <button
            key={a.label}
            type="button"
            onClick={() => { setShowFab(false); a.onClick(); }}
            style={{ animationDelay: `${i * 40}ms` }}
            className="animate-slide-up flex items-center gap-2.5 pl-3 pr-4 py-2.5 rounded-full bg-card border border-border/40 shadow-xl text-foreground text-[13px] font-semibold hover:scale-105 transition-transform"
          >
            <a.icon aria-hidden="true" size={16} className="text-primary" />
            {a.label}
          </button>
        ))}
        <button
          type="button"
          onClick={() => setShowFab(!showFab)}
          aria-label="Ações rápidas"
          aria-expanded={showFab}
          className={`w-14 h-14 rounded-full bg-primary text-primary-foreground shadow-2xl shadow-primary/30 flex items-center justify-center transition-transform active:scale-90 ${showFab ? "rotate-45" : ""}`}
        >
          <Plus aria-hidden="true" size={26} strokeWidth={2.5} />
        </button>
      </div>

      {/* Bottom nav */}
      <nav
        aria-label="Navegação principal"
        className="mobile-bottom-nav fixed bottom-0 left-0 right-0 z-30 border-t border-white/10 bg-black/75 backdrop-blur-2xl shadow-[0_-16px_40px_-28px_hsl(0_0%_0%/.9)]"
        style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
      >
        <div className="flex items-stretch justify-around px-1.5 pt-1 pb-1">
          {visibleTabs.map((tab) => {
            const active = tab.path === MORE ? showMore || isInMoreSection : isActive(tab.path);
            const className = `relative flex flex-col items-center justify-center gap-0.5 flex-1 min-h-[52px] rounded-xl transition-[color,transform,background-color] duration-200 active:scale-95 ${
              active ? "text-primary" : "text-muted-foreground"
            }`;
            const content = (
              <>
                {active && (
                  <div className="absolute top-0 left-1/2 -translate-x-1/2 w-8 h-[3px] rounded-full bg-primary shadow-[0_0_8px_hsl(var(--primary)/0.5)] animate-scale-in" />
                )}
                <div className={`p-1 rounded-xl transition-transform duration-200 ${active ? "scale-105" : ""}`}>
                  <span className={`mobile-app-icon mobile-app-icon-${menuIconTone[tab.path] || "slate"}`}>
                    <tab.icon aria-hidden="true" size={20} strokeWidth={active ? 2.5 : 2} />
                  </span>
                </div>
                <span className={`text-[10px] font-semibold leading-none ${active ? "text-primary" : "text-muted-foreground"}`}>
                  {tab.label}
                </span>
              </>
            );
            if (tab.path === MORE) return (
              <button
                key={tab.label}
                type="button"
                onClick={() => setShowMore((v) => !v)}
                aria-expanded={showMore}
                className={className}
              >
                {content}
              </button>
            );
            return <Link key={tab.label} to={tab.path} aria-current={active ? "page" : undefined} className={className}>{content}</Link>;
          })}
        </div>
      </nav>
    </>
  );
};

export default MobileBottomNav;
