import { supabase } from "@/integrations/supabase/client";
import {rememberMeStorage,suspendAuthSession} from '@/integrations/supabase/remember';
import {tabSessionStorage} from './tabSessionStorage';
import {withTimeout} from './withTimeout';

// Portal session utilities — o portal do cliente é 100% separado do app do credor.
// Cliente do portal NUNCA deve conseguir acessar rotas do app principal.
const PORTAL_SESSION_KEY = "portal-cliente-session";
const PORTAL_ATTEMPTS_KEY = "portal-cliente-attempts";
let clientPortalActive=false;

export const isPortalRoute = (pathname: string): boolean => {
  const p = pathname.toLowerCase();
  return (
    p.startsWith("/portal-cliente") ||
    p.startsWith("/cobrador-externo") ||
    p === "/" ||
    p.startsWith("/planos") ||
    p.startsWith("/sobre")
  );
};

export const isPortalToken=(token:unknown):token is string=>typeof token==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(token);
export const getPortalToken = (): string | null => {
  try {
    const raw = tabSessionStorage.getItem(PORTAL_SESSION_KEY);
    if (!raw) return null;
    const { token } = JSON.parse(raw);
    // Desde o endurecimento do portal, nenhum CPF fica persistido no navegador.
    // A sessão existe somente quando há um token UUID temporário bem formado.
    return isPortalToken(token)?token:null;
  } catch {
    return null;
  }
};
export const hasPortalSession=():boolean=>getPortalToken()!==null;
export const isClientPortalActive=():boolean=>clientPortalActive||hasPortalSession();
export const savePortalToken=(token:string):boolean=>{
  if(!isPortalToken(token))throw new Error('Sessão do portal inválida.');
  return tabSessionStorage.setItem(PORTAL_SESSION_KEY,JSON.stringify({token}));
};

export const clearPortalSession = () => {
  tabSessionStorage.removeItem(PORTAL_SESSION_KEY);
};

let isolation:Promise<void>|null=null;
/** Portal/app exclusion belongs to this browser, never to the owner's other devices. */
export function endCreditorSessionForPortal():Promise<void>{
  clientPortalActive=true;
  if(isolation)return isolation;
  isolation=(async()=>{
    try{
      const {data}=await withTimeout(supabase.auth.getSession(),20_000);
      suspendAuthSession();
      // Capture the old session before clearing storage. SDK cleanup then emits
      // SIGNED_OUT locally while the captured credential is revoked server-side.
      const remote=data.session?supabase.auth.admin.signOut(data.session.access_token,'local'):Promise.resolve();
      await withTimeout(Promise.allSettled([supabase.auth.signOut({scope:'local'}),remote]),20_000);
    }catch{suspendAuthSession();/* Network failure cannot reopen creditor access in this document. */}
  })().finally(()=>{isolation=null;});
  return isolation;
}

/**
 * Logout completo do portal do cliente.
 * Limpa a sessão desta janela e as cópias acessíveis no navegador.
 * A operação remota usa escopo local, preservando sessões em outros aparelhos.
 */
export const performFullPortalLogout = async (): Promise<void> => {
  clearPortalSession();
  tabSessionStorage.removeItem('cobrador-token');
  tabSessionStorage.removeItem(PORTAL_ATTEMPTS_KEY);
  // 1) Limpa somente a sessão do credor neste navegador.
  await endCreditorSessionForPortal();
  rememberMeStorage.clear();

  // 2) Limpar sessionStorage inteiro (portal, tentativas, cache de rota)
  try {
    sessionStorage.clear();
  } catch {}

  // 3) Limpar chaves de auth do localStorage (sb-*, supabase.*, portal-*)
  try {
    const toRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k) continue;
      if (
        k.startsWith("sb-") ||
        k.startsWith("supabase.") ||
        k.startsWith("portal-") ||
        k.includes("auth-token")
      ) {
        toRemove.push(k);
      }
    }
    toRemove.forEach((k) => localStorage.removeItem(k));
  } catch {}

  // 4) Expirar cookies de sessão do supabase/ssr no domínio atual e superiores
  try {
    const host = window.location.hostname;
    const parts = host.split(".");
    const domains = new Set<string>(["", host]);
    for (let i = 1; i < parts.length - 1; i++) {
      domains.add("." + parts.slice(i).join("."));
    }
    document.cookie.split(";").forEach((raw) => {
      const name = raw.split("=")[0]?.trim();
      if (!name) return;
      if (
        name.startsWith("sb-") ||
        name.startsWith("supabase") ||
        name.includes("auth-token") ||
        name.startsWith("portal-")
      ) {
        domains.forEach((d) => {
          document.cookie = `${name}=; Max-Age=0; path=/;${d ? ` domain=${d};` : ""}`;
        });
      }
    });
  } catch {}

  // 5) Limpar caches do service worker (se houver PWA)
  try {
    if ("caches" in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    }
  } catch {}
};

// Rate limit: bloqueia após N tentativas em janela curta
export function recordPortalLoginAttempt(success: boolean): { blocked: boolean; waitSec: number } {
  const WINDOW_MS = 15 * 60 * 1000; // 15 min
  const MAX_ATTEMPTS = 8;
  const now = Date.now();
  try {
    const raw = tabSessionStorage.getItem(PORTAL_ATTEMPTS_KEY);
    let attempts: number[] = raw ? JSON.parse(raw) : [];
    attempts = attempts.filter((t) => now - t < WINDOW_MS);
    if (success) {
      tabSessionStorage.removeItem(PORTAL_ATTEMPTS_KEY);
      return { blocked: false, waitSec: 0 };
    }
    attempts.push(now);
    tabSessionStorage.setItem(PORTAL_ATTEMPTS_KEY, JSON.stringify(attempts));
    if (attempts.length >= MAX_ATTEMPTS) {
      const oldest = attempts[0];
      const waitSec = Math.max(0, Math.ceil((WINDOW_MS - (now - oldest)) / 1000));
      return { blocked: true, waitSec };
    }
  } catch {}
  return { blocked: false, waitSec: 0 };
}

export function isPortalLoginBlocked(): { blocked: boolean; waitSec: number } {
  const WINDOW_MS = 15 * 60 * 1000;
  const MAX_ATTEMPTS = 8;
  const now = Date.now();
  try {
    const raw = tabSessionStorage.getItem(PORTAL_ATTEMPTS_KEY);
    if (!raw) return { blocked: false, waitSec: 0 };
    const attempts: number[] = JSON.parse(raw);
    const fresh = attempts.filter((t) => now - t < WINDOW_MS);
    if (fresh.length >= MAX_ATTEMPTS) {
      const oldest = fresh[0];
      const waitSec = Math.max(0, Math.ceil((WINDOW_MS - (now - oldest)) / 1000));
      return { blocked: true, waitSec };
    }
  } catch {}
  return { blocked: false, waitSec: 0 };
}
