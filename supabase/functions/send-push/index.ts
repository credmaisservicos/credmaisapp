// Envia um Web Push de verdade (chega mesmo com o navegador fechado) pra
// cada inscrição salva do usuário dono da notificação. Chamado pelo gatilho
// `notifications_push_on_insert` (ver 20260922140000_web_push_notifications.sql)
// a cada INSERT em `public.notifications` — não é invocado direto pelo app.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.117.2";
// `web-push` é um pacote CJS; os tipos publicados no esm.sh não declaram
// `export default`, embora o módulo em runtime exponha um. Import de
// namespace evita o erro de tipo TS1192 sem perder o valor em runtime.
import * as webpushModule from "https://esm.sh/web-push@3.6.7";
import { checkSharedSecret } from "../_shared/guard.ts";

const webpush = (webpushModule as any).default ?? webpushModule;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  // Só o gatilho do banco (ou um cron) chama esta function — nunca o app
  // direto, que não tem (e não deve ter) o segredo interno.
  if (!checkSharedSecret(req, "PUSH_INTERNAL_SECRET")) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const vapidPublic = Deno.env.get("VAPID_PUBLIC_KEY");
    const vapidPrivate = Deno.env.get("VAPID_PRIVATE_KEY");
    const vapidSubject = Deno.env.get("VAPID_SUBJECT") || "mailto:credmaisapp@gmail.com";
    if (!vapidPublic || !vapidPrivate) {
      // Chaves ainda não configuradas neste ambiente: não é erro do chamador,
      // só não há como assinar o push. Sai quieto (a notificação em si já foi
      // gravada pelo INSERT que disparou este gatilho).
      return new Response(JSON.stringify({ skipped: "vapid_not_configured" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    webpush.setVapidDetails(vapidSubject, vapidPublic, vapidPrivate);

    const body = await req.json();
    const userId = body?.user_id as string | undefined;
    if (!userId) {
      return new Response(JSON.stringify({ error: "user_id_required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: settingsRow } = await supabase
      .from("settings")
      .select("push_notifications_enabled")
      .eq("user_id", userId)
      .maybeSingle();
    if (!settingsRow?.push_notifications_enabled) {
      return new Response(JSON.stringify({ skipped: "push_disabled" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: subs, error: subsError } = await supabase
      .from("push_subscriptions")
      .select("id, endpoint, p256dh, auth")
      .eq("user_id", userId);
    if (subsError) throw subsError;
    if (!subs || subs.length === 0) {
      return new Response(JSON.stringify({ skipped: "no_subscriptions" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const payload = JSON.stringify({
      title: body?.from || "CredMais",
      body: body?.message || "",
      link: body?.link || "/notificacoes",
      tag: body?.notification_id || undefined,
    });

    const results = await Promise.allSettled(
      subs.map((sub) =>
        webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          payload,
        ).catch((err: any) => {
          // 404/410 = o navegador cancelou essa inscrição (desinstalou o app,
          // trocou de dispositivo, etc.) — não é falha nossa, é limpeza normal.
          if (err?.statusCode === 404 || err?.statusCode === 410) {
            return supabase.from("push_subscriptions").delete().eq("id", sub.id)
              .then(() => { throw { expired: true, id: sub.id }; });
          }
          throw err;
        })
      ),
    );

    const sent = results.filter((r) => r.status === "fulfilled").length;
    const expired = results.filter((r) => r.status === "rejected" && (r as any).reason?.expired).length;
    const failed = results.length - sent - expired;

    return new Response(JSON.stringify({ ok: true, sent, expired, failed }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[send-push] erro:", err);
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : "erro" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
