import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "@supabase/supabase-js";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { saveOfflineSession } from "@/lib/offlineSession";

const api = vi.hoisted(() => ({
  getSession: vi.fn(), single: vi.fn(), rpc: vi.fn(), signOut: vi.fn(), refreshSession: vi.fn(),
  listener: null as null | ((event: string, session: Session | null) => void),signals:[] as AbortSignal[],
}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {
  auth: {
    getSession: api.getSession, signOut: api.signOut, refreshSession: api.refreshSession,
    onAuthStateChange: (listener: typeof api.listener) => {
      api.listener = listener;
      return { data: { subscription: { unsubscribe: vi.fn() } } };
    },
  },
  from: () => ({ select: () => ({ eq: () => ({ abortSignal:(signal:AbortSignal)=>{api.signals.push(signal);return {single:api.single};} }) }) }),
  rpc: (...args:unknown[])=>{const promise=api.rpc(...args);return Object.assign(promise,{abortSignal:()=>promise});},
} }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
const session = (id: string) => ({ user: { id, email: `${id}@example.test` } }) as Session;
const profileResult = (id: string) => ({ data: { id, subscription_type: "lifetime" }, error: null });
const open = async () => {
  const hook = renderHook(() => useAuth(), { wrapper: AuthProvider });
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  return hook;
};
const emit = async (value: Session | null, event = "SIGNED_IN") => {
  await act(async () => {
    api.listener!(event, value);
    await vi.advanceTimersByTimeAsync(0);
  });
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  api.signals=[];
  localStorage.clear();
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
  api.getSession.mockResolvedValue({ data: { session: null }, error: null });
  api.single.mockResolvedValue(profileResult("a"));
  api.rpc.mockResolvedValue({ data: false, error: null });
  api.signOut.mockResolvedValue({ error: null });
  api.refreshSession.mockResolvedValue({ data: { session: session("a") }, error: null });
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });

