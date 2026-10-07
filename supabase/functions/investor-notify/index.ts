import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.117.2";
import { checkSharedSecret } from "../_shared/guard.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const brl = (n: number) =>
  (Number(n) || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const fmtDate = (s: string) => new Date(s + "T12:00:00").toLocaleDateString("pt-BR");

async function sendEmail(to: string, name: string, subject: string, html: string) {
  const key = Deno.env.get("BREVO_API_KEY");
  if (!key) return { ok: false, error: "no BREVO_API_KEY" };
  const r = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: { "api-key": key, "Content-Type": "application/json", accept: "application/json" },
    body: JSON.stringify({
      sender: { name: "CredMais", email: "noreply@credmais.app" },
      to: [{ email: to, name }],
      subject,
      htmlContent: html,
    }),
  });
  return { ok: r.ok, status: r.status };
}

function buildEmail(kind: "upcoming" | "paid" | "settled", args: any) {
  const base = `
    <div style="font-family:Inter,system-ui,sans-serif;max-width:560px;margin:auto;background:#0f172a;color:#e5e7eb;padding:32px;border-radius:16px">
      <div style="font-size:11px;letter-spacing:2px;color:#818cf8;text-transform:uppercase">Portal do Investidor</div>
      <h1 style="font-size:22px;margin:8px 0 4px 0;color:#fff">${args.title}</h1>
      <p style="color:#94a3b8;font-size:14px;margin:0 0 20px">Olá <b style="color:#fff">${args.investor}</b>,</p>
      <div style="background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:12px;padding:16px">
        ${args.body}
      </div>
      ${args.link ? `<a href="${args.link}" style="display:inline-block;margin-top:20px;background:#4f46e5;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:600">Acessar meu portal</a>` : ""}
      <p style="color:#64748b;font-size:11px;margin-top:24px">Este é um aviso automático de ${args.creditor}.</p>
    </div>`;
  return base;
}

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
    const isoIn = (days: number) => {
      const d = new Date(now);
      d.setDate(d.getDate() + days);
      return d.toISOString().slice(0, 10);
    };
    const today = isoIn(0);
    const in3 = isoIn(3);
    const yesterday = isoIn(-1);
    const yesterdayStart = new Date(now); yesterdayStart.setDate(yesterdayStart.getDate() - 1); yesterdayStart.setHours(0, 0, 0, 0);

    const notified: string[] = [];
    const errors: string[] = [];

    // 1) Empréstimos vencendo em 3 dias
    const { data: upcoming } = await supabase
      .from("investor_loans")
      .select("id, user_id, investor_id, principal, total_due, paid_amount, due_date, access_token:investors(access_token,name,email), investors(name,email,access_token)")
      .eq("due_date", in3)
      .neq("status", "paid");

    // 2) Empréstimos quitados nas últimas 24h
    const { data: settled } = await supabase
      .from("investor_loans")
      .select("id, user_id, investor_id, principal, total_due, paid_at, investors(name,email,access_token)")
      .eq("status", "paid")
      .gte("paid_at", yesterdayStart.toISOString());

    // 3) Pagamentos registrados nas últimas 24h
    const { data: payments } = await supabase
      .from("investor_payments")
      .select("id, user_id, loan_id, amount, paid_at, method, investor_id, investors(name,email,access_token), investor_loans(total_due,paid_amount,due_date)")
      .gte("created_at", yesterdayStart.toISOString());

    // Cache settings por user
    const settingsCache = new Map<string, any>();
    const getBrand = async (uid: string) => {
      if (settingsCache.has(uid)) return settingsCache.get(uid);
      const { data } = await supabase
        .from("settings")
        .select("company_name, portal_title")
        .eq("user_id", uid)
        .maybeSingle();
      const s = data || {};
      settingsCache.set(uid, s);
      return s;
    };
    const linkFor = (token: string | null) =>
      token ? `${Deno.env.get("SITE_URL") || "https://credmais.app"}/investidor/${token}` : "";

    // Processa upcoming
    for (const l of (upcoming as any[]) || []) {
      const inv = l.investors;
      if (!inv?.email) continue;
      const brand = await getBrand(l.user_id);
      const creditor = brand.company_name || brand.portal_title || "seu credor";
      const html = buildEmail("upcoming", {
        title: "Vencimento próximo — 3 dias",
        investor: inv.name,
        creditor,
        link: linkFor(inv.access_token),
        body: `
          <p style="margin:0 0 8px;color:#e5e7eb;font-size:14px">O contrato vence em <b>${fmtDate(l.due_date)}</b>.</p>
          <div style="display:flex;justify-content:space-between;margin-top:12px;color:#94a3b8;font-size:12px">
            <div>Total a receber<br><b style="color:#a5b4fc;font-size:16px">${brl(Number(l.total_due) - Number(l.paid_amount))}</b></div>
            <div>Capital<br><b style="color:#fff;font-size:16px">${brl(l.principal)}</b></div>
          </div>`,
      });
      const r = await sendEmail(inv.email, inv.name, `Vencimento em 3 dias — ${creditor}`, html);
      r.ok ? notified.push(`upcoming:${l.id}`) : errors.push(`upcoming:${l.id}`);
    }

    // Processa payments
    for (const p of (payments as any[]) || []) {
      const inv = p.investors;
      if (!inv?.email) continue;
      const brand = await getBrand(p.user_id);
      const creditor = brand.company_name || brand.portal_title || "seu credor";
      const loan = p.investor_loans || {};
      const saldo = Number(loan.total_due || 0) - Number(loan.paid_amount || 0);
      const html = buildEmail("paid", {
        title: "Novo pagamento recebido",
        investor: inv.name,
        creditor,
        link: linkFor(inv.access_token),
        body: `
          <p style="margin:0 0 8px;color:#e5e7eb;font-size:14px">${creditor} registrou um pagamento em seu favor.</p>
          <div style="display:flex;justify-content:space-between;margin-top:12px;color:#94a3b8;font-size:12px">
            <div>Valor pago<br><b style="color:#34d399;font-size:16px">${brl(p.amount)}</b></div>
            <div>Saldo restante<br><b style="color:#fff;font-size:16px">${brl(saldo)}</b></div>
          </div>`,
      });
      const r = await sendEmail(inv.email, inv.name, `Pagamento recebido — ${brl(p.amount)}`, html);
      r.ok ? notified.push(`paid:${p.id}`) : errors.push(`paid:${p.id}`);
    }

    // Processa settled
    for (const l of (settled as any[]) || []) {
      const inv = l.investors;
      if (!inv?.email) continue;
      const brand = await getBrand(l.user_id);
      const creditor = brand.company_name || brand.portal_title || "seu credor";
      const html = buildEmail("settled", {
        title: "Contrato quitado ✓",
        investor: inv.name,
        creditor,
        link: linkFor(inv.access_token),
        body: `<p style="margin:0;color:#e5e7eb;font-size:14px">Seu contrato foi <b style="color:#34d399">totalmente quitado</b>. Valor total recebido: <b>${brl(l.total_due)}</b>.</p>`,
      });
      const r = await sendEmail(inv.email, inv.name, `Contrato quitado — ${creditor}`, html);
      r.ok ? notified.push(`settled:${l.id}`) : errors.push(`settled:${l.id}`);
    }

    return new Response(
      JSON.stringify({ ok: true, notified: notified.length, errors: errors.length, today, in3 }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e: any) {
    return new Response(JSON.stringify({ ok: false, error: e.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
