import { createClient } from "https://esm.sh/@supabase/supabase-js@2.117.2";

export type EntitlementResult =
  | { ok: true; tier: string }
  | { ok: false; status: 402 | 403 | 429 | 503; error: string; retryAfterMs?: number };

/** Server-side subscription, plan and cost gate for authenticated functions. */
export async function enforceEntitlement(
  userId: string,
  feature: string,
  options: { completeOnly?: boolean; capacity?: number; windowSeconds?: number } = {},
): Promise<EntitlementResult> {
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const url = Deno.env.get("SUPABASE_URL");
  if (!serviceKey || !url) return { ok: false, status: 403, error: "entitlement_unavailable" };

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const { data: profile, error } = await admin
    .from("profiles")
    .select("is_admin,is_blocked,plan_tier,subscription_type,trial_ends_at,subscription_expires_at")
    .eq("id", userId)
    .maybeSingle();
  if (error || !profile || profile.is_blocked) return { ok: false, status: 403, error: "account_blocked" };

  const now = Date.now();
  const lifetimeActive = profile.subscription_type === "lifetime";
  const trialActive = !!profile.trial_ends_at && new Date(profile.trial_ends_at).getTime() > now;
  const subscriptionActive = !!profile.subscription_expires_at && new Date(profile.subscription_expires_at).getTime() > now;
  if (!profile.is_admin && !lifetimeActive && !trialActive && !subscriptionActive) {
    const { data: subscription } = await admin.from("subscriptions")
      .select("status,updated_at")
      .eq("user_id", userId)
      .eq("status", "active")
      .gte("updated_at", new Date(now - 35 * 86400000).toISOString())
      .limit(1)
      .maybeSingle();
    if (!subscription) return { ok: false, status: 402, error: "subscription_required" };
  }

  const tier = profile.plan_tier || "essencial";
  if (options.completeOnly && !profile.is_admin && !trialActive && tier !== "completo") {
    return { ok: false, status: 403, error: "complete_plan_required" };
  }

  const capacity = Math.max(1, options.capacity ?? 30);
  const windowSeconds = Math.max(60, options.windowSeconds ?? 3600);
  try {
    const { data: limit, error } = await admin.rpc("try_consume_rate_limit", {
      _key: `user:${userId}:${feature}`,
      _capacity: capacity,
      _refill_per_sec: capacity / windowSeconds,
    }).abortSignal(AbortSignal.timeout(10_000));
    // A missing/invalid quota is an unavailable cost gate, never permission to
    // contact the paid provider. Do not fall back to a per-process counter.
    if(error || !limit || typeof limit.allowed!=='boolean' || !Number.isFinite(limit.remaining) || limit.remaining<0
      || !Number.isFinite(limit.retry_after_ms) || limit.retry_after_ms<0 || (!limit.allowed&&limit.retry_after_ms===0)) {
      return {ok:false,status:503,error:'entitlement_unavailable'};
    }
    if (!limit.allowed) {
      return { ok: false, status: 429, error: "rate_limit_exceeded", retryAfterMs: limit.retry_after_ms };
    }
  } catch {
    return {ok:false,status:503,error:'entitlement_unavailable'};
  }
  return { ok: true, tier };
}

export function entitlementResponse(
  result: Exclude<EntitlementResult, { ok: true }>,
  corsHeaders: Record<string, string>,
) {
  return new Response(JSON.stringify({ error: result.error, retry_after_ms: result.retryAfterMs }), {
    status: result.status,
    headers: { ...corsHeaders, "Content-Type": "application/json", ...(result.retryAfterMs?{'Retry-After':String(Math.max(1,Math.ceil(result.retryAfterMs/1000)))}:{}) },
  });
}
