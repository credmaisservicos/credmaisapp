import { render } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

const sairDoAppNativo = vi.fn();
let aoVoltar: ((podeVoltar: boolean) => void) | undefined;

vi.mock("@/lib/native", () => ({
  isNativeApp: () => true,
  aplicarTemaNativo: vi.fn(),
  sairDoAppNativo: () => sairDoAppNativo(),
  ouvirBotaoVoltar: (handler: (podeVoltar: boolean) => void) => {
    aoVoltar = handler;
    return Promise.resolve(() => {});
  },
  ouvirRetomada: () => Promise.resolve(() => {}),
}));

vi.mock("@/contexts/ThemeContext", () => ({
  useTheme: () => ({ theme: "dark" as const, toggleTheme: () => {} }),
}));

import NativeShell from "@/components/NativeShell";

const montar = async () => {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <NativeShell />
    </QueryClientProvider>,
  );
  // O registro do ouvinte é assíncrono (`import()` do plugin).
  await vi.waitFor(() => expect(aoVoltar).toBeTypeOf("function"));
};

beforeEach(() => {
  aoVoltar = undefined;
  sairDoAppNativo.mockClear();
  document.body.innerHTML = "";
});

/**
 * O botão físico de voltar do Android. Sem tratamento, a WebView fecha o app
 * de qualquer tela — inclusive por cima de um modal aberto.
 */
describe("botão voltar do Android", () => {
  it("fecha o modal aberto em vez de navegar por baixo dele", async () => {
    await montar();
    const modal = document.createElement("div");
    modal.setAttribute("role", "dialog");
    document.body.appendChild(modal);

    const escapes: string[] = [];
    document.addEventListener("keydown", (event) => escapes.push(event.key));
    const voltarNoHistorico = vi.spyOn(window.history, "back").mockImplementation(() => {});

    aoVoltar!(true);

    expect(escapes).toContain("Escape");
    expect(voltarNoHistorico).not.toHaveBeenCalled();
    expect(sairDoAppNativo).not.toHaveBeenCalled();
    voltarNoHistorico.mockRestore();
  });

  it("volta uma tela quando há para onde voltar", async () => {
    await montar();
    const voltarNoHistorico = vi.spyOn(window.history, "back").mockImplementation(() => {});

    aoVoltar!(true);

    expect(voltarNoHistorico).toHaveBeenCalledTimes(1);
    expect(sairDoAppNativo).not.toHaveBeenCalled();
    voltarNoHistorico.mockRestore();
  });

  // Quem decide é a WebView. Um palpite por `history.length` erra para mais e
  // deixa o botão voltar mudo, sem saída do app — por isso o teste fixa um
  // `history.length` alto e ainda assim exige a saída.
  it("sai do app na raiz, que é o esperado no Android", async () => {
    await montar();
    const voltarNoHistorico = vi.spyOn(window.history, "back").mockImplementation(() => {});
    vi.spyOn(window.history, "length", "get").mockReturnValue(9);

    aoVoltar!(false);

    expect(sairDoAppNativo).toHaveBeenCalledTimes(1);
    expect(voltarNoHistorico).not.toHaveBeenCalled();
    voltarNoHistorico.mockRestore();
  });
});
