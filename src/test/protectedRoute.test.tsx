import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import ProtectedRoute from "@/components/ProtectedRoute";

const api = vi.hoisted(() => ({ profile: vi.fn(), subscription: vi.fn(), rpc: vi.fn() }));
const auth = vi.hoisted(() => ({
  user: { id: "a", email: "a@example.test" },
  profile: { id: "a", subscription_type: "trial", trial_ends_at: "2020-01-01", subscription_expires_at: null, is_blocked: false },
  isPlatformAdmin: false, loading: false,
  authError: null as string | null, retryAuth: vi.fn(),
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => auth }));
vi.mock("@/hooks/usePlatformSettings", () => ({ usePlatformSettings: () => ({ settings: { maintenance_mode: false } }) }));
const portal=vi.hoisted(()=>({active:false}));
vi.mock("@/lib/portalSession", () => ({ isClientPortalActive: () => portal.active }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {
  from: (table: string) => {
    const chain = { select: () => chain, eq: () => chain, or: () => chain, order: () => chain, limit: () => chain,
      maybeSingle: () => table === "profiles" ? api.profile() : api.subscription() };
    return chain;
  },
  rpc: api.rpc,
} }));
const open = async () => {
  render(<MemoryRouter><ProtectedRoute><div>Área interna</div></ProtectedRoute></MemoryRouter>);
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
};
beforeEach(() => {
  portal.active=false;
  vi.useFakeTimers(); vi.clearAllMocks(); localStorage.clear();
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
  auth.profile.is_blocked = false;
  auth.authError = null;
  api.profile.mockResolvedValue({ data: auth.profile, error: null });
  api.subscription.mockResolvedValue({ data: { status: "cancelled" }, error: null });
  api.rpc.mockResolvedValue({ data: null, error: null });
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });
it('does not render or query creditor data while a portal session is being isolated',async()=>{
  portal.active=true;await open();
  expect(screen.queryByText('Área interna')).toBeNull();expect(api.profile).not.toHaveBeenCalled();expect(api.subscription).not.toHaveBeenCalled();
});

it("revalida assinatura expirada mesmo com cache positivo de acesso", async () => {
  localStorage.setItem("__credmais_sub_status_v2_a", JSON.stringify({ v: "allowed", t: Date.now() }));
  await open();
  expect(screen.queryByText("Área interna")).toBeNull();
  expect(screen.getByText("Assinatura necessária")).toBeVisible();
});

it("usa assinatura confirmada mesmo quando a consulta redundante de perfil falha", async () => {
  api.profile.mockRejectedValue(new Error("Falha de rede"));
  api.subscription.mockResolvedValue({ data: { status: "active" }, error: null });
  await open();
  expect(screen.getByText("Área interna")).toBeVisible();
});

it("mostra planos sem esperar um link de checkout que não responde", async () => {
  api.rpc.mockReturnValue(new Promise(() => {}));
  await open();
  expect(screen.getByText("Assinatura necessária")).toBeVisible();
  expect(screen.getByRole("link", { name: "Ver planos" })).toBeVisible();
  await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
  expect(screen.getByText("Assinatura necessária")).toBeVisible();
});

it("oferece nova tentativa quando a verificação de acesso não responde", async () => {
  api.profile.mockReturnValueOnce(new Promise(() => {}));
  api.subscription.mockReturnValueOnce(new Promise(() => {}));
  await open();
  expect(screen.getByRole("status", { name: "Verificando acesso" })).toBeVisible();
  await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
  expect(screen.getByText("Não foi possível verificar seu acesso")).toBeVisible();
  api.subscription.mockResolvedValue({ data: { status: "active" }, error: null });
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Tentar novamente" })); });
  expect(screen.getByText("Área interna")).toBeVisible();
});

it("o botão de recuperação tenta novamente a autenticação quando o perfil falha", async () => {
  auth.authError = "Não foi possível carregar seu perfil.";
  await open();
  fireEvent.click(screen.getByRole("button", { name: "Tentar novamente" }));
  expect(auth.retryAuth).toHaveBeenCalledTimes(1);
  expect(api.subscription).not.toHaveBeenCalled();
});

it("mostra bloqueio administrativo sem esperar consultas auxiliares", async () => {
  auth.profile.is_blocked = true;
  api.profile.mockReturnValue(new Promise(() => {}));
  await open();
  expect(screen.getByText("Conta Bloqueada")).toBeVisible();
  expect(api.profile).not.toHaveBeenCalled();
});

it("não prolonga trial vencido pelo cache offline", async () => {
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
  localStorage.setItem("__credmais_sub_status_v2_a", JSON.stringify({ v: "allowed", t: Date.now() }));
  await open();
  expect(screen.queryByText("Área interna")).toBeNull();
  expect(screen.getByText("Não foi possível verificar seu acesso")).toBeVisible();
});
