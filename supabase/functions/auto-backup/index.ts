import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.117.2";
import { alertPlatformAdmins } from "../_shared/operations.ts";
import { checkSharedSecret } from "../_shared/guard.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const TABLES = [
  "clients", "contracts", "contract_installments", "transactions",
  "expenses", "profits", "goals", "notes", "todos", "settings",
  "collectors", "collector_assignments", "vehicles", "rentals", "stock_items",
  "investors", "investor_loans", "investor_payments", "subscriptions",
  "notifications", "client_notifications", "collection_attempts", "audit_logs",
  "bot_actions_log", "support_tickets", "whatsapp_conversations", "whatsapp_messages",
  "ai_conversations", "chat_channel_members", "chat_messages", "chat_message_reactions",
  "client_errors", "leads", "message_templates", "pledges", "user_roles",
  "whatsapp_notes", "whatsapp_scheduled_messages",
];

const PAGE_SIZE = 1000;
const SECRET_FIELDS = new Set(["whatsapp_api_key", "api_key", "access_token", "refresh_token", "secret"]);

async function fetchAllForUser(supabase: any, table: string, userId: string): Promise<any[]> {
  const rows: any[] = [];
  for (let from = 0;; from += PAGE_SIZE) {
    const { data, error } = await supabase.from(table).select("*")
      .eq("user_id", userId).range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    rows.push(...(data || []));
    if ((data || []).length < PAGE_SIZE) return rows;
  }
}

function removeSecrets(rows: any[]): any[] {
  return rows.map((row) => Object.fromEntries(
    Object.entries(row).filter(([key]) => !SECRET_FIELDS.has(key)),
  ));
}

async function listAllFiles(storage: any, folder: string): Promise<any[]> {
  const files: any[] = [];
  for (let offset = 0;; offset += PAGE_SIZE) {
    const { data, error } = await storage.from("backups").list(folder, { limit: PAGE_SIZE, offset });
    if (error) throw error;
    files.push(...(data || []));
    if ((data || []).length < PAGE_SIZE) return files;
  }
}

// ── Retenção ────────────────────────────────────────────────────────────────
// O backup rodava desde abril sem nunca apagar nada: 2.349 arquivos e 100 MB
// acumulados, crescendo junto com a carteira. Guardamos os últimos 30 dias
// inteiros e, para trás disso, só o arquivo do dia 1º de cada mês.
const DIAS_COMPLETOS = 30;

