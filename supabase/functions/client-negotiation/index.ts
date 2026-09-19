import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { guard as rateLimit } from "../_shared/rate_limit.ts";
import { parseNegotiationRequest } from "../_shared/client_negotiation.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  // Rate limit: chat de negociação (AI), 12 req/min por IP
  const rl = await rateLimit(req, "client-negotiation", 12, 12 / 60, corsHeaders);
  if (rl) return rl;


  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const payload = parseNegotiationRequest(await req.json());
    if (!payload) {
      return new Response(JSON.stringify({ error: "Solicitação de negociação inválida" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const { messages, clientId, sessionToken } = payload;
    const { data: portalSession } = await supabase
      .from("portal_sessions").select("client_id")
      .eq("token", sessionToken)
      .gt("expires_at", new Date().toISOString())
      .maybeSingle();
    if (!portalSession || portalSession.client_id !== clientId) {
      return new Response(JSON.stringify({ error: "Sessão inválida ou expirada" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!anthropicKey) {
      return new Response(JSON.stringify({ error: "Assistente temporariamente indisponível" }), {
        status: 503,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Validar cliente associado à sessão curta e revogável do portal.
    const { data: client, error: clientError } = await supabase
      .from("clients")
      .select("*, profiles!user_id(*)")
      .eq("id", clientId)
      .single();

    if (clientError || !client) {
      return new Response(JSON.stringify({ error: "Cliente não encontrado ou acesso negado" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Buscar dívidas
    const { data: installments } = await supabase
      .from("contract_installments")
      .select("*, contracts(*)")
      .eq("client_id", clientId)
      .or("status.eq.pending,status.eq.overdue")
      .order("due_date");

    const totalOverdue = installments?.reduce((sum, inst) => 
      new Date(inst.due_date) < new Date() ? sum + Number(inst.amount) : sum, 0) || 0;
    
    const overdueCount = installments?.filter(inst => new Date(inst.due_date) < new Date()).length || 0;

    const systemPrompt = `Você é o assistente IA de negociação da empresa "${client.profiles?.name || "nossa empresa"}".
    Você está conversando diretamente com o cliente ${client.name}.
    
    Contexto do Cliente:
    - Nome: ${client.name}
    - Total de parcelas pendentes/atrasadas: ${installments?.length || 0}
    - Parcelas em atraso: ${overdueCount}
    - Valor total em atraso: R$ ${totalOverdue.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
    
    Detalhes das parcelas:
    ${installments?.map(i => `- Parcela #${i.installment_number}: R$ ${Number(i.amount).toFixed(2)} (Vencimento: ${new Date(i.due_date).toLocaleDateString("pt-BR")})`).join("\n")}

    Regras de Negociação:
    1. Seja empático, educado, mas firme quanto à necessidade de regularização.
    2. Você pode oferecer as seguintes opções se o cliente demonstrar dificuldade:
       - Pagamento imediato pelo valor exibido no portal.
       - Pedido de desconto, parcelamento ou mudança de vencimento deve ser registrado como proposta sujeita à aprovação manual do credor.
       - Pagamento parcial de pelo menos uma parcela para evitar negativação.
    3. Se o cliente aceitar pagar agora, reforce que ele pode usar a chave PIX: ${client.profiles?.pix_key || "Disponível no portal"}.
    4. Se ele fizer uma proposta fora dessas regras, diga que vai encaminhar para o setor financeiro e eles entrarão em contato em até 24h.
    5. Mantenha as respostas curtas e objetivas.
    
    Objetivo: Converter a dívida em uma promessa de pagamento ou pagamento imediato via PIX.`;

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": anthropicKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-5-20250929",
        max_tokens: 1024,
        temperature: 0.7,
        system: systemPrompt,
        messages,
        stream: true,
      }),
    });

    if (!response.ok) {
      console.error("[client-negotiation] provedor indisponível", response.status);
      return new Response(JSON.stringify({ error: "Assistente temporariamente indisponível" }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Re-encoda SSE da Anthropic para formato OpenAI-style esperado pelo frontend
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
                  const chunk = { choices: [{ delta: { content: evt.delta.text } }] };
                  controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
                } else if (evt.type === "message_stop") {
                  controller.enqueue(encoder.encode("data: [DONE]\n\n"));
                }
              } catch {}
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
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : "erro" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
