// Exporta TODOS os dados do usuário autenticado (LGPD - Direito à portabilidade)
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.117.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const USER_TABLES = [
  "profiles", "settings", "clients", "contracts", "contract_installments",
  "installments", "transactions", "profits", "expenses", "goals",
  "todos", "notes", "notifications", "audit_logs", "automation_logs",
  "message_templates", "subscriptions", "collectors", "collector_assignments",
  "whatsapp_conversations", "whatsapp_messages", "whatsapp_notes",
  "whatsapp_instances", "whatsapp_scheduled_messages", "system_automations",
  "bot_actions_log", "vehicles", "rentals", "pledges", "stock_items",
  "support_tickets", "support_ticket_messages",
];

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
    if (!user) return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: corsHeaders });

    const admin = createClient(supabaseUrl, serviceKey);
    const dump: Record<string, any> = {
      _meta: {
        exported_at: new Date().toISOString(),
        user_id: user.id,
        email: user.email,
        note: "Dados pessoais conforme LGPD Art. 18 (portabilidade). JSON completo.",
      },
    };

    for (const table of USER_TABLES) {
      try {
        // profiles/settings usam id/user_id — tentamos os dois
        const filter = table === "profiles" ? "id" : "user_id";
        const { data, error } = await admin.from(table).select("*").eq(filter, user.id);
        if (error) {
          dump[table] = { _error: error.message };
        } else {
          dump[table] = data || [];
        }
      } catch (e: any) {
        dump[table] = { _error: e?.message || "fetch_failed" };
      }
    }

    return new Response(JSON.stringify(dump, null, 2), {
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json",
        "Content-Disposition": `attachment; filename="meus-dados-${user.id.slice(0,8)}-${Date.now()}.json"`,
      },
    });
  } catch (err) {
    console.error("export-user-data error", err);
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : "internal" }), {
      status: 500, headers: corsHeaders,
    });
  }
});
