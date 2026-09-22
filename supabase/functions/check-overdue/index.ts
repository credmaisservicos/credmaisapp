import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { checkSharedSecret } from "../_shared/guard.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  // SEGURANÇA (M4): cron protegido por segredo obrigatório.
  if (!checkSharedSecret(req, "CRON_SECRET")) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    // Este job gerava o MESMO alerta de "parcelas atrasadas" que
    // auto-notifications/index.ts (seção "2. PARCELAS ATRASADAS") já gera —
    // dois crons independentes, cada um com seu próprio texto e `type`
    // (`overdue_auto` aqui, `overdue_summary` lá), então quem tem atraso
    // recebia dois avisos duplicados por dia em vez de um.
    //
    // Em vez de manter os dois de pé (ou depender de alguém remover o
    // agendamento deste no Easypanel, que este código não alcança), este job
    // fica como um no-op explícito: continua existindo e podendo ser chamado
    // pelo cron antigo sem erro, só não cria mais notificação nenhuma.
    // auto-notifications é quem manda nesse alerta agora.
    return new Response(
      JSON.stringify({ message: "no-op: consolidado em auto-notifications (seção PARCELAS ATRASADAS)" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "erro" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
