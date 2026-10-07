// @vitest-environment node
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";

function worker(keys: string[] = [], readiness: (boolean | undefined)[] = []) {
  const handlers = new Map();
  const cache = { put: vi.fn(), match: vi.fn().mockResolvedValue(undefined) };
  const fetch = vi.fn().mockResolvedValue(new Response("<!doctype html><title>CredMais</title>"));
  const deleted = vi.fn().mockResolvedValue(true);
  const skipWaiting = vi.fn().mockResolvedValue(undefined);
  runInNewContext(readFileSync("public/sw.js", "utf8"), {
    self: { addEventListener: (event, handler) => handlers.set(event, handler), skipWaiting, clients: { claim: vi.fn().mockResolvedValue(undefined), matchAll: vi.fn().mockResolvedValue(readiness.map(ready => ({ postMessage: (_message, ports) => { if (ready !== undefined) ports[0].reply(ready); } }))) } },
    location: { origin: "https://credmais.example.com" },
    URL, Response, fetch,
    setTimeout: callback => setTimeout(callback, 0), clearTimeout,
    MessageChannel: class {
      port1 = { onmessage: null, close: vi.fn() };
      port2 = { reply: ready => this.port1.onmessage?.({ data: { ready } }) };
    },
    caches: { open: vi.fn().mockResolvedValue(cache), match: vi.fn().mockResolvedValue(undefined), keys: vi.fn().mockResolvedValue(keys), delete: deleted },
  });
  return { handle: handlers.get("fetch"), activate: handlers.get("activate"), message: handlers.get("message"), fetch, cache, deleted, skipWaiting };
}

describe("downloads fora do cache de navegação do PWA", () => {
  it.each([{ readiness: [true, true], expected: 1 }, { readiness: [true, false], expected: 0 }, { readiness: [true, undefined], expected: 0 }])("aplica a atualização somente quando todas as abas informam que podem atualizar: $readiness", async ({ readiness, expected }) => {
    const { message, skipWaiting } = worker([], readiness);
    const waitUntil = vi.fn();
    message({ data: { type: "CHECK_UPDATE" }, waitUntil });
    await waitUntil.mock.calls[0][0];
    expect(skipWaiting).toHaveBeenCalledTimes(expected);
  });
  it("mantém os chunks da versão anterior enquanto há formulário aberto", async () => {
    const { activate, deleted } = worker(["credmais-v22-static", "credmais-v22-html", "credmais-v23-downloads-static", "credmais-v23-downloads-runtime", "credmais-v24-release-__BUILD_ID__-static"]);
    const waitUntil = vi.fn();
    activate({ waitUntil });
    await waitUntil.mock.calls[0][0];
    expect(deleted.mock.calls.map(call => call[0])).toEqual(["credmais-v22-static", "credmais-v22-html"]);
  });
  it.each(["/downloads/CredMais.apk?v=2", "/CredMais.ipa", "/downloads/manifest.json"])("não substitui o download por HTML: %s", (path) => {
    const { handle, fetch, cache } = worker();
    const respondWith = vi.fn();
    handle({ request: { method: "GET", url: "https://credmais.example.com" + path, mode: "navigate", headers: new Headers({ accept: "text/html" }) }, respondWith });
    expect(respondWith).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    expect(cache.put).not.toHaveBeenCalled();
  });
  it("preserva navegação HTML e o cache de contingência do app", async () => {
    const { handle, fetch, cache } = worker();
    const respondWith = vi.fn();
    handle({ request: { method: "GET", url: "https://credmais.example.com/baixar", mode: "navigate", headers: new Headers({ accept: "text/html" }) }, respondWith });
    const response = await respondWith.mock.calls[0][0];
    expect(response.status).toBe(200);
    expect(fetch).toHaveBeenCalledOnce();
    expect(cache.put).toHaveBeenCalledOnce();
  });
});
