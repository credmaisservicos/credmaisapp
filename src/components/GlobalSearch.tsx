import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { usePlan } from "@/hooks/usePlan";
import {
  Search, X, FileSignature, Users, LayoutDashboard, CornerDownLeft,
  UserPlus, Receipt, TrendingUp, Wrench, Calculator, ListTodo,
  Bell, Settings, MessageSquare, Bot, Wallet, BarChart3, History, Zap, Clock
} from "lucide-react";

const safeNumber = (value: unknown) => {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
};

type Group = "Ações" | "Páginas" | "Clientes" | "Contratos" | "Recentes";

interface SearchResult {
  id: string;
  group: Group;
  title: string;
  subtitle?: string;
  path: string;
  keywords?: string;
  Icon: any;
  shortcut?: string;
}

const ALL_ACTIONS: SearchResult[] = [
  { id: "a-novo-cliente", group: "Ações", title: "Novo cliente", subtitle: "Cadastrar e criar contrato", path: "/clientes/novo", Icon: UserPlus, keywords: "cadastrar adicionar criar novo", shortcut: "n c" },
  { id: "a-cobrancas", group: "Ações", title: "Registrar pagamento", subtitle: "Abrir cobranças do dia", path: "/cobrancas", Icon: Receipt, keywords: "pagamento receber baixar parcela" },
  { id: "a-lucro", group: "Ações", title: "Lançar lucro", subtitle: "Registrar entrada de lucro", path: "/lucros", Icon: TrendingUp, keywords: "lucro receita entrada" },
  { id: "a-gasto", group: "Ações", title: "Lançar gasto", subtitle: "Registrar despesa", path: "/gastos", Icon: Wallet, keywords: "gasto despesa saida" },
  { id: "a-tarefa", group: "Ações", title: "Nova tarefa", subtitle: "Lembretes e to-dos", path: "/ferramentas/tarefas", Icon: ListTodo, keywords: "tarefa todo lembrete" },
  { id: "a-simulador", group: "Ações", title: "Simular empréstimo", subtitle: "Calcular juros e parcelas", path: "/ferramentas/simulador", Icon: Calculator, keywords: "simular calcular juros" },
];

const ALL_PAGES: SearchResult[] = [
  { id: "p-hoje", group: "Páginas", title: "Hoje", subtitle: "Tarefas, cobranças e alertas do dia", path: "/hoje", Icon: Zap, shortcut: "g h", keywords: "hoje agenda agora" },
  { id: "p-dashboard", group: "Páginas", title: "Painel", path: "/dashboard", Icon: LayoutDashboard, shortcut: "g d" },
  { id: "p-clientes", group: "Páginas", title: "Clientes", path: "/clientes", Icon: Users, shortcut: "g c" },
  { id: "p-cobrancas", group: "Páginas", title: "Cobranças", path: "/cobrancas", Icon: Receipt, shortcut: "g b" },
  { id: "p-inadimplencia", group: "Páginas", title: "Inadimplência", path: "/cobrancas?tab=aging", Icon: Zap, shortcut: "g i" },
  { id: "p-carteira", group: "Páginas", title: "Carteira", path: "/carteira", Icon: Wallet, shortcut: "g w" },
  { id: "p-lucros", group: "Páginas", title: "Lucros", path: "/lucros", Icon: TrendingUp, shortcut: "g l" },
  { id: "p-gastos", group: "Páginas", title: "Gastos", path: "/gastos", Icon: Wallet, shortcut: "g g" },
  { id: "p-analises", group: "Páginas", title: "Análises", path: "/analises", Icon: BarChart3, shortcut: "g a" },
  { id: "p-relatorios", group: "Páginas", title: "Relatórios", path: "/relatorios", Icon: BarChart3 },
  { id: "p-cobradores", group: "Páginas", title: "Cobradores", path: "/cobradores", Icon: Users },
  { id: "p-ia", group: "Páginas", title: "Agente IA", path: "/agente-ia", Icon: Bot },
  { id: "p-chat", group: "Páginas", title: "Chat", path: "/chat", Icon: MessageSquare, shortcut: "g m" },
  { id: "p-automacoes", group: "Páginas", title: "Automações", path: "/automacoes", Icon: Zap },
  { id: "p-notificacoes", group: "Páginas", title: "Notificações", path: "/notificacoes", Icon: Bell },
  { id: "p-historico", group: "Páginas", title: "Histórico", path: "/historico", Icon: History },
  { id: "p-configuracoes", group: "Páginas", title: "Configurações", path: "/configuracoes", Icon: Settings },
  { id: "p-qrcode", group: "Páginas", title: "Portais (QR)", path: "/qrcode", Icon: Wrench },
  { id: "p-simulador", group: "Páginas", title: "Simulador", path: "/ferramentas/simulador", Icon: Calculator },
  { id: "p-metas", group: "Páginas", title: "Metas", path: "/ferramentas/metas", Icon: TrendingUp },
  { id: "p-tarefas", group: "Páginas", title: "Tarefas", path: "/ferramentas/tarefas", Icon: ListTodo },
  { id: "p-anotacoes", group: "Páginas", title: "Anotações", path: "/ferramentas/anotacoes", Icon: FileSignature },
  { id: "p-planilha", group: "Páginas", title: "Planilha", path: "/ferramentas/planilha", Icon: FileSignature },
  { id: "p-puxada", group: "Páginas", title: "Puxada de Dados", path: "/puxada-dados", Icon: BarChart3 },
];

