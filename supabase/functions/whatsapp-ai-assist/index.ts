// AI assistant pro Inbox: gera sugestões de resposta, resumo da conversa, e classifica intenção.
// Modes: "suggest" | "summarize" | "classify"
// Powered by Anthropic Claude
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
    const entitlement = await enforceEntitlement(user.id, "whatsapp-ai-assist", { completeOnly: true, capacity: 60 });
    if (!entitlement.ok) return entitlementResponse(entitlement, corsHeaders);

    const { conversation_id, mode } = await req.json();
    if (!conversation_id || !mode) {
      return new Response(JSON.stringify({ error: "missing_params" }), { status: 400, headers: corsHeaders });
    }

    const supabase = createClient(supabaseUrl, serviceKey);
    const { data: convo } = await supabase
      .from("whatsapp_conversations").select("*")
      .eq("id", conversation_id).eq("user_id", user.id).single();
    if (!convo) {
      return new Response(JSON.stringify({ error: "not_found" }), { status: 404, headers: corsHeaders });
    }

    const { data: msgs } = await supabase
      .from("whatsapp_messages")
      .select("direction, sender, content, message_type, metadata, created_at")
      .eq("conversation_id", conversation_id)
      .order("created_at", { ascending: false })
      .limit(30);

    const history = (msgs || []).reverse().map((m: any) => {
      const txt = m.content || m.metadata?.transcript || `[${m.message_type}]`;
      const who = m.direction === "in" ? "Cliente" : (m.sender === "bot" ? "Bot" : "Operador");
      return `${who}: ${txt}`;
    }).join("\n");

    const { data: profile } = await supabase
      .from("profiles").select("name, pix_key, pix_key_type").eq("id", user.id).single();
    const { data: settings } = await supabase
      .from("settings").select("company_name, bot_tone").eq("user_id", user.id).single();

    let systemPrompt = "";
    let userMsg = "";
    let temperature = 0.4;

    if (mode === "suggest") {
      systemPrompt = `Você é um copiloto de atendimento WhatsApp da empresa "${settings?.company_name || profile?.name || 'a empresa'}".
Tom: ${settings?.bot_tone || 'profissional e empático'}.
Gere 3 sugestões DIFERENTES de resposta curta (1-3 linhas) que o operador HUMANO pode enviar ao cliente como próxima mensagem.
Português brasileiro, natural, sem emojis exagerados.
Cada sugestão deve cobrir um ângulo diferente: empática, objetiva, e firme/cobrar pagamento (se contexto for cobrança).

Retorne APENAS JSON puro: { "suggestions": ["...", "...", "..."] }`;
      userMsg = `Histórico da conversa:\n${history}\n\nGere 3 sugestões em JSON.`;
      temperature = 0.85;
    } else if (mode === "summarize") {
      systemPrompt = `Você resume conversas de WhatsApp para um operador entender rápido o contexto.
Retorne APENAS JSON puro: { "summary": "...", "key_points": ["...", "...", "..."], "next_action": "..." }
- summary: 1-2 frases do que aconteceu.
- key_points: até 4 bullets do que importa.
- next_action: sugestão do que o operador deve fazer agora.`;
      userMsg = `Conversa:\n${history}\n\nResuma em JSON.`;
    } else if (mode === "classify") {
      systemPrompt = `Classifique a INTENÇÃO da última mensagem do cliente.
Categorias: pagamento, duvida, reclamacao, negociacao, comprovante, saudacao, agressivo, outro.
Retorne APENAS JSON puro: { "intent": "...", "confidence": 0-1, "urgency": "low|medium|high" }`;
      userMsg = `Últimas mensagens:\n${history.split("\n").slice(-6).join("\n")}\n\nClassifique em JSON.`;
    } else {
      return new Response(JSON.stringify({ error: "invalid_mode" }), { status: 400, headers: corsHeaders });
    }

    let result: any;
    try {
      result = await callAnthropicJSON({
        userId:user.id,
        system: systemPrompt,
        messages: [{ role: "user", content: userMsg }],
        temperature,
        maxTokens: 800,
      });
    } catch (e: any) {
      return new Response(JSON.stringify({ error: "ai_failed", detail: e.message }), { status: 502, headers: corsHeaders });
    }

    return new Response(JSON.stringify({ ok: true, ...result }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("whatsapp-ai-assist error", err);
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : "internal" }), {
      status: 500, headers: corsHeaders,
    });
  }
});
