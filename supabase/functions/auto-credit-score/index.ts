import { isEmAtraso, isEmAberto, venceHoje } from "../_shared/installmentStatus.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.117.2";
import { checkSharedSecret } from "../_shared/guard.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * Score preditivo 0-100 (probabilidade INVERSA de inadimplência):
 *  - Base 100
 *  - Peso das parcelas em atraso ATUALMENTE (mais recentes pesam mais)
 *  - Média de dias de atraso histórico
 *  - Bônus por pagamentos em dia
 *  - Penalidade extra se cliente tem tendência PIORANDO (últimas 5 mais atrasadas que anteriores)
 * Retorna também `default_risk` derivado ("baixo" | "medio" | "alto" | "critico").
 */
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

    const { data: clients } = await supabase.from("clients").select("id, user_id, credit_score");
    const now = Date.now();
    let updated = 0;

    for (const c of clients || []) {
      const { data: insts } = await supabase
        .from("contract_installments")
        .select("status, due_date, paid_at")
        .eq("client_id", c.id)
        .order("due_date", { ascending: false })
        .limit(40);

      if (!insts || insts.length === 0) continue;

      let score = 100;
      let onTime = 0;
      let lateDaysSum = 0;
      let lateCount = 0;
      const currentOverdue: number[] = [];
      const lateDaysRecent: number[] = [];
      const lateDaysOlder: number[] = [];

      insts.forEach((i, idx) => {
        const due = new Date(i.due_date).getTime();
        const isRecent = idx < 10;
        // Era `status === "pending" && vencida`, e o auto-late-fees das 03:00
        // já marcou as vencidas como "overdue" — o score não enxergava atraso
        // nenhum. Em 2026-08-05, 52 dos 67 clientes inadimplentes eram
        // invisíveis aqui e pontuavam 94/100 como se estivessem em dia.
        if (isEmAtraso(i, new Date(now))) {
          const days = Math.floor((now - due) / 86400000);
          currentOverdue.push(days);
          // Parcelas atrasadas mais recentes pesam mais (peso 8/5/3)
          const weight = idx < 3 ? 8 : idx < 10 ? 5 : 3;
          score -= weight;
          lateDaysSum += days;
          lateCount++;
          (isRecent ? lateDaysRecent : lateDaysOlder).push(days);
        } else if (i.status === "paid" && i.paid_at) {
          const paid = new Date(i.paid_at).getTime();
          if (paid <= due + 86400000) onTime++;
          else {
            const d = Math.floor((paid - due) / 86400000);
            lateDaysSum += d;
            lateCount++;
            (isRecent ? lateDaysRecent : lateDaysOlder).push(d);
          }
        }
      });

      // Média de dias de atraso (cap -30)
      if (lateCount > 0) score -= Math.min(30, Math.floor((lateDaysSum / lateCount) * 2));
      // Bônus por pagamentos em dia (cap +20)
      score += Math.min(20, onTime * 4);
      // Tendência: se média recente > média antiga em 5+ dias, penaliza -8
      if (lateDaysRecent.length >= 2 && lateDaysOlder.length >= 2) {
        const avgRec = lateDaysRecent.reduce((a, b) => a + b, 0) / lateDaysRecent.length;
        const avgOld = lateDaysOlder.reduce((a, b) => a + b, 0) / lateDaysOlder.length;
        if (avgRec - avgOld >= 5) score -= 8;
      }
      // Penalidade extra: 3+ parcelas em atraso hoje
      if (currentOverdue.length >= 3) score -= 10;

      score = Math.max(0, Math.min(100, score));

      const patch: Record<string, unknown> = {};
      if (score !== c.credit_score) patch.credit_score = score;

      if (Object.keys(patch).length) {
        await supabase.from("clients").update(patch).eq("id", c.id);
        updated++;
      }
    }

    return new Response(
      JSON.stringify({ message: `${updated} score(s) atualizado(s)`, updated, total: clients?.length || 0 }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Erro" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
