import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatBRDateTime } from "@/lib/dateUtils";

/**
 * Erros de tela capturados no navegador dos assinantes e dos clientes.
 * Antes disso, um erro em produção só existia no console de quem o sofreu.
 */
const ClientErrorsPanel = () => {
  const { data: erros = [], isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: ["client-errors"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("client_errors")
        .select("id, rota, mensagem, criado_em, user_id, contexto")
        .order("criado_em", { ascending: false })
        .limit(50);
      if (error) throw error;
      return data || [];
    },
    refetchInterval: 60_000,
  });

  // Mesma mensagem na mesma rota é o mesmo problema: agrupamos para o painel
  // mostrar "o que está quebrado" em vez de uma lista repetida.
  const agrupados = Object.values(
    erros.reduce((acc: Record<string, any>, e: any) => {
      const chave = `${e.rota}::${e.mensagem}`;
      if (!acc[chave]) acc[chave] = { ...e, ocorrencias: 0, ultima: e.criado_em };
      acc[chave].ocorrencias++;
      if (e.criado_em > acc[chave].ultima) acc[chave].ultima = e.criado_em;
      return acc;
    }, {}),
  ).sort((a: any, b: any) => (a.ultima < b.ultima ? 1 : -1));

  return (
    <div className="rounded-2xl border border-border bg-card overflow-hidden">
      <div className="p-4 border-b border-border bg-accent/20 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <AlertTriangle size={16} className="text-destructive" />
          <h3 className="font-semibold text-sm">Erros de tela em produção</h3>
          {agrupados.length > 0 && (
            <Badge variant="outline" className="bg-destructive/10 text-destructive border-0">
              {agrupados.length} distinto(s)
            </Badge>
          )}
        </div>
        <Button variant="ghost" size="sm" onClick={() => refetch()} disabled={isFetching} className="h-8 text-xs">
          <RefreshCw size={12} className={`mr-1.5 ${isFetching ? "animate-spin" : ""}`} /> Atualizar
        </Button>
      </div>

      <div className="divide-y divide-border/50 max-h-[360px] overflow-y-auto">
        {isLoading && <p className="p-6 text-center text-xs text-muted-foreground">Carregando...</p>}

        {isError && (
          <div className="p-6 text-center text-xs text-destructive">
            <p>{error instanceof Error ? error.message : "Não foi possível carregar os erros."}</p>
            <Button variant="link" size="sm" onClick={() => refetch()}>Tentar novamente</Button>
          </div>
        )}

        {!isLoading && !isError && agrupados.length === 0 && (
          <p className="p-8 text-center text-xs text-muted-foreground">
            Nenhum erro registrado. É o que se espera — esta lista só enche quando alguma tela quebra.
          </p>
        )}

        {!isError && agrupados.map((e: any) => (
          <div key={e.id} className="p-3 hover:bg-accent/20 transition-colors">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <code className="text-[11px] font-mono text-primary">{e.rota || "/"}</code>
                  {e.ocorrencias > 1 && (
                    <Badge variant="outline" className="text-[9px] py-0 h-4">
                      {e.ocorrencias}×
                    </Badge>
                  )}
                  <span className="text-[10px] text-muted-foreground">
                    {e.contexto?.origem ?? "?"}
                  </span>
                  {!e.user_id && (
                    <Badge variant="outline" className="text-[9px] py-0 h-4 bg-amber-500/10 text-amber-500 border-0">
                      visitante
                    </Badge>
                  )}
                </div>
                <p className="text-xs text-foreground/90 mt-1 wrap-break-word">{e.mensagem}</p>
              </div>
              <span className="text-[10px] text-muted-foreground whitespace-nowrap shrink-0">
                {formatBRDateTime(typeof e.ultima === "string" ? e.ultima : null) || "data indisponível"}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default ClientErrorsPanel;
