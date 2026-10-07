import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.117.2";
import { checkSharedSecret } from "../_shared/guard.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  // SEGURANÇA (M4): cron protegido por segredo obrigatório.
  if (!checkSharedSecret(req, "CRON_SECRET")) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const cutoff = new Date(Date.now() - 30 * 86400000).toISOString();

    // Notificações lidas com mais de 30 dias
    const { data: notifs, error: e1 } = await supabase
      .from("notifications")
      .delete()
      .eq("is_read", true)
      .lt("created_at", cutoff)
      .select("id");

    // Audit logs com mais de 90 dias
    const cutoff90 = new Date(Date.now() - 90 * 86400000).toISOString();
    const { data: logs, error: e2 } = await supabase
      .from("audit_logs")
      .delete()
      .lt("created_at", cutoff90)
      .select("id");

    // Erros de front-end com mais de 30 dias.
    // Incluído desde o início para não repetir o que aconteceu com o backup, que
    // rodou meses sem retenção e acumulou 100 MB.
    const { data: erros, error: e3 } = await supabase
      .from("client_errors")
      .delete()
      .lt("criado_em", cutoff)
      .select("id");

    if (e1 || e2 || e3) console.error(e1 || e2 || e3);

    return new Response(
      JSON.stringify({
        message: `Limpeza: ${notifs?.length || 0} notificações, ${logs?.length || 0} logs, ${erros?.length || 0} erros`,
        notifications_deleted: notifs?.length || 0,
        logs_deleted: logs?.length || 0,
        client_errors_deleted: erros?.length || 0,
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