const PRO_PATHS = ["/comunicacao", "/comunicacao/inbox", "/agente-ia", "/automacoes", "/bot-performance"];

const RECENT_KEY = "lov_palette_recent_v1";
const loadRecents = (): string[] => {
  try { return JSON.parse(localStorage.getItem(RECENT_KEY) || "[]"); } catch { return []; }
};
const saveRecent = (id: string) => {
  try {
    const cur = loadRecents().filter(x => x !== id);
    cur.unshift(id);
    localStorage.setItem(RECENT_KEY, JSON.stringify(cur.slice(0, 5)));
  } catch {}
};

const GlobalSearch = ({ open, onClose }: { open: boolean; onClose: () => void }) => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [query, setQuery] = useState("");
  const [dynamicResults, setDynamicResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [recentIds, setRecentIds] = useState<string[]>([]);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) {
      setRecentIds(loadRecents());
      setQuery("");
      setDynamicResults([]);
      setSelectedIndex(0);
    }
  }, [open]);

  // Fetch clients/contracts only when querying
  useEffect(() => {
    if (!query.trim() || !user) { setDynamicResults([]); return; }
    const q = query.toLowerCase();
    let cancelled = false;

    const fetchData = async () => {
      setLoading(true);
      const [clientsByName, clientsByDocument] = await Promise.all([
        supabase.from("clients").select("id, name, cpf_cnpj").eq("user_id", user.id).ilike("name", `%${query}%`).limit(5),
        supabase.from("clients").select("id, name, cpf_cnpj").eq("user_id", user.id).ilike("cpf_cnpj", `%${query}%`).limit(5),
      ]);
      if (cancelled) return;
      if (clientsByName.error || clientsByDocument.error) {
        setDynamicResults([]);
        setLoading(false);
        return;
      }

      const matchedClients = [...(clientsByName.data || []), ...(clientsByDocument.data || [])]
        .filter((client, index, all) => all.findIndex((candidate) => candidate.id === client.id) === index)
        .slice(0, 5);
      const clientIds = matchedClients.map((client) => client.id);
      const contractsRes = clientIds.length
        ? await supabase.from("contracts").select("id, capital, status, clients(id, name)").eq("user_id", user.id).in("client_id", clientIds).limit(5)
        : { data: [], error: null };
      if (cancelled) return;
      if (contractsRes.error) {
        setDynamicResults([]);
        setLoading(false);
        return;
      }

      const clients: SearchResult[] = matchedClients.map((c: any) => ({
        id: `c-${c.id}`, group: "Clientes", title: String(c.name || "Cliente sem nome"), subtitle: c.cpf_cnpj || "Sem CPF",
        path: `/clientes/${c.id}`, Icon: Users,
      }));

      const contracts: SearchResult[] = (contractsRes.data || [])
        .filter((c: any) => String(c.clients?.name || "").toLowerCase().includes(q))
        .slice(0, 5)
        .map((c: any) => ({
          id: `k-${c.id}`, group: "Contratos", title: String(c.clients?.name || "Cliente sem nome"),
          subtitle: `R$ ${safeNumber(c.capital).toLocaleString("pt-BR")} • ${c.status || "Status indisponível"}`,
          path: `/clientes/${c.clients?.id || ""}`, Icon: FileSignature,
        }));

      setDynamicResults([...clients, ...contracts]);
      setLoading(false);
    };

    const timer = setTimeout(() => {
      fetchData().catch(() => {
        if (!cancelled) {
          setDynamicResults([]);
          setLoading(false);
        }
      });
    }, 220);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [query, user]);

  const { hasAutomations } = usePlan();

  const results = useMemo<SearchResult[]>(() => {
    const allowed = (r: SearchResult) => hasAutomations || !PRO_PATHS.includes(r.path);
    const ACTIONS = ALL_ACTIONS.filter(allowed);
    const PAGES = ALL_PAGES.filter(allowed);
    const q = query.trim().toLowerCase();
    if (!q) {
      const recents = recentIds
        .map(id => [...ACTIONS, ...PAGES].find(r => r.id === id))
        .filter(Boolean)
        .map(r => ({ ...(r as SearchResult), group: "Recentes" as Group }));
      return [...recents, ...ACTIONS, ...PAGES.slice(0, 10)];
    }
    const match = (r: SearchResult) =>
      String(r.title || "").toLowerCase().includes(q) ||
      (r.keywords || "").toLowerCase().includes(q) ||
      (r.subtitle || "").toLowerCase().includes(q);

    const actions = ACTIONS.filter(match);
    const pages = PAGES.filter(match);
    return [...actions, ...pages, ...dynamicResults];
  }, [query, dynamicResults, recentIds, hasAutomations]);

  useEffect(() => { setSelectedIndex(0); }, [results.length]);

  const handleSelect = useCallback((r: SearchResult) => {
    saveRecent(r.id);
    navigate(r.path);
    onClose();
  }, [navigate, onClose]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setSelectedIndex(p => Math.min(p + 1, results.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setSelectedIndex(p => Math.max(p - 1, 0)); }
    else if (e.key === "Enter" && results[selectedIndex]) { e.preventDefault(); handleSelect(results[selectedIndex]); }
  }, [results, selectedIndex, handleSelect]);

  useEffect(() => {
    const el = listRef.current?.querySelector(`[data-idx="${selectedIndex}"]`) as HTMLElement | null;
    el?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  if (!open) return null;

  // Render grouped
  let lastGroup: Group | null = null;
  let runningIdx = -1;

  return (
    <>
      <div className="fixed inset-0 bg-black/60 backdrop-blur-xs z-60 animate-fade-in" onClick={onClose} />
      <div className="fixed top-[12%] left-1/2 -translate-x-1/2 w-full max-w-xl z-61 px-4 animate-scale-in">
        <div className="rounded-2xl border border-border bg-card shadow-2xl overflow-hidden">
          <div className="flex items-center gap-3 px-4 py-3.5 border-b border-border">
            <Search size={16} className={`transition-colors ${loading ? "text-primary animate-pulse" : "text-muted-foreground"}`} />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Buscar ações, clientes, contratos, páginas..."
              className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-hidden"
            />
            {query && (
              <button onClick={() => setQuery("")} className="p-1 rounded-md hover:bg-accent text-muted-foreground transition-colors" aria-label="Limpar busca">
                <X size={14} />
              </button>
            )}
            <kbd className="text-[10px] px-1.5 py-0.5 rounded-md bg-muted text-muted-foreground font-mono">ESC</kbd>
          </div>

          <div ref={listRef} className="max-h-[60vh] overflow-y-auto py-1">
            {results.length === 0 && (
              <div className="py-12 text-center">
                <Search size={28} className="mx-auto text-muted-foreground/20 mb-3" />
                <p className="text-sm text-muted-foreground">Nenhum resultado para "{query}"</p>
                <p className="text-[11px] text-muted-foreground/60 mt-1">Tente nome do cliente, CPF ou ação</p>
              </div>
            )}
            {results.map((r) => {
              runningIdx++;
              const idx = runningIdx;
              const showHeader = r.group !== lastGroup;
              lastGroup = r.group;
              const Icon = r.Icon;
              const selected = idx === selectedIndex;
              return (
                <div key={r.id}>
                  {showHeader && (
                    <p className="px-4 pt-3 pb-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground/60 flex items-center gap-1.5">
                      {r.group === "Recentes" && <Clock size={10} />}
                      {r.group}
                    </p>
                  )}
                  <button
                    data-idx={idx}
                    onClick={() => handleSelect(r)}
                    onMouseEnter={() => setSelectedIndex(idx)}
                    className={`w-full flex items-center gap-3 px-4 py-2.5 transition-colors text-left ${selected ? "bg-accent/60" : "hover:bg-accent/30"}`}
                  >
                    <span className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
                      r.group === "Ações" ? "bg-primary/10 text-primary" :
                      r.group === "Clientes" ? "bg-success/10 text-success" :
                      r.group === "Contratos" ? "bg-indigo-500/10 text-indigo-400" :
                      "bg-muted text-muted-foreground"
                    }`}>
                      <Icon size={14} />
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">{r.title}</p>
                      {r.subtitle && <p className="text-[11px] text-muted-foreground truncate">{r.subtitle}</p>}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {r.shortcut && (
                        <span className="hidden sm:flex gap-0.5">
                          {r.shortcut.split(" ").map((k, j) => (
                            <kbd key={j} className="text-[9px] px-1 py-0.5 rounded bg-muted font-mono text-muted-foreground">{k}</kbd>
                          ))}
                        </span>
                      )}
                      {selected && <CornerDownLeft size={12} className="text-muted-foreground/50" />}
                    </div>
                  </button>
                </div>
              );
            })}
          </div>

          <div className="flex items-center justify-between px-4 py-2.5 border-t border-border text-[10px] text-muted-foreground/60">
            <div className="flex items-center gap-3">
              <span className="flex items-center gap-1"><kbd className="px-1 py-0.5 rounded bg-muted font-mono">↑↓</kbd> navegar</span>
              <span className="flex items-center gap-1"><kbd className="px-1 py-0.5 rounded bg-muted font-mono">↵</kbd> abrir</span>
              <span className="hidden sm:flex items-center gap-1"><kbd className="px-1 py-0.5 rounded bg-muted font-mono">?</kbd> atalhos</span>
            </div>
            <span>{results.length} resultado{results.length !== 1 ? "s" : ""}</span>
          </div>
        </div>
      </div>
    </>
  );
};

export default GlobalSearch;
