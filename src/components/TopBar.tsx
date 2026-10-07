import { useState, useEffect, useRef } from "react";
import { TrendingUp, LogOut, Sun, Moon, Search, Wallet, User, Settings, Plus, Users, Receipt, Landmark, UserPlus, ListTodo, Calculator, ChevronDown, AlertTriangle } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useTheme } from "@/contexts/ThemeContext";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useIsMobile } from "@/hooks/use-mobile";
import { useQuery } from "@tanstack/react-query";
import { useMultiTableRealtime } from "@/hooks/useRealtimeSubscription";
import NotificationsBell from "./NotificationsBell";
import LanguageSwitcher from "./LanguageSwitcher";
import AppModeSwitcher from "./AppModeSwitcher";
import { fetchAll } from "@/lib/fetchAll";

const safeNumber = (value: unknown) => {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
};

interface TopBarProps {
  onSearchClick?: () => void;
  onQuickPayment?: () => void;
}

const TopBar = ({ onSearchClick, onQuickPayment }: TopBarProps) => {
  const { user, profile, signOut, isPlatformAdmin } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const [quickOpen, setQuickOpen] = useState(false);
  const quickRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!quickOpen) return;
    const handler = (e: MouseEvent) => {
      if (quickRef.current && !quickRef.current.contains(e.target as Node)) setQuickOpen(false);
    };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setQuickOpen(false); };
    document.addEventListener("mousedown", handler);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", handler);
      document.removeEventListener("keydown", esc);
    };
  }, [quickOpen]);

  const { data: financials, isLoading: financialsLoading, isError: financialsError } = useQuery({
    queryKey: ["topbar-financials", user?.id],
    queryFn: async () => {
      const nowIso = new Date().toISOString();
      const [contracts, profits, overdueInstallments] = await Promise.all([
        fetchAll((f, t) => supabase.from("contracts").select("capital, status").eq("user_id", user!.id).range(f, t)),
        fetchAll((f, t) => supabase.from("profits").select("amount").eq("user_id", user!.id).eq("status", "available").range(f, t)),
        // O HEAD count recebe 403 em algumas combinações de PostgREST + RLS.
        fetchAll((f, t) => supabase.from("contract_installments").select("id")
          .eq("user_id", user!.id).neq("status", "paid").neq("status", "cancelled").lt("due_date", nowIso).range(f, t)),
      ]);
      const activeContracts = contracts.filter((c: any) => c.status === "active" || c.status === "overdue");
      const carteira = activeContracts.reduce((s: number, c: any) => s + safeNumber(c.capital), 0);
      const lucro = profits.reduce((s: number, p: any) => s + safeNumber(p.amount), 0);
      const overdue = overdueInstallments.length;
      return { carteira, lucro, overdue };
    },
    enabled: !!user,
    staleTime: 60_000,
  });

  useMultiTableRealtime(
    ["contracts", "profits", "contract_installments"],
    [["topbar-financials", user?.id]],
  );

  const handleSignOut = async () => {
    await signOut();
    navigate("/");
  };

  const fmt = (v: number) => safeNumber(v).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const financialValue = (value?: number) => financialsLoading || financialsError ? "—" : `R$ ${fmt(value ?? 0)}`;

  return (
    <header
      className="app-topbar sticky top-0 z-40 border-b border-white/8 bg-background/85 backdrop-blur-2xl shadow-[0_12px_35px_-28px_rgba(0,0,0,.9)]"
      style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}
    >
      <div className="h-16 lg:h-[72px] flex items-center justify-between px-3 lg:px-7 gap-2 lg:gap-4">
      {isMobile ? (
        <button
          onClick={() => navigate("/perfil")}
          className="flex items-center gap-2 min-w-0 max-w-[45%] active:scale-95 transition-transform"
        >
          <div className="relative w-9 h-9 rounded-full bg-linear-to-br from-primary/25 to-primary/5 flex items-center justify-center ring-1 ring-primary/25 shrink-0 shadow-xs">
            {profile?.avatar_url ? (
              <img src={profile.avatar_url} alt="" className="w-9 h-9 rounded-full object-cover" />
            ) : (
              <User size={16} className="text-primary" />
            )}
            <span className="absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full bg-success border-2 border-background" />
          </div>
          <div className="text-left min-w-0">
            <p className="text-[10px] text-muted-foreground font-medium leading-none tracking-wide uppercase">Olá</p>
            <p className="text-[13px] font-bold text-foreground leading-tight truncate">{profile?.name?.split(" ")[0] || "Usuário"}</p>
          </div>
        </button>
      ) : (
        <button
          data-tour="topbar-search"
          onClick={onSearchClick}
          className="group flex min-w-0 w-11 lg:w-[240px] xl:w-[300px] shrink items-center justify-center lg:justify-start gap-2.5 px-3 lg:px-4 h-11 rounded-xl bg-white/[.035] border border-white/10 text-sm text-muted-foreground hover:text-foreground hover:border-white/20 hover:bg-white/6 hover:shadow-[0_0_0_4px_hsl(0_0%_100%/.025)] transition-all duration-300"
        >
          <Search size={15} className="text-muted-foreground/60 group-hover:text-primary transition-colors" />
          <span className="hidden lg:inline truncate text-[13px] flex-1 text-left">Buscar clientes, contratos...</span>
          <kbd className="hidden lg:inline text-[10px] px-1.5 py-0.5 rounded-md bg-background/60 font-mono text-muted-foreground/60 border border-border/40">⌘K</kbd>
        </button>
      )}



      <div className="flex-1" />

      {/* Financial indicators — grupo unificado */}
      {!isMobile && (
        <div className="hidden xl:flex shrink-0 items-center gap-1.5 p-1 rounded-full bg-muted/25 border border-border/30 backdrop-blur-xs">
          <button
            onClick={() => navigate("/carteira")}
            className="group flex items-center gap-2 pl-2 pr-3.5 h-8 rounded-full hover:bg-primary/10 transition-all duration-200"
            title="Ver Carteira"
          >
            <span className="w-6 h-6 rounded-full bg-primary/15 flex items-center justify-center ring-1 ring-primary/20 group-hover:scale-110 transition-transform">
              <Wallet size={12} className="text-primary" />
            </span>
            <span className="whitespace-nowrap text-[12.5px] font-bold tracking-tight text-foreground">{financialValue(financials?.carteira)}</span>
          </button>
          <div className="w-px h-4 bg-border/50" />
          <button
            onClick={() => navigate("/lucros")}
            className="hidden lg:flex group items-center gap-2 pl-2 pr-3.5 h-8 rounded-full hover:bg-emerald-500/10 transition-all duration-200"
            title="Ver Lucros"
          >
            <span className="w-6 h-6 rounded-full bg-emerald-500/15 flex items-center justify-center ring-1 ring-emerald-500/25 group-hover:scale-110 transition-transform">
              <TrendingUp size={12} className="text-emerald-400" />
            </span>
            <span className="whitespace-nowrap text-[12.5px] font-bold tracking-tight text-emerald-400">{financialValue(financials?.lucro)}</span>
          </button>
          {(financials?.overdue ?? 0) > 0 && (
            <>
              <div className="w-px h-4 bg-border/50" />
              <button
                onClick={() => navigate("/cobrancas?tab=aging")}
                className="group flex items-center gap-2 pl-2 pr-3 h-8 rounded-full hover:bg-destructive/10 transition-all duration-200"
                title="Ver Inadimplência"
              >
                <span className="relative w-6 h-6 rounded-full bg-destructive/15 flex items-center justify-center ring-1 ring-destructive/25">
                  <AlertTriangle size={12} className="text-destructive" />
                  <span className="absolute inset-0 rounded-full bg-destructive/30 animate-ping opacity-60" />
                </span>
                <span className="text-[12.5px] font-bold tracking-tight text-destructive">{financials?.overdue}</span>
              </button>
            </>
          )}
        </div>
      )}


      {/* Quick Add Menu */}
      {!isMobile && (
        <div ref={quickRef} className="relative flex items-center">
          <button
            onClick={() => setQuickOpen(o => !o)}
            className="flex h-10 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-xl bg-primary px-3.5 text-[12px] font-bold text-primary-foreground shadow-[0_8px_24px_hsl(var(--primary)/.18)] transition-all duration-200 hover:bg-primary/90 hover:shadow-[0_10px_28px_hsl(var(--primary)/.24)] active:scale-[.98]"
            aria-haspopup="menu"
            aria-expanded={quickOpen}
          >
            <Plus size={15} strokeWidth={2.8} /> Novo
            <ChevronDown size={12} className={`transition-transform ${quickOpen ? "rotate-180" : ""}`} />
          </button>
          {quickOpen && (
            <div className="absolute top-full right-0 mt-2 w-64 rounded-2xl border border-border/60 bg-card/95 backdrop-blur-xl shadow-2xl overflow-hidden z-50 animate-scale-in origin-top-right">
              <p className="px-3 pt-2.5 pb-1 text-[9px] font-bold uppercase tracking-wider text-muted-foreground/60">Ações rápidas</p>
              {[
                { Icon: UserPlus, label: "Novo cliente", desc: "Cadastrar + contrato", path: "/clientes/novo", action: "navigate", color: "text-violet-400 bg-violet-500/10 ring-violet-500/20" },
                { Icon: Receipt, label: "Registrar pagamento", desc: "Buscar e dar baixa agora", path: "", action: "payment", color: "text-emerald-400 bg-emerald-500/10 ring-emerald-500/20" },
                { Icon: TrendingUp, label: "Lançar lucro", desc: "Entrada manual", path: "/lucros", action: "navigate", color: "text-sky-400 bg-sky-500/10 ring-sky-500/20" },
                { Icon: Wallet, label: "Lançar gasto", desc: "Despesa manual", path: "/gastos", action: "navigate", color: "text-amber-400 bg-amber-500/10 ring-amber-500/20" },
                { Icon: ListTodo, label: "Nova tarefa", desc: "Lembretes & to-dos", path: "/ferramentas/tarefas", action: "navigate", color: "text-rose-400 bg-rose-500/10 ring-rose-500/20" },
                { Icon: Calculator, label: "Simular empréstimo", desc: "Calcular juros", path: "/ferramentas/simulador", action: "navigate", color: "text-indigo-400 bg-indigo-500/10 ring-indigo-500/20" },
              ].map(item => (
                <button
                  key={item.path}
                  onClick={() => {
                    setQuickOpen(false);
                    if (item.action === "payment") onQuickPayment?.();
                    else navigate(item.path);
                  }}
                  className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-accent/50 transition-colors text-left group"
                >
                  <span className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ring-1 group-hover:scale-110 transition-transform ${item.color}`}>
                    <item.Icon size={14} />
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-[12px] font-semibold text-foreground truncate">{item.label}</p>
                    <p className="text-[10px] text-muted-foreground truncate">{item.desc}</p>
                  </div>
                </button>
              ))}
              <button
                onClick={() => { setQuickOpen(false); onSearchClick?.(); }}
                className="w-full flex items-center justify-between gap-2 px-3 py-2 border-t border-border/40 text-[11px] text-muted-foreground hover:bg-accent/30 transition-colors"
              >
                <span className="flex items-center gap-2"><Search size={12} /> Buscar tudo</span>
                <kbd className="text-[9px] px-1.5 py-0.5 rounded bg-muted font-mono">⌘K</kbd>
              </button>
            </div>
          )}
        </div>
      )}

      {/* Action buttons */}
      <div className="app-topbar-actions flex items-center gap-1 shrink-0 pl-1 ml-1 border-l border-border/30">
        {/* No celular não existe menu lateral, então o seletor de modo vem para cá */}
        {isMobile && <AppModeSwitcher collapsed />}

        {isMobile && (
          <button onClick={onSearchClick} aria-label="Buscar" className="w-10 h-10 flex items-center justify-center rounded-full hover:bg-muted/50 transition-all duration-200 text-muted-foreground hover:text-foreground">
            <Search size={19} />
          </button>
        )}

        {/* Tema e idioma no celular ficam no menu "Mais": a barra superior
            de 360px só comporta o essencial (buscar e avisos). */}
        {!isMobile && (
          <button
            onClick={toggleTheme}
            aria-label={theme === "dark" ? "Ativar modo claro" : "Ativar modo escuro"}
            title={theme === "dark" ? "Modo claro" : "Modo escuro"}
            className="relative w-9 h-9 flex items-center justify-center rounded-full hover:bg-muted/60 transition-all duration-200 text-muted-foreground hover:text-foreground group"
          >
            <span className="relative block w-[18px] h-[18px]">
              <Sun size={18} className={`absolute inset-0 transition-all duration-300 ${theme === "dark" ? "opacity-0 -rotate-90 scale-75" : "opacity-100 rotate-0 scale-100 text-amber-500"}`} />
              <Moon size={18} className={`absolute inset-0 transition-all duration-300 ${theme === "dark" ? "opacity-100 rotate-0 scale-100 text-primary" : "opacity-0 rotate-90 scale-75"}`} />
            </span>
          </button>
        )}

        {!isMobile && (
          <span className="app-language-switcher">
            <LanguageSwitcher />
          </span>
        )}
        <NotificationsBell />

        {!isMobile && <UserMenu profile={profile} theme={theme} toggleTheme={toggleTheme} onSignOut={handleSignOut} navigate={navigate} isAdmin={isPlatformAdmin} />}

      </div>
      </div>

      {/* Mobile: compact financial strip */}
      {isMobile && (
        <div className="flex items-center gap-2 px-3 pb-3 -mt-1 overflow-x-auto no-scrollbar scroll-smooth">
          <button
            onClick={() => navigate("/carteira")}
            className="flex items-center gap-1.5 pl-1.5 pr-3 h-8 rounded-full bg-primary/10 border border-primary/20 shrink-0 active:scale-95 transition-transform"
          >
            <span className="w-5 h-5 rounded-full bg-primary/20 flex items-center justify-center">
              <Wallet size={11} className="text-primary" />
            </span>
            <span className="text-[11.5px] font-bold text-primary tabular-nums">{financialValue(financials?.carteira)}</span>
          </button>
          <button
            onClick={() => navigate("/lucros")}
            className="flex items-center gap-1.5 pl-1.5 pr-3 h-8 rounded-full bg-emerald-500/10 border border-emerald-500/20 shrink-0 active:scale-95 transition-transform"
          >
            <span className="w-5 h-5 rounded-full bg-emerald-500/20 flex items-center justify-center">
              <TrendingUp size={11} className="text-emerald-400" />
            </span>
            <span className="text-[11.5px] font-bold text-emerald-400 tabular-nums">{financialValue(financials?.lucro)}</span>
          </button>
          {(financials?.overdue ?? 0) > 0 && (
            <button
              onClick={() => navigate("/cobrancas?tab=aging")}
              className="flex items-center gap-1.5 pl-1.5 pr-3 h-8 rounded-full bg-destructive/10 border border-destructive/25 shrink-0 active:scale-95 transition-transform"
            >
              <span className="relative w-5 h-5 rounded-full bg-destructive/20 flex items-center justify-center">
                <AlertTriangle size={11} className="text-destructive" />
                <span className="absolute inset-0 rounded-full bg-destructive/30 animate-ping opacity-60" />
              </span>
              <span className="text-[11.5px] font-bold text-destructive tabular-nums">{financials?.overdue} em atraso</span>
            </button>
          )}
        </div>
      )}
    </header>

  );
};


interface UserMenuProps {
  profile: any;
  theme: string;
  toggleTheme: () => void;
  onSignOut: () => void;
  navigate: (path: string) => void;
  isAdmin: boolean;
}

const UserMenu = ({ profile, theme, toggleTheme, onSignOut, navigate, isAdmin }: UserMenuProps) => {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", handler);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", handler);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  const go = (path: string) => { setOpen(false); navigate(path); };

  return (
    <div ref={ref} className="relative ml-1">
      <button
        onClick={() => setOpen(o => !o)}
        aria-label="Menu do usuário"
        aria-haspopup="menu"
        aria-expanded={open}
        className="relative w-9 h-9 rounded-full bg-linear-to-br from-primary/20 to-primary/5 flex items-center justify-center text-sm font-bold text-primary ring-1 ring-primary/20 hover:ring-2 hover:ring-primary/40 transition-all duration-200 micro-bounce"
      >
        {profile?.avatar_url ? (
          <img src={profile.avatar_url} alt="" className="w-9 h-9 rounded-full object-cover" />
        ) : (
          profile?.name?.charAt(0)?.toUpperCase() || "U"
        )}
        <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-success border-2 border-background" />
      </button>

      {open && (
        <div className="absolute top-full right-0 mt-2 w-64 rounded-xl border border-border bg-card shadow-2xl overflow-hidden z-50 animate-scale-in origin-top-right" role="menu">
          <div className="px-3 py-3 border-b border-border/40 flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center ring-1 ring-primary/20 shrink-0">
              {profile?.avatar_url ? (
                <img src={profile.avatar_url} alt="" className="w-10 h-10 rounded-full object-cover" />
              ) : (
                <User size={18} className="text-primary" />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-bold text-foreground truncate">{profile?.name || "Usuário"}</p>
              <p className="text-[10px] text-muted-foreground truncate">{profile?.email || ""}</p>
            </div>
          </div>

          <button onClick={() => go("/perfil")} role="menuitem" className="w-full flex items-center gap-2.5 px-3 py-2.5 hover:bg-accent/50 transition-colors text-[12px] text-foreground">
            <User size={14} className="text-muted-foreground" /> Meu perfil
          </button>
          {isAdmin && (
            <button onClick={() => go("/configuracoes")} role="menuitem" className="w-full flex items-center gap-2.5 px-3 py-2.5 hover:bg-accent/50 transition-colors text-[12px] text-foreground">
              <Settings size={14} className="text-muted-foreground" /> Configurações
            </button>
          )}
          <button onClick={toggleTheme} role="menuitem" className="w-full flex items-center justify-between gap-2.5 px-3 py-2.5 hover:bg-accent/50 transition-colors text-[12px] text-foreground">
            <span className="flex items-center gap-2.5">
              {theme === "dark" ? <Sun size={14} className="text-muted-foreground" /> : <Moon size={14} className="text-muted-foreground" />}
              {theme === "dark" ? "Modo claro" : "Modo escuro"}
            </span>
          </button>
          <div className="border-t border-border/40">
            <button onClick={onSignOut} role="menuitem" className="w-full flex items-center gap-2.5 px-3 py-2.5 hover:bg-destructive/10 transition-colors text-[12px] text-destructive font-semibold">
              <LogOut size={14} /> Sair
            </button>
          </div>
        </div>
      )}
    </div>
  );
};


export default TopBar;
