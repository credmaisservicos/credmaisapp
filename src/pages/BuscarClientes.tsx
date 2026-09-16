import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Search, ChevronLeft, ChevronRight, User as UserIcon, Loader2, AlertCircle, Copy, Check, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { onlyDigits, formatCpfCnpj, validateCpfCnpj } from "@/lib/cpfCnpj";

const PAGE_SIZE = 10;
type Mode = "name" | "cpf";

const BuscarClientes = () => {
  const { user } = useAuth();
  const [mode, setMode] = useState<Mode>("name");
  const [term, setTerm] = useState("");
  const [query, setQuery] = useState("");
  const [queryMode, setQueryMode] = useState<Mode>("name");
  const [page, setPage] = useState(0);
  const [validationError, setValidationError] = useState<string | null>(null);

  const liveCpfValidation = useMemo(() => {
    if (mode !== "cpf") return null;
    const d = onlyDigits(term);
    if (d.length !== 11 && d.length !== 14) return null;
    return validateCpfCnpj(term);
  }, [mode, term]);

  const { data, isFetching, error, isError, refetch } = useQuery({
    queryKey: ["buscar-clientes", user?.id, queryMode, query, page],
    enabled: !!user,
    retry: 1,
    queryFn: async () => {
      const t = query.trim();

      // Busca por CPF/CNPJ exato — feita no banco via RPC (índice funcional sobre os dígitos)
      if (queryMode === "cpf" && t) {
        const v = validateCpfCnpj(t);
        if (!v.ok) return { rows: [], count: 0 };
        const { data, error } = await supabase.rpc("search_clients_by_document", {
          _document: onlyDigits(t),
        });
        if (error) throw new Error(error.message || "Falha ao consultar CPF/CNPJ no servidor.");
        const all = (data || []) as any[];
        const from = page * PAGE_SIZE;
        return { rows: all.slice(from, from + PAGE_SIZE), count: all.length };
      }

      // Sem termo: listagem padrão paginada por nome
      if (!t) {
        const from = page * PAGE_SIZE;
        const to = from + PAGE_SIZE - 1;
        const { data, count, error } = await supabase
          .from("clients")
          .select("id, name, email, phone, cpf_cnpj, status, avatar_url", { count: "exact" })
          // Escopo explícito por dono, além da RLS (ver Anotacoes.tsx).
          .eq("user_id", user!.id)
          .order("name", { ascending: true })
          .range(from, to);
        if (error) throw new Error(error.message);
        return { rows: data || [], count: count || 0 };
      }

      // Busca fuzzy por nome via RPC (trigramas)
      const { data, error } = await supabase.rpc("search_clients_fuzzy", {
        _term: t,
        _threshold: 0.2,
        _limit: 100,
      });
      if (error) throw new Error(error.message);
      const all = (data || []) as any[];
      const from = page * PAGE_SIZE;
      return { rows: all.slice(from, from + PAGE_SIZE), count: all.length };
    },
  });

  useEffect(() => {
    if (!isError || !error) return;
    toast.error(
      queryMode === "cpf" ? "Falha ao buscar por CPF/CNPJ" : "Falha ao buscar clientes",
      { description: (error as Error).message || "Tente novamente em instantes." }
    );
  }, [isError, error, queryMode]);

  const total = data?.count || 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (mode === "cpf") {
      const v = validateCpfCnpj(term);
      if (!v.ok) {
        setValidationError(v.error || "CPF/CNPJ inválido.");
        return;
      }
    }
    setValidationError(null);
    setPage(0);
    setQuery(term);
    setQueryMode(mode);
  };

  const isCpf = mode === "cpf";
  const cpfNotFound = !isFetching && queryMode === "cpf" && !!query && (data?.rows.length ?? 0) === 0;

  return (
    <div className="max-w-4xl mx-auto p-4 sm:p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Buscar Clientes</h1>
        <p className="text-sm text-muted-foreground">
          {isCpf
            ? "Busca exata por CPF/CNPJ — pode digitar com ou sem pontuação."
            : "Busca inteligente por similaridade — encontra variações como \"Fabiãno\", \"Fabian\", erros de digitação e acentos."}
        </p>
      </div>

      <div className="inline-flex p-1 bg-card border border-border rounded-2xl">
        {(["name", "cpf"] as Mode[]).map((m) => (
          <button
            key={m}
            onClick={() => {
              setMode(m);
              setTerm("");
              setValidationError(null);
            }}
            className={`px-4 py-1.5 rounded-xl text-sm font-semibold transition-colors ${
              mode === m ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {m === "name" ? "Nome" : "CPF / CNPJ"}
          </button>
        ))}
      </div>

      <form onSubmit={onSubmit} className="space-y-2">
        <div className="flex flex-col gap-2 sm:flex-row">
          <div className="relative flex-1">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              name="client_search_term"
              aria-label={isCpf ? "Buscar cliente por CPF ou CNPJ" : "Buscar cliente por nome"}
              value={term}
              onChange={(e) => {
                setValidationError(null);
                setTerm(isCpf ? formatCpfCnpj(e.target.value) : e.target.value);
              }}
              inputMode={isCpf ? "numeric" : "text"}
              maxLength={isCpf ? 18 : 120}
              placeholder={isCpf ? "000.000.000-00 ou 00.000.000/0000-00" : "Digite o nome..."}
              className={`w-full pl-9 pr-3 py-2.5 rounded-2xl bg-card border text-foreground text-sm focus:outline-none transition-colors ${
                validationError || (liveCpfValidation && !liveCpfValidation.ok)
                  ? "border-destructive focus:border-destructive ring-2 ring-destructive/20"
                  : cpfNotFound
                    ? "border-amber-500/70 focus:border-amber-500 ring-2 ring-amber-500/20"
                    : "border-border focus:border-ring"
              }`}
            />
          </div>
          <button
            type="submit"
            disabled={isFetching || (isCpf && (!!validationError || (!!liveCpfValidation && !liveCpfValidation.ok)))}
            className="inline-flex items-center justify-center gap-2 rounded-2xl bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {isFetching ? <Loader2 size={14} className="animate-spin" /> : null}
            {isFetching ? "Buscando..." : "Buscar"}
          </button>
        </div>
        {(validationError || (isCpf && liveCpfValidation && !liveCpfValidation.ok)) && (
          <div className="flex items-center gap-1.5 text-xs text-destructive">
            <AlertCircle size={12} />
            <span>{validationError || liveCpfValidation?.error}</span>
          </div>
        )}
        {isCpf && liveCpfValidation?.ok && (
          <p className="text-xs text-emerald-500">
            {liveCpfValidation.type === "cpf" ? "CPF" : "CNPJ"} válido ✓
          </p>
        )}
      </form>

      {queryMode === "cpf" && query && total > 1 && (
        <div className="flex items-start gap-2 p-3 rounded-2xl border border-amber-500/40 bg-amber-500/10 text-amber-200 text-xs">
          <AlertCircle size={14} className="mt-0.5 shrink-0" />
          <div>
            <p className="font-semibold">Inconsistência detectada</p>
            <p className="opacity-90">
              Foram encontrados <strong>{total}</strong> clientes com o mesmo CPF/CNPJ. Revise os cadastros duplicados para evitar erros nos contratos.
            </p>
          </div>
        </div>
      )}

      <div className="bg-card border border-border rounded-2xl divide-y divide-border min-h-[200px]">
        {isError && !isFetching ? (
          <div className="p-8 text-center space-y-3">
            <div className="mx-auto w-10 h-10 rounded-full bg-destructive/15 flex items-center justify-center">
              <AlertCircle size={20} className="text-destructive" />
            </div>
            <div className="space-y-1">
              <p className="text-sm font-semibold text-foreground">
                {queryMode === "cpf" ? "Falha ao buscar por CPF/CNPJ" : "Falha ao buscar clientes"}
              </p>
              <p className="text-xs text-muted-foreground">
                {(error as Error)?.message || "Não foi possível concluir a consulta no servidor."}
              </p>
            </div>
            <button
              onClick={() => refetch()}
              disabled={isFetching}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-2xl bg-primary text-primary-foreground text-sm font-semibold hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <RefreshCw size={14} className={isFetching ? "animate-spin" : ""} />
              Tentar novamente
            </button>
          </div>
        ) : isFetching ? (
          Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 p-4 animate-pulse">
              <div className="w-10 h-10 rounded-full bg-muted/60" />
              <div className="flex-1 space-y-2">
                <div className="h-3 w-1/3 rounded bg-muted/60" />
                <div className="h-2.5 w-2/3 rounded bg-muted/40" />
              </div>
              <div className="w-8 h-8 rounded-lg bg-muted/40" />
              <div className="w-12 h-5 rounded-full bg-muted/40" />
            </div>
          ))
        ) : data?.rows.length === 0 ? (
          <div className="p-10 text-center space-y-2">
            <p className="text-sm font-semibold text-foreground">
              {queryMode === "cpf" && query
                ? `Nenhum cliente cadastrado com o ${onlyDigits(query).length === 14 ? "CNPJ" : "CPF"} ${formatCpfCnpj(query)}.`
                : "Nenhum cliente encontrado."}
            </p>
            {queryMode === "cpf" && query && (
              <p className="text-xs text-muted-foreground">
                Verifique se o documento foi digitado corretamente ou cadastre um novo cliente.
              </p>
            )}
          </div>
        ) : (
          data?.rows.map((c) => <ResultRow key={c.id} c={c} />)
        )}
      </div>

      {total > 0 && (
        <div className="flex items-center justify-between text-sm">
          <p className="text-muted-foreground">
            Página {page + 1} de {totalPages} • {total} resultado{total === 1 ? "" : "s"}
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page === 0 || isFetching}
              className="px-3 py-2 rounded-xl border border-border text-foreground disabled:opacity-40 disabled:cursor-not-allowed hover:bg-muted/30"
            >
              <ChevronLeft size={16} />
            </button>
            <button
              onClick={() => setPage((p) => (p + 1 < totalPages ? p + 1 : p))}
              disabled={page + 1 >= totalPages || isFetching}
              className="px-3 py-2 rounded-xl border border-border text-foreground disabled:opacity-40 disabled:cursor-not-allowed hover:bg-muted/30"
            >
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

type ResultClient = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  cpf_cnpj: string | null;
  status: string;
  avatar_url: string | null;
};

const ResultRow = ({ c }: { c: ResultClient }) => {
  const [copied, setCopied] = useState(false);
  const doc = c.cpf_cnpj || "";

  const handleCopy = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!doc) return;
    try {
      await navigator.clipboard.writeText(doc);
      setCopied(true);
      toast.success("Documento copiado", { description: doc });
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Não foi possível copiar");
    }
  };

  return (
    <Link to={`/clientes/${c.id}`} className="flex flex-wrap items-center gap-3 p-4 transition-colors hover:bg-muted/30 sm:flex-nowrap">
      {c.avatar_url ? (
        <img src={c.avatar_url} alt={c.name} className="w-10 h-10 rounded-full object-cover" />
      ) : (
        <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
          <UserIcon size={18} className="text-primary" />
        </div>
      )}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-foreground truncate">{c.name}</p>
        <p className="text-xs text-muted-foreground truncate">
          {doc || "—"} {c.phone ? `• ${c.phone}` : ""} {c.email ? `• ${c.email}` : ""}
        </p>
      </div>
      {doc && (
        <button
          type="button"
          onClick={handleCopy}
          aria-label="Copiar CPF/CNPJ"
          title="Copiar CPF/CNPJ"
          className="p-2 rounded-lg border border-border text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors"
        >
          {copied ? <Check size={14} className="text-emerald-500" /> : <Copy size={14} />}
        </button>
      )}
      <span className="text-[10px] font-semibold px-2 py-1 rounded-full bg-muted text-muted-foreground">
        {c.status}
      </span>
    </Link>
  );
};

export default BuscarClientes;
