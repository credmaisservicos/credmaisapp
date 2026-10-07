import { CredinhoLoader } from "@/components/brand/Credinho";
import { useEffect, useState } from "react";
import { Link, Navigate, useLocation } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { AlertCircle, Lock, CreditCard, Wrench } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { isClientPortalActive } from "@/lib/portalSession";
import { usePlatformSettings } from "@/hooks/usePlatformSettings";
import { hasProfileEntitlement } from "@/lib/entitlement";
import { toSafeHttpUrl } from "@/lib/safeUrl";
import { withTimeout } from "@/lib/withTimeout";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";

type AccessState = "checking" | "allowed" | "denied" | "error" | "blocked";

/**
 * Cache the subscription decision per user for a short period to avoid
 * hammering the DB on every navigation. Reset on logout via cache key.
 */
const CACHE_KEY = (uid: string) => `__credmais_sub_status_v2_${uid}`;
// Acesso positivo pode ser reutilizado por até 24h sem rede. Datas de trial e
// expiração no próprio perfil continuam sendo avaliadas localmente em cada uso.
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
function readCache(uid: string): "allowed" | "denied" | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY(uid));
    if (!raw) return null;
    const { v, t } = JSON.parse(raw);
    const age = Date.now() - t;
    if (!Number.isFinite(t) || age < 0 || age > CACHE_TTL_MS) return null;
    return v === "allowed" || v === "denied" ? v : null;
  } catch {
    return null;
  }
}
function writeCache(uid: string, v: "allowed" | "denied") {
  try {
    localStorage.setItem(CACHE_KEY(uid), JSON.stringify({ v, t: Date.now() }));
  } catch {}
}

function clearAccessCache(uid?: string) {
  try {
    if (uid) { localStorage.removeItem(CACHE_KEY(uid)); return; }
    Object.keys(localStorage)
      .filter((key) => key.startsWith("__sub_status_") || key.startsWith("__credmais_sub_status_"))
      .forEach((key) => localStorage.removeItem(key));
  } catch {}
}

