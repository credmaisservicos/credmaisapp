import { createContext, useContext, useEffect, useState, useCallback, useRef } from "react";
import { Session, User, type AuthChangeEvent } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { clearOfflineSession, loadOfflineSession, saveOfflineSession } from "@/lib/offlineSession";
import { withTimeout } from "@/lib/withTimeout";
import {authFailureMessage,isTemporaryAuthFailure} from '@/lib/authFailure';

export type AuthProfile = Database["public"]["Tables"]["profiles"]["Row"];

interface AuthContextType {
  session: Session | null;
  user: User | null;
  profile: AuthProfile | null;
  /**
   * Admin da PLATAFORMA (dono do app) — quem enxerga /admin e as configurações
   * globais. Fonte única de verdade: a função `is_admin()` do banco, que checa
   * `user_roles` e cai para `profiles.is_admin`. Não existe exceção no cliente:
   * mudanças de privilégio precisam passar pelo fluxo administrativo do banco.
   *
   * Não confundir com o assinante comum, que administra apenas o próprio tenant.
   */
  isPlatformAdmin: boolean;
  loading: boolean;
  authError: string | null;
  retryAuth: () => void;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  session: null,
  user: null,
  profile: null,
  isPlatformAdmin: false,
  loading: true,
  authError: null,
  retryAuth: () => {},
  signOut: async () => {},
  refreshProfile: async () => {},
});

export const useAuth = () => useContext(AuthContext);

