import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { act } from "react";
import SuspenseWatchdog from "@/components/SuspenseWatchdog";

afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("carregamento em uma conexão lenta", () => {
  it("mantém a tela e o cache offline depois de 45s, com recuperação explícita", () => {
    vi.useFakeTimers();
    const keys = vi.fn().mockResolvedValue(["credmais-offline"]);
    const remove = vi.fn();
    vi.stubGlobal("caches", { keys, delete: remove });
    sessionStorage.removeItem("__chunk_reloaded_at");
    render(<SuspenseWatchdog><p>Carregando página</p></SuspenseWatchdog>);
    act(() => { vi.advanceTimersByTime(45_000); });
    expect(screen.getByText("Carregando página")).toBeVisible();
    expect(screen.getByRole("button", { name: "Tentar novamente" })).toBeVisible();
    expect(keys).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
    expect(sessionStorage.getItem("__chunk_reloaded_at")).toBeNull();
  });
  it("cancela o aviso se a tela terminar de carregar antes do limite", () => {
    vi.useFakeTimers();
    const view = render(<SuspenseWatchdog>Carregando</SuspenseWatchdog>);
    view.unmount();
    act(() => { vi.advanceTimersByTime(20_000); });
    expect(screen.queryByRole("button")).toBeNull();
  });
});
