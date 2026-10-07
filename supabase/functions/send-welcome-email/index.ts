
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.117.2";
import { sendEmail, templates } from "../_shared/brevo.ts";
import { getCallerUser, checkSharedSecret } from "../_shared/guard.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // SEGURANÇA (M3): sem auth, qualquer um enviava e-mail com a marca CredMais para
    // qualquer destinatário (spam/phishing + queima de cota Brevo). Aceita um usuário
    // autenticado OU um segredo interno para chamadas server-side.
    //
    // Quem manda e-mail em nome da empresa fecha por padrão. Além do guard
    // compartilhado, Boolean evita aceitar uma chamada interna sem segredo definido.
    const segredoInterno = Deno.env.get("INTERNAL_FN_SECRET");
    const user = await getCallerUser(req);
    const chamadaInterna = Boolean(segredoInterno) &&
      checkSharedSecret(req, "INTERNAL_FN_SECRET", "x-internal-secret");
    if (!user && !chamadaInterna) {
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { email, name } = await req.json();

    if (!email) {
      return new Response(JSON.stringify({ error: "Email is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const emailTemplate = templates.welcome(name || email);
    const result = await sendEmail({
      to: [{ email, name }],
      subject: emailTemplate.subject,
      htmlContent: emailTemplate.html,
    });

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : "erro" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
