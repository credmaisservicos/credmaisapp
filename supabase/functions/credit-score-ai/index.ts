import { isEmAtraso, isEmAberto, venceHoje } from "../_shared/installmentStatus.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.117.2";
import { callAnthropicJSON } from "../_shared/anthropic.ts";
import { enforceEntitlement, entitlementResponse } from "../_shared/entitlement.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const { client_id } = await req.json();
    if (!client_id) {
      return new Response(JSON.stringify({ error: "client_id required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const entitlement = await enforceEntitlement(user.id, "credit-score-ai", { capacity: 30 });
    if (!entitlement.ok) return entitlementResponse(entitlement, corsHeaders);

    const { data: client } = await supabase.from("clients").select("*").eq("id", client_id).eq("user_id", user.id).maybeSingle();
    if (!client) return new Response(JSON.stringify({ error: "client not found" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const { data: insts } = await supabase
      .from("contract_installments")
      .select("status, due_date, paid_at, amount")
      .eq("client_id", client_id)
      .eq("user_id", user.id);

    const { data: contracts } = await supabase
      .from("contracts")
      .select("capital, status, total_amount")
      .eq("client_id", client_id)
      .eq("user_id", user.id);

    const now = Date.now();
    let onTime = 0, late = 0, overdueNow = 0, totalLateDays = 0, paidValue = 0, pendingValue = 0;
    for (const i of insts || []) {
      const due = new Date(i.due_date).getTime();
      if (i.status === "paid" && i.paid_at) {
        const paid = new Date(i.paid_at).getTime();
        const diff = (paid - due) / 86400000;
        if (diff <= 1) onTime++;
        else { late++; totalLateDays += Math.floor(diff); }
        paidValue += Number(i.amount || 0);
      } else if (isEmAberto(i)) {
        // "em aberto" cobre pending E overdue: contar só pending escondia a
        // inadimplência de quem já passou pela virada da madrugada.
        if (due < now) { overdueNow++; totalLateDays += Math.floor((now - due) / 86400000); }
        pendingValue += Number(i.amount || 0);
      }
    }

    const totalContracts = contracts?.length || 0;
    const completedContracts = contracts?.filter(c => c.status === "completed").length || 0;
    const totalCapital = contracts?.reduce((a, c) => a + Number(c.capital || 0), 0) || 0;
    const avgLate = late + overdueNow > 0 ? totalLateDays / (late + overdueNow) : 0;

    const summary = {
      name: client.name,
      total_contracts: totalContracts,
      completed_contracts: completedContracts,
      total_borrowed: totalCapital,
      installments_total: insts?.length || 0,
      installments_on_time: onTime,
      installments_late_history: late,
      installments_overdue_now: overdueNow,
      avg_days_late: Math.round(avgLate),
      paid_value: paidValue,
      pending_value: pendingValue,
      current_score: client.credit_score || 100,
    };

    const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
    if (!ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY not configured");

    const analysis = await callAnthropicJSON({
      system: "Você é um analista de crédito brasileiro especializado em empréstimos pessoais. Analise o histórico do cliente e gere um score de 0 a 1000, classificação de risco e recomendações práticas. Seja direto, em português brasileiro. Responda APENAS com JSON válido no formato: {\"score\": number (0-1000), \"risk_level\": \"baixo\"|\"medio\"|\"alto\"|\"critico\", \"risk_label\": string, \"recommended_limit\": number, \"recommended_max_installments\": number, \"reasoning\": string, \"positive_points\": string[], \"red_flags\": string[], \"recommendations\": string[3-4]}",
      messages: [{
        role: "user",
        content: `Analise este cliente:\n${JSON.stringify(summary, null, 2)}\n\nGere score (0-1000), risco, limite recomendado e justificativa curta. Retorne somente o JSON.`,
      }],
      maxTokens: 1200,
      temperature: 0.4,
    });
    if (!analysis) throw new Error("AI did not return structured analysis");

    return new Response(JSON.stringify({ analysis, summary }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("credit-score-ai error:", err);
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : "Erro" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
