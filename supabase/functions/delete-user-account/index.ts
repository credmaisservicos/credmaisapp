// Apaga a conta do usuário autenticado (LGPD - Direito ao esquecimento)
// Requer confirmação com o próprio email do usuário no body.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.117.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

async function removeAllBackupFiles(admin: any, userId: string): Promise<number> {
  let removed = 0;
  // Sempre busca a primeira pagina: depois da remocao, a proxima leva os itens
  // restantes para o inicio. Assim nao pulamos arquivos ao paginar e nao existe
  // mais o teto silencioso de mil backups.
  while (true) {
    const { data: files, error } = await admin.storage
      .from("backups")
      .list(userId, { limit: 1000, offset: 0 });
    if (error) throw error;
    const paths = (files || [])
      .filter((file: any) => file?.name)
      .map((file: any) => `${userId}/${file.name}`);
    if (!paths.length) return removed;
    const { error: removeError } = await admin.storage.from("backups").remove(paths);
    if (removeError) throw removeError;
    removed += paths.length;
    if (paths.length < 1000) return removed;
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return new Response(JSON.stringify({ error: "no_auth" }), { status: 401, headers: corsHeaders });

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData } = await userClient.auth.getUser();
    const user = userData?.user;
    if (!user?.email) return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: corsHeaders });

    const { email_confirmation } = await req.json();
    if (!email_confirmation || email_confirmation.toLowerCase().trim() !== user.email.toLowerCase().trim()) {
      return new Response(JSON.stringify({ error: "email_mismatch", message: "Você precisa confirmar digitando seu email exato." }), {
        status: 400, headers: corsHeaders,
      });
    }

    const admin = createClient(supabaseUrl, serviceKey);

    // Audit log ANTES de apagar
    await admin.from("audit_logs").insert({
      user_id: user.id,
      entity_type: "account",
      action: "self_delete_requested",
      details: { email: user.email, at: new Date().toISOString() },
    });

    // LGPD: apaga os backups ANTES de remover a conta.
    // Isto faltava — a conta sumia e a pasta em `storage/backups` continuava lá,
    // com nome, CPF e contratos dos clientes daquele assinante, por tempo
    // indeterminado. Feito antes do delete porque depois não há mais como saber
    // que aquela pasta ficou órfã até a próxima varredura do auto-backup.
    let backupsRemovidos = 0;
    try {
      backupsRemovidos = await removeAllBackupFiles(admin, user.id);
    } catch (e) {
      // Não bloqueia a exclusão da conta: o direito ao esquecimento vem primeiro,
      // e a varredura de pastas órfãs do auto-backup pega o resto.
      console.error("[delete-user-account] erro no expurgo de backups:", e);
    }

    // Deleta usuário do auth — o ON DELETE CASCADE em foreign keys limpa o resto.
    // Tabelas sem CASCADE ficam órfãs mas não expõem dados (RLS scopa por user_id).
    const { error: delErr } = await admin.auth.admin.deleteUser(user.id);
    if (delErr) {
      console.error("[delete-user-account] auth delete failed:", delErr);
      return new Response(JSON.stringify({ error: "delete_failed", detail: delErr.message }), {
        status: 500, headers: corsHeaders,
      });
    }

    return new Response(JSON.stringify({ ok: true, message: "Conta apagada com sucesso.", backupsRemovidos }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("delete-user-account error", err);
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : "internal" }), {
      status: 500, headers: corsHeaders,
    });
  }
});