const ProtectedRoute = ({ children }: { children: React.ReactNode }) => {
  const { user, profile, isPlatformAdmin, loading, authError, retryAuth } = useAuth();
  const location = useLocation();
  const online = useOnlineStatus();
  const [decision, setDecision] = useState<{ key: string; state: AccessState }>({ key: "", state: "checking" });
  const [checkoutUrl, setCheckoutUrl] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);
  const { settings: platform } = usePlatformSettings();
  const portalOnly=isClientPortalActive();
  const trialEndsAt = profile?.trial_ends_at ?? null;
  const subscriptionExpiresAt = profile?.subscription_expires_at ?? null;
  const subscriptionType = profile?.subscription_type ?? null;
  const userEmail = user?.email ?? null;
  const accessKey = JSON.stringify([user?.id, userEmail, isPlatformAdmin, loading, authError,
    subscriptionType, trialEndsAt, subscriptionExpiresAt, profile?.is_blocked, online, retryKey]);
  const access = decision.key === accessKey ? decision.state : "checking";

  useEffect(() => {
    if (portalOnly || loading || authError || !user?.id) return;
    const setAccess = (state: AccessState) => setDecision({ key: accessKey, state });
    setAccess("checking");
    setCheckoutUrl(null);

    if (profile?.is_blocked) { setAccess("blocked"); return; }

    // Dono do app sempre entra (inclusive durante manutenção)
    if (isPlatformAdmin) {
      setAccess("allowed");
      return;
    }

    const profileEntitled = hasProfileEntitlement({
      subscriptionType,
      trialEndsAt,
      subscriptionExpiresAt,
    });

    // Profile data is authoritative. Do not let an old denied cache keep a newly
    // activated customer locked out after Mercado Pago confirms the subscription.
    if (profileEntitled) {
      clearAccessCache(user.id);
      writeCache(user.id, "allowed");
      setAccess("allowed");
      return;
    }

    // Only cache positive access. Negative decisions become stale right after
    // an admin/manual release or webhook payment confirmation.
    if (!online) {
      // Não prolonga uma data de expiração conhecida usando uma decisão antiga.
      const hasDeadline = Boolean(trialEndsAt || subscriptionExpiresAt || subscriptionType === "trial");
      setAccess(!hasDeadline && readCache(user.id) === "allowed" ? "allowed" : "error");
      return;
    }
    clearAccessCache(user.id);

    let cancelled = false;
    (async () => {
      // Re-check profile directly because access may have been released by an
      // admin/webhook while the user is already stuck on this screen.
      const [profileResult, subscriptionResult] = await Promise.allSettled([
        withTimeout(supabase.from("profiles")
          .select("subscription_type, subscription_expires_at, trial_ends_at, is_blocked")
          .eq("id", user.id).maybeSingle()),
        withTimeout(supabase.from("subscriptions").select("status")
          .or(`user_id.eq.${user.id},email.eq.${userEmail ?? ""}`)
          .order("updated_at", { ascending: false }).limit(1).maybeSingle()),
      ]);

      if (cancelled) return;
      const freshProfile = profileResult.status === "fulfilled" ? profileResult.value.data : null;
      const sub = subscriptionResult.status === "fulfilled" ? subscriptionResult.value.data : null;
      const freshProfileError = profileResult.status === "rejected" || profileResult.value.error;
      const subscriptionError = subscriptionResult.status === "rejected" || subscriptionResult.value.error;

      if (freshProfile?.is_blocked) { setAccess("blocked"); return; }

      const freshProfileEntitled = hasProfileEntitlement({
        subscriptionType: freshProfile?.subscription_type,
        trialEndsAt: freshProfile?.trial_ends_at,
        subscriptionExpiresAt: freshProfile?.subscription_expires_at,
      });

      if (freshProfileEntitled) {
        clearAccessCache(user.id);
        writeCache(user.id, "allowed");
        setAccess("allowed");
        return;
      }

      if (sub?.status === "active") {
        writeCache(user.id, "allowed");
        setAccess("allowed");
        return;
      }

      if (freshProfileError || subscriptionError) {
        setAccess("error");
        return;
      }

      // 3) No access — fetch checkout URL once for the CTA
      setAccess("denied");
      // A opção Ver planos já funciona enquanto o link opcional é consultado.
      const { data: url } = await withTimeout(supabase.rpc("get_signup_checkout_url"))
        .catch(() => ({ data: null }));
      if (cancelled) return;
      const safeCheckout = toSafeHttpUrl(url);
      setCheckoutUrl(safeCheckout?.toString() ?? null);
    })().catch(() => {
      if (!cancelled) setAccess("error");
    });

    return () => { cancelled = true; };
  }, [accessKey,portalOnly]);

  // Se o navegador tem sessão do portal do cliente, jamais permite o app do credor.
  if (portalOnly) {
    return <Navigate to="/portal-cliente" replace />;
  }

  if (loading || (user && !authError && !profile?.is_blocked && access === "checking")) {
    return (
      <CredinhoLoader fullScreen label="Verificando acesso" />
    );
  }

  if (!user && !authError) {
    const path = location.pathname + location.search + location.hash;
    const lower = location.pathname.toLowerCase();
    const isAuthRoute =
      lower === "/" ||
      lower.startsWith("/login") ||
      lower.startsWith("/reset-password") ||
      lower.startsWith("/portal-cliente") ||
      lower.startsWith("/cobrador-externo");
    const next = !isAuthRoute && path.startsWith("/") ? `?next=${encodeURIComponent(path)}` : "";
    return <Navigate to={`/login${next}`} replace />;
  }

  if (profile?.is_blocked || access === "blocked") {
    return (
      <div className="min-h-dvh bg-background flex items-center justify-center p-6">
        <div className="max-w-md w-full glass-card p-8 text-center space-y-4">
          <div className="w-16 h-16 rounded-2xl bg-destructive/10 flex items-center justify-center mx-auto">
            <Lock className="text-destructive" size={28} />
          </div>
          <h1 className="text-xl font-bold text-foreground">Conta Bloqueada</h1>
          <p className="text-sm text-muted-foreground">
            Sua conta foi bloqueada pelo administrador. Entre em contato para mais informações.
          </p>
        </div>
      </div>
    );
  }

  // Modo manutenção: definido pelo dono do app em /admin → Plataforma.
  // O próprio admin continua entrando, para conseguir desligar depois.
  if (platform.maintenance_mode && !isPlatformAdmin) {
    return (
      <div className="min-h-dvh bg-background flex items-center justify-center p-6">
        <div className="max-w-md w-full glass-card p-8 text-center space-y-4">
          <div className="w-16 h-16 rounded-2xl bg-warning/10 flex items-center justify-center mx-auto">
            <Wrench className="text-warning" size={28} />
          </div>
          <h1 className="text-xl font-bold text-foreground">Sistema em manutenção</h1>
          <p className="text-sm text-muted-foreground">
            {platform.maintenance_message?.trim() ||
              "Estamos fazendo uma manutenção rápida. Volte em alguns minutos."}
          </p>
        </div>
      </div>
    );
  }

  if (authError || access === "error") {
    return (
      <div className="min-h-dvh bg-background flex items-center justify-center p-6">
        <div className="max-w-md w-full glass-card p-8 text-center space-y-5">
          <div className="w-16 h-16 rounded-2xl bg-warning/10 flex items-center justify-center mx-auto">
            <AlertCircle className="text-warning" size={28} />
          </div>
          <div className="space-y-2">
            <h1 className="text-xl font-bold text-foreground">Não foi possível verificar seu acesso</h1>
            <p className="text-sm text-muted-foreground">
              {authError || "Houve uma falha de conexão ao consultar sua assinatura. Verifique sua internet e tente novamente."}
            </p>
          </div>
          <button
            onClick={() => {
              if (authError) { retryAuth(); return; }
              clearAccessCache(user?.id);
              setRetryKey((key) => key + 1);
            }}
            className="w-full py-3 rounded-xl bg-primary text-primary-foreground font-semibold text-sm hover:opacity-90 transition"
          >
            Tentar novamente
          </button>
          {authError&&<Link to="/login" className="block text-sm underline py-2">Entrar novamente</Link>}
        </div>
      </div>
    );
  }

  if (access === "denied") {
    return (
      <div className="min-h-dvh bg-background flex items-center justify-center p-6">
        <div className="max-w-md w-full glass-card p-8 text-center space-y-5">
          <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto">
            <CreditCard className="text-primary" size={28} />
          </div>
          <div className="space-y-2">
            <h1 className="text-xl font-bold text-foreground">Assinatura necessária</h1>
            <p className="text-sm text-muted-foreground">
              Para acessar o CredMais App é preciso ter uma assinatura ativa. Finalize seu pagamento para liberar o acesso imediatamente.
            </p>
          </div>
          <div className="flex flex-col gap-2">
            {checkoutUrl ? (
              <a
                href={checkoutUrl}
                className="w-full py-3 rounded-xl bg-primary text-primary-foreground font-semibold text-sm hover:opacity-90 transition"
              >
                Ir para o pagamento
              </a>
            ) : (
              <a
                href="/planos"
                className="w-full py-3 rounded-xl bg-primary text-primary-foreground font-semibold text-sm hover:opacity-90 transition"
              >
                Ver planos
              </a>
            )}
            <button
              onClick={async () => {
                clearAccessCache(user.id);
                await supabase.auth.signOut({scope:'local'});
                window.location.href = "/login";
              }}
              className="w-full py-2.5 rounded-xl border border-border text-muted-foreground text-xs hover:text-foreground transition"
            >
              Sair
            </button>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Já pagou? Atualize a página em alguns segundos — assim que o Mercado Pago confirmar, seu acesso é liberado automaticamente.
          </p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
};

export default ProtectedRoute;
