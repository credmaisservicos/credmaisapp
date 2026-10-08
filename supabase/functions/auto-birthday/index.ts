import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.117.2";
import { checkSharedSecret } from "../_shared/guard.ts";
import { testRecipientScope } from "../_shared/bot_test_scope.ts";
import { financialDay } from "../_shared/financial_calendar.ts";

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

    const monthDay = financialDay(new Date())!.slice(5);

    // Buscar clientes que fazem aniversário hoje (compara MM-DD)
    const { data: clients } = await supabase
      .from("clients")
      .select("id, user_id, name, whatsapp, phone, birth_date")
      .not("birth_date", "is", null);

    const birthdayClients = (clients || []).filter((c) => {
      if (!c.birth_date) return false;
      return financialDay(c.birth_date)?.slice(5) === monthDay;
    });

    // Agrupar por user_id para buscar settings 1x
    const byUser = new Map<string, typeof birthdayClients>();
    for (const c of birthdayClients) {
      const arr = byUser.get(c.user_id) || [];
      arr.push(c);
      byUser.set(c.user_id, arr);
    }

    let sent = 0;
    for (const [user_id, list] of byUser) {
      const { data: settings } = await supabase
        .from("settings")
        .select("company_name, whatsapp_api_url, whatsapp_api_key, whatsapp_instance")
        .eq("user_id", user_id)
        .maybeSingle();

      const company = settings?.company_name || "Equipe";
      const canSend = settings?.whatsapp_api_url && settings?.whatsapp_api_key && settings?.whatsapp_instance;

      for (const c of list) {
        const phone = (c.whatsapp || c.phone || "").replace(/\D/g, "");
        // This legacy sender bypasses the delivery queue. Enforce the test
        // account's recipient restriction before any provider request too.
        if (testRecipientScope(user_id,phone) === false) continue;
        const msg = `🎉 Olá *${c.name}*, feliz aniversário!\n\nQue seu dia seja repleto de alegria e realizações. ✨\n\nUm abraço,\n_${company}_`;

        if (canSend && phone) {
          try {
            const url = `${settings.whatsapp_api_url!.replace(/\/$/, "")}/message/sendText/${settings.whatsapp_instance}`;
            const response = await fetch(url, {
              method: "POST",
              headers: { "Content-Type": "application/json", apikey: settings.whatsapp_api_key! },
              body: JSON.stringify({ number: phone, text: msg }),
              signal: AbortSignal.timeout(12_000),
            });
            await response.body?.cancel();
            if(response.ok)sent++;
          } catch { console.error("Birthday WhatsApp delivery unavailable"); }
        }

        // Notificação interna sempre
        await supabase.from("notifications").insert({
          user_id,
          message: `🎂 Hoje é aniversário de ${c.name}!`,
          type: "birthday",
          from: "Sistema",
          link: `/clientes/${c.id}`,
        });
      }
    }

    return new Response(
      JSON.stringify({ message: `${birthdayClients.length} aniversariante(s), ${sent} mensagem(ns) enviada(s)`, total: birthdayClients.length, sent }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Erro" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
