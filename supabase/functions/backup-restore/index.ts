// Restauração de backup — o outro lado do auto-backup, que não existia.
//
// Um backup que nunca foi restaurado é uma hipótese, não um backup. Esta função
// existe para (a) conferir que os arquivos gravados são íntegros e completos e
// (b) devolver os dados quando algo der errado.
//
// Só admin da plataforma executa. O padrão é CONFERÊNCIA (dry run): lê o arquivo
// e relata o que ele contém, sem escrever nada. Para gravar de fato é preciso
// mandar `confirmar: "RESTAURAR"` explicitamente.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.117.2";
import { getPlatformAdminUser, unauthorized } from "../_shared/guard.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Ordem importa na gravação: pai antes de filho, senão a chave estrangeira falha.
const ORDEM_TABELAS = [
  "clients", "investors", "collectors", "vehicles", "stock_items", "settings",
  "contracts", "investor_loans", "rentals", "goals", "notes", "todos",
  "contract_installments", "investor_payments", "transactions", "expenses", "profits",
  "collector_assignments", "subscriptions", "notifications", "client_notifications",
  "collection_attempts", "audit_logs", "bot_actions_log", "support_tickets",
  "support_ticket_messages", "whatsapp_conversations", "whatsapp_messages",
  "whatsapp_notes", "whatsapp_scheduled_messages", "message_templates", "leads",
  "pledges", "ai_conversations", "chat_channel_members", "chat_messages",
  "chat_message_reactions", "client_errors", "user_roles",
];

const TABLE_WITHOUT_USER_ID = new Set(["support_ticket_messages"]);

async function listAllBackups(admin: any, userId: string): Promise<any[]> {
  const files: any[] = [];
  for (let offset = 0;; offset += 1000) {
    const { data, error } = await admin.storage.from("backups").list(userId, {
      limit: 1000, offset, sortBy: { column: "name", order: "desc" },
    });
    if (error) throw error;
    files.push(...(data || []));
    if ((data || []).length < 1000) return files;
  }
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const caller = await getPlatformAdminUser(req);
  if (!caller) return unauthorized(corsHeaders);

  const body = await req.json().catch(() => ({}));
  const userId: string = body?.user_id ?? "";
  const data: string = body?.data ?? "";           // AAAA-MM-DD
  const gravar = body?.confirmar === "RESTAURAR";  // sem isto, só confere

  if (!userId) return json({ error: "informe user_id" }, 400);

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // Sem data: lista o que existe para aquele usuário.
  if (!data) {
    let arquivos: any[];
    try { arquivos = await listAllBackups(admin, userId); }
    catch (error) { return json({ error: error instanceof Error ? error.message : "list_failed" }, 500); }
    return json({
      user_id: userId,
      disponiveis: (arquivos || []).map((a: any) => a.name.replace(/\.json$/, "")),
    });
  }

  // Lê o arquivo do dia pedido.
  const caminho = `${userId}/${data}.json`;
  const { data: arquivo, error: dlErr } = await admin.storage.from("backups").download(caminho);
  if (dlErr || !arquivo) return json({ error: "backup_nao_encontrado", caminho }, 404);

  let dump: Record<string, any[]>;
  try {
    dump = JSON.parse(await arquivo.text());
  } catch {
    return json({ error: "backup_corrompido", caminho }, 422);
  }

  if (!dump || typeof dump !== "object" || Array.isArray(dump)) {
    return json({ error: "backup_formato_invalido", caminho }, 422);
  }
  const manifest = (dump as any)._manifest;
  const ticketIds = new Set((Array.isArray(dump.support_tickets) ? dump.support_tickets : [])
    .map((ticket: any) => ticket.id));
  for (const tabela of ORDEM_TABELAS) {
    const linhas = Array.isArray(dump[tabela]) ? dump[tabela] : [];
    if (manifest?.counts?.[tabela] != null && manifest.counts[tabela] !== linhas.length) {
      return json({ error: "backup_contagem_invalida", tabela, caminho }, 422);
    }
    for (const linha of linhas) {
      const ownerOk = TABLE_WITHOUT_USER_ID.has(tabela)
        ? tabela === "support_ticket_messages" && ticketIds.has(linha.ticket_id)
        : linha.user_id === userId;
      if (!ownerOk) return json({ error: "backup_usuario_invalido", tabela, caminho }, 422);
    }
  }

  // Conferência: o que o arquivo tem × o que a base tem hoje.
  const relatorio: Record<string, { no_backup: number; na_base_hoje: number; gravados?: number }> = {};
  for (const tabela of ORDEM_TABELAS) {
    const linhas = Array.isArray(dump[tabela]) ? dump[tabela] : [];
    let count = 0;
    if (tabela === "support_ticket_messages") {
      if (ticketIds.size) {
        const result = await admin.from(tabela).select("*", { count: "exact", head: true })
          .in("ticket_id", [...ticketIds]);
        count = result.count ?? 0;
      }
    } else {
      const result = await admin.from(tabela).select("*", { count: "exact", head: true })
        .eq("user_id", userId);
      count = result.count ?? 0;
    }
    relatorio[tabela] = { no_backup: linhas.length, na_base_hoje: count ?? 0 };
  }

  if (!gravar) {
    return json({
      modo: "conferencia",
      caminho,
      integro: true,
      versao: manifest?.version ?? 1,
      relatorio,
      aviso: 'Nada foi gravado. Para restaurar de verdade, envie confirmar: "RESTAURAR".',
    });
  }

  // Gravação: upsert por id. Nunca apaga — linhas criadas depois do backup
  // permanecem. Restaurar é devolver o que existia, não voltar o relógio.
  const { data: restored, error: restoreError } = await admin.rpc("restore_user_backup_atomic", {
    _user_id: userId,
    _dump: dump,
  });
  if (restoreError) {
    return json({ error: "restauracao_revertida", detail: restoreError.message, caminho }, 409);
  }
  for (const tabela of ORDEM_TABELAS) {
    relatorio[tabela].gravados = Number((restored as any)?.counts?.[tabela] ?? 0);
  }

  return json({
    modo: "restauracao",
    caminho,
    relatorio,
    atomica: true,
  });
});
