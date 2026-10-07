import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.117.2";
import { checkSharedSecret } from "../_shared/guard.ts";

const DEFAULT_DAILY_LATE_RATE = 4; // % ao dia (juros composto)

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  // SEGURANÇA (M4): cron protegido por segredo obrigatório.
  if (!checkSharedSecret(req, "CRON_SECRET")) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    const now = new Date();
    const todayStr = now.toISOString().split("T")[0];

    // Todas as parcelas ainda não pagas/canceladas cujo vencimento já passou.
    // Cobre TODOS os tipos de empréstimo (installments, percentage, etc.) — todos
    // gravam suas parcelas na mesma tabela contract_installments.
    const { data: overdueInstallments, error: fetchErr } = await supabase
      .from("contract_installments")
      .select("id, amount, paid_amount, due_date, late_fee, contract_id, user_id, client_id, installment_number, status")
      .not("status", "in", "(paid,cancelled)")
      .lt("due_date", todayStr);

    if (fetchErr) {
      throw new Error(`Erro ao buscar parcelas: ${fetchErr.message}`);
    }

    if (!overdueInstallments || overdueInstallments.length === 0) {
      return new Response(JSON.stringify({ message: "Nenhuma parcela atrasada encontrada", updated: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Configuração por contrato (multa e juros diários)
    const contractIds = [...new Set(overdueInstallments.map((i) => i.contract_id))];
    const { data: contracts } = await supabase
      .from("contracts")
      .select("id, user_id, status, loan_mode, late_fee_percent, daily_interest_percent, max_interest_cap_percent, daily_penalty_type, daily_penalty_value")
      .in("id", contractIds);

    // `max_interest_cap_percent` vinha na consulta acima e era JOGADO FORA aqui:
    // o mapa não carregava o campo, então lá embaixo `config.max_interest_cap_percent`
    // era sempre `undefined`, `Number(undefined)` virava NaN e o `isFinite` derrubava
    // a checagem. O teto continuava sem limitar nada, mesmo depois de alguém já ter
    // escrito o código que o aplica — a correção parou no meio do caminho.
    const contractMap = new Map<string, {
      user_id: string;
      status: string | null;
      loan_mode: string | null;
      late_fee_percent: number;
      daily_interest_percent: number;
      max_interest_cap_percent: number | null;
      daily_penalty_type: "percentage" | "fixed";
      daily_penalty_value: number;
    }>();
    for (const c of contracts || []) {
      contractMap.set(c.id, {
        user_id: c.user_id,
        status: c.status,
        loan_mode: c.loan_mode,
        late_fee_percent: Number(c.late_fee_percent) || 0,
        daily_interest_percent: Number(c.daily_interest_percent) || 0,
        max_interest_cap_percent: c.max_interest_cap_percent === null || c.max_interest_cap_percent === undefined
          ? null
          : Number(c.max_interest_cap_percent),
        daily_penalty_type: c.daily_penalty_type === "fixed" ? "fixed" : "percentage",
        daily_penalty_value: Math.max(0, Number(c.daily_penalty_value) || 0),
      });
    }

    // Fallback global do credor: settings.default_late_fee / default_daily_interest.
    // Garante que mesmo contratos antigos (sem multa configurada) apliquem a política padrão.
    const userIds = [...new Set((contracts || []).map((c) => c.user_id))];
    const { data: settingsRows } = await supabase
      .from("settings")
      .select("user_id, default_late_fee, default_daily_interest")
      .in("user_id", userIds);
    const settingsMap = new Map<string, { late_fee: number; daily_interest: number }>();
    for (const s of settingsRows || []) {
      settingsMap.set(s.user_id, {
        late_fee: Number(s.default_late_fee) || 0,
        daily_interest: Number(s.default_daily_interest) || 0,
      });
    }

    let feesUpdated = 0;
    let statusUpdated = 0;
    const errors: string[] = [];
    const clientNotifications: Array<Record<string, unknown>> = [];

    for (const inst of overdueInstallments) {
      const config = contractMap.get(inst.contract_id);
      if (!config) continue;
      if (["completed", "cancelled"].includes(String(config.status || "").toLowerCase())) continue;

      const outstanding = Math.max(0, Number(inst.amount || 0) - Number(inst.paid_amount || 0));
      if (outstanding <= 0.009) continue;

      const dueDate = new Date(inst.due_date);
      const daysOverdue = Math.floor((now.getTime() - dueDate.getTime()) / (1000 * 60 * 60 * 24));
      if (daysOverdue <= 0) continue;

      const baseAmount = outstanding;

      // POLÍTICA ÚNICA: juros diário COMPOSTO (padrão 4% a.d.).
      // Não existe mais multa fixa/mensal. O percentual incide sobre o valor
      // acumulado: 100 -> 104 -> 108,16 -> 112,49 ...
      const defaults = settingsMap.get(config.user_id) || { late_fee: 0, daily_interest: 0 };
      // Juros diário composto SEMPRE soma com a multa diária configurada — a
      // mesma política de src/lib/lateFee.ts (computeLateFee) e da RPC
      // pay_installment. Uma versão anterior zerava o juros quando havia
      // multa configurada, tratando-os como mutuamente exclusivos; isso
      // deixava esse job (usado pelo bot/lembretes) subestimar o encargo
      // real que pay_installment exige no pagamento, e o cliente pagava
      // exatamente o que foi cobrado por aqui só para a baixa falhar de novo.
      const dailyPct = config.daily_interest_percent > 0
        ? config.daily_interest_percent
        : (defaults.daily_interest > 0 ? defaults.daily_interest : DEFAULT_DAILY_LATE_RATE);
      const lateFeePct = 0;

      let totalLateFee = Math.round(
        baseAmount * (Math.pow(1 + dailyPct / 100, daysOverdue) - 1) * 100,
      ) / 100;

      const dailyPenalty = config.daily_penalty_type === "fixed"
        ? config.daily_penalty_value * daysOverdue
        : baseAmount * (config.daily_penalty_value / 100) * daysOverdue;
      totalLateFee = Math.round((totalLateFee + dailyPenalty) * 100) / 100;

      // Teto de juros definido no contrato (% sobre o valor da parcela).
      // O campo existia no cadastro do empréstimo desde sempre, era gravado no
      // banco e nunca lido por ninguém: o operador definia um limite que não
      // limitava nada. Com 4% ao dia composto, sem teto a dívida não para de
      // crescer — em 60 dias os juros passam de 9x a parcela.
      const capPct = Number(config.max_interest_cap_percent);
      if (Number.isFinite(capPct) && capPct > 0) {
        const teto = Math.round(baseAmount * (capPct / 100) * 100) / 100;
        totalLateFee = Math.min(totalLateFee, teto);
      }

      const patch: Record<string, unknown> = {};
      const currentFee = Number(inst.late_fee) || 0;
      if (Math.abs(totalLateFee - currentFee) >= 0.01 && (lateFeePct > 0 || dailyPct > 0)) {
        patch.late_fee = totalLateFee;
      }
      // Marca a parcela como overdue automaticamente se ainda estiver pendente.
      if (inst.status === "pending") {
        patch.status = "overdue";
      }

      if (Object.keys(patch).length === 0) continue;

      const { error: updateErr } = await supabase
        .from("contract_installments")
        .update(patch)
        .eq("id", inst.id);

      if (updateErr) {
        errors.push(`Parcela ${inst.id}: ${updateErr.message}`);
        continue;
      }

      if (patch.late_fee !== undefined) feesUpdated++;
      if (patch.status !== undefined) statusUpdated++;

      // Prepara notificação para o cliente
      const totalDue = Math.round((baseAmount + totalLateFee) * 100) / 100;
      const fmt = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

      if (patch.status === "overdue") {
        clientNotifications.push({
          client_id: inst.client_id,
          user_id: config.user_id,
          contract_id: inst.contract_id,
          installment_id: inst.id,
          type: "installment_overdue",
          title: `Parcela ${inst.installment_number} em atraso`,
          message: `Sua parcela ${inst.installment_number} de ${fmt(baseAmount)} venceu em ${inst.due_date}. Regularize para evitar aumento de juros.`,
          metadata: {
            installment_number: inst.installment_number,
            amount: baseAmount,
            due_date: inst.due_date,
            days_overdue: daysOverdue,
            late_fee: totalLateFee,
            total_due: totalDue,
          },
        });
      } else if (patch.late_fee !== undefined) {
        clientNotifications.push({
          client_id: inst.client_id,
          user_id: config.user_id,
          contract_id: inst.contract_id,
          installment_id: inst.id,
          type: "late_fee_updated",
          title: `Multa/juros atualizados — parcela ${inst.installment_number}`,
          message: `Sua parcela ${inst.installment_number} está com ${daysOverdue} dia(s) de atraso. Multa + juros: ${fmt(totalLateFee)}. Total atual: ${fmt(totalDue)}.`,
          metadata: {
            installment_number: inst.installment_number,
            amount: baseAmount,
            due_date: inst.due_date,
            days_overdue: daysOverdue,
            late_fee: totalLateFee,
            previous_late_fee: currentFee,
            total_due: totalDue,
          },
        });
      }
    }

    // Grava notificações do cliente (dedupe diária via índice único)
    let clientNotifsInserted = 0;
    if (clientNotifications.length > 0) {
      const { error: notifErr, count } = await supabase
        .from("client_notifications")
        .upsert(clientNotifications, {
          onConflict: "installment_id,type,dedupe_day",
          ignoreDuplicates: true,
          count: "exact",
        });
      if (notifErr) {
        errors.push(`Notificações cliente: ${notifErr.message}`);
      } else {
        clientNotifsInserted = count || clientNotifications.length;
      }
    }

    // Notifica cada credor 1x por dia sobre as multas atualizadas
    const affectedUsers = [...new Set(overdueInstallments.map((i) => i.user_id))];
    for (const userId of affectedUsers) {
      const { data: existing } = await supabase
        .from("notifications")
        .select("id")
        .eq("user_id", userId)
        .eq("type", "late_fees_auto")
        .gte("created_at", `${todayStr}T00:00:00Z`)
        .limit(1);
      if (existing && existing.length > 0) continue;

      const userOverdue = overdueInstallments.filter((i) => i.user_id === userId);
      if (userOverdue.length === 0) continue;

      await supabase.from("notifications").insert({
        user_id: userId,
        message: `Multas e juros atualizados automaticamente em ${userOverdue.length} parcela(s) atrasada(s).`,
        type: "late_fees_auto",
        from: "Automação",
        link: "/cobrancas",
      });
    }

    return new Response(
      JSON.stringify({
        message: `Multas: ${feesUpdated} atualizadas · ${statusUpdated} marcadas como atrasadas · ${clientNotifsInserted} notificações ao cliente`,
        fees_updated: feesUpdated,
        status_updated: statusUpdated,
        client_notifications: clientNotifsInserted,
        total_overdue: overdueInstallments.length,
        errors: errors.length > 0 ? errors : undefined,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("auto-late-fees error:", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Erro interno" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
