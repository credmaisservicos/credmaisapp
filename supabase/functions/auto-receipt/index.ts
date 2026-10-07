import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.117.2";
import { getCallerUser } from "../_shared/guard.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    // SEGURANÇA (M1): exige usuário autenticado e deriva o user_id DELE (nunca do
    // corpo). Sem isso, qualquer um que soubesse um installment_id disparava um
    // "✅ Recibo de Pagamento" no WhatsApp do devedor via a instância do dono (fraude).
    const user = await getCallerUser(req);
    if (!user) {
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const user_id = user.id;

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const body = await req.json().catch(() => ({}));
    const { installment_id } = body;
    if (!installment_id) {
      return new Response(JSON.stringify({ error: "installment_id obrigatório" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: inst } = await supabase
      .from("contract_installments")
      .select("*, clients(name, whatsapp, phone), contracts(capital, num_installments)")
      .eq("id", installment_id)
      .single();

    if (!inst) {
      return new Response(JSON.stringify({ error: "Parcela não encontrada" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // A parcela precisa pertencer ao usuário autenticado.
    if ((inst as any).user_id !== user_id) {
      return new Response(JSON.stringify({ error: "forbidden" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: settings } = await supabase
      .from("settings")
      .select("company_name, whatsapp_api_url, whatsapp_api_key, whatsapp_instance, bot_send_receipt")
      .eq("user_id", user_id)
      .maybeSingle();

    if (!settings?.bot_send_receipt) {
      return new Response(JSON.stringify({ message: "Recibo automático desativado" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const cli = (inst as any).clients;
    const ctr = (inst as any).contracts;
    const phone = (cli?.whatsapp || cli?.phone || "").replace(/\D/g, "");
    if (!phone) {
      return new Response(JSON.stringify({ message: "Cliente sem telefone" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const value = Number(inst.paid_amount || inst.amount).toFixed(2);
    const company = settings.company_name || "Sistema";
    const msg =
      `✅ *Recibo de Pagamento*\n\n` +
      `Olá *${cli?.name}*, confirmamos o recebimento da parcela ${inst.installment_number}/${ctr?.num_installments || "?"}.\n\n` +
      `💰 Valor pago: *R$ ${value}*\n` +
      `📅 Data: ${new Date(inst.paid_at || Date.now()).toLocaleDateString("pt-BR")}\n\n` +
      `Obrigado pela pontualidade!\n_${company}_`;

    let sent = false;
    if (settings.whatsapp_api_url && settings.whatsapp_api_key && settings.whatsapp_instance) {
      try {
        const url = `${settings.whatsapp_api_url.replace(/\/$/, "")}/message/sendText/${settings.whatsapp_instance}`;
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json", apikey: settings.whatsapp_api_key },
          body: JSON.stringify({ number: phone, text: msg }),
        });
        sent = res.ok;
      } catch (e) {
        console.error("WA send err:", e);
      }
    }

    await supabase.from("audit_logs").insert({
      user_id, action: "receipt_sent", entity_type: "auto_receipt", entity_id: installment_id,
      details: { client_name: cli?.name, amount: value, sent_via_whatsapp: sent },
    });

    return new Response(
      JSON.stringify({ message: sent ? "Recibo enviado" : "Recibo registrado (WA não configurado)", sent }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("auto-receipt error:", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Erro" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