/** Decide se um backup deve ser mantido, a partir do nome `AAAA-MM-DD.json`. */
export function deveManter(nomeArquivo: string, hoje: Date): boolean {
  const data = nomeArquivo.replace(/\.json$/i, "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) return true; // formato estranho: não mexe

  const d = new Date(`${data}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return true;

  const diasAtras = Math.floor((hoje.getTime() - d.getTime()) / 86400000);
  if (diasAtras < 0) return true;                  // data futura: não mexe
  if (diasAtras <= DIAS_COMPLETOS) return true;    // janela recente: mantém tudo
  return data.endsWith("-01");                     // mais antigo: só o dia 1º
}

/**
 * Apaga backups fora da política de retenção. Devolve quantos removeu.
 * Com `apenasConferir`, não apaga nada — só conta. Apagar backup é irreversível,
 * então existe um jeito de ver o estrago antes de causá-lo.
 */
async function aplicarRetencao(
  supabase: any,
  userId: string,
  hoje: Date,
  apenasConferir = false,
): Promise<number> {
  const arquivos = await listAllFiles(supabase.storage, userId);

  const remover = arquivos
    .filter((a: any) => a.name && !deveManter(a.name, hoje))
    .map((a: any) => `${userId}/${a.name}`);

  if (!remover.length) return 0;
  if (apenasConferir) return remover.length;

  const { error: delErr } = await supabase.storage.from("backups").remove(remover);
  return delErr ? 0 : remover.length;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  // SEGURANÇA (M4): cron protegido por segredo obrigatório.
  if (!checkSharedSecret(req, "CRON_SECRET")) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // ?conferir=1 → não grava backup novo, não apaga nada, só relata o que a
  // retenção removeria. Serve para inspecionar antes de deixar rodar de verdade.
  const apenasConferir = new URL(req.url).searchParams.get("conferir") === "1";

  // TRAVA DE SEGURANÇA — apagar backup é irreversível.
  //
  // O backup roda todo dia; a limpeza NÃO roda sozinha. Enquanto
  // `BACKUP_RETENTION_ENABLED` não for definido como "1" nos secrets, esta
  // função só GRAVA: nenhum arquivo é removido, nem por retenção nem por
  // pasta órfã. Assim o comportamento padrão é acumular — que desperdiça
  // espaço, mas nunca perde histórico.
  //
  // Para ligar: defina o secret e rode antes com ?conferir=1 para ver o que
  // sairia.
  const limpezaAutorizada = Deno.env.get("BACKUP_RETENTION_ENABLED") === "1";
  const podeApagar = limpezaAutorizada && !apenasConferir;

  // ?somente_orfaos=1 → apaga APENAS as pastas de contas que não existem mais,
  // sem gravar backup novo e sem aplicar retenção nos backups de quem está
  // ativo. Existe porque as duas coisas estavam amarradas no mesmo interruptor:
  // para cumprir a LGPD e sumir com o dado de quem pediu exclusão, era preciso
  // ligar a retenção geral junto — e aí o histórico de quem continua cliente
  // começava a ser podado sem ninguém ter pedido.
  //
  // Não depende de `BACKUP_RETENTION_ENABLED`: apagar pasta de conta que não
  // existe mais não é retenção, é obrigação. Mas continua respeitando
  // `?conferir=1` para inspecionar antes.
  const somenteOrfaos = new URL(req.url).searchParams.get("somente_orfaos") === "1";
  const podeApagarOrfaos = somenteOrfaos ? !apenasConferir : podeApagar;

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: profiles } = await supabase
      .from("profiles")
      .select("id")
      .eq("is_blocked", false);

    const agora = new Date();
    const today = agora.toISOString().split("T")[0];
    let backedUp = 0;
    let removidosPorRetencao = 0;
    const errors: string[] = [];

    // No modo `somente_orfaos` a varredura por usuario e pulada inteira: nada
    // e gravado e nada e podado de quem esta ativo.
    for (const p of somenteOrfaos ? [] : (profiles || [])) {
      try {
        if (!apenasConferir) {
          const dump: Record<string, unknown> = {};
          for (const t of TABLES) {
            dump[t] = removeSecrets(await fetchAllForUser(supabase, t, p.id));
          }
          const ticketIds = (dump.support_tickets as any[]).map((ticket) => ticket.id);
          const ticketMessages: any[] = [];
          for (let i = 0; i < ticketIds.length; i += 200) {
            const { data, error } = await supabase.from("support_ticket_messages")
              .select("*").in("ticket_id", ticketIds.slice(i, i + 200));
            if (error) throw new Error(`support_ticket_messages: ${error.message}`);
            ticketMessages.push(...(data || []));
          }
          dump.support_ticket_messages = ticketMessages;
          dump._manifest = {
            version: 2,
            created_at: agora.toISOString(),
            user_id: p.id,
            counts: Object.fromEntries(Object.entries(dump)
              .filter(([table]) => table !== "_manifest")
              .map(([table, rows]) => [table, Array.isArray(rows) ? rows.length : 0])),
          };
          const path = `${p.id}/${today}.json`;
          const blob = new Blob([JSON.stringify(dump)], { type: "application/json" });
          const { error: upErr } = await supabase.storage
            .from("backups")
            .upload(path, blob, { upsert: true, contentType: "application/json" });
          if (upErr) throw upErr;
          backedUp++;
        }

        removidosPorRetencao += await aplicarRetencao(supabase, p.id, agora, !podeApagar);
      } catch (e) {
        errors.push(`${p.id}: ${e instanceof Error ? e.message : "?"}`);
      }
    }

    // ── Expurgo de contas que não existem mais (LGPD) ────────────────────────
    // Apagar a conta não apagava o backup: dados pessoais dos clientes daquele
    // assinante continuavam guardados por tempo indeterminado. Aqui varremos as
    // pastas órfãs — tanto de contas apagadas antes desta correção quanto de
    // qualquer falha futura no expurgo feito na hora da exclusão.
    let pastasOrfasRemovidas = 0;
    try {
      const { data: todosPerfis } = await supabase.from("profiles").select("id");
      const existentes = new Set((todosPerfis || []).map((p: any) => p.id));

      const pastas = await listAllFiles(supabase.storage, "");
      for (const pasta of pastas || []) {
        if (!pasta?.name || existentes.has(pasta.name)) continue;
        const arquivos = await listAllFiles(supabase.storage, pasta.name);
        const caminhos = (arquivos || []).map((a: any) => `${pasta.name}/${a.name}`);
        if (!caminhos.length) continue;
        if (!podeApagarOrfaos) { pastasOrfasRemovidas++; continue; }
        const { error: rmErr } = await supabase.storage.from("backups").remove(caminhos);
        if (!rmErr) pastasOrfasRemovidas++;
      }
    } catch (e) {
      errors.push(`expurgo_orfaos: ${e instanceof Error ? e.message : "?"}`);
    }

    if (errors.length) {
      await alertPlatformAdmins(supabase, "auto-backup", `Backup terminou com ${errors.length} erro(s): ${errors.slice(0, 3).join(" | ")}`);
    }

    return new Response(
      JSON.stringify({
        // O relato precisa dizer a verdade sobre o que a chamada fez. Antes, no
        // modo `somente_orfaos`, ele apagava 26 pastas e devolvia "Nenhum
        // arquivo apagado — defina BACKUP_RETENTION_ENABLED=1": a mensagem
        // genérica não conhecia esse caminho.
        modo: apenasConferir
          ? "conferencia (nada foi alterado)"
          : somenteOrfaos
            ? "execucao (apenas pastas de contas excluidas)"
            : podeApagar ? "execucao (com limpeza)" : "execucao (limpeza DESLIGADA)",
        limpeza_autorizada: limpezaAutorizada,
        message: apenasConferir
          ? somenteOrfaos
            ? `Simulação: ${pastasOrfasRemovidas} pasta(s) de conta excluída seriam apagadas. Nada foi alterado.`
            : "Simulação: nenhum arquivo foi gravado nem apagado."
          : somenteOrfaos
            ? `${pastasOrfasRemovidas} pasta(s) de conta excluída apagada(s). Nenhum backup novo gravado e nenhuma retenção aplicada a conta ativa.`
            : podeApagar
              ? `Backup de ${backedUp} usuário(s)`
              : `Backup de ${backedUp} usuário(s). Nenhum arquivo apagado — defina BACKUP_RETENTION_ENABLED=1 para ligar a limpeza.`,
        backedUp,
        removidosPorRetencao,
        pastasOrfasRemovidas,
        errors: errors.length ? errors : undefined,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Erro" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
