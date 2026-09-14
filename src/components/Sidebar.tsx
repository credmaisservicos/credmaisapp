import { useState, useMemo } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import defaultLogo from "@/assets/credmais-mark.svg";
import {
  ChevronDown, ChevronLeft, LogOut, Plus, Search, User,
} from "lucide-react";
import AppModeSwitcher from "@/components/AppModeSwitcher";
import { useAppMode } from "@/contexts/AppModeContext";
import { useAuth } from "@/contexts/AuthContext";
import { useWhiteLabel } from "@/contexts/WhiteLabelContext";
import { useChatUnread } from "@/hooks/useChatUnread";
import { usePlan } from "@/hooks/usePlan";
import {
  operationSections as sections,
  platformSections,
  menuIconTone,
  filterMenuSections,
  isMenuPathActive,
  type MenuItem,
  type MenuSection,
} from "@/components/navigation/menu";

interface SidebarProps {
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}

const Sidebar = ({ collapsed = false, onToggleCollapse }: SidebarProps) => {
  const location = useLocation();
  const navigate = useNavigate();
  const { profile, signOut, user, isPlatformAdmin } = useAuth();
  const { config } = useWhiteLabel();
  const logoSrc = config.companyLogo || defaultLogo;
  const brandName = config.companyName || "CREDMAIS APP";
  const chatUnread = useChatUnread();

  const modules = config.modulesEnabled;
  const { hasAutomations } = usePlan();
  const { mode } = useAppMode();

  const operationSections = useMemo(
    () => filterMenuSections(sections, { isPlatformAdmin, hasAutomations, modules }),
    [isPlatformAdmin, modules, hasAutomations],
  );

  // Em modo plataforma o menu de operação some por inteiro.
  const visibleSections = mode === "platform" ? platformSections : operationSections;

  const isActive = (path: string) => isMenuPathActive(path, location.pathname, location.search);

  const openGlobalSearch = () => {
    // dispara o atalho global Cmd/Ctrl+K (GlobalSearch escuta esse evento)
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true, ctrlKey: true }));
  };

  const renderItem = (item: MenuItem) => {
    const active = isActive(item.path);
    const Icon = item.icon;
    const badge = item.path === "/chat" && chatUnread > 0 ? chatUnread : item.badge || 0;

    return (
      <button
        key={item.path}
        onClick={() => navigate(item.path)}
        title={collapsed ? item.label : undefined}
          className={`
          group relative w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-[13px] font-medium
          transition-all duration-200 ease-out will-change-transform
          ${active
            ? "text-[#201a10] bg-gradient-to-r from-[#e3a33e] via-[#ffdc91] to-[#e3a33e] shadow-[0_8px_20px_rgba(245,189,89,.16)]"
            : "text-slate-300/75 hover:text-white hover:bg-white/[.07]"
          }
          ${collapsed ? "justify-center px-2" : ""}
        `}
      >
        <div className={`menu-app-icon menu-app-icon-${menuIconTone[item.path] || "slate"} ${active ? "is-active" : ""}`}>
          <Icon size={16} strokeWidth={active ? 2.5 : 2.1} />
          {item.highlight && !active && !collapsed && (
            <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full bg-amber-400 shadow-[0_0_6px_hsl(45_95%_55%/0.8)]" />
          )}
          {badge > 0 && collapsed && (
            <span className="absolute -top-1.5 -right-1.5 min-w-[16px] h-4 px-1 rounded-full bg-destructive text-destructive-foreground text-[9px] font-bold flex items-center justify-center ring-2 ring-card">
              {badge > 9 ? "9+" : badge}
            </span>
          )}
        </div>

        {!collapsed && (
          <span className={`truncate flex-1 text-left ${active ? "font-semibold tracking-tight" : ""}`}>{item.label}</span>
        )}

        {!collapsed && badge > 0 && (
          <span className="min-w-[20px] h-[20px] px-1.5 rounded-full bg-destructive text-destructive-foreground text-[10px] font-bold flex items-center justify-center shrink-0 shadow-[0_2px_6px_hsl(var(--destructive)/0.4)]">
            {badge > 99 ? "99+" : badge}
          </span>
        )}

        {collapsed && (
          <div className="absolute left-full ml-2 px-2.5 py-1.5 rounded-lg bg-popover border border-border/60 text-[12px] text-foreground whitespace-nowrap opacity-0 pointer-events-none group-hover:opacity-100 transition-opacity shadow-xl z-50">
            {item.label}
          </div>
        )}
      </button>
    );
  };



  const [openSections, setOpenSections] = useState<Record<string, boolean>>({});
  const toggleSection = (title: string) =>
    setOpenSections((prev) => ({ ...prev, [title]: !prev[title] }));

  const renderSection = (section: MenuSection, index: number) => {
    const sectionHasActive = section.items.some((i) => isActive(i.path));
    const isCollapsible = !!section.collapsible && !collapsed;
    const userToggled = openSections[section.title];
    const isOpen = isCollapsible
      ? (userToggled !== undefined ? userToggled : (section.defaultOpen || sectionHasActive))
      : true;

    return (
      <div key={section.title} className={index > 0 ? "mt-4" : ""}>
        {!collapsed && (
          <button
            type="button"
            onClick={isCollapsible ? () => toggleSection(section.title) : undefined}
            className={`
              w-full flex items-center gap-2 px-3 py-1.5 mb-1 rounded-md
              ${isCollapsible ? "hover:bg-accent/25 cursor-pointer" : "cursor-default"}
            `}
          >
            <p className={`text-[10px] font-bold uppercase tracking-[0.16em] transition-colors ${sectionHasActive ? "text-orange-300" : "text-slate-400/55"}`}>
              {section.title}
            </p>
            <div className="flex-1 h-px bg-gradient-to-r from-white/10 to-transparent ml-1" />
            {isCollapsible && (
              <ChevronDown
                size={11}
                className={`text-muted-foreground/50 transition-transform ${isOpen ? "rotate-0" : "-rotate-90"}`}
              />
            )}
          </button>
        )}

        {isOpen && (
          <div className="space-y-1 animate-fade-in">
            {section.items.map(renderItem)}
          </div>
        )}

      </div>
    );
  };


  const handleSignOut = async () => {
    await signOut();
    navigate("/");
  };

  const sidebarBg = config.sidebarStyle === "gradient"
    ? `linear-gradient(180deg, hsl(var(--card) / 0.98), ${config.primaryColor}08)`
    : undefined;

  return (
    <aside
      className={`
        fixed left-0 top-0 h-dvh flex flex-col z-50
        transition-[width] duration-300 ease-out
        border-r border-border/10 shadow-2xl shadow-black/40
        ${collapsed ? "w-[76px]" : "w-[240px]"}
      `}
      style={{
        background: sidebarBg || "linear-gradient(180deg, #090a0d 0%, #060709 55%, #040506 100%)",
        backdropFilter: "blur(24px)",
      }}
    >
      {/* Logo */}
      <div className={`flex items-center h-[72px] border-b border-white/[.08] shrink-0 ${collapsed ? "justify-center px-2" : "px-5 gap-3"}`}>
        <div className="relative shrink-0">
          <img src={logoSrc} alt={brandName} width={30} height={30} className="rounded-lg ring-1 ring-primary/20" />
          <span className="absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full bg-emerald-500 ring-2 ring-card" />
        </div>
        {!collapsed && (
          <div className="flex flex-col min-w-0 overflow-hidden">
            <span className="text-[13px] font-bold tracking-wide text-gradient-gold leading-none truncate">
              {brandName.split(" ")[0] || brandName}
            </span>
            <span className="text-[9px] font-semibold tracking-[0.15em] text-muted-foreground/40 leading-tight truncate">
              {brandName.split(" ").slice(1).join(" ") || "PRO"}
            </span>
          </div>
        )}
      </div>

      {/* Botão colapsar */}
      <button
        onClick={onToggleCollapse}
        className="absolute -right-3 top-14 w-7 h-7 rounded-full bg-zinc-950 border border-white/15 shadow-xl flex items-center justify-center text-zinc-400 hover:text-white hover:border-white/35 transition-colors z-10"
        title={collapsed ? "Expandir" : "Minimizar"}
      >
        <span className={`transition-transform duration-300 ${collapsed ? "rotate-0" : "rotate-180"}`}>
          <ChevronLeft size={12} />
        </span>
      </button>

      <AppModeSwitcher collapsed={collapsed} />

      {/* Busca rápida + Ação rápida (só no app de operação) */}
      {mode !== "platform" && !collapsed && (
        <div className="px-3 pt-3 pb-2 space-y-1.5">
          <button
            onClick={openGlobalSearch}
            className="w-full flex items-center gap-2 h-9 px-3 rounded-lg bg-white/[.06] border border-white/[.08] text-[12px] text-slate-300/70 hover:bg-white/[.1] hover:text-white transition-colors"
          >
            <Search size={13} />
            <span className="flex-1 text-left">Buscar...</span>
            <kbd className="hidden lg:inline text-[9px] font-mono px-1.5 py-0.5 rounded bg-muted/50 border border-border/30">⌘K</kbd>
          </button>
          <button
            onClick={() => navigate("/clientes/novo")}
            className="w-full flex items-center justify-center gap-1.5 h-9 rounded-lg bg-gradient-to-r from-[#e3a33e] via-[#ffdc91] to-[#e3a33e] text-[#201a10] text-[12px] font-bold hover:brightness-110 transition-colors shadow-md shadow-amber-950/30"
          >
            <Plus size={13} /> Novo cliente
          </button>
        </div>
      )}

      {mode !== "platform" && collapsed && (
        <div className="px-2 pt-3 pb-1 flex flex-col gap-1.5">
          <button
            onClick={openGlobalSearch}
            title="Buscar (⌘K)"
            className="w-full h-9 rounded-lg bg-accent/30 hover:bg-accent/50 flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
          >
            <Search size={15} />
          </button>
          <button
            onClick={() => navigate("/clientes/novo")}
            title="Novo cliente"
            className="w-full h-9 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 flex items-center justify-center transition-colors"
          >
            <Plus size={15} />
          </button>
        </div>
      )}

      {/* Navegação */}
      <nav
        className="flex-1 overflow-y-auto px-2 py-2 scrollbar-none"
        style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
      >
        {visibleSections.map((section, idx) => renderSection(section, idx))}
      </nav>

      {/* Footer do usuário */}
      <div className={`shrink-0 border-t border-border/10 p-2.5 bg-background/20 ${collapsed ? "flex flex-col items-center gap-2" : ""}`}>
        {!collapsed ? (
          <div className="flex items-center gap-2 p-1.5 rounded-lg hover:bg-accent/30 transition-colors group">
            <div
              className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0 ring-1 ring-primary/15 cursor-pointer"
              onClick={() => navigate("/perfil")}
            >
              {profile?.avatar_url ? (
                <img src={profile.avatar_url} alt="" className="w-8 h-8 rounded-lg object-cover" />
              ) : (
                <User size={15} className="text-primary" />
              )}
            </div>
            <div className="flex-1 min-w-0 cursor-pointer" onClick={() => navigate("/perfil")}>
              <p className="text-[12px] font-semibold text-foreground truncate leading-tight">
                {profile?.name || "Usuário"}
              </p>
              <p className="text-[10px] text-muted-foreground/50 truncate">{profile?.email || ""}</p>
            </div>
            <button
              onClick={(e) => { e.stopPropagation(); handleSignOut(); }}
              className="p-1.5 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
              title="Sair"
              aria-label="Sair da conta"
            >
              <LogOut size={13} />
            </button>

          </div>
        ) : (
          <>
            <button
              onClick={() => navigate("/perfil")}
              className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center hover:bg-primary/15 transition-colors"
              title={profile?.name || "Perfil"}
            >
              {profile?.avatar_url ? (
                <img src={profile.avatar_url} alt="" className="w-9 h-9 rounded-lg object-cover" />
              ) : (
                <User size={15} className="text-primary" />
              )}
            </button>
            <button
              onClick={handleSignOut}
              className="p-1.5 rounded-md text-muted-foreground/40 hover:text-destructive hover:bg-destructive/10 transition-colors"
              title="Sair"
            >
              <LogOut size={13} />
            </button>
          </>
        )}
      </div>
    </aside>
  );
};

export default Sidebar;