const isSupabaseConfigured = Boolean(
  import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
);

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<AuthProfile | null>(null);
  const [isPlatformAdmin, setIsPlatformAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);
  const [bootstrapKey, setBootstrapKey] = useState(0);
  const mounted = useRef(false);
  const activeUserId = useRef<string | null>(null);
  const profileRequest = useRef(0);
  const profilePhase = useRef<"idle" | "loading" | "ready" | "error">("idle");

  const fetchProfile = useCallback(async (userId: string) => {
    if (!mounted.current || activeUserId.current !== userId) return;
    const request = ++profileRequest.current;
    const isCurrent = () => mounted.current && request === profileRequest.current && activeUserId.current === userId;
    profilePhase.current = "loading";
    setLoading(true);
    setAuthError(null);

    try {
      const cached = loadOfflineSession<AuthProfile>(userId);
      if (!navigator.onLine && cached?.profile.id === userId) {
        setProfile(cached.profile);
        setIsPlatformAdmin(cached.isPlatformAdmin === true);
        profilePhase.current = "ready";
        return;
      }

      const readProfile = async () => {
        const controller=new AbortController();
        const timer=setTimeout(()=>controller.abort(),10_000);
        try{return await Promise.allSettled([
          withTimeout(supabase.from("profiles").select("*").eq("id",userId).abortSignal(controller.signal).single()),
          withTimeout(supabase.rpc("is_admin",{_user_id:userId}).abortSignal(controller.signal)),
        ] as const);}finally{clearTimeout(timer);}
      };
      let [profileSettled, adminSettled] = await readProfile();
      if (!isCurrent()) return;
      const temporaryError=profileSettled.status==='rejected'?profileSettled.reason:profileSettled.value.error?{...profileSettled.value.error,status:profileSettled.value.status}:null;
      if(temporaryError&&isTemporaryAuthFailure(temporaryError)&&navigator.onLine){
        await new Promise(resolve=>setTimeout(resolve,500));
        if(!isCurrent())return;
        [profileSettled,adminSettled]=await readProfile();
      }
      if(!isCurrent())return;
      if (profileSettled.status === "fulfilled" && profileSettled.value.status === 401) {
        // A stored access token can be rejected while the refresh token is still
        // valid. Renew once, then verify this same account with fresh requests.
        // This runs outside the SDK's auth callback to avoid locking auth.
        const renewed = await withTimeout(supabase.auth.refreshSession());
        if (!isCurrent()) return;
        if (renewed.error || renewed.data.session?.user.id !== userId) {
          throw renewed.error || {status:401,message:"Não foi possível renovar sua sessão."};
        }
        [profileSettled, adminSettled] = await readProfile();
      }
      if (!isCurrent()) return;
      const profileResult = profileSettled.status === "fulfilled" ? profileSettled.value : null;
      const adminResult = adminSettled.status === "fulfilled" ? adminSettled.value : null;
      if (profileResult?.error || profileResult?.data?.id !== userId) {
        throw profileSettled.status==='rejected'?profileSettled.reason:profileResult?.error?{...profileResult.error,status:profileResult.status}:new Error('Não foi possível carregar seu perfil. Tente novamente ou entre em contato com o suporte.');
      }

      // Online, somente a resposta atual do banco confirma a permissão.
      const admin = !adminResult?.error && adminResult?.data === true;
      setProfile(profileResult.data);
      setIsPlatformAdmin(admin);
      saveOfflineSession(userId, profileResult.data, admin);
      profilePhase.current = "ready";
    } catch (error) {
      if (!isCurrent()) return;
      setProfile(null);
      setIsPlatformAdmin(false);
      setAuthError(authFailureMessage(error,'Não foi possível carregar seu perfil. Tente novamente ou entre em contato com o suporte.'));
      profilePhase.current = "error";
    } finally {
      if (isCurrent()) setLoading(false);
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    if (!isSupabaseConfigured) {
      setAuthError("Serviço de autenticação não configurado. Defina as variáveis do Supabase e tente novamente.");
      setLoading(false);
      return () => { mounted.current = false; };
    }
    let disposed = false;
    let receivedAuthEvent = false;
    let initialized = false;
    let profileTimer: ReturnType<typeof setTimeout> | undefined;

    const applySession = (newSession: Session | null, event?: AuthChangeEvent) => {
      if (disposed) return;
      const userId = newSession?.user.id ?? null;
      const sameUser = initialized && activeUserId.current === userId;
      initialized = true;
      setSession(newSession);
      setUser(newSession?.user ?? null);
      if (sameUser) {
        if (userId && profilePhase.current === "error" && (event === "SIGNED_IN" || event === "TOKEN_REFRESHED")) {
          clearTimeout(profileTimer);
          profileTimer = setTimeout(() => { if (!disposed) void fetchProfile(userId); }, 0);
        }
        return;
      }

      const previousUserId = activeUserId.current;
      activeUserId.current = userId;
      ++profileRequest.current;
      profilePhase.current = "idle";
      clearTimeout(profileTimer);
      setProfile(null);
      setIsPlatformAdmin(false);
      setAuthError(null);
      setLoading(Boolean(userId));
      if (previousUserId && previousUserId !== userId) clearOfflineSession(previousUserId);
      if (userId) {
        // A consulta deve começar fora do callback de autenticação do Supabase.
        profileTimer = setTimeout(() => { if (!disposed) void fetchProfile(userId); }, 0);
      }
    };

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, newSession) => {
      receivedAuthEvent = true;
      applySession(newSession, event);
    });

    void withTimeout(supabase.auth.getSession())
      .then(({ data, error }) => {
        if (disposed || receivedAuthEvent) return;
        if (error) throw error;
        applySession(data.session);
      })
      .catch((error) => {
        if (disposed || receivedAuthEvent) return;
        setAuthError(authFailureMessage(error,'Não foi possível recuperar sua sessão. Tente novamente ou entre novamente.'));
        setLoading(false);
      });

    return () => {
      disposed = true;
      mounted.current = false;
      ++profileRequest.current;
      clearTimeout(profileTimer);
      subscription.unsubscribe();
    };
  }, [fetchProfile, bootstrapKey]);

  useEffect(() => {
    const reconnect = () => {
      const userId = activeUserId.current;
      if (navigator.onLine && userId && profilePhase.current !== "loading") void fetchProfile(userId);
    };
    window.addEventListener("online", reconnect);
    const recoverVisible=()=>{if(document.visibilityState==='visible'&&profilePhase.current==='error')reconnect();};
    window.addEventListener('focus',recoverVisible);
    document.addEventListener('visibilitychange',recoverVisible);
    return () => {window.removeEventListener("online",reconnect);window.removeEventListener('focus',recoverVisible);document.removeEventListener('visibilitychange',recoverVisible);};
  }, [fetchProfile]);

  const signOut = async () => {
    const signedOutUserId = user?.id;
    const { error } = await withTimeout(supabase.auth.signOut());
    if (error) throw error;
    // Também invalida consultas caso o SDK não emita SIGNED_OUT.
    ++profileRequest.current;
    activeUserId.current = null;
    profilePhase.current = "idle";
    if (signedOutUserId) clearOfflineSession(signedOutUserId);
    setSession(null);
    setUser(null);
    setProfile(null);
    setIsPlatformAdmin(false);
    setAuthError(null);
    setLoading(false);
  };

  const refreshProfile = async () => {
    if (activeUserId.current) await fetchProfile(activeUserId.current);
  };

  const retryAuth = () => {
    if (activeUserId.current) void fetchProfile(activeUserId.current);
    else {
      setAuthError(null);
      setLoading(true);
      setBootstrapKey(key => key + 1);
    }
  };

  return (
    <AuthContext.Provider value={{ session, user, profile, isPlatformAdmin, loading, authError, retryAuth, signOut, refreshProfile }}>
      {children}
    </AuthContext.Provider>
  );
};
