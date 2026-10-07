import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { withTimeout,withAbortTimeout } from "@/lib/withTimeout";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

it("libera o temporizador quando a requisição termina", async () => {
  await expect(withTimeout(Promise.resolve("ok"))).resolves.toBe("ok");
  expect(vi.getTimerCount()).toBe(0);
});
it("preserva o erro original e libera o temporizador", async () => {
  const error = new Error("Falha de conexão");
  await expect(withTimeout(Promise.reject(error))).rejects.toBe(error);
  expect(vi.getTimerCount()).toBe(0);
});
it("encerra a espera de uma requisição pendente", async () => {
  const check = expect(withTimeout(new Promise(() => {}), 500)).rejects.toThrow("demorou demais");
  await vi.advanceTimersByTimeAsync(500);
  await check;
  expect(vi.getTimerCount()).toBe(0);
});
it('cancela a rede de uma leitura expirada sem repetir a operação',async()=>{
 let signal!:AbortSignal;const request=vi.fn((current:AbortSignal)=>{signal=current;return new Promise(()=>{});});
 const check=expect(withAbortTimeout(request,500)).rejects.toThrow('servidor demorou');
 await vi.advanceTimersByTimeAsync(500);await check;expect(signal.aborted).toBe(true);expect(request).toHaveBeenCalledTimes(1);expect(vi.getTimerCount()).toBe(0);
});
it('libera a rede e o temporizador de uma leitura concluída',async()=>{
 let signal!:AbortSignal;await expect(withAbortTimeout(current=>{signal=current;return Promise.resolve('ok');})).resolves.toBe('ok');
 expect(signal.aborted).toBe(true);expect(vi.getTimerCount()).toBe(0);
});
