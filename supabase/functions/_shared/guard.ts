// Helpers de autenticação/autorização compartilhados entre edge functions.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.117.2";

/** Comparação de strings em tempo constante (evita timing side-channel em segredos). */
export function timingSafeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const ba = enc.encode(a);
  const bb = enc.encode(b);
  if (ba.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < ba.length; i++) diff |= ba[i] ^ bb[i];
  return diff === 0;
}

/**
 * Autentica o chamador pelo JWT do Supabase (header Authorization).
 * Retorna o usuário autenticado ou null. NÃO aceita a anon key sozinha como usuário
 * (getUser só resolve um usuário real logado).
 */
export async function getCallerUser(req: Request) {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return null;
  const url = Deno.env.get("SUPABASE_URL")!;
  const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
  const client = createClient(url, anon, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data } = await client.auth.getUser();
  return data?.user ?? null;
}

/**
 * Gate por segredo compartilhado (cron/webhook interno). Fecha por padrão:
 * se o env `envName` NÃO estiver configurado, a requisição é negada.
 * O segredo pode vir no header (default `x-cron-secret`) ou no query `?secret=`.
 */
export function checkSharedSecret(req: Request, envName: string, headerName = "x-cron-secret"): boolean {
  const expected = Deno.env.get(envName);
  if (!expected) {
    console.error(`[guard] ${envName} não configurado — requisição negada`);
    return false;
  }
  const url = new URL(req.url);
  const provided = req.headers.get(headerName) ?? url.searchParams.get("secret") ?? "";
  return timingSafeEqual(provided, expected);
}

/**
 * Autentica o chamador E exige que ele seja admin da PLATAFORMA.
 * A checagem usa a função `is_admin()` do banco (user_roles → profiles.is_admin),
 * a mesma fonte de verdade usada pelo front e pelas policies de RLS.
 * Retorna o usuário quando for admin; caso contrário, null.
 */
export async function getPlatformAdminUser(req: Request) {
  const user = await getCallerUser(req);
  if (!user) return null;

  const url = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!serviceKey) {
    console.error("[guard] SUPABASE_SERVICE_ROLE_KEY ausente — negando por segurança");
    return null;
  }

  const admin = createClient(url, serviceKey);
  const { data, error } = await admin.rpc("is_admin", { _user_id: user.id });
  if (error) {
    console.error("[guard] is_admin falhou:", error.message);
    return null;
  }
  return data === true ? user : null;
}

export const unauthorized = (corsHeaders: Record<string, string>) =>
  new Response(JSON.stringify({ error: "unauthorized" }), {
    status: 401,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
