import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchAll } from "@/lib/fetchAll";

afterEach(() => vi.useRealTimers());
describe("carregamento paginado", () => {
  it("mantém todas as páginas e suas faixas", async () => {
    const build = vi.fn().mockResolvedValueOnce({ data: [1, 2], error: null }).mockResolvedValueOnce({ data: [3], error: null });
    expect(await fetchAll(build, 2)).toEqual([1, 2, 3]);
    expect(build.mock.calls).toEqual([[0, 1], [2, 3]]);
  });
  it("não apresenta totais parciais se uma página falhar", async () => {
    const error = { message: "Sem conexão" };
    const build = vi.fn().mockResolvedValueOnce({ data: [1, 2], error: null }).mockResolvedValueOnce({ data: null, error });
    await expect(fetchAll(build, 2)).rejects.toBe(error);
  });
  it("encerra a espera de uma página sem resposta", async () => {
    vi.useFakeTimers();
    const check = expect(fetchAll(() => new Promise(() => {}))).rejects.toThrow("demorou demais");
    await vi.advanceTimersByTimeAsync(20_000);
    await check;
    expect(vi.getTimerCount()).toBe(0);
  });
});
