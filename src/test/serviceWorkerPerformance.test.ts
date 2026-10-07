// @vitest-environment node
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";

function setup(online = true) {
  const handlers = new Map();
  const stored = new Map<string, Response>();
  let active = 0, peak = 0;
  const added: string[] = [];
  const manifest = {
    "index.html": { isEntry: true, file: "assets/main.js", imports: ["vendor"] },
    vendor: { file: "assets/vendor.js" },
    "src/pages/Dashboard.tsx": { file: "assets/dashboard.js", imports: ["vendor"] },
    ...Object.fromEntries(Array.from({ length: 40 }, (_, i) => ["route" + i, { file: `assets/route${i}.js` }])),
  };
  const fetch = vi.fn().mockImplementation(async url => {
    if (url === "/vite-manifest.json") return Response.json(manifest);
    added.push(url); active++; peak = Math.max(peak, active);
    await new Promise(resolve => setTimeout(resolve, 1));
    active--;
    return new Response("cached", { headers: { "content-type": url.endsWith(".js") ? "text/javascript" : /\.(?:png|webp|svg|ico)$/.test(url) ? "image/png" : "text/html" } });
  });
  const cache = {
    match: vi.fn(async key => stored.get(typeof key === "string" ? key : key.url)),
    put: vi.fn(async (key, response) => { stored.set(typeof key === "string" ? key : key.url, response); }),
    add: vi.fn(async url => {
      added.push(url); active++; peak = Math.max(peak, active);
      await new Promise(resolve => setTimeout(resolve, 1));
      stored.set(url, new Response("cached")); active--;
    }),
  };
  runInNewContext(readFileSync("public/sw.js", "utf8"), {
    self: { navigator: { onLine: online }, addEventListener: (type, fn) => handlers.set(type, fn) },
    location: { origin: "https://credmais.example.com" },
    URL, Response, fetch, setTimeout: callback => setTimeout(callback, 0), clearTimeout,
    caches: { open: async () => cache, match: cache.match },
  });
  return { handlers, cache, stored, added, fetch, peak: () => peak };
}

describe("service worker em celulares", () => {
  it("mantém a publicação em uso se a conexão cair antes da atualização", async () => {
    const worker = setup(false), waitUntil = vi.fn();
    worker.handlers.get("message")({ data: { type: "CHECK_UPDATE" }, waitUntil });
    await waitUntil.mock.calls[0][0];
    expect(worker.fetch).not.toHaveBeenCalled();
  });
  it("instala só o shell e o painel, com no máximo dois downloads simultâneos", async () => {
    const worker = setup(), waitUntil = vi.fn();
    worker.handlers.get("install")({ waitUntil });
    await waitUntil.mock.calls[0][0];
    expect(worker.peak()).toBe(2);
    expect(worker.added).toContain("/assets/main.js");
    expect(worker.added).toContain("/assets/dashboard.js");
    expect(worker.added).not.toContain("/assets/route0.js");
  });
  it("prepara as outras rotas offline quando o cliente libera o aquecimento", async () => {
    const worker = setup(), waitUntil = vi.fn();
    worker.handlers.get("message")({ data: { type: "WARM_OFFLINE_ROUTES" }, waitUntil });
    await waitUntil.mock.calls[0][0];
    expect(worker.added).toContain("/assets/route39.js");
    expect(worker.peak()).toBe(2);
  });
  it("abre o shell salvo se a rede ficar pendurada", async () => {
    const worker = setup(), respondWith = vi.fn(), waitUntil = vi.fn();
    worker.stored.set("/dashboard", new Response("shell offline"));
    worker.fetch.mockImplementation(() => new Promise(() => {}));
    worker.handlers.get("fetch")({ request: { method: "GET", mode: "navigate", url: "https://credmais.example.com/clientes", headers: new Headers() }, respondWith, waitUntil });
    expect(await (await respondWith.mock.calls[0][0]).text()).toBe("shell offline");
    expect(worker.cache.put).not.toHaveBeenCalled();
  });
  it("respostas HTTP 503 não substituem o shell offline", async () => {
    const worker = setup(), respondWith = vi.fn(), waitUntil = vi.fn();
    worker.stored.set("/dashboard", new Response("shell offline"));
    worker.fetch.mockResolvedValue(new Response("indisponível", { status: 503 }));
    worker.handlers.get("fetch")({ request: { method: "GET", mode: "navigate", url: "https://credmais.example.com/clientes", headers: new Headers() }, respondWith, waitUntil });
    expect(await (await respondWith.mock.calls[0][0]).text()).toBe("shell offline");
    expect(worker.cache.put).not.toHaveBeenCalled();
  });
  it("não conserva HTML devolvido no lugar de JavaScript pelo CDN", async () => {
    const worker = setup(), respondWith = vi.fn(), waitUntil = vi.fn();
    worker.stored.set("https://credmais.example.com/assets/route.js", new Response("html incorreto", { headers: { "content-type": "text/html" } }));
    worker.fetch.mockResolvedValue(new Response("html incorreto", { headers: { "content-type": "text/html" } }));
    worker.handlers.get("fetch")({ request: { method: "GET", mode: "cors", url: "https://credmais.example.com/assets/route.js", headers: new Headers() }, respondWith, waitUntil });
    expect((await respondWith.mock.calls[0][0]).type).toBe("error");
    expect(worker.fetch).toHaveBeenCalledOnce();
    expect(worker.cache.put).not.toHaveBeenCalled();
  });
});
