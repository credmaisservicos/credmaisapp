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

    const now = new Date();
    const in7days = new Date(now.getTime() + 7 * 86400000);

    // 1) Bloquear contas com assinatura vencida.
    //
    // Só entram perfis COM data de vencimento no passado. Quem está com NULL
    // não é tocado aqui de propósito: são os vitalícios e os casos legados que
    // o webhook antigo deixou sem data. Bloquear em massa por NULL derrubaria
    // gente que pagou — o conserto certo é o webhook passar a gravar a data,
    // e ele já faz isso. Os legados aparecem no relatório abaixo para o dono
    // resolver um a um.
    const { data: expired } = await supabase
      .from("profiles")
      .select("id, name, email, subscription_expires_at, is_blocked")
      .not("subscription_expires_at", "is", null)
      .lt("subscription_expires_at", now.toISOString())
      .eq("is_blocked", false);

    let blocked = 0;
    for (const p of expired || []) {
      await supabase.from("profiles").update({ is_blocked: true }).eq("id", p.id);
      await supabase.from("notifications").insert({
        user_id: p.id,
        message: "Sua assinatura expirou. Renove para continuar usando o sistema.",
        type: "subscription_expired",
        from: "Sistema",
        link: "/configuracoes",
      });
      blocked++;
    }

    // 2) Avisar quem vence em até 7 dias (1 vez/dia)
    const { data: expiring } = await supabase
      .from("profiles")
      .select("id, name, subscription_expires_at")
      .gte("subscription_expires_at", now.toISOString())
      .lte("subscription_expires_at", in7days.toISOString())
      .eq("is_blocked", false);

    const todayStr = now.toISOString().split("T")[0];
    let warned = 0;
    for (const p of expiring || []) {
      const { data: existing } = await supabase
        .from("notifications")
        .select("id")
        .eq("user_id", p.id)
        .eq("type", "subscription_expiring")
        .gte("created_at", `${todayStr}T00:00:00Z`)
        .limit(1);
      if (existing && existing.length > 0) continue;

      const expDate = new Date(p.subscription_expires_at!);
      const days = Math.ceil((expDate.getTime() - now.getTime()) / 86400000);
      await supabase.from("notifications").insert({
        user_id: p.id,
        message: `Sua assinatura vence em ${days} dia(s). Renove para evitar bloqueio.`,
        type: "subscription_expiring",
        from: "Sistema",
        link: "/configuracoes",
      });
      warned++;
    }

    // 3) Relatório: assinaturas ativas cujo perfil ficou SEM data de vencimento.
    // Essas pessoas têm acesso que nunca expira e nunca é cobrado de novo.
    // Não bloqueamos automaticamente — é decisão de negócio —, mas o dono
    // precisa enxergá-las.
    // O join por chave estrangeira não serve aqui: a maioria das assinaturas
    // tem `user_id` nulo (o webhook só vincula quando encontra o perfil na
    // hora). O casamento precisa ser por e-mail, como faz o ProtectedRoute.
    const [{ data: ativas }, { data: perfis }] = await Promise.all([
      supabase.from("subscriptions").select("email, user_id, amount_paid, updated_at").eq("status", "active"),
      supabase.from("profiles").select("id, email, subscription_type, subscription_expires_at"),
    ]);

    const porId = new Map((perfis || []).map((p: any) => [p.id, p]));
    const porEmail = new Map((perfis || []).map((p: any) => [String(p.email || "").toLowerCase(), p]));

    const semPrazo = (ativas || [])
      .filter((s: any) => {
        const p = (s.user_id && porId.get(s.user_id)) || porEmail.get(String(s.email || "").toLowerCase());
        if (!p) return true;                                   // ativa sem perfil nenhum
        if (p.subscription_type === "lifetime") return false;   // vitalício é intencional
        return p.subscription_expires_at == null;               // acesso que nunca vence
      })
      .map((s: any) => s.email);
    if (semPrazo.length) {
      console.warn(`[assinaturas] ${semPrazo.length} ativa(s) sem data de vencimento:`, semPrazo.join(", "));
    }

    return new Response(
      JSON.stringify({
        message: `${blocked} bloqueada(s), ${warned} avisada(s)`,
        blocked,
        warned,
        ativas_sem_data_de_vencimento: semPrazo,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("auto-subscription-check error:", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Erro" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
