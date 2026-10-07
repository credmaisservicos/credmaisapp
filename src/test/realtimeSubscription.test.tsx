import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import { useMultiTableRealtime, useRealtimeSubscription } from "@/hooks/useRealtimeSubscription";

const mocks = vi.hoisted(() => ({
  user: { id: "tenant-a" } as { id: string } | null,
  invalidateQueries: vi.fn(), channel: vi.fn(), removeChannel: vi.fn(),
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: mocks.user }) }));
vi.mock("@tanstack/react-query", () => ({ useQueryClient: () => queryClient }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: mocks }));
const queryClient = { invalidateQueries: mocks.invalidateQueries };
type Channel = { on: ReturnType<typeof vi.fn>; subscribe: ReturnType<typeof vi.fn>; callbacks: (() => void)[] };
let channels: Channel[];

beforeEach(() => {
  vi.useFakeTimers(); vi.clearAllMocks(); mocks.user = { id: "tenant-a" }; channels = [];
  mocks.channel.mockImplementation(() => {
    const channel: Channel = { callbacks: [], on: vi.fn(), subscribe: vi.fn() };
    channel.on.mockImplementation((_event, _config, callback) => { channel.callbacks.push(callback); return channel; });
    channels.push(channel); return channel;
  });
});
afterEach(() => { cleanup(); vi.useRealTimers(); });
const advance = (ms: number) => act(() => { vi.advanceTimersByTime(ms); });

describe("atualizações em tempo real", () => {
  it("agrupa 500 alterações entre tabelas em uma atualização por consulta", () => {
    renderHook(() => useMultiTableRealtime(["clients", "contracts", "clients"], [["clients", "tenant-a"], ["summary", "tenant-a"]]));
    expect(mocks.channel).toHaveBeenCalledTimes(1);
    expect(mocks.channel.mock.calls[0][0]).toMatch(/^tenant:tenant-a:/);
    expect(channels[0].on).toHaveBeenCalledTimes(2);
    for (let n = 0; n < 500; n++) channels[0].callbacks[n % 2]();
    advance(249); expect(mocks.invalidateQueries).not.toHaveBeenCalled();
    advance(1); expect(mocks.invalidateQueries.mock.calls).toEqual([
      [{ queryKey: ["clients", "tenant-a"] }], [{ queryKey: ["summary", "tenant-a"] }],
    ]);
    channels[0].callbacks[0](); advance(250);
    expect(mocks.invalidateQueries).toHaveBeenCalledTimes(4);
  });
  it("não reassina por arrays inline iguais e usa as novas chaves quando mudam", () => {
    const { rerender } = renderHook(({ key }) => useMultiTableRealtime(["clients"], [[key]]), { initialProps: { key: "old" } });
    rerender({ key: "old" }); expect(mocks.channel).toHaveBeenCalledTimes(1);
    channels[0].callbacks[0](); rerender({ key: "new" }); advance(250);
    expect(mocks.invalidateQueries).not.toHaveBeenCalled();
    expect(mocks.removeChannel).toHaveBeenCalledWith(channels[0]);
    channels[1].callbacks[0](); advance(250);
    expect(mocks.invalidateQueries).toHaveBeenCalledWith({ queryKey: ["new"] });
  });
  it("cancela eventos pendentes e tardios ao sair ou trocar de conta", () => {
    const { rerender, unmount } = renderHook(() => useRealtimeSubscription("clients", [["clients", mocks.user?.id || ""]]));
    channels[0].callbacks[0](); mocks.user = { id: "tenant-b" }; rerender();
    channels[0].callbacks[0](); advance(250);
    expect(mocks.invalidateQueries).not.toHaveBeenCalled();
    expect(mocks.channel.mock.calls[1][0]).toMatch(/^tenant:tenant-b:/);
    channels[1].callbacks[0](); unmount(); channels[1].callbacks[0](); advance(250);
    expect(mocks.invalidateQueries).not.toHaveBeenCalled();
    expect(mocks.removeChannel).toHaveBeenCalledTimes(2);
  });
  it("acompanha mudanças na lista de tabelas sem variar as dependências do effect", () => {
    const { rerender } = renderHook(({ tables }) => useMultiTableRealtime(tables, [["data"]]), { initialProps: { tables: ["clients"] } });
    rerender({ tables: ["clients", "contracts"] });
    expect(channels[1].on.mock.calls.map(call => call[1].table)).toEqual(["clients", "contracts"]);
    rerender({ tables: [] }); expect(mocks.removeChannel).toHaveBeenCalledTimes(2);
  });
  it("não assina sem sessão autenticada", () => {
    mocks.user = null; renderHook(() => useRealtimeSubscription("clients", [["clients"]]));
    expect(mocks.channel).not.toHaveBeenCalled();
  });
});
