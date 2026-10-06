import { beforeEach, describe, expect, it, vi } from "vitest";

const supabaseMock = vi.hoisted(() => ({
  getSession: vi.fn(),
  insert: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: { getSession: supabaseMock.getSession },
    from: () => ({ insert: supabaseMock.insert }),
  },
}));

import { instalarCapturaDeErros, reportError } from "@/lib/reportError";

describe("coletor de erros do navegador", () => {
  beforeEach(() => {
    supabaseMock.getSession.mockReset().mockResolvedValue({ data: { session: null } });
    supabaseMock.insert.mockReset().mockResolvedValue({ error: null });
  });

  it("descarta erro de chunk antes de consultar a sessão ou gravar", async () => {
    await reportError(new Error("Failed to fetch dynamically imported module"));

    expect(supabaseMock.getSession).not.toHaveBeenCalled();
    expect(supabaseMock.insert).not.toHaveBeenCalled();
  });

  it("ignora cancelamentos de consulta causados por navegação", async () => {
    const cancelled = new Error("query cancelled");
    cancelled.name = "CancelledError";
    await reportError(cancelled);

    expect(supabaseMock.getSession).not.toHaveBeenCalled();
    expect(supabaseMock.insert).not.toHaveBeenCalled();
  });

  it("reduz contexto excessivo antes de enviá-lo", async () => {
    await reportError(new Error("falha com contexto extenso"), {
      origem: "manual",
      resposta: "x".repeat(5_000),
    });

    expect(supabaseMock.insert).toHaveBeenCalledWith(
      expect.objectContaining({ contexto: { origem: "manual", truncado: true } }),
    );
  });

  it("instala cada capturador global uma única vez", () => {
    const listener = vi.spyOn(window, "addEventListener");

    instalarCapturaDeErros();
    instalarCapturaDeErros();

    expect(listener.mock.calls.filter(([tipo]) => tipo === "error")).toHaveLength(1);
    expect(listener.mock.calls.filter(([tipo]) => tipo === "unhandledrejection")).toHaveLength(1);
    listener.mockRestore();
  });
});
