// Consulta pública do status de um pagamento no Mercado Pago
// Usada pelas telas de sucesso/pendente para fazer polling e mostrar estado real
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { guard as rateLimitGuard } from "../_shared/rate_limit.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  // A tela de status faz polling legítimo, mas o endpoint aceita qualquer id de
  // pagamento — sem freio, dá para varrer ids sequencialmente. Generoso o bastante
  // para o polling (1 req/s sustentado) e apertado para enumeração.
  const rl = await rateLimitGuard(req, "mp-status", 60, 1, corsHeaders);
  if (rl) return rl;

  let id: string | null = null;
  try {
    if (req.method === "POST") {
      const b = await req.json();
      id = b?.id ? String(b.id) : null;
    } else {
      id = new URL(req.url).searchParams.get("id");
    }
  } catch {
    return json({ error: "invalid_request" }, 400);
  }
  if (!id) return json({ error: "missing_id" }, 400);
  if (!/^\d{1,32}$/.test(id)) return json({ error: "invalid_id" }, 400);
  const token = Deno.env.get("MERCADOPAGO_ACCESS_TOKEN");
  if (!token) return json({ error: "payment_unavailable" }, 500);

  try {
    const res = await fetch(`https://api.mercadopago.com/v1/payments/${id}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(12_000),
    });
    const data = await res.json();
    if (!res.ok) return json({ error: "mp_error" }, 502);
    // SEGURANÇA (M2): endpoint é público (polling do checkout antes do login), então
    // NÃO retornamos payer_email — isso permitia enumerar IDs e vazar e-mails de
    // clientes. Devolvemos apenas o necessário para a tela de status.
    return json({ status: data.status });
  } catch {
    return json({ error: "status_unavailable" }, 502);
  }
});
