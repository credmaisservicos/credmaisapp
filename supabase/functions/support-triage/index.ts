import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { callAnthropicJSON } from "../_shared/anthropic.ts";
import { getCallerUser } from "../_shared/guard.ts";
import { enforceEntitlement, entitlementResponse } from "../_shared/entitlement.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface TriageResult {
  category: "bug" | "duvida" | "financeiro" | "whatsapp" | "outro";
  severity: "low" | "med" | "high";
  suggested_reply: string;
}

const SYSTEM_PROMPT = `Você é um assistente de triagem de tickets do SYSTEM JUROS (gestão de empréstimos pessoais).
Classifique o ticket abaixo e sugira uma resposta inicial profissional, calorosa e útil em PT-BR (máx 4 parágrafos curtos).

Retorne APENAS um JSON válido no formato:
{
  "category": "bug" | "duvida" | "financeiro" | "whatsapp" | "outro",
  "severity": "low" | "med" | "high",
  "suggested_reply": "..."
}

Regras:
- bug = erro técnico, tela quebrada, função não funciona
- duvida = como faço X, onde fica Y
- financeiro = cobrança, assinatura, plano, Mercado Pago, pagamento
- whatsapp = bot, Evolution API, mensagens não entregam, instância
- outro = qualquer outra coisa
- severity high = sistema parado/perda de dados/cobrança indevida; med = bloqueio parcial; low = dúvida/sugestão
- A resposta sugerida NUNCA promete prazos, NUNCA inventa funcionalidades, sempre pede mais info quando faltar contexto.`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // SEGURANÇA (A3): exige usuário autenticado. Sem isso, qualquer um iterava
    // ticket_id e disparava triagem de IA sobre tickets de outros tenants (IDOR),
    // lendo assunto/mensagens alheios e gastando custo de IA.
    const user = await getCallerUser(req);
    if (!user) {
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const entitlement = await enforceEntitlement(user.id, "support-triage", { capacity: 20 });
    if (!entitlement.ok) return entitlementResponse(entitlement, corsHeaders);

    const { ticket_id } = await req.json();
    if (!ticket_id) {
      return new Response(JSON.stringify({ error: "ticket_id obrigatório" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: ticket, error: tErr } = await supabase
      .from("support_tickets")
      .select("id, user_id, subject, category, priority, ai_triaged_at")
      .eq("id", ticket_id)
      .single();

    if (tErr || !ticket) {
      return new Response(JSON.stringify({ error: "Ticket não encontrado" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Só o dono do ticket ou um admin pode acionar a triagem.
    if (ticket.user_id !== user.id) {
      const { data: prof } = await supabase
        .from("profiles").select("is_admin").eq("id", user.id).maybeSingle();
      if (!prof?.is_admin) {
        return new Response(JSON.stringify({ error: "forbidden" }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    if (ticket.ai_triaged_at) {
      return new Response(JSON.stringify({ ok: true, skipped: "already triaged" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: msgs } = await supabase
      .from("support_ticket_messages")
      .select("sender_role, message")
      .eq("ticket_id", ticket_id)
      .order("created_at", { ascending: true })
      .limit(5);

    const conversation = (msgs || [])
      .map((m: any) => `[${m.sender_role}] ${m.message}`)
      .join("\n");

    const userPrompt = `Assunto: ${ticket.subject}
Categoria informada: ${ticket.category}
Prioridade informada: ${ticket.priority}

Mensagens:
${conversation || "(sem mensagens ainda)"}`;

    const result = await callAnthropicJSON<TriageResult>({
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userPrompt }],
      maxTokens: 800,
      temperature: 0.3,
    });

    await supabase
      .from("support_tickets")
      .update({
        ai_category: result.category,
        ai_severity: result.severity,
        ai_suggested_reply: result.suggested_reply,
        ai_triaged_at: new Date().toISOString(),
      })
      .eq("id", ticket_id);

    return new Response(JSON.stringify({ ok: true, result }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("support-triage error:", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Erro interno" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
