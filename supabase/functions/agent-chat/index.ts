import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.117.2";
import { enforceEntitlement, entitlementResponse } from "../_shared/entitlement.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Não autorizado" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Authenticate before validating internal integrations so anonymous
    // requests consistently receive 401 and never expose configuration state.
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Não autorizado" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!anthropicKey) {
      return new Response(JSON.stringify({ error: "ANTHROPIC_API_KEY não configurada" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const entitlement = await enforceEntitlement(user.id, "agent-chat", { completeOnly: true, capacity: 60 });
    if (!entitlement.ok) return entitlementResponse(entitlement, corsHeaders);

    const { messages, context } = await req.json();

    const systemPrompt = `Você é o Copiloto Executivo do CredMais App — consultor sênior de crédito e cobranças com 15 anos de experiência, especialista em análise de carteira, estratégia de recuperação e gestão de risco no mercado brasileiro de crédito pessoal.

═══ 📊 CONTEXTO DA CARTEIRA ═══
${context ? `
- Total de clientes: ${context.totalClients} (ativos: ${context.activeClients})
- Contratos: ${context.totalContracts} (ativos: ${context.activeContracts})
- Inadimplência: ${context.overdueCount} parcelas | R$ ${context.overdueAmount}
- Capital na rua: R$ ${context.capitalOnStreet}
- Lucro em juros (histórico): R$ ${context.totalProfit}
- Vencimentos hoje: ${context.dueTodayCount}
${context.clientsList ? `\nClientes:\n${context.clientsList}` : ""}
${context.overdueDetails ? `\nParcelas atrasadas:\n${context.overdueDetails}` : ""}
` : "(Contexto ainda não carregado — peça ao usuário para atualizar a página se precisar de dados atuais.)"}

═══ 🧭 COMO RACIOCINAR ═══
1. LEIA os números acima ANTES de responder — nunca chute métrica.
2. Diagnóstico primeiro, recomendação depois. Sempre com base em evidência da carteira.
3. Priorize por impacto financeiro: valor em risco × probabilidade de recuperação.
4. Cite números específicos (%, R$, quantidade) — nada de "muitos", "vários", "alto".

═══ ✍️ ESTILO ═══
- Executivo, direto, sem enrolação. Português brasileiro.
- Use tabelas markdown para comparar segmentos/clientes.
- Use bullets para planos de ação (3–5 passos concretos).
- Ao sugerir cobrança/mensagem, dê o TEXTO pronto para o operador copiar.
- Se faltar dado no contexto, diga o que falta em vez de inventar.

═══ 🚨 REGRAS INVIOLÁVEIS ═══
✗ NUNCA invente cliente, contrato, valor ou taxa que não esteja no contexto.
✗ NUNCA prometa envio automático de mensagens — oriente o usuário a usar a aba WhatsApp ou o bot automático.
✗ NUNCA dê conselho jurídico específico — sempre recomende validar com advogado quando envolver protesto/negativação/ação judicial.
✗ NUNCA sugira estratégia agressiva/ameaçadora — reputação da marca vem antes de recuperação de curto prazo.`;

    // Converte messages para o formato Anthropic (apenas user/assistant)
    const anthMessages = messages
      .filter((m: any) => m.role === "user" || m.role === "assistant")
      .map((m: any) => ({ role: m.role, content: m.content }));

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": anthropicKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-5-20250929",
        max_tokens: 2048,
        temperature: 0.7,
        system: systemPrompt,
        messages: anthMessages,
        stream: true,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      return new Response(JSON.stringify({ error: `Anthropic API: ${errorText}` }), {
        status: response.status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Re-encoda o streaming SSE da Anthropic para o formato OpenAI-style que o frontend espera
    const stream = new ReadableStream({
      async start(controller) {
        const reader = response.body!.getReader();
        const decoder = new TextDecoder();
        const encoder = new TextEncoder();
        let buffer = "";

        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });

            const lines = buffer.split("\n");
            buffer = lines.pop() || "";

            for (const line of lines) {
              if (!line.startsWith("data: ")) continue;
              const payload = line.slice(6).trim();
              if (!payload) continue;

              try {
                const evt = JSON.parse(payload);
                if (evt.type === "content_block_delta" && evt.delta?.text) {
                  const chunk = {
                    choices: [{ delta: { content: evt.delta.text } }],
                  };
                  controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
                } else if (evt.type === "message_stop") {
                  controller.enqueue(encoder.encode("data: [DONE]\n\n"));
                }
              } catch {
                // ignora parses inválidos
              }
            }
          }
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
    });
  } catch (err) {
    console.error("agent-chat error:", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Erro interno" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