describe("sessão e perfil", () => {
  it.each([0,503])('recupera uma falha temporária do perfil com uma tentativa limitada: %s',async status=>{
    api.single.mockResolvedValueOnce({data:null,error:{message:'Failed to fetch'},status});
    const {result}=await open();await emit(session('a'));
    expect(result.current.loading).toBe(true);
    await act(async()=>{await vi.advanceTimersByTimeAsync(500);});
    expect(result.current.profile?.id).toBe('a');expect(result.current.authError).toBeNull();
    expect(api.single).toHaveBeenCalledTimes(2);expect(api.refreshSession).not.toHaveBeenCalled();
  });
  it('limita falhas temporárias a duas consultas sem usar permissão em cache',async()=>{
    saveOfflineSession('a',{id:'a',subscription_type:'lifetime'},true);
    api.single.mockResolvedValue({data:null,error:{message:'Failed to fetch'},status:503});
    const {result}=await open();await emit(session('a'));await act(async()=>{await vi.advanceTimersByTimeAsync(500);});
    expect(result.current.profile).toBeNull();expect(result.current.isPlatformAdmin).toBe(false);
    expect(result.current.authError).toContain('servidor');expect(api.single).toHaveBeenCalledTimes(2);
  });
  it('cancela a tentativa da conta antiga quando o usuário sai durante a espera',async()=>{
    api.single.mockResolvedValueOnce({data:null,error:{message:'Failed to fetch'},status:0});
    const {result}=await open();await emit(session('a'));await emit(null,'SIGNED_OUT');
    await act(async()=>{await vi.advanceTimersByTimeAsync(500);});
    expect(api.single).toHaveBeenCalledTimes(1);expect(result.current.user).toBeNull();expect(result.current.profile).toBeNull();
  });
  it('recupera a verificação que falhou ao voltar ao app',async()=>{
    api.single.mockResolvedValueOnce({data:null,error:{message:'Perfil indisponível'}});
    const {result}=await open();await emit(session('a'));expect(result.current.profile).toBeNull();
    await act(async()=>{window.dispatchEvent(new Event('focus'));});
    expect(result.current.profile?.id).toBe('a');expect(result.current.authError).toBeNull();
  });
  it('uma negativa 403 não dispara repetição automática',async()=>{
    api.single.mockResolvedValue({data:null,error:{message:'Permission denied'},status:403});
    const {result}=await open();await emit(session('a'));await act(async()=>{await vi.advanceTimersByTimeAsync(1000);});
    expect(api.single).toHaveBeenCalledTimes(1);expect(result.current.profile).toBeNull();expect(result.current.authError).toContain('permissão');
  });
  it("renova uma sessão rejeitada com 401 e consulta novamente a mesma conta", async () => {
    api.single.mockResolvedValueOnce({ data: null, error: { code: "PGRST303" }, status: 401 });
    api.refreshSession.mockImplementation(async () => {
      api.listener!("TOKEN_REFRESHED", session("a"));
      return { data: { session: session("a") }, error: null };
    });
    const { result } = await open(); await emit(session("a"));
    expect(result.current.profile?.id).toBe("a");
    expect(result.current.authError).toBeNull();
    expect(api.refreshSession).toHaveBeenCalledTimes(1);
    expect(api.single).toHaveBeenCalledTimes(2);
  });
  it("limita a renovação a uma tentativa e não libera o acesso se o 401 persistir", async () => {
    api.single.mockResolvedValue({ data: null, error: { code: "PGRST303" }, status: 401 });
    const { result } = await open(); await emit(session("a"));
    expect(result.current.profile).toBeNull();
    expect(result.current.authError).toContain("sessão");
    expect(api.refreshSession).toHaveBeenCalledTimes(1);
    expect(api.single).toHaveBeenCalledTimes(2);
  });
  it.each(["SIGNED_IN", "TOKEN_REFRESHED"])("recupera um perfil que falhou após %s na mesma conta", async event => {
    api.single.mockResolvedValueOnce({ data: null, error: { message: "Perfil indisponível" } });
    const { result } = await open(); await emit(session("a"));
    expect(result.current.authError).toContain("perfil");
    await emit(session("a"), event);
    expect(result.current.profile?.id).toBe("a");
    expect(result.current.authError).toBeNull();
    expect(api.single).toHaveBeenCalledTimes(2);
  });
  it("retoma a verificação quando a conexão volta", async () => {
    api.single.mockResolvedValueOnce({ data: null, error: { message: "Perfil indisponível" } });
    const { result } = await open(); await emit(session("a"));
    await act(async () => { window.dispatchEvent(new Event("online")); });
    expect(result.current.profile?.id).toBe("a");
    expect(result.current.authError).toBeNull();
  });
  it("não consulta a conta antiga se a renovação ocorrer durante uma troca de usuário", async () => {
    api.single.mockResolvedValueOnce({ data: null, error: {}, status: 401 }).mockResolvedValue(profileResult("b"));
    api.refreshSession.mockImplementation(async () => {
      api.listener!("SIGNED_IN", session("b"));
      return { data: { session: session("b") }, error: null };
    });
    const { result } = await open(); await emit(session("a"));
    expect(result.current.user?.id).toBe("b");
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(result.current.profile?.id).toBe("b");
    expect(api.single).toHaveBeenCalledTimes(2);
  });
  it("descarta a renovação pendente após logout", async () => {
    const renewal = deferred<{ data: { session: Session }; error: null }>();
    api.single.mockResolvedValueOnce({ data: null, error: {}, status: 401 });
    api.refreshSession.mockReturnValue(renewal.promise);
    const { result } = await open(); await emit(session("a"));
    await emit(null, "SIGNED_OUT");
    await act(async () => { renewal.resolve({ data: { session: session("a") }, error: null }); });
    expect(result.current.profile).toBeNull();
    expect(result.current.user).toBeNull();
    expect(api.single).toHaveBeenCalledTimes(1);
  });
  it("não renova nem usa cache para contornar uma negativa de acesso 403", async () => {
    saveOfflineSession("a", { id: "a", subscription_type: "lifetime" }, true);
    api.single.mockResolvedValue({ data: null, error: { code: "42501" }, status: 403 });
    const { result } = await open(); await emit(session("a"));
    expect(result.current.profile).toBeNull();
    expect(result.current.isPlatformAdmin).toBe(false);
    expect(api.refreshSession).not.toHaveBeenCalled();
  });
  it("revalida um administrador em cache ao reconectar e respeita a revogação", async () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    saveOfflineSession("a", { id: "a", subscription_type: "lifetime" }, true);
    const { result } = await open(); await emit(session("a"));
    expect(result.current.isPlatformAdmin).toBe(true);
    api.single.mockResolvedValue({ data: { id: "a", subscription_type: "lifetime", is_blocked: true }, error: null });
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
    await act(async () => { window.dispatchEvent(new Event("online")); });
    expect(result.current.isPlatformAdmin).toBe(false);
    expect(result.current.profile?.is_blocked).toBe(true);
  });
  it("aguarda o perfil no primeiro login antes de liberar as rotas", async () => {
    const pending = deferred<ReturnType<typeof profileResult>>();
    api.single.mockReturnValue(pending.promise);
    const { result } = await open();
    expect(result.current.loading).toBe(false);
    await emit(session("a"));
    expect(result.current.loading).toBe(true);
    await act(async () => { pending.resolve(profileResult("a")); });
    expect(result.current.loading).toBe(false);
    expect(result.current.profile?.id).toBe("a");
  });

  it("descarta o perfil que termina depois do logout", async () => {
    const pending = deferred<ReturnType<typeof profileResult>>();
    api.single.mockReturnValue(pending.promise);
    api.rpc.mockResolvedValue({ data: true, error: null });
    const { result } = await open();
    await emit(session("a"));
    await emit(null, "SIGNED_OUT");
    await act(async () => { pending.resolve(profileResult("a")); });
    expect(result.current.user).toBeNull();
    expect(result.current.profile).toBeNull();
    expect(result.current.isPlatformAdmin).toBe(false);
  });

  it("não substitui o perfil da nova conta por uma resposta da conta anterior", async () => {
    const old = deferred<ReturnType<typeof profileResult>>();
    api.single.mockReturnValueOnce(old.promise).mockResolvedValue(profileResult("b"));
    const { result } = await open();
    await emit(session("a"));
    await emit(session("b"));
    await act(async () => { old.resolve(profileResult("a")); });
    expect(result.current.user?.id).toBe("b");
    expect(result.current.profile?.id).toBe("b");
  });

  it("não duplica a consulta de perfil entre getSession e INITIAL_SESSION", async () => {
    api.getSession.mockResolvedValue({ data: { session: session("a") }, error: null });
    await open();
    await emit(session("a"), "INITIAL_SESSION");
    await emit(session("a"), "TOKEN_REFRESHED");
    expect(api.single).toHaveBeenCalledTimes(1);
    expect(api.rpc).toHaveBeenCalledTimes(1);
  });

  it("não reutiliza permissão administrativa em cache quando o banco a revoga", async () => {
    saveOfflineSession("a", { id: "a", subscription_type: "lifetime" }, true);
    api.single.mockResolvedValue({ data: null, error: { message: "Perfil indisponível" } });
    const { result } = await open();
    await emit(session("a"));
    expect(result.current.isPlatformAdmin).toBe(false);
    expect(result.current.profile).toBeNull();
  });

  it("não restaura uma sessão antiga que chega depois de SIGNED_IN", async () => {
    const bootstrap = deferred<{ data: { session: Session | null }; error: null }>();
    api.getSession.mockReturnValue(bootstrap.promise);
    const { result } = await open();
    await emit(session("a"));
    await act(async () => { bootstrap.resolve({ data: { session: null }, error: null }); });
    expect(result.current.user?.id).toBe("a");
    expect(result.current.profile?.id).toBe("a");
  });

  it("oferece recuperação quando a sessão não responde e tenta novamente", async () => {
    api.getSession.mockReturnValueOnce(new Promise(() => {}));
    const { result } = await open();
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(result.current.loading).toBe(false);
    expect(result.current.authError).toContain("servidor");
    act(() => { result.current.retryAuth(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(result.current.authError).toBeNull();
    expect(api.getSession).toHaveBeenCalledTimes(2);
  });

  it("permite tentar carregar o perfil novamente após um timeout", async () => {
    api.single.mockReturnValueOnce(new Promise(() => {})).mockReturnValueOnce(new Promise(() => {}));
    const { result } = await open();
    await emit(session("a"));
    await act(async () => { await vi.advanceTimersByTimeAsync(20_500); });
    expect(result.current.loading).toBe(false);
    expect(result.current.authError).toContain("servidor");
    expect(api.signals.every(signal=>signal.aborted)).toBe(true);
    await act(async () => { result.current.retryAuth(); });
    expect(result.current.authError).toBeNull();
    expect(result.current.profile?.id).toBe("a");
  });

  it("mantém acesso offline ao perfil da própria conta sem esperar rede", async () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    saveOfflineSession("a", { id: "a", subscription_type: "lifetime" }, false);
    const { result } = await open();
    await emit(session("a"));
    expect(result.current.profile?.id).toBe("a");
    expect(result.current.loading).toBe(false);
    expect(api.single).not.toHaveBeenCalled();
  });

  it("não promove usuário a administrador quando a RPC falha online", async () => {
    saveOfflineSession("a", { id: "a", subscription_type: "lifetime" }, true);
    api.rpc.mockRejectedValue(new Error("RPC indisponível"));
    const { result } = await open();
    await emit(session("a"));
    expect(result.current.profile?.id).toBe("a");
    expect(result.current.isPlatformAdmin).toBe(false);
  });

  it("descarta consulta pendente após desmontar o provider", async () => {
    const pending = deferred<ReturnType<typeof profileResult>>();
    api.single.mockReturnValue(pending.promise);
    const hook = await open();
    await emit(session("a"));
    hook.unmount();
    await act(async () => { pending.resolve(profileResult("a")); });
    expect(localStorage.getItem("credmais-offline-session:a")).toBeNull();
  });
});
