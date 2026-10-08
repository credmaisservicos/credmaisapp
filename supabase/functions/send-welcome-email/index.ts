import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.117.2";
import { templates } from "../_shared/brevo.ts";
import { getCallerUser, checkSharedSecret } from "../_shared/guard.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-internal-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const response = (status: number, body: Record<string, unknown>, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json", ...headers } });
const validEmail = (value: unknown): value is string => typeof value === "string" && value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
const normalizeEmail = (email: string) => email.trim().toLowerCase();
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return response(405, { error: "method_not_allowed" }, { Allow: "POST, OPTIONS" });

  try {
    const internal = Boolean(Deno.env.get("INTERNAL_FN_SECRET")) && checkSharedSecret(req, "INTERNAL_FN_SECRET", "x-internal-secret");
    const caller = internal ? null : await getCallerUser(req);
    if (!internal && !caller) return response(401, { error: "unauthorized" });

    let body: Record<string, unknown>;
    try {
      const parsed = await req.json();
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
      body = parsed;
    } catch { return response(400, { error: "invalid_request" }); }

    const url = Deno.env.get("SUPABASE_URL");
    const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const emailKey = Deno.env.get("BREVO_API_KEY");
    if (!url || !key || !emailKey) return response(503, { error: "email_unavailable" });
    const admin = createClient(url, key, { auth: { persistSession: false }, global: {
      fetch: (input, init) => fetch(input, { ...init, signal: init?.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(15_000)]) : AbortSignal.timeout(15_000) }),
    } });

    // A JWT can only send to its own Auth identity. Internal callers may select
    // a registered account, but the destination still comes from Auth.
    let recipient = caller;
    if (internal) {
      let userId: string;
      if (typeof body.user_id === "string" && uuid.test(body.user_id)) userId = body.user_id;
      else if (body.user_id !== undefined) return response(400, { error: "invalid_recipient" });
      else {
        if (!validEmail(body.email)) return response(400, { error: "invalid_recipient" });
        // Compatibility with existing internal {email,name} requests. A profile
        // identifies the account; it cannot supply the final email address.
        const exactEmail = normalizeEmail(body.email).replace(/[\\%_]/g, char => `\\${char}`);
        const { data, error } = await admin.from("profiles").select("id").ilike("email", exactEmail).maybeSingle();
        if (error) return response(503, { error: "recipient_unavailable" });
        if (!data?.id) return response(404, { error: "recipient_not_found" });
        userId = data.id;
      }
      const { data, error } = await admin.auth.admin.getUserById(userId);
      if (error) return response(error.status === 404 ? 404 : 503, { error: error.status === 404 ? "recipient_not_found" : "recipient_unavailable" });
      recipient = data.user;
    } else if (body.user_id !== undefined && body.user_id !== caller!.id) {
      return response(403, { error: "recipient_forbidden" });
    }
    if (!recipient || !validEmail(recipient.email)) return response(400, { error: "invalid_recipient" });
    if (body.email !== undefined && (!validEmail(body.email) || normalizeEmail(body.email) !== normalizeEmail(recipient.email))) {
      return response(403, { error: "recipient_forbidden" });
    }

    // Consume before dispatch, including failed/uncertain provider attempts.
    // No memory fallback: a failed quota lookup must never permit an email.
    const { data: limit, error: limitError } = await admin.rpc("try_consume_rate_limit", {
      _key: `welcome-email:${recipient.id}`,
      _capacity: 1,
      _refill_per_sec: 1 / 86_400,
    });
    if (limitError || !limit || typeof limit.allowed !== "boolean") return response(503, { error: "email_limit_unavailable" });
    if (!limit.allowed) {
      const retry = typeof limit.retry_after_ms === "number" && Number.isFinite(limit.retry_after_ms) && limit.retry_after_ms > 0
        ? Math.min(86_400, Math.max(1, Math.ceil(limit.retry_after_ms / 1000))) : 86_400;
      return response(429, { error: "rate_limit_exceeded" }, { "Retry-After": String(retry) });
    }

    const metadataName = recipient.user_metadata?.name ?? recipient.user_metadata?.full_name;
    const name = typeof metadataName === "string" && metadataName.trim() ? metadataName.trim().slice(0, 200) : recipient.email;
    const template = templates.welcome(escapeHtml(name));
    try {
      const delivered = await fetch("https://api.brevo.com/v3/smtp/email", {
        method: "POST", signal: AbortSignal.timeout(20_000),
        headers: { "accept": "application/json", "api-key": emailKey, "content-type": "application/json" },
        body: JSON.stringify({
          sender: { name: Deno.env.get("EMAIL_SENDER_NAME") || "CredMais App", email: Deno.env.get("BREVO_SENDER_EMAIL") || "noreply@systemjuros.com.br" },
          to: [{ email: recipient.email, name }], subject: template.subject, htmlContent: template.html,
        }),
      });
      const acknowledgement = delivered.ok ? await delivered.json() : null;
      if (!delivered.ok || typeof acknowledgement?.messageId !== "string" || !acknowledgement.messageId.trim()) {
        return response(502, { error: "email_delivery_unconfirmed" });
      }
      return response(200, { success: true });
    } catch { return response(502, { error: "email_delivery_unconfirmed" }); }
  } catch { return response(503, { error: "email_unavailable" }); }
});
