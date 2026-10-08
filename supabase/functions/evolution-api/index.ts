import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4";
import { enforceEntitlement, entitlementResponse } from "../_shared/entitlement.ts";
import { guard as rateLimitGuard } from "../_shared/rate_limit.ts";
import { testRecipientScope } from "../_shared/bot_test_scope.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const isPrivateHost = (hostname: string) => {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host === "::1" || host.startsWith("fe80:") || host.startsWith("fc") || host.startsWith("fd")) return true;
  const parts = host.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  const [a, b] = parts;
  return a === 0 || a === 10 || a === 127 || a >= 224
    || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168);
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    // Sem o header, o `!` mentia e o `.replace` estourava: a resposta virava um
    // 500 com "Cannot read properties of null", que não diz nada a quem chamou e
    // ainda parece falha do servidor. Falta de credencial é 401.
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const { data: { user }, error: authError } = await supabaseClient.auth.getUser(
      authHeader.replace("Bearer ", "")
    );

    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const entitlement = await enforceEntitlement(user.id, "evolution-api", { capacity: 120, windowSeconds: 60 });
    if (!entitlement.ok) return entitlementResponse(entitlement, corsHeaders);

    const rateLimited = await rateLimitGuard(req, `evolution-api:${user.id}`, 120, 2, corsHeaders);
    if (rateLimited) return rateLimited;

    const reqBody = await req.json();
    const { action, instanceName } = reqBody;
    const allowedActions = new Set([
      "createInstance", "update_settings", "getInstance", "check_status", "connectInstance", "get_qr",
      "logoutInstance", "logout", "deleteInstance", "delete", "find_chats", "fetch_messages", "find_messages", "send_message", "setWebhook",
    ]);
    if (typeof action !== "string" || !allowedActions.has(action)) {
      return new Response(JSON.stringify({ error: "Invalid action" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    if (typeof instanceName !== "string" || !/^[A-Za-z0-9_-]{1,80}$/.test(instanceName)) {
      return new Response(JSON.stringify({ error: "Invalid instance" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    // Accept payload either nested under `data` or flat at the top level
    const data = (reqBody?.data && typeof reqBody.data === "object") ? { ...reqBody, ...reqBody.data } : reqBody;

    if (action === 'send_message' && testRecipientScope(user.id,String(data.phone || '')) === false) {
      return new Response(JSON.stringify({error:'test_recipient_blocked'}),{status:403,headers:{...corsHeaders,'Content-Type':'application/json'}});
    }

    const { data: settings, error: settingsError } = await supabaseClient
      .from("settings")
      .select("whatsapp_api_url, whatsapp_api_key, whatsapp_instance")
      .eq("user_id", user.id)
      .single();

    if (settingsError || !settings?.whatsapp_api_url || !settings?.whatsapp_api_key) {
      return new Response(JSON.stringify({ error: "WhatsApp settings not found" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Multi-instância: cada usuário só pode operar a instância principal dele ou
    // uma instância adicional explicitamente cadastrada em whatsapp_instances.
    // Sem essa checagem, bastava conhecer o nome de outra instância no mesmo
    // servidor Evolution para consultar conversas ou enviar mensagens por ela.
    const { data: extraInstance } = await supabaseClient
      .from("whatsapp_instances")
      .select("instance, api_url, api_key, is_active")
      .eq("user_id", user.id)
      .eq("instance", instanceName)
      .eq("is_active", true)
      .maybeSingle();

    const isPrimary = settings.whatsapp_instance === instanceName;
    if (!isPrimary && !extraInstance) {
      return new Response(JSON.stringify({ error: "Instance does not belong to this user" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const resolvedApiUrl = extraInstance?.api_url || settings.whatsapp_api_url;
    const resolvedApiKey = extraInstance?.api_key || settings.whatsapp_api_key;
    const baseUrl = resolvedApiUrl.endsWith("/")
      ? resolvedApiUrl.slice(0, -1)
      : resolvedApiUrl;
    let parsedBaseUrl: URL;
    try {
      parsedBaseUrl = new URL(baseUrl);
      if (parsedBaseUrl.protocol !== "https:" || parsedBaseUrl.username || parsedBaseUrl.password || isPrivateHost(parsedBaseUrl.hostname)) throw new Error("invalid");
    } catch {
      return new Response(JSON.stringify({ error: "Invalid WhatsApp API URL" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const safeInstance = encodeURIComponent(instanceName);
    
    const apiKey = resolvedApiKey;

    let response;
    let endpoint = "";

    switch (action) {
      case "createInstance":
        endpoint = `${baseUrl}/instance/create`;
        response = await fetch(endpoint, {
          method: "POST",
          signal: AbortSignal.timeout(15_000),
          headers: {
            "Content-Type": "application/json",
            "apikey": apiKey
          },
          body: JSON.stringify({
            instanceName: instanceName,
            token: user.id.split("-")[0],
            qrcode: true,
            integration: "WHATSAPP-BAILEYS",
            syncFullHistory: true,
            alwaysOnline: true
          })
        });
        break;

      case "update_settings":
        endpoint = `${baseUrl}/settings/set/${safeInstance}`;
        response = await fetch(endpoint, {
          method: "POST",
          signal: AbortSignal.timeout(15_000),
          headers: { "Content-Type": "application/json", "apikey": apiKey },
          body: JSON.stringify({
            rejectCall: false,
            groupsIgnore: false,
            alwaysOnline: true,
            readMessages: false,
            readStatus: false,
            syncFullHistory: true
          })
        });
        break;

      case "getInstance":
      case "check_status": // Alias
        endpoint = `${baseUrl}/instance/fetchInstances?instanceName=${safeInstance}`;
        response = await fetch(endpoint, {
          method: "GET",
          signal: AbortSignal.timeout(15_000),
          headers: { "apikey": apiKey }
        });
        break;

      case "connectInstance":
      case "get_qr": // Alias
        endpoint = `${baseUrl}/instance/connect/${safeInstance}`;
        response = await fetch(endpoint, {
          method: "GET",
          signal: AbortSignal.timeout(15_000),
          headers: { "apikey": apiKey }
        });
        break;

      case "logoutInstance":
      case "logout": // Alias
        endpoint = `${baseUrl}/instance/logout/${safeInstance}`;
        response = await fetch(endpoint, {
          method: "DELETE",
          signal: AbortSignal.timeout(15_000),
          headers: { "apikey": apiKey }
        });
        break;

      case "find_chats":
        endpoint = `${baseUrl}/chat/findChats/${safeInstance}`;
        response = await fetch(endpoint, {
          method: "POST",
          signal: AbortSignal.timeout(15_000),
          headers: { "Content-Type": "application/json", "apikey": apiKey },
          body: JSON.stringify({})
        });
        break;

      case "fetch_messages":
      case "find_messages":
        endpoint = `${baseUrl}/chat/findMessages/${safeInstance}`;
        response = await fetch(endpoint, {
          method: "POST",
          signal: AbortSignal.timeout(15_000),
          headers: {
            "Content-Type": "application/json",
            "apikey": apiKey
          },
          body: JSON.stringify({
            where: data?.remoteJid ? { key: { remoteJid: data.remoteJid } } : {},
            limit: data?.count || data?.limit || 50,
            page: data?.page || 1
          })
        });
        break;

      case "send_message":
        endpoint = `${baseUrl}/message/sendText/${safeInstance}`;
        response = await fetch(endpoint, {
          method: "POST",
          signal: AbortSignal.timeout(15_000),
          headers: {
            "Content-Type": "application/json",
            "apikey": apiKey
          },
          body: JSON.stringify({
            number: data.phone,
            text: data.message
          })
        });
        break;

      case "setWebhook":
        {
        const webhookSecret = Deno.env.get("EVOLUTION_WEBHOOK_SECRET") || "";
        const webhookUrl = new URL(String(data.url));
        if (webhookSecret) webhookUrl.searchParams.set("secret", webhookSecret);
        endpoint = `${baseUrl}/webhook/set/${safeInstance}`;
        response = await fetch(endpoint, {
          method: "POST",
          signal: AbortSignal.timeout(15_000),
          headers: {
            "Content-Type": "application/json",
            "apikey": apiKey
          },
          body: JSON.stringify({
            webhook: {
              url: webhookUrl.toString(),
              enabled: true,
              webhookByEvents: false,
              webhookBase64: true,
              events: [
                "MESSAGES_UPSERT",
                "MESSAGES_UPDATE",
                "SEND_MESSAGE",
                "CONNECTION_UPDATE"
              ]
            }
          })
        });
        break;
        }

      case "deleteInstance":
      case "delete": // Alias
        endpoint = `${baseUrl}/instance/delete/${safeInstance}`;
        response = await fetch(endpoint, {
          method: "DELETE",
          signal: AbortSignal.timeout(15_000),
          headers: { "apikey": apiKey }
        });
        break;

      default:
        return new Response(JSON.stringify({ error: "Invalid action" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
    }

    console.log(`[Evolution API] Action: ${action}, Status: ${response.status}`);
    const result = await response.json().catch(() => ({}));

    // Uma solicitação explícita de exclusão sempre libera o vínculo local.
    // A Evolution pode responder 404/5xx para uma sessão que já caiu; manter o
    // vínculo nesse caso impediria o usuário de conectar um novo número.
    if (action === "deleteInstance" || action === "delete") {
      if (isPrimary) {
        await supabaseClient
          .from("settings")
          .update({ whatsapp_instance: null })
          .eq("user_id", user.id)
          .eq("whatsapp_instance", instanceName);
      } else {
        await supabaseClient
          .from("whatsapp_instances")
          .delete()
          .eq("user_id", user.id)
          .eq("instance", instanceName);
      }
    }
    
    // Always return 200 to avoid runtime error overlays; embed upstream status in body.
    // Preserve array responses (e.g. find_chats / find_messages return raw arrays) by
    // wrapping them — `{...array}` would lose the array shape and become {0:..,1:..}.
    const isDeleteAction = action === "deleteInstance" || action === "delete";
    const effectiveUpstreamStatus = isDeleteAction ? 200 : response.status;
    const body = Array.isArray(result)
      ? { data: result, chats: result, messages: result, upstream_status: effectiveUpstreamStatus }
      : {
          ...result,
          upstream_status: effectiveUpstreamStatus,
          ...(isDeleteAction ? { deleted: true, evolution_status: response.status } : {}),
        };
    return new Response(JSON.stringify(body), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });

  } catch (error) {
    console.error("[evolution-api] request failed", error instanceof Error ? error.message : String(error));
    return new Response(JSON.stringify({ error: "Evolution request failed" }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
