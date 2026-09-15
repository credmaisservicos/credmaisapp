import { createContext, useContext, useEffect, useState, useCallback, useRef } from "react";
import { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { clearOfflineSession, loadOfflineSession, saveOfflineSession } from "@/lib/offlineSession";
import { withTimeout } from "@/lib/withTimeout";

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

  const fetchProfile = useCallback(async (userId: string) => {
    if (!mounted.current || activeUserId.current !== userId) return;
    const request = ++profileRequest.current;
    const isCurrent = () => mounted.current && request === profileRequest.current && activeUserId.current === userId;
    setLoading(true);
    setAuthError(null);

    try {
      const cached = loadOfflineSession<AuthProfile>(userId);
      if (!navigator.onLine && cached?.profile.id === userId) {
        setProfile(cached.profile);
        setIsPlatformAdmin(cached.isPlatformAdmin === true);
        return;
      }

      const [profileSettled, adminSettled] = await Promise.allSettled([
        withTimeout(supabase.from("profiles").select("*").eq("id", userId).single()),
        withTimeout(supabase.rpc("is_admin", { _user_id: userId })),
      ]);
      if (!isCurrent()) return;
      const profileResult = profileSettled.status === "fulfilled" ? profileSettled.value : null;
      const adminResult = adminSettled.status === "fulfilled" ? adminSettled.value : null;
      if (profileResult?.error || profileResult?.data?.id !== userId) {
        throw new Error("Não foi possível carregar seu perfil. Verifique sua conexão e tente novamente.");
      }

      // Online, somente a resposta atual do banco confirma a permissão.
      const admin = !adminResult?.error && adminResult?.data === true;
      setProfile(profileResult.data);
      setIsPlatformAdmin(admin);
      saveOfflineSession(userId, profileResult.data, admin);
    } catch {
      if (!isCurrent()) return;
      setProfile(null);
      setIsPlatformAdmin(false);
      setAuthError("Não foi possível carregar seu perfil. Verifique sua conexão e tente novamente.");
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

    const applySession = (newSession: Session | null) => {
      if (disposed) return;
      const userId = newSession?.user.id ?? null;
      const sameUser = initialized && activeUserId.current === userId;
      initialized = true;
      setSession(newSession);
      setUser(newSession?.user ?? null);
      if (sameUser) return;

      const previousUserId = activeUserId.current;
      activeUserId.current = userId;
      ++profileRequest.current;
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

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, newSession) => {
      receivedAuthEvent = true;
      applySession(newSession);
    });

    void withTimeout(supabase.auth.getSession())
      .then(({ data, error }) => {
        if (disposed || receivedAuthEvent) return;
        if (error) throw error;
        applySession(data.session);
      })
      .catch(() => {
        if (disposed || receivedAuthEvent) return;
        setAuthError("Não foi possível recuperar sua sessão. Verifique sua conexão e tente novamente.");
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

  const signOut = async () => {
    const signedOutUserId = user?.id;
    const { error } = await withTimeout(supabase.auth.signOut());
    if (error) throw error;
    // Também invalida consultas caso o SDK não emita SIGNED_OUT.
    ++profileRequest.current;
    activeUserId.current = null;
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
