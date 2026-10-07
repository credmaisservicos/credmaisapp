import { isEmAtraso, isEmAberto, venceHoje } from "../_shared/installmentStatus.ts";
// Daily AI briefing for the dashboard top card
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { callAnthropicJSON } from "../_shared/anthropic.ts";
import { enforceEntitlement, entitlementResponse } from "../_shared/entitlement.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;

    const auth = req.headers.get("Authorization");
    if (!auth) return new Response(JSON.stringify({ error: "Não autenticado" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const userClient = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: auth } },
    });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return new Response(JSON.stringify({ error: "Não autenticado" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const entitlement = await enforceEntitlement(user.id, "daily-briefing", { capacity: 12 });
    if (!entitlement.ok) return entitlementResponse(entitlement, corsHeaders);

    const admin = createClient(SUPABASE_URL, SERVICE_KEY);
    const today = new Date();
    const todayStr = today.toISOString().slice(0, 10);
    const in7 = new Date(today.getTime() + 7 * 86400000);

    const [{ data: installments }, { data: contracts }, { data: profile }] = await Promise.all([
      admin.from("contract_installments").select("*").eq("user_id", user.id),
      admin.from("contracts").select("*, clients(name)").eq("user_id", user.id),
      admin.from("profiles").select("name").eq("id", user.id).single(),
    ]);

    const inst = installments || [];
    // O resumo diário chegava com a inadimplência quase zerada: filtrava por
    // "pending" e o cron das 03:00 já tinha marcado as vencidas como "overdue".
    const overdue = inst.filter((i: any) => isEmAtraso(i, today));
    const dueToday = inst.filter((i: any) => venceHoje(i, today));
    const next7 = inst.filter((i: any) => isEmAberto(i) && new Date(i.due_date) > today && new Date(i.due_date) <= in7);

    const overdueAmount = overdue.reduce((s: number, i: any) => s + Number(i.amount || 0), 0);
    const dueTodayAmount = dueToday.reduce((s: number, i: any) => s + Number(i.amount || 0), 0);
    const next7Amount = next7.reduce((s: number, i: any) => s + Number(i.amount || 0), 0);

    const topOverdue = overdue
      .map((i: any) => {
        const c = (contracts || []).find((c: any) => c.id === i.contract_id);
        const days = Math.floor((today.getTime() - new Date(i.due_date).getTime()) / 86400000);
        return { name: c?.clients?.name || "—", amount: Number(i.amount), days };
      })
      .sort((a, b) => b.days - a.days)
      .slice(0, 3);

    const userPrompt = `Dados de hoje (${today.toLocaleDateString("pt-BR")}):
- Parcelas atrasadas: ${overdue.length} (R$ ${overdueAmount.toFixed(2)})
- Vencendo hoje: ${dueToday.length} (R$ ${dueTodayAmount.toFixed(2)})
- Próximos 7 dias: ${next7.length} (R$ ${next7Amount.toFixed(2)})
- Top 3 críticos: ${topOverdue.map(t => `${t.name} (${t.days}d, R$${t.amount.toFixed(0)})`).join("; ") || "nenhum"}

Nome do usuário: ${profile?.name?.split(" ")[0] || "Operador"}`;

    const firstName = profile?.name?.split(" ")[0] || "Operador";
    const hour = today.getHours();
    const greet = hour < 12 ? "Bom dia" : hour < 18 ? "Boa tarde" : "Boa noite";
    const fallbackBriefing = {
      greeting: `${greet}, ${firstName}`,
      summary: overdue.length > 0
        ? `Você tem ${overdue.length} parcela(s) em atraso somando R$ ${overdueAmount.toFixed(2)}. Foco em recuperar hoje.`
        : dueToday.length > 0
        ? `${dueToday.length} parcela(s) vencem hoje (R$ ${dueTodayAmount.toFixed(2)}). Acompanhe os pagamentos.`
        : `Nenhuma parcela atrasada. Próximos 7 dias: ${next7.length} parcela(s) (R$ ${next7Amount.toFixed(2)}).`,
      priorities: [
        overdue.length > 0 ? `Cobrar ${overdue.length} atrasos (prioridade: ${topOverdue[0]?.name || "—"})` : "Manter régua de comunicação ativa",
        dueToday.length > 0 ? `Confirmar ${dueToday.length} vencimentos de hoje` : `Planejar próximos ${next7.length} vencimentos`,
        "Revisar clientes inadimplentes na aba Cobranças",
      ],
      tone: (overdue.length > 0 ? "alerta" : dueToday.length > 0 ? "neutro" : "positivo") as "positivo" | "neutro" | "alerta",
    };

    let briefing = fallbackBriefing;
    if (ANTHROPIC_API_KEY) {
      try {
        briefing = await callAnthropicJSON({
          system: "Você é um assistente executivo de cobranças. Gere um briefing curto, motivador e prático em português brasileiro. Seja direto. Use 'você'. NÃO use markdown nem emojis em excesso (no máximo 1). Responda APENAS com JSON válido no formato: {\"greeting\": string, \"summary\": string, \"priorities\": string[2-3], \"tone\": \"positivo\"|\"neutro\"|\"alerta\"}",
          messages: [{ role: "user", content: userPrompt + "\n\nRetorne somente o JSON." }],
          maxTokens: 600,
          temperature: 0.7,
        });
      } catch (err) {
        console.error("Anthropic error, using fallback:", err);
      }
    }

    return new Response(JSON.stringify({
      briefing,
      stats: { overdueCount: overdue.length, overdueAmount, dueTodayCount: dueToday.length, dueTodayAmount, next7Count: next7.length, next7Amount },
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("daily-briefing error", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "erro" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
